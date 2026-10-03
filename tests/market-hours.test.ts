import { describe, it, expect } from 'vitest';
import { marketStatus } from '../src/market-hours.js';

const at = (iso: string) => Date.parse(iso);

describe('marketStatus (America/New_York weekend closure, assumption)', () => {
  it('is closed all Saturday', () => {
    expect(marketStatus(at('2026-10-03T12:00:00Z')).open).toBe(false);
  });
  it('closes Friday 17:00 New York (EDT)', () => {
    expect(marketStatus(at('2026-10-02T20:55:00Z')).open).toBe(true);
    expect(marketStatus(at('2026-10-02T21:00:00Z')).open).toBe(false);
  });
  it('reopens Sunday 17:00 New York (EDT)', () => {
    expect(marketStatus(at('2026-10-04T20:59:00Z')).open).toBe(false);
    expect(marketStatus(at('2026-10-04T21:00:00Z')).open).toBe(true);
  });
  it('handles standard time (EST)', () => {
    expect(marketStatus(at('2026-12-04T21:59:00Z')).open).toBe(true);
    expect(marketStatus(at('2026-12-04T22:00:00Z')).open).toBe(false);
  });
  it('is open midweek', () => {
    expect(marketStatus(at('2026-10-07T09:00:00Z')).open).toBe(true);
  });
});
