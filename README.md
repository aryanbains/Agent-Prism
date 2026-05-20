# Agent Prism

Drop-in tracing for agent pipelines. Local SQLite, real token/cost tracking, and a dashboard that ships with the npm package.

Agent Prism is not another agent framework. Keep your existing agents, tool calls, OpenAI/Anthropic/OpenRouter clients, Hermes/OpenClaw workflows, or Python scripts. Add the tracer around them and Agent Prism records what happened: agent runs, parent/child handoffs, tool calls, model calls, latency, errors, token usage, and USD cost.

## Install

For app users:

```sh
npm install agent-prism
npx agent-prism init --db ./agent-prism.db
npx agent-prism demo --db ./agent-prism.db
npx agent-prism dashboard --db ./agent-prism.db
```

The CLI also ships an `agentprism` alias:

```sh
npx agentprism dashboard --db ./agent-prism.db
```

Open `http://127.0.0.1:4242` if the browser does not open automatically.

For contributors working from this repository:

```sh
npm install
npm run build
npm exec -w agent-prism -- agent-prism dashboard --db ./agent-prism.db
```

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

## OpenAI, Anthropic, And OpenRouter

OpenAI and Anthropic are first-class. OpenRouter is supported through its OpenAI-compatible endpoint and preserves OpenRouter-reported `usage.cost` when present.

```ts
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { createTracer, withAnthropic, withOpenAI, withOpenRouter } from 'agent-prism';

const prism = createTracer();

const openai = withOpenAI(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }), prism);
const anthropic = withAnthropic(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }), prism);
const openrouter = withOpenRouter(new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1'
}), prism);
```

`withPrism` is also exported for custom SDK-shaped clients.

## CLI

```sh
agent-prism init --db ./agent-prism.db
agent-prism demo --db ./agent-prism.db
agent-prism dashboard --db ./agent-prism.db
agent-prism stats --db ./agent-prism.db
agent-prism export --format json --db ./agent-prism.db
agent-prism export --format csv --db ./agent-prism.db
```

Import Hermes/OpenClaw-style logs:

```sh
agent-prism import --db ./agent-prism-openclaw.db --file ./logs/openclaw.jsonl --parser openclaw
agent-prism import --db ./agent-prism-hermes.db --file ./logs/hermes.log --parser hermes
agent-prism import --db ./agent-prism-imported.db --file ./logs/agent.log --parser auto
```

## Dashboard

The dashboard is bundled into the npm package under `dist/dashboard` by `npm run build` and `npm pack`. The CLI serves those files directly, so installed users do not need a local Vite build.

Views:

- Session Timeline: recursive agent tree with tools, model calls, status, latency, and cost.
- Cost Dashboard: cost by agent, cost over time, token split, and expensive calls.
- Tool Call Inspector: full JSON input/output, errors, latency, tokens, and cost.
- Agent Health: run counts, success rate, average latency, P95 latency, and common failures.

## Hermes And OpenClaw

Agent Prism supports Hermes/OpenClaw in two ways:

- Native tracing: wrap any code you control with the SDK.
- Log import: use `agent-prism import` with the built-in `hermes`, `openclaw`, or `auto` parser.

The OpenClaw parser accepts Agent Prism-style JSONL events and real `openclaw logs --json` operational log output. The Hermes parser accepts structured JSONL events, compact Hermes status lines, and real `$HERMES_HOME/logs/agent.log` / `errors.log` operational logs.

Checked-in fixtures:

- `packages/agent-prism/tests/fixtures/hermes.jsonl`
- `packages/agent-prism/tests/fixtures/hermes-agent-log.txt`
- `packages/agent-prism/tests/fixtures/openclaw.jsonl`
- `packages/agent-prism/tests/fixtures/openclaw-gateway.jsonl`

## OpenRouter Live Test

Bash/macOS/Linux:

```sh
export OPENROUTER_API_KEY="your_key_here"
export OPENROUTER_REQUESTS="5"
export OPENROUTER_BUDGET_USD="0.50"
export OPENROUTER_MAX_TOKENS="16"
npm run live:openrouter -w agent-prism
```

