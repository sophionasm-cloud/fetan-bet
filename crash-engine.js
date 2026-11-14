'use strict';

// Rocket Crash shared-round state machine. Every transition is a conditional
// database update; the engine can restart at any phase and reconcile from the
// persisted timestamps. Tests inject a fake clock, repo and settle callback.
const C = require('./crash-config');
const M = require('./crash-math');

function defaultTimer() {
  return {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id)
  };
}

function createCrashEngine({
  repo,
  settle,
  emit = () => {},
  clock = () => Date.now(),
  timer = defaultTimer(),
  log = console,
  generateServerSeed = M.generateServerSeed,
  generateClientSeed = M.generateClientSeed,
  bettingMs = C.BETTING_MS,
  crashedMs = C.CRASHED_MS,
  edgeBp = C.EDGE_BP,
  growthKMicro = C.GROWTH_K_MICRO,
  maxHundredths = C.MAX_HUNDREDTHS
} = {}) {
  if (!repo) throw new TypeError('crash engine requires a repo');
  if (typeof settle !== 'function') throw new TypeError('crash engine requires a settle callback');

  let running = false;
  let busy = false;
  let queued = false;
  let timerId = null;
  let nextWakeAt = null;

  const safeEmit = (event) => {
    try {
      emit(event);
    } catch (err) {
      log.error('[crash] emit failed:', err.message);
    }
  };

  const autoTime = (round, bet) =>
    round.startedAt + M.crashDurationMs(bet.autoCashoutHundredths, round.growthKMicro || growthKMicro);

  function schedule(at) {
    nextWakeAt = Number.isFinite(at) ? at : null;
    if (!running) return;
    if (timerId != null) timer.clearTimeout(timerId);
    timerId = null;
    if (nextWakeAt == null) return;
    const delay = Math.max(0, Math.min(2147483000, nextWakeAt - clock()));
    timerId = timer.setTimeout(() => {
      timerId = null;
      void run();
    }, delay);
  }

  async function run() {
    try {
      await reconcile();
    } catch (err) {
      log.error('[crash] engine reconcile failed:', err.message);
      schedule(clock() + C.ENGINE_POLL_MS);
    }
  }

  async function createRound(bettingClosesAt) {
    const id = await repo.allocateRoundId();
    const serverSeed = generateServerSeed();
    const clientSeed = generateClientSeed();
    const crashHundredths = M.crashPointHundredths({
      serverSeed,
      clientSeed,
      nonce: id,
      edgeBp,
      maxHundredths
    });
    const round = await repo.createRound({
      id,
      serverSeed,
      serverSeedHash: M.serverSeedHash(serverSeed),
      clientSeed,
      crashHundredths,
      edgeBp,
      growthKMicro,
      maxHundredths,
      bettingClosesAt
    });
    if (round) {
      log.info(`[crash] round ${round.id} created (betting closes ${round.bettingClosesAt || 'after display'})`);
      safeEmit({ type: 'phase', round });
    }
    return round;
  }

  async function ensureNextRound(afterId) {
    const recent = await repo.getRecentRounds(2);
    const existing = recent.find((round) => round.id > afterId);
    if (existing) return existing;
    return createRound(null);
  }

  async function settleBatch(bets) {
    let allOk = true;
    for (let i = 0; i < bets.length; i += C.AUTO_SETTLE_CONCURRENCY) {
      const chunk = bets.slice(i, i + C.AUTO_SETTLE_CONCURRENCY);
      const results = await Promise.all(chunk.map(async (bet) => {
        for (let attempt = 1; attempt <= C.AUTO_SETTLE_MAX_ATTEMPTS; attempt++) {
          try {
            await settle(bet, bet.autoCashoutHundredths);
            return true;
          } catch (err) {
            if (attempt >= C.AUTO_SETTLE_MAX_ATTEMPTS) {
              log.error(`[crash] auto cash-out failed for bet ${bet.id} at ${bet.autoCashoutHundredths}: ${err.message}`);
              return false;
            }
          }
        }
        return false;
      }));
      if (results.includes(false)) allOk = false;
    }
    return allOk;
  }

  // Returns 'flying' | 'crashed' | 'retry'.
  async function reconcileFlying(round, now) {
    const crashAt = round.startedAt + M.crashDurationMs(round.crashHundredths, round.growthKMicro || growthKMicro);
    let open = await repo.getOpenBetsForRound(round.id);
    const due = open.filter((bet) =>
      bet.autoCashoutHundredths != null &&
      bet.autoCashoutHundredths <= round.crashHundredths &&
      autoTime(round, bet) <= Math.min(now, crashAt)
    );
    if (due.length) {
      const ok = await settleBatch(due);
      if (!ok) return 'retry';
      open = await repo.getOpenBetsForRound(round.id);
    }

    if (now >= crashAt) {
      // A late timer or a restart must still pay every due auto target before
      // the round is linearized as crashed.
      const winners = open.filter((bet) =>
        bet.autoCashoutHundredths != null && bet.autoCashoutHundredths <= round.crashHundredths
      );
      if (winners.length) {
        const ok = await settleBatch(winners);
        if (!ok) return 'retry';
      }
      const crashed = await repo.markCrashed(round.id, now);
      const swept = await repo.sweepOpenBets(round.id);
      const finalRound = crashed || (await repo.getRoundById(round.id)) || round;
      log.info(`[crash] round ${round.id} crashed at ${finalRound.crashHundredths / 100}x; swept ${swept} losing bet(s)`);
      safeEmit({ type: 'crash', round: finalRound, swept });
      schedule((finalRound.crashedAt || now) + crashedMs);
      return 'crashed';
    }

    let nextAt = crashAt;
    for (const bet of open) {
      if (bet.autoCashoutHundredths == null || bet.autoCashoutHundredths > round.crashHundredths) continue;
      const at = autoTime(round, bet);
      if (at > now && at < nextAt) nextAt = at;
    }
    schedule(nextAt);
    return 'flying';
  }

  async function reconcile() {
    if (busy) {
      queued = true;
      return;
    }
    busy = true;
    try {
      let rounds = await repo.getRecentRounds(3);
      if (!rounds.length) {
        const round = await createRound(clock() + bettingMs);
        schedule(round ? round.bettingClosesAt : clock() + C.ENGINE_POLL_MS);
        return;
      }

      // Normal steady state: the newest round is the pre-bet round for the
      // round that is currently flying.
      const flying = rounds.find((round) => round.status === 'flying');
      if (flying) {
        const outcome = await reconcileFlying(flying, clock());
        if (outcome === 'retry') {
          schedule(clock() + C.ENGINE_POLL_MS);
          return;
        }
        rounds = await repo.getRecentRounds(3);
      }

      const latest = rounds[0];
      if (!latest) {
        schedule(clock() + C.ENGINE_POLL_MS);
        return;
      }

      if (latest.status === 'flying') {
        await ensureNextRound(latest.id);
        await reconcileFlying(latest, clock());
        return;
      }

      if (latest.status === 'crashed') {
        const displayEnd = latest.crashedAt + crashedMs;
        if (clock() < displayEnd) {
          schedule(displayEnd);
          return;
        }
        const round = await createRound(clock() + bettingMs);
        schedule(round ? round.bettingClosesAt : clock() + C.ENGINE_POLL_MS);
        return;
      }

      // Latest is betting.
      if (latest.bettingClosesAt == null) {
        const previous = rounds.find((round) => round.id < latest.id);
        if (previous && previous.status === 'crashed') {
          const displayEnd = previous.crashedAt + crashedMs;
          if (clock() < displayEnd) {
            schedule(displayEnd);
            return;
          }
        } else if (previous && previous.status === 'flying') {
          // The pre-bet round waits while the previous round is still in the
          // air; opening the window early would let the chart skip a crash.
          schedule(previous.startedAt + M.crashDurationMs(previous.crashHundredths, previous.growthKMicro || growthKMicro));
          return;
        }
        const closesAt = clock() + bettingMs;
        const updated = await repo.setBettingClosesAt(latest.id, closesAt);
        if (updated) {
          log.info(`[crash] round ${updated.id} betting window opens for ${bettingMs}ms`);
          safeEmit({ type: 'phase', round: updated });
          schedule(closesAt);
        } else {
          schedule(clock() + C.ENGINE_POLL_MS);
        }
        return;
      }

      if (clock() < latest.bettingClosesAt) {
        schedule(latest.bettingClosesAt);
        return;
      }

      const startedAt = latest.bettingClosesAt;
      const flyingRound = await repo.startRound(latest.id, startedAt, clock());
      if (!flyingRound) {
        schedule(clock() + C.ENGINE_POLL_MS);
        return;
      }
      log.info(`[crash] round ${flyingRound.id} took off at ${flyingRound.startedAt}`);
      safeEmit({ type: 'phase', round: flyingRound });
      await ensureNextRound(flyingRound.id);
      await reconcileFlying(flyingRound, clock());
    } finally {
      busy = false;
      if (queued) {
        queued = false;
        void run();
      }
    }
  }

  function start() {
    if (running) return;
    running = true;
    log.info('[crash] engine started');
    void run();
  }

  function stop() {
    running = false;
    if (timerId != null) {
      timer.clearTimeout(timerId);
      timerId = null;
    }
    queued = false;
  }

  return {
    reconcile,
    start,
    stop,
    isRunning: () => running,
    nextWakeAt: () => nextWakeAt
  };
}

module.exports = { createCrashEngine };
