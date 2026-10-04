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

// Oscillating series whose last candle is still forming for every timeframe.
function sine(n: number, lastTs: number): Candle[] {
  const out: Candle[] = [];
  let prev = 100;
  for (let i = 0; i < n; i++) {
    const close = closeAt(i);
    const ts = lastTs - (n - 1 - i) * STEP;
    out.push({
      timestamp: ts,
      isoTime: new Date(ts).toISOString(),
      open: prev,
      high: Math.max(prev, close) + 0.5,
      low: Math.min(prev, close) - 0.5,
      close,
      volume: 1,
    });
    prev = close;
  }
  return out;
}

const fake: Services = {
  symbol: 'OANDA:XAUUSD',
  connectionStatus: () => ({ state: 'connected', consecutiveFailures: 0, lastError: null, lastConnectedAt: null, retryInMs: 0, activeSessions: 0 }),
  getQuote: async () => {
    throw new Error('unused');
  },
  getCandles: async (tf) => {
    const candles = sine(300, Date.now() - 60_000);
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

describe('level tools', () => {
  it('registers key_levels and fibonacci', async () => {
    const json = await rpc('tools/list');
    const names = json.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(['key_levels', 'fibonacci']));
  });

  it('key_levels returns numeric levels per timeframe, priced from the forming candle', async () => {
    const { isError, body } = await callTool('key_levels');
    expect(isError).toBe(false);
    expect(Object.keys(body.datasets)).toEqual(['H4', 'H1', 'M15', 'M5']);
    const h1 = body.datasets.H1;
    expect(h1).toMatchObject({ basis: 'closed_candles', priceSource: 'forming_candle_close' });
    expect(h1.price).toBeCloseTo(closeAt(299), 6);
    expect(h1.levels.available).toBe(true);
    expect(h1.levels.psychological).toHaveLength(4);
    for (const p of h1.levels.psychological) expect(p.price % 50).toBe(0);
    expect(h1.levels.parameters.srToleranceAtr).toBe(0.5);
    for (const l of h1.levels.supportResistance) {
      expect(typeof l.price).toBe('number');
      expect(typeof l.priceInZone).toBe('boolean');
    }
    expect(h1.levels.fibonacci.confirmed).not.toBeNull();
  });

  it('key_levels rejects an invalid timeframe with a structured error', async () => {
    const { isError, body } = await callTool('key_levels', { timeframes: ['D1'] });
    expect(isError).toBe(true);
    expect(body.error.code).toBe('INVALID_TIMEFRAME');
  });

  it('fibonacci reports the swings used and both bases', async () => {
    const { isError, body } = await callTool('fibonacci', { timeframes: ['M5'], swingLookback: 3 });
    expect(isError).toBe(false);
    const f = body.datasets.M5.fibonacci;
    expect(f.confirmed.retracements.map((x: { label: string }) => x.label)).toEqual(['38.2%', '50%', '61.8%', '78.6%']);
    expect(f.confirmed.extensions.map((x: { label: string }) => x.label)).toEqual(['127.2%', '161.8%']);
    expect(f.confirmed.swingHigh.price).toBeGreaterThan(f.confirmed.swingLow.price);
    expect(f).toHaveProperty('provisional');
    expect(Object.keys(body.datasets)).toEqual(['M5']);
  });
});
