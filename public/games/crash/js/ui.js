// Shared UI glue: readout, connection, balance, drawer, settings, toasts,
// synthesized sounds, fullscreen and the integrated-shell message bridge.
'use strict';
window.CrashUI = (function () {
  const C = window.CrashConfig;
  const F = window.CrashFormat;
  const T = window.CrashI18n.t;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  let readout = null;
  let multValue = null;
  let kickerEl = null;
  let labelEl = null;
  let countEl = null;
  let barEl = null;
  let connEl = null;
  let clockEl = null;
  let balanceEl = null;
  let balanceCur = null;
  let trophyEl = null;
  let pausedBanner = null;
  let demoBadge = null;
  let toastRegion = null;
  let liveRegion = null;
  let drawer = null;
  let scrim = null;
  let menuBtn = null;
  let settings = { sound: true, reducedEffects: false };
  let fatalMessage = null;
  let lastConnection = null;
  let lastCrashAnnounced = null;
  let lastOpenAnnounced = null;
  let audioCtx = null;
  let clockTimer = null;
  let readoutTimer = null;

  function oneDecimal(ms) {
    const tenths = Math.max(0, Math.floor(Number(ms) / 100));
    return `${Math.floor(tenths / 10)}.${tenths % 10}`;
  }

  function setText(node, text) {
    if (node && node.textContent !== text) node.textContent = text;
  }

  function toast(message, kind) {
    if (!toastRegion || !message) return;
    const node = document.createElement('div');
    node.className = `toast${kind === 'win' ? ' is-win' : kind === 'error' ? ' is-error' : ''}`;
    node.textContent = String(message);
    toastRegion.appendChild(node);
    while (toastRegion.children.length > 3) toastRegion.firstElementChild?.remove();
    setTimeout(() => {
      node.classList.add('is-out');
      setTimeout(() => node.remove(), 280);
    }, 2600);
  }

  function announce(message) {
    if (!liveRegion || !message) return;
    liveRegion.textContent = '';
    requestAnimationFrame(() => {
      liveRegion.textContent = String(message);
    });
  }

  function unlockAudio() {
    if (audioCtx) {
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
      return;
    }
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return;
    try { audioCtx = new AudioCtor(); } catch (_) { audioCtx = null; }
  }

  function tone(frequency, delay, duration, type, volume, endFrequency) {
    if (!audioCtx) return;
    try {
      const start = audioCtx.currentTime + delay;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(frequency, start);
      if (endFrequency) osc.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume || 0.04, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(start);
      osc.stop(start + duration + 0.03);
    } catch (_) { /* audio is optional */ }
  }

  function beep(kind) {
    if (!settings.sound || !audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    if (kind === 'bet') tone(520, 0, 0.09, 'sine', 0.035);
    else if (kind === 'cashout') {
      tone(660, 0, 0.11, 'sine', 0.045);
      tone(900, 0.09, 0.14, 'sine', 0.04);
    } else if (kind === 'crash') {
      tone(180, 0, 0.3, 'sawtooth', 0.03, 60);
    }
  }

  function updateBalance() {
    const state = window.CrashStore.state;
    setText(balanceEl, state.balance == null ? '—' : F.santimToEtb(state.balance));
    setText(balanceCur, state.currency || 'ETB');
  }

  function updateConnection() {
    const state = window.CrashStore.state;
    const labels = {
      online: T('connected'),
      reconnecting: T('reconnecting'),
      offline: T('offline'),
      connecting: T('connecting')
    };
    const label = labels[state.connection] || T('connecting');
    if (connEl) {
      connEl.dataset.state = state.connection;
      connEl.title = label;
      connEl.setAttribute('aria-label', label);
    }
    if (lastConnection && lastConnection !== state.connection) {
      if (state.connection === 'online') announce(T('connected'));
      else if (state.connection === 'offline') announce(T('offline'));
    }
    lastConnection = state.connection;
    syncPaused();
  }

  function syncPaused() {
    if (!pausedBanner) return;
    const offline = window.CrashStore.state.connection === 'offline';
    const show = Boolean(fatalMessage) || offline;
    pausedBanner.hidden = !show;
    if (!show) return;
    const strong = pausedBanner.querySelector('strong');
    const hint = pausedBanner.querySelector('span');
    if (fatalMessage) {
      setText(strong, fatalMessage);
      if (hint) hint.hidden = true;
    } else {
      setText(strong, T('betting_paused'));
      if (hint) {
        hint.hidden = false;
        setText(hint, T('betting_paused_hint'));
      }
    }
  }

  function updateTrophy() {
    const state = window.CrashStore.state;
    let best = 0;
    for (const bet of state.bets) {
      if (bet.status === 'cashed' && Number(bet.payout) > best) best = Number(bet.payout);
    }
    setText(trophyEl, F.santimToEtb(best));
  }

  function updateDemo() {
    if (!demoBadge) return;
    demoBadge.hidden = !window.CrashStore.state.mock;
  }

  function updateReadout() {
    const state = window.CrashStore.state;
    if (!readout) return;
    let kicker = T('connecting');
    let value = '—';
    let label = T('bets');
    let count = String(window.CrashStore.openBetCount());
    let betting = false;
    let crashed = false;
    let hot = false;
    let track = 0;

    if (state.round && state.phase === 'betting') {
      const ms = window.CrashStore.countdownMs();
      kicker = `${T('next_round')} · ${oneDecimal(ms)}s`;
      value = '1.00';
      label = T('bets');
      count = String(window.CrashStore.openBetCount());
      betting = true;
      track = Math.max(0, Math.min(1, ms / Math.max(1, (state.config || C).bettingMs)));
    } else if (state.round && state.phase === 'flying') {
      const multiplier = window.CrashStore.currentMultiplier();
      kicker = T('in_flight');
      value = F.formatMultiplierNumber(multiplier);
      label = T('bets');
      count = String(window.CrashStore.openBetCount());
      hot = multiplier >= C.redPillThreshold;
    } else if (state.round && state.phase === 'crashed') {
      kicker = T('flew_away');
      value = F.formatMultiplierNumber(state.round.crashHundredths);
      label = T('table_round');
      count = `#${state.round.id}`;
      crashed = true;
    }

    setText(kickerEl, kicker);
    setText(multValue, value);
    setText(labelEl, label);
    setText(countEl, count);
    readout.classList.toggle('is-betting', betting);
    readout.classList.toggle('is-crashed', crashed);
    readout.classList.toggle('is-hot', hot);
    if (barEl) barEl.style.transform = `scaleX(${track})`;
    readout.setAttribute('aria-label', `${kicker} ${value} ${label} ${count}`);
  }

  function syncSettings() {
    const state = window.CrashStore.state;
    settings = state.settings;
    const soundBtn = document.getElementById('soundBtn');
    if (soundBtn) {
      soundBtn.setAttribute('aria-pressed', settings.sound ? 'true' : 'false');
      soundBtn.setAttribute('aria-label', settings.sound ? T('mute_sound') : T('unmute_sound'));
      soundBtn.title = settings.sound ? T('mute_sound') : T('unmute_sound');
    }
    const soundToggle = document.getElementById('settingSound');
    if (soundToggle) soundToggle.checked = settings.sound;
    const reducedToggle = document.getElementById('settingReduced');
    if (reducedToggle) reducedToggle.checked = settings.reducedEffects;
    document.documentElement.classList.toggle('reduced-effects', settings.reducedEffects);
    window.CrashChart?.setReduced(settings.reducedEffects);
  }

  function toggleSound() {
    unlockAudio();
    window.CrashStore.setSettings({ sound: !window.CrashStore.state.settings.sound });
  }

  function setDrawer(open, tab) {
    if (!drawer) return;
    drawer.hidden = !open;
    if (scrim) scrim.hidden = !open;
    menuBtn?.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      selectTab(tab || 'how');
      drawer.querySelector('#menuClose')?.focus();
    } else {
      menuBtn?.focus();
    }
  }

  function selectTab(name) {
    for (const tab of $$('[data-tab]', drawer)) {
      const active = tab.dataset.tab === name;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    for (const panel of $$('[data-panel-content]', drawer)) {
      panel.hidden = panel.dataset.panelContent !== name;
    }
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    } else {
      document.documentElement.requestFullscreen?.().catch(() => {});
    }
  }

  function onShellAction(action) {
    if (action === 'how') setDrawer(true, 'how');
    else if (action === 'history') void window.CrashHistory?.open();
    else if (action === 'fair') void window.CrashHistory?.openLatestVerify();
    else if (action === 'sound') toggleSound();
    else if (action === 'critical') window.CrashControls?.cashOutActive();
    else if (action === 'fullscreen') toggleFullscreen();
  }

  function init() {
    readout = document.getElementById('readout');
    multValue = document.querySelector('#multiplier .mult-value');
    kickerEl = document.getElementById('readoutKicker');
    labelEl = document.getElementById('readoutLabel');
    countEl = document.getElementById('openBets');
    barEl = document.getElementById('countdownBar');
    connEl = document.getElementById('conn');
    clockEl = document.getElementById('clock');
    balanceEl = document.getElementById('balanceValue');
    balanceCur = document.getElementById('balanceCurrency');
    trophyEl = document.getElementById('trophyValue');
    pausedBanner = document.getElementById('pausedBanner');
    demoBadge = document.getElementById('demoBadge');
    toastRegion = document.getElementById('toastRegion');
    liveRegion = document.getElementById('liveRegion');
    drawer = document.getElementById('menuDrawer');
    scrim = document.getElementById('drawerScrim');
    menuBtn = document.getElementById('menuBtn');

    document.addEventListener('pointerdown', unlockAudio, { once: true });
    document.getElementById('soundBtn')?.addEventListener('click', toggleSound);
    document.getElementById('fullscreenBtn')?.addEventListener('click', toggleFullscreen);
    document.getElementById('trophyBtn')?.addEventListener('click', () => {
      toast(T('biggest_payout'));
    });
    document.getElementById('settingSound')?.addEventListener('change', (event) => {
      unlockAudio();
      window.CrashStore.setSettings({ sound: event.target.checked });
    });
    document.getElementById('settingReduced')?.addEventListener('change', (event) => {
      window.CrashStore.setSettings({ reducedEffects: event.target.checked });
    });
    document.getElementById('fairVerifyBtn')?.addEventListener('click', () => {
      setDrawer(false);
      void window.CrashHistory?.openLatestVerify();
    });

    menuBtn?.addEventListener('click', () => setDrawer(true, 'how'));
    document.getElementById('menuClose')?.addEventListener('click', () => setDrawer(false));
    scrim?.addEventListener('click', () => setDrawer(false));
    for (const tab of $$('[data-tab]', drawer)) {
      tab.addEventListener('click', () => selectTab(tab.dataset.tab));
    }
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && drawer && !drawer.hidden) setDrawer(false);
    });
    document.addEventListener('fullscreenchange', () => {
      const button = document.getElementById('fullscreenBtn');
      if (!button) return;
      button.setAttribute('aria-label', document.fullscreenElement ? 'Exit fullscreen' : T('fullscreen'));
    });

    window.addEventListener('message', (event) => {
      if (event.origin !== location.origin || event.source !== window.parent) return;
      if (event.data?.type !== 'fetan-shell-action') return;
      onShellAction(String(event.data.action || ''));
    });

    clockTimer = setInterval(() => setText(clockEl, F.formatClock()), 10000);
    setText(clockEl, F.formatClock());
    readoutTimer = setInterval(updateReadout, 100);

    window.CrashStore.subscribe((kind) => {
      if (kind === 'connection') {
        updateConnection();
      } else if (kind === 'balance') {
        updateBalance();
      } else if (kind === 'settings') {
        syncSettings();
      } else if (kind === 'snapshot') {
        updateReadout();
        updateBalance();
        updateConnection();
        updateTrophy();
        updateDemo();
      } else if (kind === 'phase') {
        updateReadout();
        updateTrophy();
        updateDemo();
        const state = window.CrashStore.state;
        if (state.round && state.phase === 'betting' && lastOpenAnnounced !== state.round.id) {
          lastOpenAnnounced = state.round.id;
          announce(T('betting_open'));
        }
      } else if (kind === 'crash') {
        updateReadout();
        updateTrophy();
        const state = window.CrashStore.state;
        if (state.round && lastCrashAnnounced !== state.round.id) {
          lastCrashAnnounced = state.round.id;
          announce(T('round_crashed', { m: F.formatMultiplier(state.round.crashHundredths) }));
          beep('crash');
        }
      } else if (kind === 'bet' || kind === 'cashout') {
        updateTrophy();
      }
    });

    updateReadout();
    updateBalance();
    updateConnection();
    updateTrophy();
    updateDemo();
    syncSettings();
  }

  function setPaused(message) {
    fatalMessage = message || null;
    syncPaused();
  }

  function clearPaused() {
    if (!fatalMessage) return;
    fatalMessage = null;
    syncPaused();
  }

  return {
    init,
    toast,
    announce,
    beep,
    setPaused,
    clearPaused,
    updateReadout,
    toggleSound,
    _timers: () => ({ clockTimer, readoutTimer })
  };
})();
