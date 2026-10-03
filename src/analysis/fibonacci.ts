import type { StructureResult, Swing } from './market-structure.js';

export const RETRACEMENT_RATIOS = [0.382, 0.5, 0.618, 0.786] as const;
export const EXTENSION_RATIOS = [1.272, 1.618] as const;

const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const label = (ratio: number): string => `${Math.round(ratio * 1000) / 10}%`;

export type FibPoint = { price: number; timestamp: number; isoTime: string };
export type FibLevel = { ratio: number; label: string; price: number };
export type FibResult = {
  direction: 'up_leg' | 'down_leg'; // up_leg: low came first, then high
  swingHigh: FibPoint;
  swingLow: FibPoint;
  range: number;
  retracements: FibLevel[];
  extensions: FibLevel[];
};

const point = (s: Swing): FibPoint => ({ price: s.price, timestamp: s.timestamp, isoTime: s.isoTime });

export function fibonacci(high: Swing, low: Swing): FibResult | null {
  const range = high.price - low.price;
  if (!(range > 0)) return null;
  const up = low.index < high.index;
  return {
    direction: up ? 'up_leg' : 'down_leg',
    swingHigh: point(high),
    swingLow: point(low),
    range: r3(range),
    retracements: RETRACEMENT_RATIOS.map((r) => ({
      ratio: r,
      label: label(r),
      price: r3(up ? high.price - r * range : low.price + r * range),
    })),
    extensions: EXTENSION_RATIOS.map((e) => ({
      ratio: e,
      label: label(e),
      price: r3(up ? low.price + e * range : high.price - e * range),
    })),
  };
}

/** Uses the most recent swing high and the most recent swing low. */
export function fibonacciFromStructure(s: StructureResult): FibResult | null {
  if (!s.lastSwingHigh || !s.lastSwingLow) return null;
  return fibonacci(s.lastSwingHigh, s.lastSwingLow);
}
