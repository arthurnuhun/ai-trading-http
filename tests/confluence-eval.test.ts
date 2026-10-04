import { describe, it, expect } from 'vitest';
import { AppError } from '../src/errors.js';
import {
  evaluateBias, isCounterTrend, evaluateLocation, evaluateMomentum, evaluateSession, resolveOverride,
} from '../src/analysis/confluence-eval.js';
import type { Divergence } from '../src/analysis/divergence.js';

describe('evaluateBias', () => {
  it('buy passes when H4 and H1 are both bullish', () => {
    const f = evaluateBias('buy', 'bullish', 'bullish');
    expect(f.status).toBe('pass');
    expect(f.reason).toContain('H4 bullish, H1 bullish');
  });
  it('fails when H1 is not aligned and names both states', () => {
    const f = evaluateBias('buy', 'bullish', 'ranging');
    expect(f.status).toBe('fail');
    expect(f.reason).toContain('H1 ranging');
    expect(f.reason).toContain('needs both bullish');
  });
  it('sell needs both bearish', () => {
    expect(evaluateBias('sell', 'bearish', 'bearish').status).toBe('pass');
    expect(evaluateBias('sell', 'bullish', 'bearish').status).toBe('fail');
  });
  it('flags counter-trend only against a clear opposite H4 trend', () => {
    expect(isCounterTrend('buy', 'bearish')).toBe(true);
    expect(isCounterTrend('buy', 'bullish')).toBe(false);
    expect(isCounterTrend('sell', 'bullish')).toBe(true);
    expect(isCounterTrend('sell', 'ranging')).toBe(false);
  });
});

describe('evaluateLocation', () => {
  const levels = {
    supportResistance: [
      { kind: 'support' as const, priceInZone: true, zoneLow: 4133.715, zoneHigh: 4142.335 },
      { kind: 'resistance' as const, priceInZone: false, zoneLow: 4147.415, zoneHigh: 4150.175 },
    ],
    fairValueGaps: [
      { direction: 'bullish' as const, priceInGap: true, low: 4138, high: 4141 },
      { direction: 'bearish' as const, priceInGap: false, low: 4160.3, high: 4178.28 },
    ],
    orderBlocks: [{ direction: 'bearish' as const, priceInZone: false, low: 4174.525, high: 4227.53 }],
  };
  it('buy passes inside a support zone or bullish FVG and lists the evidence', () => {
    const f = evaluateLocation('buy', levels);
    expect(f.status).toBe('pass');
    expect(f.reason).toContain('support zone 4133.715-4142.335');
    expect(f.reason).toContain('bullish FVG 4138-4141');
  });
  it('sell counts only resistance and bearish items', () => {
    const f = evaluateLocation('sell', {
      supportResistance: [{ kind: 'resistance', priceInZone: true, zoneLow: 4140, zoneHigh: 4150 }],
      fairValueGaps: [{ direction: 'bullish', priceInGap: true, low: 4138, high: 4141 }],
      orderBlocks: [],
    });
    expect(f.status).toBe('pass');
    expect(f.reason).toContain('resistance zone 4140-4150');
    expect(f.reason).not.toContain('bullish FVG');
  });
  it('fails when price is not inside any matching zone', () => {
    const f = evaluateLocation('sell', levels);
    expect(f.status).toBe('fail');
    expect(f.reason).toContain('not inside');
  });
});

const none: Divergence[] = [];
const div = (kind: 'bullish' | 'bearish', indicator: 'RSI' | 'MACD_HIST'): Divergence => ({
  kind, indicator, from: { price: 1, timestamp: 1, indicatorValue: 1 }, to: { price: 2, timestamp: 2, indicatorValue: 2 },
});

