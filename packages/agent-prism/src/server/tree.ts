import type { AgentRun, AgentRunTree, ModelCall, ToolCall } from '../types.js';

export function buildRunTree(runs: AgentRun[], toolCalls: ToolCall[], modelCalls: ModelCall[]): AgentRunTree[] {
  const byId = new Map<string, AgentRunTree>();
  const roots: AgentRunTree[] = [];

  for (const run of runs) {
    byId.set(run.id, { ...run, children: [], toolCalls: [], modelCalls: [] });
  }

  for (const toolCall of toolCalls) {
    byId.get(toolCall.runId)?.toolCalls.push(toolCall);
  }

  for (const modelCall of modelCalls) {
    byId.get(modelCall.runId)?.modelCalls.push(modelCall);
  }

  for (const run of byId.values()) {
    if (run.parentRunId && byId.has(run.parentRunId)) {
      byId.get(run.parentRunId)!.children.push(run);
    } else {
      roots.push(run);
    }
  }

  return roots;
}

export function tracesToCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) {
    return '';
  }
  const headers = Object.keys(rows[0]!);
  return [headers.join(','), ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(','))].join('\n');
}

function csvCell(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'object' && value !== null) {
    return JSON.stringify(value).replaceAll('"', '""');
  }
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}