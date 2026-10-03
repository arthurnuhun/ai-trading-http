import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createApp } from './server.js';
import { ConnectionManager } from './providers/tradingview/connection.js';
import { TradingViewAdapter } from './providers/tradingview/adapter.js';
import type { Services } from './services.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);

const manager = new ConnectionManager(logger, { token: config.tvSession, signature: config.tvSignature });
const adapter = new TradingViewAdapter(manager, { symbol: config.tvSymbol, ttlMs: config.ttlMs }, logger);
const services: Services = {
  symbol: config.tvSymbol,
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
