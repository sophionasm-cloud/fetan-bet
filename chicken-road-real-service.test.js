'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const crypto = require('node:crypto');
const { createChickenRoadRealService, MIN_BET_SANTIM, MAX_BET_SANTIM } = require('./chicken-road-real-service');
const { generateRoundSeed, laneOutcomesV2 } = require('./chicken-road-committed');
const { MODES, modeConfig, conditionalSurvivalForLevel, payoutFor } = require('./chicken-road-2-config');

function fixture(initial = 100000) {
  const db = { wallet: initial, ledger: [], rounds: new Map(), actions: new Map(), game: new Map(), nextGame: 1 };
  let tail = Promise.resolve();
  const query = async (sql, p = []) => run(db, sql, p);
  const withTx = async (fn) => {
    let release;
    const prev = tail;
    tail = new Promise((resolve) => { release = resolve; });
    await prev;
    const snapshot = structuredClone(db);
    try {
      return await fn({ query: (sql, p) => run(db, sql, p) });
    } catch (error) {
      Object.assign(db, snapshot);
      throw error;
    } finally {
      release();
    }
  };
  async function ledger({ client, userId, delta, type, refType, refId }) {
    const wallet = await client.query('SELECT balance FROM wallets WHERE user_id=$1 FOR UPDATE', [userId]);
    if (wallet.rows[0].balance + delta < 0) throw Error('INSUFFICIENT');
    const balance = wallet.rows[0].balance + delta;
    await client.query('UPDATE wallets SET balance=$1 WHERE user_id=$2', [balance, userId]);
    await client.query('INSERT INTO ledger VALUES ($1,$2,$3,$4,$5,$6)', [userId, type, delta, balance, refType, refId]);
    return balance;
  }
  let failNextCredit = false;
  async function injectableLedger(args) {
    if (failNextCredit && args.delta > 0) {
      failNextCredit = false;
      throw Error('MOCK_LEDGER_FAILURE');
    }
    return ledger(args);
  }
  function service(seed, roundId) {
    return createChickenRoadRealService({
      query,
      withTx,
      ledger: injectableLedger,
      generateSeed: () => seed || generateRoundSeed(),
      generateId: () => roundId || crypto.randomUUID(),
    });
  }
  return { db, service, failCredit() { failNextCredit = true; } };
}

