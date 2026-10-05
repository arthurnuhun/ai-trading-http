import { describe, it, expect } from 'vitest';
import { newsGuardWarnings } from '../src/analysis/news-guard.js';
import type { MacroItem } from '../src/providers/macro/index.js';

const NINE_PM = '2026-10-05T21:00:00.000+07:00';

const ev = (
  title: string,
  currency: string,
  impact: string,
  minutesUntil: number,
  timeVerified = true,
  timeWib = NINE_PM,
) => ({ title, currency, impact, minutesUntil, timeWib, timeVerified });

const cal = (events: unknown[], extra: Record<string, unknown> = {}): MacroItem => ({
  available: true,
  source: 'forexfactory_feed',
  fetchedAt: '2026-10-05T00:00:00.000Z',
  data: { events, nextHighImpactUsd: null, stale: false, coverage: { windowBeyondCoverage: false }, ...extra },
});

describe('newsGuardWarnings', () => {
  it('reports an unavailable calendar with its reason', () => {
    const w = newsGuardWarnings({ available: false, reason: 'calendar feed unavailable' });
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/calendar/i);
    expect(w[0]).toContain('calendar feed unavailable');
    expect(w[0]).toContain('cannot be verified');
  });

  it('flags NO ENTRY for major news within 30 minutes', () => {
    const w = newsGuardWarnings(cal([ev('Non-Farm Employment Change', 'USD', 'High', 20)]));
    expect(w[0]).toContain('NO ENTRY');
    expect(w[0]).toContain('Non-Farm Employment Change');
    expect(w[0]).toContain('21:00 WIB');
    expect(w[0]).toContain('in 20 min');
  });

  it('gives a pre-news warning with the no-entry time for news within 4 hours', () => {
    const w = newsGuardWarnings(cal([ev('CPI m/m', 'USD', 'High', 120)]));
    expect(w[0]).toContain('Pre-news');
    expect(w[0]).toContain('in 2h 0m');
    expect(w[0]).toContain('no new entry from 20:30 WIB');
    expect(w[0]).not.toContain('NO ENTRY');
  });

  it('says so when there is no major news, ignoring events beyond 4 hours', () => {
    const w = newsGuardWarnings(cal([ev('FOMC Meeting Minutes', 'USD', 'High', 300)]));
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/no major USD news/);
  });

  it('does not treat an ordinary Medium USD event as major news', () => {
    const w = newsGuardWarnings(cal([ev('ISM Services PMI', 'USD', 'Medium', 60)]));
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/no major USD news/);
  });

  it('treats Michigan Sentiment as major even at Medium impact', () => {
    const w = newsGuardWarnings(cal([ev('Prelim UoM Consumer Sentiment', 'USD', 'Medium', 90)]));
    expect(w[0]).toContain('Prelim UoM Consumer Sentiment');
    expect(w[0]).toContain('Pre-news');
  });

  it('ignores High-impact events of other currencies', () => {
    const w = newsGuardWarnings(cal([ev('BOJ Gov Ueda Speaks', 'JPY', 'High', 10)]));
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/no major USD news/);
  });

  it('marks an unverified release time', () => {
    const w = newsGuardWarnings(cal([ev('CPI m/m', 'USD', 'High', 45, false)]));
    expect(w[0]).toContain('unverified');
    expect(w[0]).toContain('web search');
  });

  it('adds notes for stale data and limited coverage', () => {
    const w = newsGuardWarnings(cal([], { stale: true, coverage: { windowBeyondCoverage: true } }));
    expect(w.join(' ')).toMatch(/stale/);
    expect(w.join(' ')).toMatch(/coverage/);
  });
});
