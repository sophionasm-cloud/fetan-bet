'use strict';

// Monetary values are integer santim. Multipliers are parsed from their
// canonical decimal representation so payout settlement never multiplies
// binary floating-point values.
function decimalFraction(value) {
  if (!Number.isFinite(Number(value)) || Number(value) < 0) {
    throw new TypeError('Multiplier must be a finite non-negative decimal');
  }

  const text = String(value).trim();
  const match = text.match(/^([+]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);
  if (!match) throw new TypeError('Multiplier must be a finite non-negative decimal');

  const whole = match[2];
  const fractional = match[3] || '';
  const exponent = Number(match[4] || 0);
  let numerator = BigInt(whole + fractional);
  let scale = fractional.length - exponent;
  if (scale < 0) {
    numerator *= 10n ** BigInt(-scale);
    scale = 0;
  }
  return { numerator, denominator: 10n ** BigInt(scale) };
}

function grossPayoutCents(stakeCents, multiplier, capCents = null) {
  if (!Number.isSafeInteger(stakeCents) || stakeCents < 0) {
    throw new TypeError('Stake must be a non-negative safe integer number of santim');
  }
  if (capCents !== null && (!Number.isSafeInteger(capCents) || capCents < 0)) {
    throw new TypeError('Payout cap must be a non-negative safe integer number of santim');
  }

  const { numerator, denominator } = decimalFraction(multiplier);
  let payout = (BigInt(stakeCents) * numerator) / denominator;
  if (capCents !== null && payout > BigInt(capCents)) payout = BigInt(capCents);
  return Number(payout);
}

function grossPayoutFromMultiplierCents(stakeCents, multiplierCents, capCents = null) {
  if (typeof multiplierCents !== 'bigint' || multiplierCents < 0n) {
    throw new TypeError('Multiplier cents must be a non-negative BigInt');
  }
  if (!Number.isSafeInteger(stakeCents) || stakeCents < 0) {
    throw new TypeError('Stake must be a non-negative safe integer number of santim');
  }
  if (capCents !== null && (!Number.isSafeInteger(capCents) || capCents < 0)) {
    throw new TypeError('Payout cap must be a non-negative safe integer number of santim');
  }

  let payout = (BigInt(stakeCents) * multiplierCents) / 100n;
  if (capCents !== null && payout > BigInt(capCents)) payout = BigInt(capCents);
  return Number(payout);
}

function netWinningsCents(grossCents, stakeCents) {
  if (!Number.isSafeInteger(grossCents) || grossCents < 0 ||
      !Number.isSafeInteger(stakeCents) || stakeCents < 0) {
    throw new TypeError('Gross payout and stake must be non-negative safe integers');
  }
  return grossCents - stakeCents;
}

module.exports = { decimalFraction, grossPayoutCents, grossPayoutFromMultiplierCents, netWinningsCents };
