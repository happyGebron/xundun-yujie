from __future__ import annotations

import heapq
import json
import math
import random
import threading
import time
from copy import deepcopy
from itertools import count
from pathlib import Path
from typing import Any, Protocol
from uuid import uuid4

try:
    from .schemas import MissionCreate, TelemetryFrame
    from .storage import Database, utc_now
except ImportError:
    from schemas import MissionCreate, TelemetryFrame
    from storage import Database, utc_now


GRID_WIDTH = 20
GRID_HEIGHT = 12
SPEED_INTERVALS = {0.5: 2.0, 1.0: 1.0, 2.0: 0.5, 4.0: 0.25}
RISK_NAMES = [
    ("spillway-surface", "溢洪道表面异常", "Spillway surface anomaly"),
    ("toe-seepage", "坝脚温差异常", "Dam-toe thermal anomaly"),
    ("wall-loss", "消力池边墙缺损", "Stilling-basin wall loss"),
    ("joint-shift", "坝段接缝变化", "Dam-joint variation"),
    ("slope-moisture", "下游坡面湿斑", "Downstream slope moisture"),
    ("gallery-signal", "廊道振动变化", "Gallery vibration change"),
    ("crest-line", "坝顶线形异常", "Crest alignment anomaly"),
    ("drain-flow", "排水孔流量变化", "Drain flow variation"),
]


class TelemetryAdapter(Protocol):
    def read(self, mission_id: str) -> list[TelemetryFrame]: ...


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def distance(a: list[float] | tuple[int, int], b: list[float] | tuple[int, int]) -> float:
    return math.hypot(float(a[0]) - float(b[0]), float(a[1]) - float(b[1]))


def grid_point(point: list[float]) -> tuple[int, int]:
    return int(round(point[0])), int(round(point[1]))


def load_scenarios(path: Path) -> list[dict[str, Any]]:
    with path.open(encoding="utf-8") as file:
        return json.load(file)


def shortest_path(
    start: tuple[int, int],
    goal: tuple[int, int],
    obstacles: set[tuple[int, int]],
    heuristic: bool,
) -> dict[str, Any]:
    started = time.perf_counter()
    frontier: list[tuple[float, int, tuple[int, int]]] = [(0.0, 0, start)]
    ticket = count(1)
    came_from: dict[tuple[int, int], tuple[int, int] | None] = {start: None}
    cost_so_far = {start: 0.0}
    expanded = 0
    while frontier:
        _, _, current = heapq.heappop(frontier)
        expanded += 1
        if current == goal:
            break
        for dx, dy in ((1, 0), (0, 1), (-1, 0), (0, -1)):
            next_point = current[0] + dx, current[1] + dy
            if not (0 <= next_point[0] < GRID_WIDTH and 0 <= next_point[1] < GRID_HEIGHT):
                continue
            if next_point in obstacles and next_point != goal:
                continue
            next_cost = cost_so_far[current] + 1
            if next_cost >= cost_so_far.get(next_point, math.inf):
                continue
            cost_so_far[next_point] = next_cost
            estimate = abs(goal[0] - next_point[0]) + abs(goal[1] - next_point[1]) if heuristic else 0
            heapq.heappush(frontier, (next_cost + estimate, next(ticket), next_point))
            came_from[next_point] = current
    path = [goal] if goal in came_from else [start]
    while path[-1] != start:
        parent = came_from[path[-1]]
        if parent is None:
            break
        path.append(parent)
    path.reverse()
    return {
        "algorithm": "A*" if heuristic else "Dijkstra",
        "path": [list(point) for point in path],
        "cost": round(cost_so_far.get(goal, math.inf), 3),
        "length": max(0, len(path) - 1),
        "expanded_nodes": expanded,
        "runtime_ms": round((time.perf_counter() - started) * 1000, 4),
        "reachable": goal in came_from,
    }


def hungarian(costs: list[list[float]]) -> list[int]:
    if not costs:
        return []
    rows, columns = len(costs), len(costs[0])
    if rows > columns:
        raise ValueError("Hungarian assignment requires rows <= columns")
    u = [0.0] * (rows + 1)
    v = [0.0] * (columns + 1)
    p = [0] * (columns + 1)
    way = [0] * (columns + 1)
    for row in range(1, rows + 1):
        p[0], column0 = row, 0
        min_value = [math.inf] * (columns + 1)
        used = [False] * (columns + 1)
        while True:
            used[column0] = True
            row0, delta, column1 = p[column0], math.inf, 0
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


