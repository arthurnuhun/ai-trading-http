import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { ConnectionManager } from '../src/providers/tradingview/connection.js';
import { TradingViewAdapter } from '../src/providers/tradingview/adapter.js';
import { computeSnapshot } from '../src/analysis/indicators.js';
import { TIMEFRAMES } from '../src/timeframes.js';

const config = loadConfig();
const logger = createLogger('error');
const manager = new ConnectionManager(logger, { token: config.tvSession, signature: config.tvSignature });
const adapter = new TradingViewAdapter(manager, { symbol: config.tvSymbol, ttlMs: config.ttlMs }, logger);

const r3 = (v: number | null) => (v === null ? null : Math.round(v * 1000) / 1000);
for (const tf of TIMEFRAMES) {
  const res = await adapter.getCandles(tf, 500);
  const s = computeSnapshot(res.candles);
  console.log(`\n== ${tf} | candles=${s.candlesUsed} | latest=${res.latestCandleTime} | close=${res.latestCandle?.close}`);
  console.log(`RSI14=${r3(s.rsi14)}  ATR14=${r3(s.atr14)}`);
  console.log(`MACD=${r3(s.macd.macd)}  signal=${r3(s.macd.signal)}  hist=${r3(s.macd.histogram)}`);
  console.log(`EMA20=${r3(s.ema.ema20)}  EMA50=${r3(s.ema.ema50)}  EMA100=${r3(s.ema.ema100)}  EMA200=${r3(s.ema.ema200)}`);
}
await manager.shutdown();
