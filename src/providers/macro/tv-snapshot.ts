import { AppError } from '../../errors.js';
import type { Timeframe } from '../../timeframes.js';
import type { CandleResult } from '../tradingview/adapter.js';
import type { MacroItem } from './index.js';

export interface CandleSource {
  getCandles(tf: Timeframe, limit?: number): Promise<CandleResult>;
}

const H1_MS = 3_600_000;
export const SNAPSHOT_CANDLES = 200;
export const LAG_CANDLES = 12;
const WINDOWS = [
  { window: '24h', hours: 24 },
  { window: '5d', hours: 120 },
] as const;
const GAP_TOLERANCE_HOURS = 6;

const round = (x: number, digits: number) => Number(x.toFixed(digits));

const LIMITATIONS = [
  'Price is the latest M5 candle close from TradingView (the H1 candle when M5 is unavailable); the quote payload carries no exchange timestamp.',
  'Changes compare the price with the last closed H1 candle at least 24 hours or 5 days old; baselineGap marks a baseline much older than its window (weekends, trading breaks).',
  'm5AgeMinutes is the age of the latest M5 candle. It grows when trading is idle and cannot by itself tell idleness from feed delay.',
  'stale and staleReason use the XAUUSD market-hours calendar; this instrument may have different trading breaks.',
  'Descriptive only: no bullish or bearish verdict for gold is derived from this snapshot.',
];

/** Macro item for a TradingView symbol: latest price, time-based changes over closed H1 candles, data age. */
export function createTvSnapshotLoader(source: CandleSource, opts: { now?: () => number } = {}): () => Promise<MacroItem> {
  const now = opts.now ?? (() => Date.now());
  return async function loadSnapshot(): Promise<MacroItem> {
    const [h1Out, m5Out] = await Promise.allSettled([
      source.getCandles('H1', SNAPSHOT_CANDLES),
      source.getCandles('M5', LAG_CANDLES),
    ]);
    if (h1Out.status === 'rejected') {
      const err: unknown = h1Out.reason;
      return { available: false, reason: err instanceof AppError ? err.code : 'provider error' };
    }
    const res = h1Out.value;
    const m5 = m5Out.status === 'fulfilled' ? m5Out.value : null;
    const latest = res.latestCandle;
    if (!latest || !Array.isArray(res.candles) || res.candles.length === 0) {
      return { available: false, reason: 'no candles' };
    }

    const t = now();
    const closed = res.candles.filter((c) => c.timestamp + H1_MS <= t);
    const m5Latest = m5?.latestCandle ?? null;
    const priceCandle = m5Latest && Number.isFinite(m5Latest.close) ? m5Latest : latest;
    const priceSource = priceCandle === latest ? 'h1_latest_candle_close' : 'm5_latest_candle_close';
    const price = priceCandle.close;

    const changes = WINDOWS.map(({ window, hours }) => {
      const cutoff = t - hours * 3_600_000;
      let base: (typeof closed)[number] | undefined;
      for (let i = closed.length - 1; i >= 0; i -= 1) {
        const c = closed[i]!;
        if (c.timestamp + H1_MS <= cutoff) {
          base = c;
          break;
        }
      }
      if (!base) {
        return {
          window,
          hours,
          baselineTime: null,
          baselineAgeHours: null,
          baselineGap: null,
          baselineClose: null,
          absolute: null,
          percent: null,
        };
      }
      const baseCloseTime = base.timestamp + H1_MS;
      const ageHours = (t - baseCloseTime) / 3_600_000;
      return {
        window,
        hours,
        baselineTime: new Date(baseCloseTime).toISOString(),
        baselineAgeHours: round(ageHours, 1),
        baselineGap: ageHours - hours > GAP_TOLERANCE_HOURS,
        baselineClose: base.close,
        absolute: round(price - base.close, 5),
        percent: base.close !== 0 ? round(((price - base.close) / base.close) * 100, 3) : null,
      };
    });

    const day = changes[0]?.absolute ?? null;
    const direction24h = day === null ? null : day > 0 ? 'up' : day < 0 ? 'down' : 'flat';
    const lastClosed = closed.length ? closed[closed.length - 1]! : null;
    return {
      available: true,
      source: 'tradingview',
      fetchedAt: res.fetchedAt,
      data: {
        symbol: res.symbol,
        price,
        priceSource,
        priceCandleOpenTime: priceCandle.isoTime,
        lastClosedH1: lastClosed ? { openTime: lastClosed.isoTime, close: lastClosed.close } : null,
        changes,
        direction24h,
        freshness: {
          stale: res.stale,
          staleReason: res.staleReason,
          marketOpen: res.marketOpen,
          h1AgeMinutes: Math.round((t - latest.timestamp) / 60_000),
          m5AgeMinutes: m5Latest ? Math.round((t - m5Latest.timestamp) / 60_000) : null,
          note: res.note,
        },
        quality: res.quality,
        limitations: LIMITATIONS,
      },
    };
  };
}
