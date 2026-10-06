import type { Logger } from '../../logger.js';
import { easternParts } from './calendar.js';
import type { MacroItem } from './index.js';

export const GOLD_CONTRACT_CODE = '088691';
export const HISTORY_LIMIT = 157;
const BASE_URL = 'https://publicreporting.cftc.gov/resource';
const DAY_MS = 86_400_000;
const MIN_WEEKS_FOR_PERCENTILE = 52;
const EXTREME_PERCENTILE = 90;
const STALE_AFTER_DAYS = 10;
const TOO_OLD_DAYS = 21;

const round = (x: number, digits: number) => Number(x.toFixed(digits));

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string' || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function dateOf(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})(?:T|$)/.exec(v);
  return m ? (m[1] ?? null) : null;
}

const dateMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const addDays = (d: string, n: number) => new Date(dateMs(d) + n * DAY_MS).toISOString().slice(0, 10);
const toWib = (epochMs: number) => new Date(epochMs + 7 * 3_600_000).toISOString().replace('Z', '+07:00');

type GroupDef = {
  key: string;
  long: string;
  short: string;
  spread?: string;
  pctLong?: string;
  pctShort?: string;
  tradersLong?: string;
  tradersShort?: string;
};

type DatasetDef = {
  id: string;
  name: 'disaggregated' | 'legacy';
  source: string;
  groups: GroupDef[];
  primaryKey: string;
  changeLong: string;
  changeShort: string;
  notes: string[];
};

const BASE_FIELDS = [
  'report_date_as_yyyy_mm_dd',
  'yyyy_report_week_ww',
  'market_and_exchange_names',
  'cftc_contract_market_code',
  'contract_units',
  'futonly_or_combined',
  'open_interest_all',
  'tot_rept_positions_long_all',
  'tot_rept_positions_short',
  'change_in_open_interest_all',
  'traders_tot_all',
];

const DISAGGREGATED: DatasetDef = {
  id: '72hh-3qpy',
  name: 'disaggregated',
  source: 'cftc_cot_disaggregated',
  primaryKey: 'managedMoney',
  changeLong: 'change_in_m_money_long_all',
  changeShort: 'change_in_m_money_short_all',
  groups: [
    { key: 'producerMerchant', long: 'prod_merc_positions_long', short: 'prod_merc_positions_short' },
    {
      key: 'swapDealers',
      long: 'swap_positions_long_all',
      short: 'swap__positions_short_all',
      spread: 'swap__positions_spread_all',
    },
    {
      key: 'managedMoney',
      long: 'm_money_positions_long_all',
      short: 'm_money_positions_short_all',
      spread: 'm_money_positions_spread',
      pctLong: 'pct_of_oi_m_money_long_all',
      pctShort: 'pct_of_oi_m_money_short_all',
      tradersLong: 'traders_m_money_long_all',
      tradersShort: 'traders_m_money_short_all',
    },
    {
      key: 'otherReportables',
      long: 'other_rept_positions_long',
      short: 'other_rept_positions_short',
      spread: 'other_rept_positions_spread',
    },
    { key: 'nonReportable', long: 'nonrept_positions_long_all', short: 'nonrept_positions_short_all' },
  ],
  notes: [
    'Managed Money is the CFTC classification for registered CTAs, CPOs and unregistered funds; it is not the same population as the Legacy non-commercial group.',
  ],
};

const LEGACY: DatasetDef = {
  id: '6dca-aqww',
  name: 'legacy',
  source: 'cftc_cot_legacy',
  primaryKey: 'nonCommercial',
  changeLong: 'change_in_noncomm_long_all',
  changeShort: 'change_in_noncomm_short_all',
  groups: [
    {
      key: 'nonCommercial',
      long: 'noncomm_positions_long_all',
      short: 'noncomm_positions_short_all',
      spread: 'noncomm_postions_spread_all',
      pctLong: 'pct_of_oi_noncomm_long_all',
      pctShort: 'pct_of_oi_noncomm_short_all',
      tradersLong: 'traders_noncomm_long_all',
      tradersShort: 'traders_noncomm_short_all',
    },
    {
      key: 'commercial',
      long: 'comm_positions_long_all',
      short: 'comm_positions_short_all',
      pctLong: 'pct_of_oi_comm_long_all',
      pctShort: 'pct_of_oi_comm_short_all',
      tradersLong: 'traders_comm_long_all',
      tradersShort: 'traders_comm_short_all',
    },
    { key: 'nonReportable', long: 'nonrept_positions_long_all', short: 'nonrept_positions_short_all' },
  ],
  notes: [
    'Legacy non-commercial is the classic large-speculator group; commercial positions are mostly hedgers.',
  ],
};

