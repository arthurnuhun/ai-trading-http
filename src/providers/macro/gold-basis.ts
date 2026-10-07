import { AppError } from '../../errors.js';
import type { CandleResult } from '../tradingview/adapter.js';
import type { MacroItem } from './index.js';
import type { CandleSource } from './tv-snapshot.js';

export const BASIS_CANDLES = 12;
/** Futures and spot prices must come from M5 candles opened at most this far apart. */
export const MAX_ALIGNMENT_MINUTES = 10;
/** A basis larger than this (percent of spot) almost surely means a wrong symbol or bad data. */
export const MAX_ABS_BASIS_PERCENT = 5;

const round = (x: number, digits: number) => Number(x.toFixed(digits));
const failCode = (err: unknown) => (err instanceof AppError ? err.code : 'provider_error');

type LatestCandle = NonNullable<CandleResult['latestCandle']>;

function validCandle(res: CandleResult): LatestCandle | null {
  const c = res.latestCandle;
  if (!c || !Number.isFinite(c.close) || c.close <= 0 || !Number.isFinite(c.timestamp)) return null;
  return c;
}

const LIMITATIONS = [
  'Basis is the latest M5 candle close of the futures symbol minus that of the spot symbol; both come from TradingView and the quote payload carries no exchange timestamp.',
  'The futures symbol is a continuous front-month series: the basis can jump when the front contract rolls, and the contract month is not derived from the symbol.',
  'TradingView may deliver COMEX data with a delay for sessions without an exchange subscription; ageMinutes shows the age of each latest M5 candle, which can also be old simply because trading is sparse.',
  'The basis is withheld when the two candles are more than 10 minutes apart or when it exceeds 5% of spot (likely a wrong symbol).',
  'Descriptive only: no bullish or bearish verdict for gold is derived from this snapshot.',
];

export type GoldBasisOptions = { futures: CandleSource; spot: CandleSource; now?: () => number };

/** Loader for the macro key `goldFuturesBasis`: active gold futures price versus spot. */
export function createGoldFuturesBasisLoader(opts: GoldBasisOptions): () => Promise<MacroItem> {
  const now = opts.now ?? (() => Date.now());
  return async function loadGoldFuturesBasis(): Promise<MacroItem> {
    const [fOut, sOut] = await Promise.allSettled([
      opts.futures.getCandles('M5', BASIS_CANDLES),
      opts.spot.getCandles('M5', BASIS_CANDLES),
    ]);
    if (fOut.status === 'rejected') return { available: false, reason: `futures_${failCode(fOut.reason)}` };
    if (sOut.status === 'rejected') return { available: false, reason: `spot_${failCode(sOut.reason)}` };

    const fc = validCandle(fOut.value);
    if (!fc) return { available: false, reason: 'futures_no_valid_price' };
    const sc = validCandle(sOut.value);
    if (!sc) return { available: false, reason: 'spot_no_valid_price' };

    const t = now();
    const alignmentMinutes = round(Math.abs(fc.timestamp - sc.timestamp) / 60_000, 1);
    if (alignmentMinutes > MAX_ALIGNMENT_MINUTES) {
      return { available: false, reason: `price_times_misaligned_${Math.round(alignmentMinutes)}min` };
    }

    const diff = fc.close - sc.close;
    const percent = (diff / sc.close) * 100;
    if (Math.abs(percent) > MAX_ABS_BASIS_PERCENT) return { available: false, reason: 'basis_implausible' };

    const leg = (res: CandleResult, c: LatestCandle) => ({
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
        alignmentMinutes,
        maxAlignmentMinutes: MAX_ALIGNMENT_MINUTES,
        stale: Boolean(fOut.value.stale || sOut.value.stale),
        futures: leg(fOut.value, fc),
        spot: leg(sOut.value, sc),
        limitations: LIMITATIONS,
      },
    };
  };
}
