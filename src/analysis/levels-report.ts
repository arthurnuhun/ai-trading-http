import type { Candle } from '../types.js';
import { atr } from './indicators.js';
import { detectStructure, type Swing } from './market-structure.js';
import { provisionalSwings } from './provisional.js';
import { clusterLevels, nearestLevels, psychologicalLevels, recentRange } from './support-resistance.js';
import { fibonacci, fibonacciFromStructure } from './fibonacci.js';
import { detectFvgs } from './fvg.js';
import { detectOrderBlocks } from './order-blocks.js';
import { findUnsweptLiquidity, groupEqualLevels, detectSweeps, type LiquidityLevel } from './liquidity.js';

// Design parameters: the skill does not define them.
export const LEVEL_RULES = {
  swingLookback: 3,
  srToleranceAtr: 0.5,
  fvgMinSizeAtr: 0.1,
  poolToleranceAtr: 0.25,
  wideZoneAtr: 2,
  recentRangeCandles: 100,
} as const;

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

export const inZone = (price: number, low: number, high: number): boolean => price >= low && price <= high;

/** The `n` items whose reference price is closest to `price` (stable for ties). */
export function nearestByDistance<T>(items: readonly T[], price: number, at: (t: T) => number, n: number): T[] {
  return [...items].sort((a, b) => Math.abs(at(a) - price) - Math.abs(at(b) - price)).slice(0, n);
}

export function zoneWidth(low: number, high: number, atrValue: number) {
  const width = high - low;
  const widthAtr = width / atrValue;
  return { width: r3(width), widthAtr: r3(widthAtr), wide: widthAtr > LEVEL_RULES.wideZoneAtr };
}

export function sweepPenetration(s: { level: number; extreme: number; closePrice: number }, atrValue: number) {
  const penetration = Math.abs(s.extreme - s.level);
  const closeInside = Math.abs(s.level - s.closePrice);
  return {
    penetration: r3(penetration),
    penetrationAtr: r3(penetration / atrValue),
    closeInside: r3(closeInside),
    closeInsideAtr: r3(closeInside / atrValue),
  };
}

const swingView = (s: Swing) => ({ type: s.type, label: s.label, price: s.price, timestamp: s.timestamp, isoTime: s.isoTime });

export function fibonacciReport(closed: readonly Candle[], lookback: number = LEVEL_RULES.swingLookback) {
  const st = detectStructure(closed, lookback);
  const prov = provisionalSwings(closed, st);
  return {
    swingLookback: st.swingLookback,
    confirmed: fibonacciFromStructure(st),
    provisional: prov.high && prov.low ? fibonacci(prov.high, prov.low) : null,
    note: 'confirmed = latest confirmed swing high and low. provisional = highest high and lowest low after the latest confirmed swing: unconfirmed and may change.',
  };
}

export function buildLevelsReport(closed: readonly Candle[], price: number) {
  const atrValue = atr(closed, 14).at(-1) ?? null;
  if (atrValue === null || !(atrValue > 0)) {
    return { available: false as const, reason: 'not enough closed candles for ATR(14)' };
  }
  const st = detectStructure(closed, LEVEL_RULES.swingLookback);
  const prov = provisionalSwings(closed, st);

  const supportResistance = nearestLevels(
    clusterLevels(st.swings, closed, price, LEVEL_RULES.srToleranceAtr * atrValue),
    3,
  ).map((l) => ({ ...l, priceInZone: inZone(price, l.zoneLow, l.zoneHigh), distance: r3(l.price - price) }));

  const fairValueGaps = nearestByDistance(
    detectFvgs(closed, LEVEL_RULES.fvgMinSizeAtr * atrValue).filter((f) => f.status !== 'filled'),
    price,
    (f) => (f.low + f.high) / 2,
    4,
  ).map((f) => ({ ...f, priceInGap: inZone(price, f.low, f.high), distance: r3((f.low + f.high) / 2 - price) }));

  const orderBlocks = nearestByDistance(
    detectOrderBlocks(closed, st.events).filter((o) => o.status === 'unmitigated'),
    price,
    (o) => (o.low + o.high) / 2,
    3,
  ).map((o) => ({
    ...o,
    ...zoneWidth(o.low, o.high, atrValue),
    priceInZone: inZone(price, o.low, o.high),
    distance: r3((o.low + o.high) / 2 - price),
  }));

  const unswept = findUnsweptLiquidity(st.swings, closed);
  const withDistance = (l: LiquidityLevel) => ({ ...l, distance: r3(l.price - price) });
  const above = unswept.filter((l) => l.side === 'BSL' && l.price > price).sort((a, b) => a.price - b.price).slice(0, 2).map(withDistance);
  const below = unswept.filter((l) => l.side === 'SSL' && l.price < price).sort((a, b) => b.price - a.price).slice(0, 2).map(withDistance);
  const pools = nearestByDistance(groupEqualLevels(unswept, LEVEL_RULES.poolToleranceAtr * atrValue), price, (p) => p.price, 3).map(
    (p) => ({ ...p, distance: r3(p.price - price) }),
  );

  const sweeps = detectSweeps(closed, st.swings)
    .slice(-3)
    .map((s) => ({ ...s, ...sweepPenetration(s, atrValue) }));

  const swingsOf = (type: 'high' | 'low') => st.swings.filter((s) => s.type === type).slice(-3).map(swingView);

  return {
    available: true as const,
    price,
    atr14: r3(atrValue),
    parameters: { ...LEVEL_RULES },
    supportResistance,
    swingHighs: swingsOf('high'),
    swingLows: swingsOf('low'),
    provisional: {
      note: 'Extremes after the latest confirmed swing. Unconfirmed; not structure events.',
      anchorTimestamp: prov.anchorTimestamp,
      high: prov.high,
      low: prov.low,
    },
    psychological: psychologicalLevels(price, 2),
    recentRange: recentRange(closed, LEVEL_RULES.recentRangeCandles),
    fairValueGaps,
    orderBlocks,
    liquidity: { above, below, pools },
    sweeps,
    fibonacci: {
      confirmed: fibonacciFromStructure(st),
      provisional: prov.high && prov.low ? fibonacci(prov.high, prov.low) : null,
    },
  };
}
