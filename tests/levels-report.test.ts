import { describe, it, expect } from 'vitest';
import { buildLevelsReport, inZone, nearestByDistance, sweepPenetration, zoneWidth } from '../src/analysis/levels-report.js';
import { fibonacci } from '../src/analysis/fibonacci.js';
import type { Candle } from '../src/types.js';

function sine(n: number): Candle[] {
  const out: Candle[] = [];
  let prev = 100;
  for (let i = 0; i < n; i++) {
    const close = 100 + 10 * Math.sin((2 * Math.PI * i) / 20);
    out.push({
      timestamp: i * 300_000,
      isoTime: new Date(i * 300_000).toISOString(),
      open: prev,
      high: Math.max(prev, close) + 0.5,
      low: Math.min(prev, close) - 0.5,
      close,
      volume: 1,
    });
    prev = close;
  }
  return out;
}

describe('helpers', () => {
  it('inZone includes both bounds', () => {
    expect(inZone(10, 10, 12)).toBe(true);
    expect(inZone(12, 10, 12)).toBe(true);
    expect(inZone(9.99, 10, 12)).toBe(false);
    expect(inZone(12.01, 10, 12)).toBe(false);
  });
  it('nearestByDistance orders by distance and keeps ties stable', () => {
    const items = [100, 110, 95, 130]; // distances from 105: 5, 5, 10, 25
    expect(nearestByDistance(items, 105, (x) => x, 2)).toEqual([100, 110]);
    expect(nearestByDistance(items, 105, (x) => x, 3)).toEqual([100, 110, 95]);
  });
  it('zoneWidth flags zones wider than 2 ATR', () => {
    expect(zoneWidth(100, 110, 4)).toEqual({ width: 10, widthAtr: 2.5, wide: true });
    expect(zoneWidth(100, 108, 4)).toEqual({ width: 8, widthAtr: 2, wide: false });
  });
  it('sweepPenetration reports wick penetration and close distance in price and ATR', () => {
    expect(sweepPenetration({ level: 105, extreme: 107, closePrice: 104 }, 4)).toEqual({
      penetration: 2,
      penetrationAtr: 0.5,
      closeInside: 1,
      closeInsideAtr: 0.25,
    });
  });
  it('fibonacci returns null when high and low come from the same candle', () => {
    const p = (price: number) => ({ price, index: 3, timestamp: 180000, isoTime: '' });
    expect(fibonacci(p(110), p(100))).toBeNull();
  });
});

describe('buildLevelsReport', () => {
  it('is unavailable without enough candles for ATR(14)', () => {
    const r = buildLevelsReport(sine(5), 100);
    expect(r.available).toBe(false);
    if (!r.available) expect(r.reason).toMatch(/ATR/);
  });

  it('keeps its invariants on an oscillating series', () => {
    const candles = sine(200);
    const price = candles[199].close;
    const r = buildLevelsReport(candles, price);
    if (!r.available) throw new Error('report unexpectedly unavailable');

    expect(r.price).toBe(price);
    expect(r.atr14).toBeGreaterThan(0);
    expect(r.psychological).toHaveLength(4);
    expect(r.swingHighs.length).toBeGreaterThan(0);
    expect(r.swingLows.length).toBeGreaterThan(0);

    const prices = r.supportResistance.map((l) => l.price);
    expect(prices).toEqual([...prices].sort((a, b) => b - a));
    for (const l of r.supportResistance) {
      expect(l.priceInZone).toBe(price >= l.zoneLow && price <= l.zoneHigh);
      expect(l.distance).toBeCloseTo(l.price - price, 2);
    }
    for (const o of r.orderBlocks) {
      expect(o.status).toBe('unmitigated');
      expect(typeof o.widthAtr).toBe('number');
    }
    for (const f of r.fairValueGaps) expect(f.status).not.toBe('filled');

    expect(r.fibonacci.confirmed).not.toBeNull();
    expect(r.fibonacci.confirmed!.swingHigh.price).toBeGreaterThan(r.fibonacci.confirmed!.swingLow.price);
  });
});
