'use strict';

const assert = require('node:assert/strict');
const { decimalFraction, grossPayoutCents, grossPayoutFromMultiplierCents, netWinningsCents } = require('./payout');

assert.deepEqual(decimalFraction(34.04), { numerator: 3404n, denominator: 100n });
assert.equal(grossPayoutCents(100, 1.14), 114);
assert.equal(grossPayoutCents(101, 1.89), 190); // floor 190.89 santim
assert.equal(grossPayoutCents(100, 3.71), 371);
assert.equal(grossPayoutCents(100000, 34.04), 3404000);
assert.equal(grossPayoutCents(100000, 1000, 100000000), 100000000);
assert.equal(grossPayoutCents(100000, 1001, 100000000), 100000000);
assert.equal(grossPayoutFromMultiplierCents(100, 114n), 114);
assert.equal(grossPayoutFromMultiplierCents(101, 189n), 190);
assert.equal(netWinningsCents(114, 100), 14);
assert.equal(netWinningsCents(100, 100), 0);
assert.equal(netWinningsCents(0, 100), -100);
assert.throws(() => grossPayoutCents(1.5, 1), /Stake/);
assert.throws(() => grossPayoutCents(100, -1), /Multiplier/);

console.log('payout.test.js: all integer-santim settlement checks passed');
