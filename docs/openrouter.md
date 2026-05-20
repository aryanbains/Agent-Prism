# OpenRouter Live Test

Use this when you want a real provider smoke test without direct OpenAI or Anthropic credentials.

## Verified low-cost pair from OpenRouter

- OpenAI: `openai/gpt-4.1-nano`
  - Input: `$0.10 / 1M tokens`
  - Output: `$0.40 / 1M tokens`
- Anthropic: `anthropic/claude-3-haiku`
  - Input: `$0.25 / 1M tokens`
  - Output: `$1.25 / 1M tokens`

Cheapest OpenAI alternatives:

- `openai/gpt-5-nano` for the cheapest paid proprietary OpenAI route.
- `openai/gpt-oss-20b:free` for the cheapest OpenAI-branded route overall.

## Tiny smoke-test estimate

At roughly `100` input tokens and `50` output tokens per request:

- OpenAI request: about `$0.000003`
- Anthropic request: about `$0.0000875`
- Combined: about `$0.0000155`

That is far below one cent and far below the `$0.50` cap.

## Command

```powershell
$env:OPENROUTER_API_KEY="your_key_here"
npm run live:openrouter -w agent-prism
```

## More Requests With A Budget Guard

```powershell
$env:OPENROUTER_REQUESTS="5"
$env:OPENROUTER_BUDGET_USD="0.50"
$env:OPENROUTER_MAX_TOKENS="16"
npm run live:openrouter -w agent-prism
```

`OPENROUTER_REQUESTS` is the number of rounds. Each round calls the configured OpenAI route and Anthropic route, so `5` means `10` live requests. The script fails if cumulative OpenRouter-reported `usage.cost` exceeds `OPENROUTER_BUDGET_USD`.

Optional model overrides:

```powershell
$env:OPENROUTER_OPENAI_MODEL="openai/gpt-5-nano"
$env:OPENROUTER_ANTHROPIC_MODEL="anthropic/claude-3.5-haiku"
```

The script uses the OpenRouter OpenAI-compatible endpoint and prints actual usage and cost returned by OpenRouter. The default trace DB path is resolved relative to the directory where you invoke `npm run`, not the package subfolder.