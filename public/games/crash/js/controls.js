// Bet panels, stake and auto editors, and the AUTO session controller. The
// browser only submits intents: panel, stake, auto target and request id.
'use strict';
window.CrashControls = (function () {
  const C = window.CrashConfig;
  const F = window.CrashFormat;
  const CURVE = window.CrashCurve;
  const T = window.CrashI18n.t;
  const panels = {
    1: { stake: 100, auto: null, busy: false },
    2: { stake: 100, auto: null, busy: false }
  };
  const dom = { 1: null, 2: null };
  const auto = {
    active: false,
    total: 0,
    remaining: 0,
    stopBelow: null,
    stopWin: null,
    stopLoss: null,
    lastRoundId: null,
    lastEvaluated: null,
    placing: false,
    chosenCount: 10
  };
  let pausedOverride = null;
  let lastManualCashout = null;
  let autoBtn = null;
  let autoRemainingEl = null;
  let autoDialog = null;
  let autoStartBtn = null;
  let autoCounts = null;
  let shellState = '';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function storageGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }

  function storageSet(key, value) {
    try { localStorage.setItem(key, String(value)); } catch (_) { /* optional */ }
  }

  function clampStake(value) {
    return Math.max(C.minStake, Math.min(C.maxStake, Math.trunc(Number(value) || C.minStake)));
  }

  function requestId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function friendly(code) {
    const keys = {
      INSUFFICIENT: 'insufficient',
      INVALID_STAKE: 'invalid_input',
      INVALID_AUTO_CASHOUT: 'invalid_input',
      INVALID_PANEL: 'invalid_input',
      INVALID_REQUEST: 'invalid_input',
      BETTING_CLOSED: 'betting_closed',
      PANEL_BUSY: 'panel_busy',
      ROUND_CRASHED: 'round_crashed_error',
      NOT_FLYING: 'not_flying_error',
      RATE: 'rate_error',
      CRASH_DISABLED: 'paused_error',
      SESSION: 'session_expired',
      TIMEOUT: 'generic_error',
      NETWORK: 'generic_error'
    };
    return T(keys[code] || 'generic_error');
  }

  function toast(message, kind) {
    window.CrashUI?.toast(message, kind);
  }

  function announce(message) {
    window.CrashUI?.announce(message);
  }

  function beep(kind) {
    window.CrashUI?.beep(kind);
  }

  function postToShell(message) {
    if (!document.documentElement.classList.contains('fetan-integrated')) return;
    if (window.parent === window) return;
    try { window.parent.postMessage(message, location.origin); } catch (_) { /* optional */ }
  }

  function acceptingRoundId() {
    const state = window.CrashStore.state;
    if (state.bettingRoundId != null) return Number(state.bettingRoundId);
    if (state.phase === 'betting' && state.round) return Number(state.round.id);
    return null;
  }

  function betFor(panel) {
    const state = window.CrashStore.state;
    const round = state.round;
    if (!round) return null;
    if (state.phase === 'flying' && round.id) {
      const current = window.CrashStore.myBet(round.id, panel);
      if (current) return current;
    }
    const accepting = acceptingRoundId();
    return accepting != null ? window.CrashStore.myBet(accepting, panel) : null;
  }

  function isCurrentFlyingBet(bet) {
    const state = window.CrashStore.state;
    return Boolean(
      bet &&
      state.phase === 'flying' &&
      state.round &&
      bet.roundId === state.round.id &&
      bet.status === 'open'
    );
  }

  function placementPaused() {
    const state = window.CrashStore.state;
    if (pausedOverride) return true;
    if (state.phase === 'loading') return true;
    if (state.connection === 'connecting' || state.connection === 'offline') return true;
    return false;
  }

  function setButton(panel, label, sub, { disabled = false, className = '' } = {}) {
    const entry = dom[panel];
    if (!entry) return;
    if (entry.label.textContent !== label) entry.label.textContent = label;
    if (entry.sub.textContent !== sub) entry.sub.textContent = sub;
    entry.btn.disabled = disabled;
    entry.btn.className = `action-btn${className ? ` ${className}` : ''}`;
  }

  function renderPanel(panel) {
    const state = window.CrashStore.state;
    const entry = dom[panel];
    if (!entry) return;
    const data = panels[panel];

    entry.stake.textContent = F.santimToEtb(data.stake);
    if (document.activeElement !== entry.stakeInput) {
      entry.stakeInput.value = F.santimToEtb(data.stake);
    }
    entry.stakeBox.setAttribute('aria-label', `${T('stake')}: ${F.formatMoney(data.stake)}`);
    for (const chip of entry.chips) {
      chip.classList.toggle('is-active', Number(chip.dataset.chip) === data.stake);
    }

    entry.autoValue.textContent = data.auto == null ? '— — —' : F.formatMultiplierNumber(data.auto);
    entry.autoBox.classList.toggle('is-off', data.auto == null);
    entry.autoBox.setAttribute(
      'aria-label',
      data.auto == null ? T('auto_cashout') : `${T('auto_cashout')}: ${F.formatMultiplier(data.auto)}`
    );
    if (document.activeElement !== entry.autoInput) {
      entry.autoInput.value = data.auto == null ? '' : F.formatMultiplierNumber(data.auto);
    }
    for (const chip of entry.autoChips) {
      chip.classList.toggle('is-active', data.auto != null && Number(chip.dataset.mult) === data.auto);
    }

    const bet = betFor(panel);
    if (data.busy) {
      setButton(panel, '…', '', { disabled: true, className: 'is-waiting' });
      return;
    }
    if (!state.round) {
      setButton(panel, T('waiting_next'), '', { disabled: true, className: 'is-waiting' });
      return;
    }
    if (bet && bet.status === 'open') {
      if (isCurrentFlyingBet(bet)) {
        const multiplier = window.CrashStore.currentMultiplier();
        const potential = CURVE.payoutSantim(bet.stake, multiplier);
        setButton(panel, T('cash_out'), `${F.santimToEtb(potential)} ETB`, {
          className: 'is-cashout'
        });
      } else {
        setButton(panel, T('bet_placed'), T('waiting_next'), {
          disabled: true,
          className: 'is-placed'
        });
      }
      return;
    }
    if (bet && bet.status === 'cashed') {
      setButton(panel, T('won'), `+${F.santimToEtb(bet.payout)} ETB`, {
        disabled: true,
        className: 'is-won'
      });
      return;
    }
    if (bet && bet.status === 'lost') {
      setButton(panel, T('lost'), '', { disabled: true, className: 'is-lost' });
      return;
    }

    const accepting = acceptingRoundId();
    if (accepting == null) {
      setButton(panel, T('waiting_next'), '', { disabled: true, className: 'is-waiting' });
      return;
    }
    if (placementPaused()) {
      setButton(panel, T('paused_short'), T('reconnecting'), {
        disabled: true,
        className: 'is-waiting'
      });
      return;
    }
    if (state.balance != null && state.balance < data.stake) {
      setButton(panel, T('place_bet'), T('low_balance'), {
        disabled: true,
        className: 'is-waiting'
      });
      return;
    }
    const next = acceptingRoundId() !== state.round.id || state.phase !== 'betting';
    setButton(
      panel,
      T('place_bet'),
      next ? `${T('next_round_short')} · ${F.santimToEtb(data.stake)} ETB` : `${F.santimToEtb(data.stake)} ETB`,
      { className: '' }
    );
  }

  function renderAutoHeader() {
    if (!autoBtn) return;
    autoBtn.classList.toggle('is-active', auto.active);
    if (autoRemainingEl) {
      autoRemainingEl.hidden = !auto.active;
      autoRemainingEl.textContent = auto.active ? String(auto.remaining) : '';
    }
    autoBtn.setAttribute(
      'aria-label',
      auto.active ? `${T('stop_auto')} (${auto.remaining})` : 'AUTO'
    );
  }

  function syncAutoDialog() {
    if (!autoDialog) return;
    for (const chip of autoCounts ? $$('button', autoCounts) : []) {
      const value = Number(chip.dataset.count);
      chip.classList.toggle('is-active', value === auto.chosenCount);
      chip.disabled = auto.active;
    }
    const below = $('#autoStopBelow', autoDialog);
    const win = $('#autoStopWin', autoDialog);
    const loss = $('#autoStopLoss', autoDialog);
    if (below && document.activeElement !== below) {
      below.value = auto.stopBelow == null ? '' : F.santimToEtb(auto.stopBelow);
    }
    if (win && document.activeElement !== win) {
      win.value = auto.stopWin == null ? '' : F.santimToEtb(auto.stopWin);
    }
    if (loss && document.activeElement !== loss) {
      loss.value = auto.stopLoss == null ? '' : F.santimToEtb(auto.stopLoss);
    }
    if (autoStartBtn) {
      autoStartBtn.textContent = auto.active ? T('stop_auto') : T('start_auto');
      autoStartBtn.classList.toggle('is-stop', auto.active);
    }
  }

  function render() {
    renderPanel(1);
    renderPanel(2);
    renderAutoHeader();
    syncShellRoundState();
  }

  function tick() {
    const state = window.CrashStore.state;
    for (const panel of [1, 2]) {
      const bet = betFor(panel);
      if (!bet || bet.status !== 'open' || !isCurrentFlyingBet(bet)) continue;
      const potential = CURVE.payoutSantim(bet.stake, window.CrashStore.currentMultiplier());
      const entry = dom[panel];
      if (entry && entry.btn.classList.contains('is-cashout')) {
        const text = `${F.santimToEtb(potential)} ETB`;
        if (entry.sub.textContent !== text) entry.sub.textContent = text;
      }
    }
    if (!state.round) return;
  }

  function setStake(panel, value, { persist = true } = {}) {
    panels[panel].stake = clampStake(value);
    if (persist) storageSet(`crash-stake-${panel}`, panels[panel].stake);
    renderPanel(panel);
  }

  function setAutoTarget(panel, target) {
    panels[panel].auto = target == null ? null : Number(target);
    storageSet(`crash-auto-${panel}`, panels[panel].auto == null ? '' : panels[panel].auto);
    renderPanel(panel);
  }

  function openPop(panel, which) {
    const entry = dom[panel];
    if (!entry) return;
    const stakeOpen = which === 'stake';
    entry.stakePop.hidden = !stakeOpen;
    entry.autoPop.hidden = stakeOpen;
    for (const other of [1, 2]) {
      if (other === panel) continue;
      dom[other].stakePop.hidden = true;
      dom[other].autoPop.hidden = true;
    }
    if (stakeOpen) entry.stakeInput.value = F.santimToEtb(panels[panel].stake);
    else entry.autoInput.value = panels[panel].auto == null ? '' : F.formatMultiplierNumber(panels[panel].auto);
  }

  function closePops() {
    for (const panel of [1, 2]) {
      if (!dom[panel]) continue;
      dom[panel].stakePop.hidden = true;
      dom[panel].autoPop.hidden = true;
    }
  }

  function commitStakeInput(panel) {
    const entry = dom[panel];
    if (!entry) return;
    const parsed = F.parseEtbToSantim(entry.stakeInput.value);
    if (parsed == null || parsed < C.minStake || parsed > C.maxStake) {
      entry.stakeInput.value = F.santimToEtb(panels[panel].stake);
      toast(T('stake_bounds', {
        min: F.santimToEtb(C.minStake),
        max: F.santimToEtb(C.maxStake)
      }), 'error');
      return;
    }
    setStake(panel, parsed);
    entry.stakeInput.value = F.santimToEtb(panels[panel].stake);
  }

  function parseMultiplierInput(text) {
    const raw = String(text == null ? '' : text).trim().replace(/×/g, '').replace(/,/g, '');
    const match = /^(\d{1,4})(?:\.(\d{0,2}))?$/.exec(raw);
    if (!match) return null;
    const whole = Number(match[1]);
    const fraction = Number((match[2] || '').padEnd(2, '0'));
    const hundredths = whole * 100 + fraction;
    if (!Number.isSafeInteger(hundredths)) return null;
    if (hundredths < C.minAutoCashout || hundredths > C.maxHundredths) return null;
    return hundredths;
  }

  function commitAutoInput(panel) {
    const entry = dom[panel];
    if (!entry) return;
    const raw = entry.autoInput.value.trim();
    if (!raw) {
      setAutoTarget(panel, null);
      entry.autoPop.hidden = true;
      return;
    }
    const target = parseMultiplierInput(raw);
    if (target == null) {
      toast(T('auto_bounds'), 'error');
      return;
    }
    setAutoTarget(panel, target);
    entry.autoPop.hidden = true;
  }

  async function refreshFromServer() {
    try {
      const snapshot = await window.CrashNet.refresh();
      if (snapshot) window.CrashStore.applySnapshot(snapshot);
    } catch (_) { /* the stream will recover */ }
  }

  async function place(panel, { silent = false } = {}) {
    const state = window.CrashStore.state;
    const data = panels[panel];
    if (placementPaused()) {
      toast(T('paused_error'), 'error');
      return false;
    }
    if (state.balance != null && state.balance < data.stake) {
      toast(T('insufficient'), 'error');
      return false;
    }
    if (!silent) {
      data.busy = true;
      renderPanel(panel);
    }
    try {
      const result = await window.CrashNet.placeBet({
        panel,
        stake: data.stake,
        autoCashout: data.auto,
        requestId: requestId()
      });
      if (result.balance != null) window.CrashStore.setBalance(result.balance);
      if (result.bet) window.CrashStore.mergeMyBet(result.bet);
      if (!silent) {
        toast(T('bet_placed_toast', { amount: F.santimToEtb(data.stake) }), 'win');
        beep('bet');
        announce(T('bet_placed_toast', { amount: F.santimToEtb(data.stake) }));
      }
      postToShell({ type: 'fetan-wallet-refresh' });
      return true;
    } catch (err) {
      const message = friendly(err.message);
      toast(message, 'error');
      if (['PANEL_BUSY', 'BETTING_CLOSED', 'ROUND_CRASHED', 'INSUFFICIENT', 'RATE'].includes(err.message)) {
        void refreshFromServer();
      }
      throw err;
    } finally {
      if (!silent) {
        data.busy = false;
        renderPanel(panel);
      }
    }
  }

  async function cashOut(panel, bet) {
    const data = panels[panel];
    data.busy = true;
    renderPanel(panel);
    try {
      const result = await window.CrashNet.cashout(bet.id);
      if (result.balance != null) window.CrashStore.setBalance(result.balance);
      if (result.bet) window.CrashStore.mergeMyBet(result.bet);
      lastManualCashout = { id: bet.id, at: Date.now() };
      const payout = result.bet ? result.bet.payout : bet.payout;
      const multiplier = result.bet ? result.bet.cashoutHundredths : null;
      if (multiplier != null) {
        const message = T('cashed_out_toast', {
          m: F.formatMultiplier(multiplier),
          amount: F.santimToEtb(payout)
        });
        toast(message, 'win');
        announce(message);
      }
      beep('cashout');
      postToShell({ type: 'fetan-wallet-refresh' });
      if (auto.active && auto.stopWin != null && payout >= auto.stopWin) stopAuto('win');
      return true;
    } catch (err) {
      toast(friendly(err.message), 'error');
      void refreshFromServer();
      return false;
    } finally {
      data.busy = false;
      renderPanel(panel);
    }
  }

  function onAction(panel) {
    const data = panels[panel];
    if (data.busy) return;
    const bet = betFor(panel);
    if (isCurrentFlyingBet(bet)) {
      void cashOut(panel, bet);
      return;
    }
    if (bet) return;
    void place(panel).catch(() => {});
  }

  function stopAuto(reason) {
    if (!auto.active) return;
    auto.active = false;
    auto.remaining = 0;
    auto.placing = false;
    auto.lastRoundId = null;
    renderAutoHeader();
    if (autoDialog && autoDialog.open) syncAutoDialog();
    if (reason === 'complete') toast(T('auto_complete'), 'win');
    else if (reason === 'balance') toast(T('auto_stop_balance'), 'error');
    else if (reason === 'win') toast(T('auto_stop_win'), 'win');
    else if (reason === 'loss') toast(T('auto_stop_loss'), 'error');
    else if (reason === 'offline') toast(T('auto_stop_offline'), 'error');
    else if (reason === 'error') toast(T('auto_stop_error'), 'error');
  }

  async function runAutoRound(roundId) {
    if (!auto.active || auto.placing) return;
    const state = window.CrashStore.state;
    if (state.connection === 'offline' || pausedOverride) {
      stopAuto('offline');
      return;
    }
    if (auto.stopBelow != null && state.balance != null && state.balance < auto.stopBelow) {
      stopAuto('balance');
      return;
    }
    const targets = [1, 2].filter((panel) => !window.CrashStore.myBet(roundId, panel));
    if (!targets.length) return;

    auto.placing = true;
    auto.lastRoundId = roundId;
    let placed = 0;
    try {
      for (const panel of targets) {
        try {
          const ok = await place(panel, { silent: true });
          if (ok) placed += 1;
        } catch (err) {
          auto.placing = false;
          stopAuto('error');
          return;
        }
      }
      if (!auto.active) return;
      if (placed > 0) {
        auto.remaining = Math.max(0, auto.remaining - 1);
        if (auto.remaining === 0) {
          stopAuto('complete');
        } else {
          renderAutoHeader();
        }
      }
    } finally {
      auto.placing = false;
    }
  }

  function evaluateAutoResults() {
    if (!auto.active) return;
    const state = window.CrashStore.state;
    const round = state.round;
    if (!round || round.phase !== 'crashed') return;
    if (auto.lastEvaluated === round.id) return;
    const mine = state.myBets.filter((bet) => bet.roundId === round.id);
    if (!mine.length) return;
    auto.lastEvaluated = round.id;
    for (const bet of mine) {
      if (bet.status === 'cashed' && auto.stopWin != null && bet.payout >= auto.stopWin) {
        stopAuto('win');
        return;
      }
      if (bet.status === 'lost' && auto.stopLoss != null && bet.stake >= auto.stopLoss) {
        stopAuto('loss');
        return;
      }
    }
  }

  function autoTick() {
    if (!auto.active) return;
    const state = window.CrashStore.state;
    if (state.connection === 'offline' || pausedOverride) {
      stopAuto('offline');
      return;
    }
    if (auto.stopBelow != null && state.balance != null && state.balance < auto.stopBelow) {
      stopAuto('balance');
      return;
    }
    evaluateAutoResults();
    const roundId = acceptingRoundId();
    if (roundId == null || roundId === auto.lastRoundId) return;
    void runAutoRound(roundId);
  }

  function readStopField(input) {
    if (!input) return null;
    const raw = input.value.trim();
    if (!raw) return null;
    const santim = F.parseEtbToSantim(raw);
    if (santim == null) return undefined;
    return santim;
  }

  function startAuto() {
    if (auto.active) {
      stopAuto('manual');
      syncAutoDialog();
      return;
    }
    const below = readStopField($('#autoStopBelow', autoDialog));
    const win = readStopField($('#autoStopWin', autoDialog));
    const loss = readStopField($('#autoStopLoss', autoDialog));
    if (below === undefined || win === undefined || loss === undefined) {
      toast(T('invalid_input'), 'error');
      return;
    }
    auto.active = true;
    auto.total = auto.chosenCount;
    auto.remaining = auto.chosenCount;
    auto.stopBelow = below;
    auto.stopWin = win;
    auto.stopLoss = loss;
    auto.lastRoundId = null;
    auto.lastEvaluated = null;
    auto.placing = false;
    autoDialog?.close();
    renderAutoHeader();
    toast(T('auto_started', { n: auto.remaining }), 'win');
    announce(T('auto_started', { n: auto.remaining }));
    autoTick();
  }

  function syncShellRoundState() {
    if (!document.documentElement.classList.contains('fetan-integrated')) return;
    const state = window.CrashStore.state;
    const active = [1, 2].some((panel) => isCurrentFlyingBet(betFor(panel)));
    const canAct = active && state.connection === 'online';
    const key = `${active}:${canAct}`;
    if (key === shellState) return;
    shellState = key;
    postToShell({
      type: 'fetan-round-state',
      active,
      canAct,
      actionLabel: active ? T('cash_out') : ''
    });
  }

  function bindPanel(panel, root) {
    const entry = {
      root,
      stakeBox: $('[data-stake-toggle]', root),
      stake: $('[data-stake]', root),
      autoBox: $('[data-auto-toggle]', root),
      autoValue: $('[data-auto-value]', root),
      btn: $('[data-action]', root),
      stakePop: $('[data-stake-pop]', root),
      autoPop: $('[data-auto-pop]', root),
      stakeInput: $('[data-stake-input]', root),
      autoInput: $('[data-auto-input]', root),
      chips: $$('[data-chip]', root),
      autoChips: $$('[data-mult]', root)
    };
    entry.label = document.createElement('span');
    entry.sub = document.createElement('span');
    entry.sub.className = 'btn-sub';
    entry.btn.replaceChildren(entry.label, entry.sub);
    dom[panel] = entry;

    entry.btn.addEventListener('click', () => onAction(panel));
    entry.stakeBox.addEventListener('click', (event) => {
      event.stopPropagation();
      openPop(panel, 'stake');
    });
    entry.autoBox.addEventListener('click', (event) => {
      event.stopPropagation();
      openPop(panel, 'auto');
    });
    for (const close of $$('[data-close]', root)) {
      close.addEventListener('click', () => closePops());
    }

    for (const button of $$('[data-step]', root)) {
      button.addEventListener('click', () => {
        const delta = button.dataset.step === '+' ? 100 : -100;
        setStake(panel, panels[panel].stake + delta);
        entry.stakeInput.value = F.santimToEtb(panels[panel].stake);
      });
    }
    for (const chip of entry.chips) {
      chip.addEventListener('click', () => {
        setStake(panel, Number(chip.dataset.chip));
        entry.stakeInput.value = F.santimToEtb(panels[panel].stake);
      });
    }
    $('[data-half]', root)?.addEventListener('click', () => {
      setStake(panel, Math.max(C.minStake, Math.floor(panels[panel].stake / 2)));
      entry.stakeInput.value = F.santimToEtb(panels[panel].stake);
    });
    $('[data-double]', root)?.addEventListener('click', () => {
      setStake(panel, Math.min(C.maxStake, panels[panel].stake * 2));
      entry.stakeInput.value = F.santimToEtb(panels[panel].stake);
    });
    entry.stakeInput.addEventListener('change', () => commitStakeInput(panel));
    entry.stakeInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commitStakeInput(panel);
      }
    });

    for (const chip of entry.autoChips) {
      chip.addEventListener('click', () => {
        entry.autoInput.value = F.formatMultiplierNumber(Number(chip.dataset.mult));
      });
    }
    $('[data-clear]', root)?.addEventListener('click', () => {
      setAutoTarget(panel, null);
      entry.autoInput.value = '';
      entry.autoPop.hidden = true;
    });
    $('[data-auto-confirm]', root)?.addEventListener('click', () => commitAutoInput(panel));
    entry.autoInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commitAutoInput(panel);
      }
    });
  }

  function bindGlobal() {
    document.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.pop') || target.closest('.stake-box') || target.closest('.auto-box')) return;
      closePops();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closePops();
    });
  }

  function init() {
    for (const panel of [1, 2]) {
      const root = document.querySelector(`.bet-panel[data-panel="${panel}"]`);
      if (root) bindPanel(panel, root);
      const savedStake = Number(storageGet(`crash-stake-${panel}`));
      if (Number.isSafeInteger(savedStake) && savedStake >= C.minStake && savedStake <= C.maxStake) {
        panels[panel].stake = savedStake;
      }
      const savedAuto = Number(storageGet(`crash-auto-${panel}`));
      if (Number.isSafeInteger(savedAuto) && savedAuto >= C.minAutoCashout && savedAuto <= C.maxHundredths) {
        panels[panel].auto = savedAuto;
      }
    }

    autoBtn = document.getElementById('autoBtn');
    autoRemainingEl = document.getElementById('autoRemaining');
    autoDialog = document.getElementById('autoDialog');
    autoStartBtn = document.getElementById('autoStartBtn');
    autoCounts = document.getElementById('autoCounts');

    autoBtn?.addEventListener('click', () => {
      syncAutoDialog();
      if (typeof autoDialog?.showModal === 'function') autoDialog.showModal();
    });
    for (const close of autoDialog ? $$('[data-dialog-close]', autoDialog) : []) {
      close.addEventListener('click', () => autoDialog.close());
    }
    for (const chip of autoCounts ? $$('button[data-count]', autoCounts) : []) {
      chip.addEventListener('click', () => {
        if (auto.active) return;
        auto.chosenCount = Number(chip.dataset.count) || 10;
        syncAutoDialog();
      });
    }
    autoStartBtn?.addEventListener('click', startAuto);

    bindGlobal();
    window.CrashStore.subscribe((kind) => {
      if (['snapshot', 'phase', 'bet', 'cashout', 'crash', 'mybet', 'balance', 'connection'].includes(kind)) {
        render();
        if (['snapshot', 'phase', 'crash', 'balance'].includes(kind)) autoTick();
      }
      if (kind === 'settings') render();
    });
    render();
    syncAutoDialog();
  }

  function setPaused(reason) {
    pausedOverride = reason || null;
    render();
  }

  function wasJustCashed(betId) {
    return Boolean(
      lastManualCashout &&
      String(lastManualCashout.id) === String(betId) &&
      Date.now() - lastManualCashout.at < 5000
    );
  }

  function cashOutActive() {
    for (const panel of [1, 2]) {
      const bet = betFor(panel);
      if (isCurrentFlyingBet(bet) && !panels[panel].busy) onAction(panel);
    }
  }

  return {
    init,
    render,
    tick,
    setPaused,
    wasJustCashed,
    cashOutActive,
    isAutoActive: () => auto.active,
    _panels: panels
  };
})();
