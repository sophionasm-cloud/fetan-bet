'use strict';

const config = require('./public/games/slot/js/slot-config');
const math = require('./public/games/slot/js/slot-math');
const engine = require('./slot-engine');
const { postLedger } = require('./db');

const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function parseDetail(row) {
  if (row?.detail && typeof row.detail === 'object') return row.detail;
  try { return JSON.parse(row?.detail || '{}'); } catch { return {}; }
}

function validateUserId(userId) {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('INVALID');
}

function validateSpinInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !math.isValidBet(input.bet) ||
      typeof input.requestId !== 'string' || !REQUEST_ID_PATTERN.test(input.requestId.toLowerCase())) {
    throw new Error('INVALID');
  }
  return { bet: input.bet, requestId: input.requestId.toLowerCase() };
}

function clientConfig() {
  return {
    game: config.GAME_SLUG,
    title: config.GAME_TITLE,
    defaultLanguage: config.DEFAULT_LANGUAGE,
    rows: config.ROWS,
    reelCount: config.REEL_COUNT,
    reelStopCount: config.REEL_STOP_COUNT,
    symbols: config.SYMBOLS,
    reels: config.REELS,
    paylines: config.PAYLINES,
    paytable: config.PAYTABLE,
    payoutMultiplierScale: config.PAYOUT_MULTIPLIER_SCALE,
    minBetSantim: config.MIN_BET_SANTIM,
    maxBetSantim: config.MAX_BET_SANTIM,
    defaultBetSantim: config.DEFAULT_BET_SANTIM,
    betStepSantim: config.BET_STEP_SANTIM,
    quickBetsSantim: config.QUICK_BETS_SANTIM,
    maxWinMultiplier: config.MAX_WIN_MULTIPLIER,
    bigWinMultiple: config.BIG_WIN_MULTIPLE,
    megaWinMultiple: config.MEGA_WIN_MULTIPLE,
  };
}

