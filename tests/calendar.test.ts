import { describe, it, expect } from 'vitest';
import {
  buildCalendarData,
  checkEventTime,
  createEconomicCalendar,
  parseCalendarFeed,
  type RawCalendarEvent,
} from '../src/providers/macro/calendar.js';
import { createMacroProvider } from '../src/providers/macro/composite.js';

const FEED = [
  { title: 'OPEC-JMMC Meetings', country: 'All', date: '2026-10-04T05:15:00-04:00', impact: 'Medium', forecast: '', previous: '' },
  { title: 'Final Services PMI', country: 'USD', date: '2026-10-05T09:45:00-04:00', impact: 'Low', forecast: '58.7', previous: '58.7' },
  { title: 'ISM Services PMI', country: 'USD', date: '2026-10-05T10:00:00-04:00', impact: 'Medium', forecast: '55.1', previous: '55.4' },
  { title: 'Bank Holiday', country: 'CNY', date: '2026-10-05T19:01:00-04:00', impact: 'Holiday', forecast: '', previous: '' },
  { title: 'BOJ Gov Ueda Speaks', country: 'JPY', date: '2026-10-06T02:35:00-04:00', impact: 'High', forecast: '', previous: '' },
  { title: 'ADP Weekly Employment Change', country: 'USD', date: '2026-10-06T08:15:00-04:00', impact: 'Low', forecast: '', previous: '' },
  { title: 'Ivey PMI', country: 'CAD', date: '2026-10-06T10:00:00-04:00', impact: 'Medium', forecast: '65.2', previous: '64.3' },
  { title: 'FOMC Member Bowman Speaks', country: 'USD', date: '2026-10-06T10:45:00-04:00', impact: 'Low', forecast: '', previous: '' },
  { title: 'FOMC Meeting Minutes', country: 'USD', date: '2026-10-07T14:00:00-04:00', impact: 'High', forecast: '', previous: '' },
  { title: 'Unemployment Claims', country: 'USD', date: '2026-10-08T08:30:00-04:00', impact: 'Medium', forecast: '200K', previous: '197K' },
  { title: 'Employment Change', country: 'CAD', date: '2026-10-09T08:30:00-04:00', impact: 'High', forecast: '9.0K', previous: '-41.7K' },
  { title: 'Prelim UoM Consumer Sentiment', country: 'USD', date: '2026-10-09T10:00:00-04:00', impact: 'Medium', forecast: '47.6', previous: '47.8' },
];

const ev = (title: string, country: string, date: string, impact = 'Medium'): RawCalendarEvent =>
  parseCalendarFeed([{ title, country, date, impact, forecast: '', previous: '' }]).events[0]!;

const NOW = Date.parse('2026-10-05T10:00:00Z');
const base = { nowMs: NOW, windowHours: 24, maxEvents: 8, fomcDecisionDates: [] as string[] };

describe('parseCalendarFeed', () => {
  it('normalizes valid events and counts malformed ones', () => {
    const r = parseCalendarFeed([
      { title: 'ISM Services PMI', country: 'USD', date: '2026-10-05T10:00:00-04:00', impact: 'Medium', forecast: '55.1', previous: '55.4' },
      { title: 'x', country: 'USD', date: 'not-a-date', impact: 'High' },
      { title: '', country: 'USD', date: '2026-10-05T10:00:00-04:00', impact: 'High' },
      { title: 'A', country: 'USD', date: '2026-10-05T10:00:00-04:00', impact: 'Huge' },
      'text',
      null,
    ]);
    expect(r.valid).toBe(true);
    expect(r.received).toBe(6);
    expect(r.events).toHaveLength(1);
    expect(r.malformed).toBe(5);
    expect(r.events[0]!.epochMs).toBe(Date.parse('2026-10-05T10:00:00-04:00'));
    expect(r.events[0]!.forecast).toBe('55.1');
  });

  it('reports a non-array payload as invalid', () => {
    expect(parseCalendarFeed({}).valid).toBe(false);
    expect(parseCalendarFeed('x').valid).toBe(false);
  });
});

