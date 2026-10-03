import { describe, it, expect } from 'vitest';
import { detectOrderBlocks } from '../src/analysis/order-blocks.js';
import type { StructureEvent } from '../src/analysis/market-structure.js';
import type { Candle } from '../src/types.js';

type Row = [number, number, number, number];
const mk = (rows: Row[]): Candle[] =>
  rows.map(([o, h, l, cl], i) => ({ timestamp: i * 60000, isoTime: new Date(i * 60000).toISOString(), open: o, high: h, low: l, close: cl, volume: 1 }));
const mirror = (rows: Row[]): Row[] => rows.map(([o, h, l, cl]) => [200 - o, 200 - l, 200 - h, 200 - cl]);

const base: Row[] = [
  [10, 12, 9, 11],
  [11, 20, 10, 19], // swing high 20
  [19, 19, 15, 16], // bearish
  [16, 16, 12, 13], // bearish, lowest low 12
  [13, 18, 12.5, 17],
  [17, 23, 16.5, 22], // closes above 20: break
];
const mitigate: Row = [22, 22.5, 15.5, 16]; // trades into the zone, close stays above it
const invalidate: Row = [16, 16, 10, 11]; // closes below the zone

const bullEvent = (price = 20, close = 22): StructureEvent => ({
  type: 'BOS', direction: 'bullish', price, timestamp: 5 * 60000, isoTime: '', closePrice: close, brokenSwingTimestamp: 60000,
});
const bearEvent: StructureEvent = { ...bullEvent(180, 178), direction: 'bearish' };

describe('detectOrderBlocks', () => {
  it('bullish: last bearish candle at the lowest point before the break', () => {
    const ob = detectOrderBlocks(mk(base), [bullEvent()]);
    expect(ob).toHaveLength(1);
    expect(ob[0]).toMatchObject({
      direction: 'bullish', high: 16, low: 12, bodyHigh: 16, bodyLow: 13, timestamp: 3 * 60000,
      causedBy: { type: 'BOS', timestamp: 5 * 60000, price: 20 }, status: 'unmitigated',
    });
  });
  it('tracks mitigation and invalidation', () => {
    expect(detectOrderBlocks(mk([...base, mitigate]), [bullEvent()])[0].status).toBe('mitigated');
    expect(detectOrderBlocks(mk([...base, mitigate, invalidate]), [bullEvent()])[0].status).toBe('invalidated');
  });
  it('walks back to an earlier bearish candle when the lowest candle is bullish', () => {
    const rows = base.map((r) => [...r] as Row);
    rows[3] = [12.5, 14.5, 12, 14]; // lowest low but bullish
    const ob = detectOrderBlocks(mk(rows), [bullEvent()]);
    expect(ob[0]).toMatchObject({ timestamp: 2 * 60000, high: 19, low: 15 });
  });
  it('bearish mirror: last bullish candle at the highest point, with the same statuses', () => {
    const m = mirror(base);
    const ob = detectOrderBlocks(mk(m), [bearEvent]);
    expect(ob[0]).toMatchObject({ direction: 'bearish', high: 188, low: 184, bodyHigh: 187, bodyLow: 184, timestamp: 3 * 60000, status: 'unmitigated' });
    expect(detectOrderBlocks(mk([...m, mirror([mitigate])[0]]), [bearEvent])[0].status).toBe('mitigated');
    expect(detectOrderBlocks(mk([...m, mirror([mitigate])[0], mirror([invalidate])[0]]), [bearEvent])[0].status).toBe('invalidated');
  });
  it('skips events whose broken swing is unknown or adjacent to the break', () => {
    expect(detectOrderBlocks(mk(base), [{ ...bullEvent(), brokenSwingTimestamp: 999 }])).toEqual([]);
    expect(detectOrderBlocks(mk(base), [{ ...bullEvent(), brokenSwingTimestamp: 4 * 60000 }])).toEqual([]);
  });
  it('does not return the same candle twice for the same direction', () => {
    expect(detectOrderBlocks(mk(base), [bullEvent(), bullEvent()])).toHaveLength(1);
  });
});
