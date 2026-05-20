import { describe, expect, test, vi } from 'vitest';
import { CostCalculator } from '../src/cost.js';

describe('CostCalculator', () => {
  test('calculates requested claude-sonnet example', () => {
    const cost = new CostCalculator().calculate('claude-sonnet-4-6', { input: 1000, output: 500 });
    expect(cost).toBe(0.0105);
  });

  test('returns zero for unknown models while preserving tokens elsewhere', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(new CostCalculator().calculate('local-model', { input: 100, output: 100 })).toBe(0);
    expect(warning).toHaveBeenCalledWith('No pricing found for model local-model, cost set to 0. Pass a models config to override.');
    warning.mockRestore();
  });

  test('warns once when model pricing is unknown', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const calculator = new CostCalculator();
    expect(calculator.calculate('claude-opus-4-6', { input: 100, output: 50 })).toBe(0);
    expect(calculator.calculate('claude-opus-4-6', { input: 100, output: 50 })).toBe(0);
    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning.mock.calls[0]?.[0]).toContain('No pricing found for model claude-opus-4-6');
    warning.mockRestore();
  });
});