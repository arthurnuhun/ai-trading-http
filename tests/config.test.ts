import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('uses defaults for an empty env', () => {
    const c = loadConfig({});
    expect(c.port).toBe(3000);
    expect(c.tvSymbol).toBe('OANDA:XAUUSD');
  });
  it('treats empty strings like unset (as in .env.example)', () => {
    const c = loadConfig({ PORT: '', TV_SYMBOL: '', H4_CACHE_TTL_MS: '' });
    expect(c.port).toBe(3000);
    expect(c.ttlMs.H4).toBe(300000);
  });
  it('honors overrides', () => {
    const c = loadConfig({ PORT: '8080', TV_SYMBOL: 'FX:XAUUSD' });
    expect(c.port).toBe(8080);
    expect(c.tvSymbol).toBe('FX:XAUUSD');
  });
  it('rejects an invalid symbol', () => {
    expect(() => loadConfig({ TV_SYMBOL: 'XAUUSD' })).toThrow(/TV_SYMBOL/);
  });
});
