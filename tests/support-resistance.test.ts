import { describe, it, expect } from 'vitest';
import { clusterLevels, nearestLevels, psychologicalLevels, recentRange } from '../src/analysis/support-resistance.js';
import type { Swing } from '../src/analysis/market-structure.js';
import type { Candle } from '../src/types.js';

const sw = (type: 'high' | 'low', index: number, price: number): Swing => ({
  type,
  index,
  timestamp: index * 60000,
  isoTime: new Date(index * 60000).toISOString(),
  price,
  confirmedIndex: index + 1,
  confirmedTimestamp: (index + 1) * 60000,
  label: null,
});
const bar = (i: number, close: number): Candle => ({
  timestamp: i * 60000,
  isoTime: new Date(i * 60000).toISOString(),
  open: close,
  high: close + 0.5,
  low: close - 0.5,
  close,
  volume: 1,
});
const flat = (n: number, close: number) => Array.from({ length: n }, (_, i) => bar(i, close));

describe('clusterLevels', () => {
  it('merges close swings, counts touches and orders highest first', () => {
    const levels = clusterLevels([sw('high', 1, 100), sw('high', 5, 100.3), sw('low', 3, 90)], flat(10, 95), 95, 0.5);
    expect(levels).toHaveLength(2);
    expect(levels[0]).toMatchObject({ kind: 'resistance', origin: 'swing_high', touches: 2, zoneLow: 100, zoneHigh: 100.3 });
    expect(levels[0].price).toBeCloseTo(100.15, 3);
    expect(levels[1]).toMatchObject({ kind: 'support', origin: 'swing_low', touches: 1, price: 90 });
  });

  it('does not chain beyond the tolerance measured from the cluster anchor', () => {
    const levels = clusterLevels([sw('high', 1, 100), sw('high', 2, 100.4), sw('high', 3, 100.8)], flat(5, 95), 95, 0.5);
    expect(levels.map((l) => l.touches).sort()).toEqual([1, 2]);
  });

  it('flags a broken resistance that now sits below price as flipped support', () => {
    const candles = [...flat(3, 95), ...Array.from({ length: 6 }, (_, i) => bar(3 + i, 105))];
    const [lvl] = clusterLevels([sw('high', 2, 100)], candles, 105, 0.5);
    expect(lvl).toMatchObject({ kind: 'support', origin: 'swing_high', flipped: true });
  });

  it('flags a broken support that now sits above price as flipped resistance', () => {
    const candles = [...flat(3, 105), ...Array.from({ length: 6 }, (_, i) => bar(3 + i, 95))];
    const [lvl] = clusterLevels([sw('low', 2, 100)], candles, 95, 0.5);
    expect(lvl).toMatchObject({ kind: 'resistance', origin: 'swing_low', flipped: true });
  });

  it('does not flag an untouched resistance or a mixed zone', () => {
    const [res] = clusterLevels([sw('high', 2, 100)], flat(6, 95), 95, 0.5);
    expect(res.flipped).toBe(false);
    const [mixed] = clusterLevels([sw('high', 2, 100), sw('low', 3, 100.2)], flat(6, 95), 95, 0.5);
    expect(mixed).toMatchObject({ origin: 'mixed', flipped: false });
  });

  it('returns nothing for a non-positive tolerance or no swings', () => {
    expect(clusterLevels([sw('high', 1, 100)], flat(3, 95), 95, 0)).toEqual([]);
    expect(clusterLevels([], flat(3, 95), 95, 1)).toEqual([]);
  });
});

describe('nearestLevels', () => {
  it('keeps the closest levels on each side of price', () => {
    const swings = [110, 120, 130].map((p, i) => sw('high', i + 1, p)).concat([90, 80, 70].map((p, i) => sw('low', i + 5, p)));
    const near = nearestLevels(clusterLevels(swings, flat(10, 100), 100, 1), 2);
    expect(near.map((l) => l.price)).toEqual([120, 110, 90, 80]);
  });
});

describe('psychologicalLevels', () => {
  it('returns round levels around the price and marks multiples of 100 as major', () => {
    const lv = psychologicalLevels(4140.52, 2);
    expect(lv.map((l) => l.price)).toEqual([4050, 4100, 4150, 4200]);
    expect(lv.map((l) => l.major)).toEqual([false, true, false, true]);
    expect(lv[1].distance).toBeCloseTo(-40.52, 3);
  });
  it('includes the level itself when price is exactly on it', () => {
    const lv = psychologicalLevels(4150, 2);
    expect(lv.map((l) => l.price)).toEqual([4100, 4150, 4200, 4250]);
    expect(lv[1].distance).toBe(0);
  });
});

describe('recentRange', () => {
  it('finds the highest high and lowest low among the last n candles', () => {
    const c = [bar(0, 200), bar(1, 100), bar(2, 120), bar(3, 110)]; // bar 0 is outside n=3
    const r = recentRange(c, 3)!;
    expect(r.candles).toBe(3);
    expect(r.high).toMatchObject({ price: 120.5, timestamp: 2 * 60000 });
    expect(r.low).toMatchObject({ price: 99.5, timestamp: 60000 });
  });
  it('returns null for no candles', () => {
    expect(recentRange([], 10)).toBeNull();
  });
});
