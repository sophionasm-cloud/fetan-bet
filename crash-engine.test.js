'use strict';

// Deterministic engine tests: fake clock, in-memory repo, fake settlement.
// Run with: node crash-engine.test.js
const assert = require('node:assert/strict');
const C = require('./crash-config');
const M = require('./crash-math');
const { createCrashEngine } = require('./crash-engine');

const SEED_A = '00'.repeat(32);
const SEED_B = '11'.repeat(32);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeWorld(startAt = 1_000_000) {
  const state = {
    now: startAt,
    rounds: [],
    bets: [],
    nextRoundId: 1,
    nextBetId: 1,
    nextGameRoundId: 1,
    debits: 0,
    credits: 0,
    ledgerDelta: 0,
    settleCalls: [],
    failSettleAttempts: 0
  };

  const findRound = (id) => state.rounds.find((round) => round.id === id);
  const findBet = (id) => state.bets.find((bet) => bet.id === id);

  const repo = {
    async allocateRoundId() {
      return state.nextRoundId++;
    },
    async createRound(data) {
      const round = {
        id: data.id,
        status: 'betting',
        serverSeed: data.serverSeed,
        serverSeedHash: data.serverSeedHash,
        clientSeed: data.clientSeed,
        crashHundredths: data.crashHundredths,
        edgeBp: data.edgeBp,
        growthKMicro: data.growthKMicro,
        maxHundredths: data.maxHundredths,
        bettingClosesAt: data.bettingClosesAt == null ? null : Number(data.bettingClosesAt),
        startedAt: null,
        crashedAt: null,
        createdAt: state.now
      };
      state.rounds.push(round);
      return clone(round);
    },
    async getRecentRounds(limit = 4) {
      return clone([...state.rounds].sort((a, b) => b.id - a.id).slice(0, limit));
    },
    async getRoundById(id) {
      return clone(findRound(id) || null);
    },
    async setBettingClosesAt(id, closesAt) {
      const round = findRound(id);
      if (!round || round.status !== 'betting' || round.bettingClosesAt != null) return null;
      round.bettingClosesAt = Number(closesAt);
      return clone(round);
    },
    async startRound(id, startedAt, now) {
      const round = findRound(id);
      if (!round || round.status !== 'betting') return null;
      if (round.bettingClosesAt == null || round.bettingClosesAt > now) return null;
      round.status = 'flying';
      round.startedAt = Number(startedAt);
      return clone(round);
    },
    async markCrashed(id, crashedAt) {
      const round = findRound(id);
      if (!round || round.status !== 'flying') return null;
      round.status = 'crashed';
      round.crashedAt = Number(crashedAt);
      return clone(round);
    },
    async getOpenBetsForRound(roundId) {
      return clone(state.bets.filter((bet) => bet.crashRoundId === roundId && bet.status === 'open'));
    },
    async sweepOpenBets(roundId) {
      let count = 0;
      for (const bet of state.bets) {
        if (bet.crashRoundId === roundId && bet.status === 'open') {
          bet.status = 'lost';
          bet.payoutSantim = 0;
          count++;
        }
      }
      return count;
    }
  };

  function placeBet({ roundId, userId = 7, panel = 1, stakeSantim = 100, autoCashoutHundredths = null, requestId = `req-${state.nextBetId}-xx` }) {
    const replay = state.bets.find((bet) => bet.userId === userId && bet.requestId === requestId);
    if (replay) return { bet: clone(replay), replayed: true };
    const round = findRound(roundId);
    if (!round || round.status !== 'betting') throw new Error('BETTING_CLOSED');
    if (state.bets.some((bet) => bet.crashRoundId === roundId && bet.userId === userId && bet.panel === panel)) {
      throw new Error('PANEL_BUSY');
    }
    const bet = {
      id: state.nextBetId++,
      crashRoundId: roundId,
      userId,
      panel,
      stakeSantim,
      autoCashoutHundredths,
      status: 'open',
      cashoutHundredths: null,
      payoutSantim: 0,
      gameRoundId: state.nextGameRoundId++,
      requestId,
      createdAt: state.now
    };
    state.bets.push(bet);
    state.debits += 1;
    state.ledgerDelta -= stakeSantim;
    return { bet: clone(bet), replayed: false };
  }

  async function settle(bet, target) {
    state.settleCalls.push({ betId: bet.id, target, at: state.now });
    if (state.failSettleAttempts > 0) {
      state.failSettleAttempts--;
      throw new Error('TRANSIENT');
    }
    const live = findBet(bet.id);
    if (!live || live.status !== 'open') return { paid: false };
    const round = findRound(live.crashRoundId);
    if (!round || round.status !== 'flying') return { paid: false };
    if (!Number.isInteger(target) || target > round.crashHundredths) throw new Error('ROUND_CRASHED');
    const payout = M.payoutSantim(live.stakeSantim, target);
    live.status = 'cashed';
    live.cashoutHundredths = target;
    live.payoutSantim = payout;
    state.credits += 1;
    state.ledgerDelta += payout;
    return { paid: true };
  }

  function manualCashout(betId, hundredths) {
    const bet = findBet(betId);
    const round = findRound(bet.crashRoundId);
    assert.equal(round.status, 'flying');
    assert.ok(hundredths < round.crashHundredths);
    if (bet.status !== 'open') return false;
    bet.status = 'cashed';
    bet.cashoutHundredths = hundredths;
    bet.payoutSantim = M.payoutSantim(bet.stakeSantim, hundredths);
    state.credits += 1;
    state.ledgerDelta += bet.payoutSantim;
    return true;
  }

  return { state, repo, placeBet, settle, manualCashout, findRound, findBet };
}

