// ASSUMPTION (not verified against feed documentation): spot gold trades continuously except
// from Friday 17:00 to Sunday 17:00 America/New_York. Evidence: the last candles seen on a Friday
// ended at 16:55 (M5) / 16:00 (H1) New York time.
const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  hour: 'numeric',
  hourCycle: 'h23',
});

export type MarketStatus = { open: boolean; reason: 'weekend_closure' | null };

export function marketStatus(nowMs: number): MarketStatus {
  const parts = fmt.formatToParts(new Date(nowMs));
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const closed =
    weekday === 'Sat' || (weekday === 'Fri' && hour >= 17) || (weekday === 'Sun' && hour < 17);
  return closed ? { open: false, reason: 'weekend_closure' } : { open: true, reason: null };
}
