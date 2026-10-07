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
  PIP_SIZE: z.preprocess(blank, z.coerce.number().positive().optional()),
  TV_SIGNATURE: text,
  MCP_PATH_SECRET: z.preprocess(
    blank,
    z
      .string()
      .trim()
      .min(32, 'MCP_PATH_SECRET must be at least 32 characters')
      .regex(/^[A-Za-z0-9_-]+$/, 'MCP_PATH_SECRET may only contain letters, digits, - and _')
      .optional(),
  ),
  MCP_AUTH_TOKEN: z.preprocess(blank, z.string().trim().min(16, 'MCP_AUTH_TOKEN must be at least 16 characters').optional()),
  LOG_LEVEL: z.preprocess(blank, z.enum(LEVELS).default('info')),
  MARKET_CACHE_TTL_MS: int(2_000),
  M5_CACHE_TTL_MS: int(10_000),
  M15_CACHE_TTL_MS: int(30_000),
  H1_CACHE_TTL_MS: int(120_000),
  H4_CACHE_TTL_MS: int(300_000),
  DXY_SYMBOL: z.preprocess(
    blank,
    z
      .string()
      .regex(/^[A-Za-z0-9_.-]+:[A-Za-z0-9_.!-]+$/, 'DXY_SYMBOL must look like EXCHANGE:SYMBOL')
      .default('TVC:DXY'),
  ),
  US10Y_SYMBOL: z.preprocess(
    blank,
    z
      .string()
      .regex(/^[A-Za-z0-9_.-]+:[A-Za-z0-9_.!-]+$/, 'US10Y_SYMBOL must look like EXCHANGE:SYMBOL')
      .default('TVC:US10Y'),
  ),
  FED_TARGET_LOWER: z.preprocess(blank, z.coerce.number().min(0).max(20).optional()),
  FED_TARGET_UPPER: z.preprocess(blank, z.coerce.number().min(0).max(20).optional()),
  FED_EFFR: z.preprocess(blank, z.coerce.number().min(0).max(20).optional()),
  FED_RATES_ASOF: z.preprocess(
    blank,
    z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'FED_RATES_ASOF must be YYYY-MM-DD').optional(),
  ),
  ZQ_SYMBOL_PREFIX: z.preprocess(
    blank,
    z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/, 'ZQ_SYMBOL_PREFIX must look like EXCHANGE:ROOT')
      .default('CBOT:ZQ'),
  ),
  WGC_DEMAND_JSON: text,
  CALENDAR_CACHE_TTL_MS: int(900_000, 60_000),
  CALENDAR_WINDOW_HOURS: int(24, 1, 168),
  FOMC_DECISION_DATES: z.preprocess(
    blank,
    z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}(\s*,\s*\d{4}-\d{2}-\d{2})*$/, 'FOMC_DECISION_DATES must be comma-separated YYYY-MM-DD dates')
      .optional(),
  ),
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
    pipSize: e.PIP_SIZE,
    tvSignature: e.TV_SIGNATURE,
    mcpAuthToken: e.MCP_AUTH_TOKEN,
    mcpPathSecret: e.MCP_PATH_SECRET,
    fed: {
      lower: e.FED_TARGET_LOWER,
      upper: e.FED_TARGET_UPPER,
      effr: e.FED_EFFR,
      asOf: e.FED_RATES_ASOF,
      zqPrefix: e.ZQ_SYMBOL_PREFIX,
    },
    macroSymbols: { dxy: e.DXY_SYMBOL, us10y: e.US10Y_SYMBOL },
    wgcDemandJson: e.WGC_DEMAND_JSON,
    calendar: { cacheTtlMs: e.CALENDAR_CACHE_TTL_MS, windowHours: e.CALENDAR_WINDOW_HOURS },
    fomcDecisionDates: e.FOMC_DECISION_DATES ? e.FOMC_DECISION_DATES.split(',').map((s) => s.trim()) : [],
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
