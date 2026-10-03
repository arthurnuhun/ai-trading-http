import { describe, it, expect } from 'vitest';
import { scoreConfluence, CONFLUENCE_FACTORS, type ConfluenceInput, type FactorStatus } from '../src/analysis/confluence.js';

const build = (statuses: FactorStatus[]): ConfluenceInput =>
  Object.fromEntries(CONFLUENCE_FACTORS.map((name, i) => [name, { status: statuses[i], reason: `${name} test` }])) as ConfluenceInput;
const P: FactorStatus = 'pass';
const F: FactorStatus = 'fail';
const U: FactorStatus = 'unavailable';

describe('scoreConfluence (skill thresholds: 4/6 valid, 5-6 full, <=3 skip)', () => {
  it('6/6 and 5/6 are FULL_CONFLUENCE', () => {
    expect(scoreConfluence(build([P, P, P, P, P, P]))).toMatchObject({ score: 6, outOf: 6, verdict: 'FULL_CONFLUENCE' });
    expect(scoreConfluence(build([P, P, P, P, P, F])).verdict).toBe('FULL_CONFLUENCE');
  });
  it('4/6 is VALID_ENTRY', () => {
    expect(scoreConfluence(build([P, P, P, P, F, F]))).toMatchObject({ score: 4, verdict: 'VALID_ENTRY' });
  });
  it('3/6 and below is SKIP', () => {
    expect(scoreConfluence(build([P, P, P, F, F, F])).verdict).toBe('SKIP');
    expect(scoreConfluence(build([F, F, F, F, F, F]))).toMatchObject({ score: 0, verdict: 'SKIP' });
  });
  it('an unavailable factor is never counted as a pass and is listed', () => {
    const r = scoreConfluence(build([P, P, U, P, P, F]));
    expect(r).toMatchObject({ score: 4, verdict: 'VALID_ENTRY', unavailable: ['heatmap'] });
    expect(scoreConfluence(build([P, P, U, P, F, F])).verdict).toBe('SKIP'); // 3/6 once heatmap is not assumed
  });
  it('rejects a missing or invalid factor', () => {
    const input = build([P, P, P, P, P, P]) as Partial<ConfluenceInput>;
    delete input.momentum;
    expect(() => scoreConfluence(input as ConfluenceInput)).toThrow(/momentum/);
  });
});
