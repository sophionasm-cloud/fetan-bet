'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const crypto = require('node:crypto');
const { createChickenRoadDemoService, START_BALANCE_SANTIM, ladderFor } = require('./chicken-road-demo-service');
const { generateRoundSeed, laneOutcomes, commitSeed, verifyProof } = require('./chicken-road-committed');

function fakeDatabase() {
  let balances = new Map(), rounds = new Map(), actions = new Map();
  let tail = Promise.resolve();
  async function exec(sql, p = []) {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('INSERT INTO chicken_road_dash_demo_balances')) {
      if (!balances.has(Number(p[0]))) balances.set(Number(p[0]), Number(p[1]));
      return { rows: [], rowCount: 1 };
    }
    if (s.startsWith('SELECT balance_santim FROM chicken_road_dash_demo_balances WHERE user_id=$1 FOR UPDATE'))
      return { rows: [{ balance_santim: balances.get(Number(p[0])) }], rowCount: 1 };
    if (s.startsWith('SELECT balance_santim FROM chicken_road_dash_demo_balances'))
      return { rows: [{ balance_santim: balances.get(Number(p[0])) }], rowCount: 1 };
    if (s.startsWith('UPDATE chicken_road_dash_demo_balances SET balance_santim=balance_santim-$2')) {
      balances.set(Number(p[0]), balances.get(Number(p[0])) - Number(p[1])); return { rows: [], rowCount: 1 };
    }
    if (s.startsWith('UPDATE chicken_road_dash_demo_balances SET balance_santim=balance_santim+$2')) {
      balances.set(Number(p[0]), balances.get(Number(p[0])) + Number(p[1])); return { rows: [], rowCount: 1 };
    }
    if (s.startsWith('UPDATE chicken_road_dash_demo_balances SET balance_santim=$2')) {
      balances.set(Number(p[0]), Number(p[1])); return { rows: [{ balance_santim: balances.get(Number(p[0])) }], rowCount: 1 };
    }
    if (s.startsWith('SELECT * FROM chicken_road_dash_demo_rounds WHERE user_id=$1 AND status=\'active\'')) {
      const found = [...rounds.values()].filter(r => r.user_id === Number(p[0]) && r.status === 'active');
      return { rows: found, rowCount: found.length };
    }
    if (s.startsWith('SELECT r.*, b.balance_santim AS demo_balance_santim')) {
      const r = rounds.get(String(p[1]));
      if (!r || r.user_id !== Number(p[0])) return { rows: [], rowCount: 0 };
      return { rows: [{ ...r, demo_balance_santim: balances.get(r.user_id) }], rowCount: 1 };
    }
    if (s.startsWith('INSERT INTO chicken_road_dash_demo_rounds')) {
      const r = { id: p[0], user_id: Number(p[1]), difficulty: p[2], status: 'active', progress: 0,
        bet_santim: Number(p[3]), payout_santim: 0, seed_commitment: p[4], outcome_root: p[5], detail: JSON.parse(p[6]),
        engine_version: p[7], probability_version: p[8], payout_version: p[9] };
      rounds.set(r.id, r); return { rows: [r], rowCount: 1 };
    }
    if (s.startsWith('SELECT request, response FROM chicken_road_dash_demo_actions')) {
      const a = actions.get(`${p[0]}:${p[1]}`);
      return { rows: a ? [{ request: a.request, response: a.response }] : [], rowCount: a ? 1 : 0 };
    }
    if (s.startsWith('UPDATE chicken_road_dash_demo_rounds SET status=\'crashed\'')) {
      const r = rounds.get(String(p[0])); r.status = 'crashed'; r.progress = Number(p[1]); return { rows: [], rowCount: 1 };
    }
    if (s.startsWith('UPDATE chicken_road_dash_demo_rounds SET status=\'finished\'')) {
      const r = rounds.get(String(p[0])); r.status = 'finished'; r.progress = Number(p[1]); r.payout_santim = Number(p[2]); return { rows: [], rowCount: 1 };
    }
    if (s.startsWith('UPDATE chicken_road_dash_demo_rounds SET status=\'cashed_out\'')) {
      const r = rounds.get(String(p[0])); r.status = 'cashed_out'; r.payout_santim = Number(p[1]); return { rows: [], rowCount: 1 };
    }
    if (s.startsWith('UPDATE chicken_road_dash_demo_rounds SET progress=$2')) {
      const r = rounds.get(String(p[0])); r.progress = Number(p[1]); return { rows: [], rowCount: 1 };
    }
    if (s.startsWith('INSERT INTO chicken_road_dash_demo_actions')) {
      const key = `${p[0]}:${p[1]}`;
      if (actions.has(key)) throw new Error('duplicate action');
      actions.set(key, { request: JSON.parse(p[4]), response: JSON.parse(p[5]) }); return { rows: [], rowCount: 1 };
    }
    if (s.startsWith('SELECT r.*, $2::bigint AS demo_balance_santim')) {
      const found = [...rounds.values()].filter(r => r.user_id === Number(p[0])).sort((a,b) => b.id.localeCompare(a.id)).slice(0,1);
      return { rows: found.map(r => ({ ...r, demo_balance_santim: Number(p[1]) })), rowCount: found.length };
    }
    if (s.startsWith('SELECT * FROM chicken_road_dash_demo_rounds WHERE id=$1 AND user_id=$2')) {
      const r = rounds.get(String(p[0]));
      return { rows: r && r.user_id === Number(p[1]) ? [r] : [], rowCount: r && r.user_id === Number(p[1]) ? 1 : 0 };
    }
    throw new Error(`Unimplemented test SQL: ${s}`);
  }
  const query = exec;
  const withTx = async (fn) => {
    let release;
    const prev = tail; tail = new Promise(resolve => { release = resolve; }); await prev;
    const snapshot = structuredClone({ balances, rounds, actions });
    try { return await fn({ query: exec }); }
    catch (e) { balances = snapshot.balances; rounds = snapshot.rounds; actions = snapshot.actions; throw e; }
    finally { release(); }
  };
  return { query, withTx, setBalance(userId, amount) { balances.set(userId, amount); } };
}

