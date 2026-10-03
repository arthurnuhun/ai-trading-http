import type { CandleResult, QuoteResult } from './providers/tradingview/adapter.js';
import type { ConnectionStatus } from './providers/tradingview/connection.js';
import type { Timeframe } from './timeframes.js';

export type Services = {
  symbol: string;
  getQuote(): Promise<QuoteResult>;
  getCandles(tf: Timeframe, limit?: number): Promise<CandleResult>;
  connectionStatus(): ConnectionStatus;
};
