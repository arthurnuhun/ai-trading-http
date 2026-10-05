import { AppError } from '../../errors.js';
import type { Timeframe } from '../../timeframes.js';
import type { CandleResult } from '../tradingview/adapter.js';
import type { MacroItem } from './index.js';

export interface CandleSource {
  getCandles(tf: Timeframe, limit?: number): Promise<CandleResult>;
}

const H1_MS = 3_600_000;
export const SNAPSHOT_CANDLES = 130;
const BARS_BACK = [1, 24, 120] as const;

const round = (x: number, digits: number) => Number(x.toFixed(digits));

const LIMITATIONS = [
  'Price is the latest H1 candle close from TradingView (the quote payload carries no exchange timestamp); changes use closed H1 candles.',
  'Freshness flags use the XAUUSD market-hours calendar; this instrument may have different trading breaks.',
  'Descriptive only: no bullish or bearish verdict for gold is derived from this snapshot.',
];

/** Macro item for a TradingView symbol: latest price, changes over closed H1 candles, freshness. */
export function createTvSnapshotLoader(source: CandleSource, opts: { now?: () => number } = {}): () => Promise<MacroItem> {
  const now = opts.now ?? (() => Date.now());
  return async function loadSnapshot(): Promise<MacroItem> {
    let res: CandleResult;
    try {
      res = await source.getCandles('H1', SNAPSHOT_CANDLES);
    } catch (err) {
      return { available: false, reason: err instanceof AppError ? err.code : 'provider error' };
    }
    const latest = res.latestCandle;
    if (!latest || !Array.isArray(res.candles) || res.candles.length === 0) {
      return { available: false, reason: 'no candles' };
    }
    const t = now();
    const closed = res.candles.filter((c) => c.timestamp + H1_MS <= t);
    const price = latest.close;
    const changes = BARS_BACK.map((bars) => {
      const base = closed[closed.length - bars];
      if (!base) return { bars, baselineTime: null, baselineClose: null, absolute: null, percent: null };
      return {
        bars,
        baselineTime: new Date(base.timestamp + H1_MS).toISOString(),
        baselineClose: base.close,
        absolute: round(price - base.close, 5),
        percent: base.close !== 0 ? round(((price - base.close) / base.close) * 100, 3) : null,
      };
    });
    const day = changes.find((c) => c.bars === 24)?.absolute ?? null;
    const direction24h = day === null ? null : day > 0 ? 'up' : day < 0 ? 'down' : 'flat';
    const lastClosed = closed.length ? closed[closed.length - 1]! : null;
    return {
      available: true,
      source: 'tradingview',
      fetchedAt: res.fetchedAt,
      data: {
        symbol: res.symbol,
        price,
        priceSource: 'h1_latest_candle_close',
        latestCandleTime: latest.isoTime,
        lastClosedH1: lastClosed ? { openTime: lastClosed.isoTime, close: lastClosed.close } : null,
        changes,
        direction24h,
        freshness: {
          stale: res.stale,
          staleReason: res.staleReason,
          marketOpen: res.marketOpen,
          ageSeconds: res.ageSeconds,
          note: res.note,
        },
        quality: res.quality,
        limitations: LIMITATIONS,
      },
    };
  };
}
