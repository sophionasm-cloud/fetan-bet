// ፍጣን ቤት front-end — Stake-inspired professional UI, no build step.
'use strict';
let T = {}, lang = localStorage.getItem('lang') || 'en', me = null, balance = 0,
    limits = { min: 100, max: 100000 }, tab = 'games', agentSubtab = 'deposits';

const $ = (id) => document.getElementById(id);
const t = (k) => T[k] ?? k;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const rel = (cents) => (cents >= 0 ? '+' : '') + fmt(cents);
const initials = (name) => String(name || '?').trim().charAt(0).toUpperCase();

function renderMobileHeaderMenu() {
  const panel = $('mobileMenuPanel');
  if (!panel) return;
  const links = me
    ? [['support', '💬', t('support')], ['language', '🌐', lang === 'am' ? 'English' : 'አማርኛ'], ['logout', '↪', t('logout')]]
    : [['login', '↪', t('login')], ['register', '＋', t('register')], ['language', '🌐', lang === 'am' ? 'English' : 'አማርኛ']];
  panel.innerHTML = links.map(([action, icon, label]) =>
    `<button type="button" data-mobile-action="${action}"><span aria-hidden="true">${icon}</span>${esc(label)}</button>`
  ).join('');
  panel.querySelectorAll('[data-mobile-action]').forEach((button) => {
    button.onclick = () => {
      const action = button.dataset.mobileAction;
      panel.hidden = true;
      $('mobileHeaderMenu').setAttribute('aria-expanded', 'false');
      if (action === 'support') { tab = 'support'; render(); }
      if (action === 'language') $('langBtn').click();
      if (action === 'login') $('headerLoginBtn').click();
      if (action === 'register') $('headerRegBtn').click();
      if (action === 'logout') $('logoutBtn').click();
    };
  });
}

// ---------- API ----------
async function api(path, body) {
  const opt = body === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
  let r;
  try {
    r = await fetch('/api' + path, opt);
  } catch {
    throw new Error('NETWORK');
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (data.error === 'LOGIN' && me) { me = null; render(); }
    throw new Error(data.error || 'GENERIC');
  }
  return data;
}

async function openDepositReview(deposit, onDone) {
  const reviewHistory = await api(`/agent/deposits/${encodeURIComponent(deposit.id)}/reviews`).catch(() => ({ reviews: [] }));
  let dialog = $('deposit-review-dialog');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'deposit-review-dialog';
    dialog.className = 'deposit-review-dialog';
    document.body.appendChild(dialog);
  }
  const hasReceipt = deposit.has_receipt === true || deposit.has_receipt === 't';
  const checks = [
    ['amount_matches', 'Requested amount matches authorized payment records'],
    ['reference_matches', 'Transaction reference matches authorized records'],
    ['recipient_matches', 'Recipient is the authorized payment destination'],
    ['date_plausible', 'Payment date and time are plausible'],
    ['independently_verified', 'I independently verified receipt in authorized bank/provider records']
  ];
  dialog.innerHTML = `
    <form method="dialog" class="deposit-review-card">
      <div class="deposit-review-head"><div><span class="eyebrow">DEPOSIT REVIEW · #${esc(deposit.id)}</span><h2>${esc(deposit.user_name || 'Customer deposit')}</h2></div><button class="icon-btn" value="close" aria-label="Close review">×</button></div>
      <div class="deposit-review-facts"><span><b>Amount</b>${fmt(deposit.amount)} ETB</span><span><b>Method</b>${esc(deposit.provider)}</span><span><b>Reference</b>${esc(deposit.tx_ref)}</span><span><b>Submitted</b>${esc(deposit.created_at)}</span><span><b>Customer</b>${esc(deposit.phone || '')}</span></div>
      ${hasReceipt ? `<div class="receipt-preview-wrap"><img class="receipt-preview" alt="Receipt submitted for deposit ${esc(deposit.id)}" src="/api/deposits/${encodeURIComponent(deposit.id)}/receipt"><a class="btn btn-outline" href="/api/deposits/${encodeURIComponent(deposit.id)}/receipt" target="_blank" rel="noopener">Open full image</a></div>` : '<p class="notice">No receipt image was attached. Verify against authorized payment records.</p>'}
      <p class="notice">A screenshot is supporting evidence only. This system has no payment-provider verification integration; independent manual verification is required before approval.</p>
      ${reviewHistory.reviews.length ? `<section class="deposit-review-history"><h3>Previous review activity</h3>${reviewHistory.reviews.map((review) => `<p><b>${esc(review.action)}</b> · ${esc(review.reviewer)} · ${esc(review.created_at)}${review.reason ? `<br>${esc(review.reason)}` : ''}</p>`).join('')}</section>` : ''}
      <fieldset class="review-checklist"><legend>Verification checklist</legend>${checks.map(([key, label]) => `<label><input type="checkbox" name="${key}"><span>${label}</span></label>`).join('')}</fieldset>
      <label for="deposit-review-note">Review note / rejection reason</label><textarea id="deposit-review-note" maxlength="200" rows="2" placeholder="Required for reject or escalate"></textarea>
      <div class="deposit-review-actions"><button type="button" class="btn btn-outline" data-review-action="escalate">Escalate</button><button type="button" class="btn bad" data-review-action="reject">Reject</button><button type="button" class="btn btn-gold" data-review-action="approve">Approve verified deposit</button></div>
    </form>`;
  dialog.showModal();
  dialog.querySelector('form').onsubmit = (ev) => { ev.preventDefault(); dialog.close(); };
  dialog.querySelectorAll('[data-review-action]').forEach((button) => {
    button.onclick = async () => {
      const action = button.dataset.reviewAction;
      const reason = dialog.querySelector('#deposit-review-note').value.trim();
      if (action !== 'approve' && !reason) { dialog.querySelector('#deposit-review-note').focus(); return; }
      const verification = Object.fromEntries(checks.map(([key]) => [key, dialog.querySelector(`[name="${key}"]`).checked]));
      button.disabled = true;
      try {
        await api(`/agent/deposits/${encodeURIComponent(deposit.id)}/decide`, { action, reason, verification });
        dialog.close();
        success(action === 'approve' ? 'Payment independently verified; deposit approved.' : action === 'reject' ? t('status_rejected') : 'Deposit escalated for senior review.');
        onDone();
      } catch (error) { fail(error); button.disabled = false; }
    };
  });
}

// ---------- Toast & Errors ----------
function getErrMsg(e) {
  const code = e?.message || 'GENERIC';
  const key = 'err_' + code;
  return t(key) !== key ? t(key) : t('err_GENERIC');
}

function toast(msg, type = '') {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast' + (type ? ' ' + type : '');
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), 3500);
}
const fail = (e) => {
  toast(getErrMsg(e), 'err');
};
const success = (msg) => toast(msg, 'ok');
const statusTag = (s) => `<span class="tag ${s}">${esc(t('status_' + s))}</span>`;

function validPhone(p) {
  const s = String(p || '').replace(/[\s\-()]+/g, '');
  return /^(\+251|251|0)?[79]\d{8}$/.test(s);
}

function emptyState(icon, msg) {
  return `<div class="empty-state"><span class="es-icon">${icon}</span><p>${esc(msg)}</p></div>`;
}

// ---------- Language ----------
async function loadLang(l) {
  lang = l;
  localStorage.setItem('lang', l);
  T = await (await fetch('/api/i18n/' + l)).json();
  document.documentElement.lang = l;
  $('brandName').textContent = t('brand');
  $('langBtn').textContent = l === 'am' ? 'EN' : 'አማ';
  $('logoutBtn').textContent = t('logout');
  $('depTxt').textContent = t('deposit');
  $('headerLoginBtn').textContent = t('login');
  $('headerRegBtn').textContent = t('register');
  document.title = 'ፈጣን ቤት | Fetan Bet';
}

async function refreshMe() {
  try {
    const d = await api('/me');
    me = d.user; balance = d.balance; limits = d.limits;
  } catch { me = null; }

  // Header controls synchronization
  const isLogged = Boolean(me);
  $('balanceBox').hidden = !isLogged;
  $('quickDepositBtn').hidden = !isLogged;
  $('logoutBtn').hidden = !isLogged;
  $('headerLoginBtn').hidden = isLogged;
  $('headerRegBtn').hidden = isLogged;

  if (isLogged) {
    $('balanceBox').innerHTML = `🪙 ${fmt(balance)} <small style="color:var(--text-muted);font-weight:400">${t('credits')}</small>`;
    if (me.role !== 'user') {
      $('quickDepositBtn').hidden = true;
    }
  }
  renderMobileHeaderMenu();
  return isLogged;
}

function setBalance(b) {
  balance = b;
  $('balanceBox').innerHTML = `🪙 ${fmt(b)} <small style="color:var(--text-muted);font-weight:400">${t('credits')}</small>`;
}

// Header listeners
$('langBtn').onclick = async () => {
  const next = lang === 'am' ? 'en' : 'am';
  await loadLang(next);
  if (me) api('/lang', { lang: next }).catch(() => {});
  render();
};
$('logoutBtn').onclick = async () => { await api('/logout', {}); me = null; tab = 'games'; render(); };
$('quickDepositBtn').onclick = () => { tab = 'deposit'; render(); };
$('balanceBox').onclick = () => { if (me?.role === 'user') { tab = 'deposit'; render(); } };
$('brandBtn').onclick = () => { tab = (me && me.role !== 'user') ? me.role : 'games'; render(); };
$('headerLoginBtn').onclick = () => { tab = 'auth'; render('login'); };
$('headerRegBtn').onclick = () => { tab = 'auth'; render('register'); };
$('mobileHeaderMenu').onclick = () => {
  const panel = $('mobileMenuPanel');
  panel.hidden = !panel.hidden;
  $('mobileHeaderMenu').setAttribute('aria-expanded', String(!panel.hidden));
};
document.addEventListener('click', (event) => {
  const menu = $('mobileMenuPanel');
  if (menu && !event.target.closest('.mobile-header-menu') && !menu.hidden) {
    menu.hidden = true;
    $('mobileHeaderMenu').setAttribute('aria-expanded', 'false');
  }
});

// ---------- NAV ----------
function nav() {
  const tabs = [];
  const mobileUserTabs = me.role === 'user' && window.matchMedia('(max-width: 1024px)').matches;
  if (me.role === 'admin') {
    tabs.push(['admin', '⚙', 'admin']);
    tabs.push(['agent', '🔑', 'agent']);
  } else if (me.role === 'agent') {
    tabs.push(['agent', '🔑', 'agent']);
  } else {
    if (mobileUserTabs) {
      tabs.push(['games', '🎰', t('games')]);
      tabs.push(['wallet', '💳', t('wallet')]);
      tabs.push(['deposit', '⬇', t('deposit')]);
      tabs.push(['profile', '👤', lang === 'am' ? 'ፕሮፋይል' : 'Profile']);
    } else {
      tabs.push(['games', '🎰', 'games']);
      tabs.push(['wallet', '💳', 'wallet']);
      tabs.push(['deposit', '⬇', 'deposit']);
      tabs.push(['withdraw', '⬆', 'withdraw']);
      tabs.push(['history', '📋', 'history']);
      tabs.push(['support', '💬', 'support']);
    }
  }

  const n = $('nav');
  n.hidden = false;
  n.className = mobileUserTabs ? 'tabs app-bottom-tabs' : 'tabs';
  document.body.classList.toggle('has-app-nav', mobileUserTabs);
  n.innerHTML = tabs.map(([k, icon, label]) =>
    `<button type="button" data-k="${k}" class="${tab === k ? 'on' : ''}"${tab === k ? ' aria-current="page"' : ''}><span class="nav-icon" aria-hidden="true">${icon}</span><span class="nav-label">${esc(mobileUserTabs ? label : t(label))}</span></button>`
  ).join('');
  n.querySelectorAll('button').forEach((b) => (b.onclick = () => { tab = b.dataset.k; render(); }));
}

async function render(subMode = '') {
  const gameRoute = /^#\/game\/(road|road-dash|mines|plinko|keno|bingo|roulette|star)$/.exec(location.hash);
  await refreshMe();
  const app = $('app');
  if (!gameRoute || !me || me.role !== 'user' || !matchMedia('(max-width: 1024px)').matches) document.body.classList.remove('game-open');
  if (!me) {
    document.body.classList.remove('game-open');
    document.body.classList.remove('has-app-nav');
    $('nav').hidden = true;
    guestView(app);
    if (subMode) authView(app, subMode);
    return;
  }

  if (gameRoute && me.role === 'user') tab = 'games';

  // Restrict each authenticated role to its own page set. In particular, do
  // not allow staff to land on the customer transaction-history renderer.
  if (me.role === 'agent' && tab !== 'agent') tab = 'agent';
  if (me.role === 'admin' && !['admin', 'agent'].includes(tab)) tab = 'admin';
  if (me.role === 'user' && ['agent', 'admin'].includes(tab)) tab = 'games';
  if ((me.role === 'admin' || me.role === 'agent') && ['games', 'deposit', 'withdraw', 'wallet', 'support', 'profile'].includes(tab)) {
    tab = me.role === 'admin' ? 'admin' : 'agent';
    toast(t('admin_game_blocked'), 'err');
  }

  nav();
  $('nav').hidden = Boolean(gameRoute && me.role === 'user' && matchMedia('(max-width: 1024px)').matches);
  syncTelegramShell(Boolean(gameRoute && me.role === 'user' && matchMedia('(max-width: 1024px)').matches));
  const views = {
    games: (root) => gamesView(root, gameRoute),
    wallet: walletView,
    deposit: depositView,
    withdraw: withdrawView,
    history: historyView,
    support: supportView,
    profile: profileView,
    agent: agentView,
    admin: adminView,
  };
  try {
    const fn = views[tab] || (me.role === 'admin' ? adminView : me.role === 'agent' ? agentView : gamesView);
    await fn(app);
    renderA2hsHint(app, Boolean(gameRoute));
  } catch (e) {
    fail(e);
    app.innerHTML = `<div class="card agent-api-error" role="alert"><div><b>This page could not be rendered.</b><p>${esc(getErrMsg(e))}</p></div><button type="button" class="btn btn-outline" id="view-retry">Retry</button></div>`;
    const retry = $('view-retry');
    if (retry) retry.onclick = () => render();
  }
}

