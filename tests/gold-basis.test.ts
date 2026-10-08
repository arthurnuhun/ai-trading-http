import { describe, expect, it } from 'vitest';
import { createGoldFuturesBasisLoader } from '../src/providers/macro/gold-basis.js';
import type { CandleResult } from '../src/providers/tradingview/adapter.js';

const NOW = Date.parse('2026-10-07T04:45:00Z');
const quality = { received: 12, accepted: 12, malformed: 0, duplicates: 0, future: 0, nonMonotonic: 0 };

type Bar = { timestamp: number; isoTime: string; close: number };
const bar = (iso: string, close: number): Bar => ({ timestamp: Date.parse(iso), isoTime: iso, close });

function res(symbol: string, bars: Bar[], extra: Record<string, unknown> = {}): CandleResult {
  return {
    symbol,
    latestCandle: bars.length ? bars[bars.length - 1] : null,
    candles: bars,
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
  asOf: string;
  futuresLagMinutes: number;
  stale: boolean;
  futures: { ageMinutes: number; symbol: string };
  spot: { ageMinutes: number; price: number };
  latestSpot: { price: number };
};

describe('goldFuturesBasis loader', () => {
  it('computes the basis in price and percent', async () => {
    const r = await run(
      res('COMEX:GC1!', [bar('2026-10-07T04:40:00Z', 4150.5)]),
      res('OANDA:XAUUSD', [bar('2026-10-07T04:35:00Z', 4141), bar('2026-10-07T04:40:00Z', 4142.2)]),
    );
    expect(r.available).toBe(true);
    if (r.available) {
      const d = r.data as Data;
      expect(d.basis.absolute).toBeCloseTo(8.3, 3);
      expect(d.basis.percent).toBeCloseTo(0.2, 2);
      expect(d.basis.relation).toBe('futures_above_spot');
      expect(d.futuresLagMinutes).toBe(0);
      expect(d.futures.symbol).toBe('COMEX:GC1!');
    }
  });

  it('handles a futures price below spot', async () => {
    const r = await run(res('F', [bar('2026-10-07T04:40:00Z', 4140)]), res('S', [bar('2026-10-07T04:40:00Z', 4142)]));
    expect(r.available).toBe(true);
    if (r.available) expect((r.data as Data).basis.relation).toBe('futures_below_spot');
  });

  it('pairs a delayed futures candle with the spot candle of the same open time', async () => {
    const r = await run(
      res('F', [bar('2026-10-07T04:30:00Z', 4150)]),
      res('S', [bar('2026-10-07T04:30:00Z', 4141), bar('2026-10-07T04:35:00Z', 4143), bar('2026-10-07T04:40:00Z', 4146)]),
    );
    expect(r.available).toBe(true);
    if (r.available) {
      const d = r.data as Data;
      expect(d.basis.absolute).toBe(9);
      expect(d.asOf).toBe('2026-10-07T04:30:00Z');
      expect(d.futuresLagMinutes).toBe(10);
      expect(d.futures.ageMinutes).toBe(15);
      expect(d.spot.price).toBe(4141);
      expect(d.spot.ageMinutes).toBe(15);
      expect(d.latestSpot.price).toBe(4146);
    }
  });

  it('withholds the basis when futures trail spot by more than 30 minutes', async () => {
    const r = await run(res('F', [bar('2026-10-07T04:05:00Z', 4150)]), res('S', [bar('2026-10-07T04:05:00Z', 4141), bar('2026-10-07T04:40:00Z', 4146)]));
    expect(r).toEqual({ available: false, reason: 'futures_lagging_35min' });
  });

  it('withholds the basis when no spot candle matches the futures open time', async () => {
    const r = await run(res('F', [bar('2026-10-07T04:30:00Z', 4150)]), res('S', [bar('2026-10-07T04:25:00Z', 4141), bar('2026-10-07T04:40:00Z', 4146)]));
    expect(r).toEqual({ available: false, reason: 'no_spot_candle_at_futures_time' });
  });

  it('is unavailable when the futures source fails', async () => {
    expect(await run(new Error('boom'), res('S', [bar('2026-10-07T04:40:00Z', 4142)]))).toEqual({
      available: false,
      reason: 'futures_provider_error',
    });
  });

  it('is unavailable when the spot source fails', async () => {
    expect(await run(res('F', [bar('2026-10-07T04:40:00Z', 4150)]), new Error('boom'))).toEqual({
      available: false,
      reason: 'spot_provider_error',
    });
  });

  it('rejects a missing futures candle and an invalid spot price', async () => {
    expect(await run(res('F', [], { latestCandle: null }), res('S', [bar('2026-10-07T04:40:00Z', 4142)]))).toEqual({
      available: false,
      reason: 'futures_no_valid_price',
    });
    expect(await run(res('F', [bar('2026-10-07T04:40:00Z', 4150)]), res('S', [bar('2026-10-07T04:40:00Z', Number.NaN)]))).toEqual({
      available: false,
      reason: 'spot_no_valid_price',
    });
  });

  it('rejects an implausibly large basis', async () => {
    expect(await run(res('F', [bar('2026-10-07T04:40:00Z', 4500)]), res('S', [bar('2026-10-07T04:40:00Z', 4142)]))).toEqual({
      available: false,
      reason: 'basis_implausible',
    });
  });

  it('marks the item stale when either leg is stale', async () => {
    const r = await run(
      res('F', [bar('2026-10-07T04:40:00Z', 4150)], { stale: true, staleReason: 'old' }),
      res('S', [bar('2026-10-07T04:40:00Z', 4142)]),
    );
    expect(r.available).toBe(true);
    if (r.available) expect((r.data as Data).stale).toBe(true);
  });
});
