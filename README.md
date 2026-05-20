# Agent Prism

Drop-in tracing for agent pipelines. Local SQLite, zero hosted account, real token/cost tracking, and a dashboard you can run on your own machine.

Agent Prism is not another agent framework. Keep your existing agents, tool calls, OpenAI/Anthropic/OpenRouter clients, Hermes/OpenClaw workflows, or Python scripts. Add the tracer around them and Agent Prism records what happened: agent runs, parent/child handoffs, tool calls, model calls, latency, errors, token usage, and USD cost.

## Quick Start

```powershell
npm install
npm run build
npm run seed -w agent-prism
npm exec -w agent-prism -- agent-prism dashboard --db ./agent-prism.db
```

Open `http://127.0.0.1:4242` if the browser does not open automatically.

## SDK

```ts
import { createTracer } from 'agent-prism';

const prism = createTracer({ dbPath: './agent-prism.db' });

const tracedAgent = prism.wrap('sales-agent', async (input: { accountId: string }) => {
  const crm = await prism.toolCall('search_crm', { accountId: input.accountId }, async () => {
    return { tier: 'enterprise' };
  });

  return { crm };
});

await tracedAgent({ accountId: 'acct_123' });
prism.shutdown();
```

## Manual Spans

```ts
const run = prism.startRun('orchestrator-agent', { input: { goal: 'renewal email' } });
const child = run.startChild('finance-agent', { input: { accountId: 'acct_123' } });

child.recordModelCall({
  provider: 'anthropic',
  method: 'messages.create',
  model: 'claude-sonnet-4-6',
  tokens: { input: 1000, output: 500 },
  output: { text: 'Approved' }
});

child.end({ output: { score: 92 } });
run.end({ output: { complete: true } });
```

## Provider Middleware

```ts
import OpenAI from 'openai';
import { createTracer, withOpenAI } from 'agent-prism';

const prism = createTracer();
const openai = withOpenAI(new OpenAI(), prism);
```

`withOpenAI`, `withAnthropic`, and `withPrism` intercept SDK-shaped calls and record provider, method, model, latency, usage, cost, inputs, outputs, and failures. OpenRouter works through its OpenAI-compatible endpoint and keeps OpenRouter-reported `usage.cost` when available.

## CLI

```powershell
agent-prism init --db ./agent-prism.db
agent-prism demo --db ./agent-prism.db
agent-prism dashboard --db ./agent-prism.db
agent-prism stats --db ./agent-prism.db
agent-prism export --format json --db ./agent-prism.db
agent-prism export --format csv --db ./agent-prism.db
```

Import Hermes/OpenClaw-style logs:

```powershell
agent-prism import --db ./agent-prism-openclaw.db --file ./logs/openclaw.jsonl --parser openclaw
agent-prism import --db ./agent-prism-hermes.db --file ./logs/hermes.jsonl --parser hermes
agent-prism import --db ./agent-prism-imported.db --file ./logs/agent.log --parser auto
```

## Dashboard

The dashboard is local and reads from SQLite while your agent writes to it.

- Session Timeline: recursive agent tree with tools, model calls, status, latency, and cost.
- Cost Dashboard: cost by agent, cost over time, token split, and expensive calls.
- Tool Call Inspector: full JSON input/output, errors, latency, tokens, and cost.
- Agent Health: run counts, success rate, average latency, P95 latency, and common failures.

## Hermes And OpenClaw

Agent Prism supports Hermes/OpenClaw in two ways:

- Native tracing: wrap any code you control with the SDK.
- Log import: use `agent-prism import` with the built-in `hermes`, `openclaw`, or `auto` parser.

The OpenClaw parser accepts Agent Prism-style JSONL events and real `openclaw logs --json` operational log output. The Hermes parser accepts structured JSONL events, compact Hermes status lines, and real `$env:HERMES_HOME\logs\agent.log` / `errors.log` operational logs.

Checked-in fixtures:

