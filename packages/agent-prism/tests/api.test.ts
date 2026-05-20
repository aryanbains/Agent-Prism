import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { createDashboardApp } from '../src/server/app.js';
import { createTracer } from '../src/tracer.js';

async function seed(dbPath: string) {
  const lens = createTracer({ dbPath, onError: 'throw' });
  const run = lens.startRun('orchestrator', { input: 'start' });
  await run.toolCall('classify_intent', { text: 'hello' }, async () => ({ intent: 'support' }));
  run.recordModelCall({ provider: 'openai', method: 'chat.completions.create', model: 'gpt-4o-mini', tokens: { input: 100, output: 40 } });
  run.end({ output: 'done' });
  lens.shutdown();
}

describe('dashboard API', () => {
  test('serves sessions, tree, stats, and export', async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'agent-prism-')), 'trace.db');
    await seed(dbPath);
    const { app, storage } = createDashboardApp({ dbPath });

    const health = await app.request('/api/health');
    expect(health.status).toBe(200);
    const sessions = await (await app.request('/api/sessions')).json() as Array<{ id: string }>;
    expect(sessions).toHaveLength(1);
    const tree = await (await app.request(`/api/sessions/${sessions[0]!.id}/tree`)).json() as any;
    expect(tree.tree[0].toolCalls[0].toolName).toBe('classify_intent');
    expect((await app.request('/api/stats/cost')).status).toBe(200);
    expect((await app.request('/api/stats/health')).status).toBe(200);
    expect((await app.request('/api/export?format=csv')).headers.get('content-type')).toContain('text/csv');
    storage.close();
  });
});