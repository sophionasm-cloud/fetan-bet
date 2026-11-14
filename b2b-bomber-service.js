'use strict';

// B2B Bomber server-authoritative round service.
//
// The outcome is fixed from a fresh 256-bit server seed before the flight and
// is never sent to the browser while the round is active. Only this service
// decides the crash, whether a cash-out succeeded, and the payout. Wallet
// settlement uses the shared ledger helper inside a caller transaction.
//
// Storage is intentionally additive-free: the existing game_rounds row holds
// the seed commitment, client seed, bet, payout and a JSON detail document.
const crypto = require('node:crypto');
const math = require('./b2b-bomber-math');
const { postLedger } = require('./db');

const GAME_KEY = 'b2b-bomber';
const RECENT_LIMIT = 12;
const HISTORY_LIMIT = 20;
const LAST_RESULT_WINDOW_MS = 10 * 60 * 1000;
const SWEEP_LIMIT = 50;
const SWEEP_INTERVAL_MS = 1000;

function parseDetail(row) {
  if (!row || row.detail == null) return {};
  if (typeof row.detail === 'object') return row.detail;
  try {
    return JSON.parse(row.detail);
  } catch {
    return {};
  }
}

function statusFor(detail) {
  if (detail.result === 'cashout' || detail.result === 'auto_cashout') return 'cashed_out';
  if (detail.result === 'lost') return 'lost';
  return 'active';
}