describe('checkEventTime', () => {
  it('matches a US release at its conventional time', () => {
    expect(checkEventTime(ev('ISM Services PMI', 'USD', '2026-10-05T10:00:00-04:00')).timeCheck).toBe('pattern_match');
  });

  it('flags a US release at an unexpected time', () => {
    const r = checkEventTime(ev('ISM Services PMI', 'USD', '2026-10-05T11:00:00-04:00'));
    expect(r.timeCheck).toBe('pattern_mismatch');
    expect(r.expectedEt).toBe('10:00');
  });

  it('flags a feed offset that is not US Eastern for that date', () => {
    expect(checkEventTime(ev('ISM Services PMI', 'USD', '2026-10-05T10:00:00-05:00')).timeCheck).toBe('offset_mismatch');
    expect(checkEventTime(ev('FOMC Statement', 'USD', '2026-12-09T14:00:00-05:00')).timeCheck).toBe('pattern_match');
    expect(checkEventTime(ev('FOMC Statement', 'USD', '2026-12-09T14:00:00-04:00')).timeCheck).toBe('offset_mismatch');
  });

  it('is offset-only for events without a known release pattern', () => {
    expect(checkEventTime(ev('Ivey PMI', 'CAD', '2026-10-06T10:00:00-04:00')).timeCheck).toBe('offset_only');
  });
});

describe('buildCalendarData', () => {
  const events = parseCalendarFeed(FEED).events;

  it('converts to UTC and WIB', () => {
    const d = buildCalendarData(events, base);
    const ism = d.events.find((e) => e.title === 'ISM Services PMI')!;
    expect(ism.timeUtc).toBe('2026-10-05T14:00:00.000Z');
    expect(ism.timeWib).toBe('2026-10-05T21:00:00.000+07:00');
    expect(ism.timeFeed).toBe('2026-10-05T10:00:00-04:00');
    expect(ism.minutesUntil).toBe(240);
    expect(ism.timeVerified).toBe(true);
  });

  it('keeps USD Medium/High and other-currency High within the window', () => {
    const d = buildCalendarData(events, base);
    expect(d.events.map((e) => e.title)).toEqual(['ISM Services PMI', 'BOJ Gov Ueda Speaks']);
    expect(d.unverifiedHighImpact).toEqual(['BOJ Gov Ueda Speaks']);
  });

  it('reports the next USD High-impact event', () => {
    const d = buildCalendarData(events, base);
    expect(d.nextHighImpactUsd?.title).toBe('FOMC Meeting Minutes');
    expect(d.nextHighImpactUsd?.timeWib).toBe('2026-10-08T01:00:00.000+07:00');
    expect(d.nextHighImpactUsd?.minutesUntil).toBe(3360);
    expect(d.nextHighImpactUsd?.timeVerified).toBe(true);
  });

  it('flags a window beyond feed coverage', () => {
    expect(buildCalendarData(events, base).coverage.windowBeyondCoverage).toBe(false);
    const late = buildCalendarData(events, { ...base, nowMs: Date.parse('2026-10-09T12:00:00Z') });
    expect(late.coverage.windowBeyondCoverage).toBe(true);
  });

  it('cross-checks FOMC decision dates against the configured schedule', () => {
    const fed = [ev('Federal Funds Rate', 'USD', '2026-10-28T14:00:00-04:00', 'High')];
    const now = Date.parse('2026-10-28T12:00:00Z');
    const on = buildCalendarData(fed, { ...base, nowMs: now, fomcDecisionDates: ['2026-10-28'] }).events[0]!;
    expect(on.fomcSchedule).toBe('on_schedule');
    expect(on.timeVerified).toBe(true);
    const off = buildCalendarData(fed, { ...base, nowMs: now, fomcDecisionDates: ['2026-12-09'] }).events[0]!;
    expect(off.fomcSchedule).toBe('not_in_schedule');
    expect(off.timeVerified).toBe(false);
    const none = buildCalendarData(fed, { ...base, nowMs: now }).events[0]!;
    expect(none.fomcSchedule).toBe('no_schedule_configured');
  });
});

