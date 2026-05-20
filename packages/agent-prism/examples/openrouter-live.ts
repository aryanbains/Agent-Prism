import { createTracer, withPrism } from '../src/index.js';
import { resolve } from 'node:path';

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  throw new Error('OPENROUTER_API_KEY is required. Set it in your terminal before running npm run live:openrouter -w agent-prism.');
}

const openaiModel = process.env.OPENROUTER_OPENAI_MODEL ?? 'openai/gpt-4.1-nano';
const anthropicModel = process.env.OPENROUTER_ANTHROPIC_MODEL ?? 'anthropic/claude-3-haiku';
const baseDirectory = process.env.INIT_CWD ?? process.cwd();
const dbPath = resolve(baseDirectory, process.env.AGENT_PRISM_DB_PATH ?? './agent-prism-openrouter.db');
const maxTokens = Math.max(16, Number(process.env.OPENROUTER_MAX_TOKENS ?? 16));
const requestRounds = Math.max(1, Math.trunc(Number(process.env.OPENROUTER_REQUESTS ?? 1)));
const budgetUSD = Math.max(0.000001, Number(process.env.OPENROUTER_BUDGET_USD ?? 0.5));

const prism = createTracer({ dbPath, onError: 'throw' });

const client = withPrism({
  chat: {
    completions: {
      create: async (body: Record<string, unknown>) => {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com/local/agent-prism',
            'X-OpenRouter-Title': 'Agent Prism Live Test'
          },
          body: JSON.stringify(body)
        });
        if (!response.ok) {
          throw new Error(`OpenRouter ${response.status}: ${await response.text()}`);
        }
        return response.json() as Promise<any>;
      }
    }
  }
}, prism);
const run = prism.startRun('openrouter-live-smoke', {
  input: {
    openaiModel,
    anthropicModel,
    requestRounds,
    budgetUSD,
    note: 'Tiny low-cost smoke test through OpenRouter'
  },
  sessionName: 'OpenRouter live smoke'
});

const prompts = [
  'Reply with exactly the single word prism.',
  'Reply with exactly the single word trace.',
  'Reply with exactly the single word cost.',
  'Reply with exactly the single word tool.',
  'Reply with exactly the single word run.'
];

try {
  const results: any[] = [];
  let combinedCost = 0;

  for (let round = 0; round < requestRounds; round += 1) {
    for (const model of [openaiModel, anthropicModel]) {
      const prompt = prompts[round % prompts.length]!;
      const response = await run.runInContext(() => client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature: 0
      }));
      const cost = Number(response.usage?.cost ?? 0);
      combinedCost = Number((combinedCost + cost).toFixed(8));
      results.push(response);

      if (combinedCost > budgetUSD) {
        throw new Error(`OpenRouter budget exceeded: $${combinedCost} > $${budgetUSD}`);
      }
    }
  }

  run.end({
    output: {
      requestedModels: [openaiModel, anthropicModel],
      responseModels: results.map((result) => result.model),
      requestCount: results.length,
      combinedCost
    }
  });

  for (const result of results) {
    const usage = result.usage ?? {};
    console.log(JSON.stringify({
      model: result.model,
      content: result.choices?.[0]?.message?.content,
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      total_tokens: usage.total_tokens,
      cost_usd: usage.cost
    }, null, 2));
  }

  console.log(`Combined reported OpenRouter cost: $${combinedCost}`);
  console.log(`Requests: ${results.length}`);
  console.log(`Trace database: ${dbPath}`);
} catch (error) {
  run.fail(error);
  throw error;
} finally {
  prism.shutdown();
}