function makeEngine(world, { seeds = null, emits = [] } = {}) {
  const queue = seeds ? [...seeds] : null;
  let pairIndex = 0;
  return createCrashEngine({
    repo: world.repo,
    settle: world.settle,
    emit: (event) => emits.push(event),
    clock: () => world.state.now,
    timer: { setTimeout: () => 1, clearTimeout: () => {} },
    log: { info: () => {}, error: () => {} },
    generateServerSeed: queue
      ? () => queue[pairIndex % queue.length][0]
      : undefined,
    generateClientSeed: queue
      ? () => {
        const clientSeed = queue[pairIndex % queue.length][1];
        pairIndex++;
        return clientSeed;
      }
      : undefined
  });
}

const seeded = [
  [SEED_A, 'client-seed-1'], // round id 1 -> 1.60x
  [SEED_B, 'fetan'], // round id 2
  [SEED_A, 'client-seed-1'],
  [SEED_B, 'fetan']
];

async function testFullLifecycle() {
  const world = makeWorld();
  const emits = [];
  const engine = makeEngine(world, { seeds: seeded, emits });

  await engine.reconcile();
  const first = world.findRound(1);
  assert.equal(first.status, 'betting');
  assert.equal(first.crashHundredths, 160);
  assert.equal(first.bettingClosesAt, world.state.now + C.BETTING_MS);
  assert.equal(engine.nextWakeAt(), first.bettingClosesAt);

  const normal = world.placeBet({ roundId: 1, panel: 1, stakeSantim: 100, requestId: 'normal-bet-1' });
  const auto = world.placeBet({ roundId: 1, panel: 2, stakeSantim: 300, autoCashoutHundredths: 130, requestId: 'auto-bet-2' });
  assert.equal(normal.replayed, false);

  const closesAt = world.state.now + C.BETTING_MS;
  world.state.now = closesAt;
  await engine.reconcile();
  assert.equal(world.findRound(1).status, 'flying');
  assert.equal(world.findRound(1).startedAt, closesAt);
  const preBetRound = world.findRound(2);
  assert.ok(preBetRound, 'next round exists at takeoff');
  assert.equal(preBetRound.status, 'betting');
  assert.equal(preBetRound.bettingClosesAt, null, 'next round accepts pre-bets immediately');
  const pre = world.placeBet({ roundId: 2, panel: 1, stakeSantim: 200, requestId: 'pre-bet-3' });
  assert.equal(pre.replayed, false);

  const autoAt = closesAt + M.crashDurationMs(130);
  world.state.now = autoAt;
  await engine.reconcile();
  assert.equal(world.findBet(auto.bet.id).status, 'cashed');
  assert.equal(world.findBet(auto.bet.id).cashoutHundredths, 130);
  assert.equal(world.findBet(auto.bet.id).payoutSantim, 390);
  assert.equal(world.state.settleCalls[0].target, 130);

  const crashAt = closesAt + M.crashDurationMs(160, C.GROWTH_K_MICRO);
  world.state.now = crashAt + 5;
  await engine.reconcile();
  assert.equal(world.findRound(1).status, 'crashed');
  assert.equal(world.findBet(normal.bet.id).status, 'lost');
  assert.ok(emits.some((event) => event.type === 'crash' && event.round.id === 1));
  assert.equal(world.findRound(2).status, 'betting');
  assert.equal(world.findRound(2).bettingClosesAt, null);

  const displayEnd = world.findRound(1).crashedAt + C.CRASHED_MS;
  world.state.now = displayEnd - 1;
  await engine.reconcile();
  assert.equal(engine.nextWakeAt(), displayEnd);
  world.state.now = displayEnd;
  await engine.reconcile();
  assert.equal(world.findRound(2).bettingClosesAt, displayEnd + C.BETTING_MS);

  world.state.now += C.BETTING_MS;
  await engine.reconcile();
  assert.equal(world.findRound(2).status, 'flying');
  assert.ok(world.findRound(3), 'a fresh pre-bet round follows every takeoff');

  // Money invariant for all settled bets: ledger delta equals payout - stake.
  const expected = world.state.bets.reduce((sum, bet) => sum + bet.payoutSantim - bet.stakeSantim, 0);
  assert.equal(world.state.ledgerDelta, expected);
  assert.equal(world.state.debits, 3);
  assert.equal(world.state.credits, 1);
  return { world, engine };
}

