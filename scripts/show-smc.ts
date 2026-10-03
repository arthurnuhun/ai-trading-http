import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { ConnectionManager } from '../src/providers/tradingview/connection.js';
import { TradingViewAdapter } from '../src/providers/tradingview/adapter.js';
import { atr } from '../src/analysis/indicators.js';
import { detectStructure } from '../src/analysis/market-structure.js';
import { detectFvgs } from '../src/analysis/fvg.js';
import { detectOrderBlocks } from '../src/analysis/order-blocks.js';
import { findUnsweptLiquidity, groupEqualLevels, detectSweeps, inducementCandidates } from '../src/analysis/liquidity.js';
import { scanPatterns } from '../src/analysis/candle-patterns.js';
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
  const a = atr(res.candles, 14).at(-1) as number;
  const st = detectStructure(res.candles, 3);
  console.log(`\n== ${tf} | price=${price} | ATR14=${a.toFixed(3)}`);

  const fvgs = detectFvgs(res.candles, 0.1 * a).filter((f) => f.status !== 'filled').slice(-4);
  for (const f of fvgs) console.log(`  FVG ${f.direction} [${f.low}-${f.high}] size=${f.size} ${f.status} @ ${wib(f.timestamp)} WIB`);

  const obs = detectOrderBlocks(res.candles, st.events).filter((o) => o.status === 'unmitigated').slice(-3);
  for (const o of obs) console.log(`  OB ${o.direction} [${o.low}-${o.high}] ${o.status} @ ${wib(o.timestamp)} WIB via ${o.causedBy.type}`);

  const unswept = findUnsweptLiquidity(st.swings, res.candles);
  const above = unswept.filter((l) => l.side === 'BSL' && l.price > price).sort((x, y) => x.price - y.price).slice(0, 2);
  const below = unswept.filter((l) => l.side === 'SSL' && l.price < price).sort((x, y) => y.price - x.price).slice(0, 2);
  for (const l of [...above, ...below]) console.log(`  ${l.side} ${l.price} @ ${wib(l.timestamp)} WIB`);
  for (const p of groupEqualLevels(unswept, 0.25 * a).slice(0, 3)) console.log(`  pool ${p.side} ${p.price} x${p.count}`);

  for (const s of detectSweeps(res.candles, st.swings).slice(-3)) {
    console.log(`  ${s.type} level=${s.level} extreme=${s.extreme} close=${s.closePrice} reversal=${s.reversalConfirmed} @ ${wib(s.timestamp)} WIB`);
  }
  for (const s of inducementCandidates(res.candles, st).slice(-2)) {
    console.log(`  inducement-candidate ${s.type} level=${s.level} @ ${wib(s.timestamp)} WIB`);
  }
  for (const h of scanPatterns(res.candles, 8)) {
    const p = h.patterns;
    console.log(`  pattern @ ${wib(h.timestamp)} WIB: ${[p.doji && 'doji', p.pinBar && `pin-${p.pinBar}`, p.engulfing && `engulfing-${p.engulfing}`].filter(Boolean).join(', ')}`);
  }
}
await manager.shutdown();
