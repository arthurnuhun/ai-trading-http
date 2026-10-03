import { describe, it, expect } from 'vitest';
import { assessFreshness } from '../src/freshness.js';

const FRIDAY_LAST_M5 = Date.parse('2026-10-02T20:55:00Z'); // real last M5 candle from the smoke test

describe('assessFreshness', () => {
  it('weekend with Friday data is not stale', () => {
    const f = assessFreshness(FRIDAY_LAST_M5, 'M5', Date.parse('2026-10-03T11:47:00Z'));
    expect(f).toMatchObject({ stale: false, marketOpen: false, note: 'market_closed' });
  });
  it('old candle while market is open is stale', () => {
    const f = assessFreshness(FRIDAY_LAST_M5, 'M5', Date.parse('2026-10-05T12:00:00Z'));
    expect(f).toMatchObject({ stale: true, staleReason: 'candle_too_old_while_market_open', marketOpen: true });
  });
  it('very old candle while market is closed is stale', () => {
    const f = assessFreshness(FRIDAY_LAST_M5, 'M5', Date.parse('2026-10-10T12:00:00Z'));
    expect(f).toMatchObject({ stale: true, staleReason: 'candle_older_than_weekend_gap' });
  });
  it('recent candle while open is fresh', () => {
    const f = assessFreshness(Date.parse('2026-10-07T09:00:00Z'), 'M5', Date.parse('2026-10-07T09:07:00Z'));
    expect(f.stale).toBe(false);
  });
  it('no candles is stale', () => {
    expect(assessFreshness(null, 'H1', Date.now()).stale).toBe(true);
  });
});
