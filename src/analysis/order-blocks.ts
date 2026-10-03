import type { Candle } from '../types.js';
import type { StructureEvent } from './market-structure.js';

export type ObStatus = 'unmitigated' | 'mitigated' | 'invalidated';
export type OrderBlock = {
  direction: 'bullish' | 'bearish';
  high: number;
  low: number;
  bodyHigh: number;
  bodyLow: number;
  timestamp: number; // the order-block candle
  isoTime: string;
  causedBy: { type: 'BOS' | 'CHoCH'; timestamp: number; price: number };
  status: ObStatus;
};

/**
 * For each structure event: between the broken swing and the breaking candle, find the extreme
 * (lowest low for bullish, highest high for bearish), then walk back to the last opposite-colour
 * candle. Zone = that candle's full high-low range.
 */
export function detectOrderBlocks(candles: readonly Candle[], events: readonly StructureEvent[]): OrderBlock[] {
  const indexByTs = new Map<number, number>();
  candles.forEach((c, i) => indexByTs.set(c.timestamp, i));
  const seen = new Set<string>();
  const out: OrderBlock[] = [];

  for (const e of events) {
    const k = indexByTs.get(e.timestamp);
    const h = indexByTs.get(e.brokenSwingTimestamp);
    if (k === undefined || h === undefined || k - h < 2) continue;
    const bullish = e.direction === 'bullish';

    let extreme = h + 1;
    for (let i = h + 1; i < k; i++) {
      if (bullish ? candles[i].low < candles[extreme].low : candles[i].high > candles[extreme].high) extreme = i;
    }
    let obIndex = -1;
    for (let i = extreme; i > h; i--) {
      const c = candles[i];
      if (bullish ? c.close < c.open : c.close > c.open) {
        obIndex = i;
        break;
      }
    }
    if (obIndex < 0) continue;
    const key = `${e.direction}|${candles[obIndex].timestamp}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const ob = candles[obIndex];
    let mitigated = false;
    let invalidated = false;
    for (let j = k + 1; j < candles.length; j++) {
      const x = candles[j];
      if (bullish) {
        if (x.close < ob.low) {
          invalidated = true;
          break;
        }
        if (x.low <= ob.high) mitigated = true;
      } else {
        if (x.close > ob.high) {
          invalidated = true;
          break;
        }
        if (x.high >= ob.low) mitigated = true;
      }
    }
    out.push({
      direction: e.direction,
      high: ob.high,
      low: ob.low,
      bodyHigh: Math.max(ob.open, ob.close),
      bodyLow: Math.min(ob.open, ob.close),
      timestamp: ob.timestamp,
      isoTime: ob.isoTime,
      causedBy: { type: e.type, timestamp: e.timestamp, price: e.price },
      status: invalidated ? 'invalidated' : mitigated ? 'mitigated' : 'unmitigated',
    });
  }
  return out.sort((a, b) => a.timestamp - b.timestamp);
}
