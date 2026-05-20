import type { LogParser, ParsedTraceEvent } from '../types.js';
import { normalizeLogEvent, parseJsonLine } from './base.js';

export class OpenClawLogParser implements LogParser {
  readonly name = 'openclaw';

  detect(line: string): boolean {
    const json = parseJsonLine(line);
    const lowered = line.toLowerCase();
    return lowered.includes('openclaw') || Boolean(json?.openclaw || json?.framework === 'openclaw' || json?.logger === 'openclaw' || (json?.type === 'log' && (json?.subsystem || json?.module)));
  }

  parseLine(line: string): ParsedTraceEvent | undefined {
    const json = parseJsonLine(line);
    if (json) {
      return normalizeLogEvent(this.name, json.payload ?? json.data ?? json) ?? normalizeOpenClawOperationalLog(json);
    }

    const match = line.match(/\[(?<status>success|failed|timeout)]\s+(?<agent>[^\s]+)\s+(?<latency>\d+)ms/i);
    if (!match?.groups) {
      return undefined;
    }
    return {
      run: {
        agentName: match.groups.agent ?? 'openclaw-agent',
        status: match.groups.status as any,
        latencyMs: Number(match.groups.latency),
        metadata: { parserName: this.name, raw: line }
      }
    };
  }
}

function normalizeOpenClawOperationalLog(raw: Record<string, any>): ParsedTraceEvent | undefined {
  if (raw.type !== 'log' && !raw.subsystem && !raw.module && !raw.raw) {
    return undefined;
  }

  const innerRaw = parseInnerRaw(raw.raw);
  const subsystem = raw.subsystem ?? raw.module ?? parseSubsystem(raw.message) ?? parseSubsystem(innerRaw?.message) ?? 'runtime';
  const message = String(raw.message ?? innerRaw?.message ?? 'OpenClaw log event');
  const level = String(raw.level ?? innerRaw?._meta?.logLevelName ?? 'info').toLowerCase();
  const failed = level === 'error' || level === 'fatal';
  const latencyMs = parseLatency(message) ?? parseLatency(innerRaw?.message) ?? 0;

  return {
    run: {
      agentName: `openclaw:${subsystem}`,
      triggeredBy: 'agent',
      status: failed ? 'failed' : 'success',
      error: failed ? message : undefined,
      output: {
        level,
        message,
        subsystem
      },
      latencyMs,
      startedAt: parseDate(raw.time ?? innerRaw?._meta?.date),
      metadata: {
        parserName: 'openclaw',
        raw,
        operational: true
      }
    }
  };
}

function parseInnerRaw(value: unknown): Record<string, any> | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  try {
    return JSON.parse(value) as Record<string, any>;
  } catch {
    return undefined;
  }
}

function parseSubsystem(message: unknown): string | undefined {
  if (typeof message !== 'string') {
    return undefined;
  }
  const bracket = message.match(/^\[(?<subsystem>[^\]]+)]/);
  if (bracket?.groups?.subsystem) {
    return bracket.groups.subsystem;
  }
  const jsonPrefix = message.match(/^\{.*?"subsystem"\s*:\s*"(?<subsystem>[^"]+)".*?}/);
  return jsonPrefix?.groups?.subsystem;
}

function parseLatency(message: unknown): number | undefined {
  if (typeof message !== 'string') {
    return undefined;
  }
  const match = message.match(/(?<latency>\d+(?:\.\d+)?)ms/);
  return match?.groups?.latency ? Math.round(Number(match.groups.latency)) : undefined;
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}