'use strict';

// Chicken Road 2.0 configuration.
//
// The multiplier table and the probability table are intentionally stored as
// two separate configurations. The probability values are cumulative
// probabilities of reaching each configured level from the start of the
// round. They are NOT the conditional chance of surviving just the next hop;
// that value is derived by dividing successive cumulative probabilities.
//
// Playable levels are the multiplier rows only. Easy has 15 playable levels
// (table lines 1,3,...,29). Medium and Hard each have 9 playable levels
// (table lines 1,3,...,17). Medium also has two probability-only rows
// (lines 19 and 21) which are retained for completeness and are never used
// for play or payout because no approved multiplier exists for them.

const { grossPayoutFromMultiplierCents } = require('./payout');

const CONFIG_VERSION = 2;
const ENGINE_VERSION = 2;
const PROBABILITY_VERSION = 2;
const PAYOUT_VERSION = 2;

// 1e9 parts per billion represents 100% (1.0); 1e7 ppb represents 1%.
const PROBABILITY_SCALE = 1_000_000_000;
const UNIFORM_SCALE = 0x100000000;

function freezeMode(mode) {
  const frozen = {
    label: mode.label,
    lanes: mode.lanes,
    lines: Object.freeze([...mode.lines]),
    multipliers: Object.freeze([...mode.multipliers]),
    multiplierCents: Object.freeze(mode.multipliers.map((value) => {
      if (!/^\d+\.\d{2}$/.test(value)) throw new Error(`Invalid exact multiplier: ${value}`);
      const [whole, fraction] = value.split('.');
      return BigInt(whole) * 100n + BigInt(fraction);
    })),
    cumulativeProbabilityPpb: Object.freeze([...mode.cumulativeProbabilityPpb]),
    probabilityLines: Object.freeze([...(mode.probabilityLines || mode.lines)]),
  };

  if (frozen.lines.length !== frozen.lanes) throw new Error(`${mode.label}: playable line count mismatch`);
  if (frozen.multipliers.length !== frozen.lanes) throw new Error(`${mode.label}: multiplier count mismatch`);
  if (frozen.cumulativeProbabilityPpb.length !== frozen.probabilityLines.length) {
    throw new Error(`${mode.label}: probability row count mismatch`);
  }
  if (frozen.cumulativeProbabilityPpb.length < frozen.lanes) {
    throw new Error(`${mode.label}: missing playable probability rows`);
  }

  for (let i = 0; i < frozen.probabilityLines.length; i++) {
    const line = frozen.probabilityLines[i];
    if (!Number.isInteger(line) || line < 1 || line % 2 !== 1) throw new Error(`${mode.label}: invalid line ${line}`);
    if (i > 0 && line <= frozen.probabilityLines[i - 1]) throw new Error(`${mode.label}: lines must increase`);
    const probability = frozen.cumulativeProbabilityPpb[i];
    if (!Number.isSafeInteger(probability) || probability <= 0 || probability > PROBABILITY_SCALE) {
      throw new Error(`${mode.label}: invalid cumulative probability at line ${line}`);
    }
    if (i > 0 && probability >= frozen.cumulativeProbabilityPpb[i - 1]) {
      throw new Error(`${mode.label}: cumulative probabilities must decrease at line ${line}`);
    }
  }

  return Object.freeze(frozen);
}

const MODES = Object.freeze({
  easy: freezeMode({
    label: 'Easy',
    lanes: 15,
    lines: [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29],
    multipliers: ['1.01', '1.06', '1.15', '1.24', '1.35', '1.48', '1.65', '1.85', '2.12', '2.47', '2.96', '3.70', '4.64', '6.50', '12.08'],
    cumulativeProbabilityPpb: [
      297_000_000, 283_000_000, 260_900_000, 241_900_000, 222_200_000,
      202_700_000, 181_800_000, 162_200_000, 141_500_000, 121_500_000,
      101_400_000, 81_100_000, 64_700_000, 46_200_000, 24_800_000,
    ],
  }),
  medium: freezeMode({
    label: 'Medium',
    lanes: 9,
    lines: [1, 3, 5, 7, 9, 11, 13, 15, 17],
    multipliers: ['1.18', '1.83', '2.95', '5.02', '9.04', '17.74', '38.71', '67.34', '305.94'],
    // Lines 19 and 21 are probability-only rows; they have no approved
    // multiplier and are therefore not playable.
    probabilityLines: [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21],
    cumulativeProbabilityPpb: [
      254_200_000, 163_900_000, 101_700_000, 59_800_000, 33_200_000,
      16_900_000, 7_800_000, 3_100_000, 1_000_000, 200_000, 30_000,
    ],
  }),
  hard: freezeMode({
    label: 'Hard',
    lanes: 9,
    lines: [1, 3, 5, 7, 9, 11, 13, 15, 17],
    multipliers: ['1.44', '3.45', '9.09', '26.78', '92.54', '391.25', '2235.72', '18960.33', '379632.82'],
    cumulativeProbabilityPpb: [
      208_300_000, 87_000_000, 33_000_000, 11_200_000, 3_200_000,
      770_000, 130_000, 16_000, 790,
    ],
  }),
});

