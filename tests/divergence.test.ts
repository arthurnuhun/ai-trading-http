import { describe, it, expect } from 'vitest';
import { detectDivergences } from '../src/analysis/divergence.js';
import type { Swing } from '../src/analysis/market-structure.js';
import type { Series } from '../src/analysis/indicators.js';

const sw = (type: 'high' | 'low', index: number, price: number): Swing => ({
  type, index, timestamp: index * 60000, isoTime: new Date(index * 60000).toISOString(), price,
  confirmedIndex: index + 1, confirmedTimestamp: (index + 1) * 60000, label: null,
});
const series = (n: number, values: Record<number, number>): Series => Array.from({ length: n }, (_, i) => values[i] ?? null);

describe('detectDivergences', () => {
  it('bullish: lower swing low in price with a higher indicator value', () => {
    const d = detectDivergences([sw('low', 5, 100), sw('low', 15, 98)], series(20, { 5: 30, 15: 35 }), 'RSI', 19);
    expect(d).toEqual([
      {
        kind: 'bullish', indicator: 'RSI',
        from: { price: 100, timestamp: 300000, indicatorValue: 30 },
        to: { price: 98, timestamp: 900000, indicatorValue: 35 },
      },
    ]);
  });
  it('bearish: higher swing high in price with a lower indicator value', () => {
    const d = detectDivergences([sw('high', 8, 110), sw('high', 18, 112)], series(20, { 8: 70, 18: 65 }), 'MACD_HIST', 19);
    expect(d).toEqual([
      {
        kind: 'bearish', indicator: 'MACD_HIST',
        from: { price: 110, timestamp: 480000, indicatorValue: 70 },
        to: { price: 112, timestamp: 1080000, indicatorValue: 65 },
      },
    ]);
  });
  it('reports nothing when the indicator confirms price', () => {
    expect(detectDivergences([sw('low', 5, 100), sw('low', 15, 98)], series(20, { 5: 30, 15: 25 }), 'RSI', 19)).toEqual([]);
    expect(detectDivergences([sw('high', 8, 110), sw('high', 18, 112)], series(20, { 8: 70, 18: 75 }), 'RSI', 19)).toEqual([]);
  });
  it('ignores a divergence whose second swing is older than the maximum age', () => {
    const swings = [sw('low', 5, 100), sw('low', 15, 98)];
    const s = series(120, { 5: 30, 15: 35 });
    expect(detectDivergences(swings, s, 'RSI', 100)).toEqual([]); // 100 - 15 = 85 > 50
    expect(detectDivergences(swings, s, 'RSI', 60)).toHaveLength(1); // 60 - 15 = 45 <= 50
  });
  it('skips swings where the indicator has no value', () => {
    expect(detectDivergences([sw('low', 5, 100), sw('low', 15, 98)], series(20, { 5: 30 }), 'RSI', 19)).toEqual([]);
  });
  it('uses only the last two swings of each type', () => {
    const swings = [sw('low', 2, 105), sw('low', 5, 100), sw('low', 15, 98)];
    const d = detectDivergences(swings, series(20, { 2: 20, 5: 30, 15: 35 }), 'RSI', 19);
    expect(d).toHaveLength(1);
    expect(d[0].from.price).toBe(100);
  });
});
