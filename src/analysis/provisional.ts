import type { Candle } from '../types.js';
import type { StructureResult } from './market-structure.js';

export type ProvisionalPoint = { price: number; index: number; timestamp: number; isoTime: string; confirmed: false };
export type ProvisionalSwings = { anchorTimestamp: number | null; high: ProvisionalPoint | null; low: ProvisionalPoint | null };

/**
 * Highest high and lowest low after the latest confirmed swing. These are NOT confirmed swings
 * (a swing needs `lookback` candles after it) and they are never structure events.
 */
export function provisionalSwings(candles: readonly Candle[], structure: StructureResult): ProvisionalSwings {
  const anchor = Math.max(structure.lastSwingHigh?.index ?? -1, structure.lastSwingLow?.index ?? -1);
  if (anchor < 0) return { anchorTimestamp: null, high: null, low: null };
  const anchorTimestamp = candles[anchor].timestamp;
  if (anchor >= candles.length - 1) return { anchorTimestamp, high: null, low: null };

  let hi = anchor + 1;
  let lo = anchor + 1;
  for (let i = anchor + 2; i < candles.length; i++) {
    if (candles[i].high > candles[hi].high) hi = i;
    if (candles[i].low < candles[lo].low) lo = i;
  }
  const point = (i: number, price: number): ProvisionalPoint => ({
    price,
    index: i,
    timestamp: candles[i].timestamp,
    isoTime: candles[i].isoTime,
    confirmed: false,
  });
  return { anchorTimestamp, high: point(hi, candles[hi].high), low: point(lo, candles[lo].low) };
}
