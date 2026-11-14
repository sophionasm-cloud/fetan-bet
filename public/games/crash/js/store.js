// Rocket Crash single client store. Renderers subscribe; only discrete state
// changes notify, while ticks update the clock silently for the animation.
'use strict';
window.CrashStore = (function () {
  const defaults = Object.assign({}, window.CrashConfig);
  const state = {
    phase: 'loading',
    round: null,
    bettingRoundId: null,
    bets: [],
    myBets: [],
    history: [],
    balance: null,
    currency: defaults.currency,
    connection: 'connecting',
    config: defaults,
    offset: 0,
    serverTime: 0,
    lastTick: null,
    settings: { sound: true, reducedEffects: false },
    mock: false
  };
  const ownBetIds = new Set();
  const listeners = new Set();

  try {
    const savedSound = localStorage.getItem('crash-sound');
    const savedReduced = localStorage.getItem('crash-reduced');
    if (savedSound != null) state.settings.sound = savedSound === '1';
    if (savedReduced != null) {
      state.settings.reducedEffects = savedReduced === '1' ||
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    }
  } catch (_) { /* storage can be unavailable in private frames */ }

  function notify(kind) {
    for (const listener of listeners) {
      try {
        listener(kind, state);
      } catch (err) {
        console.error('[crash] renderer failed', err);
      }
    }
  }

  function upsert(list, bet) {
    const index = list.findIndex((item) => item.id === bet.id);
    if (index >= 0) list[index] = Object.assign({}, list[index], bet);
    else list.push(bet);
  }

  function syncOwnIds() {
    ownBetIds.clear();
    for (const bet of state.myBets) ownBetIds.add(bet.id);
  }

  function applySnapshot(snapshot) {
    if (!snapshot) return;
    if (snapshot.config) state.config = Object.assign({}, defaults, snapshot.config);
    state.round = snapshot.round || null;
    state.bettingRoundId = snapshot.bettingRoundId == null ? null : Number(snapshot.bettingRoundId);
    state.bets = Array.isArray(snapshot.bets) ? snapshot.bets : [];
    state.myBets = Array.isArray(snapshot.myBets) ? snapshot.myBets : [];
    state.history = Array.isArray(snapshot.history) ? snapshot.history : [];
    state.phase = state.round ? state.round.phase : 'loading';
    if (snapshot.balance != null) state.balance = Number(snapshot.balance);
    if (snapshot.serverTime) {
      state.serverTime = Number(snapshot.serverTime);
      state.lastTick = { serverTime: state.serverTime, multiplierHundredths: null };
    }
    syncOwnIds();
    notify('snapshot');
  }

  function applyPhase(round) {
    if (!round) return;
    const previousId = state.round?.id;
    state.round = round;
    state.phase = round.phase;
    if (previousId !== round.id && round.phase === 'betting') {
      state.bets = [];
      state.history = state.history.slice();
    }
    notify('phase');
  }

  function applyTick(tick) {
    if (!tick) return;
    if (tick.serverTime) state.serverTime = Number(tick.serverTime);
    if (tick.multiplierHundredths != null) state.lastTick = {
      serverTime: Number(tick.serverTime) || Date.now(),
      multiplierHundredths: Number(tick.multiplierHundredths)
    };
  }

  function applyBet(bet) {
    if (!bet) return;
    if (state.round && bet.roundId === state.round.id) upsert(state.bets, bet);
    if (bet.mine || ownBetIds.has(bet.id)) {
      ownBetIds.add(bet.id);
      upsert(state.myBets, {
        id: bet.id,
        roundId: bet.roundId,
        panel: bet.panel,
        stake: bet.stake,
        autoCashout: bet.autoCashout,
        status: bet.status,
        cashoutHundredths: bet.cashoutHundredths,
        payout: bet.payout
      });
    }
    notify('bet');
  }

  function applyCashout(bet) {
    if (!bet) return;
    if (state.round && bet.roundId === state.round.id) upsert(state.bets, bet);
    if (ownBetIds.has(bet.id) || bet.mine) {
      const existing = state.myBets.find((item) => item.id === bet.id);
      upsert(state.myBets, Object.assign({}, existing, {
        status: bet.status,
        cashoutHundredths: bet.cashoutHundredths,
        payout: bet.payout
      }));
    }
    notify('cashout');
  }

  function applyCrash(round) {
    if (round) state.round = round;
    state.phase = 'crashed';
    notify('crash');
  }

  function applyHistory(history) {
    state.history = Array.isArray(history) ? history : [];
    notify('history');
  }

  function mergeMyBet(bet) {
    if (!bet) return;
    ownBetIds.add(bet.id);
    upsert(state.myBets, bet);
    if (state.round && bet.roundId === state.round.id) {
      upsert(state.bets, Object.assign({}, bet, { mine: true, label: 'You' }));
    }
    syncOwnIds();
    notify('mybet');
  }

  function setBalance(balance) {
    if (balance == null) return;
    state.balance = Number(balance);
    notify('balance');
  }

  function setConnection(connection) {
    if (state.connection === connection) return;
    state.connection = connection;
    notify('connection');
  }

  function setOffset(offset) {
    if (Number.isFinite(offset)) state.offset = offset;
  }

  function setSettings(patch) {
    state.settings = Object.assign({}, state.settings, patch);
    try {
      localStorage.setItem('crash-sound', state.settings.sound ? '1' : '0');
      localStorage.setItem('crash-reduced', state.settings.reducedEffects ? '1' : '0');
    } catch (_) { /* ignore */ }
    notify('settings');
  }

  function setMock(value) {
    state.mock = Boolean(value);
  }

  function now() {
    return Date.now() + state.offset;
  }

  function currentMultiplier() {
    if (state.phase === 'crashed') return state.round?.crashHundredths || 100;
    if (state.phase !== 'flying' || !state.round?.startedAt) return 100;
    const raw = window.CrashCurve.multiplierAt(now() - state.round.startedAt, state.config.growthK);
    const tick = state.lastTick;
    if (tick && tick.multiplierHundredths != null && tick.serverTime) {
      // Never let a fast local clock run far past the last server sample.
      const drift = now() - tick.serverTime;
      const allowance = Math.max(0, drift) * 0.09 + 6;
      return Math.min(raw, tick.multiplierHundredths + Math.ceil(allowance));
    }
    return raw;
  }

  function countdownMs() {
    if (state.phase !== 'betting' || !state.round?.bettingClosesAt) return 0;
    return Math.max(0, state.round.bettingClosesAt - now());
  }

  function openBetCount() {
    return state.bets.filter((bet) => bet.status === 'open').length;
  }

  function myBet(roundId, panel) {
    return state.myBets.find((bet) => bet.roundId === roundId && Number(bet.panel) === Number(panel)) || null;
  }

  function betById(id) {
    return state.myBets.find((bet) => bet.id === id) || state.bets.find((bet) => bet.id === id) || null;
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    state,
    subscribe,
    applySnapshot,
    applyPhase,
    applyTick,
    applyBet,
    applyCashout,
    applyCrash,
    applyHistory,
    mergeMyBet,
    setBalance,
    setConnection,
    setOffset,
    setSettings,
    setMock,
    now,
    currentMultiplier,
    countdownMs,
    openBetCount,
    myBet,
    betById,
    isOwnBet: (id) => ownBetIds.has(id)
  };
})();