function modeConfig(difficulty) {
  const mode = MODES[String(difficulty || '').toLowerCase()];
  if (!mode) throw new Error('INVALID');
  return mode;
}

function multiplierForLevel(difficulty, step) {
  const mode = modeConfig(difficulty);
  if (!Number.isInteger(step) || step < 1 || step > mode.lanes) throw new Error('INVALID');
  return mode.multipliers[step - 1];
}

function multiplierCentsForLevel(difficulty, step) {
  const mode = modeConfig(difficulty);
  if (!Number.isInteger(step) || step < 1 || step > mode.lanes) throw new Error('INVALID');
  return mode.multiplierCents[step - 1];
}

// Survival for level n (1-based) is S(n) / S(n-1), with S(0) = 1.
function conditionalSurvivalForLevel(difficulty, step) {
  const mode = modeConfig(difficulty);
  if (!Number.isInteger(step) || step < 1 || step > mode.lanes) throw new Error('INVALID');
  const numerator = mode.cumulativeProbabilityPpb[step - 1];
  const denominator = step === 1 ? PROBABILITY_SCALE : mode.cumulativeProbabilityPpb[step - 2];
  return { numerator, denominator };
}

// Exact integer comparison of uniform32 / 2^32 < numerator / denominator.
function survivesStep(numerator, denominator, uniform32) {
  if (!Number.isSafeInteger(uniform32) || uniform32 < 0 || uniform32 >= UNIFORM_SCALE) {
    throw new TypeError('Expected a 32-bit unsigned uniform value');
  }
  return BigInt(uniform32) * BigInt(denominator) < BigInt(numerator) * BigInt(UNIFORM_SCALE);
}

function payoutFor(stakeSantim, multiplierCents) {
  if (!Number.isSafeInteger(stakeSantim) || stakeSantim < 0) throw new TypeError('Stake must be a non-negative safe integer');
  const payout = grossPayoutFromMultiplierCents(stakeSantim, multiplierCents);
  if (!Number.isSafeInteger(payout)) throw new Error('PAYOUT_LIMIT');
  return payout;
}

// Format a ppb integer as an exact percentage string without floating point.
function percentFromPpb(ppb) {
  if (!Number.isSafeInteger(ppb) || ppb < 0) throw new TypeError('Probability must be a non-negative safe integer');
  const whole = Math.floor(ppb / 10_000_000);
  let fraction = String(ppb % 10_000_000).padStart(7, '0').replace(/0+$/, '');
  if (fraction.length < 2) fraction = fraction.padEnd(2, '0');
  return fraction ? `${whole}.${fraction}%` : `${whole}%`;
}

function publicConfiguration(difficulty) {
  const mode = modeConfig(difficulty);
  return {
    difficulty,
    label: mode.label,
    lanes: mode.lanes,
    lines: [...mode.lines],
    multipliers: [...mode.multipliers],
    multiplier_cents: mode.multiplierCents.map(String),
    cumulative_probability_ppb: mode.cumulativeProbabilityPpb.slice(0, mode.lanes),
    cumulative_probability_pct: mode.cumulativeProbabilityPpb.slice(0, mode.lanes).map(percentFromPpb),
    probability_only_lines: mode.probabilityLines.slice(mode.lanes).map((line, index) => ({
      line,
      cumulative_probability_ppb: mode.cumulativeProbabilityPpb[mode.lanes + index],
      cumulative_probability_pct: percentFromPpb(mode.cumulativeProbabilityPpb[mode.lanes + index]),
    })),
    engine_version: ENGINE_VERSION,
    probability_version: PROBABILITY_VERSION,
    payout_version: PAYOUT_VERSION,
    config_version: CONFIG_VERSION,
  };
}

module.exports = {
  CONFIG_VERSION,
  ENGINE_VERSION,
  PROBABILITY_VERSION,
  PAYOUT_VERSION,
  PROBABILITY_SCALE,
  UNIFORM_SCALE,
  MODES,
  modeConfig,
  multiplierForLevel,
  multiplierCentsForLevel,
  conditionalSurvivalForLevel,
  survivesStep,
  payoutFor,
  percentFromPpb,
  publicConfiguration,
};
