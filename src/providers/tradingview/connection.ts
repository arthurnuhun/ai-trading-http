import TradingView from '@mathieuc/tradingview';
import { AppError } from '../../errors.js';
import type { Logger } from '../../logger.js';

export type ConnectionOptions = {
  token?: string;
  signature?: string;
  connectTimeoutMs?: number;
  heartbeatMs?: number;
  maxConcurrentSessions?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
};

export type ConnectionStatus = {
  state: 'connected' | 'connecting' | 'disconnected' | 'backoff' | 'shutdown';
  consecutiveFailures: number;
  lastError: string | null;
  lastConnectedAt: string | null;
  retryInMs: number;
  activeSessions: number;
};

type ClientFactory = () => any;
type DisconnectListener = (client: any) => void;

export class ConnectionManager {
  private client: any = null;
  private connecting: Promise<any> | null = null;
  private failures = 0;
  private nextAttemptAt = 0;
  private lastError: string | null = null;
  private lastConnectedAt: number | null = null;
  private closed = false;
  private heartbeat: NodeJS.Timeout | null = null;
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly disconnectListeners = new Set<DisconnectListener>();
  private readonly factory: ClientFactory;

  constructor(
    private readonly logger: Logger,
    private readonly opts: ConnectionOptions = {},
    factory?: ClientFactory,
  ) {
    this.factory =
      factory ??
      (() =>
        new TradingView.Client(
          opts.token ? { token: opts.token, signature: opts.signature ?? '' } : {},
        ));
  }

  /** Begin connecting in the background and keep the connection healthy. */
  start(): void {
    if (this.heartbeat || this.closed) return;
    void this.getClient().catch((e) => this.logger.warn({ error: String(e?.message ?? e) }, 'initial connect failed'));
    this.heartbeat = setInterval(() => {
      if (this.closed || this.connecting || this.client?.isOpen) return;
      if (Date.now() < this.nextAttemptAt) return;
      void this.getClient().catch(() => undefined);
    }, this.opts.heartbeatMs ?? 15_000);
    this.heartbeat.unref();
  }

  async getClient(): Promise<any> {
    if (this.closed) {
      throw new AppError('TRADINGVIEW_CONNECTION_ERROR', 'Connection manager is shut down', false);
    }
    if (this.client?.isOpen) return this.client;
    if (this.connecting) return this.connecting;
    const now = Date.now();
    if (now < this.nextAttemptAt) {
      throw new AppError(
        'TRADINGVIEW_CONNECTION_ERROR',
        `TradingView connection in backoff; retry in ${Math.ceil((this.nextAttemptAt - now) / 1000)}s`,
        true,
      );
    }
    this.connecting = this.connect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async connect(): Promise<any> {
    this.disposeClient();
    let client: any;
    try {
      client = this.factory();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('connect timeout')),
          this.opts.connectTimeoutMs ?? 15_000,
        );
        client.onConnected(() => {
          clearTimeout(timer);
          resolve();
        });
        client.onDisconnected(() => {
          clearTimeout(timer);
          reject(new Error('disconnected before connect completed'));
          this.handleDisconnect(client);
        });
        client.onError((...e: unknown[]) =>
          this.logger.warn({ error: e.map(String).join(' ').slice(0, 300) }, 'tradingview client error'),
        );
      });
    } catch (err) {
      try {
        client?.end();
      } catch {
        /* ignore */
      }
      this.recordFailure(err);
      throw new AppError('TRADINGVIEW_CONNECTION_ERROR', 'Unable to connect to TradingView', true);
    }
    this.client = client;
    this.failures = 0;
    this.nextAttemptAt = 0;
    this.lastError = null;
    this.lastConnectedAt = Date.now();
    this.logger.info('tradingview connected');
    return client;
  }

  private handleDisconnect(client: any): void {
    if (this.client === client) {
      this.client = null;
      this.logger.warn('tradingview disconnected');
    }
    for (const cb of [...this.disconnectListeners]) {
      try {
        cb(client);
      } catch {
        /* ignore */
      }
    }
  }

  private recordFailure(err: unknown): void {
    this.failures++;
    const base = this.opts.backoffBaseMs ?? 1_000;
    const max = this.opts.backoffMaxMs ?? 30_000;
    const delay = Math.min(base * 2 ** (this.failures - 1), max);
    const total = delay + Math.floor(Math.random() * delay * 0.2);
    this.nextAttemptAt = Date.now() + total;
    this.lastError = err instanceof Error ? err.message : String(err);
    this.logger.warn({ failures: this.failures, retryInMs: total, error: this.lastError }, 'tradingview connect failed');
  }

  private disposeClient(): void {
    const old = this.client;
    this.client = null;
    if (old) {
      try {
        old.end();
      } catch {
        /* ignore */
      }
    }
  }

  onDisconnect(cb: DisconnectListener): () => void {
    this.disconnectListeners.add(cb);
    return () => this.disconnectListeners.delete(cb);
  }

  /** Share one in-flight promise between identical concurrent requests. */
  dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;
    const p = fn().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  /** Limit the number of simultaneous TradingView sessions. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.active < (this.opts.maxConcurrentSessions ?? 4)) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) next(); // slot handed over; active count unchanged
    else this.active--;
  }

  status(): ConnectionStatus {
    const now = Date.now();
    let state: ConnectionStatus['state'];
    if (this.closed) state = 'shutdown';
    else if (this.client?.isOpen) state = 'connected';
    else if (this.connecting) state = 'connecting';
    else if (now < this.nextAttemptAt) state = 'backoff';
    else state = 'disconnected';
    return {
      state,
      consecutiveFailures: this.failures,
      lastError: this.lastError,
      lastConnectedAt: this.lastConnectedAt ? new Date(this.lastConnectedAt).toISOString() : null,
      retryInMs: Math.max(0, this.nextAttemptAt - now),
      activeSessions: this.active,
    };
  }

  /** For tests/diagnostics: drop the socket to simulate a disconnect. */
  forceClose(): void {
    try {
      this.client?.end();
    } catch {
      /* ignore */
    }
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.disposeClient();
  }
}
