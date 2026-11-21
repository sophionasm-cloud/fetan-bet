'use strict';

(() => {
  const config = window.SLOT_CONFIG;
  const ui = window.SLOT_UI.mount(config, handleAction);
  let fairness = null;
  let pendingRequest = null;
  let autoRemaining = 0;
  let autoTimer = null;
  let initialized = false;
  let spinInFlight = false;

  function requestId() { return crypto.randomUUID().toLowerCase(); }
  function postWalletRefresh() {
    window.parent.postMessage({ type: 'fetan-wallet-refresh' }, location.origin);
  }
  function mapError(error) {
    if (error.code === 'INSUFFICIENT') return 'insufficient';
    if (error.code === 'WAGERING_PAUSED' || error.code === 'WAGERING_DISABLED') return 'paused';
    if (error.code === 'SPIN_IN_PROGRESS') return 'inProgress';
    if (error.code === 'RATE_LIMITED') return 'rate';
    if (error.status === 401 || error.status === 403) return 'login';
    if (error.code === 'RATE') return 'rate';
    if (error.code === 'INVALID') return 'invalid';
    return 'unavailable';
  }
  function showError(error) {
    ui.setStatus(mapError(error), 'error');
    const replaySafe = pendingRequest && (error.retryable || error.code === 'SPIN_IN_PROGRESS' || error.code === 'RESULT_MISMATCH');
    ui.setRetryLocked(Boolean(replaySafe));
    if (!replaySafe) pendingRequest = null;
  }
  async function spin() {
    if (!initialized || spinInFlight) return;
    if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
    const bet = ui.getBet();
    if (!SLOT_MATH.isValidBet(bet)) { ui.setStatus('invalid', 'error'); return; }
    if (ui.getBalance() < bet) {
      if (autoRemaining > 0) stopAuto('autoStoppedBalance');
      else ui.setStatus('insufficient', 'error');
      return;
    }
    if (!pendingRequest || pendingRequest.bet !== bet) pendingRequest = { bet, requestId: requestId() };
    spinInFlight = true;
    ui.setBusy(true);
    ui.setStatus('spinning');
    try {
      const result = await SLOT_NET.spin(pendingRequest);
      const checked = SLOT_MATH.evaluateStops(result.stops, bet);
      if (JSON.stringify(checked.grid) !== JSON.stringify(result.grid) ||
          JSON.stringify(checked.wins) !== JSON.stringify(result.wins) || checked.totalPayout !== result.totalPayout) {
        throw Object.assign(new Error('RESULT_MISMATCH'), { code: 'RESULT_MISMATCH' });
      }
      await SLOT_REELS.animate(result, { turbo: ui.getTurbo() });
      await ui.setResult(result);
      pendingRequest = null;
      ui.setRetryLocked(false);
      fairness = result.fairness || fairness;
      postWalletRefresh();
      if (autoRemaining > 0) {
        autoRemaining--;
        const multiple = result.totalPayout / bet;
        if (config.AUTO_STOP_ON_BALANCE_DEFAULT && result.balance < bet) stopAuto('autoStoppedBalance');
        else if (config.AUTO_STOP_ON_BIG_WIN_DEFAULT && multiple >= config.BIG_WIN_MULTIPLE) stopAuto('autoStoppedWin');
        else if (config.AUTO_STOP_ON_SINGLE_LOSS_DEFAULT && result.totalPayout === 0) stopAuto('autoStoppedLoss');
        else if (autoRemaining === 0) stopAuto('autoDone');
      }
    } catch (error) {
      if (pendingRequest && error.code !== 'INVALID' && error.code !== 'INSUFFICIENT' && error.code !== 'WAGERING_DISABLED') {
        error.retryable = true;
      }
      showError(error);
      if (autoRemaining > 0) stopAuto(error.code === 'INSUFFICIENT' ? 'autoStoppedBalance' : null);
    } finally {
      spinInFlight = false;
      ui.setBusy(false);
      if (autoRemaining > 0 && !autoTimer) autoTimer = setTimeout(() => { autoTimer = null; spin(); }, config.AUTO_SPIN_DELAY_MS);
    }
  }
  function stopAuto(message) {
    autoRemaining = 0;
    if (autoTimer) clearTimeout(autoTimer);
    autoTimer = null;
    ui.setAuto(false);
    if (message) ui.setStatus(message);
  }
  function startAuto(count) {
    if (!initialized || !Number.isInteger(count) || !config.AUTO_COUNTS.includes(count)) return;
    autoRemaining = count;
    ui.setAuto(true);
    if (!autoTimer) spin();
  }
  function handleAction(action, value) {
    if (action === 'spin') return spin();
    if (action === 'fairness') { ui.showFairness(fairness); return; }
    if (action === 'start-auto') return startAuto(value);
    if (action === 'stop-auto') return stopAuto();
  }
  async function start() {
    try {
      const state = await SLOT_NET.state();
      const locale = await SLOT_I18N.load(state.language);
      ui.setLocale(locale);
      ui.setState(state);
      fairness = state.fairness;
      ui.setLocalPreview(SLOT_NET.mockEnabled);
      initialized = true;
    } catch (error) {
      try {
        const fallbackLocale = await SLOT_I18N.load(localStorage.getItem('lang') || config.DEFAULT_LANGUAGE);
        ui.setLocale(fallbackLocale);
      } catch (_) {}
      ui.setStatus(mapError(error), 'error');
      ui.setLocalPreview(SLOT_NET.mockEnabled);
    }
  }

  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.source !== window.parent || typeof event.data?.type !== 'string') return;
    if (event.data.type !== 'fetan-shell-action') return;
    if (event.data.action === 'how') ui.openPaytable();
    if (event.data.action === 'fair') ui.showFairness(fairness);
    if (event.data.action === 'sound') {
      const soundButton = document.getElementById('soundButton');
      if (soundButton) soundButton.click();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.repeat || event.target.matches('input,select,textarea,[contenteditable="true"]')) return;
    if (event.target.closest('dialog[open]')) return;
    if (event.code === 'Space' && !event.target.closest('button')) { event.preventDefault(); spin(); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); document.getElementById('betDown').click(); }
    if (event.key === 'ArrowRight') { event.preventDefault(); document.getElementById('betUp').click(); }
    if (event.key === 'Escape' && autoRemaining > 0) stopAuto();
  });

  start();
})();
