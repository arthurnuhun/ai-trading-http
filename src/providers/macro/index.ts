export const MACRO_KEYS = [
  'dxy',
  'fedwatch',
  'cotGold',
  'cotGoldPrimary',
  'us10y',
  'wgcDemand',
  'economicCalendar',
  'gcq26Underlying',
] as const;
export type MacroKey = (typeof MACRO_KEYS)[number];

export type MacroItem =
  | { available: false; reason: string }
  | { available: true; source: string; fetchedAt: string; data: unknown };
export type MacroSnapshot = Record<MacroKey, MacroItem>;

export interface MacroProvider {
  getMacro(): Promise<Partial<MacroSnapshot>>;
}

/** Every key present; anything missing or malformed becomes unavailable. */
export function normalizeMacro(
  raw: Partial<MacroSnapshot> | null | undefined,
  reason = 'provider unavailable',
): MacroSnapshot {
  const unavailable: MacroItem = { available: false, reason };
  const out = {} as MacroSnapshot;
  for (const k of MACRO_KEYS) {
    const item = raw?.[k];
    out[k] = item && typeof item === 'object' && typeof item.available === 'boolean' ? item : unavailable;
  }
  return out;
}

export const nullMacroProvider: MacroProvider = {
  async getMacro(): Promise<Partial<MacroSnapshot>> {
    return normalizeMacro(null);
  },
};
