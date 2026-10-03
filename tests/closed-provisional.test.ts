import { describe, it, expect } from 'vitest';
import { splitClosed } from '../src/analysis/closed-candles.js';
import { provisionalSwings } from '../src/analysis/provisional.js';
import type { StructureResult } from '../src/analysis/market-structure.js';
import type { Candle } from '../src/types.js';

const M5 = 300_000;
const at = (ts: number): Candle => ({ timestamp: ts, isoTime: new Date(ts).toISOString(), open: 100, high: 101, low: 99, close: 100, volume: 1 });

describe('splitClosed', () => {
  const series = [at(0), at(M5)];
  it('treats the newest candle as forming until its period has elapsed', () => {
    const r = splitClosed(series, 'M5', M5 + M5 - 1);
    expect(r.closed).toHaveLength(1);
    expect(r.forming?.timestamp).toBe(M5);
  });
  it('treats it as closed exactly when the period has elapsed', () => {
    const r = splitClosed(series, 'M5', M5 + M5);
    expect(r.closed).toHaveLength(2);
    expect(r.forming).toBeNull();
  });
  it('uses the timeframe length (H1 candle is still forming after 5 minutes)', () => {
    const r = splitClosed([at(0)], 'H1', M5);
    expect(r.closed).toHaveLength(0);
    expect(r.forming).not.toBeNull();
  });
  it('handles an empty series', () => {
    expect(splitClosed([], 'M5', 0)).toEqual({ closed: [], forming: null });
  });
});

const cd = (i: number, h: number, l: number): Candle => ({
  timestamp: i * 60000, isoTime: new Date(i * 60000).toISOString(), open: (h + l) / 2, high: h, low: l, close: (h + l) / 2, volume: 1,
});
const fakeStructure = (high?: number, low?: number) =>
  ({ lastSwingHigh: high === undefined ? null : { index: high }, lastSwingLow: low === undefined ? null : { index: low } }) as unknown as StructureResult;

describe('provisionalSwings', () => {
  // (high, low) per candle
  const rows: Array<[number, number]> = [[10, 8], [11, 9], [12, 9.5], [10, 8], [12, 9], [11, 7], [11.5, 7.5]];
  const candles = rows.map(([h, l], i) => cd(i, h, l));

  it('finds the highest high and lowest low after the latest confirmed swing', () => {
    const p = provisionalSwings(candles, fakeStructure(2, 1)); // anchor = index 2
    expect(p.anchorTimestamp).toBe(2 * 60000);
    expect(p.high).toMatchObject({ price: 12, index: 4, timestamp: 4 * 60000, confirmed: false });
    expect(p.low).toMatchObject({ price: 7, index: 5, timestamp: 5 * 60000, confirmed: false });
  });
  it('returns nothing when the latest swing is the last candle or there are no swings', () => {
    expect(provisionalSwings(candles, fakeStructure(6))).toMatchObject({ high: null, low: null });
    expect(provisionalSwings(candles, fakeStructure())).toEqual({ anchorTimestamp: null, high: null, low: null });
  });
});
