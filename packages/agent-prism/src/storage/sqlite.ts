import Database from 'better-sqlite3';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type {
  AgentHealthRow,
  AgentRun,
  CostStats,
  ExportFilter,
  HealthStats,
  ModelCall,
  ParserImportRecord,
  Session,
  SqliteStorageOptions,
  StorageAdapter,
  TokenUsage,
  ToolCall,
  TraceStatus
} from '../types.js';
import { deserializeJson, fromIso, normalizeTokens, serializeJson, toIso } from '../utils/json.js';
import { SQLITE_MIGRATIONS } from './schema.js';

type Row = Record<string, any>;

export class SqliteStorageAdapter implements StorageAdapter {
  readonly kind = 'sqlite';
  readonly dbPath: string;
  private database?: Database.Database;

  constructor(options: SqliteStorageOptions | string = {}) {
    this.dbPath = resolve(typeof options === 'string' ? options : options.dbPath ?? './agent-prism.db');
  }

  init(): void {
    if (this.database) {
      return;
    }

    const folder = dirname(this.dbPath);
    if (folder && folder !== '.' && !existsSync(folder)) {
      mkdirSync(folder, { recursive: true });
    }

    this.database = new Database(this.dbPath);
    this.database.pragma('journal_mode = WAL');
    this.database.pragma('synchronous = NORMAL');
    this.database.pragma('foreign_keys = ON');
    this.migrate();
  }

  close(): void {
    this.database?.close();
    this.database = undefined;
  }

  createSession(session: Session): void {
    const tokens = normalizeTokens(session.totalTokens);
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO sessions (
      id, name, status, started_at, ended_at, latency_ms,
      total_tokens_input, total_tokens_output, total_tokens_cached, total_tokens_total,
      total_cost_usd, metadata_json, created_at, updated_at
    ) VALUES (@id, @name, @status, @startedAt, @endedAt, @latencyMs,
      @input, @output, @cached, @total, @cost, @metadata, @createdAt, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      name = COALESCE(excluded.name, sessions.name),
      status = excluded.status,
      updated_at = excluded.updated_at`).run({
      id: session.id,
      name: session.name,
      status: session.status,
      startedAt: toIso(session.startedAt),
      endedAt: toIso(session.endedAt),
      latencyMs: session.latencyMs,
      input: tokens.input,
      output: tokens.output,
      cached: tokens.cached ?? 0,
      total: tokens.total,
      cost: session.totalCostUSD,
      metadata: serializeJson(session.metadata ?? {}),
      createdAt: now,
      updatedAt: now
    });
  }

  upsertAgentRun(run: AgentRun): void {
    const tokens = normalizeTokens(run.tokens);
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO agent_runs (
      id, session_id, agent_name, parent_run_id, triggered_by, input_json, output_json,
      status, error, error_stack, started_at, ended_at, latency_ms,
      tokens_input, tokens_output, tokens_cached, tokens_total, cost_usd, metadata_json,
      created_at, updated_at
    ) VALUES (@id, @sessionId, @agentName, @parentRunId, @triggeredBy, @inputJson, @outputJson,
      @status, @error, @errorStack, @startedAt, @endedAt, @latencyMs,
      @input, @output, @cached, @total, @cost, @metadata, @createdAt, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      output_json = excluded.output_json,
      status = excluded.status,
      error = excluded.error,
      error_stack = excluded.error_stack,
      ended_at = excluded.ended_at,
      latency_ms = excluded.latency_ms,
      tokens_input = excluded.tokens_input,
      tokens_output = excluded.tokens_output,
      tokens_cached = excluded.tokens_cached,
      tokens_total = excluded.tokens_total,
      cost_usd = excluded.cost_usd,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at`).run({
      id: run.id,
      sessionId: run.sessionId,
      agentName: run.agentName,
      parentRunId: run.parentRunId,
      triggeredBy: run.triggeredBy,
      inputJson: serializeJson(run.input),
      outputJson: serializeJson(run.output),
      status: run.status,
      error: run.error,
      errorStack: run.errorStack,
      startedAt: toIso(run.startedAt),
      endedAt: toIso(run.endedAt),
      latencyMs: run.latencyMs,
      input: tokens.input,
      output: tokens.output,
      cached: tokens.cached ?? 0,
      total: tokens.total,
      cost: run.costUSD,
      metadata: serializeJson(run.metadata ?? {}),
      createdAt: now,
      updatedAt: now
    });
  }

