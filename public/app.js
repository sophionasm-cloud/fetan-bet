// ፍጣን ቤት front-end — Stake-inspired professional UI, no build step.
'use strict';
let T = {}, lang = localStorage.getItem('lang') || 'am', me = null, balance = 0,
    limits = { min: 100, max: 100000 }, tab = 'games', agentSubtab = 'deposits';

const $ = (id) => document.getElementById(id);
const t = (k) => T[k] ?? k;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const rel = (cents) => (cents >= 0 ? '+' : '') + fmt(cents);
const initials = (name) => String(name || '?').trim().charAt(0).toUpperCase();

// ---------- API ----------
async function api(path, body) {
  const opt = body === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
  const r = await fetch('/api' + path, opt);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (data.error === 'LOGIN' && me) { me = null; render(); }
    throw new Error(data.error || 'GENERIC');
  }
  return data;
}

// ---------- Toast ----------
function toast(msg, type = '') {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast' + (type ? ' ' + type : '');
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), 3500);
}
const fail = (e) => {
  const key = 'err_' + e.message;
  toast(t(key) !== key ? t(key) : t('err_GENERIC'), 'err');
};
const success = (msg) => toast(msg, 'ok');
const statusTag = (s) => `<span class="tag ${s}">${esc(t('status_' + s))}</span>`;

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
  document.title = 'ፍጣን ቤት | Fetan Bet';
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
  }
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
$('brandBtn').onclick = () => { tab = 'games'; render(); };
$('headerLoginBtn').onclick = () => { tab = 'auth'; render('login'); };
$('headerRegBtn').onclick = () => { tab = 'auth'; render('register'); };

// ---------- NAV ----------
function nav() {
  const tabs = [
    ['games', '🎰', 'games'],
    ['wallet', '💳', 'wallet'],
    ['deposit', '⬇', 'deposit'],
    ['withdraw', '⬆', 'withdraw'],
    ['history', '📋', 'history'],
    ['support', '💬', 'support'],
  ];
  if (me.role === 'agent' || me.role === 'admin') tabs.push(['agent', '🔑', 'agent']);
  if (me.role === 'admin') tabs.push(['admin', '⚙', 'admin']);
  const n = $('nav');
  n.hidden = false;
  n.innerHTML = tabs.map(([k, icon, label]) =>
    `<button data-k="${k}" class="${tab === k ? 'on' : ''}">${icon} ${esc(t(label))}</button>`
  ).join('');
  n.querySelectorAll('button').forEach((b) => (b.onclick = () => { tab = b.dataset.k; render(); }));
}

async function render(subMode = '') {
  await refreshMe();
  const app = $('app');
  if (!me) {
    $('nav').hidden = true;
    return authView(app, subMode || 'login');
  }
  nav();
  const views = {
    games: gamesView,
    wallet: walletView,
    deposit: depositView,
    withdraw: withdrawView,
    history: historyView,
    support: supportView,
    agent: agentView,
    admin: adminView,
  };
  try {
    const fn = views[tab] || gamesView;
    await fn(app);
  } catch (e) { fail(e); }
}