async function run(db, sql, p) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  if (s.startsWith('SELECT balance FROM wallets')) return { rows: [{ balance: db.wallet }], rowCount: 1 };
  if (s.startsWith('UPDATE wallets SET balance')) { db.wallet = Number(p[0]); return { rows: [], rowCount: 1 }; }
  if (s.startsWith('INSERT INTO ledger')) {
    db.ledger.push({ user_id: p[0], type: p[1], amount: Number(p[2]), balance_after: Number(p[3]), ref_type: p[4], ref_id: p[5] });
    return { rows: [], rowCount: 1 };
  }
  if (s.startsWith("SELECT * FROM chicken_road_dash_rounds WHERE user_id=$1 AND status='active'")) {
    const active = [...db.rounds.values()].find((round) => round.user_id === Number(p[0]) && round.status === 'active');
    return { rows: active ? [active] : [], rowCount: active ? 1 : 0 };
  }
  if (s.startsWith('SELECT * FROM chicken_road_dash_rounds WHERE user_id=$1 AND start_action_id=$2')) {
    const found = [...db.rounds.values()].find((round) => round.user_id === Number(p[0]) && round.start_action_id === p[1]);
    return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
  }
  if (s.startsWith('SELECT * FROM chicken_road_dash_rounds WHERE user_id=$1 ORDER')) {
    const found = [...db.rounds.values()].filter((round) => round.user_id === Number(p[0])).slice(-1);
    return { rows: found, rowCount: found.length };
  }
  if (s.startsWith('INSERT INTO game_rounds')) {
    const id = db.nextGame++;
    db.game.set(id, { id, user_id: p[0], bet: Number(p[1]), payout: 0, step: 0, status: 'active' });
    return { rows: [{ id }], rowCount: 1 };
  }
  if (s.startsWith('INSERT INTO chicken_road_dash_rounds')) {
    const round = {
      id: p[0], user_id: Number(p[1]), difficulty: p[2], status: 'active', progress: 0,
      bet_santim: Number(p[3]), payout_santim: 0, seed_commitment: p[4], outcome_root: p[5],
      detail: JSON.parse(p[6]), engine_version: p[7], probability_version: p[8], payout_version: p[9],
      start_action_id: p[10], start_request: JSON.parse(p[11]), game_round_id: Number(p[12]),
    };
    db.rounds.set(round.id, round);
    return { rows: [round], rowCount: 1 };
  }
  if (s.startsWith('SELECT * FROM chicken_road_dash_rounds WHERE id=$1 AND user_id=$2 FOR UPDATE')) {
    const round = db.rounds.get(p[0]);
    return { rows: round && round.user_id === Number(p[1]) ? [round] : [], rowCount: round && round.user_id === Number(p[1]) ? 1 : 0 };
  }
  if (s.startsWith('SELECT r.*,w.balance AS wallet_balance')) {
    const round = db.rounds.get(p[0]);
    return { rows: round && round.user_id === Number(p[1]) ? [{ ...round, wallet_balance: db.wallet }] : [], rowCount: round && round.user_id === Number(p[1]) ? 1 : 0 };
  }
  if (s.startsWith('SELECT request,response FROM chicken_road_dash_actions')) {
    const action = db.actions.get(p[0] + p[1]);
    return { rows: action ? [action] : [], rowCount: action ? 1 : 0 };
  }
  if (s.startsWith('UPDATE chicken_road_dash_rounds')) {
    const round = db.rounds.get(p[0]);
    if (s.includes("status='finished'")) {
      round.status = 'finished';
      round.progress = Number(p[1]);
      round.payout_santim = Number(p[2]);
    } else if (s.includes("status='cashed_out'")) {
      round.status = 'cashed_out';
      round.payout_santim = Number(p[1]);
    } else if (s.includes("status='crashed'")) {
      round.status = 'crashed';
      round.progress = Number(p[1]);
    } else {
      round.progress = Number(p[1]);
    }
    return { rows: [], rowCount: 1 };
  }
  if (s.startsWith('UPDATE game_rounds')) {
    const round = db.game.get(Number(p[0]));
    if (s.includes('payout=$4')) {
      round.status = p[1];
      round.step = Number(p[2]);
      round.payout = Number(p[3]);
      round.detail = JSON.parse(p[4]);
    } else {
      round.status = p[1];
      round.step = Number(p[2]);
      round.detail = JSON.parse(p[3]);
    }
    return { rows: [], rowCount: 1 };
  }
  if (s.startsWith('INSERT INTO chicken_road_dash_actions')) {
    const key = p[0] + p[1];
    if (db.actions.has(key)) throw Error('duplicate');
    db.actions.set(key, { request: JSON.parse(p[4]), response: JSON.parse(p[5]) });
    return { rows: [], rowCount: 1 };
  }
  if (s.startsWith('SELECT * FROM chicken_road_dash_rounds WHERE id=$1 AND user_id=$2')) {
    const round = db.rounds.get(p[0]);
    return { rows: round && round.user_id === Number(p[1]) ? [round] : [], rowCount: round && round.user_id === Number(p[1]) ? 1 : 0 };
  }
  throw Error('Unimplemented mock SQL: ' + s);
}

const id = () => crypto.randomUUID();

function findSeed(roundId, difficulty, predicate, limit = 200000) {
  for (let i = 0; i < limit; i++) {
    const candidate = crypto.createHash('sha256').update(`test-seed|${i}`).digest();
    if (predicate(laneOutcomesV2(candidate, roundId, difficulty))) return candidate;
  }
  return null;
}

test('real service exposes the exact approved ladders, line labels and lane counts', () => {
  assert.deepEqual(MODES.easy.multipliers, ['1.01', '1.06', '1.15', '1.24', '1.35', '1.48', '1.65', '1.85', '2.12', '2.47', '2.96', '3.70', '4.64', '6.50', '12.08']);
  assert.deepEqual(MODES.medium.multipliers, ['1.18', '1.83', '2.95', '5.02', '9.04', '17.74', '38.71', '67.34', '305.94']);
  assert.deepEqual(MODES.hard.multipliers, ['1.44', '3.45', '9.09', '26.78', '92.54', '391.25', '2235.72', '18960.33', '379632.82']);
  assert.deepEqual(MODES.easy.lines, [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29]);
  assert.deepEqual(MODES.medium.lines, [1, 3, 5, 7, 9, 11, 13, 15, 17]);
  assert.deepEqual(MODES.hard.lines, [1, 3, 5, 7, 9, 11, 13, 15, 17]);
  assert.equal(MODES.easy.lanes, 15);
  assert.equal(MODES.medium.lanes, 9);
  assert.equal(MODES.hard.lanes, 9);
  assert.deepEqual(MODES.medium.probabilityLines, [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21]);
  assert.equal(MODES.medium.cumulativeProbabilityPpb.length, 11);
  assert.equal(MODES.medium.cumulativeProbabilityPpb[10], 30_000);
});

