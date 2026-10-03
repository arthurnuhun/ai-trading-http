import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { ConnectionManager } from '../src/providers/tradingview/connection.js';
import { TradingViewAdapter } from '../src/providers/tradingview/adapter.js';
import { atr } from '../src/analysis/indicators.js';
import { detectStructure } from '../src/analysis/market-structure.js';
import { clusterLevels, nearestLevels, psychologicalLevels, recentRange } from '../src/analysis/support-resistance.js';
import { fibonacciFromStructure } from '../src/analysis/fibonacci.js';
import { TIMEFRAMES } from '../src/timeframes.js';

const config = loadConfig();
const logger = createLogger('error');
const manager = new ConnectionManager(logger, { token: config.tvSession, signature: config.tvSignature });
const adapter = new TradingViewAdapter(manager, { symbol: config.tvSymbol, ttlMs: config.ttlMs }, logger);
const wib = (ms: number) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Jakarta', dateStyle: 'short', timeStyle: 'short' }).format(new Date(ms));

for (const tf of TIMEFRAMES) {
  const res = await adapter.getCandles(tf, 500);
  const price = res.latestCandle!.close;
  const atrLast = atr(res.candles, 14).at(-1) as number;
  const st = detectStructure(res.candles, 3);
  const tol = 0.5 * atrLast;
  console.log(`\n== ${tf} | price=${price} | ATR14=${atrLast.toFixed(3)} | tolerance=${tol.toFixed(3)}`);
  for (const l of nearestLevels(clusterLevels(st.swings, res.candles, price, tol), 3)) {
    console.log(`  ${l.kind.padEnd(10)} ${l.price} zone[${l.zoneLow}-${l.zoneHigh}] touches=${l.touches} origin=${l.origin} flipped=${l.flipped} last=${wib(l.lastTimestamp)} WIB`);
  }
  console.log('  psych:', psychologicalLevels(price, 2).map((p) => `${p.price}${p.major ? '*' : ''}`).join(' '));
  const rr = recentRange(res.candles, 100)!;
  console.log(`  recent100: high ${rr.high.price} @ ${wib(rr.high.timestamp)} | low ${rr.low.price} @ ${wib(rr.low.timestamp)}`);
  const fib = fibonacciFromStructure(st);
  if (fib) {
    console.log(`  fib ${fib.direction}: high ${fib.swingHigh.price} @ ${wib(fib.swingHigh.timestamp)} | low ${fib.swingLow.price} @ ${wib(fib.swingLow.timestamp)} | range ${fib.range}`);
    console.log('   retr:', fib.retracements.map((l) => `${l.label}=${l.price}`).join('  '));
    console.log('   ext :', fib.extensions.map((l) => `${l.label}=${l.price}`).join('  '));
  }
}
await manager.shutdown();