// =====================================================
// AUTH VIEW — Stake-style Login & Registration
// =====================================================
function authView(app, initialMode = 'login') {
  app.innerHTML = `
    <div class="auth-wrapper">
      <div class="auth-split-card">
        <!-- Left Brand Showcase Side -->
        <div class="auth-showcase">
          <div>
            <div class="auth-brand-head">
              <div class="auth-brand-logo">ፍ</div>
              <div>
                <div class="auth-brand-title">${esc(t('brand'))}</div>
                <span class="auth-brand-sub">Fetan Bet · Casino</span>
              </div>
            </div>
            <div class="auth-brand-tagline">${esc(t('tagline'))}</div>
            <ul class="auth-features">
              <li class="auth-feat-item">
                <span class="auth-feat-icon">🎰</span>
                <span>${lang === 'am' ? '5 የካሲኖ ጨዋታዎች (ሮድ ዳሽ፣ ማይንስ፣ ፕሊንኮ፣ ሩሌት፣ ስፒን)' : '5 Casino Games (Road Dash, Mines, Plinko, Roulette, Slots)'}</span>
              </li>
              <li class="auth-feat-item">
                <span class="auth-feat-icon">🪙</span>
                <span>${lang === 'am' ? '1,000 ነፃ የሙከራ ክሬዲት ሲመዘገቡ' : '1,000 Free Welcome Demo Credits'}</span>
              </li>
              <li class="auth-feat-item">
                <span class="auth-feat-icon">⚡</span>
                <span>${lang === 'am' ? 'ፈጣን የወኪል ገንዘብ ማስገቢያ እና ማውጫ' : 'Fast Agent Deposits & Withdrawals'}</span>
              </li>
              <li class="auth-feat-item">
                <span class="auth-feat-icon">🇪🇹</span>
                <span>${lang === 'am' ? 'በአማርኛ እና በእንግሊዝኛ ሙሉ ድጋፍ' : 'Amharic & English Multilingual Support'}</span>
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
          <div class="auth-tabs">
            <button class="auth-tab-btn ${initialMode === 'login' ? 'active' : ''}" id="atb-login">${esc(t('login'))}</button>
            <button class="auth-tab-btn ${initialMode === 'register' ? 'active' : ''}" id="atb-register">${esc(t('register'))}</button>
          </div>

          <!-- Quick 1-Click Demo Testing Bar -->
          <div class="auth-demo-banner">
            <div class="auth-demo-banner-head">⚡ ${esc(t('admin_demo_hint'))}</div>
            <div class="auth-demo-buttons">
              <button type="button" id="fill-admin" class="auth-demo-btn">🔑 Super Admin</button>
              <button type="button" id="fill-agent" class="auth-demo-btn">👤 Demo Agent</button>
            </div>
          </div>

          <!-- LOGIN FORM -->
          <div id="auth-login" ${initialMode === 'login' ? '' : 'hidden'}>
            <form id="lf" autocomplete="on">
              <label for="l-phone">${esc(t('phone'))}</label>
              <input id="l-phone" name="phone" placeholder="${esc(t('phone_hint'))}" autocomplete="username" required>
              <label for="l-pass" style="margin-top:10px">${esc(t('password'))}</label>
              <input id="l-pass" name="password" type="password" autocomplete="current-password" required>
              <button type="submit" class="btn btn-gold" style="margin-top:20px">${esc(t('login'))}</button>
            </form>
            <p style="text-align:center;margin-top:16px;font-size:13px;color:var(--text-muted)">
              ${esc(t('no_account'))} <a href="#" id="switch-to-reg" style="color:var(--gold-dark);font-weight:700">${esc(t('register'))}</a>
            </p>
          </div>

          <!-- REGISTER FORM -->
          <div id="auth-register" ${initialMode === 'register' ? '' : 'hidden'}>
            <form id="rf" autocomplete="on">
              <label for="r-name">${esc(t('name'))}</label>
              <input id="r-name" name="name" autocomplete="name" minlength="2" maxlength="60" required>
              <label for="r-phone" style="margin-top:10px">${esc(t('phone'))}</label>
              <input id="r-phone" name="phone" inputmode="tel" placeholder="${esc(t('phone_hint'))}" autocomplete="tel" required>
              <label for="r-pass" style="margin-top:10px">${esc(t('password'))}</label>
              <input id="r-pass" name="password" type="password" minlength="6" autocomplete="new-password" placeholder="${esc(t('pass_hint'))}" required>
              <button type="submit" class="btn btn-gold" style="margin-top:20px">${esc(t('register'))}</button>
            </form>
            <p style="text-align:center;margin-top:16px;font-size:13px;color:var(--text-muted)">
              ${esc(t('have_account'))} <a href="#" id="switch-to-login" style="color:var(--gold-dark);font-weight:700">${esc(t('login'))}</a>
            </p>
          </div>
        </div>
      </div>
    </div>`;

  // Quick fill listeners
  $('fill-admin').onclick = () => {
    $('l-phone').value = '0900000000';
    $('l-pass').value = 'admin123';
    showLogin();
  };
  $('fill-agent').onclick = () => {
    $('l-phone').value = '0911111111';
    $('l-pass').value = 'agent123';
    showLogin();
  };

  // Tab switching
  function showLogin() {
    $('auth-login').hidden = false; $('auth-register').hidden = true;
    $('atb-login').classList.add('active'); $('atb-register').classList.remove('active');
  }
  function showRegister() {
    $('auth-login').hidden = true; $('auth-register').hidden = false;
    $('atb-login').classList.remove('active'); $('atb-register').classList.add('active');
  }
  $('atb-login').onclick = showLogin;
  $('atb-register').onclick = showRegister;
  $('switch-to-reg').onclick = (e) => { e.preventDefault(); showRegister(); };
  $('switch-to-login').onclick = (e) => { e.preventDefault(); showLogin(); };

  // Form submissions
  $('lf').onsubmit = async (ev) => {
    ev.preventDefault();
    const btn = ev.target.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = '...';
    try {
      await api('/login', Object.fromEntries(new FormData(ev.target)));
      tab = 'games'; // Customer sees games immediately upon login!
      render();
    } catch (e) { fail(e); btn.disabled = false; btn.textContent = t('login'); }
  };
  $('rf').onsubmit = async (ev) => {
    ev.preventDefault();
    const btn = ev.target.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = '...';
    try {
      await api('/register', { ...Object.fromEntries(new FormData(ev.target)), lang });
      tab = 'games'; // Customer sees games immediately upon register!
      render();
    } catch (e) { fail(e); btn.disabled = false; btn.textContent = t('register'); }
  };
}

