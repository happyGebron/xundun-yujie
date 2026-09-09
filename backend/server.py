from __future__ import annotations

import json
import math
import threading
from copy import deepcopy
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from itertools import count
from pathlib import Path
from urllib.parse import parse_qs, urlparse


GRID_WIDTH = 18
GRID_HEIGHT = 10
OBSTACLES = {(6, 2), (6, 3), (7, 3), (11, 6), (12, 6), (13, 6)}


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%H:%M:%S UTC")


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def spectrum_score(samples: list[float]) -> float:
    size = len(samples)
    if size < 4:
        return 0.0
    energies = []
    for frequency in range(1, size // 2):
        real = sum(value * math.cos(2 * math.pi * frequency * index / size) for index, value in enumerate(samples))
        imag = sum(value * math.sin(2 * math.pi * frequency * index / size) for index, value in enumerate(samples))
        energies.append(real * real + imag * imag)
    total = sum(energies) or 1.0
    high_band = sum(energies[len(energies) // 2 :])
    return clamp(high_band / total, 0.0, 1.0)


def fuse_risk(rgb: float, thermal_delta: float, spectral: float) -> float:
    thermal_score = clamp(thermal_delta / 15, 0.0, 1.0)
    return round(clamp(0.48 * rgb + 0.30 * thermal_score + 0.22 * spectral, 0.0, 1.0), 3)


def a_star(start: tuple[int, int], goal: tuple[int, int]) -> list[tuple[int, int]]:
    frontier: list[tuple[int, int, int, int, int]] = []
    ticket = count()
    frontier.append((0, next(ticket), start[0], start[1], 0))
    came_from: dict[tuple[int, int], tuple[int, int] | None] = {start: None}
    cost_so_far = {start: 0}
    while frontier:
        frontier.sort(reverse=True)
        _, _, x, y, cost = frontier.pop()
        current = (x, y)
        if current == goal:
            break
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            next_point = (x + dx, y + dy)
            if not (0 <= next_point[0] < GRID_WIDTH and 0 <= next_point[1] < GRID_HEIGHT):
                continue
            if next_point in OBSTACLES:
                continue
            next_cost = cost + 1
            if next_cost >= cost_so_far.get(next_point, 10**9):
                continue
            cost_so_far[next_point] = next_cost
            heuristic = abs(goal[0] - next_point[0]) + abs(goal[1] - next_point[1])
            frontier.append((next_cost + heuristic, next(ticket), next_point[0], next_point[1], next_cost))
            came_from[next_point] = current
    if goal not in came_from:
        return [start]
    route = [goal]
    while route[-1] != start:
        parent = came_from[route[-1]]
        if parent is None:
            break
        route.append(parent)
    return list(reversed(route))


def hungarian(costs: list[list[float]]) -> list[int]:
    rows, columns = len(costs), len(costs[0])
    if rows > columns:
        raise ValueError("Hungarian assignment requires rows <= columns")
    u, v, p, way = [0.0] * (rows + 1), [0.0] * (columns + 1), [0] * (columns + 1), [0] * (columns + 1)
    for row in range(1, rows + 1):
        p[0], column0 = row, 0
        min_value, used = [float("inf")] * (columns + 1), [False] * (columns + 1)
        while True:
            used[column0] = True
            row0, delta, column1 = p[column0], float("inf"), 0
            for column in range(1, columns + 1):
                if used[column]:
                    continue
                current = costs[row0 - 1][column - 1] - u[row0] - v[column]
                if current < min_value[column]:
                    min_value[column], way[column] = current, column0
                if min_value[column] < delta:
                    delta, column1 = min_value[column], column
            for column in range(columns + 1):
                if used[column]:
                    u[p[column]] += delta
                    v[column] -= delta
                else:
                    min_value[column] -= delta
            column0 = column1
            if p[column0] == 0:
                break
        while True:
            column1 = way[column0]
            p[column0], column0 = p[column1], column1
            if column0 == 0:
                break
    assignment = [-1] * rows
    for column in range(1, columns + 1):
        if p[column]:
            assignment[p[column] - 1] = column - 1
    return assignment


def local_control(position: tuple[int, int], next_point: tuple[int, int]) -> dict[str, float | str]:
    close_obstacles = sum(abs(position[0] - x) + abs(position[1] - y) <= 2 for x, y in OBSTACLES)
    heading = math.degrees(math.atan2(next_point[1] - position[1], next_point[0] - position[0]))
    return {
        "method": "DWA",
        "speed_mps": round(clamp(1.1 - close_obstacles * 0.17, 0.45, 1.1), 2),
        "heading_deg": round(heading, 1),
        "clearance_cells": max(1, 3 - close_obstacles),
    }


class MissionEngine:
    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.reset()

    def reset(self) -> None:
        with self.lock:
            samples = [0.18, 0.23, 0.19, 0.61, 0.22, 0.27, 0.58, 0.21, 0.19, 0.53, 0.25, 0.24]
            spectrum = spectrum_score(samples)
            risk_score = fuse_risk(0.82, 9.4, spectrum)
            self.state = {
                "mission": {"id": "XD-2026-DEMO", "status": "待命", "cycle": 0, "updated_at": utc_now()},
                "agents": [
                    {"id": "UAV-01", "type": "UAV", "name": "空中巡检单元", "position": [3, 2], "battery": 93, "link": 98, "mode": "待命", "route": []},
                    {"id": "UGV-01", "type": "UGV", "name": "地面复核单元 A", "position": [2, 8], "battery": 88, "link": 96, "mode": "待命", "route": []},
                    {"id": "UGV-02", "type": "UGV", "name": "地面复核单元 B", "position": [15, 8], "battery": 90, "link": 95, "mode": "待命", "route": []},
                ],
                "risks": [
                    {
                        "id": "R-021", "name": "溢洪道右岸表观异常", "position": [13, 2], "kind": "裂缝候选", "severity": "高", "rgb": 0.82,
                        "thermal_delta": 9.4, "spectrum": round(spectrum, 3), "score": risk_score, "status": "待复核", "assigned": None,
                        "evidence": {"edge_energy": 0.82, "thermal_delta_c": 9.4, "signal": samples},
                    },
                    {
                        "id": "R-022", "name": "坝脚渗流温差", "position": [5, 7], "kind": "热异常", "severity": "中", "rgb": 0.46,
                        "thermal_delta": 6.1, "spectrum": 0.37, "score": fuse_risk(0.46, 6.1, 0.37), "status": "待复核", "assigned": None,
                        "evidence": {"edge_energy": 0.46, "thermal_delta_c": 6.1, "signal": [0.21, 0.25, 0.34, 0.39, 0.32, 0.28]},
                    },
                    {
                        "id": "R-023", "name": "消力池边墙缺损", "position": [10, 5], "kind": "剥落候选", "severity": "低", "rgb": 0.38,
                        "thermal_delta": 2.8, "spectrum": 0.22, "score": fuse_risk(0.38, 2.8, 0.22), "status": "观察", "assigned": "UAV-01",
                        "evidence": {"edge_energy": 0.38, "thermal_delta_c": 2.8, "signal": [0.11, 0.14, 0.17, 0.18, 0.15, 0.12]},
                    },
                ],
                "mesh": {"health": 96, "mode": "MESH 自组网", "relay": "UAV-01", "fault": None},
                "timeline": [
                    {"time": utc_now(), "level": "info", "text": "场景加载完成，等待任务启动。"},
                    {"time": utc_now(), "level": "warning", "text": "R-021 已进入多源融合复核队列。"},
                ],
                "last_control": {"method": "DWA", "speed_mps": 0.0, "heading_deg": 0.0, "clearance_cells": 3},
            }

    def log(self, level: str, text: str) -> None:
        self.state["timeline"].insert(0, {"time": utc_now(), "level": level, "text": text})
        self.state["timeline"] = self.state["timeline"][:12]
        self.state["mission"]["updated_at"] = utc_now()

    def dispatch(self) -> None:
        ground_agents = [agent for agent in self.state["agents"] if agent["type"] == "UGV"]
        candidates = [risk for risk in self.state["risks"] if risk["status"] == "待复核"][: len(ground_agents)]
        costs = []
        for risk in candidates:
            costs.append([
                abs(risk["position"][0] - agent["position"][0]) + abs(risk["position"][1] - agent["position"][1]) + (1 - risk["score"]) * 3
                for agent in ground_agents
            ])
        for risk, index in zip(candidates, hungarian(costs)):
            agent = ground_agents[index]
            start, goal = tuple(agent["position"]), tuple(risk["position"])
            agent["route"] = [list(point) for point in a_star(start, goal)]
            agent["mode"], risk["assigned"], risk["status"] = "前往复核", agent["id"], "已分派"
        self.log("info", "最小代价任务分派完成，地面单元已获得 A* 全局路径。")

    def start(self) -> dict:
        with self.lock:
            self.state["mission"]["status"] = "执行中"
            self.dispatch()
            self.state["agents"][0]["mode"] = "航线巡检"
            self.state["agents"][0]["route"] = [list(point) for point in a_star((3, 2), (16, 2))]
            self.log("info", "空地协同巡检任务已启动。")
            return self.snapshot()

    def pause(self) -> dict:
        with self.lock:
            self.state["mission"]["status"] = "已暂停"
            for agent in self.state["agents"]:
                agent["mode"] = "保持位置"
            self.log("warning", "任务已暂停，保留当前航迹与风险队列。")
            return self.snapshot()

    def tick(self) -> dict:
        with self.lock:
            if self.state["mission"]["status"] != "执行中":
                return self.snapshot()
            self.state["mission"]["cycle"] += 1
            for agent in self.state["agents"]:
                route = agent["route"]
                if len(route) > 1:
                    route.pop(0)
                    agent["position"] = route[0]
                    agent["battery"] = max(20, agent["battery"] - 1)
                    agent["link"] = clamp(agent["link"] - (3 if self.state["mesh"]["fault"] == "mesh" else 1), 34, 99)
                    self.state["last_control"] = local_control(tuple(agent["position"]), tuple(route[min(1, len(route) - 1)]))
                elif agent["mode"] in {"前往复核", "航线巡检"}:
                    agent["mode"] = "现场复核" if agent["type"] == "UGV" else "航线完成"
            if self.state["mission"]["cycle"] % 2 == 0:
                self.log("info", f"第 {self.state['mission']['cycle']} 个控制周期完成，已刷新局部避障速度窗。")
            return self.snapshot()

    def fault(self, kind: str) -> dict:
        with self.lock:
            labels = {
                "mesh": "MESH 链路衰减，启用 UAV 中继与离线缓存。",
                "obstacle": "发现动态障碍，UGV 正在使用 DWA 重选速度轨迹。",
                "thermal": "热成像源发生漂移，风险融合降低热特征权重。",
                "gps": "卫星定位不稳定，切换至视觉里程计模拟模式。",
            }
            if kind not in labels:
                raise ValueError("未知故障类型")
            self.state["mesh"]["fault"] = kind if kind == "mesh" else self.state["mesh"]["fault"]
            self.state["mesh"]["health"] = 58 if kind == "mesh" else self.state["mesh"]["health"]
            if kind == "thermal":
                for risk in self.state["risks"]:
                    risk["score"] = round(risk["score"] * 0.92, 3)
            self.log("warning", labels[kind])
            return self.snapshot()

    def review(self, risk_id: str) -> dict:
        with self.lock:
            risk = next((item for item in self.state["risks"] if item["id"] == risk_id), None)
            if risk is None:
                raise ValueError("未找到风险事件")
            risk["status"] = "人工确认"
            self.log("info", f"{risk_id} 已人工确认，等待形成处置闭环。")
            return self.snapshot()

    def snapshot(self) -> dict:
        with self.lock:
            state = deepcopy(self.state)
            state["summary"] = {
                "risk_count": len(state["risks"]),
                "high_risk_count": sum(risk["severity"] == "高" for risk in state["risks"]),
                "online_agents": sum(agent["link"] >= 60 for agent in state["agents"]),
                "coverage": min(100, 42 + state["mission"]["cycle"] * 4),
            }
            return state


ENGINE = MissionEngine()


class ApiHandler(BaseHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def log_message(self, format: str, *args: object) -> None:
        return

    def send_json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def do_GET(self) -> None:
        if urlparse(self.path).path in {"/api/overview", "/api/state"}:
            self.send_json(ENGINE.snapshot())
            return
        if urlparse(self.path).path == "/api/report":
            state = ENGINE.snapshot()
            self.send_json({"mission": state["mission"], "risks": state["risks"], "timeline": state["timeline"], "disclaimer": "演示数据，仅用于软件仿真与界面联调。"})
            return
        self.send_json({"error": "Not found"}, HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/api/mission/start":
                payload = ENGINE.start()
            elif parsed.path == "/api/mission/pause":
                payload = ENGINE.pause()
            elif parsed.path == "/api/mission/reset":
                ENGINE.reset()
                payload = ENGINE.snapshot()
            elif parsed.path == "/api/simulation/tick":
                payload = ENGINE.tick()
            elif parsed.path == "/api/fault":
                kind = parse_qs(parsed.query).get("kind", [""])[0]
                payload = ENGINE.fault(kind)
            elif parsed.path.startswith("/api/risks/") and parsed.path.endswith("/review"):
                payload = ENGINE.review(parsed.path.split("/")[3])
            else:
                self.send_json({"error": "Not found"}, HTTPStatus.NOT_FOUND)
                return
            self.send_json(payload)
        except ValueError as error:
            self.send_json({"error": str(error)}, HTTPStatus.BAD_REQUEST)
        except Exception:
            self.send_json({"error": "服务器处理失败，请重试。"}, HTTPStatus.INTERNAL_SERVER_ERROR)


def main() -> None:
    address = ("127.0.0.1", 8000)
    server = ThreadingHTTPServer(address, ApiHandler)
    print(f"巡盾御界 API 已启动：http://{address[0]}:{address[1]}")
    server.serve_forever()


if __name__ == "__main__":
    main()
