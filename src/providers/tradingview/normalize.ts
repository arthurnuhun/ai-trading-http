import type { Candle, NormalizeStats } from '../../types.js';

// Shape observed from @mathieuc/tradingview: { time (seconds), open, close, max (high), min (low), volume }
export type RawPeriod = {
  time: unknown;
  open: unknown;
  close: unknown;
  max: unknown;
  min: unknown;
  volume?: unknown;
};

export type NormalizeResult = { candles: Candle[]; stats: NormalizeStats };

const FUTURE_TOLERANCE_MS = 60_000;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// The library returns candles newest-first. Output is always ascending (oldest-first).
// Time gaps (market closures) are NOT treated as corruption.
export function normalizePeriods(raw: readonly RawPeriod[], nowMs: number = Date.now()): NormalizeResult {
  const stats: NormalizeStats = {
    received: raw.length,
    accepted: 0,
    malformed: 0,
    duplicates: 0,
    future: 0,
    nonMonotonic: 0,
  };
  const byTime = new Map<number, Candle>();
  let prevTs: number | null = null;
  let valid = 0;

  for (const p of raw) {
    const t = num(p?.time);
    const o = num(p?.open);
    const h = num(p?.max);
    const l = num(p?.min);
    const c = num(p?.close);
    if (
      t === null || o === null || h === null || l === null || c === null ||
      t <= 0 || o <= 0 || h <= 0 || l <= 0 || c <= 0 ||
      h < l || h < Math.max(o, c) || l > Math.min(o, c)
    ) {
      stats.malformed++;
      continue;
    }
    const timestamp = t * 1000;
    if (timestamp > nowMs + FUTURE_TOLERANCE_MS) {
      stats.future++;
      continue;
    }
    if (prevTs !== null && timestamp > prevTs) stats.nonMonotonic++; // expected newest-first
    prevTs = timestamp;
    valid++;
    byTime.set(timestamp, {
      timestamp,
      isoTime: new Date(timestamp).toISOString(),
      open: o,
      high: h,
      low: l,
      close: c,
      volume: num(p.volume),
    });
  }

  stats.duplicates = valid - byTime.size;
  const candles = [...byTime.values()].sort((a, b) => a.timestamp - b.timestamp);
  stats.accepted = candles.length;
  return { candles, stats };
}
