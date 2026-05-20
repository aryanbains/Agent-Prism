# AGENTS.md

This repo is friendly to AI coding assistants. Keep changes focused, verify them locally, and do not publish packages or push to remotes unless explicitly asked.

## Project Shape

- Root is an npm workspace with `packages/agent-prism` and `packages/dashboard`.
- `packages/agent-prism` contains the SDK, CLI, storage adapters, server, parsers, tests, and examples.
- `packages/dashboard` is a private Vite/Preact app that builds into `packages/agent-prism/dist/dashboard` for npm packaging.
- `packages/agent-prism-py` is the Python SDK that writes the same SQLite schema.

## Common Commands

```powershell
npm install
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run benchmark
npm run python:test
```

Run package smoke checks before launch work:

```powershell
npm pack -w agent-prism --dry-run
node packages/agent-prism/dist/cli/index.js demo --db ./agent-prism-smoke.db
node packages/agent-prism/dist/cli/index.js stats --db ./agent-prism-smoke.db
```

Remove generated smoke DBs before committing.

## Guardrails

- Do not commit `.env`, `.env.*`, SQLite DBs, logs, tarballs, `node_modules`, `dist`, Playwright output, or Python caches.
- Do not paste or commit API keys. Scan for `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and provider key prefixes before committing.
- Prefer SQLite in examples and docs. PostgreSQL is marked experimental in v0.1.
- The public CLI name is `agent-prism`; `agentprism` is included as a convenience alias.
- Keep OpenAI and Anthropic support first-class. OpenRouter support should work through the OpenAI-compatible endpoint and preserve provider-reported `usage.cost`.

## Release Checklist

1. `npm run typecheck`
2. `npm test`
3. `npm run build`
4. `npm run test:e2e`
5. `npm run benchmark`
6. `npm run python:test`
7. `npm pack -w agent-prism --dry-run`
8. Verify the tarball includes `dist/dashboard/index.html` and dashboard assets.