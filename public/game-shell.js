/* Shared customer game chrome. Game outcomes and balances remain server-owned. */
'use strict';
window.FetanGameShell = (() => {
  const $ = (root, selector) => root.querySelector(selector);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));

  function markup(title, t, esc, game) {
    const supportedActions = {
      road: ['how', 'history', 'fair'],
      crash: ['how', 'history', 'fair'],
      'chicken-road-2': ['how', 'history'],
      'b2b-bomber': ['how', 'history', 'fair'],
      penalty: ['how', 'history'],
      mines: ['how', 'fair'],
      roulette: ['history']
    }[game] || [];
    const actionLabels = { how: t('how_to_play'), history: t('history'), fair: t('provably_fair') };
    const actionMenu = supportedActions.map((action) =>
      `<button type="button" data-game-action="${action}">${esc(actionLabels[action])}</button>`
    ).join('');
    return `
      <div class="mobile-game-topbar immersive-game-header">
        <button class="mobile-game-icon" type="button" data-game-exit aria-label="${esc(t('back'))}">←</button>
        <strong class="mobile-game-title" data-game-title>${esc(title)}</strong>
        <div class="immersive-wallet-controls">
          <button class="mobile-game-balance" type="button" data-game-wallet aria-label="Open wallet">
            <span aria-hidden="true">🪙</span><span data-game-balance>—</span><small>ETB</small>
          </button>
          <button class="mobile-game-icon immersive-deposit-shortcut" type="button" data-game-deposit aria-label="Deposit">+</button>
        </div>
        <button class="mobile-game-icon" type="button" data-game-sound aria-label="${esc(t('sound_toggle'))}">🔊</button>
        <button class="mobile-game-icon" type="button" data-game-menu aria-label="${esc(t('menu'))}" aria-expanded="false">☰</button>
        <div class="mobile-game-menu immersive-game-menu" data-game-menu-panel hidden>
          ${actionMenu}
          <button type="button" data-game-action="fullscreen">${esc(t('fullscreen'))}</button>
          <div class="immersive-responsible-note">18+ · Play responsibly</div>
        </div>
      </div>
      <div class="immersive-sheet-overlay" data-game-sheet hidden>
        <section class="immersive-sheet" role="dialog" aria-modal="true" aria-labelledby="game-sheet-title" tabindex="-1">
          <button type="button" class="immersive-sheet-handle" data-sheet-handle aria-label="Close panel"><span></span></button>
          <header class="immersive-sheet-head">
            <div><p class="immersive-sheet-eyebrow">FETAN BET WALLET</p><h2 id="game-sheet-title" data-sheet-title>Wallet</h2></div>
            <button type="button" class="immersive-sheet-close" data-sheet-close aria-label="Close">×</button>
          </header>
          <div class="immersive-round-notice" data-round-notice hidden>
            <div><strong>Round in progress</strong><span>Use the action below or return to the game controls.</span></div>
            <button type="button" data-round-action hidden></button>
            <button type="button" data-round-return>Return to game</button>
          </div>
          <div class="immersive-sheet-content" data-wallet-panel hidden>
            <div class="immersive-balance-card"><span>Available balance</span><strong data-sheet-balance>— ETB</strong></div>
            <div class="immersive-sheet-actions">
              <button type="button" class="immersive-primary" data-open-deposit>Deposit</button>
              <button type="button" class="immersive-secondary" data-open-withdraw>Withdraw</button>
            </div>
            <div class="immersive-transactions-head"><h3>Recent transactions</h3><button type="button" data-refresh-wallet>Refresh</button></div>
            <div class="immersive-transactions" data-transactions aria-live="polite"><p class="immersive-muted">Loading transactions…</p></div>
          </div>
          <div class="immersive-sheet-content" data-deposit-panel hidden>
            <div class="immersive-balance-card compact"><span>Current balance</span><strong data-deposit-balance>— ETB</strong></div>
            <form data-deposit-form>
              <label class="immersive-field-label">Payment method</label>
              <div class="immersive-provider-grid" data-provider-grid><p class="immersive-muted">Loading payment methods…</p></div>
              <label class="immersive-field-label" for="immersive-deposit-amount">Amount (ETB)</label>
              <div class="immersive-quick-amounts">${[50, 100, 250, 500, 1000].map((amount) => `<button type="button" data-deposit-amount="${amount}">${amount}</button>`).join('')}</div>
              <input id="immersive-deposit-amount" name="amount" type="number" min="10" max="50000" step="1" value="100" required inputmode="numeric">
              <p class="immersive-provider-instructions" data-provider-instructions></p>
              <label class="immersive-field-label" for="immersive-deposit-reference">Transaction reference</label>
              <input id="immersive-deposit-reference" name="tx_ref" type="text" minlength="4" maxlength="40" pattern="[A-Za-z0-9-]{4,40}" autocomplete="off" required>
              <label class="immersive-field-label" for="immersive-deposit-receipt">Receipt image <span>(optional · JPG, PNG or WEBP · max 5 MB)</span></label>
              <input id="immersive-deposit-receipt" data-deposit-receipt type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp">
              <p class="immersive-deposit-note">Submitting a request does not verify payment or add funds. Authorized review is required.</p>
              <p class="immersive-form-status" data-deposit-status role="status" aria-live="polite"></p>
              <button type="submit" class="immersive-primary immersive-submit" data-deposit-submit>Submit deposit request</button>
            </form>
          </div>
        </section>
      </div>`;
  }

  function mount(root, { game, ctx, onExit, onAction, roundState }) {
    const overlay = $(root, '[data-game-sheet]');
    const sheet = $(overlay, '.immersive-sheet');
    const walletPanel = $(root, '[data-wallet-panel]');
    const depositPanel = $(root, '[data-deposit-panel]');
    const roundNotice = $(root, '[data-round-notice]');
    let activeSheet = null;
    let opener = null;
    let lastFocused = null;
    let providers = [];
    let providerId = null;
    let receiptData = null;
    let round = roundState || { active: false, canAct: false, actionLabel: '' };
    let wakeLock = null;
    let wasFullscreen = Boolean(document.fullscreenElement);
    let exiting = false;
    let disposed = false;
    let touchStartY = null;

    const balanceLabel = () => `${ctx.fmt(ctx.getBalance?.() ?? 0)} ETB`;
    const paintBalance = () => {
      const value = balanceLabel();
      $(root, '[data-game-balance]').textContent = value.replace(/\sETB$/, '');
      $(root, '[data-sheet-balance]').textContent = value;
      $(root, '[data-deposit-balance]').textContent = value;
    };
    const setRound = (next) => {
      round = { active: Boolean(next?.active), canAct: Boolean(next?.canAct), actionLabel: String(next?.actionLabel || '') };
      roundNotice.hidden = !round.active;
      const action = $(root, '[data-round-action]');
      action.hidden = !round.active || !round.canAct;
      action.textContent = round.actionLabel || 'Continue round';
    };
    const setStatus = (message, kind = '') => {
      const status = $(root, '[data-deposit-status]');
      status.textContent = message;
      status.dataset.kind = kind;
    };
    const focusables = () => [...sheet.querySelectorAll('button:not([disabled]):not([hidden]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled])')]
      .filter((element) => element.getClientRects().length);

    function closeSheet({ restoreFocus = true } = {}) {
      if (!activeSheet) return;
      overlay.hidden = true;
      overlay.dataset.mode = '';
      walletPanel.hidden = true;
      depositPanel.hidden = true;
      activeSheet = null;
      document.body.classList.remove('immersive-sheet-open');
      if (restoreFocus) opener?.focus?.();
    }

    function openSheet(mode, source) {
      if (disposed) return;
      opener = source || document.activeElement;
      lastFocused = opener;
      activeSheet = mode;
      overlay.hidden = false;
      overlay.dataset.mode = mode;
      walletPanel.hidden = mode !== 'wallet';
      depositPanel.hidden = mode !== 'deposit';
      $(root, '[data-sheet-title]').textContent = mode === 'wallet' ? 'Wallet' : 'Deposit';
      document.body.classList.add('immersive-sheet-open');
      paintBalance();
      setRound(round);
      requestAnimationFrame(() => $(sheet, 'button:not([disabled]), input:not([disabled])')?.focus());
      if (mode === 'wallet') loadTransactions();
      if (mode === 'deposit') loadProviders();
    }

    async function loadTransactions() {
      const host = $(root, '[data-transactions]');
      host.innerHTML = '<p class="immersive-muted">Loading transactions…</p>';
      try {
        const response = await ctx.api('/transactions');
        const transactions = (response.transactions || []).slice(0, 3);
        host.innerHTML = transactions.length ? transactions.map((transaction) => {
          const amount = Number(transaction.amount || 0);
          const date = transaction.created_at ? new Date(transaction.created_at).toLocaleString() : '';
          const signed = amount >= 0 ? '+' : '−';
          return `<div class="immersive-transaction"><span><b>${escapeHtml(String(transaction.type || 'Transaction').replaceAll('_', ' '))}</b><small>${escapeHtml(date)}</small></span><strong class="${amount < 0 ? 'debit' : 'credit'}">${signed}${ctx.fmt(Math.abs(amount))} ETB</strong></div>`;
        }).join('') : '<p class="immersive-muted">No transactions yet.</p>';
      } catch (_) {
        host.innerHTML = '<p class="immersive-muted">Transactions are temporarily unavailable.</p>';
      }
    }

    async function loadProviders() {
      const host = $(root, '[data-provider-grid]');
      host.innerHTML = '<p class="immersive-muted">Loading payment methods…</p>';
      try {
        const response = await ctx.api('/providers');
        providers = response.providers || [];
        providerId = providers[0]?.id ?? null;
        if (!providers.length) {
          host.innerHTML = '<p class="immersive-muted">No payment methods are currently available.</p>';
          return;
        }
        host.innerHTML = providers.map((provider) => {
          const icon = ({ telebirr: '📱', cbe: '🏦', boa: '🏛', dashen: '⚡', awash: '🛡', mpesa: '💸' })[provider.code] || '💳';
          return `<button class="immersive-provider ${Number(provider.id) === Number(providerId) ? 'selected' : ''}" type="button" data-provider-id="${Number(provider.id)}"><span>${icon}</span><b>${escapeHtml(provider.name)}</b></button>`;
        }).join('');
        host.querySelectorAll('[data-provider-id]').forEach((button) => button.addEventListener('click', () => {
          providerId = Number(button.dataset.providerId);
          host.querySelectorAll('[data-provider-id]').forEach((item) => item.classList.toggle('selected', item === button));
          const provider = providers.find((item) => Number(item.id) === providerId);
          $(root, '[data-provider-instructions]').textContent = provider ? (document.documentElement.lang === 'am' ? provider.instr_am : provider.instr_en) || '' : '';
        }));
        const first = providers[0];
        $(root, '[data-provider-instructions]').textContent = document.documentElement.lang === 'am' ? first.instr_am || '' : first.instr_en || '';
      } catch (_) {
        host.innerHTML = '<p class="immersive-muted">Payment methods could not be loaded. Please retry.</p>';
      }
    }

    async function refreshAccount() {
      if (ctx.refreshAccount) await ctx.refreshAccount();
      paintBalance();
    }

    async function submitDeposit(event) {
      event.preventDefault();
      const form = event.currentTarget;
      const button = $(form, '[data-deposit-submit]');
      const amount = Number($(form, '[name="amount"]').value);
      const reference = $(form, '[name="tx_ref"]').value.trim();
      if (!Number.isSafeInteger(amount) || amount < 10 || amount > 50000) return setStatus('Enter a whole ETB amount from 10 to 50,000.', 'error');
      if (!providerId || !providers.some((item) => Number(item.id) === Number(providerId))) return setStatus('Choose an available payment method.', 'error');
      if (!/^[A-Za-z0-9-]{4,40}$/.test(reference)) return setStatus('Enter a valid 4–40 character transaction reference.', 'error');
      button.disabled = true;
      button.textContent = 'Submitting…';
      setStatus('');
      const payload = { amount, provider_id: providerId, tx_ref: reference };
      if (receiptData) payload.receipt_data = receiptData;
      try {
        const result = await ctx.api('/deposits', payload);
        await refreshAccount();
        setStatus(result.existing ? 'This reference already has a pending request.' : 'Deposit request submitted for authorized review. Your wallet has not been credited.', 'success');
        form.reset();
        receiptData = null;
        await loadTransactions();
      } catch (error) {
        setStatus(error.message === 'INVALID' ? 'Check the amount, payment method, and transaction reference.' : 'Deposit request could not be submitted. Please check your connection and try again.', 'error');
      } finally {
        button.disabled = false;
        button.textContent = 'Submit deposit request';
      }
    }

    async function handleReceipt(event) {
      const file = event.target.files?.[0];
      receiptData = null;
      if (!file) return;
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
        setStatus(file.size > 5 * 1024 * 1024 ? 'Receipt image must be 5 MB or smaller.' : 'Choose a JPG, PNG, or WEBP receipt image.', 'error');
        event.target.value = '';
        return;
      }
      receiptData = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
      });
      if (!receiptData) setStatus('The receipt image could not be read. Choose another image.', 'error');
      else setStatus('Receipt attached. It will be reviewed with your request.', 'success');
    }

    function handleSheetKeydown(event) {
      if (!activeSheet) return;
      if (event.key === 'Escape') { event.preventDefault(); closeSheet(); return; }
      if (event.key !== 'Tab') return;
      const elements = focusables();
      if (!elements.length) { event.preventDefault(); sheet.focus(); return; }
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }

    let frame = null;
    const requestWakeLock = async () => {
      if (disposed || wakeLock || !navigator.wakeLock?.request) return;
      try { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
      catch (_) { /* Unsupported or denied: the immersive CSS layout remains usable. */ }
    };
    const onVisibility = () => { if (!document.hidden && !disposed) requestWakeLock(); };
    const onFullscreenChange = () => {
      const active = Boolean(document.fullscreenElement);
      if (wasFullscreen && !active && !exiting && !activeSheet) onExit();
      wasFullscreen = active;
    };
    const onShellClick = (event) => {
      if (event.target.closest('[data-game-exit]')) onExit();
      else if (event.target.closest('[data-game-wallet]')) openSheet('wallet', event.target.closest('[data-game-wallet]'));
      else if (event.target.closest('[data-game-deposit]')) openSheet('deposit', event.target.closest('[data-game-deposit]'));
      else if (event.target.closest('[data-game-menu]')) {
        const button = event.target.closest('[data-game-menu]');
        const panel = $(root, '[data-game-menu-panel]');
        panel.hidden = !panel.hidden;
        button.setAttribute('aria-expanded', String(!panel.hidden));
      } else if (event.target.closest('[data-game-action]')) {
        const action = event.target.closest('[data-game-action]').dataset.gameAction;
        $(root, '[data-game-menu-panel]').hidden = true;
        if (action === 'fullscreen') root.requestFullscreen?.().catch(() => {});
        else onAction(action);
      } else if (event.target.closest('[data-sheet-close]')) closeSheet();
      else if (event.target === overlay) closeSheet({ restoreFocus: false });
      else if (event.target.closest('[data-open-deposit]')) openSheet('deposit', event.target.closest('[data-open-deposit]'));
      else if (event.target.closest('[data-open-withdraw]')) {
        closeSheet({ restoreFocus: false });
        ctx.navigateCustomer?.('withdraw');
      } else if (event.target.closest('[data-refresh-wallet]')) { refreshAccount().then(loadTransactions); }
      else if (event.target.closest('[data-round-return]')) closeSheet({ restoreFocus: false });
      else if (event.target.closest('[data-round-action]')) {
        const state = round;
        closeSheet({ restoreFocus: false });
        if (state.active && state.canAct) onAction('critical');
      } else if (event.target.matches('[data-deposit-amount]')) {
        $(root, '[name="amount"]').value = event.target.dataset.depositAmount;
      }
    };
    const onKeydown = (event) => {
      handleSheetKeydown(event);
      if (event.key === 'Escape' && !activeSheet) { event.preventDefault(); onExit(); }
    };
    const onTouchStart = (event) => { touchStartY = event.touches[0]?.clientY ?? null; };
    const onTouchEnd = (event) => {
      const y = event.changedTouches[0]?.clientY;
      if (activeSheet && touchStartY !== null && Number.isFinite(y) && y - touchStartY > 75) closeSheet();
      touchStartY = null;
    };
    const onBalanceChange = () => paintBalance();

    root.addEventListener('click', onShellClick);
    overlay.addEventListener('submit', (event) => { if (event.target.matches('[data-deposit-form]')) submitDeposit(event); });
    $(root, '[data-deposit-receipt]').addEventListener('change', handleReceipt);
    $(root, '[data-sheet-handle]').addEventListener('touchstart', onTouchStart, { passive: true });
    $(root, '[data-sheet-handle]').addEventListener('touchend', onTouchEnd, { passive: true });
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    window.addEventListener('fetan-balance-change', onBalanceChange);
    root.addEventListener('pointerdown', requestWakeLock, { once: true });
    paintBalance();
    setRound(round);
    requestWakeLock();

    return {
      setRoundActive: setRound,
      refreshBalance: refreshAccount,
      postFrameAction(action) {
        frame = root.querySelector('iframe.integrated-game-frame');
        frame?.contentWindow?.postMessage({ type: 'fetan-shell-action', action }, location.origin);
      },
      openWallet() { openSheet('wallet', $(root, '[data-game-wallet]')); },
      openDeposit() { openSheet('deposit', $(root, '[data-game-deposit]')); },
      closeSheet,
      cleanup() {
        disposed = true;
        exiting = true;
        closeSheet({ restoreFocus: false });
        root.removeEventListener('click', onShellClick);
        document.removeEventListener('keydown', onKeydown);
        document.removeEventListener('visibilitychange', onVisibility);
        document.removeEventListener('fullscreenchange', onFullscreenChange);
        window.removeEventListener('fetan-balance-change', onBalanceChange);
        if (document.fullscreenElement && (document.fullscreenElement === root || root.contains(document.fullscreenElement))) {
          document.exitFullscreen?.().catch(() => {});
        }
        wakeLock?.release?.().catch?.(() => {});
        wakeLock = null;
      }
    };
  }

  return { markup, mount };
})();
