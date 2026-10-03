import { describe, it, expect } from 'vitest';
import { normalizePeriods } from '../src/providers/tradingview/normalize.js';

const NOW = Date.UTC(2026, 9, 3);
// Real H4 sample from the live smoke test
const real = { time: 1790960400, open: 4138.935, close: 4140.52, max: 4149.905, min: 4130.18, volume: 109389 };
const mk = (time: number, extra: object = {}) => ({ ...real, time, ...extra });

describe('normalizePeriods', () => {
  it('maps max/min to high/low and time to epoch ms', () => {
    const { candles } = normalizePeriods([real], NOW);
    expect(candles[0]).toMatchObject({ high: 4149.905, low: 4130.18, open: 4138.935, close: 4140.52, volume: 109389 });
    expect(candles[0].timestamp).toBe(1790960400 * 1000);
    expect(candles[0].isoTime).toBe('2026-10-02T17:00:00.000Z');
  });

  it('returns ascending order from newest-first input without flagging it', () => {
    const { candles, stats } = normalizePeriods([mk(1790960400), mk(1790946000)], NOW);
    expect(candles.map((c) => c.timestamp)).toEqual([1790946000000, 1790960400000]);
    expect(stats.nonMonotonic).toBe(0);
  });

  it('flags input that is not newest-first', () => {
    const { stats } = normalizePeriods([mk(1790946000), mk(1790960400)], NOW);
    expect(stats.nonMonotonic).toBe(1);
  });

  it('drops malformed candles', () => {
    const { candles, stats } = normalizePeriods(
      [real, mk(1790946000, { open: NaN }), mk(1790931600, { max: 1 }), mk(1790917200, { min: -5 })],
      NOW,
    );
    expect(candles).toHaveLength(1);
    expect(stats.malformed).toBe(3);
  });

  it('removes duplicates', () => {
    const { candles, stats } = normalizePeriods([real, real], NOW);
    expect(candles).toHaveLength(1);
    expect(stats.duplicates).toBe(1);
  });

  it('drops future candles', () => {
    const { candles, stats } = normalizePeriods([mk(Math.floor(NOW / 1000) + 3600)], NOW);
    expect(candles).toHaveLength(0);
    expect(stats.future).toBe(1);
  });

  it('keeps large time gaps (market closure is not corruption)', () => {
    const { candles, stats } = normalizePeriods([mk(1790960400), mk(1790960400 - 187200)], NOW);
    expect(candles).toHaveLength(2);
    expect(stats.malformed + stats.duplicates + stats.future).toBe(0);
  });
});
