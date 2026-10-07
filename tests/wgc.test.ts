import { describe, expect, it } from 'vitest';
import { createWgcDemandLoader } from '../src/providers/macro/wgc.js';

const base = {
  quarter: '2026-Q2',
  publishedOn: '2026-07-30',
  sourceUrl: 'https://www.gold.org/goldhub/research/gold-demand-trends/gold-demand-trends-q2-2026',
  totalTonnes: 1269,
  centralBanksTonnes: 289,
  etfTonnes: -45,
  otcTonnes: 327,
};
const at = (iso: string) => () => new Date(iso);
const load = (raw: unknown, now = '2026-10-07T00:00:00Z') =>
  createWgcDemandLoader({ raw: typeof raw === 'string' ? raw : JSON.stringify(raw), now: at(now) })();

describe('wgcDemand loader', () => {
  it('is unavailable when not configured', async () => {
    expect(await createWgcDemandLoader({ now: at('2026-10-07T00:00:00Z') })()).toEqual({ available: false, reason: 'wgc_not_configured' });
    expect(await load('   ')).toEqual({ available: false, reason: 'wgc_not_configured' });
  });

  it('rejects invalid JSON', async () => {
    expect(await load('{not json')).toEqual({ available: false, reason: 'wgc_invalid_json' });
  });

  it('rejects unknown keys instead of ignoring them', async () => {
    const r = await load({ ...base, totalTonnez: 1 });
    expect(r.available).toBe(false);
    if (!r.available) expect(r.reason).toContain('wgc_invalid');
  });

  it('returns a fresh report with figures', async () => {
    const r = await load(base);
    expect(r.available).toBe(true);
    if (r.available) {
      const d = r.data as { stale: boolean; ageDays: number; quarter: string; demandTonnes: Record<string, number | null> };
      expect(d.stale).toBe(false);
      expect(d.ageDays).toBeCloseTo(69, 0);
      expect(d.quarter).toBe('2026-Q2');
      expect(d.demandTonnes.total).toBe(1269);
      expect(d.demandTonnes.etf).toBe(-45);
    }
  });

  it('keeps figures that were not entered as null', async () => {
    const r = await load(base);
    expect(r.available).toBe(true);
    if (r.available) {
      const d = r.data as { demandTonnes: Record<string, number | null> };
      expect(d.demandTonnes.jewellery).toBeNull();
      expect(d.demandTonnes.barCoin).toBeNull();
      expect(d.demandTonnes.technology).toBeNull();
    }
  });

  it('flags a report older than 120 days as stale', async () => {
    const r = await load(base, '2026-12-01T00:00:00Z');
    expect(r.available).toBe(true);
    if (r.available) {
      const d = r.data as { stale: boolean; staleReason: string | null };
      expect(d.stale).toBe(true);
      expect(d.staleReason).toBe('report_older_than_120_days');
    }
  });

  it('rejects a publish date in the future', async () => {
    expect(await load({ ...base, publishedOn: '2026-12-31' })).toEqual({ available: false, reason: 'wgc_published_in_future' });
  });

  it('rejects a publish date on or before the quarter end', async () => {
    expect(await load({ ...base, publishedOn: '2026-06-30' })).toEqual({ available: false, reason: 'wgc_published_before_quarter_end' });
  });

  it('rejects a report with no figures', async () => {
    expect(await load({ quarter: '2026-Q2', publishedOn: '2026-07-30' })).toEqual({ available: false, reason: 'wgc_no_figures' });
  });
});
