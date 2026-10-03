import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { ConnectionManager } from '../src/providers/tradingview/connection.js';
import { TradingViewAdapter, type CandleResult } from '../src/providers/tradingview/adapter.js';
import { TIMEFRAMES } from '../src/timeframes.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);
const manager = new ConnectionManager(logger, { token: config.tvSession, signature: config.tvSignature });
const opts = { symbol: config.tvSymbol, ttlMs: config.ttlMs };
const adapter = new TradingViewAdapter(manager, opts, logger);
manager.start();

const line = (r: CandleResult) =>
  `${r.timeframe.padEnd(3)} count=${r.candles.length} latest=${r.latestCandleTime} close=${r.latestCandle?.close} ` +
  `stale=${r.stale} marketOpen=${r.marketOpen} age=${r.ageSeconds}s note=${r.note} cached=${r.cached} ` +
  `latency=${r.latencyMs}ms malformed=${r.quality.malformed} dup=${r.quality.duplicates}`;

console.log('\n=== 1. quote ===');
console.log(JSON.stringify(await adapter.getQuote()));

console.log('\n=== 2. four timeframes in parallel (limit 500) ===');
for (const r of await Promise.all(TIMEFRAMES.map((tf) => adapter.getCandles(tf, 500)))) console.log(line(r));

console.log('\n=== 3. second call must come from cache ===');
console.log(line(await adapter.getCandles('M5', 500)));

console.log('\n=== 4. dedup: 5 identical concurrent requests after cache clear ===');
adapter.clearCache();
const t0 = Date.now();
const many = await Promise.all(Array.from({ length: 5 }, () => adapter.getCandles('H1', 200)));
console.log('all equal fetchedAt:', new Set(many.map((m) => m.fetchedAt)).size === 1, '| ms:', Date.now() - t0);

console.log('\n=== 5. forced disconnect, then reconnect ===');
console.log('before:', JSON.stringify(manager.status()));
manager.forceClose();
await new Promise((r) => setTimeout(r, 500));
console.log('after drop:', JSON.stringify(manager.status()));
adapter.clearCache();
console.log(line(await adapter.getCandles('M5', 100)));
console.log('after reconnect:', JSON.stringify(manager.status()));

console.log('\n=== 6. invalid symbol ===');
const bad = new TradingViewAdapter(manager, { ...opts, symbol: 'OANDA:NOTAREALSYMBOL123' }, logger, 15000);
const s = Date.now();
try {
  console.log(line(await bad.getCandles('M5', 50)));
} catch (e: any) {
  console.log('error code:', e.code, '| retryable:', e.retryable, '| ms:', Date.now() - s);
  console.log('message:', e.message);
}

await manager.shutdown();
console.log('\nsymbol:', config.tvSymbol, '| final:', JSON.stringify(manager.status()));
