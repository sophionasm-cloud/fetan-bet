'use strict';

// B2B Bomber customer controller.
//
// The browser never chooses an outcome. It polls the server snapshot, draws a
// presentation-only flight curve from the server's timestamps, and asks the
// server to settle a cash-out. The crash point and server seed are withheld
// until the round is settled.
(() => {
  const API = '/api/games/b2b-bomber';
  const N = 1n << 256n;
  const MAX_HUNDREDTHS = 10000;
  const MIN_HUNDREDTHS = 101;
  const MIN_BET = 100;
  const MAX_BET = 100000;
  const CURVE_DOUBLE_MS = 7000;
  const CURVE_RATE = Math.log(2) / CURVE_DOUBLE_MS;
  const ACTIVE_POLL_MS = 700;
  const IDLE_POLL_MS = 1600;
  const integrated = document.documentElement.classList.contains('fetan-integrated');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const $ = (id) => document.getElementById(id);
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const now = () => Date.now() + clockOffset;

  let clockOffset = 0;
  let state = null;
  let round = null;
  let busy = false;
  let pollTimer = null;
  let pollInFlight = false;
  let pollPaused = false;
  let stateRevision = 0;
  let lastResultRound = null;
  let lastResultAt = 0;
  let boomAt = 0;
  let lastMultiplier = -1;
  let lastPaintAt = 0;
  let lastCountdownSecond = -1;
  let gateShown = false;
  let fairnessData = null;
  let historyRoundId = null;
  const dismissedResults = new Set();

  const storeGet = (key) => {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  };
  const storeSet = (key, value) => {
    try { localStorage.setItem(key, value); } catch (_) { /* Preferences are optional. */ }
  };

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));

  function formatHundredths(hundredths) {
    const h = Math.max(0, Math.round(Number(hundredths) || 0));
    return `${Math.floor(h / 100)}.${String(h % 100).padStart(2, '0')}`;
  }

  function formatEtb(santim) {
    const value = Math.round(Number(santim) || 0);
    const sign = value < 0 ? '−' : '';
    const abs = Math.abs(value);
    return `${sign}${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
  }

  function formatEtbInput(santim) {
    const value = Math.max(0, Math.round(Number(santim) || 0));
    return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;
  }

  function parseSantim(text) {
    const cleaned = String(text ?? '').trim().replace(/,/g, '');
    if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(cleaned)) return null;
    const [whole, fraction = ''] = cleaned.split('.');
    const value = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    return Number.isSafeInteger(value) ? value : null;
  }

  function parseHundredths(text) {
    const value = parseSantim(text);
    return value == null ? null : value;
  }

  function parseUuid() {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID().toLowerCase();
    const bytes = new Uint8Array(16);
    if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function makeClientSeed() {
    const bytes = new Uint8Array(16);
    if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function sanitizeSeed(value) {
    return String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  }

  const dom = {
    balance: $('balance'), recent: $('recentList'), stage: $('stage'), sky: $('sky'),
    phase: $('phaseChip'), sync: $('syncDot'), multiplier: $('multiplier'),
    kicker: $('multKicker'), sub: $('multSub'), result: $('resultCard'),
    resultKicker: $('resultKicker'), resultTitle: $('resultTitle'),
    resultDetail: $('resultDetail'), resultExtra: $('resultExtra'),
    resultFair: $('resultFairBtn'), resultClose: $('resultClose'),
    potential: $('potentialPayout'), potentialLabel: $('potentialLabel'),
    autoBadge: $('autoBadge'), statePill: $('statePill'), form: $('betForm'),
    betInput: $('betInput'), stakeMinus: $('stakeMinus'), stakePlus: $('stakePlus'),
    quickStakes: $('quickStakes'), autoToggle: $('autoToggle'),
    autoWrap: $('autoTargetWrap'), autoInput: $('autoInput'), autoChips: $('autoChips'),
    previewMult: $('previewMult'), previewPayout: $('previewPayout'),
    action: $('actionBtn'), ctaMain: $('ctaMain'), ctaSub: $('ctaSub'),
    hint: $('actionHint'), commit: $('commitHash'), seed: $('clientSeed'),
    seedButton: $('seedBtn'), seedHint: $('seedHint'), fairVerify: $('fairVerifyBtn'),
    toast: $('toast'), toastText: $('toastText'), toastAction: $('toastAction'),
    toastClose: $('toastClose'), live: $('liveStatus'), gate: $('gate'),
    gateLink: $('gateLink'), how: $('howDialog'), fair: $('fairDialog'),
    history: $('historyDialog'), fairCommit: $('fairCommit'), fairClient: $('fairClient'),
    fairNonce: $('fairNonce'), fairOutput: $('fairOutput'), fairHint: $('fairVerifyHint'),
    fairVerifyRound: $('fairVerifyRound'), historyList: $('historyList'),
    historyStatus: $('historyStatus'), mobileCash: null,
  };

  const btnHow = [$('howBtn'), $('howBtn2')].filter(Boolean);
  const btnFair = [$('fairBtn'), $('fairBtn2')].filter(Boolean);
  const btnHistory = [$('historyBtn')].filter(Boolean);

  // ---------- transport ----------
  async function api(path, { method = 'GET', body = null, sentAt = Date.now() } = {}) {
    const response = await fetch(`${API}${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body == null ? undefined : { 'Content-Type': 'application/json' },
      body: body == null ? undefined : JSON.stringify(body),
    });
    let data = {};
    try { data = await response.json(); } catch (_) { data = {}; }
    if (!response.ok) {
      const error = new Error(data.error || `HTTP_${response.status}`);
      error.status = response.status;
      error.data = data;
      error.sentAt = sentAt;
      throw error;
    }
    data.__sentAt = sentAt;
    return data;
  }

  function friendlyError(error) {
    const code = String(error?.message || '');
    if (error?.status === 401 || code === 'LOGIN') return 'Your session has expired. Sign in again to fly.';
    if (code === 'WAGERING_DISABLED') return 'Wagering is currently disabled by the operator.';
    if (code === 'INSUFFICIENT') return 'Your wallet does not cover this stake.';
    if (code === 'ACTIVE_ROUND') return 'A sortie is already active. Finish it before placing another bet.';
    if (code === 'STALE_ACTION') return 'That request no longer matches the round. Refresh and try again.';
    if (code === 'NOT_FOUND') return 'That round could not be found on your account.';
    if (code === 'RATE') return 'Too many requests. The game will retry automatically.';
    if (code === 'INVALID') return 'That value is not valid for this sortie.';
    if (code.startsWith('HTTP_503')) return 'The game server is briefly unavailable. Retrying…';
    return 'Something went wrong. The game will refresh and retry.';
  }

  let toastTimer = null;
  let toastActionHandler = null;
  function showToast(message, { tone = '', actionLabel = '', action = null, sticky = false } = {}) {
    clearTimeout(toastTimer);
    dom.toast.hidden = false;
    dom.toast.dataset.tone = tone;
    dom.toastText.textContent = message;
    dom.toastAction.hidden = !actionLabel;
    dom.toastAction.textContent = actionLabel || '';
    toastActionHandler = action;
    if (!sticky) toastTimer = setTimeout(() => { dom.toast.hidden = true; }, 5200);
  }
  function hideToast() {
    clearTimeout(toastTimer);
    dom.toast.hidden = true;
    toastActionHandler = null;
  }

  function setHint(message, tone = '') {
    dom.hint.textContent = message;
    dom.hint.dataset.tone = tone;
  }

  function announce(message) {
    dom.live.textContent = '';
    requestAnimationFrame(() => { dom.live.textContent = message; });
  }

  // ---------- sound ----------
  let audioContext = null;
  let soundOn = storeGet('bb-sound') !== '0';
  const soundButton = $('soundBtn');
  function paintSound() {
    if (!soundButton) return;
    soundButton.setAttribute('aria-pressed', String(soundOn));
    soundButton.setAttribute('aria-label', soundOn ? 'Mute sound' : 'Enable sound');
    soundButton.title = soundOn ? 'Sound on' : 'Sound off';
  }
  function ensureAudio() {
    if (!soundOn) return null;
    try {
      audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
      return audioContext;
    } catch (_) { return null; }
  }
  function beep(frequency, duration = 0.08, type = 'sine', volume = 0.05, delay = 0) {
    if (!soundOn) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    try {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = type;
      oscillator.frequency.value = frequency;
      gain.gain.value = volume;
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      const start = ctx.currentTime + delay;
      oscillator.start(start);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.stop(start + duration);
    } catch (_) { /* Sound is optional. */ }
  }
  function playClick() { beep(880, 0.04, 'square', 0.025); }
  function playBet() { beep(440, 0.09, 'triangle', 0.05); beep(660, 0.12, 'triangle', 0.05, 0.08); }
  function playCashout() { [659, 880, 1047, 1319].forEach((freq, index) => beep(freq, 0.18, 'sine', 0.06, index * 0.075)); }
  function playCrash() { beep(92, 0.5, 'sawtooth', 0.09); beep(58, 0.65, 'square', 0.07, 0.08); }
  function playTick() { beep(1100, 0.025, 'square', 0.018); }
  function setSound(value) {
    soundOn = Boolean(value);
    storeSet('bb-sound', soundOn ? '1' : '0');
    paintSound();
    if (soundOn) { ensureAudio(); playClick(); }
  }

  // ---------- round clock ----------
  function serverNow() { return now(); }

  function phaseOf(item = round) {
    if (!item) return 'idle';
    if (!item.active) {
      if (item.result === 'lost') return 'lost';
      if (item.result === 'cashout' || item.result === 'auto_cashout') return 'won';
      return 'settled';
    }
    const time = serverNow();
    if (time < Number(item.starts_at)) return 'countdown';
    if (time < Number(item.flight_started_at)) return 'takeoff';
    return 'flying';
  }

  function liveHundredths() {
    if (!round) return 100;
    if (!round.active) return Number(round.cashout_hundredths || round.crash_hundredths || 100);
    const elapsed = serverNow() - Number(round.flight_started_at);
    if (!Number.isFinite(elapsed) || elapsed <= 0) return 100;
    const value = Math.floor(Math.exp(CURVE_RATE * elapsed) * 100);
    return clamp(value, 100, MAX_HUNDREDTHS);
  }

  function potentialSantim(hundredths = liveHundredths()) {
    if (!round || !round.bet_santim) return 0;
    return Math.floor((Number(round.bet_santim) * Number(hundredths)) / 100);
  }

  function roundDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  // ---------- state ----------
  function mergeState(data, source = 'poll') {
    if (!data) return;
    const previous = round;
    const wasActive = Boolean(previous?.active);
    if (data.server_now != null) {
      const received = Date.now();
      const sent = Number(data.__sentAt) || received;
      clockOffset = Number(data.server_now) - ((sent + received) / 2);
    }
    state = { ...(state || {}), ...data };
    if (!Array.isArray(state.recent)) state.recent = [];
    round = data.round || null;

    if (round && data.balance_santim != null) {
      state.balance_santim = Number(data.balance_santim);
      dom.balance.textContent = formatEtb(state.balance_santim);
    }
    if (state.balance_santim != null) dom.balance.textContent = formatEtb(state.balance_santim);

    if (round && wasActive && !round.active && previous.id === round.id) {
      lastResultRound = round.id;
      lastResultAt = performance.now();
      if (!dismissedResults.has(round.id)) {
        if (round.result === 'lost') { playCrash(); boomAt = performance.now(); }
        else playCashout();
      }
      postToShell({ type: 'fetan-wallet-refresh' });
      if (round.result === 'auto_cashout') {
        showToast('Auto cash-out settled by the server.', { tone: 'win' });
        announce(`Auto cash-out banked at ${formatHundredths(round.cashout_hundredths)}x.`);
      }
    }
    if (round && (!wasActive || previous.id !== round.id) && round.active) {
      hideResult();
      boomAt = 0;
    }
    if (!round) hideResult();

    renderAll();
    if (source === 'action') updatePreview();
  }

  function postToShell(message) {
    if (!integrated || window.parent === window) return;
    try { window.parent.postMessage(message, location.origin); } catch (_) { /* Shell optional. */ }
  }

  let lastShellState = '';
  function notifyShell() {
    if (!integrated) return;
    const active = Boolean(round?.active);
    const canAct = active && phaseOf() === 'flying';
    const actionLabel = canAct ? `Cash out ETB ${formatEtb(potentialSantim())}` : '';
    const serialized = JSON.stringify({ active, canAct, actionLabel });
    if (serialized === lastShellState) return;
    lastShellState = serialized;
    postToShell({ type: 'fetan-round-state', active, canAct, actionLabel });
  }

  // ---------- rendering ----------
  const phaseLabels = {
    idle: 'Ready', countdown: 'Betting closed', takeoff: 'Takeoff',
    flying: 'In flight', won: 'Banked', lost: 'Shot down', settled: 'Settled',
  };
  const statePill = {
    idle: ['ready', 'Ready'], countdown: ['countdown', 'Locked'],
    takeoff: ['takeoff', 'Takeoff'], flying: ['flying', 'Flying'],
    won: ['won', 'Banked'], lost: ['lost', 'Crashed'], settled: ['ready', 'Settled'],
  };

  function paintMultiplierText(value) {
    if (value === lastMultiplier) return;
    lastMultiplier = value;
    const node = dom.multiplier.firstChild;
    if (node) node.nodeValue = formatHundredths(value);
    else dom.multiplier.textContent = formatHundredths(value);
  }

  function showResult(item) {
    if (!item || item.active) return;
    const won = item.result === 'cashout' || item.result === 'auto_cashout';
    dom.result.hidden = false;
    dom.result.dataset.tone = won ? 'win' : 'loss';
    dom.resultKicker.textContent = won
      ? (item.result === 'auto_cashout' ? 'AUTO BANKED' : 'BANKED')
      : 'SHOT DOWN';
    dom.resultTitle.textContent = `${formatHundredths(won ? item.cashout_hundredths : item.crash_hundredths)}x`;
    dom.resultDetail.textContent = won
      ? `+ ETB ${formatEtb(item.payout_santim)}`
      : `− ETB ${formatEtb(item.bet_santim)}`;
    dom.resultExtra.textContent = won
      ? `Crash at ${formatHundredths(item.crash_hundredths)}x · stake ETB ${formatEtb(item.bet_santim)}`
      : (item.auto_cashout_hundredths ? `Auto target ${formatHundredths(item.auto_cashout_hundredths)}x was not reached.` : 'The bomber was hit before cash-out.');
    dom.resultFair.textContent = 'Verify round';
    dom.resultFair.dataset.roundId = String(item.id);
  }

  function hideResult() {
    dom.result.hidden = true;
    dom.resultFair.dataset.roundId = '';
  }

  function renderRecent() {
    const recent = Array.isArray(state?.recent) ? state.recent : [];
    if (!recent.length) {
      dom.recent.innerHTML = '<span class="bb-recent-empty">No sorties yet</span>';
      return;
    }
    dom.recent.innerHTML = recent.slice(0, 8).map((item) => {
      const label = `${formatHundredths(item.crash_hundredths)}x`;
      const title = item.result === 'lost'
        ? `Lost · crash ${label}`
        : `Banked ${formatHundredths(item.cashout_hundredths)}x · crash ${label}`;
      return `<span class="bb-recent-chip" role="listitem" data-result="${escapeHtml(item.result)}" title="${escapeHtml(title)}">${label}</span>`;
    }).join('');
  }

  function autoTargetValue() {
    const parsed = parseHundredths(dom.autoInput.value);
    return parsed == null ? null : parsed;
  }

  function updatePreview() {
    const bet = parseSantim(dom.betInput.value);
    const autoOn = dom.autoToggle.getAttribute('aria-checked') === 'true';
    const target = autoOn ? autoTargetValue() : 200;
    if (target != null && target >= MIN_HUNDREDTHS && target <= MAX_HUNDREDTHS) {
      dom.previewMult.textContent = `${formatHundredths(target)}x`;
      dom.previewPayout.textContent = bet == null ? '—' : `ETB ${formatEtb(Math.floor((bet * target) / 100))}`;
    } else {
      dom.previewMult.textContent = '—';
      dom.previewPayout.textContent = '—';
    }
    const invalidBet = bet == null || bet < MIN_BET || bet > MAX_BET;
    dom.betInput.setAttribute('aria-invalid', String(invalidBet));
    const invalidAuto = autoOn && (target == null || target < MIN_HUNDREDTHS || target > MAX_HUNDREDTHS);
    dom.autoInput.setAttribute('aria-invalid', String(invalidAuto));
    if (!invalidBet && !invalidAuto && !dom.hint.dataset.tone) setHint(defaultHint());
  }

  function defaultHint() {
    if (round?.active) {
      if (phaseOf() === 'flying') {
        return round.auto_cashout_hundredths
          ? `Auto cash-out at ${formatHundredths(round.auto_cashout_hundredths)}x is settled by the server.`
          : 'Cash out any time before the crash. The server validates the request.';
      }
      return 'The bet is locked for this sortie. No changes are possible now.';
    }
    return 'One bet per sortie. Cash out any time before the crash.';
  }

  function renderCta() {
    const bet = parseSantim(dom.betInput.value);
    const autoOn = dom.autoToggle.getAttribute('aria-checked') === 'true';
    const target = autoTargetValue();
    const invalidInputs = bet == null || bet < MIN_BET || bet > MAX_BET ||
      (autoOn && (target == null || target < MIN_HUNDREDTHS || target > MAX_HUNDREDTHS));
    dom.form.classList.toggle('is-busy', busy);

    if (busy) {
      dom.action.dataset.mode = 'wait';
      dom.action.disabled = true;
      dom.ctaMain.textContent = 'Working…';
      dom.ctaSub.textContent = 'Waiting for the server';
      return;
    }

    if (!round || !round.active) {
      dom.action.dataset.mode = 'bet';
      dom.action.disabled = invalidInputs || gateShown;
      dom.ctaMain.textContent = round?.result === 'lost' ? 'Try another sortie' : 'Place bet';
      dom.ctaSub.textContent = round?.result === 'lost' ? 'The next round is independent' : 'Lock in your stake';
      return;
    }

    const phase = phaseOf();
    if (phase === 'countdown') {
      dom.action.dataset.mode = 'wait';
      dom.action.disabled = true;
      dom.ctaMain.textContent = 'Betting closed';
      const seconds = Math.max(0, (Number(round.starts_at) - serverNow()) / 1000);
      dom.ctaSub.textContent = `Takeoff in ${seconds.toFixed(1)}s`;
      return;
    }
    if (phase === 'takeoff') {
      dom.action.dataset.mode = 'wait';
      dom.action.disabled = true;
      dom.ctaMain.textContent = 'Engines spooling';
      dom.ctaSub.textContent = 'Cash-out opens at 1.01x';
      return;
    }

    const hundredths = liveHundredths();
    if (hundredths >= MIN_HUNDREDTHS) {
      dom.action.dataset.mode = 'cashout';
      dom.action.disabled = false;
      dom.ctaMain.textContent = 'Cash out';
      dom.ctaSub.textContent = `ETB ${formatEtb(potentialSantim(hundredths))} at ${formatHundredths(hundredths)}x`;
    } else {
      dom.action.dataset.mode = 'wait';
      dom.action.disabled = true;
      dom.ctaMain.textContent = 'Taking off';
      dom.ctaSub.textContent = 'Cash-out opens at 1.01x';
    }
  }

  function renderAll() {
    const phase = phaseOf();
    const label = phaseLabels[phase] || 'Ready';
    const pill = statePill[phase] || statePill.idle;
    dom.phase.textContent = label;
    dom.phase.dataset.phase = phase;
    dom.statePill.textContent = pill[1];
    dom.statePill.dataset.state = pill[0];
    const connected = dom.sync.dataset.state !== 'stale';
    dom.sync.title = connected ? 'Connected to the game server' : 'Reconnecting to the game server';
    const syncLabel = dom.sync.querySelector('span');
    if (syncLabel) syncLabel.textContent = connected ? 'LIVE' : 'RETRY';

    const won = round && !round.active && (round.result === 'cashout' || round.result === 'auto_cashout');
    const lost = round && !round.active && round.result === 'lost';
    const current = liveHundredths();
    paintMultiplierText(current);
    dom.multiplier.dataset.tone = won ? 'win' : lost ? 'loss' : 'normal';

    if (phase === 'flying') {
      dom.kicker.textContent = round.auto_cashout_hundredths ? 'Auto target set' : 'In flight';
      dom.sub.textContent = round.auto_cashout_hundredths
        ? `The server will bank at ${formatHundredths(round.auto_cashout_hundredths)}x if reached.`
        : 'Bank before the boom.';
    } else if (phase === 'countdown') {
      dom.kicker.textContent = 'Next sortie';
      dom.sub.textContent = 'Your stake is locked. The server owns the crash point.';
    } else if (phase === 'takeoff') {
      dom.kicker.textContent = 'Takeoff';
      dom.sub.textContent = 'Cash-out opens at 1.01x.';
    } else if (phase === 'won') {
      dom.kicker.textContent = round.result === 'auto_cashout' ? 'Auto cash-out' : 'Banked';
      dom.sub.textContent = `Settled by the server at ${formatHundredths(round.cashout_hundredths)}x.`;
    } else if (phase === 'lost') {
      dom.kicker.textContent = 'Shot down';
      dom.sub.textContent = 'This sortie is lost. The next round is independent.';
    } else {
      dom.kicker.textContent = 'Next sortie';
      dom.sub.textContent = 'Bank before boom.';
    }

    if (round?.active) {
      dom.potentialLabel.textContent = phase === 'flying' ? 'Cash-out value' : 'Potential payout';
      dom.potential.textContent = phase === 'flying' ? `ETB ${formatEtb(potentialSantim(current))}` : '—';
    } else if (won) {
      dom.potentialLabel.textContent = 'Settled payout';
      dom.potential.textContent = `ETB ${formatEtb(round.payout_santim)}`;
    } else if (lost) {
      dom.potentialLabel.textContent = 'Stake lost';
      dom.potential.textContent = `− ETB ${formatEtb(round.bet_santim)}`;
    } else {
      dom.potentialLabel.textContent = 'Cash-out value';
      dom.potential.textContent = '—';
    }

    if (round?.active) {
      dom.autoBadge.textContent = round.auto_cashout_hundredths
        ? `${formatHundredths(round.auto_cashout_hundredths)}x`
        : 'Manual';
    } else {
      const autoOn = dom.autoToggle.getAttribute('aria-checked') === 'true';
      const target = autoTargetValue();
      dom.autoBadge.textContent = autoOn && target ? `${formatHundredths(target)}x next` : 'Off';
    }

    const locked = Boolean(round?.active) || busy || gateShown;
    dom.betInput.disabled = locked;
    dom.stakeMinus.disabled = locked;
    dom.stakePlus.disabled = locked;
    dom.autoToggle.disabled = locked;
    dom.autoInput.disabled = locked;
    dom.seed.disabled = locked;
    dom.seedButton.disabled = locked;
    for (const button of dom.quickStakes.querySelectorAll('button')) button.disabled = locked;
    for (const button of dom.autoChips.querySelectorAll('button')) button.disabled = locked;

    dom.commit.textContent = round?.server_seed_hash || 'Published before takeoff';
    dom.seedHint.textContent = round?.active
      ? 'Locked for this sortie. Changes apply to the next one.'
      : 'Used in the next sortie. The server publishes the hash first and reveals the seed after settlement.';
    dom.fairVerify.hidden = !round || round.active;

    if (round && !round.active && !dismissedResults.has(round.id)) showResult(round);
    else hideResult();

    dom.action.disabled = dom.action.disabled || gateShown;
    renderRecent();
    renderCta();
    updatePreview();
    paintSound();
    notifyShell();
    if (dom.mobileCash) renderMobileCash();
  }

  // ---------- polling ----------
  function schedulePoll(delay) {
    clearTimeout(pollTimer);
    if (gateShown) return;
    pollTimer = setTimeout(pollTick, delay);
  }

  async function refreshState({ quiet = false } = {}) {
    if (pollInFlight) return null;
    pollInFlight = true;
    const revision = stateRevision;
    try {
      const data = await api('/state');
      if (revision === stateRevision) {
        mergeState(data, 'poll');
        dom.sync.dataset.state = 'ok';
      }
      return data;
    } catch (error) {
      dom.sync.dataset.state = 'stale';
      dom.sync.title = 'Reconnecting to the game server';
      const syncLabel = dom.sync.querySelector('span');
      if (syncLabel) syncLabel.textContent = 'RETRY';
      if (error.status === 401 || error.message === 'LOGIN') showGate();
      return null;
    } finally {
      pollInFlight = false;
    }
  }

  async function pollTick() {
    if (gateShown) return;
    if (document.hidden || pollPaused) {
      schedulePoll(1400);
      return;
    }
    await refreshState();
    schedulePoll(round?.active ? ACTIVE_POLL_MS : IDLE_POLL_MS);
  }

  // ---------- actions ----------
  function beginAction() {
    stateRevision += 1;
    pollPaused = true;
    clearTimeout(pollTimer);
    busy = true;
    renderAll();
  }

  function endAction() {
    busy = false;
    pollPaused = false;
    renderAll();
    schedulePoll(260);
  }

  async function placeBet(event) {
    event?.preventDefault();
    if (busy) return;
    if (round?.active) {
      showToast('Finish the active sortie first.', { tone: 'error' });
      return;
    }
    const bet = parseSantim(dom.betInput.value);
    if (bet == null || bet < MIN_BET || bet > MAX_BET) {
      setHint('Enter a stake between 1.00 and 1,000.00 ETB.', 'error');
      dom.betInput.focus();
      return;
    }
    const autoOn = dom.autoToggle.getAttribute('aria-checked') === 'true';
    const auto = autoOn ? autoTargetValue() : null;
    if (autoOn && (auto == null || auto < MIN_HUNDREDTHS || auto > MAX_HUNDREDTHS)) {
      setHint('Auto cash-out must be between 1.01x and 100.00x.', 'error');
      dom.autoInput.focus();
      return;
    }
    const clientSeed = sanitizeSeed(dom.seed.value);
    storeSet('bb-bet', String(bet));
    storeSet('bb-auto-on', autoOn ? '1' : '0');
    if (auto != null) storeSet('bb-auto-target', String(auto));
    if (clientSeed) storeSet('bb-client-seed', clientSeed);

    beginAction();
    setHint('Placing the bet…', 'info');
    try {
      const data = await api('/bet', {
        method: 'POST',
        sentAt: Date.now(),
        body: {
          bet_santim: bet,
          auto_cashout_hundredths: auto,
          client_seed: clientSeed || undefined,
          action_id: parseUuid(),
        },
      });
      stateRevision += 1;
      mergeState(data, 'action');
      playBet();
      announce(`Bet placed. ${data.replayed ? 'Existing sortie restored.' : 'Takeoff is counting down.'}`);
      setHint(`Stake ETB ${formatEtb(bet)} locked. Takeoff begins shortly.`, 'info');
      if (data.replayed) showToast('An existing sortie was restored for this request.');
    } catch (error) {
      if (error.status === 401) showGate();
      setHint(friendlyError(error), 'error');
      showToast(friendlyError(error), { tone: 'error' });
      if (['ACTIVE_ROUND', 'STALE_ACTION'].includes(error.message)) await refreshState({ quiet: true });
    } finally {
      endAction();
    }
  }

  async function cashOut() {
    if (busy || !round?.active) return;
    const phase = phaseOf();
    if (phase !== 'flying') {
      showToast('Cash-out opens after takeoff.', { tone: 'error' });
      return;
    }
    beginAction();
    setHint('Sending the cash-out to the server…', 'info');
    try {
      const data = await api('/cashout', {
        method: 'POST',
        sentAt: Date.now(),
        body: { round_id: round.id, action_id: parseUuid() },
      });
      stateRevision += 1;
      mergeState(data, 'action');
      const settled = data.round;
      if (settled?.result === 'lost') {
        showToast('The bomber was hit before the cash-out settled.', { tone: 'error' });
      } else if (settled?.result === 'auto_cashout') {
        showToast(`Auto banked at ${formatHundredths(settled.cashout_hundredths)}x.`, { tone: 'win' });
      } else {
        showToast(`Banked ETB ${formatEtb(settled?.payout_santim || 0)}.`, { tone: 'win' });
        announce(`Cashed out at ${formatHundredths(settled?.cashout_hundredths)}x.`);
      }
      postToShell({ type: 'fetan-wallet-refresh' });
    } catch (error) {
      if (error.status === 401) showGate();
      setHint(friendlyError(error), 'error');
      showToast(friendlyError(error), { tone: 'error' });
      await refreshState({ quiet: true });
    } finally {
      endAction();
    }
  }

  function submitAction(event) {
    event?.preventDefault();
    if (round?.active) cashOut();
    else placeBet(event);
  }

  // ---------- dialogs ----------
  function openDialog(dialog) {
    if (!dialog) return;
    if (!dialog.open) {
      try { dialog.showModal(); } catch (_) { dialog.setAttribute('open', ''); }
    }
  }
  function closeDialog(dialog) {
    if (!dialog) return;
    if (dialog.open) dialog.close();
    else dialog.removeAttribute('open');
  }

  async function openFairness({ verify = false } = {}) {
    fairnessData = null;
    dom.fairOutput.hidden = true;
    dom.fairOutput.innerHTML = '';
    dom.fairCommit.textContent = round?.server_seed_hash || '—';
    dom.fairClient.textContent = round?.client_seed || '—';
    dom.fairNonce.textContent = round?.nonce || round?.round_id || '—';
    dom.fairVerifyRound.disabled = !round || round.active;
    dom.fairVerifyRound.textContent = 'Verify settled round';
    dom.fairHint.textContent = round?.active
      ? 'The server seed and crash point are revealed only after settlement.'
      : 'Settlement happens on the server first. The verifier recomputes it locally.';
    openDialog(dom.fair);
    if (verify && round && !round.active) await verifyCurrentRound();
  }

  const hexToBytes = (hex) => {
    if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) throw new Error('INVALID_HEX');
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return bytes;
  };
  const bytesToHex = (bytes) => [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');

  async function sha256Hex(bytes) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return bytesToHex(digest);
  }

  async function hmacSha256Hex(keyBytes, message) {
    const key = await crypto.subtle.importKey(
      'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
    return bytesToHex(signature);
  }

  function crashFromHex(uniformHex) {
    const h = BigInt(`0x${uniformHex}`);
    if (h < 0n || h >= N) throw new Error('INVALID_UNIFORM');
    let raw = (40n * N) / (N - h);
    if (raw < 100n) raw = 100n;
    if (raw > BigInt(MAX_HUNDREDTHS)) raw = BigInt(MAX_HUNDREDTHS);
    return Number(raw);
  }

  function verificationMarkup(checks, data) {
    const list = checks.map((check) => (
      `<li data-fail="${check.ok ? 'false' : 'true'}">${escapeHtml(check.label)}</li>`
    )).join('');
    return `
      <h3>${checks.every((check) => check.ok) ? 'Verified in this browser' : 'Verification failed'}</h3>
      <ul class="bb-check-list">${list}</ul>
      <div class="bb-hash-stack">
        <div><span>Uniform value</span><code>${escapeHtml(data.computed_uniform || '—')}</code></div>
        <div><span>Recorded crash</span><code>${escapeHtml(formatHundredths(data.recorded_crash_hundredths || 0))}x</code></div>
        <div><span>Recomputed</span><code>${escapeHtml(formatHundredths(data.computed_crash_hundredths || 0))}x</code></div>
      </div>`;
  }

  async function verifyCurrentRound() {
    if (!round || round.active) {
      dom.fairHint.textContent = 'The round must settle before verification.';
      return;
    }
    dom.fairVerifyRound.disabled = true;
    dom.fairVerifyRound.textContent = 'Verifying…';
    dom.fairHint.textContent = 'Fetching the revealed seed and recomputing…';
    try {
      const data = await api(`/rounds/${round.id}/fairness`);
      fairnessData = data;
      dom.fairCommit.textContent = data.server_seed_hash || '—';
      dom.fairClient.textContent = data.client_seed || '—';
      dom.fairNonce.textContent = data.nonce || '—';
      if (!globalThis.crypto?.subtle) {
        dom.fairHint.textContent = 'This browser cannot run WebCrypto here. Use a secure (HTTPS or localhost) page to verify locally.';
        dom.fairVerifyRound.disabled = false;
        dom.fairVerifyRound.textContent = 'Try again';
        return;
      }
      const seedBytes = hexToBytes(data.server_seed);
      const commitment = await sha256Hex(seedBytes);
      const uniform = await hmacSha256Hex(
        seedBytes, `${sanitizeSeed(data.client_seed)}:${data.nonce}:b2b-bomber:v1`
      );
      const computed = crashFromHex(uniform);
      const checks = [
        { ok: commitment === data.server_seed_hash, label: 'SHA-256(server seed) matches the published commitment' },
        { ok: computed === Number(data.recorded_crash_hundredths), label: 'HMAC-SHA256 reproduces the recorded crash multiplier' },
        { ok: data.commitment_valid === true, label: 'Server commitment check passed' },
        { ok: data.outcome_matches === true, label: 'Server outcome check passed' },
        { ok: Number(data.recorded_crash_hundredths) >= 100 && Number(data.recorded_crash_hundredths) <= MAX_HUNDREDTHS, label: 'Recorded crash is inside the disclosed cap' },
      ];
      dom.fairOutput.innerHTML = verificationMarkup(checks, {
        computed_uniform: uniform,
        recorded_crash_hundredths: data.recorded_crash_hundredths,
        computed_crash_hundredths: computed,
      });
      dom.fairOutput.hidden = false;
      const passed = checks.every((check) => check.ok);
      dom.fairHint.textContent = passed
        ? 'All checks passed. The server could not have changed the crash after publishing this commitment.'
        : 'At least one check failed. Do not treat this round as verified; contact support with the round id.';
      if (passed) announce('Round verified in this browser.');
    } catch (error) {
      dom.fairHint.textContent = error.status === 401
        ? 'Sign in again to verify this round.'
        : 'Verification could not be completed. The round may still be settling. Try again shortly.';
      if (error.status === 401) showGate();
    } finally {
      dom.fairVerifyRound.disabled = false;
      dom.fairVerifyRound.textContent = 'Verify settled round';
    }
  }

  // ---------- history ----------
  const resultNames = {
    cashout: 'Manual cash-out', auto_cashout: 'Auto cash-out', lost: 'Shot down',
  };

  async function openHistory() {
    openDialog(dom.history);
    dom.historyStatus.textContent = 'Loading your sorties…';
    dom.historyList.innerHTML = '';
    try {
      const data = await api('/history');
      const rows = Array.isArray(data.history) ? data.history : [];
      if (!rows.length) {
        dom.historyStatus.textContent = 'No sorties recorded yet.';
        return;
      }
      dom.historyList.innerHTML = rows.map((item) => {
        const active = item.active;
        const won = item.result === 'cashout' || item.result === 'auto_cashout';
        const multiplier = active ? '—' : `${formatHundredths(won ? item.cashout_hundredths : item.crash_hundredths)}x`;
        const result = active ? 'In flight' : (resultNames[item.result] || 'Settled');
        const payout = active ? '—' : won ? `+ ETB ${formatEtb(item.payout_santim)}` : `− ETB ${formatEtb(item.bet_santim)}`;
        return `
          <div class="bb-history-row" data-result="${escapeHtml(active ? 'active' : item.result)}">
            <div class="bb-history-mult">${multiplier}</div>
            <div class="bb-history-meta">
              <b>${escapeHtml(result)}</b>
              <span>Stake ETB ${formatEtb(item.bet_santim)} · ${escapeHtml(roundDate(item.created_at))}</span>
            </div>
            <div class="bb-history-payout"><strong>${payout}</strong><span>${active ? 'Open' : 'Settled'}</span></div>
          </div>`;
      }).join('');
      dom.historyStatus.textContent = `${rows.length} recent ${rows.length === 1 ? 'sortie' : 'sorties'} · only your real rounds`;
    } catch (error) {
      if (error.status === 401) showGate();
      dom.historyStatus.textContent = friendlyError(error);
    }
  }

  // ---------- sign-in gate ----------
  function showGate() {
    gateShown = true;
    pollPaused = true;
    clearTimeout(pollTimer);
    dom.gate.hidden = false;
    dom.action.disabled = true;
    dom.sync.dataset.state = 'stale';
    announce('Sign in to play B2B Bomber.');
  }

  function onGateLink(event) {
    if (!integrated) return;
    event.preventDefault();
    postToShell({ type: 'fetan-game-close' });
  }

  // ---------- canvas flight deck ----------
  const canvas = dom.sky;
  const ctx2d = canvas?.getContext('2d', { alpha: false }) || null;
  let canvasWidth = 0;
  let canvasHeight = 0;
  let canvasDpr = 1;

  const stars = Array.from({ length: 86 }, (_, index) => {
    const raw = Math.sin(index * 12.9898 + 4.1414) * 43758.5453;
    const a = raw - Math.floor(raw);
    const raw2 = Math.sin(index * 78.233 + 1.618) * 12345.6789;
    const b = raw2 - Math.floor(raw2);
    const raw3 = Math.sin(index * 39.425 + 7.77) * 9876.5432;
    const c = raw3 - Math.floor(raw3);
    return { x: a, y: b * 0.64, r: 0.5 + c * 1.5, phase: c * Math.PI * 2, speed: 0.4 + a * 1.2 };
  });

  const skyline = [
    [0.00, 0.16], [0.05, 0.10], [0.10, 0.13], [0.16, 0.08], [0.21, 0.15], [0.27, 0.11],
    [0.33, 0.17], [0.39, 0.09], [0.44, 0.14], [0.50, 0.10], [0.56, 0.16], [0.62, 0.11],
    [0.68, 0.15], [0.74, 0.08], [0.79, 0.13], [0.85, 0.10], [0.90, 0.16], [0.96, 0.11],
  ];

  function resizeCanvas() {
    if (!canvas || !ctx2d) return;
    const rect = dom.stage.getBoundingClientRect();
    const width = Math.max(320, Math.round(rect.width));
    const height = Math.max(260, Math.round(rect.height));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (width === canvasWidth && height === canvasHeight && dpr === canvasDpr) return;
    canvasWidth = width;
    canvasHeight = height;
    canvasDpr = dpr;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function progressFor(hundredths) {
    const multiplier = Math.max(100, Number(hundredths) || 100) / 100;
    return clamp(Math.log(multiplier) / Math.log(MAX_HUNDREDTHS / 100), 0, 1);
  }

  function flightPoint(progress) {
    const p = clamp(progress, 0, 1);
    return {
      x: canvasWidth * (0.085 + p * 0.72),
      y: canvasHeight * (0.735 - p * 0.49 - Math.sin(p * Math.PI) * 0.035),
    };
  }

  function drawSky(time) {
    const gradient = ctx2d.createLinearGradient(0, 0, 0, canvasHeight);
    gradient.addColorStop(0, '#030812');
    gradient.addColorStop(0.34, '#071a32');
    gradient.addColorStop(0.68, '#0d2d52');
    gradient.addColorStop(0.86, '#1b4d79');
    gradient.addColorStop(1, '#0a2038');
    ctx2d.fillStyle = gradient;
    ctx2d.fillRect(0, 0, canvasWidth, canvasHeight);

    for (const star of stars) {
      const twinkle = reducedMotion ? 0.7 : 0.42 + 0.4 * (0.5 + 0.5 * Math.sin(time * 0.0012 * star.speed + star.phase));
      ctx2d.globalAlpha = twinkle;
      ctx2d.fillStyle = star.r > 1.45 ? '#dcecff' : '#9cc3ef';
      ctx2d.beginPath();
      ctx2d.arc(star.x * canvasWidth, star.y * canvasHeight, star.r, 0, Math.PI * 2);
      ctx2d.fill();
    }
    ctx2d.globalAlpha = 1;

    const moonX = canvasWidth * 0.80;
    const moonY = canvasHeight * 0.20;
    const moonRadius = Math.max(24, Math.min(canvasWidth, canvasHeight) * 0.055);
    const glow = ctx2d.createRadialGradient(moonX, moonY, moonRadius * 0.5, moonX, moonY, moonRadius * 4.2);
    glow.addColorStop(0, 'rgba(214, 235, 255, 0.30)');
    glow.addColorStop(0.35, 'rgba(127, 182, 255, 0.12)');
    glow.addColorStop(1, 'rgba(127, 182, 255, 0)');
    ctx2d.fillStyle = glow;
    ctx2d.beginPath();
    ctx2d.arc(moonX, moonY, moonRadius * 4.2, 0, Math.PI * 2);
    ctx2d.fill();
    ctx2d.fillStyle = '#f7faff';
    ctx2d.beginPath();
    ctx2d.arc(moonX, moonY, moonRadius, 0, Math.PI * 2);
    ctx2d.fill();
    ctx2d.fillStyle = 'rgba(168, 197, 230, 0.5)';
    for (const [dx, dy, r] of [[-0.32, -0.18, 0.16], [0.22, 0.24, 0.22], [0.28, -0.2, 0.1]]) {
      ctx2d.beginPath();
      ctx2d.arc(moonX + moonRadius * dx, moonY + moonRadius * dy, moonRadius * r, 0, Math.PI * 2);
      ctx2d.fill();
    }

    const haze = ctx2d.createLinearGradient(0, canvasHeight * 0.6, 0, canvasHeight);
    haze.addColorStop(0, 'rgba(245, 197, 43, 0)');
    haze.addColorStop(0.78, 'rgba(245, 197, 43, 0.08)');
    haze.addColorStop(1, 'rgba(10, 32, 56, 0.8)');
    ctx2d.fillStyle = haze;
    ctx2d.fillRect(0, canvasHeight * 0.6, canvasWidth, canvasHeight * 0.4);

    ctx2d.fillStyle = 'rgba(156, 195, 239, 0.075)';
    for (let i = 0; i < 4; i++) {
      const cx = ((i * 0.31 + 0.12) % 1) * canvasWidth;
      const cy = canvasHeight * (0.52 + (i % 2) * 0.08);
      ctx2d.beginPath();
      ctx2d.ellipse(cx, cy, canvasWidth * 0.22, canvasHeight * 0.035, 0, 0, Math.PI * 2);
      ctx2d.fill();
    }
  }

  function drawGuideLines() {
    const targets = [2, 5, 10, 25, 50, 100];
    ctx2d.save();
    ctx2d.font = '600 8px Poppins, Segoe UI, sans-serif';
    ctx2d.textAlign = 'left';
    for (const target of targets) {
      const p = progressFor(target * 100);
      const y = flightPoint(p).y;
      ctx2d.strokeStyle = 'rgba(127, 182, 255, 0.075)';
      ctx2d.lineWidth = 1;
      ctx2d.setLineDash([3, 9]);
      ctx2d.beginPath();
      ctx2d.moveTo(canvasWidth * 0.04, y);
      ctx2d.lineTo(canvasWidth * 0.97, y);
      ctx2d.stroke();
      ctx2d.setLineDash([]);
      ctx2d.fillStyle = 'rgba(127, 182, 255, 0.32)';
      ctx2d.fillText(`${target}x`, canvasWidth * 0.045, y - 4);
    }
    ctx2d.restore();
  }

  function drawCity() {
    const base = canvasHeight * 0.9;
    const maxHeight = canvasHeight * 0.22;
    const buildingWidth = canvasWidth / skyline.length;
    const gradient = ctx2d.createLinearGradient(0, base - maxHeight, 0, canvasHeight);
    gradient.addColorStop(0, '#061529');
    gradient.addColorStop(1, '#030a13');
    for (let i = 0; i < skyline.length; i++) {
      const [ox, h] = skyline[i];
      const x = ox * canvasWidth;
      const width = buildingWidth * 0.92;
      const height = maxHeight * (h / 0.16);
      ctx2d.fillStyle = gradient;
      ctx2d.fillRect(x, base - height, width, height + canvasHeight * 0.1);
      ctx2d.fillStyle = 'rgba(245, 197, 43, 0.42)';
      const columns = Math.max(1, Math.floor(width / 15));
      const rows = Math.max(1, Math.floor(height / 17));
      for (let c = 0; c < columns; c++) {
        for (let r = 0; r < rows; r++) {
          if ((i * 7 + c * 3 + r * 5) % 4 === 0) continue;
          const wx = x + 5 + c * 13;
          const wy = base - height + 7 + r * 15;
          if (wy > base - 8) continue;
          ctx2d.fillRect(wx, wy, 3, 4);
        }
      }
    }
    ctx2d.fillStyle = '#02070e';
    ctx2d.fillRect(0, base + 1, canvasWidth, canvasHeight - base);
    const haze = ctx2d.createLinearGradient(0, base - 26, 0, base + 4);
    haze.addColorStop(0, 'rgba(127, 182, 255, 0)');
    haze.addColorStop(0.55, 'rgba(156, 195, 239, 0.14)');
    haze.addColorStop(1, 'rgba(156, 195, 239, 0)');
    ctx2d.fillStyle = haze;
    ctx2d.fillRect(0, base - 26, canvasWidth, 30);
  }

  function drawTrail(progress, time) {
    if (progress <= 0.002) return;
    const steps = Math.max(12, Math.round(progress * 70));
    ctx2d.save();
    ctx2d.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) {
      ctx2d.beginPath();
      for (let i = 0; i <= steps; i++) {
        const point = flightPoint((i / steps) * progress);
        if (i === 0) ctx2d.moveTo(point.x, point.y);
        else ctx2d.lineTo(point.x, point.y);
      }
      ctx2d.strokeStyle = pass === 0 ? 'rgba(127, 182, 255, 0.10)' : 'rgba(245, 197, 43, 0.26)';
      ctx2d.lineWidth = pass === 0 ? 13 : 2.2;
      ctx2d.stroke();
    }
    if (!reducedMotion) {
      const shimmer = 0.16 + 0.08 * Math.sin(time * 0.004);
      ctx2d.strokeStyle = `rgba(247, 250, 255, ${shimmer})`;
      ctx2d.lineWidth = 1;
      ctx2d.stroke();
    }
    ctx2d.restore();
  }

  function drawPlane(x, y, angle, scale, time) {
    ctx2d.save();
    ctx2d.translate(x, y);
    ctx2d.rotate(angle);
    ctx2d.scale(scale, scale);

    ctx2d.fillStyle = 'rgba(2, 8, 18, 0.34)';
    ctx2d.beginPath();
    ctx2d.ellipse(-2, 8, 42, 9, 0, 0, Math.PI * 2);
    ctx2d.fill();

    // Tail stabilisers.
    ctx2d.fillStyle = '#4f7fb0';
    ctx2d.beginPath();
    ctx2d.moveTo(-34, -2);
    ctx2d.lineTo(-48, -15);
    ctx2d.lineTo(-40, -1);
    ctx2d.closePath();
    ctx2d.fill();
    ctx2d.beginPath();
    ctx2d.moveTo(-34, 2);
    ctx2d.lineTo(-48, 15);
    ctx2d.lineTo(-40, 1);
    ctx2d.closePath();
    ctx2d.fill();

    // Main wings, swept back.
    const wingTop = ctx2d.createLinearGradient(-20, -30, 12, 0);
    wingTop.addColorStop(0, '#dce9f9');
    wingTop.addColorStop(1, '#6f9bc9');
    ctx2d.fillStyle = wingTop;
    ctx2d.beginPath();
    ctx2d.moveTo(6, -4);
    ctx2d.lineTo(-18, -31);
    ctx2d.lineTo(-30, -31);
    ctx2d.lineTo(-14, -3);
    ctx2d.closePath();
    ctx2d.fill();
    ctx2d.beginPath();
    ctx2d.moveTo(6, 4);
    ctx2d.lineTo(-18, 31);
    ctx2d.lineTo(-30, 31);
    ctx2d.lineTo(-14, 3);
    ctx2d.closePath();
    ctx2d.fill();

    // Fuselage.
    const body = ctx2d.createLinearGradient(0, -9, 0, 9);
    body.addColorStop(0, '#ffffff');
    body.addColorStop(0.48, '#eaf2ff');
    body.addColorStop(1, '#6f9bc9');
    ctx2d.fillStyle = body;
    ctx2d.beginPath();
    ctx2d.moveTo(38, 0);
    ctx2d.bezierCurveTo(28, -7, 4, -9, -26, -8);
    ctx2d.bezierCurveTo(-38, -7, -42, -4, -44, 0);
    ctx2d.bezierCurveTo(-42, 4, -38, 7, -26, 8);
    ctx2d.bezierCurveTo(4, 9, 28, 7, 38, 0);
    ctx2d.closePath();
    ctx2d.fill();

    // Cockpit and markings.
    ctx2d.fillStyle = '#102747';
    ctx2d.beginPath();
    ctx2d.ellipse(23, -2, 8, 4.5, -0.18, 0, Math.PI * 2);
    ctx2d.fill();
    ctx2d.fillStyle = 'rgba(127, 182, 255, 0.7)';
    ctx2d.beginPath();
    ctx2d.ellipse(25, -2.6, 4.5, 2, -0.18, 0, Math.PI * 2);
    ctx2d.fill();
    ctx2d.fillStyle = '#f5c52b';
    ctx2d.fillRect(-2, -8, 5, 16);
    ctx2d.fillStyle = '#2467b9';
    ctx2d.fillRect(-9, -8, 3, 16);
    ctx2d.fillStyle = '#d93643';
    ctx2d.fillRect(-38, -6, 5, 12);

    // Four engine nacelles.
    for (const [ex, ey, side] of [[-8, -19, -1], [-24, -25, -1], [-8, 19, 1], [-24, 25, 1]]) {
      ctx2d.fillStyle = side < 0 ? '#cfe0f5' : '#9dbde4';
      ctx2d.beginPath();
      ctx2d.ellipse(ex, ey, 8, 3.4, 0, 0, Math.PI * 2);
      ctx2d.fill();
      ctx2d.fillStyle = '#102747';
      ctx2d.beginPath();
      ctx2d.ellipse(ex - 7, ey, 1.8, 3, 0, 0, Math.PI * 2);
      ctx2d.fill();
      const prop = reducedMotion ? 0 : time * 0.04;
      ctx2d.strokeStyle = 'rgba(247, 250, 255, 0.55)';
      ctx2d.lineWidth = 1;
      ctx2d.beginPath();
      ctx2d.arc(ex - 8, ey, 4.5, prop, prop + Math.PI * 1.2);
      ctx2d.stroke();
      const exhaust = ctx2d.createRadialGradient(ex - 9, ey, 0, ex - 9, ey, 8);
      exhaust.addColorStop(0, 'rgba(245, 197, 43, 0.75)');
      exhaust.addColorStop(0.5, 'rgba(233, 128, 43, 0.3)');
      exhaust.addColorStop(1, 'rgba(217, 54, 67, 0)');
      ctx2d.fillStyle = exhaust;
      ctx2d.beginPath();
      ctx2d.arc(ex - 9, ey, 8, 0, Math.PI * 2);
      ctx2d.fill();
    }

    // Wing roundels.
    for (const [wx, wy] of [[-18, -23], [-18, 23]]) {
      ctx2d.fillStyle = '#f5c52b';
      ctx2d.beginPath();
      ctx2d.arc(wx, wy, 5, 0, Math.PI * 2);
      ctx2d.fill();
      ctx2d.fillStyle = '#2467b9';
      ctx2d.beginPath();
      ctx2d.arc(wx, wy, 3, 0, Math.PI * 2);
      ctx2d.fill();
    }

    ctx2d.restore();
  }

  function drawExplosion(progress, elapsed, time) {
    const point = flightPoint(progress);
    const age = Math.max(0, elapsed);
    const alive = age < 1400;
    const intensity = alive ? Math.max(0, 1 - age / 1400) : 0.28;
    const radius = reducedMotion ? 26 : 10 + Math.min(age, 900) * 0.075;

    const glow = ctx2d.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius * 4.4);
    glow.addColorStop(0, `rgba(255, 245, 210, ${0.9 * intensity})`);
    glow.addColorStop(0.22, `rgba(245, 197, 43, ${0.65 * intensity})`);
    glow.addColorStop(0.55, `rgba(217, 54, 67, ${0.3 * intensity})`);
    glow.addColorStop(1, 'rgba(217, 54, 67, 0)');
    ctx2d.fillStyle = glow;
    ctx2d.beginPath();
    ctx2d.arc(point.x, point.y, radius * 4.4, 0, Math.PI * 2);
    ctx2d.fill();

    ctx2d.fillStyle = `rgba(255, 238, 190, ${0.9 * intensity})`;
    ctx2d.beginPath();
    ctx2d.arc(point.x, point.y, radius * 0.34, 0, Math.PI * 2);
    ctx2d.fill();

    if (!reducedMotion) {
      for (let i = 0; i < 18; i++) {
        const angle = (i / 18) * Math.PI * 2 + i * 0.35;
        const distance = radius * (1.2 + ((i * 7) % 10) / 10) + age * 0.035;
        const px = point.x + Math.cos(angle) * distance;
        const py = point.y + Math.sin(angle) * distance;
        const size = 1.2 + ((i * 3) % 5) * 0.6;
        ctx2d.fillStyle = i % 3 === 0
          ? `rgba(247, 250, 255, ${0.55 * intensity})`
          : `rgba(245, 197, 43, ${0.45 * intensity})`;
        ctx2d.beginPath();
        ctx2d.arc(px, py, size, 0, Math.PI * 2);
        ctx2d.fill();
      }
    }

    if (!alive) {
      ctx2d.fillStyle = 'rgba(12, 20, 31, 0.55)';
      for (let i = 0; i < 5; i++) {
        const angle = i * 1.4 + 0.4;
        const distance = 16 + i * 8;
        ctx2d.beginPath();
        ctx2d.arc(point.x + Math.cos(angle) * distance, point.y + Math.sin(angle) * distance + i * 2, 9 + i * 3, 0, Math.PI * 2);
        ctx2d.fill();
      }
    }
    ctx2d.save();
    ctx2d.font = '800 10px Poppins, Segoe UI, sans-serif';
    ctx2d.textAlign = 'center';
    ctx2d.fillStyle = `rgba(255, 122, 132, ${0.9 * intensity + 0.1})`;
    ctx2d.fillText('HIT', point.x, point.y - radius * 2.4 - 8);
    ctx2d.restore();
  }

  function drawFlight(timeMs) {
    if (!ctx2d) return;
    resizeCanvas();
    drawSky(timeMs);
    drawGuideLines();
    drawCity();

    const phase = phaseOf();
    let hundredths = liveHundredths();
    if (phase === 'won') hundredths = Number(round.cashout_hundredths || hundredths);
    if (phase === 'lost') hundredths = Number(round.crash_hundredths || hundredths);
    const progress = progressFor(hundredths);
    const point = flightPoint(progress);
    const lookAhead = flightPoint(Math.min(1, progress + 0.01));
    const angle = Math.atan2(lookAhead.y - point.y, lookAhead.x - point.x);
    const scale = clamp(canvasWidth / 900, 0.62, 1.12) * (phase === 'countdown' || phase === 'idle' ? 0.82 : 0.92);

    if (phase === 'flying' || phase === 'won' || phase === 'takeoff') {
      drawTrail(progress, timeMs);
      const bob = reducedMotion || phase !== 'takeoff' ? 0 : Math.sin(timeMs * 0.004) * 2;
      drawPlane(point.x, point.y + bob, angle, scale, timeMs);
    } else if (phase === 'lost') {
      const crashProgress = progressFor(Number(round.crash_hundredths || 100));
      const elapsed = boomAt ? performance.now() - boomAt : 5000;
      drawExplosion(crashProgress, elapsed, timeMs);
    } else {
      const bob = reducedMotion ? 0 : Math.sin(timeMs * 0.0022) * 1.6;
      drawPlane(canvasWidth * 0.085, canvasHeight * 0.735 + bob, 0, scale, timeMs);
      if (!reducedMotion) {
        ctx2d.strokeStyle = 'rgba(245, 197, 43, 0.28)';
        ctx2d.lineWidth = 1;
        ctx2d.setLineDash([3, 8]);
        ctx2d.beginPath();
        ctx2d.moveTo(canvasWidth * 0.05, canvasHeight * 0.775);
        ctx2d.lineTo(canvasWidth * 0.92, canvasHeight * 0.775);
        ctx2d.stroke();
        ctx2d.setLineDash([]);
      }
    }
  }

  let animationFrame = 0;
  function animate(timeMs) {
    animationFrame = requestAnimationFrame(animate);
    if (document.hidden) return;
    drawFlight(timeMs);
    if (timeMs - lastPaintAt > 80) {
      lastPaintAt = timeMs;
      const phase = phaseOf();
      paintMultiplierText(liveHundredths());
      if (phase === 'countdown') {
        const seconds = Math.ceil(Math.max(0, Number(round.starts_at) - serverNow()) / 1000);
        if (seconds !== lastCountdownSecond) {
          lastCountdownSecond = seconds;
          if (seconds > 0 && seconds <= 3) playTick();
        }
      }
      if (phase === 'flying' && dom.action.dataset.mode === 'cashout' && !busy) {
        dom.ctaSub.textContent = `ETB ${formatEtb(potentialSantim())} at ${formatHundredths(liveHundredths())}x`;
      }
      if (dom.mobileCash && !dom.mobileCash.hidden) {
        dom.mobileCash.innerHTML = `Cash out <b>ETB ${formatEtb(potentialSantim())}</b>`;
      }
      if (timeMs - lastResultAt > 900 && lastResultRound && !dismissedResults.has(lastResultRound) && round && !round.active) {
        // Keep the result visible; this branch only gives screen readers time
        // to finish the live announcement before another poll re-renders.
      }
    }
  }

  function renderMobileCash() {
    if (!dom.mobileCash) return;
    const show = Boolean(round?.active) && phaseOf() === 'flying' && !busy && !gateShown;
    dom.mobileCash.hidden = !show;
    if (show) {
      const value = `ETB ${formatEtb(potentialSantim())}`;
      dom.mobileCash.innerHTML = `Cash out <b>${value}</b>`;
      dom.mobileCash.setAttribute('aria-label', `Cash out for ${value}`);
    }
  }

  // ---------- form wiring ----------
  function stepBet(direction) {
    const current = parseSantim(dom.betInput.value) ?? 1000;
    const step = current >= 50000 ? 10000 : current >= 10000 ? 1000 : 100;
    const next = clamp(current + direction * step, MIN_BET, MAX_BET);
    dom.betInput.value = formatEtbInput(next);
    updatePreview();
    playClick();
  }

  function onFormInput() {
    updatePreview();
    if (dom.hint.dataset.tone === 'error') setHint(defaultHint());
  }

  function setAuto(on) {
    dom.autoToggle.setAttribute('aria-checked', String(Boolean(on)));
    dom.autoWrap.hidden = !on;
    updatePreview();
    storeSet('bb-auto-on', on ? '1' : '0');
    if (on) dom.autoInput.focus();
  }

  function toggleAuto() {
    if (dom.autoToggle.disabled) return;
    setAuto(dom.autoToggle.getAttribute('aria-checked') !== 'true');
    playClick();
  }

  function bindEvents() {
    dom.form.addEventListener('submit', submitAction);
    dom.betInput.addEventListener('input', onFormInput);
    dom.betInput.addEventListener('blur', () => {
      const value = parseSantim(dom.betInput.value);
      dom.betInput.value = value == null ? '10.00' : formatEtbInput(clamp(value, MIN_BET, MAX_BET));
      updatePreview();
    });
    dom.stakeMinus.addEventListener('click', () => stepBet(-1));
    dom.stakePlus.addEventListener('click', () => stepBet(1));
    dom.quickStakes.addEventListener('click', (event) => {
      const button = event.target.closest('[data-stake]');
      if (!button || button.disabled) return;
      dom.betInput.value = formatEtbInput(Number(button.dataset.stake) * 100);
      updatePreview();
      playClick();
    });
    dom.autoToggle.addEventListener('click', toggleAuto);
    dom.autoInput.addEventListener('input', onFormInput);
    dom.autoInput.addEventListener('blur', () => {
      const value = autoTargetValue();
      dom.autoInput.value = value == null ? '2.00' : formatHundredths(clamp(value, MIN_HUNDREDTHS, MAX_HUNDREDTHS));
      updatePreview();
    });
    dom.autoChips.addEventListener('click', (event) => {
      const button = event.target.closest('[data-auto]');
      if (!button || button.disabled) return;
      dom.autoInput.value = formatHundredths(Number(button.dataset.auto) * 100);
      updatePreview();
      playClick();
    });
    dom.seed.addEventListener('input', () => {
      const clean = sanitizeSeed(dom.seed.value);
      if (clean !== dom.seed.value) dom.seed.value = clean;
      storeSet('bb-client-seed', clean);
    });
    dom.seedButton.addEventListener('click', () => {
      dom.seed.value = makeClientSeed();
      storeSet('bb-client-seed', dom.seed.value);
      setHint('A new client seed will be used for the next sortie.', 'info');
      playClick();
    });
    dom.mobileCash?.addEventListener('click', cashOut);
    soundButton?.addEventListener('click', () => setSound(!soundOn));
    for (const button of btnHow) button.addEventListener('click', () => { playClick(); openDialog(dom.how); });
    for (const button of btnFair) button.addEventListener('click', () => { playClick(); openFairness(); });
    for (const button of btnHistory) button.addEventListener('click', () => { playClick(); openHistory(); });
    dom.fairVerify.addEventListener('click', () => openFairness({ verify: true }));
    dom.fairVerifyRound.addEventListener('click', verifyCurrentRound);
    dom.resultFair.addEventListener('click', () => openFairness({ verify: true }));
    dom.resultClose.addEventListener('click', () => {
      if (round?.id) dismissedResults.add(round.id);
      hideResult();
    });
    dom.toastClose.addEventListener('click', hideToast);
    dom.toastAction.addEventListener('click', () => {
      const handler = toastActionHandler;
      hideToast();
      handler?.();
    });
    dom.gateLink.addEventListener('click', onGateLink);

    for (const dialog of [dom.how, dom.fair, dom.history]) {
      dialog.querySelectorAll('[data-close]').forEach((button) => {
        button.addEventListener('click', () => closeDialog(dialog));
      });
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) closeDialog(dialog);
      });
    }

    const balanceButton = $('balanceBtn');
    balanceButton?.addEventListener('click', () => {
      if (integrated) postToShell({ type: 'fetan-open-wallet' });
      else location.hash = '#/wallet';
    });

    window.addEventListener('message', (event) => {
      if (event.origin !== location.origin || event.source !== window.parent) return;
      if (event.data?.type !== 'fetan-shell-action') return;
      const action = event.data.action;
      if (action === 'how') openDialog(dom.how);
      else if (action === 'fair') openFairness();
      else if (action === 'history') openHistory();
      else if (action === 'critical') cashOut();
      else if (action === 'sound') setSound(!soundOn);
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        clearTimeout(pollTimer);
      } else if (!gateShown) {
        pollInFlight = false;
        pollTick();
      }
    });
    window.addEventListener('online', () => { hideToast(); schedulePoll(0); });
    window.addEventListener('offline', () => {
      dom.sync.dataset.state = 'stale';
      showToast('You are offline. The game will reconnect automatically.', { tone: 'error', sticky: true });
    });
    window.addEventListener('resize', resizeCanvas);
    if (window.ResizeObserver) new ResizeObserver(resizeCanvas).observe(dom.stage);
  }

  function restorePreferences() {
    // Stored values are integer santim / hundredths, not user-facing ETB text.
    const savedBet = Number(storeGet('bb-bet'));
    if (Number.isSafeInteger(savedBet) && savedBet >= MIN_BET && savedBet <= MAX_BET) {
      dom.betInput.value = formatEtbInput(savedBet);
    }
    const savedAuto = Number(storeGet('bb-auto-target'));
    if (Number.isSafeInteger(savedAuto) && savedAuto >= MIN_HUNDREDTHS && savedAuto <= MAX_HUNDREDTHS) {
      dom.autoInput.value = formatHundredths(savedAuto);
    }
    const autoOn = storeGet('bb-auto-on') === '1';
    dom.autoToggle.setAttribute('aria-checked', String(autoOn));
    dom.autoWrap.hidden = !autoOn;
    const savedSeed = sanitizeSeed(storeGet('bb-client-seed'));
    if (savedSeed) dom.seed.value = savedSeed;
    paintSound();
    updatePreview();
  }

  function start() {
    dom.mobileCash = $('mobileCash');
    restorePreferences();
    bindEvents();
    resizeCanvas();
    setHint(defaultHint());
    animationFrame = requestAnimationFrame(animate);
    pollTick();
  }

  start();

  // Exposed only for the static integration test and browser debugging. It
  // contains no settlement authority.
  window.B2BBomber = Object.freeze({
    version: '1.0.0',
    api: API,
    rtpPercent: 40,
    houseEdgePercent: 60,
    refresh: () => refreshState({ quiet: true }),
  });





})();