def greedy_assignment(costs: list[list[float]]) -> list[int]:
    result = [-1] * len(costs)
    available_rows = set(range(len(costs)))
    available_columns = set(range(len(costs[0]) if costs else 0))
    while available_rows and available_columns:
        row, column = min(
            ((r, c) for r in available_rows for c in available_columns),
            key=lambda pair: (costs[pair[0]][pair[1]], pair[0], pair[1]),
        )
        result[row] = column
        available_rows.remove(row)
        available_columns.remove(column)
    return result


def severity(score: float) -> str:
    return "high" if score >= 0.70 else "medium" if score >= 0.45 else "low"


def make_event(event_type: str, code: str, level: str = "info", **data: Any) -> dict[str, Any]:
    return {"type": event_type, "code": code, "level": level, "data": data}


def event_copy(event: dict[str, Any]) -> dict[str, Any]:
    labels = {
        "MISSION_CREATED": ("场景已载入，等待任务启动", "Scenario loaded and ready"),
        "MISSION_STARTED": ("空地协同任务已启动", "Air-ground mission started"),
        "MISSION_PAUSED": ("任务已暂停，当前位置和路径已保留", "Mission paused with position and routes retained"),
        "MISSION_STEP": ("已推进一个控制周期", "Advanced one control cycle"),
        "SPEED_CHANGED": ("仿真速度已调整", "Simulation speed changed"),
        "TASK_ASSIGNED": ("地面复核任务已重新分配", "Ground verification tasks assigned"),
        "RISK_REACHED": ("地面单元已到达风险点", "Ground unit reached risk location"),
        "MISSION_COMPLETED": ("现场复核路径已执行完成", "Field verification routes completed"),
        "OBSTACLE_ADDED": ("发现动态障碍，已重算全局路径", "Dynamic obstacle detected; global routes recalculated"),
        "LINK_RELAY": ("链路衰减，无人机进入中继状态", "Link degraded; UAV entered relay mode"),
        "LINK_CRITICAL": ("链路严重衰减，任务已重新分配", "Critical link loss triggered reassignment"),
        "LINK_RECOVERED": ("通信链路已恢复", "Communication link recovered"),
        "RISK_REVIEWED": ("风险事件已完成复核", "Risk event reviewed"),
        "ANALYSIS_RISK_ADDED": ("算法分析结果已加入任务", "Analysis result added to mission"),
        "FAULT_INJECTED": ("已注入受控故障", "Controlled fault injected"),
    }
    zh, en = labels.get(event["code"], (event["code"], event["code"]))
    return {**event, "text_zh": zh, "text_en": en}


def dwa_control(position: list[float], waypoint: list[int], obstacles: set[tuple[int, int]]) -> dict[str, Any]:
    heading_to_goal = math.atan2(waypoint[1] - position[1], waypoint[0] - position[0])
    candidates: list[dict[str, Any]] = []
    for speed in (0.45, 0.75, 1.0):
        for angular_deg in (-35.0, 0.0, 35.0):
            heading = heading_to_goal + math.radians(angular_deg)
            x, y = position
            trajectory: list[list[float]] = []
            clearance = math.inf
            collision = False
            for _ in range(4):
                x += math.cos(heading) * speed * 0.5
                y += math.sin(heading) * speed * 0.5
                trajectory.append([round(x, 3), round(y, 3)])
                local_clearance = min((math.hypot(x - ox, y - oy) for ox, oy in obstacles), default=5.0)
                clearance = min(clearance, local_clearance)
                collision = collision or local_clearance < 0.48 or not (0 <= x < GRID_WIDTH and 0 <= y < GRID_HEIGHT)
            endpoint_error = distance([x, y], waypoint)
            heading_score = 1 / (1 + endpoint_error)
            clearance_score = clamp(clearance / 3, 0, 1)
            score = 0.45 * heading_score + 0.35 * clearance_score + 0.20 * speed
            candidates.append(
                {
                    "linear_velocity": speed,
                    "angular_velocity": angular_deg,
                    "clearance": round(clearance, 3),
                    "score": round(score, 4) if not collision else 0.0,
                    "collision_free": not collision,
                    "trajectory": trajectory,
                }
            )
    safe = [candidate for candidate in candidates if candidate["collision_free"]]
    chosen = max(safe or candidates, key=lambda candidate: candidate["score"])
    return {
        "method": "DWA",
        "prediction_horizon_s": 2,
        "heading_deg": round(math.degrees(heading_to_goal), 2),
        "speed_mps": chosen["linear_velocity"],
        "angular_velocity": chosen["angular_velocity"],
        "clearance_cells": chosen["clearance"],
        "chosen": chosen,
        "candidates": candidates,
    }


