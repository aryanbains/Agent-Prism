from __future__ import annotations

import contextvars
import time
import traceback
from datetime import datetime
from functools import wraps
from typing import Any, Callable, TypeVar
from uuid import uuid4

from .storage import SqliteStorage
from .types import AgentRun, TokenUsage

T = TypeVar("T")
_active_run: contextvars.ContextVar[tuple[str, str] | None] = contextvars.ContextVar("agent_prism_active_run", default=None)


def create_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:10]}"


class RunHandle:
    def __init__(self, tracer: "Tracer", run_id: str, session_id: str) -> None:
        self.tracer = tracer
        self.id = run_id
        self.session_id = session_id

    def tool_call(self, name: str, input_value: Any, callback: Callable[[], T]) -> T:
        return self.tracer.tool_call(name, input_value, callback, self.id)

    def end(self, output: Any = None) -> None:
        self.tracer.end_run(self, output=output)


class Tracer:
    def __init__(self, db_path: str = "./agent-prism.db", on_error: str = "warn") -> None:
        self.storage = SqliteStorage(db_path)
        self.on_error = on_error

    def start_run(self, agent_name: str, input: Any = None, session_id: str | None = None, parent_run_id: str | None = None, triggered_by: str | None = None) -> RunHandle:
        active = _active_run.get()
        active_run_id, active_session_id = active if active else (None, None)
        next_session_id = session_id or active_session_id or create_id("ses")
        next_parent_id = parent_run_id or active_run_id
        now = datetime.utcnow()
        self.storage.create_session(next_session_id, agent_name, now)
        run = AgentRun(
            id=create_id("run"),
            session_id=next_session_id,
            agent_name=agent_name,
            parent_run_id=next_parent_id,
            triggered_by=triggered_by or ("agent" if next_parent_id else "human"),
            input=input,
            started_at=now,
        )
        self.storage.upsert_run(run)
        return RunHandle(self, run.id, next_session_id)

    def end_run(self, run: RunHandle, output: Any = None, status: str = "success", tokens: TokenUsage | None = None, cost_usd: float = 0.0) -> None:
        row = self.storage.connection.execute("SELECT * FROM agent_runs WHERE id=?", (run.id,)).fetchone()
        if not row:
            return
        started_at = datetime.fromisoformat(str(row["started_at"]).replace("Z", ""))
        ended_at = datetime.utcnow()
        agent_run = AgentRun(
            id=run.id,
            session_id=run.session_id,
            agent_name=row["agent_name"],
            parent_run_id=row["parent_run_id"],
            triggered_by=row["triggered_by"],
            input=None,
            output=output,
            status=status,  # type: ignore[arg-type]
            started_at=started_at,
            ended_at=ended_at,
            latency_ms=int((ended_at - started_at).total_seconds() * 1000),
            tokens=tokens or TokenUsage(),
            cost_usd=cost_usd,
        )
        self.storage.upsert_run(agent_run)

    def trace(self, agent_name: str) -> Callable[[Callable[..., T]], Callable[..., T]]:
        def decorator(function: Callable[..., T]) -> Callable[..., T]:
            @wraps(function)
            def wrapper(*args: Any, **kwargs: Any) -> T:
                run = self.start_run(agent_name, input={"args": args, "kwargs": kwargs})
                token = _active_run.set((run.id, run.session_id))
                try:
                    result = function(*args, **kwargs)
                    self.end_run(run, output=result)
                    return result
                except Exception as error:
                    self._fail_run(run, error)
                    raise
                finally:
                    _active_run.reset(token)
            return wrapper
        return decorator

    def tool_call(self, name: str, input_value: Any, callback: Callable[[], T], run_id: str | None = None) -> T:
        active = _active_run.get()
        target_run_id = run_id or (active[0] if active else None)
        if not target_run_id:
            implicit = self.start_run(f"tool:{name}", input=input_value)
            target_run_id = implicit.id
        started = time.perf_counter()
        try:
            output = callback()
            self.storage.insert_tool_call(target_run_id, create_id("tool"), name, input_value, output, int((time.perf_counter() - started) * 1000))
            return output
        except Exception as error:
            self.storage.insert_tool_call(target_run_id, create_id("tool"), name, input_value, None, int((time.perf_counter() - started) * 1000), "failed", str(error))
            raise

    def _fail_run(self, run: RunHandle, error: Exception) -> None:
        self.end_run(run, status="failed")
        self.storage.connection.execute(
            "UPDATE agent_runs SET error=?, error_stack=?, status='failed' WHERE id=?",
            (str(error), "".join(traceback.format_exception(error)), run.id),
        )
        self.storage.connection.commit()

    def close(self) -> None:
        self.storage.close()


def create_tracer(db_path: str = "./agent-prism.db") -> Tracer:
    return Tracer(db_path=db_path)