import type { Candle } from '../types.js';
import { detectSwings, type StructureResult, type Swing } from './market-structure.js';

export type LiquidityLevel = { side: 'BSL' | 'SSL'; price: number; timestamp: number; isoTime: string };

/** Swing highs (BSL) and lows (SSL) that price has not traded beyond since they formed. */
export function findUnsweptLiquidity(swings: readonly Swing[], candles: readonly Candle[]): LiquidityLevel[] {
  const out: LiquidityLevel[] = [];
  for (const s of swings) {
    let traded = false;
    for (let j = s.index + 1; j < candles.length; j++) {
      if (s.type === 'high' ? candles[j].high > s.price : candles[j].low < s.price) {
        traded = true;
        break;
      }
    }
    if (!traded) {
      out.push({ side: s.type === 'high' ? 'BSL' : 'SSL', price: s.price, timestamp: s.timestamp, isoTime: s.isoTime });
    }
  }
  return out;
}

export type LiquidityPool = {
  side: 'BSL' | 'SSL';
  price: number; // BSL: highest level of the pool; SSL: lowest
  count: number;
  fromTimestamp: number;
  toTimestamp: number;
};

/** Two or more same-side levels within `tolerance` of the cluster's lowest price form a pool. */
export function groupEqualLevels(levels: readonly LiquidityLevel[], tolerance: number): LiquidityPool[] {
  if (!(tolerance > 0)) return [];
  const pools: LiquidityPool[] = [];
  for (const side of ['BSL', 'SSL'] as const) {
    const sorted = levels.filter((l) => l.side === side).sort((a, b) => a.price - b.price);
    const clusters: LiquidityLevel[][] = [];
    for (const l of sorted) {
      const cur = clusters[clusters.length - 1];
      if (cur && l.price - cur[0].price <= tolerance) cur.push(l);
      else clusters.push([l]);
    }
    for (const g of clusters) {
      if (g.length < 2) continue;
      const prices = g.map((x) => x.price);
      const times = g.map((x) => x.timestamp);
      pools.push({
        side,
        price: side === 'BSL' ? Math.max(...prices) : Math.min(...prices),
        count: g.length,
        fromTimestamp: Math.min(...times),
        toTimestamp: Math.max(...times),
      });
    }
  }
  return pools.sort((a, b) => b.price - a.price);
}

export type Sweep = {
  type: 'BSL_sweep' | 'SSL_sweep';
  level: number;
  levelTimestamp: number;
  timestamp: number; // the sweeping candle
  isoTime: string;
  extreme: number; // wick extreme beyond the level
  closePrice: number;
  reversalConfirmed: boolean; // BSL_sweep -> bearish reversal, SSL_sweep -> bullish reversal
  reversalTimestamp: number | null;
};

/**
 * For each swing, the first candle that trades beyond it. If that candle closes back inside the
 * level it is a sweep; if it closes beyond, it is a break and nothing is reported.
 * A reversal is confirmed when, within `reversalWindow` candles, a close passes the opposite
 * extreme of the sweeping candle.
 */
export function detectSweeps(candles: readonly Candle[], swings: readonly Swing[], reversalWindow = 3): Sweep[] {
  const out: Sweep[] = [];
  for (const s of swings) {
    const isHigh = s.type === 'high';
    let j = -1;
    for (let k = s.index + 1; k < candles.length; k++) {
      if (isHigh ? candles[k].high > s.price : candles[k].low < s.price) {
        j = k;
        break;
      }
    }
    if (j < 0) continue;
    const c = candles[j];
    if (isHigh ? c.close > s.price : c.close < s.price) continue; // closed beyond: a break, not a sweep

    let reversalTimestamp: number | null = null;
    for (let k = j + 1; k <= j + reversalWindow && k < candles.length; k++) {
      if (isHigh ? candles[k].close < c.low : candles[k].close > c.high) {
        reversalTimestamp = candles[k].timestamp;
        break;
      }
    }
    out.push({
      type: isHigh ? 'BSL_sweep' : 'SSL_sweep',
      level: s.price,
      levelTimestamp: s.timestamp,
      timestamp: c.timestamp,
      isoTime: c.isoTime,
      extreme: isHigh ? c.high : c.low,
      closePrice: c.close,
      reversalConfirmed: reversalTimestamp !== null,
      reversalTimestamp,
    });
  }
  return out.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * CANDIDATES only: the skill does not define inducement. These are sweeps of minor swings
 * (lookback 1) formed after the most recent major swing.
 */
export function inducementCandidates(candles: readonly Candle[], structure: StructureResult): Sweep[] {
  const anchor = Math.max(structure.lastSwingHigh?.index ?? -1, structure.lastSwingLow?.index ?? -1);
  if (anchor < 0) return [];
  const minor = detectSwings(candles, 1).filter((s) => s.index > anchor);
  return detectSweeps(candles, minor);
}
