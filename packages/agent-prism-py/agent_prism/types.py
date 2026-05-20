from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal

TraceStatus = Literal["running", "success", "failed", "timeout"]
TriggeredBy = Literal["human", "agent", "scheduled"]


@dataclass
class TokenUsage:
    input: int = 0
    output: int = 0
    cached: int = 0
    total: int = 0


@dataclass
class AgentRun:
    id: str
    session_id: str
    agent_name: str
    triggered_by: TriggeredBy = "human"
    parent_run_id: str | None = None
    input: Any = None
    output: Any = None
    status: TraceStatus = "running"
    error: str | None = None
    error_stack: str | None = None
    started_at: datetime = field(default_factory=datetime.utcnow)
    ended_at: datetime | None = None
    latency_ms: int | None = None
    tokens: TokenUsage = field(default_factory=TokenUsage)
    cost_usd: float = 0.0
    metadata: dict[str, Any] = field(default_factory=dict)