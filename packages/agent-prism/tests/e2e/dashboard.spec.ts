import { serve, type ServerType } from '@hono/node-server';
import { expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDashboardApp } from '../../src/server/app.js';
import { createTracer } from '../../src/tracer.js';

let server: ServerType;

test.beforeAll(async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'agent-prism-e2e-')), 'trace.db');
  const lens = createTracer({ dbPath, onError: 'throw' });
  const run = lens.startRun('orchestrator-agent', { input: { prompt: 'demo' }, sessionName: 'E2E demo' });
  await run.toolCall('classify_intent', { prompt: 'demo' }, async () => ({ intent: 'demo' }));
  run.recordModelCall({ provider: 'anthropic', method: 'messages.create', model: 'claude-sonnet-4-6', tokens: { input: 1000, output: 500 } });
  run.end({ output: { ok: true } });
  lens.shutdown();
  const { app } = createDashboardApp({ dbPath });
  server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 4242 });
});

test.afterAll(() => {
  server.close();
});

test('renders timeline, cost, inspector, and health views', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Agent Prism' })).toBeVisible();
  await expect(page.getByText('orchestrator-agent')).toBeVisible();
  await page.getByRole('button', { name: /Cost/ }).click();
  await expect(page.getByRole('heading', { name: 'Cost Dashboard' })).toBeVisible();
  await page.getByRole('button', { name: /Inspector/ }).click();
  await expect(page.getByRole('heading', { name: 'Input' })).toBeVisible({ timeout: 10_000 }).catch(async () => {
    await page.getByText('classify_intent').click();
    await expect(page.getByRole('heading', { name: 'Input' })).toBeVisible();
  });
  await page.getByRole('button', { name: /Health/ }).click();
  await expect(page.getByRole('heading', { name: 'Agent Health' })).toBeVisible();
});