function selectFields(def: DatasetDef): string[] {
  const out = new Set<string>(BASE_FIELDS);
  out.add(def.changeLong);
  out.add(def.changeShort);
  for (const g of def.groups) {
    for (const f of [g.long, g.short, g.spread, g.pctLong, g.pctShort, g.tradersLong, g.tradersShort]) {
      if (f) out.add(f);
    }
  }
  return [...out];
}

function urlFor(def: DatasetDef): string {
  const fields = encodeURIComponent(selectFields(def).join(','));
  const order = encodeURIComponent('report_date_as_yyyy_mm_dd DESC');
  return `${BASE_URL}/${def.id}.json?cftc_contract_market_code=${GOLD_CONTRACT_CODE}&$select=${fields}&$order=${order}&$limit=${HISTORY_LIMIT}`;
}

type GroupRow = {
  long: number;
  short: number;
  spread: number | null;
  pctLong: number | null;
  pctShort: number | null;
  tradersLong: number | null;
  tradersShort: number | null;
};

type Row = {
  date: string;
  yearWeek: string | null;
  market: string;
  contractUnits: string | null;
  openInterest: number;
  changeOpenInterest: number | null;
  tradersTotal: number | null;
  changeLong: number | null;
  changeShort: number | null;
  groups: Record<string, GroupRow>;
};

function parseRow(def: DatasetDef, x: unknown): Row | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const date = dateOf(o.report_date_as_yyyy_mm_dd);
  const market = o.market_and_exchange_names;
  if (!date || typeof market !== 'string' || !market.startsWith('GOLD')) return null;
  if (String(o.cftc_contract_market_code ?? '').trim() !== GOLD_CONTRACT_CODE) return null;
  if (o.futonly_or_combined !== 'FutOnly') return null;
  const openInterest = num(o.open_interest_all);
  if (openInterest === null) return null;
  const groups: Record<string, GroupRow> = {};
  for (const g of def.groups) {
    const long = num(o[g.long]);
    const short = num(o[g.short]);
    if (long === null || short === null) return null;
    groups[g.key] = {
      long,
      short,
      spread: g.spread ? num(o[g.spread]) : null,
      pctLong: g.pctLong ? num(o[g.pctLong]) : null,
      pctShort: g.pctShort ? num(o[g.pctShort]) : null,
      tradersLong: g.tradersLong ? num(o[g.tradersLong]) : null,
      tradersShort: g.tradersShort ? num(o[g.tradersShort]) : null,
    };
  }
  return {
    date,
    yearWeek: typeof o.yyyy_report_week_ww === 'string' ? o.yyyy_report_week_ww : null,
    market,
    contractUnits: typeof o.contract_units === 'string' ? o.contract_units : null,
    openInterest,
    changeOpenInterest: num(o.change_in_open_interest_all),
    tradersTotal: num(o.traders_tot_all),
    changeLong: num(o[def.changeLong]),
    changeShort: num(o[def.changeShort]),
    groups,
  };
}

