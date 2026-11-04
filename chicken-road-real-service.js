'use strict';

// Chicken Road 2.0 real-wallet settlement service.
// The wallet is the only balance source. Bets and payouts are posted through
// the shared ledger helper inside the caller-provided transaction.
const crypto = require('node:crypto');
const {
  generateRoundSeed,
  commitSeed,
  laneOutcomesV2,
  merkleTreeV2,
  verifyProof,
  ENGINE_VERSION_V2,
  PROBABILITY_VERSION_V2,
} = require('./chicken-road-committed');
const {
  CONFIG_VERSION,
  PAYOUT_VERSION,
  modeConfig,
  payoutFor,
  conditionalSurvivalForLevel,
  percentFromPpb,
} = require('./chicken-road-2-config');
const { postLedger } = require('./db');

const MIN_BET_SANTIM = 100;
const MAX_BET_SANTIM = 50000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createChickenRoadRealService({
  query,
  withTx,
  ledger = postLedger,
  generateSeed = generateRoundSeed,
  generateId = crypto.randomUUID,
}) {
  if (typeof query !== 'function' || typeof withTx !== 'function') {
    throw new TypeError('Database query and transaction helpers are required');
  }

  const json = (value) => (typeof value === 'string' ? JSON.parse(value) : value);

  function multiplierAt(difficulty, step) {
    const mode = modeConfig(difficulty);
    if (step <= 0) return 1;
    return Number(mode.multipliers[Math.min(step, mode.lanes) - 1]);
  }

  function view(row, balance, reveal = false) {
    if (!row) return null;
    const mode = modeConfig(row.difficulty);
    const detail = json(row.detail);
    const step = Number(row.progress);
    const ladder = mode.multipliers.map(Number);
    const settled = row.status !== 'active';
    const multiplier = row.status === 'crashed' ? 0 : multiplierAt(row.difficulty, step);
    const out = {
      id: row.id,
      active: row.status === 'active',
      status: row.status,
      difficulty: row.difficulty,
      bet_santim: Number(row.bet_santim),
      balance_santim: Number(balance),
      step,
      lanes: mode.lanes,
      lines: [...mode.lines],
      line: step > 0 ? mode.lines[Math.min(step, mode.lanes) - 1] : null,
      multiplier,
      ladder,
      commitment: row.seed_commitment,
      outcome_root: row.outcome_root,
      engine_version: Number(row.engine_version),
      probability_version: Number(row.probability_version),
      payout_version: Number(row.payout_version),
      config_version: CONFIG_VERSION,
      payout_santim: Number(row.payout_santim || 0),
    };
    if (reveal && settled) {
      out.server_seed = detail.seed;
      out.outcomes = detail.outcomes.map((outcome, index) => ({
        ...outcome,
        salt: detail.tree.salts[index],
        proof: detail.tree.proofs[index],
      }));
      out.verification = {
        commitment: row.seed_commitment,
        outcome_root: row.outcome_root,
        engine_version: Number(row.engine_version),
        probability_version: Number(row.probability_version),
        payout_version: Number(row.payout_version),
        config_version: CONFIG_VERSION,
        round_id: row.id,
        difficulty: row.difficulty,
        lanes: mode.lanes,
      };
    }
    return out;
  }

  async function current(userId) {
    const wallet = await query('SELECT balance FROM wallets WHERE user_id=$1', [userId]);
    if (!wallet.rowCount) throw new Error('NOT_FOUND');
    const balance = Number(wallet.rows[0].balance);
    const rounds = await query(
      `SELECT * FROM chicken_road_dash_rounds WHERE user_id=$1
       ORDER BY (status='active') DESC, created_at DESC LIMIT 1`,
      [userId]
    );
    const row = rounds.rows[0] || null;
    return { balance_santim: balance, round: view(row, balance, row && row.status !== 'active') };
  }

  async function start(userId, input) {
    const difficulty = String(input?.difficulty || '').toLowerCase();
    const bet = Number(input?.bet_santim);
    const actionId = String(input?.action_id || '');
    if (!modeConfigSafe(difficulty) ||
        !Number.isSafeInteger(bet) ||
        bet < MIN_BET_SANTIM ||
        bet > MAX_BET_SANTIM ||
        !UUID_PATTERN.test(actionId)) {
      throw new Error('INVALID');
    }
    const mode = modeConfig(difficulty);
    const request = { difficulty, bet_santim: bet };

    return withTx(async (client) => {
      const wallet = await client.query('SELECT balance FROM wallets WHERE user_id=$1 FOR UPDATE', [userId]);
      if (!wallet.rowCount) throw new Error('NOT_FOUND');
      const balance = Number(wallet.rows[0].balance);

      const previous = await client.query(
        'SELECT * FROM chicken_road_dash_rounds WHERE user_id=$1 AND start_action_id=$2 FOR UPDATE',
        [userId, actionId]
      );
      if (previous.rowCount) {
        const existing = previous.rows[0];
        const oldRequest = json(existing.start_request);
        if (oldRequest.difficulty !== request.difficulty || Number(oldRequest.bet_santim) !== request.bet_santim) {
          throw new Error('STALE_ACTION');
        }
        return view(existing, balance, existing.status !== 'active');
      }

      const active = await client.query(
        "SELECT * FROM chicken_road_dash_rounds WHERE user_id=$1 AND status='active' FOR UPDATE",
        [userId]
      );
      if (active.rowCount) return view(active.rows[0], balance);
      if (balance < bet) throw new Error('INSUFFICIENT');

      const id = generateId();
      const seed = generateSeed();
      if (!Buffer.isBuffer(seed) || seed.length !== 32) throw new TypeError('Expected a 256-bit server seed');
      const outcomes = laneOutcomesV2(seed, id, difficulty);
      const tree = merkleTreeV2(id, outcomes);
      const detail = {
        seed: seed.toString('hex'),
        outcomes,
        tree,
        configVersion: CONFIG_VERSION,
        payoutVersion: PAYOUT_VERSION,
        lanes: mode.lanes,
        lines: [...mode.lines],
      };

      const game = await client.query(
        `INSERT INTO game_rounds
          (user_id,game,bet,payout,step,status,detail,server_seed,server_seed_hash,difficulty)
         VALUES($1,'chicken-road-dash',$2,0,0,'active',$3,$4,$5,$6) RETURNING id`,
        [userId, bet, JSON.stringify({ round_id: id, config_version: CONFIG_VERSION }), seed.toString('hex'), commitSeed(seed), difficulty]
      );
      const gameRoundId = Number(game.rows[0].id);

      await ledger({
        client,
        userId,
        delta: -bet,
        type: 'bet',
        refType: 'game_round',
        refId: gameRoundId,
      });

      const inserted = await client.query(
        `INSERT INTO chicken_road_dash_rounds
          (id,user_id,difficulty,status,progress,bet_santim,seed_commitment,outcome_root,detail,
           engine_version,probability_version,payout_version,start_action_id,start_request,game_round_id)
         VALUES($1,$2,$3,'active',0,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12::jsonb,$13) RETURNING *`,
        [
          id, userId, difficulty, bet, commitSeed(seed), tree.root, JSON.stringify(detail),
          ENGINE_VERSION_V2, PROBABILITY_VERSION_V2, PAYOUT_VERSION,
          actionId, JSON.stringify(request), gameRoundId,
        ]
      );
      return view(inserted.rows[0], balance - bet);
    });
  }

  async function act(userId, roundId, actionId, kind) {
    if (!UUID_PATTERN.test(String(roundId || '')) ||
        !UUID_PATTERN.test(String(actionId || '')) ||
        (kind !== 'cross' && kind !== 'cashout')) {
      throw new Error('INVALID');
    }
    const request = { type: kind };
    return withTx(async (client) => {
      const wallet = await client.query('SELECT balance FROM wallets WHERE user_id=$1 FOR UPDATE', [userId]);
      if (!wallet.rowCount) throw new Error('NOT_FOUND');
      const balance = Number(wallet.rows[0].balance);
      const found = await client.query(
        'SELECT * FROM chicken_road_dash_rounds WHERE id=$1 AND user_id=$2 FOR UPDATE',
        [roundId, userId]
      );
      if (!found.rowCount) throw new Error('NOT_FOUND');
      const row = found.rows[0];

      const cached = await client.query(
        'SELECT request,response FROM chicken_road_dash_actions WHERE round_id=$1 AND action_id=$2',
        [roundId, actionId]
      );
      if (cached.rowCount) {
        if (JSON.stringify(json(cached.rows[0].request)) !== JSON.stringify(request)) {
          throw new Error('STALE_ACTION');
        }
        return json(cached.rows[0].response);
      }
      if (row.status !== 'active') throw new Error('ROUND_SETTLED');

      const mode = modeConfig(row.difficulty);
      const detail = json(row.detail);
      const step = Number(row.progress);
      const bet = Number(row.bet_santim);
      let response;

      if (kind === 'cross') {
        const lane = step + 1;
        if (lane > mode.lanes + 1) throw new Error('STALE_ACTION');

        if (lane === mode.lanes + 1) {
          if (step !== mode.lanes) throw new Error('STALE_ACTION');
          const multiplier = Number(mode.multipliers[mode.lanes - 1]);
          const payout = payoutFor(bet, mode.multiplierCents[mode.lanes - 1]);
          const balanceAfter = Number(await ledger({
            client,
            userId,
            delta: payout,
            type: 'win',
            refType: 'game_round',
            refId: Number(row.game_round_id),
          }));
          await client.query(
            `UPDATE chicken_road_dash_rounds
             SET status='finished',progress=$2,payout_santim=$3,settled_at=NOW(),updated_at=NOW()
             WHERE id=$1`,
            [roundId, mode.lanes, payout]
          );
          await client.query(
            'UPDATE game_rounds SET status=$2,step=$3,payout=$4,detail=$5 WHERE id=$1',
            [row.game_round_id, 'done', mode.lanes, payout, JSON.stringify({ round_id: roundId, finished: true, config_version: CONFIG_VERSION })]
          );
          response = {
            round_id: roundId,
            lane: mode.lanes,
            line: mode.lines[mode.lanes - 1],
            outcome: 'finish',
            finished: true,
            crashed: false,
            step: mode.lanes,
            multiplier,
            payout_santim: payout,
            balance_santim: balanceAfter,
          };
        } else {
          const outcome = detail.outcomes[lane - 1];
          if (!outcome) throw new Error('INVALID');
          const crash = outcome.outcome === 'collision';
          if (crash) {
            await client.query(
              `UPDATE chicken_road_dash_rounds
               SET status='crashed',progress=$2,settled_at=NOW(),updated_at=NOW()
               WHERE id=$1`,
              [roundId, lane]
            );
            await client.query(
              'UPDATE game_rounds SET status=$2,step=$3,detail=$4 WHERE id=$1',
              [row.game_round_id, 'done', lane, JSON.stringify({ round_id: roundId, crashed: true, config_version: CONFIG_VERSION })]
            );
          } else {
            await client.query(
              'UPDATE chicken_road_dash_rounds SET progress=$2,updated_at=NOW() WHERE id=$1',
              [roundId, lane]
            );
          }
          const survival = conditionalSurvivalForLevel(row.difficulty, lane);
          response = {
            round_id: roundId,
            lane,
            line: outcome.line,
            outcome: outcome.outcome,
            cumulative_probability_ppb: outcome.cumulativeProbabilityPpb,
            cumulative_probability_pct: percentFromPpb(outcome.cumulativeProbabilityPpb),
            survival_numerator: survival.numerator,
            survival_denominator: survival.denominator,
            uniform: outcome.uniform,
            salt: detail.tree.salts[lane - 1],
            proof: detail.tree.proofs[lane - 1],
            outcome_root: row.outcome_root,
            crashed: crash,
            finished: false,
            step: lane,
            multiplier: crash ? 0 : Number(mode.multipliers[lane - 1]),
            payout_santim: 0,
            balance_santim: balance,
          };
        }
      } else {
        if (step < 1 || step > mode.lanes) throw new Error('STALE_ACTION');
        const multiplier = Number(mode.multipliers[step - 1]);
        const payout = payoutFor(bet, mode.multiplierCents[step - 1]);
        const balanceAfter = Number(await ledger({
          client,
          userId,
          delta: payout,
          type: 'win',
          refType: 'game_round',
          refId: Number(row.game_round_id),
        }));
        await client.query(
          `UPDATE chicken_road_dash_rounds
           SET status='cashed_out',payout_santim=$2,settled_at=NOW(),updated_at=NOW()
           WHERE id=$1`,
          [roundId, payout]
        );
        await client.query(
          'UPDATE game_rounds SET status=$2,step=$3,payout=$4,detail=$5 WHERE id=$1',
          [row.game_round_id, 'done', step, payout, JSON.stringify({ round_id: roundId, cashout: true, config_version: CONFIG_VERSION })]
        );
        response = {
          round_id: roundId,
          status: 'cashed_out',
          step,
          line: mode.lines[step - 1],
          multiplier,
          payout_santim: payout,
          balance_santim: balanceAfter,
        };
      }

      await client.query(
        `INSERT INTO chicken_road_dash_actions
          (round_id,action_id,sequence,action_type,request,response)
         VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
        [roundId, actionId, step + 1, kind, JSON.stringify(request), JSON.stringify(response)]
      );
      return response;
    });
  }

  async function verify(userId, roundId) {
    if (!UUID_PATTERN.test(String(roundId || ''))) throw new Error('INVALID');
    const result = await query(
      `SELECT r.*,w.balance AS wallet_balance
       FROM chicken_road_dash_rounds r
       JOIN wallets w ON w.user_id=r.user_id
       WHERE r.id=$1 AND r.user_id=$2`,
      [roundId, userId]
    );
    if (!result.rowCount) throw new Error('NOT_FOUND');
    const row = result.rows[0];
    if (row.status === 'active') throw new Error('INVALID');

    const mode = modeConfig(row.difficulty);
    const detail = json(row.detail);
    const seed = Buffer.from(detail.seed, 'hex');
    const generated = laneOutcomesV2(seed, roundId, row.difficulty);
    const round = view(row, Number(row.wallet_balance), true);
    const proofChecks = round.outcomes.map((outcome, index) =>
      verifyProof(round.id, outcome.lane, outcome.outcome, outcome.salt, outcome.proof, round.outcome_root)
    );
    return {
      ...round.verification,
      seed_commit_valid: commitSeed(seed) === row.seed_commitment,
      outcomes_match_seed: generated.every((outcome, index) =>
        outcome.outcome === round.outcomes[index].outcome &&
        outcome.uniform === round.outcomes[index].uniform
      ),
      probabilities_match_config: generated.every((outcome, index) =>
        outcome.cumulativeProbabilityPpb === mode.cumulativeProbabilityPpb[index] &&
        outcome.line === mode.lines[index]
      ),
      merkle_proofs_valid: proofChecks.every(Boolean),
      outcomes: round.outcomes,
    };
  }

  return {
    current,
    start,
    cross: (userId, roundId, actionId) => act(userId, roundId, actionId, 'cross'),
    cashout: (userId, roundId, actionId) => act(userId, roundId, actionId, 'cashout'),
    verify,
  };
}

function modeConfigSafe(difficulty) {
  try {
    modeConfig(difficulty);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  createChickenRoadRealService,
  MIN_BET_SANTIM,
  MAX_BET_SANTIM,
};
