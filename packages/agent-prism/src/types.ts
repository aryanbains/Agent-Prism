export type MaybePromise<T> = T | Promise<T>;

export type TriggeredBy = 'human' | 'agent' | 'scheduled';
export type TraceStatus = 'running' | 'success' | 'failed' | 'timeout';
export type OnErrorMode = 'throw' | 'warn' | 'silent';
export type ExportFormat = 'json' | 'csv';

export interface TokenUsage {
  input: number;
  output: number;
  cached?: number;
  total: number;
}

export interface CostModel {
  inputPer1M: number;
  outputPer1M: number;
  cachedPer1M?: number;
}

export interface Session {
  id: string;
  name?: string;
  status: TraceStatus;
  startedAt: Date;
  endedAt?: Date;
  latencyMs?: number;
  totalTokens: TokenUsage;
  totalCostUSD: number;
  metadata?: Record<string, unknown>;
}

export interface AgentRun {
  id: string;
  sessionId: string;
  agentName: string;
  parentRunId?: string;
  triggeredBy: TriggeredBy;
  input: unknown;
  output?: unknown;
  status: TraceStatus;
  error?: string;
  errorStack?: string;
  startedAt: Date;
  endedAt?: Date;
  latencyMs?: number;
  toolCalls: ToolCall[];
  modelCalls?: ModelCall[];
  agentCalls?: AgentRun[];
  tokens: TokenUsage;
  costUSD: number;
  metadata?: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  runId: string;
  toolName: string;
  input: unknown;
  output?: unknown;
  latencyMs: number;
  tokens?: TokenUsage;
  costUSD: number;
  status: Exclude<TraceStatus, 'running' | 'timeout'> | 'timeout';
  error?: string;
  errorStack?: string;
  calledAt: Date;
  metadata?: Record<string, unknown>;
}

export interface ModelCall {
  id: string;
  runId: string;
  provider: 'openai' | 'anthropic' | 'custom' | string;
  method: string;
  model?: string;
  input?: unknown;
  output?: unknown;
  latencyMs: number;
  tokens: TokenUsage;
  costUSD: number;
  status: Exclude<TraceStatus, 'running' | 'timeout'> | 'timeout';
  error?: string;
  errorStack?: string;
  calledAt: Date;
  metadata?: Record<string, unknown>;
}

export interface AgentRunTree extends AgentRun {
  children: AgentRunTree[];
  toolCalls: ToolCall[];
  modelCalls: ModelCall[];
}

export interface StartRunOptions {
  input?: unknown;
  sessionId?: string;
  parentRunId?: string;
  triggeredBy?: TriggeredBy;
  metadata?: Record<string, unknown>;
  sessionName?: string;
}

export interface EndRunOptions {
  output?: unknown;
  status?: TraceStatus;
  tokens?: Partial<TokenUsage>;
  costUSD?: number;
  metadata?: Record<string, unknown>;
}

export interface WrapOptions extends StartRunOptions {
  input?: unknown | ((args: unknown[]) => unknown);
}

export interface ToolCallOptions {
  runId?: string;
  input?: unknown;
  tokens?: Partial<TokenUsage>;
  costUSD?: number;
  metadata?: Record<string, unknown>;
}

export interface RecordToolCallInput extends ToolCallOptions {
  id?: string;
  toolName: string;
  output?: unknown;
  latencyMs?: number;
  status?: ToolCall['status'];
  error?: string;
  errorStack?: string;
  calledAt?: Date;
}