- `packages/agent-prism/tests/fixtures/hermes.jsonl`
- `packages/agent-prism/tests/fixtures/hermes-agent-log.txt`
- `packages/agent-prism/tests/fixtures/openclaw.jsonl`
- `packages/agent-prism/tests/fixtures/openclaw-gateway.jsonl`

## OpenRouter Live Test

Set your key in the terminal, then run:

```powershell
$env:OPENROUTER_API_KEY="your_key_here"
npm run live:openrouter -w agent-prism
```

Defaults:

- OpenAI route: `openai/gpt-4.1-nano`
- Anthropic route: `anthropic/claude-3-haiku`
- Requests: `1` round, which means two requests total
- Budget guard: `$0.50`

More effective live testing, still budget-limited:

```powershell
$env:OPENROUTER_REQUESTS="5"
$env:OPENROUTER_BUDGET_USD="0.50"
$env:OPENROUTER_MAX_TOKENS="16"
npm run live:openrouter -w agent-prism
```

The script writes `./agent-prism-openrouter.db` relative to the directory where you invoked `npm run`, prints every response's usage/cost, and fails if the cumulative reported cost exceeds the budget.

## Framework Matrix

| Agent / framework | Status |
| --- | --- |
| Custom JavaScript/TypeScript agents | Wrap/manual span API implemented |
| OpenAI SDK-shaped calls | Proxy middleware implemented |
| Anthropic SDK-shaped calls | Proxy middleware implemented |
| OpenRouter | Live script and OpenAI-compatible proxy implemented |
| Vercel AI SDK | Use `withPrism` around compatible clients or manual spans |
| LangChain.js | Manual callback integration via `recordToolCall` / `recordModelCall` |
| Hermes | Structured parser plus real `$env:HERMES_HOME\logs\*.log` import implemented |
| OpenClaw | Structured parser plus real `openclaw logs --json` import implemented |
| Python agents / CrewAI-style code | `agent-prism-py` writes the same SQLite schema |

## Self-Test Checklist

```powershell
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run benchmark
```

Parser import smoke:

```powershell
node packages/agent-prism/dist/cli/index.js import --db ./agent-prism-openclaw-fixture.db --file packages/agent-prism/tests/fixtures/openclaw.jsonl --parser auto
node packages/agent-prism/dist/cli/index.js stats --db ./agent-prism-openclaw-fixture.db
node packages/agent-prism/dist/cli/index.js dashboard --db ./agent-prism-openclaw-fixture.db --no-open
```

OpenClaw local smoke after installing `openclaw`:

```powershell
openclaw --version
openclaw onboard --non-interactive --accept-risk --mode local --auth-choice skip --skip-channels --skip-daemon --skip-health --skip-search --skip-ui
openclaw doctor --non-interactive
openclaw status --json --timeout 5000
```

Hermes local smoke after installing `hermes`:

```powershell
hermes --help
hermes --version
hermes doctor
hermes status
hermes logs list
$env:HERMES_HOME = [Environment]::GetEnvironmentVariable("HERMES_HOME", "User")
node packages/agent-prism/dist/cli/index.js import --db ./agent-prism-hermes-live.db --file "$env:HERMES_HOME\logs\agent.log" --parser hermes
```

Python package smoke, when Python works in your environment:

```powershell
python -m pytest packages/agent-prism-py/tests
```

## Comparison

| Tool | Agent Prism | LangSmith / Langfuse / Phoenix |
| --- | --- | --- |
| Setup | Local SQLite, no account | Usually server/cloud oriented |
| Scope | Lightweight agent tracing | Broader observability/eval platforms |
| Dashboard | Local Hono + static Preact | Hosted or heavier local stacks |
| Best for | Local/indie agent builders and integration debugging | Teams needing full hosted observability/evals |

## Current Notes

- SQLite is the production default. PostgreSQL is present as an adapter scaffold, not the recommended v0.1 path.
- Tracing failures default to warning/continuation behavior so observability does not break the agent being observed.
- No npm or PyPI publishing is performed by this repo setup.
- Rotate any provider key that was pasted into a shared chat or terminal transcript.