test('conditional survival is derived from cumulative probabilities, not used directly', () => {
  const easy = conditionalSurvivalForLevel('easy', 2);
  assert.equal(easy.numerator, MODES.easy.cumulativeProbabilityPpb[1]);
  assert.equal(easy.denominator, MODES.easy.cumulativeProbabilityPpb[0]);
  const medium = conditionalSurvivalForLevel('medium', 1);
  assert.equal(medium.numerator, 254_200_000);
  assert.equal(medium.denominator, 1_000_000_000);
  const hard = conditionalSurvivalForLevel('hard', 9);
  assert.equal(hard.numerator, 790);
  assert.equal(hard.denominator, 16_000);
  assert.equal(payoutFor(10000, MODES.easy.multiplierCents[0]), 10100);
  assert.equal(payoutFor(999, MODES.hard.multiplierCents[8]), Math.floor(999 * 37963282 / 100));
});

test('deducts the real wallet once, restores active state, crosses safely and cashes out exactly', async () => {
  const roundId = '00000000-0000-4000-8000-000000000003';
  const seed = findSeed(roundId, 'easy', (outcomes) => outcomes[0].outcome === 'safe');
  assert.ok(seed);
  const f = fixture();
  const service = f.service(seed, roundId);
  const startAction = id();
  const input = { difficulty: 'easy', bet_santim: 10000, action_id: startAction };
  const start = await service.start(9, input);
  assert.equal(start.balance_santim, 90000);
  assert.equal(start.lanes, 15);
  assert.equal(start.ladder[0], 1.01);
  assert.deepEqual(await service.start(9, input), start);
  assert.equal(f.db.ledger.length, 1);
  assert.equal(f.db.ledger[0].type, 'bet');
  assert.equal(f.db.ledger[0].amount, -10000);
  assert.equal((await service.current(9)).round.id, start.id);
  const crossing = await service.cross(9, start.id, id());
  assert.equal(crossing.outcome, 'safe');
  assert.equal(crossing.line, 1);
  assert.equal(f.db.ledger.length, 1);
  const cashAction = id();
  const result = await service.cashout(9, start.id, cashAction);
  assert.equal(result.multiplier, 1.01);
  assert.equal(result.payout_santim, payoutFor(10000, MODES.easy.multiplierCents[0]));
  assert.deepEqual(await service.cashout(9, start.id, cashAction), result);
  assert.equal(f.db.ledger.length, 2);
  assert.equal(f.db.wallet, 90000 + result.payout_santim);
  assert.equal(f.db.ledger.reduce((sum, row) => sum + row.amount, 0), f.db.wallet - 100000);
});

test('crash pays zero and reveals verifiable v2 fairness data', async () => {
  for (let i = 0; i < 200; i++) {
    const f = fixture();
    const service = f.service();
    const round = await service.start(2, { difficulty: 'hard', bet_santim: 1000, action_id: id() });
    const crossing = await service.cross(2, round.id, id());
    if (crossing.crashed) {
      assert.equal(crossing.payout_santim, 0);
      assert.equal(f.db.wallet, 99000);
      assert.equal(f.db.ledger.length, 1);
      const proof = await service.verify(2, round.id);
      assert.equal(proof.seed_commit_valid, true);
      assert.equal(proof.outcomes_match_seed, true);
      assert.equal(proof.probabilities_match_config, true);
      assert.equal(proof.merkle_proofs_valid, true);
      assert.equal(proof.probability_version, 2);
      assert.equal(proof.engine_version, 2);
      return;
    }
  }
  assert.fail('deterministic samples did not include a hard-mode crash');
});

test('full completion pays the final configured multiplier only, with no 1.5x bonus', async () => {
  const roundId = '00000000-0000-4000-8000-000000000001';
  const seed = findSeed(roundId, 'easy', (outcomes) => outcomes.every((outcome) => outcome.outcome === 'safe'), 2000000);
  assert.ok(seed, 'find a seed whose committed level outcomes are all safe');
  const f = fixture();
  const service = f.service(seed, roundId);
  const round = await service.start(5, { difficulty: 'easy', bet_santim: 2000, action_id: id() });
  assert.equal(round.id, roundId);
  for (let lane = 1; lane <= 15; lane++) {
    const crossing = await service.cross(5, round.id, id());
    assert.equal(crossing.crashed, false, `lane ${lane} must be safe`);
    assert.equal(crossing.lane, lane);
    assert.equal(crossing.line, MODES.easy.lines[lane - 1]);
  }
  const out = await service.cross(5, round.id, id());
  const expected = payoutFor(2000, MODES.easy.multiplierCents[14]);
  assert.equal(out.outcome, 'finish');
  assert.equal(out.finished, true);
  assert.equal(out.step, 15);
  assert.equal(out.multiplier, 12.08);
  assert.equal(out.payout_santim, expected);
  assert.equal(out.payout_santim, 24160);
  assert.equal(f.db.wallet, 100000 - 2000 + expected);
});

