import { marketStatus } from './market-hours.js';
import { TIMEFRAME_SECONDS, type Timeframe } from './timeframes.js';

export type Freshness = {
  stale: boolean;
  staleReason: string | null;
  note: string | null;
  marketOpen: boolean;
  ageSeconds: number;
};

// While the market is closed, anything older than a weekend plus margin is still stale.
const MAX_CLOSED_AGE_MS = 72 * 3600 * 1000;

export function assessFreshness(latestTs: number | null, tf: Timeframe, nowMs: number): Freshness {
  const market = marketStatus(nowMs);
  if (latestTs === null) {
    return { stale: true, staleReason: 'no_candles', note: null, marketOpen: market.open, ageSeconds: -1 };
  }
  const ageMs = nowMs - latestTs;
  const ageSeconds = Math.round(ageMs / 1000);
  if (market.open) {
    const stale = ageMs > 2 * TIMEFRAME_SECONDS[tf] * 1000;
    return {
      stale,
      staleReason: stale ? 'candle_too_old_while_market_open' : null,
      note: null,
      marketOpen: true,
      ageSeconds,
    };
  }
  const stale = ageMs > MAX_CLOSED_AGE_MS;
  return {
    stale,
    staleReason: stale ? 'candle_older_than_weekend_gap' : null,
    note: stale ? null : 'market_closed',
    marketOpen: false,
    ageSeconds,
  };
}
