import { describe, it, expect } from 'vitest';
import { parseTimeframe, TV_INTERVAL, TIMEFRAME_SECONDS } from '../src/timeframes.js';

describe('timeframes', () => {
  it('maps to TradingView intervals', () => {
    expect(TV_INTERVAL).toEqual({ H4: '240', H1: '60', M15: '15', M5: '5' });
    expect(TIMEFRAME_SECONDS.H4).toBe(14400);
  });
  it('parses case-insensitively and rejects others', () => {
    expect(parseTimeframe('m5')).toBe('M5');
    expect(parseTimeframe(' H4 ')).toBe('H4');
    expect(parseTimeframe('D')).toBeNull();
    expect(parseTimeframe('240')).toBeNull();
    expect(parseTimeframe(5)).toBeNull();
  });
});
