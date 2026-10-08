import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AppError } from '../../errors.js';
import type { Logger } from '../../logger.js';
import type { Services } from '../../services.js';
import { MIN_RR, buildRiskPlan, type Direction, type TradeStyle } from '../../analysis/risk.js';
import { scoreConfluence, type ConfluenceInput } from '../../analysis/confluence.js';
import {
  evaluateBias,
  evaluateLocation,
  evaluateMomentum,
  evaluateSession,
  isCounterTrend,
  resolveOverride,
} from '../../analysis/confluence-eval.js';
import { detectDivergences } from '../../analysis/divergence.js';
import { macd, rsi } from '../../analysis/indicators.js';
import { LEVEL_RULES, buildLevelsReport } from '../../analysis/levels-report.js';
import { detectStructure } from '../../analysis/market-structure.js';
import { sessionContext } from '../../analysis/sessions.js';
import { ok, fail, checkSymbol } from './market.js';
import { basis, loadTf } from './analysis.js';
import { loadMacro } from '../../providers/context-providers.js';
import { newsGuardWarnings } from '../../analysis/news-guard.js';
import { evaluateMacroBias } from '../../analysis/macro-bias.js';

function parseDirection(v: string): Direction {
  if (v === 'buy' || v === 'sell') return v;
  throw new AppError('INVALID_INPUT', 'direction must be buy or sell', false);
}

function parseStyle(v: string): TradeStyle {
  if (Object.hasOwn(MIN_RR, v)) return v as TradeStyle;
  throw new AppError('INVALID_INPUT', 'style must be scalp, intraday or swing', false);
}

const verdict = z.object({ status: z.string(), reason: z.string() }).optional();

