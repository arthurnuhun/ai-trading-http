import { describe, expect, it } from 'vitest';
import { evaluateMacroBias } from '../src/analysis/macro-bias.js';
import type { MacroItem } from '../src/providers/macro/index.js';

type Opts = { stale?: boolean; gap?: boolean; no24h?: boolean };
const item = (percent: number, absolute: number, o: Opts = {}): MacroItem => ({
  available: true,
  source: 'tradingview',
  fetchedAt: '2026-10-09T00:00:00.000Z',
  data: {
    freshness: { stale: o.stale === true, staleReason: o.stale ? 'candle_too_old_while_market_open' : null },
    changes: o.no24h
      ? [{ window: '5d', baselineGap: false, absolute: 0, percent: 0 }]
      : [
          { window: '24h', baselineGap: o.gap === true, absolute, percent },
          { window: '5d', baselineGap: true, absolute: 0, percent: 0 },
        ],
  },
});
const na: MacroItem = { available: false, reason: 'provider unavailable' };
const falling = { dxy: item(-0.118, -0.121), us10y: item(-0.965, -0.051) };
const rising = { dxy: item(0.2, 0.2), us10y: item(0.9, 0.05) };

describe('evaluateMacroBias', () => {
  it('passes a buy and fails a sell when DXY and US10Y both fall', () => {
    const buy = evaluateMacroBias('buy', falling);
    expect(buy.status).toBe('pass');
    expect(buy.reason).toContain('DXY -0.118%');
    expect(buy.reason).toContain('US10Y -0.051 pp');
    expect(buy.reason).toContain('bullish for gold');
    expect(buy.reason).toContain('supports a buy');
    const sell = evaluateMacroBias('sell', falling);
    expect(sell.status).toBe('fail');
    expect(sell.reason).toContain('against a sell');
  });

  it('passes a sell and fails a buy when both rise', () => {
    expect(evaluateMacroBias('sell', rising).status).toBe('pass');
    const buy = evaluateMacroBias('buy', rising);
    expect(buy.status).toBe('fail');
    expect(buy.reason).toContain('against a buy');
  });

  it('fails both directions when the moves disagree', () => {
    const mixed = { dxy: item(0.2, 0.2), us10y: item(-0.9, -0.05) };
    for (const dir of ['buy', 'sell'] as const) {
      const f = evaluateMacroBias(dir, mixed);
      expect(f.status).toBe('fail');
      expect(f.reason).toContain('no clear macro bias');
      expect(f.reason).toContain('not counted as a pass');
    }
  });

  it('treats a move below the threshold as flat', () => {
    const f = evaluateMacroBias('buy', { dxy: item(-0.05, -0.05), us10y: item(-0.9, -0.05) });
    expect(f.status).toBe('fail');
    expect(f.reason).toContain('no clear macro bias');
  });

  it('counts a move exactly at the threshold', () => {
    const f = evaluateMacroBias('buy', { dxy: item(-0.1, -0.1), us10y: item(-1, -0.02) });
    expect(f.status).toBe('pass');
  });

  it('is unavailable when a leg is stale', () => {
    const f = evaluateMacroBias('buy', { dxy: item(-0.118, -0.121), us10y: item(-0.9, -0.05, { stale: true }) });
    expect(f.status).toBe('unavailable');
    expect(f.reason).toContain('US10Y data is stale (candle_too_old_while_market_open)');
  });

  it('is unavailable when a 24h baseline has a gap', () => {
    const f = evaluateMacroBias('sell', { dxy: item(0.2, 0.2, { gap: true }), us10y: item(0.9, 0.05) });
    expect(f.status).toBe('unavailable');
    expect(f.reason).toContain('DXY 24h baseline has a gap');
  });

  it('is unavailable and names every missing leg', () => {
    const f = evaluateMacroBias('buy', { dxy: na, us10y: na });
    expect(f.status).toBe('unavailable');
    expect(f.reason).toContain('DXY unavailable (provider unavailable)');
    expect(f.reason).toContain('US10Y unavailable (provider unavailable)');
  });

  it('is unavailable when the 24h change is missing', () => {
    const f = evaluateMacroBias('buy', { dxy: item(-0.2, -0.2, { no24h: true }), us10y: item(-0.9, -0.05) });
    expect(f.status).toBe('unavailable');
    expect(f.reason).toContain('DXY has no 24h change');
  });
});
