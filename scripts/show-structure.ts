import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { ConnectionManager } from '../src/providers/tradingview/connection.js';
import { TradingViewAdapter } from '../src/providers/tradingview/adapter.js';
import { detectStructure } from '../src/analysis/market-structure.js';
import { TIMEFRAMES } from '../src/timeframes.js';

const config = loadConfig();
const logger = createLogger('error');
const manager = new ConnectionManager(logger, { token: config.tvSession, signature: config.tvSignature });
const adapter = new TradingViewAdapter(manager, { symbol: config.tvSymbol, ttlMs: config.ttlMs }, logger);
const wib = (ms: number) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Jakarta', dateStyle: 'short', timeStyle: 'short' }).format(new Date(ms));

for (const tf of TIMEFRAMES) {
  const res = await adapter.getCandles(tf, 500);
  const r = detectStructure(res.candles, 3);
  console.log(`\n== ${tf} | trendState=${r.trendState} | swings=${r.swings.length} | events=${r.events.length} | lookback=${r.swingLookback}`);
  for (const s of r.swings.slice(-6)) console.log(`  ${(s.label ?? '--').padEnd(2)} swing-${s.type.padEnd(4)} ${s.price}  @ ${wib(s.timestamp)} WIB`);
  for (const e of r.events.slice(-3)) {
    console.log(`  ${e.type} ${e.direction} level=${e.price} close=${e.closePrice} @ ${wib(e.timestamp)} WIB (swing ${wib(e.brokenSwingTimestamp)} WIB)`);
  }
}
await manager.shutdown();
