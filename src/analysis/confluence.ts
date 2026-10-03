import { AppError } from '../errors.js';

export const CONFLUENCE_FACTORS = [
  'h4h1_bias',
  'sr_fvg_location',
  'heatmap',
  'momentum',
  'session',
  'macro_bias',
] as const;
export type FactorName = (typeof CONFLUENCE_FACTORS)[number];
export type FactorStatus = 'pass' | 'fail' | 'unavailable';
export type Factor = { status: FactorStatus; reason: string };
export type ConfluenceInput = Record<FactorName, Factor>;

// Thresholds from analisa-xauusd: 4/6 valid entry, 5-6/6 full, <=3/6 skip. Do not change.
export const THRESHOLDS = { valid: 4, full: 5, skipAtOrBelow: 3 } as const;
export type Verdict = 'FULL_CONFLUENCE' | 'VALID_ENTRY' | 'SKIP';

export function scoreConfluence(input: ConfluenceInput) {
  const unavailable: FactorName[] = [];
  let score = 0;
  for (const name of CONFLUENCE_FACTORS) {
    const f = input?.[name];
    if (!f || !['pass', 'fail', 'unavailable'].includes(f.status)) {
      throw new AppError('INVALID_INPUT', `Missing or invalid confluence factor: ${name}`, false);
    }
    if (f.status === 'pass') score++;
    if (f.status === 'unavailable') unavailable.push(name); // never counted as a pass
  }
  const verdict: Verdict =
    score >= THRESHOLDS.full ? 'FULL_CONFLUENCE' : score >= THRESHOLDS.valid ? 'VALID_ENTRY' : 'SKIP';
  return { score, outOf: CONFLUENCE_FACTORS.length, verdict, unavailable, thresholds: THRESHOLDS, factors: input };
}
