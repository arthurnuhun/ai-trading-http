import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createLogger } from '../src/logger.js';
import { AppError } from '../src/errors.js';
import { TIMEFRAMES } from '../src/timeframes.js';
import { ConnectionManager, type ConnectionOptions } from '../src/providers/tradingview/connection.js';
import { TradingViewAdapter } from '../src/providers/tradingview/adapter.js';

const SYMBOL = 'OANDA:XAUUSD';
const FAKE_NOW = new Date('2026-10-03T12:00:00Z'); // Saturday: the market is closed
// Real last M5 candle time from the market-closed snapshot (seconds)
const FRIDAY_LAST = Date.UTC(2026, 9, 2, 20, 55) / 1000;

type Period = { time: number; open: number; close: number; max: number; min: number; volume: number };

// Newest first, like @mathieuc/tradingview
function periods(n: number, lastTime = FRIDAY_LAST, step = 300): Period[] {
  return Array.from({ length: n }, (_, i) => {
    const base = 4140 + (n - 1 - i) * 0.1;
    return { time: lastTime - i * step, open: base, close: base + 0.2, max: base + 0.5, min: base - 0.3, volume: 100 + i };
  });
}

type Connect = 'ok' | 'never' | 'fail';
type ChartCtx = {
  symbol: string;
  opts: { timeframe: string; range: number };
  client: FakeClient;
  emitPeriods(p: Period[]): void;
  emitError(...a: unknown[]): void;
};
type QuoteCtx = { client: FakeClient; emitData(d: unknown): void; emitError(...a: unknown[]): void };

class World {
  clients: FakeClient[] = [];
  charts = 0;
  activeCharts = 0;
  maxActiveCharts = 0;
  deletedCharts = 0;
  connectPlan: Connect[] = ['ok'];
  chartScript: (c: ChartCtx) => void = (c) => c.emitPeriods(periods(c.opts.range));
  quoteScript: (c: QuoteCtx) => void = (c) => c.emitData({ lp: 4140.52 });
  nextPlan(): Connect {
    return this.connectPlan.length > 1 ? (this.connectPlan.shift() as Connect) : this.connectPlan[0];
  }
}

class FakeMarket {
  private dataCbs: Array<(d: unknown) => void> = [];
  private errorCbs: Array<(...a: unknown[]) => void> = [];
  constructor(client: FakeClient, world: World) {
    setTimeout(() => {
      world.quoteScript({
        client,
        emitData: (d) => this.dataCbs.forEach((cb) => cb(d)),
        emitError: (...a) => this.errorCbs.forEach((cb) => cb(...a)),
      });
    }, 0);
  }
  onData(cb: (d: unknown) => void) { this.dataCbs.push(cb); }
  onError(cb: (...a: unknown[]) => void) { this.errorCbs.push(cb); }
  onLoaded(_cb: () => void) { /* not simulated */ }
  close() { /* nothing to release */ }
}

class FakeQuote {
  Market: new (symbol: string) => FakeMarket;
  constructor(client: FakeClient, world: World) {
    this.Market = class extends FakeMarket {
      constructor(_symbol: string) {
        super(client, world);
      }
    };
  }
  delete() { /* nothing to release */ }
}

class FakeChart {
  periods: Period[] = [];
  private updateCbs: Array<() => void> = [];
  private errorCbs: Array<(...a: unknown[]) => void> = [];
  private deleted = false;
  constructor(private readonly client: FakeClient, private readonly world: World) {
    world.charts++;
    world.activeCharts++;
    world.maxActiveCharts = Math.max(world.maxActiveCharts, world.activeCharts);
  }
  onUpdate(cb: () => void) { this.updateCbs.push(cb); }
  onError(cb: (...a: unknown[]) => void) { this.errorCbs.push(cb); }
  setMarket(symbol: string, opts: { timeframe: string; range: number }) {
    this.world.chartScript({
      symbol,
      opts,
      client: this.client,
      emitPeriods: (p) => {
        this.periods = p;
        this.updateCbs.forEach((cb) => cb());
      },
      emitError: (...a) => this.errorCbs.forEach((cb) => cb(...a)),
    });
  }
  delete() {
    if (this.deleted) return;
    this.deleted = true;
    this.world.activeCharts--;
    this.world.deletedCharts++;
  }
}

