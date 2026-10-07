import { z } from 'zod';
import type { MacroItem } from './index.js';

/** WGC Gold Demand Trends are quarterly; a report older than this is flagged stale. */
export const WGC_STALE_AFTER_DAYS = 120;
const DAY_MS = 86_400_000;

const tonnes = z.number().finite().nullable().default(null);

const schema = z
  .object({
    quarter: z.string().regex(/^\d{4}-Q[1-4]$/, 'quarter must look like 2026-Q2'),
    publishedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'publishedOn must be YYYY-MM-DD'),
    sourceUrl: z.string().url().nullable().default(null),
    totalTonnes: tonnes,
    jewelleryTonnes: tonnes,
    technologyTonnes: tonnes,
    centralBanksTonnes: tonnes,
    barCoinTonnes: tonnes,
    etfTonnes: tonnes,
    otcTonnes: tonnes,
  })
  .strict();

function utcMs(date: string): number | null {
  const [y = 0, m = 0, d = 0] = date.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  const ok = back.getUTCFullYear() === y && back.getUTCMonth() === m - 1 && back.getUTCDate() === d;
  return ok ? t : null;
}

/** Last day of the quarter (UTC midnight). */
function quarterEndMs(quarter: string): number {
  const year = Number(quarter.slice(0, 4));
  const q = Number(quarter.slice(6));
  return Date.UTC(year, q * 3, 0);
}

export type WgcDemandOptions = { raw?: string; now?: () => Date };

/**
 * World Gold Council demand figures, maintained by the operator in one JSON env var.
 * Nothing is fetched or guessed: missing or inconsistent input is reported as unavailable.
 */
export function createWgcDemandLoader(opts: WgcDemandOptions = {}): () => Promise<MacroItem> {
  const now = opts.now ?? (() => new Date());
  return async (): Promise<MacroItem> => {
    const raw = opts.raw?.trim();
    if (!raw) return { available: false, reason: 'wgc_not_configured' };

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return { available: false, reason: 'wgc_invalid_json' };
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
      return { available: false, reason: `wgc_invalid: ${detail}` };
    }
    const v = parsed.data;

    const figures = [v.totalTonnes, v.jewelleryTonnes, v.technologyTonnes, v.centralBanksTonnes, v.barCoinTonnes, v.etfTonnes, v.otcTonnes];
    if (figures.every((x) => x === null)) return { available: false, reason: 'wgc_no_figures' };

    const published = utcMs(v.publishedOn);
    if (published === null) return { available: false, reason: 'wgc_invalid_published_date' };
    if (published <= quarterEndMs(v.quarter)) return { available: false, reason: 'wgc_published_before_quarter_end' };

    const nowMs = now().getTime();
    if (published > nowMs + DAY_MS) return { available: false, reason: 'wgc_published_in_future' };

    const ageDays = Math.round(((nowMs - published) / DAY_MS) * 10) / 10;
    const stale = ageDays > WGC_STALE_AFTER_DAYS;

    return {
      available: true,
      source: 'wgc_gold_demand_trends_manual_env',
      fetchedAt: now().toISOString(),
      data: {
        quarter: v.quarter,
        publishedOn: v.publishedOn,
        sourceUrl: v.sourceUrl,
        ageDays,
        stale,
        staleReason: stale ? `report_older_than_${WGC_STALE_AFTER_DAYS}_days` : null,
        demandTonnes: {
          total: v.totalTonnes,
          jewellery: v.jewelleryTonnes,
          technology: v.technologyTonnes,
          centralBanks: v.centralBanksTonnes,
          barCoin: v.barCoinTonnes,
          etf: v.etfTonnes,
          otc: v.otcTonnes,
        },
        limitations: [
          'Quarterly data entered manually by the operator from the World Gold Council report; it is not fetched automatically.',
          'null means the figure was not entered, not that demand was zero.',
          'Descriptive only: no bullish or bearish verdict for gold is derived from this snapshot.',
        ],
      },
    };
  };
}
