import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AppError } from '../../errors.js';
import type { Logger } from '../../logger.js';
import type { Services } from '../../services.js';
import type { Timeframe } from '../../timeframes.js';
import type { NormalizeStats } from '../../types.js';
import { PATTERN_RULES, scanPatterns } from '../../analysis/candle-patterns.js';
import { compactLevels, emaStack, priceVsEma } from '../../analysis/context.js';
import { DIVERGENCE_MAX_AGE_CANDLES, detectDivergences } from '../../analysis/divergence.js';
import { computeSnapshot, macd, rsi } from '../../analysis/indicators.js';
import { LEVEL_RULES, buildLevelsReport } from '../../analysis/levels-report.js';
import { detectStructure, type Swing } from '../../analysis/market-structure.js';
import { provisionalSwings } from '../../analysis/provisional.js';
import { sessionContext } from '../../analysis/sessions.js';
import { loadHeatmap, loadMacro, macroStatus } from '../../providers/context-providers.js';
import { MACRO_KEYS, type MacroSnapshot } from '../../providers/macro/index.js';
import { ok, fail, checkSymbol } from './market.js';
import { basis, parseTfs, perTimeframe, type Loaded } from './analysis.js';

const DEFAULT_CANDLES = 30;
const MAX_CANDLES = 200;
const CANDLE_FIELDS = ['timestamp', 'open', 'high', 'low', 'close', 'volume'] as const;
const r3 = (v: number | null): number | null => (v === null ? null : Math.round(v * 1000) / 1000);

const LIMITATIONS = [
  'Price only: the TradingView quote has no bid/ask or spread.',
  'Volume is TradingView tick volume, not traded volume.',
  'Indicators, structure and levels use closed candles only; the forming candle is reported separately.',
  'Analytical parameters (swing lookback, zone tolerances, pattern thresholds) are design choices; the full context lists them under "parameters".',
];

type PriceInfo = {
  value: number;
  source: 'quote' | 'm5_latest_candle_close';
  timestamp: string;
  timestampSource: 'received_at' | 'candle_open_time';
  marketOpen: boolean;
  latencyMs?: number;
  cached?: boolean;
  quoteError?: string;
};

async function resolvePrice(services: Services): Promise<PriceInfo> {
  try {
    const q = await services.getQuote();
    return {
      value: q.price,
      source: 'quote',
      timestamp: q.receivedAt,
      timestampSource: 'received_at',
      marketOpen: q.marketOpen,
      latencyMs: q.latencyMs,
      cached: q.cached,
    };
  } catch (err) {
    const m5 = await services.getCandles('M5', 500);
    const last = m5.latestCandle;
    if (!last) throw new AppError('DATA_QUALITY_ERROR', 'No price available', true);
    return {
      value: last.close,
      source: 'm5_latest_candle_close',
      timestamp: last.isoTime,
      timestampSource: 'candle_open_time',
      marketOpen: m5.marketOpen,
      quoteError: err instanceof AppError ? err.code : 'UNKNOWN',
    };
  }
}

const sv = (s: Swing) => ({ type: s.type, label: s.label, price: s.price, timestamp: s.timestamp, isoTime: s.isoTime });

function freshnessOf(tf: Timeframe, l: Loaded) {
  return {
    timeframe: tf,
    latestCandleTime: l.res.latestCandleTime,
    ageSeconds: l.res.ageSeconds,
    stale: l.res.stale,
    staleReason: l.res.staleReason,
    note: l.res.note,
    marketOpen: l.res.marketOpen,
    fetchedAt: l.res.fetchedAt,
    cached: l.res.cached,
    latencyMs: l.res.latencyMs,
  };
}
type Fresh = ReturnType<typeof freshnessOf>;

function buildFreshness(tfs: Timeframe[], fresh: Partial<Record<Timeframe, Fresh>>) {
  const byTimeframe: Record<string, Fresh> = {};
  for (const tf of tfs) {
    const f = fresh[tf];
    if (f) byTimeframe[tf] = f;
  }
  return {
    byTimeframe,
    anyStale: Object.values(byTimeframe).some((f) => f.stale),
    marketOpen: sessionContext().marketOpen,
  };
}

function availableMacro(m: MacroSnapshot): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of MACRO_KEYS) if (m[k].available) out[k] = m[k];
  return out;
}

function buildTf(tf: Timeframe, l: Loaded, price: number, detail: 'compact' | 'full', candleLimit: number) {
  const closed = l.closed;
  const snap = computeSnapshot(closed);
  const st = detectStructure(closed, LEVEL_RULES.swingLookback);
  const prov = provisionalSwings(closed, st);
  const closes = closed.map((c) => c.close);
  const lastIndex = closed.length - 1;
  const divergences = [
    ...detectDivergences(st.swings, rsi(closes, 14), 'RSI', lastIndex),
    ...detectDivergences(st.swings, macd(closes).histogram, 'MACD_HIST', lastIndex),
  ];
  const levels = buildLevelsReport(closed, price);

  const base = {
    ...basis(tf, l),
    indicators: {
      rsi14: r3(snap.rsi14),
      macd: { macd: r3(snap.macd.macd), signal: r3(snap.macd.signal), histogram: r3(snap.macd.histogram) },
      atr14: r3(snap.atr14),
      ema: { ema20: r3(snap.ema.ema20), ema50: r3(snap.ema.ema50), ema100: r3(snap.ema.ema100), ema200: r3(snap.ema.ema200) },
    },
    emaStack: emaStack(snap.ema),
    priceVsEma: priceVsEma(price, snap.ema),
    structure: {
      trendState: st.trendState,
      lastEvent: st.lastEvent,
      lastSwingHigh: st.lastSwingHigh ? sv(st.lastSwingHigh) : null,
      lastSwingLow: st.lastSwingLow ? sv(st.lastSwingLow) : null,
      provisional: { high: prov.high, low: prov.low },
    },
    divergences,
    patterns: scanPatterns(closed, 5),
  };

  if (detail === 'compact') {
    return { ...base, levels: levels.available ? compactLevels(levels) : levels };
  }
  const rows =
    candleLimit > 0
      ? l.res.candles.slice(-candleLimit).map((c) => [c.timestamp, c.open, c.high, c.low, c.close, c.volume ?? null])
      : null;
  return {
    ...base,
    structure: { ...base.structure, recentEvents: st.events.slice(-5), recentSwings: st.swings.slice(-8).map(sv) },
    levels,
    ...(rows
      ? { candles: { fields: CANDLE_FIELDS, volumeType: 'tick', count: rows.length, includesFormingCandle: l.forming !== null, rows } }
      : {}),
  };
}

