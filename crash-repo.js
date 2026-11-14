'use strict';

// Rocket Crash repository: every SQL statement used by the engine and the
// HTTP service lives here. Public read paths use explicit column lists so
// server_seed and crash_hundredths can never leak before the crash.
const C = require('./crash-config');

const ROUND_COLUMNS = `id, status, server_seed, server_seed_hash, client_seed,
  crash_hundredths, edge_bp, growth_k_micro, max_hundredths,
  betting_closes_at, started_at, crashed_at, created_at`;
const BET_COLUMNS = `id, crash_round_id, user_id, panel, stake_santim,
  auto_cashout_hundredths, status, cashout_hundredths, payout_santim,
  game_round_id, request_id, created_at, settled_at`;

function toMs(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.getTime();
  return Number(value);
}

function mapRound(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    status: row.status,
    serverSeed: row.server_seed,
    serverSeedHash: row.server_seed_hash,
    clientSeed: row.client_seed,
    crashHundredths: Number(row.crash_hundredths),
    edgeBp: Number(row.edge_bp),
    growthKMicro: Number(row.growth_k_micro),
    maxHundredths: Number(row.max_hundredths),
    bettingClosesAt: toMs(row.betting_closes_at),
    startedAt: toMs(row.started_at),
    crashedAt: toMs(row.crashed_at),
    createdAt: toMs(row.created_at)
  };
}

function mapBet(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    crashRoundId: Number(row.crash_round_id),
    userId: Number(row.user_id),
    panel: Number(row.panel),
    stakeSantim: Number(row.stake_santim),
    autoCashoutHundredths: row.auto_cashout_hundredths == null ? null : Number(row.auto_cashout_hundredths),
    status: row.status,
    cashoutHundredths: row.cashout_hundredths == null ? null : Number(row.cashout_hundredths),
    payoutSantim: Number(row.payout_santim),
    gameRoundId: Number(row.game_round_id),
    requestId: row.request_id,
    createdAt: toMs(row.created_at),
    settledAt: toMs(row.settled_at),
    name: row.name == null ? null : String(row.name),
    phone: row.phone == null ? null : String(row.phone),
    email: row.email == null ? null : String(row.email),
    username: row.username == null ? null : String(row.username),
    roundStatus: row.round_status == null ? null : String(row.round_status),
    roundCrashHundredths: row.round_crash_hundredths == null ? null : Number(row.round_crash_hundredths)
  };
}

const USER_COLUMNS = 'u.name, u.phone, u.email, u.username';
const BET_JOIN = `cb.id, cb.crash_round_id, cb.user_id, cb.panel, cb.stake_santim,
  cb.auto_cashout_hundredths, cb.status, cb.cashout_hundredths, cb.payout_santim,
  cb.game_round_id, cb.request_id, cb.created_at, cb.settled_at, ${USER_COLUMNS}`;

