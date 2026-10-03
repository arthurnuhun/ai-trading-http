import { AppError } from '../../errors.js';
import type { Logger } from '../../logger.js';
import { TtlCache } from '../../cache/ttl-cache.js';
import { assessFreshness } from '../../freshness.js';
import { marketStatus } from '../../market-hours.js';
import { TV_INTERVAL, type Timeframe } from '../../timeframes.js';
import type { Candle, NormalizeStats } from '../../types.js';
import type { ConnectionManager } from './connection.js';
import { normalizePeriods, type RawPeriod } from './normalize.js';

export const MAX_LIMIT = 500; // the only range verified against the live feed

export type CandleResult = {
  symbol: string;
  source: 'tradingview';
  timeframe: Timeframe;
  candles: Candle[];
  latestCandle: Candle | null;
  fetchedAt: string;
  latestCandleTime: string | null;
  stale: boolean;
  staleReason: string | null;
  note: string | null;
  marketOpen: boolean;
  ageSeconds: number;
  latencyMs: number;
  cached: boolean;
  quality: NormalizeStats;
};

export type QuoteResult = {
  symbol: string;
  source: 'tradingview';
  price: number;
  receivedAt: string;
  priceTimeSource: 'received_at'; // the quote payload carries no exchange timestamp
  marketOpen: boolean;
  latencyMs: number;
  cached: boolean;
};

type CandleEntry = { candles: Candle[]; quality: NormalizeStats; fetchedAtMs: number; latencyMs: number };
type QuoteEntry = { price: number; receivedAtMs: number; latencyMs: number };

export type AdapterOptions = {
  symbol: string;
  ttlMs: Record<'quote' | Timeframe, number>;
};

function classifyChartError(args: unknown[]): AppError {
  const raw = args.map(String).join(' ').slice(0, 200);
  // Heuristic: the exact TradingView wording for an unknown symbol is verified separately by the smoke script.
  if (/symbol|invalid|not.?found|unknown|no such/i.test(raw)) {
    return new AppError('INVALID_SYMBOL', `TradingView rejected the symbol: ${raw}`, false);
  }
  return new AppError('TRADINGVIEW_CONNECTION_ERROR', `TradingView chart error: ${raw}`, true);
}

export class TradingViewAdapter {
  private readonly candleCache = new TtlCache<CandleEntry>();
  private readonly quoteCache = new TtlCache<QuoteEntry>();
  private readonly lastKnown = new Map<string, CandleEntry>();

  constructor(
    private readonly manager: ConnectionManager,
    private readonly opts: AdapterOptions,
    private readonly logger: Logger,
    private readonly requestTimeoutMs = 20_000,
  ) {}

  get symbol(): string {
    return this.opts.symbol;
  }

  clearCache(): void {
    this.candleCache.clear();
    this.quoteCache.clear();
    this.lastKnown.clear();
  }

