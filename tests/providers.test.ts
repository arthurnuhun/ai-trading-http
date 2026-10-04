import { describe, it, expect } from 'vitest';
import { nullHeatmapProvider } from '../src/providers/heatmap/index.js';
import { MACRO_KEYS, nullMacroProvider } from '../src/providers/macro/index.js';
import { loadHeatmap, loadMacro, macroStatus } from '../src/providers/context-providers.js';
import type { Services } from '../src/services.js';

const bare = {} as unknown as Services;

describe('null providers', () => {
  it('heatmap is unavailable and never produces a signal', async () => {
    expect(await nullHeatmapProvider.getHeatmap()).toEqual({ available: false, reason: 'No heatmap provider configured' });
  });
  it('macro reports every input as unavailable with the documented shape', async () => {
    const m = await nullMacroProvider.getMacro();
    expect(Object.keys(m)).toEqual([...MACRO_KEYS]);
    for (const k of MACRO_KEYS) expect(m[k]).toEqual({ available: false, reason: 'provider unavailable' });
  });
});

describe('context provider helpers', () => {
  it('fall back to the null providers and hide provider errors', async () => {
    expect(await loadHeatmap(bare)).toMatchObject({ available: false });
    const failing = {
      macro: { getMacro: async () => { throw new Error('secret boom'); } },
      heatmap: { getHeatmap: async () => { throw new Error('secret boom'); } },
    } as unknown as Services;
    const h = await loadHeatmap(failing);
    const m = await loadMacro(failing);
    expect(h).toEqual({ available: false, reason: 'provider error' });
    expect(m.dxy).toEqual({ available: false, reason: 'provider error' });
    expect(JSON.stringify(m)).not.toContain('secret');
  });
  it('normalizes a snapshot with missing keys', async () => {
    const partial = {
      macro: { getMacro: async () => ({ dxy: { available: true, source: 't', fetchedAt: 'x', data: 1 } }) },
    } as unknown as Services;
    const m = await loadMacro(partial);
    expect(m.dxy.available).toBe(true);
    expect(m.us10y).toEqual({ available: false, reason: 'provider unavailable' });
    expect(Object.keys(m)).toEqual([...MACRO_KEYS]);
  });
  it('macroStatus counts the available inputs', async () => {
    const m = await loadMacro(bare);
    expect(macroStatus(m)).toEqual({ availableCount: 0, total: 8, unavailable: [...MACRO_KEYS] });
  });
});
