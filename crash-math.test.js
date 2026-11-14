'use strict';

// Deterministic tests for the Rocket Crash math and fairness formula.
// Run with: node crash-math.test.js
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const C = require('./crash-config');
const M = require('./crash-math');

const seedA = '00'.repeat(32);
const seedB = '11'.repeat(32);
const seedC = 'ab'.repeat(32);

// --- Normative seed hashes -------------------------------------------------
assert.equal(M.serverSeedHash(seedA), '60e05bd1b195af2f94112fa7197a5c88289058840ce7c6df9693756bc6250f55');
assert.equal(M.serverSeedHash(seedB), '3138bb9bc78df27c473ecfd1410f7bd45ebac1f59cf3ff9cfe4db77aab7aedd3');
assert.equal(M.serverSeedHash(seedC), '271a413bd339c5709fdceaec41f14f11e9fbfb5042d72d331c65f32b284cd09a');

// --- Normative crash vectors ----------------------------------------------
const vectors = [
  [seedA, 'client-seed-1', 1, 1780449004463526n, 160],
  [seedA, 'client-seed-1', 2, 492412625740326n, 108],
  [seedB, 'client-seed-1', 1, 3016689934302982n, 293],
  [seedB, 'fetan', 7, 2072394246040949n, 179],
  [seedC, 'fetan', 1, 1532811713580661n, 147],
  [seedC, 'fetan', 1000, 1113684506073514n, 128]
];

for (const [serverSeed, clientSeed, nonce, expectedX, expectedCrash] of vectors) {
  const message = `${clientSeed}:${nonce}`;
  const hmac = crypto.createHmac('sha256', Buffer.from(serverSeed, 'utf8'))
    .update(message, 'utf8')
    .digest('hex');
  const x = BigInt('0x' + hmac.slice(0, 13));
  assert.equal(x, expectedX, `X mismatch for ${clientSeed}:${nonce}`);
  assert.equal(M.crashPointFromX(x), expectedCrash);
  assert.equal(
    M.crashPointHundredths({ serverSeed, clientSeed, nonce }),
    expectedCrash,
    `crash mismatch for ${clientSeed}:${nonce}`
  );
  assert.equal(M.hmacForRound(serverSeed, clientSeed, nonce), hmac);
}

// The key is the seed as UTF-8 text, not the decoded bytes.
const utf8Hmac = crypto.createHmac('sha256', Buffer.from(seedC, 'utf8'))
  .update('fetan:42', 'utf8').digest('hex');
assert.equal(M.hmacForRound(seedC, 'fetan', 42), utf8Hmac);

// --- Clamping --------------------------------------------------------------
assert.equal(M.crashPointFromX(0n), 100, 'raw below 100 clamps to 1.00x');
assert.equal(M.crashPointFromX(M.TWO_52 - 1n), 100000, 'raw above cap clamps to max');
assert.equal(M.crashPointFromX(0n, { maxHundredths: 500 }), 100);
assert.equal(M.crashPointFromX(M.TWO_52 - 1n, { maxHundredths: 500 }), 500);
for (let i = 0; i < 5000; i++) {
  const value = M.crashPointFromX(BigInt(i) * 900719925474n % M.TWO_52);
  assert.ok(value >= 100 && value <= C.MAX_HUNDREDTHS, 'crash point inside bounds');
}

// --- Multiplier and crash duration ----------------------------------------
assert.equal(M.multiplierHundredthsAt(0), 100);
assert.equal(M.multiplierHundredthsAt(-5), 100);
let previous = 0;
for (let ms = 0; ms <= 120000; ms += 17) {
  const m = M.multiplierHundredthsAt(ms);
  assert.ok(m >= previous, `multiplier must not decrease at ${ms}ms`);
  previous = m;
}
assert.ok(M.multiplierHundredthsAt(8000) >= 200, '2.00x is reached around 8s');
assert.ok(M.multiplierHundredthsAt(8000) <= 201, '2.00x is not reached early');
assert.ok(M.multiplierHundredthsAt(26000) >= 950, 'about 10x around 26s');