function createSlotService({ withTx, ledger = postLedger, createEpoch = () => engine.createSeedEpoch(), now = () => new Date() } = {}) {
  if (typeof withTx !== 'function' || typeof ledger !== 'function') throw new TypeError('Transaction and ledger helpers are required.');

  async function ensureEpoch(client, userId) {
    let result = await client.query(
      'SELECT * FROM slot_seed_epochs WHERE user_id=$1 AND retired_at IS NULL', [userId]
    );
    if (result.rowCount) return result.rows[0];
    const seed = createEpoch();
    await client.query(
      `INSERT INTO slot_seed_epochs (user_id, server_seed, server_seed_hash, client_seed)
       VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [userId, seed.serverSeed, seed.serverSeedHash, seed.clientSeed]
    );
    result = await client.query(
      'SELECT * FROM slot_seed_epochs WHERE user_id=$1 AND retired_at IS NULL', [userId]
    );
    if (!result.rowCount) throw new Error('SCHEMA_NOT_READY');
    return result.rows[0];
  }

  async function findRequest(client, userId, requestId) {
    const result = await client.query(
      `SELECT r.*, e.server_seed AS epoch_server_seed, e.retired_at AS epoch_retired_at,
              n.server_seed_hash AS next_epoch_hash
       FROM game_rounds r
       LEFT JOIN slot_seed_epochs e ON e.id=(r.detail::jsonb->>'seedEpochId')::bigint AND e.user_id=r.user_id
       LEFT JOIN slot_seed_epochs n ON n.user_id=r.user_id AND n.id=(
         SELECT MIN(id) FROM slot_seed_epochs
         WHERE user_id=r.user_id AND id>(r.detail::jsonb->>'seedEpochId')::bigint
       )
       WHERE r.user_id=$1 AND r.game='slot' AND r.detail::jsonb->>'requestId'=$2
       LIMIT 1`,
      [userId, requestId]
    );
    return result.rows[0] || null;
  }

  function responseFor(row, replayed = false) {
    const detail = parseDetail(row);
    const retired = Boolean(row.epoch_retired_at);
    // For spins from a retired epoch: prefer the hash stored in the spin detail
    // (set when this spin triggered the rotation) or fall back to the next epoch's hash
    // so that any replay from a retired epoch exposes the successor commitment.
    const nextHash = detail.nextServerSeedHash || (retired ? (row.next_epoch_hash || null) : null);
    return {
      spinId: Number(row.id),
      stops: detail.stops,
      grid: detail.grid,
      wins: detail.wins,
      totalPayout: Number(row.payout),
      balance: Number(detail.balanceAfter),
      replayed,
      fairness: {
        server_seed_hash: row.server_seed_hash,
        client_seed: row.client_seed,
        nonce: Number(detail.nonce),
        retired,
        server_seed: retired ? row.epoch_server_seed : null,
        next_server_seed_hash: nextHash,
        math_version: config.MATH_VERSION,
        fairness_version: config.FAIRNESS_VERSION,
        algorithm: config.FAIRNESS_ALGORITHM,
      },
    };
  }

  function paytable() {
    return {
      game: config.GAME_SLUG,
      title: config.GAME_TITLE,
      symbols: config.SYMBOLS,
      paytable: config.PAYTABLE,
      payout_multiplier_scale: config.PAYOUT_MULTIPLIER_SCALE,
      paylines: config.PAYLINES,
      max_win_multiplier: config.MAX_WIN_MULTIPLIER,
      math_version: config.MATH_VERSION,
      fairness_version: config.FAIRNESS_VERSION,
    };
  }

  async function state(userId, language = config.DEFAULT_LANGUAGE) {
    validateUserId(userId);
    return withTx(async (client) => {
      const epoch = await ensureEpoch(client, userId);
      const wallet = await client.query('SELECT balance FROM wallets WHERE user_id=$1', [userId]);
      if (!wallet.rowCount) throw new Error('NOT_FOUND');
      const recent = await client.query(
        `SELECT r.id, r.bet, r.payout, r.detail, r.server_seed_hash, r.client_seed, r.created_at,
                e.server_seed AS epoch_server_seed, e.retired_at AS epoch_retired_at
         FROM game_rounds r
         JOIN slot_seed_epochs e ON e.id=(r.detail::jsonb->>'seedEpochId')::bigint AND e.user_id=r.user_id
         WHERE r.user_id=$1 AND r.game='slot'
         ORDER BY r.id DESC LIMIT $2`,
        [userId, config.MAX_HISTORY_SPINS]
      );
      return {
        config: clientConfig(),
        paytable: config.PAYTABLE,
        betOptionsSantim: config.QUICK_BETS_SANTIM,
        balance: Number(wallet.rows[0].balance),
        language: language === 'en' ? 'en' : 'am',
        fairness: {
          server_seed_hash: epoch.server_seed_hash,
          client_seed: epoch.client_seed,
          nonce: Number(epoch.next_nonce),
          spins_remaining: Math.max(0, config.SEED_EPOCH_SPINS - Number(epoch.completed_spins)),
          math_version: config.MATH_VERSION,
          fairness_version: config.FAIRNESS_VERSION,
          algorithm: config.FAIRNESS_ALGORITHM,
        },
        preview: {
          stops: [0, 0, 0, 0, 0],
          ...math.evaluateStops([0, 0, 0, 0, 0], config.DEFAULT_BET_SANTIM),
        },
        recent: recent.rows.map((row) => {
          const detail = parseDetail(row);
          const retired = Boolean(row.epoch_retired_at);
          return {
            spinId: Number(row.id),
            bet: Number(row.bet),
            totalPayout: Number(row.payout),
            stops: detail.stops,
            grid: detail.grid,
            wins: detail.wins,
            createdAt: row.created_at,
            fairness: {
              server_seed_hash: row.server_seed_hash,
              client_seed: row.client_seed,
              nonce: Number(detail.nonce),
              retired,
              server_seed: retired ? row.epoch_server_seed : null,
              next_server_seed_hash: detail.nextServerSeedHash || null,
          math_version: config.MATH_VERSION,
          fairness_version: config.FAIRNESS_VERSION,
          algorithm: config.FAIRNESS_ALGORITHM,
            },
          };
        }),
      };
    });
  }

  async function spin(userId, input) {
    validateUserId(userId);
    const { bet, requestId } = validateSpinInput(input);
    return withTx(async (client) => {
      let prior = await findRequest(client, userId, requestId);
      if (prior) {
        if (Number(prior.bet) !== bet) throw new Error('SLOT_REQUEST_REUSED');
        return responseFor(prior, true);
      }

      await ensureEpoch(client, userId);
      let epoch;
      try {
        const locked = await client.query(
          'SELECT * FROM slot_seed_epochs WHERE user_id=$1 AND retired_at IS NULL FOR UPDATE NOWAIT', [userId]
        );
        epoch = locked.rows[0];
      } catch (error) {
        if (error.code === '55P03') throw new Error('SLOT_SPIN_IN_PROGRESS');
        throw error;
      }
      if (!epoch) throw new Error('SCHEMA_NOT_READY');

      prior = await findRequest(client, userId, requestId);
      if (prior) {
        if (Number(prior.bet) !== bet) throw new Error('SLOT_REQUEST_REUSED');
        return responseFor(prior, true);
      }

      const wallet = await client.query('SELECT balance FROM wallets WHERE user_id=$1 FOR UPDATE', [userId]);
      if (!wallet.rowCount) throw new Error('NOT_FOUND');
      const balance = Number(wallet.rows[0].balance);
      if (!Number.isSafeInteger(balance) || balance < bet) throw new Error('SLOT_INSUFFICIENT');

      const nonce = Number(epoch.next_nonce);
      const outcome = engine.spinFromSeed(epoch.server_seed, epoch.client_seed, nonce, bet);
      const balanceAfter = balance - bet + outcome.totalPayout;
      if (!Number.isSafeInteger(balanceAfter)) throw new Error('INVALID');
      const detail = {
        requestId,
        seedEpochId: Number(epoch.id),
        nonce,
        stops: outcome.stops,
        grid: outcome.grid,
        wins: outcome.wins,
        balanceAfter,
        mathVersion: config.MATH_VERSION,
        fairnessVersion: config.FAIRNESS_VERSION,
      };
      const inserted = await client.query(
        `INSERT INTO game_rounds
          (user_id, game, bet, payout, step, status, detail, server_seed, client_seed, server_seed_hash, difficulty)
         VALUES ($1,'slot',$2,$3,$4,'done',$5,$6,$7,$8,'standard')
         RETURNING id`,
        [userId, bet, outcome.totalPayout, outcome.wins.length, JSON.stringify(detail), epoch.server_seed, epoch.client_seed, epoch.server_seed_hash]
      );
      const spinId = Number(inserted.rows[0].id);
      let postedBalance;
      try {
        postedBalance = await ledger({ client, userId, delta: -bet, type: 'bet', refType: 'round', refId: spinId });
        if (outcome.totalPayout > 0) {
          postedBalance = await ledger({ client, userId, delta: outcome.totalPayout, type: 'win', refType: 'round', refId: spinId });
        }
      } catch (error) {
        if (error.message === 'INSUFFICIENT') throw new Error('SLOT_INSUFFICIENT');
        throw error;
      }
      if (Number(postedBalance) !== balanceAfter) throw new Error('SLOT_BALANCE_MISMATCH');
      const completedSpins = Number(epoch.completed_spins) + 1;
      await client.query(
        'UPDATE slot_seed_epochs SET next_nonce=$1, completed_spins=$2 WHERE id=$3 AND retired_at IS NULL',
        [nonce + 1, completedSpins, epoch.id]
      );
      let retired = false;
      let nextServerSeedHash = null;
      if (completedSpins >= config.SEED_EPOCH_SPINS) {
        await client.query('UPDATE slot_seed_epochs SET retired_at=$1 WHERE id=$2 AND retired_at IS NULL', [now(), epoch.id]);
        const nextEpoch = createEpoch();
        await client.query(
          `INSERT INTO slot_seed_epochs (user_id, server_seed, server_seed_hash, client_seed)
           VALUES ($1,$2,$3,$4)`,
          [userId, nextEpoch.serverSeed, nextEpoch.serverSeedHash, nextEpoch.clientSeed]
        );
        retired = true;
        nextServerSeedHash = nextEpoch.serverSeedHash;
        detail.nextServerSeedHash = nextServerSeedHash;
      }

      await client.query('UPDATE game_rounds SET detail=$1 WHERE id=$2', [JSON.stringify(detail), spinId]);

      return {
        spinId,
        stops: outcome.stops,
        grid: outcome.grid,
        wins: outcome.wins,
        totalPayout: outcome.totalPayout,
        balance: balanceAfter,
        replayed: false,
        fairness: {
          server_seed_hash: epoch.server_seed_hash,
          client_seed: epoch.client_seed,
          nonce,
          retired,
          server_seed: retired ? epoch.server_seed : null,
          next_server_seed_hash: nextServerSeedHash,
          math_version: config.MATH_VERSION,
          fairness_version: config.FAIRNESS_VERSION,
          algorithm: config.FAIRNESS_ALGORITHM,
        },
      };
    });
  }

  return Object.freeze({ state, paytable, spin });
}

module.exports = { REQUEST_ID_PATTERN, createSlotService };
