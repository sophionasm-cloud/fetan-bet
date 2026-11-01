/* Penalty Unlimited — original canvas recreation.
 * Vanilla JS, no dependencies. Every visual is painted at runtime.
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
  const ladderEl = $('ladder');
  const stageMessage = $('stageMessage');
  const difficultyBtn = $('difficultyBtn');
  const difficultyLabel = $('difficultyLabel');
  const betMinus = $('betMinus');
  const betPlus = $('betPlus');
  const betAmountEl = $('betAmount');
  const shootBtn = $('shootBtn');
  const claimBtn = $('claimBtn');
  const claimValueEl = $('claimValue');
  const lastWinEl = $('lastWin');
  const howBtn = $('howBtn');
  const soundBtn = $('soundBtn');
  const soundOnIcon = $('soundOnIcon');
  const soundOffIcon = $('soundOffIcon');
  const fullscreenBtn = $('fullscreenBtn');
  const menuBtn = $('menuBtn');
  const resultOverlay = $('resultOverlay');
  const resultCard = $('resultCard');
  const resultKicker = $('resultKicker');
  const resultTitle = $('resultTitle');
  const resultAmount = $('resultAmount');
  const resultSub = $('resultSub');
  const resultBtn = $('resultBtn');
  const howModal = $('howModal');
  const menuModal = $('menuModal');
  const menuSound = $('menuSound');
  const menuMusic = $('menuMusic');
  const menuSoundState = $('menuSoundState');
  const menuMusicState = $('menuMusicState');
  const menuHow = $('menuHow');
  const menuReset = $('menuReset');
  const toastWrap = $('toastWrap');

  // ---------------------------------------------------------------- Constants
  const MIN_BET = 1;
  const MAX_BET = 500;
  const START_BALANCE = 1000000;
  const STORE_KEY = 'fetanbet.penalty.v1';
  const integrated = new URLSearchParams(location.search).get('fetan') === '1';
  const AIMS = ['left', 'center', 'right'];
  const BASE_LADDER = [0, 1.8, 3.37, 6.32, 11.86, 22.24];
  const LADDER_NODES = 7;

  const DIFFICULTY = {
    easy: { label: 'EASY', tell: 0.82, lean: 15, read: 'strong tell', speed: 1 },
    medium: { label: 'MEDIUM', tell: 0.58, lean: 9.5, read: 'subtle tell', speed: 1.15 },
    hard: { label: 'HARD', tell: 0.34, lean: 5.5, read: 'faint tell', speed: 1.3 },
  };

  // ---------------------------------------------------------------- Storage
  function readStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
    catch (e) { return {}; }
  }
  const saved = readStore();

  function saveStore() {
    try {
      if (integrated) {
        localStorage.setItem(STORE_KEY, JSON.stringify({ difficulty: state.difficulty, sound: state.sound, music: state.music }));
        return;
      }
      localStorage.setItem(STORE_KEY, JSON.stringify({
        balance: state.balance,
        bet: state.bet,
        difficulty: state.difficulty,
        lastWin: state.lastWin,
        sound: state.sound,
        music: state.music,
      }));
    } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------- Utils
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOut = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  const round2 = (v) => Math.round(v * 100) / 100;

  function fmtInt(n) {
    return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }
  function fmtMoney(n) {
    return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ETB';
  }
  function fmtPlain(n) {
    return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function grossPreviewBirr(stakeBirr, multiplier) {
    const stakeCents = BigInt(Math.round(Number(stakeBirr) * 100));
    const multiplierCents = BigInt(Math.round(Number(multiplier) * 100));
    return Number(stakeCents * multiplierCents / 100n) / 100;
  }
  function ladderValue(index) {
    if (index <= 0) return 0;
    if (index < BASE_LADDER.length) return BASE_LADDER[index];
    let v = BASE_LADDER[BASE_LADDER.length - 1];
    for (let i = BASE_LADDER.length - 1; i < index; i++) v = Math.round(v * 1.875 * 100) / 100;
    return v;
  }
  function fmtLadder(index) {
    if (integrated && state.serverLadder?.[index] !== undefined) {
      const value = state.serverLadder[index];
      return index <= 0 ? 'X0' : 'X' + (Number.isInteger(value) ? value : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));
    }
    const v = ladderValue(index);
    if (index <= 0) return 'X0';
    return 'X' + (Number.isInteger(v) ? v : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));
  }

  async function fetanApi(path, payload) {
    const response = await fetch(`/api/games/penalty${path}`, {
      method: payload === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers: payload === undefined ? {} : { 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'GENERIC');
    return data;
  }

  function nextActionId() {
    return crypto.randomUUID?.() || `penalty_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
  }

  function usePenaltyState(data) {
    state.balance = Number(data.balance || 0) / 100;
    const serverBet = Number(data.bet);
    if (data.active && Number.isSafeInteger(serverBet) && serverBet >= 100) {
      state.bet = clamp(serverBet / 100, MIN_BET, MAX_BET);
    }
    if (data.active && DIFFICULTY[data.difficulty]) state.difficulty = data.difficulty;
    state.streak = Number(data.streak || 0);
    state.currentMult = Number(data.multiplier || 0);
    state.serverLadder = Array.isArray(data.ladder) ? data.ladder : state.serverLadder;
    state.maxSafeStep = Number(data.max_safe_step || 0);
    state.remoteTell = data.tell || null;
    state.runActive = Boolean(data.active);
    state.phase = data.active ? 'ready' : 'idle';
    state.keeper = { dive: null, tell: state.remoteTell || 'center', lean: DIFFICULTY[state.difficulty].lean, phase: 0, idleSeed: rand(0, Math.PI * 2) };
    state.remoteReady = true;
    state.remoteBusy = false;
    state.pendingActionId = null;
    state.remoteResult = null;
    updateHUD();
  }

  function apiErrorMessage(error) {
    return ({ LOGIN: 'Please sign in again to play.', INSUFFICIENT: 'Your Fetan Bet wallet does not have enough balance.', ACTIVE_ROUND: 'An active Penalty round already exists; it has been restored.', STALE_ACTION: 'The round changed in another window. Its latest server state has been restored.', PAYOUT_LIMIT: 'The current stake has reached the safe settlement limit. Claim the current payout to finish this round.' })[error?.message] || 'The server could not complete that action. Check the round status and retry.';
  }

  // ---------------------------------------------------------------- State
  const state = {
    phase: 'idle', // idle | ready | shooting | goal | saved | claimed
    balance: integrated ? 0 : Number.isFinite(saved.balance) ? saved.balance : START_BALANCE,
    bet: clamp(Number(saved.bet) || 3, MIN_BET, MAX_BET),
    difficulty: DIFFICULTY[saved.difficulty] ? saved.difficulty : 'medium',
    lastWin: integrated ? 0 : Number(saved.lastWin) || 0,
    sound: saved.sound !== false,
    music: saved.music !== false,
    aim: 'center',
    streak: 0,
    currentMult: 0,
    runActive: false,
    keeper: null,
    serverLadder: [],
    maxSafeStep: 0,
    remoteTell: null,
    remoteReady: !integrated,
    remoteBusy: false,
    pendingActionId: null,
    remoteResult: null,
    shot: null,
    deflect: null,
    goalTimer: 0,
    resultTimer: 0,
    resultShown: false,
    lastOutcome: null,
    netRipple: 0,
    flash: 0,
    shake: 0,
    particles: [],
    scene: null,
    aimHitboxes: [],
    ballHitbox: null,
    viewW: 1,
    viewH: 1,
    dpr: 1,
    time: 0,
    started: false,
  };

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
  function startAudio() {
    if (!window.Sound) return;
    state.started = true;
    Sound.init();
    if (state.sound && state.music) Sound.startMusic('penalty');
  }
  function applySoundSettings() {
    if (!window.Sound) return;
    Sound.setEnabled(state.sound);
    Sound.setMusic(state.music && state.sound);
    if (state.sound && state.music && state.started) Sound.startMusic('penalty');
    syncSoundUI();
  }
  function play(name) {
    if (window.Sound && Sound[name]) Sound[name]();
  }

  // ---------------------------------------------------------------- Toast
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
  }

  // ---------------------------------------------------------------- HUD
  function setMessage(text) {
    stageMessage.textContent = text;
    stageMessage.classList.remove('hide');
  }

  function renderLadder() {
    const end = integrated && state.maxSafeStep ? Math.min(state.maxSafeStep, Math.max(LADDER_NODES - 1, state.streak + 2)) : Math.max(LADDER_NODES - 1, state.streak + 2);
    const start = Math.max(0, end - (LADDER_NODES - 1));
    const nodes = [];
    for (let i = start; i <= start + LADDER_NODES - 1; i++) {
      const done = i < state.streak;
      const active = i === state.streak;
      const claimable = active && state.runActive && state.streak > 0 &&
        (state.phase === 'ready' || state.phase === 'goal');
      nodes.push(`<div class="ladder-node ${done ? 'done' : ''} ${active ? 'active' : ''} ${claimable ? 'claimable' : ''}">
        <div class="node-dot"></div>
        <div class="node-label">${fmtLadder(i)}</div>
      </div>`);
    }
    ladderEl.innerHTML = nodes.join('');
  }

  function updateHUD() {
    balanceEl.textContent = integrated ? fmtMoney(state.balance) : `${fmtInt(state.balance)} ETB`;
    betAmountEl.textContent = fmtInt(state.bet);
    lastWinEl.innerHTML = `<i>ETB</i>${fmtPlain(state.lastWin)}`;
    const claimable = state.runActive && state.streak > 0 &&
      (state.phase === 'ready' || state.phase === 'goal');
    const payout = claimable ? grossPreviewBirr(state.bet, state.currentMult) : 0;
    claimValueEl.textContent = fmtMoney(payout);
    claimBtn.disabled = !claimable || (integrated && (state.remoteBusy || !state.remoteReady));
    shootBtn.disabled = !(state.phase === 'idle' || state.phase === 'ready') || (integrated && (!state.remoteReady || state.remoteBusy || (state.runActive && state.streak >= state.maxSafeStep)));
    const locked = state.runActive || state.phase === 'shooting' || state.phase === 'goal' || state.phase === 'saved' || state.phase === 'claimed';
    difficultyBtn.disabled = locked || (integrated && (!state.remoteReady || state.remoteBusy));
    betMinus.disabled = locked || (integrated && (!state.remoteReady || state.remoteBusy));
    betPlus.disabled = locked || (integrated && (!state.remoteReady || state.remoteBusy));
    difficultyLabel.textContent = DIFFICULTY[state.difficulty].label;
    shootBtn.querySelector('span').textContent = integrated
      ? (state.runActive ? state.streak >= state.maxSafeStep ? 'CLAIM' : 'SHOOT' : state.remoteReady ? 'START' : 'LOADING')
      : state.runActive && state.streak > 0 ? 'NEXT' : 'SHOOT';
    if (integrated && state.runActive && state.maxSafeStep && state.streak >= state.maxSafeStep) {
      setMessage('Safe settlement limit reached. Claim the current payout to finish this round.');
    }
    renderLadder();
  }

  // ---------------------------------------------------------------- Scene layout
  function computeScene() {
    const w = state.viewW;
    const h = state.viewH;
    const goalW = Math.min(w * (w < 620 ? 0.82 : 0.56), h * 1.3);
    const goalH = Math.min(goalW * (w < 620 ? 0.58 : 0.44), h * 0.48);
    const goalX = (w - goalW) / 2;
    const goalY = Math.max(h * 0.17, 48);
    const goalBottom = Math.min(goalY + goalH, h * 0.68);
    const realGoalH = goalBottom - goalY;
    const ballY = goalBottom + Math.max(34, (h - goalBottom) * 0.56);
    const ballR = clamp(Math.min(w, h) * 0.078, 16, 46);
    const targets = {
      left: { x: goalX + goalW * 0.18, y: goalY + realGoalH * 0.56 },
      center: { x: goalX + goalW * 0.5, y: goalY + realGoalH * 0.43 },
      right: { x: goalX + goalW * 0.82, y: goalY + realGoalH * 0.56 },
    };
    return {
      w, h,
      goal: { x: goalX, y: goalY, w: goalW, h: realGoalH, bottom: goalBottom },
      ball: { x: w * 0.5, y: ballY, r: ballR },
      targets,
      wallTop: Math.max(30, h * 0.29),
      horizon: Math.max(26, h * 0.25),
      scale: realGoalH / 240,
    };
  }

  function rebuildScene() {
    state.scene = computeScene();
  }

  // ---------------------------------------------------------------- Round flow
  function prepareKeeper() {
    if (integrated) {
      state.keeper = {
        dive: null,
        tell: state.remoteTell || 'center',
        lean: DIFFICULTY[state.difficulty].lean,
        phase: 0,
        idleSeed: rand(0, Math.PI * 2),
      };
      return;
    }
    const cfg = DIFFICULTY[state.difficulty];
    const dive = pick(AIMS);
    let tell = dive;
    if (Math.random() > cfg.tell) {
      const others = AIMS.filter((a) => a !== dive);
      tell = pick(others);
    }
    state.keeper = {
      dive,
      tell,
      lean: cfg.lean,
      phase: 0,
      idleSeed: rand(0, Math.PI * 2),
    };
  }

  function resetToIdle() {
    state.phase = 'idle';
    state.runActive = false;
    state.streak = 0;
    state.currentMult = 0;
    state.shot = null;
    state.deflect = null;
    state.aim = 'center';
    prepareKeeper();
    updateHUD();
    setMessage('Pick a corner and beat the keeper');
  }

  function startNewRun() {
    startAudio();
    if (state.resultShown) hideResult();
    if (state.balance < MIN_BET) {
      state.balance = START_BALANCE;
      toast('Demo balance topped up to 1 000 000 ETB', 'good');
    }
    if (state.bet > state.balance) {
      toast('Not enough demo balance for that bet', 'bad');
      return false;
    }
    state.balance = round2(state.balance - state.bet);
    state.runActive = true;
    state.streak = 0;
    state.currentMult = 0;
    state.lastOutcome = null;
    state.shot = null;
    state.deflect = null;
    state.phase = 'ready';
    if (!state.keeper) prepareKeeper();
    saveStore();
    updateHUD();
    return true;
  }

  function shoot() {
    if (state.phase !== 'idle' && state.phase !== 'ready') return;
    startAudio();
    if (integrated) {
      if (!state.remoteReady || state.remoteBusy) return;
      if (state.phase === 'idle') {
        state.remoteBusy = true;
        updateHUD();
        fetanApi('/start', {
          bet: Math.round(state.bet * 100), difficulty: state.difficulty,
          client_seed: `fetan_penalty_${Date.now().toString(36)}`
        }).then((data) => {
          usePenaltyState(data);
          state.lastOutcome = null;
          state.shot = null;
          state.deflect = null;
          if (state.resultShown) hideResult();
          setMessage('Read the keeper, choose a corner, then shoot');
          play('click');
        }).catch(async (error) => {
          try { usePenaltyState(await fetanApi('/')); } catch { state.remoteReady = false; state.remoteBusy = false; updateHUD(); }
          toast(apiErrorMessage(error), 'bad');
        });
        return;
      }
      if (!state.runActive) return;
      if (state.streak >= state.maxSafeStep) {
        toast(apiErrorMessage(new Error('PAYOUT_LIMIT')), 'bad');
        return;
      }
      state.remoteBusy = true;
      state.pendingActionId ||= nextActionId();
      const actionId = state.pendingActionId;
      updateHUD();
      fetanApi('/shoot', { aim: state.aim, action_id: actionId, expected_step: state.streak }).then((data) => {
        state.pendingActionId = null;
        state.remoteBusy = false;
        state.remoteResult = data;
        state.balance = Number(data.balance || 0) / 100;
        state.serverLadder = data.ladder || state.serverLadder;
        state.maxSafeStep = Number(data.max_safe_step || state.maxSafeStep);
        state.remoteTell = data.next_tell;
        state.keeper = { dive: data.dive, tell: data.tell, lean: DIFFICULTY[state.difficulty].lean, phase: 0, idleSeed: rand(0, Math.PI * 2) };
        if (state.resultShown) hideResult();
        const sc = state.scene;
        const target = sc.targets[state.aim];
        state.shot = {
          t: 0, dur: 0.58, startX: sc.ball.x, startY: sc.ball.y, startR: sc.ball.r,
          targetX: target.x, targetY: target.y, aim: state.aim, dive: data.dive,
          saved: Boolean(data.saved), rot: 0, trail: [], outcome: null,
        };
        state.phase = 'shooting';
        state.netRipple = 0;
        setMessage('Kicked…');
        play('kick');
        updateHUD();
      }).catch(async (error) => {
        state.remoteBusy = false;
        if (error.message === 'STALE_ACTION') {
          state.pendingActionId = null;
          try { usePenaltyState(await fetanApi('/')); } catch { /* Keep the last confirmed round state. */ }
        }
        toast(apiErrorMessage(error), 'bad');
        updateHUD();
      });
      return;
    }
    if (state.phase === 'idle') {
      if (!startNewRun()) return;
    }
    if (state.phase !== 'ready') return;
    if (state.resultShown) hideResult();
    if (!state.keeper) prepareKeeper();
    const sc = state.scene;
    const target = sc.targets[state.aim];
    const saved = state.aim === state.keeper.dive;
    state.shot = {
      t: 0,
      dur: 0.58,
      startX: sc.ball.x,
      startY: sc.ball.y,
      startR: sc.ball.r,
      targetX: target.x,
      targetY: target.y,
      aim: state.aim,
      dive: state.keeper.dive,
      saved,
      rot: 0,
      trail: [],
      outcome: null,
    };
    state.phase = 'shooting';
    state.netRipple = 0;
    setMessage('Kicked…');
    play('kick');
    updateHUD();
  }

  function claim() {
    if ((state.phase !== 'ready' && state.phase !== 'goal') || !state.runActive || state.streak <= 0) return;
    if (integrated) {
      if (state.remoteBusy) return;
      state.remoteBusy = true;
      state.pendingActionId ||= nextActionId();
      const actionId = state.pendingActionId;
      updateHUD();
      fetanApi('/cashout', { action_id: actionId, expected_step: state.streak }).then((data) => {
        state.pendingActionId = null;
        state.remoteBusy = false;
        const payout = Number(data.payout || 0) / 100;
        state.balance = Number(data.balance || 0) / 100;
        state.lastWin = payout;
        state.currentMult = Number(data.multiplier || state.currentMult);
        state.phase = 'claimed';
        state.runActive = false;
        state.resultTimer = 0.85;
        state.lastOutcome = { type: 'claim', payout, net: Number(data.net || 0) / 100, mult: state.currentMult, goals: Number(data.streak || state.streak) };
        state.remoteResult = null;
        saveStore();
        play('cash');
        play('crowd');
        addConfetti(state.scene.w * 0.5, state.scene.h * 0.42, 90);
        state.flash = 0.18;
        setMessage('Winnings banked through Fetan Bet');
        updateHUD();
      }).catch(async (error) => {
        state.remoteBusy = false;
        if (error.message === 'STALE_ACTION') {
          state.pendingActionId = null;
          try { usePenaltyState(await fetanApi('/')); } catch { /* Keep the last confirmed round state. */ }
        }
        toast(apiErrorMessage(error), 'bad');
        updateHUD();
      });
      return;
    }
    const payout = round2(state.bet * state.currentMult);
    state.balance = round2(state.balance + payout);
    state.lastWin = payout;
    state.phase = 'claimed';
    state.runActive = false;
    state.resultTimer = 0.85;
    state.lastOutcome = { type: 'claim', payout, mult: state.currentMult, goals: state.streak };
    saveStore();
    play('cash');
    play('crowd');
    addConfetti(state.scene.w * 0.5, state.scene.h * 0.42, 90);
    state.flash = 0.18;
    setMessage('Winnings banked!');
    updateHUD();
  }

  function scoreGoal() {
    state.phase = 'goal';
    if (integrated && state.remoteResult) {
      state.streak = Number(state.remoteResult.streak);
      state.currentMult = Number(state.remoteResult.multiplier);
      state.balance = Number(state.remoteResult.balance || 0) / 100;
      state.remoteResult = null;
    } else {
      state.streak += 1;
      state.currentMult = ladderValue(state.streak);
    }
    state.goalTimer = 1.15;
    state.netRipple = 1;
    state.flash = 0.24;
    state.shake = 0.25;
    state.deflect = null;
    play('goal');
    play('crowd');
    addConfetti(state.shot.targetX, state.shot.targetY, 65);
    setMessage(`GOAL!  ${fmtLadder(state.streak)}  —  claim or shoot again`);
    updateHUD();
  }

  function keeperSave() {
    state.phase = 'saved';
    state.runActive = false;
    state.resultTimer = 1.2;
    state.shake = 0.5;
    state.lastOutcome = { type: 'save', streak: state.streak };
    if (integrated && state.remoteResult) {
      state.streak = Number(state.remoteResult.streak);
      state.balance = Number(state.remoteResult.balance || 0) / 100;
      state.remoteResult = null;
      state.lastOutcome.streak = state.streak;
    }
    const sc = state.scene;
    const dir = state.keeper.dive === 'left' ? -1 : state.keeper.dive === 'right' ? 1 : 0;
    state.deflect = {
      x: state.shot.targetX,
      y: state.shot.targetY,
      vx: (dir || (Math.random() < 0.5 ? -1 : 1)) * rand(140, 260),
      vy: rand(-130, -30),
      r: state.shot.startR * 0.62,
      rot: rand(0, 6),
      spin: rand(-10, 10),
      life: 1.3,
    };
    play('save');
    play('lose');
    addDust(state.shot.targetX, state.shot.targetY, 18);
    setMessage('SAVED!  The keeper got a glove to it');
    updateHUD();
  }

  function showResult(kind, title, amount, sub, kicker) {
    state.resultShown = true;
    state.phase = 'idle';
    state.runActive = false;
    state.shot = null;
    state.deflect = null;
    state.netRipple = 0;
    state.aim = 'center';
    resultCard.classList.remove('good', 'bad', 'gold');
    if (kind) resultCard.classList.add(kind);
    resultKicker.textContent = kicker || 'RUN OVER';
    resultTitle.textContent = title;
    resultAmount.textContent = amount;
    resultSub.textContent = sub;
    resultBtn.textContent = 'Take another penalty';
    resultOverlay.classList.add('show');
    prepareKeeper();
    updateHUD();
  }

  function hideResult() {
    state.resultShown = false;
    resultOverlay.classList.remove('show');
  }

  function scheduleResult() {
    if (state.resultShown || !state.lastOutcome) return;
    const out = state.lastOutcome;
    if (out.type === 'claim') {
      showResult('gold', 'CLAIMED!', fmtMoney(out.payout),
        `Bet ${fmtMoney(state.bet)} × ${fmtLadder(out.goals)} · ${out.goals} goal${out.goals === 1 ? '' : 's'}`, 'WINNINGS BANKED');
    } else {
      showResult('bad', 'SAVED!', fmtMoney(0),
        `The keeper ended your run after ${out.streak} goal${out.streak === 1 ? '' : 's'}. Read the tell and go again.`, 'RUN OVER');
    }
  }

  // ---------------------------------------------------------------- Bet / difficulty
  function setBet(value) {
    state.bet = clamp(Math.round(value), MIN_BET, MAX_BET);
    state.bet = Math.min(state.bet, Math.max(MIN_BET, Math.floor(state.balance)));
    saveStore();
    updateHUD();
  }
  function stepBet(dir) {
    const v = state.bet;
    let step = 1;
    if (v >= 100) step = 25;
    else if (v >= 50) step = 10;
    else if (v >= 10) step = 5;
    else if (v >= 5) step = 2;
    setBet(v + dir * step);
    play('click');
  }
  function cycleDifficulty() {
    const order = ['easy', 'medium', 'hard'];
    const i = order.indexOf(state.difficulty);
    state.difficulty = order[(i + 1) % order.length];
    prepareKeeper();
    saveStore();
    updateHUD();
    play('click');
    toast(`Difficulty: ${DIFFICULTY[state.difficulty].label} — ${DIFFICULTY[state.difficulty].read}`, 'good');
  }

  // ---------------------------------------------------------------- Aim
  function setAim(aim) {
    if (!AIMS.includes(aim)) return;
    if (state.phase !== 'idle' && state.phase !== 'ready') return;
    if (state.aim === aim) return;
    state.aim = aim;
    play('click');
  }

  function cycleAim(dir) {
    const i = AIMS.indexOf(state.aim);
    setAim(AIMS[(i + dir + AIMS.length) % AIMS.length]);
  }

  // ---------------------------------------------------------------- Particles
  function addDust(x, y, count) {
    for (let i = 0; i < count; i++) {
      state.particles.push({
        type: 'dust',
        x: x + rand(-12, 12),
        y: y + rand(-8, 8),
        vx: rand(-80, 80),
        vy: rand(-80, 20),
        life: rand(0.3, 0.6),
        max: 0.6,
        size: rand(2, 5),
        color: 'rgba(235,244,240,0.55)',
      });
    }
  }

  function addConfetti(x, y, count) {
    const palette = ['#ffd45a', '#ff6b78', '#4fe0a2', '#73a7ff', '#ffffff', '#ff9f4a', '#40e0d0'];
    for (let i = 0; i < count; i++) {
      state.particles.push({
        type: Math.random() < 0.18 ? 'coin' : 'confetti',
        x: x + rand(-30, 30),
        y: y + rand(-30, 30),
        vx: rand(-260, 260),
        vy: rand(-420, -100),
        life: rand(1, 1.9),
        max: 1.9,
        size: rand(3, 7),
        rot: rand(0, Math.PI * 2),
        spin: rand(-10, 10),
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
      if (p.type === 'dust') {
        p.vx *= 0.94;
        p.vy += 30 * dt;
        p.size += 6 * dt;
      } else {
        p.vy += 520 * dt;
        p.vx *= 0.99;
        p.rot += p.spin * dt;
      }
    }
  }

  function drawParticles() {
    for (const p of state.particles) {
      const alpha = clamp(p.life / (p.max * 0.7), 0, 1);
      ctx.save();
      ctx.globalAlpha = alpha;
      if (p.type === 'dust') {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === 'coin') {
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(Math.max(0.15, Math.abs(Math.cos(p.rot * 1.4))), 1);
        ctx.fillStyle = '#ffd04a';
        ctx.beginPath();
        ctx.arc(0, 0, p.size + 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#a66d00';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      } else {
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
      }
      ctx.restore();
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

  // ---------------------------------------------------------------- Sky & scenery
  function drawSky(sc) {
    const { w, h } = sc;
    const sky = ctx.createLinearGradient(0, 0, 0, sc.wallTop + 30);
    sky.addColorStop(0, '#0a111b');
    sky.addColorStop(0.48, '#172536');
    sky.addColorStop(1, '#263744');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // Sun
    const sunX = w * 0.17;
    const sunY = Math.max(36, h * 0.1);
    const sunR = Math.max(26, Math.min(w, h) * 0.075);
    const glow = ctx.createRadialGradient(sunX, sunY, 2, sunX, sunY, sunR * 2.4);
    glow.addColorStop(0, 'rgba(255,230,150,0.34)');
    glow.addColorStop(0.35, 'rgba(255,211,90,0.18)');
    glow.addColorStop(1, 'rgba(255,211,90,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR * 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,226,140,0.62)';
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR * 0.6, 0, Math.PI * 2);
    ctx.fill();

    // Clouds
    const cloud = (cx, cy, s, alpha) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#b9c7d4';
      ctx.beginPath();
      ctx.ellipse(cx, cy, 42 * s, 15 * s, 0, 0, Math.PI * 2);
      ctx.ellipse(cx - 27 * s, cy + 4 * s, 26 * s, 11 * s, 0, 0, Math.PI * 2);
      ctx.ellipse(cx + 30 * s, cy + 5 * s, 28 * s, 12 * s, 0, 0, Math.PI * 2);
      ctx.ellipse(cx + 2 * s, cy - 10 * s, 24 * s, 13 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
    cloud(w * 0.72, h * 0.12, 1.05, 0.7);
    cloud(w * 0.38, h * 0.07, 0.72, 0.48);
    cloud(w * 0.9, h * 0.2, 0.6, 0.42);

    // Distant sea
    const seaTop = sc.horizon;
    const seaBottom = sc.wallTop + 16;
    const sea = ctx.createLinearGradient(0, seaTop, 0, seaBottom);
    sea.addColorStop(0, '#142b3a');
    sea.addColorStop(0.55, '#1b3544');
    sea.addColorStop(1, '#263a43');
    ctx.fillStyle = sea;
    ctx.fillRect(0, seaTop, w, seaBottom - seaTop);
    ctx.fillStyle = 'rgba(143,190,205,0.16)';
    for (let i = 0; i < 14; i++) {
      const yy = seaTop + ((i * 37) % Math.max(1, seaBottom - seaTop));
      const xx = (i * 173) % w;
      ctx.fillRect(xx, yy, 20 + (i % 4) * 9, 1.2);
    }

    // Distant island / sand
    ctx.fillStyle = 'rgba(28, 60, 53, 0.72)';
    ctx.beginPath();
    ctx.moveTo(w * 0.18, seaTop + 9);
    ctx.quadraticCurveTo(w * 0.28, seaTop - 10, w * 0.4, seaTop + 8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(31, 40, 46, 0.96)';
    ctx.beginPath();
    ctx.moveTo(0, seaBottom - 6);
    ctx.quadraticCurveTo(w * 0.5, seaBottom + 8, w, seaBottom - 6);
    ctx.lineTo(w, seaBottom + 20);
    ctx.lineTo(0, seaBottom + 20);
    ctx.closePath();
    ctx.fill();
  }

  function drawPalm(x, groundY, height, lean, flip) {
    ctx.save();
    ctx.translate(x, groundY);
    ctx.scale(flip ? -1 : 1, 1);
    const topX = lean * height * 0.28;
    const topY = -height;
    // trunk
    const trunk = ctx.createLinearGradient(0, 0, topX, topY);
    trunk.addColorStop(0, '#34434a');
    trunk.addColorStop(0.55, '#526168');
    trunk.addColorStop(1, '#75858a');
    ctx.strokeStyle = trunk;
    ctx.lineWidth = Math.max(7, height * 0.055);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(lean * 10, -height * 0.35, topX * 0.5, -height * 0.7, topX, topY);
    ctx.stroke();
    // trunk rings
    ctx.strokeStyle = 'rgba(13,23,29,0.5)';
    ctx.lineWidth = Math.max(1, height * 0.009);
    for (let i = 1; i < 8; i++) {
      const t = i / 8;
      const px = lean * height * 0.28 * t * t;
      const py = -height * t;
      ctx.beginPath();
      ctx.moveTo(px - 5, py);
      ctx.lineTo(px + 5, py + 1);
      ctx.stroke();
    }
    // fronds
    const fronds = [
      [-0.95, 0.2], [-0.7, -0.3], [-0.25, -0.55], [0.2, -0.6],
      [0.7, -0.35], [1.05, 0.15], [0.6, 0.45], [-0.55, 0.5],
    ];
    for (let i = 0; i < fronds.length; i++) {
      const [dx, dy] = fronds[i];
      const fx = topX + dx * height * 0.48;
      const fy = topY + dy * height * 0.3 + height * 0.12;
      ctx.strokeStyle = i % 2 === 0 ? '#276b4a' : '#39845a';
      ctx.lineWidth = Math.max(3, height * 0.022);
      ctx.beginPath();
      ctx.moveTo(topX, topY);
      ctx.quadraticCurveTo(
        topX + dx * height * 0.22,
        topY - height * 0.16,
        fx, fy
      );
      ctx.stroke();
      // leaflets
      ctx.strokeStyle = 'rgba(24,73,52,0.86)';
      ctx.lineWidth = Math.max(1, height * 0.008);
      for (let k = 0.25; k < 1; k += 0.14) {
        const px = lerp(topX, fx, k);
        const py = lerp(topY, fy, k) - Math.sin(k * Math.PI) * height * 0.1;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + dx * height * 0.06, py + height * 0.055);
        ctx.stroke();
      }
    }
    // coconuts
    ctx.fillStyle = '#26343a';
    ctx.beginPath();
    ctx.arc(topX - 7, topY + 12, 4.5, 0, Math.PI * 2);
    ctx.arc(topX + 6, topY + 15, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawTag(x, y, scale, color, text, rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(scale, scale);
    ctx.font = '900 34px Montserrat, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.78;
    ctx.strokeStyle = 'rgba(20,22,30,0.8)';
    ctx.lineWidth = 7;
    ctx.strokeText(text, 0, 0);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3.5;
    ctx.strokeText(text, 0, 0);
    ctx.fillStyle = color;
    ctx.fillText(text, 0, 0);
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(-42, 22);
    ctx.quadraticCurveTo(0, 30, 48, 19);
    ctx.stroke();
    ctx.restore();
  }

  function drawWall(sc) {
    const { w, h } = sc;
    const top = sc.wallTop;
    const bottom = sc.goal.bottom + Math.max(8, h * 0.018);
    const wall = ctx.createLinearGradient(0, top, 0, bottom);
    wall.addColorStop(0, '#29343d');
    wall.addColorStop(0.5, '#222c35');
    wall.addColorStop(1, '#17212a');
    ctx.fillStyle = wall;
    ctx.fillRect(0, top, w, bottom - top);

    // Concrete panels
    ctx.strokeStyle = 'rgba(123, 155, 173, 0.12)';
    ctx.lineWidth = 1.5;
    const panel = Math.max(90, w / 9);
    for (let x = panel; x < w; x += panel) {
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
    }
    for (let y = top + 40; y < bottom; y += 46) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    // Wall cap and base shadow
    ctx.fillStyle = 'rgba(181,208,220,0.08)';
    ctx.fillRect(0, top, w, 5);
    ctx.fillStyle = 'rgba(2,7,12,0.34)';
    ctx.fillRect(0, bottom - 10, w, 10);

    // Cracks and stains
    ctx.strokeStyle = 'rgba(119,151,166,0.12)';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 10; i++) {
      const cx = (i * 137 + 40) % w;
      const cy = top + 22 + (i * 41) % Math.max(1, bottom - top - 30);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + 7, cy + 9);
      ctx.lineTo(cx + 1, cy + 18);
      ctx.lineTo(cx + 10, cy + 26);
      ctx.stroke();
    }
    // Graffiti
    drawTag(w * 0.09, top + 55, 0.72, '#d7b64d', 'GOAL', -0.06);
    drawTag(w * 0.87, top + 78, 0.76, '#75b9d7', 'PEN', 0.08);
    drawTag(w * 0.2, bottom - 38, 0.5, '#d7b64d', 'BEACH', 0.03);
    drawTag(w * 0.76, bottom - 30, 0.52, '#79bfa3', 'UNLTD', -0.05);
    // Abstract graffiti swirls
    ctx.save();
    ctx.globalAlpha = 0.62;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#927d57';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(w * 0.02, top + 108);
    ctx.bezierCurveTo(w * 0.06, top + 70, w * 0.12, top + 148, w * 0.16, top + 105);
    ctx.stroke();
    ctx.strokeStyle = '#d7b64d';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(w * 0.8, top + 34);
    ctx.bezierCurveTo(w * 0.85, top + 62, w * 0.9, top + 18, w * 0.95, top + 50);
    ctx.stroke();
    ctx.strokeStyle = '#64aabe';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(w * 0.02, bottom - 55);
    ctx.quadraticCurveTo(w * 0.08, bottom - 90, w * 0.14, bottom - 52);
    ctx.stroke();
    ctx.restore();

    // Fence posts along top
    ctx.fillStyle = 'rgba(50,56,63,0.55)';
    for (let x = 20; x < w; x += Math.max(120, w / 8)) {
      ctx.fillRect(x, top - 16, 4, 18);
    }
  }

  function drawPitch(sc) {
    const { w, h } = sc;
    const g = sc.goal;
    const top = g.bottom;

    // Terracotta track
    const track = ctx.createLinearGradient(0, top, 0, h);
    track.addColorStop(0, '#24323a');
    track.addColorStop(1, '#111a20');
    ctx.fillStyle = track;
    ctx.fillRect(0, top, w, h - top);
    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    for (let x = 0; x < w; x += 46) ctx.fillRect(x, top + 16, 20, 2);

    // Green pitch trapezoid
    const topLeft = g.x - g.w * 0.16;
    const topRight = g.x + g.w * 1.16;
    const bottomLeft = -w * 0.16;
    const bottomRight = w * 1.16;
    const green = ctx.createLinearGradient(0, top, 0, h);
    green.addColorStop(0, '#3d8c50');
    green.addColorStop(0.5, '#327a43');
    green.addColorStop(1, '#245d35');
    ctx.fillStyle = green;
    ctx.beginPath();
    ctx.moveTo(topLeft, top);
    ctx.lineTo(topRight, top);
    ctx.lineTo(bottomRight, h);
    ctx.lineTo(bottomLeft, h);
    ctx.closePath();
    ctx.fill();

    // Mowing stripes (perspective)
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(topLeft, top);
    ctx.lineTo(topRight, top);
    ctx.lineTo(bottomRight, h);
    ctx.lineTo(bottomLeft, h);
    ctx.closePath();
    ctx.clip();
    const stripes = 10;
    for (let i = 0; i < stripes; i += 2) {
      const t0 = i / stripes;
      const t1 = (i + 1) / stripes;
      const y0 = lerp(top, h, t0);
      const y1 = lerp(top, h, t1);
      const l0 = lerp(topLeft, bottomLeft, t0);
      const r0 = lerp(topRight, bottomRight, t0);
      const l1 = lerp(topLeft, bottomLeft, t1);
      const r1 = lerp(topRight, bottomRight, t1);
      ctx.fillStyle = 'rgba(255,255,255,0.045)';
      ctx.beginPath();
      ctx.moveTo(l0, y0);
      ctx.lineTo(r0, y0);
      ctx.lineTo(r1, y1);
      ctx.lineTo(l1, y1);
      ctx.closePath();
      ctx.fill();
    }
    // Grass texture
    ctx.fillStyle = 'rgba(210,255,210,0.09)';
    for (let i = 0; i < 100; i++) {
      const yy = top + ((i * 61) % Math.max(1, h - top));
      const xx = ((i * 173) % w);
      ctx.fillRect(xx, yy, 2, 3);
    }
    ctx.restore();

    // Goal line
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = Math.max(2, h * 0.004);
    ctx.beginPath();
    ctx.moveTo(g.x - g.w * 0.1, top);
    ctx.lineTo(g.x + g.w * 1.1, top);
    ctx.stroke();

    // Penalty box
    const boxTop = top + (h - top) * 0.3;
    const boxBottom = top + (h - top) * 0.64;
    const boxLeft = Math.max(10, g.x - g.w * 0.28);
    const boxRight = Math.min(w - 10, g.x + g.w * 1.28);
    ctx.strokeStyle = 'rgba(255,255,255,0.66)';
    ctx.lineWidth = Math.max(1.5, h * 0.0035);
    ctx.beginPath();
    ctx.moveTo(boxLeft, boxTop);
    ctx.lineTo(boxLeft, boxBottom);
    ctx.lineTo(boxRight, boxBottom);
    ctx.lineTo(boxRight, boxTop);
    ctx.stroke();

    // Penalty arc
    ctx.beginPath();
    ctx.arc(w / 2, boxBottom, Math.max(30, g.w * 0.16), Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();

    // Penalty spot
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.beginPath();
    ctx.ellipse(sc.ball.x, sc.ball.y + sc.ball.r * 0.65, sc.ball.r * 0.42, sc.ball.r * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();

    // Touchline shading
    const shade = ctx.createLinearGradient(0, h - 80, 0, h);
    shade.addColorStop(0, 'rgba(0,0,0,0)');
    shade.addColorStop(1, 'rgba(0,0,0,0.2)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, h - 80, w, 80);
  }

  function drawNet(sc) {
    const g = sc.goal;
    const ripple = state.netRipple;
    ctx.save();
    ctx.beginPath();
    ctx.rect(g.x, g.y, g.w, g.h);
    ctx.clip();
    ctx.fillStyle = 'rgba(226, 246, 255, 0.12)';
    ctx.fillRect(g.x, g.y, g.w, g.h);

    const stepX = Math.max(11, g.w / 30);
    const stepY = Math.max(9, g.h / 21);
    const wave = ripple > 0 ? Math.sin(state.time * 34) * 6 * ripple : 0;
    ctx.strokeStyle = 'rgba(245, 252, 255, 0.45)';
    ctx.lineWidth = 1;
    for (let x = g.x; x <= g.x + g.w; x += stepX) {
      const bend = Math.sin((x - g.x) * 0.035 + state.time * 18) * wave;
      ctx.beginPath();
      ctx.moveTo(x, g.y);
      ctx.lineTo(x + bend, g.y + g.h);
      ctx.stroke();
    }
    for (let y = g.y; y <= g.y + g.h; y += stepY) {
      const bend = Math.sin((y - g.y) * 0.06 + state.time * 20) * wave;
      ctx.beginPath();
      ctx.moveTo(g.x, y);
      ctx.lineTo(g.x + g.w, y + bend);
      ctx.stroke();
    }
    // Net depth diagonal
    ctx.strokeStyle = 'rgba(240,250,255,0.15)';
    ctx.beginPath();
    ctx.moveTo(g.x, g.y);
    ctx.lineTo(g.x + g.w * 0.08, g.y + g.h * 0.08);
    ctx.lineTo(g.x + g.w * 0.92, g.y + g.h * 0.08);
    ctx.lineTo(g.x + g.w, g.y);
    ctx.stroke();
    ctx.restore();
  }

  function drawGoalFrame(sc) {
    const g = sc.goal;
    const postW = Math.max(5, g.w * 0.012);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 4;
    const post = ctx.createLinearGradient(g.x, 0, g.x + g.w, 0);
    post.addColorStop(0, '#e9eef3');
    post.addColorStop(0.5, '#ffffff');
    post.addColorStop(1, '#c9d2dc');
    ctx.strokeStyle = post;
    ctx.lineWidth = postW;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(g.x, g.y);
    ctx.lineTo(g.x, g.bottom);
    ctx.moveTo(g.x + g.w, g.y);
    ctx.lineTo(g.x + g.w, g.bottom);
    ctx.moveTo(g.x - postW * 0.4, g.y);
    ctx.lineTo(g.x + g.w + postW * 0.4, g.y);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    // Post highlights
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = Math.max(1, postW * 0.24);
    ctx.beginPath();
    ctx.moveTo(g.x - postW * 0.2, g.y + 4);
    ctx.lineTo(g.x - postW * 0.2, g.bottom - 2);
    ctx.moveTo(g.x + g.w - postW * 0.2, g.y + 4);
    ctx.lineTo(g.x + g.w - postW * 0.2, g.bottom - 2);
    ctx.stroke();
    // Goal mouth shading
    const shade = ctx.createLinearGradient(0, g.y, 0, g.bottom);
    shade.addColorStop(0, 'rgba(20,40,60,0.1)');
    shade.addColorStop(1, 'rgba(20,40,60,0.02)');
    ctx.fillStyle = shade;
    ctx.fillRect(g.x + postW, g.y + postW, g.w - postW * 2, g.h - postW);
    ctx.restore();
  }

  // ---------------------------------------------------------------- Keeper
  function keeperPose() {
    const sc = state.scene;
    const g = sc.goal;
    const cfg = DIFFICULTY[state.difficulty];
    const centerX = g.x + g.w / 2;
    const groundY = g.bottom + 2;
    const idlePose = () => {
      const k = state.keeper;
      const tellDir = k ? (k.tell === 'left' ? -1 : k.tell === 'right' ? 1 : 0) : 0;
      const breathe = Math.sin(state.time * 2.4 + (k ? k.idleSeed : 0)) * 1.8;
      const leanPx = cfg.lean * Math.max(0.72, g.w / 620);
      return {
        x: centerX + tellDir * leanPx,
        y: groundY + breathe,
        rot: tellDir * 0.025,
        crouch: k && k.tell === 'center' ? 4 : 0,
        tellDir,
        diveDir: 0,
        diveT: 0,
        idle: true,
      };
    };
    if (state.phase === 'idle' || state.phase === 'ready' || state.phase === 'claimed') return idlePose();
    if (!state.shot) return idlePose();
    const raw = state.phase === 'shooting' ? clamp(state.shot.t * 1.28, 0, 1) : 1;
    const p = easeOut(raw);
    const dir = state.shot.dive === 'left' ? -1 : state.shot.dive === 'right' ? 1 : 0;
    if (dir === 0) {
      return {
        x: centerX,
        y: groundY + g.h * 0.025 * p,
        rot: 0,
        crouch: g.h * 0.04 * p,
        tellDir: 0,
        diveDir: 0,
        diveT: p,
        idle: false,
      };
    }
    return {
      x: centerX + dir * g.w * 0.245 * p,
      y: groundY - g.h * 0.075 * Math.sin(p * Math.PI * 0.5),
      rot: dir * 0.9 * p,
      crouch: 0,
      tellDir: 0,
      diveDir: dir,
      diveT: p,
      idle: false,
    };
  }

  function drawKeeper() {
    if (!state.keeper) return;
    const sc = state.scene;
    const g = sc.goal;
    const pose = keeperPose();
    const s = Math.max(0.55, g.h / 240);

    // Shadow
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#102010';
    ctx.beginPath();
    ctx.ellipse(pose.x, g.bottom + 4, 35 * s, 9 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(pose.x, pose.y);
    ctx.rotate(pose.rot);
    ctx.scale(s, s);
    if (pose.crouch) ctx.translate(0, pose.crouch);

    // Motion streaks on a dive
    if (!pose.idle && pose.diveT > 0.12 && pose.diveDir) {
      ctx.save();
      ctx.globalAlpha = 0.25 * pose.diveT;
      ctx.strokeStyle = '#eaf7ff';
      ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(-pose.diveDir * (38 + i * 14), -100 + i * 19);
        ctx.lineTo(-pose.diveDir * (78 + i * 20), -104 + i * 19);
        ctx.stroke();
      }
      ctx.restore();
    }

    const skin = '#d5976c';
    const skinDark = '#b97951';
    const kit = '#174b91';
    const kitLight = '#2a6bbd';
    const shorts = '#0f2f5c';
    const sock = '#e9f1f7';

    // Legs
    const legSpread = pose.idle ? 17 : pose.diveDir ? 10 : 13;
    for (const side of [-1, 1]) {
      const hipX = side * legSpread;
      const kneeX = side * (legSpread + (pose.idle ? 4 : 12));
      const footX = side * (legSpread + (pose.idle ? 7 : 18));
      ctx.strokeStyle = shorts;
      ctx.lineWidth = 14;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(hipX, -74);
      ctx.lineTo(kneeX, -39);
      ctx.stroke();
      // Sock
      ctx.strokeStyle = sock;
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(kneeX, -40);
      ctx.lineTo(footX, -9);
      ctx.stroke();
      // Boot
      ctx.fillStyle = '#ffd34d';
      ctx.strokeStyle = '#b17b00';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.ellipse(footX + side * 4, -4, 12, 6, side * 0.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Torso
    const jersey = ctx.createLinearGradient(-28, -145, 28, -72);
    jersey.addColorStop(0, kitLight);
    jersey.addColorStop(0.5, kit);
    jersey.addColorStop(1, '#0d356a');
    ctx.fillStyle = jersey;
    ctx.strokeStyle = '#082347';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-26, -141);
    ctx.quadraticCurveTo(-32, -110, -28, -73);
    ctx.quadraticCurveTo(0, -63, 28, -73);
    ctx.quadraticCurveTo(32, -110, 26, -141);
    ctx.quadraticCurveTo(0, -151, -26, -141);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Jersey stripe
    ctx.fillStyle = 'rgba(255,213,80,0.9)';
    ctx.fillRect(-27, -106, 54, 4);
    // Number
    ctx.fillStyle = '#ffe06a';
    ctx.font = '900 27px Montserrat, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('1', 0, -89);
    // Shoulder highlights
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-21, -137);
    ctx.quadraticCurveTo(-16, -119, -18, -109);
    ctx.stroke();

    // Arms and gloves
    const tellDir = pose.tellDir || 0;
    let leftGlove = { x: -51, y: -101 };
    let rightGlove = { x: 51, y: -101 };
    if (pose.idle) {
      if (tellDir < 0) {
        leftGlove = { x: -57, y: -127 };
        rightGlove = { x: 47, y: -92 };
      } else if (tellDir > 0) {
        leftGlove = { x: -47, y: -92 };
        rightGlove = { x: 57, y: -127 };
      } else {
        leftGlove = { x: -41, y: -92 };
        rightGlove = { x: 41, y: -92 };
      }
    } else if (pose.diveDir < 0) {
      leftGlove = { x: -78, y: -132 };
      rightGlove = { x: -35, y: -148 };
    } else if (pose.diveDir > 0) {
      leftGlove = { x: 35, y: -148 };
      rightGlove = { x: 78, y: -132 };
    } else {
      leftGlove = { x: -24, y: -83 };
      rightGlove = { x: 24, y: -83 };
    }
    const drawArm = (side, glove) => {
      const shoulder = { x: side * 24, y: -132 };
      const elbow = {
        x: lerp(shoulder.x, glove.x, 0.55) + side * (pose.idle ? 4 : 8),
        y: lerp(shoulder.y, glove.y, 0.55),
      };
      ctx.strokeStyle = skin;
      ctx.lineWidth = 10;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(shoulder.x, shoulder.y);
      ctx.lineTo(elbow.x, elbow.y);
      ctx.lineTo(glove.x, glove.y);
      ctx.stroke();
      // Sleeve
      ctx.strokeStyle = kit;
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.moveTo(shoulder.x, shoulder.y);
      ctx.lineTo(lerp(shoulder.x, elbow.x, 0.45), lerp(shoulder.y, elbow.y, 0.45));
      ctx.stroke();
      // Glove
      ctx.fillStyle = '#f4f7f5';
      ctx.strokeStyle = '#9aa6ad';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(glove.x, glove.y, 9.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffd34d';
      ctx.fillRect(glove.x - 9, glove.y - 3, 18, 6);
    };
    drawArm(-1, leftGlove);
    drawArm(1, rightGlove);

    // Neck and head
    ctx.strokeStyle = skin;
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(0, -144);
    ctx.lineTo(0, -153);
    ctx.stroke();
    ctx.fillStyle = skin;
    ctx.strokeStyle = skinDark;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(0, -169, 17, 20, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Hair
    ctx.fillStyle = '#2a201d';
    ctx.beginPath();
    ctx.arc(0, -178, 17, Math.PI * 0.94, Math.PI * 2.06);
    ctx.lineTo(14, -168);
    ctx.quadraticCurveTo(0, -175, -14, -168);
    ctx.closePath();
    ctx.fill();
    // Eyes
    ctx.fillStyle = '#1d1c24';
    ctx.beginPath();
    ctx.arc(-6, -169, 2.1, 0, Math.PI * 2);
    ctx.arc(6, -169, 2.1, 0, Math.PI * 2);
    ctx.fill();
    // Mouth
    ctx.strokeStyle = 'rgba(80,45,38,0.7)';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(-5, -160);
    ctx.quadraticCurveTo(0, -157, 5, -160);
    ctx.stroke();
    // Ear
    ctx.fillStyle = skinDark;
    ctx.beginPath();
    ctx.ellipse(-16, -168, 3.5, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Tell glint: small highlight on the leaning glove
    if (pose.idle && tellDir !== 0) {
      const gl = tellDir < 0 ? leftGlove : rightGlove;
      ctx.save();
      ctx.globalAlpha = 0.55 + Math.sin(state.time * 4) * 0.2;
      ctx.fillStyle = '#fff8c8';
      ctx.beginPath();
      ctx.arc(gl.x, gl.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }

  // ---------------------------------------------------------------- Ball
  function ballPose() {
    const sc = state.scene;
    if (state.deflect) {
      const d = state.deflect;
      return { x: d.x, y: d.y, r: d.r, rot: d.rot, flight: true };
    }
    if (state.shot) {
      const sh = state.shot;
      const p = state.phase === 'shooting' ? clamp(sh.t, 0, 1) : 1;
      const ep = easeOut(p);
      const x = (1 - ep) * (1 - ep) * sh.startX + 2 * (1 - ep) * ep * ((sh.startX + sh.targetX) / 2) + ep * ep * sh.targetX;
      const y = (1 - ep) * (1 - ep) * sh.startY + 2 * (1 - ep) * ep * (Math.min(sh.startY, sh.targetY) - sc.h * 0.13) + ep * ep * sh.targetY;
      const r = lerp(sh.startR, sh.startR * 0.48, ep);
      return { x, y, r, rot: p * 16, flight: true };
    }
    return { x: sc.ball.x, y: sc.ball.y, r: sc.ball.r, rot: 0, flight: false };
  }

  function drawSoccerBall(x, y, r, rot, flight) {
    if (r <= 0) return;
    ctx.save();
    // Shadow
    if (!flight) {
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = '#10200f';
      ctx.beginPath();
      ctx.ellipse(x, y + r * 0.95, r * 0.88, r * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.translate(x, y);
    ctx.rotate(rot);
    const g = ctx.createRadialGradient(-r * 0.36, -r * 0.42, r * 0.1, 0, 0, r * 1.08);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.6, '#f4f5f2');
    g.addColorStop(1, '#c4c9c4');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.98, 0, Math.PI * 2);
    ctx.clip();
    // Center pentagon
    ctx.fillStyle = '#1d2229';
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
      const px = Math.cos(a) * r * 0.3;
      const py = Math.sin(a) * r * 0.3;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    // Outer patches
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 5 + Math.PI / 5;
      const px = Math.cos(a) * r * 0.73;
      const py = Math.sin(a) * r * 0.73;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(a);
      ctx.fillStyle = '#252b33';
      ctx.beginPath();
      for (let k = 0; k < 5; k++) {
        const aa = -Math.PI / 2 + (k * Math.PI * 2) / 5;
        const kx = Math.cos(aa) * r * 0.17;
        const ky = Math.sin(aa) * r * 0.17;
        k ? ctx.lineTo(kx, ky) : ctx.moveTo(kx, ky);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    // Seams
    ctx.strokeStyle = 'rgba(60,66,72,0.55)';
    ctx.lineWidth = Math.max(0.8, r * 0.035);
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3);
      ctx.lineTo(Math.cos(a) * r * 0.72, Math.sin(a) * r * 0.72);
      ctx.stroke();
    }
    // Highlight
    const spec = ctx.createRadialGradient(-r * 0.38, -r * 0.48, 0, -r * 0.38, -r * 0.48, r * 0.55);
    spec.addColorStop(0, 'rgba(255,255,255,0.75)');
    spec.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = spec;
    ctx.beginPath();
    ctx.arc(-r * 0.35, -r * 0.4, r * 0.52, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(60,66,72,0.65)';
    ctx.lineWidth = Math.max(1, r * 0.04);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // ---------------------------------------------------------------- Aiming
  function drawAimTargets(sc) {
    if (state.phase !== 'idle' && state.phase !== 'ready') return;
    for (const aim of AIMS) {
      const t = sc.targets[aim];
      const active = state.aim === aim;
      const rr = Math.max(10, sc.goal.h * 0.075) * (active ? 1.15 : 1);
      ctx.save();
      ctx.globalAlpha = active ? 0.95 : 0.3;
      ctx.strokeStyle = active ? '#6dffae' : '#d8f7e8';
      ctx.lineWidth = active ? 2.4 : 1.3;
      ctx.shadowColor = active ? '#46ff9a' : 'transparent';
      ctx.shadowBlur = active ? 13 : 0;
      ctx.beginPath();
      ctx.arc(t.x, t.y, rr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(t.x - rr * 0.55, t.y);
      ctx.lineTo(t.x + rr * 0.55, t.y);
      ctx.moveTo(t.x, t.y - rr * 0.55);
      ctx.lineTo(t.x, t.y + rr * 0.55);
      ctx.stroke();
      ctx.restore();
    }
    // Dashed guide to the selected target
    const ball = sc.ball;
    const target = sc.targets[state.aim];
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = '#74ffb0';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([5, 8]);
    ctx.beginPath();
    ctx.moveTo(ball.x, ball.y - ball.r);
    ctx.quadraticCurveTo(
      (ball.x + target.x) / 2,
      Math.min(ball.y, target.y) - sc.h * 0.12,
      target.x, target.y
    );
    ctx.stroke();
    ctx.restore();
  }

  function drawAimArrows(sc) {
    state.aimHitboxes = [];
    state.ballHitbox = { x: sc.ball.x, y: sc.ball.y, r: Math.max(24, sc.ball.r * 1.18) };
    if (state.phase !== 'idle' && state.phase !== 'ready') return;
    const r = sc.ball.r;
    const specs = [
      { aim: 'left', x: sc.ball.x - r * 1.92, y: sc.ball.y - r * 0.08, angle: Math.PI },
      { aim: 'center', x: sc.ball.x, y: sc.ball.y - r * 2.02, angle: -Math.PI / 2 },
      { aim: 'right', x: sc.ball.x + r * 1.92, y: sc.ball.y - r * 0.08, angle: 0 },
    ];
    const baseR = Math.max(15, r * 0.58);
    for (const spec of specs) {
      const active = state.aim === spec.aim;
      const radius = active ? baseR * 1.16 : baseR;
      ctx.save();
      ctx.translate(spec.x, spec.y);
      ctx.globalAlpha = active ? 1 : 0.6;
      ctx.fillStyle = active ? 'rgba(52, 255, 142, 0.2)' : 'rgba(8, 26, 17, 0.4)';
      ctx.strokeStyle = active ? '#75ffb2' : 'rgba(197, 255, 221, 0.5)';
      ctx.lineWidth = active ? 2 : 1.2;
      ctx.shadowColor = active ? '#4dffa1' : 'transparent';
      ctx.shadowBlur = active ? 16 : 0;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.rotate(spec.angle);
      ctx.fillStyle = active ? '#7dffb8' : 'rgba(220,255,236,0.7)';
      ctx.beginPath();
      ctx.moveTo(radius * 0.62, 0);
      ctx.lineTo(-radius * 0.25, -radius * 0.38);
      ctx.lineTo(-radius * 0.08, 0);
      ctx.lineTo(-radius * 0.25, radius * 0.38);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      state.aimHitboxes.push({ aim: spec.aim, x: spec.x, y: spec.y, r: Math.max(18, radius * 1.35) });
    }
  }

  // ---------------------------------------------------------------- Scene render
  function render() {
    const w = state.viewW;
    const h = state.viewH;
    if (w < 2 || h < 2) return;
    if (!state.scene) rebuildScene();
    const sc = state.scene;

    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const shakeX = state.shake > 0 ? rand(-4, 4) : 0;
    const shakeY = state.shake > 0 ? rand(-3, 3) : 0;
    ctx.save();
    ctx.translate(shakeX, shakeY);

    drawSky(sc);
    drawWall(sc);
    drawPalm(w * 0.038, sc.goal.bottom + h * 0.02, h * 0.45, 0.72, false);
    drawPalm(w * 0.962, sc.goal.bottom + h * 0.02, h * 0.42, -0.78, true);
    drawPalm(w * 0.125, sc.goal.bottom + h * 0.03, h * 0.31, 0.5, false);
    drawPalm(w * 0.878, sc.goal.bottom + h * 0.03, h * 0.34, -0.55, true);
    drawNet(sc);
    drawPitch(sc);
    drawGoalFrame(sc);
    drawAimTargets(sc);
    drawKeeper();
    drawBallTrail();
    const bp = ballPose();
    drawSoccerBall(bp.x, bp.y, bp.r, bp.rot, bp.flight);
    drawAimArrows(sc);
    drawParticles();

    ctx.restore();

    // Flash and vignette
    if (state.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${state.flash * 0.45})`;
      ctx.fillRect(0, 0, w, h);
    }
    const vg = ctx.createRadialGradient(w * 0.5, h * 0.48, h * 0.28, w * 0.5, h * 0.48, Math.max(w, h) * 0.78);
    vg.addColorStop(0, 'rgba(3,8,12,0)');
    vg.addColorStop(1, 'rgba(3,8,12,0.28)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
  }

  // ---------------------------------------------------------------- Shot & simulation
  function drawBallTrail() {
    if (!state.shot || !state.shot.trail || state.phase !== 'shooting') return;
    for (let i = 0; i < state.shot.trail.length; i++) {
      const t = state.shot.trail[i];
      const a = (i + 1) / state.shot.trail.length;
      ctx.save();
      ctx.globalAlpha = a * 0.22;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r * (0.5 + a * 0.4), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function finishShot() {
    const shot = state.shot;
    if (!shot) return;
    shot.t = 1;
    if (shot.saved) keeperSave();
    else scoreGoal();
  }

  function updateShot(dt) {
    if (state.phase !== 'shooting' || !state.shot) return;
    const shot = state.shot;
    shot.t += dt / shot.dur;
    if (shot.t > 1) shot.t = 1;
    const bp = ballPose();
    shot.trail.push({ x: bp.x, y: bp.y, r: bp.r });
    if (shot.trail.length > 12) shot.trail.shift();
    if (shot.t >= 1) finishShot();
  }

  function update(dt) {
    state.time += dt;
    state.shake = Math.max(0, state.shake - dt);
    state.flash = Math.max(0, state.flash - dt * 2.5);
    state.netRipple = Math.max(0, state.netRipple - dt * 1.6);
    updateShot(dt);
    updateParticles(dt);

    if (state.deflect) {
      const d = state.deflect;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.vy += 760 * dt;
      d.rot += d.spin * dt;
      d.life -= dt;
      if (d.life <= 0) state.deflect = null;
    }

    if (state.phase === 'goal') {
      state.goalTimer -= dt;
      if (state.goalTimer <= 0) {
        state.phase = 'ready';
        state.shot = null;
        state.deflect = null;
        prepareKeeper();
        updateHUD();
        setMessage('Next penalty — read the keeper, then shoot');
      }
    }

    if (state.phase === 'saved' || state.phase === 'claimed') {
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

  // ---------------------------------------------------------------- Pointer hit tests
  function pointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (state.viewW / Math.max(1, rect.width)),
      y: (e.clientY - rect.top) * (state.viewH / Math.max(1, rect.height)),
    };
  }

  function hitAim(x, y) {
    for (const box of state.aimHitboxes) {
      if (Math.hypot(x - box.x, y - box.y) <= box.r) return box.aim;
    }
    return null;
  }

  function hitBall(x, y) {
    const b = state.ballHitbox;
    return b && Math.hypot(x - b.x, y - b.y) <= b.r;
  }

  function goalAimAt(x, y) {
    const sc = state.scene;
    if (!sc) return null;
    const g = sc.goal;
    if (x < g.x || x > g.x + g.w || y < g.y || y > g.bottom) return null;
    const rel = (x - g.x) / g.w;
    return rel < 0.36 ? 'left' : rel > 0.64 ? 'right' : 'center';
  }

  function updateCursor(x, y) {
    if (state.phase !== 'idle' && state.phase !== 'ready') {
      canvas.style.cursor = 'default';
      return;
    }
    if (hitBall(x, y) || hitAim(x, y) || goalAimAt(x, y)) canvas.style.cursor = 'pointer';
    else canvas.style.cursor = 'default';
  }

  // ---------------------------------------------------------------- Events
  function bindEvents() {
    shootBtn.addEventListener('click', shoot);
    claimBtn.addEventListener('click', claim);
    betMinus.addEventListener('click', () => stepBet(-1));
    betPlus.addEventListener('click', () => stepBet(1));
    difficultyBtn.addEventListener('click', () => {
      if (state.runActive) return;
      cycleDifficulty();
    });
    resultBtn.addEventListener('click', () => {
      hideResult();
      resetToIdle();
      startAudio();
      play('click');
    });

    howBtn.addEventListener('click', () => {
      startAudio();
      openModal(howModal);
    });
    menuBtn.addEventListener('click', () => {
      startAudio();
      syncSoundUI();
      openModal(menuModal);
    });
    soundBtn.addEventListener('click', () => {
      state.sound = !state.sound;
      applySoundSettings();
      saveStore();
      if (state.sound) play('click');
      toast(state.sound ? 'Sound on' : 'Sound muted');
    });
    fullscreenBtn.addEventListener('click', async () => {
      play('click');
      try {
        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen();
        } else {
          await document.exitFullscreen();
        }
      } catch (e) {
        toast('Fullscreen is not available in this browser', 'bad');
      }
    });

    menuSound.addEventListener('click', () => {
      state.sound = !state.sound;
      applySoundSettings();
      saveStore();
      if (state.sound) play('click');
    });
    menuMusic.addEventListener('click', () => {
      state.music = !state.music;
      applySoundSettings();
      saveStore();
      play('click');
    });
    menuHow.addEventListener('click', () => {
      closeModal(menuModal);
      setTimeout(() => openModal(howModal), 120);
    });
    menuReset.addEventListener('click', () => {
      if (state.runActive || state.phase === 'shooting' || state.phase === 'goal' || state.phase === 'saved' || state.phase === 'claimed') {
        toast('Finish the current run first', 'bad');
        return;
      }
      state.balance = START_BALANCE;
      state.lastWin = 0;
      hideResult();
      resetToIdle();
      saveStore();
      play('coin');
      toast('Demo balance reset to 1 000 000 ETB', 'good');
      closeModal(menuModal);
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
      if (e.button !== 0 || state.resultShown) return;
      const p = pointerPos(e);
      if (state.phase !== 'idle' && state.phase !== 'ready') return;
      const aim = hitAim(p.x, p.y);
      if (aim) {
        e.preventDefault();
        setAim(aim);
        return;
      }
      if (hitBall(p.x, p.y)) {
        e.preventDefault();
        shoot();
        return;
      }
      const goalAim = goalAimAt(p.x, p.y);
      if (goalAim) {
        e.preventDefault();
        setAim(goalAim);
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = pointerPos(e);
      updateCursor(p.x, p.y);
    });
    canvas.addEventListener('pointerleave', () => {
      canvas.style.cursor = 'default';
    });

    document.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        closeAllModals();
        return;
      }
      if (document.querySelector('.modal.open')) return;
      if (state.resultShown) {
        if (e.code === 'Space' || e.code === 'Enter') {
          e.preventDefault();
          hideResult();
          resetToIdle();
        }
        return;
      }
      if (e.code === 'ArrowLeft') {
        e.preventDefault();
        cycleAim(-1);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        cycleAim(1);
      } else if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        e.preventDefault();
        setAim('center');
      } else if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        shoot();
      } else if (e.code === 'KeyC') {
        e.preventDefault();
        claim();
      }
    });

    document.addEventListener('pointerdown', startAudio, { once: true });
    window.addEventListener('resize', resize);
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(resize);
      ro.observe(stage);
    }
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
    rebuildScene();
  }

  function init() {
    syncSoundUI();
    if (integrated) {
      const wallet = balanceEl.closest('.balance-pill');
      if (wallet) wallet.title = 'Fetan Bet wallet balance (ETB)';
      balanceEl.textContent = 'Loading…';
      menuReset.disabled = true;
      document.querySelectorAll('[data-fetan-back], a[href="../"]').forEach((link) => {
        link.addEventListener('click', (event) => {
          event.preventDefault();
          parent.postMessage({ type: 'fetan-game-close' }, location.origin);
        });
      });
      const menuDescription = document.querySelector('#menuModal .modal-card > p');
      if (menuDescription) menuDescription.textContent = 'Settings for your Fetan Bet game session.';
    }
    resize();
    prepareKeeper();
    updateHUD();
    bindEvents();
    if (new URLSearchParams(location.search).has('debug')) {
      window.__penaltyDebug = { state, shoot, claim, setAim, resetToIdle, prepareKeeper };
    }
    requestAnimationFrame(() => {
      resize();
      requestAnimationFrame(() => loader.classList.add('done'));
    });
    setTimeout(() => loader.classList.add('done'), 700);
    requestAnimationFrame(loop);
    if (integrated) {
      fetanApi('/').then(usePenaltyState).catch((error) => {
        state.remoteReady = false;
        state.remoteBusy = false;
        toast(apiErrorMessage(error), 'bad');
        updateHUD();
      });
    }
  }

  init();
})();

