'use strict';

// Rocket Crash HTTP service, wallet settlement and engine runtime.
// Every bet/cash-out is one transaction using the shared ledger helper; the
// browser only ever sends a panel, stake, request id, or bet id.
const C = require('./crash-config');
const M = require('./crash-math');
const { createCrashRepo } = require('./crash-repo');
const { createCrashEngine } = require('./crash-engine');
const { createCrashHub } = require('./crash-sse');
const db = require('./db');

const STATUS_BY_CODE = Object.freeze({
  INVALID_STAKE: 400,
  INVALID_AUTO_CASHOUT: 400,
  INVALID_PANEL: 400,
  INVALID_REQUEST: 400,
  INVALID_BET: 400,
  INSUFFICIENT: 400,
  BETTING_CLOSED: 409,
  PANEL_BUSY: 409,
  ROUND_CRASHED: 409,
  NOT_FLYING: 409,
  STALE_ACTION: 409,
  NOT_FOUND: 404,
  RATE: 429,
  CRASH_DISABLED: 503
});

function crashEnabled(envValue) {
  if (envValue === undefined || envValue === null || envValue === '') return C.CRASH_ENABLED_DEFAULT;
  return !['false', '0', 'off', 'no'].includes(String(envValue).trim().toLowerCase());
}

function maskLabel(bet) {
  const raw = String(bet.username || bet.name || '').trim();
  if (!raw) return 'Player';
  const isContact =
    /@/.test(raw) ||
    (bet.phone && raw === bet.phone) ||
    /^\+?[0-9][0-9\s()-]{5,}$/.test(raw);
  const keep = isContact ? 2 : 3;
  return `${raw.slice(0, keep)}***`;
}

