import TradingView from '@mathieuc/tradingview';

const SYMBOL = process.env.TV_SYMBOL || 'OANDA:XAUUSD';
const client = new TradingView.Client();
client.onError((...e) => console.error('[client error]', ...e));

// A) M5 dengan range 500
const res = await new Promise((resolve) => {
  const chart = new client.Session.Chart();
  let settle;
  const hard = setTimeout(() => finish({ error: 'timeout' }), 30000);
  function finish(r) {
    clearTimeout(hard);
    clearTimeout(settle);
    try { chart.delete(); } catch {}
    resolve(r);
  }
  chart.onError((...e) => finish({ error: e.join(' ') }));
  chart.onUpdate(() => {
    if (!chart.periods.length) return;
    clearTimeout(settle);
    settle = setTimeout(
      () => finish({ infos: chart.infos, periods: chart.periods.slice() }),
      1500,
    );
  });
  chart.setMarket(SYMBOL, { timeframe: '5', range: 500 });
});

console.log('===== M5 range=500 =====');
if (res.error) {
  console.log('ERROR:', res.error);
} else {
  const asc = [...res.periods].reverse();
  const gaps = new Map();
  let dup = 0, nonMono = 0;
  for (let i = 1; i < asc.length; i++) {
    const d = asc[i].time - asc[i - 1].time;
    if (d === 0) dup++;
    else if (d < 0) nonMono++;
    gaps.set(d, (gaps.get(d) || 0) + 1);
  }
  const iso = (t) => new Date(t * 1000).toISOString();
  console.log('count:', res.periods.length, '(diminta 500)');
  console.log('tertua:', iso(asc[0].time), '| terbaru:', iso(asc[asc.length - 1].time));
  console.log('gap (detik:jumlah):', [...gaps.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join(', '));
  console.log('duplikat:', dup, '| non-monotonic:', nonMono);
  console.log('infos keys:', Object.keys(res.infos).join(', '));
  for (const k of ['timezone', 'session', 'type', 'pricescale', 'minmov', 'currency_id']) {
    if (k in res.infos) console.log(`infos.${k}:`, JSON.stringify(res.infos[k]));
  }
}

// B) Quote session (payload mentah)
console.log('\n===== Quote session (10 detik) =====');
const qs = new client.Session.Quote({ fields: 'price' });
const market = new qs.Market(SYMBOL);
let n = 0;
market.onLoaded(() => console.log('[quote] loaded'));
market.onError((...e) => console.log('[quote error]', ...e));
market.onData((d) => {
  n++;
  if (n <= 5) console.log('[quote data]', JSON.stringify(d));
});
await new Promise((r) => setTimeout(r, 10000));
console.log('total event quote data:', n);
market.close();
qs.delete();
client.end();
