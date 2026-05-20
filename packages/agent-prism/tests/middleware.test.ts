import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { createTracer, SqliteStorageAdapter, withOpenAI } from '../src/index.js';

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
});