// Localhost-only mock transport. It exists so the complete UI can be reviewed
// without PostgreSQL, wallet endpoints or B2 storage. It is unreachable unless
// the hostname is localhost/127.0.0.1 AND ?mock=1 is present, and it never
// calls the real wallet or bet endpoints.
'use strict';
window.CrashMock = (function () {
  const C = window.CrashConfig;
  const F = window.CrashFormat;
  const CURVE = window.CrashCurve;
  const encoder = new TextEncoder();
  const FAKE_LABELS = ['Dem***', 'Pil***', 'Ast***', 'Kad***', 'Mik***', 'Sol***', 'Nur***', 'Tes***', 'Yon***', 'Abe***'];
  const state = {
    balance: 100000,
    display: null,
    next: null,
    history: [],
    archive: new Map(),
    myBets: [],
    bets: [],
    requestMap: new Map(),
    nextRoundId: 1,
    nextBetId: 1,
    lastTickAt: 0,
    running: false,
    busy: false,
    handler: null,
    timer: null
  };

  function enabled() {
    const host = location.hostname;
    const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    return local && new URLSearchParams(location.search).get('mock') === '1';
  }

  function randomInt(max) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] % max;
  }

  function hex(buffer) {
    return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function sha256(text) {
    return hex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
  }

  async function hmac(seed, message) {
    const key = await crypto.subtle.importKey('raw', encoder.encode(seed), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
  }

  function serverSeed() {
    return hex(crypto.getRandomValues(new Uint8Array(32)));
  }

  function clientSeed() {
    return hex(crypto.getRandomValues(new Uint8Array(16)));
  }

  function crashFromHmac(hmacHex) {
    const X = BigInt('0x' + hmacHex.slice(0, 13));
    const N = 1n << 52n;
    const raw = (100n * 9700n * N) / (10000n * (N - X));
    if (raw < 100n) return 100;
    if (raw > 100000n) return 100000;
    return Number(raw);
  }

  async function makeRound(bettingClosesAt) {
    const id = state.nextRoundId++;
    const sSeed = serverSeed();
    const cSeed = clientSeed();
    const hash = await sha256(sSeed);
    const crash = crashFromHmac(await hmac(sSeed, `${cSeed}:${id}`));
    return {
      id,
      status: 'betting',
      serverSeed: sSeed,
      serverSeedHash: hash,
      clientSeed: cSeed,
      crashHundredths: crash,
      bettingClosesAt,
      startedAt: null,
      crashedAt: null
    };
  }

  function publicRound(round) {
    if (!round) return null;
    const view = {
      id: round.id,
      phase: round.status,
      serverSeedHash: round.serverSeedHash,
      clientSeed: round.clientSeed,
      bettingClosesAt: round.bettingClosesAt,
      startedAt: round.startedAt
    };
    if (round.crashedAt != null) view.crashedAt = round.crashedAt;
    if (round.status === 'crashed') {
      view.crashHundredths = round.crashHundredths;
      view.serverSeed = round.serverSeed;
    }
    return view;
  }

  function publicBet(bet, viewerOwned) {
    const mine = Boolean(viewerOwned);
    const view = {
      id: bet.id,
      roundId: bet.roundId,
      panel: bet.panel,
      label: mine ? 'You' : bet.label,
      stake: bet.stake,
      status: bet.status,
      cashoutHundredths: bet.cashoutHundredths,
      payout: bet.payout,
      mine
    };
    if (mine) view.autoCashout = bet.autoCashout;
    return view;
  }

  function ownBet(bet) {
    return {
      id: bet.id,
      roundId: bet.roundId,
      panel: bet.panel,
      stake: bet.stake,
      autoCashout: bet.autoCashout,
      status: bet.status,
      cashoutHundredths: bet.cashoutHundredths,
      payout: bet.payout,
      createdAt: bet.createdAt
    };
  }

  function displayedBets() {
    if (!state.display) return [];
    return state.bets
      .filter((bet) => bet.roundId === state.display.id)
      .sort((a, b) => b.stake - a.stake || a.id - b.id)
      .slice(0, C.displayBets);
  }

  function relevantMyBets() {
    const ids = new Set([state.display?.id, state.next?.id].filter(Boolean));
    return state.myBets.filter((bet) => ids.has(bet.roundId));
  }

  function snapshot() {
    return {
      serverTime: Date.now(),
      config: Object.assign({}, C),
      round: publicRound(state.display),
      bettingRoundId: state.next?.id ?? (state.display?.status === 'betting' ? state.display.id : null),
      bets: displayedBets().map((bet) => publicBet(bet, bet.mine)),
      myBets: relevantMyBets().map(ownBet),
      history: state.history.slice(0, 20),
      balance: state.balance
    };
  }

  function emit(event, data) {
    if (state.handler) {
      try {
        state.handler(event, data);
      } catch (err) {
        console.error('[crash mock] handler failed', err);
      }
    }
  }

  function addBet(round, { panel, stake, autoCashout, label, mine }) {
    const bet = {
      id: state.nextBetId++,
      roundId: round.id,
      panel,
      stake,
      autoCashout: autoCashout || null,
      status: 'open',
      cashoutHundredths: null,
      payout: 0,
      label,
      mine: Boolean(mine),
      createdAt: Date.now()
    };
    state.bets.push(bet);
    if (bet.mine) state.myBets.push(bet);
    return bet;
  }

  function seedFakeBets(round, count) {
    for (let i = 0; i < count; i++) {
      const panel = randomInt(2) + 1;
      if (state.bets.some((bet) => bet.roundId === round.id && bet.label === FAKE_LABELS[i % FAKE_LABELS.length] && bet.panel === panel)) continue;
      const auto = randomInt(3) === 0 ? 120 + randomInt(400) : null;
      addBet(round, {
        panel,
        stake: 100 + randomInt(40) * 100,
        autoCashout: auto,
        label: FAKE_LABELS[i % FAKE_LABELS.length],
        mine: false
      });
    }
  }

  function settleAuto(bet, hundredths) {
    if (bet.status !== 'open') return false;
    bet.status = 'cashed';
    bet.cashoutHundredths = hundredths;
    bet.payout = CURVE.payoutSantim(bet.stake, hundredths);
    if (bet.mine) state.balance += bet.payout;
    emit('cashout', { bet: publicBet(bet, bet.mine) });
    return true;
  }

  async function takeoff() {
    if (!state.display || state.display.status !== 'betting') return;
    state.display.status = 'flying';
    state.display.startedAt = state.display.bettingClosesAt || Date.now();
    state.display.bettingClosesAt = state.display.startedAt;
    emit('phase', { round: publicRound(state.display) });
    const next = await makeRound(null);
    state.next = next;
    seedFakeBets(next, 4);
    emit('snapshot', snapshot());
  }

  function crash() {
    const round = state.display;
    if (!round || round.status !== 'flying') return;
    round.status = 'crashed';
    round.crashedAt = Date.now();
    for (const bet of state.bets) {
      if (bet.roundId === round.id && bet.status === 'open') {
        bet.status = 'lost';
        bet.payout = 0;
      }
    }
    state.archive.set(round.id, round);
    state.history.unshift({ roundId: round.id, crashHundredths: round.crashHundredths, crashedAt: round.crashedAt });
    state.history = state.history.slice(0, 20);
    emit('crash', { round: publicRound(round) });
    emit('history', { history: state.history });
    emit('snapshot', snapshot());
  }

  async function openNext() {
    if (!state.next) {
      state.next = await makeRound(Date.now() + C.bettingMs);
    } else {
      state.next.bettingClosesAt = Date.now() + C.bettingMs;
    }
    state.display = state.next;
    state.next = null;
    seedFakeBets(state.display, 6);
    emit('phase', { round: publicRound(state.display) });
    emit('snapshot', snapshot());
  }

  async function onTick() {
    if (!state.running || state.busy) return;
    const now = Date.now();
    const round = state.display;
    if (!round) return;
    if (round.status === 'betting' && round.bettingClosesAt && now >= round.bettingClosesAt) {
      state.busy = true;
      try { await takeoff(); } finally { state.busy = false; }
      return;
    }
    if (round.status === 'flying') {
      const elapsed = now - round.startedAt;
      const multiplier = Math.min(
        CURVE.multiplierAt(elapsed, C.growthK),
        round.crashHundredths - 1
      );
      for (const bet of state.bets) {
        if (bet.roundId !== round.id || bet.status !== 'open' || !bet.autoCashout) continue;
        if (bet.autoCashout > round.crashHundredths) continue;
        if (elapsed >= CURVE.crashDurationMs(bet.autoCashout, C.growthK)) settleAuto(bet, bet.autoCashout);
      }
      if (elapsed >= CURVE.crashDurationMs(round.crashHundredths, C.growthK)) {
        crash();
        return;
      }
      if (now - state.lastTickAt >= 250) {
        state.lastTickAt = now;
        emit('tick', { serverTime: now, multiplierHundredths: multiplier });
      }
      return;
    }
    if (round.status === 'crashed' && round.crashedAt && now >= round.crashedAt + C.crashedMs) {
      state.busy = true;
      try { await openNext(); } finally { state.busy = false; }
    }
  }

  async function boot() {
    state.display = await makeRound(Date.now() + C.bettingMs);
    seedFakeBets(state.display, 6);
    state.running = true;
    emit('snapshot', snapshot());
    state.timer = setInterval(onTick, 60);
  }

  function connect(handler) {
    state.handler = handler;
    boot().catch((err) => console.error('[crash mock] boot failed', err));
    return () => stop();
  }

  function stop() {
    state.running = false;
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
  }

  function acceptingRound() {
    if (state.display?.status === 'betting') return state.display;
    return state.next;
  }

  function placeBet(panel, stake, autoCashout, requestId) {
    const replay = state.requestMap.get(requestId);
    if (replay) return Promise.resolve(replay);
    if (!Number.isInteger(panel) || (panel !== 1 && panel !== 2)) return Promise.reject(new Error('INVALID_PANEL'));
    if (!Number.isInteger(stake) || stake < C.minStake || stake > C.maxStake) return Promise.reject(new Error('INVALID_STAKE'));
    if (autoCashout != null && (!Number.isInteger(autoCashout) || autoCashout < 101)) {
      return Promise.reject(new Error('INVALID_AUTO_CASHOUT'));
    }
    const round = acceptingRound();
    if (!round) return Promise.reject(new Error('BETTING_CLOSED'));
    if (state.bets.some((bet) => bet.roundId === round.id && bet.mine && bet.panel === panel)) {
      return Promise.reject(new Error('PANEL_BUSY'));
    }
    if (state.balance < stake) return Promise.reject(new Error('INSUFFICIENT'));
    state.balance -= stake;
    const bet = addBet(round, { panel, stake, autoCashout, label: 'You', mine: true });
    emit('bet', { bet: publicBet(bet, false) });
    const result = { bet: publicBet(bet, true), balance: state.balance };
    state.requestMap.set(requestId, result);
    emit('snapshot', snapshot());
    return Promise.resolve(result);
  }

  function cashout(betId) {
    const bet = state.myBets.find((item) => item.id === betId);
    if (!bet) return Promise.reject(new Error('NOT_FOUND'));
    const round = state.display;
    if (!round || round.id !== bet.roundId) return Promise.reject(new Error('NOT_FLYING'));
    if (bet.status === 'cashed') return Promise.resolve({ bet: publicBet(bet, true), balance: state.balance });
    if (bet.status === 'lost' || round.status === 'crashed') return Promise.reject(new Error('ROUND_CRASHED'));
    if (round.status !== 'flying') return Promise.reject(new Error('NOT_FLYING'));
    const elapsed = Date.now() - round.startedAt;
    if (elapsed >= CURVE.crashDurationMs(round.crashHundredths, C.growthK)) {
      return Promise.reject(new Error('ROUND_CRASHED'));
    }
    const multiplier = Math.max(100, Math.min(
      CURVE.multiplierAt(elapsed, C.growthK),
      round.crashHundredths - 1
    ));
    bet.status = 'cashed';
    bet.cashoutHundredths = multiplier;
    bet.payout = CURVE.payoutSantim(bet.stake, multiplier);
    state.balance += bet.payout;
    emit('cashout', { bet: publicBet(bet, true) });
    emit('snapshot', snapshot());
    return Promise.resolve({ bet: publicBet(bet, true), balance: state.balance });
  }

  function fetchHistory() {
    const history = [...state.archive.values()]
      .sort((a, b) => b.id - a.id)
      .slice(0, 50)
      .map((round) => ({
        roundId: round.id,
        serverSeed: round.serverSeed,
        serverSeedHash: round.serverSeedHash,
        clientSeed: round.clientSeed,
        crashHundredths: round.crashHundredths,
        edgeBp: C.edgeBp,
        maxHundredths: C.maxHundredths,
        crashedAt: round.crashedAt
      }));
    return Promise.resolve({ history });
  }

  function fetchMyBets() {
    const bets = [...state.myBets].reverse().slice(0, 50).map((bet) => {
      const round = state.archive.get(bet.roundId) || (state.display?.id === bet.roundId ? state.display : null);
      return {
        id: bet.id,
        roundId: bet.roundId,
        panel: bet.panel,
        stake: bet.stake,
        autoCashout: bet.autoCashout,
        status: bet.status,
        cashoutHundredths: bet.cashoutHundredths,
        payout: bet.payout,
        crashHundredths: round?.status === 'crashed' ? round.crashHundredths : null,
        createdAt: bet.createdAt
      };
    });
    return Promise.resolve({ bets });
  }

  function fetchVerify(roundId) {
    const round = state.archive.get(Number(roundId));
    if (!round) return Promise.reject(new Error('ROUND_CRASHED'));
    return Promise.resolve({
      roundId: round.id,
      serverSeed: round.serverSeed,
      serverSeedHash: round.serverSeedHash,
      clientSeed: round.clientSeed,
      nonce: round.id,
      edgeBp: C.edgeBp,
      maxHundredths: C.maxHundredths,
      crashHundredths: round.crashHundredths,
      growthKMicro: Math.round(C.growthK * 1e6),
      formulaVersion: 'crash-v1',
      startedAt: round.startedAt,
      crashedAt: round.crashedAt
    });
  }

  return {
    enabled,
    connect,
    stop,
    refresh: () => Promise.resolve(snapshot()),
    placeBet,
    cashout,
    fetchHistory,
    fetchMyBets,
    fetchVerify
  };
})();
