import { describe, it, expect } from 'vitest';
import { detectSwings, detectStructure } from '../src/analysis/market-structure.js';
import type { Candle } from '../src/types.js';

const bar = (i: number, h: number, l: number, c?: number): Candle => {
  const close = c ?? (h + l) / 2;
  return {
    timestamp: i * 60000,
    isoTime: new Date(i * 60000).toISOString(),
    open: close,
    high: h,
    low: l,
    close,
    volume: 1,
  };
};

// [high, low, close?] per bar. Bars 0-8: rising zigzag. Bar 9 closes above 34 (BOS). Bar 10 closes below 19 (CHoCH).
const rows: Array<[number, number, number?]> = [
  [11, 9], [20, 15], [16, 10], [26, 18], [22, 14], [32, 20], [28, 19], [34, 24], [33, 26],
  [40, 30, 39],
  [38, 12, 15],
];
const series = (n = rows.length) => rows.slice(0, n).map(([h, l, c], i) => bar(i, h, l, c));
const mirrored = () => rows.map(([h, l, c], i) => bar(i, 100 - l, 100 - h, c === undefined ? undefined : 100 - c));

describe('detectSwings', () => {
  it('finds fractal swings and labels them (lookback 1)', () => {
    const c = [[10, 5], [30, 25], [20, 15], [50, 45], [40, 35]].map(([h, l], i) => bar(i, h, l));
    const s = detectSwings(c, 1);
    expect(s.filter((x) => x.type === 'high').map((x) => [x.index, x.price, x.label])).toEqual([
      [1, 30, null],
      [3, 50, 'HH'],
    ]);
    expect(s.filter((x) => x.type === 'low').map((x) => [x.index, x.price])).toEqual([[2, 15]]);
  });

  it('confirms a swing only lookback candles later (no look-ahead)', () => {
    const c = [[10, 5], [30, 25], [20, 15], [50, 45], [40, 35]].map(([h, l], i) => bar(i, h, l));
    const first = detectSwings(c, 1)[0];
    expect(first.index).toBe(1);
    expect(first.confirmedIndex).toBe(2);
    expect(first.confirmedTimestamp).toBe(2 * 60000);
  });

  it('takes only the first of two equal highs', () => {
    const c = [[10, 5], [20, 15], [20, 15], [10, 5]].map(([h, l], i) => bar(i, h, l));
    expect(detectSwings(c, 1).filter((x) => x.type === 'high').map((x) => x.index)).toEqual([1]);
  });

  it('returns nothing for a series that is too short', () => {
    expect(detectSwings(series(2), 1)).toEqual([]);
  });

  it('rejects an invalid lookback', () => {
    expect(() => detectSwings(series(), 0)).toThrow();
  });
});

describe('detectStructure', () => {
  it('reads a rising zigzag as bullish (HH + HL)', () => {
    const r = detectStructure(series(9), 1);
    expect(r.swings.filter((s) => s.type === 'high').map((s) => s.label)).toEqual([null, 'HH', 'HH', 'HH']);
    expect(r.swings.filter((s) => s.type === 'low').map((s) => s.label)).toEqual([null, 'HL', 'HL']);
    expect(r.trendState).toBe('bullish');
    expect(r.events).toEqual([]); // the first break only sets the trend, no event without context
  });

  it('emits BOS then CHoCH with candle evidence', () => {
    const r = detectStructure(series(), 1);
    expect(r.events).toEqual([
      { type: 'BOS', direction: 'bullish', price: 34, timestamp: 9 * 60000, isoTime: new Date(9 * 60000).toISOString(), closePrice: 39, brokenSwingTimestamp: 7 * 60000 },
      { type: 'CHoCH', direction: 'bearish', price: 19, timestamp: 10 * 60000, isoTime: new Date(10 * 60000).toISOString(), closePrice: 15, brokenSwingTimestamp: 6 * 60000 },
    ]);
    expect(r.lastEvent?.type).toBe('CHoCH');
  });

  it('is symmetric on the mirrored series (bearish trend, BOS down, CHoCH up)', () => {
    const r = detectStructure(mirrored(), 1);
    expect(r.events.map((e) => [e.type, e.direction, e.price])).toEqual([
      ['BOS', 'bearish', 66],
      ['CHoCH', 'bullish', 81],
    ]);
    expect(detectStructure(mirrored().slice(0, 9), 1).trendState).toBe('bearish');
  });

  it('does not count a wick beyond a swing without a close beyond it', () => {
    const rowsWick: Array<[number, number, number?]> = [...rows.slice(0, 9), [40, 30, 33]]; // high 40 > 34 but close 33 < 34
    const c = rowsWick.map(([h, l, cl], i) => bar(i, h, l, cl));
    expect(detectStructure(c, 1).events).toEqual([]);
  });

  it('reports undetermined when there is no structure yet', () => {
    expect(detectStructure(series(3), 1).trendState).toBe('undetermined');
  });
});