const THIS = 'https://example.test/this.json';
const NEXT = 'https://example.test/next.json';
const urls = { thisWeek: THIS, nextWeek: NEXT };

function mockFetch(handler: (url: string) => { status: number; body: string }) {
  const calls: string[] = [];
  const fn = (async (url: unknown) => {
    calls.push(String(url));
    const r = handler(String(url));
    return new Response(r.body, { status: r.status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const okAll = (url: string) =>
  url === THIS ? { status: 200, body: JSON.stringify(FEED) } : { status: 200, body: '[]' };

describe('economic calendar provider', () => {
  it('loads this week and next week and serves from cache', async () => {
    const { fn, calls } = mockFetch(okAll);
    let t = NOW;
    const load = createEconomicCalendar({ fetchFn: fn, now: () => t, urls, cacheTtlMs: 60_000 });
    const first: any = await load();
    expect(first.available).toBe(true);
    expect(first.data.events.map((e: any) => e.title)).toEqual(['ISM Services PMI', 'BOJ Gov Ueda Speaks']);
    expect(first.data.quality.feeds).toEqual({ thisweek: 'ok', nextweek: 'ok' });
    expect(calls).toEqual([THIS, NEXT]);
    t += 30_000;
    await load();
    expect(calls).toHaveLength(2);
  });

  it('tolerates a missing next-week feed', async () => {
    const { fn } = mockFetch((url) => (url === THIS ? okAll(url) : { status: 404, body: 'nope' }));
    const load = createEconomicCalendar({ fetchFn: fn, now: () => NOW, urls });
    const r: any = await load();
    expect(r.available).toBe(true);
    expect(r.data.quality.feeds.nextweek).toBe('failed: HTTP 404');
  });

  it('serves stale data flagged when a refresh fails, and backs off', async () => {
    let failing = false;
    const { fn, calls } = mockFetch((url) => (failing ? { status: 500, body: 'err' } : okAll(url)));
    let t = NOW;
    const load = createEconomicCalendar({ fetchFn: fn, now: () => t, urls, cacheTtlMs: 60_000, retryAfterFailureMs: 60_000 });
    await load();
    failing = true;
    t += 61_000;
    const stale: any = await load();
    expect(stale.available).toBe(true);
    expect(stale.data.stale).toBe(true);
    expect(calls).toHaveLength(4);
    t += 10_000;
    await load();
    expect(calls).toHaveLength(4);
    t += 61_000;
    await load();
    expect(calls).toHaveLength(6);
  });

  it('is unavailable when the feed never loaded', async () => {
    const { fn } = mockFetch(() => ({ status: 500, body: 'err' }));
    const r: any = await createEconomicCalendar({ fetchFn: fn, now: () => NOW, urls })();
    expect(r.available).toBe(false);
    expect(r.reason).toBe('calendar feed unavailable');
  });

  it('is unavailable when cached data is too old', async () => {
    let failing = false;
    const { fn } = mockFetch((url) => (failing ? { status: 500, body: 'err' } : okAll(url)));
    let t = NOW;
    const load = createEconomicCalendar({ fetchFn: fn, now: () => t, urls, cacheTtlMs: 60_000, staleMaxMs: 3_600_000 });
    await load();
    failing = true;
    t += 2 * 3_600_000;
    const r: any = await load();
    expect(r.available).toBe(false);
  });

  it('treats a non-JSON response as a failure', async () => {
    const { fn } = mockFetch(() => ({ status: 200, body: '<html>rate limited</html>' }));
    const r: any = await createEconomicCalendar({ fetchFn: fn, now: () => NOW, urls })();
    expect(r.available).toBe(false);
  });
});

describe('createMacroProvider', () => {
  it('isolates a failing loader and omits keys without a loader', async () => {
    const provider = createMacroProvider({
      dxy: async () => {
        throw new Error('boom');
      },
      us10y: async () => ({ available: true, source: 'x', fetchedAt: 't', data: {} }),
    });
    const m: any = await provider.getMacro();
    expect(m.dxy).toEqual({ available: false, reason: 'provider error' });
    expect(m.us10y.available).toBe(true);
    expect('cotGold' in m).toBe(false);
  });
});
