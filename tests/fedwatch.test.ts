import { describe, it, expect } from 'vitest';
import { AppError } from '../src/errors.js';
import { createFedWatchLoader, estimateMeeting, frontContractMonth } from '../src/providers/macro/fedwatch.js';
import type { CandleSource } from '../src/providers/macro/tv-snapshot.js';
import type { CandleResult } from '../src/providers/tradingview/adapter.js';

const NOW = Date.parse('2026-10-05T23:30:00Z');
const DATES = ['2026-09-16', '2026-10-28', '2026-12-09'];
const RATES = { lower: 3.75, upper: 4.0, effr: 3.9, asOf: '2026-09-17' };

function res(symbol: string, close: number, openIso = '2026-10-05T23:20:00.000Z'): CandleResult {
  const c = { timestamp: Date.parse(openIso), isoTime: openIso, open: close, high: close, low: close, close, volume: 1 };
  return {
    symbol,
    source: 'tradingview',
    timeframe: 'M5',
    candles: [c],
    latestCandle: c,
    fetchedAt: new Date(NOW).toISOString(),
    latestCandleTime: openIso,
    stale: false,
    staleReason: null,
    note: null,
    marketOpen: true,
    ageSeconds: 600,
    latencyMs: 1,
    cached: false,
    quality: { received: 1, accepted: 1, malformed: 0, duplicates: 0, future: 0, nonMonotonic: 0 },
  } as unknown as CandleResult;
}

function sources(prices: Record<string, number>) {
  const requested: string[] = [];
  const sourceFor = (symbol: string): CandleSource =>
    ({
      async getCandles() {
        requested.push(symbol);
        const p = prices[symbol];
        if (p === undefined) throw new AppError('INVALID_SYMBOL', 'rejected', false);
        return res(symbol, p);
      },
    }) as unknown as CandleSource;
  return { sourceFor, requested };
}

const run = (
  prices: Record<string, number>,
  over: Partial<Parameters<typeof createFedWatchLoader>[0]> = {},
  now = NOW,
) => {
  const s = sources(prices);
  const loader = createFedWatchLoader({
    sourceFor: s.sourceFor,
    decisionDates: DATES,
    rates: RATES,
    now: () => now,
    ...over,
  });
  return { loader, requested: s.requested };
};

describe('contract month mapping', () => {
  it('rolls ZQ1! to the next month after the last business day', () => {
    expect(frontContractMonth('2026-10-05')).toEqual({ year: 2026, month: 10 });
    expect(frontContractMonth('2026-10-30')).toEqual({ year: 2026, month: 10 });
    expect(frontContractMonth('2026-10-31')).toEqual({ year: 2026, month: 11 });
  });
});

describe('estimateMeeting', () => {
  it('uses the next month contract for a late-month meeting and cross-checks with the spread', () => {
    const r: any = estimateMeeting({
      decisionDate: '2026-10-28',
      allDecisionDates: DATES,
      preRatePercent: 3.9,
      impliedRates: { '2026-10': 3.935, '2026-11': 4.08 },
    });
    expect(r.ok).toBe(true);
    expect(r.method).toBe('next_month_contract');
    expect(r.impliedChangeBp).toBeCloseTo(18, 1);
    expect(r.spreadCheckBp).toBeCloseTo(16.1, 1);
    expect(r.probabilities).toEqual([
      { changeBp: 0, probability: 0.28 },
      { changeBp: 25, probability: 0.72 },
    ]);
  });

  it('uses the month contract, with amplification, when the next month has another meeting', () => {
    const r: any = estimateMeeting({
      decisionDate: '2026-09-16',
      allDecisionDates: ['2026-09-16', '2026-10-28'],
      preRatePercent: 3.9,
      impliedRates: { '2026-09': 3.95, '2026-10': 4.0 },
    });
    expect(r.method).toBe('month_contract');
    expect(r.postMeetingRatePercent).toBeCloseTo(4.0071, 4);
    expect(r.impliedChangeBp).toBeCloseTo(10.7, 1);
    expect(r.amplification).toBeCloseTo(2.143, 3);
  });

  it('puts probability on a cut and on no change for a negative move', () => {
    const r: any = estimateMeeting({
      decisionDate: '2026-10-28',
      allDecisionDates: DATES,
      preRatePercent: 3.9,
      impliedRates: { '2026-11': 3.75 },
    });
    expect(r.impliedChangeBp).toBeCloseTo(-15, 1);
    expect(r.probabilities).toEqual([
      { changeBp: -25, probability: 0.6 },
      { changeBp: 0, probability: 0.4 },
    ]);
  });
});