PowerShell/Windows:

```powershell
$env:OPENROUTER_API_KEY="your_key_here"
$env:OPENROUTER_REQUESTS="5"
$env:OPENROUTER_BUDGET_USD="0.50"
$env:OPENROUTER_MAX_TOKENS="16"
npm run live:openrouter -w agent-prism
```

Defaults:

- OpenAI route: `openai/gpt-4.1-nano`
- Anthropic route: `anthropic/claude-3-haiku`
- Requests: `1` round, which means two requests total
- Budget guard: `$0.50`

The script writes `./agent-prism-openrouter.db`, prints every response's usage/cost, and fails if cumulative reported cost exceeds the budget.

## Framework Matrix

| Agent / framework | Status |
| --- | --- |
| Custom JavaScript/TypeScript agents | Wrap/manual span API implemented |
| OpenAI SDK-shaped calls | `withOpenAI` implemented and tested |
| Anthropic SDK-shaped calls | `withAnthropic` implemented and tested |
| OpenRouter | `withOpenRouter`, `withPrism`, live script, and `usage.cost` preservation implemented |
| Vercel AI SDK | Use `withPrism` around compatible clients or manual spans |
| LangChain.js | Manual callback integration via `recordToolCall` / `recordModelCall` |
| Hermes | Structured parser plus real `$HERMES_HOME/logs/*.log` import implemented |
| OpenClaw | Structured parser plus real `openclaw logs --json` import implemented |
| Python agents / CrewAI-style code | `agent-prism-py` writes the same SQLite schema |

## Self-Test Checklist

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run benchmark
npm run python:test
npm pack -w agent-prism --dry-run
```

Parser import smoke:

```sh
node packages/agent-prism/dist/cli/index.js import --db ./agent-prism-openclaw-fixture.db --file packages/agent-prism/tests/fixtures/openclaw.jsonl --parser auto
node packages/agent-prism/dist/cli/index.js stats --db ./agent-prism-openclaw-fixture.db
node packages/agent-prism/dist/cli/index.js dashboard --db ./agent-prism-openclaw-fixture.db --no-open
```

Hermes local smoke after installing `hermes`:

```sh
hermes --version
hermes doctor
hermes status
hermes logs list
```

PowerShell import from the configured Hermes home:

```powershell
$env:HERMES_HOME = [Environment]::GetEnvironmentVariable("HERMES_HOME", "User")
node packages/agent-prism/dist/cli/index.js import --db ./agent-prism-hermes-live.db --file "$env:HERMES_HOME\logs\agent.log" --parser hermes
```

Bash import from the configured Hermes home:

```sh
agent-prism import --db ./agent-prism-hermes-live.db --file "$HERMES_HOME/logs/agent.log" --parser hermes
```

OpenClaw local smoke after installing `openclaw`:

```sh
openclaw --version
openclaw health --json --timeout 5000
openclaw logs --json --limit 20 --timeout 5000 > openclaw-live.jsonl
agent-prism import --db ./agent-prism-openclaw-live.db --file ./openclaw-live.jsonl --parser openclaw
```

## Publishing

The package is configured for public npm publishing but this repository does not publish automatically.

Before publishing:

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run benchmark
npm run python:test
npm pack -w agent-prism --dry-run
```

Then publish intentionally:

```sh
npm publish -w agent-prism --access public
```

`prepack` builds SDK, CLI, and dashboard assets. `prepublishOnly` runs typecheck, tests, and build.

## Current Notes

- SQLite is the supported storage path for v0.1.
- PostgreSQL is exported only as an `@experimental` adapter scaffold until schema parity lands.
- Tracing failures default to warning/continuation behavior so observability does not break the agent being observed.
- Root `package-lock.json` is intentionally ignored for the library workspace; CI uses `npm install`.
- Rotate any provider key that was pasted into a shared chat or terminal transcript.
