'use strict';

(() => {
  const config = window.SLOT_CONFIG;
  const math = window.SLOT_MATH;
  const state = {
    balance: config.MOCK_BALANCE_SANTIM,
    sequence: 0,
    recent: [],
    epoch: 1,
  };
  const fixtureStops = () => config.REELS.map((reel) => {
    const middleHeart = reel.strip.indexOf('heart');
    return (middleHeart + config.REEL_STOP_COUNT - 1) % config.REEL_STOP_COUNT;
  });
  function fairness() {
    return {
      server_seed_hash: 'c7a4d1b839e27f015a6c4d8b2f90e631c7a4d1b839e27f015a6c4d8b2f90e631',
      client_seed: '0123456789abcdef0123456789abcdef',
      nonce: state.sequence,
      spins_remaining: config.SEED_EPOCH_SPINS - (state.sequence % config.SEED_EPOCH_SPINS),
      math_version: config.MATH_VERSION,
      fairness_version: config.FAIRNESS_VERSION,
    };
  }
  function getState(language = 'en') {
    const preview = math.evaluateStops(fixtureStops(), config.DEFAULT_BET_SANTIM);
    return {
      config,
      paytable: config.PAYTABLE,
      betOptionsSantim: config.QUICK_BETS_SANTIM,
      balance: state.balance,
      language: language === 'en' || language === 'am' ? language : config.DEFAULT_LANGUAGE,
      fairness: fairness(),
      preview: { stops: fixtureStops(), ...preview },
      recent: state.recent.slice(0, config.MAX_HISTORY_SPINS),
    };
  }
  function spin({ bet }) {
    if (!math.isValidBet(bet)) throw Object.assign(new Error('INVALID'), { code: 'INVALID' });
    if (state.balance < bet) throw Object.assign(new Error('INSUFFICIENT'), { code: 'INSUFFICIENT' });
    state.sequence++;
    const stops = state.sequence % 2 ? fixtureStops() : [0, 0, 0, 0, 0];
    const result = math.evaluateStops(stops, bet);
    state.balance = state.balance - bet + result.totalPayout;
    const spin = {
      spinId: state.sequence,
      bet,
      stops,
      grid: result.grid,
      wins: result.wins,
      totalPayout: result.totalPayout,
      balance: state.balance,
      replayed: false,
      fairness: { ...fairness(), retired: false, server_seed: null },
    };
    state.recent.unshift({ ...spin, createdAt: new Date().toISOString() });
    return spin;
  }
  window.SLOT_MOCK = Object.freeze({ getState, spin, paytable: () => config.PAYTABLE });
})();
