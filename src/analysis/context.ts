import type { buildLevelsReport } from './levels-report.js';

export type EmaValues = { ema20: number | null; ema50: number | null; ema100: number | null; ema200: number | null };
export type EmaStack = 'bullish' | 'bearish' | 'mixed' | null;

/** Design rule: strictly ordered 20 > 50 > 100 > 200 is bullish, the reverse is bearish; null without full history. */
export function emaStack(e: EmaValues): EmaStack {
  const { ema20, ema50, ema100, ema200 } = e;
  if (ema20 === null || ema50 === null || ema100 === null || ema200 === null) return null;
  if (ema20 > ema50 && ema50 > ema100 && ema100 > ema200) return 'bullish';
  if (ema20 < ema50 && ema50 < ema100 && ema100 < ema200) return 'bearish';
  return 'mixed';
}

export function priceVsEma(price: number, e: EmaValues) {
  const side = (v: number | null): 'above' | 'below' | 'at' | null =>
    v === null ? null : price > v ? 'above' : price < v ? 'below' : 'at';
  return { ema20: side(e.ema20), ema50: side(e.ema50), ema100: side(e.ema100), ema200: side(e.ema200) };
}

export type AvailableLevels = Extract<ReturnType<typeof buildLevelsReport>, { available: true }>;

/** Compact view for trading_context: nearest two zones per side, two FVGs, two order blocks. */
export function compactLevels(l: AvailableLevels) {
  const above = l.supportResistance
    .filter((x) => x.kind === 'resistance')
    .sort((a, b) => a.price - b.price)
    .slice(0, 2)
    .sort((a, b) => b.price - a.price);
  const below = l.supportResistance
    .filter((x) => x.kind === 'support')
    .sort((a, b) => b.price - a.price)
    .slice(0, 2);
  return {
    available: true as const,
    price: l.price,
    atr14: l.atr14,
    supportResistance: [...above, ...below],
    psychological: l.psychological,
    recentRange: l.recentRange,
    fairValueGaps: l.fairValueGaps.slice(0, 2),
    orderBlocks: l.orderBlocks.slice(0, 2),
    liquidity: { above: l.liquidity.above, below: l.liquidity.below },
    sweeps: l.sweeps.slice(-2),
  };
}
