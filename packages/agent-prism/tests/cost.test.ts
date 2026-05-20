import { describe, expect, test } from 'vitest';
import { CostCalculator } from '../src/cost.js';

describe('CostCalculator', () => {
  test('calculates requested claude-sonnet example', () => {
    const cost = new CostCalculator().calculate('claude-sonnet-4-6', { input: 1000, output: 500 });
    expect(cost).toBe(0.0105);
  });

  test('returns zero for unknown models while preserving tokens elsewhere', () => {
    expect(new CostCalculator().calculate('local-model', { input: 100, output: 100 })).toBe(0);
  });
});