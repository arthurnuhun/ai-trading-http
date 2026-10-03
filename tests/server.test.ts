import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';

let server: Server;
let base: string;

beforeAll(async () => {
  const config = loadConfig({});
  const app = createApp(config, createLogger('silent'));
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };

describe('http server', () => {
  it('GET /health returns 200 with service info', async () => {
    const r = await fetch(`${base}/health`);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toMatchObject({ status: 'ok', service: 'ai-trading-http', symbol: 'OANDA:XAUUSD', source: 'tradingview' });
  });

  it('POST /mcp initialize answers with server info', async () => {
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
    };
    const r = await fetch(`${base}/mcp`, { method: 'POST', headers, body: JSON.stringify(body) });
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('ai-trading-http');
  });

  it('POST /mcp with malformed JSON returns a structured parse error', async () => {
    const r = await fetch(`${base}/mcp`, { method: 'POST', headers, body: '{bad json' });
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe(-32700);
  });

  it('GET /mcp is not allowed', async () => {
    const r = await fetch(`${base}/mcp`);
    expect(r.status).toBe(405);
  });
});
