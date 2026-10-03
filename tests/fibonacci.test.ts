import { describe, it, expect } from 'vitest';
import { fibonacci, fibonacciFromStructure } from '../src/analysis/fibonacci.js';
import type { Swing, StructureResult } from '../src/analysis/market-structure.js';

const sw = (type: 'high' | 'low', index: number, price: number): Swing => ({
  type,
  index,
  timestamp: index * 60000,
  isoTime: new Date(index * 60000).toISOString(),
  price,
  confirmedIndex: index + 1,
  confirmedTimestamp: (index + 1) * 60000,
  label: null,
});
const prices = (l: { price: number }[]) => l.map((x) => x.price);

describe('fibonacci', () => {
  it('up leg (low first): retracements fall from the high, extensions project above it', () => {
    const f = fibonacci(sw('high', 5, 200), sw('low', 1, 100))!;
    expect(f.direction).toBe('up_leg');
    expect(f.range).toBe(100);
    expect(prices(f.retracements)).toEqual([161.8, 150, 138.2, 121.4]);
    expect(prices(f.extensions)).toEqual([227.2, 261.8]);
    expect(f.retracements.map((l) => l.label)).toEqual(['38.2%', '50%', '61.8%', '78.6%']);
    expect(f.extensions.map((l) => l.label)).toEqual(['127.2%', '161.8%']);
  });

  it('down leg (high first): retracements rise from the low, extensions project below it', () => {
    const f = fibonacci(sw('high', 1, 200), sw('low', 5, 100))!;
    expect(f.direction).toBe('down_leg');
    expect(prices(f.retracements)).toEqual([138.2, 150, 161.8, 178.6]);
    expect(prices(f.extensions)).toEqual([72.8, 38.2]);
  });

  it('always reports the swing high and swing low used', () => {
    const f = fibonacci(sw('high', 5, 200), sw('low', 1, 100))!;
    expect(f.swingHigh).toMatchObject({ price: 200, timestamp: 5 * 60000 });
    expect(f.swingLow).toMatchObject({ price: 100, timestamp: 60000 });
  });

  it('returns null when the range is not positive', () => {
    expect(fibonacci(sw('high', 5, 100), sw('low', 1, 100))).toBeNull();
    expect(fibonacci(sw('high', 5, 90), sw('low', 1, 100))).toBeNull();
  });

  it('fibonacciFromStructure needs both a last swing high and low', () => {
    const base = { swingLookback: 3, swings: [], events: [], trendState: 'undetermined', lastEvent: null } as const;
    const none = { ...base, lastSwingHigh: null, lastSwingLow: null } as unknown as StructureResult;
    expect(fibonacciFromStructure(none)).toBeNull();
    const both = { ...base, lastSwingHigh: sw('high', 5, 200), lastSwingLow: sw('low', 1, 100) } as unknown as StructureResult;
    expect(fibonacciFromStructure(both)?.direction).toBe('up_leg');
  });
});