async function testLateAutoStillPaysTarget() {
  const world = makeWorld();
  const engine = makeEngine(world, { seeds: seeded });
  await engine.reconcile();
  world.placeBet({ roundId: 1, panel: 1, stakeSantim: 100, autoCashoutHundredths: 130, requestId: 'late-auto-1' });
  const closesAt = world.findRound(1).bettingClosesAt;
  world.state.now = closesAt;
  await engine.reconcile();
  const crashAt = closesAt + M.crashDurationMs(160);
  world.state.now = crashAt + 2000; // timer fires two seconds late
  await engine.reconcile();
  assert.equal(world.findRound(1).status, 'crashed');
  assert.equal(world.state.bets[0].status, 'cashed');
  assert.equal(world.state.bets[0].cashoutHundredths, 130, 'exact target, not current multiplier');
  assert.equal(world.state.bets[0].payoutSantim, 130);
  assert.deepEqual(world.state.settleCalls.map((call) => call.target), [130]);
}

async function testAutoAboveCrashLoses() {
  const world = makeWorld();
  const engine = makeEngine(world, { seeds: seeded });
  await engine.reconcile();
  world.placeBet({ roundId: 1, panel: 1, stakeSantim: 100, autoCashoutHundredths: 200, requestId: 'too-high-1' });
  const closesAt = world.findRound(1).bettingClosesAt;
  world.state.now = closesAt;
  await engine.reconcile();
  world.state.now = closesAt + M.crashDurationMs(160) + 1;
  await engine.reconcile();
  assert.equal(world.state.bets[0].status, 'lost');
  assert.equal(world.state.settleCalls.length, 0);
}

async function testSettlementFailureDelaysCrash() {
  const world = makeWorld();
  const engine = makeEngine(world, { seeds: seeded });
  await engine.reconcile();
  world.placeBet({ roundId: 1, panel: 1, stakeSantim: 100, autoCashoutHundredths: 130, requestId: 'retry-auto-1' });
  const closesAt = world.findRound(1).bettingClosesAt;
  world.state.now = closesAt;
  await engine.reconcile();
  world.state.now = closesAt + M.crashDurationMs(160) + 1;
  world.state.failSettleAttempts = C.AUTO_SETTLE_MAX_ATTEMPTS;
  await engine.reconcile();
  assert.equal(world.findRound(1).status, 'flying', 'crash waits for due auto settlement');
  assert.equal(engine.nextWakeAt(), world.state.now + C.ENGINE_POLL_MS);
  world.state.now += C.ENGINE_POLL_MS;
  await engine.reconcile();
  assert.equal(world.state.bets[0].status, 'cashed');
  assert.equal(world.findRound(1).status, 'crashed');
  assert.equal(world.state.bets[0].payoutSantim, 130);
}

async function testCashoutCrashRace() {
  // Ordering 1: player cashes out, then the crash transition runs.
  const world1 = makeWorld();
  const engine1 = makeEngine(world1, { seeds: seeded });
  await engine1.reconcile();
  world1.placeBet({ roundId: 1, panel: 1, stakeSantim: 100, requestId: 'race-cash-1' });
  world1.state.now = world1.findRound(1).bettingClosesAt;
  await engine1.reconcile();
  assert.equal(world1.manualCashout(1, 120), true);
  const crashAt = world1.findRound(1).startedAt + M.crashDurationMs(160);
  world1.state.now = crashAt + 1;
  await engine1.reconcile();
  assert.equal(world1.state.credits, 1, 'one credit');
  assert.equal(world1.state.bets[0].status, 'cashed');
  assert.equal(world1.state.bets[0].payoutSantim, 120);

  // Ordering 2: crash runs first; a later settlement attempt cannot pay.
  const world2 = makeWorld();
  const engine2 = makeEngine(world2, { seeds: seeded });
  await engine2.reconcile();
  world2.placeBet({ roundId: 1, panel: 1, stakeSantim: 100, requestId: 'race-crash-1' });
  world2.state.now = world2.findRound(1).bettingClosesAt;
  await engine2.reconcile();
  world2.state.now = world2.findRound(1).startedAt + M.crashDurationMs(160) + 1;
  await engine2.reconcile();
  assert.equal(world2.state.bets[0].status, 'lost');
  await world2.settle(world2.state.bets[0], 150);
  assert.equal(world2.state.bets[0].status, 'lost');
  assert.equal(world2.state.credits, 0, 'no credit after the round crashed');
  assert.equal(world2.state.bets.filter((bet) => bet.status === 'open').length, 0);
}

