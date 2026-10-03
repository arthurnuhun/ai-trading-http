import { z } from 'zod';

const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const text = z.preprocess(blank, z.string().optional());
const int = (def: number, min = 1, max = Number.MAX_SAFE_INTEGER) =>
  z.preprocess(blank, z.coerce.number().int().min(min).max(max).default(def));

const LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const schema = z.object({
  NODE_ENV: z.preprocess(blank, z.enum(['development', 'production', 'test']).default('production')),
  PORT: int(3000, 1, 65535),
  TV_SYMBOL: z.preprocess(
    blank,
    z
      .string()
      .regex(/^[A-Za-z0-9_.-]+:[A-Za-z0-9_.!-]+$/, 'TV_SYMBOL must look like EXCHANGE:SYMBOL')
      .default('OANDA:XAUUSD'),
  ),
  TV_SESSION: text,
  TV_SIGNATURE: text,
  LOG_LEVEL: z.preprocess(blank, z.enum(LEVELS).default('info')),
  MARKET_CACHE_TTL_MS: int(2_000),
  M5_CACHE_TTL_MS: int(10_000),
  M15_CACHE_TTL_MS: int(30_000),
  H1_CACHE_TTL_MS: int(120_000),
  H4_CACHE_TTL_MS: int(300_000),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${msg}`);
  }
  const e = parsed.data;
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    tvSymbol: e.TV_SYMBOL,
    tvSession: e.TV_SESSION,
    tvSignature: e.TV_SIGNATURE,
    logLevel: e.LOG_LEVEL,
    ttlMs: {
      quote: e.MARKET_CACHE_TTL_MS,
      M5: e.M5_CACHE_TTL_MS,
      M15: e.M15_CACHE_TTL_MS,
      H1: e.H1_CACHE_TTL_MS,
      H4: e.H4_CACHE_TTL_MS,
    },
  };
}

export type Config = ReturnType<typeof loadConfig>;
