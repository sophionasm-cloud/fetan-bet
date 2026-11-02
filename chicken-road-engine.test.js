'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const engine = require('./chicken-road-engine');
const seed = Buffer.alloc(32, 7);
for (const difficulty of ['easy', 'medium', 'hard']) {
  const a = engine.makeTraffic(seed, difficulty);
  const b = engine.makeTraffic(seed, difficulty);
  assert.deepEqual(a, b, `${difficulty} schedule reproduces from the same seed`);
  assert.equal(a.length, 14);
  assert.ok(a.every((lane, i) => lane.direction === (i % 2 === 0 ? 1 : -1)));
  assert.ok(a.every((lane) => lane.speed > 0 && lane.vehicles.length >= 1));
  assert.equal(engine.crossingCollision(a, 15, 0, difficulty), null, 'finish crossing is outside vehicle lanes');
  assert.equal(engine.multiplier(difficulty, 14) > engine.multiplier(difficulty, 1), true);
}
assert.throws(() => engine.makeTraffic(crypto.randomBytes(8), 'easy'));
assert.throws(() => engine.makeTraffic(seed, 'hardcore'));
assert.throws(() => engine.crossingCollision([], 1, 0, 'easy'));
console.log('chicken-road-engine.test.js: deterministic server traffic and rule checks passed');
