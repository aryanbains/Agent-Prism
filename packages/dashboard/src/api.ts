export interface TokenUsage {
  input: number;
  output: number;
  cached?: number;
  total: number;
}

export interface Session {
  id: string;
  name?: string;
  status: 'running' | 'success' | 'failed' | 'timeout';
  startedAt: string;
  endedAt?: string;
  latencyMs?: number;
  totalTokens: TokenUsage;
  totalCostUSD: number;
}

export interface ToolCall {
  id: string;
  runId: string;
  toolName: string;
  input: unknown;
  output?: unknown;
  latencyMs: number;
  costUSD: number;
  status: 'success' | 'failed' | 'timeout';
  error?: string;
  calledAt: string;
}

export interface ModelCall {
  id: string;
  runId: string;
  provider: string;
  method: string;
  model?: string;
  input?: unknown;
  output?: unknown;
  latencyMs: number;
  tokens: TokenUsage;
  costUSD: number;
  status: 'success' | 'failed' | 'timeout';
  error?: string;
  calledAt: string;
}

export interface RunTree {
  id: string;
  sessionId: string;
  agentName: string;
  parentRunId?: string;
  triggeredBy: string;
  input: unknown;
  output?: unknown;
  status: 'running' | 'success' | 'failed' | 'timeout';
  error?: string;
  latencyMs?: number;
  tokens: TokenUsage;
  costUSD: number;
  startedAt: string;
  endedAt?: string;
  children: RunTree[];
  toolCalls: ToolCall[];
  modelCalls: ModelCall[];
}

export interface SessionTreeResponse {
  session: Session;
  tree: RunTree[];
  toolCalls: ToolCall[];
  modelCalls: ModelCall[];
}

export interface CostStats {
  totalCostUSD: number;
  totalTokens: TokenUsage;
  costByAgent: Array<{ agentName: string; costUSD: number; runCount: number }>;
  costOverTime: Array<{ sessionId: string; startedAt: string; costUSD: number }>;
  expensiveCalls: Array<{ id: string; kind: 'tool' | 'model'; name: string; costUSD: number; latencyMs: number; runId: string }>;
}

export interface HealthStats {
  agents: Array<{ agentName: string; runCount: number; successRate: number; averageLatencyMs: number; p95LatencyMs: number; averageCostUSD: number; commonFailure?: string }>;
  failures: Array<{ reason: string; count: number }>;
}

export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}