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
// Reference: Dark green-black & antique-gold split card
// =====================================================
function authView(app, initialMode = 'login') {
  app.innerHTML = `
    <div class="auth-wrapper">
      <div class="auth-split-card">
        <!-- Left Brand Showcase Side -->
        <div class="auth-showcase">
          <div>
            <div class="auth-brand-head" style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
              <div class="logo">ፍ</div>
              <span class="brand-sub" style="font-size:12px;letter-spacing:1px;color:var(--gold-bright)">FETAN BET CASINO</span>
            </div>

            <div class="auth-hero-title-group">
              <div class="auth-welcome-sub">Welcome to</div>
              <div class="auth-brand-giant">FETAN BET</div>
            </div>

            <div class="auth-brand-tagline">
              ${lang === 'am' ? 'በፍጣን ቤት በሚወዷቸው የካሲኖ እና የስፖርት ጨዋታዎች ይደሰቱ' : 'Bet on your favorite sports and casino games with FETAN BET'}
            </div>

            <ul class="auth-features">
              <li class="auth-feat-item">
                <span class="auth-feat-icon">🎰</span>
                <span>${lang === 'am' ? '7 ዋና የካሲኖ ጨዋታዎች (ሮድ፣ ማይንስ፣ ፕሊንኮ፣ ኬኖ፣ ቢንጎ...)' : '7 Premium Casino Games (Road, Mines, Plinko, Keno, Bingo...)'}</span>
              </li>
              <li class="auth-feat-item">
                <span class="auth-feat-icon">🪙</span>
                <span>${lang === 'am' ? '1,000 ነፃ የሙከራ ክሬዲት ሲመዘገቡ' : '1,000 Free Welcome Demo Credits'}</span>
              </li>
              <li class="auth-feat-item">
                <span class="auth-feat-icon">⚡</span>
                <span>${lang === 'am' ? 'ፈጣን የወኪል ገንዘብ ማስገቢያ እና ማውጫ' : 'Instant Agent Deposits & Withdrawals'}</span>
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
              
              <label for="l-pass" style="margin-top:12px">${esc(t('password'))}</label>
              <div class="input-wrap-pass">
                <input id="l-pass" name="password" type="password" autocomplete="current-password" required>
                <button type="button" class="pass-toggle-btn" id="l-pass-toggle" title="Show/Hide Password">👁</button>
              </div>

              <div class="auth-helper-row">
                <label class="auth-checkbox-label">
                  <input type="checkbox" id="remember-me" checked>
                  <span>Remember me</span>
                </label>
                <a href="#" class="auth-forgot-link" id="forgot-pass-link">Forgot Password?</a>
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
              <input id="r-phone" name="phone" inputmode="tel" placeholder="${esc(t('phone_hint'))}" autocomplete="tel" required>
              
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

  // Password visibility toggles
  $('l-pass-toggle').onclick = () => {
    const inp = $('l-pass');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  };
  $('r-pass-toggle').onclick = () => {
    const inp = $('r-pass');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  };
  $('forgot-pass-link').onclick = (e) => {
    e.preventDefault();
    toast('Demo account: use 0900000000 / admin123 or your registered phone number.', 'ok');
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
              <span class="provider-card-badge">${esc(t('status_approved'))}</span>
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
        <tr><th>${esc(t('date'))}</th><th>${esc(t('method'))}</th><th>${esc(t('amount'))}</th><th>${esc(t('tx_ref'))}</th><th>${esc(t('status'))}</th></tr>
        ${deposits.map((d) => `<tr>
          <td class="muted" style="white-space:nowrap">${esc(d.created_at)}</td>
          <td><b>${esc(d.provider)}</b></td>
          <td style="font-weight:800;color:var(--gold-bright);font-size:15px">${fmt(d.amount)} ${esc(t('currency_etb'))}</td>
          <td><span style="font-size:12px;font-family:monospace;background:var(--surface-hover);padding:3px 8px;border-radius:4px">${esc(d.tx_ref)}</span></td>
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

  $('df').onsubmit = async (ev) => {
    ev.preventDefault();
    const btn = $('dep-submit-btn');
    btn.disabled = true; btn.textContent = '...';
    try {
      await api('/deposits', Object.fromEntries(new FormData(ev.target)));
      success(t('deposit_created'));
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
// AGENT VIEW — Float Funding & Customer Verification
// =====================================================
async function agentView(app) {
  const [dp, da, dr, wp, wa, wr, fund] = await Promise.all([
    api('/agent/deposits?status=pending'),
    api('/agent/deposits?status=approved'),
    api('/agent/deposits?status=rejected'),
    api('/agent/withdrawals?status=pending'),
    api('/agent/withdrawals?status=approved'),
    api('/agent/withdrawals?status=rejected'),
    api('/agent/funding').catch(() => ({ requests: [] })),
  ]);

  const isDep = agentSubtab === 'deposits';
  const isWith = agentSubtab === 'withdrawals';
  const isFund = agentSubtab === 'funding';

  app.innerHTML = `
    <!-- Agent Float Balance Banner -->
    <div class="agent-float-card">
      <div class="agent-float-info">
        <div class="agent-float-title">🔑 ${esc(t('agent_float_balance'))}</div>
        <div class="agent-float-num">🪙 ${fmt(balance)} <small style="font-size:16px;color:var(--gold-bright);font-weight:700">${esc(t('currency_etb'))}</small></div>
        <div style="font-size:12px;color:var(--text-muted)">${esc(me.name)} (${esc(me.phone)})</div>
      </div>
      <div>
        <button id="toggle-funding-btn" class="btn btn-gold" style="width:auto;padding:10px 18px;font-size:13px">
          ⚡ ${esc(t('request_funding'))}
        </button>
      </div>
    </div>

    <!-- Agent Funding Request Drawer / Box (Hidden by default, toggleable) -->
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
        <button class="subtab ${isDep ? 'on' : ''}" id="as-dep">
          ⬇ ${esc(t('customer_deposits'))}
          <span class="tag ${dp.deposits.length ? 'pending' : 'approved'}">${dp.deposits.length}</span>
        </button>
        <button class="subtab ${isWith ? 'on' : ''}" id="as-with">
          ⬆ ${esc(t('customer_withdrawals'))}
          <span class="tag ${wp.withdrawals.length ? 'pending' : 'approved'}">${wp.withdrawals.length}</span>
        </button>
        <button class="subtab ${isFund ? 'on' : ''}" id="as-fund">
          ⚡ ${esc(t('funding_history'))}
          <span class="tag ${fund.requests.filter(r => r.status === 'pending').length ? 'pending' : 'approved'}">${fund.requests.length}</span>
        </button>
      </div>

      <!-- TAB 1: CUSTOMER DEPOSITS -->
      ${isDep ? `
        <h3>${esc(t('pending_requests'))}</h3>
        ${dp.deposits.length ? `
          <div class="scroll"><table>
            <tr><th>${esc(t('name'))}</th><th>${esc(t('method'))}</th><th>${esc(t('amount'))}</th><th>${esc(t('tx_ref'))}</th><th></th></tr>
            ${dp.deposits.map((d) => `<tr>
              <td><div style="font-weight:600">${esc(d.user_name)}</div><div class="muted">${esc(d.phone)}</div></td>
              <td><b>${esc(d.provider)}</b></td>
              <td style="font-weight:800;color:var(--gold-bright);font-size:16px">${fmt(d.amount)} ${esc(t('currency_etb'))}</td>
              <td><span style="font-size:12px;font-family:monospace;background:var(--surface-hover);padding:3px 8px;border-radius:4px">${esc(d.tx_ref)}</span></td>
              <td style="white-space:nowrap">
                <button class="btn sm alt" data-kind="deposit" data-a="approve" data-id="${d.id}">✓ ${esc(t('approve'))}</button>
                <button class="btn sm bad" data-kind="deposit" data-a="reject" data-id="${d.id}">✕ ${esc(t('reject'))}</button>
              </td>
            </tr>`).join('')}
          </table></div>` : emptyState('✅', t('no_data'))
        }

        <div class="divider"></div>
        <h3>${esc(t('decided_requests'))}</h3>
        ${[...da.deposits, ...dr.deposits].length ? `
          <div class="scroll"><table>
            <tr><th>${esc(t('name'))}</th><th>${esc(t('amount'))}</th><th>${esc(t('tx_ref'))}</th><th>${esc(t('status'))}</th></tr>
            ${[...da.deposits, ...dr.deposits].sort((x, y) => y.id - x.id).slice(0, 30).map((d) => `<tr>
              <td><div style="font-weight:600">${esc(d.user_name)}</div><div class="muted">${esc(d.provider)}</div></td>
              <td style="font-weight:700">${fmt(d.amount)}</td>
              <td><span style="font-size:12px;font-family:monospace">${esc(d.tx_ref)}</span></td>
              <td>${statusTag(d.status)}${d.reason ? `<div class="muted" style="margin-top:3px;font-size:11px">${esc(d.reason)}</div>` : ''}</td>
            </tr>`).join('')}
          </table></div>` : emptyState('📋', t('no_data'))
        }
      ` : ''}

      <!-- TAB 2: CUSTOMER WITHDRAWALS -->
      ${isWith ? `
        <h3>${esc(t('pending_withdrawals'))}</h3>
        ${wp.withdrawals.length ? `
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
        ${[...wa.withdrawals, ...wr.withdrawals].length ? `
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

      <!-- TAB 3: AGENT FUNDING REQUESTS -->
      ${isFund ? `
        <h3>${esc(t('funding_history'))}</h3>
        ${!fund.requests.length ? emptyState('⚡', t('no_data')) : `
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
    </div>`;

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
  $('as-fund').onclick = () => { agentSubtab = 'funding'; render(); };

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
// ADMIN VIEW — 3 Structured Sections: Deposits, Agent Funding, Transactions
// =====================================================
let adminSection = 'deposits';

async function adminView(app) {
  const [s, u, tks, aud, fundReqs, depPending, txs] = await Promise.all([
    api('/admin/stats'),
    api('/admin/users'),
    api('/admin/tickets'),
    api('/admin/audit'),
    api('/admin/agent-funding').catch(() => ({ requests: [] })),
    api('/agent/deposits?status=pending').catch(() => ({ deposits: [] })),
    api('/admin/transactions').catch(() => ({ transactions: [] })),
  ]);

  app.innerHTML = `
    <div class="section-head">
      <h2>⚙ ${esc(t('admin'))}</h2>
      <span class="tag rejected" style="font-size:12px;letter-spacing:1px">SUPER ADMIN</span>
    </div>

    <!-- Admin KPI Stats Grid -->
    <div class="admin-stats">
      <div class="admin-stat">
        <div class="value">${s.users}</div>
        <div class="label">${esc(t('stat_users'))}</div>
      </div>
      <div class="admin-stat">
        <div class="value">${s.agents ?? 1}</div>
        <div class="label">${esc(t('stat_agents'))}</div>
      </div>
      <div class="admin-stat">
        <div class="value ${depPending.deposits.length ? 'accent' : ''}">${depPending.deposits.length}</div>
        <div class="label">${esc(t('stat_pending'))}</div>
      </div>
      <div class="admin-stat">
        <div class="value ${fundReqs.requests.filter(r => r.status === 'pending').length ? 'accent' : ''}">
          ${fundReqs.requests.filter(r => r.status === 'pending').length}
        </div>
        <div class="label">${esc(t('stat_funding_pending'))}</div>
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

    <!-- Admin Navigation Tabs -->
    <div class="card" style="padding:16px 20px 8px">
      <div class="subtabs" style="margin-bottom:0;border-bottom:none">
        <button class="subtab ${adminSection === 'deposits' ? 'on' : ''}" id="adm-tab-dep">
          ⬇ ${esc(t('sec_customer_deposits'))}
          <span class="tag ${depPending.deposits.length ? 'pending' : 'approved'}">${depPending.deposits.length}</span>
        </button>
        <button class="subtab ${adminSection === 'funding' ? 'on' : ''}" id="adm-tab-fund">
          ⚡ ${esc(t('sec_agent_funding'))}
          <span class="tag ${fundReqs.requests.filter(r => r.status === 'pending').length ? 'pending' : 'approved'}">
            ${fundReqs.requests.filter(r => r.status === 'pending').length}
          </span>
        </button>
        <button class="subtab ${adminSection === 'transactions' ? 'on' : ''}" id="adm-tab-tx">
          📋 ${esc(t('sec_system_tx'))}
        </button>
        <button class="subtab ${adminSection === 'users' ? 'on' : ''}" id="adm-tab-users">
          👥 ${esc(t('users'))}
        </button>
        <button class="subtab ${adminSection === 'support' ? 'on' : ''}" id="adm-tab-supp">
          💬 ${esc(t('tickets'))} (${tks.tickets.length})
        </button>
      </div>
    </div>

    <!-- SECTION 1: CUSTOMER DEPOSITS APPROVAL -->
    ${adminSection === 'deposits' ? `
      <div class="card">
        <h3>${esc(t('sec_customer_deposits'))}</h3>
        ${!depPending.deposits.length ? emptyState('✅', 'No pending customer deposit requests') : `
        <div class="scroll"><table>
          <tr><th>${esc(t('name'))}</th><th>${esc(t('method'))}</th><th>${esc(t('amount'))}</th><th>${esc(t('tx_ref'))}</th><th></th></tr>
          ${depPending.deposits.map((d) => `<tr>
            <td><div style="font-weight:600">${esc(d.user_name)}</div><div class="muted">${esc(d.phone)}</div></td>
            <td><b>${esc(d.provider)}</b></td>
            <td style="font-weight:800;color:var(--gold-bright);font-size:16px">${fmt(d.amount)} ${esc(t('currency_etb'))}</td>
            <td><span style="font-size:12px;font-family:monospace;background:var(--surface-hover);padding:3px 8px;border-radius:4px">${esc(d.tx_ref)}</span></td>
            <td style="white-space:nowrap">
              <button class="btn sm alt" data-adm-dep="approve" data-id="${d.id}">✓ ${esc(t('approve'))}</button>
              <button class="btn sm bad" data-adm-dep="reject" data-id="${d.id}">✕ ${esc(t('reject'))}</button>
            </td>
          </tr>`).join('')}
        </table></div>`}
      </div>
    ` : ''}

    <!-- SECTION 2: AGENT FUNDING REQUESTS -->
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

    <!-- SECTION 3: SYSTEM TRANSACTIONS / LEDGER -->
    ${adminSection === 'transactions' ? `
      <div class="card">
        <div class="section-head">
          <h3>${esc(t('sec_system_tx'))}</h3>
          <span class="muted" style="font-size:12px">${txs.transactions.length} records</span>
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

    <!-- SECTION 4: USER MANAGEMENT -->
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
    ` : ''}

    <!-- SECTION 5: SUPPORT TICKETS & AUDIT -->
    ${adminSection === 'support' ? `
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
          ${aud.logs.slice(0, 30).map((x) => `<tr>
            <td class="muted" style="white-space:nowrap">${esc(x.created_at)}</td>
            <td>${esc(x.actor_name || 'System')}</td>
            <td><span style="font-family:monospace;font-size:12px">${esc(x.action)}</span></td>
          </tr>`).join('')}
        </table></div>
      </div>
    ` : ''}
  `;

  // Subtab switching
  $('adm-tab-dep').onclick = () => { adminSection = 'deposits'; render(); };
  $('adm-tab-fund').onclick = () => { adminSection = 'funding'; render(); };
  $('adm-tab-tx').onclick = () => { adminSection = 'transactions'; render(); };
  $('adm-tab-users').onclick = () => { adminSection = 'users'; render(); };
  $('adm-tab-supp').onclick = () => { adminSection = 'support'; render(); };

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

// Initial boot
(async () => {
  await loadLang(lang);
  render();
})();