function parseRows(def: DatasetDef, raw: unknown): { valid: boolean; rows: Row[]; received: number; malformed: number } {
  if (!Array.isArray(raw)) return { valid: false, rows: [], received: 0, malformed: 0 };
  const byDate = new Map<string, Row>();
  let malformed = 0;
  for (const item of raw) {
    const row = parseRow(def, item);
    if (!row) malformed += 1;
    else if (!byDate.has(row.date)) byDate.set(row.date, row);
  }
  const rows = [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { valid: true, rows, received: raw.length, malformed };
}

type Snap = { rows: Row[]; received: number; malformed: number; fetchedAtMs: number };
type DatasetState = { snap: Snap | null; refreshFailing: boolean; reason: string | null };

type Deps = {
  logger?: Pick<Logger, 'warn'>;
  fetchFn: typeof fetch;
  now: () => number;
  cacheTtlMs: number;
  retryAfterFailureMs: number;
  timeoutMs: number;
};

function createDataset(def: DatasetDef, deps: Deps) {
  let snap: Snap | null = null;
  let lastFailureMs = 0;
  let lastReason: string | null = null;
  let inflight: Promise<void> | null = null;
  const url = urlFor(def);

  const fail = (reason: string) => {
    lastFailureMs = deps.now();
    lastReason = reason;
    deps.logger?.warn({ dataset: def.name, reason }, 'cot refresh failed');
  };

  async function refresh(): Promise<void> {
    let res: Response;
    try {
      res = await deps.fetchFn(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'ai-trading-http' },
        signal: AbortSignal.timeout(deps.timeoutMs),
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      fail(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network error');
      return;
    }
    if (!res.ok) {
      fail(`HTTP ${res.status}`);
      return;
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      fail('invalid payload');
      return;
    }
    const parsed = parseRows(def, json);
    if (!parsed.valid || parsed.rows.length === 0) {
      fail(parsed.valid && parsed.received === 0 ? 'no data' : 'invalid payload');
      return;
    }
    snap = { rows: parsed.rows, received: parsed.received, malformed: parsed.malformed, fetchedAtMs: deps.now() };
    lastFailureMs = 0;
    lastReason = null;
  }

  async function get(): Promise<DatasetState> {
    const t = deps.now();
    const fresh = snap !== null && t - snap.fetchedAtMs < deps.cacheTtlMs;
    const backingOff = lastFailureMs > 0 && t - lastFailureMs < deps.retryAfterFailureMs;
    if (!fresh && !backingOff) {
      inflight ??= refresh().finally(() => {
        inflight = null;
      });
      await inflight;
    }
    const refreshFailing = lastFailureMs > 0 && (snap === null || lastFailureMs >= snap.fetchedAtMs);
    return { snap, refreshFailing, reason: lastReason };
  }

  return { def, get };
}

const netOf = (r: Row, key: string) => {
  const g = r.groups[key];
  return g ? g.long - g.short : 0;
};

function releaseTime(dateStr: string): { utc: string; wib: string } {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  const offset = easternParts(Date.UTC(y, m - 1, d, 19, 30)).offsetMinutes;
  const utcMs = Date.UTC(y, m - 1, d, 15, 30) - (Number.isFinite(offset) ? offset : -300) * 60_000;
  return { utc: new Date(utcMs).toISOString(), wib: toWib(utcMs) };
}

const COMMON_LIMITATIONS = [
  'Positions are as of Tuesday and published on Friday around 15:30 ET (holiday weeks shift this): the data is days old by design and does not reflect moves since the report date.',
  'Futures-only report for COMEX Gold (contract 088691); options are not included.',
  'percentile is the share of weeks in the fetched history (up to about three years) whose net position is at or below the current one; extremeFlag marks the top or bottom 10% and is descriptive, not a trading signal.',
  'stale means the latest report is older than 10 days (a holiday can delay a release); the item is unavailable beyond 21 days.',
];

function buildItem(def: DatasetDef, own: DatasetState, other: DatasetState, otherDef: DatasetDef, nowMs: number): MacroItem {
  const rows = own.snap?.rows ?? [];
  const latest = rows[0];
  if (!own.snap || !latest) return { available: false, reason: own.reason ?? 'cot data unavailable' };

  const ageDays = round((nowMs - dateMs(latest.date)) / DAY_MS, 1);
  if (ageDays > TOO_OLD_DAYS) return { available: false, reason: 'report_too_old' };

  const prev = rows[1];
  const prevIsLastWeek = prev !== undefined && dateMs(latest.date) - dateMs(prev.date) === 7 * DAY_MS;
  const nets = rows.map((r) => netOf(r, def.primaryKey));
  const current = netOf(latest, def.primaryKey);
  const weeklyChange = prevIsLastWeek && prev ? current - netOf(prev, def.primaryKey) : null;
  const reportedWeeklyChange =
    latest.changeLong !== null && latest.changeShort !== null ? latest.changeLong - latest.changeShort : null;
  const weeklyChangeConsistent =
    weeklyChange !== null && reportedWeeklyChange !== null ? weeklyChange === reportedWeeklyChange : null;
  const percentile =
    nets.length >= MIN_WEEKS_FOR_PERCENTILE
      ? round((100 * nets.filter((v) => v <= current).length) / nets.length, 1)
      : null;
  const extremeFlag =
    percentile === null
      ? null
      : percentile >= EXTREME_PERCENTILE
        ? 'near_top_of_range'
        : percentile <= 100 - EXTREME_PERCENTILE
          ? 'near_bottom_of_range'
          : null;

  const groups: Record<string, unknown> = {};
  for (const g of def.groups) {
    const row = latest.groups[g.key];
    if (!row) continue;
    groups[g.key] = {
      long: row.long,
      short: row.short,
      spread: row.spread,
      net: row.long - row.short,
      pctOfOpenInterestLong: row.pctLong,
      pctOfOpenInterestShort: row.pctShort,
      tradersLong: row.tradersLong,
      tradersShort: row.tradersShort,
    };
  }

  const otherLatest = other.snap?.rows[0];
  const crossCheck = otherLatest
    ? {
        against: otherDef.name,
        sameReportDate: otherLatest.date === latest.date,
        openInterestMatches: otherLatest.openInterest === latest.openInterest,
      }
    : null;

  const nextReportDate = addDays(latest.date, 7);
  const release = releaseTime(addDays(latest.date, 10));

  return {
    available: true,
    source: def.source,
    fetchedAt: new Date(own.snap.fetchedAtMs).toISOString(),
    data: {
      dataset: def.name,
      report: {
        date: latest.date,
        yearWeek: latest.yearWeek,
        market: latest.market,
        contractCode: GOLD_CONTRACT_CODE,
        contractUnits: latest.contractUnits,
        futuresOnly: true,
        ageDays,
        stale: ageDays > STALE_AFTER_DAYS,
        nextReportDate,
        nextReleaseUtc: release.utc,
        nextReleaseWib: release.wib,
      },
      openInterest: { value: latest.openInterest, reportedWeeklyChange: latest.changeOpenInterest },
      groups,
      primaryGroup: def.primaryKey,
      primaryNet: {
        value: current,
        weeklyChange,
        reportedWeeklyChange,
        weeklyChangeConsistent,
        percentile,
        weeksInSample: nets.length,
        min: Math.min(...nets),
        max: Math.max(...nets),
        extremeFlag,
      },
      crossCheck,
      refreshFailing: own.refreshFailing,
      quality: { received: own.snap.received, accepted: rows.length, malformed: own.snap.malformed },
      limitations: [...COMMON_LIMITATIONS, ...def.notes],
    },
  };
}

export type CotOptions = {
  logger?: Pick<Logger, 'warn'>;
  fetchFn?: typeof fetch;
  now?: () => number;
  cacheTtlMs?: number;
  retryAfterFailureMs?: number;
  timeoutMs?: number;
};

/** Loaders for the macro keys `cotGold` (Disaggregated) and `cotGoldPrimary` (Legacy), COMEX Gold futures only. */
export function createCot(opts: CotOptions = {}): { cotGold: () => Promise<MacroItem>; cotGoldPrimary: () => Promise<MacroItem> } {
  const deps: Deps = {
    logger: opts.logger,
    fetchFn: opts.fetchFn ?? ((input, init) => fetch(input, init)),
    now: opts.now ?? (() => Date.now()),
    cacheTtlMs: opts.cacheTtlMs ?? 21_600_000,
    retryAfterFailureMs: opts.retryAfterFailureMs ?? 600_000,
    timeoutMs: opts.timeoutMs ?? 10_000,
  };
  const disaggregated = createDataset(DISAGGREGATED, deps);
  const legacy = createDataset(LEGACY, deps);
  return {
    cotGold: async () => {
      const [own, other] = await Promise.all([disaggregated.get(), legacy.get()]);
      return buildItem(DISAGGREGATED, own, other, LEGACY, deps.now());
    },
    cotGoldPrimary: async () => {
      const [own, other] = await Promise.all([legacy.get(), disaggregated.get()]);
      return buildItem(LEGACY, own, other, DISAGGREGATED, deps.now());
    },
  };
}