assert.equal(M.crashDurationMs(100), 0);
for (const crash of [101, 108, 128, 147, 160, 200, 293, 1000, 100000]) {
  const duration = M.crashDurationMs(crash);
  const at = M.multiplierHundredthsAt(duration);
  // Rounding t_crash to whole milliseconds moves a 1000x multiplier by ~9
  // hundredths, so allow one millisecond of growth plus integer floor.
  const tolerance = Math.ceil((crash * C.GROWTH_K_MICRO) / 1e6 / 1000) + 1;
  assert.ok(Math.abs(at - crash) <= tolerance, `t_crash round trip for ${crash} (got ${at})`);
  const before = M.multiplierHundredthsAt(Math.max(0, duration - 50));
  assert.ok(before < crash, `multiplier below crash before t_crash for ${crash}`);
}

// --- Integer payout --------------------------------------------------------
assert.equal(M.payoutSantim(100, 100), 100);
assert.equal(M.payoutSantim(300, 115), 345);
assert.equal(M.payoutSantim(333, 248), 825, 'payout floors, never rounds');
assert.equal(M.payoutSantim(100000, 99999), C.MAX_WIN_SANTIM, 'payout cap applies');
assert.ok(Number.isInteger(M.payoutSantim(777, 123)));
assert.throws(() => M.payoutSantim(1.5, 200), /INVALID_STAKE/);
assert.throws(() => M.payoutSantim(100, 199.5), /INVALID_MULTIPLIER/);

// --- Input validation ------------------------------------------------------
assert.equal(M.validateStake(100), 100);
assert.equal(M.validateStake(100000), 100000);
assert.throws(() => M.validateStake(99), /INVALID_STAKE/);
assert.throws(() => M.validateStake(100001), /INVALID_STAKE/);
assert.throws(() => M.validateStake('100'), /INVALID_STAKE/);
assert.equal(M.validatePanel(1), 1);
assert.throws(() => M.validatePanel(3), /INVALID_PANEL/);
assert.throws(() => M.validatePanel('1'), /INVALID_PANEL/);
assert.equal(M.validateAutoCashout(null), null);
assert.equal(M.validateAutoCashout(101), 101);
assert.throws(() => M.validateAutoCashout(100), /INVALID_AUTO_CASHOUT/);
assert.throws(() => M.validateAutoCashout(1.5), /INVALID_AUTO_CASHOUT/);
assert.equal(M.validateRequestId('abcd1234'), 'abcd1234');
assert.throws(() => M.validateRequestId('short'), /INVALID_REQUEST/);
assert.throws(() => M.validateRequestId('bad space here'), /INVALID_REQUEST/);
assert.throws(() => M.validateRequestId('x'.repeat(65)), /INVALID_REQUEST/);

// --- Deterministic statistical check (200,000 seeded rounds) --------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0x5eed1234);
const hex32 = () => Math.floor(rand() * 0x100000000).toString(16).padStart(8, '0');
const seed64 = () => hex32() + hex32() + hex32() + hex32() + hex32() + hex32() + hex32() + hex32();
const seed32 = () => hex32() + hex32() + hex32() + hex32();

const N = 200000;
let atLeast2x = 0;
let instantCrash = 0;
let botReturn = 0n;
for (let i = 1; i <= N; i++) {
  const crash = M.crashPointHundredths({
    serverSeed: seed64(),
    clientSeed: seed32(),
    nonce: i
  });
  assert.ok(crash >= 100 && crash <= C.MAX_HUNDREDTHS);
  if (crash >= 200) {
    atLeast2x++;
    botReturn += BigInt(M.payoutSantim(100, 200));
  } else if (crash === 100) {
    instantCrash++;
  }
}
const rtp = Number(botReturn) / (100 * N);
const p2 = atLeast2x / N;
const pInstant = instantCrash / N;
assert.ok(Math.abs(rtp - 0.972) <= 0.012, `2.00x bot RTP ${rtp.toFixed(4)} outside 97.2% +/-1.2%`);
assert.ok(Math.abs(p2 - 0.486) <= 0.008, `P(crash >= 2.00x) ${p2.toFixed(4)} outside 48.6% +/-0.8%`);
assert.ok(Math.abs(pInstant - 0.0396) <= 0.006, `P(instant 1.00x) ${pInstant.toFixed(4)} outside expected range`);

console.log('crash-math.test.js OK');
console.log(`  vectors: 6, seed hashes: 3, simulated rounds: ${N}`);
console.log(`  2.00x bot RTP: ${(rtp * 100).toFixed(2)}% | P(>=2.00x): ${(p2 * 100).toFixed(2)}% | P(1.00x): ${(pInstant * 100).toFixed(2)}%`);