function renderA2hsHint(app, gameRoute) {
  app.querySelector('#a2hs-hint')?.remove();
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const installed = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  if (!ios || installed || gameRoute || tab !== 'games' || sessionStorage.getItem('a2hs-dismissed')) return;
  const hint = document.createElement('aside');
  hint.id = 'a2hs-hint';
  hint.className = 'a2hs-hint';
  hint.innerHTML = '<span>Add Fetan Bet to your Home Screen for an app-style full-screen experience.</span><button type="button" aria-label="Dismiss home screen hint">×</button>';
  hint.querySelector('button').onclick = () => { sessionStorage.setItem('a2hs-dismissed', '1'); hint.remove(); };
  app.prepend(hint);
}

const telegramApp = window.Telegram?.WebApp || null;
if (telegramApp) {
  try {
    telegramApp.ready();
    telegramApp.expand();
    telegramApp.setHeaderColor?.('#090b09');
    telegramApp.setBackgroundColor?.('#090b09');
    telegramApp.onEvent?.('viewportChanged', () => setAppViewportHeight());
    telegramApp.onEvent?.('fullscreenChanged', () => setAppViewportHeight());
  } catch (_) { /* Telegram APIs vary by client version. */ }
}
let telegramBackBound = false;
let telegramGameState = null;
function syncTelegramShell(gameOpen) {
  if (!telegramApp) return;
  const back = telegramApp.BackButton;
  if (!back) return;
  if (telegramGameState === gameOpen) return;
  telegramGameState = gameOpen;
  try {
    if (!telegramBackBound) {
      back.onClick(() => {
        if (document.body.classList.contains('game-open')) history.back();
      });
      telegramBackBound = true;
    }
    if (gameOpen) {
      back.show();
      telegramApp.disableVerticalSwipes?.();
      telegramApp.requestFullscreen?.();
    } else {
      back.hide();
      telegramApp.enableVerticalSwipes?.();
    }
  } catch (_) { /* Keep the browser game usable if an optional API is unavailable. */ }
}

function setAppViewportHeight() {
  const height = window.visualViewport?.height || window.innerHeight;
  document.documentElement.style.setProperty('--app-height', `${Math.round(height)}px`);
  document.body.classList.toggle('mobile-app', window.innerWidth <= 1024);
  document.body.classList.toggle('game-landscape', window.innerWidth > height);
  const routeIsGame = /^#\/game\/(road|road-dash|mines|plinko|keno|bingo|roulette|star)$/.test(location.hash);
  const shouldOpenShell = window.innerWidth <= 1024 && routeIsGame && me?.role === 'user';
  syncTelegramShell(shouldOpenShell);
  if (document.body.classList.contains('game-open') !== shouldOpenShell) {
    if (!shouldOpenShell) Games.cleanupCurrent();
    render();
  }
}
setAppViewportHeight();
window.visualViewport?.addEventListener('resize', setAppViewportHeight);
window.addEventListener('resize', setAppViewportHeight, { passive: true });
window.addEventListener('orientationchange', setAppViewportHeight, { passive: true });
window.addEventListener('popstate', () => { Games.cleanupCurrent(); render(); });