// =====================================================
// GAMES VIEW (Primary Landing Page)
// =====================================================
async function gamesView(app) {
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
  const recentTx = tx.transactions.slice(0, 5);

  app.innerHTML = `
    <div class="notice">${esc(t('demo_notice'))}</div>

    <div class="card">
      <div class="profile-row">
        <div class="avatar">${initials(me.name)}</div>
        <div>
          <div class="profile-name">${esc(me.name)}</div>
          <div class="profile-phone">${esc(me.phone)} · <span class="tag ${me.role === 'admin' ? 'rejected' : me.role === 'agent' ? 'pending' : 'approved'}">${esc(me.role)}</span></div>
        </div>
      </div>
      <div class="grid">
        <div class="stat">
          <div class="stat-label">${esc(t('balance'))}</div>
          <b>${fmt(balance)}</b>
          <div class="muted">${esc(t('credits'))}</div>
        </div>
        <div class="stat">
          <div class="stat-label">${esc(t('status_pending'))}</div>
          <b>${pendingDep + pendingWith}</b>
          <div class="muted">${pendingDep} in · ${pendingWith} out</div>
        </div>
      </div>
      <div style="display:flex;gap:10px;margin-top:14px">
        <button id="go-dep" class="btn btn-gold" style="margin-top:0">⬇ ${esc(t('deposit'))}</button>
        <button id="go-with" class="btn btn-outline" style="margin-top:0">⬆ ${esc(t('withdraw'))}</button>
      </div>
    </div>

    <div class="card">
      <div class="section-head">
        <h2>${esc(t('history'))}</h2>
        <a href="#" id="see-all-tx" style="font-size:13px;font-weight:700;color:var(--gold-dark)">${esc(t('see_all'))} →</a>
      </div>
      ${!recentTx.length ? emptyState('📋', t('no_data')) : `
      <div class="scroll"><table>
        <tr><th>${esc(t('date'))}</th><th>${esc(t('type'))}</th><th>${esc(t('amount'))}</th><th>${esc(t('balance'))}</th></tr>
        ${recentTx.map((x) => `<tr>
          <td class="muted" style="white-space:nowrap">${esc(x.created_at)}</td>
          <td>${esc(t('t_' + x.type))}</td>
          <td class="${x.amount >= 0 ? 'plus' : 'minus'}">${rel(x.amount)}</td>
          <td style="font-weight:600">${fmt(x.balance_after)}</td>
        </tr>`).join('')}
      </table></div>`}
    </div>`;

  $('go-dep').onclick = () => { tab = 'deposit'; render(); };
  $('go-with').onclick = () => { tab = 'withdraw'; render(); };
  const seeAll = $('see-all-tx');
  if (seeAll) seeAll.onclick = (e) => { e.preventDefault(); tab = 'history'; render(); };
}

