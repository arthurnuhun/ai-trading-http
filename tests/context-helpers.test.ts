import { describe, it, expect } from 'vitest';
import { emaStack, priceVsEma, compactLevels } from '../src/analysis/context.js';

const e = (a: number | null, b: number | null, c: number | null, d: number | null) => ({ ema20: a, ema50: b, ema100: c, ema200: d });

describe('emaStack', () => {
  it('bullish when ema20 > ema50 > ema100 > ema200, bearish when reversed', () => {
    expect(emaStack(e(4, 3, 2, 1))).toBe('bullish');
    expect(emaStack(e(1, 2, 3, 4))).toBe('bearish');
  });
  it('mixed when not strictly ordered; null without full history', () => {
    expect(emaStack(e(4, 3, 3, 1))).toBe('mixed');
    expect(emaStack(e(4, 2, 3, 1))).toBe('mixed');
    expect(emaStack(e(4, 3, 2, null))).toBeNull();
  });
});

describe('priceVsEma', () => {
  it('reports above, at, below and null', () => {
    expect(priceVsEma(10, e(9, 10, 11, null))).toEqual({ ema20: 'above', ema50: 'at', ema100: 'below', ema200: null });
  });
});

describe('compactLevels', () => {
  it('keeps the two nearest zones per side (highest first) and trims the lists', () => {
    const levels = {
      available: true,
      price: 100,
      atr14: 5,
      supportResistance: [
        { kind: 'resistance', price: 130 }, { kind: 'resistance', price: 120 }, { kind: 'resistance', price: 110 },
        { kind: 'support', price: 95 }, { kind: 'support', price: 90 }, { kind: 'support', price: 80 },
      ],
      fairValueGaps: [{ id: 1 }, { id: 2 }, { id: 3 }],
      orderBlocks: [{ id: 1 }, { id: 2 }, { id: 3 }],
      liquidity: { above: [{ p: 1 }], below: [{ p: 2 }], pools: [{ p: 3 }] },
      sweeps: [{ s: 1 }, { s: 2 }, { s: 3 }],
      psychological: [{ price: 100 }],
      recentRange: { candles: 1 },
      fibonacci: { confirmed: null },
    } as unknown as Parameters<typeof compactLevels>[0];
    const c = compactLevels(levels);
    expect(c.supportResistance.map((x) => x.price)).toEqual([120, 110, 95, 90]);
    expect(c.fairValueGaps).toHaveLength(2);
    expect(c.orderBlocks).toHaveLength(2);
    expect(c.sweeps).toEqual([{ s: 2 }, { s: 3 }]);
    expect(c.liquidity).toEqual({ above: [{ p: 1 }], below: [{ p: 2 }] });
    expect(c).not.toHaveProperty('fibonacci');
  });
});
