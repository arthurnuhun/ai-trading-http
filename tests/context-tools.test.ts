import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { AppError } from '../src/errors.js';
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

let quoteFails = false;
let failH4 = false;

const fake: Services = {
  symbol: 'OANDA:XAUUSD',
  pipSize: 0.1,
  connectionStatus: () => ({ state: 'connected', consecutiveFailures: 0, lastError: null, lastConnectedAt: null, retryInMs: 0, activeSessions: 0 }),
  getQuote: async () => {
    if (quoteFails) throw new AppError('TRADINGVIEW_CONNECTION_ERROR', 'Timed out waiting for TradingView quote', true);
    return {
      symbol: 'OANDA:XAUUSD', source: 'tradingview' as const, price: 123.45, receivedAt: '2026-10-04T01:00:00.000Z',
      priceTimeSource: 'received_at' as const, marketOpen: true, latencyMs: 2, cached: false,
    };
  },
  getCandles: async (tf) => {
    if (failH4 && tf === 'H4') throw new AppError('TRADINGVIEW_CONNECTION_ERROR', 'Unable to retrieve XAUUSD data', true);
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

describe('context tools', () => {
  it('registers trading_context and xauusd_analysis_context', async () => {
    const json = await rpc('tools/list');
    const names = json.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(['trading_context', 'xauusd_analysis_context']));
  });

  it('trading_context is compact and structured, with honest heatmap and macro status', async () => {
    const { isError, body } = await callTool('trading_context');
    expect(isError).toBe(false);
    expect(body).toMatchObject({ ok: true, symbol: 'OANDA:XAUUSD', source: 'tradingview', partial: false });
    expect(body.price).toMatchObject({ value: 123.45, source: 'quote', timestampSource: 'received_at' });
    expect(Object.keys(body.datasets)).toEqual(['H4', 'H1', 'M15', 'M5']);
    const h1 = body.datasets.H1;
    expect(typeof h1.indicators.rsi14).toBe('number');
    expect(typeof h1.indicators.macd.histogram).toBe('number');
    expect(typeof h1.indicators.atr14).toBe('number');
    expect(['bullish', 'bearish', 'mixed']).toContain(h1.emaStack);
    expect(['above', 'below', 'at']).toContain(h1.priceVsEma.ema20);
    expect(typeof h1.structure.trendState).toBe('string');
    expect(Array.isArray(h1.divergences)).toBe(true);
    expect(h1.levels.available).toBe(true);
    expect(h1.levels.supportResistance.length).toBeLessThanOrEqual(4);
    expect(h1.formingCandle).not.toBeNull();
    expect(h1).not.toHaveProperty('candles');
    expect(h1).not.toHaveProperty('parameters');
    expect(body.heatmap).toEqual({ available: false, reason: 'No heatmap provider configured' });
    expect(body.macro.status).toMatchObject({ availableCount: 0, total: 8 });
    expect(body.macro.status.unavailable).toHaveLength(8);
    expect(Object.keys(body.dataFreshness.byTimeframe)).toEqual(['H4', 'H1', 'M15', 'M5']);
    expect(body.dataFreshness.anyStale).toBe(false);
    expect(body.session.timezone).toBe('Asia/Jakarta');
    expect(body.limitations.length).toBeGreaterThan(0);
  });

  it('falls back to the M5 candle close when the quote fails, and says so', async () => {
    quoteFails = true;
    const { isError, body } = await callTool('trading_context', { timeframes: ['H1'] });
    quoteFails = false;
    expect(isError).toBe(false);
    expect(body.price).toMatchObject({ source: 'm5_latest_candle_close', timestampSource: 'candle_open_time', quoteError: 'TRADINGVIEW_CONNECTION_ERROR' });
    expect(body.price.value).toBeCloseTo(closeAt(299), 6);
  });

  it('xauusd_analysis_context returns the full evidence set', async () => {
    const { isError, body } = await callTool('xauusd_analysis_context');
    expect(isError).toBe(false);
    const h4 = body.datasets.H4;
    expect(h4.candles.fields).toEqual(['timestamp', 'open', 'high', 'low', 'close', 'volume']);
    expect(h4.candles).toMatchObject({ volumeType: 'tick', count: 30, includesFormingCandle: true });
    expect(h4.candles.rows).toHaveLength(30);
    expect(h4.levels.available).toBe(true);
    expect(h4.levels.fibonacci).toBeDefined();
    expect(h4.levels.parameters.srToleranceAtr).toBe(0.5);
    expect(Array.isArray(h4.structure.recentEvents)).toBe(true);
    expect(Array.isArray(h4.structure.recentSwings)).toBe(true);
    expect(body.economicCalendar).toEqual({ available: false, reason: 'provider unavailable' });
    expect(body.dataQuality.byTimeframe.H4).toMatchObject({ received: 300, accepted: 300, malformed: 0 });
    expect(body.dataQuality.connection.state).toBe('connected');
    expect(body.parameters.swingLookback).toBe(3);
    expect(body.parameters.indicators.rsiPeriod).toBe(14);
    expect(body.macro.status.total).toBe(8);
  });

  it('candleLimit controls the candle rows and is validated', async () => {
    const five = await callTool('xauusd_analysis_context', { timeframes: ['M5'], candleLimit: 5 });
    expect(five.body.datasets.M5.candles.rows).toHaveLength(5);
    const zero = await callTool('xauusd_analysis_context', { timeframes: ['M5'], candleLimit: 0 });
    expect(zero.body.datasets.M5).not.toHaveProperty('candles');
    for (const bad of [201, 1.5, -1]) {
      const r = await callTool('xauusd_analysis_context', { candleLimit: bad });
      expect(r.isError).toBe(true);
      expect(r.body.error.code).toBe('INVALID_INPUT');
    }
  });

  it('uses injected providers and never leaks a provider error message', async () => {
    fake.heatmap = {
      getHeatmap: async () => ({ available: true, source: 'test', fetchedAt: '2026-10-04T00:00:00.000Z', data: { zones: 2 } }),
    };
    fake.macro = {
      getMacro: async () => {
        throw new Error('secret boom');
      },
    };
    const { body } = await callTool('xauusd_analysis_context', { timeframes: ['H1'] });
    fake.heatmap = undefined;
    fake.macro = undefined;
    expect(body.heatmap).toMatchObject({ available: true, source: 'test' });
    expect(body.macro.items.dxy).toEqual({ available: false, reason: 'provider error' });
    expect(body.macro.status.availableCount).toBe(0);
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('rejects invalid timeframes and foreign symbols with structured errors', async () => {
    for (const tool of ['trading_context', 'xauusd_analysis_context']) {
      const a = await callTool(tool, { timeframes: ['D1'] });
      expect(a.isError).toBe(true);
      expect(a.body.error.code).toBe('INVALID_TIMEFRAME');
      const b = await callTool(tool, { symbol: 'FX:XAUUSD' });
      expect(b.body.error.code).toBe('INVALID_SYMBOL');
    }
  });

  it('reports a partial failure per timeframe', async () => {
    failH4 = true;
    const { isError, body } = await callTool('trading_context');
    failH4 = false;
    expect(isError).toBe(false);
    expect(body.partial).toBe(true);
    expect(Object.keys(body.datasets)).toEqual(['H1', 'M15', 'M5']);
    expect(body.errors.H4.code).toBe('TRADINGVIEW_CONNECTION_ERROR');
    expect(Object.keys(body.dataFreshness.byTimeframe)).toEqual(['H1', 'M15', 'M5']);
  });
});
