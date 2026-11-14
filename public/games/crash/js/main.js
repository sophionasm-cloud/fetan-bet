// Rocket Crash bootstrap. The store is the only shared state; the network
// layer feeds it, and every renderer subscribes to it.
'use strict';
(function () {
  const T = window.CrashI18n.t;
  let refreshTimer = null;

  function applyOffset(snapshot) {
    if (!snapshot || !snapshot.serverTime) return;
    window.CrashStore.setOffset(Number(snapshot.serverTime) - Date.now());
  }

  function fatal(error) {
    const message = error && error.message === 'SESSION'
      ? T('session_expired')
      : T('paused_error');
    window.CrashUI.setPaused(message);
    window.CrashControls.setPaused(message);
    window.CrashUI.toast(message, 'error');
    window.CrashUI.announce(message);
  }

  function refreshSoon(delay = 220) {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      refreshTimer = null;
      try {
        const snapshot = await window.CrashNet.refresh();
        if (snapshot) {
          applyOffset(snapshot);
          window.CrashStore.applySnapshot(snapshot);
        }
      } catch (err) {
        if (err.status === 401 || err.message === 'CRASH_DISABLED') fatal(err);
      }
    }, delay);
  }

  function handleEvent(name, data) {
    if (!data) return;
    if (name === 'snapshot') {
      applyOffset(data);
      window.CrashStore.applySnapshot(data);
      window.CrashUI.clearPaused();
      window.CrashControls.setPaused(null);
      return;
    }
    if (name === 'phase') {
      window.CrashStore.applyPhase(data.round);
      return;
    }
    if (name === 'tick') {
      window.CrashStore.applyTick(data);
      return;
    }
    if (name === 'bet') {
      const mine = window.CrashStore.isOwnBet(data.bet?.id) || Boolean(data.bet?.mine);
      window.CrashStore.applyBet(data.bet);
      if (mine) refreshSoon();
      return;
    }
    if (name === 'cashout') {
      const bet = data.bet;
      const mine = bet && (window.CrashStore.isOwnBet(bet.id) || bet.mine);
      const alreadyNotified = bet && window.CrashControls.wasJustCashed?.(bet.id);
      window.CrashStore.applyCashout(bet);
      if (mine) {
        if (!alreadyNotified && bet.status === 'cashed') {
          const message = T('won_toast', {
            amount: window.CrashFormat.santimToEtb(bet.payout),
            m: window.CrashFormat.formatMultiplier(bet.cashoutHundredths)
          });
          window.CrashUI.toast(message, 'win');
          window.CrashUI.announce(message);
          window.CrashUI.beep('cashout');
        }
        window.CrashUI.updateReadout();
        refreshSoon(120);
        if (document.documentElement.classList.contains('fetan-integrated')) {
          try {
            window.parent.postMessage({ type: 'fetan-wallet-refresh' }, location.origin);
          } catch (_) { /* optional */ }
        }
      }
      return;
    }
    if (name === 'crash') {
      window.CrashStore.applyCrash(data.round);
      return;
    }
    if (name === 'history') {
      window.CrashStore.applyHistory(data.history);
      return;
    }
    if (name === 'fatal') {
      fatal(data);
    }
  }

  function boot() {
    window.CrashChart.init(document.getElementById('chart'));
    window.CrashFeed.init();
    window.CrashHistory.init();
    window.CrashControls.init();
    window.CrashUI.init();

    window.CrashNet.connect({
      status: (status) => {
        window.CrashStore.setConnection(status);
      },
      event: handleEvent
    });

    window.addEventListener('offline', () => window.CrashStore.setConnection('offline'));
    window.addEventListener('pagehide', () => window.CrashNet.stop(), { once: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
