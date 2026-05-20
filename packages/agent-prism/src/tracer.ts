import { CostCalculator } from './cost.js';
import { TraceContext } from './context.js';
import { SqliteStorageAdapter } from './storage/sqlite.js';
import { PostgresStorageAdapter } from './storage/postgres.js';
import type {
  AgentRun,
  CostModel,
  EndRunOptions,
  LogParser,
  ModelCall,
  OnErrorMode,
  RecordModelCallInput,
  RecordToolCallInput,
  Session,
  StartRunOptions,
  StorageAdapter,
  TokenUsage,
  ToolCall,
  ToolCallOptions,
  TraceStatus,
  TracerOptions,
  WrapOptions
} from './types.js';
import { createId } from './utils/id.js';
import { normalizeTokens } from './utils/json.js';

type AnyFunction = (...args: any[]) => any;

export class AgentRunHandle {
  constructor(private readonly tracer: Tracer, readonly id: string, readonly sessionId: string) {}

  toolCall<T>(toolName: string, input: unknown, callback: () => T, options: Omit<ToolCallOptions, 'runId' | 'input'> = {}): T {
    return this.tracer.toolCall(toolName, { ...options, runId: this.id, input }, callback);
  }

  recordToolCall(input: Omit<RecordToolCallInput, 'runId'>): void {
    this.tracer.recordToolCall({ ...input, runId: this.id });
  }

  recordModelCall(input: Omit<RecordModelCallInput, 'runId'>): void {
    this.tracer.recordModelCall({ ...input, runId: this.id });
  }

  startChild(agentName: string, options: Omit<StartRunOptions, 'sessionId' | 'parentRunId' | 'triggeredBy'> = {}): AgentRunHandle {
    return this.tracer.startRun(agentName, {
      ...options,
      sessionId: this.sessionId,
      parentRunId: this.id,
      triggeredBy: 'agent'
    });
  }

  runInContext<T>(callback: () => T): T {
    return this.tracer.withActiveRun(this.id, this.sessionId, callback);
  }

  end(options: EndRunOptions = {}): void {
    this.tracer.endRun(this, options);
  }

  fail(error: unknown): void {
    this.tracer.failRun(this, error);
  }
}

export class Tracer {
  readonly storage: StorageAdapter;
  readonly context = new TraceContext();
  readonly cost: CostCalculator;
  readonly parsers: LogParser[];
  private readonly onError: OnErrorMode;
  private readonly serviceName: string;
  private readonly maxDbSizeBytes?: number;

  constructor(options: TracerOptions = {}) {
    this.storage = resolveStorage(options);
    this.cost = new CostCalculator(options.models);
    this.parsers = (options.parsers ?? []).filter((parser): parser is LogParser => typeof parser === 'object');
    this.onError = options.onError ?? 'warn';
    this.serviceName = options.serviceName ?? 'agent-prism';
    this.maxDbSizeBytes = options.maxDbSizeBytes;
    this.safeStorage('initialize storage', () => this.storage.init());

    if (typeof process !== 'undefined' && process.once) {
      process.once('beforeExit', () => {
        this.flush();
      });
    }
  }

  startRun(agentName: string, options: StartRunOptions = {}): AgentRunHandle {
    const active = this.context.get();
    const now = new Date();
    const sessionId = options.sessionId ?? active?.sessionId ?? createId('ses');
    const parentRunId = options.parentRunId ?? active?.runId;
    const run: AgentRun = {
      id: createId('run'),
      sessionId,
      agentName,
      parentRunId,
      triggeredBy: options.triggeredBy ?? (parentRunId ? 'agent' : 'human'),
      input: options.input,
      status: 'running',
      startedAt: now,
      toolCalls: [],
      modelCalls: [],
      agentCalls: [],
      tokens: normalizeTokens(),
      costUSD: 0,
      metadata: { serviceName: this.serviceName, ...(options.metadata ?? {}) }
    };
    const session: Session = {
      id: sessionId,
      name: options.sessionName ?? agentName,
      status: 'running',
      startedAt: now,
      totalTokens: normalizeTokens(),
      totalCostUSD: 0,
      metadata: options.metadata
    };

    this.safeStorage('create session', () => this.storage.createSession(session));
    this.safeStorage('start run', () => this.storage.upsertAgentRun(run));
    return new AgentRunHandle(this, run.id, sessionId);
  }

