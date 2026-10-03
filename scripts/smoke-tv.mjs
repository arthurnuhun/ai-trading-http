import TradingView from '@mathieuc/tradingview';

const SYMBOL = process.env.TV_SYMBOL || 'OANDA:XAUUSD';
const TIMEFRAMES = { H4: '240', H1: '60', M15: '15', M5: '5' };
const RANGE = 50;
const TIMEOUT_MS = 20000;

const client = new TradingView.Client();
client.onConnected(() => console.log('[client] connected'));
client.onDisconnected(() => console.log('[client] disconnected'));
client.onError((...e) => console.error('[client error]', ...e));

function fetchTf(label, tf) {
  return new Promise((resolve) => {
    const chart = new client.Session.Chart();
    let done = false;
    const timer = setTimeout(() => finish({ label, tf, error: 'timeout' }), TIMEOUT_MS);
    function finish(result) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { chart.delete(); } catch {}
      resolve(result);
    }
    chart.onError((...err) => finish({ label, tf, error: err.join(' ') }));
    chart.onUpdate(() => {
      if (!chart.periods.length) return;
      finish({ label, tf, infos: chart.infos, periods: chart.periods.slice() });
    });
    chart.setMarket(SYMBOL, { timeframe: tf, range: RANGE });
  });
}

function report(r) {
  console.log(`\n===== ${r.label} (timeframe=${r.tf}) =====`);
  if (r.error) { console.log('ERROR:', r.error); return; }
  const asc = [...r.periods].reverse(); // library returns newest first
  const newest = r.periods[0];
  let dup = 0, nonMono = 0;
  const gaps = new Set();
  for (let i = 1; i < asc.length; i++) {
    const d = asc[i].time - asc[i - 1].time;
    if (d === 0) dup++;
    else if (d < 0) nonMono++;
    gaps.add(d);
  }
  const iso = (t) => new Date(t * 1000).toISOString();
  console.log('infos:', JSON.stringify(r.infos).slice(0, 500));
  console.log('count:', r.periods.length, '(requested', RANGE + ')');
  console.log('newest raw:', JSON.stringify(newest));
  console.log('oldest raw:', JSON.stringify(r.periods[r.periods.length - 1]));
  console.log('newest time (asumsi detik):', iso(newest.time));
  console.log('umur candle terbaru (menit):', Math.round((Date.now() / 1000 - newest.time) / 60));
  console.log('selisih antar candle (detik, unik):', [...gaps].sort((a, b) => a - b).join(', '));
  console.log('duplikat:', dup, '| non-monotonic:', nonMono);
}

for (const [label, tf] of Object.entries(TIMEFRAMES)) {
  report(await fetchTf(label, tf));
}
console.log('\nSymbol:', SYMBOL);
client.end();
