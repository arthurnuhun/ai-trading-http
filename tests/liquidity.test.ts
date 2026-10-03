import { describe, it, expect } from 'vitest';
import { findUnsweptLiquidity, groupEqualLevels, detectSweeps, inducementCandidates } from '../src/analysis/liquidity.js';
import type { Swing, StructureResult } from '../src/analysis/market-structure.js';
import type { Candle } from '../src/types.js';

type Row = [number, number, number, number];
const mk = (rows: Row[]): Candle[] =>
  rows.map(([o, h, l, cl], i) => ({ timestamp: i * 60000, isoTime: new Date(i * 60000).toISOString(), open: o, high: h, low: l, close: cl, volume: 1 }));
const mirror = (rows: Row[]): Row[] => rows.map(([o, h, l, cl]) => [200 - o, 200 - l, 200 - h, 200 - cl]);
const swing = (type: 'high' | 'low', index: number, price: number): Swing => ({
  type, index, timestamp: index * 60000, isoTime: new Date(index * 60000).toISOString(), price,
  confirmedIndex: index + 1, confirmedTimestamp: (index + 1) * 60000, label: null,
});

const rows: Row[] = [
  [100, 102, 99, 101],
  [101, 105, 100, 104], // swing high 105
  [104, 104.5, 102, 103],
  [103, 107, 102.5, 104], // wicks to 107, closes 104 <= 105: sweep
  [104, 104.2, 101, 101.5], // closes below sweep candle low 102.5: reversal confirmed
];

describe('detectSweeps', () => {
  it('detects a BSL sweep with confirmed reversal and candle evidence', () => {
    expect(detectSweeps(mk(rows), [swing('high', 1, 105)])).toEqual([
      {
        type: 'BSL_sweep', level: 105, levelTimestamp: 60000, timestamp: 180000,
        isoTime: new Date(180000).toISOString(), extreme: 107, closePrice: 104,
        reversalConfirmed: true, reversalTimestamp: 240000,
      },
    ]);
  });
  it('mirrors to an SSL sweep', () => {
    const s = detectSweeps(mk(mirror(rows)), [swing('low', 1, 95)]);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ type: 'SSL_sweep', level: 95, extreme: 93, closePrice: 96, reversalConfirmed: true, reversalTimestamp: 240000 });
  });
  it('reports a sweep without confirmation when no close passes the opposite extreme', () => {
    const r = rows.map((x) => [...x] as Row);
    r[4] = [104, 104.2, 101, 103];
    expect(detectSweeps(mk(r), [swing('high', 1, 105)])[0]).toMatchObject({ reversalConfirmed: false, reversalTimestamp: null });
  });
  it('a close beyond the level is a break, not a sweep', () => {
    const r = rows.map((x) => [...x] as Row);
    r[3] = [103, 107, 102.5, 106];
    expect(detectSweeps(mk(r), [swing('high', 1, 105)])).toEqual([]);
  });
  it('only the first breach of a swing counts', () => {
    const r: Row[] = [...rows, [104, 108, 103, 104.5]]; // breaches 105 again later
    expect(detectSweeps(mk(r), [swing('high', 1, 105)])).toHaveLength(1);
  });
});

describe('findUnsweptLiquidity', () => {
  it('keeps only levels price has not traded beyond', () => {
    const out = findUnsweptLiquidity([swing('high', 1, 105), swing('high', 3, 107)], mk(rows));
    expect(out).toEqual([{ side: 'BSL', price: 107, timestamp: 180000, isoTime: new Date(180000).toISOString() }]);
  });
  it('treats a swing low as SSL', () => {
    const out = findUnsweptLiquidity([swing('low', 1, 90)], mk(rows));
    expect(out[0]).toMatchObject({ side: 'SSL', price: 90 });
  });
});

describe('groupEqualLevels', () => {
  const lv = (side: 'BSL' | 'SSL', price: number, t: number) => ({ side, price, timestamp: t, isoTime: '' });
  it('forms pools from two or more same-side levels within tolerance', () => {
    const pools = groupEqualLevels(
      [lv('BSL', 107, 1), lv('BSL', 107.3, 2), lv('BSL', 110, 3), lv('SSL', 90, 4), lv('SSL', 90.2, 5)],
      0.5,
    );
    expect(pools.map((p) => [p.side, p.price, p.count])).toEqual([['BSL', 107.3, 2], ['SSL', 90, 2]]);
  });
  it('returns nothing for a non-positive tolerance', () => {
    expect(groupEqualLevels([lv('BSL', 107, 1), lv('BSL', 107.1, 2)], 0)).toEqual([]);
  });
});

describe('inducementCandidates', () => {
  it('returns sweeps of minor swings after the last major swing (candidates only)', () => {
    const structure = { lastSwingHigh: swing('high', 0, 102), lastSwingLow: null } as unknown as StructureResult;
    const out = inducementCandidates(mk(rows), structure);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'BSL_sweep', level: 105 });
  });
  it('returns nothing without a major swing', () => {
    const structure = { lastSwingHigh: null, lastSwingLow: null } as unknown as StructureResult;
    expect(inducementCandidates(mk(rows), structure)).toEqual([]);
  });
});