  endRun(runOrHandle: AgentRunHandle | string, options: EndRunOptions = {}): void {
    const runId = typeof runOrHandle === 'string' ? runOrHandle : runOrHandle.id;
    const stored = this.readRun(runId);
    if (!stored) {
      this.handleTracingError(new Error(`Cannot end missing run ${runId}`), 'end run');
      return;
    }
    const endedAt = new Date();
    const explicitTokens = options.tokens ? normalizeTokens(options.tokens) : stored.tokens;
    const run: AgentRun = {
      ...stored,
      output: options.output,
      status: options.status ?? 'success',
      error: options.error ?? stored.error,
      errorStack: options.errorStack ?? stored.errorStack,
      endedAt,
      latencyMs: endedAt.getTime() - stored.startedAt.getTime(),
      tokens: explicitTokens,
      costUSD: options.costUSD ?? stored.costUSD,
      metadata: { ...(stored.metadata ?? {}), ...(options.metadata ?? {}) }
    };
    this.safeStorage('end run', () => this.storage.upsertAgentRun(run));
    this.safeStorage('refresh session', () => this.storage.refreshSession(run.sessionId));
    this.maybePrune();
  }

  failRun(runOrHandle: AgentRunHandle | string, error: unknown): void {
    this.endRun(runOrHandle, {
      status: 'failed',
      output: undefined,
      error: errorMessage(error),
      errorStack: errorStack(error),
      metadata: {
        failureCapturedAt: new Date().toISOString()
      }
    });
  }

  timeoutRun(runOrHandle: AgentRunHandle | string, error: unknown = 'Timed out'): void {
    const runId = typeof runOrHandle === 'string' ? runOrHandle : runOrHandle.id;
    const stored = this.readRun(runId);
    if (!stored) return;
    this.safeStorage('record run timeout', () => this.storage.upsertAgentRun({
      ...stored,
      status: 'timeout',
      error: errorMessage(error),
      errorStack: errorStack(error),
      endedAt: new Date(),
      latencyMs: Date.now() - stored.startedAt.getTime()
    }));
    this.safeStorage('refresh timeout session', () => this.storage.refreshSession(stored.sessionId));
  }

  wrap<T extends AnyFunction>(agentName: string, callback: T, options: WrapOptions = {}): T {
    const tracer = this;
    return function wrappedAgent(this: unknown, ...args: Parameters<T>) {
      const input = typeof options.input === 'function' ? options.input(args) : options.input ?? (args.length === 1 ? args[0] : args);
      const run = tracer.startRun(agentName, { ...options, input });

      const execute = () => callback.apply(this, args);
      const finish = (output: unknown) => {
        tracer.endRun(run, { output });
        return output;
      };
      const fail = (error: unknown) => {
        tracer.failRun(run, error);
        throw error;
      };

      try {
        const result = tracer.withActiveRun(run.id, run.sessionId, execute);
        if (isPromiseLike(result)) {
          return result.then(finish, fail);
        }
        return finish(result);
      } catch (error) {
        return fail(error);
      }
    } as T;
  }

  toolCall<T>(toolName: string, input: unknown, callback: () => T): T;
  toolCall<T>(toolName: string, options: ToolCallOptions, callback: () => T): T;
  toolCall<T>(toolName: string, inputOrOptions: unknown, callback: () => T): T {
    const options: ToolCallOptions = isToolCallOptions(inputOrOptions) ? inputOrOptions : { input: inputOrOptions };
    const active = this.context.get();
    const implicitRun = options.runId || active ? undefined : this.startRun(`tool:${toolName}`, { input: options.input, triggeredBy: 'human' });
    const runId = options.runId ?? active?.runId ?? implicitRun!.id;
    const sessionId = active?.sessionId ?? implicitRun?.sessionId ?? this.readRun(runId)?.sessionId;
    const startedAt = Date.now();
    const calledAt = new Date();
    const finish = (output: unknown) => {
      this.recordToolCall({
        ...options,
        runId,
        toolName,
        output,
        latencyMs: Date.now() - startedAt,
        status: 'success',
        calledAt
      });
      if (implicitRun) {
        this.endRun(implicitRun, { output });
      }
      return output;
    };
    const fail = (error: unknown) => {
      this.recordToolCall({
        ...options,
        runId,
        toolName,
        latencyMs: Date.now() - startedAt,
        status: 'failed',
        error: errorMessage(error),
        errorStack: errorStack(error),
        calledAt
      });
      if (implicitRun) {
        this.failRun(implicitRun, error);
      }
      throw error;
    };

    try {
      const result = sessionId ? this.withActiveRun(runId, sessionId, callback) : callback();
      if (isPromiseLike(result)) {
        return result.then(finish, fail) as T;
      }
      return finish(result) as T;
    } catch (error) {
      return fail(error) as T;
    }
  }

