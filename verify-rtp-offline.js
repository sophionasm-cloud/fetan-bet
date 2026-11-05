'use strict';
// Offline RTP verification against the actual games.js implementation.
// No database access required: all payout functions are pure math.
const assert = require('assert');
const games = require('./games');
const { grossPayoutCents, grossPayoutFromMultiplierCents } = require('./payout');

const TARGET = 0.30;
const MIN_BET = games.MIN_BET;
const MAX_BET = games.MAX_BET;
const close = (a, b, tol) => Math.abs(a - b) <= tol;

function choose(n, k) {
  if (k < 0 || k > n) return 0n;
  const take = Math.min(k, n - k);
  let v = 1n;
  for (let i = 1; i <= take; i++) v = (v * BigInt(n - take + i)) / BigInt(i);
  return v;
}

// ---------------- Roulette ----------------
const rStraight = (1 / 37) * games.ROULETTE_MULTIPLIERS.number;
const rOutside = (18 / 37) * games.ROULETTE_MULTIPLIERS.outside;
console.log('Roulette straight:', rStraight.toFixed(6), 'outside:', rOutside.toFixed(6));
assert.ok(close(rStraight, TARGET, 1e-12), 'roulette straight RTP');
assert.ok(close(rOutside, 0.3016216216216216, 1e-12), 'roulette outside RTP');

// ---------------- Star Spin ----------------
const symbols = games.SYMBOLS;
let weightedReturn = 0;
for (const [a, , wa] of symbols) for (const [b, , wb] of symbols) for (const [c, , wc] of symbols) {
  const names = [a, b, c];
  const normal = names.filter((n) => n !== 'wild');
  let mult = 0;
  if (normal.length === 0) mult = games.PAY3.wild;
  else if (normal.every((n) => n === normal[0])) mult = games.PAY3[normal[0]];
  else if (names.filter((n) => n === 'cherry' || n === 'wild').length >= 2) mult = games.STAR_REFUND_MULTIPLIER;
  weightedReturn += wa * wb * wc * mult;
}
const starRtp = weightedReturn / 1_000_000;
console.log('Star RTP:', starRtp.toFixed(7));
assert.ok(close(starRtp, 0.3005241, 1e-12), 'star RTP');

// ---------------- Road Dash ----------------
for (const difficulty of Object.keys(games.ROAD_CONFIG.difficulties)) {
  const ladder = games.getLadder(difficulty);
  const cfg = games.ROAD_CONFIG.difficulties[difficulty];
  let minRtp = 1, maxRtp = 0, survival = 1;
  for (let i = 0; i < ladder.length; i++) {
    const crash = Math.min(0.99, cfg.p0 + cfg.step * i);
    survival *= 1 - crash;
    const rtp = survival * ladder[i];
    minRtp = Math.min(minRtp, rtp);
    maxRtp = Math.max(maxRtp, rtp);
  }
  console.log(`Road ${difficulty}: RTP range [${minRtp.toFixed(4)}, ${maxRtp.toFixed(4)}]`);
  assert.ok(minRtp >= 0.2960 && maxRtp <= 0.3027, `road ${difficulty} RTP range`);
}

// ---------------- Mines ----------------
let minesMin = 1, minesMax = 0, capMin = 0, capMax = 0;
for (const grid of games.MINES_GRIDS) {
  const N = grid * grid;
  for (let M = 1; M < N; M++) {
    for (let k = 1; k <= N - M; k++) {
      const cents = games.getMinesMultiplierCents(N, M, k);
      const prob = Number(choose(N - M, k)) / Number(choose(N, k));
      const rtp = prob * Number(cents) / 100;
      minesMin = Math.min(minesMin, rtp);
      minesMax = Math.max(minesMax, rtp);
      for (const stake of [MIN_BET, MAX_BET]) {
        const capped = grossPayoutFromMultiplierCents(stake, cents, games.MINES_MAX_WIN);
        const uncapped = grossPayoutFromMultiplierCents(stake, cents);
        if (capped !== uncapped) {
          if (stake === MIN_BET) capMin++;
          if (stake === MAX_BET) capMax++;
        }
      }
    }
  }
}
console.log(`Mines RTP range [${minesMin.toFixed(4)}, ${minesMax.toFixed(4)}], caps: min=${capMin} max=${capMax}`);
assert.ok(minesMin >= 0.296 && minesMax <= 0.3045, 'mines RTP range');
assert.equal(capMin, 1427, 'mines cap at min stake');
assert.equal(capMax, 2355, 'mines cap at max stake');

