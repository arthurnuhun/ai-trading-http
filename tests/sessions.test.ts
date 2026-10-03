import { describe, it, expect } from 'vitest';
import { sessionContext } from '../src/analysis/sessions.js';

const at = (iso: string) => sessionContext(Date.parse(iso)); // WIB = UTC+7; 2026-10-05 is a Monday

describe('sessionContext (Asia/Jakarta)', () => {
  it('reports the timezone and local time', () => {
    expect(at('2026-10-05T06:00:00Z')).toMatchObject({ timezone: 'Asia/Jakarta', localTime: '13:00' });
  });
  it('London kill zone is 13:00-15:00 WIB', () => {
    expect(at('2026-10-05T05:59:00Z')).toMatchObject({ session: 'Asia', killZone: false });
    expect(at('2026-10-05T06:00:00Z')).toMatchObject({ session: 'London', killZone: true, killZoneName: 'London' });
    expect(at('2026-10-05T07:59:00Z')).toMatchObject({ session: 'London', killZone: true });
    expect(at('2026-10-05T08:00:00Z')).toMatchObject({ session: 'London', killZone: false });
  });
  it('New York kill zone is 20:00-21:30 WIB', () => {
    expect(at('2026-10-05T12:59:00Z')).toMatchObject({ session: 'London', killZone: false });
    expect(at('2026-10-05T13:00:00Z')).toMatchObject({ session: 'New York', killZone: true, killZoneName: 'New York' });
    expect(at('2026-10-05T14:29:00Z')).toMatchObject({ session: 'New York', killZone: true });
    expect(at('2026-10-05T14:30:00Z')).toMatchObject({ session: 'New York', killZone: false });
    expect(at('2026-10-05T16:59:00Z').session).toBe('New York');
  });
  it('Australia 05:00-07:00 and Asia 07:00-13:00 WIB', () => {
    expect(at('2026-10-05T22:00:00Z').session).toBe('Australia'); // 05:00 WIB Tuesday
    expect(at('2026-10-05T23:59:00Z').session).toBe('Australia');
    expect(at('2026-10-06T00:00:00Z').session).toBe('Asia');
  });
  it('00:00-05:00 WIB is off_hours', () => {
    expect(at('2026-10-05T17:00:00Z')).toMatchObject({ session: 'off_hours', killZone: false, characteristic: null });
    expect(at('2026-10-05T21:59:00Z').session).toBe('off_hours');
  });
  it('carries the market-open flag independently of the session', () => {
    expect(at('2026-10-03T11:47:00Z')).toMatchObject({ session: 'London', marketOpen: false, marketClosedReason: 'weekend_closure' });
    expect(at('2026-10-05T06:00:00Z').marketOpen).toBe(true);
  });
});
