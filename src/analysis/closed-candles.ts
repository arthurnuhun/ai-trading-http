import { TIMEFRAME_SECONDS, type Timeframe } from '../timeframes.js';
import type { Candle } from '../types.js';

/**
 * TradingView's newest candle is still forming until timestamp + timeframe length has passed.
 * Analysis uses closed candles only, so a forming candle can never repaint a swing, BOS or indicator.
 */
export function splitClosed(
  candles: readonly Candle[],
  tf: Timeframe,
  nowMs: number = Date.now(),
): { closed: Candle[]; forming: Candle | null } {
  const last = candles.length ? candles[candles.length - 1] : undefined;
  if (last && nowMs < last.timestamp + TIMEFRAME_SECONDS[tf] * 1000) {
    return { closed: candles.slice(0, -1), forming: last };
  }
  return { closed: candles.slice(), forming: null };
}
