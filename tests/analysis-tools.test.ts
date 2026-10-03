import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import type { Services } from '../src/services.js';
import type { Candle } from '../src/types.js';

const STEP = 300_000;
// Strictly rising ramp: RSI 100, no swings, the last candle is still forming.
function ramp(n: number, lastTs: number): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const close = 100 + i;
    const ts = lastTs - (n - 1 - i) * STEP;
    return { timestamp: ts, isoTime: new Date(ts).toISOString(), open: close - 0.5, high: close + 0.5, low: close - 1, close, volume: 1 };
  });
}

const fake: Services = {
  symbol: 'OANDA:XAUUSD',
  connectionStatus: () => ({ state: 'connected', consecutiveFailures: 0, lastError: null, lastConnectedAt: null, retryInMs: 0, activeSessions: 0 }),
  getQuote: async () => {
    throw new Error('unused');
  },
  getCandles: async (tf) => {
    const candles = ramp(300, Date.now() - 60_000);
    const latest = candles[candles.length - 1];
    return {
      symbol: 'OANDA:XAUUSD',
      source: 'tradingview' as const,
      timeframe: tf,
      candles,
      latestCandle: latest,
      fetchedAt: new Date().toISOString(),
      latestCandleTime: latest.isoTime,
      stale: false,
      staleReason: null,
      note: null,
      marketOpen: true,
      ageSeconds: 60,
      latencyMs: 1,
      cached: false,
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

describe('analysis tools', () => {
  it('registers technical_indicators, market_structure and session_context', async () => {
    const json = await rpc('tools/list');
    const names = json.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(['technical_indicators', 'market_structure', 'session_context']));
  });

  it('technical_indicators uses closed candles only and reports the forming candle separately', async () => {
    const { isError, body } = await callTool('technical_indicators');
    expect(isError).toBe(false);
    expect(Object.keys(body.datasets)).toEqual(['H4', 'H1', 'M15', 'M5']);
    const h4 = body.datasets.H4;
    expect(h4).toMatchObject({ basis: 'closed_candles', closedCandles: 299, lastClose: 398 });
    expect(h4.formingCandle.close).toBe(399);
    expect(h4.indicators.rsi14).toBe(100);
    const e = h4.indicators.ema;
    expect(e.ema20).toBeGreaterThan(e.ema50);
    expect(e.ema50).toBeGreaterThan(e.ema100);
    expect(e.ema100).toBeGreaterThan(e.ema200);
    expect(typeof h4.indicators.macd.histogram).toBe('number');
    expect(typeof h4.indicators.atr14).toBe('number');
    expect(body).toMatchObject({ symbol: 'OANDA:XAUUSD', source: 'tradingview', partial: false });
  });

  it('technical_indicators rejects an invalid timeframe and a foreign symbol', async () => {
    const a = await callTool('technical_indicators', { timeframes: ['D1'] });
    expect(a.isError).toBe(true);
    expect(a.body.error.code).toBe('INVALID_TIMEFRAME');
    const b = await callTool('technical_indicators', { symbol: 'FX:XAUUSD' });
    expect(b.body.error.code).toBe('INVALID_SYMBOL');
  });

  it('market_structure reports undetermined structure and no provisional swing on a pure ramp', async () => {
    const { isError, body } = await callTool('market_structure', { timeframes: ['H1'] });
    expect(isError).toBe(false);
    const h1 = body.datasets.H1;
    expect(h1).toMatchObject({ swingLookback: 3, trendState: 'undetermined', recentEvents: [], lastEvent: null });
    expect(h1.provisional.high).toBeNull();
    expect(Object.keys(body.datasets)).toEqual(['H1']);
  });

  it('market_structure honors swingLookback and validates it', async () => {
    const ok5 = await callTool('market_structure', { timeframes: ['M5'], swingLookback: 5 });
    expect(ok5.body.datasets.M5.swingLookback).toBe(5);
    const bad = await callTool('market_structure', { swingLookback: 0 });
    expect(bad.isError).toBe(true);
    expect(bad.body.error.code).toBe('INVALID_INPUT');
  });

  it('session_context reports Asia/Jakarta, session, kill zone and market status', async () => {
    const { isError, body } = await callTool('session_context');
    expect(isError).toBe(false);
    expect(body.timezone).toBe('Asia/Jakarta');
    expect(['Australia', 'Asia', 'London', 'New York', 'off_hours']).toContain(body.session);
    expect(typeof body.killZone).toBe('boolean');
    expect(typeof body.marketOpen).toBe('boolean');
  });
});
