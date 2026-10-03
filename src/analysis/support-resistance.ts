import type { Candle } from '../types.js';
import type { Swing } from './market-structure.js';

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

export type SrLevel = {
  price: number;
  zoneLow: number;
  zoneHigh: number;
  kind: 'support' | 'resistance';
  origin: 'swing_high' | 'swing_low' | 'mixed';
  touches: number;
  firstTimestamp: number;
  lastTimestamp: number;
  flipped: boolean;
};

/** Cluster swings whose prices lie within `tolerance` of the cluster's lowest price. */
export function clusterLevels(
  swings: readonly Swing[],
  candles: readonly Candle[],
  referencePrice: number,
  tolerance: number,
): SrLevel[] {
  if (!(tolerance > 0) || swings.length === 0) return [];
  const sorted = [...swings].sort((a, b) => a.price - b.price);
  const clusters: Swing[][] = [];
  for (const s of sorted) {
    const cur = clusters[clusters.length - 1];
    if (cur && s.price - cur[0].price <= tolerance) cur.push(s);
    else clusters.push([s]);
  }

  const levels = clusters.map((group): SrLevel => {
    const prices = group.map((s) => s.price);
    const times = group.map((s) => s.timestamp);
    const zoneLow = Math.min(...prices);
    const zoneHigh = Math.max(...prices);
    const price = prices.reduce((a, b) => a + b, 0) / prices.length;
    const highs = group.filter((s) => s.type === 'high').length;
    const origin = highs === group.length ? 'swing_high' : highs === 0 ? 'swing_low' : 'mixed';
    const kind = price > referencePrice ? 'resistance' : 'support';
    const lastTimestamp = Math.max(...times);
    let flipped = false;
    if (origin === 'swing_high' && kind === 'support') {
      flipped = candles.some((c) => c.timestamp > lastTimestamp && c.close > zoneHigh);
    } else if (origin === 'swing_low' && kind === 'resistance') {
      flipped = candles.some((c) => c.timestamp > lastTimestamp && c.close < zoneLow);
    }
    return {
      price: r3(price),
      zoneLow: r3(zoneLow),
      zoneHigh: r3(zoneHigh),
      kind,
      origin,
      touches: group.length,
      firstTimestamp: Math.min(...times),
      lastTimestamp,
      flipped,
    };
  });
  return levels.sort((a, b) => b.price - a.price); // highest first
}

/** The `perSide` closest resistances above and supports below, highest first. */
export function nearestLevels(levels: readonly SrLevel[], perSide = 3): SrLevel[] {
  const res = levels.filter((l) => l.kind === 'resistance').sort((a, b) => a.price - b.price).slice(0, perSide);
  const sup = levels.filter((l) => l.kind === 'support').sort((a, b) => b.price - a.price).slice(0, perSide);
  return [...res, ...sup].sort((a, b) => b.price - a.price);
}

export type PsychLevel = { price: number; major: boolean; distance: number };

/** `perSide` round levels at or below the price and `perSide` above it. */
export function psychologicalLevels(price: number, perSide = 3, step = 50, majorStep = 100): PsychLevel[] {
  const lo = Math.floor(price / step) * step;
  const out: PsychLevel[] = [];
  for (let i = -(perSide - 1); i <= perSide; i++) {
    const p = lo + i * step;
    out.push({ price: p, major: p % majorStep === 0, distance: r3(p - price) });
  }
  return out;
}

export type Extreme = { price: number; timestamp: number; isoTime: string };

export function recentRange(
  candles: readonly Candle[],
  n = 100,
): { candles: number; high: Extreme; low: Extreme } | null {
  if (candles.length === 0) return null;
  const slice = candles.slice(-n);
  let hi = slice[0];
  let lo = slice[0];
  for (const c of slice) {
    if (c.high > hi.high) hi = c;
    if (c.low < lo.low) lo = c;
  }
  return {
    candles: slice.length,
    high: { price: hi.high, timestamp: hi.timestamp, isoTime: hi.isoTime },
    low: { price: lo.low, timestamp: lo.timestamp, isoTime: lo.isoTime },
  };
}
