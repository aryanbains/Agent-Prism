from __future__ import annotations

from .types import TokenUsage

DEFAULT_MODEL_PRICES = {
    "gpt-4o": {"inputPer1M": 2.50, "outputPer1M": 10.00},
    "gpt-4o-mini": {"inputPer1M": 0.15, "outputPer1M": 0.60},
    "claude-sonnet-4-6": {"inputPer1M": 3.00, "outputPer1M": 15.00, "cachedPer1M": 0.30},
    "claude-3-5-haiku": {"inputPer1M": 0.80, "outputPer1M": 4.00, "cachedPer1M": 0.08},
}


def calculate_cost(model: str | None, tokens: TokenUsage, models: dict[str, dict[str, float]] | None = None) -> float:
    if not model:
        return 0.0
    prices = {**DEFAULT_MODEL_PRICES, **(models or {})}
    price = prices.get(model)
    if not price:
        lowered = model.lower()
        price = next((value for key, value in prices.items() if key.lower() in lowered), None)
    if not price:
        return 0.0
    cached = tokens.cached or 0
    billable_input = max(0, tokens.input - cached)
    micro_dollars = (
        billable_input * price["inputPer1M"]
        + tokens.output * price["outputPer1M"]
        + cached * price.get("cachedPer1M", price["inputPer1M"])
    )
    return round(micro_dollars / 1_000_000, 8)