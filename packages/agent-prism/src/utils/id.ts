import { randomBytes, randomUUID } from 'node:crypto';

export function createId(prefix?: string): string {
  const body = typeof randomUUID === 'function'
    ? randomUUID().replaceAll('-', '').slice(0, 10)
    : randomBytes(8).toString('base64url').slice(0, 10);
  return prefix ? `${prefix}_${body}` : body;
}