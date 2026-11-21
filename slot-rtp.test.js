'use strict';

const assert = require('node:assert/strict');
const config = require('./public/games/slot/js/slot-config');
const { simulate } = require('./scripts/slot-simulate');

const result = simulate(config.SIMULATION_SPINS, config.SIMULATION_SEED);
assert.equal(result.spins, 2000000);
assert.ok(Math.abs(result.rtpPercent - config.RTP_TARGET_PERCENT) <= 0.5,
  `RTP ${result.rtpPercent}% must be within 0.5% of ${config.RTP_TARGET_PERCENT}%`);
assert.ok(result.hitRatePercent >= config.HIT_RATE_MIN_PERCENT && result.hitRatePercent <= config.HIT_RATE_MAX_PERCENT,
  `Hit rate ${result.hitRatePercent}% must be between ${config.HIT_RATE_MIN_PERCENT}% and ${config.HIT_RATE_MAX_PERCENT}%`);
assert.equal(result.totalBetSantim, result.spins * config.DEFAULT_BET_SANTIM);
assert.ok(Object.values(result.distribution.payoutBands).reduce((sum, count) => sum + count, 0) === result.spins);
console.log(`slot-rtp.test.js: ${result.spins.toLocaleString('en-US')} seeded spins, RTP ${result.rtpPercent}%, hit rate ${result.hitRatePercent}%, distribution ${JSON.stringify(result.distribution)}`);
