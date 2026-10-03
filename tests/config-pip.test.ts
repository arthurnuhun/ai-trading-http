import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('PIP_SIZE', () => {
  it('has no default', () => {
    expect(loadConfig({}).pipSize).toBeUndefined();
    expect(loadConfig({ PIP_SIZE: '' }).pipSize).toBeUndefined();
  });
  it('is read when set and must be positive', () => {
    expect(loadConfig({ PIP_SIZE: '0.1' }).pipSize).toBe(0.1);
    expect(() => loadConfig({ PIP_SIZE: '0' })).toThrow(/PIP_SIZE/);
    expect(() => loadConfig({ PIP_SIZE: '-1' })).toThrow(/PIP_SIZE/);
  });
});
