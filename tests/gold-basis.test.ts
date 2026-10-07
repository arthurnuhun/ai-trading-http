import { describe, expect, it } from 'vitest';
import { createGoldFuturesBasisLoader } from '../src/providers/macro/gold-basis.js';
import type { CandleResult } from '../src/providers/tradingview/adapter.js';

const NOW = Date.parse('2026-10-07T04:45:00Z');
const quality = { received: 12, accepted: 12, malformed: 0, duplicates: 0, future: 0, nonMonotonic: 0 };

function res(symbol: string, close: number, openIso: string, extra: Record<string, unknown> = {}): CandleResult {
  return {
    symbol,
    latestCandle: { timestamp: Date.parse(openIso), isoTime: openIso, close },
    candles: [],
    fetchedAt: '2026-10-07T04:45:00.000Z',
    stale: false,
    staleReason: null,
    marketOpen: true,
    note: null,
    quality,
    ...extra,
  } as unknown as CandleResult;
}
const src = (r: CandleResult | Error) => ({
  getCandles: async () => {
    if (r instanceof Error) throw r;
    return r;
  },
});
const run = (f: CandleResult | Error, s: CandleResult | Error) =>
  createGoldFuturesBasisLoader({ futures: src(f), spot: src(s), now: () => NOW })();

type Data = {
  basis: { absolute: number; percent: number; relation: string };
  alignmentMinutes: number;
  stale: boolean;
  futures: { ageMinutes: number; symbol: string };
  spot: { ageMinutes: number };
};

describe('goldFuturesBasis loader', () => {
  it('computes the basis in price and percent', async () => {
    const r = await run(res('COMEX:GC1!', 4150.5, '2026-10-07T04:40:00Z'), res('OANDA:XAUUSD', 4142.2, '2026-10-07T04:40:00Z'));
    expect(r.available).toBe(true);
    if (r.available) {
      const d = r.data as Data;
      expect(d.basis.absolute).toBeCloseTo(8.3, 3);
      expect(d.basis.percent).toBeCloseTo(0.2, 2);
      expect(d.basis.relation).toBe('futures_above_spot');
      expect(d.futures.symbol).toBe('COMEX:GC1!');
    }
  });

  it('handles a futures price below spot', async () => {
    const r = await run(res('COMEX:GC1!', 4140, '2026-10-07T04:40:00Z'), res('OANDA:XAUUSD', 4142, '2026-10-07T04:40:00Z'));
    expect(r.available).toBe(true);
    if (r.available) expect((r.data as Data).basis.relation).toBe('futures_below_spot');
  });

  it('reports candle ages and alignment', async () => {
    const r = await run(res('F', 4150, '2026-10-07T04:35:00Z'), res('S', 4142, '2026-10-07T04:40:00Z'));
    expect(r.available).toBe(true);
    if (r.available) {
      const d = r.data as Data;
      expect(d.alignmentMinutes).toBe(5);
      expect(d.futures.ageMinutes).toBe(10);
      expect(d.spot.ageMinutes).toBe(5);
    }
  });

  it('withholds the basis when candle times are more than 10 minutes apart', async () => {
    const r = await run(res('F', 4150, '2026-10-07T04:25:00Z'), res('S', 4142, '2026-10-07T04:40:00Z'));
    expect(r).toEqual({ available: false, reason: 'price_times_misaligned_15min' });
  });

  it('is unavailable when the futures source fails', async () => {
    expect(await run(new Error('boom'), res('S', 4142, '2026-10-07T04:40:00Z'))).toEqual({
      available: false,
      reason: 'futures_provider_error',
    });
  });

  it('is unavailable when the spot source fails', async () => {
    expect(await run(res('F', 4150, '2026-10-07T04:40:00Z'), new Error('boom'))).toEqual({
      available: false,
      reason: 'spot_provider_error',
    });
  });

  it('rejects a missing futures candle and an invalid spot price', async () => {
    expect(await run(res('F', 4150, '2026-10-07T04:40:00Z', { latestCandle: null }), res('S', 4142, '2026-10-07T04:40:00Z'))).toEqual({
      available: false,
      reason: 'futures_no_valid_price',
    });
    expect(await run(res('F', 4150, '2026-10-07T04:40:00Z'), res('S', Number.NaN, '2026-10-07T04:40:00Z'))).toEqual({
      available: false,
      reason: 'spot_no_valid_price',
    });
  });

  it('rejects an implausibly large basis', async () => {
    expect(await run(res('F', 4500, '2026-10-07T04:40:00Z'), res('S', 4142, '2026-10-07T04:40:00Z'))).toEqual({
      available: false,
      reason: 'basis_implausible',
    });
  });

  it('marks the item stale when either leg is stale', async () => {
    const r = await run(
      res('F', 4150, '2026-10-07T04:40:00Z', { stale: true, staleReason: 'old' }),
      res('S', 4142, '2026-10-07T04:40:00Z'),
    );
    expect(r.available).toBe(true);
    if (r.available) expect((r.data as Data).stale).toBe(true);
  });
});
