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
  const walletOpen = $('walletOpen');
  const depositOpen = $('depositOpen');
  const lowBalanceNote = $('lowBalanceNote');
  const walletSheet = $('walletSheet');
  const depositSheet = $('depositSheet');
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
  const integrationRetryBtn = $('integrationRetryBtn');
  const playBtnLabel = $('playBtnLabel');
  const modelCNote = $('modelCNote');
  const multLadderTrack = $('multLadderTrack');

  // ---------------------------------------------------------------- Constants
  const LANE_W = 112;
  let SIDE_L = 200;
  let SIDE_R = 190;
  const CHECKPOINT_INSET = 36;
  const integrated = new URLSearchParams(location.search).get('fetan') === '1';
  const sharedShell = new URLSearchParams(location.search).get('fetan-shell') === '1';
  const realWalletMode = true;
  const MIN_BET = 1;
  const MAX_BET = 500;
  const START_BALANCE = 1000000;
  const STORE_KEY = 'fetanbet.cr2.v1';
  let activeAccountSheet = null;
  let accountSheetOpener = null;
  let depositProviders = [];
  let selectedDepositProviderId = null;
  let depositReceiptData = null;
  let balanceAnimationFrame = 0;
  let displayedBalance = null;
  let wakeLock = null;
  let lastParentRoundState = null;

  function reportParentRoundState(active, canAct = active) {
    if (!sharedShell || window.parent === window || lastParentRoundState === Boolean(active)) return;
    const previousActive = Boolean(lastParentRoundState);
    lastParentRoundState = Boolean(active);
    window.parent.postMessage({ type: 'fetan-round-state', active: Boolean(active), canAct: Boolean(canAct), actionLabel: 'Cash out now', previousActive }, location.origin);
  }

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
    fences: [],               // server-confirmed checkpoints only
    pendingCheckpoint: null,  // local practice fence awaiting the collision check
    checkFx: null,
    blinkTimer: 2.5,
    blink: 0,
    idleHintTimer: 0,
    lastFrame: 0,
    started: false,
  };
  if (!integrated) state.bet = Math.min(state.bet, state.balance > 0 ? Math.max(MIN_BET, state.balance) : MIN_BET);

  // ---------------------------------------------------------------- Layout
  // The chicken stands just behind the confirmed checkpoint gate, not in the
  // middle of a live traffic column. `laneCenterX` keeps the original collision
  // geometry untouched for local practice rounds.
  function startX() {
    // Compact screens trim the unused pit apron so the first live lane stays
    // clear of the odds panel.
    return SIDE_L < 160 ? SIDE_L * 0.42 : SIDE_L * 0.5;
  }
  function laneCenterX(pos) {
    if (pos <= 0) return startX();
    if (pos >= finishPosition()) return SIDE_L + roadWidth() + SIDE_R * 0.5;
    return SIDE_L + (pos - 0.5) * LANE_W;
  }
  function checkpointX(pos) {
    return SIDE_L + clamp(pos, 0, laneLimit()) * LANE_W;
  }
  function posX(pos) {
    if (pos <= 0) return startX();
    if (pos >= finishPosition()) return SIDE_L + roadWidth() + SIDE_R * 0.5;
    return checkpointX(pos) - CHECKPOINT_INSET;
  }
  function worldWidth() {
    return SIDE_L + roadWidth() + SIDE_R;
  }
  function roadCenterY() {
    return state.viewH * 0.53;
  }

  // ------------------------------------------------------- Checkpoint fences
  function resetFences(confirmed = 0) {
    const top = clamp(Math.round(Number(confirmed) || 0), 0, laneLimit());
    state.fences = [];
    for (let pos = 1; pos <= top; pos++) state.fences.push({ pos, t: 1 });
    state.pendingCheckpoint = null;
    state.checkFx = null;
  }
  function confirmedCheckpoints() {
    let top = 0;
    for (const fence of state.fences) if (fence.pos > top) top = fence.pos;
    return Math.min(laneLimit(), top);
  }
  function collisionX() {
    if (!state.hop) return laneCenterX(state.pos);
    const p = clamp(state.hop.t / state.hop.dur, 0, 1);
    return lerp(laneCenterX(state.hop.from), laneCenterX(state.hop.to), easeInOut(p));
  }
  function confirmCheckpoint(pos) {
    const lane = clamp(Math.round(Number(pos) || 0), 0, laneLimit());
    if (lane < 1) return;
    // The caller only reaches this point after a confirmed safe crossing. An
    // existing fence is never re-animated, which prevents duplicate effects.
    if (state.fences.some((fence) => fence.pos === lane)) return;
    state.fences.push({ pos: lane, t: 0 });
    state.fences.sort((a, b) => a.pos - b.pos);
    state.checkFx = { pos: lane, t: 0 };
    addDust(checkpointX(lane) - 16, roadCenterY() + 26);
    addDust(checkpointX(lane) - 30, roadCenterY() + 10);
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
      resetFences(0);
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
      // Rebuild gates only from server-confirmed safe crossings. A crashed
      // round never gets a gate at the lane where it failed.
      const confirmed = round.status === 'active' || round.status === 'finished' || round.status === 'cashed_out'
        ? state.pos
        : round.status === 'crashed' ? Math.max(0, state.pos - 1) : 0;
      resetFences(confirmed);
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
    syncWakeLockState();
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
      WAGERING_DISABLED: 'New wagers are currently disabled. Any active Chicken Road round can still be finished or cashed out.',
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
    if (integrationRetryBtn) {
      integrationRetryBtn.hidden = false;
      integrationRetryBtn.disabled = false;
      integrationRetryBtn.textContent = 'Retry connection';
    }
    if (menuReset) menuReset.disabled = true;
    updateHUD();
  }

  function loadIntegratedSession() {
    if (!integrated || state.remoteBusy) return;
    state.remoteError = null;
    state.remoteBusy = true;
    if (integrationWalletStatus) integrationWalletStatus.textContent = 'Checking your authenticated Fetan Bet wallet…';
    if (integrationRetryBtn) {
      integrationRetryBtn.hidden = false;
      integrationRetryBtn.disabled = true;
      integrationRetryBtn.textContent = 'Checking…';
    }
    updateHUD();
    fetanApi('').then((data) => {
      useServerRound(data);
      difficultyEl.value = state.difficulty;
      if (integrationWalletStatus) integrationWalletStatus.textContent = 'ETB wallet connected · outcomes are confirmed by the server.';
      updateHUD();
    }).catch((error) => {
      showGameServiceError(error);
      toast(apiErrorMessage(error), 'bad');
    });
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
    renderWalletBalance();
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
    // A settled round is over, so the player may prepare the next round
    // (difficulty and stake) while the result card is still on screen.
    setBetControls(state.phase === 'idle' || settling);
    const insufficient = integrated && state.remoteReady && state.bet > state.balance;
    if (lowBalanceNote) lowBalanceNote.hidden = !insufficient || state.phase !== 'idle';
    playBtn.disabled = integrated && (!state.remoteReady || state.remoteBusy || Boolean(activeAccountSheet) || insufficient);
    if (playBtnLabel) {
      const unavailable = integrated && !state.remoteReady && Boolean(state.remoteError);
      const connecting = integrated && !state.remoteReady && !state.remoteError;
      playBtnLabel.textContent = unavailable ? 'Unavailable' : connecting ? 'Connecting…' : state.remoteBusy && state.phase === 'idle' ? 'Starting…' : 'Play';
      playBtn.setAttribute('aria-label', unavailable
        ? 'Chicken Road is unavailable because the wallet connection failed'
        : connecting ? 'Connecting to the Fetan Bet wallet' : 'Play Chicken Road Dash');
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
    syncAccountSheetState();
    reportParentRoundState(active, active && state.pos > 0 && !state.hop && !state.remoteBusy);
  }

  function renderWalletBalance() {
    if (!integrated) {
      balanceEl.textContent = `${fmtInt(state.balance)} ETB`;
      return;
    }
    if (!state.remoteReady) {
      balanceEl.textContent = state.remoteError ? 'Unavailable · ETB' : 'Loading ETB…';
      updateSheetBalances(state.remoteError ? 'Unavailable · ETB' : 'Loading ETB…');
      return;
    }
    const target = Number.isFinite(state.balance) ? Math.max(0, state.balance) : 0;
    if (displayedBalance === null || Math.abs(target - displayedBalance) < 0.005 ||
        matchMedia('(prefers-reduced-motion: reduce)').matches) {
      displayedBalance = target;
      balanceEl.textContent = fmtMoney(target);
      updateSheetBalances(fmtMoney(target));
      return;
    }
    cancelAnimationFrame(balanceAnimationFrame);
    const from = displayedBalance;
    const startedAt = performance.now();
    const animate = (now) => {
      const progress = Math.min(1, (now - startedAt) / 300);
      const eased = 1 - ((1 - progress) ** 3);
      const value = from + (target - from) * eased;
      displayedBalance = value;
      const formatted = fmtMoney(value);
      balanceEl.textContent = formatted;
      updateSheetBalances(formatted);
      if (progress < 1) balanceAnimationFrame = requestAnimationFrame(animate);
      else displayedBalance = target;
    };
    balanceAnimationFrame = requestAnimationFrame(animate);
  }

  function updateSheetBalances(value = fmtMoney(state.balance)) {
    const walletBalance = $('walletSheetBalance');
    const depositBalance = $('depositSheetBalance');
    if (walletBalance) walletBalance.textContent = value;
    if (depositBalance) depositBalance.textContent = value;
  }

  function syncAccountSheetState() {
    if (!integrated) return;
    const activeRound = state.phase === 'playing';
    document.querySelectorAll('.sheet-round-note').forEach((note) => { note.hidden = !activeRound; });
    document.querySelectorAll('.sheet-round-action').forEach((dock) => {
      dock.hidden = !activeRound;
      const button = dock.querySelector('.sheet-cashout');
      if (!button) return;
      const eligible = state.pos >= 1 && !state.hop && !state.remoteBusy && Boolean(state.serverRoundId);
      button.disabled = !eligible;
      button.textContent = state.pos < 1 ? 'Cash out after first crossing' : `Cash out · ${cashValueEl.textContent}`;
      button.onclick = () => {
        if (!eligible) return;
        closeAccountSheet(false);
        cashBtn.click();
      };
    });
  }

  function releaseWakeLock() {
    if (!wakeLock) return;
    const lock = wakeLock;
    wakeLock = null;
    try { Promise.resolve(lock.release?.()).catch(() => {}); } catch (_) { /* Optional browser API. */ }
  }

  function syncWakeLockState() {
    if (!integrated || state.phase !== 'playing' || document.visibilityState === 'hidden') {
      releaseWakeLock();
      return;
    }
    if (!navigator.wakeLock?.request || wakeLock) return;
    navigator.wakeLock.request('screen').then((lock) => {
      if (state.phase !== 'playing' || document.visibilityState === 'hidden') {
        lock.release().catch(() => {});
        return;
      }
      wakeLock = lock;
      lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; }, { once: true });
    }).catch(() => { /* Screen wake lock is optional and is not supported everywhere. */ });
  }

  function openAccountSheet(sheet, opener) {
    if (!integrated || !sheet) return;
    if (activeAccountSheet && activeAccountSheet !== sheet) closeAccountSheet(false);
    activeAccountSheet = sheet;
    accountSheetOpener = opener || document.activeElement;
    sheet.hidden = false;
    requestAnimationFrame(() => {
      if (activeAccountSheet !== sheet) return;
      sheet.classList.add('open');
      const panel = sheet.querySelector('[role="dialog"]');
      panel?.focus({ preventScroll: true });
    });
    updateHUD();
  }

  function closeAccountSheet(restoreFocus = true) {
    const sheet = activeAccountSheet;
    if (!sheet) return;
    activeAccountSheet = null;
    sheet.classList.remove('open');
    updateHUD();
    setTimeout(() => { if (!sheet.classList.contains('open')) sheet.hidden = true; }, 210);
    if (restoreFocus && accountSheetOpener?.isConnected) accountSheetOpener.focus({ preventScroll: true });
    accountSheetOpener = null;
  }

  function trapSheetFocus(event) {
    const panel = activeAccountSheet?.querySelector('[role="dialog"]');
    if (!panel || event.key !== 'Tab') return;
    const focusable = [...panel.querySelectorAll('button:not([disabled]), input:not([disabled]), a[href], select:not([disabled]), [tabindex="0"]')]
      .filter((element) => !element.hidden && element.getClientRects().length > 0);
    if (!focusable.length) { event.preventDefault(); panel.focus(); return; }
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  }

  async function customerAccountApi(path, payload) {
    let response;
    try {
      response = await fetch(path, {
        method: payload === undefined ? 'GET' : 'POST',
        credentials: 'same-origin',
        headers: payload === undefined ? {} : { 'Content-Type': 'application/json' },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
    } catch (_) {
      const error = new Error('NETWORK'); error.code = 'NETWORK'; throw error;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || 'GENERIC');
      error.code = data.error || 'GENERIC'; error.status = response.status; throw error;
    }
    return data;
  }

  async function refreshAuthoritativeBalance() {
    const data = await fetanApi('');
    const serverBalance = Number(data.balance_santim ?? data.balance);
    if (!Number.isFinite(serverBalance) || serverBalance < 0) throw new Error('INVALID_BALANCE');
    state.balance = serverBalance / 100;
    state.remoteReady = true;
    state.remoteError = null;
    updateHUD();
    return data;
  }

  const providerIcons = { telebirr: '📱', cbe: '🏦', boa: '🏛', dashen: '⚡', awash: '🛡', mpesa: '💸' };
  function depositFeedback(message, kind = '') {
    const output = $('gameDepositFeedback');
    if (!output) return;
    output.textContent = message;
    output.classList.toggle('error', kind === 'error');
    output.hidden = !message;
  }

  function selectDepositProvider(providerId) {
    selectedDepositProviderId = Number(providerId);
    $('gameDepositProviderId').value = String(selectedDepositProviderId);
    const provider = depositProviders.find((item) => Number(item.id) === selectedDepositProviderId);
    document.querySelectorAll('#gameDepositProviders .sheet-provider').forEach((button) => {
      button.setAttribute('aria-pressed', String(Number(button.dataset.providerId) === selectedDepositProviderId));
    });
    const instructions = $('gameDepositInstructions');
    if (provider && instructions) {
      const language = (() => { try { return parent.localStorage.getItem('lang') || 'en'; } catch (_) { return 'en'; } })();
      instructions.textContent = language === 'am' ? (provider.instr_am || provider.instr_en || '') : (provider.instr_en || provider.instr_am || '');
      instructions.hidden = !instructions.textContent;
    }
  }

  async function loadDepositProviders() {
    const container = $('gameDepositProviders');
    container.replaceChildren();
    const loading = document.createElement('p');
    loading.className = 'sheet-muted'; loading.textContent = 'Loading payment methods…';
    container.append(loading);
    try {
      const response = await customerAccountApi('/api/providers');
      depositProviders = Array.isArray(response.providers) ? response.providers : [];
      container.replaceChildren();
      if (!depositProviders.length) {
        const empty = document.createElement('p'); empty.className = 'sheet-muted';
        empty.textContent = 'No active payment methods are available right now.'; container.append(empty);
        return;
      }
      for (const provider of depositProviders) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'sheet-provider'; button.dataset.providerId = String(provider.id);
        button.setAttribute('aria-pressed', 'false');
        const icon = document.createElement('span'); icon.className = 'sheet-provider-icon'; icon.setAttribute('aria-hidden', 'true'); icon.textContent = providerIcons[provider.code] || '💳';
        const name = document.createElement('span'); name.textContent = provider.name;
        button.append(icon, name);
        button.addEventListener('click', () => selectDepositProvider(provider.id));
        container.append(button);
      }
      selectDepositProvider(depositProviders[0].id);
    } catch (error) {
      container.replaceChildren();
      const message = document.createElement('p'); message.className = 'sheet-muted';
      message.textContent = error.code === 'LOGIN' ? 'Your session has expired. Sign in again to request a deposit.' : 'Payment methods could not be loaded. Please try again.';
      container.append(message);
      depositFeedback('Payment methods are unavailable. No request was submitted.', 'error');
    }
  }

  async function loadRecentTransactions() {
    const container = $('walletTransactions');
    container.replaceChildren();
    const loading = document.createElement('p'); loading.className = 'sheet-muted'; loading.textContent = 'Loading recent activity…'; container.append(loading);
    try {
      const { transactions = [] } = await customerAccountApi('/api/transactions');
      container.replaceChildren();
      const recent = transactions.slice(0, 3);
      if (!recent.length) {
        const empty = document.createElement('p'); empty.className = 'sheet-muted'; empty.textContent = 'No transactions yet.'; container.append(empty); return;
      }
      for (const tx of recent) {
        const row = document.createElement('div'); row.className = 'wallet-tx-row';
        const main = document.createElement('div'); main.className = 'wallet-tx-main';
        const type = document.createElement('strong'); type.textContent = String(tx.type || 'Wallet activity').replace(/[_-]+/g, ' ');
        const time = document.createElement('time'); time.textContent = tx.created_at ? new Date(tx.created_at).toLocaleString() : '—';
        main.append(type, time);
        const amount = Number(tx.amount) / 100;
        const value = document.createElement('span'); value.className = `wallet-tx-amount${amount > 0 ? ' positive' : ''}`;
        value.textContent = `${amount > 0 ? '+' : ''}${fmtMoney(amount)}`;
        row.append(main, value); container.append(row);
      }
    } catch (error) {
      container.replaceChildren();
      const message = document.createElement('p'); message.className = 'sheet-muted';
      message.textContent = error.code === 'LOGIN' ? 'Your session has expired. Sign in again to view wallet activity.' : 'Recent transactions could not be loaded.';
      container.append(message);
    }
  }

  function navigateCustomer(route) {
    closeAccountSheet(false);
    if (parent !== window) parent.postMessage({ type: 'fetan-game-navigate', route }, location.origin);
  }

  async function submitGameDeposit(event) {
    event.preventDefault();
    const amount = Number($('gameDepositAmount').value);
    const txRef = $('gameDepositReference').value.trim().toUpperCase();
    const providerId = Number($('gameDepositProviderId').value);
    if (!Number.isInteger(amount) || amount < 10 || amount > 50000) {
      depositFeedback('Enter a whole ETB amount from 10 to 50,000.', 'error'); $('gameDepositAmount').focus(); return;
    }
    if (!providerId || !depositProviders.some((provider) => Number(provider.id) === providerId)) {
      depositFeedback('Choose an available payment method.', 'error'); return;
    }
    if (!/^[A-Z0-9-]{4,40}$/.test(txRef)) {
      depositFeedback('Enter a payment reference using 4–40 letters, numbers, or hyphens.', 'error'); $('gameDepositReference').focus(); return;
    }
    const button = $('gameDepositSubmit'); button.disabled = true; button.textContent = 'Submitting request…';
    depositFeedback('');
    try {
      const payload = { provider_id: providerId, amount, tx_ref: txRef };
      if (depositReceiptData) payload.receipt_data = depositReceiptData;
      const result = await customerAccountApi('/api/deposits', payload);
      depositFeedback(result.existing
        ? `This reference already has a ${String(result.status || 'pending')} request. It will remain in the existing review flow.`
        : 'Your request was submitted for manual review. Your balance changes only after authorized approval.');
      await Promise.allSettled([refreshAuthoritativeBalance(), loadRecentTransactions()]);
    } catch (error) {
      const message = error.code === 'DUP_REF' ? 'That payment reference is already in use. Check the reference or contact support.'
        : error.code === 'INVALID' ? 'The amount, payment method, or transaction reference was not accepted. Check the form and try again.'
          : error.code === 'RECEIPT_STORAGE_UNAVAILABLE' ? 'The receipt could not be stored. Please retry without the image or contact support.'
            : error.code === 'LOGIN' ? 'Your session has expired. Sign in again before submitting a deposit.'
              : 'The deposit request could not be submitted. Please check your connection and try again.';
      depositFeedback(message, 'error');
    } finally {
      button.disabled = false; button.textContent = 'Submit deposit request';
    }
  }

  async function handleDepositReceipt(event) {
    const file = event.target.files?.[0];
    depositReceiptData = null;
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      depositFeedback(file.size > 5 * 1024 * 1024 ? 'Receipt image must be 5 MB or smaller.' : 'Choose a JPG, PNG, or WEBP receipt image.', 'error');
      event.target.value = '';
      return;
    }
    depositReceiptData = await new Promise((resolve) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => resolve(null); reader.readAsDataURL(file);
    });
    if (!depositReceiptData) { depositFeedback('The receipt image could not be read. Choose another image.', 'error'); event.target.value = ''; }
  }

  function openDepositSheet(opener = depositOpen) {
    depositFeedback('');
    openAccountSheet(depositSheet, opener);
    loadDepositProviders();
    refreshAuthoritativeBalance().catch(() => {});
  }

  let autoVerifiedRoundId = null;
  function autoVerifySettledRound() {
    const roundId = state.serverRoundId;
    if (!integrated || !roundId || autoVerifiedRoundId === roundId) return;
    autoVerifiedRoundId = roundId;
    // Proof checking runs in the background; the result card stays clean and
    // the next round is never blocked by it.
    fetanApi(`/verify/${encodeURIComponent(state.serverRoundId)}`).then((proof) => {
      if (!proof.seed_commit_valid || !proof.outcomes_match_seed || !proof.probabilities_match_config || !proof.merkle_proofs_valid) {
        throw new Error('INVALID_PROOF');
      }
    }).catch((error) => {
      console.warn('Chicken Road round verification failed:', error?.message || error);
    });
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
    resultOverlay.classList.add('show');
    if (integrated) autoVerifySettledRound();
    updateHUD();
  }

  function hideResult() {
    state.resultShown = false;
    resultOverlay.classList.remove('show');
  }

  // Return a settled round to the ready-to-play state without starting a new
  // one. This is what lets the player change difficulty or stake after a
  // crash, cash-out or completed road.
  function resetToIdle() {
    state.phase = 'idle';
    state.pos = state.lane = 0;
    state.mult = 1;
    state.hop = null;
    state.pendingCheckpoint = null;
    state.resultTimer = 0;
    state.resultShown = false;
    state.lastOutcome = null;
    state.cameraX = state.cameraTarget = 0;
    state.shake = 0;
    state.particles = [];
    state.serverLadder = [];
    state.serverRoundId = null;
    state.remoteAction = null;
    state.pendingActionId = null;
    resetFences(0);
    resetTraffic();
    saveStore();
    updateHUD();
    syncWakeLockState();
    stageHint.textContent = integrated ? 'Play with your Fetan Bet wallet' : 'Press Play, then hop across the road';
    stageHint.classList.remove('fade');
  }

  // ---------------------------------------------------------------- Betting
  function setBet(value) {
    state.bet = clamp(Math.round(value), MIN_BET, MAX_BET);
    if (!integrated) state.bet = Math.min(state.bet, Math.max(MIN_BET, Math.floor(state.balance)));
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
          kind: Math.random() < 0.25 ? 'gt' : 'formula',
          num: Math.floor(rand(2, 99)),
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
      if (!state.remoteReady || state.remoteBusy || activeAccountSheet) return;
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
          resetFences(0);
        }
        hideResult();
        saveStore();
        updateHUD();
        stageHint.textContent = resumed
          ? 'Active round restored from the server.'
          : 'Server-committed outcomes; traffic is visual only.';
        play('click');
        syncWakeLockState();
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
    resetFences(0);
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
      // Server has confirmed this crossing is safe, so the gate may rise.
      confirmCheckpoint(state.pos);
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
    // Wait for this frame's collision check before raising a gate. A local
    // crossing that lands in traffic must not look confirmed.
    state.pendingCheckpoint = Math.min(to, laneLimit());
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
        syncWakeLockState();
        refreshAuthoritativeBalance().catch(() => {});
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
    syncWakeLockState();
    if (integrated) refreshAuthoritativeBalance().catch(() => {});
  }

  function crash(car) {
    if (state.phase !== 'playing') return;
    state.phase = 'crashed';
    state.hop = null;
    state.pendingCheckpoint = null;
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
    syncWakeLockState();
    if (integrated) refreshAuthoritativeBalance().catch(() => {});
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
        'A car got you. Try a safer crossing.', 'ROUND OVER');
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
  const ART = {
    black: '#101720',
    ink: '#1B2632',
    panel: '#1B2632',
    asphalt: '#454B50',
    asphaltDark: '#343B40',
    steel: '#51585E',
    steelLight: '#92999E',
    white: '#F7F8FA',
    yellow: '#FFC400',
    yellowHot: '#FFDA45',
    red: '#F32640',
    redDark: '#8F1E2D',
    green: '#17C990',
    blue: '#268EFF',
  };

  function hash01(n) {
    const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return v - Math.floor(v);
  }

  function drawAsphalt(x, y, w, h, dark = false) {
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, dark ? '#303A40' : '#41484D');
    g.addColorStop(0.48, dark ? '#3E484E' : '#51585D');
    g.addColorStop(1, dark ? '#2B353B' : '#3B4348');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);

    // A soft cool stadium wash lifts the asphalt without flattening its depth.
    const wash = ctx.createLinearGradient(x, y, x + w, y);
    wash.addColorStop(0, 'rgba(118,164,205,0.035)');
    wash.addColorStop(0.5, 'rgba(215,228,239,0.055)');
    wash.addColorStop(1, 'rgba(255,196,0,0.035)');
    ctx.fillStyle = wash;
    ctx.fillRect(x, y, w, h);

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    const count = Math.min(360, Math.max(60, Math.floor((w * h) / 1500)));
    for (let i = 0; i < count; i++) {
      const sx = x + hash01(i * 3.17 + 1) * w;
      const sy = y + hash01(i * 7.31 + 2) * h;
      const light = i % 5 === 0;
      ctx.fillStyle = light ? 'rgba(255,255,255,0.055)' : 'rgba(5,12,20,0.13)';
      ctx.fillRect(sx, sy, light ? 2 : 1.5, light ? 2 : 4);
    }
    ctx.strokeStyle = 'rgba(5,12,20,0.17)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 7; i++) {
      const cx = x + hash01(i * 11.3) * w;
      const cy = y + hash01(i * 17.9) * h;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + 9, cy + 6);
      ctx.lineTo(cx + 4, cy + 15);
      ctx.lineTo(cx + 17, cy + 24);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCheckeredStrip(x, y, w, h, cell = 10) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    for (let yy = y; yy < y + h; yy += cell) {
      for (let xx = 0; xx < w; xx += cell) {
        const row = Math.floor((yy - y) / cell);
        const col = Math.floor(xx / cell);
        ctx.fillStyle = (row + col) % 2 === 0 ? 'rgba(247,245,236,0.82)' : 'rgba(8,9,11,0.88)';
        ctx.fillRect(x + xx, yy, Math.min(cell, x + w - (x + xx)), Math.min(cell, y + h - yy));
      }
    }
    ctx.restore();
  }

  function drawPitArea(x, w, h, finish) {
    drawAsphalt(x, 0, w, h, true);

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, 28, w, h - 56);
    ctx.clip();
    // Concrete pit slabs.
    ctx.strokeStyle = 'rgba(235,243,250,0.105)';
    ctx.lineWidth = 1;
    for (let yy = 30; yy < h - 28; yy += 64) {
      ctx.beginPath();
      ctx.moveTo(x, yy);
      ctx.lineTo(x + w, yy);
      ctx.stroke();
    }
    for (let xx = x + 26; xx < x + w; xx += 58) {
      ctx.beginPath();
      ctx.moveTo(xx, 28);
      ctx.lineTo(xx, h - 28);
      ctx.stroke();
    }
    // Painted pit boxes.
    ctx.strokeStyle = 'rgba(255,196,0,0.28)';
    ctx.lineWidth = 2;
    for (let yy = 62; yy < h - 40; yy += 150) {
      ctx.strokeRect(x + 12, yy, Math.max(20, w - 24), 76);
    }
    ctx.restore();

    // Yellow lane edge and inner white line.
    const edge = finish ? x : x + w;
    ctx.fillStyle = 'rgba(255,196,0,0.72)';
    ctx.fillRect(edge - (finish ? 0 : 4), 28, 4, h - 56);
    ctx.fillStyle = 'rgba(247,245,236,0.5)';
    ctx.fillRect(finish ? edge + 7 : edge - 12, 28, 2, h - 56);

    // Drainage grates.
    ctx.fillStyle = 'rgba(0,0,0,0.34)';
    for (let yy = 80; yy < h - 40; yy += 190) {
      ctx.fillRect(finish ? x + w - 24 : x + 8, yy, 15, 28);
      ctx.fillStyle = 'rgba(255,255,255,0.09)';
      for (let k = 0; k < 4; k++) ctx.fillRect(finish ? x + w - 22 : x + 10, yy + 4 + k * 6, 11, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.34)';
    }
  }

  function drawGrandstand(x, y, w, h) {
    if (w < 30 || h < 30) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();

    // Structure and roof.
    ctx.fillStyle = '#0d0f12';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#1a1d22';
    ctx.fillRect(x + 3, y + 4, w - 6, h - 4);
    ctx.fillStyle = ART.yellow;
    ctx.fillRect(x, y + 2, w, 3);
    ctx.fillStyle = '#2b3037';
    ctx.fillRect(x, y + 5, w, 4);

    const rows = Math.max(3, Math.min(6, Math.floor((h - 18) / 14)));
    for (let r = 0; r < rows; r++) {
      const ry = y + 13 + r * ((h - 18) / rows);
      ctx.fillStyle = r % 2 ? '#282d34' : '#22262c';
      ctx.fillRect(x + 5, ry, w - 10, 11);
      ctx.fillStyle = 'rgba(0,0,0,0.32)';
      ctx.fillRect(x + 5, ry + 9, w - 10, 2);
      // Crowd dots, deterministic so they do not flicker.
      const seats = Math.max(4, Math.floor((w - 16) / 8));
      for (let s = 0; s < seats; s++) {
        const n = r * 97 + s * 13 + Math.round(x);
        const px = x + 8 + s * ((w - 16) / seats) + hash01(n) * 3;
        const py = ry + 3 + hash01(n + 5) * 3;
        const tones = ['#f7f5ec', '#ffc400', '#e5323b', '#8c939c'];
        ctx.fillStyle = tones[Math.floor(hash01(n + 11) * tones.length)];
        ctx.beginPath();
        ctx.arc(px, py, 1.6 + hash01(n + 3) * 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Support posts and safety rail.
    ctx.fillStyle = '#090a0c';
    for (let px = x + 8; px < x + w; px += 34) ctx.fillRect(px, y + 6, 3, h - 6);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(x, y + h - 4, w, 1);

    // Small pennants on the roof.
    for (let px = x + 12, i = 0; px < x + w - 8; px += 42, i++) {
      const col = i % 2 ? ART.red : ART.yellow;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(px, y);
      ctx.lineTo(px + 11, y);
      ctx.lineTo(px + 5, y + 10);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawTireStack(x, y, levels = 3, scale = 1) {
    for (let i = 0; i < levels; i++) {
      const yy = y - i * 10 * scale;
      const wobble = i % 2 ? 1.5 : -1.5;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(x + 3, yy + 3, 22 * scale, 9 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0b0c0e';
      ctx.strokeStyle = '#24272c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(x + wobble, yy, 21 * scale, 9 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#2e3238';
      ctx.beginPath();
      ctx.ellipse(x + wobble, yy - 1, 7 * scale, 3 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,196,0,0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(x + wobble, yy, 15 * scale, 6 * scale, 0, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
    }
  }

  function drawCone(x, y, scale = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(2, 2, 9, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ART.red;
    ctx.strokeStyle = '#5f1117';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, -17);
    ctx.lineTo(7, 0);
    ctx.lineTo(-7, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = ART.white;
    ctx.fillRect(-5, -8, 10, 3);
    ctx.fillStyle = '#15171a';
    ctx.fillRect(-9, 0, 18, 3);
    ctx.restore();
  }

  function drawSign(x, y, w, h, text, accent = ART.yellow, checkers = false) {
    if (w < 20 || h < 12) return;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x + 2, y + 3, w, h);
    ctx.fillStyle = '#0b0c0e';
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.4;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    if (checkers) {
      drawCheckeredStrip(x + 2, y + 2, w - 4, 4, 4);
    } else {
      ctx.fillStyle = accent;
      ctx.fillRect(x + 2, y + 2, w - 4, 3);
    }
    if (text && h >= 16) {
      ctx.fillStyle = ART.white;
      ctx.font = '900 8px Montserrat, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x + w / 2, y + h / 2 + 2);
    }
    ctx.restore();
  }

  function drawPitBench(x, y, w) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.34)';
    ctx.fillRect(x + 2, y + 10, w, 4);
    ctx.fillStyle = '#171a1f';
    ctx.fillRect(x, y, w, 5);
    ctx.fillRect(x, y - 8, w, 4);
    ctx.fillStyle = ART.yellow;
    ctx.fillRect(x + 3, y + 5, 3, 11);
    ctx.fillRect(x + w - 6, y + 5, 3, 11);
    ctx.fillStyle = '#2d3239';
    ctx.fillRect(x + 7, y + 8, w - 14, 2);
    ctx.fillStyle = ART.red;
    ctx.fillRect(x + w * 0.62, y - 7, 10, 2);
    ctx.restore();
  }

  function drawStartLights(x, y) {
    const active = state.phase === 'playing';
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(x + 2, y + 3, 18, 64);
    ctx.fillStyle = '#0b0c0e';
    ctx.strokeStyle = 'rgba(255,196,0,0.55)';
    ctx.lineWidth = 1.4;
    ctx.fillRect(x, y, 18, 64);
    ctx.strokeRect(x + 0.5, y + 0.5, 17, 63);
    for (let i = 0; i < 5; i++) {
      const on = active ? i >= 3 : true;
      ctx.fillStyle = active ? (on ? ART.green : '#1b2320') : (i < 3 ? ART.red : '#2a1012');
      ctx.beginPath();
      ctx.arc(x + 9, y + 9 + i * 11.5, 4, 0, Math.PI * 2);
      ctx.fill();
      if (active ? on : i < 3) {
        ctx.shadowColor = active ? ART.green : ART.red;
        ctx.shadowBlur = 7;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
    ctx.restore();
  }

  function drawChevron(x, y, dir, alpha = 0.25) {
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = ART.white;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (dir > 0) {
      ctx.moveTo(-10, -6);
      ctx.lineTo(0, 5);
      ctx.lineTo(10, -6);
    } else {
      ctx.moveTo(-10, 5);
      ctx.lineTo(0, -6);
      ctx.lineTo(10, 5);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawTrackBorders(h) {
    const W = worldWidth();
    const curb = 13;
    const rail = 15;
    const drawCurbBand = (top) => {
      const y = top ? 0 : h - curb;
      for (let x = 0; x < W; x += 22) {
        ctx.fillStyle = (Math.floor(x / 22) % 2 === 0) ? ART.white : ART.red;
        ctx.fillRect(x, y, 22, curb);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(0, top ? curb - 2 : h - curb, W, 2);
    };
    const drawRail = (top) => {
      const y = top ? curb : h - curb - rail;
      ctx.fillStyle = '#0e1013';
      ctx.fillRect(0, y, W, rail);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(0, top ? y + 2 : y + rail - 3, W, 1);
      ctx.fillStyle = ART.yellow;
      ctx.fillRect(0, top ? y + rail - 4 : y + 3, W, 2);
      // Repeat sponsor boards along the safety wall.
      for (let x = 24; x < W - 90; x += 236) {
        const boardW = 82;
        drawSign(x, top ? y + 3 : y + 4, boardW, rail - 7, 'FETAN BET', ART.yellow, false);
        if (x + 140 < W - 90) {
          ctx.fillStyle = '#1a1d22';
          ctx.fillRect(x + 118, top ? y + 5 : y + 6, 32, rail - 10);
          ctx.fillStyle = ART.red;
          ctx.fillRect(x + 118, top ? y + 5 : y + 6, 32, 3);
        }
      }
    };
    drawCurbBand(true);
    drawRail(true);
    drawCurbBand(false);
    drawRail(false);

    // Floodlight glows on the outer walls.
    for (let x = 86; x < W; x += 208) {
      const gy = 8;
      const glow = ctx.createRadialGradient(x, gy, 0, x, gy, 34);
      glow.addColorStop(0, 'rgba(255,224,102,0.24)');
      glow.addColorStop(1, 'rgba(255,224,102,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(x - 34, 0, 68, 48);
      const glow2 = ctx.createRadialGradient(x + 34, h - 8, 0, x + 34, h - 8, 30);
      glow2.addColorStop(0, 'rgba(255,224,102,0.18)');
      glow2.addColorStop(1, 'rgba(255,224,102,0)');
      ctx.fillStyle = glow2;
      ctx.fillRect(x + 4, h - 48, 64, 48);
    }
    // Tiny checkered pennants on the wall.
    for (let x = 162; x < W - 20; x += 208) {
      drawCheckeredStrip(x, 2, 9, 9, 4.5);
      drawCheckeredStrip(x + 11, h - 11, 9, 9, 4.5);
    }
  }

  function drawStartArea(h) {
    const cy = roadCenterY();
    const compact = SIDE_L < 160;
    drawStartLights(compact ? 12 : 19, Math.min(h - 108, cy + 58));
    if (compact) {
      drawPitBench(SIDE_L - 66, Math.max(82, cy - 94), Math.max(38, SIDE_L - 72));
    } else {
      drawPitBench(96, Math.max(82, cy - 94), 86);
    }

    // Pit-side tyre stacks and cones.
    drawTireStack(compact ? SIDE_L * 0.44 : 62, Math.min(h - 60, cy + 132), 3, 1);
    drawTireStack(compact ? SIDE_L * 0.74 : 104, Math.min(h - 58, cy + 140), 2, 0.88);
    drawCone(compact ? SIDE_L * 0.54 : 70, Math.min(h - 48, cy + 82), 0.9);
    drawCone(compact ? SIDE_L - 20 : 150, Math.max(52, cy - 76), 0.85);

    // Vertical start pylon at the edge of the road. On compact screens the
    // shorter apron would put it through the chicken, so the start band and
    // lights carry the start-line cue instead.
    if (!compact) {
      const px = SIDE_L - 38;
      ctx.fillStyle = '#0b0c0e';
      ctx.fillRect(px, 30, 14, h - 60);
      ctx.fillStyle = ART.yellow;
      ctx.fillRect(px + 2, 30, 3, h - 60);
      drawCheckeredStrip(px + 5, 38, 9, Math.min(86, h * 0.22), 4.5);
      drawCheckeredStrip(px + 5, h - 38 - Math.min(86, h * 0.22), 9, Math.min(86, h * 0.22), 4.5);
      ctx.save();
      ctx.translate(px + 10, cy);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = 'rgba(247,245,236,0.72)';
      ctx.font = '900 8px Montserrat, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('START', 0, 0);
      ctx.restore();
    }

    // Pit-side equipment.
    ctx.fillStyle = '#14171b';
    ctx.fillRect(12, Math.max(50, cy - 104), 46, 13);
    ctx.fillStyle = ART.red;
    ctx.fillRect(14, Math.max(50, cy - 102), 13, 4);
    ctx.fillStyle = ART.yellow;
    ctx.fillRect(30, Math.max(50, cy - 102), 8, 4);
    ctx.fillStyle = '#2b3037';
    ctx.fillRect(12, Math.max(50, cy - 91), 46, 2);
  }

  function drawFinishArea(h) {
    const cy = roadCenterY();
    const roadR = SIDE_L + roadWidth();
    drawSign(roadR + 20, 34, 112, 24, 'FINISH LINE', ART.yellow, true);

    // Podium and trophy.
    const podiumY = Math.min(h - 84, cy + 92);
    ctx.fillStyle = '#111318';
    ctx.fillRect(roadR + 34, podiumY, 40, 22);
    ctx.fillRect(roadR + 78, podiumY - 10, 38, 32);
    ctx.fillRect(roadR + 120, podiumY + 4, 34, 18);
    ctx.fillStyle = ART.yellow;
    ctx.fillRect(roadR + 34, podiumY, 40, 3);
    ctx.fillRect(roadR + 78, podiumY - 10, 38, 3);
    ctx.fillRect(roadR + 120, podiumY + 4, 34, 3);
    ctx.fillStyle = '#2b3037';
    ctx.fillRect(roadR + 36, podiumY + 22, 38, 2);
    ctx.fillRect(roadR + 80, podiumY + 22, 36, 2);
    ctx.fillStyle = ART.yellow;
    ctx.beginPath();
    ctx.arc(roadR + 97, podiumY - 24, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0b0c0e';
    ctx.fillRect(roadR + 94, podiumY - 20, 6, 6);

    drawTireStack(roadR + 24, Math.min(h - 58, cy + 142), 3, 1);
    drawTireStack(roadR + 164, Math.min(h - 58, cy + 140), 2, 0.9);
    drawCone(roadR + 14, Math.max(52, cy - 84), 0.85);

    // Vertical finish pylon.
    const px = roadR + 15;
    ctx.fillStyle = '#0b0c0e';
    ctx.fillRect(px, 30, 14, h - 60);
    ctx.fillStyle = ART.yellow;
    ctx.fillRect(px + 2, 30, 3, h - 60);
    ctx.save();
    ctx.translate(px + 10, cy);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = 'rgba(255,224,102,0.86)';
    ctx.font = '900 8px Montserrat, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('FINISH', 0, 0);
    ctx.restore();
  }

  function drawWorld(h) {
    const W = worldWidth();
    const roadX = SIDE_L;
    const roadW = roadWidth();
    const roadR = roadX + roadW;

    ctx.fillStyle = ART.black;
    ctx.fillRect(0, 0, W, h);

    drawPitArea(0, SIDE_L, h, false);
    drawPitArea(roadR, SIDE_R, h, true);
    drawGrandstand(14, 26, SIDE_L - 28, Math.max(42, Math.min(118, h * 0.22)));
    drawGrandstand(roadR + 14, 26, SIDE_R - 28, Math.max(42, Math.min(118, h * 0.22)));

    drawAsphalt(roadX, 0, roadW, h);

    const cleared = confirmedCheckpoints();
    const active = state.phase === 'playing';
    for (let i = 0; i < laneLimit(); i++) {
      const lx = roadX + i * LANE_W;
      if (i < cleared) {
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.fillRect(lx + 2, 28, LANE_W - 4, h - 56);
        ctx.fillStyle = 'rgba(255,196,0,0.035)';
        ctx.fillRect(lx + 2, 28, LANE_W - 4, h - 56);
      } else if (active && i === state.pos) {
        ctx.fillStyle = 'rgba(255,196,0,0.055)';
        ctx.fillRect(lx + 2, 28, LANE_W - 4, h - 56);
      }

      // Rubber lines and tarmac seams.
      ctx.fillStyle = 'rgba(0,0,0,0.14)';
      ctx.fillRect(lx + LANE_W * 0.42, 28, 5, h - 56);
      ctx.fillRect(lx + LANE_W * 0.58, 28, 5, h - 56);
      ctx.fillStyle = 'rgba(255,255,255,0.02)';
      ctx.fillRect(lx + LANE_W * 0.5 - 1, 28, 2, h - 56);

      const lane = state.lanes[i];
      if (lane) {
        drawChevron(lx + LANE_W / 2, 42, lane.dir, 0.2);
        drawChevron(lx + LANE_W / 2, h - 40, lane.dir, 0.16);
      }
    }

    // Lane markings.
    for (let i = 0; i <= laneLimit(); i++) {
      const lx = roadX + i * LANE_W;
      const edge = i === 0 || i === laneLimit();
      ctx.save();
      ctx.strokeStyle = edge ? 'rgba(247,248,250,0.88)' : 'rgba(247,248,250,0.34)';
      ctx.lineWidth = edge ? 3 : 2;
      ctx.setLineDash(edge ? [] : [16, 20]);
      ctx.beginPath();
      ctx.moveTo(lx, 30);
      ctx.lineTo(lx, h - 30);
      ctx.stroke();
      ctx.restore();
    }

    // Start and finish checker bands.
    drawCheckeredStrip(roadX - 17, 28, 17, h - 56, 8.5);
    drawCheckeredStrip(roadR, 28, 17, h - 56, 8.5);
    ctx.fillStyle = 'rgba(255,196,0,0.34)';
    ctx.fillRect(roadX - 1, 28, 2, h - 56);
    ctx.fillRect(roadR - 1, 28, 2, h - 56);

    // Road edge light strips.
    const edgeGlow = ctx.createLinearGradient(roadX - 12, 0, roadX + 26, 0);
    edgeGlow.addColorStop(0, 'rgba(255,196,0,0)');
    edgeGlow.addColorStop(0.55, 'rgba(255,196,0,0.12)');
    edgeGlow.addColorStop(1, 'rgba(255,196,0,0)');
    ctx.fillStyle = edgeGlow;
    ctx.fillRect(roadX - 12, 28, 38, h - 56);

    drawTrackBorders(h);
    drawStartArea(h);
    drawFinishArea(h);
  }

  // ---------------------------------------------------------------- Checkpoint art
  function drawCheckpointMarkers(h) {
    const active = state.phase === 'playing';
    const next = Math.min(laneLimit(), state.pos + 1);
    const targetX = checkpointX(next);
    const pulse = 0.5 + 0.5 * Math.sin(state.time * 5.2);

    ctx.save();
    if (active) {
      ctx.strokeStyle = `rgba(255,196,0,${0.22 + pulse * 0.2})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([11, 12]);
      ctx.beginPath();
      ctx.moveTo(targetX, 32);
      ctx.lineTo(targetX, h - 32);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = `rgba(255,196,0,${0.55 + pulse * 0.3})`;
      ctx.beginPath();
      ctx.moveTo(targetX - 5, 34);
      ctx.lineTo(targetX + 5, 34);
      ctx.lineTo(targetX, 42);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(targetX - 5, h - 34);
      ctx.lineTo(targetX + 5, h - 34);
      ctx.lineTo(targetX, h - 42);
      ctx.closePath();
      ctx.fill();
    }

    // Checkpoint gate number flags at the road edge.
    ctx.font = '900 7px Montserrat, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let p = 1; p <= laneLimit(); p++) {
      const x = checkpointX(p);
      if (x < state.cameraX - 40 || x > state.cameraX + state.viewW + 40) continue;
      const isPast = p <= confirmedCheckpoints();
      const isNext = active && p === next;
      if (!isPast && !isNext) continue;
      ctx.fillStyle = isNext ? ART.yellow : 'rgba(255,196,0,0.45)';
      ctx.fillRect(x - 1, 29, 2, 12);
      ctx.fillRect(x - 1, h - 41, 2, 12);
      if (isNext) {
        ctx.fillStyle = ART.yellow;
        ctx.fillRect(x - 6, 29, 12, 9);
        ctx.fillStyle = '#0b0c0e';
        ctx.fillText(String(p), x, 34);
      }
    }

    if (state.checkFx) {
      const t = clamp(state.checkFx.t / 0.8, 0, 1);
      const cx = checkpointX(state.checkFx.pos) - CHECKPOINT_INSET;
      const cy = roadCenterY() + 34;
      ctx.strokeStyle = `rgba(255,224,102,${(1 - t) * 0.7})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 20 + t * 42, 7 + t * 15, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSafetyFence(x, h, t) {
    if (t <= 0) return;
    const cy = roadCenterY();
    const gap = Math.min(78, Math.max(60, h * 0.21));
    const grow = 1 - Math.pow(1 - clamp(t, 0, 1), 3);
    const topEnd = 34;
    const bottomEnd = h - 34;
    const topLen = Math.max(0, cy - gap - topEnd) * grow;
    const bottomLen = Math.max(0, bottomEnd - cy - gap) * grow;
    if (topLen < 2 && bottomLen < 2) return;

    const drawSegment = (y0, y1) => {
      const len = y1 - y0;
      if (len < 2) return;
      ctx.save();
      // Drop shadow into the cleared lane.
      ctx.fillStyle = 'rgba(0,0,0,0.42)';
      ctx.fillRect(x - 8, y0 + 3, 11, len);
      // Dark frame.
      ctx.fillStyle = '#0b0c0e';
      ctx.fillRect(x - 5, y0, 10, len);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x - 3.5, y0, 7, len);
      ctx.clip();
      for (let yy = y0, i = 0; yy < y1; yy += 15, i++) {
        ctx.fillStyle = i % 2 === 0 ? ART.red : ART.white;
        ctx.fillRect(x - 4, yy, 8, 15);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      for (let yy = y0 + 15; yy < y1; yy += 15) ctx.fillRect(x - 4, yy - 1, 8, 1.5);
      ctx.restore();
      // Glass/steel top edge.
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillRect(x + 2.5, y0, 1.5, len);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(x - 5, y0, 1.5, len);
      // Diagonal supports into the closed lane.
      ctx.strokeStyle = 'rgba(10,11,13,0.72)';
      ctx.lineWidth = 2.5;
      for (let yy = y0 + 24; yy < y1 - 10; yy += 66) {
        ctx.beginPath();
        ctx.moveTo(x - 5, yy);
        ctx.lineTo(x - 18, yy + 19);
        ctx.stroke();
      }
      ctx.restore();
    };

    drawSegment(cy - gap - topLen, cy - gap);
    drawSegment(cy + gap, cy + gap + bottomLen);

    // Checkpoint gate posts with yellow caps.
    const post = (py) => {
      ctx.fillStyle = '#0b0c0e';
      ctx.fillRect(x - 8, py - 7, 16, 14);
      ctx.fillStyle = ART.yellow;
      ctx.fillRect(x - 6, py - 5, 12, 3);
      ctx.fillStyle = 'rgba(255,224,102,0.8)';
      ctx.beginPath();
      ctx.arc(x, py + 2, 2.2 + Math.sin(state.time * 6) * 0.7, 0, Math.PI * 2);
      ctx.fill();
    };
    post(cy - gap);
    post(cy + gap);

    // A small checkered plate at the gate.
    drawCheckeredStrip(x - 5, cy - 6, 10, 12, 4);
    ctx.strokeStyle = 'rgba(255,196,0,0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 5.5, cy - 6.5, 11, 13);
  }

  function drawFences(h) {
    // Only the newest confirmed gate carries the full safety barrier. Earlier
    // checkpoints stay marked by their closed lane and checkpoint flag, which
    // keeps the live crossing readable instead of stacking tall barriers.
    let latest = null;
    for (const fence of state.fences) {
      if (!latest || fence.pos > latest.pos) latest = fence;
    }
    if (!latest) return;
    const x = checkpointX(latest.pos);
    if (x < state.cameraX - 40 || x > state.cameraX + state.viewW + 40) return;
    drawSafetyFence(x, h, latest.t);
  }

  // ---------------------------------------------------------------- Vehicles
  function arcadeCarPaint(source) {
    const match = String(source || '').match(/^#([\da-f]{6})$/i);
    if (!match) return ART.blue;
    const hex = match[1];
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
    let hue = 0;
    if (delta) {
      if (max === r) hue = 60 * (((g - b) / delta) % 6);
      else if (max === g) hue = 60 * ((b - r) / delta + 2);
      else hue = 60 * ((r - g) / delta + 4);
    }
    if (hue < 0) hue += 360;
    if (hue < 28 || hue >= 345) return ART.red;
    if (hue < 68) return ART.yellow;
    if (hue < 190) return ART.green;
    if (hue < 265) return ART.blue;
    return '#263142';
  }

  function drawCar(car, lane, laneX, alpha = 1) {
    const len = car.len;
    const dir = lane.dir;
    const base = arcadeCarPaint(car.color);
    const num = car.num || 7;
    ctx.save();
    ctx.translate(laneX, car.y);
    if (dir < 0) ctx.rotate(Math.PI);
    ctx.globalAlpha = alpha;

    // Ground shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.46)';
    rr(-26, -len / 2 + 7, 58, len, 18);
    ctx.fill();

    // Rear wing.
    ctx.fillStyle = '#0c0d10';
    rr(-29, -len / 2 + 2, 58, 5, 2);
    ctx.fill();
    ctx.fillStyle = base;
    ctx.fillRect(-29, -len / 2 + 2, 4, 11);
    ctx.fillRect(25, -len / 2 + 2, 4, 11);
    ctx.fillStyle = ART.yellow;
    ctx.fillRect(-29, -len / 2 + 2, 4, 2);
    ctx.fillRect(25, -len / 2 + 2, 4, 2);

    // Wheels.
    const wheelLen = Math.max(20, len * 0.2);
    const drawWheel = (wx, wy) => {
      ctx.fillStyle = '#08090b';
      rr(wx - 5, wy - wheelLen / 2, 10, wheelLen, 4);
      ctx.fill();
      ctx.fillStyle = '#202834';
      rr(wx - 2.5, wy - wheelLen / 2 + 3, 5, wheelLen - 6, 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,196,0,0.72)';
      ctx.fillRect(wx - 1, wy - wheelLen / 2 + 5, 2, wheelLen - 10);
    };
    drawWheel(-28, len * 0.25);
    drawWheel(28, len * 0.25);
    drawWheel(-28, -len * 0.25);
    drawWheel(28, -len * 0.25);

    // Sidepods.
    const podG = ctx.createLinearGradient(-24, 0, 24, 0);
    podG.addColorStop(0, darken(base, 38));
    podG.addColorStop(0.5, base);
    podG.addColorStop(1, darken(base, 48));
    ctx.fillStyle = podG;
    rr(-23, -len * 0.16, 12, len * 0.34, 5);
    ctx.fill();
    rr(11, -len * 0.16, 12, len * 0.34, 5);
    ctx.fill();

    // Chassis / nose.
    const bodyG = ctx.createLinearGradient(-18, 0, 18, 0);
    bodyG.addColorStop(0, darken(base, 46));
    bodyG.addColorStop(0.25, lighten(base, 20));
    bodyG.addColorStop(0.55, base);
    bodyG.addColorStop(1, darken(base, 54));
    ctx.fillStyle = bodyG;
    ctx.beginPath();
    ctx.moveTo(-12, -len * 0.4);
    ctx.quadraticCurveTo(-18, -len * 0.05, -12, len * 0.28);
    ctx.lineTo(-6, len / 2 - 11);
    ctx.quadraticCurveTo(0, len / 2 - 7, 6, len / 2 - 11);
    ctx.lineTo(12, len * 0.28);
    ctx.quadraticCurveTo(18, -len * 0.05, 12, -len * 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(8,9,11,0.8)';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // Fine racing pinstripes and a gloss pass bring a miniature collector-car
    // finish while staying inside the original body and wheel silhouette.
    ctx.fillStyle = 'rgba(247,248,250,0.72)';
    ctx.fillRect(-1.5, -len * 0.28, 3, len * 0.48);
    ctx.fillStyle = ART.yellow;
    ctx.fillRect(-6, -len * 0.22, 1.5, len * 0.38);
    ctx.fillRect(4.5, -len * 0.22, 1.5, len * 0.38);
    ctx.fillRect(-8, len * 0.02, 16, 2);
    const gloss = ctx.createLinearGradient(-14, -len * 0.34, 12, len * 0.2);
    gloss.addColorStop(0, 'rgba(255,255,255,0.28)');
    gloss.addColorStop(0.35, 'rgba(255,255,255,0.08)');
    gloss.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gloss;
    ctx.beginPath();
    ctx.moveTo(-9, -len * 0.34);
    ctx.quadraticCurveTo(0, -len * 0.39, 9, -len * 0.34);
    ctx.lineTo(7, -len * 0.12);
    ctx.lineTo(-7, -len * 0.12);
    ctx.closePath();
    ctx.fill();

    // Cockpit and halo.
    ctx.fillStyle = '#0e1013';
    ctx.beginPath();
    ctx.ellipse(0, -len * 0.06, 9, len * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(38,142,255,0.2)';
    ctx.beginPath();
    ctx.ellipse(-2, -len * 0.08, 5, len * 0.09, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0a0b0d';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, -len * 0.055, 10, Math.PI * 0.95, Math.PI * 2.05);
    ctx.stroke();

    // Discreet side decals stay inside the original car body bounds.
    ctx.fillStyle = 'rgba(247,248,250,0.92)';
    ctx.font = '900 4.5px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('FB', -16.5, len * 0.015);
    ctx.fillText('FB', 16.5, len * 0.015);

    // Driver helmet.
    ctx.fillStyle = num % 2 ? ART.yellow : ART.white;
    ctx.beginPath();
    ctx.arc(0, -len * 0.075, 5.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0a0b0d';
    ctx.lineWidth = 1.3;
    ctx.stroke();
    ctx.strokeStyle = '#0a0b0d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-4, -len * 0.075);
    ctx.lineTo(4, -len * 0.075);
    ctx.stroke();

    // Front wing.
    ctx.fillStyle = '#0c0d10';
    rr(-30, len / 2 - 12, 60, 5, 2);
    ctx.fill();
    ctx.fillStyle = base;
    ctx.fillRect(-30, len / 2 - 12, 7, 5);
    ctx.fillRect(23, len / 2 - 12, 7, 5);
    ctx.fillStyle = 'rgba(255,255,255,0.24)';
    ctx.fillRect(-18, len / 2 - 13, 36, 1.5);

    // Number roundel on the nose.
    ctx.fillStyle = ART.white;
    ctx.beginPath();
    ctx.arc(0, len * 0.23, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0b0c0e';
    ctx.font = '900 7px Montserrat, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(num), 0, len * 0.24);

    // Headlights and tail lights.
    ctx.shadowColor = '#fff3b0';
    ctx.shadowBlur = 9;
    ctx.fillStyle = '#fff6cf';
    rr(-22, len / 2 - 9, 8, 4, 2);
    ctx.fill();
    rr(14, len / 2 - 9, 8, 4, 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ff495e';
    rr(-23, -len / 2 + 8, 8, 3, 1.5);
    ctx.fill();
    rr(15, -len / 2 + 8, 8, 3, 1.5);
    ctx.fill();

    // Speed streaks behind the car.
    const speed = Math.min(1, lane.speed / 160);
    ctx.strokeStyle = `rgba(38,142,255,${0.035 + speed * 0.045})`;
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      const sx = -18 + i * 18;
      ctx.beginPath();
      ctx.moveTo(sx, -len / 2 - 6);
      ctx.lineTo(sx, -len / 2 - 20 - i * 7);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawVehicles(h) {
    const left = state.cameraX - 80;
    const right = state.cameraX + state.viewW + 80;
    const cleared = confirmedCheckpoints();
    const chicken = chickenX();
    const centerY = roadCenterY();
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 28, worldWidth(), h - 56);
    ctx.clip();
    for (let i = 0; i < laneLimit(); i++) {
      const lane = state.lanes[i];
      if (!lane) continue;
      const laneX = SIDE_L + (i + 0.5) * LANE_W;
      if (laneX < left || laneX > right) continue;
      // Completed crossings are visually closed behind the safety gate. The
      // traffic is presentation only in wallet mode; local collision geometry
      // still uses the original lane centres.
      const closed = i < cleared;
      const alpha = closed ? 0.16 : 1;
      for (const car of lane.cars) {
        // Never let ghost traffic slide through the chicken. The driver stands
        // on the closed lane at the gate, so nearby cars are simply omitted.
        if (closed && Math.abs(laneX - chicken) < 72 && Math.abs(car.y - centerY) < car.len / 2 + 58) continue;
        drawCar(car, lane, laneX, alpha);
      }
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- Chicken art
  function chickenX() {
    if (!state.hop) return posX(state.pos);
    const p = clamp(state.hop.t / state.hop.dur, 0, 1);
    return lerp(state.hop.x0, state.hop.x1, easeInOut(p));
  }

  // The selected mascot artwork is split into layered SVG sprites so each
  // part can still move independently. All layers share one crop, so their
  // local coordinates line up exactly when drawn on top of each other.
  const CHICKEN_ART = {
    // The selected artwork is cropped to x=76.5, y=0, 391x427 SVG units.
    drawH: 104,
    drawW: 104 * 391 / 427,
    offsetX: -(104 * 391 / 427) / 2,
    offsetY: -60,
    rasterScale: 3,
    parts: {
      tail: 'assets/chicken/tail.svg',
      body: 'assets/chicken/body.svg',
      legs: 'assets/chicken/legs.svg',
      wing: 'assets/chicken/wing.svg',
      head: 'assets/chicken/head.svg',
      comb: 'assets/chicken/comb.svg',
      beak: 'assets/chicken/beak.svg',
      wattle: 'assets/chicken/wattle.svg',
      eye: 'assets/chicken/eye.svg',
    },
    pivots: {
      tail: { x: -23.6, y: -14.9 },
      wing: { x: 14.1, y: -5.2 },
      head: { x: 16.5, y: -16.2 },
      eye: { x: 17.2, y: -21.5 },
      legs: { x: 4.4, y: 20.4 },
    },
  };

  const chickenSprites = Object.create(null);

  function loadChickenSprites() {
    const entries = Object.entries(CHICKEN_ART.parts);
    const rasterW = Math.round(CHICKEN_ART.drawW * CHICKEN_ART.rasterScale);
    const rasterH = Math.round(CHICKEN_ART.drawH * CHICKEN_ART.rasterScale);
    for (const [part, src] of entries) {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        try {
          const off = document.createElement('canvas');
          off.width = rasterW;
          off.height = rasterH;
          const octx = off.getContext('2d');
          octx.imageSmoothingEnabled = true;
          octx.imageSmoothingQuality = 'high';
          octx.drawImage(img, 0, 0, rasterW, rasterH);
          chickenSprites[part] = off;
        } catch (err) {
          // Leave this layer out rather than break the race.
        }
      };
      img.src = src;
    }
  }

  function drawChickenSprite(part) {
    const sprite = chickenSprites[part];
    if (!sprite) return;
    ctx.drawImage(sprite, CHICKEN_ART.offsetX, CHICKEN_ART.offsetY, CHICKEN_ART.drawW, CHICKEN_ART.drawH);
  }

  function rotateChickenPart(pivot, angle) {
    ctx.translate(pivot.x, pivot.y);
    ctx.rotate(angle);
    ctx.translate(-pivot.x, -pivot.y);
  }

  function drawChicken(h) {
    const baseY = roadCenterY();
    const x = chickenX();
    let y = baseY;
    let hopLift = 0;
    let tilt = 0;
    let squash = 1;
    const flying = !!state.hop;
    const victory = state.phase === 'cashed' || state.phase === 'finished';
    const hopProgress = flying ? clamp(state.hop.t / state.hop.dur, 0, 1) : 0;

    if (state.hop) {
      hopLift = Math.sin(Math.PI * hopProgress) * 66;
      tilt = Math.cos(Math.PI * hopProgress) * 0.1;
      squash = 1 + Math.sin(Math.PI * hopProgress) * 0.06;
    } else if (state.phase === 'idle') {
      y += Math.sin(state.time * 3.4) * 1.4;
    } else if (victory) {
      y -= Math.abs(Math.sin(state.time * 8)) * 12;
    }
    y -= hopLift;

    // Shadow stays on the track while the driver jumps.
    const shadowScale = clamp(1 - hopLift / 160, 0.5, 1);
    // Warm track lighting ties the original SVG mascot into the miniature
    // circuit without changing its size, crop, or movement.
    ctx.save();
    const pool = ctx.createRadialGradient(x, baseY + 20, 4, x, baseY + 20, 62);
    pool.addColorStop(0, 'rgba(255,196,0,0.12)');
    pool.addColorStop(0.48, 'rgba(255,196,0,0.055)');
    pool.addColorStop(1, 'rgba(255,196,0,0)');
    ctx.fillStyle = pool;
    ctx.fillRect(x - 64, baseY - 44, 128, 112);
    ctx.strokeStyle = 'rgba(255,196,0,0.2)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(x, baseY + 35, 35, 9, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.38;
    ctx.fillStyle = '#040507';
    ctx.beginPath();
    ctx.ellipse(x, baseY + 38, 34 * shadowScale, 8.5 * shadowScale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    if (state.phase === 'crashed') {
      ctx.translate(0, 17);
      ctx.rotate(-1.18);
      ctx.scale(1.12, 0.7);
    } else {
      ctx.scale(1.06, 1.06 * squash);
    }

    const t = state.time;
    const run = Math.sin(t * (flying ? 16 : 9.5));
    const bob = flying ? 0 : Math.abs(Math.sin(t * 9.5)) * 1.5;
    ctx.translate(0, -bob + (victory ? -Math.abs(Math.sin(t * 8)) * 8 : 0));

    // Speed streaks while jumping.
    if (flying) {
      ctx.strokeStyle = 'rgba(255,224,102,0.4)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(-42 - i * 8, -18 + i * 16);
        ctx.lineTo(-62 - i * 10, -18 + i * 16);
        ctx.stroke();
      }
    }

    const tailAngle = victory
      ? Math.sin(t * 12) * 0.1
      : Math.sin(t * 2.7) * 0.045 + (flying ? Math.sin(t * 18) * 0.02 : 0);
    const headAngle = victory
      ? Math.sin(t * 9) * 0.05
      : Math.sin(t * 2.1 + 0.7) * 0.035 + (flying ? Math.sin(t * 14) * 0.02 : 0);
    const wingAngle = victory
      ? 0.2 + Math.sin(t * 10) * 0.1
      : flying
        ? 0.16 + Math.sin(t * 22) * 0.12
        : Math.sin(t * 3.1) * 0.025;
    const legTuck = flying ? -Math.sin(Math.PI * hopProgress) * 4.4 : 0;

    // Tail feathers.
    ctx.save();
    rotateChickenPart(CHICKEN_ART.pivots.tail, tailAngle);
    drawChickenSprite('tail');
    ctx.restore();

    // Body.
    drawChickenSprite('body');

    // Legs and feet.
    ctx.save();
    ctx.translate(0, legTuck);
    rotateChickenPart(CHICKEN_ART.pivots.legs, run * 0.012);
    drawChickenSprite('legs');
    ctx.restore();

    // Wing.
    ctx.save();
    rotateChickenPart(CHICKEN_ART.pivots.wing, wingAngle);
    drawChickenSprite('wing');
    ctx.restore();

    // Head, comb, beak, wattle and eyes move as one unit.
    ctx.save();
    rotateChickenPart(CHICKEN_ART.pivots.head, headAngle);
    drawChickenSprite('head');
    const blinkScale = state.blink > 0 ? 0.1 : 1;
    if (blinkScale !== 1) {
      const eye = CHICKEN_ART.pivots.eye;
      ctx.save();
      ctx.translate(eye.x, eye.y);
      ctx.scale(1, blinkScale);
      ctx.translate(-eye.x, -eye.y);
      drawChickenSprite('eye');
      ctx.restore();
    } else {
      drawChickenSprite('eye');
    }
    drawChickenSprite('comb');
    drawChickenSprite('beak');
    drawChickenSprite('wattle');
    ctx.restore();

    // Crash stars.
    if (state.phase === 'crashed') {
      ctx.fillStyle = ART.yellow;
      for (let i = 0; i < 4; i++) {
        const ang = state.time * 5 + i * Math.PI / 2;
        const sx = Math.cos(ang) * 36;
        const sy = -34 + Math.sin(ang) * 12;
        ctx.beginPath();
        ctx.arc(sx, sy, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  // ---------------------------------------------------------------- Finish gate
  function drawFinishGate(h) {
    const gx = SIDE_L + roadWidth() + SIDE_R * 0.56;
    const top = 26;
    const bottom = h - 26;

    // Yellow glow behind the gantry.
    const glow = ctx.createRadialGradient(gx, h * 0.5, 10, gx, h * 0.5, Math.max(70, h * 0.34));
    glow.addColorStop(0, 'rgba(255,196,0,0.14)');
    glow.addColorStop(1, 'rgba(255,196,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(gx - 70, 26, 140, h - 52);

    // Twin truss rails.
    ctx.strokeStyle = '#454b54';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(gx - 6, top);
    ctx.lineTo(gx - 6, bottom);
    ctx.moveTo(gx + 6, top);
    ctx.lineTo(gx + 6, bottom);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,196,0,0.55)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(gx - 2, top);
    ctx.lineTo(gx - 2, bottom);
    ctx.stroke();
    // Truss cross braces.
    ctx.strokeStyle = 'rgba(120,130,142,0.5)';
    ctx.lineWidth = 1.4;
    for (let y = top + 10; y < bottom - 10; y += 22) {
      ctx.beginPath();
      ctx.moveTo(gx - 6, y);
      ctx.lineTo(gx + 6, y + 11);
      ctx.moveTo(gx + 6, y);
      ctx.lineTo(gx - 6, y + 11);
      ctx.stroke();
    }

    // Checkered banners top and bottom.
    drawCheckeredStrip(gx - 21, top + 8, 42, 30, 6);
    drawCheckeredStrip(gx - 21, bottom - 38, 42, 30, 6);

    // Start/finish flags.
    ctx.fillStyle = ART.yellow;
    ctx.fillRect(gx + 16, top + 6, 3, 30);
    ctx.beginPath();
    ctx.moveTo(gx + 19, top + 6);
    ctx.lineTo(gx + 46, top + 13);
    ctx.lineTo(gx + 19, top + 22);
    ctx.closePath();
    ctx.fillStyle = ART.red;
    ctx.fill();
    ctx.fillStyle = 'rgba(247,245,236,0.85)';
    ctx.fillRect(gx + 24, top + 12, 6, 4);

    // Ground shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(gx - 10, bottom - 4, 26, 4);
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
    bg.addColorStop(0, '#17212C');
    bg.addColorStop(0.5, '#202B37');
    bg.addColorStop(1, '#121A23');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const shakeX = state.shake > 0 ? rand(-4, 4) : 0;
    const shakeY = state.shake > 0 ? rand(-3, 3) : 0;

    ctx.save();
    ctx.translate(-state.cameraX + shakeX, shakeY);

    drawWorld(h);
    drawCheckpointMarkers(h);
    drawFinishGate(h);
    drawVehicles(h);
    drawFences(h);
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
    // Preserve the original lane-centre collision geometry and probabilities;
    // the racing checkpoint position is presentation only.
    const x = collisionX();
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
    for (const fence of state.fences) fence.t = Math.min(1, fence.t + dt / 0.42);
    if (state.checkFx) {
      state.checkFx.t += dt;
      if (state.checkFx.t > 0.8) state.checkFx = null;
    }
    updateTraffic(dt);
    updateHop(dt);
    checkCollision();
    if (state.pendingCheckpoint != null) {
      if (state.phase !== 'crashed') confirmCheckpoint(state.pendingCheckpoint);
      state.pendingCheckpoint = null;
    }
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
    integrationRetryBtn?.addEventListener('click', loadIntegratedSession);
    goBtn.addEventListener('click', hop);
    cashBtn.addEventListener('click', cashOut);
    resultBtn.addEventListener('click', () => {
      startAudio();
      hideResult();
      resetToIdle();
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
      // Locked only while a round is genuinely in progress. A crashed,
      // cashed-out or completed round no longer owns the selector.
      if (state.phase === 'playing') return;
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
    if (integrated) {
      walletOpen.setAttribute('role', 'button');
      walletOpen.setAttribute('tabindex', '0');
      walletOpen.setAttribute('aria-label', 'Open wallet and recent transactions');
      $('integratedGameTitle').hidden = false;
      $('depositOpen').hidden = false;
      $('menuFullscreen').hidden = false;
      $('menuResponsible').hidden = false;
      walletOpen.addEventListener('click', () => {
        if (sharedShell) parent.postMessage({ type: 'fetan-open-wallet' }, location.origin);
        else {
          openAccountSheet(walletSheet, walletOpen);
          refreshAuthoritativeBalance().catch(() => {});
          loadRecentTransactions();
        }
      });
      walletOpen.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); walletOpen.click(); }
      });
      depositOpen.addEventListener('click', () => sharedShell
        ? parent.postMessage({ type: 'fetan-open-deposit' }, location.origin)
        : openDepositSheet(depositOpen));
      $('lowBalanceDeposit')?.addEventListener('click', () => sharedShell
        ? parent.postMessage({ type: 'fetan-open-deposit' }, location.origin)
        : openDepositSheet($('lowBalanceDeposit')));
      $('walletSheetDeposit').addEventListener('click', () => sharedShell
        ? parent.postMessage({ type: 'fetan-open-deposit' }, location.origin)
        : openDepositSheet(depositOpen));
      $('walletSheetWithdraw').addEventListener('click', () => navigateCustomer('withdraw'));
      $('walletSheetRefresh').addEventListener('click', () => {
        refreshAuthoritativeBalance().catch(() => {});
        loadRecentTransactions();
      });
      $('gameDepositForm').addEventListener('submit', submitGameDeposit);
      $('gameDepositReceipt').addEventListener('change', handleDepositReceipt);
      document.querySelectorAll('[data-deposit-amount]').forEach((button) => {
        button.addEventListener('click', () => {
          $('gameDepositAmount').value = button.dataset.depositAmount;
          document.querySelectorAll('[data-deposit-amount]').forEach((item) => item.classList.toggle('active', item === button));
        });
      });
      $('gameDepositAmount').addEventListener('input', () => {
        document.querySelectorAll('[data-deposit-amount]').forEach((item) => item.classList.toggle('active', item.dataset.depositAmount === $('gameDepositAmount').value));
      });
      [walletSheet, depositSheet].forEach((sheet) => {
        sheet.addEventListener('click', (event) => {
          if (event.target === sheet || event.target.closest('[data-sheet-close]')) closeAccountSheet();
        });
        let touchStartY = null;
        const handle = sheet.querySelector('.sheet-handle');
        handle?.addEventListener('pointerdown', (event) => { touchStartY = event.clientY; });
        handle?.addEventListener('pointerup', (event) => {
          if (touchStartY !== null && event.clientY - touchStartY > 56) closeAccountSheet();
          touchStartY = null;
        });
        handle?.addEventListener('pointercancel', () => { touchStartY = null; });
      });
      $('menuFullscreen').addEventListener('click', () => {
        closeModal(menuModal);
        try {
          const parentDocument = parent.document;
          if (parentDocument.fullscreenElement) {
            parent.__fetanManualChickenFullscreenExit = true;
            parentDocument.exitFullscreen().catch(() => {});
          } else if (document.querySelector('.app')?.requestFullscreen) {
            parent.__fetanManualChickenFullscreenExit = false;
            document.querySelector('.app').requestFullscreen().catch(() => {});
          } else {
            $('fullscreenState').textContent = 'Unavailable';
          }
        } catch (_) {
          $('fullscreenState').textContent = 'Unavailable';
        }
      });
      $('menuResponsible').addEventListener('click', (event) => {
        event.preventDefault();
        closeModal(menuModal);
        navigateCustomer('support');
      });
      syncAccountSheetState();
    }
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
      if (activeAccountSheet) {
        if (e.key === 'Escape') { e.preventDefault(); closeAccountSheet(); }
        else if (e.key === 'Tab') trapSheetFocus(e);
        return;
      }
      if (e.code === 'Escape') {
        if (document.querySelector('.modal.open')) {
          closeAllModals();
          return;
        }
        if (integrated && parent !== window) {
          parent.postMessage({ type: 'fetan-game-close' }, location.origin);
          return;
        }
        closeAllModals();
        return;
      }
      if (document.querySelector('.modal.open')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        startAudio();
        if (state.resultShown) {
          hideResult();
          resetToIdle();
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
    document.addEventListener('visibilitychange', syncWakeLockState);
    window.addEventListener('pagehide', releaseWakeLock, { once: true });

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
    if (integrated && $('fullscreenState')) {
      let available = false, active = false;
      try {
        available = Boolean(parent.document.fullscreenEnabled && document.querySelector('.app')?.requestFullscreen);
        active = Boolean(parent.document.fullscreenElement);
      } catch (_) { /* The regular embedded layout remains available. */ }
      $('fullscreenState').textContent = available ? (active ? 'On' : 'Off') : 'Unavailable';
      $('menuFullscreen').disabled = !available;
    }
  }

  // ---------------------------------------------------------------- Resize / init
  function resize() {
    const rect = stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    SIDE_L = w < 360 ? 128 : 200;
    // Fill wide arcade stages with the existing finish-side scenery rather
    // than leaving an unused strip beyond the track. Lane and car geometry
    // stay fixed, so this only changes the decorative apron width.
    SIDE_R = Math.max(190, w - SIDE_L - roadWidth());
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
    if (sharedShell) {
      window.addEventListener('message', (event) => {
        if (event.origin !== location.origin || event.source !== parent || event.data?.type !== 'fetan-shell-action') return;
        const action = event.data.action;
        if (action === 'critical' && !cashBtn.disabled) cashBtn.click();
        else if (action === 'sound') soundBtn.click();
        else if (action === 'how') menuHow?.click();
        else if (action === 'history') menuBtn.click();
      });
    }
    updateHUD();
    if (integrated) stageHint.textContent = 'Fetan Bet wallet · server-committed crossings';
    resize();
    resetTraffic();
    loadChickenSprites();
    bindEvents();
    updateLiveTicker();
    if (!integrated) setInterval(updateLiveTicker, 5200);
    if (new URLSearchParams(location.search).has('debug')) {
      window.__chickenDebug = { state, hop, cashOut, startRound, updateHUD, resetTraffic, resetFences, confirmCheckpoint, collisionX, posX, confirmedCheckpoints, chickenSprites, chickenX };
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
      loadIntegratedSession();
    }
  }

  init();
})();
