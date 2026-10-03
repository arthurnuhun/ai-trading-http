import type { Candle } from '../types.js';

export type Series = Array<number | null>;

const empty = (n: number): Series => new Array<number | null>(n).fill(null);

/** EMA seeded with the SMA of the first `period` values. */
export function ema(values: readonly number[], period: number): Series {
  const out = empty(values.length);
  if (!Number.isInteger(period) || period < 1 || values.length < period) return out;
  let prev = 0;
  for (let i = 0; i < period; i++) prev += values[i];
  prev /= period;
  out[period - 1] = prev;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

const rsiValue = (avgGain: number, avgLoss: number): number =>
  avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - 100 / (1 + avgGain / avgLoss);

/** Wilder RSI. First value at index `period`. */
export function rsi(closes: readonly number[], period = 14): Series {
  const out = empty(closes.length);
  if (!Number.isInteger(period) || period < 1 || closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = rsiValue(avgGain, avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
    out[i] = rsiValue(avgGain, avgLoss);
  }
  return out;
}

/** Wilder ATR. TR[0] = high - low. First value at index `period - 1`. */
export function atr(candles: readonly Pick<Candle, 'high' | 'low' | 'close'>[], period = 14): Series {
  const n = candles.length;
  const out = empty(n);
  if (!Number.isInteger(period) || period < 1 || n < period) return out;
  const tr: number[] = new Array(n);
  tr[0] = candles[0].high - candles[0].low;
  for (let i = 1; i < n; i++) {
    const c = candles[i];
    const pc = candles[i - 1].close;
    tr[i] = Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
  }
  let prev = 0;
  for (let i = 0; i < period; i++) prev += tr[i];
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < n; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

export type MacdResult = { macd: Series; signal: Series; histogram: Series };

/** MACD = EMA(fast) - EMA(slow); signal = EMA of MACD; histogram = MACD - signal. */
export function macd(closes: readonly number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  const n = closes.length;
  const f = ema(closes, fast);
  const s = ema(closes, slow);
  const line = empty(n);
  for (let i = 0; i < n; i++) {
    const a = f[i];
    const b = s[i];
    if (a !== null && b !== null) line[i] = a - b;
  }
  const signal = empty(n);
  const histogram = empty(n);
  const first = line.findIndex((v) => v !== null);
  if (first >= 0) {
    const defined = line.slice(first) as number[];
    const sig = ema(defined, signalPeriod);
    sig.forEach((v, j) => {
      if (v !== null) {
        signal[first + j] = v;
        histogram[first + j] = (line[first + j] as number) - v;
      }
    });
  }
  return { macd: line, signal, histogram };
}

const last = (s: Series): number | null => (s.length ? s[s.length - 1] : null);

export type IndicatorSnapshot = {
  candlesUsed: number;
  rsi14: number | null;
  macd: { macd: number | null; signal: number | null; histogram: number | null };
  atr14: number | null;
  ema: { ema20: number | null; ema50: number | null; ema100: number | null; ema200: number | null };
};

/** Latest indicator values; null where there is not enough history. */
export function computeSnapshot(candles: readonly Candle[]): IndicatorSnapshot {
  const closes = candles.map((c) => c.close);
  const m = macd(closes);
  return {
    candlesUsed: candles.length,
    rsi14: last(rsi(closes, 14)),
    macd: { macd: last(m.macd), signal: last(m.signal), histogram: last(m.histogram) },
    atr14: last(atr(candles, 14)),
    ema: {
      ema20: last(ema(closes, 20)),
      ema50: last(ema(closes, 50)),
      ema100: last(ema(closes, 100)),
      ema200: last(ema(closes, 200)),
    },
  };
}
