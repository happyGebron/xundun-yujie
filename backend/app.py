from __future__ import annotations

import asyncio
import csv
import hashlib
import io
import os
import shutil
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from uuid import uuid4

import cv2
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

try:
    from .analysis import AnalysisError, analyze_bundle, analyze_sensor, analyze_thermal
    from .coordination import MissionEngine, SPEED_INTERVALS, load_scenarios
    from .schemas import MissionCommand, MissionCreate, RiskReview, SampleAnalysisRequest
    from .storage import Database, utc_now
except ImportError:
    from analysis import AnalysisError, analyze_bundle, analyze_sensor, analyze_thermal
    from coordination import MissionEngine, SPEED_INTERVALS, load_scenarios
    from schemas import MissionCommand, MissionCreate, RiskReview, SampleAnalysisRequest
    from storage import Database, utc_now


BASE_DIR = Path(__file__).resolve().parent.parent
RUNTIME_DIR = Path(os.getenv("XUNDUN_RUNTIME_DIR", BASE_DIR / "runtime"))
ARTIFACT_DIR = RUNTIME_DIR / "artifacts"
TEMP_DIR = RUNTIME_DIR / "tmp"
DATA_DIR = BASE_DIR / "data"
FRONTEND_DIST = Path(os.getenv("XUNDUN_FRONTEND_DIST", BASE_DIR / "frontend" / "dist"))
UPLOAD_RULES = {
    "rgb": {
        "limit": 20 * 1024 * 1024, "extensions": {".jpg", ".jpeg", ".png"},
        "mime": {"image/jpeg", "image/png", "application/octet-stream"},
    },
    "video": {
        "limit": 100 * 1024 * 1024, "extensions": {".mp4"},
        "mime": {"video/mp4", "application/mp4", "application/octet-stream"},
    },
    "thermal": {
        "limit": 5 * 1024 * 1024, "extensions": {".csv"},
        "mime": {"text/csv", "application/csv", "application/vnd.ms-excel", "text/plain", "application/octet-stream"},
    },
    "sensor": {
        "limit": 5 * 1024 * 1024, "extensions": {".csv"},
        "mime": {"text/csv", "application/csv", "application/vnd.ms-excel", "text/plain", "application/octet-stream"},
    },
}


def api_error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})


class StreamHub:
    def __init__(self) -> None:
        self.clients: dict[str, dict[WebSocket, asyncio.Queue[dict[str, Any]]]] = {}
        self.lock = asyncio.Lock()

    async def connect(self, mission_id: str, socket: WebSocket) -> asyncio.Queue[dict[str, Any]]:
        await socket.accept()
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=64)
        async with self.lock:
            self.clients.setdefault(mission_id, {})[socket] = queue
        return queue

    async def disconnect(self, mission_id: str, socket: WebSocket) -> None:
        async with self.lock:
            sockets = self.clients.get(mission_id)
            if sockets:
                sockets.pop(socket, None)
                if not sockets:
                    self.clients.pop(mission_id, None)

    async def publish(self, mission_id: str, message: dict[str, Any]) -> None:
        async with self.lock:
            queues = list(self.clients.get(mission_id, {}).values())
        for queue in queues:
            if queue.full():
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            queue.put_nowait(message)


hub = StreamHub()


def state_envelope(state: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "snapshot", "mission_id": state["mission"]["id"], "sequence": state.get("stream_sequence", 0),
        "timestamp": state["mission"]["updated_at"], "data": state,
    }


async def publish_state(app: FastAPI, state: dict[str, Any]) -> None:
    await hub.publish(state["mission"]["id"], state_envelope(state))


async def simulation_loop(app: FastAPI) -> None:
    last_tick: dict[str, float] = {}
    loop = asyncio.get_running_loop()
    while True:
        await asyncio.sleep(0.1)
        engine: MissionEngine = app.state.engine
        for mission_id in app.state.database.running_missions():
            state = engine.get(mission_id)
            interval = SPEED_INTERVALS.get(float(state["mission"]["speed"]), 1.0)
            now = loop.time()
            if now - last_tick.get(mission_id, 0) < interval:
                continue
            last_tick[mission_id] = now
            updated = await asyncio.to_thread(engine.tick, mission_id)
            await publish_state(app, updated)


