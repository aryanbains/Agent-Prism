import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTracer } from '../src/index.js';

const dbPath = join(mkdtempSync(join(tmpdir(), 'agent-prism-bench-')), 'bench.db');
const lens = createTracer({ dbPath, onError: 'throw' });
const startedAt = Date.now();

await Promise.all(Array.from({ length: 1000 }, (_, index) => {
  const traced = lens.wrap(`agent-${index}`, async (input: number) => {
    await lens.toolCall('noop_tool', { input }, async () => ({ result: input }));
    return { result: input };
  });
  return traced(index);
}));

const elapsed = Date.now() - startedAt;
lens.shutdown();
console.log(`1000 concurrent wrapped calls with tool calls: ${elapsed}ms`);
console.log(`Average overhead budget target: <5000ms total, observed ${(elapsed / 1000).toFixed(3)}ms per call wall-clock share`);