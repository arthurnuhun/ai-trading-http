import { AppError } from '../errors.js';
import type { Factor, FactorStatus } from './confluence.js';
import type { Divergence } from './divergence.js';
import type { TrendState } from './market-structure.js';
import type { Direction, TradeStyle } from './risk.js';

// Interpretations of the skill's six checklist items. The skill gives titles, not formulas.
const r1 = (v: number): number => Math.round(v * 10) / 10;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** 1. H4/H1 bias: both timeframes must show the trade's direction. */
export function evaluateBias(direction: Direction, h4: TrendState, h1: TrendState): Factor {
  const want: TrendState = direction === 'buy' ? 'bullish' : 'bearish';
  const pass = h4 === want && h1 === want;
  return { status: pass ? 'pass' : 'fail', reason: `H4 ${h4}, H1 ${h1}; a ${direction} needs both ${want}` };
}

export function isCounterTrend(direction: Direction, h4: TrendState): boolean {
  return h4 === (direction === 'buy' ? 'bearish' : 'bullish');
}

export type LocationLevels = {
  supportResistance: ReadonlyArray<{ kind: 'support' | 'resistance'; priceInZone: boolean; zoneLow: number; zoneHigh: number }>;
  fairValueGaps: ReadonlyArray<{ direction: 'bullish' | 'bearish'; priceInGap: boolean; low: number; high: number }>;
  orderBlocks: ReadonlyArray<{ direction: 'bullish' | 'bearish'; priceInZone: boolean; low: number; high: number }>;
};

/** 2. Price inside a valid S/R zone or FVG (order blocks included) on the trade's side. */
export function evaluateLocation(direction: Direction, levels: LocationLevels): Factor {
  const buy = direction === 'buy';
  const hits: string[] = [];
  for (const z of levels.supportResistance) {
    if (z.priceInZone && z.kind === (buy ? 'support' : 'resistance')) hits.push(`${z.kind} zone ${z.zoneLow}-${z.zoneHigh}`);
  }
  for (const g of levels.fairValueGaps) {
    if (g.priceInGap && g.direction === (buy ? 'bullish' : 'bearish')) hits.push(`${g.direction} FVG ${g.low}-${g.high}`);
  }
  for (const o of levels.orderBlocks) {
    if (o.priceInZone && o.direction === (buy ? 'bullish' : 'bearish')) hits.push(`${o.direction} order block ${o.low}-${o.high}`);
  }
  if (hits.length) return { status: 'pass', reason: `H1: price inside ${hits.join('; ')}` };
  return {
    status: 'fail',
    reason: `H1: price is not inside a ${buy ? 'support zone, bullish FVG or bullish order block' : 'resistance zone, bearish FVG or bearish order block'}`,
  };
}

export type MomentumInput = { rsi14: number | null; macdHistogram: number | null; divergences: readonly Divergence[] };

/** 4. Momentum confirmation on M15: MACD histogram and RSI agree, RSI not extreme, no opposing divergence. */
export function evaluateMomentum(direction: Direction, m: MomentumInput): Factor {
  if (m.rsi14 === null || m.macdHistogram === null) {
    return { status: 'unavailable', reason: 'M15: not enough closed candles for RSI/MACD' };
  }
  const buy = direction === 'buy';
  const rsi = m.rsi14;
  const hist = m.macdHistogram;
  const histOk = buy ? hist > 0 : hist < 0;
  const rsiOk = buy ? rsi >= 50 && rsi < 70 : rsi <= 50 && rsi > 30;
  const opposing = m.divergences.filter((d) => d.kind === (buy ? 'bearish' : 'bullish'));
  const problems: string[] = [];
  if (!histOk) problems.push(`MACD histogram ${r3(hist)} (needs ${buy ? '> 0' : '< 0'})`);
  if (!rsiOk) problems.push(`RSI ${r1(rsi)} (needs ${buy ? '50 to 70' : '30 to 50'})`);
  if (opposing.length) problems.push(`opposing divergence: ${opposing.map((d) => `${d.indicator} ${d.kind}`).join(', ')}`);
  if (problems.length) return { status: 'fail', reason: `M15: ${problems.join('; ')}` };
  return { status: 'pass', reason: `M15: RSI ${r1(rsi)}, MACD histogram ${r3(hist)}, no opposing divergence` };
}

/** 5. Session fit for the trade style. */
export function evaluateSession(
  style: TradeStyle,
  s: { session: string; killZone: boolean; marketOpen: boolean },
): Factor {
  if (!s.marketOpen) return { status: 'fail', reason: 'Market is closed' };
  let pass: boolean;
  let need: string;
  if (style === 'scalp') {
    pass = s.killZone;
    need = 'scalp needs a kill zone (London 13:00-15:00 or New York 20:00-21:30 WIB)';
  } else if (style === 'intraday') {
    pass = s.session === 'London' || s.session === 'New York';
    need = 'intraday needs the London or New York session';
  } else {
    pass = s.session === 'Asia' || s.session === 'London' || s.session === 'New York';
    need = 'swing needs a liquid session (Asia, London or New York)';
  }
  return { status: pass ? 'pass' : 'fail', reason: `${s.session}${s.killZone ? ' (kill zone)' : ''}: ${need}` };
}

/** Heatmap and macro have no provider: unavailable unless the caller supplies an explicit, documented verdict. */
export function resolveOverride(
  input: { status: string; reason: string } | undefined,
  defaultReason: string,
): Factor {
  if (input === undefined) return { status: 'unavailable', reason: defaultReason };
  const status = input.status;
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!['pass', 'fail', 'unavailable'].includes(status)) {
    throw new AppError('INVALID_INPUT', 'status must be pass, fail or unavailable', false);
  }
  if (reason.length < 1 || reason.length > 300) {
    throw new AppError('INVALID_INPUT', 'reason is required (1-300 characters) when supplying a factor verdict', false);
  }
  return { status: status as FactorStatus, reason: `caller_supplied: ${reason}` };
}
