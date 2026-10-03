import { AppError } from '../errors.js';

// From analisa-xauusd
export const RISK_RULES = {
  maxRiskPercent: 2,
  partialTp1Percent: 40,
  moveToBreakevenAfterPips: 20,
  maxOpenPositions: 3,
  stopAfterConsecutiveLosses: 3,
} as const;
export const MIN_RR = { scalp: 1.5, intraday: 2, swing: 3 } as const;

export type TradeStyle = keyof typeof MIN_RR;
export type Direction = 'buy' | 'sell';

export type RiskInput = {
  direction: Direction;
  style: TradeStyle;
  entry: number;
  stopLoss: number;
  takeProfits: number[]; // 1 to 3 prices, ordered away from entry
  pipSize: number; // price units per pip: required, no default
  accountBalance?: number;
  riskPercent?: number;
  contractSize?: number; // ounces per lot, broker specific
};

const round = (v: number, d: number): number => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};
const bad = (message: string): never => {
  throw new AppError('INVALID_INPUT', message, false);
};
const pos = (v: unknown, name: string): number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : bad(`${name} must be a positive number`);

function sizing(i: RiskInput, riskDistance: number) {
  if (i.riskPercent !== undefined) {
    const rp = pos(i.riskPercent, 'riskPercent');
    if (rp > RISK_RULES.maxRiskPercent) bad(`riskPercent must not exceed ${RISK_RULES.maxRiskPercent}`);
  }
  if (i.accountBalance === undefined || i.riskPercent === undefined || i.contractSize === undefined) {
    return {
      available: false as const,
      reason: 'accountBalance, riskPercent and contractSize are all required',
    };
  }
  const balance = pos(i.accountBalance, 'accountBalance');
  const rp = pos(i.riskPercent, 'riskPercent');
  const contractSize = pos(i.contractSize, 'contractSize');
  const riskAmount = (balance * rp) / 100;
  const lots = Math.floor((riskAmount / (riskDistance * contractSize)) * 100 + 1e-9) / 100;
  return {
    available: true as const,
    approximate: true,
    riskAmount: round(riskAmount, 2),
    lots,
    assumptions: [
      'account currency equals the quote currency (USD)',
      'lots = riskAmount / (stopDistancePrice * contractSize), rounded down to 0.01',
      'spread, commission and slippage are not included',
    ],
  };
}

export function buildRiskPlan(i: RiskInput) {
  if (i.direction !== 'buy' && i.direction !== 'sell') bad('direction must be buy or sell');
  if (!(i.style in MIN_RR)) bad('style must be scalp, intraday or swing');
  const entry = pos(i.entry, 'entry');
  const sl = pos(i.stopLoss, 'stopLoss');
  const pipSize = pos(i.pipSize, 'pipSize');
  if (!Array.isArray(i.takeProfits) || i.takeProfits.length < 1 || i.takeProfits.length > 3) {
    bad('takeProfits must contain 1 to 3 prices');
  }
  const tps = i.takeProfits.map((p, k) => pos(p, `takeProfits[${k}]`));
  const buy = i.direction === 'buy';
  if (buy ? !(sl < entry) : !(sl > entry)) bad('stopLoss must be on the losing side of entry');
  tps.forEach((tp, k) => {
    if (buy ? !(tp > entry) : !(tp < entry)) bad(`takeProfits[${k}] must be on the winning side of entry`);
    if (k > 0 && (buy ? !(tp > tps[k - 1]) : !(tp < tps[k - 1]))) bad('takeProfits must be ordered away from entry');
  });

  const riskDistance = Math.abs(entry - sl);
  const targets = tps.map((price, k) => ({
    label: `TP${k + 1}`,
    price,
    pips: round(Math.abs(price - entry) / pipSize, 1),
    rr: round(Math.abs(price - entry) / riskDistance, 2),
  }));
  const final = targets[targets.length - 1];
  const minimum = MIN_RR[i.style];
  const beDelta = RISK_RULES.moveToBreakevenAfterPips * pipSize;

  return {
    analyticalOnly: true,
    direction: i.direction,
    style: i.style,
    entry,
    stopLoss: sl,
    pipSize,
    stopDistance: { price: round(riskDistance, 3), pips: round(riskDistance / pipSize, 1) },
    takeProfits: targets,
    partialAtTp1Percent: RISK_RULES.partialTp1Percent,
    breakeven: {
      afterPips: RISK_RULES.moveToBreakevenAfterPips,
      triggerPrice: round(buy ? entry + beDelta : entry - beDelta, 3),
    },
    rr: { final: final.rr, minimum, meetsMinimum: final.rr >= minimum, evaluatedOn: final.label },
    positionSizing: sizing(i, riskDistance),
    rules: { ...RISK_RULES },
  };
}
