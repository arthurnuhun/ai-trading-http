import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import type { Services } from '../src/services.js';
import type { Candle } from '../src/types.js';

const STEP = 300_000;
const closeAt = (i: number): number => 100 + 10 * Math.sin((2 * Math.PI * i) / 20);

function sine(n: number, lastTs: number): Candle[] {
  const out: Candle[] = [];
  let prev = 100;
  for (let i = 0; i < n; i++) {
    const close = closeAt(i);
    const ts = lastTs - (n - 1 - i) * STEP;
    out.push({
      timestamp: ts, isoTime: new Date(ts).toISOString(), open: prev,
      high: Math.max(prev, close) + 0.5, low: Math.min(prev, close) - 0.5, close, volume: 1,
    });
    prev = close;
  }
  return out;
}

const fake: Services = {
  symbol: 'OANDA:XAUUSD',
  pipSize: 0.1,
  connectionStatus: () => ({ state: 'connected', consecutiveFailures: 0, lastError: null, lastConnectedAt: null, retryInMs: 0, activeSessions: 0 }),
  getQuote: async () => {
    throw new Error('unused');
  },
  getCandles: async (tf) => {
    const candles = sine(300, Date.now() - 60_000);
    const latest = candles[candles.length - 1];
    return {
      symbol: 'OANDA:XAUUSD', source: 'tradingview' as const, timeframe: tf, candles, latestCandle: latest,
      fetchedAt: new Date().toISOString(), latestCandleTime: latest.isoTime, stale: false, staleReason: null,
      note: null, marketOpen: true, ageSeconds: 60, latencyMs: 1, cached: false,
      quality: { received: 300, accepted: 300, malformed: 0, duplicates: 0, future: 0, nonMonotonic: 0 },
    };
  },
};

let server: Server;
let base: string;
beforeAll(async () => {
  const app = createApp(loadConfig({}), createLogger('silent'), fake);
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
async function rpc(method: string, params: object = {}) {
  const r = await fetch(`${base}/mcp`, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const text = await r.text();
  const line = text.split('\n').find((l) => l.startsWith('data: '));
  return line ? JSON.parse(line.slice(6)) : JSON.parse(text);
}
async function callTool(name: string, args: object = {}) {
  const json = await rpc('tools/call', { name, arguments: args });
  return { isError: json.result.isError === true, body: JSON.parse(json.result.content[0].text) };
}

const plan = { direction: 'buy', style: 'scalp', entry: 4100, stopLoss: 4090, takeProfits: [4115, 4130, 4150] };

describe('decision tools', () => {
  it('registers confluence_check and risk_plan', async () => {
    const json = await rpc('tools/list');
    const names = json.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(['confluence_check', 'risk_plan']));
  });

  it('confluence_check never counts unavailable heatmap/macro and applies the skill thresholds', async () => {
    const { isError, body } = await callTool('confluence_check', { direction: 'buy', style: 'intraday' });
    expect(isError).toBe(false);
    expect(body).toMatchObject({ ok: true, outOf: 6, direction: 'buy', style: 'intraday', symbol: 'OANDA:XAUUSD' });
    expect(Object.keys(body.factors)).toEqual(['h4h1_bias', 'sr_fvg_location', 'heatmap', 'momentum', 'session', 'macro_bias']);
    expect(body.factors.heatmap).toEqual({ status: 'unavailable', reason: 'No heatmap provider configured' });
    expect(body.factors.macro_bias.status).toBe('unavailable');
    expect(body.unavailable).toEqual(expect.arrayContaining(['heatmap', 'macro_bias']));
    expect(body.score).toBeLessThanOrEqual(4);
    expect(body.verdict).not.toBe('FULL_CONFLUENCE');
    expect(body.thresholds).toEqual({ valid: 4, full: 5, skipAtOrBelow: 3 });
    expect(typeof body.counterTrend).toBe('boolean');
    expect(body.warnings.join(' ')).toMatch(/calendar/i);
    expect(body.warnings.join(' ')).toMatch(/spread/i);
  });

  it('confluence_check accepts a documented caller-supplied heatmap verdict', async () => {
    const { body } = await callTool('confluence_check', {
      direction: 'sell', style: 'scalp', heatmap: { status: 'pass', reason: 'yellow zone below price' },
    });
    expect(body.factors.heatmap).toEqual({ status: 'pass', reason: 'caller_supplied: yellow zone below price' });
    expect(body.unavailable).not.toContain('heatmap');
  });

  it('confluence_check validates direction, style and supplied verdicts', async () => {
    for (const args of [
      { direction: 'long', style: 'scalp' },
      { direction: 'buy', style: 'toString' },
      { direction: 'buy', style: 'scalp', heatmap: { status: 'maybe', reason: 'x' } },
    ]) {
      const r = await callTool('confluence_check', args);
      expect(r.isError).toBe(true);
      expect(r.body.error.code).toBe('INVALID_INPUT');
    }
  });

  it('risk_plan uses the configured pip size and sizes the position', async () => {
    const { isError, body } = await callTool('risk_plan', { ...plan, accountBalance: 10000, riskPercent: 1, contractSize: 100 });
    expect(isError).toBe(false);
    expect(body).toMatchObject({ ok: true, analyticalOnly: true, pipSize: 0.1, pipSizeSource: 'config' });
    expect(body.stopDistance).toEqual({ price: 10, pips: 100 });
    expect(body.takeProfits.map((t: { rr: number }) => t.rr)).toEqual([1.5, 3, 5]);
    expect(body.positionSizing).toMatchObject({ available: true, riskAmount: 100, lots: 0.1 });
  });

  it('risk_plan prefers a pipSize given in the input', async () => {
    const { body } = await callTool('risk_plan', { ...plan, pipSize: 1 });
    expect(body.pipSizeSource).toBe('input');
    expect(body.stopDistance.pips).toBe(10);
    expect(body.takeProfits.map((t: { pips: number }) => t.pips)).toEqual([15, 30, 50]);
  });

  it('risk_plan refuses to run without any pip size', async () => {
    const saved = fake.pipSize;
    fake.pipSize = undefined;
    const r = await callTool('risk_plan', plan);
    fake.pipSize = saved;
    expect(r.isError).toBe(true);
    expect(r.body.error.code).toBe('INVALID_INPUT');
    expect(r.body.error.message).toMatch(/PIP_SIZE/);
  });

  it('risk_plan rejects risk above 2% and an invalid style', async () => {
    const a = await callTool('risk_plan', { ...plan, accountBalance: 10000, riskPercent: 3, contractSize: 100 });
    expect(a.body.error).toMatchObject({ code: 'INVALID_INPUT' });
    expect(a.body.error.message).toMatch(/riskPercent/);
    const b = await callTool('risk_plan', { ...plan, style: 'swingy' });
    expect(b.body.error.code).toBe('INVALID_INPUT');
  });
});