// =====================================================
// DEPOSIT VIEW
// =====================================================
async function depositView(app) {
  const [{ providers }, { deposits }] = await Promise.all([api('/providers'), api('/deposits')]);

  app.innerHTML = `
    <div class="card">
      <h2>⬇ ${esc(t('deposit'))}</h2>
      <form id="df">
        <label for="prov">${esc(t('method'))}</label>
        <select id="prov" name="provider_id">
          ${providers.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
        </select>
        <div id="ins" class="notice" style="margin-top:12px;font-size:13px"></div>
        <label for="amt">${esc(t('amount'))} (${esc(t('credits'))})</label>
        <input id="amt" name="amount" type="number" min="1" max="10000" step="1" value="50" required>
        <label for="tx">${esc(t('tx_ref'))}</label>
        <input id="tx" name="tx_ref" placeholder="e.g. DEMO123" required style="font-family:monospace;letter-spacing:1px;text-transform:uppercase">
        <button class="btn btn-gold">${esc(t('submit'))}</button>
      </form>
    </div>

    <div class="card">
      <h3>${esc(t('my_deposits'))}</h3>
      ${!deposits.length ? emptyState('⬆', t('no_data')) : `
      <div class="scroll"><table>
        <tr><th>${esc(t('date'))}</th><th>${esc(t('method'))}</th><th>${esc(t('amount'))}</th><th>${esc(t('tx_ref'))}</th><th>${esc(t('status'))}</th></tr>
        ${deposits.map((d) => `<tr>
          <td class="muted" style="white-space:nowrap">${esc(d.created_at)}</td>
          <td>${esc(d.provider)}</td>
          <td style="font-weight:700">${fmt(d.amount)}</td>
          <td><span style="font-size:12px;font-family:monospace">${esc(d.tx_ref)}</span></td>
          <td>${statusTag(d.status)}${d.reason ? `<div class="muted" style="margin-top:3px">${esc(d.reason)}</div>` : ''}</td>
        </tr>`).join('')}
      </table></div>`}
    </div>`;

  const show = () => {
    const p = providers.find((p) => String(p.id) === $('prov').value);
    $('ins').textContent = p ? (lang === 'am' ? p.instr_am : p.instr_en) : '';
  };
  $('prov').onchange = show; show();
  $('df').onsubmit = async (ev) => {
    ev.preventDefault();
    const btn = ev.target.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = '...';
    try {
      await api('/deposits', Object.fromEntries(new FormData(ev.target)));
      success(t('deposit_created')); tab = 'wallet'; render();
    } catch (e) { fail(e); btn.disabled = false; btn.textContent = t('submit'); }
  };
}