class FakeClient {
  isOpen = false;
  ended = false;
  Session: { Chart: new () => FakeChart; Quote: new (o: unknown) => FakeQuote };
  private connectedCbs: Array<() => void> = [];
  private disconnectedCbs: Array<() => void> = [];
  constructor(plan: Connect, world: World) {
    const self = this;
    this.Session = {
      Chart: class extends FakeChart {
        constructor() {
          super(self, world);
        }
      },
      Quote: class extends FakeQuote {
        constructor(_options: unknown) {
          super(self, world);
        }
      },
    };
    setTimeout(() => {
      if (plan === 'ok') {
        this.isOpen = true;
        this.connectedCbs.forEach((cb) => cb());
      } else if (plan === 'fail') {
        this.disconnectedCbs.forEach((cb) => cb());
      }
    }, 0);
  }
  onConnected(cb: () => void) { this.connectedCbs.push(cb); }
  onDisconnected(cb: () => void) { this.disconnectedCbs.push(cb); }
  onError(_cb: (...a: unknown[]) => void) { /* client-level errors are not simulated */ }
  simulateDrop() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.disconnectedCbs.forEach((cb) => cb());
  }
  end() {
    this.ended = true;
    this.simulateDrop();
  }
}

const created: ConnectionManager[] = [];

function setup(o: { ttl?: number; timeoutMs?: number; conn?: ConnectionOptions } = {}) {
  const world = new World();
  const logger = createLogger('silent');
  const manager = new ConnectionManager(
    logger,
    { connectTimeoutMs: 200, backoffBaseMs: 20, backoffMaxMs: 20, ...(o.conn ?? {}) },
    () => {
      const client = new FakeClient(world.nextPlan(), world);
      world.clients.push(client);
      return client;
    },
  );
  created.push(manager);
  const ttl = o.ttl ?? 60_000;
  const adapter = new TradingViewAdapter(
    manager,
    { symbol: SYMBOL, ttlMs: { quote: ttl, M5: ttl, M15: ttl, H1: ttl, H4: ttl } },
    logger,
    o.timeoutMs ?? 300,
  );
  return { world, manager, adapter };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function waitFor(cond: () => boolean, tries = 200): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (cond()) return;
    await sleep(5);
  }
  throw new Error('condition not met in time');
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FAKE_NOW);
});
afterEach(async () => {
  for (const m of created.splice(0)) await m.shutdown();
  vi.useRealTimers();
});

