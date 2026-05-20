# SQLite Schema

Agent Prism stores traces in `sessions`, `agent_runs`, `tool_calls`, `model_calls`, and `parser_imports`. WAL mode is enabled so the dashboard can read while agents write.

Key indexes are created on session id, parent run id, status, and start time. Inputs, outputs, metadata, and parser raw payloads are stored as JSON text.