// =====================================================
// WITHDRAW VIEW
// =====================================================
async function withdrawView(app) {
  const [{ providers }, { withdrawals }] = await Promise.all([
    api('/providers'),
    api('/withdrawals').catch(() => ({ withdrawals: [] }))
  ]);

  app.innerHTML = `
    <div class="card">
      <h2>⬆ ${esc(t('withdraw'))}</h2>
      <div class="notice" style="margin-bottom:14px">
        ${esc(t('balance'))}: <b>${fmt(balance)} ${esc(t('credits'))}</b>
      </div>
      <form id="wf">
        <label for="wprov">${esc(t('method'))}</label>
        <select id="wprov" name="provider_id">
          ${providers.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
        </select>
        <label for="wamt">${esc(t('amount'))} (${esc(t('credits'))})</label>
        <input id="wamt" name="amount" type="number" min="1" max="${balance / 100}" step="1" value="${Math.min(50, Math.floor(balance / 100))}" required>
        <label for="wacc">${esc(t('account_number'))}</label>
        <input id="wacc" name="account_number" placeholder="0911223344 or account number" required>
        <button class="btn btn-gold" ${balance <= 0 ? 'disabled' : ''}>${esc(t('submit'))}</button>
      </form>
    </div>

    <div class="card">
      <h3>${esc(t('my_withdrawals'))}</h3>
      ${!withdrawals.length ? emptyState('⬇', t('no_data')) : `
      <div class="scroll"><table>
        <tr><th>${esc(t('date'))}</th><th>${esc(t('method'))}</th><th>${esc(t('amount'))}</th><th>${esc(t('account_number'))}</th><th>${esc(t('status'))}</th></tr>
        ${withdrawals.map((w) => `<tr>
          <td class="muted" style="white-space:nowrap">${esc(w.created_at)}</td>
          <td>${esc(w.provider)}</td>
          <td style="font-weight:700">${fmt(w.amount)}</td>
          <td><span style="font-size:12px;font-family:monospace">${esc(w.account_number)}</span></td>
          <td>${statusTag(w.status)}${w.reason ? `<div class="muted" style="margin-top:3px">${esc(w.reason)}</div>` : ''}</td>
        </tr>`).join('')}
      </table></div>`}
    </div>`;

  $('wf').onsubmit = async (ev) => {
    ev.preventDefault();
    const btn = ev.target.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = '...';
    try {
      await api('/withdrawals', Object.fromEntries(new FormData(ev.target)));
      success(t('withdraw_created')); tab = 'wallet'; render();
    } catch (e) { fail(e); btn.disabled = false; btn.textContent = t('submit'); }
  };
}

// =====================================================
// HISTORY VIEW
// =====================================================
async function historyView(app) {
  const { transactions } = await api('/transactions');
  app.innerHTML = `
    <div class="card">
      <h2>${esc(t('history'))}</h2>
      ${!transactions.length ? emptyState('📋', t('no_data')) : `
      <div class="scroll"><table>
        <tr><th>${esc(t('date'))}</th><th>${esc(t('type'))}</th><th>${esc(t('amount'))}</th><th>${esc(t('balance'))}</th></tr>
        ${transactions.map((x) => `<tr>
          <td class="muted" style="white-space:nowrap">${esc(x.created_at)}</td>
          <td>${esc(t('t_' + x.type))}</td>
          <td class="${x.amount >= 0 ? 'plus' : 'minus'}">${rel(x.amount)}</td>
          <td style="font-weight:600">${fmt(x.balance_after)}</td>
        </tr>`).join('')}
      </table></div>`}
    </div>`;
}

// =====================================================
// SUPPORT VIEW
// =====================================================
async function supportView(app) {
  app.innerHTML = `
    <div class="card" style="max-width:480px;margin:0 auto">
      <h2>${esc(t('support'))}</h2>
      <p class="secondary" style="margin-bottom:14px">${esc(t('support_desc'))}</p>
      <form id="sf">
        <textarea name="message" rows="5" maxlength="500" placeholder="${esc(t('ticket_ph'))}" required></textarea>
        <button class="btn btn-gold">${esc(t('send'))}</button>
      </form>
    </div>`;
  $('sf').onsubmit = async (ev) => {
    ev.preventDefault();
    const btn = ev.target.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = '...';
    try {
      await api('/support', { message: ev.target.message.value });
      ev.target.reset(); success(t('ticket_sent'));
      btn.disabled = false; btn.textContent = t('send');
    } catch (e) { fail(e); btn.disabled = false; btn.textContent = t('send'); }
  };
}

