import { describe, it, expect } from 'vitest';
import { buildRiskPlan } from '../src/analysis/risk.js';

describe('buildRiskPlan style validation', () => {
  it('rejects inherited object keys as a style', () => {
    const input = { direction: 'buy', style: 'toString', entry: 4100, stopLoss: 4090, takeProfits: [4115], pipSize: 0.1 } as unknown as Parameters<typeof buildRiskPlan>[0];
    expect(() => buildRiskPlan(input)).toThrow(/style/);
  });
});
