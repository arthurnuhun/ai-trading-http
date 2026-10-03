import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AppError, toErrorResponse } from '../../errors.js';
import type { Logger } from '../../logger.js';
import type { CandleResult } from '../../providers/tradingview/adapter.js';
import type { Services } from '../../services.js';
import { TIMEFRAMES, type Timeframe } from '../../timeframes.js';
import type { Candle } from '../../types.js';
import { computeSnapshot } from '../../analysis/indicators.js';
import { detectStructure, type Swing } from '../../analysis/market-structure.js';
import { splitClosed } from '../../analysis/closed-candles.js';
import { provisionalSwings } from '../../analysis/provisional.js';
import { sessionContext } from '../../analysis/sessions.js';
import { ok, fail, checkSymbol, requireTimeframe } from './market.js';

const ANALYSIS_CANDLES = 500;
const r3 = (v: number | null): number | null => (v === null ? null : Math.round(v * 1000) / 1000);

type Loaded = { res: CandleResult; closed: Candle[]; forming: Candle | null };

async function loadTf(services: Services, tf: Timeframe): Promise<Loaded> {
  const res = await services.getCandles(tf, ANALYSIS_CANDLES);
  const { closed, forming } = splitClosed(res.candles, tf);
  return { res, closed, forming };
}

function basis(tf: Timeframe, l: Loaded) {
  const last = l.closed.length ? l.closed[l.closed.length - 1] : null;
  return {
    timeframe: tf,
    basis: 'closed_candles' as const,
    closedCandles: l.closed.length,
    lastClosedCandleTime: last?.isoTime ?? null,
    lastClose: last?.close ?? null,
    formingCandle: l.forming
      ? { timestamp: l.forming.timestamp, isoTime: l.forming.isoTime, close: l.forming.close }
      : null,
    fetchedAt: l.res.fetchedAt,
    stale: l.res.stale,
    staleReason: l.res.staleReason,
    note: l.res.note,
    marketOpen: l.res.marketOpen,
    cached: l.res.cached,
  };
}

function parseTfs(input: string[] | undefined): Timeframe[] {
  const tfs = [...new Set((input ?? [...TIMEFRAMES]).map(requireTimeframe))];
  if (tfs.length === 0) throw new AppError('INVALID_INPUT', 'timeframes must not be empty', false);
  return tfs;
}

async function perTimeframe(services: Services, tfs: Timeframe[], build: (tf: Timeframe, l: Loaded) => object) {
  const settled = await Promise.allSettled(tfs.map(async (tf) => build(tf, await loadTf(services, tf))));
  const datasets: Record<string, object> = {};
  const errors: Record<string, unknown> = {};
  let firstError: unknown;
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') datasets[tfs[i]] = s.value;
    else {
      firstError ??= s.reason;
      errors[tfs[i]] = toErrorResponse(s.reason).error;
    }
  });
  if (Object.keys(datasets).length === 0) throw firstError;
  const partial = Object.keys(errors).length > 0;
  return { partial, datasets, ...(partial ? { errors } : {}) };
}

const swingView = (s: Swing) => ({
  type: s.type,
  label: s.label,
  price: s.price,
  timestamp: s.timestamp,
  isoTime: s.isoTime,
  confirmedTimestamp: s.confirmedTimestamp,
});

export function registerAnalysisTools(server: McpServer, services: Services, logger: Logger): void {
  server.registerTool(
    'technical_indicators',
    {
      description:
        'RSI(14), MACD(12,26,9) with histogram, ATR(14) and EMA 20/50/100/200 per timeframe (default H4, H1, M15, M5), computed on closed candles only. null means not enough history. Indicators are contextual evidence, not standalone signals.',
      inputSchema: { symbol: z.string().optional(), timeframes: z.array(z.string()).optional() },
    },
    async ({ symbol, timeframes }) => {
      try {
        checkSymbol(services, symbol);
        const out = await perTimeframe(services, parseTfs(timeframes), (tf, l) => {
          const s = computeSnapshot(l.closed);
          return {
            ...basis(tf, l),
            indicators: {
              rsi14: r3(s.rsi14),
              macd: { macd: r3(s.macd.macd), signal: r3(s.macd.signal), histogram: r3(s.macd.histogram) },
              atr14: r3(s.atr14),
              ema: { ema20: r3(s.ema.ema20), ema50: r3(s.ema.ema50), ema100: r3(s.ema.ema100), ema200: r3(s.ema.ema200) },
            },
          };
        });
        return ok({
          symbol: services.symbol,
          source: 'tradingview',
          interpretation: 'Contextual evidence only; not standalone trading signals. Parameters: RSI 14 (Wilder), MACD 12/26/9, ATR 14 (Wilder).',
          ...out,
        });
      } catch (err) {
        return fail(err, logger);
      }
    },
  );

  server.registerTool(
    'market_structure',
    {
      description:
        'Swing highs/lows with HH/HL/LH/LL labels, BOS and CHoCH (close-based) and trend state per timeframe, computed on closed candles. Every event carries candle/price evidence. "provisional" holds unconfirmed extremes after the latest confirmed swing. swingLookback 1-20 (default 3).',
      inputSchema: {
        symbol: z.string().optional(),
        timeframes: z.array(z.string()).optional(),
        swingLookback: z.number().optional(),
      },
    },
    async ({ symbol, timeframes, swingLookback }) => {
      try {
        checkSymbol(services, symbol);
        const out = await perTimeframe(services, parseTfs(timeframes), (tf, l) => {
          const st = detectStructure(l.closed, swingLookback);
          const prov = provisionalSwings(l.closed, st);
          return {
            ...basis(tf, l),
            swingLookback: st.swingLookback,
            trendState: st.trendState,
            lastEvent: st.lastEvent,
            recentEvents: st.events.slice(-5),
            recentSwings: st.swings.slice(-8).map(swingView),
            lastSwingHigh: st.lastSwingHigh ? swingView(st.lastSwingHigh) : null,
            lastSwingLow: st.lastSwingLow ? swingView(st.lastSwingLow) : null,
            provisional: {
              note: 'Extremes after the latest confirmed swing. Not confirmed; they can still change and are not structure events.',
              anchorTimestamp: prov.anchorTimestamp,
              high: prov.high,
              low: prov.low,
            },
          };
        });
        return ok({ symbol: services.symbol, source: 'tradingview', ...out });
      } catch (err) {
        return fail(err, logger);
      }
    },
  );

  server.registerTool(
    'session_context',
    {
      description:
        'Current trading session in Asia/Jakarta (Australia 05-07, Asia 07-13, London 13-20, New York 20-24) with kill zones (London 13-15, New York 20-21:30). 00:00-05:00 is off_hours. Also reports whether the market is open.',
    },
    async () => {
      try {
        return ok({ ...sessionContext() });
      } catch (err) {
        return fail(err, logger);
      }
    },
  );
}
