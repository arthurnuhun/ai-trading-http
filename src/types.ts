// timestamp = epoch milliseconds (UTC)
export type Candle = {
  timestamp: number;
  isoTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null; // TradingView tick volume for this feed, not real traded volume
};

export type NormalizeStats = {
  received: number;
  accepted: number;
  malformed: number;
  duplicates: number;
  future: number;
  nonMonotonic: number;
};
