import { AppError } from '../../errors.js';
import type { CandleResult } from '../tradingview/adapter.js';
import type { MacroItem } from './index.js';
import type { CandleSource } from './tv-snapshot.js';

export const BASIS_CANDLES = 12;
/** The latest futures candle may trail the latest spot candle by at most this many minutes. */
export const MAX_FUTURES_LAG_MINUTES = 30;
/** A basis larger than this (percent of spot) almost surely means a wrong symbol or bad data. */
export const MAX_ABS_BASIS_PERCENT = 5;

const round = (x: number, digits: number) => Number(x.toFixed(digits));
const failCode = (err: unknown) => (err instanceof AppError ? err.code : 'provider_error');

type Bar = { timestamp: number; isoTime: string; close: number };

function validBar(c: Bar | null | undefined): Bar | null {
  if (!c || !Number.isFinite(c.close) || c.close <= 0 || !Number.isFinite(c.timestamp)) return null;
  return c;
}

const LIMITATIONS = [
  'Basis is the latest futures M5 candle close minus the close of the spot M5 candle that opened at the same time, so a delayed futures feed does not distort it; both come from TradingView and the quote payload carries no exchange timestamp.',
  'asOf is the open time of the futures candle used; futuresLagMinutes is how far it trails the latest spot candle and shows feed delay or sparse trading (the two cannot be told apart from this data alone).',
  'The futures symbol is a continuous front-month series: the basis can jump when the front contract rolls, and the contract month is not derived from the symbol.',
  'TradingView may deliver COMEX data with a delay for sessions without an exchange subscription.',
  'The basis is withheld when the futures candle trails spot by more than 30 minutes, when no spot candle matches its open time, or when it exceeds 5% of spot (likely a wrong symbol).',
  'Descriptive only: no bullish or bearish verdict for gold is derived from this snapshot.',
];

export type GoldBasisOptions = { futures: CandleSource; spot: CandleSource; now?: () => number };

/** Loader for the macro key `goldFuturesBasis`: active gold futures price versus spot at the same candle time. */
export function createGoldFuturesBasisLoader(opts: GoldBasisOptions): () => Promise<MacroItem> {
  const now = opts.now ?? (() => Date.now());
  return async function loadGoldFuturesBasis(): Promise<MacroItem> {
    const [fOut, sOut] = await Promise.allSettled([
      opts.futures.getCandles('M5', BASIS_CANDLES),
      opts.spot.getCandles('M5', BASIS_CANDLES),
    ]);
    if (fOut.status === 'rejected') return { available: false, reason: `futures_${failCode(fOut.reason)}` };
    if (sOut.status === 'rejected') return { available: false, reason: `spot_${failCode(sOut.reason)}` };
    const fRes = fOut.value;
    const sRes = sOut.value;

    const fc = validBar(fRes.latestCandle);
    if (!fc) return { available: false, reason: 'futures_no_valid_price' };
    const sLatest = validBar(sRes.latestCandle);
    if (!sLatest) return { available: false, reason: 'spot_no_valid_price' };

    const t = now();
    const futuresLagMinutes = round((sLatest.timestamp - fc.timestamp) / 60_000, 1);
    if (futuresLagMinutes > MAX_FUTURES_LAG_MINUTES) {
      return { available: false, reason: `futures_lagging_${Math.round(futuresLagMinutes)}min` };
    }

    const spotCandles: readonly Bar[] = Array.isArray(sRes.candles) ? sRes.candles : [];
    const sc = validBar(spotCandles.find((c) => c.timestamp === fc.timestamp));
    if (!sc) return { available: false, reason: 'no_spot_candle_at_futures_time' };

    const diff = fc.close - sc.close;
    const percent = (diff / sc.close) * 100;
    if (Math.abs(percent) > MAX_ABS_BASIS_PERCENT) return { available: false, reason: 'basis_implausible' };

    const leg = (res: CandleResult, c: Bar) => ({
      symbol: res.symbol,
      price: c.close,
      candleOpenTime: c.isoTime,
      ageMinutes: Math.round((t - c.timestamp) / 60_000),
      stale: res.stale,
      staleReason: res.staleReason,
      marketOpen: res.marketOpen,
      quality: res.quality,
    });

    return {
      available: true,
      source: 'tradingview',
      fetchedAt: new Date(t).toISOString(),
      data: {
        basis: {
          absolute: round(diff, 3),
          percent: round(percent, 3),
          relation: diff > 0 ? 'futures_above_spot' : diff < 0 ? 'futures_below_spot' : 'futures_equal_spot',
        },
        asOf: fc.isoTime,
        pairing: 'spot_candle_with_same_open_time_as_latest_futures_candle',
        futuresLagMinutes,
        maxFuturesLagMinutes: MAX_FUTURES_LAG_MINUTES,
        stale: Boolean(fRes.stale || sRes.stale),
        futures: leg(fRes, fc),
        spot: leg(sRes, sc),
        latestSpot: { price: sLatest.close, candleOpenTime: sLatest.isoTime },
        limitations: LIMITATIONS,
      },
    };
  };
}
