# Parser Guide

Implement `LogParser` with `name`, `detect(line)`, and `parseLine(line)`. Return normalized `run`, `toolCall`, or `modelCall` events.

The included Hermes and OpenClaw parsers support JSONL-style structured logs and compact text patterns. OpenClaw also supports real `openclaw logs --json` operational logs by converting each log entry into an operational Agent Prism run. Hermes supports real timestamped `$env:HERMES_HOME\logs\agent.log` and `errors.log` lines the same way.

## CLI Import

```powershell
agent-prism import --db ./agent-prism-imported.db --file ./logs/hermes.jsonl --parser hermes
agent-prism import --db ./agent-prism-imported.db --file ./logs/openclaw.jsonl --parser openclaw
agent-prism import --db ./agent-prism-imported.db --file ./logs/agent.log --parser auto
```

The import command records an audit row in `parser_imports`, preserves source metadata on imported runs/calls, and avoids creating extra empty sessions when log lines already contain `sessionId`.

## Supported Event Shapes

Structured run:

```json
{"framework":"openclaw","type":"run","runId":"run_1","sessionId":"ses_1","agentName":"planner","status":"success","latencyMs":42}
```

Structured tool call:

```json
{"framework":"hermes","type":"tool","runId":"run_1","toolName":"session_search","input":{"query":"invoice"},"output":{"hits":3},"latencyMs":40}
```

Structured model call:

```json
{"framework":"openclaw","type":"model","runId":"run_1","provider":"openrouter","method":"chat.completions.create","model":"openai/gpt-4.1-nano","usage":{"prompt_tokens":15,"completion_tokens":3,"total_tokens":18},"cost_usd":0.0000027}
```

OpenClaw operational log:

```json
{"type":"log","time":"2026-05-20T18:47:48.576+00:00","level":"info","subsystem":"gateway/ws","message":"res ok health 138ms"}
```

Hermes operational log:

```text
2026-05-20 18:59:37,718 INFO hermes_cli.plugins: Plugin 'xai' registered image_gen provider: xai
```

Fixtures live in `packages/agent-prism/tests/fixtures/`.