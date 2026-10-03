import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createApp } from './server.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);
const app = createApp(config, logger);

const httpServer = app.listen(config.port, () => {
  logger.info({ port: config.port, symbol: config.tvSymbol, nodeEnv: config.nodeEnv }, 'ai-trading-http listening');
});

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
