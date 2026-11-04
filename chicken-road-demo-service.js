'use strict';

const crypto = require('node:crypto');
const { generateRoundSeed, commitSeed, laneOutcomes, merkleTree, verifyProof,
  DIFFICULTIES, ENGINE_VERSION, PROBABILITY_VERSION } = require('./chicken-road-committed');

const LANES = 14;
const PAYOUT_VERSION = 1;
const START_BALANCE_SANTIM = 100000000; // 1,000,000.00 DEMO ETB
const ERRORS = Object.freeze({ INVALID: 'INVALID', ACTIVE: 'ACTIVE_ROUND', NOT_FOUND: 'NOT_FOUND',
  STALE: 'STALE_ACTION', INSUFFICIENT: 'INSUFFICIENT_DEMO', SETTLED: 'ROUND_SETTLED' });

function ladderFor(difficulty) {
  const step = ({ easy: 0.10, medium: 0.18, hard: 0.28 })[difficulty];
  if (!step) throw new Error(ERRORS.INVALID);
  let m = 1;
  return Array.from({ length: LANES }, () => {
    m += step * (1 + (m - 1) * 0.35);
    return Math.round(m * 100) / 100;
  });
}
function cents(betSantim, multiplier) {
  return Math.round(betSantim * multiplier);
}
function newId() { return crypto.randomUUID(); }
function safeJson(value) { return typeof value === 'string' ? JSON.parse(value) : value; }