// =====================================================
// AGENT VIEW — Verify Deposits and Withdrawals
// =====================================================
async function agentView(app) {
  const [dp, da, dr, wp, wa, wr] = await Promise.all([
    api('/agent/deposits?status=pending'),
    api('/agent/deposits?status=approved'),
    api('/agent/deposits?status=rejected'),
    api('/agent/withdrawals?status=pending'),
    api('/agent/withdrawals?status=approved'),
    api('/agent/withdrawals?status=rejected'),
  ]);

  const isDep = agentSubtab === 'deposits';
  const pendingCount = isDep ? dp.deposits.length : wp.withdrawals.length;

  app.innerHTML = `
    <div class="card">
      <div class="section-head">
        <h2>🔑 ${esc(t('agent'))}</h2>
      </div>
      <div class="subtabs">
        <button class="subtab ${isDep ? 'on' : ''}" id="as-dep">
          ⬇ ${esc(t('deposit'))}
          <span class="tag ${dp.deposits.length ? 'pending' : 'approved'}">${dp.deposits.length}</span>
        </button>
        <button class="subtab ${!isDep ? 'on' : ''}" id="as-with">
          ⬆ ${esc(t('withdraw'))}
          <span class="tag ${wp.withdrawals.length ? 'pending' : 'approved'}">${wp.withdrawals.length}</span>
        </button>
      </div>

      <!-- PENDING SECTION -->
      <h3>${esc(isDep ? t('pending_requests') : t('pending_withdrawals'))}</h3>
      ${isDep
        ? (dp.deposits.length ? `<div class="scroll"><table>
            <tr><th>${esc(t('name'))}</th><th>${esc(t('method'))}</th><th>${esc(t('amount'))}</th><th>${esc(t('tx_ref'))}</th><th></th></tr>
            ${dp.deposits.map((d) => `<tr>
              <td><div style="font-weight:600">${esc(d.user_name)}</div><div class="muted">${esc(d.phone)}</div></td>
              <td>${esc(d.provider)}</td>
              <td style="font-weight:700">${fmt(d.amount)}</td>
              <td><span style="font-size:12px;font-family:monospace">${esc(d.tx_ref)}</span></td>
              <td style="white-space:nowrap">
                <button class="btn sm alt" data-kind="deposit" data-a="approve" data-id="${d.id}">✓ ${esc(t('approve'))}</button>
                <button class="btn sm bad" data-kind="deposit" data-a="reject" data-id="${d.id}">✕ ${esc(t('reject'))}</button>
              </td>
            </tr>`).join('')}
          </table></div>` : emptyState('✅', t('no_data')))
        : (wp.withdrawals.length ? `<div class="scroll"><table>
            <tr><th>${esc(t('name'))}</th><th>${esc(t('method'))}</th><th>${esc(t('amount'))}</th><th>${esc(t('account_number'))}</th><th></th></tr>
            ${wp.withdrawals.map((w) => `<tr>
              <td><div style="font-weight:600">${esc(w.user_name)}</div><div class="muted">${esc(w.phone)}</div></td>
              <td>${esc(w.provider)}</td>
              <td style="font-weight:700">${fmt(w.amount)}</td>
              <td><span style="font-size:12px;font-family:monospace">${esc(w.account_number)}</span></td>
              <td style="white-space:nowrap">
                <button class="btn sm alt" data-kind="withdraw" data-a="approve" data-id="${w.id}">✓ ${esc(t('approve'))}</button>
                <button class="btn sm bad" data-kind="withdraw" data-a="reject" data-id="${w.id}">✕ ${esc(t('reject'))}</button>
              </td>
            </tr>`).join('')}
          </table></div>` : emptyState('✅', t('no_data')))
      }
    </div>

    <!-- DECIDED SECTION -->
    <div class="card">
      <h3>${esc(isDep ? t('decided_requests') : t('decided_withdrawals'))}</h3>
      ${isDep
        ? ([...da.deposits, ...dr.deposits].length ? `<div class="scroll"><table>
            <tr><th>${esc(t('name'))}</th><th>${esc(t('amount'))}</th><th>${esc(t('tx_ref'))}</th><th>${esc(t('status'))}</th></tr>
            ${[...da.deposits, ...dr.deposits].sort((x, y) => y.id - x.id).slice(0, 30).map((d) => `<tr>
              <td>${esc(d.user_name)}</td>
              <td style="font-weight:600">${fmt(d.amount)}</td>
              <td><span style="font-size:12px;font-family:monospace">${esc(d.tx_ref)}</span></td>
              <td>${statusTag(d.status)}${d.reason ? `<div class="muted" style="margin-top:3px">${esc(d.reason)}</div>` : ''}</td>
            </tr>`).join('')}
          </table></div>` : emptyState('📋', t('no_data')))
        : ([...wa.withdrawals, ...wr.withdrawals].length ? `<div class="scroll"><table>
            <tr><th>${esc(t('name'))}</th><th>${esc(t('amount'))}</th><th>${esc(t('account_number'))}</th><th>${esc(t('status'))}</th></tr>
            ${[...wa.withdrawals, ...wr.withdrawals].sort((x, y) => y.id - x.id).slice(0, 30).map((w) => `<tr>
              <td>${esc(w.user_name)}</td>
              <td style="font-weight:600">${fmt(w.amount)}</td>
              <td><span style="font-size:12px;font-family:monospace">${esc(w.account_number)}</span></td>
              <td>${statusTag(w.status)}${w.reason ? `<div class="muted" style="margin-top:3px">${esc(w.reason)}</div>` : ''}</td>
            </tr>`).join('')}
          </table></div>` : emptyState('📋', t('no_data')))
      }
    </div>`;

  $('as-dep').onclick = () => { agentSubtab = 'deposits'; render(); };
  $('as-with').onclick = () => { agentSubtab = 'withdrawals'; render(); };

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
}

