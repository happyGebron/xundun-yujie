from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class MissionStatus(StrEnum):
    READY = "ready"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"


class AgentStatus(StrEnum):
    IDLE = "idle"
    SCANNING = "scanning"
    ASSIGNED = "assigned"
    NAVIGATING = "navigating"
    VERIFYING = "verifying"
    HOLDING = "holding"
    OFFLINE = "offline"


class ScenarioParameters(BaseModel):
    risk_count: int = Field(default=4, ge=1, le=8)
    obstacle_count: int = Field(default=8, ge=0, le=20)
    link_quality: int = Field(default=92, ge=40, le=100)


class MissionCreate(BaseModel):
    scenario_id: str
    seed: int = 20260915
    parameters: ScenarioParameters = Field(default_factory=ScenarioParameters)


class MissionCommand(BaseModel):
    command: Literal["start", "pause", "step", "reset", "set_speed"]
    value: float | None = None

    @model_validator(mode="after")
    def validate_speed(self) -> "MissionCommand":
        if self.command == "set_speed" and self.value not in {0.5, 1.0, 2.0, 4.0}:
            raise ValueError("value must be one of 0.5, 1, 2, 4")
        return self


class RiskReview(BaseModel):
    decision: Literal["confirmed", "dismissed"]
    note: str | None = Field(default=None, max_length=500)


class SampleAnalysisRequest(BaseModel):
    mission_id: str | None = None
    kind: Literal["multimodal", "video"] = "multimodal"
    x: float | None = Field(default=None, ge=0, le=19)
    y: float | None = Field(default=None, ge=0, le=11)


class TelemetryFrame(BaseModel):
    agent_id: str
    agent_type: Literal["UAV", "UGV"]
    timestamp: str
    position: tuple[float, float]
    heading_deg: float
    linear_velocity: float
    angular_velocity: float
    battery: float = Field(ge=0, le=100)
    link_quality: float = Field(ge=0, le=100)
    status: AgentStatus
    mission_id: str | None = None
