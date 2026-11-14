'use strict';

// Static verification for B2B Bomber's 40% RTP model. No database required.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const m = require('./b2b-bomber-math');

const SEED = '00'.repeat(32);
const SEED_ASC = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';

// Deterministic vectors, independently recomputed before being committed here.
const VECTORS = [
  { seed: SEED_ASC, client: 'b2b-test', nonce: '1', h: '5ca0bd0894f21a066d854291db62131117b8d06c830b9fba8a661dcf764ed37e', crash: 100 },
  { seed: SEED, client: 'vector', nonce: '10', h: 'bbdc2d4dc5546beb9f4161327fb43f74d2022e1b29bab116197ed926f69f849d', crash: 150 },
  { seed: SEED, client: 'vector', nonce: '2782', h: 'ccfcee3dddd352e04cf6ae0e6b29eecf9d76fd22d1b6e958ac86b2dfc9e2ed80', crash: 200 },
  { seed: SEED, client: 'vector', nonce: '9945', h: 'eb8a6d48a77a32cbd63454bb0d9b0e76423bf19fa22dca398f8703c93c96d667', crash: 500 },
  { seed: SEED, client: 'vector', nonce: '13224', h: 'f5c351da8f5bd186d75fa48ceb01fd2f03dca35ea45089ca5a6f9fc6070ad22d', crash: 1000 },
];

for (const v of VECTORS) {
  const got = m.crashFromSeed(v.seed, v.client, v.nonce);
  assert.equal(got.uniform_hex, v.h, `uniform vector ${v.nonce}`);
  assert.equal(got.crash_hundredths, v.crash, `crash vector ${v.nonce}`);
}

// Commitment is SHA-256 of the raw 32-byte seed, not of the hex text.
const seedBytes = Buffer.from(SEED_ASC, 'hex');
assert.equal(m.commitServerSeed(SEED_ASC), crypto.createHash('sha256').update(seedBytes).digest('hex'));
assert.equal(m.commitServerSeed(seedBytes), m.commitServerSeed(SEED_ASC));
assert.throws(() => m.commitServerSeed('not-a-seed'), /64 hex/);

// The multiplier is clamped at both ends.
assert.equal(m.crashHundredthsFromUniform(0n), 100);
assert.equal(m.crashHundredthsFromUniform((1n << 256n) - 1n), 10000);
assert.throws(() => m.crashHundredthsFromUniform(1n << 256n), /256-bit/);
assert.throws(() => m.crashHundredthsFromUniform(-1n), /256-bit/);

// Exact reach counts: for X > 100, count = floor(40N / X).
for (const x of [101, 102, 150, 200, 500, 1000, 5000, 10000]) {
  const count = m.reachCount(x);
  assert.equal(count, (40n * (1n << 256n)) / BigInt(x), `reach count ${x}`);
  assert.ok(count > 0n && count <= (1n << 256n));
  assert.ok(count * BigInt(x) <= 40n * (1n << 256n));
  assert.ok((count + 1n) * BigInt(x) > 40n * (1n << 256n));
}
assert.equal(m.reachCount(100), 1n << 256n);
assert.equal(m.reachCount(10001), 0n);

// Published probability examples. Deviation from 40/X is bounded below 1/N.
assert.match(m.probabilityPercent(150), /^26\.66666/);
assert.match(m.probabilityPercent(200), /^19\.99999/);
assert.match(m.probabilityPercent(500), /^7\.99999/);
assert.match(m.probabilityPercent(1000), /^3\.99999/);
assert.match(m.probabilityPercent(5000), /^0\.79999/);
assert.match(m.probabilityPercent(10000), /^0\.39999/);

// Immediate 1.00x crash probability is 1 - floor(40N/101)/N.
const immediate = m.ratioToDecimal(m.immediateCrashCount() * 100n, m.UNIFORM_SPACE, 10);
assert.equal(immediate, '60.3960396039');