describe('FedWatch loader', () => {
  const PRICES = { 'CBOT:ZQ1!': 96.065, 'CBOT:ZQ2!': 95.92 };

  it('reports contracts and an estimate when everything is configured', async () => {
    const { loader, requested } = run(PRICES);
    const item: any = await loader();
    expect(item.available).toBe(true);
    expect([...requested].sort()).toEqual(['CBOT:ZQ1!', 'CBOT:ZQ2!']);
    const d = item.data;
    expect(d.nextMeeting).toEqual({ decisionDate: '2026-10-28', daysUntil: 23 });
    expect(d.contracts[0].contractMonth).toBe('2026-10');
    expect(d.contracts[0].impliedRatePercent).toBe(3.935);
    expect(d.contracts[0].ageMinutes).toBe(10);
    expect(d.contracts[1].contractMonth).toBe('2026-11');
    expect(d.estimate.method).toBe('next_month_contract');
    expect(d.estimate.impliedChangeBp).toBeCloseTo(18, 1);
    expect(d.estimateUnavailableReason).toBeNull();
    expect(d.warnings).toEqual([]);
    expect(d.limitations.length).toBeGreaterThan(0);
  });

  it('withholds the estimate when rates are not configured', async () => {
    const item: any = await run(PRICES, { rates: {} }).loader();
    expect(item.available).toBe(true);
    expect(item.data.estimate).toBeNull();
    expect(item.data.estimateUnavailableReason).toBe('rates_not_configured');
    expect(item.data.contracts[0].impliedRatePercent).toBe(3.935);
  });

  it('withholds the estimate when no FOMC dates are configured', async () => {
    const { loader, requested } = run(PRICES, { decisionDates: [] });
    const item: any = await loader();
    expect(item.data.estimateUnavailableReason).toBe('fomc_dates_not_configured');
    expect([...requested].sort()).toEqual(['CBOT:ZQ1!', 'CBOT:ZQ2!']);
  });

  it('withholds the estimate when a decision happened after the rates date', async () => {
    const item: any = await run(PRICES, { rates: { ...RATES, asOf: '2026-09-10' } }).loader();
    expect(item.data.estimateUnavailableReason).toBe('rates_outdated_after_2026-09-16');
  });

  it('withholds the estimate when EFFR is outside the target range', async () => {
    const item: any = await run(PRICES, { rates: { ...RATES, effr: 5.5 } }).loader();
    expect(item.data.estimateUnavailableReason).toBe('effr_outside_target_range');
  });

  it('keeps the item available when one contract is rejected', async () => {
    const item: any = await run({ 'CBOT:ZQ1!': 96.065 }).loader();
    expect(item.available).toBe(true);
    expect(item.data.contracts[1]).toMatchObject({ available: false, reason: 'INVALID_SYMBOL' });
    expect(item.data.estimate).toBeNull();
    expect(item.data.estimateUnavailableReason).toBe('contract_unavailable');
  });

  it('is unavailable when every contract fails', async () => {
    const item: any = await run({}).loader();
    expect(item).toEqual({ available: false, reason: 'INVALID_SYMBOL' });
  });

  it('moves to the next meeting and its contracts after the decision', async () => {
    const after = Date.parse('2026-10-28T19:00:00Z');
    const { loader, requested } = run(
      { 'CBOT:ZQ3!': 96.0, 'CBOT:ZQ4!': 95.9 },
      { rates: { ...RATES, asOf: '2026-10-28' } },
      after,
    );
    const item: any = await loader();
    expect([...requested].sort()).toEqual(['CBOT:ZQ3!', 'CBOT:ZQ4!']);
    expect(item.data.nextMeeting.decisionDate).toBe('2026-12-09');
    expect(item.data.estimate.method).toBe('month_contract');
    expect(item.data.estimate.amplification).toBeCloseTo(1.409, 3);
  });
});
