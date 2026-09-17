from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def encode(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def decode(value: str | None, default: Any = None) -> Any:
    return json.loads(value) if value else default


class Database:
    def __init__(self, path: Path) -> None:
        self.path = path

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path, timeout=20, check_same_thread=False)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 20000")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def initialize(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS missions (
                    id TEXT PRIMARY KEY,
                    scenario_id TEXT NOT NULL,
                    seed INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    speed REAL NOT NULL,
                    cycle INTEGER NOT NULL,
                    config_json TEXT NOT NULL,
                    current_snapshot_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
                    sequence INTEGER NOT NULL,
                    type TEXT NOT NULL,
                    level TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    snapshot_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    UNIQUE(mission_id, sequence)
                );
                CREATE TABLE IF NOT EXISTS analyses (
                    id TEXT PRIMARY KEY,
                    mission_id TEXT REFERENCES missions(id) ON DELETE SET NULL,
                    status TEXT NOT NULL,
                    progress INTEGER NOT NULL,
                    modality_json TEXT NOT NULL,
                    result_json TEXT,
                    error_json TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS reviews (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
                    risk_id TEXT NOT NULL,
                    decision TEXT NOT NULL,
                    note TEXT,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_events_mission_sequence ON events(mission_id, sequence);
                CREATE INDEX IF NOT EXISTS idx_analyses_mission ON analyses(mission_id, created_at DESC);
                PRAGMA user_version = 2;
                """
            )
            now = utc_now()
            connection.execute(
                "UPDATE missions SET status = 'paused', updated_at = ? WHERE status = 'running'",
                (now,),
            )
            connection.execute(
                """UPDATE analyses SET status = 'failed', progress = 0,
                error_json = ?, updated_at = ? WHERE status IN ('queued', 'processing')""",
                (encode({"code": "PROCESS_INTERRUPTED", "message": "Process restarted before analysis completed."}), now),
            )

    def create_mission(self, state: dict[str, Any], event: dict[str, Any]) -> None:
        mission = state["mission"]
        now = mission["created_at"]
        with self.connect() as connection:
            connection.execute(
                """INSERT INTO missions
                (id, scenario_id, seed, status, speed, cycle, config_json, current_snapshot_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    mission["id"], mission["scenario_id"], mission["seed"], mission["status"], mission["speed"],
                    mission["cycle"], encode(state["config"]), encode(state), now, now,
                ),
            )
            connection.execute(
                """INSERT INTO events
                (mission_id, sequence, type, level, payload_json, snapshot_json, created_at)
                VALUES (?, 1, ?, ?, ?, ?, ?)""",
                (mission["id"], event["type"], event["level"], encode(event), encode(state), now),
            )

    def save_mission(self, state: dict[str, Any], event: dict[str, Any] | None = None) -> int:
        mission = state["mission"]
        now = utc_now()
        mission["updated_at"] = now
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            current = int(connection.execute(
                "SELECT COALESCE(MAX(sequence), 0) FROM events WHERE mission_id = ?", (mission["id"],)
            ).fetchone()[0])
            sequence = current + 1 if event is not None else current
            state["stream_sequence"] = sequence
            if event is not None:
                event["sequence"] = sequence
                event["timestamp"] = now
            connection.execute(
                """UPDATE missions SET status = ?, speed = ?, cycle = ?, config_json = ?,
                current_snapshot_json = ?, updated_at = ? WHERE id = ?""",
                (
                    mission["status"], mission["speed"], mission["cycle"], encode(state["config"]),
                    encode(state), now, mission["id"],
                ),
            )
            if event is None:
                return current
            connection.execute(
                """INSERT INTO events
                (mission_id, sequence, type, level, payload_json, snapshot_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (mission["id"], sequence, event["type"], event["level"], encode(event), encode(state), now),
            )
            return sequence

    def get_mission(self, mission_id: str) -> dict[str, Any] | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT current_snapshot_json FROM missions WHERE id = ?", (mission_id,)
            ).fetchone()
        return decode(row["current_snapshot_json"]) if row else None

    def latest_mission(self) -> dict[str, Any] | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT current_snapshot_json FROM missions ORDER BY created_at DESC LIMIT 1"
            ).fetchone()
        return decode(row["current_snapshot_json"]) if row else None

    def list_missions(self) -> list[dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT current_snapshot_json FROM missions ORDER BY created_at DESC"
            ).fetchall()
        states = [decode(row["current_snapshot_json"]) for row in rows]
        return [
            {
                "id": state["mission"]["id"],
                "scenario_id": state["mission"]["scenario_id"],
                "scenario_name": state["mission"].get("scenario_name", state["mission"]["scenario_id"]),
                "status": state["mission"]["status"],
                "cycle": state["mission"]["cycle"],
                "speed": state["mission"]["speed"],
                "coverage": state["summary"]["coverage"],
                "risk_count": state["summary"]["risk_count"],
                "created_at": state["mission"]["created_at"],
                "updated_at": state["mission"]["updated_at"],
            }
            for state in states
        ]

    def running_missions(self, exclude: str | None = None) -> list[str]:
        sql = "SELECT id FROM missions WHERE status = 'running'"
        params: tuple[Any, ...] = ()
        if exclude:
            sql += " AND id != ?"
            params = (exclude,)
        with self.connect() as connection:
            return [row["id"] for row in connection.execute(sql, params).fetchall()]

    def delete_mission(self, mission_id: str) -> list[str] | None:
        state = self.get_mission(mission_id)
        if state is None:
            return None
        artifacts: list[str] = []
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT result_json FROM analyses WHERE mission_id = ?", (mission_id,)
            ).fetchall()
            for row in rows:
                result = decode(row["result_json"], {})
                artifacts.extend(result.get("artifacts", []))
            connection.execute("DELETE FROM missions WHERE id = ?", (mission_id,))
        return artifacts

    def list_events(self, mission_id: str, after_sequence: int = 0) -> list[dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute(
                """SELECT sequence, type, level, payload_json, snapshot_json, created_at FROM events
                WHERE mission_id = ? AND sequence > ? ORDER BY sequence""",
                (mission_id, after_sequence),
            ).fetchall()
        return [
            {
                "sequence": row["sequence"],
                "type": row["type"],
                "level": row["level"],
                "timestamp": row["created_at"],
                "data": decode(row["payload_json"], {}),
                "snapshot": decode(row["snapshot_json"], {}),
            }
            for row in rows
        ]

    def create_analysis(self, analysis_id: str, mission_id: str | None, modalities: dict[str, Any]) -> dict[str, Any]:
        now = utc_now()
        with self.connect() as connection:
            connection.execute(
                """INSERT INTO analyses
                (id, mission_id, status, progress, modality_json, result_json, error_json, created_at, updated_at)
                VALUES (?, ?, 'queued', 0, ?, NULL, NULL, ?, ?)""",
                (analysis_id, mission_id, encode(modalities), now, now),
            )
        return self.get_analysis(analysis_id) or {}

    def update_analysis(
        self,
        analysis_id: str,
        *,
        status: str,
        progress: int,
        result: dict[str, Any] | None = None,
        error: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        with self.connect() as connection:
            connection.execute(
                """UPDATE analyses SET status = ?, progress = ?, result_json = ?, error_json = ?, updated_at = ?
                WHERE id = ?""",
                (status, progress, encode(result) if result is not None else None, encode(error) if error else None, utc_now(), analysis_id),
            )
        return self.get_analysis(analysis_id)

    def get_analysis(self, analysis_id: str) -> dict[str, Any] | None:
        with self.connect() as connection:
            row = connection.execute("SELECT * FROM analyses WHERE id = ?", (analysis_id,)).fetchone()
        return self._analysis_row(row) if row else None

    def list_analyses(self, mission_id: str | None = None, limit: int = 20) -> list[dict[str, Any]]:
        with self.connect() as connection:
            if mission_id:
                rows = connection.execute(
                    "SELECT * FROM analyses WHERE mission_id = ? ORDER BY created_at DESC LIMIT ?",
                    (mission_id, limit),
                ).fetchall()
            else:
                rows = connection.execute("SELECT * FROM analyses ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
        return [self._analysis_row(row) for row in rows]

    @staticmethod
    def _analysis_row(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "mission_id": row["mission_id"],
            "status": row["status"],
            "progress": row["progress"],
            "modalities": decode(row["modality_json"], {}),
            "result": decode(row["result_json"]),
            "error": decode(row["error_json"]),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    def add_review(self, mission_id: str, risk_id: str, decision: str, note: str | None) -> dict[str, Any]:
        now = utc_now()
        with self.connect() as connection:
            cursor = connection.execute(
                "INSERT INTO reviews (mission_id, risk_id, decision, note, created_at) VALUES (?, ?, ?, ?, ?)",
                (mission_id, risk_id, decision, note, now),
            )
        return {"id": cursor.lastrowid, "mission_id": mission_id, "risk_id": risk_id, "decision": decision, "note": note, "created_at": now}

    def list_reviews(self, mission_id: str) -> list[dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM reviews WHERE mission_id = ? ORDER BY created_at", (mission_id,)
            ).fetchall()
        return [dict(row) for row in rows]

    def mission_bundle(self, mission_id: str) -> dict[str, Any] | None:
        state = self.get_mission(mission_id)
        if state is None:
            return None
        return {
            "version": "2.0.0",
            "generated_at": utc_now(),
            "mission": state,
            "events": self.list_events(mission_id),
            "analyses": self.list_analyses(mission_id, 100),
            "reviews": self.list_reviews(mission_id),
            "disclaimer": "Algorithm and coordination simulation only; not an engineering safety assessment.",
        }
