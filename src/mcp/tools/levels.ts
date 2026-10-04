import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from '../../logger.js';
import type { Services } from '../../services.js';
import { buildLevelsReport, fibonacciReport } from '../../analysis/levels-report.js';
import { ok, fail, checkSymbol } from './market.js';
import { basis, parseTfs, perTimeframe } from './analysis.js';

export function registerLevelTools(server: McpServer, services: Services, logger: Logger): void {
  server.registerTool(
    'key_levels',
    {
      description:
        'Key price levels per timeframe (default H4, H1, M15, M5) computed from closed candles: support/resistance zones (with touches, flipped, priceInZone), confirmed swing highs/lows, provisional extremes, psychological levels, recent 100-candle high/low, open fair value gaps, unmitigated order blocks (widthAtr, wide), unswept BSL/SSL and equal-level pools, recent sweeps (penetration in price and ATR) and Fibonacci. Items are ordered by distance to price. All levels carry numeric prices. Distances are level minus price.',
      inputSchema: { symbol: z.string().optional(), timeframes: z.array(z.string()).optional() },
    },
    async ({ symbol, timeframes }) => {
      try {
        checkSymbol(services, symbol);
        const out = await perTimeframe(services, parseTfs(timeframes), (tf, l) => {
          const base = basis(tf, l);
          const price = l.res.latestCandle?.close ?? l.closed[l.closed.length - 1]?.close;
          if (price === undefined) return { ...base, levels: { available: false, reason: 'no candles' } };
          return {
            ...base,
            price,
            priceSource: l.forming ? 'forming_candle_close' : 'last_closed_candle_close',
            levels: buildLevelsReport(l.closed, price),
          };
        });
        return ok({ symbol: services.symbol, source: 'tradingview', ...out });
      } catch (err) {
        return fail(err, logger);
      }
    },
  );

  server.registerTool(
    'fibonacci',
    {
      description:
        'Fibonacci retracements (38.2, 50, 61.8, 78.6%) and extensions (127.2, 161.8%) per timeframe. "confirmed" uses the latest confirmed swing high and low; "provisional" uses the extremes after it (unconfirmed). The swing high and swing low used are always reported. swingLookback 1-20 (default 3).',
      inputSchema: {
        symbol: z.string().optional(),
        timeframes: z.array(z.string()).optional(),
        swingLookback: z.number().optional(),
      },
    },
    async ({ symbol, timeframes, swingLookback }) => {
      try {
        checkSymbol(services, symbol);
        const out = await perTimeframe(services, parseTfs(timeframes), (tf, l) => ({
          ...basis(tf, l),
          fibonacci: fibonacciReport(l.closed, swingLookback),
        }));
        return ok({ symbol: services.symbol, source: 'tradingview', ...out });
      } catch (err) {
        return fail(err, logger);
      }
    },
  );
}