export function registerDecisionTools(server: McpServer, services: Services, logger: Logger): void {
  server.registerTool(
    'confluence_check',
    {
      description:
        'Scores the six-factor confluence checklist of analisa-xauusd for a prospective trade (direction buy/sell, style scalp/intraday/swing). Thresholds: 4/6 valid entry, 5-6/6 full confluence, <=3/6 SKIP. Factors: H4/H1 bias, S/R-FVG location (H1), heatmap, momentum (M15), session, macro bias. Heatmap is "unavailable" (never counted as a pass) unless the caller supplies {status, reason}, which is marked caller_supplied. Macro bias is computed from the 24h direction of DXY and US10Y (both must be fresh; bullish for gold only when both fall, bearish only when both rise, otherwise no clear bias, which is not a pass) unless the caller supplies {status, reason}, which overrides it and is marked caller_supplied. Warnings list rules the server cannot verify.',
      inputSchema: {
        symbol: z.string().optional(),
        direction: z.string(),
        style: z.string(),
        heatmap: verdict,
        macro: verdict,
      },
    },
    async ({ symbol, direction, style, heatmap, macro }) => {
      try {
        checkSymbol(services, symbol);
        const dir = parseDirection(direction);
        const sty = parseStyle(style);
        const heatmapFactor = resolveOverride(heatmap, 'No heatmap provider configured');
        const macroOverride = macro === undefined ? null : resolveOverride(macro, 'No macro verdict supplied');

        const [h4, h1, m15, macroSnapshot] = await Promise.all([
          loadTf(services, 'H4'),
          loadTf(services, 'H1'),
          loadTf(services, 'M15'),
          loadMacro(services),
        ]);
        const price = m15.res.latestCandle?.close;
        if (price === undefined) throw new AppError('DATA_QUALITY_ERROR', 'No M15 candles available', true);

        const lookback = LEVEL_RULES.swingLookback;
        const h4Trend = detectStructure(h4.closed, lookback).trendState;
        const h1Trend = detectStructure(h1.closed, lookback).trendState;
        const levels = buildLevelsReport(h1.closed, price);

        const closes = m15.closed.map((c) => c.close);
        const rsiSeries = rsi(closes, 14);
        const histogram = macd(closes).histogram;
        const st15 = detectStructure(m15.closed, lookback);
        const lastIndex = m15.closed.length - 1;
        const divergences = [
          ...detectDivergences(st15.swings, rsiSeries, 'RSI', lastIndex),
          ...detectDivergences(st15.swings, histogram, 'MACD_HIST', lastIndex),
        ];
        const session = sessionContext();

        const factors: ConfluenceInput = {
          h4h1_bias: evaluateBias(dir, h4Trend, h1Trend),
          sr_fvg_location: levels.available
            ? evaluateLocation(dir, levels)
            : { status: 'unavailable', reason: levels.reason },
          heatmap: heatmapFactor,
          momentum: evaluateMomentum(dir, {
            rsi14: rsiSeries.at(-1) ?? null,
            macdHistogram: histogram.at(-1) ?? null,
            divergences,
          }),
          session: evaluateSession(sty, session),
          macro_bias: macroOverride ?? evaluateMacroBias(dir, macroSnapshot),
        };
        const result = scoreConfluence(factors);
        const counterTrend = isCounterTrend(dir, h4Trend);

        const warnings: string[] = [
          ...newsGuardWarnings(macroSnapshot.economicCalendar),
          'The data source provides no bid/ask: the wide-spread prohibition cannot be verified.',
        ];
        if (counterTrend) {
          warnings.push(
            'Counter-trend versus H4. The skill says "min 4/5 confluence" for counter-trend, which does not match its 6-factor checklist; only the 4/6, 5-6/6 and <=3/6 thresholds are applied here.',
          );
        }
        if (!session.marketOpen) warnings.push('Market is closed: this evaluation uses the last available data.');
        for (const [tf, l] of [['H4', h4], ['H1', h1], ['M15', m15]] as const) {
          if (l.res.stale) warnings.push(`${tf} data is stale (${l.res.staleReason}).`);
        }

        return ok({
          symbol: services.symbol,
          source: 'tradingview',
          direction: dir,
          style: sty,
          price,
          priceSource: 'm15_latest_candle_close',
          score: result.score,
          outOf: result.outOf,
          verdict: result.verdict,
          thresholds: result.thresholds,
          unavailable: result.unavailable,
          factors: result.factors,
          counterTrend,
          context: {
            biasTimeframes: 'H4+H1',
            locationTimeframe: 'H1',
            momentumTimeframe: 'M15',
            h4TrendState: h4Trend,
            h1TrendState: h1Trend,
            m15Divergences: divergences,
            session,
          },
          warnings,
          data: { H4: basis('H4', h4), H1: basis('H1', h1), M15: basis('M15', m15) },
        });
      } catch (err) {
        return fail(err, logger);
      }
    },
  );

  server.registerTool(
    'risk_plan',
    {
      description:
        'Analytical risk plan, never an order: pip distances, TP pips and RR, minimum-RR check per style (scalp 1.5, intraday 2, swing 3), breakeven trigger (+20 pips), partial at TP1 (40%), max risk 2%, and approximate position size when accountBalance, riskPercent and contractSize (ounces per lot) are all given. pipSize comes from the input or the PIP_SIZE environment variable; takeProfits must be 1-3 prices ordered away from entry.',
      inputSchema: {
        direction: z.string(),
        style: z.string(),
        entry: z.number(),
        stopLoss: z.number(),
        takeProfits: z.array(z.number()),
        pipSize: z.number().optional(),
        accountBalance: z.number().optional(),
        riskPercent: z.number().optional(),
        contractSize: z.number().optional(),
      },
    },
    async (a) => {
      try {
        const pipSize = a.pipSize ?? services.pipSize;
        if (pipSize === undefined) {
          throw new AppError('INVALID_INPUT', 'pipSize is required: pass pipSize or set the PIP_SIZE environment variable', false);
        }
        const plan = buildRiskPlan({
          direction: parseDirection(a.direction),
          style: parseStyle(a.style),
          entry: a.entry,
          stopLoss: a.stopLoss,
          takeProfits: a.takeProfits,
          pipSize,
          accountBalance: a.accountBalance,
          riskPercent: a.riskPercent,
          contractSize: a.contractSize,
        });
        return ok({
          symbol: services.symbol,
          ...plan,
          pipSizeSource: a.pipSize !== undefined ? 'input' : 'config',
          note: 'Analytical only: this server never places, modifies or cancels orders.',
        });
      } catch (err) {
        return fail(err, logger);
      }
    },
  );
}