export function registerContextTools(server: McpServer, services: Services, logger: Logger): void {
  server.registerTool(
    'trading_context',
    {
      description:
        'Primary AI context, compact: current price, session (Asia/Jakarta), and per timeframe (default H4, H1, M15, M5) RSI, MACD histogram, ATR, EMA values and stack, market structure, divergences, recent candle patterns and nearest key levels, plus heatmap status, macro status and data freshness. Computed on closed candles. Structured data, no prose. Use xauusd_analysis_context for the full evidence set.',
      inputSchema: { symbol: z.string().optional(), timeframes: z.array(z.string()).optional() },
    },
    async ({ symbol, timeframes }) => {
      try {
        checkSymbol(services, symbol);
        const tfs = parseTfs(timeframes);
        const price = await resolvePrice(services);
        const fresh: Partial<Record<Timeframe, Fresh>> = {};
        const [out, heatmap, macro] = await Promise.all([
          perTimeframe(services, tfs, (tf, l) => {
            fresh[tf] = freshnessOf(tf, l);
            return buildTf(tf, l, price.value, 'compact', 0);
          }),
          loadHeatmap(services),
          loadMacro(services),
        ]);
        return ok({
          symbol: services.symbol,
          source: 'tradingview',
          generatedAt: new Date().toISOString(),
          price,
          session: sessionContext(),
          ...out,
          heatmap,
          macro: { status: macroStatus(macro), availableItems: availableMacro(macro) },
          dataFreshness: buildFreshness(tfs, fresh),
          limitations: LIMITATIONS,
        });
      } catch (err) {
        return fail(err, logger);
      }
    },
  );

  server.registerTool(
    'xauusd_analysis_context',
    {
      description: `Full evidence set for the AI analyst: price, session, per timeframe (default H4, H1, M15, M5) indicators, EMA stack, structure with recent events and swings, divergences, patterns, complete key levels (support/resistance, FVG, order blocks, liquidity, sweeps, Fibonacci confirmed and provisional) and the most recent candles (candleLimit 0-${MAX_CANDLES}, default ${DEFAULT_CANDLES}; 0 omits them), plus heatmap, macro inputs, economic calendar, data quality and the parameters used. Unavailable providers are reported as available: false, never fabricated.`,
      inputSchema: {
        symbol: z.string().optional(),
        timeframes: z.array(z.string()).optional(),
        candleLimit: z.number().optional(),
      },
    },
    async ({ symbol, timeframes, candleLimit }) => {
      try {
        checkSymbol(services, symbol);
        const tfs = parseTfs(timeframes);
        const n = candleLimit ?? DEFAULT_CANDLES;
        if (!Number.isInteger(n) || n < 0 || n > MAX_CANDLES) {
          throw new AppError('INVALID_INPUT', `candleLimit must be an integer between 0 and ${MAX_CANDLES}`, false);
        }
        const price = await resolvePrice(services);
        const fresh: Partial<Record<Timeframe, Fresh>> = {};
        const quality: Partial<Record<Timeframe, NormalizeStats>> = {};
        const [out, heatmap, macro] = await Promise.all([
          perTimeframe(services, tfs, (tf, l) => {
            fresh[tf] = freshnessOf(tf, l);
            quality[tf] = l.res.quality;
            return buildTf(tf, l, price.value, 'full', n);
          }),
          loadHeatmap(services),
          loadMacro(services),
        ]);
        const byTimeframe: Record<string, NormalizeStats> = {};
        for (const tf of tfs) {
          const q = quality[tf];
          if (q) byTimeframe[tf] = q;
        }
        return ok({
          symbol: services.symbol,
          source: 'tradingview',
          generatedAt: new Date().toISOString(),
          price,
          session: sessionContext(),
          ...out,
          heatmap,
          macro: { status: macroStatus(macro), items: macro },
          economicCalendar: macro.economicCalendar,
          dataFreshness: buildFreshness(tfs, fresh),
          dataQuality: { byTimeframe, connection: services.connectionStatus() },
          parameters: {
            ...LEVEL_RULES,
            indicators: { rsiPeriod: 14, macd: { fast: 12, slow: 26, signal: 9 }, atrPeriod: 14, ema: [20, 50, 100, 200] },
            patterns: PATTERN_RULES,
            divergenceMaxAgeCandles: DIVERGENCE_MAX_AGE_CANDLES,
          },
          limitations: LIMITATIONS,
        });
      } catch (err) {
        return fail(err, logger);
      }
    },
  );
}