function seedFor(roundId, difficulty, predicate) {
  for (let i = 0; i < 10000; i++) {
    const seed = generateRoundSeed();
    if (predicate(laneOutcomes(seed, roundId, difficulty))) return seed;
  }
  throw new Error('Could not find deterministic test seed');
}
const allSafe = (id, difficulty) => seedFor(id, difficulty, outcomes => outcomes.every(o => o.outcome === 'safe'));
const firstCrash = (id, difficulty) => seedFor(id, difficulty, outcomes => outcomes[0].outcome === 'collision');

test('Model C demo: starts, persists, completes all 14 lanes and finish, then verifies commitment', async () => {
  const db = fakeDatabase();
  let allSafeSeed;
  const service = createChickenRoadDemoService({ ...db, generateSeed: (id, d) => (allSafeSeed = allSafe(id, d)) });
  const start = await service.start(11, { difficulty: 'easy', bet_santim: 300 });
  assert.equal(start.active, true);
  assert.equal(start.commitment, commitSeed(allSafeSeed));
  assert.equal(start.payout_version, 1);
  assert.equal((await service.current(11)).balance_santim, START_BALANCE_SANTIM - 300);
  const sameStart = await service.start(11, { difficulty: 'hard', bet_santim: 1000 });
  assert.equal(sameStart.id, start.id, 'refresh/repeated start restores the active round without charging again');
  for (let lane = 1; lane <= 14; lane++) {
    const result = await service.cross(11, start.id, crypto.randomUUID());
    assert.equal(result.outcome, 'safe');
    assert.equal(result.step, lane);
    assert.equal(result.crashed, false);
    assert.equal(verifyProof(start.id, lane, result.outcome, result.salt, result.proof, start.outcome_root), true);
    // Reconstruct a new service instance over the same persistent storage.
    const restarted = createChickenRoadDemoService({ ...db, generateSeed: () => Buffer.from(allSafeSeed) });
    assert.equal((await restarted.current(11)).round.step, lane);
  }
  const finish = await service.cross(11, start.id, crypto.randomUUID());
  assert.equal(finish.finished, true);
  assert.equal(finish.payout_santim, Math.round(300 * ladderFor('easy')[13] * 1.5));
  const proof = await service.verify(11, start.id);
  assert.equal(proof.seed_commit_valid, true);
  assert.equal(proof.payout_version, 1);
  assert.equal(proof.outcomes_match_seed, true);
  assert.equal(proof.merkle_proofs_valid, true);
});

test('Model C demo: crash is immutable, cashout settles, and retries/concurrency are idempotent', async () => {
  const db = fakeDatabase();
  let useSafeSeed = false;
  const service = createChickenRoadDemoService({ ...db, generateSeed: (id, d) => useSafeSeed ? allSafe(id, d) : firstCrash(id, d) });
  const crashed = await service.start(22, { difficulty: 'medium', bet_santim: 500 });
  const crashAction = crypto.randomUUID();
  const [crashA, crashB] = await Promise.all([
    service.cross(22, crashed.id, crashAction), service.cross(22, crashed.id, crashAction),
  ]);
  assert.equal(crashA.outcome, 'collision');
  assert.deepEqual(crashB, crashA);
  assert.equal((await service.current(22)).balance_santim, START_BALANCE_SANTIM - 500);
  const replay = await service.cross(22, crashed.id, crashAction);
  assert.deepEqual(replay, crashA);
  const verifiedCrash = await service.verify(22, crashed.id);
  assert.equal(verifiedCrash.outcomes_match_seed, true);

  useSafeSeed = true;
  const cashRound = await service.start(33, { difficulty: 'easy', bet_santim: 1000 });
  const crossed = await service.cross(33, cashRound.id, crypto.randomUUID());
  assert.equal(crossed.outcome, 'safe');
  const beforeCash = await service.current(33);
  const cashId = crypto.randomUUID();
  const [cashA, cashB] = await Promise.all([
    service.cashout(33, cashRound.id, cashId), service.cashout(33, cashRound.id, cashId),
  ]);
  assert.deepEqual(cashB, cashA);
  assert.equal(cashA.payout_santim, Math.round(1000 * ladderFor('easy')[0]));
  assert.equal((await service.current(33)).balance_santim, beforeCash.balance_santim + cashA.payout_santim);
});

test('Model C demo: all difficulties start, and insufficient demo credits reject', async () => {
  const db = fakeDatabase();
  const service = createChickenRoadDemoService({ ...db });
  for (const [i, difficulty] of ['easy', 'medium', 'hard'].entries()) {
    const round = await service.start(50 + i, { difficulty, bet_santim: 100 });
    assert.equal(round.difficulty, difficulty);
    assert.equal(round.ladder.length, 14);
  }
  assert.notDeepEqual(ladderFor('easy'), ladderFor('medium'));
  assert.notDeepEqual(ladderFor('medium'), ladderFor('hard'));
  db.setBalance(44, 500);
  await assert.rejects(service.start(44, { difficulty: 'easy', bet_santim: 1000 }), /INSUFFICIENT_DEMO/);
  assert.equal((await service.current(44)).balance_santim, 500);
});