  insertToolCall(call: ToolCall): void {
    const tokens = normalizeTokens(call.tokens);
    const now = new Date().toISOString();
    this.db.prepare(`INSERT OR REPLACE INTO tool_calls (
      id, run_id, tool_name, input_json, output_json, latency_ms,
      tokens_input, tokens_output, tokens_cached, tokens_total, cost_usd,
      status, error, error_stack, called_at, metadata_json, created_at, updated_at
    ) VALUES (@id, @runId, @toolName, @inputJson, @outputJson, @latencyMs,
      @input, @output, @cached, @total, @cost, @status, @error, @errorStack,
      @calledAt, @metadata, @createdAt, @updatedAt)`).run({
      id: call.id,
      runId: call.runId,
      toolName: call.toolName,
      inputJson: serializeJson(call.input),
      outputJson: serializeJson(call.output),
      latencyMs: call.latencyMs,
      input: tokens.input,
      output: tokens.output,
      cached: tokens.cached ?? 0,
      total: tokens.total,
      cost: call.costUSD,
      status: call.status,
      error: call.error,
      errorStack: call.errorStack,
      calledAt: toIso(call.calledAt),
      metadata: serializeJson(call.metadata ?? {}),
      createdAt: now,
      updatedAt: now
    });
    this.refreshRunTotals(call.runId);
  }

  insertModelCall(call: ModelCall): void {
    const tokens = normalizeTokens(call.tokens);
    const now = new Date().toISOString();
    this.db.prepare(`INSERT OR REPLACE INTO model_calls (
      id, run_id, provider, method, model, input_json, output_json, latency_ms,
      tokens_input, tokens_output, tokens_cached, tokens_total, cost_usd,
      status, error, error_stack, called_at, metadata_json, created_at, updated_at
    ) VALUES (@id, @runId, @provider, @method, @model, @inputJson, @outputJson, @latencyMs,
      @input, @output, @cached, @total, @cost, @status, @error, @errorStack,
      @calledAt, @metadata, @createdAt, @updatedAt)`).run({
      id: call.id,
      runId: call.runId,
      provider: call.provider,
      method: call.method,
      model: call.model,
      inputJson: serializeJson(call.input),
      outputJson: serializeJson(call.output),
      latencyMs: call.latencyMs,
      input: tokens.input,
      output: tokens.output,
      cached: tokens.cached ?? 0,
      total: tokens.total,
      cost: call.costUSD,
      status: call.status,
      error: call.error,
      errorStack: call.errorStack,
      calledAt: toIso(call.calledAt),
      metadata: serializeJson(call.metadata ?? {}),
      createdAt: now,
      updatedAt: now
    });
    this.refreshRunTotals(call.runId);
  }

  refreshSession(sessionId: string): void {
    const summary = this.db.prepare(`SELECT
      COALESCE(SUM(tokens_input), 0) AS input,
      COALESCE(SUM(tokens_output), 0) AS output,
      COALESCE(SUM(tokens_cached), 0) AS cached,
      COALESCE(SUM(tokens_total), 0) AS total,
      COALESCE(SUM(cost_usd), 0) AS cost,
      MIN(started_at) AS started_at,
      MAX(ended_at) AS ended_at,
      SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status = 'timeout' THEN 1 ELSE 0 END) AS timeout
      FROM agent_runs WHERE session_id = ?`).get(sessionId) as Row;
    const status: TraceStatus = summary.running > 0 ? 'running' : summary.failed > 0 ? 'failed' : summary.timeout > 0 ? 'timeout' : 'success';
    const startedAt = summary.started_at ? new Date(summary.started_at).getTime() : undefined;
    const endedAt = summary.ended_at ? new Date(summary.ended_at).getTime() : undefined;
    this.db.prepare(`UPDATE sessions SET
      status = ?, ended_at = ?, latency_ms = ?, total_tokens_input = ?, total_tokens_output = ?,
      total_tokens_cached = ?, total_tokens_total = ?, total_cost_usd = ?, updated_at = ?
      WHERE id = ?`).run(
      status,
      status === 'running' ? undefined : summary.ended_at,
      startedAt && endedAt ? endedAt - startedAt : undefined,
      summary.input,
      summary.output,
      summary.cached,
      summary.total,
      summary.cost,
      new Date().toISOString(),
      sessionId
    );
  }

  listSessions(limit = 50): Session[] {
    return (this.db.prepare('SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?').all(limit) as Row[]).map(mapSession);
  }

  getSession(sessionId: string): Session | undefined {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as Row | undefined;
    return row ? mapSession(row) : undefined;
  }