// =====================================================
// AUTH VIEW — Stake-style Login & Registration
// Reference: Dark green-black & antique-gold split card
// =====================================================
function authView(app, initialMode = 'login') {
  const existing = $('auth-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'auth-modal';
  modal.className = 'auth-overlay';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'auth-modal-title');
  modal.innerHTML = `
    <div class="auth-wrapper">
      <div class="auth-split-card">
        <!-- Left Brand Showcase Side -->
        <div class="auth-showcase">
          <div>
            <div class="auth-brand-head" style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
              <div class="logo">ፈ</div>
              <span class="brand-sub" style="font-size:12px;letter-spacing:1px;color:var(--gold-bright)">FETAN BET CASINO</span>
            </div>

            <div class="auth-hero-title-group">
              <div class="auth-welcome-sub">${lang === 'am' ? 'እንኳን ወደ' : 'WELCOME TO'}</div>
              <div class="auth-brand-giant">${lang === 'am' ? 'ፈጣን ቤት' : 'FETAN BET'}</div>
            </div>

            <div class="auth-brand-tagline">
              ${lang === 'am' ? 'በፈጣን ቤት በሚወዷቸው የካሲኖ እና የስፖርት ጨዋታዎች ይደሰቱ' : 'Bet on your favorite sports and casino games with FETAN BET'}
            </div>

            <ul class="auth-features">
              <li class="auth-feat-item">
                <span class="auth-feat-icon">⚡</span>
                <span>${lang === 'am' ? '<strong>ደህንነቱ የተጠበቀ እና ፈጣን ክፍያ፡</strong> ያሸነፉትን በፍጥነት እና በደህንነት ይቀበሉ።' : '<strong>Secure and Instant Payouts:</strong> Get your winnings quickly and safely.'}</span>
              </li>
              <li class="auth-feat-item">
                <span class="auth-feat-icon">⚖️</span>
                <span>${lang === 'am' ? '<strong>ፍትሃዊ ጨዋታ እና ግልጽነት፡</strong> የተረጋገጠ RNG ለሁሉም ጨዋታዎች።' : '<strong>Fair Play and Transparency:</strong> Verified RNG for all games, guaranteed.'}</span>
              </li>
              <li class="auth-feat-item">
                <span class="auth-feat-icon">🎧</span>
                <span>${lang === 'am' ? '<strong>የ24/7 የባለሙያ ድጋፍ፡</strong> በማንኛውም ሰዓት ዝግጁ የሆነ ቡድን።' : '<strong>24/7 Expert Support:</strong> Dedicated team available around the clock.'}</span>
              </li>
            </ul>
          </div>

          <div class="auth-showcase-notice">
            <span>⚠</span>
            <span>${esc(t('demo_notice'))}</span>
          </div>
        </div>

        <!-- Right Form Side -->
        <div class="auth-form-side">
          <button type="button" class="auth-close" id="auth-close" aria-label="Close dialog">×</button>
          <h2 id="auth-modal-title" class="auth-modal-title">${initialMode === 'login' ? esc(t('login')) : esc(t('register'))}</h2>
          <div class="auth-tabs">
            <button class="auth-tab-btn ${initialMode === 'login' ? 'active' : ''}" id="atb-login">${esc(t('login'))}</button>
            <button class="auth-tab-btn ${initialMode === 'register' ? 'active' : ''}" id="atb-register">${esc(t('register'))}</button>
          </div>

          <div id="auth-error-box" class="auth-error-box" hidden></div>

          <!-- LOGIN FORM -->
          <div id="auth-login" ${initialMode === 'login' ? '' : 'hidden'}>
            <form id="lf" autocomplete="on">
              <label for="l-phone">${esc(t('phone_or_username'))}</label>
              <input id="l-phone" name="phone" type="text" placeholder="${esc(t('phone_or_username_hint'))}" autocomplete="username tel" required>
              
              <label for="l-pass" style="margin-top:14px">${esc(t('password'))}</label>
              <div class="input-wrap-pass">
                <input id="l-pass" name="password" type="password" autocomplete="current-password" required>
                <button type="button" class="pass-toggle-btn" id="l-pass-toggle" title="Show/Hide Password">👁</button>
              </div>

              <button type="submit" class="btn btn-gold" style="margin-top:16px">${esc(t('login'))}</button>
            </form>
            <p style="text-align:center;margin-top:18px;font-size:13px;color:var(--text-muted)">
              ${esc(t('no_account'))} <a href="#" id="switch-to-reg" style="color:var(--gold-bright);font-weight:700">${esc(t('register'))}</a>
            </p>
          </div>

          <!-- REGISTER FORM -->
          <div id="auth-register" ${initialMode === 'register' ? '' : 'hidden'}>
            <form id="rf" autocomplete="on">
              <label for="r-name">${esc(t('name'))}</label>
              <input id="r-name" name="name" autocomplete="name" minlength="2" maxlength="60" required>
              
              <label for="r-phone" style="margin-top:10px">${esc(t('phone'))}</label>
              <input id="r-phone" name="phone" type="tel" inputmode="tel" placeholder="${esc(t('phone_hint'))}" autocomplete="tel" required>
              
              <label for="r-pass" style="margin-top:10px">${esc(t('password'))}</label>
              <div class="input-wrap-pass">
                <input id="r-pass" name="password" type="password" minlength="6" autocomplete="new-password" placeholder="${esc(t('pass_hint'))}" required>
                <button type="button" class="pass-toggle-btn" id="r-pass-toggle" title="Show/Hide Password">👁</button>
              </div>

              <button type="submit" class="btn btn-gold" style="margin-top:20px">${esc(t('register'))}</button>
            </form>
            <p style="text-align:center;margin-top:18px;font-size:13px;color:var(--text-muted)">
              ${esc(t('have_account'))} <a href="#" id="switch-to-login" style="color:var(--gold-bright);font-weight:700">${esc(t('login'))}</a>
            </p>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const opener = document.activeElement;
  const closeModal = () => {
    modal.remove();
    if (opener?.isConnected) opener.focus();
  };
  $('auth-close').onclick = closeModal;
  modal.addEventListener('click', (ev) => { if (ev.target === modal) closeModal(); });
  modal.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { ev.preventDefault(); closeModal(); return; }
    if (ev.key === 'Tab') {
      const focusable = [...modal.querySelectorAll('button:not([disabled]), input:not([disabled]), a[href]')]
        .filter((el) => !el.closest('[hidden]'));
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last?.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first?.focus(); }
    }
  });

  // Password visibility toggles
  $('l-pass-toggle').setAttribute('aria-label', 'Show password');
  $('l-pass-toggle').onclick = () => {
    const inp = $('l-pass');
    inp.type = inp.type === 'password' ? 'text' : 'password';
    $('l-pass-toggle').setAttribute('aria-label', inp.type === 'password' ? 'Show password' : 'Hide password');
  };
  $('r-pass-toggle').onclick = () => {
    const inp = $('r-pass');
    inp.type = inp.type === 'password' ? 'text' : 'password';
    $('r-pass-toggle').setAttribute('aria-label', inp.type === 'password' ? 'Show password' : 'Hide password');
  };
  function clearAuthError() {
    const b = $('auth-error-box');
    if (b) { b.hidden = true; b.textContent = ''; }
  }
  function showAuthError(err) {
    const msg = getErrMsg(err);
    const b = $('auth-error-box');
    if (b) { b.textContent = msg; b.hidden = false; }
    toast(msg, 'err');
  }

  // Clear errors when user types
  modal.querySelectorAll('input').forEach((inp) => inp.addEventListener('input', clearAuthError));

  // Tab switching
  function showLogin() {
    clearAuthError();
    $('auth-login').hidden = false; $('auth-register').hidden = true;
    $('atb-login').classList.add('active'); $('atb-register').classList.remove('active');
    $('auth-modal-title').textContent = t('login');
    $('l-phone').focus();
  }
  function showRegister() {
    clearAuthError();
    $('auth-login').hidden = true; $('auth-register').hidden = false;
    $('atb-login').classList.remove('active'); $('atb-register').classList.add('active');
    $('auth-modal-title').textContent = t('register');
    $('r-name').focus();
  }
  $('atb-login').onclick = showLogin;
  $('atb-register').onclick = showRegister;
  $('switch-to-reg').onclick = (e) => { e.preventDefault(); showRegister(); };
  $('switch-to-login').onclick = (e) => { e.preventDefault(); showLogin(); };

  // Form submissions
  $('lf').onsubmit = async (ev) => {
    ev.preventDefault();
    clearAuthError();
    const data = Object.fromEntries(new FormData(ev.target));
    const phone = String(data.phone || '').trim();
    const password = String(data.password || '');

    if (!phone) {
      showAuthError(new Error('INVALID_PHONE'));
      $('l-phone').focus();
      return;
    }
    if (!password) {
      showAuthError(new Error('INVALID_PASSWORD'));
      $('l-pass').focus();
      return;
    }

    const btn = ev.target.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = '...';
    try {
      await api('/login', { phone, password });
      if (!await refreshMe()) throw new Error('SESSION');
      tab = (me && me.role !== 'user') ? me.role : 'games';
      closeModal();
      await render();
    } catch (e) {
      showAuthError(e);
      btn.disabled = false;
      btn.textContent = t('login');
    }
  };

  $('rf').onsubmit = async (ev) => {
    ev.preventDefault();
    clearAuthError();
    const data = Object.fromEntries(new FormData(ev.target));
    const name = String(data.name || '').trim();
    const phone = String(data.phone || '').trim();
    const password = String(data.password || '');

    if (name.length < 2) {
      showAuthError(new Error('INVALID_NAME'));
      $('r-name').focus();
      return;
    }
    if (!validPhone(phone)) {
      showAuthError(new Error('INVALID_PHONE'));
      $('r-phone').focus();
      return;
    }
    if (password.length < 6) {
      showAuthError(new Error('INVALID_PASSWORD'));
      $('r-pass').focus();
      return;
    }

    const btn = ev.target.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = '...';
    try {
      await api('/register', { name, phone, password, lang });
      if (!await refreshMe()) throw new Error('REGISTERED_SESSION');
      tab = 'games'; // Customer sees games immediately upon register!
      closeModal();
      await render();
    } catch (e) {
      showAuthError(e);
      btn.disabled = false;
      btn.textContent = t('register');
    }
  };
  (initialMode === 'register' ? $('r-name') : $('l-phone')).focus();
}

function guestView(app) {
  Games.mount(app, {
    t, esc, fmt, limits, roadState: { active: false, ladder: [], maxSteps: 10 },
    minesState: { active: false, mines: 5 }, guest: true,
    onLogin: () => authView(app, 'login'),
  });
  const hero = app.querySelector('.lobby-hero-content');
  if (hero) {
    const actions = document.createElement('div');
    actions.className = 'guest-hero-actions';
    actions.innerHTML = `<button type="button" class="btn btn-gold" id="guest-register">${esc(t('register'))}</button><button type="button" class="btn btn-outline" id="guest-login">${esc(t('login'))}</button>`;
    hero.appendChild(actions);
    $('guest-register').onclick = () => authView(app, 'register');
    $('guest-login').onclick = () => authView(app, 'login');
  }
}

// =====================================================
// GAMES VIEW (Primary Landing Page)
// =====================================================
async function gamesView(app, gameRoute = null) {
  const [roadState, minesState] = await Promise.all([
    api('/games/road').catch(() => ({ active: false, ladder: [], maxSteps: 10 })),
    api('/games/mines').catch(() => ({ active: false, mines: 5 }))
  ]);
  if (roadState.balance !== undefined) setBalance(roadState.balance);
  Games.mount(app, {
    api, t, esc, fmt, setBalance, fail, limits,
    roadState, minesState,
    reload: () => render()
  });
  if (gameRoute) {
    const requestedGame = gameRoute[1] === 'road-dash' ? 'road' : gameRoute[1];
    Games.openRoute(app, requestedGame);
  }
}

// =====================================================
// WALLET VIEW
// =====================================================
async function walletView(app) {
  const [d, w, tx] = await Promise.all([
    api('/deposits'),
    api('/withdrawals').catch(() => ({ withdrawals: [] })),
    api('/transactions')
  ]);
  const pendingDep = d.deposits.filter((x) => x.status === 'pending').length;
  const pendingWith = w.withdrawals.filter((x) => x.status === 'pending').length;
  const recentTx = tx.transactions.slice(0, 8);

  app.innerHTML = `
    <div class="notice">${esc(t('demo_notice'))}</div>

    <!-- Main Wallet Card -->
    <div class="card" style="position:relative;overflow:hidden">
      <div class="profile-row" style="margin-bottom:20px">
        <div class="avatar">${initials(me.name)}</div>
        <div>
          <div class="profile-name">${esc(me.name)}</div>
          <div class="profile-phone">${esc(me.phone)} · <span class="tag ${me.role === 'admin' ? 'rejected' : me.role === 'agent' ? 'pending' : 'approved'}">${esc(me.role.toUpperCase())}</span></div>
        </div>
      </div>

      <div class="grid" style="grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:14px">
        <div class="stat" style="background:var(--surface-hover);border-color:rgba(214,189,114,0.3)">
          <div class="stat-label">${esc(t('balance'))} (${esc(t('currency_etb'))})</div>
          <b style="color:var(--gold-bright);font-size:32px;letter-spacing:0.5px">🪙 ${fmt(balance)}</b>
          <div class="muted">${esc(t('credits'))}</div>
        </div>
        <div class="stat">
          <div class="stat-label">${esc(t('status_pending'))}</div>
          <b style="font-size:26px">${pendingDep + pendingWith}</b>
          <div class="muted">${pendingDep} ${esc(t('deposit'))} · ${pendingWith} ${esc(t('withdraw'))}</div>
        </div>
        <div class="stat">
          <div class="stat-label">${esc(t('history'))}</div>
          <b style="font-size:26px">${tx.transactions.length}</b>
          <div class="muted">${esc(t('stat_rounds'))} &amp; transfers</div>
        </div>
      </div>

      <div style="display:flex;gap:12px;margin-top:20px;flex-wrap:wrap">
        <button id="go-dep" class="btn btn-gold" style="flex:1;min-width:160px;margin-top:0;font-size:15px;padding:14px">
          ⬇ ${esc(t('deposit'))} (${esc(t('currency_etb'))})
        </button>
        <button id="go-with" class="btn btn-outline" style="flex:1;min-width:160px;margin-top:0;font-size:15px;padding:14px">
          ⬆ ${esc(t('withdraw'))}
        </button>
      </div>
    </div>

    <!-- Recent Transactions -->
    <div class="card">
      <div class="section-head">
        <h2>${esc(t('history'))}</h2>
        <a href="#" id="see-all-tx" style="font-size:13px;font-weight:700;color:var(--gold-bright)">${esc(t('see_all'))} →</a>
      </div>
      ${!recentTx.length ? emptyState('📋', t('no_data')) : `
      <div class="scroll"><table>
        <tr><th>${esc(t('date'))}</th><th>${esc(t('type'))}</th><th>${esc(t('amount'))}</th><th>${esc(t('balance'))}</th></tr>
        ${recentTx.map((x) => `<tr>
          <td class="muted" style="white-space:nowrap">${esc(x.created_at)}</td>
          <td><span style="font-weight:600">${esc(t('t_' + x.type))}</span></td>
          <td class="${x.amount >= 0 ? 'plus' : 'minus'}" style="font-weight:700;font-family:var(--font-heading);font-size:16px">${rel(x.amount)}</td>
          <td style="font-weight:600">${fmt(x.balance_after)}</td>
        </tr>`).join('')}
      </table></div>`}
    </div>`;

  $('go-dep').onclick = () => { tab = 'deposit'; render(); };
  $('go-with').onclick = () => { tab = 'withdraw'; render(); };
  const seeAll = $('see-all-tx');
  if (seeAll) seeAll.onclick = (e) => { e.preventDefault(); tab = 'history'; render(); };
}

function profileView(app) {
  app.innerHTML = `
    <section class="profile-page card" aria-labelledby="profile-title">
      <div class="profile-page-heading">
        <div class="avatar">${esc(initials(me?.name))}</div>
        <div><div class="eyebrow">${lang === 'am' ? 'የእርስዎ መለያ' : 'YOUR ACCOUNT'}</div><h1 id="profile-title">${esc(me?.name || '')}</h1></div>
      </div>
      <dl class="profile-details">
        <div><dt>${esc(t('phone'))}</dt><dd>${esc(me?.phone || '')}</dd></div>
        <div><dt>${esc(t('balance'))}</dt><dd>🪙 ${fmt(balance)} ${esc(t('currency_etb'))}</dd></div>
        <div><dt>${esc(t('role'))}</dt><dd>${esc(me?.role || 'user')}</dd></div>
      </dl>
      <div class="profile-actions">
        <button class="btn btn-outline" type="button" data-profile-route="wallet">💳 ${esc(t('wallet'))}</button>
        <button class="btn btn-outline" type="button" data-profile-route="withdraw">⬆ ${esc(t('withdraw'))}</button>
        <button class="btn btn-outline" type="button" data-profile-route="history">📋 ${esc(t('history'))}</button>
        <button class="btn btn-outline" type="button" data-profile-route="support">💬 ${esc(t('support'))}</button>
      </div>
    </section>`;
  app.querySelectorAll('[data-profile-route]').forEach((button) => {
    button.onclick = () => { tab = button.dataset.profileRoute; render(); };
  });
}

// =====================================================
// DEPOSIT VIEW — Step-by-Step Ethiopian Payment Flow
// =====================================================
async function depositView(app) {
  const [{ providers }, { deposits }] = await Promise.all([api('/providers'), api('/deposits')]);

  const providerIcons = {
    telebirr: '📱',
    cbe: '🏦',
    boa: '🏛',
    dashen: '⚡',
    awash: '🛡',
    mpesa: '💸'
  };

  let selectedProvId = providers[0]?.id || 1;

  app.innerHTML = `
    <div class="card">
      <div class="section-head" style="margin-bottom:6px">
        <h2>⬇ ${esc(t('deposit'))}</h2>
        <span class="tag approved" style="font-size:13px">🪙 ${fmt(balance)} ${esc(t('currency_etb'))}</span>
      </div>
      <p style="color:var(--text-secondary);font-size:13px;margin-bottom:16px">${esc(t('manual_review_notice'))}</p>

      <form id="df">
        <!-- Step 1: Select Payment Method -->
        <div class="payment-step-head">
          <div class="payment-step-num">1</div>
          <div class="payment-step-title">${esc(t('step_select_method'))}</div>
        </div>

        <div class="provider-cards-grid" id="prov-cards">
          ${providers.map((p) => `
            <div class="provider-card-item ${p.id === selectedProvId ? 'selected' : ''}" data-id="${p.id}">
              <div class="provider-card-icon">${providerIcons[p.code] || '💳'}</div>
              <div class="provider-card-name">${esc(p.name)}</div>
              <span class="provider-card-badge">${esc(t('manual'))}</span>
            </div>
          `).join('')}
        </div>
        <input type="hidden" id="prov" name="provider_id" value="${selectedProvId}">

        <!-- Step 2: Choose Amount -->
        <div class="payment-step-head">
          <div class="payment-step-num">2</div>
          <div class="payment-step-title">${esc(t('step_enter_amount'))}</div>
        </div>

        <div class="quick-amounts-bar">
          <button type="button" class="quick-amt-chip" data-val="50">50 ${esc(t('currency_etb'))}</button>
          <button type="button" class="quick-amt-chip active" data-val="100">100 ${esc(t('currency_etb'))}</button>
          <button type="button" class="quick-amt-chip" data-val="250">250 ${esc(t('currency_etb'))}</button>
          <button type="button" class="quick-amt-chip" data-val="500">500 ${esc(t('currency_etb'))}</button>
          <button type="button" class="quick-amt-chip" data-val="1000">1,000 ${esc(t('currency_etb'))}</button>
          <button type="button" class="quick-amt-chip" data-val="2500">2,500 ${esc(t('currency_etb'))}</button>
        </div>

        <div style="position:relative">
          <input id="amt" name="amount" type="number" min="10" max="50000" step="1" value="100" required
            style="font-size:18px;font-weight:700;color:var(--gold-bright);padding-left:14px">
        </div>

        <!-- Step 3: Instructions & Transfer Details -->
        <div class="payment-step-head">
          <div class="payment-step-num">3</div>
          <div class="payment-step-title">${esc(t('step_transfer_submit'))}</div>
        </div>

        <div class="provider-detail-box" id="provider-info-box">
          <div class="p-title" id="ins-title"></div>
          <div class="p-text" id="ins"></div>
        </div>

        <label for="tx">${esc(t('tx_ref'))}</label>
        <input id="tx" name="tx_ref" placeholder="${esc(t('tx_ref_hint'))}" required
          style="font-family:monospace;letter-spacing:1.5px;text-transform:uppercase;font-size:15px;padding:12px 14px">

        <label for="deposit-receipt" class="receipt-upload-label">${lang === 'am' ? 'የክፍያ ደረሰኝ ምስል' : 'Payment receipt image'} <span class="muted">(${lang === 'am' ? 'አማራጭ · JPG፣ PNG ወይም WEBP · እስከ 5 ሜባ' : 'optional · JPG, PNG or WEBP · max 5 MB'})</span></label>
        <input id="deposit-receipt" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" class="receipt-file-input">
        <div id="deposit-receipt-preview-wrap" class="receipt-upload-preview" hidden>
          <img id="deposit-receipt-preview" alt="Selected receipt preview">
          <div><span id="deposit-receipt-name"></span><button type="button" class="btn btn-outline sm" id="deposit-receipt-remove">Remove</button></div>
        </div>
        <p id="deposit-receipt-error" class="receipt-error" role="alert" hidden></p>
        <p class="notice">${lang === 'am' ? 'ደረሰኞች በግል ይቀመጣሉ እና ለሰው ግምገማ ብቻ ይላካሉ። ምስል መጫን ክፍያን አያረጋግጥም ወይም ገንዘብ አይጨምርም።' : 'Receipt images are private and submitted for manual review only. Uploading an image does not verify payment or add funds.'}</p>

        <button type="submit" class="btn btn-gold" id="dep-submit-btn" style="margin-top:18px;padding:14px;font-size:15px">
          ${esc(t('submit'))}
        </button>
      </form>
    </div>

    <!-- My Deposits History -->
    <div class="card">
      <div class="section-head">
        <h3>${esc(t('my_deposits'))}</h3>
        <span class="muted" style="font-size:12px">${deposits.length} ${esc(t('history'))}</span>
      </div>
      ${!deposits.length ? emptyState('⬆', t('no_data')) : `
      <div class="scroll"><table>
        <tr><th>${esc(t('date'))}</th><th>${esc(t('method'))}</th><th>${esc(t('amount'))}</th><th>${esc(t('tx_ref'))}</th><th>Receipt</th><th>${esc(t('status'))}</th></tr>
        ${deposits.map((d) => `<tr>
          <td class="muted" style="white-space:nowrap">${esc(d.created_at)}</td>
          <td><b>${esc(d.provider)}</b></td>
          <td style="font-weight:800;color:var(--gold-bright);font-size:15px">${fmt(d.amount)} ${esc(t('currency_etb'))}</td>
          <td><span style="font-size:12px;font-family:monospace;background:var(--surface-hover);padding:3px 8px;border-radius:4px">${esc(d.tx_ref)}</span></td>
          <td>${d.has_receipt ? `<a class="btn btn-outline sm" href="/api/deposits/${encodeURIComponent(d.id)}/receipt" target="_blank" rel="noopener">View receipt</a>` : '<span class="muted">Not attached</span>'}</td>
          <td>${statusTag(d.status)}${d.reason ? `<div class="muted" style="margin-top:3px;font-size:11px">${esc(d.reason)}</div>` : ''}</td>
        </tr>`).join('')}
      </table></div>`}
    </div>`;

  const updateProviderDisplay = (provId) => {
    selectedProvId = Number(provId);
    $('prov').value = selectedProvId;
    document.querySelectorAll('.provider-card-item').forEach((c) => {
      c.classList.toggle('selected', Number(c.dataset.id) === selectedProvId);
    });
    const p = providers.find((x) => x.id === selectedProvId);
    if (p) {
      $('ins-title').textContent = `${p.name} - ${esc(t('instructions'))}`;
      $('ins').textContent = lang === 'am' ? p.instr_am : p.instr_en;
    }
  };

  document.querySelectorAll('.provider-card-item').forEach((item) => {
    item.onclick = () => updateProviderDisplay(item.dataset.id);
  });
  updateProviderDisplay(selectedProvId);

  document.querySelectorAll('.quick-amt-chip').forEach((chip) => {
    chip.onclick = () => {
      document.querySelectorAll('.quick-amt-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      $('amt').value = chip.dataset.val;
    };
  });

  $('amt').oninput = (e) => {
    document.querySelectorAll('.quick-amt-chip').forEach((c) => {
      c.classList.toggle('active', c.dataset.val === e.target.value);
    });
  };

  let receiptData = null;
  $('deposit-receipt').onchange = async (ev) => {
    const file = ev.target.files?.[0];
    const error = $('deposit-receipt-error');
    error.hidden = true;
    receiptData = null;
    $('deposit-receipt-preview-wrap').hidden = true;
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      error.textContent = file.size > 5 * 1024 * 1024 ? 'Image must be 5 MB or smaller.' : 'Choose a JPG, PNG or WEBP image.';
      error.hidden = false;
      ev.target.value = '';
      return;
    }
    receiptData = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    }).catch(() => null);
    if (!receiptData) { error.textContent = 'Could not read that image. Please try another file.'; error.hidden = false; return; }
    $('deposit-receipt-preview').src = receiptData;
    $('deposit-receipt-name').textContent = file.name;
    $('deposit-receipt-preview-wrap').hidden = false;
  };
  $('deposit-receipt-remove').onclick = () => {
    receiptData = null;
    $('deposit-receipt').value = '';
    $('deposit-receipt-preview-wrap').hidden = true;
  };

  $('df').onsubmit = async (ev) => {
    ev.preventDefault();
    const btn = $('dep-submit-btn');
    btn.disabled = true; btn.textContent = '...';
    try {
      const request = Object.fromEntries(new FormData(ev.target));
      if (receiptData) request.receipt_data = receiptData;
      const result = await api('/deposits', request);
      success(result.existing ? t('deposit_existing') : t('deposit_created'));
      tab = 'wallet';
      render();
    } catch (e) {
      fail(e);
      btn.disabled = false;
      btn.textContent = t('submit');
    }
  };
}

// =====================================================
// WITHDRAW VIEW — Clean ETB Cashout Flow
// =====================================================
async function withdrawView(app) {
  const [{ providers }, { withdrawals }] = await Promise.all([
    api('/providers'),
    api('/withdrawals').catch(() => ({ withdrawals: [] }))
  ]);

  const maxETB = Math.floor(balance / 100);

  app.innerHTML = `
    <div class="card">
      <div class="section-head" style="margin-bottom:6px">
        <h2>⬆ ${esc(t('withdraw'))}</h2>
        <span class="tag approved" style="font-size:13px">🪙 ${fmt(balance)} ${esc(t('currency_etb'))}</span>
      </div>
      <p style="color:var(--text-secondary);font-size:13px;margin-bottom:16px">${esc(t('withdraw_created'))}</p>
      <p class="notice">${lang === 'am' ? 'የምናባዊ ክሬዲት ሙከራ ብቻ ነው። የክፍያ አቅራቢ አልተገናኘም፤ ጥያቄ መቀበል እውነተኛ ክፍያ መላኩን አያረጋግጥም።' : 'Virtual-credit demo only: no cash-out provider is connected. An accepted request records an internal demo status and does not confirm that a real payment was sent.'}</p>

      <form id="wf">
        <!-- Step 1: Payout Method -->
        <label for="wprov">${esc(t('withdraw_step_method'))}</label>
        <select id="wprov" name="provider_id">
          ${providers.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
        </select>

        <!-- Step 2: Amount -->
        <label for="wamt" style="margin-top:12px">${esc(t('amount'))} (${esc(t('currency_etb'))})</label>
        <div class="quick-amounts-bar">
          <button type="button" class="quick-amt-chip" data-pct="0.25">25%</button>
          <button type="button" class="quick-amt-chip" data-pct="0.5">50%</button>
          <button type="button" class="quick-amt-chip" data-pct="0.75">75%</button>
          <button type="button" class="quick-amt-chip" data-pct="1">MAX</button>
        </div>
        <input id="wamt" name="amount" type="number" min="10" max="${Math.max(10, maxETB)}" step="1"
          value="${Math.min(100, Math.max(10, maxETB))}" required style="font-size:18px;font-weight:700;color:var(--gold-bright)">

        <!-- Step 3: Account Number / Phone -->
        <label for="wacc" style="margin-top:12px">${esc(t('account_number'))}</label>
        <input id="wacc" name="account_number" placeholder="e.g. 0911223344 or 100012345678" required
          style="font-family:monospace;font-size:15px;letter-spacing:1px">

        <button type="submit" class="btn btn-gold" ${balance < 1000 ? 'disabled' : ''} style="margin-top:18px;padding:14px;font-size:15px">
          ${esc(t('submit'))}
        </button>
      </form>
    </div>

    <!-- My Withdrawals History -->
    <div class="card">
      <div class="section-head">
        <h3>${esc(t('my_withdrawals'))}</h3>
        <span class="muted" style="font-size:12px">${withdrawals.length} ${esc(t('history'))}</span>
      </div>
      ${!withdrawals.length ? emptyState('⬇', t('no_data')) : `
      <div class="scroll"><table>
        <tr><th>${esc(t('date'))}</th><th>${esc(t('method'))}</th><th>${esc(t('amount'))}</th><th>${esc(t('account_number'))}</th><th>${esc(t('status'))}</th></tr>
        ${withdrawals.map((w) => `<tr>
          <td class="muted" style="white-space:nowrap">${esc(w.created_at)}</td>
          <td><b>${esc(w.provider)}</b></td>
          <td style="font-weight:800;color:#FFFFFF;font-size:15px">${fmt(w.amount)} ${esc(t('currency_etb'))}</td>
          <td><span style="font-size:12px;font-family:monospace;background:var(--surface-hover);padding:3px 8px;border-radius:4px">${esc(w.account_number)}</span></td>
          <td>${statusTag(w.status)}${w.reason ? `<div class="muted" style="margin-top:3px;font-size:11px">${esc(w.reason)}</div>` : ''}</td>
        </tr>`).join('')}
      </table></div>`}
    </div>`;

  document.querySelectorAll('.quick-amt-chip[data-pct]').forEach((chip) => {
    chip.onclick = () => {
      const pct = Number(chip.dataset.pct);
      const val = Math.floor(maxETB * pct);
      $('wamt').value = Math.max(10, val);
    };
  });

  $('wf').onsubmit = async (ev) => {
    ev.preventDefault();
    const btn = ev.target.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = '...';
    try {
      await api('/withdrawals', Object.fromEntries(new FormData(ev.target)));
      success(t('withdraw_created'));
      tab = 'wallet';
      render();
    } catch (e) {
      fail(e);
      btn.disabled = false;
      btn.textContent = t('submit');
    }
  };
}

// =====================================================
// HISTORY VIEW — Filter Pills + Table & Mobile Cards
// =====================================================
async function historyView(app) {
  const { transactions } = await api('/transactions');
  let currentFilter = 'all';

  const renderHistoryContent = (filter) => {
    const filtered = transactions.filter((tx) => {
      if (filter === 'all') return true;
      if (filter === 'deposit') return tx.type === 'deposit' || tx.type === 'demo_bonus' || tx.type === 'agent_funding';
      if (filter === 'withdraw') return tx.type.startsWith('withdraw');
      if (filter === 'bet') return tx.type === 'bet';
      if (filter === 'win') return tx.type === 'win';
      return true;
    });

    const listHtml = !filtered.length ? emptyState('📋', t('no_data')) : `
      <div class="scroll"><table>
        <tr><th>${esc(t('date'))}</th><th>${esc(t('type'))}</th><th>${esc(t('amount'))}</th><th>${esc(t('balance'))}</th></tr>
        ${filtered.map((x) => `<tr>
          <td class="muted" style="white-space:nowrap">${esc(x.created_at)}</td>
          <td><span style="font-weight:600">${esc(t('t_' + x.type) !== 't_' + x.type ? t('t_' + x.type) : x.type)}</span></td>
          <td class="${x.amount >= 0 ? 'plus' : 'minus'}" style="font-weight:700;font-family:var(--font-heading);font-size:16px">${rel(x.amount)}</td>
          <td style="font-weight:600">${fmt(x.balance_after)}</td>
        </tr>`).join('')}
      </table></div>`;

    $('history-data-container').innerHTML = listHtml;
  };

  app.innerHTML = `
    <div class="card">
      <div class="section-head">
        <h2>${esc(t('history'))}</h2>
        <span class="muted" style="font-size:12px">${transactions.length} entries</span>
      </div>

      <div class="filter-pills-bar">
        <button class="filter-pill active" data-f="all">${esc(t('filter_all'))}</button>
        <button class="filter-pill" data-f="deposit">${esc(t('filter_deposits'))}</button>
        <button class="filter-pill" data-f="withdraw">${esc(t('filter_withdrawals'))}</button>
        <button class="filter-pill" data-f="bet">${esc(t('filter_bets'))}</button>
        <button class="filter-pill" data-f="win">${esc(t('filter_wins'))}</button>
      </div>

      <div id="history-data-container"></div>
    </div>`;

  document.querySelectorAll('.filter-pill').forEach((pill) => {
    pill.onclick = () => {
      document.querySelectorAll('.filter-pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      currentFilter = pill.dataset.f;
      renderHistoryContent(currentFilter);
    };
  });

  renderHistoryContent('all');
}

// =====================================================
// SUPPORT VIEW — Interactive AI Assistant & Customer Chat
// =====================================================
async function supportView(app) {
  const { ticket, messages, ai_enabled } = await api('/support');

  const defaultGreeting = lang === 'am'
    ? `ሰላም ${esc(me.name)}! ወደ ፈጣን ቤት የደንበኞች ድጋፍ ማዕከል እንኳን በደህና መጡ። እኔ የፈጣን ቤት AI ረዳት ነኝ። ዛሬ እንዴት ልረዳዎ እችላለሁ? ስለ ገንዘብ ማስገባት፣ ማውጣት፣ ወይም ስለ ጨዋታዎቻችን መጠየቅ ይችላሉ።`
    : `Hi ${esc(me.name)}! Welcome to Fetan Bet Support. I am your AI Support Assistant. How can I assist you today? Feel free to ask about deposits, withdrawals, or game rules.`;

  const allMessages = messages && messages.length ? messages : [
    { sender_role: 'ai', sender_name: 'Fetan AI', message: defaultGreeting, created_at: 'Just now' }
  ];

  app.innerHTML = `
    <div class="support-chat-card">
      <div class="support-chat-header">
        <div style="display:flex;align-items:center;gap:10px">
          <div class="logo" style="width:34px;height:34px;font-size:16px">🤖</div>
          <div>
            <div style="font-weight:800;font-size:15px;color:var(--text)">${esc(t('ai_assistant'))}</div>
            <div style="font-size:11px;color:var(--green);display:flex;align-items:center;gap:4px">
              <span style="font-size:8px">●</span> ${esc(t('ai_status_active'))}
            </div>
          </div>
        </div>
        <div>
          ${ticket ? statusTag(ticket.status) : `<span class="tag open">${esc(t('status_open'))}</span>`}
        </div>
      </div>

      <!-- Quick prompts bar -->
      <div class="chat-prompts-bar">
        <button type="button" class="prompt-chip" data-q="How do I deposit with Telebirr or CBE?">💳 ${lang === 'am' ? 'ገንዘብ ማስገባት' : 'Deposit Instructions'}</button>
        <button type="button" class="prompt-chip" data-q="Where is my deposit status?">🪙 ${lang === 'am' ? 'የማስገቢያዬ ሁኔታ' : 'Deposit Status'}</button>
        <button type="button" class="prompt-chip" data-q="How do I request a withdrawal?">⬆ ${lang === 'am' ? 'ገንዘብ ማውጣት' : 'Withdrawal Process'}</button>
        <button type="button" class="prompt-chip" data-q="How do I play Road Dash and Mines?">🎰 ${lang === 'am' ? 'የጨዋታዎች ህግ' : 'Game Rules'}</button>
        <button type="button" class="prompt-chip" data-q="I want to talk to a human agent">👤 ${lang === 'am' ? 'ከሰው ወኪል ጋር አገናኘኝ' : 'Talk to Human Agent'}</button>
      </div>

      <!-- Chat message stream -->
      <div class="support-chat-stream" id="chat-stream">
        ${allMessages.map((m) => `
          <div class="chat-msg ${m.sender_role}">
            <div class="chat-msg-sender">
              <span>${m.sender_role === 'ai' ? '🤖 Fetan AI' : m.sender_role === 'user' ? '🪙 You' : '👤 ' + esc(m.sender_name)}</span>
              <span class="muted" style="font-size:10px">${esc(m.created_at)}</span>
            </div>
            <div class="chat-bubble">${esc(m.message)}</div>
          </div>
        `).join('')}
      </div>

      ${ticket && ticket.status === 'escalated' ? `
        <div style="padding:10px 18px;background:rgba(239,68,68,0.1);border-top:1px solid rgba(239,68,68,0.3);font-size:12px;color:#FCA5A5">
          ℹ ${lang === 'am' ? 'ጥያቄዎ ወደ ሰው ድጋፍ ሰጪ ወኪሎቻችን ተላልፏል። አንድ ወኪል በቅርቡ እዚህ መልስ ይሰጥዎታል።' : 'Your request has been escalated to our human support team. An agent will reply to you directly here.'}
        </div>
      ` : ''}

      <!-- Message input -->
      <form id="chat-form" class="chat-input-row">
        <input id="chat-input" placeholder="${esc(t('ticket_ph'))}" autocomplete="off" required>
        <button type="submit" class="chat-send-btn" id="chat-send-btn">
          <span>${esc(t('send'))}</span> ➤
        </button>
      </form>
    </div>`;

  const stream = $('chat-stream');
  if (stream) stream.scrollTop = stream.scrollHeight;

  document.querySelectorAll('.prompt-chip').forEach((chip) => {
    chip.onclick = () => {
      $('chat-input').value = chip.dataset.q;
      $('chat-form').dispatchEvent(new Event('submit'));
    };
  });

  $('chat-form').onsubmit = async (ev) => {
    ev.preventDefault();
    const inp = $('chat-input');
    const msg = inp.value.trim();
    if (!msg) return;
    const btn = $('chat-send-btn');
    btn.disabled = true;

    // Immediately display user bubble in UI
    const userDiv = document.createElement('div');
    userDiv.className = 'chat-msg user';
    userDiv.innerHTML = `
      <div class="chat-msg-sender"><span>🪙 You</span><span class="muted" style="font-size:10px">Just now</span></div>
      <div class="chat-bubble">${esc(msg)}</div>
    `;
    stream.appendChild(userDiv);
    stream.scrollTop = stream.scrollHeight;
    inp.value = '';

    try {
      await api('/support', { message: msg });
      supportView(app);
    } catch (e) {
      fail(e);
      btn.disabled = false;
    }
  };
}

// =====================================================
// AGENT VIEW — Float Funding, Verification & Support Queue
// =====================================================
async function agentView(app) {
  app.innerHTML = '<div class="card agent-loading" role="status"><span class="agent-loading-dot"></span>Loading Agent Dashboard…</div>';
  const load = async (url, key, fallback = []) => {
    try { return { value: await api(url), error: null }; }
    catch (error) { return { value: { [key]: fallback }, error }; }
  };
  const [dpR, daR, drR, wpR, waR, wrR, fundR, ticketsR, perfR, annR] = await Promise.all([
    load('/agent/deposits?status=pending', 'deposits'),
    load('/agent/deposits?status=approved', 'deposits'),
    load('/agent/deposits?status=rejected', 'deposits'),
    load('/agent/withdrawals?status=pending', 'withdrawals'),
    load('/agent/withdrawals?status=approved', 'withdrawals'),
    load('/agent/withdrawals?status=rejected', 'withdrawals'),
    load('/agent/funding', 'requests'),
    load('/agent/tickets', 'tickets'),
    load('/agent/performance', 'performance', {}),
    load('/announcements', 'announcements'),
  ]);
  const dp = dpR.value, da = daR.value, dr = drR.value;
  const wp = wpR.value, wa = waR.value, wr = wrR.value;
  const fund = fundR.value, ticketsRes = ticketsR.value;
  const perf = perfR.value.performance || perfR.value;
  const annRes = annR.value;
  const agentErrors = [
    ['Pending deposits', dpR.error], ['Approved deposits', daR.error], ['Rejected deposits', drR.error],
    ['Pending withdrawals', wpR.error], ['Approved withdrawals', waR.error], ['Rejected withdrawals', wrR.error],
    ['Funding requests', fundR.error], ['Support requests', ticketsR.error], ['Performance', perfR.error], ['Announcements', annR.error]
  ];
  const errorText = (error) => error?.message === 'SCHEMA_NOT_READY'
    ? 'Deposit review database schema is unavailable. Migration 002 must be applied by an authorized operator.'
    : getErrMsg(error);
  const errorPanel = (label, error) => `<div class="agent-api-error" role="alert"><div><b>${esc(label)} could not be loaded</b><p>${esc(errorText(error))}</p></div><button type="button" class="btn btn-outline sm" data-agent-retry>Retry</button></div>`;

  const isDep = agentSubtab === 'deposits';
  const isWith = agentSubtab === 'withdrawals';
  const isTickets = agentSubtab === 'tickets';
  const isFund = agentSubtab === 'funding';
  const isAnn = agentSubtab === 'announcements';

  const pendingTickets = (ticketsRes.tickets || []).filter((t) => t.status === 'open' || t.status === 'escalated');

  app.innerHTML = `
    <div class="section-head agent-dashboard-heading">
      <div><h2>🔑 Agent Dashboard</h2><span class="brand-sub" style="color:var(--gold-bright)">REQUESTS · VERIFICATION · SUPPORT</span></div>
      <span class="tag approved">${esc(me.status || 'active')}</span>
    </div>
    <div class="agent-overview-cards" aria-label="Agent activity overview">
      <div class="agent-overview-stat"><span aria-hidden="true">⬇</span><div><small>Pending deposits</small><b>${dpR.error ? '—' : dp.deposits.length}</b></div></div>
      <div class="agent-overview-stat"><span aria-hidden="true">⬆</span><div><small>Pending withdrawals</small><b>${wpR.error ? '—' : wp.withdrawals.length}</b></div></div>
      <div class="agent-overview-stat"><span aria-hidden="true">✓</span><div><small>Reviewed today</small><b>${perfR.error ? '—' : (perf.today_deposits_count ?? 0) + (perf.today_withdrawals_count ?? 0)}</b><em>${perfR.error ? 'Unavailable' : `${perf.today_deposits_count ?? 0} deposits · ${perf.today_withdrawals_count ?? 0} withdrawals`}</em></div></div>
      <div class="agent-overview-stat"><span aria-hidden="true">◉</span><div><small>Open support cases</small><b>${ticketsR.error ? '—' : pendingTickets.length}</b></div></div>
    </div>
    ${agentErrors.filter(([, error]) => error).map(([label, error]) => errorPanel(label, error)).join('')}
    <!-- Agent Float Balance Banner -->
    <div class="agent-float-card">
      <div class="agent-float-info">
        <div class="agent-float-title">🔑 ${esc(t('agent_float_balance'))}</div>
        <div class="agent-float-num">🪙 ${fmt(balance)} <small style="font-size:16px;color:var(--gold-bright);font-weight:700">${esc(t('currency_etb'))}</small></div>
        <div style="font-size:12px;color:var(--text-muted)">${esc(me.name)} (${esc(me.phone)})</div>
      </div>
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <div class="stat" style="padding:8px 14px;background:var(--surface-card);border:1px solid var(--border);border-radius:var(--radius-sm)">
          <div class="stat-label">Today's Verified</div>
          <b>${perfR.error ? '—' : `${perf.today_deposits_count ?? 0} in · ${perf.today_withdrawals_count ?? 0} out`}</b>
        </div>
          <button id="toggle-funding-btn" class="btn btn-gold" style="width:auto;padding:10px 18px;font-size:13px">
            ⚡ ${esc(t('request_funding'))}
          </button>
      </div>
    </div>

    <!-- Agent Funding Request Drawer / Box -->
    <div id="funding-request-box" class="card" style="display:none;border-color:var(--gold-muted);margin-bottom:20px">
      <div class="section-head">
        <h3>⚡ ${esc(t('request_funding'))}</h3>
        <button type="button" id="close-funding-box" class="btn sm btn-outline">✕</button>
      </div>
      <p style="color:var(--text-secondary);font-size:13px;margin-bottom:12px">
        Request float top-up directly from the Super Admin. Once approved, credits will be added to your agent wallet immediately.
      </p>
      <form id="af-form">
        <label for="af-amt">${esc(t('funding_amount'))} (${esc(t('currency_etb'))})</label>
        <div class="quick-amounts-bar">
          <button type="button" class="quick-amt-chip" data-v="500">500 ${esc(t('currency_etb'))}</button>
          <button type="button" class="quick-amt-chip active" data-v="1000">1,000 ${esc(t('currency_etb'))}</button>
          <button type="button" class="quick-amt-chip" data-v="2500">2,500 ${esc(t('currency_etb'))}</button>
          <button type="button" class="quick-amt-chip" data-v="5000">5,000 ${esc(t('currency_etb'))}</button>
        </div>
        <input id="af-amt" name="amount" type="number" min="50" max="100000" step="10" value="1000" required
          style="font-size:18px;font-weight:700;color:var(--gold-bright)">

        <label for="af-note" style="margin-top:12px">${esc(t('funding_note'))}</label>
        <input id="af-note" name="note" placeholder="e.g. Weekend cash float for customer deposits">

        <button type="submit" id="af-submit-btn" class="btn btn-gold" style="margin-top:16px">
          ${esc(t('funding_req_btn'))}
        </button>
      </form>
    </div>

    <!-- Main Agent Operations Card -->
    <div class="card">
      <div class="subtabs">
        <button class="subtab ${isDep ? 'on' : ''}" id="as-dep">⬇ ${esc(t('customer_deposits'))}<span class="tag ${dp.deposits.length ? 'pending' : 'approved'}">${dp.deposits.length}</span></button>
        <button class="subtab ${isWith ? 'on' : ''}" id="as-with">⬆ ${esc(t('customer_withdrawals'))}<span class="tag ${wp.withdrawals.length ? 'pending' : 'approved'}">${wp.withdrawals.length}</span></button>
        <button class="subtab ${isTickets ? 'on' : ''}" id="as-tickets">💬 ${esc(t('tickets'))}<span class="tag ${pendingTickets.length ? 'pending' : 'approved'}">${pendingTickets.length}</span></button>
        <button class="subtab ${isFund ? 'on' : ''}" id="as-fund">⚡ ${esc(t('funding_history'))}</button>
        <button class="subtab ${isAnn ? 'on' : ''}" id="as-ann">📢 ${esc(t('announcements'))} (${annRes.announcements.length})</button>
      </div>
      <!-- TAB 1: CUSTOMER DEPOSITS -->
      ${isDep ? `
        <h3>${esc(t('pending_requests'))}</h3>
        ${dpR.error ? errorPanel('Pending deposits', dpR.error) : dp.deposits.length ? `
          <div class="scroll"><table>
            <tr><th>${esc(t('date'))}</th><th>${esc(t('name'))}</th><th>${esc(t('method'))}</th><th>${esc(t('amount'))}</th><th>${esc(t('tx_ref'))}</th><th>Receipt</th><th></th></tr>
            ${dp.deposits.map((d) => `<tr>
              <td class="muted" style="white-space:nowrap">${esc(d.created_at)}</td>
              <td><div style="font-weight:600">${esc(d.user_name)}</div><div class="muted">${esc(d.phone)}</div></td>
              <td><b>${esc(d.provider)}</b>${d.last_review_action === 'escalate' ? '<div class="tag pending">Escalated for review</div>' : ''}</td>
              <td style="font-weight:800;color:var(--gold-bright);font-size:16px">${fmt(d.amount)} ${esc(t('currency_etb'))}</td>
              <td><span style="font-size:12px;font-family:monospace;background:var(--surface-hover);padding:3px 8px;border-radius:4px">${esc(d.tx_ref)}</span></td>
              <td>${d.has_receipt ? 'Attached' : 'None'}</td>
              <td style="white-space:nowrap">
                <button class="btn sm btn-gold" data-open-deposit-review="${d.id}">Review request</button>
              </td>
            </tr>`).join('')}
          </table></div>` : emptyState('✅', t('no_data'))
        }

        <div class="divider"></div>
        <h3>${esc(t('decided_requests'))}</h3>
        ${daR.error || drR.error ? errorPanel('Deposit review history', daR.error || drR.error) : [...da.deposits, ...dr.deposits].length ? `
          <div class="scroll"><table>
            <tr><th>${esc(t('date'))}</th><th>${esc(t('name'))}</th><th>${esc(t('amount'))}</th><th>${esc(t('tx_ref'))}</th><th>Receipt</th><th>Reviewed by</th><th>${esc(t('status'))}</th></tr>
            ${[...da.deposits, ...dr.deposits].sort((x, y) => y.id - x.id).slice(0, 30).map((d) => `<tr>
              <td class="muted" style="white-space:nowrap">${esc(d.created_at)}</td>
              <td><div style="font-weight:600">${esc(d.user_name)}</div><div class="muted">${esc(d.provider)}</div></td>
              <td style="font-weight:700">${fmt(d.amount)}</td>
              <td><span style="font-size:12px;font-family:monospace">${esc(d.tx_ref)}</span></td>
              <td>${d.has_receipt ? `<a class="btn btn-outline sm" href="/api/deposits/${encodeURIComponent(d.id)}/receipt" target="_blank" rel="noopener">View</a>` : 'None'}</td>
              <td>${esc(d.reviewer_name || '—')}</td>
              <td>${statusTag(d.status)}${d.reason ? `<div class="muted" style="margin-top:3px;font-size:11px">${esc(d.reason)}</div>` : ''}</td>
            </tr>`).join('')}
          </table></div>` : emptyState('📋', t('no_data'))
        }
      ` : ''}

      <!-- TAB 2: CUSTOMER WITHDRAWALS -->
      ${isWith ? `
        <p class="notice">${lang === 'am' ? 'የምናባዊ ክሬዲት ሙከራ ብቻ። እነዚህ ድርጊቶች ክፍያ አይልኩም፤ የክፍያ አቅራቢ ግንኙነት የለም።' : 'Virtual-credit demo only. These actions do not send a payout; the project has no payment-provider payout integration.'}</p>
        <h3>${esc(t('pending_withdrawals'))}</h3>
        ${wpR.error ? errorPanel('Pending withdrawals', wpR.error) : wp.withdrawals.length ? `
          <div class="scroll"><table>
            <tr><th>${esc(t('name'))}</th><th>${esc(t('method'))}</th><th>${esc(t('amount'))}</th><th>${esc(t('account_number'))}</th><th></th></tr>
            ${wp.withdrawals.map((w) => `<tr>
              <td><div style="font-weight:600">${esc(w.user_name)}</div><div class="muted">${esc(w.phone)}</div></td>
              <td><b>${esc(w.provider)}</b></td>
              <td style="font-weight:800;color:#FFFFFF;font-size:16px">${fmt(w.amount)} ${esc(t('currency_etb'))}</td>
              <td><span style="font-size:12px;font-family:monospace;background:var(--surface-hover);padding:3px 8px;border-radius:4px">${esc(w.account_number)}</span></td>
              <td style="white-space:nowrap">
                <button class="btn sm alt" data-kind="withdraw" data-a="approve" data-id="${w.id}">✓ ${esc(t('approve'))}</button>
                <button class="btn sm bad" data-kind="withdraw" data-a="reject" data-id="${w.id}">✕ ${esc(t('reject'))}</button>
              </td>
            </tr>`).join('')}
          </table></div>` : emptyState('✅', t('no_data'))
        }

        <div class="divider"></div>
        <h3>${esc(t('decided_withdrawals'))}</h3>
        ${waR.error || wrR.error ? errorPanel('Withdrawal history', waR.error || wrR.error) : [...wa.withdrawals, ...wr.withdrawals].length ? `
          <div class="scroll"><table>
            <tr><th>${esc(t('name'))}</th><th>${esc(t('amount'))}</th><th>${esc(t('account_number'))}</th><th>${esc(t('status'))}</th></tr>
            ${[...wa.withdrawals, ...wr.withdrawals].sort((x, y) => y.id - x.id).slice(0, 30).map((w) => `<tr>
              <td><div style="font-weight:600">${esc(w.user_name)}</div><div class="muted">${esc(w.provider)}</div></td>
              <td style="font-weight:700">${fmt(w.amount)}</td>
              <td><span style="font-size:12px;font-family:monospace">${esc(w.account_number)}</span></td>
              <td>${statusTag(w.status)}${w.reason ? `<div class="muted" style="margin-top:3px;font-size:11px">${esc(w.reason)}</div>` : ''}</td>
            </tr>`).join('')}
          </table></div>` : emptyState('📋', t('no_data'))
        }
      ` : ''}

      <!-- TAB 3: CUSTOMER SUPPORT TICKETS QUEUE -->
      ${isTickets ? `
        <div class="section-head">
          <h3>💬 Customer Support & Escalated Requests</h3>
        </div>
        ${ticketsR.error ? errorPanel('Support requests', ticketsR.error) : !ticketsRes.tickets.length ? emptyState('💬', t('no_data')) : `
          <div class="scroll"><table>
            <tr><th>Ticket ID</th><th>${esc(t('name'))}</th><th>Status</th><th>Escalation Reason</th><th>Date</th><th>Action</th></tr>
            ${ticketsRes.tickets.map((tk) => `<tr>
              <td>#${tk.id}</td>
              <td><div style="font-weight:700">${esc(tk.user_name)}</div><div class="muted">${esc(tk.user_phone)}</div></td>
              <td>${statusTag(tk.status)}</td>
              <td><span style="font-size:12px;color:var(--gold-bright)">${esc(tk.escalated_reason || 'General inquiry')}</span></td>
              <td class="muted" style="white-space:nowrap">${esc(tk.created_at)}</td>
              <td>
                <button class="btn sm btn-gold" data-open-ticket="${tk.id}">💬 Reply / Manage</button>
              </td>
            </tr>`).join('')}
          </table></div>`
        }

        <!-- Inline Ticket Thread Modal / Container -->
        <div id="agent-ticket-modal" style="display:none;margin-top:20px;background:var(--surface-card);border:1.5px solid var(--border-subtle);border-radius:var(--radius-lg);padding:18px">
          <div class="section-head">
            <h4 id="atm-title" style="margin:0"></h4>
            <button type="button" id="atm-close" class="btn sm btn-outline">✕ Close</button>
          </div>
          <div id="atm-stream" class="support-chat-stream" style="max-height:300px;margin-bottom:14px;border-radius:8px"></div>
          
          <form id="atm-reply-form">
            <textarea id="atm-reply-msg" rows="3" placeholder="Type reply to customer, or internal staff note..." required style="margin-bottom:10px"></textarea>
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
              <label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
                <input type="checkbox" id="atm-internal">
                <span>🔒 ${esc(t('internal_note'))}</span>
              </label>
              <div style="display:flex;gap:8px">
                <button type="button" id="atm-resolve-btn" class="btn sm alt">✓ Mark Resolved</button>
                <button type="submit" class="btn sm btn-gold">Send Reply</button>
              </div>
            </div>
          </form>
        </div>
      ` : ''}

      <!-- TAB 4: AGENT FLOAT & PERFORMANCE -->
      ${isFund ? `
        <div class="grid" style="grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:14px;margin-bottom:20px">
          <div class="stat">
            <div class="stat-label">Total Deposits Approved</div>
            <b style="color:var(--gold-bright)">${perfR.error ? '—' : (perf.approved_deposits_count ?? 0)}</b>
            <div class="muted">${perfR.error ? 'Unavailable' : `${fmt(perf.approved_deposits_volume ?? 0)} ${esc(t('currency_etb'))}`}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Total Withdrawals Handled</div>
            <b>${perfR.error ? '—' : (perf.approved_withdrawals_count ?? 0)}</b>
            <div class="muted">${perfR.error ? 'Unavailable' : `${fmt(perf.approved_withdrawals_volume ?? 0)} ${esc(t('currency_etb'))}`}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Tickets Resolved</div>
            <b style="color:var(--green)">${perfR.error ? '—' : (perf.tickets_resolved ?? 0)}</b>
            <div class="muted">Customer issues closed</div>
          </div>
        </div>

        <h3>${esc(t('funding_history'))}</h3>
        ${fundR.error ? errorPanel('Funding requests', fundR.error) : !fund.requests.length ? emptyState('⚡', t('no_data')) : `
          <div class="scroll"><table>
            <tr><th>${esc(t('date'))}</th><th>${esc(t('amount'))}</th><th>${esc(t('message'))}</th><th>${esc(t('status'))}</th><th>${esc(t('admin_note'))}</th></tr>
            ${fund.requests.map((r) => `<tr>
              <td class="muted" style="white-space:nowrap">${esc(r.created_at)}</td>
              <td style="font-weight:800;color:var(--gold-bright);font-size:15px">${fmt(r.amount)} ${esc(t('currency_etb'))}</td>
              <td>${esc(r.note || '-')}</td>
              <td>${statusTag(r.status)}</td>
              <td><span class="muted">${esc(r.admin_note || '-')}</span></td>
            </tr>`).join('')}
          </table></div>`
        }
      ` : ''}

      <!-- TAB 5: SUPER ADMIN ANNOUNCEMENTS -->
      ${isAnn ? `
        <div class="section-head">
          <h3>📢 Super Admin Instructions & Announcements</h3>
        </div>
        ${annR.error ? errorPanel('Announcements', annR.error) : !annRes.announcements.length ? emptyState('📢', 'No announcements posted yet.') : `
          ${annRes.announcements.map((a) => `
            <div class="announcement-box">
              <div class="announcement-box-title">📢 ${esc(a.title)}</div>
              <div class="announcement-box-content">${esc(a.content)}</div>
              <div class="muted" style="font-size:11px;margin-top:6px">Posted by Super Admin · ${esc(a.created_at)}</div>
            </div>
          `).join('')}
        `}
      ` : ''}
    </div>`;

  app.querySelectorAll('[data-agent-retry]').forEach((button) => {
    button.onclick = async () => {
      button.disabled = true;
      button.textContent = 'Loading…';
      await agentView(app);
    };
  });

  $('toggle-funding-btn').onclick = () => {
    const box = $('funding-request-box');
    box.style.display = box.style.display === 'none' ? 'block' : 'none';
    if (box.style.display === 'block') box.scrollIntoView({ behavior: 'smooth' });
  };
  $('close-funding-box').onclick = () => { $('funding-request-box').style.display = 'none'; };

  document.querySelectorAll('#af-form .quick-amt-chip').forEach((chip) => {
    chip.onclick = () => {
      document.querySelectorAll('#af-form .quick-amt-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      $('af-amt').value = chip.dataset.v;
    };
  });

  $('af-form').onsubmit = async (ev) => {
    ev.preventDefault();
    const btn = $('af-submit-btn');
    btn.disabled = true; btn.textContent = '...';
    try {
      await api('/agent/funding', Object.fromEntries(new FormData(ev.target)));
      success('Funding request submitted to Super Admin');
      agentSubtab = 'funding';
      render();
    } catch (e) {
      fail(e);
      btn.disabled = false;
      btn.textContent = t('funding_req_btn');
    }
  };

  $('as-dep').onclick = () => { agentSubtab = 'deposits'; render(); };
  $('as-with').onclick = () => { agentSubtab = 'withdrawals'; render(); };
  $('as-tickets').onclick = () => { agentSubtab = 'tickets'; render(); };
  $('as-fund').onclick = () => { agentSubtab = 'funding'; render(); };
  $('as-ann').onclick = () => { agentSubtab = 'announcements'; render(); };

  app.querySelectorAll('[data-open-deposit-review]').forEach((button) => {
    const deposit = dp.deposits.find((item) => String(item.id) === button.dataset.openDepositReview);
    if (deposit) button.onclick = () => openDepositReview(deposit, render);
  });

  // Agent approvals
  app.querySelectorAll('button[data-a]').forEach((b) => (b.onclick = async () => {
    let reason = '';
    if (b.dataset.a === 'reject') {
      reason = prompt(t('reject_reason')) || '';
      if (!reason.trim()) return;
    }
    const endpoint = b.dataset.kind === 'deposit'
      ? `/agent/deposits/${b.dataset.id}/decide`
      : `/agent/withdrawals/${b.dataset.id}/decide`;
    try {
      await api(endpoint, { action: b.dataset.a, reason });
      success(t('status_' + (b.dataset.a === 'approve' ? 'approved' : 'rejected')));
      render();
    } catch (e) { fail(e); }
  }));

  // Agent ticket reply & management
  let activeAgentTicketId = null;
  app.querySelectorAll('button[data-open-ticket]').forEach((b) => (b.onclick = async () => {
    activeAgentTicketId = Number(b.dataset.openTicket);
    try {
      const res = await api(`/support/ticket/${activeAgentTicketId}`);
      $('atm-title').textContent = `Ticket #${res.ticket.id} — ${res.ticket.user_name} (${res.ticket.user_phone})`;
      const stream = $('atm-stream');
      stream.innerHTML = res.messages.map((m) => `
        <div class="chat-msg ${m.is_internal ? 'internal' : m.sender_role}">
          <div class="chat-msg-sender">
            <span>${m.is_internal ? '🔒 Internal Note' : m.sender_role === 'ai' ? '🤖 Fetan AI' : m.sender_role === 'user' ? '🪙 Customer' : '👤 ' + esc(m.sender_name)}</span>
            <span class="muted" style="font-size:10px">${esc(m.created_at)}</span>
          </div>
          <div class="chat-bubble">${esc(m.message)}</div>
        </div>
      `).join('');
      $('agent-ticket-modal').style.display = 'block';
      $('agent-ticket-modal').scrollIntoView({ behavior: 'smooth' });
    } catch (e) { fail(e); }
  }));

  const closeAtm = $('atm-close');
  if (closeAtm) closeAtm.onclick = () => { $('agent-ticket-modal').style.display = 'none'; };

  const atmForm = $('atm-reply-form');
  if (atmForm) {
    atmForm.onsubmit = async (ev) => {
      ev.preventDefault();
      if (!activeAgentTicketId) return;
      const msg = $('atm-reply-msg').value.trim();
      const isInternal = $('atm-internal').checked;
      try {
        await api(`/support/ticket/${activeAgentTicketId}/reply`, { message: msg, is_internal: isInternal });
        success('Reply recorded');
        $('atm-reply-msg').value = '';
        agentView(app);
      } catch (e) { fail(e); }
    };
  }

  const resolveBtn = $('atm-resolve-btn');
  if (resolveBtn) {
    resolveBtn.onclick = async () => {
      if (!activeAgentTicketId) return;
      try {
        await api(`/support/ticket/${activeAgentTicketId}/status`, { status: 'resolved' });
        success('Ticket marked as resolved');
        agentView(app);
      } catch (e) { fail(e); }
    };
  }
}

