import { AppError } from '../errors.js';
import type { Candle } from '../types.js';

export const DEFAULT_SWING_LOOKBACK = 3;

export type SwingType = 'high' | 'low';
export type SwingLabel = 'HH' | 'LH' | 'HL' | 'LL' | null;
export type Swing = {
  type: SwingType;
  index: number;
  timestamp: number;
  isoTime: string;
  price: number;
  confirmedIndex: number; // index + lookback: the swing is only known from this candle on
  confirmedTimestamp: number;
  label: SwingLabel;
};

export type StructureEvent = {
  type: 'BOS' | 'CHoCH';
  direction: 'bullish' | 'bearish';
  price: number; // the swing level that was broken
  timestamp: number; // candle that closed beyond it
  isoTime: string;
  closePrice: number;
  brokenSwingTimestamp: number;
};

export type TrendState = 'bullish' | 'bearish' | 'ranging' | 'undetermined';

export type StructureResult = {
  swingLookback: number;
  swings: Swing[];
  events: StructureEvent[];
  trendState: TrendState;
  lastSwingHigh: Swing | null;
  lastSwingLow: Swing | null;
  lastEvent: StructureEvent | null;
};

function assertLookback(n: number): void {
  if (!Number.isInteger(n) || n < 1 || n > 20) {
    throw new AppError('INVALID_INPUT', 'swing lookback must be an integer between 1 and 20', false);
  }
}

export function detectSwings(candles: readonly Candle[], lookback = DEFAULT_SWING_LOOKBACK): Swing[] {
  assertLookback(lookback);
  const swings: Swing[] = [];
  const make = (type: SwingType, i: number): Swing => ({
    type,
    index: i,
    timestamp: candles[i].timestamp,
    isoTime: candles[i].isoTime,
    price: type === 'high' ? candles[i].high : candles[i].low,
    confirmedIndex: i + lookback,
    confirmedTimestamp: candles[i + lookback].timestamp,
    label: null,
  });

  for (let i = lookback; i < candles.length - lookback; i++) {
    let isHigh = true;
    let isLow = true;
    for (let k = 1; k <= lookback; k++) {
      if (!(candles[i].high > candles[i - k].high && candles[i].high >= candles[i + k].high)) isHigh = false;
      if (!(candles[i].low < candles[i - k].low && candles[i].low <= candles[i + k].low)) isLow = false;
    }
    if (isHigh) swings.push(make('high', i));
    if (isLow) swings.push(make('low', i));
  }

  let prevHigh: number | null = null;
  let prevLow: number | null = null;
  for (const s of swings) {
    if (s.type === 'high') {
      if (prevHigh !== null) s.label = s.price > prevHigh ? 'HH' : s.price < prevHigh ? 'LH' : null;
      prevHigh = s.price;
    } else {
      if (prevLow !== null) s.label = s.price > prevLow ? 'HL' : s.price < prevLow ? 'LL' : null;
      prevLow = s.price;
    }
  }
  return swings;
}

function trendFromSwings(swings: readonly Swing[]): TrendState {
  const lastHigh = [...swings].reverse().find((s) => s.type === 'high');
  const lastLow = [...swings].reverse().find((s) => s.type === 'low');
  if (!lastHigh?.label || !lastLow?.label) return 'undetermined';
  if (lastHigh.label === 'HH' && lastLow.label === 'HL') return 'bullish';
  if (lastHigh.label === 'LH' && lastLow.label === 'LL') return 'bearish';
  return 'ranging';
}

export function detectStructure(candles: readonly Candle[], lookback = DEFAULT_SWING_LOOKBACK): StructureResult {
  const swings = detectSwings(candles, lookback);
  const byConfirm = new Map<number, Swing[]>();
  for (const s of swings) {
    const list = byConfirm.get(s.confirmedIndex) ?? [];
    list.push(s);
    byConfirm.set(s.confirmedIndex, list);
  }

  const events: StructureEvent[] = [];
  let refHigh: Swing | null = null;
  let refLow: Swing | null = null;
  let trend: 'bullish' | 'bearish' | null = null;

  const emit = (type: 'BOS' | 'CHoCH', direction: 'bullish' | 'bearish', ref: Swing, c: Candle) =>
    events.push({
      type,
      direction,
      price: ref.price,
      timestamp: c.timestamp,
      isoTime: c.isoTime,
      closePrice: c.close,
      brokenSwingTimestamp: ref.timestamp,
    });

  for (let i = 0; i < candles.length; i++) {
    for (const s of byConfirm.get(i) ?? []) {
      if (s.type === 'high') refHigh = s;
      else refLow = s;
    }
    const c = candles[i];
    if (refHigh && c.close > refHigh.price) {
      if (trend !== null) emit(trend === 'bullish' ? 'BOS' : 'CHoCH', 'bullish', refHigh, c);
      trend = 'bullish';
      refHigh = null;
    } else if (refLow && c.close < refLow.price) {
      if (trend !== null) emit(trend === 'bearish' ? 'BOS' : 'CHoCH', 'bearish', refLow, c);
      trend = 'bearish';
      refLow = null;
    }
  }

  return {
    swingLookback: lookback,
    swings,
    events,
    trendState: trendFromSwings(swings),
    lastSwingHigh: [...swings].reverse().find((s) => s.type === 'high') ?? null,
    lastSwingLow: [...swings].reverse().find((s) => s.type === 'low') ?? null,
    lastEvent: events.length ? events[events.length - 1] : null,
  };
}
