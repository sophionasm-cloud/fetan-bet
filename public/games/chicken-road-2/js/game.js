/* Chicken Road Dash — original canvas recreation.
 * Vanilla JS, no dependencies. All artwork is drawn procedurally at runtime.
 */
(() => {
  'use strict';

  // ---------------------------------------------------------------- DOM
  const $ = (id) => document.getElementById(id);
  const stage = $('stage');
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const loader = $('loader');
  const balanceEl = $('balance');
  const betAmountEl = $('betAmount');
  const multiplierEl = $('multiplier');
  const multBadge = $('multBadge');
  const nextMultEl = $('nextMult');
  const cashValueEl = $('cashValue');
  const onlineEl = $('online');
  const tickerNameEl = $('tickerName');
  const tickerAmountEl = $('tickerAmount');
  const difficultyEl = $('difficulty');
  const chipsEl = $('chips');
  const playBtn = $('playBtn');
  const playActions = $('playActions');
  const goBtn = $('goBtn');
  const cashBtn = $('cashBtn');
  const minBtn = $('minBtn');
  const maxBtn = $('maxBtn');
  const soundBtn = $('soundBtn');
  const menuBtn = $('menuBtn');
  const soundOnIcon = $('soundOnIcon');
  const soundOffIcon = $('soundOffIcon');
  const stageHint = $('stageHint');
  const resultOverlay = $('resultOverlay');
  const resultCard = $('resultCard');
  const resultKicker = $('resultKicker');
  const resultTitle = $('resultTitle');
  const resultAmount = $('resultAmount');
  const resultSub = $('resultSub');
  const resultBtn = $('resultBtn');
  const verifyRoundBtn = $('verifyRoundBtn');
  const toastWrap = $('toastWrap');
  const howModal = $('howModal');
  const menuModal = $('menuModal');
  const menuSound = $('menuSound');
  const menuMusic = $('menuMusic');
  const menuSoundState = $('menuSoundState');
  const menuMusicState = $('menuMusicState');
  const menuHow = $('menuHow');
  const menuReset = $('menuReset');
  const integrationBlocker = $('integrationBlocker');
  const integrationWalletStatus = $('integrationWalletStatus');
  const modelCNote = $('modelCNote');
  const multLadderTrack = $('multLadderTrack');

  // ---------------------------------------------------------------- Constants
  const LANE_W = 112;
  const SIDE_L = 200;
  const SIDE_R = 190;
  const integrated = new URLSearchParams(location.search).get('fetan') === '1';
  const realWalletMode = true;
  const MIN_BET = 1;
  const MAX_BET = 500;
  const START_BALANCE = 1000000;
  const STORE_KEY = 'fetanbet.cr2.v1';

  function laneLimit() { return DIFFICULTY[state.difficulty].lanes; }
  function roadWidth() { return laneLimit() * LANE_W; }
  function finishPosition() { return laneLimit() + 1; }

  const DIFFICULTY = {
    easy: {
      label: 'Easy',
      lanes: 15,
      lines: [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29],
      multipliers: [1.01, 1.06, 1.15, 1.24, 1.35, 1.48, 1.65, 1.85, 2.12, 2.47, 2.96, 3.70, 4.64, 6.50, 12.08],
      speed: 82,
      density: 0.3,
      hopTime: 0.34,
      colors: ['#ef5b5b', '#f2b33d', '#4fc3a1', '#7189d8'],
    },
    medium: {
      label: 'Medium',
      lanes: 9,
      lines: [1, 3, 5, 7, 9, 11, 13, 15, 17],
      multipliers: [1.18, 1.83, 2.95, 5.02, 9.04, 17.74, 38.71, 67.34, 305.94],
      speed: 122,
      density: 0.62,
      hopTime: 0.30,
      colors: ['#ef5b5b', '#f2b33d', '#4fc3a1', '#7189d8', '#b06bd8'],
    },
    hard: {
      label: 'Hard',
      lanes: 9,
      lines: [1, 3, 5, 7, 9, 11, 13, 15, 17],
      multipliers: [1.44, 3.45, 9.09, 26.78, 92.54, 391.25, 2235.72, 18960.33, 379632.82],
      speed: 168,
      density: 0.9,
      hopTime: 0.26,
      colors: ['#ef5b5b', '#f2b33d', '#4fc3a1', '#7189d8', '#b06bd8', '#e8793c'],
    },
  };

  const TICKER_NAMES = [
    'Salmon S.', 'Lucky P.', 'Cluck M.', 'Nugget K.', 'Road R.', 'Dizzy D.',
    'Feather F.', 'Speedy G.', 'Wing W.', 'Chick C.', 'Bantam B.', 'Coop C.',
  ];

  // ---------------------------------------------------------------- Storage
  function readStore() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
    } catch (e) {
      return {};
    }
  }
  const saved = readStore();

  function saveStore() {
    if (integrated) {
      try { localStorage.setItem(STORE_KEY, JSON.stringify({ bet: state.bet, difficulty: state.difficulty, sound: state.sound, music: state.music })); } catch (e) { /* private mode */ }
      return;
    }
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        balance: state.balance,
        bet: state.bet,
        difficulty: state.difficulty,
        sound: state.sound,
        music: state.music,
      }));
    } catch (e) { /* private mode */ }
  }

  // ---------------------------------------------------------------- Utils
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeInOut = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const round2 = (v) => Math.round(v * 100) / 100;

  function fmtInt(n) {
    return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }
  function fmtMoney(n) {
    return Number(n).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + ' ETB';
  }
  function grossPreviewBirr(stakeBirr, multiplier) {
    const stakeCents = BigInt(Math.round(Number(stakeBirr) * 100));
    const multiplierCents = BigInt(Math.round(Number(multiplier) * 100));
    return Number(stakeCents * multiplierCents / 100n) / 100;
  }
  function fmtMult(n) {
    return String(Math.round(n * 100) / 100) + 'x';
  }
  function multForLane(lane) {
    if (integrated && Array.isArray(state.serverLadder) && state.serverLadder[lane - 1] !== undefined) return state.serverLadder[lane - 1];
    const multipliers = DIFFICULTY[state.difficulty].multipliers;
    return multipliers[Math.min(Math.max(1, lane), multipliers.length) - 1];
  }
  function laneCount() {
    return Math.min(state.pos, laneLimit());
  }
  function lineLabel(lane) {
    return DIFFICULTY[state.difficulty].lines[Math.min(Math.max(1, lane), laneLimit()) - 1];
  }

  // ---------------------------------------------------------------- State
  const state = {
    phase: 'idle',            // idle | playing | crashed | cashed | finished
    balance: integrated ? 0 : (Number.isFinite(saved.balance) && saved.balance >= 0 ? saved.balance : START_BALANCE),
    bet: clamp(Number(saved.bet) || 3, MIN_BET, MAX_BET),
    difficulty: DIFFICULTY[saved.difficulty] ? saved.difficulty : 'medium',
    sound: saved.sound !== false,
    music: saved.music !== false,
    pos: 0,
    maxLanes: DIFFICULTY[saved.difficulty] ? DIFFICULTY[saved.difficulty].lanes : 9,
    serverLadder: [],
    serverRoundId: null,
    remoteAction: null,
    pendingActionId: null,
    pendingStartActionId: null,
    remoteBusy: false,
    remoteReady: !integrated,
    remoteError: null,
    lane: 0,
    mult: 1,
    hop: null,
    lanes: [],
    viewW: 1,
    viewH: 1,
    dpr: 1,
    cameraX: 0,
    cameraTarget: 0,
    time: 0,
    resultTimer: 0,
    resultShown: false,
    lastOutcome: null,
    shake: 0,
    particles: [],
    blinkTimer: 2.5,
    blink: 0,
    idleHintTimer: 0,
    lastFrame: 0,
    started: false,
  };
  if (!integrated) state.bet = Math.min(state.bet, state.balance > 0 ? Math.max(MIN_BET, state.balance) : MIN_BET);

  // ---------------------------------------------------------------- Layout
  function posX(pos) {
    if (pos <= 0) return SIDE_L * 0.5;
    if (pos >= finishPosition()) return SIDE_L + roadWidth() + SIDE_R * 0.5;
    return SIDE_L + (pos - 0.5) * LANE_W;
  }
  function worldWidth() {
    return SIDE_L + roadWidth() + SIDE_R;
  }
  function roadCenterY() {
    return state.viewH * 0.53;
  }

  // ---------------------------------------------------------------- Toast
  let toastTimer = null;
  function toast(msg, kind = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = msg;
    toastWrap.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(6px)';
      el.style.transition = 'opacity .2s ease, transform .2s ease';
      setTimeout(() => el.remove(), 220);
    }, 2300);
    while (toastWrap.children.length > 3) toastWrap.firstChild.remove();
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {}, 2300);
  }

  // ---------------------------------------------------------------- Sound
  function syncSoundUI() {
    soundOnIcon.classList.toggle('hidden', !state.sound);
    soundOffIcon.classList.toggle('hidden', state.sound);
    soundBtn.setAttribute('aria-label', state.sound ? 'Mute sound' : 'Enable sound');
    menuSoundState.textContent = state.sound ? 'On' : 'Off';
    menuMusicState.textContent = state.music ? 'On' : 'Off';
    menuSoundState.classList.toggle('off', !state.sound);
    menuMusicState.classList.toggle('off', !state.music);
  }
  function applySoundSettings() {
    if (!window.Sound) return;
    Sound.setEnabled(state.sound);
    Sound.setMusic(state.music && state.sound);
    if (state.sound && state.music && state.started) Sound.startMusic('road');
    syncSoundUI();
  }
  function startAudio() {
    if (!window.Sound) return;
    state.started = true;
    Sound.init();
    if (state.sound && state.music) Sound.startMusic('road');
  }
  function play(name) {
    if (window.Sound && Sound[name]) Sound[name]();
  }

  async function fetanApi(path, payload) {
    let response;
    try {
      response = await fetch(`/api/games/chicken-road-dash/${realWalletMode ? 'real' : 'demo'}${path}`, {
        method: payload === undefined ? 'GET' : 'POST',
        credentials: 'same-origin',
        headers: payload === undefined ? {} : { 'Content-Type': 'application/json' },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
    } catch {
      const error = new Error('NETWORK');
      error.code = 'NETWORK';
      throw error;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || (response.status === 404 ? 'ENDPOINT_NOT_FOUND' : 'GENERIC'));
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function nextActionId() {
    return crypto.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function useServerRound(data) {
    state.balance = Number(data.balance_santim ?? data.balance ?? 0) / 100;
    const round = data.round || (data.id ? data : null);
    if (!round) {
      state.serverRoundId = null;
      state.phase = 'idle';
      state.pos = state.lane = 0;
      state.mult = 1;
      state.serverLadder = [];
    } else {
      state.serverRoundId = round.id;
      state.serverLadder = Array.isArray(round.ladder) ? round.ladder : [];
      state.difficulty = DIFFICULTY[round.difficulty] ? round.difficulty : 'medium';
      difficultyEl.value = state.difficulty;
      state.bet = Number(round.bet_santim) / 100;
      const limits = DIFFICULTY[state.difficulty];
      state.pos = round.status === 'finished' ? limits.lanes + 1 : Math.min(limits.lanes, Number(round.step || 0));
      state.lane = Math.min(limits.lanes, state.pos);
      const serverMultiplier = Number(round.multiplier);
      state.mult = Number.isFinite(serverMultiplier)
        ? serverMultiplier
        : (state.pos ? state.serverLadder[Math.min(state.pos, limits.lanes) - 1] : 1);
      state.phase = round.status === 'active' ? 'playing' : round.status === 'crashed' ? 'crashed' : round.status === 'finished' ? 'finished' : round.status === 'cashed_out' ? 'cashed' : 'idle';
      if (round.status !== 'active') {
        state.lastOutcome = { type: round.status === 'finished' ? 'finish' : round.status === 'cashed_out' ? 'cash' : 'crash', payout: Number(round.payout_santim || 0) / 100 };
        state.resultTimer = 0;
        state.resultShown = false;
      }
    }
    state.remoteReady = true;
    state.remoteError = null;
    state.remoteBusy = false;
    state.remoteAction = null;
    state.pendingActionId = null;
    state.hop = null;
    resetTraffic();
    if (integrationBlocker) integrationBlocker.hidden = true;
    if (menuReset) menuReset.disabled = true;
    updateHUD();
  }

  function apiErrorMessage(error) {
    const code = error?.code || error?.message;
    return ({
      NETWORK: 'Cannot reach the Fetan Bet server. Check that it is running, then reload.',
      LOGIN: 'Your customer session is missing or expired. Sign in to Fetan Bet, then reopen the game.',
      ENDPOINT_NOT_FOUND: 'The Chicken Road Dash API is unavailable. Restart the server and reload.',
      SCHEMA_NOT_READY: 'Chicken Road Dash tables are missing. The required migration must be applied.',
      SERVICE_UNAVAILABLE: 'The server cannot reach its database. The wallet was not changed.',
      GENERIC: 'The server could not complete that request. Check server logs; your wallet was not changed.',
      INSUFFICIENT: 'Your Fetan Bet wallet does not have enough balance.',
      ACTIVE_ROUND: 'An active Chicken Road round already exists; it has been restored.',
      STALE_ACTION: 'The round changed in another window. Its latest server state has been restored.',
      PAYOUT_LIMIT: 'This payout exceeds the safe settlement limit. Cash out the current round.',
    })[code] || (error?.name === 'TypeError'
      ? 'Cannot reach the Fetan Bet server. Check that it is running, then reload.'
      : `The game API request failed${error?.status ? ` (HTTP ${error.status})` : ''}. Your wallet was not changed.`);
  }

  function showGameServiceError(error) {
    state.remoteReady = false;
    state.remoteBusy = false;
    state.remoteError = apiErrorMessage(error);
    if (integrationBlocker) integrationBlocker.hidden = false;
    const heading = integrationBlocker?.querySelector('strong');
    if (heading) heading.textContent = 'WALLET UNAVAILABLE';
    if (integrationWalletStatus) integrationWalletStatus.textContent = state.remoteError;
    if (menuReset) menuReset.disabled = true;
    updateHUD();
  }

  // ---------------------------------------------------------------- UI
  function setBetControls(enabled) {
    enabled = enabled && (!integrated || (state.remoteReady && !state.remoteBusy));
    difficultyEl.disabled = !enabled;
    minBtn.disabled = !enabled;
    maxBtn.disabled = !enabled;
    [...chipsEl.querySelectorAll('.chip')].forEach((chip) => {
      chip.disabled = !enabled;
      chip.classList.toggle('active', Number(chip.dataset.bet) === state.bet);
    });
  }

  let ladderSignature = '';
  function ladderValues() {
    const configured = DIFFICULTY[state.difficulty].multipliers;
    if (integrated && state.serverLadder.length === configured.length) {
      return state.serverLadder.map((value) => Number(value));
    }
    return configured;
  }
  function renderLadder() {
    if (!multLadderTrack) return;
    const mode = DIFFICULTY[state.difficulty];
    const values = ladderValues();
    const currentIndex = state.pos > 0 ? Math.min(state.pos, values.length) - 1 : -1;
    const nextIndex = state.phase === 'playing' || state.phase === 'idle'
      ? Math.min(state.pos, values.length - 1)
      : -1;
    const signature = `${state.difficulty}|${values.join(',')}|${state.pos}|${state.phase}|${state.serverLadder.length}`;
    if (signature === ladderSignature) return;
    ladderSignature = signature;
    multLadderTrack.innerHTML = values.map((value, index) => {
      const classes = ['mult-ladder-item'];
      if (index < currentIndex) classes.push('passed');
      if (index === currentIndex) classes.push('current');
      else if (index === nextIndex) classes.push('next');
      return `<div class="${classes.join(' ')}"${index === currentIndex ? ' aria-current="step"' : ''}>` +
        `<span class="ladder-line">L${mode.lines[index] ?? index + 1}</span><b>${fmtMult(value)}</b></div>`;
    }).join('');
    multLadderTrack.querySelector('.current, .next')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  function updateHUD() {
    balanceEl.textContent = integrated
      ? (state.remoteReady ? fmtMoney(state.balance) : state.remoteError ? 'Unavailable · ETB' : 'Loading ETB…')
      : `${fmtInt(state.balance)} ETB`;
    betAmountEl.textContent = fmtInt(state.bet);
    const active = state.phase === 'playing';
    const settling = state.phase === 'crashed' || state.phase === 'cashed' || state.phase === 'finished';
    const shownMult = active || settling ? state.mult : multForLane(1);
    multiplierEl.textContent = fmtMult(shownMult);
    multBadge.classList.toggle('hot', shownMult >= 2);
    multBadge.classList.toggle('crash', state.phase === 'crashed');

    let nextText;
    if (settling) {
      nextText = '—';
    } else if (state.pos >= laneLimit()) {
      nextText = fmtMult(multForLane(laneLimit()));
    } else {
      nextText = fmtMult(multForLane(Math.min(laneCount() + 1, laneLimit())));
    }
    nextMultEl.textContent = nextText;
    nextMultEl.parentElement.classList.toggle('muted', settling);
    const previewMultiplier = state.mult;
    if (integrated && active) {
      cashValueEl.textContent = fmtMoney(grossPreviewBirr(state.bet, previewMultiplier));
    } else cashValueEl.textContent = fmtMoney(grossPreviewBirr(state.bet, previewMultiplier));
    playBtn.classList.toggle('hidden', active || settling);
    playActions.classList.toggle('hidden', !active);
    if (active) {
      const last = state.pos === laneLimit();
      goBtn.innerHTML = last ? 'FINISH <span>→</span>' : 'GO <span>→</span>';
      goBtn.disabled = !!state.hop || state.remoteBusy;
      cashBtn.disabled = !!state.hop || state.remoteBusy;
      goBtn.title = last ? 'Reach the far sidewalk and bank the final multiplier' : 'Hop forward';
    }
    setBetControls(state.phase === 'idle');
    playBtn.disabled = integrated && (!state.remoteReady || state.remoteBusy);
    if (integrated && !state.remoteReady) {
      playBtn.querySelector('span')?.replaceChildren(document.createTextNode('Unavailable'));
    }

    if (state.phase === 'idle') {
      stageHint.textContent = integrated ? 'Play with your Fetan Bet wallet' : 'Press Play, then hop across the road';
      stageHint.classList.remove('fade');
    } else if (active) {
      if (state.hop) stageHint.textContent = 'Jumping…';
      else if (state.pos === 0) stageHint.textContent = 'Tap GO when the first level is clear';
      else if (state.pos === laneLimit()) stageHint.textContent = `Last level! Hit FINISH to bank ${fmtMult(multForLane(laneLimit()))}`;
      else stageHint.textContent = 'Watch traffic — hop or cash out';
      stageHint.classList.remove('fade');
    }
    renderLadder();
  }

  function showResult(kind, title, amount, sub, kicker) {
    state.resultShown = true;
    resultCard.classList.remove('good', 'bad', 'gold');
    if (kind) resultCard.classList.add(kind);
    resultKicker.textContent = kicker || 'ROUND OVER';
    resultTitle.textContent = title;
    resultAmount.textContent = amount;
    resultSub.textContent = sub;
    resultBtn.textContent = 'Play again';
    if (verifyRoundBtn) {
      verifyRoundBtn.classList.toggle('hidden', !integrated || !state.serverRoundId);
      verifyRoundBtn.disabled = false;
      verifyRoundBtn.textContent = 'Verify committed round';
    }
    resultOverlay.classList.add('show');
    updateHUD();
  }

  function hideResult() {
    state.resultShown = false;
    resultOverlay.classList.remove('show');
  }

  // ---------------------------------------------------------------- Betting
  function setBet(value) {
    state.bet = clamp(Math.round(value), MIN_BET, MAX_BET);
    state.bet = Math.min(state.bet, Math.max(MIN_BET, Math.floor(state.balance)));
    saveStore();
    updateHUD();
  }

  function resetTraffic() {
    const cfg = DIFFICULTY[state.difficulty];
    const h = Math.max(320, state.viewH);
    const period = h + 360;
    state.lanes = [];
    for (let i = 0; i < laneLimit(); i++) {
      const dir = i % 2 === 0 ? 1 : -1;
      const speed = cfg.speed * rand(0.78, 1.2) * (1 + i * 0.018);
      let count = Math.random() < cfg.density ? 2 : 1;
      if (h > 620 && Math.random() < 0.45) count++;
      if (h > 800 && Math.random() < 0.3) count++;
      const cars = [];
      const carLen = rand(104, 142);
      const firstY = rand(-80, period - 80);
      for (let c = 0; c < count; c++) {
        const len = c === 0 ? carLen : rand(100, 146);
        cars.push({
          y: firstY + c * period / count + rand(-30, 30),
          len,
          color: pick(cfg.colors),
          kind: Math.random() < 0.2 ? 'truck' : 'car',
          wobble: rand(0, Math.PI * 2),
        });
      }
      state.lanes.push({ dir, speed, cars });
    }
  }

  // ---------------------------------------------------------------- Round flow
  function startRound() {
    startAudio();
    if (integrated) {
      if (!state.remoteReady || state.remoteBusy) return;
      state.remoteBusy = true;
      updateHUD();
      state.pendingStartActionId ||= nextActionId();
      fetanApi('/start', { bet_santim: Math.round(state.bet * 100), difficulty: state.difficulty, action_id: state.pendingStartActionId }).then((round) => {
        state.pendingStartActionId = null;
        const resumed = Number(round.step || 0) > 0;
        useServerRound(round);
        if (!resumed) {
          state.phase = 'playing';
          state.pos = state.lane = 0;
          state.mult = 1;
          state.particles = [];
          state.shake = 0;
          state.resultTimer = 0;
          state.lastOutcome = null;
          state.cameraX = state.cameraTarget = 0;
        }
        hideResult();
        saveStore();
        updateHUD();
        stageHint.textContent = resumed
          ? 'Active round restored from the server.'
          : 'Server-committed outcomes; traffic is visual only.';
        play('click');
      }).catch(async (error) => {
        try { useServerRound(await fetanApi('')); } catch { showGameServiceError(error); }
        toast(apiErrorMessage(error), 'bad');
        updateHUD();
      });
      return;
    }
    if (state.balance < MIN_BET) {
      state.balance = START_BALANCE;
      toast('Practice balance topped up to 1 000 000 ETB', 'good');
    }
    if (state.bet > state.balance) {
      toast('Not enough demo balance for that bet', 'bad');
      return;
    }
    hideResult();
    state.phase = 'playing';
    state.balance = round2(state.balance - state.bet);
    state.pos = 0;
    state.lane = 0;
    state.mult = 1;
    state.hop = null;
    state.particles = [];
    state.shake = 0;
    state.resultTimer = 0;
    state.lastOutcome = null;
    state.cameraX = 0;
    state.cameraTarget = 0;
    resetTraffic();
    saveStore();
    updateHUD();
    play('click');
    stageHint.textContent = 'GO! Watch the first lane';
    stageHint.classList.remove('fade');
  }

  function hop() {
    if (state.phase !== 'playing' || state.hop) return;
    if (integrated) {
      if (state.remoteBusy || !state.serverRoundId) return;
      state.remoteBusy = true;
      state.pendingActionId ||= nextActionId();
      const actionId = state.pendingActionId;
      updateHUD();
      fetanApi('/cross', { round_id: state.serverRoundId, action_id: actionId }).then((result) => {
        state.remoteAction = result;
        state.pendingActionId = null;
        state.remoteBusy = false;
        const hopTarget = result.finished ? finishPosition() : result.lane;
        state.hop = { from: state.pos, to: hopTarget, x0: posX(state.pos), x1: posX(hopTarget), t: 0,
          dur: DIFFICULTY[state.difficulty]?.hopTime || 0.3 };
        play('hop');
        addDust(posX(state.pos), roadCenterY() + 24);
        updateHUD();
      }).catch(async (error) => {
        state.remoteBusy = false;
        if (error.message === 'STALE_ACTION') {
          state.pendingActionId = null;
          try { useServerRound(await fetanApi('')); } catch { /* preserve the last confirmed state */ }
        }
        toast(apiErrorMessage(error), 'bad');
        updateHUD();
      });
      return;
    }
    if (state.pos >= finishPosition()) return;
    const fromPos = state.pos;
    const toPos = state.pos + 1;
    state.hop = {
      from: fromPos,
      to: toPos,
      x0: posX(fromPos),
      x1: posX(toPos),
      t: 0,
      dur: DIFFICULTY[state.difficulty].hopTime,
    };
    play('hop');
    addDust(posX(fromPos), roadCenterY() + 24);
    updateHUD();
  }

  function landHop() {
    const to = state.hop.to;
    state.hop = null;
    state.pos = to;
    if (integrated) {
      const result = state.remoteAction;
      state.remoteAction = null;
      if (!result) {
        toast('The committed server result is missing. Reloading the round.', 'bad');
        fetanApi('').then(useServerRound).catch(showGameServiceError);
        return;
      }
      state.balance = Number(result.balance_santim ?? state.balance * 100) / 100;
      state.pos = Number(result.step ?? to);
      state.lane = Math.min(laneLimit(), state.pos);
      state.mult = Number(result.multiplier || 0);
      if (result.crashed) {
        state.lastOutcome = { type: 'crash', payout: 0 };
        crash(null);
        return;
      }
      play('coin');
      if (result.finished) {
        finishRound(result);
        return;
      }
      multBadge.classList.remove('pulse');
      void multBadge.offsetWidth;
      multBadge.classList.add('pulse');
      updateHUD();
      stageHint.textContent = `Safe on level ${result.line ?? lineLabel(state.pos)} · traffic is visual only; accept next crossing or cash out.`;
      return;
    }
    if (to <= laneLimit()) {
      state.lane = to;
      state.mult = multForLane(to);
      multBadge.classList.remove('pulse');
      void multBadge.offsetWidth;
      multBadge.classList.add('pulse');
      play('coin');
      if (to < laneLimit()) stageHint.textContent = to === laneLimit() - 1 ? 'Last level! One more to the finish' : 'Keep going — or cash out';
    }
    if (to >= finishPosition()) {
      finishRound();
      return;
    }
    updateHUD();
  }

  function cashOut() {
    if (state.phase !== 'playing' || state.hop) return;
    if (integrated) {
      if (state.remoteBusy || state.pos < 1 || !state.serverRoundId) return;
      state.remoteBusy = true;
      state.pendingActionId ||= nextActionId();
      const actionId = state.pendingActionId;
      updateHUD();
      fetanApi('/cashout', { round_id: state.serverRoundId, action_id: actionId }).then((result) => {
        state.pendingActionId = null;
        state.remoteBusy = false;
        state.balance = Number(result.balance_santim) / 100;
        state.phase = 'cashed';
        state.lastOutcome = { type: 'cash', payout: Number(result.payout_santim) / 100 };
        state.resultTimer = 0.8;
        state.cameraTarget = state.cameraX;
        saveStore();
        play('cash');
        addConfetti(posX(state.pos), roadCenterY(), 48, false);
        updateHUD();
        stageHint.textContent = 'Banked it!';
      }).catch(async (error) => {
        state.remoteBusy = false;
        if (error.message === 'STALE_ACTION') {
          state.pendingActionId = null;
          try { useServerRound(await fetanApi('')); } catch { /* preserve confirmed state */ }
        }
        toast(apiErrorMessage(error), 'bad');
        updateHUD();
      });
      return;
    }
    const payout = round2(state.bet * state.mult);
    state.phase = 'cashed';
    state.balance = round2(state.balance + payout);
    state.lastOutcome = { type: 'cash', payout };
    state.resultTimer = 0.8;
    state.cameraTarget = state.cameraX;
    saveStore();
    play('cash');
    addConfetti(posX(state.pos), roadCenterY(), 48, false);
    updateHUD();
    stageHint.textContent = 'Banked it!';
  }

  function finishRound(serverResult = null) {
    const payout = integrated ? Number(serverResult?.payout_santim || 0) / 100 : round2(state.bet * state.mult);
    state.phase = 'finished';
    state.balance = integrated ? Number(serverResult?.balance_santim ?? state.balance * 100) / 100 : round2(state.balance + payout);
    state.pos = finishPosition();
    state.lastOutcome = { type: 'finish', payout };
    state.resultTimer = 0.95;
    saveStore();
    play('win');
    addConfetti(posX(finishPosition()), roadCenterY(), 110, true);
    addConfetti(state.cameraX + state.viewW * 0.4, roadCenterY() - 60, 60, true);
    updateHUD();
    stageHint.textContent = 'Clean crossing!';
  }

  function crash(car) {
    if (state.phase !== 'playing') return;
    state.phase = 'crashed';
    state.hop = null;
    state.resultTimer = 1.05;
    state.shake = 0.55;
    state.lastOutcome = { type: 'crash', car };
    play('crash');
    addFeathers(posX(state.pos), roadCenterY(), 20);
    stage.classList.remove('shake');
    void stage.offsetWidth;
    stage.classList.add('shake');
    setTimeout(() => stage.classList.remove('shake'), 500);
    updateHUD();
    stageHint.textContent = 'Busted!';
  }

  function scheduleResult() {
    if (state.resultShown) return;
    const out = state.lastOutcome;
    if (!out) return;
    if (out.type === 'cash') {
      showResult('gold', 'CASHED OUT!', fmtMoney(out.payout),
        `Bet ${fmtMoney(state.bet)} · ${fmtMult(state.mult)} multiplier`, 'SAFE LANDING');
    } else if (out.type === 'finish') {
      const levels = state.serverLadder.length || laneLimit();
      showResult('good', 'ROAD CLEARED!', fmtMoney(out.payout),
        `${levels} levels crossed · ${fmtMult(state.mult)} final multiplier`, 'CLEAN CROSSING');
    } else {
      showResult('bad', 'CRASHED!', fmtMoney(0),
        integrated ? 'The server-committed crossing crashed. Traffic is visual only.' : 'A car got you. Try a safer crossing.', 'ROUND OVER');
    }
  }

  // ---------------------------------------------------------------- Canvas helpers
  function rr(x, y, w, h, r) {
    const rad = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  function lighten(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const r = clamp((n >> 16) + amt, 0, 255);
    const g = clamp(((n >> 8) & 255) + amt, 0, 255);
    const b = clamp((n & 255) + amt, 0, 255);
    return `rgb(${r},${g},${b})`;
  }
  function darken(hex, amt) {
    return lighten(hex, -amt);
  }

  // ---------------------------------------------------------------- Particles
  function addDust(x, y) {
    for (let i = 0; i < 5; i++) {
      state.particles.push({
        type: 'dust',
        x: x + rand(-12, 12),
        y: y + rand(-4, 4),
        vx: rand(-30, 30),
        vy: rand(-40, -8),
        life: rand(0.32, 0.55),
        max: 0.55,
        size: rand(3, 7),
        color: 'rgba(220,210,190,0.55)',
      });
    }
  }

  function addFeathers(x, y, count) {
    for (let i = 0; i < count; i++) {
      state.particles.push({
        type: 'feather',
        x: x + rand(-14, 14),
        y: y + rand(-22, 16),
        vx: rand(-130, 130),
        vy: rand(-190, -40),
        life: rand(0.7, 1.35),
        max: 1.35,
        size: rand(4, 8),
        rot: rand(0, Math.PI * 2),
        spin: rand(-7, 7),
        color: Math.random() < 0.35 ? '#ffd24a' : '#fff8e8',
      });
    }
    for (let i = 0; i < 8; i++) {
      state.particles.push({
        type: 'star',
        x: x + rand(-24, 24),
        y: y + rand(-30, 10),
        vx: rand(-90, 90),
        vy: rand(-140, -30),
        life: rand(0.35, 0.7),
        max: 0.7,
        size: rand(2, 4),
        color: '#ffd24a',
      });
    }
  }

  function addConfetti(x, y, count, coins) {
    const palette = ['#ffd24a', '#ff6b78', '#4fe0a2', '#73a7ff', '#ffffff', '#ff9f4a'];
    for (let i = 0; i < count; i++) {
      state.particles.push({
        type: coins && Math.random() < 0.3 ? 'coin' : 'confetti',
        x: x + rand(-20, 20),
        y: y + rand(-20, 20),
        vx: rand(-230, 230),
        vy: rand(-380, -110),
        life: rand(0.9, 1.7),
        max: 1.7,
        size: rand(3, 7),
        rot: rand(0, Math.PI * 2),
        spin: rand(-9, 9),
        color: pick(palette),
      });
    }
  }

  function updateParticles(dt) {
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        state.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.type === 'feather' || p.type === 'confetti' || p.type === 'coin') {
        p.vy += 340 * dt;
        p.vx *= 0.99;
        p.rot += p.spin * dt;
      } else if (p.type === 'dust') {
        p.vy += 12 * dt;
        p.vx *= 0.96;
        p.size += 4 * dt;
      } else {
        p.vy += 260 * dt;
      }
    }
  }

  function drawParticles() {
    for (const p of state.particles) {
      const a = clamp(p.life / (p.max * 0.65), 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      if (p.type === 'dust') {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === 'star') {
        ctx.fillStyle = p.color;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot || 0);
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const ang = (Math.PI / 4) * i;
          const rad = i % 2 === 0 ? p.size * 2.2 : p.size * 0.75;
          ctx.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
        }
        ctx.closePath();
        ctx.fill();
      } else if (p.type === 'coin') {
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(Math.cos(p.rot * 1.6), 1);
        ctx.fillStyle = '#ffcf3a';
        ctx.beginPath();
        ctx.arc(0, 0, p.size + 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#b37a00';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.fillStyle = '#8c5c00';
        ctx.font = `800 ${p.size + 1}px Montserrat, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('B', 0, 0.5);
      } else {
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot || 0);
        ctx.fillStyle = p.color;
        if (p.type === 'feather') {
          ctx.beginPath();
          ctx.ellipse(0, 0, p.size * 0.48, p.size * 1.25, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(70,60,45,0.25)';
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(0, -p.size);
          ctx.lineTo(0, p.size);
          ctx.stroke();
        } else {
          ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
        }
      }
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------- Background art
  function drawSidewalk(x, w, h, finish) {
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    if (finish) {
      g.addColorStop(0, '#2b2b3d');
      g.addColorStop(0.55, '#343344');
      g.addColorStop(1, '#242433');
    } else {
      g.addColorStop(0, '#202436');
      g.addColorStop(0.6, '#292e44');
      g.addColorStop(1, '#24283d');
    }
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, w, h);

    // Pavement tiles
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, 0, w, h);
    ctx.clip();
    ctx.strokeStyle = 'rgba(160,175,215,0.09)';
    ctx.lineWidth = 1;
    const tile = 42;
    for (let yy = 0; yy < h + tile; yy += tile) {
      ctx.beginPath();
      ctx.moveTo(x, yy);
      ctx.lineTo(x + w, yy);
      ctx.stroke();
    }
    for (let xx = x; xx < x + w; xx += tile) {
      ctx.beginPath();
      ctx.moveTo(xx, 0);
      ctx.lineTo(xx, h);
      ctx.stroke();
    }
    // speckles
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    for (let i = 0; i < 34; i++) {
      const sx = x + ((i * 73) % Math.max(1, w));
      const sy = (i * 137 + 30) % h;
      ctx.fillRect(sx, sy, 2, 2);
    }
    ctx.restore();

    // Edge curb
    const edgeX = finish ? x : x + w - 12;
    ctx.fillStyle = '#3d425c';
    ctx.fillRect(edgeX, 0, 12, h);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(edgeX + (finish ? 0 : 9), 0, 2, h);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(edgeX + (finish ? 10 : 0), 0, 2, h);
  }

  function drawGraffiti(x, y, scale) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.globalAlpha = 0.55;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const strokes = [
      ['#ff6b78', [[0, 18], [12, 0], [25, 17], [38, 2], [50, 16]], 8],
      ['#ffd24a', [[4, 31], [16, 17], [30, 33], [44, 19], [56, 32]], 5],
      ['#69c9ff', [[0, 45], [18, 28], [26, 44], [42, 30], [55, 45]], 4],
    ];
    for (const [color, pts, lw] of strokes) {
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.beginPath();
      pts.forEach(([px, py], i) => i ? ctx.lineTo(px, py) : ctx.moveTo(px, py));
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawChevron(x, y, dir, alpha) {
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#f2f5ff';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (dir > 0) {
      ctx.moveTo(-13, -7);
      ctx.lineTo(0, 7);
      ctx.lineTo(13, -7);
    } else {
      ctx.moveTo(-13, 7);
      ctx.lineTo(0, -7);
      ctx.lineTo(13, 7);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawWorld(h) {
    // Deep backdrop
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#141827');
    bg.addColorStop(0.5, '#1b2032');
    bg.addColorStop(1, '#111421');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, worldWidth(), h);

    // Sidewalks
    drawSidewalk(0, SIDE_L, h, false);
    drawSidewalk(SIDE_L + roadWidth(), SIDE_R, h, true);

    // Start decoration
    drawGraffiti(42, h * 0.14, 1.25);
    drawGraffiti(34, h * 0.72, 0.9);
    ctx.save();
    ctx.translate(SIDE_L * 0.52, 58);
    ctx.rotate(-Math.PI / 2);
    ctx.font = '900 13px Montserrat, sans-serif';
    ctx.letterSpacing = '3px';
    ctx.fillStyle = 'rgba(230,236,255,0.28)';
    ctx.textAlign = 'center';
    ctx.fillText('CHICKEN ROAD DASH', 0, 0);
    ctx.restore();

    // Finish decoration
    ctx.save();
    ctx.translate(SIDE_L + roadWidth() + SIDE_R * 0.52, 62);
    ctx.rotate(-Math.PI / 2);
    ctx.font = '900 15px Montserrat, sans-serif';
    ctx.letterSpacing = '3px';
    ctx.fillStyle = 'rgba(255,210,74,0.7)';
    ctx.textAlign = 'center';
    ctx.fillText('FINISH', 0, 0);
    ctx.restore();
    drawGraffiti(SIDE_L + roadWidth() + 26, h * 0.72, 1.15);

    // Road base
    const roadG = ctx.createLinearGradient(SIDE_L, 0, SIDE_L + roadWidth(), 0);
    roadG.addColorStop(0, '#252a3d');
    roadG.addColorStop(0.5, '#2b3045');
    roadG.addColorStop(1, '#232738');
    ctx.fillStyle = roadG;
    ctx.fillRect(SIDE_L, 0, roadWidth(), h);

    // Lanes
    for (let i = 0; i < laneLimit(); i++) {
      const lx = SIDE_L + i * LANE_W;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.018)' : 'rgba(0,0,0,0.045)';
      ctx.fillRect(lx, 0, LANE_W, h);
      // Asphalt grain
      ctx.fillStyle = 'rgba(255,255,255,0.025)';
      for (let k = 0; k < 8; k++) {
        const gx = lx + ((i * 47 + k * 29) % (LANE_W - 12)) + 5;
        const gy = (k * 113 + i * 67) % h;
        ctx.fillRect(gx, gy, 2, 7);
      }
      // Direction arrows
      const lane = state.lanes[i];
      if (lane) {
        drawChevron(lx + LANE_W / 2, h * 0.24, lane.dir, 0.09);
        drawChevron(lx + LANE_W / 2, h * 0.76, lane.dir, 0.09);
      }
    }

    // Lane dashes
    for (let i = 0; i <= laneLimit(); i++) {
      const lx = SIDE_L + i * LANE_W;
      const edge = i === 0 || i === laneLimit();
      ctx.save();
      ctx.strokeStyle = edge ? 'rgba(255,218,118,0.5)' : 'rgba(236,241,255,0.24)';
      ctx.lineWidth = edge ? 3.5 : 2.6;
      ctx.setLineDash(edge ? [22, 14] : [17, 24]);
      ctx.beginPath();
      ctx.moveTo(lx, 30);
      ctx.lineTo(lx, h - 30);
      ctx.stroke();
      ctx.restore();
    }

    // Start / finish lines
    drawCheckerBand(SIDE_L - 34, 30, 24, h - 60, false);
    drawCheckerBand(SIDE_L + roadWidth() + 10, 30, 24, h - 60, true);

    // Curbs / top and bottom walkways
    drawCurb(0, h, false);
    drawCurb(0, h, true);

    // Road edge glow
    const glow = ctx.createLinearGradient(SIDE_L - 8, 0, SIDE_L + 8, 0);
    glow.addColorStop(0, 'rgba(255,207,89,0.12)');
    glow.addColorStop(1, 'rgba(255,207,89,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(SIDE_L - 8, 0, 16, h);
  }

  function drawCheckerBand(x, y, w, h, start) {
    const cell = 12;
    ctx.save();
    ctx.globalAlpha = 0.7;
    for (let yy = y; yy < y + h; yy += cell) {
      for (let xx = 0; xx < w; xx += cell) {
        const row = Math.floor((yy - y) / cell);
        const col = Math.floor(xx / cell);
        const white = (row + col) % 2 === 0;
        ctx.fillStyle = white ? 'rgba(255,255,255,0.75)' : 'rgba(20,24,38,0.85)';
        ctx.fillRect(x + xx, yy, cell, Math.min(cell, y + h - yy));
      }
    }
    ctx.restore();
  }

  function drawCurb(x, h, bottom) {
    const y = bottom ? h - 26 : 0;
    const g = ctx.createLinearGradient(0, y, 0, y + 26);
    g.addColorStop(0, bottom ? '#1c2032' : '#333952');
    g.addColorStop(1, bottom ? '#333952' : '#1c2032');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, worldWidth(), 26);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(x, bottom ? y : y + 24, worldWidth(), 2);
    // railing posts
    for (let px = 0; px < worldWidth(); px += 76) {
      ctx.fillStyle = 'rgba(160,175,215,0.2)';
      ctx.fillRect(px + 18, bottom ? y - 8 : y + 8, 3, 18);
    }
    // top/bottom tiny lights
    ctx.fillStyle = 'rgba(255,210,90,0.16)';
    for (let px = 38; px < worldWidth(); px += 150) {
      ctx.beginPath();
      ctx.arc(px, bottom ? y + 13 : y + 13, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---------------------------------------------------------------- Vehicles
  function drawCar(car, lane, laneX) {
    const w = 58;
    const len = car.len;
    const dir = lane.dir;
    const base = car.color;
    ctx.save();
    ctx.translate(laneX, car.y);

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    rr(-w / 2 + 5, -len / 2 + 7, w, len, 15);
    ctx.fill();

    // Wheels
    ctx.fillStyle = '#14151d';
    const wheelW = 9;
    const wheelH = 20;
    for (const wy of [-len * 0.3, len * 0.22]) {
      rr(-w / 2 - 3, wy, wheelW, wheelH, 4); ctx.fill();
      rr(w / 2 - wheelW + 3, wy, wheelW, wheelH, 4); ctx.fill();
    }

    // Body
    const bodyG = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
    bodyG.addColorStop(0, darken(base, 40));
    bodyG.addColorStop(0.28, lighten(base, 18));
    bodyG.addColorStop(0.55, base);
    bodyG.addColorStop(1, darken(base, 48));
    ctx.fillStyle = bodyG;
    rr(-w / 2, -len / 2, w, len, 14);
    ctx.fill();

    // Body outline / rim
    ctx.strokeStyle = 'rgba(10,12,20,0.5)';
    ctx.lineWidth = 2;
    rr(-w / 2 + 1, -len / 2 + 1, w - 2, len - 2, 13);
    ctx.stroke();

    // Hood / cabin
    if (car.kind === 'truck') {
      ctx.fillStyle = 'rgba(245,246,252,0.22)';
      rr(-w / 2 + 6, -len / 2 + 8, w - 12, len * 0.52, 6);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.stroke();
      // cabin windshield near front
      const cy = dir > 0 ? len * 0.18 : -len * 0.42;
      ctx.fillStyle = 'rgba(18,25,42,0.9)';
      rr(-w / 2 + 9, cy, w - 18, len * 0.19, 5);
      ctx.fill();
    } else {
      const cabinY = dir > 0 ? -len * 0.28 : -len * 0.06;
      // Roof
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      rr(-w / 2 + 7, cabinY, w - 14, len * 0.36, 7);
      ctx.fill();
      // Windshield
      ctx.fillStyle = 'rgba(20,28,48,0.92)';
      const wsY = dir > 0 ? cabinY + len * 0.22 : cabinY + len * 0.02;
      rr(-w / 2 + 10, wsY, w - 20, len * 0.14, 4);
      ctx.fill();
      // Rear window
      ctx.fillStyle = 'rgba(20,28,48,0.75)';
      const rwY = dir > 0 ? cabinY + len * 0.02 : cabinY + len * 0.22;
      rr(-w / 2 + 11, rwY, w - 22, len * 0.1, 4);
      ctx.fill();
      // Racing stripe
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(-5, -len / 2 + 10, 10, len - 20);
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(-14, -len / 2 + 10, 4, len - 20);
    }

    // Headlights
    const frontY = dir > 0 ? len / 2 - 6 : -len / 2 + 6;
    const lightColor = dir > 0 ? '#fff3b0' : '#fff6cf';
    ctx.shadowColor = lightColor;
    ctx.shadowBlur = 10;
    ctx.fillStyle = lightColor;
    rr(-w / 2 + 7, frontY - 3, 12, 5, 2); ctx.fill();
    rr(w / 2 - 19, frontY - 3, 12, 5, 2); ctx.fill();
    ctx.shadowBlur = 0;
    // Tail lights
    const tailY = dir > 0 ? -len / 2 + 4 : len / 2 - 4;
    ctx.fillStyle = '#ff495e';
    rr(-w / 2 + 7, tailY - 2, 12, 4, 2); ctx.fill();
    rr(w / 2 - 19, tailY - 2, 12, 4, 2); ctx.fill();

    // Bumper glint
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    rr(-w / 2 + 6, dir > 0 ? len / 2 - 14 : -len / 2 + 9, w - 12, 4, 2);
    ctx.fill();

    ctx.restore();
  }

  function drawVehicles(h) {
    const left = state.cameraX - 80;
    const right = state.cameraX + state.viewW + 80;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 28, worldWidth(), h - 56);
    ctx.clip();
    for (let i = 0; i < laneLimit(); i++) {
      const lane = state.lanes[i];
      if (!lane) continue;
      const laneX = SIDE_L + (i + 0.5) * LANE_W;
      if (laneX < left || laneX > right) continue;
      for (const car of lane.cars) drawCar(car, lane, laneX);
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- Chicken art
  function chickenX() {
    if (!state.hop) return posX(state.pos);
    const p = clamp(state.hop.t / state.hop.dur, 0, 1);
    return lerp(state.hop.x0, state.hop.x1, easeInOut(p));
  }

  function drawChicken(h) {
    const baseY = roadCenterY();
    let x = chickenX();
    let y = baseY;
    let hopLift = 0;
    let tilt = 0;
    let squash = 1;
    let flying = false;

    if (state.hop) {
      const p = clamp(state.hop.t / state.hop.dur, 0, 1);
      hopLift = Math.sin(Math.PI * p) * 64;
      tilt = Math.cos(Math.PI * p) * 0.1;
      squash = 1 + Math.sin(Math.PI * p) * 0.06;
      flying = true;
    } else if (state.phase === 'idle') {
      y += Math.sin(state.time * 3.4) * 1.6;
    } else if (state.phase === 'cashed' || state.phase === 'finished') {
      y -= Math.abs(Math.sin(state.time * 8)) * 14;
    }

    // Shadow
    const shadowScale = clamp(1 - hopLift / 150, 0.55, 1);
    ctx.save();
    ctx.globalAlpha = 0.34;
    ctx.fillStyle = '#05070c';
    ctx.beginPath();
    ctx.ellipse(x, baseY + 35, 27 * shadowScale, 8 * shadowScale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(x, y - hopLift);
    ctx.rotate(tilt);
    if (state.phase === 'crashed') {
      ctx.translate(0, 16);
      ctx.rotate(-1.15);
      ctx.scale(1.15, 0.72);
    } else {
      ctx.scale(1.08, 1.08 * squash);
    }
    const flap = flying ? Math.sin(state.time * 26) * 0.5 : Math.sin(state.time * 4.5) * 0.12;
    const walk = flying ? 0 : Math.sin(state.time * 9) * 2;
    const blink = state.blink > 0 ? 0.12 : 1;

    // Legs
    ctx.strokeStyle = '#e79318';
    ctx.lineWidth = 3.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-6, 20);
    ctx.lineTo(-8 + walk, 34);
    ctx.moveTo(8, 20);
    ctx.lineTo(11 - walk, 34);
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-8 + walk, 34);
    ctx.lineTo(-16 + walk, 37);
    ctx.moveTo(-8 + walk, 34);
    ctx.lineTo(-2 + walk, 38);
    ctx.moveTo(11 - walk, 34);
    ctx.lineTo(4 - walk, 37);
    ctx.moveTo(11 - walk, 34);
    ctx.lineTo(19 - walk, 38);
    ctx.stroke();

    // Tail
    ctx.fillStyle = '#fff8ea';
    ctx.strokeStyle = '#2c2833';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(-25, -1, 12, 7, -0.55, 0, Math.PI * 2);
    ctx.ellipse(-27, -9, 11, 6, -0.9, 0, Math.PI * 2);
    ctx.ellipse(-24, 7, 10, 6, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Body
    const bodyG = ctx.createRadialGradient(-9, -8, 3, -2, 2, 33);
    bodyG.addColorStop(0, '#ffffff');
    bodyG.addColorStop(0.55, '#fff8e9');
    bodyG.addColorStop(1, '#e8dcc2');
    ctx.fillStyle = bodyG;
    ctx.beginPath();
    ctx.ellipse(-2, 2, 28, 25, -0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2c2833';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // Wing
    ctx.save();
    ctx.translate(-9, 3);
    ctx.rotate(flap);
    const wingG = ctx.createLinearGradient(-10, -10, 10, 12);
    wingG.addColorStop(0, '#fffdf5');
    wingG.addColorStop(1, '#e9ddc4');
    ctx.fillStyle = wingG;
    ctx.strokeStyle = '#b9a988';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(0, 0, 15, 11, -0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(150,135,105,0.55)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(-8, 3);
    ctx.quadraticCurveTo(0, 6, 8, 1);
    ctx.stroke();
    ctx.restore();

    // Head
    const headG = ctx.createRadialGradient(18, -29, 2, 19, -22, 24);
    headG.addColorStop(0, '#ffffff');
    headG.addColorStop(0.7, '#fff7e6');
    headG.addColorStop(1, '#eadfc8');
    ctx.fillStyle = headG;
    ctx.strokeStyle = '#2c2833';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(18, -23, 19, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Comb
    ctx.fillStyle = '#f0444f';
    ctx.strokeStyle = '#b72430';
    ctx.lineWidth = 1.3;
    for (const [cx, cy, r] of [[8, -40, 8], [16, -45, 9], [25, -41, 7]]) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Beak
    ctx.fillStyle = '#ffb21d';
    ctx.strokeStyle = '#c47a00';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(34, -26);
    ctx.lineTo(48, -19);
    ctx.lineTo(34, -14);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.moveTo(35, -24);
    ctx.lineTo(43, -20);
    ctx.lineTo(35, -20);
    ctx.closePath();
    ctx.fill();

    // Wattle
    ctx.fillStyle = '#ef4655';
    ctx.beginPath();
    ctx.ellipse(31, -8, 5, 8, 0.2, 0, Math.PI * 2);
    ctx.fill();

    // Eye
    ctx.save();
    ctx.translate(24, -28);
    ctx.scale(1, blink);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(0, 0, 5.2, 0, Math.PI * 2);
    ctx.fill();
    if (state.phase === 'crashed') {
      ctx.strokeStyle = '#2c2833';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-3.6, -3.6); ctx.lineTo(3.6, 3.6);
      ctx.moveTo(3.6, -3.6); ctx.lineTo(-3.6, 3.6);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#20222d';
      ctx.beginPath();
      ctx.arc(1.1, 0.5, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(2.2, -0.8, 1.05, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Cheek
    ctx.fillStyle = 'rgba(255,120,130,0.18)';
    ctx.beginPath();
    ctx.ellipse(15, -15, 7, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Crashing stars
    if (state.phase === 'crashed') {
      ctx.fillStyle = '#ffd24a';
      for (let i = 0; i < 4; i++) {
        const ang = state.time * 5 + i * Math.PI / 2;
        const sx = Math.cos(ang) * 34;
        const sy = -30 + Math.sin(ang) * 12;
        ctx.beginPath();
        ctx.arc(sx, sy, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  // ---------------------------------------------------------------- Render
  function drawFinishGate(h) {
    const gx = SIDE_L + roadWidth() + SIDE_R * 0.58;
    const top = Math.max(52, h * 0.16);
    const bottom = h - Math.max(54, h * 0.12);
    // Poles
    ctx.fillStyle = '#c9cfe0';
    ctx.fillRect(gx - 34, top, 5, bottom - top);
    ctx.fillRect(gx + 34, top, 5, bottom - top);
    ctx.fillStyle = '#ffd24a';
    ctx.beginPath();
    ctx.arc(gx - 31.5, top - 3, 5, 0, Math.PI * 2);
    ctx.arc(gx + 36.5, top - 3, 5, 0, Math.PI * 2);
    ctx.fill();
    // Checkered banner
    const cell = 9;
    ctx.save();
    ctx.globalAlpha = 0.9;
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 8; col++) {
        ctx.fillStyle = (row + col) % 2 === 0 ? '#f7f9ff' : '#222739';
        ctx.fillRect(gx - 36 + col * cell, top - 34 + row * cell, cell, cell);
      }
    }
    ctx.restore();
    // Glow flags
    ctx.fillStyle = 'rgba(255,210,74,0.14)';
    ctx.beginPath();
    ctx.arc(gx, (top + bottom) / 2, 55, 0, Math.PI * 2);
    ctx.fill();
  }

  function render() {
    const w = state.viewW;
    const h = state.viewH;
    if (w < 2 || h < 2) return;
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Outside-world backdrop
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#0f1220');
    bg.addColorStop(0.5, '#191d2f');
    bg.addColorStop(1, '#0c0e18');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const shakeX = state.shake > 0 ? rand(-4, 4) : 0;
    const shakeY = state.shake > 0 ? rand(-3, 3) : 0;

    ctx.save();
    ctx.translate(-state.cameraX + shakeX, shakeY);

    drawWorld(h);
    drawFinishGate(h);
    drawVehicles(h);
    drawChicken(h);
    drawParticles();

    ctx.restore();

    // Screen vignette
    const vg = ctx.createRadialGradient(w * 0.5, h * 0.5, h * 0.25, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
    vg.addColorStop(0, 'rgba(4,6,12,0)');
    vg.addColorStop(1, 'rgba(4,6,12,0.42)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);

    // Subtle top/bottom shade
    const topShade = ctx.createLinearGradient(0, 0, 0, 46);
    topShade.addColorStop(0, 'rgba(4,6,12,0.4)');
    topShade.addColorStop(1, 'rgba(4,6,12,0)');
    ctx.fillStyle = topShade;
    ctx.fillRect(0, 0, w, 46);
  }

  // ---------------------------------------------------------------- Simulation
  function updateTraffic(dt) {
    const h = state.viewH;
    const top = -220;
    const bottom = h + 220;
    const span = bottom - top;
    for (const lane of state.lanes) {
      for (const car of lane.cars) {
        car.y += lane.dir * lane.speed * dt;
        if (car.y > bottom) car.y -= span;
        if (car.y < top) car.y += span;
      }
    }
  }

  function checkCollision() {
    if (integrated) return; // Model C outcomes come only from the server; traffic is decorative.
    if (state.phase !== 'playing') return;
    const x = chickenX();
    const y = roadCenterY();
    for (let i = 0; i < state.lanes.length; i++) {
      const lane = state.lanes[i];
      const laneX = SIDE_L + (i + 0.5) * LANE_W;
      if (Math.abs(x - laneX) > 51) continue;
      for (const car of lane.cars) {
        if (Math.abs(y - car.y) < car.len / 2 + 17) {
          crash(car);
          return;
        }
      }
    }
  }

  function updateHop(dt) {
    if (!state.hop) return;
    state.hop.t += dt;
    if (state.hop.t >= state.hop.dur) {
      state.hop.t = state.hop.dur;
      landHop();
    }
  }

  function updateCamera(dt) {
    const max = Math.max(0, worldWidth() - state.viewW);
    const target = clamp(chickenX() - state.viewW * 0.33, 0, max);
    state.cameraTarget = target;
    state.cameraX += (target - state.cameraX) * Math.min(1, dt * 6.5);
    if (Math.abs(target - state.cameraX) < 0.1) state.cameraX = target;
  }

  function update(dt) {
    state.time += dt;
    state.shake = Math.max(0, state.shake - dt);
    updateTraffic(dt);
    updateHop(dt);
    checkCollision();
    updateParticles(dt);
    updateCamera(dt);

    // Blinking
    state.blinkTimer -= dt;
    if (state.blinkTimer <= 0) {
      state.blink = 0.12;
      state.blinkTimer = rand(2.4, 5.2);
    }
    state.blink = Math.max(0, state.blink - dt);

    // Delayed result card
    if (state.phase === 'crashed' || state.phase === 'cashed' || state.phase === 'finished') {
      state.resultTimer -= dt;
      if (state.resultTimer <= 0 && !state.resultShown) scheduleResult();
    }
  }

  let lastFrame = 0;
  function loop(ts) {
    if (!lastFrame) lastFrame = ts;
    const dt = Math.min(0.05, Math.max(0, (ts - lastFrame) / 1000));
    lastFrame = ts;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------- Modals
  function openModal(el) {
    if (!el) return;
    el.classList.add('open');
    play('click');
  }
  function closeModal(el) {
    if (!el) return;
    el.classList.remove('open');
  }
  function closeAllModals() {
    closeModal(howModal);
    closeModal(menuModal);
  }

  // ---------------------------------------------------------------- Events
  function bindEvents() {
    playBtn.addEventListener('click', () => {
      startAudio();
      startRound();
    });
    goBtn.addEventListener('click', hop);
    cashBtn.addEventListener('click', cashOut);
    resultBtn.addEventListener('click', () => {
      startAudio();
      hideResult();
      startRound();
    });
    verifyRoundBtn?.addEventListener('click', async () => {
      if (!state.serverRoundId) return;
      verifyRoundBtn.disabled = true;
      try {
        const proof = await fetanApi(`/verify/${encodeURIComponent(state.serverRoundId)}`);
        if (!proof.seed_commit_valid || !proof.outcomes_match_seed || !proof.probabilities_match_config || !proof.merkle_proofs_valid) throw new Error('INVALID_PROOF');
        toast(`Committed seed and all ${state.serverLadder.length || laneLimit()} level proofs verified.`, 'good');
        verifyRoundBtn.textContent = 'Round verified';
      } catch {
        toast('Could not verify this round proof.', 'bad');
        verifyRoundBtn.disabled = false;
      }
    });

    chipsEl.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip || chip.disabled) return;
      startAudio();
      play('click');
      setBet(Number(chip.dataset.bet));
    });
    minBtn.addEventListener('click', () => { play('click'); setBet(MIN_BET); });
    maxBtn.addEventListener('click', () => { play('click'); setBet(Math.min(MAX_BET, state.balance)); });

    difficultyEl.addEventListener('change', () => {
      if (state.phase !== 'idle') return;
      state.difficulty = DIFFICULTY[difficultyEl.value] ? difficultyEl.value : 'medium';
      resetTraffic();
      saveStore();
      updateHUD();
      play('click');
      toast(`Difficulty set to ${DIFFICULTY[state.difficulty].label}`, 'good');
    });

    soundBtn.addEventListener('click', () => {
      state.sound = !state.sound;
      applySoundSettings();
      saveStore();
      if (state.sound) play('click');
      toast(state.sound ? 'Sound on' : 'Sound muted');
    });

    menuBtn.addEventListener('click', () => {
      startAudio();
      updateMenuState();
      openModal(menuModal);
    });
    menuSound.addEventListener('click', () => {
      state.sound = !state.sound;
      applySoundSettings();
      saveStore();
      updateMenuState();
      if (state.sound) play('click');
    });
    menuMusic.addEventListener('click', () => {
      state.music = !state.music;
      applySoundSettings();
      saveStore();
      updateMenuState();
      play('click');
    });
    menuHow.addEventListener('click', () => {
      closeModal(menuModal);
      setTimeout(() => openModal(howModal), 120);
    });
    if (menuReset) menuReset.addEventListener('click', () => {
      if (integrated) return;
      if (state.phase !== 'idle') {
        toast('Finish the current round first', 'bad');
        return;
      }
      state.balance = START_BALANCE;
      state.bet = clamp(state.bet, MIN_BET, MAX_BET);
      hideResult(); saveStore(); updateHUD(); play('coin');
      toast('Demo balance reset to 1 000 000 ETB', 'good'); closeModal(menuModal);
    });

    document.querySelectorAll('[data-close]').forEach((btn) => {
      btn.addEventListener('click', () => {
        closeModal($(btn.dataset.close));
        play('click');
      });
    });
    [howModal, menuModal].forEach((modal) => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal(modal);
      });
    });

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (state.resultShown) return;
      if (state.phase === 'playing') {
        e.preventDefault();
        startAudio();
        hop();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        closeAllModals();
        return;
      }
      if (document.querySelector('.modal.open')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        startAudio();
        if (state.resultShown) {
          hideResult();
          startRound();
        } else if (state.phase === 'playing') {
          hop();
        } else if (state.phase === 'idle') {
          startRound();
        }
      } else if (e.code === 'KeyC') {
        if (state.phase === 'playing') {
          e.preventDefault();
          cashOut();
        }
      }
    });

    document.addEventListener('pointerdown', startAudio, { once: true });

    window.addEventListener('resize', resize);
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(resize);
      ro.observe(stage);
    }
  }

  function updateMenuState() {
    menuSoundState.textContent = state.sound ? 'On' : 'Off';
    menuMusicState.textContent = state.music ? 'On' : 'Off';
    menuSoundState.classList.toggle('off', !state.sound);
    menuMusicState.classList.toggle('off', !state.music);
  }

  // ---------------------------------------------------------------- Resize / init
  function resize() {
    const rect = stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    state.viewW = w;
    state.viewH = h;
    state.dpr = dpr;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const max = Math.max(0, worldWidth() - w);
    state.cameraX = clamp(state.cameraX, 0, max);
    if (!state.lanes.length) resetTraffic();
  }

  function updateLiveTicker() {
    const name = pick(TICKER_NAMES);
    const amount = rand(18, 420);
    tickerNameEl.textContent = name;
    tickerAmountEl.textContent = '+' + fmtMoney(amount);
    const base = 4200 + Math.floor(rand(0, 1800));
    onlineEl.textContent = fmtInt(base);
  }

  function init() {
    if (integrated) {
      const wallet = balanceEl.closest('.balance-pill');
      if (wallet) wallet.title = 'Fetan Bet wallet balance';
      const betCurrency = document.querySelector('.bet-currency');
      if (betCurrency) betCurrency.textContent = 'ETB';
      document.querySelector('.bet-input')?.setAttribute('aria-label', 'Bet amount in ETB');
      minBtn.setAttribute('aria-label', 'Minimum bet');
      maxBtn.setAttribute('aria-label', 'Maximum bet');
      chipsEl.setAttribute('aria-label', 'Quick bet amounts in Ethiopian Birr');
      state.remoteReady = false;
      integrationBlocker.hidden = true;
      if (modelCNote) modelCNote.hidden = false;
      stageHint.textContent = 'Fetan Bet wallet · server-committed outcomes';
      integrationWalletStatus.textContent = 'Your wallet balance and payouts are loaded from your Fetan Bet account.';
      if (menuReset) menuReset.disabled = true;
      setBetControls(true);
      const howTitle = $('howTitle');
      const howDescription = document.querySelector('#howModal .modal-card > p');
      const howRules = document.querySelector('#howModal .modal-card > ul');
      if (howTitle) howTitle.textContent = 'How to play';
      if (howDescription) howDescription.textContent = 'Play Chicken Road 2.0 with your Fetan Bet wallet. Outcomes are committed by the server before play; traffic is visual presentation only.';
      if (howRules) howRules.hidden = false;
    }
    syncSoundUI();
    if (saved.difficulty && DIFFICULTY[saved.difficulty]) difficultyEl.value = saved.difficulty;
    else difficultyEl.value = state.difficulty;
    if (integrated) {
      if (menuReset) menuReset.disabled = true;
      document.querySelectorAll('[data-fetan-back]').forEach((backLink) => {
        backLink.addEventListener('click', (event) => {
          event.preventDefault();
          parent.postMessage({ type: 'fetan-game-close' }, location.origin);
        });
      });
    }
    updateHUD();
    if (integrated) stageHint.textContent = 'Fetan Bet wallet · server-committed crossings';
    resize();
    resetTraffic();
    bindEvents();
    updateLiveTicker();
    if (!integrated) setInterval(updateLiveTicker, 5200);
    if (new URLSearchParams(location.search).has('debug')) {
      window.__chickenDebug = { state, hop, cashOut, startRound, resetTraffic };
    }
    requestAnimationFrame(() => {
      resize();
      requestAnimationFrame(() => loader.classList.add('done'));
    });
    setTimeout(() => loader.classList.add('done'), 700);
    requestAnimationFrame(loop);
    if (state.sound) {
      // Audio is unlocked by the first pointer/key interaction.
      state.started = false;
    }
    if (integrated) {
      fetanApi('').then((data) => {
        useServerRound(data);
        difficultyEl.value = state.difficulty;
        integrationWalletStatus.textContent = 'ETB wallet · committed outcomes · traffic is visual only';
        updateHUD();
      }).catch((error) => {
        showGameServiceError(error);
        toast(apiErrorMessage(error), 'bad');
      });
    }
  }

  init();
})();
