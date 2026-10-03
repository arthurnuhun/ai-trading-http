import { describe, it, expect } from 'vitest';
import { detectFvgs } from '../src/analysis/fvg.js';
import type { Candle } from '../src/types.js';

type Row = [number, number, number, number]; // o, h, l, c
const mk = (rows: Row[]): Candle[] =>
  rows.map(([o, h, l, cl], i) => ({ timestamp: i * 60000, isoTime: new Date(i * 60000).toISOString(), open: o, high: h, low: l, close: cl, volume: 1 }));
const mirror = (rows: Row[]): Row[] => rows.map(([o, h, l, cl]) => [200 - o, 200 - l, 200 - h, 200 - cl]);

const rows: Row[] = [
  [9, 10, 8, 9.5],
  [10, 16, 9.5, 15],
  [15, 18, 12, 17], // low 12 > first high 10 -> bullish gap [10, 12]
  [17, 17.5, 11, 12.5], // dips to 11: partially filled
  [12.5, 13, 9.8, 10], // reaches 9.8 <= 10: filled
];

describe('detectFvgs', () => {
  it('finds a bullish gap and reports it as open', () => {
    const f = detectFvgs(mk(rows.slice(0, 3)));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ direction: 'bullish', low: 10, high: 12, size: 2, status: 'open', timestamp: 60000, confirmedTimestamp: 120000 });
  });
  it('tracks partial and full fills', () => {
    expect(detectFvgs(mk(rows.slice(0, 4)))[0].status).toBe('partially_filled');
    expect(detectFvgs(mk(rows))[0].status).toBe('filled');
  });
  it('mirrors into a bearish gap [188, 190]', () => {
    const f = detectFvgs(mk(mirror(rows.slice(0, 3))));
    expect(f[0]).toMatchObject({ direction: 'bearish', low: 188, high: 190, size: 2, status: 'open' });
    expect(detectFvgs(mk(mirror(rows.slice(0, 4))))[0].status).toBe('partially_filled');
    expect(detectFvgs(mk(mirror(rows)))[0].status).toBe('filled');
  });
  it('ignores overlapping candles and gaps not larger than minSize', () => {
    expect(detectFvgs(mk([[9, 10, 8, 9], [9, 12, 9, 11], [11, 13, 9.5, 12]]))).toEqual([]);
    expect(detectFvgs(mk(rows.slice(0, 3)), 2)).toEqual([]);
    expect(detectFvgs(mk(rows.slice(0, 3)), 1)).toHaveLength(1);
  });
});
