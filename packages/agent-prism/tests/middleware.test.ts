import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { createTracer, SqliteStorageAdapter, withAnthropic, withOpenAI, withOpenRouter, withPrism } from '../src/index.js';

describe('withOpenAI proxy middleware', () => {
  test('records usage and cost from SDK-shaped responses', async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'agent-prism-')), 'trace.db');
    const lens = createTracer({ dbPath, onError: 'throw' });
    const run = lens.startRun('writer-agent');
    const client = withOpenAI({
      chat: {
        completions: {
          create: async (_request: { model: string }) => ({ model: 'gpt-4o', usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 }, choices: [{ message: { content: 'hi' } }] })
        }
      }
    }, lens);

    await run.runInContext(() => client.chat.completions.create({ model: 'gpt-4o' }));
    run.end();
    lens.shutdown();

    const storage = new SqliteStorageAdapter(dbPath);
    storage.init();
    const modelCalls = storage.getModelCallsByRunIds([run.id]);
    expect(modelCalls).toHaveLength(1);
    expect(modelCalls[0]!.tokens.total).toBe(1500);
    expect(modelCalls[0]!.costUSD).toBeGreaterThan(0);
    storage.close();
  });

  test('records Anthropic SDK-shaped message responses', async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'agent-prism-')), 'trace.db');
    const lens = createTracer({ dbPath, onError: 'throw' });
    const run = lens.startRun('research-agent');
    const client = withAnthropic({
      messages: {
        create: async (_request: { model: string }) => ({ model: 'claude-3-haiku', usage: { input_tokens: 120, output_tokens: 30 }, content: [{ type: 'text', text: 'ok' }] })
      }
    }, lens);

    await run.runInContext(() => client.messages.create({ model: 'claude-3-haiku' }));
    run.end();
    lens.shutdown();

    const storage = new SqliteStorageAdapter(dbPath);
    storage.init();
    const modelCalls = storage.getModelCallsByRunIds([run.id]);
    expect(modelCalls).toHaveLength(1);
    expect(modelCalls[0]!.provider).toBe('anthropic');
    expect(modelCalls[0]!.tokens.total).toBe(150);
    expect(modelCalls[0]!.costUSD).toBeGreaterThan(0);
    storage.close();
  });

  test('preserves OpenRouter reported cost through the OpenAI-compatible API', async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'agent-prism-')), 'trace.db');
    const lens = createTracer({ dbPath, onError: 'throw' });
    const run = lens.startRun('router-agent');
    const client = withOpenRouter({
      chat: {
        completions: {
          create: async (_request: { model: string }) => ({ model: 'openai/gpt-4.1-nano', usage: { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50, cost: 0.000009 }, choices: [{ message: { content: 'ok' } }] })
        }
      }
    }, lens);

    await run.runInContext(() => client.chat.completions.create({ model: 'openai/gpt-4.1-nano' }));
    run.end();
    lens.shutdown();

    const storage = new SqliteStorageAdapter(dbPath);
    storage.init();
    const modelCalls = storage.getModelCallsByRunIds([run.id]);
    expect(modelCalls).toHaveLength(1);
    expect(modelCalls[0]!.provider).toBe('openrouter');
    expect(modelCalls[0]!.costUSD).toBe(0.000009);
    storage.close();
  });

  test('auto-detects OpenRouter when usage.cost is present in generic middleware', async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'agent-prism-')), 'trace.db');
    const lens = createTracer({ dbPath, onError: 'throw' });
    const run = lens.startRun('generic-router-agent');
    const client = withPrism({
      chat: {
        completions: {
          create: async (_request: { model: string }) => ({ model: 'anthropic/claude-3-haiku', usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70, cost: 0.00002 }, choices: [{ message: { content: 'ok' } }] })
        }
      }
    }, lens);

    await run.runInContext(() => client.chat.completions.create({ model: 'anthropic/claude-3-haiku' }));
    run.end();
    lens.shutdown();

    const storage = new SqliteStorageAdapter(dbPath);
    storage.init();
    const modelCalls = storage.getModelCallsByRunIds([run.id]);
    expect(modelCalls[0]!.provider).toBe('openrouter');
    expect(modelCalls[0]!.costUSD).toBe(0.00002);
    storage.close();
  });
});