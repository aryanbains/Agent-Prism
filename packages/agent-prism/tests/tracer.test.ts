import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { createTracer, SqliteStorageAdapter } from '../src/index.js';

function tempDb() {
  return join(mkdtempSync(join(tmpdir(), 'agent-prism-')), 'trace.db');
}

describe('Tracer', () => {
  test('wraps an async agent and records tool calls', async () => {
    const dbPath = tempDb();
    const lens = createTracer({ dbPath, onError: 'throw' });
    const traced = lens.wrap('sales-agent', async (input: { account: string }) => {
      const crm = await lens.toolCall('search_crm', { account: input.account }, async () => ({ tier: 'enterprise' }));
      return { crm };
    });

    await expect(traced({ account: 'acme' })).resolves.toEqual({ crm: { tier: 'enterprise' } });
    lens.shutdown();

    const storage = new SqliteStorageAdapter(dbPath);
    storage.init();
    const sessions = storage.listSessions();
    expect(sessions).toHaveLength(1);
    const runs = storage.getRunsBySession(sessions[0]!.id);
    expect(runs[0]!.agentName).toBe('sales-agent');
    expect(runs[0]!.status).toBe('success');
    expect(storage.getToolCallsByRunIds(runs.map((run) => run.id))[0]!.toolName).toBe('search_crm');
    storage.close();
  });

  test('records child agent linkage', () => {
    const dbPath = tempDb();
    const lens = createTracer({ dbPath, onError: 'throw' });
    const parent = lens.startRun('orchestrator', { input: 'go' });
    const child = parent.startChild('finance-agent', { input: 'budget' });
    child.end({ output: 'done' });
    parent.end({ output: 'final' });
    const storage = new SqliteStorageAdapter(dbPath);
    storage.init();
    const runs = storage.getRunsBySession(parent.sessionId);
    expect(runs.find((run) => run.agentName === 'finance-agent')?.parentRunId).toBe(parent.id);
    storage.close();
    lens.shutdown();
  });

  test('preserves scheduled runs as a first-class trigger type', () => {
    const dbPath = tempDb();
    const lens = createTracer({ dbPath, onError: 'throw' });
    const run = lens.startRun('nightly-sync', { triggeredBy: 'scheduled', input: { job: 'nightly' } });
    run.end({ output: { ok: true } });
    lens.shutdown();

    const storage = new SqliteStorageAdapter(dbPath);
    storage.init();
    const stored = storage.getRunsBySession(run.sessionId)[0];
    expect(stored?.triggeredBy).toBe('scheduled');
    storage.close();
  });

  test('failRun writes the failure reason in a single terminal update', () => {
    const runs = new Map<string, any>();
    const upserts: any[] = [];
    const refreshes: string[] = [];
    const storage = {
      kind: 'memory',
      init: () => undefined,
      close: () => undefined,
      createSession: () => undefined,
      upsertAgentRun: (run: any) => {
        runs.set(run.id, structuredClone(run));
        upserts.push(structuredClone(run));
      },
      insertToolCall: () => undefined,
      insertModelCall: () => undefined,
      refreshSession: (sessionId: string) => { refreshes.push(sessionId); },
      listSessions: () => [],
      getSession: () => undefined,
      getRunsBySession: () => [],
      getRun: (runId: string) => runs.get(runId),
      getToolCallsByRunIds: () => [],
      getToolCall: () => undefined,
      getModelCallsByRunIds: () => [],
      getModelCall: () => undefined,
      getCostStats: () => ({ totalCostUSD: 0, totalTokens: { input: 0, output: 0, total: 0 }, costByAgent: [], costOverTime: [], expensiveCalls: [] }),
      getHealthStats: () => ({ agents: [], failures: [] }),
      exportTraces: () => ({ sessions: [], runs: [], toolCalls: [], modelCalls: [] }),
      getLatestUpdatedAt: () => undefined,
      recordParserImport: () => undefined
    };
    const lens = createTracer({ storage, onError: 'throw' });
    const run = lens.startRun('fragile-agent', { input: { ok: false } });
    lens.failRun(run, new Error('boom'));

    expect(upserts).toHaveLength(2);
    expect(upserts[1]!.status).toBe('failed');
    expect(upserts[1]!.error).toBe('boom');
    expect(refreshes).toHaveLength(1);
  });

  test('onError warn does not break the wrapped function', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const brokenStorage = {
      kind: 'broken', init: () => undefined, close: () => undefined, createSession: () => { throw new Error('disk'); }, upsertAgentRun: () => undefined,
      insertToolCall: () => undefined, insertModelCall: () => undefined, refreshSession: () => undefined, listSessions: () => [], getSession: () => undefined,
      getRunsBySession: () => [], getRun: () => undefined, getToolCallsByRunIds: () => [], getToolCall: () => undefined, getModelCallsByRunIds: () => [],
      getModelCall: () => undefined, getCostStats: () => ({ totalCostUSD: 0, totalTokens: { input: 0, output: 0, total: 0 }, costByAgent: [], costOverTime: [], expensiveCalls: [] }),
      getHealthStats: () => ({ agents: [], failures: [] }), exportTraces: () => ({ sessions: [], runs: [], toolCalls: [], modelCalls: [] }), getLatestUpdatedAt: () => undefined,
      recordParserImport: () => undefined
    };
    const lens = createTracer({ storage: brokenStorage, onError: 'warn' });
    const traced = lens.wrap('safe-agent', async () => 'ok');
    await expect(traced()).resolves.toBe('ok');
    expect(warning).toHaveBeenCalled();
    warning.mockRestore();
  });
});