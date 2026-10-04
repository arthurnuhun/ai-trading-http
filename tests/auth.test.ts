import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import type { Services } from '../src/services.js';

const TOKEN = 'test-token-0123456789abcdef';

let warnCount = 0;
const logger: any = {
  info() {},
  warn() { warnCount += 1; },
  error() {},
  debug() {},
  trace() {},
  fatal() {},
};
logger.child = () => logger;

const services = {
  symbol: 'OANDA:XAUUSD',
  connectionStatus: () => ({
    state: 'connected',
    consecutiveFailures: 0,
    lastError: null,
    lastConnectedAt: null,
    retryInMs: 0,
    activeSessions: 0,
  }),
  getQuote: async () => { throw new Error('unused'); },
  getCandles: async () => { throw new Error('unused'); },
} as unknown as Services;

async function start(env: Record<string, string>) {
  const app = createApp(loadConfig(env as NodeJS.ProcessEnv), logger, services);
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, base };
}

const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
const baseHeaders = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
const callMcp = (base: string, auth?: string) =>
  fetch(`${base}/mcp`, {
    method: 'POST',
    headers: auth ? { ...baseHeaders, Authorization: auth } : baseHeaders,
    body,
  });

describe('MCP bearer token', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    ({ server, base } = await start({ MCP_AUTH_TOKEN: TOKEN }));
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('rejects /mcp without an Authorization header', async () => {
    const res = await callMcp(base);
    expect(res.status).toBe(401);
    const json: any = await res.json();
    expect(json.error.code).toBe(-32001);
  });

  it('rejects a wrong token', async () => {
    const res = await callMcp(base, 'Bearer wrong-token-0123456789abcdef');
    expect(res.status).toBe(401);
  });

  it('rejects a non-Bearer scheme even with the right value', async () => {
    const res = await callMcp(base, `Basic ${TOKEN}`);
    expect(res.status).toBe(401);
  });

  it('accepts the correct token', async () => {
    const res = await callMcp(base, `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('market_quote');
  });

  it('keeps /health and /ready public', async () => {
    expect((await fetch(`${base}/health`)).status).toBe(200);
    expect((await fetch(`${base}/ready`)).status).toBe(200);
  });
});

describe('MCP without a configured token', () => {
  it('stays open and logs a warning', async () => {
    const before = warnCount;
    const { server, base } = await start({});
    try {
      const res = await callMcp(base);
      expect(res.status).toBe(200);
      expect(warnCount).toBe(before + 1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('MCP_AUTH_TOKEN config', () => {
  it('rejects a token shorter than 16 characters', () => {
    expect(() => loadConfig({ MCP_AUTH_TOKEN: 'short' } as NodeJS.ProcessEnv)).toThrow(/MCP_AUTH_TOKEN/);
  });
  it('treats an empty value as not set', () => {
    expect(loadConfig({ MCP_AUTH_TOKEN: '' } as NodeJS.ProcessEnv).mcpAuthToken).toBeUndefined();
  });
});
