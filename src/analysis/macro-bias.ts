import type { MacroItem, MacroSnapshot } from '../providers/macro/index.js';
import type { Factor } from './confluence.js';
import type { Direction } from './risk.js';

/** Design choices, not derived from data: a 24h move smaller than these counts as flat. */
export const MACRO_BIAS_RULES = { window: '24h', dxyMinPercent: 0.1, us10yMinPoints: 0.02 } as const;

type Move = 'up' | 'down' | 'flat';
type Leg = { move: Move; label: string };
type LegResult = { ok: true; leg: Leg } | { ok: false; reason: string };
type ChangeRow = { window?: unknown; baselineGap?: unknown; absolute?: unknown; percent?: unknown };
type SnapshotData = { freshness?: { stale?: unknown; staleReason?: unknown } | null; changes?: unknown };

const BIAS_TEXT = {
  bullish_for_gold: 'both falling: macro bias is bullish for gold',
  bearish_for_gold: 'both rising: macro bias is bearish for gold',
  neutral: 'mixed or below threshold: no clear macro bias',
} as const;

function readLeg(
  name: string,
  item: MacroItem | undefined,
  field: 'percent' | 'absolute',
  minMove: number,
  unit: string,
): LegResult {
  if (!item) return { ok: false, reason: `${name} missing` };
  if (!item.available) return { ok: false, reason: `${name} unavailable (${item.reason})` };
  const data = item.data as SnapshotData | null | undefined;
  if (!data || typeof data !== 'object') return { ok: false, reason: `${name} data malformed` };
  const fr = data.freshness;
  if (fr && fr.stale === true) {
    return { ok: false, reason: `${name} data is stale (${String(fr.staleReason ?? 'unknown')})` };
  }
  const rows = Array.isArray(data.changes) ? (data.changes as ChangeRow[]) : [];
  const row = rows.find((r) => r && r.window === MACRO_BIAS_RULES.window);
  if (!row) return { ok: false, reason: `${name} has no 24h change` };
  if (row.baselineGap === true) return { ok: false, reason: `${name} 24h baseline has a gap` };
  const v = row[field];
  if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false, reason: `${name} 24h change unavailable` };
  const move: Move = Math.abs(v) < minMove ? 'flat' : v > 0 ? 'up' : 'down';
  return { ok: true, leg: { move, label: `${name} ${v > 0 ? '+' : ''}${v}${unit}` } };
}

/**
 * Macro bias factor from the 24h direction of DXY and US10Y (gold moves against both).
 * pass only when both are fresh and move together in the direction that supports the trade;
 * a mixed or flat picture is a fail (not a pass); missing or stale data is unavailable.
 */
export function evaluateMacroBias(dir: Direction, macro: Pick<MacroSnapshot, 'dxy' | 'us10y'>): Factor {
  const dxy = readLeg('DXY', macro.dxy, 'percent', MACRO_BIAS_RULES.dxyMinPercent, '%');
  const us10y = readLeg('US10Y', macro.us10y, 'absolute', MACRO_BIAS_RULES.us10yMinPoints, ' pp');
  if (!dxy.ok || !us10y.ok) {
    const reasons: string[] = [];
    if (!dxy.ok) reasons.push(dxy.reason);
    if (!us10y.ok) reasons.push(us10y.reason);
    return { status: 'unavailable', reason: `Macro bias unavailable: ${reasons.join('; ')}` };
  }

  const bias =
    dxy.leg.move === 'down' && us10y.leg.move === 'down'
      ? 'bullish_for_gold'
      : dxy.leg.move === 'up' && us10y.leg.move === 'up'
        ? 'bearish_for_gold'
        : 'neutral';
  const supports = (dir === 'buy' && bias === 'bullish_for_gold') || (dir === 'sell' && bias === 'bearish_for_gold');
  const verdictText = supports ? `supports a ${dir}` : bias === 'neutral' ? 'not counted as a pass' : `against a ${dir}`;
  const rules = `thresholds: DXY ${MACRO_BIAS_RULES.dxyMinPercent}%, US10Y ${MACRO_BIAS_RULES.us10yMinPoints} pp over ${MACRO_BIAS_RULES.window}`;
  return {
    status: supports ? 'pass' : 'fail',
    reason: `${dxy.leg.label}, ${us10y.leg.label} (${MACRO_BIAS_RULES.window}): ${BIAS_TEXT[bias]}; ${verdictText} (${rules})`,
  };
}
