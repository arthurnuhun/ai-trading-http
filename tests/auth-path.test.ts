import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import type { Services } from '../src/services.js';

const SECRET = 'path-secret-0123456789abcdefghij-XYZ_1';
const TOKEN = 'test-token-0123456789abcdef';

const warns: unknown[][] = [];
const logger: any = {
  info() {},
  warn(...args: unknown[]) { warns.push(args); },
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
const post = (url: string, auth?: string) =>
  fetch(url, {
    method: 'POST',
    headers: auth ? { ...baseHeaders, Authorization: auth } : baseHeaders,
    body,
  });
const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));

describe('MCP path secret only', () => {
  let server: Server;
  let base: string;
  beforeAll(async () => {
    ({ server, base } = await start({ MCP_PATH_SECRET: SECRET }));
  });
  afterAll(() => close(server));

  it('accepts the correct secret path', async () => {
    const res = await post(`${base}/mcp/${SECRET}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('market_quote');
  });

  it('rejects a wrong secret path', async () => {
    const res = await post(`${base}/mcp/${'x'.repeat(40)}`);
    expect(res.status).toBe(401);
  });

  it('rejects bare /mcp when no bearer token is configured', async () => {
    const res = await post(`${base}/mcp`);
    expect(res.status).toBe(401);
  });

  it('keeps /health public', async () => {
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });

  it('never writes the secret or the attempted segment to the logs', async () => {
    const wrong = 'attempt-' + 'y'.repeat(40);
    await post(`${base}/mcp/${wrong}`);
    await post(`${base}/mcp/${SECRET}`);
    const logged = JSON.stringify(warns);
    expect(logged).toContain('path_secret_mismatch');
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain(wrong);
  });
});

describe('MCP path secret and bearer together', () => {
  let server: Server;
  let base: string;
  beforeAll(async () => {
    ({ server, base } = await start({ MCP_PATH_SECRET: SECRET, MCP_AUTH_TOKEN: TOKEN }));
  });
  afterAll(() => close(server));

  it('accepts the bearer on bare /mcp', async () => {
    expect((await post(`${base}/mcp`, `Bearer ${TOKEN}`)).status).toBe(200);
  });

  it('accepts the secret path without any header', async () => {
    expect((await post(`${base}/mcp/${SECRET}`)).status).toBe(200);
  });
});

describe('MCP bearer only', () => {
  let server: Server;
  let base: string;
  beforeAll(async () => {
    ({ server, base } = await start({ MCP_AUTH_TOKEN: TOKEN }));
  });
  afterAll(() => close(server));

  it('returns 404 for a secret-style path', async () => {
    expect((await post(`${base}/mcp/${SECRET}`)).status).toBe(404);
  });
});

describe('MCP_PATH_SECRET config', () => {
  it('rejects a secret shorter than 32 characters', () => {
    expect(() => loadConfig({ MCP_PATH_SECRET: 'too-short-secret' } as NodeJS.ProcessEnv)).toThrow(/MCP_PATH_SECRET/);
  });
  it('rejects characters outside letters, digits, - and _', () => {
    expect(() =>
      loadConfig({ MCP_PATH_SECRET: 'abc/def' + 'x'.repeat(30) } as NodeJS.ProcessEnv),
    ).toThrow(/MCP_PATH_SECRET/);
  });
  it('treats an empty value as not set', () => {
    expect(loadConfig({ MCP_PATH_SECRET: '' } as NodeJS.ProcessEnv).mcpPathSecret).toBeUndefined();
  });
});