  async getCandles(tf: Timeframe, limit: number = MAX_LIMIT): Promise<CandleResult> {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new AppError('INVALID_INPUT', `limit must be an integer between 1 and ${MAX_LIMIT}`, false);
    }
    const key = `${this.opts.symbol}|${tf}|${limit}`;
    const hit = this.candleCache.get(key);
    if (hit) return this.build(tf, hit, true, null);
    try {
      const entry = await this.manager.dedupe(`candles|${key}`, () =>
        this.manager.run(() => this.loadCandles(tf, limit)),
      );
      this.candleCache.set(key, entry, this.opts.ttlMs[tf]);
      this.lastKnown.set(key, entry);
      return this.build(tf, entry, false, null);
    } catch (err) {
      const last = this.lastKnown.get(key);
      if (last && err instanceof AppError && err.retryable) {
        this.logger.warn({ code: err.code, timeframe: tf }, 'serving last-known candles flagged stale');
        return this.build(tf, last, true, 'fetch_failed_serving_last_known');
      }
      throw err;
    }
  }

  async getQuote(): Promise<QuoteResult> {
    const key = `${this.opts.symbol}|quote`;
    const hit = this.quoteCache.get(key);
    if (hit) return this.buildQuote(hit, true);
    const entry = await this.manager.dedupe(`quote|${key}`, () =>
      this.manager.run(() => this.loadQuote()),
    );
    this.quoteCache.set(key, entry, this.opts.ttlMs.quote);
    return this.buildQuote(entry, false);
  }

  private build(tf: Timeframe, e: CandleEntry, cached: boolean, forcedStale: string | null): CandleResult {
    const latest = e.candles.length ? e.candles[e.candles.length - 1] : null;
    const f = assessFreshness(latest?.timestamp ?? null, tf, Date.now());
    return {
      symbol: this.opts.symbol,
      source: 'tradingview',
      timeframe: tf,
      candles: e.candles,
      latestCandle: latest,
      fetchedAt: new Date(e.fetchedAtMs).toISOString(),
      latestCandleTime: latest?.isoTime ?? null,
      stale: forcedStale ? true : f.stale,
      staleReason: forcedStale ?? f.staleReason,
      note: f.note,
      marketOpen: f.marketOpen,
      ageSeconds: f.ageSeconds,
      latencyMs: cached ? 0 : e.latencyMs,
      cached,
      quality: e.quality,
    };
  }

  private buildQuote(e: QuoteEntry, cached: boolean): QuoteResult {
    return {
      symbol: this.opts.symbol,
      source: 'tradingview',
      price: e.price,
      receivedAt: new Date(e.receivedAtMs).toISOString(),
      priceTimeSource: 'received_at',
      marketOpen: marketStatus(Date.now()).open,
      latencyMs: cached ? 0 : e.latencyMs,
      cached,
    };
  }

  private async loadCandles(tf: Timeframe, limit: number): Promise<CandleEntry> {
    const started = Date.now();
    const client = await this.manager.getClient();
    const raw = await this.fetchChart(client, tf, limit);
    const { candles, stats } = normalizePeriods(raw, Date.now());
    if (candles.length === 0) {
      throw new AppError('DATA_QUALITY_ERROR', 'TradingView returned no valid candles', true);
    }
    if (stats.received > 0 && stats.malformed / stats.received > 0.1) {
      throw new AppError(
        'DATA_QUALITY_ERROR',
        `Too many malformed candles (${stats.malformed}/${stats.received})`,
        true,
      );
    }
    return { candles, quality: stats, fetchedAtMs: Date.now(), latencyMs: Date.now() - started };
  }

  private fetchChart(client: any, tf: Timeframe, limit: number): Promise<RawPeriod[]> {
    return new Promise<RawPeriod[]>((resolve, reject) => {
      const chart = new client.Session.Chart();
      let done = false;
      let settle: NodeJS.Timeout | undefined;
      const unsubscribe = this.manager.onDisconnect((c) => {
        if (c === client) finish(new AppError('TRADINGVIEW_CONNECTION_ERROR', 'TradingView disconnected during request', true));
      });
      const hard = setTimeout(
        () => finish(new AppError('TRADINGVIEW_CONNECTION_ERROR', 'Timed out waiting for TradingView data', true)),
        this.requestTimeoutMs,
      );
      function finish(result: RawPeriod[] | AppError): void {
        if (done) return;
        done = true;
        clearTimeout(hard);
        if (settle) clearTimeout(settle);
        unsubscribe();
        try {
          chart.delete();
        } catch {
          /* ignore */
        }
        if (result instanceof AppError) reject(result);
        else resolve(result);
      }
      chart.onError((...err: unknown[]) => finish(classifyChartError(err)));
      chart.onUpdate(() => {
        const periods: RawPeriod[] = chart.periods;
        if (!periods.length) return;
        if (periods.length >= limit) {
          finish(periods.slice(0, limit));
          return;
        }
        if (settle) clearTimeout(settle);
        settle = setTimeout(() => finish((chart.periods as RawPeriod[]).slice(0, limit)), 1_000);
      });
      chart.setMarket(this.opts.symbol, { timeframe: TV_INTERVAL[tf], range: limit });
    });
  }

  private async loadQuote(): Promise<QuoteEntry> {
    const started = Date.now();
    const client = await this.manager.getClient();
    const price = await this.fetchQuote(client);
    return { price, receivedAtMs: Date.now(), latencyMs: Date.now() - started };
  }

  private fetchQuote(client: any): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const qs = new client.Session.Quote({ fields: 'price' });
      const market = new qs.Market(this.opts.symbol);
      let done = false;
      const unsubscribe = this.manager.onDisconnect((c) => {
        if (c === client) finish(new AppError('TRADINGVIEW_CONNECTION_ERROR', 'TradingView disconnected during request', true));
      });
      const hard = setTimeout(
        () => finish(new AppError('TRADINGVIEW_CONNECTION_ERROR', 'Timed out waiting for TradingView quote', true)),
        10_000,
      );
      function finish(result: number | AppError): void {
        if (done) return;
        done = true;
        clearTimeout(hard);
        unsubscribe();
        try {
          market.close();
          qs.delete();
        } catch {
          /* ignore */
        }
        if (result instanceof AppError) reject(result);
        else resolve(result);
      }
      market.onError((...err: unknown[]) => finish(classifyChartError(err)));
      market.onData((d: { lp?: unknown }) => {
        if (typeof d?.lp === 'number' && Number.isFinite(d.lp)) finish(d.lp);
      });
    });
  }
}
