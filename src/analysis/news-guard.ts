import type { MacroItem } from '../providers/macro/index.js';

export const NEWS_NO_ENTRY_MINUTES = 30;
export const NEWS_WARNING_HOURS = 4;

// Critical news named by the analisa-xauusd skill: NFP, CPI/PPI, FOMC, Michigan Sentiment.
const CRITICAL_TITLE =
  /non-farm|\bcpi\b|\bppi\b|^fomc (meeting minutes|statement|press conference)|^federal funds rate|consumer sentiment/i;

type CalEvent = {
  title: string;
  currency: string;
  impact: string;
  minutesUntil: number;
  timeWib: string;
  timeVerified: boolean;
};

function isEvent(x: unknown): x is CalEvent {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.title === 'string' &&
    typeof o.currency === 'string' &&
    typeof o.impact === 'string' &&
    typeof o.minutesUntil === 'number' &&
    Number.isFinite(o.minutesUntil) &&
    typeof o.timeWib === 'string' &&
    typeof o.timeVerified === 'boolean'
  );
}

const wibClock = (epochMs: number) => new Date(epochMs + 7 * 3_600_000).toISOString().slice(11, 16);

function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m} min`;
}

/** Pre-news warnings for confluence_check, derived only from the economicCalendar macro item. */
export function newsGuardWarnings(item: MacroItem): string[] {
  const rule = 'the skill rule "no entry 30 minutes before major news"';
  if (!item.available) {
    return [`Economic calendar unavailable (${item.reason}): ${rule} cannot be verified.`];
  }
  const data = item.data as {
    events?: unknown;
    nextHighImpactUsd?: unknown;
    stale?: unknown;
    coverage?: { windowBeyondCoverage?: unknown };
  } | null;
  if (!data || typeof data !== 'object' || !Array.isArray(data.events)) {
    return [`Economic calendar returned an unexpected shape: ${rule} cannot be verified.`];
  }

  const seen = new Set<string>();
  const candidates: CalEvent[] = [];
  for (const x of [...data.events, data.nextHighImpactUsd]) {
    if (!isEvent(x)) continue;
    const key = `${x.title}|${x.timeWib}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(x);
  }
  const major = candidates
    .filter((e) => e.currency === 'USD' && (e.impact === 'High' || CRITICAL_TITLE.test(e.title)))
    .filter((e) => e.minutesUntil >= 0 && e.minutesUntil <= NEWS_WARNING_HOURS * 60)
    .sort((a, b) => a.minutesUntil - b.minutesUntil);

  const warnings: string[] = [];
  for (const e of major) {
    const epoch = Date.parse(e.timeWib);
    const at = Number.isFinite(epoch) ? wibClock(epoch) : e.timeWib;
    const noEntryFrom = Number.isFinite(epoch) ? wibClock(epoch - NEWS_NO_ENTRY_MINUTES * 60_000) : 'unknown';
    const unverified = e.timeVerified ? '' : ' Release time is unverified: cross-check it via web search.';
    if (e.minutesUntil <= NEWS_NO_ENTRY_MINUTES) {
      warnings.push(
        `NO ENTRY: ${e.title} at ${at} WIB in ${e.minutesUntil} min, inside the ${NEWS_NO_ENTRY_MINUTES}-minute pre-news window.${unverified}`,
      );
    } else {
      warnings.push(
        `Pre-news: ${e.title} at ${at} WIB (in ${duration(e.minutesUntil)}); no new entry from ${noEntryFrom} WIB.${unverified}`,
      );
    }
  }
  if (major.length === 0) {
    warnings.push(
      `Economic calendar checked: no major USD news in the next ${NEWS_WARNING_HOURS} hours (actual values are not available from the feed; geopolitical news is not covered).`,
    );
  }
  if (data.stale === true) {
    warnings.push('Economic calendar data is stale (refresh failing): the news check may be outdated.');
  }
  if (data.coverage?.windowBeyondCoverage === true) {
    warnings.push('Economic calendar coverage ends inside the lookahead window: upcoming news may be missing.');
  }
  return warnings;
}
