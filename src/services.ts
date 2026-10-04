import type { CandleResult, QuoteResult } from './providers/tradingview/adapter.js';
import type { ConnectionStatus } from './providers/tradingview/connection.js';
import type { HeatmapProvider } from './providers/heatmap/index.js';
import type { MacroProvider } from './providers/macro/index.js';
import type { Timeframe } from './timeframes.js';

export type Services = {
  symbol: string;
  pipSize?: number;
  heatmap?: HeatmapProvider;
  macro?: MacroProvider;
  getQuote(): Promise<QuoteResult>;
  getCandles(tf: Timeframe, limit?: number): Promise<CandleResult>;
  connectionStatus(): ConnectionStatus;
};
