import { describe, it, expect } from 'vitest';
import { detectPatterns, scanPatterns } from '../src/analysis/candle-patterns.js';
import type { Candle } from '../src/types.js';

const c = (o: number, h: number, l: number, cl: number, i = 0): Candle => ({
  timestamp: i * 60000,
  isoTime: new Date(i * 60000).toISOString(),
  open: o,
  high: h,
  low: l,
  close: cl,
  volume: 1,
});

describe('doji', () => {
  it('body at most 10% of range', () => {
    expect(detectPatterns(c(100, 105, 95, 100.1)).doji).toBe(true); // body 0.1, range 10
    expect(detectPatterns(c(100, 105, 95, 101.5)).doji).toBe(false); // body 1.5 > 1
  });
  it('a zero-range candle is not a doji', () => {
    expect(detectPatterns(c(100, 100, 100, 100)).doji).toBe(false);
  });
});

describe('pin bar', () => {
  it('long lower wick is bullish', () => {
    expect(detectPatterns(c(100, 101, 90, 100.5)).pinBar).toBe('bullish'); // lower 10 of range 11
  });
  it('long upper wick is bearish', () => {
    expect(detectPatterns(c(100, 110, 99, 99.5)).pinBar).toBe('bearish'); // upper 10 of range 11
  });
  it('a balanced candle is no pin bar', () => {
    expect(detectPatterns(c(100, 105, 99, 104)).pinBar).toBeNull();
  });
});

describe('engulfing', () => {
  it('bullish: bigger green body wraps the previous red body', () => {
    expect(detectPatterns(c(99, 108, 98, 107), c(105, 106, 99, 100)).engulfing).toBe('bullish');
  });
  it('bearish: bigger red body wraps the previous green body', () => {
    expect(detectPatterns(c(106, 107, 97, 98), c(100, 106, 99, 105)).engulfing).toBe('bearish');
  });
  it('requires a bigger body', () => {
    expect(detectPatterns(c(99.5, 104, 99, 103), c(105, 106, 99, 100)).engulfing).toBeNull();
  });
  it('needs a previous candle', () => {
    expect(detectPatterns(c(99, 108, 98, 107)).engulfing).toBeNull();
  });
});

describe('scanPatterns', () => {
  it('lists only candles with a pattern among the last n', () => {
    const series = [c(100, 105, 95, 100.1, 0), c(100, 104, 99, 103, 1), c(100, 101, 90, 100.5, 2)];
    expect(scanPatterns(series, 3).map((h) => h.index)).toEqual([0, 2]);
    expect(scanPatterns(series, 1).map((h) => h.index)).toEqual([2]);
  });
});
