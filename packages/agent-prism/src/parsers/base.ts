import type { LogParser, ParsedTraceEvent } from '../types.js';

export function parseJsonLine(line: string): Record<string, any> | undefined {
  const trimmed = line.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed) as Record<string, any>;
  } catch {
    return undefined;
  }
}

export function normalizeLogEvent(parserName: string, raw: Record<string, any>): ParsedTraceEvent | undefined {
  const kind = raw.kind ?? raw.type ?? raw.event;
  const agentName = raw.agent_name ?? raw.agentName ?? raw.agent;
  const runId = raw.run_id ?? raw.runId;
  const usage = normalizeUsage(raw.tokens ?? raw.usage);

  if (kind === 'tool' || raw.tool_name || raw.toolName) {
    return {
      toolCall: {
        id: raw.id,
        runId,
        toolName: raw.tool_name ?? raw.toolName ?? raw.name,
        input: raw.input,
        output: raw.output,
        latencyMs: raw.latency_ms ?? raw.latencyMs ?? 0,
        status: raw.status === 'failed' ? 'failed' : 'success',
        error: raw.error,
        calledAt: normalizeDate(raw.called_at ?? raw.calledAt ?? raw.timestamp ?? raw.time),
        metadata: { parserName, raw }
      }
    };
  }

  if (kind === 'model' || raw.provider || raw.model) {
    return {
      modelCall: {
        id: raw.id,
        runId,
        provider: raw.provider ?? parserName,
        method: raw.method ?? 'log.model_call',
        model: raw.model,
        input: raw.input,
        output: raw.output,
        latencyMs: raw.latency_ms ?? raw.latencyMs ?? 0,
        tokens: usage,
        costUSD: raw.cost_usd ?? raw.costUSD ?? raw.usage?.cost,
        status: raw.status === 'failed' ? 'failed' : 'success',
        error: raw.error,
        calledAt: normalizeDate(raw.called_at ?? raw.calledAt ?? raw.timestamp ?? raw.time),
        metadata: { parserName, raw }
      }
    };
  }

  if (agentName || kind === 'agent' || kind === 'run') {
    return {
      session: raw.session_id || raw.sessionId ? { id: raw.session_id ?? raw.sessionId } : undefined,
      run: {
        id: runId ?? raw.id,
        sessionId: raw.session_id ?? raw.sessionId,
        parentRunId: raw.parent_run_id ?? raw.parentRunId,
        agentName: agentName ?? raw.name ?? `${parserName}-agent`,
        triggeredBy: raw.triggered_by ?? raw.triggeredBy ?? 'agent',
        input: raw.input,
        output: raw.output,
        status: raw.status ?? 'success',
        error: raw.error,
        latencyMs: raw.latency_ms ?? raw.latencyMs,
        tokens: usage,
        costUSD: raw.cost_usd ?? raw.costUSD,
        startedAt: normalizeDate(raw.started_at ?? raw.startedAt ?? raw.timestamp ?? raw.time),
        endedAt: normalizeDate(raw.ended_at ?? raw.endedAt),
        metadata: { parserName, raw }
      }
    };
  }

  return undefined;
}

function normalizeUsage(value: any) {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  return {
    input: value.input ?? value.prompt_tokens ?? value.input_tokens ?? 0,
    output: value.output ?? value.completion_tokens ?? value.output_tokens ?? 0,
    cached: value.cached ?? value.cached_tokens,
    total: value.total ?? value.total_tokens
  };
}

function normalizeDate(value: unknown): Date | undefined {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  return undefined;
}

export function parseLines(parser: LogParser, text: string): ParsedTraceEvent[] {
  return text.split(/\r?\n/).flatMap((line) => {
    if (!parser.detect(line)) {
      return [];
    }
    const event = parser.parseLine(line);
    return event ? [event] : [];
  });
}