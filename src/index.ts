import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createApp } from './server.js';
import { ConnectionManager } from './providers/tradingview/connection.js';
import { TradingViewAdapter } from './providers/tradingview/adapter.js';
import type { Services } from './services.js';
import { createMacroProvider } from './providers/macro/composite.js';
import { createEconomicCalendar } from './providers/macro/calendar.js';
import { createTvSnapshotLoader } from './providers/macro/tv-snapshot.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);

const manager = new ConnectionManager(logger, { token: config.tvSession, signature: config.tvSignature });
const adapter = new TradingViewAdapter(manager, { symbol: config.tvSymbol, ttlMs: config.ttlMs }, logger);
const macro = createMacroProvider({
  dxy: createTvSnapshotLoader(new TradingViewAdapter(manager, { symbol: config.macroSymbols.dxy, ttlMs: config.ttlMs }, logger)),
  us10y: createTvSnapshotLoader(new TradingViewAdapter(manager, { symbol: config.macroSymbols.us10y, ttlMs: config.ttlMs }, logger)),
  economicCalendar: createEconomicCalendar({
    logger,
    cacheTtlMs: config.calendar.cacheTtlMs,
    windowHours: config.calendar.windowHours,
    fomcDecisionDates: config.fomcDecisionDates,
  }),
});
const services: Services = {
  symbol: config.tvSymbol,
  pipSize: config.pipSize,
  macro,
  getQuote: () => adapter.getQuote(),
  getCandles: (tf, limit) => adapter.getCandles(tf, limit),
  connectionStatus: () => manager.status(),
};

const app = createApp(config, logger, services);
manager.start();

const httpServer = app.listen(config.port, () => {
  logger.info({ port: config.port, symbol: config.tvSymbol, nodeEnv: config.nodeEnv }, 'ai-trading-http listening');
});

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  void manager.shutdown();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
