# Agent Prism

Drop-in tracing for agent pipelines. Local SQLite, real costs, and a dashboard bundled with the npm package.

![Agent Prism demo](https://raw.githubusercontent.com/aryanbains/Agent-Prism/main/docs/assets/agent-prism-demo.gif)

Full docs, launch notes, and self-test steps live in the GitHub README: https://github.com/aryanbains/Agent-Prism#readme

## Install

```sh
npm install agent-prism
npx agent-prism init --db ./agent-prism.db
npx agent-prism demo --db ./agent-prism.db
npx agent-prism dashboard --db ./agent-prism.db
```

`agentprism` is also published as a CLI alias.

If the browser does not open automatically, visit `http://127.0.0.1:4242`.

## SDK

```ts
import { createTracer } from 'agent-prism';

const prism = createTracer({ dbPath: './agent-prism.db' });
const traced = prism.wrap('sales-agent', async (input) => ({ ok: true, input }));
await traced({ accountId: 'acct_123' });
prism.shutdown();
```

## Provider Middleware

```ts
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { createTracer, withAnthropic, withGemini, withOpenAI, withOpenRouter, withVercelAI } from 'agent-prism';

const prism = createTracer();
const openai = withOpenAI(new OpenAI(), prism);
const anthropic = withAnthropic(new Anthropic(), prism);
const openrouter = withOpenRouter(new OpenAI({ baseURL: 'https://openrouter.ai/api/v1' }), prism);
const gemini = withGemini(googleGenAIClient, prism);
const vercelAI = withVercelAI(vercelAIClient, prism);
```

OpenAI and Anthropic SDK-shaped calls are first-class. OpenRouter is supported through the OpenAI-compatible API and preserves provider-reported `usage.cost` when present. Gemini and Vercel AI SDK-shaped clients now have first-party convenience wrappers as well.

## CLI

```sh
agent-prism init --db ./agent-prism.db
agent-prism demo --db ./agent-prism.db
agent-prism import --db ./agent-prism.db --file ./openclaw.jsonl --parser openclaw
agent-prism import --db ./agent-prism.db --file "$HERMES_HOME/logs/agent.log" --parser hermes
agent-prism dashboard --db ./agent-prism.db
agent-prism stats --db ./agent-prism.db
```

## Published Package Contents

The npm tarball includes:

- `dist/index.js` and `dist/index.cjs`
- `dist/server/app.js` and `dist/server/app.cjs`
- `dist/parsers/index.js` and `dist/parsers/index.cjs`
- `dist/cli/index.js`
- `dist/dashboard/index.html` and bundled dashboard assets

`prepack` builds the SDK, CLI, and dashboard before package creation.
