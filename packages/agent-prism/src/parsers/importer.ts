import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  AgentRun,
  LogParser,
  ModelCall,
  ParsedTraceEvent,
  ParserImportSummary,
  Session,
  StorageAdapter,
  ToolCall,
  TraceStatus,
  TriggeredBy
} from '../types.js';
import { createId } from '../utils/id.js';
import { normalizeTokens } from '../utils/json.js';
import { SqliteStorageAdapter } from '../storage/sqlite.js';
import { HermesLogParser } from './hermes.js';
import { OpenClawLogParser } from './openclaw.js';

export type BuiltInParserName = 'hermes' | 'openclaw';
export type ParserSelection = BuiltInParserName | 'auto' | LogParser;

export interface ImportLogTextOptions {
  parser: ParserSelection;
  text: string;
  source?: string;
  storage?: StorageAdapter;
  dbPath?: string;
  sessionId?: string;
  sessionName?: string;
  importId?: string;
}

export interface ImportLogFileOptions extends Omit<ImportLogTextOptions, 'text' | 'source'> {
  filePath: string;
  source?: string;
}

export function getBuiltInParser(name: BuiltInParserName): LogParser {
  return name === 'hermes' ? new HermesLogParser() : new OpenClawLogParser();
}

export function getBuiltInParsers(): LogParser[] {
  return [new HermesLogParser(), new OpenClawLogParser()];
}

export function importLogFile(options: ImportLogFileOptions): ParserImportSummary {
  const filePath = resolve(options.filePath);
  return importLogText({
    ...options,
    text: readFileSync(filePath, 'utf8'),
    source: options.source ?? filePath
  });
}

export function importLogText(options: ImportLogTextOptions): ParserImportSummary {
  const ownsStorage = !options.storage;
  const storage = options.storage ?? new SqliteStorageAdapter(options.dbPath ?? './agent-prism.db');
  storage.init();

  try {
    const lines = options.text.split(/\r?\n/);
    const explicitParser = options.parser !== 'auto';
    const parser = resolveParser(options.parser, lines);
    const importId = options.importId ?? createId('imp');
    const defaultSessionId = options.sessionId ?? createId('ses');
    const now = new Date();
    const source = options.source ?? 'inline';
    const sessionName = options.sessionName ?? `${parser.name} import`;
    const runIds = new Set<string>();
    const runSessionIds = new Map<string, string>();
    const sessionIds = new Set<string>();
    let fallbackRunId: string | undefined;
    let primarySessionId: string | undefined;
    let runCount = 0;
    let toolCallCount = 0;
    let modelCallCount = 0;
    let skippedLineCount = 0;

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      if (!explicitParser && !parser.detect(line)) {
        skippedLineCount += 1;
        continue;
      }
      const event = parser.parseLine(line);
      if (!event) {
        skippedLineCount += 1;
        continue;
      }

      const referencedRunId = event.run?.id ?? event.toolCall?.runId ?? event.modelCall?.runId;
      const sessionId = event.session?.id ?? event.run?.sessionId ?? (referencedRunId ? runSessionIds.get(referencedRunId) : undefined) ?? defaultSessionId;
      primarySessionId ??= sessionId;
      if (!sessionIds.has(sessionId)) {
        storage.createSession(createImportedSession(sessionId, event.session?.name ?? sessionName, now, parser.name, importId, source));
        sessionIds.add(sessionId);
      }

      if (event.run) {
        const run = toImportedRun(event, sessionId, parser.name, importId, source, now);
        storage.upsertAgentRun(run);
        storage.refreshSession(run.sessionId);
        runIds.add(run.id);
        runSessionIds.set(run.id, run.sessionId);
        fallbackRunId = run.id;
        runCount += 1;
      }

      if (event.toolCall) {
        const runId = ensureRunForCall({
          storage,
          runIds,
          fallbackRunId,
          sessionId,
          parserName: parser.name,
          importId,
          source,
          now,
          callName: event.toolCall.toolName,
          callRunId: event.toolCall.runId
        });
        fallbackRunId = runId;
        storage.insertToolCall(toImportedToolCall(event.toolCall, runId, parser.name, importId, source, now));
        toolCallCount += 1;
      }

      if (event.modelCall) {
        const runId = ensureRunForCall({
          storage,
          runIds,
          fallbackRunId,
          sessionId,
          parserName: parser.name,
          importId,
          source,
          now,
          callName: event.modelCall.model ?? event.modelCall.method,
          callRunId: event.modelCall.runId
        });
        fallbackRunId = runId;
        storage.insertModelCall(toImportedModelCall(event.modelCall, runId, parser.name, importId, source, now));
        modelCallCount += 1;
      }
    }

    for (const sessionId of sessionIds) {
      storage.refreshSession(sessionId);
    }

    storage.recordParserImport({
      id: importId,
      parserName: parser.name,
      source,
      importedAt: now,
      runCount,
      toolCallCount,
      metadata: {
        modelCallCount,
        skippedLineCount,
        sessionIds: [...sessionIds]
      }
    });

    return {
      id: importId,
      parserName: parser.name,
      source,
      sessionId: primarySessionId ?? defaultSessionId,
      runCount,
      toolCallCount,
      modelCallCount,
      skippedLineCount
    };
  } finally {
    if (ownsStorage) {
      storage.close();
    }
  }
}

