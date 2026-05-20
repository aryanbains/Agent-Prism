import type { CostModel, TokenUsage } from './types.js';
import { normalizeTokens } from './utils/json.js';

export const DEFAULT_MODEL_PRICES: Record<string, CostModel> = {
  'gpt-5-nano': { inputPer1M: 0.05, outputPer1M: 0.4 },
  'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
  'gpt-4.1': { inputPer1M: 2, outputPer1M: 8 },
  'gpt-4.1-mini': { inputPer1M: 0.4, outputPer1M: 1.6 },
  'gpt-4.1-nano': { inputPer1M: 0.1, outputPer1M: 0.4 },
  'gpt-oss-20b': { inputPer1M: 0.03, outputPer1M: 0.14 },
  'gpt-oss-120b': { inputPer1M: 0.15, outputPer1M: 0.6 },
  'o3-mini': { inputPer1M: 1.1, outputPer1M: 4.4 },
  'claude-3-haiku': { inputPer1M: 0.25, outputPer1M: 1.25 },
  'claude-3-5-sonnet': { inputPer1M: 3, outputPer1M: 15, cachedPer1M: 0.3 },
  'claude-3-7-sonnet': { inputPer1M: 3, outputPer1M: 15, cachedPer1M: 0.3 },
  'claude-sonnet-4-6': { inputPer1M: 3, outputPer1M: 15, cachedPer1M: 0.3 },
  'claude-3-5-haiku': { inputPer1M: 0.8, outputPer1M: 4, cachedPer1M: 0.08 },
  'claude-haiku': { inputPer1M: 0.8, outputPer1M: 4, cachedPer1M: 0.08 }
};

export class CostCalculator {
  private readonly models: Record<string, CostModel>;
  private readonly warnedModels = new Set<string>();

  constructor(models: Record<string, CostModel> = {}) {
    this.models = { ...DEFAULT_MODEL_PRICES, ...models };
  }

  calculate(model: string | undefined, usage?: Partial<TokenUsage>): number {
    const tokens = normalizeTokens(usage);
    if (!model) {
      return 0;
    }

    const pricing = this.lookup(model);
    if (!pricing) {
      this.warnMissingPricing(model);
      return 0;
    }

    const cached = tokens.cached ?? 0;
    const billableInput = Math.max(0, tokens.input - cached);
    const microDollars =
      billableInput * pricing.inputPer1M +
      tokens.output * pricing.outputPer1M +
      cached * (pricing.cachedPer1M ?? pricing.inputPer1M);
    return Number((microDollars / 1_000_000).toFixed(8));
  }

  lookup(model: string): CostModel | undefined {
    if (this.models[model]) {
      return this.models[model];
    }
    const normalized = model.toLowerCase();
    return Object.entries(this.models).find(([key]) => normalized.includes(key.toLowerCase()))?.[1];
  }

  private warnMissingPricing(model: string): void {
    if (this.warnedModels.has(model)) {
      return;
    }
    this.warnedModels.add(model);
    console.warn(`No pricing found for model ${model}, cost set to 0. Pass a models config to override.`);
  }
}