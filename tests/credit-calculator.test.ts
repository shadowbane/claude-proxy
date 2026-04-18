import { describe, it, expect } from 'vitest';
import { estimateCredits } from '../src/server/lib/credit-calculator.js';

describe('estimateCredits', () => {
  // ── mimo-v2-pro → 2× ───────────────────────────

  it('applies 2× multiplier to all token types for mimo-v2-pro', () => {
    const result = estimateCredits({
      model: 'mimo-v2-pro',
      promptTokens: 100,
      completionTokens: 50,
      cacheCreationTokens: 25,
      cacheReadTokens: 1000,
    });
    expect(result).toBe((100 + 50 + 25 + 1000) * 2);
  });

  it('returns 0 for mimo-v2-pro with no tokens', () => {
    expect(
      estimateCredits({
        model: 'mimo-v2-pro',
        promptTokens: 0,
        completionTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      }),
    ).toBe(0);
  });

  it('counts cache_read at full 2× rate for pro (no Anthropic-style discount)', () => {
    expect(
      estimateCredits({
        model: 'mimo-v2-pro',
        promptTokens: 0,
        completionTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 5_000_000,
      }),
    ).toBe(10_000_000);
  });

  // ── mimo-v2-omni → 1× ──────────────────────────

  it('applies 1× multiplier to all token types for mimo-v2-omni', () => {
    const result = estimateCredits({
      model: 'mimo-v2-omni',
      promptTokens: 100,
      completionTokens: 50,
      cacheCreationTokens: 25,
      cacheReadTokens: 1000,
    });
    expect(result).toBe(100 + 50 + 25 + 1000);
  });

  it('counts cache_read at full 1× rate for omni', () => {
    expect(
      estimateCredits({
        model: 'mimo-v2-omni',
        promptTokens: 0,
        completionTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 6_000_000,
      }),
    ).toBe(6_000_000);
  });

  it('returns 0 for mimo-v2-omni with no tokens', () => {
    expect(
      estimateCredits({
        model: 'mimo-v2-omni',
        promptTokens: 0,
        completionTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      }),
    ).toBe(0);
  });

  // ── mimo-v2-tts → 0× (free) ────────────────────

  it('always returns 0 for mimo-v2-tts regardless of token counts', () => {
    expect(
      estimateCredits({
        model: 'mimo-v2-tts',
        promptTokens: 9_999_999,
        completionTokens: 9_999_999,
        cacheCreationTokens: 9_999_999,
        cacheReadTokens: 9_999_999,
      }),
    ).toBe(0);
  });

  // ── Unknown / unsupported models → null ────────

  it('returns null for non-MiMo models', () => {
    expect(
      estimateCredits({
        model: 'claude-3-5-sonnet',
        promptTokens: 1000,
        completionTokens: 500,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      }),
    ).toBeNull();
  });

  it('returns null for empty string model', () => {
    expect(
      estimateCredits({
        model: '',
        promptTokens: 100,
        completionTokens: 100,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      }),
    ).toBeNull();
  });

  it('returns null for unknown mimo-v2-* variants (strict match)', () => {
    expect(
      estimateCredits({
        model: 'mimo-v2-lite',
        promptTokens: 100,
        completionTokens: 100,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      }),
    ).toBeNull();
  });

  it('is case-sensitive — uppercase model name does not match', () => {
    expect(
      estimateCredits({
        model: 'MiMo-V2-Pro',
        promptTokens: 100,
        completionTokens: 100,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      }),
    ).toBeNull();
  });

  // ── Defensive input handling ───────────────────

  it('coerces negative or non-finite inputs to zero without throwing (pro)', () => {
    expect(
      estimateCredits({
        model: 'mimo-v2-pro',
        promptTokens: -500,
        completionTokens: Number.NaN,
        cacheCreationTokens: Number.POSITIVE_INFINITY,
        cacheReadTokens: 10,
      }),
    ).toBe(10 * 2);
  });

  it('coerces negative or non-finite inputs to zero without throwing (omni)', () => {
    expect(
      estimateCredits({
        model: 'mimo-v2-omni',
        promptTokens: -500,
        completionTokens: Number.NaN,
        cacheCreationTokens: Number.POSITIVE_INFINITY,
        cacheReadTokens: 10,
      }),
    ).toBe(10);
  });
});