function createCrashRepo({ query, withTx }) {
  if (typeof query !== 'function' || typeof withTx !== 'function') {
    throw new TypeError('Database query and transaction helpers are required');
  }

  // --- Engine -----------------------------------------------------------------
  async function allocateRoundId() {
    const result = await query(`SELECT nextval(pg_get_serial_sequence('crash_rounds','id'))::bigint AS id`);
    return Number(result.rows[0].id);
  }

  async function createRound(round) {
    const result = await query(
      `INSERT INTO crash_rounds
        (id, status, server_seed, server_seed_hash, client_seed, crash_hundredths,
         edge_bp, growth_k_micro, max_hundredths, betting_closes_at)
       VALUES ($1,'betting',$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING ${ROUND_COLUMNS}`,
      [
        round.id,
        round.serverSeed,
        round.serverSeedHash,
        round.clientSeed,
        round.crashHundredths,
        round.edgeBp,
        round.growthKMicro,
        round.maxHundredths,
        round.bettingClosesAt == null ? null : new Date(round.bettingClosesAt)
      ]
    );
    return mapRound(result.rows[0]);
  }

  async function getRecentRounds(limit = 4) {
    const result = await query(
      `SELECT ${ROUND_COLUMNS} FROM crash_rounds ORDER BY id DESC LIMIT $1`,
      [Math.max(1, Math.min(20, Number(limit) || 4))]
    );
    return result.rows.map(mapRound);
  }

  async function getRoundById(id) {
    const result = await query(`SELECT ${ROUND_COLUMNS} FROM crash_rounds WHERE id=$1`, [id]);
    return mapRound(result.rows[0]);
  }

  async function setBettingClosesAt(id, closesAt) {
    const result = await query(
      `UPDATE crash_rounds SET betting_closes_at=$2
       WHERE id=$1 AND status='betting' AND betting_closes_at IS NULL
       RETURNING ${ROUND_COLUMNS}`,
      [id, new Date(closesAt)]
    );
    return mapRound(result.rows[0]);
  }

  async function startRound(id, startedAt, now) {
    const result = await query(
      `UPDATE crash_rounds SET status='flying', started_at=$2
       WHERE id=$1 AND status='betting' AND betting_closes_at IS NOT NULL AND betting_closes_at <= $3
       RETURNING ${ROUND_COLUMNS}`,
      [id, new Date(startedAt), new Date(now)]
    );
    return mapRound(result.rows[0]);
  }

  async function markCrashed(id, crashedAt) {
    const result = await query(
      `UPDATE crash_rounds SET status='crashed', crashed_at=$2
       WHERE id=$1 AND status='flying'
       RETURNING ${ROUND_COLUMNS}`,
      [id, new Date(crashedAt)]
    );
    return mapRound(result.rows[0]);
  }

  async function getOpenBetsForRound(roundId) {
    const result = await query(
      `SELECT id, crash_round_id, user_id, panel, stake_santim,
              auto_cashout_hundredths, status, payout_santim, game_round_id
       FROM crash_bets WHERE crash_round_id=$1 AND status='open'
       ORDER BY auto_cashout_hundredths NULLS LAST, id`,
      [roundId]
    );
    return result.rows.map(mapBet);
  }

  async function sweepOpenBets(roundId) {
    return withTx(async (client) => {
      const lost = await client.query(
        `UPDATE crash_bets SET status='lost', settled_at=NOW()
         WHERE crash_round_id=$1 AND status='open'
         RETURNING game_round_id`,
        [roundId]
      );
      if (!lost.rows.length) return 0;
      const ids = lost.rows.map((row) => row.game_round_id);
      await client.query(
        `UPDATE game_rounds SET status=$2, payout=0
         WHERE id = ANY($1::bigint[]) AND status <> $2`,
        [ids, C.GAME_ROUND_DONE_STATUS]
      );
      return lost.rows.length;
    });
  }

  // --- Bet placement ----------------------------------------------------------
  async function findAcceptingRound(client) {
    const result = await client.query(
      `SELECT ${ROUND_COLUMNS} FROM crash_rounds
       WHERE status='betting' AND (betting_closes_at IS NULL OR betting_closes_at > NOW())
       ORDER BY id DESC LIMIT 1 FOR SHARE`
    );
    return mapRound(result.rows[0]);
  }

  async function findBetByRequest(userId, requestId) {
    const result = await query(
      `SELECT ${BET_JOIN}, cr.status AS round_status, cr.crash_hundredths AS round_crash_hundredths
       FROM crash_bets cb JOIN crash_rounds cr ON cr.id=cb.crash_round_id
       JOIN users u ON u.id=cb.user_id
       WHERE cb.user_id=$1 AND cb.request_id=$2 LIMIT 1`,
      [userId, requestId]
    );
    return mapBet(result.rows[0]);
  }

  async function insertGameRound(client, { userId, stakeSantim, detail }) {
    const result = await client.query(
      `INSERT INTO game_rounds
        (user_id, game, bet, payout, step, status, detail, server_seed, client_seed, server_seed_hash)
       VALUES ($1,$2,$3,0,0,$4,$5,NULL,$6,$7) RETURNING id`,
      [
        userId,
        C.GAME_ROUND_GAME,
        stakeSantim,
        C.GAME_ROUND_ACTIVE_STATUS,
        JSON.stringify(detail),
        detail.clientSeed,
        detail.serverSeedHash
      ]
    );
    return Number(result.rows[0].id);
  }

  async function insertBet(client, bet) {
    const result = await client.query(
      `INSERT INTO crash_bets
        (crash_round_id, user_id, panel, stake_santim, auto_cashout_hundredths,
         status, game_round_id, request_id)
       VALUES ($1,$2,$3,$4,$5,'open',$6,$7)
       RETURNING ${BET_COLUMNS}`,
      [
        bet.crashRoundId,
        bet.userId,
        bet.panel,
        bet.stakeSantim,
        bet.autoCashoutHundredths,
        bet.gameRoundId,
        bet.requestId
      ]
    );
    return mapBet(result.rows[0]);
  }

  // --- Cash-out settlement ----------------------------------------------------
  async function getBetOwner(client, betId, userId) {
    const result = await client.query(
      'SELECT id, crash_round_id FROM crash_bets WHERE id=$1 AND user_id=$2',
      [betId, userId]
    );
    return result.rows[0] || null;
  }

  async function lockRoundForShare(client, roundId) {
    const result = await client.query(
      `SELECT ${ROUND_COLUMNS} FROM crash_rounds WHERE id=$1 FOR SHARE`,
      [roundId]
    );
    return mapRound(result.rows[0]);
  }

  async function lockBetForUpdate(client, betId, userId) {
    const result = await client.query(
      `SELECT ${BET_COLUMNS} FROM crash_bets WHERE id=$1 AND user_id=$2 FOR UPDATE`,
      [betId, userId]
    );
    return mapBet(result.rows[0]);
  }

  async function markBetCashed(client, betId, cashoutHundredths, payoutSantim) {
    const result = await client.query(
      `UPDATE crash_bets
       SET status='cashed', cashout_hundredths=$2, payout_santim=$3, settled_at=NOW()
       WHERE id=$1 AND status='open'
       RETURNING ${BET_COLUMNS}`,
      [betId, cashoutHundredths, payoutSantim]
    );
    return mapBet(result.rows[0]);
  }

  async function finishGameRound(client, gameRoundId, payoutSantim, detail) {
    await client.query(
      `UPDATE game_rounds SET status=$2, payout=$3, detail=$4 WHERE id=$1`,
      [gameRoundId, C.GAME_ROUND_DONE_STATUS, payoutSantim, JSON.stringify(detail)]
    );
  }

  async function getBalance(userId, client = null, { forUpdate = false } = {}) {
    const executor = client || { query };
    const result = await executor.query(
      `SELECT balance FROM wallets WHERE user_id=$1${forUpdate ? ' FOR UPDATE' : ''}`,
      [userId]
    );
    return result.rows[0] ? Number(result.rows[0].balance) : null;
  }

  async function getBetWithUser(betId) {
    const result = await query(
      `SELECT ${BET_JOIN} FROM crash_bets cb JOIN users u ON u.id=cb.user_id WHERE cb.id=$1`,
      [betId]
    );
    return mapBet(result.rows[0]);
  }

  // --- Public reads -----------------------------------------------------------
  async function getDisplayBets(roundId, limit = C.DISPLAY_BETS_LIMIT) {
    const result = await query(
      `SELECT ${BET_JOIN} FROM crash_bets cb JOIN users u ON u.id=cb.user_id
       WHERE cb.crash_round_id=$1
       ORDER BY cb.stake_santim DESC, cb.id ASC LIMIT $2`,
      [roundId, Math.max(1, Math.min(C.DISPLAY_BETS_LIMIT, Number(limit) || C.DISPLAY_BETS_LIMIT))]
    );
    return result.rows.map(mapBet);
  }

  async function getMyBets(userId, roundIds) {
    const ids = (roundIds || []).filter((id) => Number.isSafeInteger(Number(id)));
    if (!ids.length) return [];
    const result = await query(
      `SELECT ${BET_COLUMNS} FROM crash_bets
       WHERE user_id=$1 AND crash_round_id = ANY($2::bigint[]) ORDER BY id`,
      [userId, ids]
    );
    return result.rows.map(mapBet);
  }

  async function getHistory(limit = C.STATE_HISTORY_LIMIT) {
    const result = await query(
      `SELECT id, crash_hundredths, crashed_at FROM crash_rounds
       WHERE status='crashed' ORDER BY id DESC LIMIT $1`,
      [Math.max(1, Math.min(100, Number(limit) || C.STATE_HISTORY_LIMIT))]
    );
    return result.rows.map((row) => ({
      roundId: Number(row.id),
      crashHundredths: Number(row.crash_hundredths),
      crashedAt: toMs(row.crashed_at)
    }));
  }

  async function getRoundsHistory(limit = 50) {
    const result = await query(
      `SELECT id, server_seed, server_seed_hash, client_seed, crash_hundredths,
              edge_bp, max_hundredths, crashed_at
       FROM crash_rounds WHERE status='crashed' ORDER BY id DESC LIMIT $1`,
      [Math.max(1, Math.min(50, Number(limit) || 50))]
    );
    return result.rows.map((row) => ({
      roundId: Number(row.id),
      serverSeed: row.server_seed,
      serverSeedHash: row.server_seed_hash,
      clientSeed: row.client_seed,
      crashHundredths: Number(row.crash_hundredths),
      edgeBp: Number(row.edge_bp),
      maxHundredths: Number(row.max_hundredths),
      crashedAt: toMs(row.crashed_at)
    }));
  }

  async function getUserBets(userId, limit = 50) {
    const result = await query(
      `SELECT cb.id, cb.crash_round_id, cb.stake_santim, cb.auto_cashout_hundredths,
              cb.status, cb.cashout_hundredths, cb.payout_santim, cb.created_at,
              cr.status AS round_status, cr.crash_hundredths AS round_crash_hundredths
       FROM crash_bets cb JOIN crash_rounds cr ON cr.id=cb.crash_round_id
       WHERE cb.user_id=$1 ORDER BY cb.id DESC LIMIT $2`,
      [userId, Math.max(1, Math.min(50, Number(limit) || 50))]
    );
    return result.rows.map(mapBet);
  }

  async function getVerifyRound(roundId) {
    const result = await query(
      `SELECT id, server_seed, server_seed_hash, client_seed, crash_hundredths,
              edge_bp, max_hundredths, started_at, crashed_at
       FROM crash_rounds WHERE id=$1 AND status='crashed'`,
      [roundId]
    );
    return mapRound(result.rows[0]);
  }

  return {
    allocateRoundId,
    createRound,
    getRecentRounds,
    getRoundById,
    setBettingClosesAt,
    startRound,
    markCrashed,
    getOpenBetsForRound,
    sweepOpenBets,
    findAcceptingRound,
    findBetByRequest,
    insertGameRound,
    insertBet,
    getBetOwner,
    lockRoundForShare,
    lockBetForUpdate,
    markBetCashed,
    finishGameRound,
    getBalance,
    getBetWithUser,
    getDisplayBets,
    getMyBets,
    getHistory,
    getRoundsHistory,
    getUserBets,
    getVerifyRound
  };
}

module.exports = { createCrashRepo };