async function testDuplicateRequests() {
  const world = makeWorld();
  const engine = makeEngine(world, { seeds: seeded });
  await engine.reconcile();
  const first = world.placeBet({ roundId: 1, panel: 1, stakeSantim: 100, requestId: 'dupe-request-1' });
  const replay = world.placeBet({ roundId: 1, panel: 1, stakeSantim: 100, requestId: 'dupe-request-1' });
  assert.equal(replay.replayed, true);
  assert.equal(replay.bet.id, first.bet.id);
  assert.equal(world.state.debits, 1, 'duplicate request never double-debits');
  assert.throws(
    () => world.placeBet({ roundId: 1, panel: 1, stakeSantim: 100, requestId: 'dupe-request-2' }),
    /PANEL_BUSY/
  );
  assert.equal(world.state.debits, 1, 'panel conflict leaves one debit');
}

async function testRestartRecovery() {
  // Betting, close in the future.
  {
    const world = makeWorld();
    await makeEngine(world, { seeds: seeded }).reconcile();
    const closes = world.findRound(1).bettingClosesAt;
    const restarted = makeEngine(world, { seeds: seeded });
    await restarted.reconcile();
    assert.equal(world.findRound(1).status, 'betting');
    assert.equal(restarted.nextWakeAt(), closes);
    assert.equal(world.state.rounds.length, 1);
  }
  // Betting, close already passed.
  {
    const world = makeWorld();
    await makeEngine(world, { seeds: seeded }).reconcile();
    world.state.now = world.findRound(1).bettingClosesAt + 10;
    await makeEngine(world, { seeds: seeded }).reconcile();
    assert.equal(world.findRound(1).status, 'flying');
  }
  // Flying, before the crash: resume timers without a new round.
  {
    const world = makeWorld();
    await makeEngine(world, { seeds: seeded }).reconcile();
    world.state.now = world.findRound(1).bettingClosesAt;
    await makeEngine(world, { seeds: seeded }).reconcile();
    const restarted = makeEngine(world, { seeds: seeded });
    await restarted.reconcile();
    assert.equal(world.findRound(1).status, 'flying');
    assert.ok(restarted.nextWakeAt() >= world.state.now);
    const crashAt = world.findRound(1).startedAt + M.crashDurationMs(160);
    world.state.now = crashAt + 1;
    await restarted.reconcile();
    assert.equal(world.findRound(1).status, 'crashed');
  }
  // Flying, already past the crash: crash immediately at boot.
  {
    const world = makeWorld();
    await makeEngine(world, { seeds: seeded }).reconcile();
    world.state.now = world.findRound(1).bettingClosesAt;
    await makeEngine(world, { seeds: seeded }).reconcile();
    world.state.now = world.findRound(1).startedAt + M.crashDurationMs(160) + 500;
    await makeEngine(world, { seeds: seeded }).reconcile();
    assert.equal(world.findRound(1).status, 'crashed');
    assert.equal(world.state.bets.filter((bet) => bet.status === 'open').length, 0);
  }
  // Crashed, display pending, then display over.
  {
    const world = makeWorld();
    await makeEngine(world, { seeds: seeded }).reconcile();
    world.state.now = world.findRound(1).bettingClosesAt;
    await makeEngine(world, { seeds: seeded }).reconcile();
    world.state.now = world.findRound(1).startedAt + M.crashDurationMs(160) + 1;
    await makeEngine(world, { seeds: seeded }).reconcile();
    const crashed = world.findRound(1);
    const restarted = makeEngine(world, { seeds: seeded });
    await restarted.reconcile();
    assert.equal(restarted.nextWakeAt(), crashed.crashedAt + C.CRASHED_MS);
    world.state.now = crashed.crashedAt + C.CRASHED_MS;
    await restarted.reconcile();
    assert.ok(world.findRound(2));
    assert.equal(world.findRound(2).status, 'betting');
  }
}