describe('adapter candles against a scripted TradingView client', () => {
  it('returns normalized ascending candles with quality and freshness metadata', async () => {
    const { adapter, world } = setup();
    const r = await adapter.getCandles('M5', 50);
    expect(r).toMatchObject({ symbol: SYMBOL, source: 'tradingview', timeframe: 'M5', cached: false });
    expect(r.candles).toHaveLength(50);
    expect(r.candles[0].timestamp).toBeLessThan(r.candles[49].timestamp);
    expect(r.latestCandle?.isoTime).toBe('2026-10-02T20:55:00.000Z');
    expect(r.latestCandleTime).toBe('2026-10-02T20:55:00.000Z');
    expect(r).toMatchObject({ stale: false, staleReason: null, note: 'market_closed', marketOpen: false, ageSeconds: 54300 });
    expect(r.quality).toMatchObject({ received: 50, accepted: 50, malformed: 0, duplicates: 0, future: 0 });
    expect(world.clients).toHaveLength(1);
    expect(world.deletedCharts).toBe(1);
    expect(world.activeCharts).toBe(0);
  });

  it('serves the second identical request from cache', async () => {
    const { adapter, world } = setup();
    await adapter.getCandles('M5', 50);
    const again = await adapter.getCandles('M5', 50);
    expect(again).toMatchObject({ cached: true, latencyMs: 0 });
    expect(world.charts).toBe(1);
  });

  it('shares one fetch between identical concurrent requests', async () => {
    const { adapter, world } = setup();
    const results = await Promise.all(Array.from({ length: 5 }, () => adapter.getCandles('H1', 50)));
    expect(world.charts).toBe(1);
    expect(new Set(results.map((r) => r.fetchedAt)).size).toBe(1);
  });

  it('serves the four timeframes over a single connection', async () => {
    const { adapter, world } = setup();
    const all = await Promise.all(TIMEFRAMES.map((tf) => adapter.getCandles(tf, 50)));
    expect(all.map((r) => r.timeframe)).toEqual(['H4', 'H1', 'M15', 'M5']);
    expect(world.clients).toHaveLength(1);
    expect(world.charts).toBe(4);
  });

  it('returns only the newest candles up to the limit', async () => {
    const { adapter, world } = setup();
    world.chartScript = (c) => c.emitPeriods(periods(50));
    const r = await adapter.getCandles('M5', 10);
    expect(r.candles).toHaveLength(10);
    expect(r.latestCandleTime).toBe('2026-10-02T20:55:00.000Z');
  });

  it('accepts a few malformed candles and counts them', async () => {
    const { adapter, world } = setup();
    const p = periods(50);
    p[10].open = NaN;
    p[20].max = 1; // high below open/close
    p[30].min = -5;
    world.chartScript = (c) => c.emitPeriods(p);
    const r = await adapter.getCandles('M5', 50);
    expect(r.candles).toHaveLength(47);
    expect(r.quality).toMatchObject({ received: 50, accepted: 47, malformed: 3 });
  });

  it('rejects a payload with too many malformed candles, or with none valid', async () => {
    const many = setup();
    const p = periods(50);
    p.slice(0, 10).forEach((x) => { x.open = NaN; }); // 20% malformed
    many.world.chartScript = (c) => c.emitPeriods(p);
    await expect(many.adapter.getCandles('M5', 50)).rejects.toMatchObject({ code: 'DATA_QUALITY_ERROR', retryable: true });

    const none = setup();
    const q = periods(50);
    q.forEach((x) => { x.max = NaN; });
    none.world.chartScript = (c) => c.emitPeriods(q);
    await expect(none.adapter.getCandles('M5', 50)).rejects.toMatchObject({ code: 'DATA_QUALITY_ERROR', retryable: true });
  });

  it('removes duplicate candles and counts them', async () => {
    const { adapter, world } = setup();
    const p = periods(50);
    p[5] = { ...p[5], time: p[4].time };
    world.chartScript = (c) => c.emitPeriods(p);
    const r = await adapter.getCandles('M5', 50);
    expect(r.candles).toHaveLength(49);
    expect(r.quality).toMatchObject({ accepted: 49, duplicates: 1, malformed: 0 });
  });

  it('drops candles from the future', async () => {
    const { adapter, world } = setup();
    const p = periods(50);
    p[0] = { ...p[0], time: FAKE_NOW.getTime() / 1000 + 3600 };
    world.chartScript = (c) => c.emitPeriods(p);
    const r = await adapter.getCandles('M5', 50);
    expect(r.candles).toHaveLength(49);
    expect(r.quality.future).toBe(1);
    expect(r.latestCandleTime).toBe('2026-10-02T20:50:00.000Z');
  });

  it('times out cleanly when TradingView sends no data', async () => {
    const { adapter, world } = setup({ timeoutMs: 40 });
    world.chartScript = (c) => c.emitPeriods([]);
    const err = await adapter.getCandles('M5', 50).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code: 'TRADINGVIEW_CONNECTION_ERROR', retryable: true });
    expect((err as AppError).message).toMatch(/Timed out/);
    expect(world.activeCharts).toBe(0);
  });

  it('maps a TradingView symbol error on a chart to INVALID_SYMBOL', async () => {
    const { adapter, world } = setup();
    world.chartScript = (c) => c.emitError('(ser_1) Symbol error: invalid symbol');
    await expect(adapter.getCandles('M5', 50)).rejects.toMatchObject({ code: 'INVALID_SYMBOL', retryable: false });
    expect(world.activeCharts).toBe(0);
  });

  it('maps a TradingView symbol error on the quote to INVALID_SYMBOL', async () => {
    const { adapter, world } = setup();
    world.quoteScript = (c) => c.emitError('(ser_1) Symbol error: invalid symbol');
    await expect(adapter.getQuote()).rejects.toMatchObject({ code: 'INVALID_SYMBOL', retryable: false });
  });

  it('treats any other chart error as a retryable connection error', async () => {
    const { adapter, world } = setup();
    world.chartScript = (c) => c.emitError('something went wrong');
    await expect(adapter.getCandles('M5', 50)).rejects.toMatchObject({ code: 'TRADINGVIEW_CONNECTION_ERROR', retryable: true });
  });

  it('reports a disconnect during a request and recovers on the next one', async () => {
    const { adapter, manager, world } = setup();
    world.chartScript = (c) => c.client.simulateDrop();
    const err = await adapter.getCandles('M5', 50).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code: 'TRADINGVIEW_CONNECTION_ERROR', retryable: true });
    expect((err as AppError).message).toMatch(/disconnected during request/);
    expect(manager.status().state).toBe('disconnected');

    world.chartScript = (c) => c.emitPeriods(periods(c.opts.range));
    const r = await adapter.getCandles('M5', 50);
    expect(r.candles).toHaveLength(50);
    expect(world.clients).toHaveLength(2);
    expect(world.clients[0].isOpen).toBe(false);
    expect(manager.status().state).toBe('connected');
  });

  it('serves last-known candles flagged stale when a refresh fails', async () => {
    const { adapter, world } = setup({ ttl: 1000 });
    await adapter.getCandles('M5', 50);
    vi.setSystemTime(new Date(FAKE_NOW.getTime() + 60_000)); // the 1 s cache entry expires
    world.chartScript = (c) => c.emitError('temporary failure');
    const r = await adapter.getCandles('M5', 50);
    expect(r).toMatchObject({ stale: true, staleReason: 'fetch_failed_serving_last_known', cached: true });
    expect(r.candles).toHaveLength(50);
  });

  it('does not mask a non-retryable error with last-known data', async () => {
    const { adapter, world } = setup({ ttl: 1000 });
    await adapter.getCandles('M5', 50);
    vi.setSystemTime(new Date(FAKE_NOW.getTime() + 60_000));
    world.chartScript = (c) => c.emitError('(ser_1) Symbol error: invalid symbol');
    await expect(adapter.getCandles('M5', 50)).rejects.toMatchObject({ code: 'INVALID_SYMBOL' });
  });

  it('flags old candles as stale while the market is open', async () => {
    const { adapter } = setup();
    vi.setSystemTime(new Date('2026-10-05T12:00:00Z')); // Monday 08:00 New York: open
    const r = await adapter.getCandles('M5', 50);
    expect(r).toMatchObject({ stale: true, staleReason: 'candle_too_old_while_market_open', marketOpen: true, note: null });
  });

  it('validates the limit', async () => {
    const { adapter } = setup();
    for (const bad of [0, 501, 1.5]) {
      await expect(adapter.getCandles('M5', bad)).rejects.toMatchObject({ code: 'INVALID_INPUT', retryable: false });
    }
  });
});

