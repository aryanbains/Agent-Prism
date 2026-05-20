import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { HermesLogParser, importLogFile, OpenClawLogParser, SqliteStorageAdapter } from '../src/index.js';
import { createDashboardApp } from '../src/server/app.js';

describe('log parsers', () => {
  test('parses Hermes JSONL agent events', () => {
    const parser = new HermesLogParser();
    const event = parser.parseLine(JSON.stringify({ framework: 'hermes', agentName: 'browser-agent', status: 'success', latencyMs: 42 }));
    expect(event?.run?.agentName).toBe('browser-agent');
  });

  test('parses OpenClaw compact log events', () => {
    const parser = new OpenClawLogParser();
    const event = parser.parseLine('[success] planner-agent 87ms openclaw');
    expect(event?.run?.agentName).toBe('planner-agent');
  });

  test('imports Hermes JSONL runs, tools, and model calls into SQLite', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'agent-prism-'));
    const dbPath = join(folder, 'trace.db');
    const logPath = join(folder, 'hermes.jsonl');
    writeFileSync(logPath, [
      JSON.stringify({ framework: 'hermes', type: 'run', runId: 'run_hermes_root', sessionId: 'ses_hermes', agentName: 'hermes-orchestrator', status: 'success', latencyMs: 125, startedAt: '2026-05-20T10:00:00.000Z', endedAt: '2026-05-20T10:00:00.125Z' }),
      JSON.stringify({ framework: 'hermes', type: 'tool', runId: 'run_hermes_root', toolName: 'session_search', input: { query: 'invoice' }, output: { hits: 3 }, latencyMs: 40, calledAt: '2026-05-20T10:00:00.020Z' }),
      JSON.stringify({ framework: 'hermes', type: 'model', runId: 'run_hermes_root', provider: 'openrouter', method: 'chat.completions.create', model: 'anthropic/claude-3-haiku', usage: { input: 16, output: 7, total: 23 }, costUSD: 0.00001275 })
    ].join('\n'));

    const summary = importLogFile({ filePath: logPath, dbPath, parser: 'auto' });
    expect(summary.parserName).toBe('hermes');
    expect(summary.runCount).toBe(1);
    expect(summary.toolCallCount).toBe(1);
    expect(summary.modelCallCount).toBe(1);

    const storage = new SqliteStorageAdapter(dbPath);
    storage.init();
    const runs = storage.getRunsBySession('ses_hermes');
    expect(runs[0]!.agentName).toBe('hermes-orchestrator');
    expect(storage.getToolCallsByRunIds(['run_hermes_root'])[0]!.toolName).toBe('session_search');
    expect(storage.getModelCallsByRunIds(['run_hermes_root'])[0]!.tokens.total).toBe(23);
    storage.close();
  });

  test('imports OpenClaw nested events and serves them through the dashboard API', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'agent-prism-'));
    const dbPath = join(folder, 'trace.db');
    const logPath = join(folder, 'openclaw.jsonl');
    writeFileSync(logPath, [
      JSON.stringify({ framework: 'openclaw', type: 'run', runId: 'run_openclaw_root', sessionId: 'ses_openclaw', agentName: 'gateway-agent', status: 'success', latencyMs: 210 }),
      JSON.stringify({ framework: 'openclaw', type: 'run', runId: 'run_openclaw_child', sessionId: 'ses_openclaw', parentRunId: 'run_openclaw_root', agentName: 'calendar-agent', status: 'success', latencyMs: 88 }),
      JSON.stringify({ framework: 'openclaw', type: 'tool', runId: 'run_openclaw_child', toolName: 'sessions_send', input: { target: 'self' }, output: { ok: true }, latencyMs: 33 }),
      JSON.stringify({ framework: 'openclaw', type: 'model', runId: 'run_openclaw_child', provider: 'openrouter', method: 'chat.completions.create', model: 'openai/gpt-4.1-nano', usage: { prompt_tokens: 15, completion_tokens: 3, total_tokens: 18 }, cost_usd: 0.0000027 })
    ].join('\n'));

    const summary = importLogFile({ filePath: logPath, dbPath, parser: 'openclaw' });
    expect(summary.runCount).toBe(2);
    const { app, storage } = createDashboardApp({ dbPath });
    const tree = await (await app.request('/api/sessions/ses_openclaw/tree')).json() as any;
    expect(tree.tree[0].children[0].agentName).toBe('calendar-agent');
    expect(tree.tree[0].children[0].toolCalls[0].toolName).toBe('sessions_send');
    expect(tree.modelCalls[0].costUSD).toBe(0.0000027);
    expect(await storage.listSessions()).toHaveLength(1);
    storage.close();
  });

  test('imports real OpenClaw gateway JSON logs as operational runs', () => {
    const folder = mkdtempSync(join(tmpdir(), 'agent-prism-'));
    const dbPath = join(folder, 'trace.db');
    const summary = importLogFile({ filePath: join(process.cwd(), 'tests/fixtures/openclaw-gateway.jsonl'), dbPath, parser: 'openclaw' });
    expect(summary.runCount).toBe(2);

    const storage = new SqliteStorageAdapter(dbPath);
    storage.init();
    const runs = storage.listSessions().flatMap((session) => storage.getRunsBySession(session.id));
    expect(runs.map((run) => run.agentName)).toEqual(['openclaw:gateway/ws', 'openclaw:gateway/ws']);
    expect(runs[0]!.latencyMs).toBe(138);
    storage.close();
  });

  test('imports real Hermes agent logs as operational runs', () => {
    const folder = mkdtempSync(join(tmpdir(), 'agent-prism-'));
    const dbPath = join(folder, 'trace.db');
    const summary = importLogFile({ filePath: join(process.cwd(), 'tests/fixtures/hermes-agent-log.txt'), dbPath, parser: 'hermes' });
    expect(summary.runCount).toBe(4);

    const storage = new SqliteStorageAdapter(dbPath);
    storage.init();
    const runs = storage.listSessions().flatMap((session) => storage.getRunsBySession(session.id));
    expect(runs.map((run) => run.agentName)).toEqual(['hermes:plugins', 'hermes:plugins', 'hermes:auxiliary_client', 'hermes:auxiliary_client']);
    expect(runs[3]!.status).toBe('failed');
    storage.close();
  });
});