import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { SqliteStorageAdapter } from '../storage/sqlite.js';
import type { StorageAdapter } from '../types.js';
import { buildRunTree, tracesToCsv } from './tree.js';

export interface DashboardAppOptions {
  storage?: StorageAdapter;
  dbPath?: string;
  dashboardDir?: string;
}

export function createDashboardApp(options: DashboardAppOptions = {}) {
  const storage = options.storage ?? new SqliteStorageAdapter(options.dbPath ?? './agent-prism.db');
  storage.init();
  const app = new Hono();
  const dashboardDir = options.dashboardDir ?? resolve(process.cwd(), 'dist/dashboard');

  app.use('/api/*', cors());

  app.get('/api/health', (context) => context.json({
    status: 'ok',
    version: '0.1.0',
    storage: storage.kind,
    dbPath: storage.dbPath
  }));

  app.get('/api/sessions', async (context) => {
    const limit = Number(context.req.query('limit') ?? 50);
    return context.json(await storage.listSessions(limit));
  });

  app.get('/api/sessions/:id', async (context) => {
    const session = await storage.getSession(context.req.param('id'));
    return session ? context.json(session) : context.json({ error: 'Session not found' }, 404);
  });

  app.get('/api/sessions/:id/tree', async (context) => {
    const sessionId = context.req.param('id');
    const session = await storage.getSession(sessionId);
    if (!session) {
      return context.json({ error: 'Session not found' }, 404);
    }
    const runs = await storage.getRunsBySession(sessionId);
    const runIds = runs.map((run) => run.id);
    const toolCalls = await storage.getToolCallsByRunIds(runIds);
    const modelCalls = await storage.getModelCallsByRunIds(runIds);
    return context.json({ session, tree: buildRunTree(runs, toolCalls, modelCalls), runs, toolCalls, modelCalls });
  });

  app.get('/api/runs/:id', async (context) => {
    const run = await storage.getRun(context.req.param('id'));
    return run ? context.json(run) : context.json({ error: 'Run not found' }, 404);
  });

  app.get('/api/tool-calls/:id', async (context) => {
    const call = await storage.getToolCall(context.req.param('id'));
    return call ? context.json(call) : context.json({ error: 'Tool call not found' }, 404);
  });

  app.get('/api/model-calls/:id', async (context) => {
    const call = await storage.getModelCall(context.req.param('id'));
    return call ? context.json(call) : context.json({ error: 'Model call not found' }, 404);
  });

  app.get('/api/stats/cost', async (context) => context.json(await storage.getCostStats()));
  app.get('/api/stats/health', async (context) => context.json(await storage.getHealthStats()));

  app.get('/api/export', async (context) => {
    const format = context.req.query('format') === 'csv' ? 'csv' : 'json';
    const exported = await storage.exportTraces({
      sessionId: context.req.query('sessionId'),
      status: context.req.query('status') as any,
      from: context.req.query('from') ? new Date(context.req.query('from')!) : undefined,
      to: context.req.query('to') ? new Date(context.req.query('to')!) : undefined,
      format
    });
    if (format === 'csv') {
      const rows = exported.runs.map((run) => ({
        type: 'run',
        id: run.id,
        sessionId: run.sessionId,
        name: run.agentName,
        status: run.status,
        latencyMs: run.latencyMs,
        costUSD: run.costUSD,
        startedAt: run.startedAt
      }));
      return context.text(tracesToCsv(rows), 200, { 'content-type': 'text/csv; charset=utf-8' });
    }
    return context.json(exported);
  });

  app.get('/api/stream', (context) => streamSSE(context, async (stream) => {
    let lastUpdate = await storage.getLatestUpdatedAt();
    await stream.writeSSE({ event: 'ready', data: JSON.stringify({ at: new Date().toISOString() }), id: 'ready' });
    for (;;) {
      const latest = await storage.getLatestUpdatedAt();
      if (latest && (!lastUpdate || latest > lastUpdate)) {
        lastUpdate = latest;
        await stream.writeSSE({ event: 'trace-update', data: JSON.stringify({ updatedAt: latest.toISOString() }), id: latest.getTime().toString() });
      }
      await stream.sleep(1000);
    }
  }));

  app.get('*', (context) => {
    const requestPath = new URL(context.req.url).pathname;
    const staticPath = requestPath === '/' ? 'index.html' : requestPath.slice(1);
    const filePath = resolve(join(dashboardDir, staticPath));
    const fallback = resolve(join(dashboardDir, 'index.html'));
    const target = existsSync(filePath) ? filePath : fallback;
    if (!existsSync(target)) {
      return context.html(renderMissingDashboard(), 200);
    }
    return new Response(readFileSync(target), { headers: { 'content-type': contentType(target) } });
  });

  return { app, storage };
}

function contentType(filePath: string): string {
  switch (extname(filePath)) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'text/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.json': return 'application/json';
    default: return 'application/octet-stream';
  }
}

function renderMissingDashboard(): string {
  return `<!doctype html><html><head><title>Agent Prism</title><style>body{font-family:system-ui;margin:48px;line-height:1.5;color:#17202a}code{background:#eef2f6;padding:2px 6px;border-radius:4px}</style></head><body><h1>Agent Prism dashboard assets are not built yet.</h1><p>Run <code>npm run build</code> from the workspace root, then start <code>agent-prism dashboard</code> again.</p></body></html>`;
}