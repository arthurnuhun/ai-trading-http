import type { Logger } from '../../logger.js';
import type { MacroItem } from './index.js';

export const CALENDAR_THISWEEK_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
export const CALENDAR_NEXTWEEK_URL = 'https://nfs.faireconomy.media/ff_calendar_nextweek.json';

const IMPACTS = ['Low', 'Medium', 'High', 'Holiday'] as const;
export type CalendarImpact = (typeof IMPACTS)[number];

export type RawCalendarEvent = {
  title: string;
  country: string;
  impact: CalendarImpact;
  forecast: string;
  previous: string;
  feedDate: string;
  epochMs: number;
  feedOffsetMinutes: number;
};

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-])(\d{2}):(\d{2})$/;

function parseItem(x: unknown): RawCalendarEvent | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const { title, country, date, impact } = o;
  if (typeof title !== 'string' || !title.trim()) return null;
  if (typeof country !== 'string' || !country.trim()) return null;
  if (typeof date !== 'string') return null;
  if (typeof impact !== 'string' || !(IMPACTS as readonly string[]).includes(impact)) return null;
  const m = ISO_WITH_OFFSET.exec(date);
  if (!m) return null;
  const epochMs = Date.parse(date);
  if (!Number.isFinite(epochMs)) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const feedOffsetMinutes = sign * (Number(m[2]) * 60 + Number(m[3]));
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  return {
    title: title.trim(),
    country: country.trim(),
    impact: impact as CalendarImpact,
    forecast: str(o.forecast),
    previous: str(o.previous),
    feedDate: date,
    epochMs,
    feedOffsetMinutes,
  };
}

export function parseCalendarFeed(raw: unknown): {
  valid: boolean;
  events: RawCalendarEvent[];
  received: number;
  malformed: number;
} {
  if (!Array.isArray(raw)) return { valid: false, events: [], received: 0, malformed: 0 };
  const events: RawCalendarEvent[] = [];
  let malformed = 0;
  for (const item of raw) {
    const ev = parseItem(item);
    if (ev) events.push(ev);
    else malformed += 1;
  }
  return { valid: true, events, received: raw.length, malformed };
}

const etFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  timeZoneName: 'longOffset',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
} as Intl.DateTimeFormatOptions);

