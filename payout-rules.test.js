'use strict';

// Pure, database-free payout and RTP checks. Run with: node payout-rules.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
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

// Road Dash: every version-3 cash-out step targets ~30% RTP. Rounding to the
// nearest santim leaves a tiny band around 0.30 rather than a 1.00x floor.
for (const [difficulty, config] of Object.entries(games.ROAD_CONFIG.difficulties)) {
  let survival = 1;
  const ladder = games.getLadder(difficulty);
  assert.equal(ladder.length, config.lanes);
  for (let step = 1; step <= config.lanes; step++) {
    const crash = Math.min(0.99, config.p0 + config.step * (step - 1));
    survival *= 1 - crash;
    const rtp = survival * ladder[step - 1];
    close(rtp, games.TARGET_RTP, 0.005, `${difficulty} step ${step} target RTP`);
  }
}
// Version 2 keeps the prior ~92% ladder, including its 1.00x floor where the
// old target fell below 1.00x at the first step.
for (const [difficulty, config] of Object.entries(games.ROAD_CONFIG.difficulties)) {
  const v2 = games.getLadderV2(difficulty);
  assert.equal(v2.length, config.lanes);
  assert.ok(v2[0] >= 1, `${difficulty} v2 retains its minimum cashout floor`);
  assert.ok(v2[v2.length - 1] > 1, `${difficulty} v2 ladder remains progressive`);
}
assert.equal(games.getLadderV2('easy')[0], 1, 'Road Dash v2 Easy keeps the 1.00x floor');

