import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AppError, toErrorResponse } from '../../errors.js';
import type { Logger } from '../../logger.js';
import type { CandleResult } from '../../providers/tradingview/adapter.js';
import { parseTimeframe, TIMEFRAMES, type Timeframe } from '../../timeframes.js';
import type { Services } from '../../services.js';

const DEFAULT_LIMIT = 200;
const FIELDS = ['timestamp', 'open', 'high', 'low', 'close', 'volume'] as const;

function ok(data: object) {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, ...data }) }] };
}

function fail(err: unknown, logger: Logger) {
  if (!(err instanceof AppError)) logger.error({ err }, 'unexpected tool error');
  return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(toErrorResponse(err)) }] };
}

function checkSymbol(services: Services, symbol: string | undefined): void {
  if (symbol !== undefined && symbol !== services.symbol) {
    throw new AppError(
      'INVALID_SYMBOL',
      `This server is configured for ${services.symbol}; it does not mix feeds. Omit "symbol" or use ${services.symbol}.`,
      false,
    );
  }
}

function requireTimeframe(input: string): Timeframe {
  const tf = parseTimeframe(input);
  if (!tf) throw new AppError('INVALID_TIMEFRAME', `timeframe must be one of ${TIMEFRAMES.join(', ')}`, false);
  return tf;
}

// Compact rows: [timestamp(ms), open, high, low, close, volume]. Volume is TradingView tick volume.
function candleData(r: CandleResult, includeIdentity: boolean) {
  return {
    ...(includeIdentity ? { symbol: r.symbol, source: r.source } : {}),
    timeframe: r.timeframe,
    fields: FIELDS,
    volumeType: 'tick',
    count: r.candles.length,
    candles: r.candles.map((c) => [c.timestamp, c.open, c.high, c.low, c.close, c.volume ?? null]),
    latestCandle: r.latestCandle,
    fetchedAt: r.fetchedAt,
    latestCandleTime: r.latestCandleTime,
    stale: r.stale,
    staleReason: r.staleReason,
    note: r.note,
    marketOpen: r.marketOpen,
    ageSeconds: r.ageSeconds,
    latencyMs: r.latencyMs,
    cached: r.cached,
    quality: r.quality,
  };
}

export function registerMarketTools(server: McpServer, services: Services, logger: Logger): void {
  server.registerTool(
    'market_quote',
    {
      description:
        'Latest XAUUSD price from TradingView. Price only: bid/ask are not available from this source. Timestamp is the time this server received the price.',
      inputSchema: { symbol: z.string().optional() },
    },
    async ({ symbol }) => {
      try {
        checkSymbol(services, symbol);
        const q = await services.getQuote();
        return ok({
          symbol: q.symbol,
          price: q.price,
          timestamp: q.receivedAt,
          timestampSource: q.priceTimeSource,
          source: q.source,
          stale: false,
          marketOpen: q.marketOpen,
          note: q.marketOpen ? null : 'market_closed_last_price',
          latencyMs: q.latencyMs,
          cached: q.cached,
        });
      } catch (err) {
        return fail(err, logger);
      }
    },
  );

  server.registerTool(
    'ohlc',
    {
      description: `Historical OHLC for one timeframe (H4, H1, M15, M5), oldest to newest. Rows follow "fields". limit 1-500 (default ${DEFAULT_LIMIT}).`,
      inputSchema: { symbol: z.string().optional(), timeframe: z.string(), limit: z.number().optional() },
    },
    async ({ symbol, timeframe, limit }) => {
      try {
        checkSymbol(services, symbol);
        const tf = requireTimeframe(timeframe);
        const r = await services.getCandles(tf, limit ?? DEFAULT_LIMIT);
        return ok(candleData(r, true));
      } catch (err) {
        return fail(err, logger);
      }
    },
  );

  server.registerTool(
    'multi_timeframe_ohlc',
    {
      description: `OHLC for several timeframes in one response (default H4, H1, M15, M5). limit 1-500 per timeframe (default ${DEFAULT_LIMIT}). A failing timeframe is reported under "errors" and the others are still returned.`,
      inputSchema: {
        symbol: z.string().optional(),
        timeframes: z.array(z.string()).optional(),
        limit: z.number().optional(),
      },
    },
    async ({ symbol, timeframes, limit }) => {
      try {
        checkSymbol(services, symbol);
        const tfs = [...new Set((timeframes ?? [...TIMEFRAMES]).map(requireTimeframe))];
        if (tfs.length === 0) throw new AppError('INVALID_INPUT', 'timeframes must not be empty', false);
        const eff = limit ?? DEFAULT_LIMIT;
        const settled = await Promise.allSettled(tfs.map((tf) => services.getCandles(tf, eff)));
        const datasets: Record<string, unknown> = {};
        const errors: Record<string, unknown> = {};
        let firstError: unknown;
        settled.forEach((s, i) => {
          if (s.status === 'fulfilled') datasets[tfs[i]] = candleData(s.value, false);
          else {
            firstError ??= s.reason;
            errors[tfs[i]] = toErrorResponse(s.reason).error;
          }
        });
        if (Object.keys(datasets).length === 0) throw firstError;
        const partial = Object.keys(errors).length > 0;
        return ok({
          symbol: services.symbol,
          source: 'tradingview',
          requestedLimit: eff,
          partial,
          datasets,
          ...(partial ? { errors } : {}),
        });
      } catch (err) {
        return fail(err, logger);
      }
    },
  );
}
