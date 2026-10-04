import type { Services } from '../services.js';
import { nullHeatmapProvider, type HeatmapResult } from './heatmap/index.js';
import { MACRO_KEYS, normalizeMacro, nullMacroProvider, type MacroSnapshot } from './macro/index.js';

/** Provider failures never leak their message; the caller only sees "provider error". */
export async function loadHeatmap(services: Services): Promise<HeatmapResult> {
  try {
    const r = await (services.heatmap ?? nullHeatmapProvider).getHeatmap();
    if (r && typeof r === 'object' && typeof r.available === 'boolean') return r;
    return { available: false, reason: 'provider error' };
  } catch {
    return { available: false, reason: 'provider error' };
  }
}

export async function loadMacro(services: Services): Promise<MacroSnapshot> {
  try {
    return normalizeMacro(await (services.macro ?? nullMacroProvider).getMacro());
  } catch {
    return normalizeMacro(null, 'provider error');
  }
}

export function macroStatus(m: MacroSnapshot) {
  const unavailable = MACRO_KEYS.filter((k) => !m[k].available);
  return { availableCount: MACRO_KEYS.length - unavailable.length, total: MACRO_KEYS.length, unavailable };
}
