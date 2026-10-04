import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import type { Services } from '../src/services.js';

const SECRET = 'query-secret-0123456789abcdefghij-XYZ_1';
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
const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
const post = (url: string) => fetch(url, { method: 'POST', headers, body });
const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));

describe('MCP query token with MCP_PATH_SECRET', () => {
  let server: Server;
  let base: string;
  beforeAll(async () => {
    ({ server, base } = await start({ MCP_PATH_SECRET: SECRET }));
  });
  afterAll(() => close(server));

  it('accepts the correct ?token= on bare /mcp', async () => {
    const res = await post(`${base}/mcp?token=${SECRET}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('market_quote');
  });

  it('rejects a wrong ?token=', async () => {
    expect((await post(`${base}/mcp?token=${'x'.repeat(40)}`)).status).toBe(401);
  });

  it('rejects an empty ?token=', async () => {
    expect((await post(`${base}/mcp?token=`)).status).toBe(401);
  });

  it('never writes the token to the logs', async () => {
    const wrong = 'attempt-' + 'z'.repeat(40);
    await post(`${base}/mcp?token=${wrong}`);
    await post(`${base}/mcp?token=${SECRET}`);
    const logged = JSON.stringify(warns);
    expect(logged).toContain('query_token_mismatch');
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain(wrong);
  });
});

describe('MCP query token without MCP_PATH_SECRET', () => {
  let server: Server;
  let base: string;
  beforeAll(async () => {
    ({ server, base } = await start({ MCP_AUTH_TOKEN: TOKEN }));
  });
  afterAll(() => close(server));

  it('does not accept the bearer value as ?token=', async () => {
    expect((await post(`${base}/mcp?token=${TOKEN}`)).status).toBe(401);
  });
});
