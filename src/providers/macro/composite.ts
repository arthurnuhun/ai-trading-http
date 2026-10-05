import { MACRO_KEYS, type MacroItem, type MacroKey, type MacroProvider, type MacroSnapshot } from './index.js';

export type MacroItemLoader = () => Promise<MacroItem>;

/** Combines per-key loaders into one MacroProvider; a failing loader only makes its own key unavailable. */
export function createMacroProvider(loaders: Partial<Record<MacroKey, MacroItemLoader>>): MacroProvider {
  return {
    async getMacro(): Promise<Partial<MacroSnapshot>> {
      const out: Partial<MacroSnapshot> = {};
      await Promise.all(
        MACRO_KEYS.map(async (key) => {
          const load = loaders[key];
          if (!load) return;
          try {
            out[key] = await load();
          } catch {
            out[key] = { available: false, reason: 'provider error' };
          }
        }),
      );
      return out;
    },
  };
}
