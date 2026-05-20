# What Agent Prism Is For

Agent Prism is a local observability layer for agent systems. It helps you answer the questions that appear after an agent run goes wrong or becomes expensive:

- Which agent handled the request?
- Which child agents did it call?
- Which tools ran, with what inputs and outputs?
- Which model calls happened, how long did they take, and what did they cost?
- Where did the run fail or time out?
- Is one agent becoming slow, unreliable, or expensive over time?

## Why It Exists

Agent workflows are often built from many small parts: routers, planners, subagents, tools, model calls, memory lookups, browser actions, and scheduled tasks. Console logs can show fragments, but they rarely show the full tree of what happened.

Agent Prism records that tree into SQLite and makes it inspectable in a local dashboard. You can use it while developing an agent, validating a launch, comparing model/provider choices, or debugging a customer-impacting workflow without sending traces to a hosted observability service.

## Who It Helps

- Builders shipping local or self-hosted agents.
- Developers comparing OpenAI, Anthropic, OpenRouter, or local model routes.
- People running Hermes/OpenClaw-style assistants who want a separate trace viewer.
- Teams that want a small, auditable SQLite trace file before adopting a larger observability platform.

## What It Does Not Try To Be

Agent Prism is not an agent runtime, hosted SaaS, eval platform, prompt optimizer, or replay engine. It observes your system; it does not own your system. Replay would require user-provided replay handlers because trace records do not contain executable application code.

## Typical Workflow

1. Add `createTracer()` to your project.
2. Wrap agent functions with `prism.wrap()` or create manual spans with `startRun()`.
3. Record tool/model calls manually or through `withOpenAI`, `withAnthropic`, or `withPrism`.
4. Run your agent normally.
5. Open `agent-prism dashboard --db ./agent-prism.db`.
6. Inspect the timeline, cost dashboard, tool/model details, and health view.

For systems you do not control directly, import structured logs:

```powershell
agent-prism import --db ./agent-prism-imported.db --file ./openclaw.jsonl --parser openclaw
agent-prism dashboard --db ./agent-prism-imported.db
```

## Practical Uses

- Find the slowest tool call in a multi-agent handoff.
- Prove an OpenRouter request recorded the provider-reported cost correctly.
- Compare cheap smoke-test models before spending real budget.
- Inspect real OpenClaw gateway operational logs in the same UI as native traces.
- Keep a trace DB attached to a bug report or launch checklist.

The core idea is simple: agent behavior should be visible as a tree, not scattered across terminal output.