# Agent Prism

Drop-in tracing for any agent pipeline. Local SQLite, zero config, real costs.

See the workspace root README for the full guide. The published package contains the SDK, CLI, Hono dashboard server, static dashboard assets, parser scaffolds, and TypeScript types.

## Quick Start

```ts
import { createTracer } from 'agent-prism';

const prism = createTracer({ dbPath: './agent-prism.db' });
const traced = prism.wrap('sales-agent', async (input) => ({ ok: true, input }));
await traced({ accountId: 'acct_123' });
prism.shutdown();
```

## CLI

```bash
agent-prism init --db ./agent-prism.db
agent-prism demo --db ./agent-prism.db
agent-prism import --db ./agent-prism.db --file ./openclaw.jsonl --parser openclaw
agent-prism import --db ./agent-prism.db --file "$env:HERMES_HOME\logs\agent.log" --parser hermes
agent-prism dashboard --db ./agent-prism.db
agent-prism stats --db ./agent-prism.db
```

## OpenRouter Live Smoke Test

```bash
$env:OPENROUTER_API_KEY='...'
npm run live:openrouter -w agent-prism
```

Defaults:

- OpenAI model: `openai/gpt-4.1-nano`
- Anthropic model: `anthropic/claude-3-haiku`
- Request rounds: `OPENROUTER_REQUESTS=1` by default, two requests total
- Budget guard: `OPENROUTER_BUDGET_USD=0.50` by default

Override with `OPENROUTER_OPENAI_MODEL`, `OPENROUTER_ANTHROPIC_MODEL`, `OPENROUTER_REQUESTS`, `OPENROUTER_MAX_TOKENS`, and `OPENROUTER_BUDGET_USD`.

If you want the absolute cheapest paid OpenAI option, use `openai/gpt-5-nano`. If you want the absolute cheapest OpenAI-branded option overall, use `openai/gpt-oss-20b:free`.