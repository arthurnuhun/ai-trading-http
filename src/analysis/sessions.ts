import { marketStatus } from '../market-hours.js';

export const SESSION_TIMEZONE = 'Asia/Jakarta';
export type SessionName = 'Australia' | 'Asia' | 'London' | 'New York' | 'off_hours';

const m = (h: number, min = 0): number => h * 60 + min;

// From analisa-xauusd (WIB). 00:00-05:00 is not defined by the skill, so it is reported as 'off_hours'.
const SESSIONS: Array<{ name: Exclude<SessionName, 'off_hours'>; from: number; to: number; characteristic: string }> = [
  { name: 'Australia', from: m(5), to: m(7), characteristic: 'Volume tipis — hindari entry agresif' },
  { name: 'Asia', from: m(7), to: m(13), characteristic: 'Range bound — hunting S/R' },
  { name: 'London', from: m(13), to: m(20), characteristic: 'Kill zone 13:00–15:00: sweep + reversal' },
  { name: 'New York', from: m(20), to: m(24), characteristic: 'Kill zone 20:00–21:30: continuation/reversal' },
];
const KILL_ZONES = [
  { name: 'London', from: m(13), to: m(15) },
  { name: 'New York', from: m(20), to: m(21, 30) },
];

const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: SESSION_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const pad = (n: number): string => String(n).padStart(2, '0');

export function sessionContext(nowMs: number = Date.now()) {
  const parts = fmt.formatToParts(new Date(nowMs));
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  const t = hour * 60 + minute;
  const s = SESSIONS.find((x) => t >= x.from && t < x.to);
  const kz = KILL_ZONES.find((x) => t >= x.from && t < x.to);
  const market = marketStatus(nowMs);
  return {
    timezone: SESSION_TIMEZONE,
    localTime: `${pad(hour)}:${pad(minute)}`,
    session: (s?.name ?? 'off_hours') as SessionName,
    killZone: kz !== undefined,
    killZoneName: kz?.name ?? null,
    characteristic: s?.characteristic ?? null,
    marketOpen: market.open,
    marketClosedReason: market.reason,
  };
}
