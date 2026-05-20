import type {
  AgentRun,
  CostStats,
  ExportFilter,
  HealthStats,
  ModelCall,
  ParserImportRecord,
  PostgresStorageOptions,
  Session,
  StorageAdapter,
  ToolCall
} from '../types.js';

export class PostgresStorageAdapter implements StorageAdapter {
  readonly kind = 'postgres';
  private pool: any;

  constructor(private readonly options: PostgresStorageOptions) {}

  async init(): Promise<void> {
    const pg = await import('pg');
    this.pool = new pg.Pool({ connectionString: this.options.url });
    await this.pool.query('SELECT 1');
    throw new Error('PostgreSQL schema parity is scaffolded but not enabled in v0.1. Use SQLite for local zero-config tracing.');
  }

  async close(): Promise<void> { await this.pool?.end?.(); }
  createSession(_session: Session): void { throw unsupported(); }
  upsertAgentRun(_run: AgentRun): void { throw unsupported(); }
  insertToolCall(_call: ToolCall): void { throw unsupported(); }
  insertModelCall(_call: ModelCall): void { throw unsupported(); }
  refreshSession(_sessionId: string): void { throw unsupported(); }
  listSessions(_limit?: number): Session[] { throw unsupported(); }
  getSession(_sessionId: string): Session | undefined { throw unsupported(); }
  getRunsBySession(_sessionId: string): AgentRun[] { throw unsupported(); }
  getRun(_runId: string): AgentRun | undefined { throw unsupported(); }
  getToolCallsByRunIds(_runIds: string[]): ToolCall[] { throw unsupported(); }
  getToolCall(_callId: string): ToolCall | undefined { throw unsupported(); }
  getModelCallsByRunIds(_runIds: string[]): ModelCall[] { throw unsupported(); }
  getModelCall(_callId: string): ModelCall | undefined { throw unsupported(); }
  getCostStats(): CostStats { throw unsupported(); }
  getHealthStats(): HealthStats { throw unsupported(); }
  exportTraces(_filter?: ExportFilter): { sessions: Session[]; runs: AgentRun[]; toolCalls: ToolCall[]; modelCalls: ModelCall[] } { throw unsupported(); }
  getLatestUpdatedAt(): Date | undefined { throw unsupported(); }
  recordParserImport(_record: ParserImportRecord): void { throw unsupported(); }
}

function unsupported(): Error {
  return new Error('PostgreSQL storage is scaffolded for the adapter contract but not implemented in v0.1. Use SQLite or contribute the SQL parity layer.');
}