  recordToolCall(input: RecordToolCallInput): void {
    const active = this.context.get();
    const implicitRun = input.runId || active ? undefined : this.startRun(`tool:${input.toolName}`, { input: input.input, triggeredBy: 'human' });
    const call: ToolCall = {
      id: input.id ?? createId('tool'),
      runId: input.runId ?? active?.runId ?? implicitRun!.id,
      toolName: input.toolName,
      input: input.input,
      output: input.output,
      latencyMs: input.latencyMs ?? 0,
      tokens: normalizeTokens(input.tokens),
      costUSD: input.costUSD ?? 0,
      status: input.status ?? (input.error ? 'failed' : 'success'),
      error: input.error,
      errorStack: input.errorStack,
      calledAt: input.calledAt ?? new Date(),
      metadata: input.metadata
    };
    this.safeStorage('record tool call', () => this.storage.insertToolCall(call));
    if (implicitRun) {
      this.endRun(implicitRun, { output: input.output });
    }
  }

  recordModelCall(input: RecordModelCallInput): void {
    const active = this.context.get();
    const implicitRun = input.runId || active ? undefined : this.startRun(`model:${input.provider}`, { input: input.input, triggeredBy: 'human' });
    const tokens = normalizeTokens(input.tokens);
    const call: ModelCall = {
      id: input.id ?? createId('model'),
      runId: input.runId ?? active?.runId ?? implicitRun!.id,
      provider: input.provider,
      method: input.method,
      model: input.model,
      input: input.input,
      output: input.output,
      latencyMs: input.latencyMs ?? 0,
      tokens,
      costUSD: input.costUSD ?? this.cost.calculate(input.model, tokens),
      status: input.status ?? (input.error ? 'failed' : 'success'),
      error: input.error,
      errorStack: input.errorStack,
      calledAt: input.calledAt ?? new Date(),
      metadata: input.metadata
    };
    this.safeStorage('record model call', () => this.storage.insertModelCall(call));
    if (implicitRun) {
      this.endRun(implicitRun, { output: input.output });
    }
  }

  withActiveRun<T>(runId: string, sessionId: string, callback: () => T): T {
    return this.context.run({ runId, sessionId }, callback);
  }

  currentRunId(): string | undefined {
    return this.context.get()?.runId;
  }

  flush(): void {
    if (this.maxDbSizeBytes) {
      this.maybePrune();
    }
  }

  shutdown(): void {
    this.flush();
    this.safeStorage('close storage', () => this.storage.close());
  }

  private readRun(runId: string): AgentRun | undefined {
    try {
      return this.storage.getRun(runId) as AgentRun | undefined;
    } catch (error) {
      this.handleTracingError(error, 'read run');
      return undefined;
    }
  }

  private safeStorage(label: string, callback: () => unknown): void {
    try {
      const result = callback();
      if (isPromiseLike(result)) {
        result.catch((error: unknown) => this.handleTracingError(error, label));
      }
    } catch (error) {
      this.handleTracingError(error, label);
    }
  }

  private maybePrune(): void {
    const maxDbSizeBytes = this.maxDbSizeBytes;
    if (!maxDbSizeBytes || !this.storage.prune) {
      return;
    }
    this.safeStorage('prune database', () => this.storage.prune!(maxDbSizeBytes));
  }

  private handleTracingError(error: unknown, label: string): void {
    if (this.onError === 'silent') {
      return;
    }
    const wrapped = error instanceof Error ? error : new Error(String(error));
    wrapped.message = `Agent Prism ${label} failed: ${wrapped.message}`;
    if (this.onError === 'throw') {
      throw wrapped;
    }
    console.warn(wrapped.message);
  }
}

export function createTracer(options: TracerOptions = {}): Tracer {
  return new Tracer(options);
}

function resolveStorage(options: TracerOptions): StorageAdapter {
  const configured = options.storage;
  if (configured && typeof configured === 'object' && 'init' in configured) {
    return configured;
  }
  if (configured && typeof configured === 'object' && configured.type === 'postgres') {
    return new PostgresStorageAdapter(configured);
  }
  if (configured && typeof configured === 'object' && configured.type === 'sqlite') {
    return new SqliteStorageAdapter({ dbPath: configured.dbPath ?? options.dbPath, maxDbSizeBytes: configured.maxDbSizeBytes });
  }
  return new SqliteStorageAdapter({ dbPath: options.dbPath, maxDbSizeBytes: options.maxDbSizeBytes });
}

function isPromiseLike<T = unknown>(value: unknown): value is Promise<T> {
  return Boolean(value && typeof (value as Promise<T>).then === 'function');
}

function isToolCallOptions(value: unknown): value is ToolCallOptions {
  if (!value || typeof value !== 'object') {
    return false;
  }
  return ['runId', 'input', 'tokens', 'costUSD', 'metadata'].some((key) => key in value);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function errorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}

export type { CostModel, TokenUsage, TraceStatus };