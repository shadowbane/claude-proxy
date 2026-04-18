import { describe, it, expect } from 'vitest';
import { estimateCredits } from '../src/server/lib/credit-calculator.js';

describe('estimateCredits', () => {
  it('applies the 2× multiplier to all token types for mimo-v2-pro', () => {
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

  it('counts cache_read at full 2× rate (no Anthropic-style discount)', () => {
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

  it('returns null for non-pro models', () => {
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

  it('returns null for unknown/empty model', () => {
    expect(
      estimateCredits({
        model: '',
        promptTokens: 100,
        completionTokens: 100,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      }),
    ).toBeNull();
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

  it('coerces negative or non-finite inputs to zero without throwing', () => {
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
});