export interface RecordModelCallInput {
  id?: string;
  runId?: string;
  provider: ModelCall['provider'];
  method: string;
  model?: string;
  input?: unknown;
  output?: unknown;
  latencyMs?: number;
  tokens?: Partial<TokenUsage>;
  costUSD?: number;
  status?: ModelCall['status'];
  error?: string;
  errorStack?: string;
  calledAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface ExportFilter {
  sessionId?: string;
  from?: Date;
  to?: Date;
  status?: TraceStatus;
  format?: ExportFormat;
}

export interface CostStats {
  totalCostUSD: number;
  totalTokens: TokenUsage;
  costByAgent: Array<{ agentName: string; costUSD: number; runCount: number }>;
  costOverTime: Array<{ sessionId: string; startedAt: Date; costUSD: number }>;
  expensiveCalls: Array<{ id: string; kind: 'tool' | 'model'; name: string; costUSD: number; latencyMs: number; runId: string }>;
}

export interface AgentHealthRow {
  agentName: string;
  runCount: number;
  successRate: number;
  averageLatencyMs: number;
  p95LatencyMs: number;
  averageCostUSD: number;
  commonFailure?: string;
}

export interface HealthStats {
  agents: AgentHealthRow[];
  failures: Array<{ reason: string; count: number }>;
}

export interface ParserImportRecord {
  id: string;
  parserName: string;
  source: string;
  importedAt: Date;
  runCount: number;
  toolCallCount: number;
  metadata?: Record<string, unknown>;
}

export interface ParsedTraceEvent {
  session?: Partial<Session> & { id?: string };
  run?: Partial<AgentRun> & { agentName: string; id?: string };
  toolCall?: Partial<ToolCall> & { toolName: string; runId?: string; id?: string };
  modelCall?: Partial<ModelCall> & { provider: string; method: string; runId?: string; id?: string };
}

export interface ParserImportSummary {
  id: string;
  parserName: string;
  source: string;
  sessionId: string;
  runCount: number;
  toolCallCount: number;
  modelCallCount: number;
  skippedLineCount: number;
}

export interface LogParser {
  name: string;
  detect(line: string): boolean;
  parseLine(line: string): ParsedTraceEvent | undefined;
}

export interface StorageAdapter {
  readonly kind: string;
  readonly dbPath?: string;
  init(): MaybePromise<void>;
  close(): MaybePromise<void>;
  createSession(session: Session): MaybePromise<void>;
  upsertAgentRun(run: AgentRun): MaybePromise<void>;
  insertToolCall(call: ToolCall): MaybePromise<void>;
  insertModelCall(call: ModelCall): MaybePromise<void>;
  refreshSession(sessionId: string): MaybePromise<void>;
  listSessions(limit?: number): MaybePromise<Session[]>;
  getSession(sessionId: string): MaybePromise<Session | undefined>;
  getRunsBySession(sessionId: string): MaybePromise<AgentRun[]>;
  getRun(runId: string): MaybePromise<AgentRun | undefined>;
  getToolCallsByRunIds(runIds: string[]): MaybePromise<ToolCall[]>;
  getToolCall(callId: string): MaybePromise<ToolCall | undefined>;
  getModelCallsByRunIds(runIds: string[]): MaybePromise<ModelCall[]>;
  getModelCall(callId: string): MaybePromise<ModelCall | undefined>;
  getCostStats(): MaybePromise<CostStats>;
  getHealthStats(): MaybePromise<HealthStats>;
  exportTraces(filter?: ExportFilter): MaybePromise<{ sessions: Session[]; runs: AgentRun[]; toolCalls: ToolCall[]; modelCalls: ModelCall[] }>;
  getLatestUpdatedAt(): MaybePromise<Date | undefined>;
  recordParserImport(record: ParserImportRecord): MaybePromise<void>;
  prune?(maxDbSizeBytes: number): MaybePromise<number>;
}

export interface SqliteStorageOptions {
  type?: 'sqlite';
  dbPath?: string;
  maxDbSizeBytes?: number;
}

export interface PostgresStorageOptions {
  type: 'postgres';
  url: string;
}

export interface TracerOptions {
  storage?: 'sqlite' | SqliteStorageOptions | PostgresStorageOptions | StorageAdapter;
  dbPath?: string;
  models?: Record<string, CostModel>;
  autoDetectModels?: boolean;
  onError?: OnErrorMode;
  serviceName?: string;
  parsers?: Array<LogParser | 'hermes' | 'openclaw'>;
  maxDbSizeBytes?: number;
}

export interface MiddlewareOptions {
  provider?: 'openai' | 'anthropic' | 'custom' | string;
  recordInputs?: boolean;
  recordOutputs?: boolean;
}