function resolveParser(selection: ParserSelection, lines: string[]): LogParser {
  if (typeof selection === 'object') {
    return selection;
  }
  if (selection !== 'auto') {
    return getBuiltInParser(selection);
  }
  const parsers = getBuiltInParsers();
  const parser = parsers.find((candidate) => lines.some((line) => candidate.detect(line)));
  if (!parser) {
    throw new Error('Could not auto-detect parser. Use --parser hermes or --parser openclaw.');
  }
  return parser;
}

function createImportedSession(id: string, name: string, startedAt: Date, parserName: string, importId: string, source: string): Session {
  return {
    id,
    name,
    status: 'running',
    startedAt,
    totalTokens: normalizeTokens(),
    totalCostUSD: 0,
    metadata: { parserName, importId, source, imported: true }
  };
}

function toImportedRun(event: ParsedTraceEvent, sessionId: string, parserName: string, importId: string, source: string, importedAt: Date): AgentRun {
  const run = event.run!;
  const startedAt = toDate((run as { startedAt?: unknown; started_at?: unknown }).startedAt ?? (run as { started_at?: unknown }).started_at, importedAt);
  const endedAt = toDate((run as { endedAt?: unknown; ended_at?: unknown }).endedAt ?? (run as { ended_at?: unknown }).ended_at, undefined);
  return {
    id: run.id ?? createId('run'),
    sessionId: run.sessionId ?? sessionId,
    agentName: run.agentName,
    parentRunId: run.parentRunId,
    triggeredBy: normalizeTriggeredBy(run.triggeredBy),
    input: run.input,
    output: run.output,
    status: normalizeStatus(run.status),
    error: run.error,
    errorStack: run.errorStack,
    startedAt,
    endedAt,
    latencyMs: run.latencyMs ?? (startedAt && endedAt ? endedAt.getTime() - startedAt.getTime() : undefined),
    toolCalls: [],
    modelCalls: [],
    agentCalls: [],
    tokens: normalizeTokens(run.tokens),
    costUSD: run.costUSD ?? 0,
    metadata: { ...(run.metadata ?? {}), parserName, importId, source, imported: true }
  };
}

function toImportedToolCall(call: ParsedTraceEvent['toolCall'], runId: string, parserName: string, importId: string, source: string, importedAt: Date): ToolCall {
  return {
    id: call!.id ?? createId('tool'),
    runId,
    toolName: call!.toolName,
    input: call!.input,
    output: call!.output,
    latencyMs: call!.latencyMs ?? 0,
    tokens: normalizeTokens(call!.tokens),
    costUSD: call!.costUSD ?? 0,
    status: normalizeCallStatus(call!.status),
    error: call!.error,
    errorStack: call!.errorStack,
    calledAt: toDate((call as { calledAt?: unknown; called_at?: unknown })?.calledAt ?? (call as { called_at?: unknown })?.called_at, importedAt),
    metadata: { ...(call!.metadata ?? {}), parserName, importId, source, imported: true }
  };
}

function toImportedModelCall(call: ParsedTraceEvent['modelCall'], runId: string, parserName: string, importId: string, source: string, importedAt: Date): ModelCall {
  return {
    id: call!.id ?? createId('model'),
    runId,
    provider: call!.provider,
    method: call!.method,
    model: call!.model,
    input: call!.input,
    output: call!.output,
    latencyMs: call!.latencyMs ?? 0,
    tokens: normalizeTokens(call!.tokens),
    costUSD: call!.costUSD ?? 0,
    status: normalizeCallStatus(call!.status),
    error: call!.error,
    errorStack: call!.errorStack,
    calledAt: toDate((call as { calledAt?: unknown; called_at?: unknown })?.calledAt ?? (call as { called_at?: unknown })?.called_at, importedAt),
    metadata: { ...(call!.metadata ?? {}), parserName, importId, source, imported: true }
  };
}

interface EnsureRunForCallInput {
  storage: StorageAdapter;
  runIds: Set<string>;
  fallbackRunId?: string;
  sessionId: string;
  parserName: string;
  importId: string;
  source: string;
  now: Date;
  callName?: string;
  callRunId?: string;
}

function ensureRunForCall(input: EnsureRunForCallInput): string {
  const runId = input.callRunId ?? input.fallbackRunId;
  if (runId && input.runIds.has(runId)) {
    return runId;
  }

  const createdRunId = runId ?? createId('run');
  input.storage.upsertAgentRun({
    id: createdRunId,
    sessionId: input.sessionId,
    agentName: `${input.parserName}-imported-agent`,
    triggeredBy: 'agent',
    input: { importedCall: input.callName },
    status: 'success',
    startedAt: input.now,
    endedAt: input.now,
    latencyMs: 0,
    toolCalls: [],
    modelCalls: [],
    agentCalls: [],
    tokens: normalizeTokens(),
    costUSD: 0,
    metadata: { parserName: input.parserName, importId: input.importId, source: input.source, imported: true, synthetic: true }
  });
  input.runIds.add(createdRunId);
  return createdRunId;
}

function normalizeStatus(status?: TraceStatus): TraceStatus {
  return status === 'running' || status === 'failed' || status === 'timeout' ? status : 'success';
}

function normalizeCallStatus(status?: ToolCall['status'] | ModelCall['status']): ToolCall['status'] {
  return status === 'failed' || status === 'timeout' ? status : 'success';
}

function normalizeTriggeredBy(triggeredBy?: TriggeredBy): TriggeredBy {
  return triggeredBy === 'human' || triggeredBy === 'scheduled' ? triggeredBy : 'agent';
}

function toDate(value: unknown, fallback: Date | undefined): Date {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return fallback ?? new Date();
}