// =====================================================
// ADMIN VIEW — Complete Financial Analytics, Central Ledger & Management
// =====================================================
let adminSection = 'analytics';
let adminAnalyticsRange = '7d';

async function adminView(app) {
  const [s, u, aud, fundReqs, depPending, withPending, analytics, txs, ticketsRes, aiConfig, annRes] = await Promise.all([
    api('/admin/stats'),
    api('/admin/users'),
    api('/admin/audit'),
    api('/admin/agent-funding').catch(() => ({ requests: [] })),
    api('/agent/deposits?status=pending').catch(() => ({ deposits: [] })),
    api('/agent/withdrawals?status=pending').catch(() => ({ withdrawals: [] })),
    api(`/admin/financial-analytics?range=${adminAnalyticsRange}`).catch(() => ({})),
    api('/admin/transactions').catch(() => ({ transactions: [] })),
    api('/admin/tickets').catch(() => ({ tickets: [] })),
    api('/admin/ai-settings').catch(() => ({ enabled: true })),
    api('/announcements').catch(() => ({ announcements: [] })),
  ]);

  const pendingFundingCount = fundReqs.requests.filter((r) => r.status === 'pending').length;

  app.innerHTML = `
    <div class="section-head">
      <div>
        <h2>⚙ ${esc(t('admin'))}</h2>
        <span class="brand-sub" style="color:var(--gold-bright)">SUPER ADMIN EXECUTIVE DESK</span>
      </div>
      <span class="tag rejected" style="font-size:12px;letter-spacing:1px;font-weight:800">SUPER ADMIN</span>
    </div>

    <!-- Executive KPI Grid -->
    <div class="admin-stats">
      <div class="admin-stat">
        <div class="value accent">${fmt(analytics.gross_gaming_revenue ?? 0)} <small style="font-size:14px;color:var(--text-muted)">ETB</small></div>
        <div class="label">${esc(t('ggr'))}</div>
        <div style="font-size:11px;color:var(--gold-bright);margin-top:2px">Margin: ${analytics.margin_percent ?? '0.0'}%</div>
      </div>
      <div class="admin-stat">
        <div class="value">${fmt(analytics.total_bets_amount ?? 0)} <small style="font-size:14px;color:var(--text-muted)">ETB</small></div>
        <div class="label">${esc(t('total_stakes'))} (${analytics.total_bets_count ?? 0})</div>
      </div>
      <div class="admin-stat">
        <div class="value">${fmt(analytics.total_wins_amount ?? 0)} <small style="font-size:14px;color:var(--text-muted)">ETB</small></div>
        <div class="label">${esc(t('total_payouts'))} (${analytics.total_wins_count ?? 0})</div>
      </div>
      <div class="admin-stat">
        <div class="value ${(analytics.pending_deposits_count || analytics.pending_withdrawals_count) ? 'accent' : ''}">${analytics.pending_deposits_count ?? depPending.deposits.length} in · ${analytics.pending_withdrawals_count ?? withPending.withdrawals.length} out</div>
        <div class="label">Pending · deposits ${fmt(analytics.pending_deposits_amount ?? 0)} ETB · withdrawals ${fmt(analytics.pending_withdrawals_amount ?? 0)} ETB</div>
      </div>
      <div class="admin-stat">
        <div class="value ${pendingFundingCount ? 'accent' : ''}">${pendingFundingCount}</div>
        <div class="label">${esc(t('stat_funding_pending'))}</div>
      </div>
      <div class="admin-stat">
        <div class="value">${s.users} customers · ${s.active_agents ?? s.agents} active agents</div>
        <div class="label">${s.suspended_agents ?? 0} suspended · registered agents ${s.agents}</div>
      </div>
    </div>

    <!-- Admin Subtabs Navigation -->
    <div class="card" style="padding:14px 20px 6px">
      <div class="subtabs" style="margin-bottom:0;border-bottom:none;overflow-x:auto">
        <button class="subtab ${adminSection === 'analytics' ? 'on' : ''}" id="adm-tab-analytics">📊 ${esc(t('financial_analytics'))}</button>
        <button class="subtab ${adminSection === 'deposits' ? 'on' : ''}" id="adm-tab-dep">⬇ ${esc(t('sec_customer_deposits'))}<span class="tag ${depPending.deposits.length ? 'pending' : 'approved'}">${depPending.deposits.length}</span></button>
        <button class="subtab ${adminSection === 'funding' ? 'on' : ''}" id="adm-tab-fund">⚡ ${esc(t('sec_agent_funding'))}<span class="tag ${pendingFundingCount ? 'pending' : 'approved'}">${pendingFundingCount}</span></button>
        <button class="subtab ${adminSection === 'transactions' ? 'on' : ''}" id="adm-tab-tx">📋 ${esc(t('sec_system_tx'))}</button>
        <button class="subtab ${adminSection === 'support' ? 'on' : ''}" id="adm-tab-supp">💬 ${esc(t('tickets'))} &amp; AI (${ticketsRes.tickets.length})</button>
        <button class="subtab ${adminSection === 'users' ? 'on' : ''}" id="adm-tab-users">👥 ${esc(t('users'))} &amp; Audit</button>
      </div>
    </div>

    <!-- SECTION 1: FINANCIAL ANALYTICS & INTERACTIVE REPORTS -->
    ${adminSection === 'analytics' ? `
      <div class="card">
        <div class="section-head">
          <h3>📊 Platform Financial Analytics</h3>
          <div class="filter-pills-bar" style="margin-bottom:0">
            <button class="filter-pill ${adminAnalyticsRange === 'today' ? 'active' : ''}" data-range="today">Today</button>
            <button class="filter-pill ${adminAnalyticsRange === '7d' ? 'active' : ''}" data-range="7d">Last 7 Days</button>
            <button class="filter-pill ${adminAnalyticsRange === '30d' ? 'active' : ''}" data-range="30d">Last 30 Days</button>
            <button class="filter-pill ${adminAnalyticsRange === 'month' ? 'active' : ''}" data-range="month">This Month</button>
            <button class="filter-pill ${adminAnalyticsRange === 'all' ? 'active' : ''}" data-range="all">All Time</button>
          </div>
        </div>

        <div class="analytics-kpi-grid">
          <div class="analytics-kpi-item">
            <div class="analytics-kpi-val" style="color:var(--gold-bright)">${fmt(analytics.gross_gaming_revenue ?? 0)} ETB</div>
            <div class="analytics-kpi-lbl">${esc(t('ggr'))}</div>
            <div class="analytics-kpi-formula">Formula: Total Stakes - Total Winning Payouts</div>
          </div>
          <div class="analytics-kpi-item">
            <div class="analytics-kpi-val" style="color:#A3E635">${fmt(analytics.total_deposits_amount ?? 0)} ETB</div>
            <div class="analytics-kpi-lbl">Approved Customer Deposits</div>
            <div class="analytics-kpi-formula">${analytics.total_deposits_count ?? 0} settled deposits</div>
          </div>
          <div class="analytics-kpi-item">
            <div class="analytics-kpi-val" style="color:#F87171">${fmt(analytics.total_withdrawals_amount ?? 0)} ETB</div>
            <div class="analytics-kpi-lbl">Withdrawal holds · virtual demo</div>
            <div class="analytics-kpi-formula">${analytics.total_withdrawals_count ?? 0} withdrawal requests; no payout confirmation is recorded</div>
          </div>
          <div class="analytics-kpi-item">
            <div class="analytics-kpi-val">${analytics.margin_percent ?? '0.0'}%</div>
            <div class="analytics-kpi-lbl">${esc(t('house_margin'))}</div>
            <div class="analytics-kpi-formula">GGR / Total Stakes</div>
          </div>
        </div>

        <!-- SVG Daily Trend Visual -->
        <div class="chart-box">
          <div class="chart-box-head">
            <h4 style="margin:0">📈 Daily Financial Activity Trend</h4>
            <div class="muted" style="font-size:12px">Stakes vs Winning Payouts</div>
          </div>
          <div style="overflow-x:auto">
            ${(analytics.daily_trends && analytics.daily_trends.length) ? `
              <div style="display:flex;align-items:flex-end;gap:12px;height:180px;padding:10px 0;border-bottom:1px solid var(--border)">
                ${analytics.daily_trends.map((d) => {
                  const maxH = Math.max(...analytics.daily_trends.map(x => Math.max(x.bets, x.wins)), 100);
                  const hBet = Math.max(10, Math.round((d.bets / maxH) * 150));
                  const hWin = Math.max(10, Math.round((d.wins / maxH) * 150));
                  return `
                    <div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1;min-width:44px">
                      <div style="display:flex;gap:4px;align-items:flex-end;height:150px">
                        <div style="width:14px;height:${hBet}px;background:var(--gold);border-radius:3px" title="Stakes: ${fmt(d.bets)}"></div>
                        <div style="width:14px;height:${hWin}px;background:#10B981;border-radius:3px" title="Payouts: ${fmt(d.wins)}"></div>
                      </div>
                      <span class="muted" style="font-size:10px;white-space:nowrap">${d.date.slice(5)}</span>
                    </div>
                  `;
                }).join('')}
              </div>
              <div style="display:flex;gap:16px;margin-top:10px;font-size:12px">
                <span style="display:inline-flex;align-items:center;gap:6px"><span style="width:10px;height:10px;background:var(--gold);border-radius:2px"></span> Stakes</span>
                <span style="display:inline-flex;align-items:center;gap:6px"><span style="width:10px;height:10px;background:#10B981;border-radius:2px"></span> Winning Payouts</span>
              </div>
            ` : emptyState('📈', 'Trend data will appear as games and transactions take place')}
          </div>
        </div>

        <!-- Game Breakdown Table -->
        <h4 style="margin:20px 0 10px">🎰 Game-by-Game Revenue Breakdown</h4>
        ${(analytics.game_distribution && analytics.game_distribution.length) ? `
          <div class="scroll"><table>
            <tr><th>Game</th><th>Rounds Played</th><th>Total Stakes</th><th>Payouts</th><th>GGR</th></tr>
            ${analytics.game_distribution.map((g) => `<tr>
              <td><b>${esc(g.game.toUpperCase())}</b></td>
              <td>${g.rounds}</td>
              <td style="font-weight:700">${fmt(g.stakes)} ETB</td>
              <td style="color:#A3E635">${fmt(g.payouts)} ETB</td>
              <td style="font-weight:800;color:var(--gold-bright)">${fmt(g.ggr)} ETB</td>
            </tr>`).join('')}
          </table></div>` : emptyState('🎰', 'No game round data recorded for this date range')
        }

        <!-- Agent Performance Comparison Table -->
        <h4 style="margin:24px 0 10px">👤 Agent Operations & Performance Comparison</h4>
        ${(analytics.agents && analytics.agents.length) ? `
          <div class="scroll"><table>
            <tr><th>Agent Name</th><th>Phone</th><th>Status</th><th>Float Balance</th><th>Deposits Verified</th><th>Withdrawals Verified</th><th>Resolved Tickets</th></tr>
            ${analytics.agents.map((ag) => `<tr>
              <td><b>${esc(ag.name)}</b></td>
              <td>${esc(ag.phone)}</td>
              <td>${statusTag(ag.status)}</td>
              <td style="font-weight:800;color:var(--gold-bright)">🪙 ${fmt(ag.balance)}</td>
              <td><b>${ag.deposits_verified}</b> (${fmt(ag.deposits_volume)} ETB)</td>
              <td><b>${ag.withdrawals_verified}</b></td>
              <td><span style="color:var(--green);font-weight:700">${ag.tickets_resolved}</span></td>
            </tr>`).join('')}
          </table></div>` : emptyState('👤', 'No registered agents')
        }
      </div>
    ` : ''}

    <!-- SECTION 2: CUSTOMER DEPOSITS APPROVAL -->
    ${adminSection === 'deposits' ? `
      <div class="card">
        <h3>${esc(t('sec_customer_deposits'))}</h3>
        ${!depPending.deposits.length ? emptyState('✅', 'No pending customer deposit requests') : `
        <div class="scroll"><table>
          <tr><th>${esc(t('name'))}</th><th>${esc(t('method'))}</th><th>${esc(t('amount'))}</th><th>${esc(t('tx_ref'))}</th><th>Receipt</th><th></th></tr>
          ${depPending.deposits.map((d) => `<tr>
            <td><div style="font-weight:600">${esc(d.user_name)}</div><div class="muted">${esc(d.phone)}</div></td>
            <td><b>${esc(d.provider)}</b></td>
            <td style="font-weight:800;color:var(--gold-bright);font-size:16px">${fmt(d.amount)} ${esc(t('currency_etb'))}</td>
            <td><span style="font-size:12px;font-family:monospace;background:var(--surface-hover);padding:3px 8px;border-radius:4px">${esc(d.tx_ref)}</span></td>
              <td>${d.has_receipt ? 'Attached' : 'None'}</td>
            <td style="white-space:nowrap">
                <button class="btn sm btn-gold" data-open-admin-deposit-review="${d.id}">Review request</button>
            </td>
          </tr>`).join('')}
        </table></div>`}
      </div>
    ` : ''}

    <!-- SECTION 3: AGENT FUNDING REQUESTS -->
    ${adminSection === 'funding' ? `
      <div class="card">
        <h3>${esc(t('sec_agent_funding'))}</h3>
        ${!fundReqs.requests.length ? emptyState('⚡', t('no_data')) : `
        <div class="scroll"><table>
          <tr><th>${esc(t('actor'))}</th><th>${esc(t('amount'))}</th><th>${esc(t('message'))}</th><th>${esc(t('status'))}</th><th>${esc(t('admin_note'))}</th><th></th></tr>
          ${fundReqs.requests.map((r) => `<tr>
            <td>
              <div style="font-weight:700">${esc(r.agent_name)}</div>
              <div class="muted">${esc(r.agent_phone)}</div>
            </td>
            <td style="font-weight:800;color:var(--gold-bright);font-size:16px">${fmt(r.amount)} ${esc(t('currency_etb'))}</td>
            <td>${esc(r.note || '-')}</td>
            <td>${statusTag(r.status)}</td>
            <td><span class="muted">${esc(r.admin_note || '-')}</span></td>
            <td style="white-space:nowrap">
              ${r.status === 'pending' ? `
                <button class="btn sm alt" data-fund-action="approve" data-id="${r.id}">✓ ${esc(t('approve'))}</button>
                <button class="btn sm bad" data-fund-action="reject" data-id="${r.id}">✕ ${esc(t('reject'))}</button>
              ` : `<span class="muted" style="font-size:11px">Decided</span>`}
            </td>
          </tr>`).join('')}
        </table></div>`}
      </div>
    ` : ''}

    <!-- SECTION 4: SYSTEM TRANSACTIONS / CENTRAL LEDGER -->
    ${adminSection === 'transactions' ? `
      <div class="card">
        <div class="section-head" style="flex-wrap:wrap;gap:12px">
          <div>
            <h3>${esc(t('sec_system_tx'))}</h3>
            <span class="muted" style="font-size:12px">${txs.transactions.length} records retrieved</span>
          </div>
          <div style="display:flex;gap:10px;align-items:center">
            <input id="tx-search-input" placeholder="Search customer or phone..." style="padding:6px 14px;font-size:13px;width:220px">
            <button id="download-csv-btn" class="btn sm btn-outline">📥 ${esc(t('export_csv'))}</button>
          </div>
        </div>
        ${!txs.transactions.length ? emptyState('📋', t('no_data')) : `
        <div class="scroll"><table>
          <tr><th>${esc(t('date'))}</th><th>${esc(t('name'))}</th><th>${esc(t('type'))}</th><th>${esc(t('amount'))}</th><th>${esc(t('balance'))}</th></tr>
          ${txs.transactions.map((x) => `<tr>
            <td class="muted" style="white-space:nowrap">${esc(x.created_at)}</td>
            <td><div style="font-weight:600">${esc(x.user_name)}</div><div class="muted">${esc(x.phone)}</div></td>
            <td><span style="font-weight:600">${esc(t('t_' + x.type) !== 't_' + x.type ? t('t_' + x.type) : x.type)}</span></td>
            <td class="${x.amount >= 0 ? 'plus' : 'minus'}" style="font-weight:700;font-family:var(--font-heading);font-size:16px">${rel(x.amount)}</td>
            <td style="font-weight:600">${fmt(x.balance_after)}</td>
          </tr>`).join('')}
        </table></div>`}
      </div>
    ` : ''}

    <!-- SECTION 5: SUPPORT, AI SETTINGS & ANNOUNCEMENTS -->
    ${adminSection === 'support' ? `
      <div class="card">
        <div class="section-head">
          <div>
            <h3>🤖 AI Customer Support Configuration</h3>
            <p class="secondary" style="margin:0;font-size:13px">Enable or disable automated AI responses for customer queries</p>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <label style="display:inline-flex;align-items:center;gap:8px;font-weight:700;cursor:pointer">
              <input type="checkbox" id="ai-toggle-chk" ${aiConfig.enabled ? 'checked' : ''}>
              <span>${aiConfig.enabled ? 'AI Support Active' : 'AI Support Disabled'}</span>
            </label>
          </div>
        </div>
        <div style="display:flex;gap:16px;margin-top:10px;font-size:13px">
          <div>Messages Handled by AI: <b>${aiConfig.total_ai_messages ?? 0}</b></div>
          <div>Escalated to Human Agents: <b>${aiConfig.escalated_tickets ?? 0}</b></div>
        </div>
      </div>

      <div class="card">
        <div class="section-head">
          <h3>📢 Broadcast Announcement to Agents</h3>
        </div>
        <form id="ann-form">
          <label for="ann-title">Announcement Title</label>
          <input id="ann-title" name="title" placeholder="e.g. Weekend Cash Handling Guidelines" required>
          <label for="ann-content" style="margin-top:10px">Message Content</label>
          <textarea id="ann-content" name="content" rows="3" placeholder="Write message to agents..." required></textarea>
          <button type="submit" class="btn btn-gold" style="margin-top:12px;width:auto">📢 Broadcast to Agents</button>
        </form>
      </div>

      <div class="card">
        <h3>💬 Customer Support Tickets Desk</h3>
        ${!ticketsRes.tickets.length ? emptyState('💬', t('no_data')) : `
        <div class="scroll"><table>
          <tr><th>Ticket ID</th><th>${esc(t('name'))}</th><th>Status</th><th>Escalated Reason</th><th>${esc(t('date'))}</th></tr>
          ${ticketsRes.tickets.map((x) => `<tr>
            <td>#${x.id}</td>
            <td><div style="font-weight:600">${esc(x.user_name || x.name)}</div><div class="muted">${esc(x.user_phone || x.phone)}</div></td>
            <td>${statusTag(x.status)}</td>
            <td><span style="font-size:12px;color:var(--gold-bright)">${esc(x.escalated_reason || 'Direct question')}</span></td>
            <td class="muted" style="white-space:nowrap">${esc(x.created_at)}</td>
          </tr>`).join('')}
        </table></div>`}
      </div>
    ` : ''}

    <!-- SECTION 6: USER MANAGEMENT & AUDIT LOGS -->
    ${adminSection === 'users' ? `
      <div class="card">
        <h3>${esc(t('users'))}</h3>
        <div class="scroll"><table>
          <tr><th>${esc(t('name'))}</th><th>${esc(t('role'))}</th><th>${esc(t('status'))}</th><th>${esc(t('balance'))}</th><th></th></tr>
          ${u.users.map((x) => `<tr>
            <td>
              <div style="font-weight:600">${esc(x.name)}</div>
              <div class="muted">${esc(x.phone)}</div>
            </td>
            <td><span class="tag ${x.role === 'admin' ? 'rejected' : x.role === 'agent' ? 'pending' : 'approved'}">${esc(x.role)}</span></td>
            <td>${statusTag(x.status)}</td>
            <td style="font-weight:700">${fmt(x.balance)} ${esc(t('currency_etb'))}</td>
            <td style="white-space:nowrap">
              ${x.id === me.id ? '<span class="muted">(you)</span>' : `
                ${x.role === 'user' ? `<button class="btn sm btn-outline" data-u="${x.id}" data-role="agent">${esc(t('make_agent'))}</button>` : ''}
                ${x.role === 'agent' ? `<button class="btn sm btn-outline" data-u="${x.id}" data-role="user">${esc(t('make_user'))}</button>` : ''}
                ${x.status === 'active'
                  ? `<button class="btn sm bad" data-u="${x.id}" data-status="suspended">${esc(t('suspend'))}</button>`
                  : `<button class="btn sm alt" data-u="${x.id}" data-status="active">${esc(t('activate'))}</button>`}
              `}
            </td>
          </tr>`).join('')}
        </table></div>
      </div>

      <div class="card">
        <div class="section-head">
          <h3>${esc(t('audit'))}</h3>
          <input id="audit-search" placeholder="Search audit logs..." style="padding:6px 14px;font-size:12px;width:180px">
        </div>
        <div class="scroll"><table>
          <tr><th>${esc(t('date'))}</th><th>${esc(t('actor'))}</th><th>${esc(t('action'))}</th></tr>
          ${aud.logs.slice(0, 40).map((x) => `<tr>
            <td class="muted" style="white-space:nowrap">${esc(x.created_at)}</td>
            <td>${esc(x.actor_name || 'System')}</td>
            <td><span style="font-family:monospace;font-size:12px">${esc(x.action)}</span></td>
          </tr>`).join('')}
        </table></div>
      </div>
    ` : ''}
    </div>
  `;

  // Subtab switching
  $('adm-tab-analytics').onclick = () => { adminSection = 'analytics'; render(); };
  $('adm-tab-dep').onclick = () => { adminSection = 'deposits'; render(); };
  $('adm-tab-fund').onclick = () => { adminSection = 'funding'; render(); };
  $('adm-tab-tx').onclick = () => { adminSection = 'transactions'; render(); };
  $('adm-tab-supp').onclick = () => { adminSection = 'support'; render(); };
  $('adm-tab-users').onclick = () => { adminSection = 'users'; render(); };

  app.querySelectorAll('[data-open-admin-deposit-review]').forEach((button) => {
    const deposit = depPending.deposits.find((item) => String(item.id) === button.dataset.openAdminDepositReview);
    if (deposit) button.onclick = () => openDepositReview(deposit, render);
  });

  // Date range filter
  document.querySelectorAll('.filter-pill[data-range]').forEach((pill) => {
    pill.onclick = () => {
      adminAnalyticsRange = pill.dataset.range;
      adminView(app);
    };
  });

  // AI Toggle listener
  const aiChk = $('ai-toggle-chk');
  if (aiChk) {
    aiChk.onchange = async () => {
      try {
        await api('/admin/ai-settings', { enabled: aiChk.checked });
        success('AI Support ' + (aiChk.checked ? 'enabled' : 'disabled'));
        adminView(app);
      } catch (e) { fail(e); }
    };
  }

  // Announcement form
  const annForm = $('ann-form');
  if (annForm) {
    annForm.onsubmit = async (ev) => {
      ev.preventDefault();
      try {
        await api('/admin/announcements', {
          title: $('ann-title').value,
          content: $('ann-content').value,
          target_role: 'agent'
        });
        success('Announcement broadcasted to agents');
        $('ann-form').reset();
        adminView(app);
      } catch (e) { fail(e); }
    };
  }

  // Transaction search & CSV download
  const txSearch = $('tx-search-input');
  if (txSearch) {
    txSearch.onkeyup = (e) => {
      if (e.key === 'Enter') {
        api(`/admin/transactions?search=${encodeURIComponent(txSearch.value)}`).then((res) => {
          txs.transactions = res.transactions;
          adminView(app);
        });
      }
    };
  }

  const csvBtn = $('download-csv-btn');
  if (csvBtn) {
    csvBtn.onclick = () => {
      const rows = [
        ['ID', 'Date', 'User', 'Phone', 'Type', 'Amount', 'Balance After'],
        ...txs.transactions.map((t) => [t.id, t.created_at, `"${t.user_name}"`, t.phone, t.type, t.amount / 100, t.balance_after / 100])
      ];
      const csvContent = 'data:text/csv;charset=utf-8,' + rows.map(e => e.join(',')).join('\n');
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', 'fetan_bet_transactions.csv');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    };
  }

  // Admin customer deposit approvals
  app.querySelectorAll('button[data-adm-dep]').forEach((b) => (b.onclick = async () => {
    let reason = '';
    if (b.dataset.admDep === 'reject') {
      reason = prompt(t('reject_reason')) || '';
      if (!reason.trim()) return;
    }
    try {
      await api(`/agent/deposits/${b.dataset.id}/decide`, { action: b.dataset.admDep, reason });
      success(t('status_' + (b.dataset.admDep === 'approve' ? 'approved' : 'rejected')));
      render();
    } catch (e) { fail(e); }
  }));

  // Admin agent funding decisions
  app.querySelectorAll('button[data-fund-action]').forEach((b) => (b.onclick = async () => {
    const action = b.dataset.fundAction;
    let note = '';
    if (action === 'approve') {
      note = prompt('Admin note for agent (optional):') || 'Approved';
    } else {
      note = prompt('Rejection reason:') || '';
      if (!note.trim()) return;
    }
    try {
      await api(`/admin/agent-funding/${b.dataset.id}/decide`, { action, note });
      success('Agent funding request ' + (action === 'approve' ? 'approved and credited' : 'rejected'));
      render();
    } catch (e) { fail(e); }
  }));

  // User management listeners
  app.querySelectorAll('button[data-u]').forEach((b) => (b.onclick = async () => {
    const body = {};
    if (b.dataset.role) body.role = b.dataset.role;
    if (b.dataset.status) body.status = b.dataset.status;
    try { await api(`/admin/users/${b.dataset.u}`, body); render(); } catch (e) { fail(e); }
  }));
}

// A direct game link still gets an in-app lobby entry for Back navigation.
const initialGameRoute = /^#\/game\/(road|road-dash|mines|plinko|keno|bingo|roulette|star)$/.test(location.hash);
if (initialGameRoute) {
  const deepLink = location.hash;
  history.replaceState({ fetanPage: 'lobby' }, '', `${location.pathname}${location.search}#/lobby`);
  history.pushState({ fetanPage: 'game' }, '', `${location.pathname}${location.search}${deepLink}`);
}

// Initial boot
(async () => {
  await loadLang(lang);
  render();
})();
