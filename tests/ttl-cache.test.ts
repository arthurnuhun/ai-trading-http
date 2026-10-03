import { describe, it, expect } from 'vitest';
import { TtlCache } from '../src/cache/ttl-cache.js';

describe('TtlCache', () => {
  it('returns values until the TTL elapses', () => {
    let t = 1000;
    const c = new TtlCache<number>(() => t);
    c.set('a', 1, 500);
    expect(c.get('a')).toBe(1);
    t = 1499;
    expect(c.get('a')).toBe(1);
    t = 1500;
    expect(c.get('a')).toBeUndefined();
  });
  it('evicts the oldest entry beyond maxEntries', () => {
    const c = new TtlCache<number>(() => 0, 2);
    c.set('a', 1, 1000);
    c.set('b', 2, 1000);
    c.set('c', 3, 1000);
    expect(c.get('a')).toBeUndefined();
    expect(c.get('c')).toBe(3);
  });
  it('clear removes everything', () => {
    const c = new TtlCache<number>(() => 0);
    c.set('a', 1, 1000);
    c.clear();
    expect(c.get('a')).toBeUndefined();
  });
});
