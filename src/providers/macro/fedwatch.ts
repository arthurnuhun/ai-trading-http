import { AppError } from '../../errors.js';
import { easternParts } from './calendar.js';
import type { MacroItem } from './index.js';
import type { CandleSource } from './tv-snapshot.js';

export type YearMonth = { year: number; month: number };

const pad = (n: number) => String(n).padStart(2, '0');
const round = (x: number, digits: number) => Number(x.toFixed(digits));
export const monthKey = (m: YearMonth) => `${m.year}-${pad(m.month)}`;

export function parseYmd(date: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Last Monday-Friday of the month (exchange holidays are not modelled). */
export function lastBusinessDay(year: number, month: number): number {
  let day = daysInMonth(year, month);
  for (;;) {
    const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    if (dow !== 0 && dow !== 6) return day;
    day -= 1;
  }
}

export function addMonths(m: YearMonth, n: number): YearMonth {
  const idx = m.year * 12 + (m.month - 1) + n;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

export const monthsBetween = (a: YearMonth, b: YearMonth) => (b.year - a.year) * 12 + (b.month - a.month);

/** ZQ1! is the current month's contract until its last business day, then the next month's. */
export function frontContractMonth(todayEt: string): YearMonth {
  const p = parseYmd(todayEt);
  if (!p) throw new Error(`invalid date: ${todayEt}`);
  const here = { year: p.year, month: p.month };
  return p.day > lastBusinessDay(p.year, p.month) ? addMonths(here, 1) : here;
}

export type MeetingEstimate = {
  method: 'month_contract' | 'next_month_contract';
  postMeetingRatePercent: number;
  impliedChangeBp: number;
  probabilities: Array<{ changeBp: number; probability: number }>;
  amplification: number | null;
  spreadCheckBp: number | null;
};

export type EstimateResult = ({ ok: true } & MeetingEstimate) | { ok: false; reason: string };

/**
 * Expected rate after a meeting from fed funds futures (implied rate = 100 - price).
 * A contract's rate is the average over its month, so the meeting day splits it into
 * days before and after the change (the change takes effect the day after the decision).
 */
export function estimateMeeting(opts: {
  decisionDate: string;
  allDecisionDates: string[];
  preRatePercent: number;
  impliedRates: Partial<Record<string, number>>;
}): EstimateResult {
  const p = parseYmd(opts.decisionDate);
  if (!p) return { ok: false, reason: 'invalid_decision_date' };
  const total = daysInMonth(p.year, p.month);
  const postDays = total - p.day;
  const month = { year: p.year, month: p.month };
  const nextKey = monthKey(addMonths(month, 1));
  const fThis = opts.impliedRates[monthKey(month)];
  const fNext = opts.impliedRates[nextKey];
  const nextHasMeeting = opts.allDecisionDates.some((d) => d.startsWith(`${nextKey}-`));
  const useNext = postDays === 0 || (postDays / total < 0.5 && !nextHasMeeting);

  let postRate: number;
  let method: MeetingEstimate['method'];
  let amplification: number | null;
  let spreadCheckBp: number | null = null;
  if (useNext) {
    if (nextHasMeeting) return { ok: false, reason: 'next_month_has_meeting' };
    if (fNext === undefined) return { ok: false, reason: 'contract_unavailable' };
    postRate = fNext;
    method = 'next_month_contract';
    amplification = null;
    if (fThis !== undefined && p.day > 0) spreadCheckBp = ((fNext - fThis) * total) / p.day * 100;
  } else {
    if (fThis === undefined) return { ok: false, reason: 'contract_unavailable' };
    postRate = (fThis * total - opts.preRatePercent * p.day) / postDays;
    method = 'month_contract';
    amplification = total / postDays;
  }

  const bp = (postRate - opts.preRatePercent) * 100;
  const steps = bp / 25;
  const k = Math.floor(steps);
  const frac = steps - k;
  const probabilities = [
    { changeBp: k * 25, probability: round(1 - frac, 3) },
    { changeBp: (k + 1) * 25, probability: round(frac, 3) },
  ].filter((o) => o.probability > 0.0005);

  return {
    ok: true,
    method,
    postMeetingRatePercent: round(postRate, 4),
    impliedChangeBp: round(bp, 1),
    probabilities,
    amplification: amplification === null ? null : round(amplification, 3),
    spreadCheckBp: spreadCheckBp === null ? null : round(spreadCheckBp, 1),
  };
}

export type FedRatesConfig = { lower?: number; upper?: number; effr?: number; asOf?: string };

export type FedWatchOptions = {
  sourceFor: (symbol: string) => CandleSource;
  zqPrefix?: string;
  decisionDates: string[];
  rates: FedRatesConfig;
  now?: () => number;
};

type ContractOk = {
  symbol: string;
  index: number;
  contractMonth: string;
  available: true;
  price: number;
  impliedRatePercent: number;
  latestCandleTime: string;
  ageMinutes: number;
  marketOpen: boolean;
};
type ContractFail = { symbol: string; index: number; contractMonth: string; available: false; reason: string };
type ContractInfo = ContractOk | ContractFail;

type RatesCheck = { ok: true; effr: number } | { ok: false; reason: string };

function checkRates(
  r: FedRatesConfig,
  dates: string[],
  decided: (d: string) => boolean,
): RatesCheck {
  if (r.lower === undefined || r.upper === undefined || r.effr === undefined || r.asOf === undefined) {
    return { ok: false, reason: 'rates_not_configured' };
  }
  if (!parseYmd(r.asOf)) return { ok: false, reason: 'rates_asof_invalid' };
  if (r.lower > r.upper) return { ok: false, reason: 'target_range_invalid' };
  if (r.effr < r.lower - 0.05 || r.effr > r.upper + 0.05) return { ok: false, reason: 'effr_outside_target_range' };
  const asOf = r.asOf;
  const missed = dates.find((d) => d > asOf && decided(d));
  if (missed) return { ok: false, reason: `rates_outdated_after_${missed}` };
  return { ok: true, effr: r.effr };
}

const ET_DECISION_TIME = '14:00';
const DAY_MS = 86_400_000;
const ymdToUtc = (s: string) => {
  const q = parseYmd(s);
  return q ? Date.UTC(q.year, q.month - 1, q.day) : Number.NaN;
};

const LIMITATIONS = [
  'Simplified estimate on a 25 bp grid, not CME FedWatch: it assumes the current EFFR (from environment variables) is the rate before the meeting and that no other change happens in the contract months used.',
  'Target range, EFFR and their asOf date come from environment variables kept by the operator; the estimate is withheld when they look inconsistent or outdated.',
  'TradingView may deliver CBOT data with a delay for sessions without an exchange subscription; contract latestCandleTime and ageMinutes show the age of the latest M5 candle, which can also be old simply because trading is sparse.',
  'Contract months assume ZQ1! is the current month until its last business day; exchange holidays are not modelled.',
];

/** Loader for the macro key `fedwatch`, built on fed funds futures (ZQ) from TradingView. */
export function createFedWatchLoader(opts: FedWatchOptions): () => Promise<MacroItem> {
  const now = opts.now ?? (() => Date.now());
  const prefix = opts.zqPrefix ?? 'CBOT:ZQ';
  const dates = [...opts.decisionDates].sort();

  return async function loadFedWatch(): Promise<MacroItem> {
    const t = now();
    const et = easternParts(t);
    const front = frontContractMonth(et.date);
    const decided = (d: string) => d < et.date || (d === et.date && et.time >= ET_DECISION_TIME);
    const next = dates.find((d) => !decided(d)) ?? null;

    let firstIndex = 1;
    const p = next ? parseYmd(next) : null;
    if (p) {
      const i = monthsBetween(front, { year: p.year, month: p.month }) + 1;
      if (i >= 1 && i <= 23) firstIndex = i;
    }

    const load = async (index: number): Promise<ContractInfo> => {
      const symbol = `${prefix}${index}!`;
      const contractMonth = monthKey(addMonths(front, index - 1));
      try {
        const res = await opts.sourceFor(symbol).getCandles('M5', 12);
        const latest = res.latestCandle;
        if (!latest || !Number.isFinite(latest.close) || latest.close <= 80 || latest.close > 100) {
          return { symbol, index, contractMonth, available: false, reason: 'no valid price' };
        }
        return {
          symbol,
          index,
          contractMonth,
          available: true,
          price: latest.close,
          impliedRatePercent: round(100 - latest.close, 4),
          latestCandleTime: latest.isoTime,
          ageMinutes: Math.round((t - latest.timestamp) / 60_000),
          marketOpen: res.marketOpen,
        };
      } catch (err) {
        return {
          symbol,
          index,
          contractMonth,
          available: false,
          reason: err instanceof AppError ? err.code : 'provider error',
        };
      }
    };

    const contracts = await Promise.all([load(firstIndex), load(firstIndex + 1)]);
    const impliedRates: Record<string, number> = {};
    for (const c of contracts) if (c.available) impliedRates[c.contractMonth] = c.impliedRatePercent;
    if (Object.keys(impliedRates).length === 0) {
      const failed = contracts.find((c): c is ContractFail => !c.available);
      return { available: false, reason: failed ? failed.reason : 'provider error' };
    }

    const warnings: string[] = [];
    let estimate: MeetingEstimate | null = null;
    let estimateUnavailableReason: string | null = null;
    if (dates.length === 0) estimateUnavailableReason = 'fomc_dates_not_configured';
    else if (!next) estimateUnavailableReason = 'no_upcoming_meeting_in_configured_dates';
    else {
      const chk = checkRates(opts.rates, dates, decided);
      if (!chk.ok) estimateUnavailableReason = chk.reason;
      else {
        const est = estimateMeeting({
          decisionDate: next,
          allDecisionDates: dates,
          preRatePercent: chk.effr,
          impliedRates,
        });
        if (est.ok) {
          const { ok: _ok, ...rest } = est;
          estimate = rest;
          if (rest.spreadCheckBp !== null && Math.abs(rest.spreadCheckBp - rest.impliedChangeBp) > 5) {
            warnings.push(
              'EFFR-based and futures-spread estimates differ by more than 5 bp: the configured EFFR may be outdated or wrong.',
            );
          }
        } else estimateUnavailableReason = est.reason;
      }
    }

    const r = opts.rates;
    return {
      available: true,
      source: 'tradingview_zq_futures',
      fetchedAt: new Date(t).toISOString(),
      data: {
        method: 'simplified_zq_implied_rate',
        nextMeeting: next
          ? { decisionDate: next, daysUntil: Math.round((ymdToUtc(next) - ymdToUtc(et.date)) / DAY_MS) }
          : null,
        rates: {
          targetLower: r.lower ?? null,
          targetUpper: r.upper ?? null,
          effr: r.effr ?? null,
          asOf: r.asOf ?? null,
          source: 'environment',
        },
        contracts,
        estimate,
        estimateUnavailableReason,
        warnings,
        limitations: LIMITATIONS,
      },
    };
  };
}