// =====================================================
// ADMIN VIEW
// =====================================================
async function adminView(app) {
  const [s, u, tks, aud] = await Promise.all([
    api('/admin/stats'),
    api('/admin/users'),
    api('/admin/tickets'),
    api('/admin/audit'),
  ]);

  app.innerHTML = `
    <div class="section-head">
      <h2>⚙ ${esc(t('admin'))}</h2>
    </div>

    <div class="admin-stats">
      <div class="admin-stat">
        <div class="value">${s.users}</div>
        <div class="label">${esc(t('stat_users'))}</div>
      </div>
      <div class="admin-stat">
        <div class="value">${s.pending}</div>
        <div class="label">${esc(t('stat_pending'))}</div>
      </div>
      <div class="admin-stat">
        <div class="value accent">${fmt(s.credited)}</div>
        <div class="label">${esc(t('stat_credited'))}</div>
      </div>
      <div class="admin-stat">
        <div class="value">${s.rounds}</div>
        <div class="label">${esc(t('stat_rounds'))}</div>
      </div>
    </div>

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
          <td style="font-weight:700">${fmt(x.balance)}</td>
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
      <h3>${esc(t('tickets'))}</h3>
      ${!tks.tickets.length ? emptyState('💬', t('no_data')) : `
      <div class="scroll"><table>
        <tr><th>${esc(t('date'))}</th><th>${esc(t('name'))}</th><th>${esc(t('message'))}</th></tr>
        ${tks.tickets.map((x) => `<tr>
          <td class="muted" style="white-space:nowrap">${esc(x.created_at)}</td>
          <td><div style="font-weight:600">${esc(x.user_name)}</div><div class="muted">${esc(x.phone)}</div></td>
          <td>${esc(x.message)}</td>
        </tr>`).join('')}
      </table></div>`}
    </div>

    <div class="card">
      <h3>${esc(t('audit'))}</h3>
      <div class="scroll"><table>
        <tr><th>${esc(t('date'))}</th><th>${esc(t('actor'))}</th><th>${esc(t('action'))}</th></tr>
        ${aud.logs.map((x) => `<tr>
          <td class="muted" style="white-space:nowrap">${esc(x.created_at)}</td>
          <td>${esc(x.actor_name || 'System')}</td>
          <td><span style="font-family:monospace;font-size:12px">${esc(x.action)}</span></td>
        </tr>`).join('')}
      </table></div>
    </div>`;

  app.querySelectorAll('button[data-u]').forEach((b) => (b.onclick = async () => {
    const body = {};
    if (b.dataset.role) body.role = b.dataset.role;
    if (b.dataset.status) body.status = b.dataset.status;
    try { await api(`/admin/users/${b.dataset.u}`, body); render(); } catch (e) { fail(e); }
  }));
}

// Initial boot
(async () => {
  await loadLang(lang);
  render();
})();