async def analysis_worker(app: FastAPI) -> None:
    loop = asyncio.get_running_loop()
    while True:
        job = await app.state.analysis_queue.get()
        analysis_id = job["analysis_id"]
        mission_id = job.get("mission_id")

        def progress(value: int) -> None:
            app.state.database.update_analysis(analysis_id, status="processing", progress=value)
            message = {
                "type": "analysis_progress", "mission_id": mission_id, "sequence": 0, "timestamp": utc_now(),
                "data": {"analysis_id": analysis_id, "status": "processing", "progress": value},
            }
            if mission_id:
                asyncio.run_coroutine_threadsafe(hub.publish(mission_id, message), loop)

        analysis = None
        try:
            app.state.database.update_analysis(analysis_id, status="processing", progress=2)
            result = await asyncio.to_thread(
                analyze_bundle, {name: Path(path) for name, path in job["paths"].items()}, ARTIFACT_DIR, analysis_id, progress
            )
            location = job.get("location")
            if mission_id and location:
                state = await asyncio.to_thread(
                    app.state.engine.add_analysis_risk, mission_id, analysis_id, result, float(location["x"]), float(location["y"])
                )
                await publish_state(app, state)
            analysis = app.state.database.update_analysis(analysis_id, status="completed", progress=100, result=result)
        except AnalysisError as error:
            analysis = app.state.database.update_analysis(
                analysis_id, status="failed", progress=0, error={"code": error.code, "message": error.message}
            )
        except Exception as error:
            analysis = app.state.database.update_analysis(
                analysis_id, status="failed", progress=0, error={"code": "ANALYSIS_FAILED", "message": str(error) or "Analysis failed."}
            )
        finally:
            for path in job["paths"].values():
                Path(path).unlink(missing_ok=True)
            app.state.analysis_queue.task_done()
        if mission_id and analysis:
            await hub.publish(
                mission_id,
                {
                    "type": "analysis_progress", "mission_id": mission_id, "sequence": 0, "timestamp": utc_now(),
                    "data": {"analysis_id": analysis_id, "status": analysis["status"], "progress": analysis["progress"], "result": analysis["result"], "error": analysis["error"]},
                },
            )


@asynccontextmanager
async def lifespan(app: FastAPI):
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    for path in TEMP_DIR.iterdir():
        if path.is_file():
            path.unlink(missing_ok=True)
    database = Database(RUNTIME_DIR / "xundun.db")
    database.initialize()
    engine = MissionEngine(database, load_scenarios(DATA_DIR / "scenarios.json"))
    engine.ensure_default()
    app.state.database = database
    app.state.engine = engine
    app.state.analysis_queue = asyncio.Queue()
    app.state.simulation_task = asyncio.create_task(simulation_loop(app))
    app.state.analysis_task = asyncio.create_task(analysis_worker(app))
    yield
    for task in (app.state.simulation_task, app.state.analysis_task):
        task.cancel()
    await asyncio.gather(app.state.simulation_task, app.state.analysis_task, return_exceptions=True)


