export function serializeJson(value: unknown): string {
  if (typeof value === 'undefined') {
    return 'null';
  }

  try {
    return JSON.stringify(value, (_key, innerValue) => {
      if (typeof innerValue === 'bigint') {
        return innerValue.toString();
      }
      if (innerValue instanceof Error) {
        return { name: innerValue.name, message: innerValue.message, stack: innerValue.stack };
      }
      return innerValue;
    }) ?? 'null';
  } catch (error) {
    return JSON.stringify({ unserializable: true, value: String(value), error: (error as Error).message });
  }
}

export function deserializeJson<T = unknown>(value: string | null | undefined): T | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return value as T;
  }
}

export function toIso(value?: Date): string | undefined {
  return value ? value.toISOString() : undefined;
}

export function fromIso(value?: string | null): Date | undefined {
  return value ? new Date(value) : undefined;
}

export function normalizeTokens(tokens?: Partial<{ input: number; output: number; cached?: number; total: number }>) {
  const input = Math.max(0, Math.trunc(tokens?.input ?? 0));
  const output = Math.max(0, Math.trunc(tokens?.output ?? 0));
  const cached = Math.max(0, Math.trunc(tokens?.cached ?? 0));
  const total = Math.max(0, Math.trunc(tokens?.total ?? input + output + cached));
  return cached > 0 ? { input, output, cached, total } : { input, output, total };
}