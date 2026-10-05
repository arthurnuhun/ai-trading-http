import { describe, it, expect } from 'vitest';
import { AppError } from '../src/errors.js';
import { createTvSnapshotLoader, SNAPSHOT_CANDLES, type CandleSource } from '../src/providers/macro/tv-snapshot.js';
import type { CandleResult } from '../src/providers/tradingview/adapter.js';

const H = 3_600_000;
const NOW = Date.parse('2026-10-05T12:30:00Z');
const FORMING_OPEN = Date.parse('2026-10-05T12:00:00Z');

function candles(count: number, closeOf: (k: number) => number) {
  return Array.from({ length: count }, (_, k) => {
    const ts = FORMING_OPEN - (count - 1 - k) * H;
    const c = closeOf(k);
    return { timestamp: ts, isoTime: new Date(ts).toISOString(), open: c, high: c, low: c, close: c, volume: 1 };
  });
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
    ageSeconds: 1790,
    latencyMs: 5,
    cached: false,
    quality: { received: cs.length, accepted: cs.length, malformed: 0, duplicates: 0, future: 0, nonMonotonic: 0 },
    ...over,
  } as CandleResult;
}

function fakeSource(outcome: CandleResult | Error) {
  const calls: Array<[string, number | undefined]> = [];
  return {
    calls,
    async getCandles(tf: string, limit?: number) {
      calls.push([tf, limit]);
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  } as unknown as CandleSource & { calls: Array<[string, number | undefined]> };
}

const load = (src: CandleSource) => createTvSnapshotLoader(src, { now: () => NOW })() as Promise<any>;

describe('TradingView macro snapshot', () => {
  it('maps candles to price, changes and direction', async () => {
    const item = await load(fakeSource(result(candles(130, (k) => 100 + k))));
    expect(item.available).toBe(true);
    expect(item.source).toBe('tradingview');
    const d = item.data;
    expect(d.symbol).toBe('TVC:DXY');
    expect(d.price).toBe(229);
    expect(d.priceSource).toBe('h1_latest_candle_close');
    const by = (bars: number) => d.changes.find((c: any) => c.bars === bars);
    expect(by(1).baselineClose).toBe(228);
    expect(by(1).absolute).toBe(1);
    expect(by(24).baselineClose).toBe(205);
    expect(by(24).absolute).toBe(24);
    expect(by(24).percent).toBeCloseTo(11.707, 3);
    expect(by(120).baselineClose).toBe(109);
    expect(by(120).absolute).toBe(120);
    expect(d.direction24h).toBe('up');
  });

  it('requests H1 candles with the snapshot limit', async () => {
    const src = fakeSource(result(candles(130, (k) => 100 + k)));
    await load(src);
    expect(src.calls).toEqual([['H1', SNAPSHOT_CANDLES]]);
  });

  it('excludes the forming candle from closed candles', async () => {
    const item = await load(fakeSource(result(candles(130, (k) => 100 + k))));
    expect(item.data.lastClosedH1.openTime).toBe('2026-10-05T11:00:00.000Z');
    expect(item.data.lastClosedH1.close).toBe(228);
    expect(item.data.latestCandleTime).toBe('2026-10-05T12:00:00.000Z');
    expect(item.data.changes.find((c: any) => c.bars === 24).baselineTime).toBe('2026-10-04T13:00:00.000Z');
  });

  it('returns null changes when there are not enough closed candles', async () => {
    const item = await load(fakeSource(result(candles(10, (k) => 100 + k))));
    const by = (bars: number) => item.data.changes.find((c: any) => c.bars === bars);
    expect(by(1).absolute).toBe(1);
    expect(by(24).absolute).toBeNull();
    expect(by(120).absolute).toBeNull();
    expect(item.data.direction24h).toBeNull();
  });

  it('reports down and flat directions', async () => {
    const down = await load(fakeSource(result(candles(130, (k) => (k === 129 ? 90 : 100 + k)))));
    expect(down.data.direction24h).toBe('down');
    const flat = await load(fakeSource(result(candles(130, (k) => (k === 129 ? 205 : 100 + k)))));
    expect(flat.data.direction24h).toBe('flat');
  });

  it('surfaces freshness flags and candle quality', async () => {
    const item = await load(
      fakeSource(result(candles(130, (k) => 100 + k), { stale: true, staleReason: 'old_candle', marketOpen: false })),
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
    const item = await load(fakeSource(result([])));
    expect(item).toEqual({ available: false, reason: 'no candles' });
  });
});