describe('evaluateMomentum (M15)', () => {
  it('buy passes with RSI 50-70, positive histogram and no opposing divergence', () => {
    const f = evaluateMomentum('buy', { rsi14: 55, macdHistogram: 1.2, divergences: none });
    expect(f.status).toBe('pass');
    expect(f.reason).toContain('RSI 55');
  });
  it('fails on weak RSI using real M15 values from the market-closed snapshot', () => {
    const f = evaluateMomentum('buy', { rsi14: 41.897, macdHistogram: 1.456, divergences: none });
    expect(f.status).toBe('fail');
    expect(f.reason).toContain('RSI 41.9');
    expect(f.reason).not.toContain('MACD');
  });
  it('buy fails when RSI is overbought (70 and above)', () => {
    expect(evaluateMomentum('buy', { rsi14: 72, macdHistogram: 1, divergences: none }).reason).toContain('RSI 72');
    expect(evaluateMomentum('buy', { rsi14: 70, macdHistogram: 1, divergences: none }).status).toBe('fail');
  });
  it('an opposing divergence blocks the pass; a supporting one does not', () => {
    const blocked = evaluateMomentum('buy', { rsi14: 55, macdHistogram: 1, divergences: [div('bearish', 'RSI')] });
    expect(blocked.status).toBe('fail');
    expect(blocked.reason).toContain('opposing divergence: RSI bearish');
    expect(evaluateMomentum('buy', { rsi14: 55, macdHistogram: 1, divergences: [div('bullish', 'RSI')] }).status).toBe('pass');
  });
  it('sell mirrors: RSI 30-50 with a negative histogram', () => {
    expect(evaluateMomentum('sell', { rsi14: 45, macdHistogram: -1, divergences: none }).status).toBe('pass');
    const f = evaluateMomentum('sell', { rsi14: 30, macdHistogram: -1, divergences: none });
    expect(f.status).toBe('fail');
    expect(f.reason).toContain('RSI 30');
  });
  it('is unavailable without indicator values', () => {
    expect(evaluateMomentum('buy', { rsi14: null, macdHistogram: 1, divergences: none }).status).toBe('unavailable');
  });
});

describe('evaluateSession', () => {
  it('scalp needs a kill zone', () => {
    expect(evaluateSession('scalp', { session: 'London', killZone: true, marketOpen: true }).status).toBe('pass');
    const f = evaluateSession('scalp', { session: 'London', killZone: false, marketOpen: true });
    expect(f.status).toBe('fail');
    expect(f.reason).toContain('kill zone');
  });
  it('intraday needs London or New York', () => {
    expect(evaluateSession('intraday', { session: 'London', killZone: false, marketOpen: true }).status).toBe('pass');
    expect(evaluateSession('intraday', { session: 'New York', killZone: false, marketOpen: true }).status).toBe('pass');
    expect(evaluateSession('intraday', { session: 'Asia', killZone: false, marketOpen: true }).status).toBe('fail');
  });
  it('swing accepts Asia, London and New York but not Australia or off hours', () => {
    expect(evaluateSession('swing', { session: 'Asia', killZone: false, marketOpen: true }).status).toBe('pass');
    expect(evaluateSession('swing', { session: 'Australia', killZone: false, marketOpen: true }).status).toBe('fail');
    expect(evaluateSession('swing', { session: 'off_hours', killZone: false, marketOpen: true }).status).toBe('fail');
  });
  it('a closed market always fails', () => {
    const f = evaluateSession('scalp', { session: 'London', killZone: true, marketOpen: false });
    expect(f).toEqual({ status: 'fail', reason: 'Market is closed' });
  });
});

describe('resolveOverride', () => {
  it('is unavailable by default, with the provider reason', () => {
    expect(resolveOverride(undefined, 'No heatmap provider configured')).toEqual({
      status: 'unavailable', reason: 'No heatmap provider configured',
    });
  });
  it('marks a supplied verdict as caller_supplied and trims the reason', () => {
    expect(resolveOverride({ status: 'pass', reason: ' yellow zone below price ' }, 'x')).toEqual({
      status: 'pass', reason: 'caller_supplied: yellow zone below price',
    });
  });
  it('rejects an unknown status or an empty reason', () => {
    expect(() => resolveOverride({ status: 'maybe', reason: 'x' }, 'd')).toThrow(AppError);
    expect(() => resolveOverride({ status: 'pass', reason: '   ' }, 'd')).toThrow(AppError);
  });
});
