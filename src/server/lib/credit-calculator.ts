// Estimates MiMo Token Plan credit consumption for a single request.
//
// Credits are deducted per Xiaomi MiMo Token Plan subscription pricing:
// https://platform.xiaomimimo.com/#/docs/tokenplan/subscription
//
//   mimo-v2-pro  → 2×   (all tokens, incl. cache reads — no Anthropic-style discount)
//   mimo-v2-omni → 1×   (all tokens — equivalent to raw token rate)
//   mimo-v2-tts  → 0×   (free during public beta)
//   anything else → null (aggregations distinguish "not computed" from zero)
//
// Note: MiMo also documents a 4× tier for mimo-v2-pro at 256k–1M context, but
// the Token Plan does not expose a way to opt into the 1M window, so we treat
// mimo-v2-pro as flat 2×.
// See docs/credit-limit.md and docs/mimo-billing-investigation.md.

export interface CreditInput {
  model: string;
  promptTokens: number;
  completionTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

const MIMO_MULTIPLIERS: Record<string, number> = {
  'mimo-v2-pro': 2,
  'mimo-v2-omni': 1,
  'mimo-v2-tts': 0,
};

function sanitize(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function estimateCredits(input: CreditInput): number | null {
  const multiplier = MIMO_MULTIPLIERS[input.model];
  if (multiplier === undefined) return null;

  const sum =
    sanitize(input.promptTokens) +
    sanitize(input.completionTokens) +
    sanitize(input.cacheCreationTokens) +
    sanitize(input.cacheReadTokens);
  return sum * multiplier;
}