import type { LogParser, ParsedTraceEvent } from '../types.js';
import { normalizeLogEvent, parseJsonLine } from './base.js';

export class HermesLogParser implements LogParser {
  readonly name = 'hermes';

  detect(line: string): boolean {
    const json = parseJsonLine(line);
    const lowered = line.toLowerCase();
    return lowered.includes('hermes') || Boolean(json?.hermes || json?.framework === 'hermes' || json?.logger === 'hermes');
  }

  parseLine(line: string): ParsedTraceEvent | undefined {
    const json = parseJsonLine(line);
    if (json) {
      return normalizeLogEvent(this.name, json.payload ?? json.data ?? json);
    }

    const operational = normalizeHermesOperationalLog(line);
    if (operational) {
      return operational;
    }

    const match = line.match(/agent=(?<agent>[^\s]+).*status=(?<status>success|failed|timeout).*latency=(?<latency>\d+)/i);
    if (!match?.groups) {
      return undefined;
    }
    return {
      run: {
        agentName: match.groups.agent ?? 'hermes-agent',
        status: match.groups.status as any,
        latencyMs: Number(match.groups.latency),
        metadata: { parserName: this.name, raw: line }
      }
    };
  }
}

function normalizeHermesOperationalLog(line: string): ParsedTraceEvent | undefined {
  const match = line.match(/^(?<date>\d{4}-\d{2}-\d{2})\s+(?<time>\d{2}:\d{2}:\d{2},\d{3})\s+(?<level>[A-Z]+)\s+(?<logger>[\w.\-]+):\s*(?<message>.*)$/);
  if (!match?.groups) {
    return undefined;
  }

  const logger = match.groups.logger ?? 'hermes';
  const component = logger.replace(/^hermes_cli\.?/, '').replace(/^agent\.?/, '') || logger;
  const level = (match.groups.level ?? 'INFO').toLowerCase();
  const message = match.groups.message ?? '';
  const failed = level === 'error' || level === 'critical';

  return {
    run: {
      agentName: `hermes:${component}`,
      triggeredBy: 'agent',
      status: failed ? 'failed' : 'success',
      error: failed ? message : undefined,
      output: {
        level,
        logger,
        message
      },
      latencyMs: parseLatency(message) ?? 0,
      startedAt: parseHermesDate(match.groups.date, match.groups.time),
      metadata: {
        parserName: 'hermes',
        raw: line,
        operational: true
      }
    }
  };
}

function parseLatency(message: string): number | undefined {
  const match = message.match(/(?<latency>\d+(?:\.\d+)?)ms/);
  return match?.groups?.latency ? Math.round(Number(match.groups.latency)) : undefined;
}

function parseHermesDate(date: string | undefined, time: string | undefined): Date | undefined {
  if (!date || !time) {
    return undefined;
  }
  const parsed = new Date(`${date}T${time.replace(',', '.')}`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}