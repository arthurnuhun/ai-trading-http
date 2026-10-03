import { describe, it, expect } from 'vitest';
import { ema, rsi, atr, macd, computeSnapshot } from '../src/analysis/indicators.js';
import type { Candle } from '../src/types.js';

const mkCandle = (i: number, o: number, h: number, l: number, c: number): Candle => ({
  timestamp: i * 60000,
  isoTime: new Date(i * 60000).toISOString(),
  open: o,
  high: h,
  low: l,
  close: c,
  volume: 1,
});
const ramp = (n: number, start = 100, step = 1): Candle[] =>
  Array.from({ length: n }, (_, i) => {
    const c = start + i * step;
    return mkCandle(i, c - 0.2, c + 0.5, c - 0.5, c);
  });

describe('ema', () => {
  it('seeds with SMA and applies k = 2/(n+1) (hand-computed)', () => {
    // period 3: seed (1+2+3)/3 = 2; k = 0.5 -> 3, 4
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });
  it('returns all null when history is too short', () => {
    expect(ema([1, 2], 3)).toEqual([null, null]);
  });
});

describe('rsi', () => {
  it('matches a hand-computed Wilder example (period 2)', () => {
    // changes +1,-1,+2 -> avgGain/avgLoss = 0.5/0.5 -> RSI 50; then 1.25/0.25 -> RS 5 -> 83.333
    const r = rsi([10, 11, 10, 12], 2);
    expect(r[0]).toBeNull();
    expect(r[1]).toBeNull();
    expect(r[2]).toBeCloseTo(50, 6);
    expect(r[3]).toBeCloseTo(83.3333333, 5);
  });
  it('is 100 for a strictly rising series and 0 for a strictly falling one', () => {
    const up = Array.from({ length: 30 }, (_, i) => 100 + i);
    const down = Array.from({ length: 30 }, (_, i) => 100 - i);
    expect(rsi(up, 14).at(-1)).toBe(100);
    expect(rsi(down, 14).at(-1)).toBe(0);
  });
  it('is 50 for a flat series', () => {
    expect(rsi(new Array(30).fill(100), 14).at(-1)).toBe(50);
  });
  it('has first value at index = period', () => {
    const r = rsi(Array.from({ length: 20 }, (_, i) => 100 + (i % 3)), 14);
    expect(r[13]).toBeNull();
    expect(r[14]).not.toBeNull();
  });
});

describe('atr', () => {
  it('matches a hand-computed Wilder example (period 2)', () => {
    // TR = [2, 2, 4]; seed avg(2,2)=2; next (2*1+4)/2 = 3
    const candles = [mkCandle(0, 9, 10, 8, 9), mkCandle(1, 9, 11, 9, 10), mkCandle(2, 10, 14, 10, 13)];
    const a = atr(candles, 2);
    expect(a[0]).toBeNull();
    expect(a[1]).toBeCloseTo(2, 9);
    expect(a[2]).toBeCloseTo(3, 9);
  });
  it('uses the gap from the previous close in true range', () => {
    // second candle gaps up: high-low = 1, but |high - prevClose| = 5
    const candles = [mkCandle(0, 10, 10, 9, 10), mkCandle(1, 14, 15, 14, 15)];
    expect(atr(candles, 2)[1]).toBeCloseTo((1 + 5) / 2, 9);
  });
});

describe('macd', () => {
  it('is zero for a constant series', () => {
    const m = macd(new Array(60).fill(100));
    expect(m.macd.at(-1)).toBeCloseTo(0, 9);
    expect(m.histogram.at(-1)).toBeCloseTo(0, 9);
  });
  it('aligns warm-up: macd at slow-1, signal and histogram at slow-1+signal-1', () => {
    const closes = Array.from({ length: 50 }, (_, i) => 100 + i);
    const m = macd(closes);
    expect(m.macd[24]).toBeNull();
    expect(m.macd[25]).not.toBeNull();
    expect(m.signal[32]).toBeNull();
    expect(m.signal[33]).not.toBeNull();
    expect(m.histogram[33]).toBeCloseTo((m.macd[33] as number) - (m.signal[33] as number), 9);
    expect(m.macd).toHaveLength(50);
  });
  it('is positive on a rising ramp', () => {
    const m = macd(Array.from({ length: 60 }, (_, i) => 100 + i));
    expect(m.macd.at(-1) as number).toBeGreaterThan(0);
  });
});

describe('computeSnapshot', () => {
  it('leaves EMA200 null with too little history and fills it with enough', () => {
    expect(computeSnapshot(ramp(100)).ema.ema200).toBeNull();
    const full = computeSnapshot(ramp(250));
    expect(full.ema.ema200).not.toBeNull();
    expect(full.rsi14).toBe(100);
    expect(full.candlesUsed).toBe(250);
  });
  it('orders EMAs on a rising ramp: ema20 > ema50 > ema100 > ema200', () => {
    const e = computeSnapshot(ramp(300)).ema;
    expect(e.ema20! > e.ema50!).toBe(true);
    expect(e.ema50! > e.ema100!).toBe(true);
    expect(e.ema100! > e.ema200!).toBe(true);
  });
});