describe('adapter quote against a scripted TradingView client', () => {
  it('returns the price stamped with the receive time, then serves from cache', async () => {
    const { adapter } = setup();
    const q = await adapter.getQuote();
    expect(q).toMatchObject({
      symbol: SYMBOL, source: 'tradingview', price: 4140.52, priceTimeSource: 'received_at',
      marketOpen: false, cached: false, receivedAt: '2026-10-03T12:00:00.000Z',
    });
    expect(await adapter.getQuote()).toMatchObject({ cached: true, latencyMs: 0 });
  });

  it('ignores payloads without a numeric price and waits for a valid one', async () => {
    const { adapter, world } = setup();
    world.quoteScript = (c) => {
      c.emitData({ lp: 'abc' });
      c.emitData({});
      c.emitData({ lp: 4141.5 });
    };
    expect((await adapter.getQuote()).price).toBe(4141.5);
  });
});

describe('connection manager', () => {
  it('times out a connection, backs off, and retries once the backoff has passed', async () => {
    const { adapter, manager, world } = setup({ conn: { connectTimeoutMs: 30 } });
    world.connectPlan = ['never', 'ok'];
    await expect(adapter.getCandles('M5', 50)).rejects.toMatchObject({ code: 'TRADINGVIEW_CONNECTION_ERROR', retryable: true });
    expect(manager.status()).toMatchObject({ state: 'backoff', consecutiveFailures: 1 });
    expect(world.clients).toHaveLength(1);

    const err = await adapter.getCandles('M5', 50).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).message).toMatch(/backoff/);
    expect(world.clients).toHaveLength(1); // no new attempt while backing off

    vi.setSystemTime(new Date(FAKE_NOW.getTime() + 5000));
    const r = await adapter.getCandles('M5', 50);
    expect(r.candles).toHaveLength(50);
    expect(world.clients).toHaveLength(2);
    expect(manager.status()).toMatchObject({ state: 'connected', consecutiveFailures: 0 });
  });

  it('reconnects through the heartbeat without any request', async () => {
    const { manager, world } = setup({ conn: { heartbeatMs: 20 } });
    manager.start();
    await waitFor(() => manager.status().state === 'connected');
    world.clients[0].simulateDrop();
    expect(manager.status().state).toBe('disconnected');
    await waitFor(() => manager.status().state === 'connected' && world.clients.length === 2);
    expect(world.clients).toHaveLength(2);
  });

  it('shuts down: closes the client and refuses further work without retry', async () => {
    const { manager, adapter, world } = setup();
    await adapter.getCandles('M5', 50);
    await manager.shutdown();
    expect(manager.status().state).toBe('shutdown');
    expect(world.clients[0].ended).toBe(true);
    const err = await adapter.getCandles('H1', 50).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code: 'TRADINGVIEW_CONNECTION_ERROR', retryable: false });
  });

  it('limits concurrent chart sessions', async () => {
    const { adapter, world } = setup({ conn: { maxConcurrentSessions: 2 } });
    world.chartScript = (c) => {
      setTimeout(() => c.emitPeriods(periods(c.opts.range)), 30);
    };
    const all = await Promise.all(TIMEFRAMES.map((tf) => adapter.getCandles(tf, 50)));
    expect(all).toHaveLength(4);
    expect(world.charts).toBe(4);
    expect(world.maxActiveCharts).toBe(2);
    expect(world.activeCharts).toBe(0);
  });
});