function createChickenRoadDemoService({ query, withTx, generateSeed = generateRoundSeed }) {
  if (typeof query !== 'function' || typeof withTx !== 'function') throw new TypeError('Database query and transaction helpers are required');

  async function balanceFor(userId, client = null) {
    const run = client ? client.query.bind(client) : query;
    await run(`INSERT INTO chicken_road_dash_demo_balances (user_id, balance_santim)
      VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING`, [userId, START_BALANCE_SANTIM]);
    const r = await run('SELECT balance_santim FROM chicken_road_dash_demo_balances WHERE user_id=$1', [userId]);
    return Number(r.rows[0].balance_santim);
  }

  function publicRound(row, reveal = false) {
    if (!row) return null;
    const detail = safeJson(row.detail);
    const ladder = ladderFor(row.difficulty);
    const step = Number(row.progress);
    const out = {
      id: row.id, active: row.status === 'active', status: row.status,
      difficulty: row.difficulty, bet_santim: Number(row.bet_santim),
      balance_santim: Number(row.demo_balance_santim), step,
      multiplier: row.status === 'crashed' ? 0 : step > 0 ? ladder[Math.min(step, LANES) - 1] : 1,
      ladder, commitment: row.seed_commitment, outcome_root: row.outcome_root,
      engine_version: Number(row.engine_version), probability_version: Number(row.probability_version),
      payout_version: Number(row.payout_version),
      payout_santim: Number(row.payout_santim || 0),
    };
    if (reveal && row.status !== 'active') {
      out.server_seed = detail.seed;
      out.outcomes = detail.outcomes.map((o, i) => ({ ...o, salt: detail.tree.salts[i], proof: detail.tree.proofs[i] }));
      out.verification = { commitment: row.seed_commitment, outcome_root: row.outcome_root,
        engine_version: Number(row.engine_version), probability_version: Number(row.probability_version),
        payout_version: Number(row.payout_version), round_id: row.id, difficulty: row.difficulty };
    }
    return out;
  }

  async function load(userId, id, client, lock = false) {
    const r = await client.query(`SELECT r.*, b.balance_santim AS demo_balance_santim
      FROM chicken_road_dash_demo_rounds r
      JOIN chicken_road_dash_demo_balances b ON b.user_id=r.user_id
      WHERE r.user_id=$1 AND r.id=$2${lock ? ' FOR UPDATE OF r, b' : ''}`, [userId, id]);
    if (!r.rowCount) throw new Error(ERRORS.NOT_FOUND);
    return r.rows[0];
  }

  async function current(userId) {
    const bal = await balanceFor(userId);
    const r = await query(`SELECT r.*, $2::bigint AS demo_balance_santim
      FROM chicken_road_dash_demo_rounds r WHERE r.user_id=$1
      ORDER BY (r.status='active') DESC, r.created_at DESC LIMIT 1`, [userId, bal]);
    return { balance_santim: bal, round: publicRound(r.rows[0], true) };
  }

  async function start(userId, input) {
    const difficulty = String(input?.difficulty || '');
    const bet = Number(input?.bet_santim);
    if (!DIFFICULTIES[difficulty] || !Number.isSafeInteger(bet) || bet < 100 || bet > 50000) throw new Error(ERRORS.INVALID);
    return withTx(async (client) => {
      const prior = await client.query(`SELECT * FROM chicken_road_dash_demo_rounds
        WHERE user_id=$1 AND status='active' FOR UPDATE`, [userId]);
      if (prior.rowCount) {
        const active = await load(userId, prior.rows[0].id, client, true);
        return publicRound(active);
      }
      await client.query(`INSERT INTO chicken_road_dash_demo_balances(user_id,balance_santim)
        VALUES($1,$2) ON CONFLICT(user_id) DO NOTHING`, [userId, START_BALANCE_SANTIM]);
      const balance = await client.query('SELECT balance_santim FROM chicken_road_dash_demo_balances WHERE user_id=$1 FOR UPDATE', [userId]);
      const currentBalance = Number(balance.rows[0].balance_santim);
      const activeAfterBalanceLock = await client.query(`SELECT * FROM chicken_road_dash_demo_rounds
        WHERE user_id=$1 AND status='active' FOR UPDATE`, [userId]);
      if (activeAfterBalanceLock.rowCount) {
        const active = await load(userId, activeAfterBalanceLock.rows[0].id, client, true);
        return publicRound(active);
      }
      if (currentBalance < bet) throw new Error(ERRORS.INSUFFICIENT);
      const id = newId();
      const seed = generateSeed(id, difficulty);
      const outcomes = laneOutcomes(seed, id, difficulty);
      const tree = merkleTree(id, outcomes);
      const detail = { seed: seed.toString('hex'), outcomes, tree, payoutVersion: PAYOUT_VERSION };
      await client.query('UPDATE chicken_road_dash_demo_balances SET balance_santim=balance_santim-$2, updated_at=NOW() WHERE user_id=$1', [userId, bet]);
      const r = await client.query(`INSERT INTO chicken_road_dash_demo_rounds
        (id,user_id,difficulty,status,progress,bet_santim,payout_santim,seed_commitment,outcome_root,detail,engine_version,probability_version,payout_version)
        VALUES($1,$2,$3,'active',0,$4,0,$5,$6,$7::jsonb,$8,$9,$10) RETURNING *`,
      [id, userId, difficulty, bet, commitSeed(seed), tree.root, JSON.stringify(detail), ENGINE_VERSION, PROBABILITY_VERSION, PAYOUT_VERSION]);
      const row = { ...r.rows[0], demo_balance_santim: currentBalance - bet };
      return publicRound(row);
    });
  }

  async function priorAction(client, roundId, actionId, request) {
    const found = await client.query(`SELECT request, response FROM chicken_road_dash_demo_actions
      WHERE round_id=$1 AND action_id=$2`, [roundId, actionId]);
    if (!found.rowCount) return null;
    if (JSON.stringify(safeJson(found.rows[0].request)) !== JSON.stringify(request)) throw new Error(ERRORS.STALE);
    return safeJson(found.rows[0].response);
  }

  async function act(userId, roundId, actionId, kind) {
    if (!/^[0-9a-f-]{36}$/i.test(String(roundId || '')) || !/^[0-9a-f-]{36}$/i.test(String(actionId || ''))) throw new Error(ERRORS.INVALID);
    const request = { type: kind };
    return withTx(async (client) => {
      const row = await load(userId, roundId, client, true);
      // Serialize even idempotency lookups on the owning round row. Two
      // simultaneous retries cannot both miss the action record and execute.
      const cached = await priorAction(client, roundId, actionId, request);
      if (cached) return cached;
      if (row.status !== 'active') throw new Error(ERRORS.SETTLED);
      const detail = safeJson(row.detail);
      const step = Number(row.progress);
      const ladder = ladderFor(row.difficulty);
      let response;
      if (kind === 'cross') {
        const lane = step + 1;
        if (lane > LANES + 1) throw new Error(ERRORS.STALE);
        if (lane === LANES + 1) {
          if (step !== LANES) throw new Error(ERRORS.STALE);
          const mult = ladder[LANES - 1];
          const payout = cents(Number(row.bet_santim), mult);
          await client.query(`UPDATE chicken_road_dash_demo_balances SET balance_santim=balance_santim+$2,updated_at=NOW() WHERE user_id=$1`, [userId, payout]);
          await client.query(`UPDATE chicken_road_dash_demo_rounds SET status='finished',progress=$2,payout_santim=$3,settled_at=NOW(),updated_at=NOW() WHERE id=$1`, [roundId, lane, payout]);
          response = { round_id: roundId, lane, outcome: 'finish', finished: true, crashed: false, step: lane, multiplier: ladder[LANES - 1], payout_santim: payout, balance_santim: Number(row.demo_balance_santim) + payout };
        } else {
          const outcome = detail.outcomes[lane - 1];
          const proof = { lane, outcome: outcome.outcome, salt: detail.tree.salts[lane - 1], proof: detail.tree.proofs[lane - 1], outcome_root: row.outcome_root };
          const crash = outcome.outcome === 'collision';
          if (crash) await client.query(`UPDATE chicken_road_dash_demo_rounds SET status='crashed',progress=$2,settled_at=NOW(),updated_at=NOW() WHERE id=$1`, [roundId, lane]);
          else await client.query(`UPDATE chicken_road_dash_demo_rounds SET progress=$2,updated_at=NOW() WHERE id=$1`, [roundId, lane]);
          response = { round_id: roundId, ...proof, crashed: crash, finished: false, step: lane,
            multiplier: crash ? 0 : ladder[lane - 1], payout_santim: 0,
            balance_santim: Number(row.demo_balance_santim) };
          if (crash) response.reveal = publicRound({ ...row, status: 'crashed', detail }, true);
        }
      } else if (kind === 'cashout') {
        if (step < 1 || step > LANES) throw new Error(ERRORS.STALE);
        const payout = cents(Number(row.bet_santim), ladder[step - 1]);
        await client.query('UPDATE chicken_road_dash_demo_balances SET balance_santim=balance_santim+$2,updated_at=NOW() WHERE user_id=$1', [userId, payout]);
        await client.query(`UPDATE chicken_road_dash_demo_rounds SET status='cashed_out',payout_santim=$2,settled_at=NOW(),updated_at=NOW() WHERE id=$1`, [roundId, payout]);
        response = { round_id: roundId, status: 'cashed_out', step, multiplier: ladder[step - 1], payout_santim: payout, balance_santim: Number(row.demo_balance_santim) + payout };
      } else throw new Error(ERRORS.INVALID);

      if (response.finished || response.crashed || kind === 'cashout') {
        const settled = await load(userId, roundId, client, false);
        response.round = publicRound({ ...settled, detail }, true);
      }
      await client.query(`INSERT INTO chicken_road_dash_demo_actions(round_id,action_id,sequence,action_type,request,response)
        VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)`, [roundId, actionId, step + 1, kind, JSON.stringify(request), JSON.stringify(response)]);
      return response;
    });
  }

  async function verify(userId, roundId) {
    const state = await current(userId);
    const r = await query(`SELECT * FROM chicken_road_dash_demo_rounds WHERE id=$1 AND user_id=$2`, [roundId, userId]);
    if (!r.rowCount) throw new Error(ERRORS.NOT_FOUND);
    const row = { ...r.rows[0], demo_balance_santim: state.balance_santim };
    if (row.status === 'active') throw new Error(ERRORS.INVALID);
    const round = publicRound(row, true);
    const seed = Buffer.from(round.server_seed, 'hex');
    const generated = laneOutcomes(seed, round.id, round.difficulty);
    const proofChecks = round.outcomes.map((o) => verifyProof(round.id, o.lane, o.outcome, o.salt, o.proof, round.outcome_root));
    return { ...round.verification, seed_commit_valid: commitSeed(seed) === round.commitment,
      outcomes_match_seed: generated.every((o, i) => o.outcome === round.outcomes[i].outcome && o.uniform === round.outcomes[i].uniform),
      merkle_proofs_valid: proofChecks.every(Boolean), outcomes: round.outcomes };
  }

  async function reset(userId) {
    return withTx(async (client) => {
      await client.query(`INSERT INTO chicken_road_dash_demo_balances(user_id,balance_santim)
        VALUES($1,$2) ON CONFLICT(user_id) DO NOTHING`, [userId, START_BALANCE_SANTIM]);
      const r = await client.query(`UPDATE chicken_road_dash_demo_balances SET balance_santim=$2,updated_at=NOW()
        WHERE user_id=$1 RETURNING balance_santim`, [userId, START_BALANCE_SANTIM]);
      return { balance_santim: Number(r.rows[0].balance_santim) };
    });
  }

  return { current, start, cross: (userId, roundId, actionId) => act(userId, roundId, actionId, 'cross'),
    cashout: (userId, roundId, actionId) => act(userId, roundId, actionId, 'cashout'), verify, reset };
}

module.exports = { createChickenRoadDemoService, ladderFor, cents, START_BALANCE_SANTIM, LANES, PAYOUT_VERSION, ERRORS };
