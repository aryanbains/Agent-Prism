import type { Tracer } from '../tracer.js';
import type { MiddlewareOptions, TokenUsage } from '../types.js';

export function withPrism<T extends object>(client: T, tracer: Tracer, options: MiddlewareOptions = {}): T {
  const cache = new WeakMap<object, object>();
  return createProxy(client, tracer, options, [], cache) as T;
}

export function withOpenAI<T extends object>(client: T, tracer: Tracer, options: Omit<MiddlewareOptions, 'provider'> = {}): T {
  return withPrism(client, tracer, { ...options, provider: 'openai' });
}

export function withAnthropic<T extends object>(client: T, tracer: Tracer, options: Omit<MiddlewareOptions, 'provider'> = {}): T {
  return withPrism(client, tracer, { ...options, provider: 'anthropic' });
}

export function withOpenRouter<T extends object>(client: T, tracer: Tracer, options: Omit<MiddlewareOptions, 'provider'> = {}): T {
  return withPrism(client, tracer, { ...options, provider: 'openrouter' });
}

function createProxy(target: object, tracer: Tracer, options: MiddlewareOptions, path: string[], cache: WeakMap<object, object>): object {
  if (cache.has(target)) {
    return cache.get(target)!;
  }

  const proxy = new Proxy(target, {
    get(currentTarget, property, receiver) {
      const value = Reflect.get(currentTarget, property, receiver);
      if (typeof property === 'symbol' || property === 'then') {
        return value;
      }

      const nextPath = [...path, String(property)];
      if (typeof value === 'function') {
        return function prismWrappedFunction(this: unknown, ...args: unknown[]) {
          const startedAt = Date.now();
          const method = nextPath.join('.');
          const shouldAlwaysRecord = isKnownProviderMethod(method);

          try {
            const result = value.apply(currentTarget, args);
            if (isPromiseLike(result)) {
              return result.then((output: unknown) => {
                maybeRecordCall(tracer, options, method, args, output, Date.now() - startedAt, shouldAlwaysRecord);
                return output;
              }, (error: unknown) => {
                recordFailedCall(tracer, options, method, args, error, Date.now() - startedAt, shouldAlwaysRecord);
                throw error;
              });
            }
            maybeRecordCall(tracer, options, method, args, result, Date.now() - startedAt, shouldAlwaysRecord);
            return result;
          } catch (error) {
            recordFailedCall(tracer, options, method, args, error, Date.now() - startedAt, shouldAlwaysRecord);
            throw error;
          }
        };
      }

      if (value && typeof value === 'object') {
        return createProxy(value, tracer, options, nextPath, cache);
      }

      return value;
    }
  });

  cache.set(target, proxy);
  return proxy;
}

function maybeRecordCall(
  tracer: Tracer,
  options: MiddlewareOptions,
  method: string,
  args: unknown[],
  output: unknown,
  latencyMs: number,
  shouldAlwaysRecord: boolean
): void {
  const usage = extractUsage(output);
  const reportedCost = extractReportedCost(output);
  const model = extractModel(output, args);
  if (!shouldAlwaysRecord && !usage && !model) {
    return;
  }

  tracer.recordModelCall({
    provider: options.provider ?? detectProvider(method, output, args),
    method,
    model,
    input: options.recordInputs === false ? undefined : summarizeInput(args),
    output: options.recordOutputs === false ? undefined : summarizeOutput(output),
    latencyMs,
    tokens: usage,
    costUSD: reportedCost,
    status: 'success',
    metadata: { interceptedBy: 'proxy' }
  });
}

function recordFailedCall(
  tracer: Tracer,
  options: MiddlewareOptions,
  method: string,
  args: unknown[],
  error: unknown,
  latencyMs: number,
  shouldAlwaysRecord: boolean
): void {
  if (!shouldAlwaysRecord) {
    return;
  }

  tracer.recordModelCall({
    provider: options.provider ?? detectProvider(method, undefined, args),
    method,
    input: options.recordInputs === false ? undefined : summarizeInput(args),
    latencyMs,
    status: 'failed',
    error: error instanceof Error ? error.message : String(error),
    errorStack: error instanceof Error ? error.stack : undefined,
    metadata: { interceptedBy: 'proxy' }
  });
}

function extractUsage(output: unknown): Partial<TokenUsage> | undefined {
  const response = output as any;
  const usage = response?.usage ?? response?.response?.usage;
  if (!usage) {
    return undefined;
  }

  const input = usage.prompt_tokens ?? usage.input_tokens ?? usage.input ?? 0;
  const outputTokens = usage.completion_tokens ?? usage.output_tokens ?? usage.output ?? 0;
  const cached = usage.prompt_tokens_details?.cached_tokens ?? usage.cache_read_input_tokens ?? usage.input_token_details?.cache_read ?? 0;
  const total = usage.total_tokens ?? usage.total ?? input + outputTokens + cached;
  return { input, output: outputTokens, cached, total };
}

function extractModel(output: unknown, args: unknown[]): string | undefined {
  const response = output as any;
  const request = args[0] as any;
  return response?.model ?? response?.response?.model ?? request?.model;
}

function summarizeInput(args: unknown[]): unknown {
  if (args.length === 0) return undefined;
  if (args.length === 1) return args[0];
  return args;
}

function summarizeOutput(output: unknown): unknown {
  const response = output as any;
  if (!response || typeof response !== 'object') {
    return output;
  }
  return {
    id: response.id,
    model: response.model,
    usage: response.usage ?? response.response?.usage,
    choices: Array.isArray(response.choices) ? response.choices.length : undefined,
    content: response.content,
    stopReason: response.stop_reason
  };
}

function detectProvider(method: string, output?: unknown, args?: unknown[]): string {
  const response = output as any;
  const request = args?.[0] as any;
  const model = response?.model ?? request?.model;
  if (typeof response?.usage?.cost === 'number' || typeof response?.response?.usage?.cost === 'number') {
    return 'openrouter';
  }
  if (typeof model === 'string') {
    if (model.startsWith('anthropic/')) return 'anthropic';
    if (model.startsWith('openai/')) return 'openai';
  }
  if (method.includes('messages') || response?.stop_reason || response?.usage?.input_tokens) {
    return 'anthropic';
  }
  if (method.includes('chat') || method.includes('responses') || response?.choices || response?.usage?.prompt_tokens) {
    return 'openai';
  }
  return 'custom';
}

function isKnownProviderMethod(method: string): boolean {
  return [
    'chat.completions.create',
    'responses.create',
    'completions.create',
    'messages.create'
  ].some((knownMethod) => method.endsWith(knownMethod));
}

function isPromiseLike<T = unknown>(value: unknown): value is Promise<T> {
  return Boolean(value && typeof (value as Promise<T>).then === 'function');
}

function extractReportedCost(output: unknown): number | undefined {
  const response = output as any;
  const cost = response?.usage?.cost ?? response?.response?.usage?.cost;
  return typeof cost === 'number' ? cost : undefined;
}