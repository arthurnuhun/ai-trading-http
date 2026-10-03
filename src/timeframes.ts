export const TIMEFRAMES = ['H4', 'H1', 'M15', 'M5'] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

// Verified against the live feed: candle spacing was 14400/3600/900/300 seconds.
export const TV_INTERVAL: Record<Timeframe, string> = { H4: '240', H1: '60', M15: '15', M5: '5' };
export const TIMEFRAME_SECONDS: Record<Timeframe, number> = { H4: 14400, H1: 3600, M15: 900, M5: 300 };

export function parseTimeframe(input: unknown): Timeframe | null {
  if (typeof input !== 'string') return null;
  const up = input.trim().toUpperCase();
  return (TIMEFRAMES as readonly string[]).includes(up) ? (up as Timeframe) : null;
}