  getRunsBySession(sessionId: string): AgentRun[] {
    return (this.db.prepare('SELECT * FROM agent_runs WHERE session_id = ? ORDER BY started_at ASC').all(sessionId) as Row[]).map(mapRun);
  }

  getRun(runId: string): AgentRun | undefined {
    const row = this.db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(runId) as Row | undefined;
    return row ? mapRun(row) : undefined;
  }

  getToolCallsByRunIds(runIds: string[]): ToolCall[] {
    if (runIds.length === 0) {
      return [];
    }
    const placeholders = runIds.map(() => '?').join(',');
    return (this.db.prepare(`SELECT * FROM tool_calls WHERE run_id IN (${placeholders}) ORDER BY called_at ASC`).all(...runIds) as Row[]).map(mapToolCall);
  }

  getToolCall(callId: string): ToolCall | undefined {
    const row = this.db.prepare('SELECT * FROM tool_calls WHERE id = ?').get(callId) as Row | undefined;
    return row ? mapToolCall(row) : undefined;
  }

  getModelCallsByRunIds(runIds: string[]): ModelCall[] {
    if (runIds.length === 0) {
      return [];
    }
    const placeholders = runIds.map(() => '?').join(',');
    return (this.db.prepare(`SELECT * FROM model_calls WHERE run_id IN (${placeholders}) ORDER BY called_at ASC`).all(...runIds) as Row[]).map(mapModelCall);
  }

  getModelCall(callId: string): ModelCall | undefined {
    const row = this.db.prepare('SELECT * FROM model_calls WHERE id = ?').get(callId) as Row | undefined;
    return row ? mapModelCall(row) : undefined;
  }

  getCostStats(): CostStats {
    const sessions = this.listSessions(500);
    const costByAgent = this.db.prepare(`SELECT agent_name AS agentName, COALESCE(SUM(cost_usd), 0) AS costUSD, COUNT(*) AS runCount
      FROM agent_runs GROUP BY agent_name ORDER BY costUSD DESC`).all() as Array<{ agentName: string; costUSD: number; runCount: number }>;
    const expensiveTools = this.db.prepare(`SELECT id, 'tool' AS kind, tool_name AS name, cost_usd AS costUSD, latency_ms AS latencyMs, run_id AS runId
      FROM tool_calls ORDER BY cost_usd DESC, latency_ms DESC LIMIT 10`).all() as CostStats['expensiveCalls'];
    const expensiveModels = this.db.prepare(`SELECT id, 'model' AS kind, COALESCE(model, method) AS name, cost_usd AS costUSD, latency_ms AS latencyMs, run_id AS runId
      FROM model_calls ORDER BY cost_usd DESC, latency_ms DESC LIMIT 10`).all() as CostStats['expensiveCalls'];
    const totalTokens = sessions.reduce<TokenUsage>((acc, session) => ({
      input: acc.input + session.totalTokens.input,
      output: acc.output + session.totalTokens.output,
      cached: (acc.cached ?? 0) + (session.totalTokens.cached ?? 0),
      total: acc.total + session.totalTokens.total
    }), { input: 0, output: 0, cached: 0, total: 0 });
    return {
      totalCostUSD: Number(sessions.reduce((sum, session) => sum + session.totalCostUSD, 0).toFixed(8)),
      totalTokens,
      costByAgent,
      costOverTime: sessions.map((session) => ({ sessionId: session.id, startedAt: session.startedAt, costUSD: session.totalCostUSD })).reverse(),
      expensiveCalls: [...expensiveTools, ...expensiveModels].sort((a, b) => b.costUSD - a.costUSD).slice(0, 10)
    };
  }

