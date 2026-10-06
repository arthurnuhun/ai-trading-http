import { describe, it, expect } from 'vitest';
import { AppError } from '../src/errors.js';
import {
  createTvSnapshotLoader,
  LAG_CANDLES,
  SNAPSHOT_CANDLES,
  type CandleSource,
} from '../src/providers/macro/tv-snapshot.js';
import type { CandleResult } from '../src/providers/tradingview/adapter.js';

const H = 3_600_000;
const NOW = Date.parse('2026-10-05T12:30:00Z');
const FORMING_OPEN = Date.parse('2026-10-05T12:00:00Z');

const candleAt = (ts: number, c: number) => ({
  timestamp: ts,
  isoTime: new Date(ts).toISOString(),
  open: c,
  high: c,
  low: c,
  close: c,
  volume: 1,
});

function candles(count: number, closeOf: (k: number) => number) {
  return Array.from({ length: count }, (_, k) => candleAt(FORMING_OPEN - (count - 1 - k) * H, closeOf(k)));
}

function result(cs: ReturnType<typeof candles>, over: Partial<CandleResult> = {}): CandleResult {
  return {
    symbol: 'TVC:DXY',
    source: 'tradingview',
    timeframe: 'H1',
    candles: cs,
    latestCandle: cs.at(-1) ?? null,
    fetchedAt: '2026-10-05T12:29:50.000Z',
    latestCandleTime: cs.at(-1)?.isoTime ?? null,
    stale: false,
    staleReason: null,
    note: null,
    marketOpen: true,
    ageSeconds: 1800,
    latencyMs: 5,
    cached: false,
    quality: { received: cs.length, accepted: cs.length, malformed: 0, duplicates: 0, future: 0, nonMonotonic: 0 },
    ...over,
  } as CandleResult;
}

function m5(close: number, ageMin = 2): CandleResult {
  return result([candleAt(NOW - ageMin * 60_000, close)], { timeframe: 'M5' } as Partial<CandleResult>);
}

function fakeSource(h1: CandleResult | Error, m5Out: CandleResult | Error | null = null) {
  const calls: Array<[string, number | undefined]> = [];
  return {
    calls,
    async getCandles(tf: string, limit?: number) {
      calls.push([tf, limit]);
      const out = tf === 'H1' ? h1 : m5Out;
      if (out === null) throw new Error('m5 unavailable');
      if (out instanceof Error) throw out;
      return out;
    },
  } as unknown as CandleSource & { calls: Array<[string, number | undefined]> };
}

const load = (src: CandleSource) => createTvSnapshotLoader(src, { now: () => NOW })() as Promise<any>;
const lin = (k: number) => 100 + k;
const by = (item: any, w: string) => item.data.changes.find((c: any) => c.window === w);