/** US Eastern wall-clock date/time and UTC offset (minutes) at an instant, computed independently of the feed. */
export function easternParts(epochMs: number): { date: string; time: string; offsetMinutes: number } {
  const parts = etFormatter.formatToParts(new Date(epochMs));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const m = /^GMT([+-])(\d{2}):(\d{2})$/.exec(get('timeZoneName'));
  const offsetMinutes = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : Number.NaN;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}`, offsetMinutes };
}

/** Conventional US release times (US Eastern). A match is evidence; a mismatch is only flagged, never "fixed". */
const US_RELEASE_TIMES: Array<[RegExp, string]> = [
  [/^Non-Farm Employment Change$/, '08:30'],
  [/^Unemployment Rate$/, '08:30'],
  [/^Average Hourly Earnings m\/m$/, '08:30'],
  [/^(Core )?CPI (m\/m|y\/y)$/, '08:30'],
  [/^(Core )?PPI m\/m$/, '08:30'],
  [/^(Core )?Retail Sales m\/m$/, '08:30'],
  [/^Unemployment Claims$/, '08:30'],
  [/^(Advance|Prelim|Final) GDP q\/q$/, '08:30'],
  [/^Core PCE Price Index m\/m$/, '08:30'],
  [/^ISM (Manufacturing|Services) PMI$/, '10:00'],
  [/^(Prelim|Final) UoM Consumer Sentiment$/, '10:00'],
  [/^FOMC Meeting Minutes$/, '14:00'],
  [/^(Federal Funds Rate|FOMC Statement)$/, '14:00'],
];

export type TimeCheck = 'pattern_match' | 'offset_only' | 'pattern_mismatch' | 'offset_mismatch';

export function checkEventTime(ev: RawCalendarEvent): { timeCheck: TimeCheck; expectedEt?: string } {
  const et = easternParts(ev.epochMs);
  if (Number.isFinite(et.offsetMinutes) && et.offsetMinutes !== ev.feedOffsetMinutes) {
    return { timeCheck: 'offset_mismatch' };
  }
  if (ev.country === 'USD') {
    for (const [re, expected] of US_RELEASE_TIMES) {
      if (re.test(ev.title)) {
        return et.time === expected
          ? { timeCheck: 'pattern_match', expectedEt: expected }
          : { timeCheck: 'pattern_mismatch', expectedEt: expected };
      }
    }
  }
  return { timeCheck: 'offset_only' };
}

export type FomcScheduleCheck = 'on_schedule' | 'not_in_schedule' | 'no_schedule_configured';

function fomcScheduleCheck(ev: RawCalendarEvent, dates: string[]): FomcScheduleCheck | undefined {
  if (ev.country !== 'USD' || !/^(Federal Funds Rate|FOMC Statement)$/.test(ev.title)) return undefined;
  if (dates.length === 0) return 'no_schedule_configured';
  return dates.includes(easternParts(ev.epochMs).date) ? 'on_schedule' : 'not_in_schedule';
}

function toWib(epochMs: number): string {
  return new Date(epochMs + 7 * 3_600_000).toISOString().replace('Z', '+07:00');
}

export type CalendarEventOut = {
  title: string;
  currency: string;
  impact: CalendarImpact;
  forecast: string | null;
  previous: string | null;
  timeUtc: string;
  timeWib: string;
  timeFeed: string;
  minutesUntil: number;
  timeCheck: TimeCheck;
  timeVerified: boolean;
  expectedEt?: string;
  fomcSchedule?: FomcScheduleCheck;
};

function toOut(ev: RawCalendarEvent, nowMs: number, fomcDates: string[]): CalendarEventOut {
  const check = checkEventTime(ev);
  const schedule = fomcScheduleCheck(ev, fomcDates);
  return {
    title: ev.title,
    currency: ev.country,
    impact: ev.impact,
    forecast: ev.forecast || null,
    previous: ev.previous || null,
    timeUtc: new Date(ev.epochMs).toISOString(),
    timeWib: toWib(ev.epochMs),
    timeFeed: ev.feedDate,
    minutesUntil: Math.round((ev.epochMs - nowMs) / 60_000),
    timeCheck: check.timeCheck,
    timeVerified: check.timeCheck === 'pattern_match' && schedule !== 'not_in_schedule',
    ...(check.expectedEt ? { expectedEt: check.expectedEt } : {}),
    ...(schedule ? { fomcSchedule: schedule } : {}),
  };
}

/** USD Medium/High and USD holidays, plus High-impact events of any other currency. */
function relevant(ev: RawCalendarEvent): boolean {
  if (ev.impact === 'Low') return false;
  if (ev.impact === 'Holiday') return ev.country === 'USD';
  if (ev.country === 'USD') return true;
  return ev.impact === 'High';
}

const LIMITATIONS = [
  'The feed provides forecast and previous values only; actual values are not available.',
  'Feed times carry US Eastern offsets; they are cross-checked against the real US Eastern offset and known US release times, never silently trusted.',
  'timeVerified is true only when a known release-time pattern matched; verify other high-impact times via web search before relying on them.',
];

export function buildCalendarData(
  events: RawCalendarEvent[],
  opts: { nowMs: number; windowHours: number; maxEvents: number; fomcDecisionDates: string[] },
) {
  const { nowMs, windowHours, maxEvents, fomcDecisionDates } = opts;
  const fromMs = nowMs - 3_600_000;
  const toMs = nowMs + windowHours * 3_600_000;
  const selected = events
    .filter((e) => relevant(e) && e.epochMs >= fromMs && e.epochMs <= toMs)
    .sort((a, b) => a.epochMs - b.epochMs);
  const out = selected.slice(0, maxEvents).map((e) => toOut(e, nowMs, fomcDecisionDates));
  const nextHigh = events
    .filter((e) => e.country === 'USD' && e.impact === 'High' && e.epochMs >= nowMs)
    .sort((a, b) => a.epochMs - b.epochMs)[0];
  const epochs = events.map((e) => e.epochMs);
  const covFrom = epochs.length ? Math.min(...epochs) : null;
  const covTo = epochs.length ? Math.max(...epochs) : null;
  return {
    window: { hours: windowHours, fromUtc: new Date(fromMs).toISOString(), toUtc: new Date(toMs).toISOString() },
    filter: 'USD Medium/High and USD holidays; High-impact events of other currencies',
    events: out,
    totalInWindow: selected.length,
    truncated: selected.length > maxEvents,
    nextHighImpactUsd: nextHigh ? toOut(nextHigh, nowMs, fomcDecisionDates) : null,
    unverifiedHighImpact: out.filter((e) => e.impact === 'High' && !e.timeVerified).map((e) => e.title),
    coverage: {
      fromUtc: covFrom === null ? null : new Date(covFrom).toISOString(),
      toUtc: covTo === null ? null : new Date(covTo).toISOString(),
      windowBeyondCoverage: covTo === null ? true : toMs > covTo,
    },
    feedOffsetMismatches: events.filter((e) => checkEventTime(e).timeCheck === 'offset_mismatch').length,
    limitations: LIMITATIONS,
  };
}

export type CalendarOptions = {
  logger?: Pick<Logger, 'warn'>;
  fetchFn?: typeof fetch;
  now?: () => number;
  urls?: { thisWeek: string; nextWeek: string };
  cacheTtlMs?: number;
  staleMaxMs?: number;
  retryAfterFailureMs?: number;
  timeoutMs?: number;
  windowHours?: number;
  maxEvents?: number;
  fomcDecisionDates?: string[];
};

type FetchOne =
  | { ok: true; events: RawCalendarEvent[]; received: number; malformed: number }
  | { ok: false; reason: string };

type Cache = {
  events: RawCalendarEvent[];
  received: number;
  malformed: number;
  fetchedAtMs: number;
  feeds: { thisweek: string; nextweek: string };
};

/** Loader for the macro key `economicCalendar`: cached, backs off after failures, serves flagged stale data. */
export function createEconomicCalendar(opts: CalendarOptions = {}): () => Promise<MacroItem> {
  const fetchFn: typeof fetch = opts.fetchFn ?? ((input, init) => fetch(input, init));
  const now = opts.now ?? (() => Date.now());
  const urls = opts.urls ?? { thisWeek: CALENDAR_THISWEEK_URL, nextWeek: CALENDAR_NEXTWEEK_URL };
  const cacheTtlMs = opts.cacheTtlMs ?? 900_000;
  const staleMaxMs = opts.staleMaxMs ?? 12 * 3_600_000;
  const retryAfterFailureMs = opts.retryAfterFailureMs ?? 60_000;
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const windowHours = opts.windowHours ?? 24;
  const maxEvents = opts.maxEvents ?? 8;
  const fomcDates = opts.fomcDecisionDates ?? [];

  let cache: Cache | null = null;
  let lastFailureMs = 0;
  let inflight: Promise<void> | null = null;

  async function fetchOne(url: string): Promise<FetchOne> {
    let res: Response;
    try {
      res = await fetchFn(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'ai-trading-http' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      return { ok: false, reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network error' };
    }
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return { ok: false, reason: 'invalid payload' };
    }
    const parsed = parseCalendarFeed(json);
    if (!parsed.valid || (parsed.events.length === 0 && parsed.received > 0)) {
      return { ok: false, reason: 'invalid payload' };
    }
    return { ok: true, events: parsed.events, received: parsed.received, malformed: parsed.malformed };
  }

  async function refresh(): Promise<void> {
    const [a, b] = await Promise.all([fetchOne(urls.thisWeek), fetchOne(urls.nextWeek)]);
    if (!a.ok) {
      lastFailureMs = now();
      opts.logger?.warn({ reason: a.reason }, 'economic calendar refresh failed');
      return;
    }
    const seen = new Set<string>();
    const events: RawCalendarEvent[] = [];
    for (const ev of [...a.events, ...(b.ok ? b.events : [])]) {
      const key = `${ev.epochMs}|${ev.country}|${ev.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push(ev);
    }
    cache = {
      events,
      received: a.received + (b.ok ? b.received : 0),
      malformed: a.malformed + (b.ok ? b.malformed : 0),
      fetchedAtMs: now(),
      feeds: { thisweek: 'ok', nextweek: b.ok ? 'ok' : `failed: ${b.reason}` },
    };
    lastFailureMs = 0;
  }

  return async function loadCalendar(): Promise<MacroItem> {
    const t = now();
    const fresh = cache !== null && t - cache.fetchedAtMs < cacheTtlMs;
    const backingOff = lastFailureMs > 0 && t - lastFailureMs < retryAfterFailureMs;
    if (!fresh && !backingOff) {
      inflight ??= refresh().finally(() => {
        inflight = null;
      });
      await inflight;
    }
    const snap: Cache | null = cache;
    if (!snap) return { available: false, reason: 'calendar feed unavailable' };
    const ageMs = now() - snap.fetchedAtMs;
    if (ageMs > staleMaxMs) return { available: false, reason: 'calendar data too old and refresh failing' };
    const data = buildCalendarData(snap.events, {
      nowMs: now(),
      windowHours,
      maxEvents,
      fomcDecisionDates: fomcDates,
    });
    return {
      available: true,
      source: 'forexfactory_feed',
      fetchedAt: new Date(snap.fetchedAtMs).toISOString(),
      data: {
        ...data,
        stale: lastFailureMs > snap.fetchedAtMs,
        ageSeconds: Math.round(ageMs / 1000),
        quality: {
          received: snap.received,
          accepted: snap.events.length,
          malformed: snap.malformed,
          feeds: snap.feeds,
        },
      },
    };
  };
}
