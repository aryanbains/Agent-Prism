from __future__ import annotations

import json
import sqlite3
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Any

from .types import AgentRun, TokenUsage


def iso(value: datetime | None) -> str | None:
    return value.isoformat(timespec="milliseconds") + "Z" if value else None


def serialize(value: Any) -> str:
    try:
        return json.dumps(value, default=str)
    except TypeError:
        return json.dumps({"unserializable": True, "value": str(value)})


class SqliteStorage:
    def __init__(self, db_path: str = "./agent-prism.db") -> None:
        self.db_path = str(Path(db_path).resolve())
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(self.db_path)
        self.connection.row_factory = sqlite3.Row
        self.init_schema()

    def init_schema(self) -> None:
        cursor = self.connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.executescript(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS sessions (
              id TEXT PRIMARY KEY, name TEXT, status TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT,
              latency_ms INTEGER, total_tokens_input INTEGER NOT NULL DEFAULT 0, total_tokens_output INTEGER NOT NULL DEFAULT 0,
              total_tokens_cached INTEGER NOT NULL DEFAULT 0, total_tokens_total INTEGER NOT NULL DEFAULT 0,
              total_cost_usd REAL NOT NULL DEFAULT 0, metadata_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS agent_runs (
              id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
              agent_name TEXT NOT NULL, parent_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
              triggered_by TEXT NOT NULL, input_json TEXT, output_json TEXT, status TEXT NOT NULL,
              error TEXT, error_stack TEXT, started_at TEXT NOT NULL, ended_at TEXT, latency_ms INTEGER,
              tokens_input INTEGER NOT NULL DEFAULT 0, tokens_output INTEGER NOT NULL DEFAULT 0,
              tokens_cached INTEGER NOT NULL DEFAULT 0, tokens_total INTEGER NOT NULL DEFAULT 0,
              cost_usd REAL NOT NULL DEFAULT 0, metadata_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tool_calls (
              id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
              tool_name TEXT NOT NULL, input_json TEXT, output_json TEXT, latency_ms INTEGER NOT NULL DEFAULT 0,
              tokens_input INTEGER NOT NULL DEFAULT 0, tokens_output INTEGER NOT NULL DEFAULT 0,
              tokens_cached INTEGER NOT NULL DEFAULT 0, tokens_total INTEGER NOT NULL DEFAULT 0,
              cost_usd REAL NOT NULL DEFAULT 0, status TEXT NOT NULL, error TEXT, error_stack TEXT,
              called_at TEXT NOT NULL, metadata_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS model_calls (
              id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
              provider TEXT NOT NULL, method TEXT NOT NULL, model TEXT, input_json TEXT, output_json TEXT,
              latency_ms INTEGER NOT NULL DEFAULT 0, tokens_input INTEGER NOT NULL DEFAULT 0,
              tokens_output INTEGER NOT NULL DEFAULT 0, tokens_cached INTEGER NOT NULL DEFAULT 0,
              tokens_total INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0, status TEXT NOT NULL,
              error TEXT, error_stack TEXT, called_at TEXT NOT NULL, metadata_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS parser_imports (
              id TEXT PRIMARY KEY, parser_name TEXT NOT NULL, source TEXT NOT NULL, imported_at TEXT NOT NULL,
              run_count INTEGER NOT NULL DEFAULT 0, tool_call_count INTEGER NOT NULL DEFAULT 0, metadata_json TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_agent_runs_session_id ON agent_runs(session_id);
            CREATE INDEX IF NOT EXISTS idx_agent_runs_parent_run_id ON agent_runs(parent_run_id);
            """
        )
        self.connection.commit()

    def create_session(self, session_id: str, name: str, started_at: datetime) -> None:
        now = iso(datetime.utcnow())
        self.connection.execute(
            """INSERT OR IGNORE INTO sessions
            (id, name, status, started_at, total_tokens_input, total_tokens_output, total_tokens_cached, total_tokens_total, total_cost_usd, metadata_json, created_at, updated_at)
            VALUES (?, ?, 'running', ?, 0, 0, 0, 0, 0, '{}', ?, ?)""",
            (session_id, name, iso(started_at), now, now),
        )
        self.connection.commit()

    def upsert_run(self, run: AgentRun) -> None:
        now = iso(datetime.utcnow())
        tokens = run.tokens
        self.connection.execute(
            """INSERT INTO agent_runs
            (id, session_id, agent_name, parent_run_id, triggered_by, input_json, output_json, status, error, error_stack,
             started_at, ended_at, latency_ms, tokens_input, tokens_output, tokens_cached, tokens_total, cost_usd,
             metadata_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET output_json=excluded.output_json, status=excluded.status, error=excluded.error,
            error_stack=excluded.error_stack, ended_at=excluded.ended_at, latency_ms=excluded.latency_ms,
            tokens_input=excluded.tokens_input, tokens_output=excluded.tokens_output, tokens_cached=excluded.tokens_cached,
            tokens_total=excluded.tokens_total, cost_usd=excluded.cost_usd, metadata_json=excluded.metadata_json,
            updated_at=excluded.updated_at""",
            (
                run.id,
                run.session_id,
                run.agent_name,
                run.parent_run_id,
                run.triggered_by,
                serialize(run.input),
                serialize(run.output),
                run.status,
                run.error,
                run.error_stack,
                iso(run.started_at),
                iso(run.ended_at),
                run.latency_ms,
                tokens.input,
                tokens.output,
                tokens.cached,
                tokens.total,
                run.cost_usd,
                serialize(run.metadata),
                now,
                now,
            ),
        )
        self.connection.commit()
        self.refresh_session(run.session_id)

    def get_run(self, run_id: str) -> AgentRun | None:
        row = self.connection.execute("SELECT * FROM agent_runs WHERE id=?", (run_id,)).fetchone()
        if not row:
            return None
        return AgentRun(
            id=row["id"],
            session_id=row["session_id"],
            agent_name=row["agent_name"],
            parent_run_id=row["parent_run_id"],
            triggered_by=row["triggered_by"],
            input=None,
            output=None,
            status=row["status"],
            error=row["error"],
            error_stack=row["error_stack"],
            started_at=datetime.fromisoformat(str(row["started_at"]).replace("Z", "")),
            ended_at=datetime.fromisoformat(str(row["ended_at"]).replace("Z", "")) if row["ended_at"] else None,
            latency_ms=row["latency_ms"],
            tokens=TokenUsage(
                input=row["tokens_input"],
                output=row["tokens_output"],
                cached=row["tokens_cached"],
                total=row["tokens_total"],
            ),
            cost_usd=row["cost_usd"],
        )

    def insert_tool_call(self, run_id: str, call_id: str, tool_name: str, input_value: Any, output: Any, latency_ms: int, status: str = "success", error: str | None = None) -> None:
        now = iso(datetime.utcnow())
        self.connection.execute(
            """INSERT OR REPLACE INTO tool_calls
            (id, run_id, tool_name, input_json, output_json, latency_ms, tokens_input, tokens_output, tokens_cached, tokens_total, cost_usd, status, error, error_stack, called_at, metadata_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, ?, ?, NULL, ?, '{}', ?, ?)""",
            (call_id, run_id, tool_name, serialize(input_value), serialize(output), latency_ms, status, error, now, now, now),
        )
        self.connection.commit()

    def refresh_session(self, session_id: str) -> None:
        row = self.connection.execute(
            """SELECT COALESCE(SUM(tokens_input),0) AS input, COALESCE(SUM(tokens_output),0) AS output,
            COALESCE(SUM(tokens_cached),0) AS cached, COALESCE(SUM(tokens_total),0) AS total,
            COALESCE(SUM(cost_usd),0) AS cost, MIN(started_at) AS started_at, MAX(ended_at) AS ended_at,
            SUM(CASE WHEN status='running' THEN 1 ELSE 0 END) AS running,
            SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed FROM agent_runs WHERE session_id=?""",
            (session_id,),
        ).fetchone()
        status = "running" if row["running"] else "failed" if row["failed"] else "success"
        self.connection.execute(
            """UPDATE sessions SET status=?, ended_at=?, total_tokens_input=?, total_tokens_output=?,
            total_tokens_cached=?, total_tokens_total=?, total_cost_usd=?, updated_at=? WHERE id=?""",
            (status, None if status == "running" else row["ended_at"], row["input"], row["output"], row["cached"], row["total"], row["cost"], iso(datetime.utcnow()), session_id),
        )
        self.connection.commit()

    def close(self) -> None:
        self.connection.close()