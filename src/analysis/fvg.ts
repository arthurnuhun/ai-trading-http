import type { Candle } from '../types.js';

export type FvgStatus = 'open' | 'partially_filled' | 'filled';
export type Fvg = {
  direction: 'bullish' | 'bearish';
  low: number;
  high: number;
  size: number;
  timestamp: number; // middle (displacement) candle
  isoTime: string;
  confirmedTimestamp: number; // third candle, when the gap becomes known
  status: FvgStatus;
};

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Three-candle imbalance. Only gaps strictly larger than minSize are returned. */
export function detectFvgs(candles: readonly Candle[], minSize = 0): Fvg[] {
  const out: Fvg[] = [];
  for (let i = 2; i < candles.length; i++) {
    const a = candles[i - 2];
    const mid = candles[i - 1];
    const c = candles[i];
    let direction: 'bullish' | 'bearish' | null = null;
    let low = 0;
    let high = 0;
    if (c.low > a.high && c.low - a.high > minSize) {
      direction = 'bullish';
      low = a.high;
      high = c.low;
    } else if (a.low > c.high && a.low - c.high > minSize) {
      direction = 'bearish';
      low = c.high;
      high = a.low;
    }
    if (!direction) continue;

    let filled = false;
    let partial = false;
    for (let j = i + 1; j < candles.length; j++) {
      const x = candles[j];
      if (direction === 'bullish') {
        if (x.low <= low) {
          filled = true;
          break;
        }
        if (x.low < high) partial = true;
      } else {
        if (x.high >= high) {
          filled = true;
          break;
        }
        if (x.high > low) partial = true;
      }
    }
    out.push({
      direction,
      low: r3(low),
      high: r3(high),
      size: r3(high - low),
      timestamp: mid.timestamp,
      isoTime: mid.isoTime,
      confirmedTimestamp: c.timestamp,
      status: filled ? 'filled' : partial ? 'partially_filled' : 'open',
    });
  }
  return out;
}