def _free_positions(rng: random.Random, blocked: set[tuple[int, int]]) -> list[tuple[int, int]]:
    positions = [(x, y) for y in range(1, GRID_HEIGHT - 1) for x in range(1, GRID_WIDTH - 1) if (x, y) not in blocked]
    rng.shuffle(positions)
    return positions


def build_state(scenario: dict[str, Any], request: MissionCreate) -> dict[str, Any]:
    rng = random.Random(request.seed)
    created_at = utc_now()
    mission_id = f"XD-{created_at[2:10].replace('-', '')}-{uuid4().hex[:6].upper()}"
    starts = {(2, 2), (2, 9), (17, 9)}
    obstacle_candidates = _free_positions(rng, starts)
    obstacles = set(obstacle_candidates[: request.parameters.obstacle_count])
    risk_candidates = _free_positions(rng, starts | obstacles)
    bias = float(scenario.get("risk_bias", 0.5))
    risks = []
    for index, point in enumerate(risk_candidates[: request.parameters.risk_count]):
        key, name_zh, name_en = RISK_NAMES[index]
        score = round(clamp(bias + rng.uniform(-0.18, 0.24), 0.18, 0.94), 3)
        risks.append(
            {
                "id": f"R-{index + 1:03d}",
                "name_key": key,
                "name_zh": name_zh,
                "name_en": name_en,
                "position": list(point),
                "severity": severity(score),
                "score": score,
                "status": "pending",
                "assigned": None,
                "source": "synthetic",
                "evidence": {
                    "rgb": round(clamp(score + rng.uniform(-0.12, 0.12), 0, 1), 3),
                    "thermal": round(clamp(score + rng.uniform(-0.15, 0.15), 0, 1), 3),
                    "sensor": round(clamp(score + rng.uniform(-0.18, 0.18), 0, 1), 3),
                },
            }
        )
    link = request.parameters.link_quality
    agents = [
        {
            "id": "UAV-01", "type": "UAV", "name_key": "aerial-unit", "position": [2.0, 2.0], "battery": 96.0,
            "link": float(link), "status": "idle", "mode": "standby", "heading_deg": 0.0,
            "linear_velocity": 0.0, "angular_velocity": 0.0, "target_risk": None, "route": [], "trail": [[2.0, 2.0]],
        },
        {
            "id": "UGV-01", "type": "UGV", "name_key": "ground-unit-a", "position": [2.0, 9.0], "battery": 91.0,
            "link": float(link - 2), "status": "idle", "mode": "standby", "heading_deg": 0.0,
            "linear_velocity": 0.0, "angular_velocity": 0.0, "target_risk": None, "route": [], "trail": [[2.0, 9.0]],
        },
        {
            "id": "UGV-02", "type": "UGV", "name_key": "ground-unit-b", "position": [17.0, 9.0], "battery": 93.0,
            "link": float(link - 1), "status": "idle", "mode": "standby", "heading_deg": 180.0,
            "linear_velocity": 0.0, "angular_velocity": 0.0, "target_risk": None, "route": [], "trail": [[17.0, 9.0]],
        },
    ]
    state = {
        "version": "2.0.0",
        "mission": {
            "id": mission_id, "scenario_id": scenario["id"], "scenario_name": scenario["name_zh"], "seed": request.seed,
            "status": "ready", "speed": 1.0, "cycle": 0, "created_at": created_at, "updated_at": created_at,
        },
        "config": {"parameters": request.parameters.model_dump(), "scenario": scenario},
        "grid": {"width": GRID_WIDTH, "height": GRID_HEIGHT, "obstacles": [list(p) for p in sorted(obstacles)], "dynamic_obstacles": []},
        "agents": agents,
        "risks": risks,
        "mesh": {"health": float(link), "mode": "normal", "relay": None, "fault": None},
        "summary": {"risk_count": len(risks), "high_risk_count": sum(r["severity"] == "high" for r in risks), "online_agents": 3, "coverage": 0},
        "comparisons": {"assignment": None, "paths": []},
        "last_control": {"method": "DWA", "speed_mps": 0.0, "heading_deg": 0.0, "angular_velocity": 0.0, "clearance_cells": 0.0, "chosen": None, "candidates": []},
        "timeline": [],
        "flags": {"dynamic_obstacle_added": False, "relay_announced": False, "critical_announced": False},
        "stream_sequence": 1,
    }
    created = event_copy(make_event("mission", "MISSION_CREATED", scenario_id=scenario["id"]))
    created.update({"sequence": 1, "timestamp": created_at})
    state["timeline"] = [created]
    return state