app = FastAPI(
    title="Xundun Yujie API",
    description="Deterministic dam-inspection analysis and air-ground coordination simulation.",
    version="2.0.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173", "http://127.0.0.1:8000", "http://localhost:8000"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Accept"],
)
if (FRONTEND_DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")


@app.exception_handler(HTTPException)
async def http_error_handler(_, error: HTTPException) -> JSONResponse:
    detail = error.detail if isinstance(error.detail, dict) else {"code": "HTTP_ERROR", "message": str(error.detail)}
    return JSONResponse(status_code=error.status_code, content={"error": detail})


def require_mission(app: FastAPI, mission_id: str) -> dict[str, Any]:
    try:
        return app.state.engine.get(mission_id)
    except KeyError as error:
        raise api_error(404, "MISSION_NOT_FOUND", "Mission was not found.") from error


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {"status": "ok", "version": "2.0.0", "time": utc_now()}


@app.get("/api/v2/scenarios")
async def scenarios() -> list[dict[str, Any]]:
    return list(app.state.engine.scenarios.values())


@app.get("/api/v2/missions")
async def missions() -> list[dict[str, Any]]:
    return app.state.database.list_missions()


@app.post("/api/v2/missions", status_code=201)
async def create_mission(request: MissionCreate) -> dict[str, Any]:
    try:
        state = app.state.engine.create(request)
    except ValueError as error:
        raise api_error(404, str(error), "Scenario was not found.") from error
    await publish_state(app, state)
    return state


@app.get("/api/v2/missions/{mission_id}")
async def get_mission(mission_id: str) -> dict[str, Any]:
    return require_mission(app, mission_id)


@app.delete("/api/v2/missions/{mission_id}")
async def delete_mission(mission_id: str) -> dict[str, Any]:
    state = require_mission(app, mission_id)
    if state["mission"]["status"] == "running":
        raise api_error(409, "MISSION_RUNNING", "Pause the mission before deleting it.")
    artifacts = app.state.database.delete_mission(mission_id)
    if artifacts is None:
        raise api_error(404, "MISSION_NOT_FOUND", "Mission was not found.")
    for filename in artifacts:
        (ARTIFACT_DIR / Path(filename).name).unlink(missing_ok=True)
    return {"deleted": mission_id}


@app.post("/api/v2/missions/{mission_id}/commands")
async def mission_command(mission_id: str, command: MissionCommand) -> dict[str, Any]:
    require_mission(app, mission_id)
    try:
        state = app.state.engine.command(mission_id, command.command, command.value)
    except RuntimeError as error:
        raise api_error(409, str(error), "Another mission is already running.") from error
    except ValueError as error:
        raise api_error(409 if str(error) == "MISSION_COMPLETED" else 400, str(error), "Command could not be applied.") from error
    await publish_state(app, state)
    return state


@app.get("/api/v2/missions/{mission_id}/events")
async def mission_events(mission_id: str, after_sequence: int = Query(default=0, ge=0)) -> list[dict[str, Any]]:
    require_mission(app, mission_id)
    return app.state.database.list_events(mission_id, after_sequence)


@app.get("/api/v2/missions/{mission_id}/comparisons")
async def mission_comparisons(mission_id: str) -> dict[str, Any]:
    return require_mission(app, mission_id)["comparisons"]


@app.post("/api/v2/missions/{mission_id}/faults")
async def mission_fault(mission_id: str, kind: str) -> dict[str, Any]:
    require_mission(app, mission_id)
    try:
        state = app.state.engine.inject_fault(mission_id, kind)
    except ValueError as error:
        raise api_error(400, str(error), "Unknown fault type.") from error
    await publish_state(app, state)
    return state


@app.post("/api/v2/missions/{mission_id}/risks/{risk_id}/review")
async def review_risk(mission_id: str, risk_id: str, review: RiskReview) -> dict[str, Any]:
    require_mission(app, mission_id)
    try:
        state = app.state.engine.review(mission_id, risk_id, review.decision, review.note)
    except KeyError as error:
        raise api_error(404, "RISK_NOT_FOUND", "Risk was not found.") from error
    await publish_state(app, state)
    return state


async def store_upload(upload: UploadFile, modality: str) -> tuple[Path, dict[str, Any]]:
    rule = UPLOAD_RULES[modality]
    original_name = Path(upload.filename or f"{modality}.bin").name
    suffix = Path(original_name).suffix.lower()
    if suffix not in rule["extensions"]:
        raise api_error(415, "FILE_EXTENSION_INVALID", f"Unsupported {modality} file extension.")
    mime = (upload.content_type or "application/octet-stream").split(";", 1)[0].strip().lower()
    if mime not in rule["mime"]:
        raise api_error(415, "FILE_MIME_INVALID", f"Unsupported {modality} MIME type.")
    path = TEMP_DIR / f"{uuid4().hex}{suffix}"
    digest = hashlib.sha256()
    size = 0
    try:
        with path.open("wb") as output:
            while chunk := await upload.read(1024 * 1024):
                size += len(chunk)
                if size > rule["limit"]:
                    raise api_error(413, "FILE_TOO_LARGE", f"{modality} file exceeds its size limit.")
                digest.update(chunk)
                output.write(chunk)
    except Exception:
        path.unlink(missing_ok=True)
        raise
    finally:
        await upload.close()
    if size == 0:
        path.unlink(missing_ok=True)
        raise api_error(400, "FILE_EMPTY", "Uploaded file is empty.")
    return path, {"filename": original_name, "mime": mime, "bytes": size, "sha256": digest.hexdigest()}


def validate_stored(path: Path, modality: str) -> None:
    if modality == "rgb" and cv2.imread(str(path), cv2.IMREAD_COLOR) is None:
        raise AnalysisError("IMAGE_DECODE_FAILED", "Image could not be decoded.")
    if modality == "video":
        capture = cv2.VideoCapture(str(path))
        fps = float(capture.get(cv2.CAP_PROP_FPS))
        frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        opened = capture.isOpened()
        capture.release()
        if not opened or fps <= 0 or frame_count <= 0:
            raise AnalysisError("VIDEO_DECODE_FAILED", "Video could not be decoded.")
        if frame_count / fps > 60.1:
            raise AnalysisError("VIDEO_DURATION_LIMIT", "Video must not exceed 60 seconds.")
    if modality == "thermal":
        analyze_thermal(path)
    if modality == "sensor":
        analyze_sensor(path)


async def queue_analysis(mission_id: str | None, location: dict[str, float] | None, uploads: dict[str, UploadFile]) -> dict[str, Any]:
    if mission_id:
        require_mission(app, mission_id)
    if not uploads:
        raise api_error(400, "ANALYSIS_INPUT_REQUIRED", "Provide at least one supported input.")
    if "rgb" in uploads and "video" in uploads:
        raise api_error(400, "VISUAL_INPUT_CONFLICT", "RGB image and video are mutually exclusive.")
    paths: dict[str, Path] = {}
    manifest: dict[str, Any] = {}
    try:
        for name, upload in uploads.items():
            path, metadata = await store_upload(upload, name)
            paths[name] = path
            validate_stored(path, name)
            manifest[name] = metadata
    except AnalysisError as error:
        for path in paths.values():
            path.unlink(missing_ok=True)
        raise api_error(400, error.code, error.message) from error
    except Exception:
        for path in paths.values():
            path.unlink(missing_ok=True)
        raise
    analysis_id = f"ANA-{uuid4().hex[:10].upper()}"
    analysis = app.state.database.create_analysis(analysis_id, mission_id, manifest)
    await app.state.analysis_queue.put(
        {"analysis_id": analysis_id, "mission_id": mission_id, "location": location, "paths": {name: str(path) for name, path in paths.items()}}
    )
    return {"analysis_id": analysis_id, "status": analysis["status"], "sha256_manifest": {name: item["sha256"] for name, item in manifest.items()}}


@app.post("/api/v2/analyses", status_code=202)
async def create_analysis(
    mission_id: str | None = Form(default=None),
    x: float | None = Form(default=None),
    y: float | None = Form(default=None),
    rgb_image: UploadFile | None = File(default=None),
    rgb_video: UploadFile | None = File(default=None),
    thermal_csv: UploadFile | None = File(default=None),
    sensor_csv: UploadFile | None = File(default=None),
) -> dict[str, Any]:
    if (x is None) != (y is None):
        raise api_error(422, "LOCATION_INCOMPLETE", "x and y must be provided together.")
    location = {"x": x, "y": y} if x is not None and y is not None else None
    uploads = {name: upload for name, upload in (("rgb", rgb_image), ("video", rgb_video), ("thermal", thermal_csv), ("sensor", sensor_csv)) if upload is not None}
    return await queue_analysis(mission_id, location, uploads)


def copy_sample(name: str, modality: str) -> tuple[Path, dict[str, Any]]:
    source = DATA_DIR / "samples" / name
    if not source.is_file():
        raise api_error(503, "SAMPLE_NOT_AVAILABLE", f"Sample file {name} is not available.")
    destination = TEMP_DIR / f"{uuid4().hex}{source.suffix}"
    shutil.copyfile(source, destination)
    data = destination.read_bytes()
    mime = "video/mp4" if modality == "video" else "text/csv" if source.suffix == ".csv" else "image/png"
    return destination, {"filename": source.name, "mime": mime, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "sample": True}


@app.post("/api/v2/analyses/sample", status_code=202)
async def sample_analysis(request: SampleAnalysisRequest) -> dict[str, Any]:
    if request.mission_id:
        require_mission(app, request.mission_id)
    names = {"rgb": "surface-anomaly.png", "thermal": "thermal.csv", "sensor": "sensor.csv"} if request.kind == "multimodal" else {"video": "patrol.mp4"}
    paths: dict[str, Path] = {}
    manifest: dict[str, Any] = {}
    try:
        for modality, name in names.items():
            paths[modality], manifest[modality] = copy_sample(name, modality)
            validate_stored(paths[modality], modality)
    except Exception:
        for path in paths.values():
            path.unlink(missing_ok=True)
        raise
    analysis_id = f"ANA-{uuid4().hex[:10].upper()}"
    app.state.database.create_analysis(analysis_id, request.mission_id, manifest)
    location = {"x": request.x, "y": request.y} if request.x is not None and request.y is not None else None
    await app.state.analysis_queue.put(
        {"analysis_id": analysis_id, "mission_id": request.mission_id, "location": location, "paths": {name: str(path) for name, path in paths.items()}}
    )
    return {"analysis_id": analysis_id, "status": "queued", "sha256_manifest": {name: item["sha256"] for name, item in manifest.items()}}


@app.get("/api/v2/analyses")
async def analyses(mission_id: str | None = None, limit: int = Query(default=20, ge=1, le=100)) -> list[dict[str, Any]]:
    return app.state.database.list_analyses(mission_id, limit)


@app.get("/api/v2/analyses/{analysis_id}")
async def get_analysis(analysis_id: str) -> dict[str, Any]:
    analysis = app.state.database.get_analysis(analysis_id)
    if analysis is None:
        raise api_error(404, "ANALYSIS_NOT_FOUND", "Analysis was not found.")
    return analysis


@app.get("/api/v2/artifacts/{filename}")
async def artifact(filename: str) -> FileResponse:
    safe_name = Path(filename).name
    if safe_name != filename:
        raise api_error(400, "ARTIFACT_NAME_INVALID", "Artifact name is invalid.")
    path = ARTIFACT_DIR / safe_name
    if not path.is_file():
        raise api_error(404, "ARTIFACT_NOT_FOUND", "Artifact was not found.")
    return FileResponse(path, media_type="image/jpeg")


def comparison_rows(state: dict[str, Any]) -> list[dict[str, Any]]:
    rows = []
    assignment = state["comparisons"].get("assignment")
    if assignment:
        for method in ("hungarian", "greedy"):
            value = assignment[method]
            rows.append({"category": "assignment", "method": method, "cost": value["total_cost"], "runtime_ms": value["runtime_ms"], "expanded_nodes": "", "path_length": ""})
    for item in state["comparisons"].get("paths", []):
        for method in ("a_star", "dijkstra"):
            value = item[method]
            rows.append({"category": "path", "method": value["algorithm"], "cost": value["cost"], "runtime_ms": value["runtime_ms"], "expanded_nodes": value["expanded_nodes"], "path_length": value["length"]})
    return rows


@app.get("/api/v2/missions/{mission_id}/export.json")
async def export_json(mission_id: str) -> Response:
    bundle = app.state.database.mission_bundle(mission_id)
    if bundle is None:
        raise api_error(404, "MISSION_NOT_FOUND", "Mission was not found.")
    import json
    body = json.dumps(bundle, ensure_ascii=False, indent=2).encode("utf-8")
    return Response(body, media_type="application/json", headers={"Content-Disposition": f'attachment; filename="{mission_id}.json"'})


@app.get("/api/v2/missions/{mission_id}/export.csv")
async def export_csv(mission_id: str, dataset: str = Query(pattern="^(risks|events|comparisons)$")) -> Response:
    state = require_mission(app, mission_id)
    if dataset == "risks":
        rows = [{key: risk.get(key) for key in ("id", "name_zh", "name_en", "severity", "score", "status", "assigned", "source", "position")} for risk in state["risks"]]
    elif dataset == "events":
        rows = [{"sequence": item["sequence"], "type": item["type"], "level": item["level"], "timestamp": item["timestamp"], "code": item["data"].get("code", "")} for item in app.state.database.list_events(mission_id)]
    else:
        rows = comparison_rows(state)
    output = io.StringIO()
    fields = list(rows[0]) if rows else ["empty"]
    writer = csv.DictWriter(output, fieldnames=fields)
    writer.writeheader()
    writer.writerows(rows)
    body = "\ufeff" + output.getvalue()
    return Response(body, media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="{mission_id}-{dataset}.csv"'})


@app.websocket("/api/v2/missions/{mission_id}/stream")
async def mission_stream(socket: WebSocket, mission_id: str, after_sequence: int = 0) -> None:
    try:
        state = app.state.engine.get(mission_id)
    except KeyError:
        await socket.close(code=4404, reason="Mission not found")
        return
    queue = await hub.connect(mission_id, socket)
    try:
        await socket.send_json(state_envelope(state))
        for event in app.state.database.list_events(mission_id, after_sequence):
            await socket.send_json(
                {
                    "type": "event", "mission_id": mission_id, "sequence": event["sequence"], "timestamp": event["timestamp"],
                    "data": {"event": event["data"], "snapshot": event["snapshot"]},
                }
            )
        while True:
            try:
                message = await asyncio.wait_for(queue.get(), timeout=15)
            except asyncio.TimeoutError:
                message = {"type": "heartbeat", "mission_id": mission_id, "sequence": 0, "timestamp": utc_now(), "data": {}}
            await socket.send_json(message)
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        await hub.disconnect(mission_id, socket)


@app.get("/api/overview")
@app.get("/api/state")
async def legacy_overview() -> dict[str, Any]:
    return app.state.engine.legacy()


@app.get("/api/report")
async def legacy_report() -> dict[str, Any]:
    state = app.state.engine.legacy()
    return {"mission": state["mission"], "risks": state["risks"], "timeline": state["timeline"], "disclaimer": "演示数据，仅用于算法与协同仿真。"}


@app.post("/api/mission/start")
async def legacy_start() -> dict[str, Any]:
    state = app.state.engine.command(app.state.engine.default()["mission"]["id"], "start")
    await publish_state(app, state)
    return app.state.engine.legacy(state)


@app.post("/api/mission/pause")
async def legacy_pause() -> dict[str, Any]:
    state = app.state.engine.command(app.state.engine.default()["mission"]["id"], "pause")
    await publish_state(app, state)
    return app.state.engine.legacy(state)


@app.post("/api/mission/reset")
async def legacy_reset() -> dict[str, Any]:
    current = app.state.engine.default()
    state = app.state.engine.command(current["mission"]["id"], "reset")
    await publish_state(app, state)
    return app.state.engine.legacy(state)


@app.post("/api/simulation/tick")
async def legacy_tick() -> dict[str, Any]:
    state = app.state.engine.tick(app.state.engine.default()["mission"]["id"])
    await publish_state(app, state)
    return app.state.engine.legacy(state)


@app.post("/api/fault")
async def legacy_fault(kind: str) -> dict[str, Any]:
    state = app.state.engine.inject_fault(app.state.engine.default()["mission"]["id"], kind)
    await publish_state(app, state)
    return app.state.engine.legacy(state)


@app.post("/api/risks/{risk_id}/review")
async def legacy_review(risk_id: str) -> dict[str, Any]:
    mission_id = app.state.engine.default()["mission"]["id"]
    state = app.state.engine.review(mission_id, risk_id, "confirmed", None)
    await publish_state(app, state)
    return app.state.engine.legacy(state)


@app.get("/{path:path}", include_in_schema=False)
async def spa(path: str) -> Response:
    if path.startswith("api/"):
        return JSONResponse(status_code=404, content={"error": {"code": "NOT_FOUND", "message": "Endpoint was not found."}})
    requested = FRONTEND_DIST / path
    if path and requested.is_file() and FRONTEND_DIST in requested.resolve().parents:
        return FileResponse(requested)
    index = FRONTEND_DIST / "index.html"
    if index.is_file():
        return FileResponse(index)
    return HTMLResponse(
        "<main style='font:16px system-ui;padding:32px'><h1>Xundun Yujie API</h1><p>Frontend build not found. Run the Vite development server or build frontend.</p></main>"
    )
