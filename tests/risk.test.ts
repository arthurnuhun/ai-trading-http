import { describe, it, expect } from 'vitest';
import { buildRiskPlan } from '../src/analysis/risk.js';

// pipSize 0.1 is a TEST INPUT only; the server never assumes a pip size.
const buy = { direction: 'buy', style: 'scalp', entry: 4100, stopLoss: 4090, takeProfits: [4115, 4130, 4150], pipSize: 0.1 } as const;

describe('buildRiskPlan', () => {
  it('computes distances, pips and RR for a buy (hand-computed)', () => {
    const p = buildRiskPlan({ ...buy });
    expect(p.stopDistance).toEqual({ price: 10, pips: 100 });
    expect(p.takeProfits.map((t) => [t.label, t.price, t.pips, t.rr])).toEqual([
      ['TP1', 4115, 150, 1.5],
      ['TP2', 4130, 300, 3],
      ['TP3', 4150, 500, 5],
    ]);
    expect(p.breakeven.triggerPrice).toBeCloseTo(4102, 6); // +20 pips
    expect(p.partialAtTp1Percent).toBe(40);
    expect(p.analyticalOnly).toBe(true);
  });

  it('mirrors for a sell', () => {
    const p = buildRiskPlan({ direction: 'sell', style: 'scalp', entry: 4100, stopLoss: 4110, takeProfits: [4085, 4070], pipSize: 0.1 });
    expect(p.takeProfits.map((t) => t.rr)).toEqual([1.5, 3]);
    expect(p.breakeven.triggerPrice).toBeCloseTo(4098, 6);
  });

  it('checks the minimum RR per style on the furthest TP', () => {
    const one = { ...buy, takeProfits: [4115] };
    expect(buildRiskPlan({ ...one, style: 'scalp' }).rr).toMatchObject({ final: 1.5, minimum: 1.5, meetsMinimum: true });
    expect(buildRiskPlan({ ...one, style: 'intraday' }).rr).toMatchObject({ minimum: 2, meetsMinimum: false });
    expect(buildRiskPlan({ ...buy, style: 'swing' }).rr).toMatchObject({ final: 5, minimum: 3, meetsMinimum: true, evaluatedOn: 'TP3' });
  });

  it('sizes the position from balance, risk % and contract size (hand-computed)', () => {
    // 10000 * 1% = 100; stop distance 10; contract 100 oz -> 100 / (10 * 100) = 0.1 lot
    const p = buildRiskPlan({ ...buy, accountBalance: 10000, riskPercent: 1, contractSize: 100 });
    expect(p.positionSizing).toMatchObject({ available: true, approximate: true, riskAmount: 100, lots: 0.1 });
    const q = buildRiskPlan({ ...buy, accountBalance: 10000, riskPercent: 2, contractSize: 100 });
    expect(q.positionSizing).toMatchObject({ riskAmount: 200, lots: 0.2 });
  });

  it('does not size without all sizing inputs', () => {
    expect(buildRiskPlan({ ...buy, accountBalance: 10000, riskPercent: 1 }).positionSizing).toMatchObject({ available: false });
    expect(buildRiskPlan({ ...buy }).positionSizing).toMatchObject({ available: false });
  });

  it('rejects risk above 2% and invalid input', () => {
    expect(() => buildRiskPlan({ ...buy, accountBalance: 10000, riskPercent: 2.5, contractSize: 100 })).toThrow(/riskPercent/);
    expect(() => buildRiskPlan({ ...buy, riskPercent: 3 })).toThrow(/riskPercent/);
    expect(() => buildRiskPlan({ ...buy, stopLoss: 4110 })).toThrow(/stopLoss/);
    expect(() => buildRiskPlan({ ...buy, takeProfits: [4130, 4115] })).toThrow(/ordered/);
    expect(() => buildRiskPlan({ ...buy, takeProfits: [4090] })).toThrow(/winning side/);
    expect(() => buildRiskPlan({ ...buy, takeProfits: [] })).toThrow(/takeProfits/);
    expect(() => buildRiskPlan({ ...buy, pipSize: 0 })).toThrow(/pipSize/);
  });
});