class MissionEngine:
    def __init__(self, database: Database, scenarios: list[dict[str, Any]]) -> None:
        self.database = database
        self.scenarios = {scenario["id"]: scenario for scenario in scenarios}
        self.lock = threading.RLock()
        self.default_mission_id: str | None = None

    def ensure_default(self) -> dict[str, Any]:
        latest = self.database.latest_mission()
        if latest:
            self.default_mission_id = latest["mission"]["id"]
            return latest
        first = next(iter(self.scenarios))
        return self.create(MissionCreate(scenario_id=first))

    def create(self, request: MissionCreate) -> dict[str, Any]:
        scenario = self.scenarios.get(request.scenario_id)
        if scenario is None:
            raise ValueError("SCENARIO_NOT_FOUND")
        state = build_state(scenario, request)
        self.database.create_mission(state, state["timeline"][0])
        self.default_mission_id = state["mission"]["id"]
        return state

    def get(self, mission_id: str) -> dict[str, Any]:
        state = self.database.get_mission(mission_id)
        if state is None:
            raise KeyError(mission_id)
        return state

    def default(self) -> dict[str, Any]:
        if self.default_mission_id:
            state = self.database.get_mission(self.default_mission_id)
            if state:
                return state
        return self.ensure_default()

    def _record(self, state: dict[str, Any], event: dict[str, Any]) -> dict[str, Any]:
        item = event_copy(event)
        item["timestamp"] = utc_now()
        state["timeline"] = [item, *state.get("timeline", [])][:40]
        sequence = self.database.save_mission(state, item)
        state["stream_sequence"] = sequence
        item["sequence"] = sequence
        return state

    def _obstacles(self, state: dict[str, Any]) -> set[tuple[int, int]]:
        return {tuple(point) for point in state["grid"]["obstacles"] + state["grid"]["dynamic_obstacles"]}

    def _dispatch(self, state: dict[str, Any]) -> bool:
        agents = [a for a in state["agents"] if a["type"] == "UGV" and a["status"] in {"idle", "holding"} and a["link"] >= 35]
        risks = sorted(
            [r for r in state["risks"] if r["status"] == "pending"],
            key=lambda risk: ({"high": 0, "medium": 1, "low": 2}[risk["severity"]], -risk["score"], risk["id"]),
        )
        if not agents or not risks:
            return False
        agents = agents[: min(len(agents), len(risks))]
        obstacles = self._obstacles(state)
        costs: list[list[float]] = []
        for agent in agents:
            row = []
            for risk in risks:
                path = shortest_path(grid_point(agent["position"]), tuple(risk["position"]), obstacles, True)
                path_component = min(path["length"] / (GRID_WIDTH + GRID_HEIGHT), 1)
                battery_penalty = 1 - agent["battery"] / 100
                link_penalty = 1 - agent["link"] / 100
                capability_penalty = 0.0 if agent["type"] == "UGV" else 1.0
                row.append(round(0.45 * path_component + 0.20 * battery_penalty + 0.20 * link_penalty + 0.15 * capability_penalty, 5))
            costs.append(row)
        started = time.perf_counter()
        selected = hungarian(costs)
        hungarian_runtime = (time.perf_counter() - started) * 1000
        started = time.perf_counter()
        baseline = greedy_assignment(costs)
        greedy_runtime = (time.perf_counter() - started) * 1000
        state["comparisons"]["assignment"] = {
            "agents": [agent["id"] for agent in agents],
            "risks": [risk["id"] for risk in risks],
            "matrix": costs,
            "hungarian": {
                "pairs": [{"agent_id": agents[row]["id"], "risk_id": risks[column]["id"], "cost": costs[row][column]} for row, column in enumerate(selected) if column >= 0],
                "total_cost": round(sum(costs[row][column] for row, column in enumerate(selected) if column >= 0), 5),
                "runtime_ms": round(hungarian_runtime, 4),
                "assigned": sum(column >= 0 for column in selected),
                "unassigned": max(0, len(risks) - len(selected)),
            },
            "greedy": {
                "pairs": [{"agent_id": agents[row]["id"], "risk_id": risks[column]["id"], "cost": costs[row][column]} for row, column in enumerate(baseline) if column >= 0],
                "total_cost": round(sum(costs[row][column] for row, column in enumerate(baseline) if column >= 0), 5),
                "runtime_ms": round(greedy_runtime, 4),
                "assigned": sum(column >= 0 for column in baseline),
                "unassigned": max(0, len(risks) - len(baseline)),
            },
        }
        for row, column in enumerate(selected):
            if column < 0:
                continue
            agent, risk = agents[row], risks[column]
            a_star = shortest_path(grid_point(agent["position"]), tuple(risk["position"]), obstacles, True)
            dijkstra = shortest_path(grid_point(agent["position"]), tuple(risk["position"]), obstacles, False)
            agent.update({"status": "navigating", "mode": "ground-verification", "target_risk": risk["id"], "route": a_star["path"]})
            risk.update({"status": "assigned", "assigned": agent["id"]})
            state["comparisons"]["paths"].append({"agent_id": agent["id"], "risk_id": risk["id"], "a_star": a_star, "dijkstra": dijkstra})
        state["comparisons"]["paths"] = state["comparisons"]["paths"][-12:]
        return True

    def _uav_route(self) -> list[list[int]]:
        route = []
        for row, y in enumerate((2, 4, 6, 8)):
            xs = range(2, 18) if row % 2 == 0 else range(17, 1, -1)
            route.extend([[x, y] for x in xs])
        return route

    def command(self, mission_id: str, command: str, value: float | None = None) -> dict[str, Any]:
        with self.lock:
            state = self.get(mission_id)
            if command == "start":
                if self.database.running_missions(exclude=mission_id):
                    raise RuntimeError("MISSION_ALREADY_RUNNING")
                if state["mission"]["status"] == "completed":
                    raise ValueError("MISSION_COMPLETED")
                state["mission"]["status"] = "running"
                uav = state["agents"][0]
                if not uav["route"]:
                    uav.update({"route": self._uav_route(), "status": "scanning", "mode": "aerial-scan"})
                for agent in state["agents"]:
                    if agent["status"] == "holding" and agent["route"]:
                        agent["status"] = "navigating" if agent["type"] == "UGV" else "scanning"
                assigned = self._dispatch(state)
                return self._record(state, make_event("mission", "MISSION_STARTED", assigned=assigned))
            if command == "pause":
                state["mission"]["status"] = "paused"
                for agent in state["agents"]:
                    if agent["status"] not in {"offline", "verifying"}:
                        agent["status"] = "holding"
                return self._record(state, make_event("mission", "MISSION_PAUSED"))
            if command == "set_speed":
                state["mission"]["speed"] = float(value or 1)
                return self._record(state, make_event("mission", "SPEED_CHANGED", speed=state["mission"]["speed"]))
            if command == "reset":
                request = MissionCreate(
                    scenario_id=state["mission"]["scenario_id"],
                    seed=state["mission"]["seed"],
                    parameters=state["config"]["parameters"],
                )
                return self.create(request)
            if command == "step":
                if state["mission"]["status"] == "completed":
                    raise ValueError("MISSION_COMPLETED")
                original = state["mission"]["status"]
                state["mission"]["status"] = "running"
                state = self._advance(state)
                if state["mission"]["status"] != "completed":
                    state["mission"]["status"] = "paused" if original != "running" else "running"
                return self._record(state, make_event("tick", "MISSION_STEP", cycle=state["mission"]["cycle"]))
            raise ValueError("UNKNOWN_COMMAND")

    def tick(self, mission_id: str) -> dict[str, Any]:
        with self.lock:
            state = self.get(mission_id)
            if state["mission"]["status"] != "running":
                return state
            before = state["mission"]["status"]
            state = self._advance(state)
            code = "MISSION_COMPLETED" if before != state["mission"]["status"] else "MISSION_STEP"
            return self._record(state, make_event("tick", code, cycle=state["mission"]["cycle"]))

    def _advance(self, state: dict[str, Any]) -> dict[str, Any]:
        state["mission"]["cycle"] += 1
        cycle = state["mission"]["cycle"]
        scenario_id = state["mission"]["scenario_id"]
        obstacles = self._obstacles(state)
        if scenario_id == "dynamic-obstacle" and cycle == 8 and not state["flags"]["dynamic_obstacle_added"]:
            ugv = next((agent for agent in state["agents"] if agent["type"] == "UGV" and len(agent["route"]) > 2), None)
            point = ugv["route"][2] if ugv else [10, 6]
            if point not in state["grid"]["dynamic_obstacles"]:
                state["grid"]["dynamic_obstacles"].append(point)
            state["flags"]["dynamic_obstacle_added"] = True
            obstacles.add(tuple(point))
            for agent in state["agents"]:
                if agent["target_risk"]:
                    risk = next(r for r in state["risks"] if r["id"] == agent["target_risk"])
                    planned = shortest_path(grid_point(agent["position"]), tuple(risk["position"]), obstacles, True)
                    agent["route"] = planned["path"]
            state["timeline"].insert(0, event_copy(make_event("coordination", "OBSTACLE_ADDED", "warning", position=point)))
        if scenario_id == "link-degradation" or state["mesh"]["fault"] == "mesh":
            fall = 5 if cycle <= 14 else -4
            for agent in state["agents"]:
                if agent["type"] == "UGV":
                    agent["link"] = clamp(agent["link"] - fall, 24, 96)
            state["mesh"]["health"] = round(min(agent["link"] for agent in state["agents"]), 1)
        else:
            state["mesh"]["health"] = round(sum(agent["link"] for agent in state["agents"]) / len(state["agents"]), 1)
        lowest_ground_link = min(agent["link"] for agent in state["agents"] if agent["type"] == "UGV")
        if lowest_ground_link < 60:
            uav = state["agents"][0]
            uav.update({"status": "scanning", "mode": "mesh-relay"})
            state["mesh"].update({"mode": "relay", "relay": uav["id"]})
            if not state["flags"]["relay_announced"]:
                state["timeline"].insert(0, event_copy(make_event("link", "LINK_RELAY", "warning")))
                state["flags"]["relay_announced"] = True
        if lowest_ground_link < 35 and not state["flags"]["critical_announced"]:
            for agent in state["agents"]:
                if agent["type"] == "UGV" and agent["link"] < 35:
                    if agent["target_risk"]:
                        risk = next(r for r in state["risks"] if r["id"] == agent["target_risk"])
                        risk.update({"status": "pending", "assigned": None})
                    agent.update({"status": "offline", "mode": "offline", "route": [], "target_risk": None})
            state["timeline"].insert(0, event_copy(make_event("link", "LINK_CRITICAL", "warning")))
            state["flags"]["critical_announced"] = True
        if state["flags"]["critical_announced"] and lowest_ground_link >= 45:
            for agent in state["agents"]:
                if agent["type"] == "UGV" and agent["status"] == "offline":
                    agent.update({"status": "idle", "mode": "standby"})
            state["timeline"].insert(0, event_copy(make_event("link", "LINK_RECOVERED")))
            state["flags"]["critical_announced"] = False
            state["flags"]["relay_announced"] = False
        for agent in state["agents"]:
            if agent["status"] == "offline" or not agent["route"]:
                continue
            current_grid = grid_point(agent["position"])
            while agent["route"] and tuple(agent["route"][0]) == current_grid:
                agent["route"].pop(0)
            if not agent["route"]:
                continue
            waypoint = agent["route"][0]
            control = dwa_control(agent["position"], waypoint, obstacles)
            agent["position"] = [float(waypoint[0]), float(waypoint[1])]
            agent["trail"] = [*agent["trail"], agent["position"]][-80:]
            agent.update(
                {
                    "heading_deg": control["heading_deg"], "linear_velocity": control["speed_mps"],
                    "angular_velocity": control["angular_velocity"], "battery": round(max(12, agent["battery"] - (0.34 if agent["type"] == "UAV" else 0.22)), 2),
                }
            )
            state["last_control"] = control
            if agent["route"]:
                agent["route"].pop(0)
            if not agent["route"] and agent["target_risk"]:
                risk = next(r for r in state["risks"] if r["id"] == agent["target_risk"])
                risk["status"] = "field_verified"
                agent.update({"status": "verifying", "mode": "on-site-verification", "target_risk": None, "linear_velocity": 0.0})
                state["timeline"].insert(0, event_copy(make_event("risk", "RISK_REACHED", risk_id=risk["id"], agent_id=agent["id"])))
                agent.update({"status": "idle", "mode": "standby"})
        self._dispatch(state)
        verified = sum(risk["status"] in {"field_verified", "confirmed", "dismissed"} for risk in state["risks"])
        state["summary"] = {
            "risk_count": len(state["risks"]),
            "high_risk_count": sum(risk["severity"] == "high" and risk["status"] != "dismissed" for risk in state["risks"]),
            "online_agents": sum(agent["status"] != "offline" for agent in state["agents"]),
            "coverage": min(100, round(100 * verified / max(1, len(state["risks"])) * 0.72 + cycle * 1.6)),
        }
        if verified == len(state["risks"]) or cycle >= 300:
            state["mission"]["status"] = "completed"
            state["summary"]["coverage"] = 100
            for agent in state["agents"]:
                if agent["status"] != "offline":
                    agent.update({"status": "idle", "mode": "standby", "linear_velocity": 0.0})
        state["timeline"] = state["timeline"][:40]
        return state

    def inject_fault(self, mission_id: str, kind: str) -> dict[str, Any]:
        with self.lock:
            state = self.get(mission_id)
            if kind not in {"mesh", "obstacle", "thermal", "gps"}:
                raise ValueError("UNKNOWN_FAULT")
            if kind == "mesh":
                state["mesh"].update({"fault": "mesh", "health": 52})
                for agent in state["agents"]:
                    if agent["type"] == "UGV":
                        agent["link"] = min(agent["link"], 52)
            elif kind == "obstacle":
                point = [10, 6]
                if point not in state["grid"]["dynamic_obstacles"]:
                    state["grid"]["dynamic_obstacles"].append(point)
                state["flags"]["dynamic_obstacle_added"] = True
            elif kind == "thermal":
                state["config"]["thermal_quality"] = 0.62
            else:
                state["config"]["positioning_mode"] = "visual-odometry"
            return self._record(state, make_event("fault", "FAULT_INJECTED", "warning", kind=kind))

    def review(self, mission_id: str, risk_id: str, decision: str, note: str | None) -> dict[str, Any]:
        with self.lock:
            state = self.get(mission_id)
            risk = next((risk for risk in state["risks"] if risk["id"] == risk_id), None)
            if risk is None:
                raise KeyError(risk_id)
            risk["status"] = decision
            self.database.add_review(mission_id, risk_id, decision, note)
            return self._record(state, make_event("risk", "RISK_REVIEWED", risk_id=risk_id, decision=decision, note=note))

    def add_analysis_risk(self, mission_id: str, analysis_id: str, result: dict[str, Any], x: float, y: float) -> dict[str, Any]:
        with self.lock:
            state = self.get(mission_id)
            score = float(result["fusion"]["score"])
            risk_id = f"A-{len(state['risks']) + 1:03d}"
            state["risks"].append(
                {
                    "id": risk_id, "name_key": "analysis-candidate", "name_zh": "上传数据异常候选", "name_en": "Uploaded-data anomaly candidate",
                    "position": [round(x, 2), round(y, 2)], "severity": severity(score), "score": score, "status": "pending",
                    "assigned": None, "source": analysis_id, "evidence": result.get("modalities", {}),
                }
            )
            state["summary"]["risk_count"] = len(state["risks"])
            state["summary"]["high_risk_count"] = sum(r["severity"] == "high" for r in state["risks"])
            return self._record(state, make_event("analysis", "ANALYSIS_RISK_ADDED", analysis_id=analysis_id, risk_id=risk_id))

    def legacy(self, state: dict[str, Any] | None = None) -> dict[str, Any]:
        state = deepcopy(state or self.default())
        mission_status = {"ready": "待命", "running": "执行中", "paused": "已暂停", "completed": "已完成", "failed": "失败"}
        agent_modes = {
            "standby": "待命", "aerial-scan": "航线巡检", "ground-verification": "前往复核", "on-site-verification": "现场复核",
            "mesh-relay": "通信中继", "offline": "离线", "visual-odometry": "视觉里程计",
        }
        risk_status = {"pending": "待复核", "assigned": "已分派", "field_verified": "现场已核", "confirmed": "人工确认", "dismissed": "已排除"}
        severity_zh = {"high": "高", "medium": "中", "low": "低"}
        return {
            "mission": {
                "id": state["mission"]["id"], "status": mission_status[state["mission"]["status"]],
                "cycle": state["mission"]["cycle"], "updated_at": state["mission"]["updated_at"],
            },
            "agents": [
                {
                    "id": agent["id"], "type": agent["type"], "name": "空中巡检单元" if agent["type"] == "UAV" else f"地面复核单元 {'A' if agent['id'].endswith('01') else 'B'}",
                    "position": [round(agent["position"][0]), round(agent["position"][1])], "battery": round(agent["battery"]),
                    "link": round(agent["link"]), "mode": agent_modes.get(agent["mode"], agent["mode"]), "route": agent["route"],
                }
                for agent in state["agents"]
            ],
            "risks": [
                {
                    "id": risk["id"], "name": risk["name_zh"], "position": risk["position"], "kind": "算法异常候选",
                    "severity": severity_zh[risk["severity"]], "rgb": risk.get("evidence", {}).get("rgb", risk["score"]),
                    "thermal_delta": round(risk.get("evidence", {}).get("thermal", risk["score"]) * 15, 2),
                    "spectrum": risk.get("evidence", {}).get("sensor", risk["score"]), "score": risk["score"],
                    "status": risk_status[risk["status"]], "assigned": risk["assigned"],
                    "evidence": {"edge_energy": risk["score"], "thermal_delta_c": risk["score"] * 15, "signal": [risk["score"]] * 8},
                }
                for risk in state["risks"]
            ],
            "mesh": {
                "health": round(state["mesh"]["health"]), "mode": "MESH 自组网", "relay": state["mesh"]["relay"] or "UAV-01", "fault": state["mesh"]["fault"],
            },
            "timeline": [
                {"time": item.get("timestamp", state["mission"]["updated_at"]), "level": item["level"], "text": item.get("text_zh", item["code"])}
                for item in state["timeline"][:12]
            ],
            "last_control": {
                "method": "DWA", "speed_mps": state["last_control"]["speed_mps"], "heading_deg": state["last_control"]["heading_deg"],
                "clearance_cells": state["last_control"]["clearance_cells"],
            },
            "summary": state["summary"],
        }


class SimulationTelemetryAdapter:
    def __init__(self, engine: MissionEngine) -> None:
        self.engine = engine

    def read(self, mission_id: str) -> list[TelemetryFrame]:
        state = self.engine.get(mission_id)
        return [
            TelemetryFrame(
                agent_id=agent["id"], agent_type=agent["type"], timestamp=state["mission"]["updated_at"],
                position=tuple(agent["position"]), heading_deg=agent["heading_deg"], linear_velocity=agent["linear_velocity"],
                angular_velocity=agent["angular_velocity"], battery=agent["battery"], link_quality=agent["link"],
                status=agent["status"], mission_id=mission_id,
            )
            for agent in state["agents"]
        ]