  getHealthStats(): HealthStats {
    const rows = this.db.prepare(`SELECT agent_name AS agentName,
      COUNT(*) AS runCount,
      AVG(CASE WHEN status = 'success' THEN 1.0 ELSE 0.0 END) AS successRate,
      AVG(COALESCE(latency_ms, 0)) AS averageLatencyMs,
      AVG(cost_usd) AS averageCostUSD
      FROM agent_runs GROUP BY agent_name ORDER BY runCount DESC`).all() as AgentHealthRow[];
    const failures = this.db.prepare(`SELECT COALESCE(error, 'Unknown failure') AS reason, COUNT(*) AS count
      FROM agent_runs WHERE status IN ('failed', 'timeout') GROUP BY reason ORDER BY count DESC LIMIT 10`).all() as HealthStats['failures'];
    const agents = rows.map((row) => {
      const latencies = (this.db.prepare('SELECT latency_ms FROM agent_runs WHERE agent_name = ? AND latency_ms IS NOT NULL ORDER BY latency_ms ASC').all(row.agentName) as Row[]).map((item) => Number(item.latency_ms));
      const p95Index = latencies.length > 0 ? Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1) : 0;
      const commonFailure = this.db.prepare(`SELECT error FROM agent_runs WHERE agent_name = ? AND error IS NOT NULL GROUP BY error ORDER BY COUNT(*) DESC LIMIT 1`).get(row.agentName) as Row | undefined;
      return {
        ...row,
        successRate: Number(row.successRate ?? 0),
        averageLatencyMs: Math.round(Number(row.averageLatencyMs ?? 0)),
        p95LatencyMs: latencies[p95Index] ?? 0,
        averageCostUSD: Number(Number(row.averageCostUSD ?? 0).toFixed(8)),
        commonFailure: commonFailure?.error
      };
    });
    return { agents, failures };
  }

  exportTraces(filter: ExportFilter = {}) {
    const sessions = filter.sessionId ? [this.getSession(filter.sessionId)].filter(Boolean) as Session[] : this.listSessions(10_000);
    const filteredSessions = sessions.filter((session) => {
      if (filter.status && session.status !== filter.status) return false;
      if (filter.from && session.startedAt < filter.from) return false;
      if (filter.to && session.startedAt > filter.to) return false;
      return true;
    });
    const runs = filteredSessions.flatMap((session) => this.getRunsBySession(session.id));
    const runIds = runs.map((run) => run.id);
    return {
      sessions: filteredSessions,
      runs,
      toolCalls: this.getToolCallsByRunIds(runIds),
      modelCalls: this.getModelCallsByRunIds(runIds)
    };
  }

  getLatestUpdatedAt(): Date | undefined {
    const row = this.db.prepare(`SELECT MAX(updated_at) AS updated_at FROM (
      SELECT updated_at FROM sessions UNION ALL SELECT updated_at FROM agent_runs
      UNION ALL SELECT updated_at FROM tool_calls UNION ALL SELECT updated_at FROM model_calls
    )`).get() as Row | undefined;
    return fromIso(row?.updated_at);
  }

  recordParserImport(record: ParserImportRecord): void {
    this.db.prepare(`INSERT OR REPLACE INTO parser_imports (id, parser_name, source, imported_at, run_count, tool_call_count, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      record.id,
      record.parserName,
      record.source,
      toIso(record.importedAt),
      record.runCount,
      record.toolCallCount,
      serializeJson(record.metadata ?? {})
    );
  }

  prune(maxDbSizeBytes: number): number {
    if (!existsSync(this.dbPath) || statSync(this.dbPath).size <= maxDbSizeBytes) {
      return 0;
    }
    const deleted = this.db.prepare(`DELETE FROM sessions WHERE id IN (
      SELECT id FROM sessions ORDER BY started_at ASC LIMIT 10
    )`).run().changes;
    this.db.pragma('wal_checkpoint(TRUNCATE)');
    this.db.prepare('VACUUM').run();
    return deleted;
  }

  private refreshRunTotals(runId: string): void {
    const summary = this.db.prepare(`SELECT
      COALESCE((SELECT SUM(tokens_input) FROM tool_calls WHERE run_id = @runId), 0) + COALESCE((SELECT SUM(tokens_input) FROM model_calls WHERE run_id = @runId), 0) AS input,
      COALESCE((SELECT SUM(tokens_output) FROM tool_calls WHERE run_id = @runId), 0) + COALESCE((SELECT SUM(tokens_output) FROM model_calls WHERE run_id = @runId), 0) AS output,
      COALESCE((SELECT SUM(tokens_cached) FROM tool_calls WHERE run_id = @runId), 0) + COALESCE((SELECT SUM(tokens_cached) FROM model_calls WHERE run_id = @runId), 0) AS cached,
      COALESCE((SELECT SUM(tokens_total) FROM tool_calls WHERE run_id = @runId), 0) + COALESCE((SELECT SUM(tokens_total) FROM model_calls WHERE run_id = @runId), 0) AS total,
      COALESCE((SELECT SUM(cost_usd) FROM tool_calls WHERE run_id = @runId), 0) + COALESCE((SELECT SUM(cost_usd) FROM model_calls WHERE run_id = @runId), 0) AS cost`).get({ runId }) as Row;
    this.db.prepare(`UPDATE agent_runs SET tokens_input = ?, tokens_output = ?, tokens_cached = ?, tokens_total = ?, cost_usd = ?, updated_at = ? WHERE id = ?`).run(
      summary.input,
      summary.output,
      summary.cached,
      summary.total,
      summary.cost,
      new Date().toISOString(),
      runId
    );
    const run = this.getRun(runId);
    if (run) {
      this.refreshSession(run.sessionId);
    }
  }

  private migrate(): void {
    const db = this.db;
    db.prepare(SQLITE_MIGRATIONS[0]!.statements[0]!).run();
    for (const migration of SQLITE_MIGRATIONS) {
      const applied = db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(migration.version);
      if (applied) {
        continue;
      }
      const apply = db.transaction(() => {
        for (const statement of migration.statements) {
          db.prepare(statement).run();
        }
        db.prepare('INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(migration.version, new Date().toISOString());
      });
      apply();
    }
  }

  private get db(): Database.Database {
    if (!this.database) {
      this.init();
    }
    return this.database!;
  }
}

function mapTokens(row: Row, prefix = ''): TokenUsage {
  const input = Number(row[`${prefix}tokens_input`] ?? row[`${prefix}total_tokens_input`] ?? row.input ?? 0);
  const output = Number(row[`${prefix}tokens_output`] ?? row[`${prefix}total_tokens_output`] ?? row.output ?? 0);
  const cached = Number(row[`${prefix}tokens_cached`] ?? row[`${prefix}total_tokens_cached`] ?? row.cached ?? 0);
  const total = Number(row[`${prefix}tokens_total`] ?? row[`${prefix}total_tokens_total`] ?? row.total ?? input + output + cached);
  return cached > 0 ? { input, output, cached, total } : { input, output, total };
}

function mapSession(row: Row): Session {
  return {
    id: row.id,
    name: row.name ?? undefined,
    status: row.status,
    startedAt: fromIso(row.started_at) ?? new Date(),
    endedAt: fromIso(row.ended_at),
    latencyMs: row.latency_ms ?? undefined,
    totalTokens: mapTokens(row, 'total_'),
    totalCostUSD: Number(row.total_cost_usd ?? 0),
    metadata: deserializeJson<Record<string, unknown>>(row.metadata_json) ?? {}
  };
}

function mapRun(row: Row): AgentRun {
  return {
    id: row.id,
    sessionId: row.session_id,
    agentName: row.agent_name,
    parentRunId: row.parent_run_id ?? undefined,
    triggeredBy: row.triggered_by,
    input: deserializeJson(row.input_json),
    output: deserializeJson(row.output_json),
    status: row.status,
    error: row.error ?? undefined,
    errorStack: row.error_stack ?? undefined,
    startedAt: fromIso(row.started_at) ?? new Date(),
    endedAt: fromIso(row.ended_at),
    latencyMs: row.latency_ms ?? undefined,
    toolCalls: [],
    modelCalls: [],
    tokens: mapTokens(row),
    costUSD: Number(row.cost_usd ?? 0),
    metadata: deserializeJson<Record<string, unknown>>(row.metadata_json) ?? {}
  };
}

function mapToolCall(row: Row): ToolCall {
  return {
    id: row.id,
    runId: row.run_id,
    toolName: row.tool_name,
    input: deserializeJson(row.input_json),
    output: deserializeJson(row.output_json),
    latencyMs: Number(row.latency_ms ?? 0),
    tokens: mapTokens(row),
    costUSD: Number(row.cost_usd ?? 0),
    status: row.status,
    error: row.error ?? undefined,
    errorStack: row.error_stack ?? undefined,
    calledAt: fromIso(row.called_at) ?? new Date(),
    metadata: deserializeJson<Record<string, unknown>>(row.metadata_json) ?? {}
  };
}

function mapModelCall(row: Row): ModelCall {
  return {
    id: row.id,
    runId: row.run_id,
    provider: row.provider,
    method: row.method,
    model: row.model ?? undefined,
    input: deserializeJson(row.input_json),
    output: deserializeJson(row.output_json),
    latencyMs: Number(row.latency_ms ?? 0),
    tokens: mapTokens(row),
    costUSD: Number(row.cost_usd ?? 0),
    status: row.status,
    error: row.error ?? undefined,
    errorStack: row.error_stack ?? undefined,
    calledAt: fromIso(row.called_at) ?? new Date(),
    metadata: deserializeJson<Record<string, unknown>>(row.metadata_json) ?? {}
  };
}