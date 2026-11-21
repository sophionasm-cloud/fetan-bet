'use strict';

const assert = require('node:assert/strict');
const config = require('./public/games/slot/js/slot-config');
const math = require('./public/games/slot/js/slot-math');

assert.equal(config.GAME_SLUG, 'slot');
assert.equal(config.REELS.length, 5);
assert.equal(config.PAYLINES.length, 10);
assert.ok(config.PAYLINES.every((line) => line.length === 5 && line.every((row) => row >= 0 && row < 3)));
for (const reel of config.REELS) {
  assert.equal(reel.strip.length, config.REEL_STOP_COUNT);
  for (const symbol of config.SYMBOLS) {
    assert.equal(reel.strip.filter((entry) => entry === symbol.id).length, reel.weights[symbol.id]);
  }
}

assert.deepEqual(math.gridFromStops([0, 1, 2, 3, 4]).map((row) => row.length), [5, 5, 5]);
assert.throws(() => math.gridFromStops([0, 1, 2, 3]), /INVALID_STOPS/);
assert.throws(() => math.evaluateGrid([['bad']], 100), /INVALID_GRID/);
assert.equal(math.isValidBet(100), true);
assert.equal(math.isValidBet(99), false);
assert.equal(math.isValidBet(100000.5), false);

const horizontal = Array.from({ length: 3 }, () => ['wild', 'heart', 'wild', 'heart', 'heart']);
assert.deepEqual(math.evaluateGrid(horizontal, 101).wins[0], { line: 1, symbol: 'heart', count: 5, payout: 2533 });
const wildOnly = Array.from({ length: 3 }, () => Array(5).fill('wild'));
const jackpot = math.evaluateGrid(wildOnly, 100);
assert.equal(jackpot.wins.length, 5);
assert.equal(jackpot.totalPayout, 100000);
assert.equal(Number.isInteger(jackpot.totalPayout), true);
assert.ok(jackpot.totalPayout <= 100 * config.MAX_WIN_MULTIPLIER);

console.log('slot-math.test.js: paylines, wild substitution, integer payouts and cap passed');