function createCrashService({
  query = db.query,
  withTx = db.withTx,
  ledger = db.postLedger,
  pool = db.pool,
  clock = () => Date.now(),
  enabled = crashEnabled(process.env.CRASH_ENABLED),
  log = console,
  repo: injectedRepo = null
} = {}) {
  const repo = injectedRepo || createCrashRepo({ query, withTx });
  const buckets = new Map();
  const engine = createCrashEngine({ repo, settle: settleAuto, emit: handleEngineEvent, clock, log });

  let started = false;
  let lockClient = null;
  let lockRetryTimer = null;
  let rateCleanupTimer = null;

  const hub = createCrashHub({ repo, stateFor, clock, log });

  function configView() {
    return {
      gameName: C.GAME_NAME,
      minStake: C.MIN_STAKE_SANTIM,
      maxStake: C.MAX_STAKE_SANTIM,
      maxWin: C.MAX_WIN_SANTIM,
      maxHundredths: C.MAX_HUNDREDTHS,
      minAutoCashout: C.MIN_AUTO_CASHOUT_HUNDREDTHS,
      growthK: C.GROWTH_K_MICRO / 1e6,
      bettingMs: C.BETTING_MS,
      crashedMs: C.CRASHED_MS,
      edgeBp: C.EDGE_BP,
      panels: C.PANELS,
      redPillThreshold: C.RED_PILL_THRESHOLD_HUNDREDTHS,
      stripLength: C.STRIP_LENGTH,
      formulaVersion: C.FORMULA_VERSION
    };
  }

  function publicBet(bet, viewerId) {
    if (!bet) return null;
    const mine = Number(bet.userId) === Number(viewerId);
    const view = {
      id: bet.id,
      roundId: bet.crashRoundId,
      panel: bet.panel,
      label: mine ? 'You' : maskLabel(bet),
      stake: bet.stakeSantim,
      status: bet.status,
      cashoutHundredths: bet.cashoutHundredths,
      payout: bet.payoutSantim,
      mine
    };
    if (mine) view.autoCashout = bet.autoCashoutHundredths;
    return view;
  }

  function ownBet(bet) {
    return {
      id: bet.id,
      roundId: bet.crashRoundId,
      panel: bet.panel,
      stake: bet.stakeSantim,
      autoCashout: bet.autoCashoutHundredths,
      status: bet.status,
      cashoutHundredths: bet.cashoutHundredths,
      payout: bet.payoutSantim,
      createdAt: bet.createdAt
    };
  }

  async function stateFor(userId) {
    const now = clock();
    const rounds = await repo.getRecentRounds(3);
    const { display, betting } = M.selectDisplayRounds(rounds);
    const displayBets = display ? await repo.getDisplayBets(display.id, C.DISPLAY_BETS_LIMIT) : [];
    const roundIds = [...new Set([display?.id, betting?.id].filter((id) => id != null))];
    const mine = await repo.getMyBets(userId, roundIds);
    const history = await repo.getHistory(C.STATE_HISTORY_LIMIT);
    const balance = await repo.getBalance(userId);
    return {
      serverTime: now,
      config: configView(),
      round: M.publicRound(display),
      bettingRoundId: betting ? betting.id : null,
      bets: displayBets.map((bet) => publicBet(bet, userId)),
      myBets: mine.map(ownBet),
      history,
      balance
    };
  }

  function rateLimit(userId) {
    const now = clock();
    const cutoff = now - C.RATE_LIMIT_WINDOW_MS;
    const recent = (buckets.get(userId) || []).filter((at) => at > cutoff);
    if (recent.length >= C.RATE_LIMIT_MAX_REQUESTS) {
      buckets.set(userId, recent);
      throw new Error('RATE');
    }
    recent.push(now);
    buckets.set(userId, recent);
  }

  async function placeBet(userId, body = {}) {
    rateLimit(userId);
    const panel = M.validatePanel(body.panel);
    const stake = M.validateStake(body.stake);
    const autoCashout = M.validateAutoCashout(body.autoCashout);
    const requestId = M.validateRequestId(body.requestId);

    let outcome;
    try {
      outcome = await withTx(async (client) => {
        const existing = await repo.findBetByRequest(userId, requestId);
        if (existing) {
          const balance = await repo.getBalance(userId, client);
          return { bet: existing, balance, replayed: true };
        }
        const round = await repo.findAcceptingRound(client);
        if (!round) throw new Error('BETTING_CLOSED');
        // Lock the wallet row so two panels submitted at the same time cannot
        // both pass the balance check before either debit is posted.
        const balance = await repo.getBalance(userId, client, { forUpdate: true });
        if (balance == null) throw new Error('NOT_FOUND');
        if (balance < stake) throw new Error('INSUFFICIENT');

        const detail = {
          crashRoundId: round.id,
          panel,
          autoCashoutHundredths: autoCashout,
          formulaVersion: C.FORMULA_VERSION,
          serverSeedHash: round.serverSeedHash,
          clientSeed: round.clientSeed
        };
        const gameRoundId = await repo.insertGameRound(client, { userId, stakeSantim: stake, detail });
        await ledger({
          client,
          userId,
          delta: -stake,
          type: C.LEDGER_DEBIT_TYPE,
          refType: C.LEDGER_REF_TYPE,
          refId: gameRoundId
        });
        const bet = await repo.insertBet(client, {
          crashRoundId: round.id,
          userId,
          panel,
          stakeSantim: stake,
          autoCashoutHundredths: autoCashout,
          gameRoundId,
          requestId
        });
        const newBalance = await repo.getBalance(userId, client);
        return { bet, balance: newBalance, replayed: false };
      });
    } catch (err) {
      if (err?.code === '23505' && String(err.constraint || '').includes('user_request')) {
        const existing = await repo.findBetByRequest(userId, requestId);
        if (existing) {
          return { bet: publicBet(existing, userId), balance: await repo.getBalance(userId) };
        }
      }
      if (err?.code === '23505' && String(err.constraint || '').includes('round_user_panel')) {
        throw new Error('PANEL_BUSY');
      }
      throw err;
    }

    if (!outcome.replayed) {
      const full = await repo.getBetWithUser(outcome.bet.id);
      hub.broadcast('bet', { bet: publicBet(full || outcome.bet, 0) });
    }
    return { bet: publicBet(outcome.bet, userId), balance: outcome.balance };
  }

  async function settleBet({ betId, userId, autoTarget = null }) {
    const outcome = await withTx(async (client) => {
      const owner = await repo.getBetOwner(client, betId, userId);
      if (!owner) throw new Error('NOT_FOUND');
      const round = await repo.lockRoundForShare(client, owner.crash_round_id);
      if (!round) throw new Error('NOT_FOUND');
      const bet = await repo.lockBetForUpdate(client, betId, userId);
      if (!bet) throw new Error('NOT_FOUND');
      if (bet.status === 'cashed') {
        return { bet, balance: await repo.getBalance(userId, client), changed: false };
      }
      if (bet.status === 'lost') throw new Error('ROUND_CRASHED');
      if (round.status === 'crashed') throw new Error('ROUND_CRASHED');
      if (round.status !== 'flying') throw new Error('NOT_FLYING');

      let multiplier;
      if (autoTarget != null) {
        if (!Number.isSafeInteger(autoTarget) || autoTarget > round.crashHundredths) {
          throw new Error('ROUND_CRASHED');
        }
        multiplier = autoTarget;
      } else {
        const elapsed = clock() - round.startedAt;
        const duration = M.crashDurationMs(round.crashHundredths, round.growthKMicro);
        if (elapsed >= duration) throw new Error('ROUND_CRASHED');
        multiplier = Math.max(
          100,
          Math.min(M.multiplierHundredthsAt(elapsed, round.growthKMicro), round.crashHundredths - 1)
        );
      }

      const payout = M.payoutSantim(bet.stakeSantim, multiplier, C.MAX_WIN_SANTIM);
      await ledger({
        client,
        userId,
        delta: payout,
        type: C.LEDGER_CREDIT_TYPE,
        refType: C.LEDGER_REF_TYPE,
        refId: bet.gameRoundId
      });
      const cashed = await repo.markBetCashed(client, bet.id, multiplier, payout);
      if (!cashed) throw new Error('ROUND_CRASHED');
      await repo.finishGameRound(client, bet.gameRoundId, payout, {
        crashRoundId: round.id,
        panel: bet.panel,
        autoCashoutHundredths: bet.autoCashoutHundredths,
        cashoutHundredths: multiplier,
        formulaVersion: C.FORMULA_VERSION,
        serverSeedHash: round.serverSeedHash,
        clientSeed: round.clientSeed
      });
      const balance = await repo.getBalance(userId, client);
      return { bet: cashed, balance, changed: true };
    });
    const full = await repo.getBetWithUser(outcome.bet.id);
    return { ...outcome, full: full || outcome.bet };
  }

  async function cashOut(userId, body = {}) {
    rateLimit(userId);
    const betId = Number(body.betId);
    if (!Number.isSafeInteger(betId) || betId < 1) throw new Error('NOT_FOUND');
    const outcome = await settleBet({ betId, userId });
    if (outcome.changed) {
      hub.broadcast('cashout', { bet: publicBet(outcome.full, 0) });
    }
    return { bet: publicBet(outcome.bet, userId), balance: outcome.balance };
  }

  async function settleAuto(bet, target) {
    try {
      const outcome = await settleBet({ betId: bet.id, userId: bet.userId, autoTarget: target });
      if (outcome.changed) {
        hub.broadcast('cashout', { bet: publicBet(outcome.full, 0) });
      }
    } catch (err) {
      // The round linearized before this timer; the sweep owns the loss.
      if (['ROUND_CRASHED', 'NOT_FOUND', 'NOT_FLYING'].includes(err.message)) return;
      throw err;
    }
  }

  function handleEngineEvent(event) {
    if (!event || !event.type) return;
    if (event.type === 'crash') {
      hub.broadcast('crash', { round: M.publicRound(event.round) });
      void hub.broadcastSnapshots();
      void hub.broadcastHistory();
    } else if (event.type === 'phase') {
      void hub.broadcastSnapshots();
    }
  }

  function send(res, status, body) {
    res.status(status).json(body);
    return res;
  }

  function guarded(handler) {
    return async (req, res) => {
      if (!enabled) return send(res, 503, { error: 'CRASH_DISABLED' });
      try {
        const result = await handler(req);
        return send(res, result.status || 200, result.body);
      } catch (err) {
        const code = STATUS_BY_CODE[err.message] ? err.message : null;
        if (code) return send(res, STATUS_BY_CODE[code], { error: code });
        log.error('[crash] request failed:', err.message);
        return send(res, 500, { error: 'SERVER' });
      }
    };
  }

  const httpState = guarded(async (req) => ({ body: await stateFor(req.user.id) }));

  const httpBet = guarded(async (req) => {
    const body = await placeBet(req.user.id, req.body || {});
    return { body };
  });

  const httpCashout = guarded(async (req) => {
    const body = await cashOut(req.user.id, req.body || {});
    return { body };
  });

  const httpHistory = guarded(async (req) => {
    const requested = Number(req.query.limit);
    const limit = Number.isSafeInteger(requested) ? Math.max(1, Math.min(50, requested)) : 50;
    return { body: { history: await repo.getRoundsHistory(limit) } };
  });

  const httpMyBets = guarded(async (req) => {
    const requested = Number(req.query.limit);
    const limit = Number.isSafeInteger(requested) ? Math.max(1, Math.min(50, requested)) : 50;
    const bets = await repo.getUserBets(req.user.id, limit);
    return {
      body: {
        bets: bets.map((bet) => ({
          id: bet.id,
          roundId: bet.crashRoundId,
          panel: bet.panel,
          stake: bet.stakeSantim,
          autoCashout: bet.autoCashoutHundredths,
          status: bet.status,
          cashoutHundredths: bet.cashoutHundredths,
          payout: bet.payoutSantim,
          crashHundredths: bet.roundStatus === 'crashed' ? bet.roundCrashHundredths : null,
          createdAt: bet.createdAt
        }))
      }
    };
  });

  const httpVerify = guarded(async (req) => {
    const roundId = Number(req.params.id);
    if (!Number.isSafeInteger(roundId) || roundId < 1) throw new Error('NOT_FOUND');
    const round = await repo.getVerifyRound(roundId);
    if (!round) throw new Error('ROUND_CRASHED');
    return {
      body: {
        roundId: round.id,
        serverSeed: round.serverSeed,
        serverSeedHash: round.serverSeedHash,
        clientSeed: round.clientSeed,
        nonce: round.id,
        edgeBp: round.edgeBp,
        maxHundredths: round.maxHundredths,
        crashHundredths: round.crashHundredths,
        growthKMicro: round.growthKMicro,
        formulaVersion: C.FORMULA_VERSION,
        startedAt: round.startedAt,
        crashedAt: round.crashedAt
      }
    };
  });

  const httpAvailability = async (req, res) => send(res, 200, { enabled });

  function httpStream(req, res) {
    if (!enabled) return send(res, 503, { error: 'CRASH_DISABLED' });
    return hub.handleStream(req, res, req.user.id);
  }

  async function acquireLock() {
    if (!enabled || lockClient || !started) return;
    try {
      const client = await pool.connect();
      const result = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [C.ADVISORY_LOCK_KEY]);
      if (!result.rows[0]?.locked) {
        client.release();
        log.warn('[crash] engine lock held elsewhere; this instance will serve snapshots only');
        lockRetryTimer = setTimeout(acquireLock, 10000);
        lockRetryTimer.unref?.();
        return;
      }
      lockClient = client;
      lockClient.on('error', (err) => {
        log.warn('[crash] engine lock connection lost:', err.message);
        if (lockClient === client) lockClient = null;
        engine.stop();
        if (started) {
          lockRetryTimer = setTimeout(acquireLock, 10000);
          lockRetryTimer.unref?.();
        }
      });
      log.info('[crash] engine advisory lock acquired');
      engine.start();
    } catch (err) {
      log.warn('[crash] engine lock attempt failed:', err.message);
      if (started) {
        lockRetryTimer = setTimeout(acquireLock, 10000);
        lockRetryTimer.unref?.();
      }
    }
  }

  function start() {
    if (started || !enabled) return;
    started = true;
    hub.start();
    rateCleanupTimer = setInterval(() => {
      const cutoff = clock() - 60000;
      for (const [userId, times] of buckets) {
        if (!times.some((at) => at > cutoff)) buckets.delete(userId);
      }
    }, 60000);
    rateCleanupTimer.unref?.();
    void acquireLock();
  }

  function stop() {
    if (!started) return;
    started = false;
    engine.stop();
    hub.stop();
    if (lockRetryTimer) clearTimeout(lockRetryTimer);
    if (rateCleanupTimer) clearInterval(rateCleanupTimer);
    lockRetryTimer = null;
    rateCleanupTimer = null;
    if (lockClient) {
      lockClient.query('SELECT pg_advisory_unlock($1)', [C.ADVISORY_LOCK_KEY])
        .catch(() => {})
        .finally(() => {
          try { lockClient.release(); } catch (_) { /* already released */ }
          lockClient = null;
        });
    }
  }

  return {
    current: stateFor,
    placeBet,
    cashOut,
    start,
    stop,
    engine,
    hub,
    httpState,
    httpBet,
    httpCashout,
    httpHistory,
    httpMyBets,
    httpVerify,
    httpAvailability,
    httpStream,
    isEnabled: () => enabled
  };
}

module.exports = { createCrashService, crashEnabled, maskLabel, STATUS_BY_CODE };
