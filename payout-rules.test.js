'use strict';

// Pure, database-free payout and RTP checks. Run with: node payout-rules.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const games = require('./games');
const { grossPayoutCents, grossPayoutFromMultiplierCents, netWinningsCents } = require('./payout');

function close(actual, expected, tolerance = 1e-10, message = '') {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message} expected ${expected}, got ${actual}`);
}

function choose(n, r) {
  if (r < 0 || r > n) return 0n;
  let out = 1n;
  for (let i = 1; i <= Math.min(r, n - r); i++) out = (out * BigInt(n - Math.min(r, n - r) + i)) / BigInt(i);
  return out;
}

// Integer-santim settlement, endpoints, refund/loss and exact decimal handling.
for (const stake of [games.MIN_BET, 101, 1000, games.MAX_BET]) {
  assert.equal(grossPayoutCents(stake, 1), stake);
  assert.equal(grossPayoutCents(stake, 0), 0);
  assert.equal(grossPayoutCents(stake, 3.71), Math.floor(stake * 371 / 100));
  assert.equal(grossPayoutCents(stake, 1.89), Math.floor(stake * 189 / 100));
}
assert.equal(grossPayoutFromMultiplierCents(101, 189n), 190);
assert.equal(netWinningsCents(100, 100), 0);
assert.equal(netWinningsCents(0, 100), -100);

// Road Dash: each survival probability and payout ladder; minimum cashout is 1x.
for (const [difficulty, config] of Object.entries(games.ROAD_CONFIG.difficulties)) {
  let survival = 1;
  const ladder = games.getLadder(difficulty);
  assert.equal(ladder.length, config.lanes);
  for (let step = 1; step <= config.lanes; step++) {
    const crash = Math.min(0.99, config.p0 + config.step * (step - 1));
    survival *= 1 - crash;
    assert.ok(ladder[step - 1] >= 1, `${difficulty} step ${step} minimum cashout`);
    const rtp = survival * ladder[step - 1];
    if (ladder[step - 1] === 1) {
      close(rtp, survival, 1e-12, `${difficulty} step ${step} minimum-return RTP`);
      assert.ok(rtp > 0.92, `${difficulty} step ${step} minimum-return trade-off`);
    } else {
      assert.ok(rtp <= 0.9200000001 && rtp > 0.91, `${difficulty} step ${step} target-floor range`);
    }
  }
}

// Mines: exact integer-combination multipliers, all valid configurations, both stakes/cap.
let minesCapAtMin = 0, minesCapAtMax = 0;
for (const grid of games.MINES_GRIDS) {
  const N = grid * grid;
  for (let M = 1; M < N; M++) {
    for (let k = 1; k <= N - M; k++) {
      const cents = games.getMinesMultiplierCents(N, M, k);
      const expected = (92n * choose(N, k)) / choose(N - M, k);
      assert.equal(cents, expected, `Mines ${grid}x${grid}, ${M} mines, ${k} picks`);
      for (const stake of [games.MIN_BET, games.MAX_BET]) {
        const raw = grossPayoutFromMultiplierCents(stake, cents);
        const capped = grossPayoutFromMultiplierCents(stake, cents, games.MINES_MAX_WIN);
        assert.ok(capped <= games.MINES_MAX_WIN);
        if (raw > games.MINES_MAX_WIN) {
          if (stake === games.MIN_BET) minesCapAtMin++;
          else minesCapAtMax++;
        }
      }
    }
  }
}
assert.equal(minesCapAtMin, 1545);
assert.equal(minesCapAtMax, 2556);

// Plinko: every supported vector uses exact binomial bucket weights and stays under 92%.
let plinkoVectorCount = 0;
for (const [rowsText, risks] of Object.entries(games.PLINKO_PAYOUTS)) {
  const rows = Number(rowsText), denominator = 2 ** rows;
  for (const [risk, multipliers] of Object.entries(risks)) {
    assert.equal(multipliers.length, rows + 1);
    let rtp = 0;
    for (let bucket = 0; bucket <= rows; bucket++) {
      rtp += Number(choose(rows, bucket)) / denominator * multipliers[bucket];
      for (const stake of [games.MIN_BET, games.MAX_BET]) {
        const payout = grossPayoutCents(stake, multipliers[bucket]);
        assert.ok(Number.isSafeInteger(payout));
      }
    }
    assert.ok(rtp <= 0.92 && rtp > 0.91, `Plinko ${rows}/${risk} RTP ${rtp}`);
    plinkoVectorCount++;
  }
}
assert.equal(plinkoVectorCount, 27);

// Keno: exact hypergeometric probabilities for each pick count.
for (let picks = 1; picks <= 10; picks++) {
  let rtp = 0;
  const denominator = choose(80, picks);
  for (let hits = 0; hits <= picks; hits++) {
    const probability = Number(choose(20, hits) * choose(60, picks - hits)) / Number(denominator);
    const multiplier = games.KENO_PAY[picks][hits] || 0;
    rtp += probability * multiplier;
    for (const stake of [games.MIN_BET, games.MAX_BET]) assert.ok(Number.isSafeInteger(grossPayoutCents(stake, multiplier)));
  }
  assert.ok(rtp <= 0.9200001 && rtp > 0.91, `Keno ${picks} picks RTP ${rtp}`);
}

// Bingo: payout boundaries; exact completed-round tier distribution from independent enumeration.
assert.deepEqual([20, 21, 30, 31, 40, 41, 50, 51, 75].map(games.getBingoMultiplier),
  [3.71, 1.98, 1.98, 0.99, 0.99, 0.62, 0.62, 0.37, 0.37]);
const bingoTierProbabilities = [0.022874453345924528, 0.12066501614203462,
  0.302091636016361, 0.36876080658678534, 0.1856080879088946];
const bingoCompletedRtp = bingoTierProbabilities.reduce((sum, probability, index) =>
  sum + probability * games.BINGO_PAYOUT_TIERS[index].multiplier, 0);
close(bingoCompletedRtp, 0.92015837, 1e-8, 'Bingo completed-round RTP');
assert.equal(grossPayoutCents(100, games.getBingoMultiplier(75)), 37);
assert.deepEqual([20, 21, 30, 31, 40, 41, 50, 51, 75].map(games.getLegacyBingoMultiplier),
  [15, 8, 8, 4, 4, 2.5, 2.5, 1.5, 1.5]);
assert.equal(games.getBingoMultiplierForVersion(20, 1), 15);
assert.equal(games.getBingoMultiplierForVersion(20, 2), 3.71);
assert.equal(games.getMinesMultiplierForVersion(25, 5, 1, 1), 1.23);
assert.equal(games.getMinesMultiplierForVersion(25, 5, 1, 2), 1.15);

// Roulette: 37 pockets, single zero; net calculation is distinct from gross return.
close((1 / 37) * games.ROULETTE_MULTIPLIERS.number, 0.92, 1e-12, 'Roulette straight RTP');
close((18 / 37) * games.ROULETTE_MULTIPLIERS.outside, 0.9194594594594594, 1e-12, 'Roulette outside RTP');
assert.equal(grossPayoutCents(100, games.ROULETTE_MULTIPLIERS.number), 3404);
assert.equal(netWinningsCents(3404, 100), 3304);

// Star Spin: enumerate all weighted 3-reel combinations, including refund outcome.
const symbols = games.SYMBOLS;
let weightedReturn = 0;
for (const [a, , wa] of symbols) for (const [b, , wb] of symbols) for (const [c, , wc] of symbols) {
  const names = [a, b, c], normal = names.filter((name) => name !== 'wild');
  let multiplier = 0;
  if (normal.length === 0) multiplier = games.PAY3.wild;
  else if (normal.every((name) => name === normal[0])) multiplier = games.PAY3[normal[0]];
  else if (names.filter((name) => name === 'cherry' || name === 'wild').length >= 2) multiplier = games.STAR_REFUND_MULTIPLIER;
  weightedReturn += wa * wb * wc * multiplier;
}
close(weightedReturn / 1_000_000, 0.9198948, 1e-12, 'Star Spin RTP');
assert.equal(grossPayoutCents(100, games.STAR_REFUND_MULTIPLIER), 100);

// Frontend configuration checks prevent stale customer-facing tables.
const frontend = fs.readFileSync(require.resolve('./public/games.js'), 'utf8');
const serverSource = fs.readFileSync(require.resolve('./games.js'), 'utf8');
for (const text of ['3.68×', '15.30×', '71308.13×', '×3.71', '×0.37', '34.04', '1.89', '×1.00 (stake returned)']) {
  assert.ok(frontend.includes(text), `frontend paytable contains ${text}`);
}
for (const fragment of [
  "FROM game_rounds WHERE user_id=$1 AND game='road' AND status='active' FOR UPDATE",
  "FROM game_rounds WHERE user_id=$1 AND game='mines' AND status='active' FOR UPDATE",
  "UPDATE game_rounds SET status='done', step=$1, payout=$2 WHERE id=$3 AND status='active'",
  "UPDATE game_rounds SET status='done', payout=$1 WHERE id=$2 AND status='active'",
  'await postLedger({ client, userId, delta: payout, type: \'win\'',
  'await postLedger({ client, userId, delta: potential, type: \'win\'',
]) assert.ok(serverSource.includes(fragment), `server transaction invariant remains: ${fragment}`);
assert.ok(serverSource.includes('crypto.randomInt(0, n)'), 'roulette and Keno retain crypto random helper');
assert.ok(serverSource.includes('crypto.createHash(\'sha256\')'), 'provably-fair games retain server hash outcome generation');
assert.ok(serverSource.includes('payoutVersion: PAYOUT_RULE_VERSION'), 'new long-lived rounds record payout version');
assert.ok(serverSource.includes('getRoadLadderForVersion(diff, payoutVersion)'), 'active Road Dash rounds retain their original payout version');
assert.ok(serverSource.includes('getMinesMultiplierCentsForVersion(N, m, k, payoutVersion)'), 'active Mines rounds retain their original payout version');

console.log('payout-rules.test.js: all pure payout and RTP checks passed');
