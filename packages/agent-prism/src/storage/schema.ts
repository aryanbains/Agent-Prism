export interface Migration {
  version: number;
  statements: string[];
}

export const SQLITE_MIGRATIONS: Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        name TEXT,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        latency_ms INTEGER,
        total_tokens_input INTEGER NOT NULL DEFAULT 0,
        total_tokens_output INTEGER NOT NULL DEFAULT 0,
        total_tokens_cached INTEGER NOT NULL DEFAULT 0,
        total_tokens_total INTEGER NOT NULL DEFAULT 0,
        total_cost_usd REAL NOT NULL DEFAULT 0,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS agent_runs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        agent_name TEXT NOT NULL,
        parent_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
        triggered_by TEXT NOT NULL,
        input_json TEXT,
        output_json TEXT,
        status TEXT NOT NULL,
        error TEXT,
        error_stack TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        latency_ms INTEGER,
        tokens_input INTEGER NOT NULL DEFAULT 0,
        tokens_output INTEGER NOT NULL DEFAULT 0,
        tokens_cached INTEGER NOT NULL DEFAULT 0,
        tokens_total INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS tool_calls (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
        tool_name TEXT NOT NULL,
        input_json TEXT,
        output_json TEXT,
        latency_ms INTEGER NOT NULL DEFAULT 0,
        tokens_input INTEGER NOT NULL DEFAULT 0,
        tokens_output INTEGER NOT NULL DEFAULT 0,
        tokens_cached INTEGER NOT NULL DEFAULT 0,
        tokens_total INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        error TEXT,
        error_stack TEXT,
        called_at TEXT NOT NULL,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS model_calls (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        method TEXT NOT NULL,
        model TEXT,
        input_json TEXT,
        output_json TEXT,
        latency_ms INTEGER NOT NULL DEFAULT 0,
        tokens_input INTEGER NOT NULL DEFAULT 0,
        tokens_output INTEGER NOT NULL DEFAULT 0,
        tokens_cached INTEGER NOT NULL DEFAULT 0,
        tokens_total INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        error TEXT,
        error_stack TEXT,
        called_at TEXT NOT NULL,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS parser_imports (
        id TEXT PRIMARY KEY,
        parser_name TEXT NOT NULL,
        source TEXT NOT NULL,
        imported_at TEXT NOT NULL,
        run_count INTEGER NOT NULL DEFAULT 0,
        tool_call_count INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)`,
      `CREATE INDEX IF NOT EXISTS idx_agent_runs_session_id ON agent_runs(session_id)`,
      `CREATE INDEX IF NOT EXISTS idx_agent_runs_parent_run_id ON agent_runs(parent_run_id)`,
      `CREATE INDEX IF NOT EXISTS idx_agent_runs_started_at ON agent_runs(started_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status)`,
      `CREATE INDEX IF NOT EXISTS idx_tool_calls_run_id ON tool_calls(run_id)`,
      `CREATE INDEX IF NOT EXISTS idx_model_calls_run_id ON model_calls(run_id)`
    ]
  }
];