// Payouts are integer santim and always floor.
assert.equal(m.payoutSantim(100, 150), 150);
assert.equal(m.payoutSantim(100, 101), 101);
assert.equal(m.payoutSantim(12345, 150), 18517);
assert.equal(m.payoutSantim(12345, 101), 12468);
assert.equal(m.payoutSantim(100000, 10000), 10000000);
assert.throws(() => m.payoutSantim(100.5, 200), /safe integer/);
assert.throws(() => m.payoutSantim(100, 200.5), /safe integer/);

// Exact expected RTP. At a 100-santim stake the floor disappears and RTP is
// 0.4 minus at most 1/N per target. At arbitrary stakes the floor can only
// reduce RTP, never increase it.
for (const x of [101, 150, 200, 500, 1000, 5000, 10000]) {
  const rtp100 = m.expectedRtp(100, x);
  const ratio100 = m.ratioToDecimal(rtp100.numerator, rtp100.denominator, 14);
  assert.match(ratio100, /^0\.39999999999/, `RTP at ${x} must be 40% minus a negligible discrete term`);
  const rtpOdd = m.expectedRtp(12345, x);
  const ratioOdd = m.ratioToDecimal(rtpOdd.numerator, rtpOdd.denominator, 14);
  assert.ok(Number(ratioOdd) <= 0.4, `RTP at ${x} must never exceed 40%`);
  assert.ok(Number(ratioOdd) >= 0.3999, `RTP at ${x} must stay within rounding distance of 40%`);
}
assert.equal(m.expectedRtp(50000, 200).numerator, 100000n * m.reachCount(200));

// The 100x cap does not change reach probability at or below the cap; it only
// forbids targets above it.
assert.equal(m.reachCount(10000), (40n * (1n << 256n)) / 10000n);
assert.equal(m.reachCount(10001), 0n);

// Flight presentation: 2x is reached at exactly 7 seconds; a 150x crash cannot
// be displayed as successful at the crash instant.
assert.equal(m.flightDurationMs(100), 0);
assert.equal(m.flightDurationMs(200), 7000);
assert.equal(m.flightDurationMs(10000), 46507);
assert.equal(m.multiplierHundredthsAtElapsed(7000), 200);
assert.equal(m.multiplierHundredthsAtElapsed(0), 100);
assert.equal(m.currentHundredths(Date.now(), Date.now() - 1, 150), 100);
assert.equal(m.currentHundredths(Date.now() + 100000, Date.now() - 100, 150), 150);

// The final reachable multiplier is visible for one 0.01x tick before the
// crash. This is what makes a manual cash-out at exactly X succeed whenever
// crash >= X, preserving the 40/X proof for manual and automatic play.
const t150 = m.flightDurationMs(150);
const crash150 = m.crashAfterMs(150);
assert.ok(crash150 > t150, 'crash occurs after the final 1.50x tick');
assert.equal(m.currentHundredths(t150, 0, 150), 150);
assert.equal(m.currentHundredths(t150 + 1, 0, 150), 150);
assert.ok(t150 + 1 < crash150);
assert.equal(m.currentHundredths(crash150, 0, 150), 150);
assert.equal(m.crashAfterMs(100), m.timeToHundredths(101));
assert.equal(m.flightDurationMs(100), 0);

// Validation helpers.
assert.equal(m.isValidBet(100), true);
assert.equal(m.isValidBet(100000), true);
assert.equal(m.isValidBet(99), false);
assert.equal(m.isValidBet(100001), false);
assert.equal(m.isValidAutoTarget(101), true);
assert.equal(m.isValidAutoTarget(100), false);
assert.equal(m.isValidAutoTarget(10001), false);

// Statistical sanity check only. This is sampling, not proof; the exact
// counts above are the proof.
let instant = 0;
const samples = 100000;
for (let i = 0; i < samples; i++) {
  const h = BigInt('0x' + crypto.createHash('sha256').update(String(i)).digest('hex'));
  if (m.crashHundredthsFromUniform(h) === 100) instant++;
}
const sampled = (instant / samples) * 100;
assert.ok(sampled > 59.5 && sampled < 61.3, `sampled instant crash ${sampled.toFixed(3)}% should be near 60.4%`);

console.log(`B2B Bomber math OK: ${VECTORS.length} vectors, RTP 40.000000% nominal, immediate crash ${immediate}%, sample ${sampled.toFixed(3)}%`);