describe('TradingView macro snapshot', () => {
  it('maps candles to price and time-based changes', async () => {
    const item = await load(fakeSource(result(candles(200, lin)), m5(299)));
    expect(item.available).toBe(true);
    expect(item.source).toBe('tradingview');
    const d = item.data;
    expect(d.symbol).toBe('TVC:DXY');
    expect(d.price).toBe(299);
    const day = by(item, '24h');
    expect(day.baselineTime).toBe('2026-10-04T12:00:00.000Z');
    expect(day.baselineClose).toBe(274);
    expect(day.baselineAgeHours).toBe(24.5);
    expect(day.baselineGap).toBe(false);
    expect(day.absolute).toBe(25);
    expect(day.percent).toBeCloseTo(9.124, 3);
    const five = by(item, '5d');
    expect(five.baselineTime).toBe('2026-09-30T12:00:00.000Z');
    expect(five.baselineClose).toBe(178);
    expect(five.absolute).toBe(121);
    expect(five.percent).toBeCloseTo(67.978, 2);
    expect(d.direction24h).toBe('up');
  });

  it('requests H1 and M5 candles with the snapshot limits', async () => {
    const src = fakeSource(result(candles(200, lin)), m5(299));
    await load(src);
    expect(src.calls).toEqual([
      ['H1', SNAPSHOT_CANDLES],
      ['M5', LAG_CANDLES],
    ]);
  });

  it('excludes the forming candle from closed candles', async () => {
    const item = await load(fakeSource(result(candles(200, lin)), m5(299)));
    expect(item.data.lastClosedH1.openTime).toBe('2026-10-05T11:00:00.000Z');
    expect(item.data.lastClosedH1.close).toBe(298);
  });

  it('flags a baseline far older than its window', async () => {
    const cs = [
      candleAt(FORMING_OPEN - 60 * H, 50),
      ...[4, 3, 2, 1, 0].map((h) => candleAt(FORMING_OPEN - h * H, 100 + (4 - h))),
    ];
    const item = await load(fakeSource(result(cs), m5(104)));
    const day = by(item, '24h');
    expect(day.baselineClose).toBe(50);
    expect(day.baselineAgeHours).toBe(59.5);
    expect(day.baselineGap).toBe(true);
    expect(day.absolute).toBe(54);
    expect(by(item, '5d').absolute).toBeNull();
  });

  it('returns null changes when candles do not reach back', async () => {
    const item = await load(fakeSource(result(candles(10, lin)), m5(109)));
    expect(by(item, '24h').absolute).toBeNull();
    expect(by(item, '5d').absolute).toBeNull();
    expect(item.data.direction24h).toBeNull();
  });

  it('reports down and flat directions', async () => {
    const cs = candles(200, (k) => (k === 199 ? 90 : 100 + k));
    const down = await load(fakeSource(result(cs), m5(90)));
    expect(down.data.direction24h).toBe('down');
    const flat = await load(fakeSource(result(candles(200, lin)), m5(274)));
    expect(flat.data.direction24h).toBe('flat');
  });

  it('uses the latest M5 close as price and reports its age', async () => {
    const item = await load(fakeSource(result(candles(200, lin)), m5(300, 7)));
    expect(item.data.price).toBe(300);
    expect(item.data.priceSource).toBe('m5_latest_candle_close');
    expect(item.data.freshness.m5AgeMinutes).toBe(7);
    expect(item.data.freshness.h1AgeMinutes).toBe(30);
    expect(by(item, '24h').absolute).toBe(26);
  });

  it('falls back to the H1 candle when M5 fails', async () => {
    const item = await load(fakeSource(result(candles(200, lin)), null));
    expect(item.available).toBe(true);
    expect(item.data.price).toBe(299);
    expect(item.data.priceSource).toBe('h1_latest_candle_close');
    expect(item.data.freshness.m5AgeMinutes).toBeNull();
  });

  it('surfaces freshness flags and candle quality', async () => {
    const item = await load(
      fakeSource(result(candles(200, lin), { stale: true, staleReason: 'old_candle', marketOpen: false }), m5(299)),
    );
    expect(item.data.freshness.stale).toBe(true);
    expect(item.data.freshness.staleReason).toBe('old_candle');
    expect(item.data.freshness.marketOpen).toBe(false);
    expect(item.data.quality.malformed).toBe(0);
    expect(item.data.limitations.length).toBeGreaterThan(0);
  });

  it('is unavailable with the error code for a rejected symbol', async () => {
    const item = await load(fakeSource(new AppError('INVALID_SYMBOL', 'TradingView rejected the symbol', false)));
    expect(item).toEqual({ available: false, reason: 'INVALID_SYMBOL' });
  });

  it('is unavailable with a generic reason for an unknown error', async () => {
    const item = await load(fakeSource(new Error('secret internal detail')));
    expect(item).toEqual({ available: false, reason: 'provider error' });
  });

  it('is unavailable when there are no candles', async () => {
    const item = await load(fakeSource(result([]), m5(1)));
    expect(item).toEqual({ available: false, reason: 'no candles' });
  });
});
