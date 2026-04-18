// Estimates MiMo Token Plan credit consumption for a single request.
//
// For mimo-v2-pro, MiMo bills all token types (fresh input, output, cache
// creation, cache read) at 2× the Lite rate — cache reads are NOT discounted.
// See docs/mimo-billing-investigation-v1.md for the evidence behind this.
//
// Returns null for any other model so aggregations distinguish
// "not computed" from a genuine zero-credit request.

export interface CreditInput {
  model: string;
  promptTokens: number;
  completionTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

const MIMO_V2_PRO_MULTIPLIER = 2;

function sanitize(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function estimateCredits(input: CreditInput): number | null {
  if (input.model !== 'mimo-v2-pro') return null;
  const sum =
    sanitize(input.promptTokens) +
    sanitize(input.completionTokens) +
    sanitize(input.cacheCreationTokens) +
    sanitize(input.cacheReadTokens);
  return sum * MIMO_V2_PRO_MULTIPLIER;
}