function createB2BBomberService({
  query,
  withTx,
  ledger = postLedger,
  generateSeed = () => crypto.randomBytes(math.SERVER_SEED_BYTES),
  generateId = () => crypto.randomUUID(),
  now = () => Date.now(),
} = {}) {
  if (typeof query !== 'function' || typeof withTx !== 'function') {
    throw new TypeError('Database query and transaction helpers are required');
  }

  function rules() {
    return {
      rtp_percent: math.RTP_PERCENT,
      house_edge_percent: math.HOUSE_EDGE_PERCENT,
      min_bet_santim: math.MIN_BET_SANTIM,
      max_bet_santim: math.MAX_BET_SANTIM,
      max_multiplier: math.MAX_MULTIPLIER,
      math_version: math.MATH_VERSION,
      fairness_version: math.FAIRNESS_VERSION,
      immediate_crash_percent: math.ratioToDecimal(math.immediateCrashCount() * 100n, math.UNIFORM_SPACE, 4),
      probability_examples: [
        { multiplier: 1.5, percent: math.probabilityPercent(150, 4) },
        { multiplier: 2, percent: math.probabilityPercent(200, 4) },
        { multiplier: 5, percent: math.probabilityPercent(500, 4) },
        { multiplier: 10, percent: math.probabilityPercent(1000, 4) },
        { multiplier: 50, percent: math.probabilityPercent(5000, 4) },
      ],
      note: '40% is a long-run theoretical return. Individual rounds are independent and are not predictions.',
    };
  }

  function view(row, balance, at = now()) {
    if (!row) return null;
    const detail = parseDetail(row);
    const crash = Number(detail.crashHundredths);
    const active = row.status === 'active';
    const bet = Number(row.bet_santim ?? row.bet);
    const payout = Number(row.payout || 0);
    const startsAt = Number(detail.startsAt);
    const flightStartedAt = Number(detail.flightStartedAt);
    const auto = detail.autoCashoutHundredths == null ? null : Number(detail.autoCashoutHundredths);
    const result = active ? null : (detail.result || 'lost');

    let phase = 'settled';
    if (active) {
      if (at < startsAt) phase = 'countdown';
      else if (at < flightStartedAt) phase = 'takeoff';
      else phase = 'flying';
    } else if (result === 'lost') {
      phase = 'crashed';
    }

    const current = active ? math.currentHundredths(at, flightStartedAt, crash) : crash;
    const cashout = detail.cashoutHundredths == null ? null : Number(detail.cashoutHundredths);
    const shown = active ? current : (cashout || crash);

    return {
      id: Number(row.id),
      round_id: detail.roundId || null,
      status: active ? 'active' : statusFor(detail),
      active,
      phase,
      result,
      bet_santim: bet,
      payout_santim: payout,
      net_santim: payout - bet,
      balance_santim: Number(balance),
      multiplier_hundredths: shown,
      multiplier: shown / 100,
      auto_cashout_hundredths: auto,
      auto_cashout: auto == null ? null : auto / 100,
      can_cashout: Boolean(active && phase === 'flying' && current >= 101 && current <= crash && at < Number(detail.crashAt)),
      potential_payout_santim: active && current >= 101 ? math.payoutSantim(bet, current) : 0,
      crash_hundredths: active ? null : crash,
      crash_multiplier: active ? null : crash / 100,
      cashout_hundredths: active ? null : cashout,
      cashout_multiplier: active ? null : (cashout == null ? null : cashout / 100),
      starts_at: startsAt,
      flight_started_at: flightStartedAt,
      server_seed_hash: row.server_seed_hash,
      client_seed: row.client_seed,
      nonce: detail.nonce || null,
      math_version: detail.mathVersion || math.MATH_VERSION,
      fairness_version: detail.fairnessVersion || math.FAIRNESS_VERSION,
      created_at: row.created_at,
      settled_at: detail.settledAt || null,
    };
  }

  async function walletBalance(client, userId) {
    const res = await client.query('SELECT balance FROM wallets WHERE user_id=$1', [userId]);
    if (!res.rowCount) throw new Error('NOT_FOUND');
    return Number(res.rows[0].balance);
  }

  function resolutionAt(detail) {
    const auto = detail.autoCashoutHundredths == null ? null : Number(detail.autoCashoutHundredths);
    const crash = Number(detail.crashHundredths);
    if (auto != null && auto <= crash) {
      return Number(detail.flightStartedAt) + math.flightDurationMs(auto);
    }
    return Number(detail.crashAt);
  }

  async function settleIfDue(client, row, at) {
    if (!row || row.status !== 'active') return row;
    const detail = parseDetail(row);
    if (at < resolutionAt(detail)) return row;

    const bet = Number(row.bet_santim ?? row.bet);
    const crash = Number(detail.crashHundredths);
    const auto = detail.autoCashoutHundredths == null ? null : Number(detail.autoCashoutHundredths);
    const autoWins = auto != null && auto <= crash;
    const result = autoWins ? 'auto_cashout' : 'lost';
    const cashoutHundredths = autoWins ? auto : null;
    const payout = autoWins ? math.payoutSantim(bet, auto) : 0;
    const settledAt = at;

    const updated = await client.query(
      `UPDATE game_rounds
       SET status='done', payout=$2, step=$3, detail=$4
       WHERE id=$1 AND status='active'
       RETURNING *`,
      [row.id, payout, cashoutHundredths == null ? 0 : cashoutHundredths, JSON.stringify({
        ...detail,
        result,
        cashoutHundredths,
        settledAt,
      })]
    );
    if (updated.rowCount === 0) {
      const current = await client.query('SELECT * FROM game_rounds WHERE id=$1', [row.id]);
      return current.rows[0] || row;
    }
    if (payout > 0) {
      await ledger({
        client,
        userId: Number(row.user_id),
        delta: payout,
        type: 'win',
        refType: 'round',
        refId: Number(row.id),
      });
    }
    return updated.rows[0];
  }

  async function current(userId) {
    if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('INVALID');
    const wallet = await query('SELECT balance FROM wallets WHERE user_id=$1', [userId]);
    if (!wallet.rowCount) throw new Error('NOT_FOUND');

    const latest = await query(
      `SELECT * FROM game_rounds WHERE user_id=$1 AND game=$2 ORDER BY id DESC LIMIT 1`,
      [userId, GAME_KEY]
    );
    let row = latest.rows[0] || null;
    const at = now();
    if (row && row.status === 'active' && at >= resolutionAt(parseDetail(row))) {
      const due = await withTx(async (client) => {
        // Lock order is always wallet then round. Cash-out, sweep and start
        // share it so concurrent settlement cannot form a deadlock cycle.
        const walletLock = await client.query(
          'SELECT balance FROM wallets WHERE user_id=$1 FOR UPDATE',
          [userId]
        );
        if (!walletLock.rowCount) throw new Error('NOT_FOUND');
        const locked = await client.query(
          `SELECT * FROM game_rounds WHERE id=$1 AND user_id=$2 AND game=$3 FOR UPDATE`,
          [row.id, userId, GAME_KEY]
        );
        if (!locked.rowCount) return row;
        return settleIfDue(client, locked.rows[0], now());
      });
      row = due || row;
    }

    if (row && row.status !== 'active') {
      const settledAt = Number(parseDetail(row).settledAt || 0);
      if (!settledAt || at - settledAt > LAST_RESULT_WINDOW_MS) row = null;
    }

    const balance = await walletBalance({ query }, userId);
    const recent = await query(
      `SELECT * FROM game_rounds
       WHERE user_id=$1 AND game=$2 AND status<>'active'
       ORDER BY id DESC LIMIT $3`,
      [userId, GAME_KEY, RECENT_LIMIT]
    );
    return {
      game: GAME_KEY,
      server_now: at,
      balance_santim: balance,
      round: view(row, balance, at),
      recent: recent.rows.map((item) => {
        const detail = parseDetail(item);
        return {
          id: Number(item.id),
          bet_santim: Number(item.bet_santim ?? item.bet),
          payout_santim: Number(item.payout || 0),
          crash_hundredths: Number(detail.crashHundredths),
          crash_multiplier: Number(detail.crashHundredths) / 100,
          cashout_hundredths: detail.cashoutHundredths == null ? null : Number(detail.cashoutHundredths),
          result: detail.result || 'lost',
          created_at: item.created_at,
        };
      }),
      rules: rules(),
    };
  }

  async function start(userId, input = {}) {
    if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('INVALID');
    const bet = Number(input.bet_santim);
    const actionId = String(input.action_id || '').toLowerCase();
    const rawAuto = input.auto_cashout_hundredths;
    const auto = rawAuto == null || rawAuto === '' ? null : Number(rawAuto);
    const clientSeedInput = math.sanitizeClientSeed(input.client_seed);
    if (!math.isValidBet(bet) || !math.UUID_PATTERN.test(actionId)) throw new Error('INVALID');
    if (auto != null && !math.isValidAutoTarget(auto)) throw new Error('INVALID');

    return withTx(async (client) => {
      // The wallet row is the per-user serialization point. It also prevents
      // two simultaneous start requests from creating two active rounds.
      const wallet = await client.query('SELECT balance FROM wallets WHERE user_id=$1 FOR UPDATE', [userId]);
      if (!wallet.rowCount) throw new Error('NOT_FOUND');
      const balance = Number(wallet.rows[0].balance);

      const prior = await client.query(
        `SELECT * FROM game_rounds
         WHERE user_id=$1 AND game=$2 AND detail::jsonb->>'startActionId'=$3
         ORDER BY id DESC LIMIT 1`,
        [userId, GAME_KEY, actionId]
      );
      if (prior.rowCount) {
        const existing = prior.rows[0];
        const priorDetail = parseDetail(existing);
        const snapshot = priorDetail.startRequest;
        if (snapshot && (
          Number(snapshot.bet_santim) !== bet ||
          (snapshot.auto_cashout_hundredths == null ? null : Number(snapshot.auto_cashout_hundredths)) !== auto ||
          String(snapshot.client_seed || '') !== clientSeedInput
        )) {
          throw new Error('STALE_ACTION');
        }
        return {
          replayed: true,
          round: view(existing, balance),
          balance_santim: balance,
          server_now: now(),
          rules: rules(),
        };
      }

      const active = await client.query(
        `SELECT * FROM game_rounds WHERE user_id=$1 AND game=$2 AND status='active' FOR UPDATE`,
        [userId, GAME_KEY]
      );
      if (active.rowCount) throw new Error('ACTIVE_ROUND');
      if (balance < bet) throw new Error('INSUFFICIENT');

      const serverSeed = generateSeed();
      if (!Buffer.isBuffer(serverSeed) || serverSeed.length !== math.SERVER_SEED_BYTES) {
        throw new TypeError('Expected a 256-bit server seed');
      }
      const serverSeedHex = serverSeed.toString('hex');
      const commitment = math.commitServerSeed(serverSeed);
      const clientSeed = math.clientSeedForRound(clientSeedInput);
      const roundUuid = generateId();
      if (!math.UUID_PATTERN.test(roundUuid)) throw new TypeError('Expected a UUID round identifier');
      const outcome = math.crashFromSeed(serverSeedHex, clientSeed, roundUuid);
      const at = now();
      const timing = math.timingFor(outcome.crash_hundredths, at);
      const detail = {
        roundId: roundUuid,
        startActionId: actionId,
        startRequest: {
          bet_santim: bet,
          auto_cashout_hundredths: auto,
          client_seed: clientSeedInput,
        },
        crashHundredths: outcome.crash_hundredths,
        autoCashoutHundredths: auto,
        startsAt: timing.starts_at,
        flightStartedAt: timing.flight_started_at,
        crashAt: timing.crash_at,
        result: null,
        cashoutHundredths: null,
        settledAt: null,
        nonce: roundUuid,
        mathVersion: math.MATH_VERSION,
        fairnessVersion: math.FAIRNESS_VERSION,
        engineVersion: math.ENGINE_VERSION,
      };

      const inserted = await client.query(
        `INSERT INTO game_rounds
          (user_id, game, bet, payout, step, status, detail, server_seed, client_seed, server_seed_hash, difficulty)
         VALUES ($1,$2,$3,0,0,'active',$4,$5,$6,$7,'standard')
         RETURNING *`,
        [userId, GAME_KEY, bet, JSON.stringify(detail), serverSeedHex, clientSeed, commitment]
      );
      const row = inserted.rows[0];
      const balanceAfter = await ledger({
        client,
        userId,
        delta: -bet,
        type: 'bet',
        refType: 'round',
        refId: Number(row.id),
      });
      return {
        replayed: false,
        round: view(row, balanceAfter, at),
        balance_santim: Number(balanceAfter),
        server_now: at,
        rules: rules(),
      };
    });
  }

  async function cashout(userId, input = {}) {
    if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('INVALID');
    const roundId = Number(input.round_id);
    const actionId = String(input.action_id || '').toLowerCase();
    if (!Number.isSafeInteger(roundId) || roundId <= 0 || !math.UUID_PATTERN.test(actionId)) {
      throw new Error('INVALID');
    }

    return withTx(async (client) => {
      // Lock wallet then round, matching start/current/sweep. The lock wait is
      // part of processing time, so the multiplier is read after the lock is
      // granted rather than from a timestamp captured before the request
      // waited behind another transaction.
      const wallet = await client.query(
        'SELECT balance FROM wallets WHERE user_id=$1 FOR UPDATE',
        [userId]
      );
      if (!wallet.rowCount) throw new Error('NOT_FOUND');
      const balance = Number(wallet.rows[0].balance);

      const found = await client.query(
        `SELECT * FROM game_rounds WHERE id=$1 AND user_id=$2 AND game=$3 FOR UPDATE`,
        [roundId, userId, GAME_KEY]
      );
      if (!found.rowCount) throw new Error('NOT_FOUND');
      const row = found.rows[0];
      const at = now();
      if (row.status !== 'active') {
        return { replayed: true, round: view(row, balance, at), balance_santim: balance, server_now: at };
      }

      const detail = parseDetail(row);
      const settled = await settleIfDue(client, row, at);
      if (settled.status !== 'active') {
        const after = await walletBalance(client, userId);
        return {
          replayed: false,
          settled: true,
          round: view(settled, after, at),
          balance_santim: after,
          server_now: at,
        };
      }

      const crash = Number(detail.crashHundredths);
      const flightStartedAt = Number(detail.flightStartedAt);
      const currentHundredths = math.currentHundredths(at, flightStartedAt, crash);
      if (at < flightStartedAt || currentHundredths < 101) {
        throw new Error('INVALID');
      }

      const bet = Number(row.bet_santim ?? row.bet);
      const payout = math.payoutSantim(bet, currentHundredths);
      const updated = await client.query(
        `UPDATE game_rounds
         SET status='done', payout=$2, step=$3, detail=$4
         WHERE id=$1 AND status='active'
         RETURNING *`,
        [roundId, payout, currentHundredths, JSON.stringify({
          ...detail,
          result: 'cashout',
          cashoutHundredths: currentHundredths,
          cashoutActionId: actionId,
          settledAt: at,
        })]
      );
      if (updated.rowCount === 0) {
        const again = await client.query('SELECT * FROM game_rounds WHERE id=$1', [roundId]);
        return { replayed: true, round: view(again.rows[0], balance, at), balance_santim: balance, server_now: at };
      }
      const balanceAfter = await ledger({
        client,
        userId,
        delta: payout,
        type: 'win',
        refType: 'round',
        refId: roundId,
      });
      return {
        replayed: false,
        settled: false,
        round: view(updated.rows[0], balanceAfter, at),
        balance_santim: Number(balanceAfter),
        server_now: at,
      };
    });
  }

  async function history(userId) {
    if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('INVALID');
    const result = await query(
      `SELECT * FROM game_rounds
       WHERE user_id=$1 AND game=$2
       ORDER BY id DESC LIMIT $3`,
      [userId, GAME_KEY, HISTORY_LIMIT]
    );
    return {
      game: GAME_KEY,
      history: result.rows.map((row) => {
        const detail = parseDetail(row);
        const active = row.status === 'active';
        const bet = Number(row.bet_santim ?? row.bet);
        const payout = Number(row.payout || 0);
        return {
          id: Number(row.id),
          active,
          status: active ? 'active' : statusFor(detail),
          result: active ? null : (detail.result || 'lost'),
          bet_santim: bet,
          payout_santim: payout,
          crash_hundredths: active ? null : Number(detail.crashHundredths),
          crash_multiplier: active ? null : Number(detail.crashHundredths) / 100,
          cashout_hundredths: active || detail.cashoutHundredths == null ? null : Number(detail.cashoutHundredths),
          created_at: row.created_at,
          server_seed: active ? null : row.server_seed,
          server_seed_hash: row.server_seed_hash,
          client_seed: row.client_seed,
          nonce: active ? null : (detail.nonce || null),
        };
      }),
    };
  }

  async function verifyOwned(userId, roundId) {
    const id = Number(roundId);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('INVALID');
    const result = await query(
      'SELECT * FROM game_rounds WHERE id=$1 AND user_id=$2 AND game=$3',
      [id, userId, GAME_KEY]
    );
    if (!result.rowCount) throw new Error('NOT_FOUND');
    const row = result.rows[0];
    if (row.status === 'active') throw new Error('INVALID');
    const detail = parseDetail(row);
    const recomputed = math.crashFromSeed(row.server_seed, row.client_seed, detail.nonce || detail.roundId);
    return {
      round_id: detail.roundId,
      server_seed: row.server_seed,
      server_seed_hash: row.server_seed_hash,
      client_seed: row.client_seed,
      nonce: detail.nonce || detail.roundId,
      commitment_valid: math.commitServerSeed(row.server_seed) === row.server_seed_hash,
      computed_uniform: recomputed.uniform_hex,
      computed_crash_hundredths: recomputed.crash_hundredths,
      recorded_crash_hundredths: Number(detail.crashHundredths),
      outcome_matches: recomputed.crash_hundredths === Number(detail.crashHundredths),
      math_version: detail.mathVersion,
      fairness_version: detail.fairnessVersion,
      algorithm: 'HMAC-SHA256(server_seed, client_seed + ":" + nonce + ":b2b-bomber:v1"), BigInt crash formula',
    };
  }

  function verifyPayload(input = {}) {
    if (typeof input.server_seed !== 'string' || typeof input.nonce !== 'string') {
      throw new Error('INVALID');
    }
    const seed = input.server_seed;
    const clientSeed = math.sanitizeClientSeed(input.client_seed);
    const nonce = input.nonce;
    if (!/^[0-9a-f]{64}$/i.test(seed) || !nonce || nonce.length > 80) throw new Error('INVALID');
    const recomputed = math.crashFromSeed(seed, clientSeed, nonce);
    return {
      server_seed_hash: math.commitServerSeed(seed),
      client_seed: clientSeed,
      nonce,
      computed_uniform: recomputed.uniform_hex,
      computed_crash_hundredths: recomputed.crash_hundredths,
      computed_crash_multiplier: recomputed.crash_hundredths / 100,
      math_version: math.MATH_VERSION,
      fairness_version: math.FAIRNESS_VERSION,
      algorithm: 'HMAC-SHA256(server_seed, client_seed + ":" + nonce + ":b2b-bomber:v1"), BigInt crash formula',
    };
  }

  async function sweep() {
    const due = await query(
      `SELECT id, user_id FROM game_rounds
       WHERE game=$1 AND status='active'
       ORDER BY id ASC LIMIT $2`,
      [GAME_KEY, SWEEP_LIMIT]
    );
    let settled = 0;
    for (const item of due.rows) {
      try {
        const changed = await withTx(async (client) => {
          const wallet = await client.query(
            'SELECT balance FROM wallets WHERE user_id=$1 FOR UPDATE',
            [item.user_id]
          );
          if (!wallet.rowCount) return false;
          const locked = await client.query(
            'SELECT * FROM game_rounds WHERE id=$1 AND status=$2 FOR UPDATE',
            [item.id, 'active']
          );
          if (!locked.rowCount) return false;
          const after = await settleIfDue(client, locked.rows[0], now());
          return after && after.status !== 'active';
        });
        if (changed) settled++;
      } catch (err) {
        console.error('[b2b-bomber] sweep failed for round', item.id, err.message);
      }
    }
    return { checked: due.rowCount, settled };
  }

  function startSweeper() {
    const timer = setInterval(() => {
      sweep().catch((err) => console.error('[b2b-bomber] sweep error:', err.message));
    }, SWEEP_INTERVAL_MS);
    if (typeof timer.unref === 'function') timer.unref();
    return () => clearInterval(timer);
  }

  return {
    current,
    start,
    cashout,
    history,
    verifyOwned,
    verifyPayload,
    sweep,
    startSweeper,
    rules,
    view,
  };
}

module.exports = {
  createB2BBomberService,
  GAME_KEY,
  RECENT_LIMIT,
  HISTORY_LIMIT,
  LAST_RESULT_WINDOW_MS,
  SWEEP_INTERVAL_MS,
};
