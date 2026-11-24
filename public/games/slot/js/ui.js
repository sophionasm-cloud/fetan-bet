'use strict';

(() => {
  const byId = (id) => document.getElementById(id);
  const bellSvg = '<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M12 33h24l-3.4-4.7V20a8.6 8.6 0 0 0-17.2 0v8.3L12 33Z" fill="currentColor"/><path d="M20 36a4 4 0 0 0 8 0" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M20 11.5c1.2-.8 2.6-1.2 4-1.2" stroke="#fff3b4" stroke-width="2" stroke-linecap="round"/></svg>';

  function mount(config, onAction) {
    const nodes = {
      balance: byId('slotBalance'), bet: byId('slotBet'), win: byId('slotWin'), status: byId('slotStatus'),
      reels: byId('slotReels'), spin: byId('spinButton'), quickBets: byId('quickBets'), paytable: byId('paytableDialog'),
      paytableRows: byId('paytableRows'), fairness: byId('fairnessDetails'), hash: byId('serverSeedHash'),
      clientSeed: byId('clientSeed'), nonce: byId('nonceValue'), sound: byId('soundButton'), local: byId('slotLocalPreview'),
      auto: byId('autoButton'), autoCount: byId('autoCount'), turbo: byId('turboToggle'),
      cabinet: byId('slotCabinet'), banner: byId('slotWinBanner'), revealedSeed: byId('revealedSeed'),
      nextCommitment: byId('nextServerSeedHash'), algorithm: byId('fairnessAlgorithm'),
    };
    let locale = { lang: 'en', currency: 'ETB', copy: {} };
    let bet = config.DEFAULT_BET_SANTIM;
    let balance = null;
    let loaded = false;
    let busy = false;
    let retryLocked = false;
    let winningLines = [];
    let currentFairness = null;
    let paylineCycleTimer = null;
    const symbolById = new Map(config.SYMBOLS.map((symbol) => [symbol.id, symbol]));
    const reels = [...nodes.reels.querySelectorAll('.slot-reel')];

    function t(key, values) { return window.SLOT_I18N.interpolate(locale.copy[key] || key, values); }
    function format(santim) { return window.SLOT_I18N.formatMoney(santim, locale.lang); }
    function announce(key, values, kind = '') {
      nodes.status.textContent = t(key, values);
      nodes.status.dataset.kind = kind;
    }
    function paintBet() { nodes.bet.textContent = format(bet); }
    function updateBetControls() {
      nodes.reels.classList.toggle('is-spinning', busy);
      nodes.spin.disabled = !loaded || busy || balance < bet;
      nodes.auto.disabled = !loaded || (busy && nodes.auto.dataset.active !== 'true');
      nodes.autoCount.disabled = !loaded || busy || nodes.auto.dataset.active === 'true';
      byId('betDown').disabled = busy || retryLocked || bet <= config.MIN_BET_SANTIM;
      byId('betUp').disabled = busy || retryLocked || bet >= config.MAX_BET_SANTIM;
      nodes.quickBets.querySelectorAll('button').forEach((button) => {
        button.setAttribute('aria-pressed', Number(button.dataset.bet) === bet ? 'true' : 'false');
        button.disabled = busy || retryLocked;
      });
    }
    function applyBet(value) {
      if (!Number.isSafeInteger(value)) return;
      bet = Math.max(config.MIN_BET_SANTIM, Math.min(config.MAX_BET_SANTIM, value));
      paintBet();
      updateBetControls();
      onAction('bet', bet);
    }
    function buildQuickBets() {
      nodes.quickBets.replaceChildren(...config.QUICK_BETS_SANTIM.map((amount) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'slot-quick-bet';
        button.dataset.bet = String(amount);
        button.textContent = format(amount);
        button.setAttribute('aria-label', `${t('bet')} ${format(amount)} ${locale.currency}`);
        button.onclick = () => applyBet(amount);
        return button;
      }));
    }
    function setLocale(next) {
      locale = next;
      document.documentElement.lang = locale.lang;
      document.querySelectorAll('[data-copy]').forEach((element) => {
        const key = element.dataset.copy;
        if (locale.copy[key]) element.textContent = locale.copy[key];
      });
      document.querySelectorAll('[data-label]').forEach((element) => {
        const key = element.dataset.label;
        if (locale.copy[key]) element.setAttribute('aria-label', locale.copy[key]);
      });
      byId('slotLocalPreview').textContent = t('localPreview');
      nodes.spin.textContent = t('spin');
      const soundEnabled = localStorage.getItem('slot-sound') == null ? config.SOUND_DEFAULT : localStorage.getItem('slot-sound') === '1';
      const soundText = nodes.sound.querySelector('.slot-sound-text') || nodes.sound;
      soundText.textContent = soundEnabled ? t('soundOn') : t('soundOff');
      const soundIcon = byId('soundIcon');
      if (soundIcon) soundIcon.src = soundEnabled ? './assets/sound-on.svg' : './assets/sound-off.svg';
      nodes.sound.setAttribute('aria-pressed', String(soundEnabled));
      nodes.autoCount.replaceChildren(...config.AUTO_COUNTS.map((count) => {
        const option = document.createElement('option');
        option.value = String(count);
        option.textContent = String(count);
        return option;
      }));
      nodes.autoCount.value = String(config.AUTO_DEFAULT_COUNT);
      buildQuickBets();
      paintBet();
      if (balance !== null) nodes.balance.textContent = `${format(balance)} ${locale.currency}`;
      updateBetControls();
    }
    function defaultInitialGrid() {
      try {
        return window.SLOT_MATH.gridFromStops([0, 0, 0, 0, 0]);
      } catch (_) {
        return [
          ['heart', 'diamond', 'spade', 'club', 'seven'],
          ['diamond', 'spade', 'club', 'seven', 'bar'],
          ['spade', 'club', 'seven', 'bar', 'bell']
        ];
      }
    }
    function showSymbol(cell, symbolId, row, reelIndex) {
      cell.replaceChildren();
      cell.className = 'slot-cell';
      cell.dataset.symbol = symbolId;
      const symbol = symbolById.get(symbolId);
      if (!symbol) {
        cell.classList.add('is-empty');
        cell.textContent = '·';
        cell.setAttribute('role', 'presentation');
        cell.removeAttribute('aria-label');
        return;
      }
      cell.classList.add(`slot-symbol-${symbol.id}`);
      cell.setAttribute('role', 'img');
      cell.setAttribute('aria-label', locale.symbols?.[symbol.id] || symbol.label);
      const img = document.createElement('img');
      img.src = `./assets/${symbol.id}.svg`;
      img.alt = '';
      img.className = 'slot-symbol-art';
      img.onerror = () => { img.remove(); cell.textContent = symbol.glyph || ''; };
      cell.append(img);
      cell.dataset.position = `${row}:${reelIndex}`;
    }
    function drawPayline(line) {
      const polyline = byId('slotPayline').querySelector('polyline');
      if (!line || !Array.isArray(config.PAYLINES[line - 1])) { polyline.setAttribute('points', ''); return; }
      polyline.setAttribute('points', config.PAYLINES[line - 1].map((row, reel) => `${(reel + .5) * 100},${(row + .5) * 100}`).join(' '));
    }
    function stopPaylineCycle() {
      if (paylineCycleTimer) { clearInterval(paylineCycleTimer); paylineCycleTimer = null; }
    }
    function startPaylineCycle(wins) {
      stopPaylineCycle();
      if (!wins || wins.length <= 1) return;
      let index = 0;
      paylineCycleTimer = setInterval(() => {
        index = (index + 1) % wins.length;
        drawPayline(wins[index].line);
      }, 1200);
    }
    function renderGrid(grid, wins = []) {
      stopPaylineCycle();
      winningLines = wins;
      const marked = new Set();
      for (const win of wins) {
        const path = config.PAYLINES[win.line - 1];
        if (path) path.forEach((row, reel) => marked.add(`${row}:${reel}`));
      }
      reels.forEach((reel, reelIndex) => {
        const track = reel.querySelector('.slot-reel-track');
        const cells = Array.from({ length: config.ROWS }, () => document.createElement('span'));
        track.replaceChildren(...cells);
        track.removeAttribute('aria-hidden');
        track.style.transition = 'none';
        track.style.transform = 'translate3d(0, 0, 0)';
        cells.forEach((cell, row) => {
          const symbolId = Array.isArray(grid?.[row]) ? grid[row][reelIndex] : null;
          showSymbol(cell, symbolId, row, reelIndex);
          cell.classList.toggle('is-winning', marked.has(`${row}:${reelIndex}`));
        });
      });
      drawPayline(wins[0]?.line);
      nodes.reels.classList.toggle('has-win', wins.length > 0);
      if (wins.length > 1) startPaylineCycle(wins);
    }
    function renderPaytable() {
      const rows = config.SYMBOLS.map((symbol) => {
        const row = document.createElement('div');
        row.className = 'slot-paytable-row';
        const label = document.createElement('span');
        label.className = 'slot-paytable-label';
        const icon = document.createElement('img');
        icon.src = `./assets/${symbol.id}.svg`;
        icon.alt = '';
        icon.className = 'slot-paytable-icon';
        const text = document.createElement('span');
        text.textContent = locale.symbols?.[symbol.id] || symbol.label;
        label.append(icon, text);
        row.append(label);
        for (const count of [3, 4, 5]) {
          const amount = document.createElement('strong');
          amount.textContent = `${(config.PAYTABLE[symbol.id][count] / config.PAYOUT_MULTIPLIER_SCALE).toLocaleString(locale.lang === 'am' ? 'am-ET' : 'en-US')}×`;
          row.append(amount);
        }
        return row;
      });
      nodes.paytableRows.replaceChildren(...rows);
      if (!nodes.paytable.open) nodes.paytable.showModal();
    }
    function showFairness(fairness) {
      nodes.fairness.hidden = false;
      nodes.fairness.open = true;
      currentFairness = fairness || currentFairness;
      nodes.hash.textContent = currentFairness?.server_seed_hash || '—';
      nodes.clientSeed.textContent = currentFairness?.client_seed || '—';
      nodes.nonce.textContent = String(currentFairness?.nonce ?? '—');
      nodes.revealedSeed.textContent = currentFairness?.server_seed || t('pendingSeed');
      nodes.nextCommitment.textContent = currentFairness?.next_server_seed_hash || '—';
      nodes.algorithm.textContent = currentFairness?.algorithm || config.FAIRNESS_ALGORITHM;
      nodes.fairness.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
    function setState(state) {
      balance = state.balance;
      loaded = Number.isSafeInteger(balance);
      nodes.balance.textContent = loaded ? `${format(balance)} ${locale.currency}` : '—';
      if (state.fairness) {
        currentFairness = state.fairness;
        nodes.hash.textContent = state.fairness.server_seed_hash || '—';
        nodes.clientSeed.textContent = state.fairness.client_seed || '—';
        nodes.nonce.textContent = String(state.fairness.nonce ?? '—');
        nodes.revealedSeed.textContent = state.fairness.server_seed || t('pendingSeed');
        nodes.algorithm.textContent = state.fairness.algorithm || config.FAIRNESS_ALGORITHM;
      }
      const latest = state.recent?.[0];
      if (latest?.grid) {
        renderGrid(latest.grid, latest.wins || []);
        nodes.win.textContent = format(latest.totalPayout);
        nodes.win.dataset.santim = String(latest.totalPayout);
      } else if (state.preview?.grid) {
        renderGrid(state.preview.grid, state.preview.wins || []);
        nodes.win.textContent = format(state.preview.totalPayout);
        nodes.win.dataset.santim = String(state.preview.totalPayout);
      } else {
        renderGrid(defaultInitialGrid());
      }
      announce('ready');
      updateBetControls();
    }
    function setResult(result) {
      balance = result.balance;
      nodes.balance.textContent = `${format(balance)} ${locale.currency}`;
      const previousWin = Number(nodes.win.dataset.santim || 0);
      renderGrid(result.grid, result.wins);
      announce(result.totalPayout > 0 ? 'won' : 'noWin', { amount: format(result.totalPayout), currency: locale.currency }, result.totalPayout > 0 ? 'win' : '');
      return window.SLOT_EFFECTS.present({ result, bet, previousWin, winElement: nodes.win, cabinet: nodes.cabinet, banner: nodes.banner, format });
    }
    function setBusy(value) {
      busy = Boolean(value);
      if (busy) {
        stopPaylineCycle();
        nodes.reels.classList.remove('has-win');
        nodes.reels.querySelectorAll('.slot-cell.is-winning').forEach((cell) => cell.classList.remove('is-winning'));
        byId('slotPayline').querySelector('polyline').setAttribute('points', '');
      }
      nodes.spin.disabled = busy || !loaded || balance < bet;
      nodes.spin.textContent = t('spin');
      nodes.spin.setAttribute('aria-busy', String(busy));
      nodes.auto.disabled = !loaded || (busy && nodes.auto.dataset.active !== 'true');
      nodes.autoCount.disabled = !loaded || busy || nodes.auto.dataset.active === 'true';
      byId('betDown').disabled = busy || retryLocked || bet <= config.MIN_BET_SANTIM;
      byId('betUp').disabled = busy || retryLocked || bet >= config.MAX_BET_SANTIM;
      nodes.quickBets.querySelectorAll('button').forEach((button) => { button.disabled = busy || retryLocked; });
    }
    function setStatus(key, kind = '', values) { announce(key, values, kind); }
    function setAuto(active) {
      nodes.auto.textContent = active ? t('stopAuto') : t('startAuto');
      nodes.auto.dataset.active = active ? 'true' : 'false';
      nodes.auto.disabled = !loaded || (busy && !active);
      nodes.autoCount.disabled = !loaded || busy || active;
    }
    function setLocalPreview(active) { nodes.local.hidden = !active; }
    function setRetryLocked(active) { retryLocked = Boolean(active); updateBetControls(); }

    byId('betDown').onclick = () => applyBet(bet - config.BET_STEP_SANTIM);
    byId('betUp').onclick = () => applyBet(bet + config.BET_STEP_SANTIM);
    nodes.spin.onclick = () => onAction('spin');
    byId('paytableButton').onclick = renderPaytable;
    byId('fairnessButton').onclick = () => onAction('fairness');
    nodes.sound.onclick = () => {
      const current = localStorage.getItem('slot-sound') == null ? config.SOUND_DEFAULT : localStorage.getItem('slot-sound') === '1';
      const enabled = !current;
      localStorage.setItem('slot-sound', enabled ? '1' : '0');
      nodes.sound.setAttribute('aria-pressed', String(enabled));
      const soundText = nodes.sound.querySelector('.slot-sound-text') || nodes.sound;
      soundText.textContent = enabled ? t('soundOn') : t('soundOff');
      const soundIcon = byId('soundIcon');
      if (soundIcon) soundIcon.src = enabled ? './assets/sound-on.svg' : './assets/sound-off.svg';
      window.dispatchEvent(new CustomEvent('slot-sound-change', { detail: { enabled } }));
      onAction('sound', enabled);
    };
    nodes.turbo.checked = localStorage.getItem('slot-turbo') == null ? config.TURBO_DEFAULT : localStorage.getItem('slot-turbo') === '1';
    nodes.turbo.onchange = () => {
      localStorage.setItem('slot-turbo', nodes.turbo.checked ? '1' : '0');
      onAction('turbo', nodes.turbo.checked);
    };
    nodes.auto.onclick = () => onAction(nodes.auto.dataset.active === 'true' ? 'stop-auto' : 'start-auto', Number(nodes.autoCount.value));
    setLocale(locale);
    renderGrid(defaultInitialGrid());

    return Object.freeze({
      setLocale, setState, setResult, setBusy, setStatus, setAuto, setLocalPreview, showFairness, setRetryLocked,
      getBet: () => bet, getBalance: () => balance, getTurbo: () => nodes.turbo.checked,
      getAutoCount: () => Number(nodes.autoCount.value), openPaytable: renderPaytable,
    });
  }
  window.SLOT_UI = Object.freeze({ mount });
})();
