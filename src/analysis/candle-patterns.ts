import type { Candle } from '../types.js';

export type PinBar = 'bullish' | 'bearish' | null;
export type Engulfing = 'bullish' | 'bearish' | null;
export type CandlePatterns = { doji: boolean; pinBar: PinBar; engulfing: Engulfing };

// Design thresholds: the skill names these patterns but does not define them.
export const PATTERN_RULES = { dojiMaxBodyRatio: 0.1, pinMinWickRatio: 0.6, pinMinWickToBody: 2 } as const;

export function detectPatterns(cur: Candle, prev: Candle | null = null): CandlePatterns {
  const range = cur.high - cur.low;
  const body = Math.abs(cur.close - cur.open);
  const upper = cur.high - Math.max(cur.open, cur.close);
  const lower = Math.min(cur.open, cur.close) - cur.low;

  const doji = range > 0 && body <= PATTERN_RULES.dojiMaxBodyRatio * range;

  let pinBar: PinBar = null;
  if (range > 0) {
    if (lower >= PATTERN_RULES.pinMinWickRatio * range && lower >= PATTERN_RULES.pinMinWickToBody * body) pinBar = 'bullish';
    else if (upper >= PATTERN_RULES.pinMinWickRatio * range && upper >= PATTERN_RULES.pinMinWickToBody * body) pinBar = 'bearish';
  }

  let engulfing: Engulfing = null;
  if (prev) {
    const prevBody = Math.abs(prev.close - prev.open);
    if (body > prevBody) {
      if (prev.close < prev.open && cur.close > cur.open && cur.open <= prev.close && cur.close >= prev.open) engulfing = 'bullish';
      else if (prev.close > prev.open && cur.close < cur.open && cur.open >= prev.close && cur.close <= prev.open) engulfing = 'bearish';
    }
  }
  return { doji, pinBar, engulfing };
}

export type PatternHit = { index: number; timestamp: number; isoTime: string; patterns: CandlePatterns };

/** Candles among the last `lastN` that show at least one pattern. */
export function scanPatterns(candles: readonly Candle[], lastN = 20): PatternHit[] {
  const out: PatternHit[] = [];
  const start = Math.max(0, candles.length - lastN);
  for (let i = start; i < candles.length; i++) {
    const p = detectPatterns(candles[i], i > 0 ? candles[i - 1] : null);
    if (p.doji || p.pinBar || p.engulfing) {
      out.push({ index: i, timestamp: candles[i].timestamp, isoTime: candles[i].isoTime, patterns: p });
    }
  }
  return out;
}
