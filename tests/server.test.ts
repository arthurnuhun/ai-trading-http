import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { AppError } from '../src/errors.js';
import type { Services } from '../src/services.js';

const candle = {
  timestamp: 1790974500000,
  isoTime: '2026-10-02T20:55:00.000Z',
  open: 4139.495,
  high: 4140.945,
  low: 4138.78,
  close: 4140.52,
  volume: 822,
};
const candleResult = (tf: string) => ({
  symbol: 'OANDA:XAUUSD',
  source: 'tradingview' as const,
  timeframe: tf,
  candles: [candle],
  latestCandle: candle,
  fetchedAt: '2026-10-03T11:52:14.000Z',
  latestCandleTime: candle.isoTime,
  stale: false,
  staleReason: null,
  note: 'market_closed',
  marketOpen: false,
  ageSeconds: 100,
  latencyMs: 5,
  cached: false,
  quality: { received: 1, accepted: 1, malformed: 0, duplicates: 0, future: 0, nonMonotonic: 0 },
});

let connected = true;
let failH4 = false;
let failAll = false;
const connStatus = () => ({
  state: connected ? ('connected' as const) : ('disconnected' as const),
  consecutiveFailures: 0,
  lastError: null,
  lastConnectedAt: null,
  retryInMs: 0,
  activeSessions: 0,
});
const fake: Services = {
  symbol: 'OANDA:XAUUSD',
  connectionStatus: connStatus,
  getQuote: async () => ({
    symbol: 'OANDA:XAUUSD',
    source: 'tradingview',
    price: 4140.52,
    receivedAt: '2026-10-03T11:52:14.470Z',
    priceTimeSource: 'received_at',
    marketOpen: false,
    latencyMs: 3,
    cached: false,
  }),
  getCandles: async (tf) => {
    if (failAll) throw new AppError('TRADINGVIEW_CONNECTION_ERROR', 'Unable to retrieve XAUUSD data', true);
    if (failH4 && tf === 'H4') throw new AppError('TRADINGVIEW_CONNECTION_ERROR', 'Unable to retrieve XAUUSD data', true);
    return candleResult(tf);
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
  const r = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const text = await r.text();
  const dataLine = text.split('\n').find((l) => l.startsWith('data: '));
  return { status: r.status, json: dataLine ? JSON.parse(dataLine.slice(6)) : JSON.parse(text) };
}

async function callTool(name: string, args: object = {}) {
  const { json } = await rpc('tools/call', { name, arguments: args });
  return { isError: json.result.isError === true, body: JSON.parse(json.result.content[0].text) };
}

describe('http endpoints', () => {
  it('GET /health is 200 and reports ok when connected', async () => {
    connected = true;
    const r = await fetch(`${base}/health`);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ status: 'ok', service: 'ai-trading-http', symbol: 'OANDA:XAUUSD', source: 'tradingview' });
  });

  it('GET /health stays 200 but reports degraded when disconnected; /ready is 503', async () => {
    connected = false;
    const h = await fetch(`${base}/health`);
    expect(h.status).toBe(200);
    expect((await h.json()).status).toBe('degraded');
    expect((await fetch(`${base}/ready`)).status).toBe(503);
    connected = true;
    expect((await fetch(`${base}/ready`)).status).toBe(200);
  });

  it('POST /mcp with malformed JSON returns a structured parse error', async () => {
    const r = await fetch(`${base}/mcp`, { method: 'POST', headers, body: '{bad json' });
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe(-32700);
  });

  it('GET /mcp is not allowed', async () => {
    expect((await fetch(`${base}/mcp`)).status).toBe(405);
  });
});

describe('mcp tools', () => {
  it('lists the registered tools', async () => {
    const { json } = await rpc('tools/list');
    const names = json.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(['ping', 'market_quote', 'ohlc', 'multi_timeframe_ohlc']));
  });

  it('market_quote returns price without inventing bid/ask', async () => {
    const { isError, body } = await callTool('market_quote');
    expect(isError).toBe(false);
    expect(body).toMatchObject({ ok: true, symbol: 'OANDA:XAUUSD', price: 4140.52, source: 'tradingview', stale: false });
    expect(body).not.toHaveProperty('bid');
    expect(body).not.toHaveProperty('ask');
  });

  it('ohlc returns compact rows with quality metadata', async () => {
    const { body } = await callTool('ohlc', { timeframe: 'm5', limit: 1 });
    expect(body).toMatchObject({ ok: true, timeframe: 'M5', count: 1, volumeType: 'tick' });
    expect(body.fields).toEqual(['timestamp', 'open', 'high', 'low', 'close', 'volume']);
    expect(body.candles[0]).toEqual([1790974500000, 4139.495, 4140.945, 4138.78, 4140.52, 822]);
    expect(body).toHaveProperty('fetchedAt');
    expect(body).toHaveProperty('latestCandleTime');
    expect(body).toHaveProperty('latencyMs');
  });

  it('ohlc rejects an invalid timeframe with a structured error', async () => {
    const { isError, body } = await callTool('ohlc', { timeframe: 'D1' });
    expect(isError).toBe(true);
    expect(body).toEqual({ ok: false, error: { code: 'INVALID_TIMEFRAME', message: expect.any(String), retryable: false } });
  });

  it('rejects a symbol that differs from the configured feed', async () => {
    const { isError, body } = await callTool('ohlc', { symbol: 'FX:XAUUSD', timeframe: 'H1' });
    expect(isError).toBe(true);
    expect(body.error.code).toBe('INVALID_SYMBOL');
  });

  it('multi_timeframe_ohlc returns all four timeframes by default', async () => {
    const { body } = await callTool('multi_timeframe_ohlc');
    expect(body.ok).toBe(true);
    expect(body.partial).toBe(false);
    expect(Object.keys(body.datasets)).toEqual(['H4', 'H1', 'M15', 'M5']);
  });

  it('multi_timeframe_ohlc reports a partial failure per timeframe', async () => {
    failH4 = true;
    const { isError, body } = await callTool('multi_timeframe_ohlc');
    failH4 = false;
    expect(isError).toBe(false);
    expect(body.partial).toBe(true);
    expect(Object.keys(body.datasets)).toEqual(['H1', 'M15', 'M5']);
    expect(body.errors.H4.code).toBe('TRADINGVIEW_CONNECTION_ERROR');
  });

  it('multi_timeframe_ohlc fails with a structured error when everything fails', async () => {
    failAll = true;
    const { isError, body } = await callTool('multi_timeframe_ohlc');
    failAll = false;
    expect(isError).toBe(true);
    expect(body).toEqual({
      ok: false,
      error: { code: 'TRADINGVIEW_CONNECTION_ERROR', message: 'Unable to retrieve XAUUSD data', retryable: true },
    });
  });
});