// Mines: exact integer-combination multipliers, all valid configurations, both stakes/cap.
let minesCapAtMin = 0, minesCapAtMax = 0;
for (const grid of games.MINES_GRIDS) {
  const N = grid * grid;
  for (let M = 1; M < N; M++) {
    for (let k = 1; k <= N - M; k++) {
      const cents = games.getMinesMultiplierCents(N, M, k);
      const denominator = choose(N - M, k);
      const expected = (games.TARGET_RTP_CENTS * choose(N, k) + denominator / 2n) / denominator;
      assert.equal(cents, expected, `Mines ${grid}x${grid}, ${M} mines, ${k} picks`);
      const rtp = Number(choose(N - M, k) * cents) / Number(choose(N, k)) / 100;
      assert.ok(rtp >= 0.296 && rtp <= 0.3045, `Mines ${grid}x${grid}, ${M} mines, ${k} picks RTP ${rtp}`);
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
assert.equal(minesCapAtMin, 1427);
assert.equal(minesCapAtMax, 2355);
// Version 2 keeps the exact integer-floor 92% multiplier; version 1 keeps legacy.
assert.equal(games.getMinesMultiplierForVersion(25, 5, 1, 1), 1.23);
assert.equal(games.getMinesMultiplierForVersion(25, 5, 1, 2), 1.15);
assert.equal(games.getMinesMultiplierForVersion(25, 5, 1, 3), 0.38);

// Plinko: every bucket is scaled to ~30% RTP, server/client table agreement,
// and deterministic verification all use the same landing bucket multiplier.
const plinkoClientSource = fs.readFileSync('public/games.js', 'utf8');
const baseMatch = plinkoClientSource.match(/const PLINKO_BASE_TABLES = (\{[\s\S]*?\n  \});\n\n  function plinkoTargetTables/);
assert.ok(baseMatch, 'frontend Plinko base payout table is present');
const frontendBaseTables = vm.runInNewContext(`(${baseMatch[1]})`);
assert.equal(JSON.stringify(frontendBaseTables), JSON.stringify(games.PLINKO_BASE_PAYOUTS),
  'frontend and backend start from the same Plinko payout vectors');
const targetMatch = plinkoClientSource.match(/function plinkoTargetTables\(baseTables\) \{[\s\S]*?\n  \}\n  const PLINKO_TABLES/);
assert.ok(targetMatch, 'frontend Plinko target payout calculation is present');
const frontendTargetTables = vm.runInNewContext(`${targetMatch[0].replace(/\n  const PLINKO_TABLES$/, '')}; plinkoTargetTables`);
assert.equal(JSON.stringify(frontendTargetTables(frontendBaseTables)), JSON.stringify(games.PLINKO_PAYOUTS),
  'displayed Plinko multipliers match authoritative backend payout tables');

// Board initialization and resize redraw are part of the game-open lifecycle,
// so navigating away and reopening mounts a fresh, immediately rendered board.
assert.match(plinkoClientSource, /\$\('pdrop'\)\.onclick = handleDrop;[\s\S]*?buildGeometry\(\);\s*startAnimLoopIfNeeded\(\);\s*\n\s*\}/,
  'Plinko builds geometry and renders its board on every mount');
assert.match(plinkoClientSource, /ctx\.setTransform\(dpr, 0, 0, dpr, 0, 0\);[\s\S]*startAnimLoopIfNeeded\(\);/,
  'canvas resize redraws the static board after its bitmap is cleared');
assert.match(plinkoClientSource, /cancelAnimationFrame\(animFrameId\)/,
  'Plinko animation is cleaned up when navigating away');

let plinkoVectorCount = 0;
for (const [rowsText, risks] of Object.entries(games.PLINKO_PAYOUTS)) {
  const rows = Number(rowsText), denominator = 2 ** rows;
  for (const [risk, multipliers] of Object.entries(risks)) {
    assert.equal(multipliers.length, rows + 1);
    const centerBuckets = rows % 2 === 0 ? [rows / 2] : [Math.floor(rows / 2), Math.ceil(rows / 2)];
    for (const bucket of centerBuckets) assert.ok(multipliers[bucket] < 1,
      `Plinko ${rows}/${risk} has no reserved 1.00x center`);
    let rtp = 0;
    for (let bucket = 0; bucket <= rows; bucket++) {
      rtp += Number(choose(rows, bucket)) / denominator * multipliers[bucket];
      for (const stake of [games.MIN_BET, games.MAX_BET]) {
        const payout = grossPayoutCents(stake, multipliers[bucket]);
        assert.ok(Number.isSafeInteger(payout));
      }
    }
    close(rtp, games.TARGET_RTP, 0.0031, `Plinko ${rows}/${risk} RTP ${rtp}`);
    assert.ok(multipliers.some((multiplier) => multiplier < 1),
      `Plinko ${rows}/${risk} retains loss outcomes below 1.00x`);
    plinkoVectorCount++;
  }
}
assert.equal(plinkoVectorCount, 27);
assert.equal(grossPayoutCents(101, 1), 101, 'Plinko 1.00x gross payout returns the stake');
assert.equal(netWinningsCents(grossPayoutCents(101, 1), 101), 0,
  'Plinko 1.00x result has zero net winnings');
assert.equal(grossPayoutCents(101, 0.5), 50, 'Plinko sub-1.00x payout remains a loss');
assert.equal(netWinningsCents(grossPayoutCents(101, 0.5), 101), -51,
  'Plinko sub-1.00x result reports the correct net loss');
// Version 2 retains its reserved 1.00x center and ~92% weighted return.
for (const [rowsText, risks] of Object.entries(games.PLINKO_PAYOUTS_V2)) {
  const rows = Number(rowsText), denominator = 2 ** rows;
  for (const multipliers of Object.values(risks)) {
    const center = Math.floor(rows / 2);
    assert.equal(multipliers[center], 1, `Plinko v2 ${rows} reserves the center`);
    const rtp = multipliers.reduce((sum, multiplier, bucket) =>
      sum + Number(choose(rows, bucket)) / denominator * multiplier, 0);
    assert.ok(rtp > 0.91 && rtp <= 0.9200001, `Plinko v2 ${rows} RTP ${rtp}`);
  }
}

// Plinko verification keeps each round on the table it was played with.
const plinkoProof = { server_seed: 'f'.repeat(64), client_seed: 'payout-version-proof', nonce: 7, rows: 10, risk: 'medium' };
const plinkoV3 = games.plinkoVerify({ ...plinkoProof, payout_version: 3 });
const plinkoV2 = games.plinkoVerify({ ...plinkoProof, payoutVersion: 2 });
const plinkoV1 = games.plinkoVerify({ ...plinkoProof, payout_version: 1 });
assert.equal(plinkoV3.multiplier, games.PLINKO_PAYOUTS[10].medium[plinkoV3.bucket], 'Plinko v3 verification');
assert.equal(plinkoV2.multiplier, games.PLINKO_PAYOUTS_V2[10].medium[plinkoV2.bucket], 'Plinko v2 verification');
assert.equal(plinkoV1.multiplier, games.PLINKO_BASE_PAYOUTS[10].medium[plinkoV1.bucket], 'Plinko v1 verification');
assert.equal(games.plinkoVerify(plinkoProof).payout_version, 3, 'unversioned Plinko verification uses the current table');

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
  close(rtp, games.TARGET_RTP, 0.001, `Keno ${picks} picks RTP ${rtp}`);
}

// Bingo: payout boundaries; exact completed-round tier distribution from independent enumeration.
assert.deepEqual([20, 21, 30, 31, 40, 41, 50, 51, 75].map(games.getBingoMultiplier),
  [1.26, 0.65, 0.65, 0.32, 0.32, 0.20, 0.20, 0.12, 0.12]);
const bingoTierProbabilities = [0.022874453345924528, 0.12066501614203462,
  0.302091636016361, 0.36876080658678534, 0.1856080879088946];
const bingoCompletedRtp = bingoTierProbabilities.reduce((sum, probability, index) =>
  sum + probability * games.BINGO_PAYOUT_TIERS[index].multiplier, 0);
close(bingoCompletedRtp, 0.2999485270998474, 1e-12, 'Bingo completed-round RTP');
assert.equal(grossPayoutCents(100, games.getBingoMultiplier(75)), 12);
assert.deepEqual([20, 21, 30, 31, 40, 41, 50, 51, 75].map(games.getBingoMultiplierV2),
  [3.71, 1.98, 1.98, 0.99, 0.99, 0.62, 0.62, 0.37, 0.37]);
assert.deepEqual([20, 21, 30, 31, 40, 41, 50, 51, 75].map(games.getLegacyBingoMultiplier),
  [15, 8, 8, 4, 4, 2.5, 2.5, 1.5, 1.5]);
assert.equal(games.getBingoMultiplierForVersion(20, 1), 15);
assert.equal(games.getBingoMultiplierForVersion(20, 2), 3.71);
assert.equal(games.getBingoMultiplierForVersion(20, 3), 1.26);

// Penalty: optimal play shoots away from the tell. Goal probabilities are
// derived from tell accuracy: (1 + a) / 2. Each difficulty has its own 30% ladder.
const penaltyExpectations = {
  easy: { q: 0.91, first: [0.33, 0.36, 0.40, 0.44, 0.48, 0.53], max100: 353, max50000: 287 },
  medium: { q: 0.79, first: [0.38, 0.48, 0.61, 0.77, 0.97, 1.23], max100: 141, max50000: 115 },
  hard: { q: 0.67, first: [0.45, 0.67, 1.00, 1.49, 2.22, 3.32], max100: 83, max50000: 67 },
};
for (const [difficulty, expected] of Object.entries(penaltyExpectations)) {
  close(Number(games.PENALTY_GOAL_BPS[difficulty]) / 10000, expected.q, 1e-12, `${difficulty} goal chance`);
  assert.deepEqual(
    Array.from({ length: 6 }, (_, step) => Number(games.penaltyMultiplierCents(step + 1, difficulty, 3)) / 100),
    expected.first,
    `${difficulty} version-3 ladder start`
  );
  for (let step = 1; step <= 400; step++) {
    const rtp = Number(games.penaltyMultiplierCents(step, difficulty, 3)) / 100 * expected.q ** step;
    assert.ok(rtp >= 0.298 && rtp <= 0.3018, `${difficulty} step ${step} RTP ${rtp}`);
  }
  assert.equal(games.penaltyMaxSafeStep(100, difficulty, 3), expected.max100, `${difficulty} 1 ETB cap`);
  assert.equal(games.penaltyMaxSafeStep(50000, difficulty, 3), expected.max50000, `${difficulty} 500 ETB cap`);
}
assert.deepEqual(
  Array.from({ length: 7 }, (_, step) => Number(games.penaltyMultiplierCents(step, 'medium', 1)) / 100),
  [0, 1.8, 3.37, 6.32, 11.86, 22.24, 41.7],
  'Penalty version 1 keeps the legacy ladder'
);
assert.deepEqual(
  Array.from({ length: 7 }, (_, step) => Number(games.penaltyMultiplierCents(step, 'medium', 2)) / 100),
  [0, 1.8, 3.37, 6.32, 11.86, 22.24, 41.7],
  'Penalty version 2 keeps the legacy ladder'
);

// Roulette: 37 pockets, single zero; net calculation is distinct from gross return.
close((1 / 37) * games.ROULETTE_MULTIPLIERS.number, 0.30, 1e-12, 'Roulette straight RTP');
close((18 / 37) * games.ROULETTE_MULTIPLIERS.outside, 0.3016216216216216, 1e-12, 'Roulette outside RTP');
assert.equal(grossPayoutCents(100, games.ROULETTE_MULTIPLIERS.number), 1110);
assert.equal(netWinningsCents(1110, 100), 1010);

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
close(weightedReturn / 1_000_000, 0.3005241, 1e-12, 'Star Spin RTP');
assert.equal(grossPayoutCents(100, games.STAR_REFUND_MULTIPLIER), 33,
  'Star 0.33x partial return is not a stake refund');
assert.equal(netWinningsCents(grossPayoutCents(100, games.STAR_REFUND_MULTIPLIER), 100), -67);

// Frontend configuration checks prevent stale customer-facing tables.
const frontend = fs.readFileSync(require.resolve('./public/games.js'), 'utf8');
const serverSource = fs.readFileSync(require.resolve('./games.js'), 'utf8');
for (const text of ['1.20×', '23261.75×', "'1.26'", "'0.12'", '11.10', '0.62', '×0.33 (partial return)']) {
  assert.ok(frontend.includes(text), `frontend paytable contains ${text}`);
}
assert.ok(frontend.includes('const GAME_TARGET_RTP_CENTS = 30n;'), 'frontend Mines preview defines the shared RTP target');
assert.ok(frontend.includes('payout_version: lastPayoutVersion'), 'Plinko verification sends the round payout version');
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
