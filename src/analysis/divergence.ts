import type { Series } from './indicators.js';
import type { Swing } from './market-structure.js';

export type DivergenceIndicator = 'RSI' | 'MACD_HIST';
export type DivergencePoint = { price: number; timestamp: number; indicatorValue: number };
export type Divergence = {
  kind: 'bullish' | 'bearish';
  indicator: DivergenceIndicator;
  from: DivergencePoint;
  to: DivergencePoint;
};

// Design parameter: the second swing must be at most this many candles old.
export const DIVERGENCE_MAX_AGE_CANDLES = 50;

/**
 * Regular divergence between the last two swings of each type:
 * lower swing low in price with a higher indicator value = bullish;
 * higher swing high in price with a lower indicator value = bearish.
 */
export function detectDivergences(
  swings: readonly Swing[],
  series: Series,
  indicator: DivergenceIndicator,
  lastIndex: number,
  maxAge: number = DIVERGENCE_MAX_AGE_CANDLES,
): Divergence[] {
  const out: Divergence[] = [];
  for (const type of ['low', 'high'] as const) {
    const pts = swings.filter((s) => s.type === type).slice(-2);
    if (pts.length < 2) continue;
    const [a, b] = pts;
    if (lastIndex - b.index > maxAge) continue;
    const va = series[a.index];
    const vb = series[b.index];
    if (va === null || vb === null || va === undefined || vb === undefined) continue;
    const from = { price: a.price, timestamp: a.timestamp, indicatorValue: va };
    const to = { price: b.price, timestamp: b.timestamp, indicatorValue: vb };
    if (type === 'low' && b.price < a.price && vb > va) out.push({ kind: 'bullish', indicator, from, to });
    if (type === 'high' && b.price > a.price && vb < va) out.push({ kind: 'bearish', indicator, from, to });
  }
  return out;
}