// ---------------- Plinko ----------------
let plinkoMin = 1, plinkoMax = 0, plinkoCount = 0;
function binomial(n, k) {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let res = 1;
  for (let i = 1; i <= k; i++) res = res * (n - k + i) / i;
  return res;
}
for (const [rowsText, risks] of Object.entries(games.PLINKO_PAYOUTS)) {
  const rows = Number(rowsText);
  const denominator = 2 ** rows;
  for (const [risk, multipliers] of Object.entries(risks)) {
    assert.equal(multipliers.length, rows + 1);
    let plinkoRtp = 0;
    for (let b = 0; b <= rows; b++) plinkoRtp += binomial(rows, b) / denominator * multipliers[b];
    plinkoMin = Math.min(plinkoMin, plinkoRtp);
    plinkoMax = Math.max(plinkoMax, plinkoRtp);
    plinkoCount++;
    assert.ok(close(plinkoRtp, TARGET, 0.0031), `plinko ${rows}/${risk} RTP ${plinkoRtp}`);
    assert.ok(multipliers.some((m) => m < 1), `plinko ${rows}/${risk} has sub-1 outcomes`);
  }
}
console.log(`Plinko RTP range [${plinkoMin.toFixed(4)}, ${plinkoMax.toFixed(4)}], vectors=${plinkoCount}`);
assert.equal(plinkoCount, 27, 'plinko 27 vectors');

// ---------------- Keno ----------------
let kenoMin = 1, kenoMax = 0;
for (let picks = 1; picks <= 10; picks++) {
  let kenoRtp = 0;
  const denom = Number(choose(80, picks));
  for (let hits = 0; hits <= picks; hits++) {
    const prob = Number(choose(20, hits) * choose(60, picks - hits)) / denom;
    const mult = games.KENO_PAY[picks][hits] || 0;
    kenoRtp += prob * mult;
  }
  kenoMin = Math.min(kenoMin, kenoRtp);
  kenoMax = Math.max(kenoMax, kenoRtp);
  console.log(`Keno ${picks}: RTP ${kenoRtp.toFixed(6)}`);
  assert.ok(close(kenoRtp, TARGET, 0.001), `keno ${picks} RTP ${kenoRtp}`);
}
console.log(`Keno RTP range [${kenoMin.toFixed(6)}, ${kenoMax.toFixed(6)}]`);

// ---------------- Bingo ----------------
const tierProbs = [0.022874453345924528, 0.12066501614203462, 0.302091636016361, 0.36876080658678534, 0.1856080879088946];
let bingoRtp = 0;
for (let i = 0; i < tierProbs.length; i++) bingoRtp += tierProbs[i] * games.BINGO_PAYOUT_TIERS[i].multiplier;
console.log(`Bingo completed-round RTP: ${bingoRtp.toFixed(10)}`);
assert.ok(close(bingoRtp, 0.2999485270998474, 1e-12), 'bingo RTP');

// ---------------- Penalty ----------------
for (const difficulty of ['easy', 'medium', 'hard']) {
  const q = Number(games.PENALTY_GOAL_BPS[difficulty]) / 10000;
  let minRtp = 1, maxRtp = 0;
  for (let step = 1; step <= 400; step++) {
    const cents = games.penaltyMultiplierCents(step, difficulty, 3);
    const rtp = Number(cents) / 100 * q ** step;
    minRtp = Math.min(minRtp, rtp);
    maxRtp = Math.max(maxRtp, rtp);
  }
  console.log(`Penalty ${difficulty}: q=${q}, RTP range [${minRtp.toFixed(4)}, ${maxRtp.toFixed(4)}]`);
  assert.ok(minRtp >= 0.298 && maxRtp <= 0.3018, `penalty ${difficulty} RTP range`);
}

console.log('\nALL OFFLINE RTP CHECKS PASSED');