test('each mode starts with its own lane count and all configured multipliers settle exactly once', async () => {
  for (const [index, difficulty] of ['easy', 'medium', 'hard'].entries()) {
    const f = fixture();
    const service = f.service();
    const round = await service.start(100 + index, { difficulty, bet_santim: 1000, action_id: id() });
    assert.equal(round.lanes, modeConfig(difficulty).lanes);
    assert.deepEqual(round.ladder, modeConfig(difficulty).multipliers.map(Number));
    const crossing = await service.cross(100 + index, round.id, id());
    if (crossing.crashed) continue;
    const cash = await service.cashout(100 + index, round.id, id());
    assert.equal(cash.multiplier, Number(modeConfig(difficulty).multipliers[0]));
    assert.equal(cash.payout_santim, payoutFor(1000, modeConfig(difficulty).multiplierCents[0]));
  }
});

test('failed payout transaction rolls back wallet, ledger and round settlement', async () => {
  const roundId = '00000000-0000-4000-8000-000000000002';
  const seed = findSeed(roundId, 'easy', (outcomes) => outcomes[0].outcome === 'safe');
  assert.ok(seed);
  const f = fixture();
  const service = f.service(seed, roundId);
  const round = await service.start(8, { difficulty: 'easy', bet_santim: 3000, action_id: id() });
  await service.cross(8, round.id, id());
  const balanceBefore = f.db.wallet;
  const ledgerBefore = structuredClone(f.db.ledger);
  f.failCredit();
  await assert.rejects(service.cashout(8, round.id, id()), /MOCK_LEDGER_FAILURE/);
  assert.equal(f.db.wallet, balanceBefore);
  assert.deepEqual(f.db.ledger, ledgerBefore);
  assert.equal((await service.current(8)).round.status, 'active');
});

test('concurrent duplicate cashouts serialize and pay once', async () => {
  const f = fixture();
  const service = f.service();
  const round = await service.start(3, { difficulty: 'medium', bet_santim: 5000, action_id: id() });
  const cross = await service.cross(3, round.id, id());
  if (cross.crashed) return;
  const action = id();
  const output = await Promise.all([service.cashout(3, round.id, action), service.cashout(3, round.id, action)]);
  assert.deepEqual(output[0], output[1]);
  assert.equal(f.db.ledger.length, 2);
});

test('start idempotency survives settlement; replay cannot debit again', async () => {
  const f = fixture();
  const service = f.service();
  const startKey = id();
  const input = { difficulty: 'easy', bet_santim: 1000, action_id: startKey };
  const first = await service.start(11, input);
  await service.cross(11, first.id, id());
  const replay = await service.start(11, input);
  assert.equal(replay.id, first.id);
  assert.equal(f.db.ledger.length, 1);
  assert.equal(f.db.wallet, 99000);
  await assert.rejects(service.start(11, { ...input, bet_santim: 2000 }), /STALE_ACTION/);
  assert.equal(f.db.ledger.length, 1);
});

test('cash-out before a safe crossing and invalid bets are rejected without financial changes', async () => {
  const f = fixture();
  const service = f.service();
  const round = await service.start(14, { difficulty: 'medium', bet_santim: 1500, action_id: id() });
  const before = structuredClone(f.db.ledger);
  await assert.rejects(service.cashout(14, round.id, id()), /STALE_ACTION/);
  assert.equal(f.db.wallet, 98500);
  assert.deepEqual(f.db.ledger, before);
  await assert.rejects(service.start(14, { difficulty: 'easy', bet_santim: 99, action_id: id() }), /INVALID/);
  await assert.rejects(service.start(14, { difficulty: 'easy', bet_santim: MAX_BET_SANTIM + 1, action_id: id() }), /INVALID/);
  await assert.rejects(service.start(14, { difficulty: 'easy', bet_santim: 100, action_id: 'not-a-uuid' }), /INVALID/);
  await assert.rejects(service.cross(14, 'not-a-uuid', id()), /INVALID/);
  await assert.rejects(service.cashout(14, round.id, 'not-a-uuid'), /INVALID/);
  assert.equal(f.db.wallet, 98500);
  assert.ok(MIN_BET_SANTIM > 0);
});
