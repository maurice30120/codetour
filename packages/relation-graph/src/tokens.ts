/**
 * Deterministic token estimate used for the maxTokens limit (the measurement
 * harness of #118 owns exact counting; tests pin statuses, not token budgets).
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Shared maxTokens budget: spends the token estimate of each added element and
 * flags truncation when the budget is exhausted (the element is then skipped).
 */
export class TokenBudget {
  used = 0;
  constructor(
    readonly max: number,
    private readonly flags: { tokens: boolean }
  ) {}
  trySpend(text: string): boolean {
    const cost = estimateTokens(text);
    if (this.used + cost > this.max) {
      this.flags.tokens = true;
      return false;
    }
    this.used += cost;
    return true;
  }
}
