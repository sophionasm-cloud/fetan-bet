'use strict';

// Browser-side Rocket Crash helpers, tested in Node without a DOM. These are
// display and chart functions only; the server remains authoritative.
const assert = require('node:assert/strict');
const C = require('./crash-config');
const M = require('./crash-math');
const F = require('./public/games/crash/js/format');
const CURVE = require('./public/games/crash/js/curve');

// --- Integer money formatting and parsing ---------------------------------
assert.equal(F.santimToEtb(0), '0.00');
assert.equal(F.santimToEtb(100), '1.00');
assert.equal(F.santimToEtb(123456789), '1,234,567.89');
assert.equal(F.santimToEtb(-105), '-1.05');
assert.equal(F.santimToEtb('250'), '2.50');
assert.equal(F.formatMoney(100000), '1,000.00 ETB');

assert.equal(F.parseEtbToSantim('1.00'), 100);
assert.equal(F.parseEtbToSantim('1.5'), 150);
assert.equal(F.parseEtbToSantim('1,000.25'), 100025);
assert.equal(F.parseEtbToSantim(' 10 '), 1000);
assert.equal(F.parseEtbToSantim('0.01'), 1);
assert.equal(F.parseEtbToSantim('1.'), 100);
assert.equal(F.parseEtbToSantim('1.001'), null);
assert.equal(F.parseEtbToSantim('1.234'), null);
assert.equal(F.parseEtbToSantim('-1'), null);
assert.equal(F.parseEtbToSantim('abc'), null);
assert.equal(F.parseEtbToSantim(''), null);
for (const value of ['0.01', '12.34', '999.99', '1,000.00']) {
  assert.equal(F.santimToEtb(F.parseEtbToSantim(value)), value === '0.01' ? '0.01' : value);
}
for (let santim = 0; santim <= 100000; santim += 137) {
  const text = F.santimToEtb(santim);
  assert.equal(F.parseEtbToSantim(text), santim, `round trip at ${santim}`);
}

// --- Multiplier display ----------------------------------------------------
assert.equal(F.formatMultiplier(100), '1.00\u00D7');
assert.equal(F.formatMultiplier(115), '1.15\u00D7');
assert.equal(F.formatMultiplier(1234), '12.34\u00D7');
assert.equal(F.formatMultiplier(100000), '1000.00\u00D7');
assert.equal(F.formatMultiplierNumber(248), '2.48');
assert.equal(F.formatMultiplierNumber(100000), '1000.00');
assert.equal(F.formatAxisMultiplier(100), '1.00\u00D7');
assert.equal(F.formatAxisMultiplier(199), '1.9\u00D7');
assert.equal(F.formatCountdown(6000), '6.0s');
assert.equal(F.formatCountdown(5999), '5.9s');
assert.equal(F.formatCountdown(99), '0.0s');
assert.equal(F.formatCountdown(-50), '0.0s');

assert.equal(F.shortHash('abcdef1234567890', 6, 4), 'abcdef\u20267890');
assert.equal(F.shortHash('abc'), 'abc');

// --- Chart maths stay in lock-step with the server -----------------------
assert.equal(CURVE.DEFAULT_K, C.GROWTH_K_MICRO / 1e6);
assert.equal(CURVE.MAX_HUNDREDTHS, C.MAX_HUNDREDTHS);
for (let ms = 0; ms <= 180000; ms += 211) {
  assert.equal(
    CURVE.multiplierAt(ms),
    M.multiplierHundredthsAt(ms),
    `client/server multiplier disagreement at ${ms}ms`
  );
}
assert.equal(CURVE.multiplierAt(-1), 100);
assert.equal(CURVE.multiplierAt(0), 100);
assert.equal(CURVE.multiplierAt(1e9), C.MAX_HUNDREDTHS);

let previous = 0;
for (let ms = 0; ms <= 200000; ms += 97) {
  const multiplier = CURVE.multiplierAt(ms);
  assert.ok(multiplier >= previous, 'multiplier must never decrease');
  assert.ok(multiplier >= 100 && multiplier <= C.MAX_HUNDREDTHS);
  previous = multiplier;
}

for (const crash of [101, 108, 147, 200, 293, 1000, 100000]) {
  assert.equal(
    CURVE.crashDurationMs(crash, C.GROWTH_K_MICRO / 1e6),
    M.crashDurationMs(crash),
    `client/server crash duration disagreement at ${crash}`
  );
}
assert.equal(CURVE.crashDurationMs(100), 0);
assert.equal(CURVE.crashDurationMs(50), 0);

// --- Integer payout preview ------------------------------------------------
for (let step = 0; step < 2000; step++) {
  const stake = 100 + ((step * 7919) % 99900);
  const multiplier = 101 + ((step * 104729) % 99899);
  assert.equal(CURVE.payoutSantim(stake, multiplier), M.payoutSantim(stake, multiplier));
}
assert.equal(CURVE.payoutSantim(100, 100), 100);
assert.equal(CURVE.payoutSantim(333, 248), 825, 'preview floors, never rounds');
assert.equal(CURVE.payoutSantim(0, 200), 0);
assert.equal(CURVE.payoutSantim(100, 99), 0);
assert.ok(Number.isInteger(CURVE.payoutSantim(777, 123)));

// --- Axis helpers ----------------------------------------------------------
assert.deepEqual(CURVE.yTicks(200), [100, 125, 150, 175, 200]);
assert.deepEqual(CURVE.yTicks(1000), [100, 325, 550, 775, 1000]);
assert.deepEqual(CURVE.xTicks(5), [0, 1, 2, 3, 4, 5]);
assert.deepEqual(CURVE.xTicks(20), [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
assert.ok(CURVE.yAxisTarget(248) >= 300);
assert.ok(CURVE.xAxisTarget(8000) >= 9);
assert.equal(CURVE.smoothAxis(100, 200, 0.5), 150);
assert.equal(CURVE.smoothAxis(200, 100, 0.5), 200, 'running axis never shrinks');
assert.equal(CURVE.smoothAxis(200, 100, 0.5, false), 150);
assert.equal(CURVE.smoothAxis(NaN, 200), 200);

console.log('crash-client-math.test.js OK');