async function testOrphanSweepRecovery() {
  const world = makeWorld();
  const engine = makeEngine(world, { seeds: seeded });
  await engine.reconcile();
  world.placeBet({ roundId: 1, panel: 1, stakeSantim: 100, requestId: 'orphan-bet-1' });
  world.state.now = world.findRound(1).bettingClosesAt;
  await engine.reconcile();
  const round = world.findRound(1);
  const crashAt = round.startedAt + M.crashDurationMs(round.crashHundredths, round.growthKMicro);
  // Simulate a process exit after markCrashed but before the sweep.
  round.status = 'crashed';
  round.crashedAt = crashAt;
  world.state.now = crashAt + 1;
  assert.equal(world.findBet(1).status, 'open');

  const restarted = makeEngine(world, { seeds: seeded });
  await restarted.reconcile();
  assert.equal(world.findBet(1).status, 'lost');
  assert.equal(world.state.bets.filter((bet) => bet.status === 'open').length, 0);
  assert.equal(world.state.credits, 0, 'an unresolved losing bet never receives a credit');
}

function findInstantCrashSeed(nonce) {
  for (let i = 0; i < 5000; i++) {
    const seed = M.sha256Hex(`instant-crash-seed-${i}`);
    const crash = M.crashPointHundredths({ serverSeed: seed, clientSeed: 'instant-client', nonce });
    if (crash === 100) return seed;
  }
  throw new Error('no instant crash seed found');
}

async function testInstantCrash() {
  const seed = findInstantCrashSeed(1);
  const world = makeWorld();
  const emits = [];
  const engine = makeEngine(world, { seeds: [[seed, 'instant-client']], emits });
  await engine.reconcile();
  assert.equal(world.findRound(1).crashHundredths, 100);
  world.placeBet({ roundId: 1, panel: 1, stakeSantim: 100, autoCashoutHundredths: 101, requestId: 'instant-bet-1' });
  world.state.now = world.findRound(1).bettingClosesAt;
  await engine.reconcile();
  assert.equal(world.findRound(1).status, 'crashed', 'takes off and crashes in the same reconcile pass');
  assert.equal(world.state.bets[0].status, 'lost');
  assert.equal(world.state.credits, 0);
  assert.ok(emits.some((event) => event.type === 'crash' && event.round.crashHundredths === 100));
}

async function testSecrecyProjection() {
  const world = makeWorld();
  const emits = [];
  const engine = makeEngine(world, { seeds: seeded, emits });
  await engine.reconcile();
  const bettingView = M.publicRound(world.findRound(1));
  const serialized = JSON.stringify(bettingView);
  assert.equal(serialized.includes(world.findRound(1).serverSeed), false);
  assert.equal('serverSeed' in bettingView, false);
  assert.equal('crashHundredths' in bettingView, false);
  assert.equal(bettingView.serverSeedHash, world.findRound(1).serverSeedHash);

  world.placeBet({ roundId: 1, panel: 1, stakeSantim: 100, requestId: 'secrecy-bet-1' });
  world.state.now = world.findRound(1).bettingClosesAt;
  await engine.reconcile();
  const flyingView = M.publicRound(world.findRound(1));
  assert.equal('serverSeed' in flyingView, false);
  assert.equal('crashHundredths' in flyingView, false);

  world.state.now = world.findRound(1).startedAt + M.crashDurationMs(160) + 1;
  await engine.reconcile();
  const crashedView = M.publicRound(world.findRound(1));
  assert.equal(crashedView.serverSeed, world.findRound(1).serverSeed);
  assert.equal(crashedView.crashHundredths, 160);
  assert.equal(crashedView.phase, 'crashed');

  for (const event of emits.filter((item) => item.type === 'phase' && item.round.status !== 'crashed')) {
    const view = JSON.stringify(M.publicRound(event.round));
    assert.equal(view.includes('"serverSeed"'), false);
    assert.equal(view.includes('"crashHundredths"'), false);
  }
}

(async () => {
  await testFullLifecycle();
  await testLateAutoStillPaysTarget();
  await testAutoAboveCrashLoses();
  await testSettlementFailureDelaysCrash();
  await testCashoutCrashRace();
  await testDuplicateRequests();
  await testRestartRecovery();
  await testOrphanSweepRecovery();
  await testInstantCrash();
  await testSecrecyProjection();
  console.log('crash-engine.test.js OK');
  console.log('  lifecycle, pre-bet, late auto target, crash race, retries, recovery, orphan sweep, instant crash, secrecy');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
