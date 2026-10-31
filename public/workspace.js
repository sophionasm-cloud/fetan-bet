/* Fetan Bet — Agent & Super Admin workspace.
 * The workspace is intentionally isolated from the customer SPA renderer so
 * staff never mount customer wallet, deposit or game views.
 */
(function () {
  'use strict';

  const ICONS = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    swap: '<path d="M7 16H3m0 0 4-4m-4 4 4 4"/><path d="M17 8h4m0 0-4-4m4 4-4 4"/>',
    chat: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/><path d="M8 9h8M8 13h5"/>',
    wallet: '<path d="M20 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15v14H5a2 2 0 0 1-2-2V5"/><path d="M16 13h4"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    report: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.37a1.7 1.7 0 0 0-1 .63 1.7 1.7 0 0 0-.34 1v.17a2 2 0 1 1-4 0V21a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.63 15a1.7 1.7 0 0 0-.63-1 1.7 1.7 0 0 0-1-.34H2.83a2 2 0 1 1 0-4H3a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.63a1.7 1.7 0 0 0 1-.63 1.7 1.7 0 0 0 .34-1V2.83a2 2 0 1 1 4 0V3a1.7 1.7 0 0 0 1.11 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.37 9c.16.37.4.7.63 1 .28.3.65.47 1 .34h.17a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6.66z"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
    deposit: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/>',
    withdraw: '<path d="M12 21V9"/><path d="m7 14 5-5 5 5"/><path d="M4 3h16"/>',
    agents: '<circle cx="9" cy="7" r="4"/><path d="M2 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2"/><path d="M19 8v6M16 11h6"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
    trend: '<path d="m3 17 6-6 4 4 8-9"/><path d="M15 6h6v6"/>',
    gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v9h14v-9M12 8v13"/><path d="M12 8H7.5A2.5 2.5 0 1 1 10 5.5zM12 8h4.5A2.5 2.5 0 1 0 14 5.5z"/>',
    check: '<path d="m4 12 5 5L20 6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
    filter: '<path d="M3 5h18M6 12h12M10 19h4"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'
  };

  const DAY_MS = 24 * 60 * 60 * 1000;
  const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;

  function utcWeekBounds(date = new Date()) {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) throw new TypeError('Invalid settlement date.');
    const eat = new Date(d.getTime() + EAT_OFFSET_MS);
    const localMidnightUtc = Date.UTC(eat.getUTCFullYear(), eat.getUTCMonth(), eat.getUTCDate());
    const daysSinceMonday = (new Date(localMidnightUtc).getUTCDay() + 6) % 7;
    const start = new Date(localMidnightUtc - daysSinceMonday * DAY_MS - EAT_OFFSET_MS);
    const end = new Date(start.getTime() + 7 * DAY_MS);
    return { start, end };
  }

  function eatDayBounds(date = new Date()) {
    const d = new Date(date);
    const eat = new Date(d.getTime() + EAT_OFFSET_MS);
    const midnightUtc = Date.UTC(eat.getUTCFullYear(), eat.getUTCMonth(), eat.getUTCDate());
    return { start: new Date(midnightUtc - EAT_OFFSET_MS), end: new Date(midnightUtc - EAT_OFFSET_MS + DAY_MS) };
  }

  function eatMonthBounds(date = new Date()) {
    const d = new Date(date);
    const eat = new Date(d.getTime() + EAT_OFFSET_MS);
    const firstUtc = Date.UTC(eat.getUTCFullYear(), eat.getUTCMonth(), 1);
    const nextUtc = Date.UTC(eat.getUTCFullYear(), eat.getUTCMonth() + 1, 1);
    return { start: new Date(firstUtc - EAT_OFFSET_MS), end: new Date(nextUtc - EAT_OFFSET_MS) };
  }

  function workspaceRange(range = 'weekly') {
    if (range === 'daily') return eatDayBounds();
    if (range === 'monthly') return eatMonthBounds();
    return utcWeekBounds();
  }

  function eatDateLabel(value) {
    const d = new Date(value);
    return new Date(d.getTime() + EAT_OFFSET_MS).toISOString().slice(0, 10);
  }

  const state = {
    page: 'dashboard',
    agentRange: 'weekly',
    superRange: 'weekly',
    perfPeriod: 'weekly',
    pendingTab: 'deposits',
    managementTab: 'agents',
    supportStatus: 'all',
    superSupportStatus: 'all',
    selectedTicket: null,
    selectedSuperTicket: null,
    userSearch: '',
    userStatus: 'all',
    userOffset: 0,
    superUserSearch: '',
    superUserRole: 'user',
    superUserStatus: 'all',
    superUserOffset: 0,
    txType: 'all',
    txStatus: 'all',
    txSearch: '',
    txStart: '',
    txEnd: '',
    txOffset: 0,
    depositStatus: 'pending',
    depositSearch: '',
    withdrawalStatus: 'pending',
    withdrawalSearch: '',
    reportStart: '',
    reportEnd: '',
    notifications: [],
    notificationUnread: 0,
    reportData: null,
    sidebarOpen: false,
  };

  let ctx = null;
  let root = null;
  let pageTimer = null;
  let notificationTimer = null;
  let notificationOpen = false;

  const icon = (name, cls = '') => `<svg class="ws-svg ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.grid}</svg>`;
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const num = (value) => Number(value || 0).toLocaleString('en-US');
  const money = (value, digits) => {
    const amount = Number(value || 0) / 100;
    const dec = digits == null ? (Math.abs(amount) % 1 === 0 ? 0 : 2) : digits;
    return amount.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  };
  const etb = (value) => `<span class="ws-money">${money(value)}</span> <small>ETB</small>`;
  const pct = (value) => `${Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
  const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('');
  const dateShort = (value) => value ? new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const dateTime = (value) => value ? new Date(value).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
  const timeAgo = (value) => {
    if (!value) return '—';
    const diff = Date.now() - new Date(value).getTime();
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  };
  const statusClass = (status) => {
    const s = String(status || '').toLowerCase();
    if (['active', 'approved', 'paid', 'resolved', 'settled', 'awarded'].includes(s)) return 'success';
    if (['pending', 'open', 'accrued', 'estimated'].includes(s)) return 'warning';
    if (['rejected', 'suspended', 'escalated'].includes(s)) return 'danger';
    if (['in_progress', 'approved_for_payout', 'processing'].includes(s)) return 'info';
    return 'muted';
  };
  const pill = (status, label) => `<span class="ws-pill ${statusClass(status)}"><i></i>${esc(label || String(status || '').replace(/_/g, ' '))}</span>`;
  const changeBadge = (value) => {
    if (value == null || !Number.isFinite(Number(value))) return '<span class="ws-change flat">—</span>';
    const n = Number(value);
    return `<span class="ws-change ${n >= 0 ? 'up' : 'down'}">${n >= 0 ? '↑' : '↓'} ${Math.abs(n).toFixed(1)}%</span>`;
  };
  const pageError = (error) => `<div class="ws-card ws-error"><div class="ws-error-icon">!</div><div><h3>We couldn't load this page</h3><p>${esc(error && error.message ? error.message : 'Please try again.')}</p><button type="button" class="ws-btn primary" id="ws-error-retry">Retry</button></div></div>`;
  const loading = (label) => `<div class="ws-loading"><span class="ws-spinner"></span><span>${esc(label || 'Loading workspace')}</span></div>`;
  const empty = (iconName, title, text) => `<div class="ws-empty">${icon(iconName)}<h3>${esc(title)}</h3><p>${esc(text || '')}</p></div>`;

  function iconButton(name, label, id) {
    return `<button type="button" class="ws-icon-btn" aria-label="${esc(label)}" title="${esc(label)}"${id ? ` id="${id}"` : ''}>${icon(name)}</button>`;
  }

  function statCard({ label, value, caption, iconName, tone = 'yellow', change, footer }) {
    return `<article class="ws-stat tone-${tone}">
      <div class="ws-stat-top">
        <span class="ws-stat-icon">${icon(iconName)}</span>
        ${change == null ? '' : changeBadge(change)}
      </div>
      <div class="ws-stat-value">${value}</div>
      <div class="ws-stat-label">${esc(label)}</div>
      ${footer || caption ? `<div class="ws-stat-foot">${footer || esc(caption)}</div>` : ''}
    </article>`;
  }

  function sectionHead(title, subtitle, action) {
    return `<div class="ws-card-head"><div><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>${action || ''}</div>`;
  }

  function table(headers, rows, emptyMarkup) {
    if (!rows || !rows.length) return emptyMarkup || empty('filter', 'Nothing here yet', 'New activity will appear here automatically.');
    return `<div class="ws-table-wrap"><table class="ws-table"><thead><tr>${headers.map((head) => `<th>${esc(head)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  }

  function segmented(options, current, action) {
    return `<div class="ws-segmented" data-segment="${esc(action)}">${options.map(([value, label]) => `<button type="button" data-value="${esc(value)}" class="${current === value ? 'on' : ''}">${esc(label)}</button>`).join('')}</div>`;
  }

  function lineChart(points, options = {}) {
    const data = Array.isArray(points) ? points : [];
    if (!data.length) return empty('trend', 'No chart data yet', 'Activity will appear as settled rounds are recorded.');
    const width = 760, height = 250, padX = 42, padY = 26;
    const values = data.map((point) => Number(options.value ? point[options.value] : point) || 0);
    const max = Math.max(1, ...values);
    const min = Math.min(0, ...values);
    const span = max - min || 1;
    const stepX = data.length > 1 ? (width - padX * 2) / (data.length - 1) : 0;
    const pointAt = (index) => {
      const x = padX + index * stepX;
      const y = height - padY - ((values[index] - min) / span) * (height - padY * 2);
      return [x, y];
    };
    const coords = data.map((_, index) => pointAt(index));
    const line = coords.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const area = `${line} L${coords[coords.length - 1][0].toFixed(1)},${height - padY} L${coords[0][0].toFixed(1)},${height - padY} Z`;
    const grid = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
      const y = padY + ratio * (height - padY * 2);
      const value = max - ratio * span;
      return `<line x1="${padX}" y1="${y}" x2="${width - padX}" y2="${y}" class="ws-chart-grid"/><text x="${width - padX + 6}" y="${y + 3}" class="ws-chart-y">${money(value, 0)}</text>`;
    }).join('');
    const labelEvery = Math.max(1, Math.ceil(data.length / 7));
    const labels = data.map((point, index) => {
      if (index % labelEvery !== 0 && index !== data.length - 1) return '';
      const [x] = coords[index];
      return `<text x="${x}" y="${height - 5}" text-anchor="middle" class="ws-chart-x">${esc(String(point.bucket || point.label || '').slice(5))}</text>`;
    }).join('');
    const dots = coords.map(([x, y], index) => `<circle cx="${x}" cy="${y}" r="${index === coords.length - 1 ? 4 : 2.5}" class="ws-chart-dot"><title>${esc(data[index].bucket || '')}: ${money(values[index])} ETB</title></circle>`).join('');
    return `<div class="ws-chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Profit chart">
      <defs><linearGradient id="wsLineFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#FFD21F" stop-opacity=".28"/><stop offset="100%" stop-color="#FFD21F" stop-opacity="0"/></linearGradient></defs>
      ${grid}<path d="${area}" fill="url(#wsLineFill)"/><path d="${line}" class="ws-chart-line"/>${dots}${labels}
    </svg></div>`;
  }

  function donutChart(percent, center, label, color = '#FFD21F') {
    const radius = 58;
    const circumference = 2 * Math.PI * radius;
    const safe = Math.max(0, Math.min(100, Number(percent) || 0));
    const dash = (safe / 100) * circumference;
    return `<div class="ws-donut-wrap"><svg viewBox="0 0 150 150" class="ws-donut" role="img" aria-label="${esc(label)} ${safe}%">
      <circle cx="75" cy="75" r="${radius}" fill="none" stroke="#22313f" stroke-width="14"/>
      <circle cx="75" cy="75" r="${radius}" fill="none" stroke="${color}" stroke-width="14" stroke-linecap="round" stroke-dasharray="${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}" transform="rotate(-90 75 75)"/>
      <text x="75" y="72" text-anchor="middle" class="ws-donut-value">${esc(center)}</text>
      <text x="75" y="91" text-anchor="middle" class="ws-donut-label">${esc(label)}</text>
    </svg></div>`;
  }

  function avatar(name, size = '') {
    return `<span class="ws-avatar ${size}">${esc(initials(name))}</span>`;
  }

  function onlineDot(online, label) {
    return `<span class="ws-online ${online ? 'on' : ''}"><i></i>${esc(label || (online ? 'Online' : 'Offline'))}</span>`;
  }

  function userPill(user) {
    return `<div class="ws-user-cell">${avatar(user.name)}<div><b>${esc(user.name)}</b><span>${esc(user.phone || user.email || '')}</span></div></div>`;
  }

  function agentNav() {
    return [
      ['dashboard', 'Dashboard', 'grid'],
      ['users', 'My Users', 'users'],
      ['transactions', 'Transactions', 'swap'],
      ['support', 'Support Chat', 'chat'],
      ['earnings', 'My Earnings', 'wallet'],
      ['profile', 'Profile', 'user'],
    ];
  }
  function superNav() {
    return [
      ['dashboard', 'Dashboard', 'grid'],
      ['users', 'Users', 'users'],
      ['agents', 'Agents', 'agents'],
      ['deposit-requests', 'Deposit Requests', 'deposit'],
      ['withdrawal-requests', 'Withdrawal Requests', 'withdraw'],
      ['agent-management', 'Agent Management', 'shield'],
      ['reports', 'Reports', 'report'],
      ['support', 'Support', 'chat'],
      ['settings', 'Settings', 'settings'],
    ];
  }
  function navItems() { return ctx.me.role === 'agent' ? agentNav() : superNav(); }
  function defaultPage() { return 'dashboard'; }
  function allowedPage(page) { return navItems().some(([key]) => key === page); }

  const PAGE_META = {
    dashboard: ['Dashboard', 'Live performance across your network'],
    users: ['My Users', 'Customers who joined with your promo code'],
    transactions: ['Transactions', 'Wallet, deposit, withdrawal and game activity'],
    support: ['Support Chat', 'Conversations routed from your referred customers'],
    earnings: ['My Earnings', 'Weekly 25% commission and payout status'],
    profile: ['Profile', 'Your agent identity and referral tools'],
    agents: ['Agents', 'Performance of every active agent'],
    'deposit-requests': ['Deposit Requests', 'Review and approve customer deposits'],
    'withdrawal-requests': ['Withdrawal Requests', 'Approve payouts and confirm external payments'],
    'agent-management': ['Agent Management', 'Create, edit and settle agent accounts'],
    reports: ['Reports', 'Financial and agent performance reporting'],
    settings: ['Settings', 'Platform, support and commission configuration'],
  };

  function metaFor(page) {
    const base = PAGE_META[page] || ['Workspace', ''];
    if (ctx.me.role === 'agent' && page === 'dashboard') return [base[0], 'Here is what is happening with your referrals today.'];
    if (ctx.me.role === 'superadmin' && page === 'dashboard') return [base[0], 'Platform health, agent performance and approvals.'];
    return base;
  }

  function sidebarMarkup() {
    const roleLabel = ctx.me.role === 'agent' ? 'Agent workspace' : 'Super Admin console';
    return `<aside class="ws-sidebar" id="ws-sidebar">
      <div class="ws-sidebar-head">
        <div class="ws-brand"><span class="ws-brand-mark">ፈ</span><div><b>FETAN BET</b><span>ፍጣን ቤት</span></div></div>
        <button type="button" class="ws-sidebar-close" id="ws-sidebar-close" aria-label="Close menu">${icon('close')}</button>
      </div>
      <div class="ws-account">
        ${avatar(ctx.me.name, 'lg')}
        <div><b>${esc(ctx.me.name)}</b><span>${esc(roleLabel)}</span></div>
        <span class="ws-account-dot" title="Active session"></span>
      </div>
      <nav class="ws-nav" aria-label="Workspace navigation">
        <p class="ws-nav-label">${ctx.me.role === 'agent' ? 'Workspace' : 'Control centre'}</p>
        ${navItems().map(([key, label, iconName], index) => `<button type="button" class="ws-nav-item ${state.page === key ? 'active' : ''}" data-page="${key}">
          <span class="ws-nav-icon">${icon(iconName)}</span><span>${esc(label)}</span>
          ${key === 'support' ? `<em class="ws-nav-badge" id="ws-nav-support-badge" ${state.supportUnread ? '' : 'hidden'}>${state.supportUnread || ''}</em>` : ''}
          ${ctx.me.role === 'superadmin' && key === 'deposit-requests' ? `<em class="ws-nav-badge" id="ws-nav-approval-badge" ${state.pendingApprovals ? '' : 'hidden'}>${state.pendingApprovals || ''}</em>` : ''}
          ${state.page === key ? '<span class="ws-nav-active-dot"></span>' : ''}
        </button>`).join('')}
      </nav>
      <div class="ws-sidebar-foot">
        <div class="ws-help-card">
          <span class="ws-help-icon">${icon(ctx.me.role === 'agent' ? 'chat' : 'shield')}</span>
          <div><b>${ctx.me.role === 'agent' ? 'Need a hand?' : 'Secure operations'}</b><p>${ctx.me.role === 'agent' ? 'Your support team is one message away.' : 'Only Super Admin can approve money.'}</p></div>
          ${ctx.me.role === 'agent' ? '<button type="button" class="ws-help-link" data-page="support">Open support</button>' : '<span class="ws-secure-tag">2FA review on payouts</span>'}
        </div>
        <button type="button" class="ws-nav-item ws-logout" id="ws-logout"><span class="ws-nav-icon">${icon('logout')}</span><span>Logout</span></button>
      </div>
    </aside>`;
  }

  function topbarMarkup() {
    const [title, subtitle] = metaFor(state.page);
    return `<header class="ws-topbar">
      <button type="button" class="ws-menu-btn" id="ws-menu" aria-label="Open menu" aria-expanded="false" aria-controls="ws-sidebar">${icon('menu')}<span class="ws-menu-text">Menu</span></button>
      <div class="ws-title-block"><span class="ws-eyebrow">${ctx.me.role === 'agent' ? 'AGENT PORTAL' : 'SUPER ADMIN'}</span><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div>
      <div class="ws-top-actions">
        <button type="button" class="ws-refresh-btn" id="ws-refresh" title="Refresh dashboard" aria-label="Refresh dashboard">${icon('refresh')}<span>Refresh</span></button>
        <div class="ws-notif-wrap">
          <button type="button" class="ws-icon-btn ws-bell" id="ws-bell" aria-label="Notifications">${icon('bell')}<span class="ws-bell-badge" id="ws-bell-badge" ${state.notificationUnread ? '' : 'hidden'}>${state.notificationUnread > 9 ? '9+' : state.notificationUnread}</span></button>
          <div class="ws-notif-panel" id="ws-notif-panel" hidden></div>
        </div>
        <button type="button" class="ws-top-avatar" id="ws-top-avatar" title="${esc(ctx.me.name)}" aria-label="Open profile">${avatar(ctx.me.name)}<span class="ws-top-avatar-dot"></span></button>
        <button type="button" class="ws-logout-btn" id="ws-logout-top" title="Logout" aria-label="Logout">${icon('logout')}<span>Logout</span></button>
      </div>
    </header>`;
  }

  function renderShell() {
    root.innerHTML = `<div class="ws-shell">${sidebarMarkup()}<div class="ws-main">${topbarMarkup()}<main class="ws-content" id="ws-content"></main></div><div class="ws-scrim" id="ws-scrim" hidden></div></div>`;
    bindShell();
    renderNotifications();
  }

  function bindShell() {
    document.getElementById('ws-logout')?.addEventListener('click', () => ctx.onLogout());
    document.getElementById('ws-logout-top')?.addEventListener('click', () => ctx.onLogout());
    document.querySelectorAll('.ws-nav-item[data-page]').forEach((button) => {
      button.addEventListener('click', () => navigate(button.dataset.page));
    });
    document.querySelectorAll('[data-page]').forEach((button) => {
      if (button.classList.contains('ws-nav-item')) return;
      button.addEventListener('click', () => navigate(button.dataset.page));
    });
    document.getElementById('ws-refresh')?.addEventListener('click', () => renderPage(true));
    document.getElementById('ws-top-avatar')?.addEventListener('click', () => navigate(ctx.me.role === 'agent' ? 'profile' : 'settings'));
    document.getElementById('ws-menu')?.addEventListener('click', () => setSidebar(!state.sidebarOpen));
    document.getElementById('ws-sidebar-close')?.addEventListener('click', () => setSidebar(false));
    document.getElementById('ws-scrim')?.addEventListener('click', () => setSidebar(false));
    document.addEventListener('keydown', closeSidebarOnEscape);
    document.getElementById('ws-bell')?.addEventListener('click', (event) => {
      event.stopPropagation();
      notificationOpen = !notificationOpen;
      const panel = document.getElementById('ws-notif-panel');
      if (panel) panel.hidden = !notificationOpen;
      if (notificationOpen) loadNotifications().catch(() => {});
    });
    document.addEventListener('click', closeNotificationsOnOutside);
    notificationTimer = window.setInterval(() => {
      loadNotifications(true).catch(() => {});
    }, 45000);
  }

  function closeSidebarOnEscape(event) {
    if (event.key === 'Escape') setSidebar(false);
  }

  function closeNotificationsOnOutside(event) {
    if (!notificationOpen) return;
    if (event.target.closest('.ws-notif-wrap')) return;
    notificationOpen = false;
    const panel = document.getElementById('ws-notif-panel');
    if (panel) panel.hidden = true;
  }

  function setSidebar(open) {
    state.sidebarOpen = Boolean(open);
    document.getElementById('ws-sidebar')?.classList.toggle('open', state.sidebarOpen);
    const scrim = document.getElementById('ws-scrim');
    if (scrim) scrim.hidden = !state.sidebarOpen;
    const menu = document.getElementById('ws-menu');
    if (menu) menu.setAttribute('aria-expanded', String(state.sidebarOpen));
    document.body.classList.toggle('ws-nav-open', state.sidebarOpen);
  }

  function navigate(page) {
    if (!allowedPage(page)) page = defaultPage();
    cleanupPage();
    state.page = page;
    if (page !== 'support') state.selectedTicket = null;
    if (page !== 'support') state.selectedSuperTicket = null;
    setSidebar(false);
    document.querySelectorAll('.ws-nav-item[data-page]').forEach((button) => button.classList.toggle('active', button.dataset.page === page));
    const [title, subtitle] = metaFor(page);
    const titleBlock = document.querySelector('.ws-title-block');
    if (titleBlock) titleBlock.innerHTML = `<span class="ws-eyebrow">${ctx.me.role === 'agent' ? 'AGENT PORTAL' : 'SUPER ADMIN'}</span><h1>${esc(title)}</h1><p>${esc(subtitle)}</p>`;
    history.replaceState(null, '', `#/${ctx.me.role}/${page}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    renderPage();
  }

  function cleanupPage() {
    if (pageTimer) { clearInterval(pageTimer); pageTimer = null; }
  }

  function cleanup() {
    cleanupPage();
    if (notificationTimer) { clearInterval(notificationTimer); notificationTimer = null; }
    document.removeEventListener('click', closeNotificationsOnOutside);
    document.removeEventListener('keydown', closeSidebarOnEscape);
    document.body.classList.remove('workspace-mode', 'ws-agent', 'ws-superadmin', 'ws-modal-open', 'ws-nav-open');
    document.querySelectorAll('.ws-modal-backdrop').forEach((modal) => modal.remove());
    state.notifications = [];
    state.notificationUnread = 0;
    notificationOpen = false;
  }

  async function loadNotifications(silent) {
    try {
      const data = await ctx.api('/notifications?limit=20');
      state.notifications = data.notifications || [];
      state.notificationUnread = Number(data.unread || 0);
      const badge = document.getElementById('ws-bell-badge');
      if (badge) {
        badge.hidden = !state.notificationUnread;
        badge.textContent = state.notificationUnread > 9 ? '9+' : String(state.notificationUnread);
      }
      renderNotifications();
    } catch (error) {
      if (!silent) ctx.fail(error);
    }
  }

  function notificationLink(item) {
    const link = String(item.link || 'dashboard');
    if (ctx.me.role === 'agent') {
      if (link === 'wallet') return 'earnings';
      if (link === 'support') return 'support';
      if (link === 'users') return 'users';
      if (link === 'earnings') return 'earnings';
      return 'dashboard';
    }
    const map = {
      support: 'support', deposits: 'deposit-requests', deposit: 'deposit-requests',
      withdrawals: 'withdrawal-requests', withdrawal: 'withdrawal-requests',
      users: 'users', commissions: 'agent-management', commission: 'agent-management',
      agents: 'agents', reports: 'reports', settings: 'settings', dashboard: 'dashboard'
    };
    return map[link] || 'dashboard';
  }

  function renderNotifications() {
    const panel = document.getElementById('ws-notif-panel');
    if (!panel) return;
    const items = state.notifications;
    panel.innerHTML = `<div class="ws-notif-head"><div><b>Notifications</b><span>${state.notificationUnread ? `${state.notificationUnread} unread` : 'You are all caught up'}</span></div><button type="button" id="ws-mark-all">Mark all read</button></div>
      <div class="ws-notif-list">${items.length ? items.map((item) => `<button type="button" class="ws-notif-item ${item.is_read ? '' : 'unread'}" data-notification="${item.id}" data-link="${esc(notificationLink(item))}">
        <span class="ws-notif-icon">${icon(item.type && item.type.includes('support') ? 'chat' : item.type && (item.type.includes('deposit') || item.type.includes('withdraw') || item.type.includes('commission') || item.type.includes('payout')) ? 'wallet' : item.type && item.type.includes('agent') ? 'agents' : 'bell')}</span>
        <span class="ws-notif-copy"><b>${esc(item.title)}</b><em>${esc(item.message)}</em><small>${timeAgo(item.created_at)}</small></span>
      </button>`).join('') : `<div class="ws-notif-empty">${icon('bell')}<p>No notifications yet.</p></div>`}</div>`;
    document.getElementById('ws-mark-all')?.addEventListener('click', async (event) => {
      event.stopPropagation();
      try { await ctx.api('/notifications/read-all', {}); await loadNotifications(); } catch (error) { ctx.fail(error); }
    });
    panel.querySelectorAll('[data-notification]').forEach((button) => {
      button.addEventListener('click', async () => {
        const id = button.dataset.notification;
        const item = state.notifications.find((notification) => String(notification.id) === String(id));
        try {
          if (item && !item.is_read) {
            await ctx.api(`/notifications/${encodeURIComponent(id)}/read`, {});
            item.is_read = true;
            state.notificationUnread = Math.max(0, state.notificationUnread - 1);
            const badge = document.getElementById('ws-bell-badge');
            if (badge) { badge.hidden = !state.notificationUnread; badge.textContent = state.notificationUnread > 9 ? '9+' : String(state.notificationUnread); }
          }
        } catch (_) { /* navigation should still work */ }
        notificationOpen = false;
        panel.hidden = true;
        navigate(button.dataset.link || 'dashboard');
      });
    });
  }

  async function renderPage(force) {
    cleanupPage();
    const content = document.getElementById('ws-content');
    if (!content) return;
    if (!force) content.innerHTML = loading();
    else content.classList.add('refreshing');
    try {
      let result;
      if (ctx.me.role === 'agent') result = await renderAgentPage();
      else result = await renderSuperPage();
      if (result) content.innerHTML = result;
      content.classList.remove('refreshing');
      bindPage();
      content.classList.add('ws-page-enter');
      window.setTimeout(() => content.classList.remove('ws-page-enter'), 420);
    } catch (error) {
      content.classList.remove('refreshing');
      ctx.fail(error);
      content.innerHTML = pageError(error);
      document.getElementById('ws-error-retry')?.addEventListener('click', () => renderPage());
    }
  }

  function bindPage() {
    bindGeneric();
    if (ctx.me.role === 'agent') bindAgentPage();
    else bindSuperPage();
  }

  function bindGeneric() {
    document.querySelectorAll('[data-segment]').forEach((group) => {
      group.querySelectorAll('button[data-value]').forEach((button) => {
        button.addEventListener('click', () => {
          const key = group.dataset.segment;
          if (key === 'agent-range') state.agentRange = button.dataset.value;
          else if (key === 'super-range') state.superRange = button.dataset.value;
          else if (key === 'super-perf') state.perfPeriod = button.dataset.value;
          else if (key === 'perf-period') state.perfPeriod = button.dataset.value;
          else if (key === 'pending-tab') state.pendingTab = button.dataset.value;
          else if (key === 'management-tab') state.managementTab = button.dataset.value;
          else if (key === 'support-filter') { state.supportStatus = button.dataset.value; state.selectedTicket = null; }
          else if (key === 'super-support-filter') { state.superSupportStatus = button.dataset.value; state.selectedSuperTicket = null; }
          else if (key === 'deposit-status') state.depositStatus = button.dataset.value;
          else if (key === 'withdrawal-status') state.withdrawalStatus = button.dataset.value;
          renderPage();
        });
      });
    });
    document.querySelectorAll('[data-copy]').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(button.dataset.copy);
          ctx.success('Copied to clipboard.');
        } catch (_) { ctx.fail({ message: 'GENERIC' }); }
      });
    });
    document.querySelectorAll('[data-nav-page]').forEach((button) => {
      button.addEventListener('click', () => navigate(button.dataset.navPage));
    });
    document.getElementById('ws-error-retry')?.addEventListener('click', () => renderPage());
  }

  // =====================================================
  // AGENT PAGES
  // =====================================================

  async function renderAgentPage() {
    switch (state.page) {
      case 'dashboard': return agentDashboard();
      case 'users': return agentUsers();
      case 'transactions': return agentTransactions();
      case 'support': return agentSupport();
      case 'earnings': return agentEarnings();
      case 'profile': return agentProfile();
      default: return agentDashboard();
    }
  }

  async function agentDashboard() {
    const range = state.agentRange;
    const [dashboard, tickets] = await Promise.all([
      ctx.api(`/agent/dashboard?range=${encodeURIComponent(range)}`),
      ctx.api('/agent/tickets?status=all').catch(() => ({ tickets: [] }))
    ]);
    const stats = dashboard.stats || {};
    const supportTickets = (tickets.tickets || []).filter((ticket) => ticket.status !== 'resolved').slice(0, 3);
    state.supportUnread = Number(dashboard.support?.unread || 0);
    const navBadge = document.getElementById('ws-nav-support-badge');
    if (navBadge) { navBadge.textContent = state.supportUnread; navBadge.hidden = !state.supportUnread; }
    const donut = dashboard.donut || {};
    const positive = Math.max(0, Number(donut.ngr || 0));
    const cut = positive > 0 ? (Number(donut.commission || 0) / positive) * 100 : 0;
    return `<div class="ws-page-head">
      <div><span class="ws-kicker">PERFORMANCE</span><h2>Welcome back, ${esc(ctx.me.name.split(' ')[0])} 👋</h2><p>Track your referral profit and weekly commission in real time.</p></div>
      <div class="ws-head-actions">
        ${segmented([['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']], range, 'agent-range')}
        <button type="button" class="ws-btn ghost" data-copy="${esc(dashboard.profile.referral_url || '')}">${icon('copy')} Copy referral link</button>
      </div>
    </div>
    <div class="ws-promo-strip">
      <div class="ws-promo-copy"><span class="ws-promo-icon">${icon('gift')}</span><div><b>Your promo code is <strong>${esc(dashboard.profile.promo_code)}</strong></b><p>Every customer who joins with it receives 2,000 promotional credits.</p></div></div>
      <div class="ws-promo-actions"><button type="button" class="ws-btn dark" data-copy="${esc(dashboard.profile.promo_code)}">${icon('copy')} ${esc(dashboard.profile.promo_code)}</button><span class="ws-promo-rate">${esc(dashboard.profile.commission_percent)}% weekly cut</span></div>
    </div>
    <div class="ws-stats-grid four">
      ${statCard({ label: 'Total Users', value: num(stats.total_users?.value), iconName: 'users', tone: 'yellow', change: stats.total_users?.change, footer: `<span class="ws-mini-positive">${num(stats.active_users?.value)}</span> active this period` })}
      ${statCard({ label: 'Active Users', value: num(stats.active_users?.value), iconName: 'trend', tone: 'green', change: stats.active_users?.change, footer: 'Played or transacted this period' })}
      ${statCard({ label: 'Deposits', value: `${money(stats.deposits?.value)} <small>ETB</small>`, iconName: 'deposit', tone: 'blue', change: stats.deposits?.change, footer: 'Approved customer deposits' })}
      ${statCard({ label: 'Commission', value: `${money(stats.commission?.value)} <small>ETB</small>`, iconName: 'wallet', tone: 'gold', change: stats.commission?.change, footer: `${esc(dashboard.profile.commission_percent)}% of positive NGR` })}
    </div>
    <div class="ws-layout-2-1">
      <section class="ws-card ws-chart-card">
        <div class="ws-card-head"><div><h2>Profit overview</h2><p>Settled stakes minus gross gaming payouts</p></div><div class="ws-chart-tabs">${segmented([['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']], range, 'agent-range')}</div></div>
        <div class="ws-chart-summary"><div><span>Net gaming revenue</span><b>${etb(Math.max(0, Number(dashboard.stats.ngr?.value || 0)))}</b></div><span class="ws-chart-legend"><i></i> Profit</span></div>
        ${lineChart(dashboard.chart, { value: 'ngr' })}
      </section>
      <section class="ws-card ws-donut-card">
        <div class="ws-card-head"><div><h2>Weekly commission</h2><p>Your 25% share of positive NGR</p></div><span class="ws-live-badge"><i></i> Live</span></div>
        <div class="ws-donut-body">
          ${donutChart(cut, `${Math.round(cut)}%`, 'YOUR CUT')}
          <div class="ws-donut-legend">
            <div><span class="dot yellow"></span><div><b>${etb(donut.commission || 0)}</b><small>Your commission</small></div></div>
            <div><span class="dot slate"></span><div><b>${etb(donut.platform_share || 0)}</b><small>Platform share</small></div></div>
          </div>
        </div>
        <div class="ws-donut-foot"><span>Eligible NGR</span><b>${etb(Math.max(0, donut.ngr || 0))}</b></div>
      </section>
    </div>
    <div class="ws-layout-2-1">
      <section class="ws-card">
        <div class="ws-card-head"><div><h2>Recent users</h2><p>Latest customers in your network</p></div><button type="button" class="ws-text-btn" data-nav-page="users">View all ${icon('arrow')}</button></div>
        ${table(['Customer', 'Joined', 'Status', 'Wallet'], (dashboard.recent_users || []).map((user) => `<tr class="ws-click-row" data-agent-user="${user.id}">
          <td>${userPill(user)}</td><td><span class="ws-cell-sub">${dateShort(user.created_at)}</span></td>
          <td>${pill(user.status)}</td><td><b>${money(user.balance)} ETB</b></td>
        </tr>`), empty('users', 'No referred users yet', 'Share your promo code to start building your network.'))}
      </section>
      <section class="ws-card ws-support-widget">
        <div class="ws-card-head"><div><h2>Live support</h2><p>Conversations assigned to you</p></div><span class="ws-live-badge"><i></i> ${dashboard.support?.open || 0} open</span></div>
        <div class="ws-support-list">
          ${supportTickets.length ? supportTickets.map((ticket) => `<button type="button" class="ws-support-preview" data-support-ticket="${ticket.id}">
            <span class="ws-support-avatar">${avatar(ticket.user_name)}${onlineDot(ticket.user_online || false, '')}</span>
            <span class="ws-support-copy"><b>${esc(ticket.user_name)}</b><em>${esc(ticket.latest_message || ticket.message || 'Support conversation')}</em><small>${timeAgo(ticket.latest_message_at || ticket.updated_at || ticket.created_at)}</small></span>
            ${ticket.unread_count ? `<span class="ws-unread-count">${Number(ticket.unread_count)}</span>` : ''}
          </button>`).join('') : empty('chat', 'No active conversations', 'Customer messages will appear here.')}
        </div>
        <button type="button" class="ws-btn ghost full" data-nav-page="support">${icon('chat')} Open support inbox</button>
      </section>
    </div>
    <section class="ws-card ws-run-rate">
      <div class="ws-run-rate-copy"><span class="ws-kicker">THIS WEEK</span><h3>Your next commission cheque</h3><p>Commission is confirmed after the Addis Ababa week closes and Super Admin reviews it.</p></div>
      <div class="ws-run-rate-grid">
        <div><small>Current week NGR</small><b>${etb(dashboard.stats.ngr?.value || 0)}</b></div>
        <div><small>Estimated commission</small><b class="yellow">${etb(dashboard.stats.commission?.value || 0)}</b></div>
        <div><small>Latest settled week</small><b>${dashboard.latest_settlement ? etb(dashboard.latest_settlement.commission_santim) : 'Not closed yet'}</b></div>
      </div>
      <button type="button" class="ws-btn primary" data-nav-page="earnings">View earnings ${icon('arrow')}</button>
    </section>`;
  }

  async function agentUsers() {
    const params = new URLSearchParams({ search: state.userSearch, status: state.userStatus, limit: '25', offset: String(state.userOffset) });
    const data = await ctx.api(`/agent/users?${params.toString()}`);
    const total = Number(data.total || 0);
    return `<div class="ws-page-head"><div><span class="ws-kicker">NETWORK</span><h2>My Users</h2><p>Every customer permanently attributed to your promo code.</p></div><div class="ws-head-actions"><span class="ws-count-chip"><b>${num(total)}</b> customers</span></div></div>
    <section class="ws-card">
      <div class="ws-toolbar">
        <form id="agent-user-filter" class="ws-search-form">${icon('search')}<input id="agent-user-search" name="search" value="${esc(state.userSearch)}" placeholder="Search name, phone, email or username"><button type="submit" class="ws-btn dark">Search</button></form>
        <div class="ws-toolbar-right"><select id="agent-user-status" class="ws-select"><option value="all" ${state.userStatus === 'all' ? 'selected' : ''}>All statuses</option><option value="active" ${state.userStatus === 'active' ? 'selected' : ''}>Active</option><option value="suspended" ${state.userStatus === 'suspended' ? 'selected' : ''}>Suspended</option></select></div>
      </div>
      ${table(['Customer', 'Joined', 'Status', 'Deposits', 'Rounds', 'NGR', 'Wallet', ''], (data.users || []).map((user) => `<tr>
        <td>${userPill(user)}</td><td><span class="ws-cell-sub">${dateShort(user.created_at)}</span></td>
        <td>${pill(user.status)}</td><td><b>${money(user.deposit_total)} ETB</b><div class="ws-cell-sub">${user.deposit_count} deposits</div></td>
        <td>${num(user.rounds_played)}</td><td class="${Number(user.ngr) >= 0 ? 'ws-positive' : 'ws-negative'}">${money(user.ngr)} ETB</td>
        <td><b>${money(user.balance)} ETB</b>${user.promo_balance ? `<div class="ws-cell-sub">${money(user.promo_balance)} promo</div>` : ''}</td>
        <td><button type="button" class="ws-btn tiny" data-agent-user="${user.id}">View</button></td>
      </tr>`), empty('users', 'No customers found', 'Try a different search or share your referral link.'))}
      ${pagination(total, state.userOffset, 25, 'agent-user-page')}
    </section>`;
  }

  async function agentTransactions() {
    const params = new URLSearchParams({
      type: state.txType, status: state.txStatus, search: state.txSearch,
      start: state.txStart, end: state.txEnd, limit: '25', offset: String(state.txOffset)
    });
    const data = await ctx.api(`/agent/transactions?${params.toString()}`);
    const types = ['all', 'bet', 'win', 'deposit', 'withdrawal', 'agent_commission', 'agent_fee', 'refund'];
    return `<div class="ws-page-head"><div><span class="ws-kicker">LEDGER</span><h2>Transactions</h2><p>Real wallet and game activity across your referrals.</p></div><div class="ws-head-actions"><span class="ws-count-chip"><b>${num(data.total)}</b> entries</span></div></div>
    <section class="ws-card">
      <form id="agent-tx-filter" class="ws-filter-grid">
        <label class="ws-field search">${icon('search')}<input name="search" value="${esc(state.txSearch)}" placeholder="Customer, phone or reference"></label>
        <label class="ws-field"><span>Type</span><select name="type" class="ws-select">${types.map((type) => `<option value="${type}" ${state.txType === type ? 'selected' : ''}>${type === 'all' ? 'All types' : esc(type.replace(/_/g, ' '))}</option>`).join('')}</select></label>
        <label class="ws-field"><span>Status</span><select name="status" class="ws-select">${['all', 'settled', 'pending', 'approved', 'rejected', 'paid'].map((status) => `<option value="${status}" ${state.txStatus === status ? 'selected' : ''}>${status === 'all' ? 'All statuses' : esc(status)}</option>`).join('')}</select></label>
        <label class="ws-field"><span>From</span><input name="start" type="date" value="${esc(state.txStart)}"></label>
        <label class="ws-field"><span>To</span><input name="end" type="date" value="${esc(state.txEnd)}"></label>
        <button type="submit" class="ws-btn primary">Apply</button>
      </form>
      ${table(['Date', 'Customer', 'Type', 'Reference', 'Status', 'Amount', 'Balance after'], (data.transactions || []).map((row) => `<tr>
        <td><span class="ws-cell-sub">${dateTime(row.created_at)}</span></td>
        <td><b>${esc(row.user_name)}</b><div class="ws-cell-sub">${esc(row.phone || '')}</div></td>
        <td><span class="ws-type-chip">${esc(String(row.type).replace(/_/g, ' '))}</span></td>
        <td><span class="ws-mono">${esc(row.reference || '—')}</span></td>
        <td>${pill(row.status)}</td>
        <td class="${Number(row.amount) >= 0 ? 'ws-positive' : 'ws-negative'}"><b>${Number(row.amount) >= 0 ? '+' : ''}${money(row.amount)} ETB</b></td>
        <td>${row.balance_after == null ? '—' : `${money(row.balance_after)} ETB`}</td>
      </tr>`), empty('swap', 'No transactions found', 'Adjust the filters to see more activity.'))}
      ${pagination(data.total, state.txOffset, 25, 'agent-tx-page')}
    </section>`;
  }

  async function agentSupport() {
    const list = await ctx.api(`/agent/tickets?status=${encodeURIComponent(state.supportStatus)}`);
    const tickets = list.tickets || [];
    if (!state.selectedTicket && tickets.length) state.selectedTicket = tickets[0].id;
    let detail = null;
    if (state.selectedTicket) {
      detail = await ctx.api(`/support/ticket/${state.selectedTicket}`);
      state.supportUnread = tickets.reduce((sum, ticket) => sum + Number(ticket.unread_count || 0), 0);
    }
    const selected = detail?.ticket;
    return `<div class="ws-page-head"><div><span class="ws-kicker">CONVERSATIONS</span><h2>Support Chat</h2><p>Replies from your referred and assigned customers arrive here first.</p></div><div class="ws-head-actions"><span class="ws-live-badge"><i></i> Live inbox</span><button type="button" class="ws-btn ghost" id="agent-support-refresh">${icon('refresh')} Refresh</button></div></div>
    <div class="ws-support-shell">
      <section class="ws-card ws-ticket-list">
        <div class="ws-ticket-list-head"><h3>Inbox <span>${tickets.length}</span></h3></div>
        <div class="ws-segmented compact">${[['all','All'],['open','Open'],['escalated','Escalated'],['resolved','Resolved']].map(([value,label]) => `<button type="button" data-support-status="${value}" class="${state.supportStatus === value ? 'on' : ''}">${label}</button>`).join('')}</div>
        <div class="ws-ticket-scroll">${tickets.length ? tickets.map((ticket) => `<button type="button" class="ws-ticket-item ${String(state.selectedTicket) === String(ticket.id) ? 'active' : ''}" data-agent-ticket="${ticket.id}">
          <span class="ws-ticket-avatar">${avatar(ticket.user_name)}${onlineDot(ticket.user_online, '')}</span>
          <span class="ws-ticket-copy"><span><b>${esc(ticket.user_name)}</b><small>${timeAgo(ticket.latest_message_at || ticket.updated_at || ticket.created_at)}</small></span><em>${esc(ticket.latest_message || ticket.message || '')}</em><span class="ws-ticket-meta">${pill(ticket.status)}${ticket.unread_count ? `<i class="ws-unread-count">${ticket.unread_count}</i>` : ''}</span></span>
        </button>`).join('') : empty('chat', 'No conversations', 'Customer messages will land here.')}</div>
      </section>
      <section class="ws-card ws-chat-panel">
        ${selected ? `<div class="ws-chat-head"><div>${avatar(selected.user_name, 'lg')}<div><b>${esc(selected.user_name)}</b><span>${onlineDot(selected.user_online)} · ${esc(selected.user_phone || '')}</span></div></div><div class="ws-chat-actions"><span>${pill(selected.status)}</span><button type="button" class="ws-btn tiny" id="agent-chat-resolve" ${selected.status === 'resolved' ? 'disabled' : ''}>Resolve</button><button type="button" class="ws-btn tiny danger" id="agent-chat-escalate">Escalate</button></div></div>
        <div class="ws-chat-stream" id="ws-chat-stream">${(detail.messages || []).map((message) => `<div class="ws-chat-message ${message.sender_role === 'user' ? 'them' : message.sender_role === 'ai' ? 'ai' : 'me'}"><div class="ws-chat-bubble">${esc(message.message)}</div><span>${message.sender_role === 'ai' ? 'Fetan AI' : esc(message.sender_name)} · ${dateTime(message.created_at)}</span></div>`).join('') || empty('chat', 'No messages yet', '')}</div>
        <form class="ws-chat-compose" id="agent-chat-form"><input id="ws-chat-input" name="message" maxlength="1000" placeholder="Write a reply to ${esc(selected.user_name)}..." autocomplete="off" required><button type="submit" class="ws-btn primary">${icon('arrow')} Send</button></form>
        <div class="ws-chat-foot">${selected.assigned_agent_id ? 'Assigned to you' : 'Unassigned conversation'} · ${selected.user_online ? 'Customer online' : 'Customer offline'}</div>` : empty('chat', 'Select a conversation', 'Choose a ticket from the inbox to start replying.')}
      </section>
      <aside class="ws-card ws-chat-context">
        <h3>Customer details</h3>
        ${selected ? `<div class="ws-context-user">${avatar(selected.user_name, 'xl')}<b>${esc(selected.user_name)}</b><span>${esc(selected.user_phone || '')}</span>${onlineDot(selected.user_online)}</div>
        <dl class="ws-detail-list"><div><dt>Ticket</dt><dd>#${selected.id}</dd></div><div><dt>Status</dt><dd>${pill(selected.status)}</dd></div><div><dt>Opened</dt><dd>${dateShort(selected.created_at)}</dd></div><div><dt>Agent</dt><dd>${esc(selected.agent_name || 'You')}</dd></div><div><dt>Escalation</dt><dd>${esc(selected.escalated_reason || '—')}</dd></div></dl>
        <div class="ws-context-note">${icon('shield')}<p>Only you and Super Admin can review this conversation.</p></div>` : '<p class="ws-muted">Select a ticket to see customer details.</p>'}
      </aside>
    </div>`;
  }

  async function agentEarnings() {
    const data = await ctx.api('/agent/earnings');
    const current = data.current || {};
    const history = data.history || [];
    const latest = history[0];
    const pending = (data.payout_requests || []).filter((request) => request.status === 'pending');
    const canRequestCommission = latest && Number(latest.commission_santim) > Number(latest.commission_paid)
      && !pending.some((request) => request.payout_type === 'commission');
    const canRequestFee = Number(data.profile.weekly_fee_santim) > 0
      && !pending.some((request) => request.payout_type === 'weekly_fee');
    const stages = ['estimated', 'accrued', 'approved', 'paid'];
    return `<div class="ws-page-head"><div><span class="ws-kicker">COMPENSATION</span><h2>My Earnings</h2><p>Your 25% share is calculated only on positive settled net gaming revenue.</p></div><div class="ws-head-actions"><span class="ws-rate-chip"><b>${esc(data.profile.commission_percent)}%</b> weekly commission</span></div></div>
    <div class="ws-stats-grid four">
      ${statCard({ label: 'This week NGR', value: `${money(current.profit_santim)} <small>ETB</small>`, iconName: 'trend', tone: 'green', footer: 'Settled stakes minus payouts' })}
      ${statCard({ label: 'Estimated commission', value: `${money(current.estimated_commission_santim)} <small>ETB</small>`, iconName: 'wallet', tone: 'yellow', footer: '25% of positive NGR after carry' })}
      ${statCard({ label: 'Commission paid', value: `${money(data.totals.commission_paid_santim)} <small>ETB</small>`, iconName: 'check', tone: 'blue', footer: `${history.length} settled weeks` })}
      ${statCard({ label: 'Pending requests', value: `${money(data.totals.pending_requests_santim)} <small>ETB</small>`, iconName: 'clock', tone: 'gold', footer: `${pending.length} awaiting Super Admin` })}
    </div>
    <section class="ws-card ws-stage-card">
      <div class="ws-card-head"><div><h2>Commission lifecycle</h2><p>Every settlement moves through four auditable stages.</p></div><span class="ws-tz-chip">${esc(data.time_zone)}</span></div>
      <div class="ws-stage-track">${stages.map((stage, index) => `<div class="ws-stage ${stage === 'estimated' ? 'current' : ''}"><span class="ws-stage-num">${index + 1}</span><div><b>${stage.charAt(0).toUpperCase() + stage.slice(1)}</b><small>${stage === 'estimated' ? 'Live during the open week' : stage === 'accrued' ? 'Week closed and reviewed' : stage === 'approved' ? 'Cleared for payment' : 'Credited to your wallet'}</small></div></div>`).join('')}</div>
      <div class="ws-current-week">
        <div><span>Week starting</span><b>${dateShort(data.week_start)}</b></div>
        <div><span>Carried loss in</span><b>${etb(current.carried_loss_in_santim || 0)}</b></div>
        <div><span>NGR this week</span><b>${etb(current.profit_santim || 0)}</b></div>
        <div class="highlight"><span>Estimated commission</span><b>${etb(current.estimated_commission_santim || 0)}</b></div>
      </div>
    </section>
    <div class="ws-layout-2-1">
      <section class="ws-card">
        <div class="ws-card-head"><div><h2>Settlement history</h2><p>Closed weeks and their payment status</p></div></div>
        ${table(['Week', 'NGR', 'Commission', 'Paid', 'Stage', ''], history.map((row) => `<tr>
          <td><b>${dateShort(row.week_start)}</b><div class="ws-cell-sub">to ${dateShort(row.week_end)}</div></td>
          <td class="${Number(row.profit_santim) >= 0 ? 'ws-positive' : 'ws-negative'}">${money(row.profit_santim)} ETB</td>
          <td><b>${money(row.commission_santim)} ETB</b></td><td>${money(row.commission_paid)} ETB</td>
          <td>${pill(row.stage)}</td><td>${Number(row.commission_santim) > Number(row.commission_paid) ? `<button type="button" class="ws-btn tiny" data-request-payout="commission" ${!canRequestCommission ? 'disabled' : ''}>Request</button>` : ''}</td>
        </tr>`), empty('wallet', 'No closed weeks yet', 'Your first settlement will appear after a full week closes.'))}
      </section>
      <section class="ws-card">
        <div class="ws-card-head"><div><h2>Payout requests</h2><p>Submitted to Super Admin</p></div></div>
        <div class="ws-request-actions"><button type="button" class="ws-btn primary full" data-request-payout="commission" ${canRequestCommission ? '' : 'disabled'}>Request commission</button><button type="button" class="ws-btn ghost full" data-request-payout="weekly_fee" ${canRequestFee ? '' : 'disabled'}>Request weekly fee</button></div>
        ${table(['Type', 'Amount', 'Status'], (data.payout_requests || []).slice(0, 8).map((request) => `<tr><td><span class="ws-type-chip">${esc(request.payout_type.replace(/_/g, ' '))}</span><div class="ws-cell-sub">${dateShort(request.created_at)}</div></td><td><b>${money(request.amount_santim)} ETB</b></td><td>${pill(request.status)}</td></tr>`), empty('clock', 'No payout requests', 'You can request approved compensation here.'))}
      </section>
    </div>`;
  }

  async function agentProfile() {
    const data = await ctx.api('/agent/profile');
    const profile = data.profile || {};
    return `<div class="ws-page-head"><div><span class="ws-kicker">ACCOUNT</span><h2>Profile</h2><p>Manage the identity customers see when they contact you.</p></div><div class="ws-head-actions"><span class="ws-count-chip">${pill(profile.status)}</span></div></div>
    <div class="ws-layout-2-1">
      <section class="ws-card">
        <div class="ws-card-head"><div><h2>Personal details</h2><p>Your login and agent contact information</p></div></div>
        <form id="agent-profile-form" class="ws-form-grid">
          <label class="ws-field"><span>Full name</span><input name="name" value="${esc(profile.name)}" minlength="2" maxlength="60" required></label>
          <label class="ws-field"><span>Phone</span><input value="${esc(profile.phone)}" disabled><small>Phone login changes require Super Admin.</small></label>
          <label class="ws-field"><span>Username</span><input name="username" value="${esc(profile.username || '')}" placeholder="letters, numbers, dot, dash" maxlength="30"></label>
          <label class="ws-field"><span>Email address</span><input name="email" type="email" value="${esc(profile.email || '')}" maxlength="160" placeholder="you@example.com"></label>
          <label class="ws-field full"><span>Contact details</span><input name="contact_info" value="${esc(profile.contact_info || '')}" maxlength="200" placeholder="Telegram, WhatsApp or office address"></label>
          <div class="ws-form-actions"><button type="submit" class="ws-btn primary">Save changes</button></div>
        </form>
      </section>
      <aside class="ws-card ws-referral-card">
        <div class="ws-referral-icon">${icon('gift')}</div>
        <h3>Your referral tools</h3><p>Share this link and code. New customers receive 2,000 promotional credits.</p>
        <label class="ws-field"><span>Promo code</span><div class="ws-copy-row"><input value="${esc(profile.promo_code)}" readonly><button type="button" class="ws-btn dark" data-copy="${esc(profile.promo_code)}">${icon('copy')}</button></div></label>
        <label class="ws-field"><span>Referral link</span><div class="ws-copy-row"><input value="${esc(profile.referral_url)}" readonly><button type="button" class="ws-btn dark" data-copy="${esc(profile.referral_url)}">${icon('copy')}</button></div></label>
        <dl class="ws-detail-list"><div><dt>Commission</dt><dd><b>${esc(profile.commission_percent)}% weekly</b></dd></div><div><dt>Member since</dt><dd>${dateShort(profile.created_at)}</dd></div><div><dt>Last active</dt><dd>${profile.last_seen_at ? dateTime(profile.last_seen_at) : '—'}</dd></div></dl>
        <div class="ws-security-note">${icon('shield')}<p>Your promo code is permanent. Customer attribution cannot be changed from your side.</p></div>
      </aside>
    </div>`;
  }

  function pagination(total, offset, limit, action) {
    if (!total) return '';
    const from = total ? offset + 1 : 0;
    const to = Math.min(offset + limit, total);
    return `<div class="ws-pagination"><span>Showing <b>${from}–${to}</b> of <b>${num(total)}</b></span><div><button type="button" class="ws-btn tiny" data-page-action="${action}" data-dir="prev" ${offset <= 0 ? 'disabled' : ''}>Previous</button><button type="button" class="ws-btn tiny" data-page-action="${action}" data-dir="next" ${offset + limit >= total ? 'disabled' : ''}>Next</button></div></div>`;
  }

  // =====================================================
  // SUPER ADMIN PAGES
  // =====================================================

  function pendingBadge(value) {
    if (!value) return '<span class="ws-pill muted">None</span>';
    return `<span class="ws-pill danger">${num(value)} pending</span>`;
  }

  function managementTabs() {
    return `<div class="ws-toolbar"><div class="ws-segmented">${[['agents', 'Agents'], ['commissions', 'Commissions']].map(([value, label]) => `<button type="button" data-management-tab="${value}" class="${state.managementTab === value ? 'on' : ''}">${label}</button>`).join('')}</div></div>`;
  }

  async function superDashboard() {
    const range = state.superRange;
    const [dash, performance] = await Promise.all([
      ctx.api(`/superadmin/dashboard?range=${encodeURIComponent(range)}`),
      ctx.api(`/superadmin/agent-performance?period=${encodeURIComponent(state.perfPeriod)}`).catch(() => ({ agents: [] }))
    ]);
    state.pendingApprovals = Number(dash.stats?.pending_approvals?.value || 0);
    state.supportUnread = Number(dash.support?.unread || 0);
    const badge = document.getElementById('ws-nav-approval-badge');
    if (badge) { badge.textContent = state.pendingApprovals; badge.hidden = !state.pendingApprovals; }
    const supportBadge = document.getElementById('ws-nav-support-badge');
    if (supportBadge) { supportBadge.textContent = state.supportUnread || ''; supportBadge.hidden = !state.supportUnread; }
    const donut = dash.donut || {};
    const pendingRows = state.pendingTab === 'withdrawals' ? (dash.pending_withdrawals || []) : (dash.pending_deposits || []);
    const perfRows = (performance.agents || []).slice(0, 8);
    return `<div class="ws-page-head">
      <div><span class="ws-kicker">PLATFORM</span><h2>Executive Desk</h2><p>Deposits, withdrawals, agents and approvals across FETAN BET.</p></div>
      <div class="ws-head-actions">
        ${segmented([['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']], range, 'super-range')}
        <button type="button" class="ws-btn ghost" id="ws-super-refresh">${icon('refresh')} Refresh</button>
      </div>
    </div>
    <div class="ws-stats-grid five">
      ${statCard({ label: 'Total Users', value: num(dash.stats.total_users?.value), iconName: 'users', tone: 'yellow', change: dash.stats.total_users?.change, footer: `${dash.stats.total_users?.new || 0} new this period` })}
      ${statCard({ label: 'Active Agents', value: num(dash.stats.active_agents?.value), iconName: 'agents', tone: 'green', footer: `${num(dash.stats.active_agents?.total)} total · ${num(dash.stats.active_agents?.online)} online` })}
      ${statCard({ label: 'Deposits', value: etb(dash.stats.deposits?.value), iconName: 'deposit', tone: 'blue', footer: `${num(dash.stats.deposits?.count)} settled` })}
      ${statCard({ label: 'Pending Approvals', value: num(dash.stats.pending_approvals?.value), iconName: 'clock', tone: 'danger', footer: `${num(dash.stats.pending_approvals?.deposits)} deposits · ${num(dash.stats.pending_approvals?.withdrawals)} withdrawals` })}
      ${statCard({ label: 'Commission', value: etb(dash.stats.commission?.value), iconName: 'wallet', tone: 'gold', change: dash.stats.commission?.change, footer: `25% weekly cut` })}
    </div>
    <div class="ws-layout-2-1">
      <section class="ws-card ws-chart-card">
        <div class="ws-card-head"><div><h2>Agent P&amp;L</h2><p>Weekly net gaming revenue across the referral network.</p></div><span class="ws-live-badge"><i></i> 8 weeks</span></div>
        ${agentBarChart(dash.weekly_trend, 'bucket')}
      </section>
      <section class="ws-card ws-donut-card">
        <div class="ws-card-head"><div><h2>25% Weekly Cut</h2><p>Platform share versus agent commission.</p></div></div>
        <div class="ws-donut-body">
          ${donutChart(Math.min(100, donut.commission > 0 ? (Number(donut.commission) / Math.max(1, Number(donut.ngr))) * 100 : 0), `${money(Math.max(0, donut.commission || 0))}`, 'AGENT COMMISSION')}
          <div class="ws-donut-legend">
            <div><span class="dot yellow"></span><div><b>${etb(donut.commission || 0)}</b><small>Agent commission pool</small></div></div>
            <div><span class="dot slate"></span><div><b>${etb(donut.platform_share || 0)}</b><small>Platform share</small></div></div>
          </div>
        </div>
        <div class="ws-donut-foot"><span>Eligible NGR this week</span><b>${etb(Math.max(0, donut.ngr || 0))}</b></div>
      </section>
    </div>
    <div class="ws-layout-2-1">
      <section class="ws-card ws-performance-card">
        <div class="ws-card-head"><div><h2>Agent Performance</h2><p>Ranked by net gaming revenue.</p></div><div class="ws-chart-tabs">${segmented([['weekly', 'Weekly'], ['monthly', 'Monthly']], state.perfPeriod, 'super-perf')}</div></div>
        ${table(['Rank', 'Agent', 'Code', 'NGR', 'Commission', 'Users'], perfRows.map((row) => `<tr>
          <td><b>${num(row.rank)}</b></td>
          <td>${avatar(row.name)}<div><b>${esc(row.name)}</b><div class="ws-cell-sub">${esc(row.phone || '')}</div></div></td>
          <td><span class="ws-mono">${esc(row.promo_code || '—')}</span></td>
          <td class="${Number(row.ngr) >= 0 ? 'ws-positive' : 'ws-negative'}">${money(row.ngr)} ETB</td>
          <td><b>${money(row.commission)} ETB</b></td><td>${num(row.total_users || 0)}</td>
        </tr>`), empty('agents', 'No agents yet', 'Create agents in Agent Management.'))}
        <div class="ws-card-foot"><button type="button" class="ws-text-btn" data-nav-page="agents">Open agent management ${icon('arrow')}</button></div>
      </section>
      <section class="ws-card ws-approval-card">
        <div class="ws-card-head"><div><h2>Pending Approvals</h2><p>Only Super Admin can release these.</p></div><span class="ws-count-chip"><b>${num(state.pendingApprovals)}</b> waiting</span></div>
        <div class="ws-segmented pending-tabs">
          <button type="button" data-pending-tab="deposits" class="${state.pendingTab === 'deposits' ? 'on' : ''}">Deposits ${dash.stats.pending_approvals?.deposits ? `<b>${num(dash.stats.pending_approvals.deposits)}</b>` : ''}</button>
          <button type="button" data-pending-tab="withdrawals" class="${state.pendingTab === 'withdrawals' ? 'on' : ''}">Withdrawals ${dash.stats.pending_approvals?.withdrawals ? `<b>${num(dash.stats.pending_approvals.withdrawals)}</b>` : ''}</button>
        </div>
        <div class="ws-pending-list">
          ${pendingRows.length ? pendingRows.map((row) => `<button type="button" class="ws-pending-row" data-pending-open="${row.id}" data-pending-kind="${state.pendingTab}">
            ${avatar(row.user_name, 'sm')}<span><b>${esc(row.user_name)}</b><small>${esc(row.phone || row.tx_ref || row.account_number || '')} · ${timeAgo(row.created_at)}</small></span><strong>${money(row.amount)} <small>ETB</small></strong>${icon('arrow')}
          </button>`).join('') : empty('check', state.pendingTab === 'deposits' ? 'No pending deposits' : 'No pending withdrawals', 'The queue is clear.')}
        </div>
        <div class="ws-notification-list">
          <h4>Live notifications</h4>
          ${(dash.notifications || []).length ? (dash.notifications || []).slice(0, 4).map((item) => `<button type="button" class="ws-notif-item ${item.is_read ? '' : 'unread'}" data-notification-link="${esc(notificationLink(item))}">${icon('bell')}<div><b>${esc(item.title)}</b><small>${timeAgo(item.created_at)}</small></div></button>`).join('') : `<p class="ws-muted" style="font-size:12.5px">New alerts will appear here.</p>`}
        </div>
      </section>
    </div>`;
  }

  function agentBarChart(items, labelKey = 'bucket') {
    const data = Array.isArray(items) ? items : [];
    if (!data.length) return empty('trend', 'No agent data yet', 'Settled activity will appear here.');
    const values = data.map((row) => Number(row.ngr || 0));
    const max = Math.max(1, ...values.map((value) => Math.abs(value)));
    return `<div class="ws-bar-chart">
      ${data.map((row, index) => {
        const value = values[index];
        const height = Math.max(2, Math.round((Math.abs(value) / max) * 100));
        const label = String(row[labelKey] || row.name || row.agent_name || '').slice(0, 14);
        return `<div class="ws-bar-col" title="${esc(label)} — ${money(value)} ETB">
          <div class="ws-bar-track"><div class="ws-bar-fill ${value < 0 ? 'negative' : ''}" style="height:${height}%"><span class="ws-bar-value">${money(value)}</span></div></div>
          <span class="ws-bar-label">${esc(label)}</span>
        </div>`;
      }).join('')}
    </div>`;
  }

  async function superUsers() {
    const params = new URLSearchParams({
      search: state.superUserSearch, role: state.superUserRole, status: state.superUserStatus,
      limit: '25', offset: String(state.superUserOffset)
    });
    const data = await ctx.api(`/superadmin/users?${params.toString()}`);
    return `<div class="ws-page-head"><div><span class="ws-kicker">DIRECTORY</span><h2>Users</h2><p>All platform customers with wallets and referral attribution.</p></div><div class="ws-head-actions"><span class="ws-count-chip"><b>${num(data.total)}</b> users</span></div></div>
    <section class="ws-card">
      <div class="ws-toolbar">
        <form id="super-user-filter" class="ws-search-form">${icon('search')}<input id="super-user-search" name="search" value="${esc(state.superUserSearch)}" placeholder="Search name, phone, email or username"><button type="submit" class="ws-btn dark">Search</button></form>
        <div class="ws-toolbar-right">
          <select id="super-user-role" class="ws-select">
            <option value="user" ${state.superUserRole === 'user' ? 'selected' : ''}>Customers</option>
            <option value="agent" ${state.superUserRole === 'agent' ? 'selected' : ''}>Agents</option>
            <option value="all" ${state.superUserRole === 'all' ? 'selected' : ''}>All roles</option>
          </select>
          <select id="super-user-status" class="ws-select">
            <option value="all" ${state.superUserStatus === 'all' ? 'selected' : ''}>All statuses</option>
            <option value="active" ${state.superUserStatus === 'active' ? 'selected' : ''}>Active</option>
            <option value="suspended" ${state.superUserStatus === 'suspended' ? 'selected' : ''}>Suspended</option>
          </select>
        </div>
      </div>
      ${table(['Customer', 'Contact', 'Role', 'Agent', 'Wallet', 'Promo', 'Status', ''], (data.users || []).map((row) => `<tr>
        <td>${userPill(row)}</td><td>${esc(row.email || row.username || row.phone || '')}</td>
        <td><span class="ws-role-chip ws-role-${esc(String(row.role)).toLowerCase()}">${esc(row.role)}</span></td>
        <td>${row.referred_by_agent_id ? `${avatar(row.agent_name || 'Agent', 'sm')} <span class="ws-mono">#${num(row.referred_by_agent_id)}</span>` : '<span class="ws-muted">—</span>'}</td>
        <td><b>${money(row.balance)} ETB</b></td>
        <td>${money(row.promo_balance)} ETB</td>
        <td>${pill(row.status)}</td>
        <td><button type="button" class="ws-btn tiny" data-super-user="${row.id}">View</button></td>
      </tr>`), empty('users', 'No users found', 'Try a different search.'))}
      ${pagination(data.total, state.superUserOffset, 25, 'super-user-page')}
    </section>`;
  }

  async function openSuperUserDetail(id) {
    const data = await ctx.api(`/superadmin/users/${id}`);
    const user = data.user || {};
    const active = user.status === 'active';
    openModal(`Customer · ${user.name}`, `<div class="ws-modal-user">${avatar(user.name, 'xl')}<div>
      <h3>${esc(user.name)}</h3>
      <span>${esc(user.phone || '')} · ${esc(user.role)} · ${user.role !== 'superadmin' ? `referred by ${user.agent_name || 'nobody'} ` : ''}</span>
      <div class="ws-modal-badges">${pill(user.status)}${user.promo_balance ? `<span class="ws-pill warning">${money(user.promo_balance)} promo credits</span>` : ''}</div>
    </div></div>
    <div class="ws-modal-stats">
      <div><span>Wallet</span><b>${money(user.balance)} ETB</b></div>
      <div><span>Promo credits</span><b>${money(user.promo_balance)} ETB</b></div>
      <div><span>Referral bonus</span><b>${user.referral_bonus == null ? '—' : `${money(user.referral_bonus)} ETB`}</b></div>
      <div><span>Deposits</span><b>${money(user.deposit_total)} ETB</b></div>
      <div><span>NGR</span><b class="${Number(user.ngr) >= 0 ? 'ws-positive' : 'ws-negative'}">${money(user.ngr)} ETB</b></div>
    </div>
    <div class="ws-modal-tabs"><button type="button" class="on" data-modal-tab="ledger">Wallet ledger</button><button type="button" data-modal-tab="deposits">Deposits</button><button type="button" data-modal-tab="withdrawals">Withdrawals</button><button type="button" data-modal-tab="games">Games</button><button type="button" data-modal-tab="tickets">Tickets</button></div>
    <div id="ws-modal-tab-body">${table(['Date', 'Type', 'Amount', 'Balance after'], (data.ledger || []).map((row) => `<tr><td>${dateTime(row.created_at)}</td><td><span class="ws-type-chip">${esc(row.type)}</span></td><td class="${Number(row.amount) >= 0 ? 'ws-positive' : 'ws-negative'}">${Number(row.amount) >= 0 ? '+' : ''}${money(row.amount)} ETB</td><td>${money(row.balance_after)} ETB</td></tr>`))}</div>
    <div class="ws-modal-actions">
      <button type="button" class="ws-btn ghost" data-user-action="toggle">${active ? 'Suspend account' : 'Reactivate account'}</button>
      ${user.role === 'user' && ctx.me.role === 'superadmin' ? `<button type="button" class="ws-btn dark" data-user-action="reassign">Change attribution</button>` : ''}
    </div>`, async (modal) => {
      const bodies = {
        ledger: () => table(['Date', 'Type', 'Amount', 'Balance after'], (data.ledger || []).map((row) => `<tr><td>${dateTime(row.created_at)}</td><td><span class="ws-type-chip">${esc(row.type)}</span></td><td class="${Number(row.amount) >= 0 ? 'ws-positive' : 'ws-negative'}">${money(row.amount)} ETB</td><td>${money(row.balance_after)} ETB</td></tr>`)),
        deposits: () => table(['Date', 'Provider', 'Amount', 'Status'], (data.deposits || []).map((row) => `<tr><td>${dateTime(row.created_at)}</td><td>${esc(row.provider)}</td><td>${money(row.amount)} ETB</td><td>${pill(row.status)}</td></tr>`)),
        withdrawals: () => table(['Date', 'Provider', 'Amount', 'Status'], (data.withdrawals || []).map((row) => `<tr><td>${dateTime(row.created_at)}</td><td>${esc(row.provider)}</td><td>${money(row.amount)} ETB</td><td>${pill(row.status)}</td></tr>`)),
        games: () => table(['Game', 'Rounds', 'Stakes', 'Payouts', 'NGR'], (data.games || []).map((row) => `<tr><td><b>${esc(row.game)}</b></td><td>${num(row.rounds)}</td><td>${money(row.stakes)} ETB</td><td>${money(row.payouts)} ETB</td><td class="${Number(row.ngr) >= 0 ? 'ws-positive' : 'ws-negative'}">${money(row.ngr)} ETB</td></tr>`)),
        tickets: () => table(['Ticket', 'Status', 'Opened'], (data.tickets || []).map((row) => `<tr><td><b>#${row.id}</b></td><td>${pill(row.status)}</td><td>${dateTime(row.created_at)}</td></tr>`))
      };
      modal.querySelectorAll('[data-modal-tab]').forEach((button) => {
        button.addEventListener('click', () => {
          modal.querySelectorAll('[data-modal-tab]').forEach((item) => item.classList.toggle('on', item === button));
          document.getElementById('ws-modal-tab-body').innerHTML = bodies[button.dataset.modalTab]();
        });
      });
      const runAction = async (action) => {
        if (action === 'reassign') {
          try { await openSuperReassign(user); } catch (_) { /* fallback */ }
          return;
        }
        openReauth({
          title: active ? 'Suspend account' : 'Reactivate account',
          message: `Confirm your Super Admin password to ${active ? 'suspend' : 'reactivate'} ${user.name}.`,
          confirmLabel: active ? 'Suspend account' : 'Reactivate account',
          tone: active ? 'bad' : 'primary',
          onConfirm: async (password) => {
            await ctx.api(`/superadmin/users/${id}`, { status: active ? 'suspended' : 'active', reauth_password: password }, 'PATCH');
            ctx.success(`Account ${active ? 'suspended' : 'reactivated'}.`);
            closeModalIfOpen(modal);
            renderPage();
          }
        });
      };
      modal.querySelectorAll('[data-user-action]').forEach((button) => {
        button.addEventListener('click', () => runAction(button.dataset.userAction));
      });
      const closeModalIfOpen = (el) => { el.remove(); document.body.classList.remove('ws-modal-open'); };
    });
  }

  async function openSuperReassign(user) {
    const agents = (await ctx.api('/superadmin/agents?limit=100&search=')).agents || [];
    openModal(`Reassign ${esc(user.name)}`, `<form class="ws-form-grid full-form">
      <label class="ws-field"><span>Customer</span><b>${esc(user.name)}</b> · #${num(user.id)}</label>
      <label class="ws-field"><span>New agent</span><select name="agent_id"><option value="">Remove attribution</option>${agents.map((agent) => `<option value="${String(agent.id)}">${esc(agent.name)} · ${esc(agent.promo_code)}</option>`).join('')}</select></label>
      <label class="ws-field"><span>Reason</span><input name="reason" minlength="3" maxlength="300" required placeholder="Why is attribution changing?"></label>
      ${passwordField()}
      <div class="ws-form-actions full"><button type="submit" class="ws-btn primary">Update attribution</button></div>
    </form>`, (modal) => {
      const form = modal.querySelector('.ws-form-grid');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(form));
        const submit = form.querySelector('button[type="submit"]');
        submit.disabled = true;
        clearFormError(form);
        try {
          await ctx.api(`/superadmin/users/${user.id}/reassign-agent`, {
            agent_id: data.agent_id || null,
            reason: data.reason,
            reauth_password: data.reauth_password
          });
          ctx.success('Referral attribution updated.');
          renderPage();
          modal.remove();
          document.body.classList.remove('ws-modal-open');
        } catch (error) {
          ctx.fail(error);
          showFormError(form, error);
          submit.disabled = false;
        }
      });
    });
  }

  async function superAgents() {
    const data = await ctx.api(`/superadmin/agents?limit=100&search=${encodeURIComponent(state.superUserSearch || '')}`);
    return `<div class="ws-page-head"><div><span class="ws-kicker">NETWORK</span><h2>Agents</h2><p>Create, edit, suspend and credit every agent account.</p></div><div class="ws-head-actions"><span class="ws-count-chip"><b>${num(data.total)}</b> agents</span><button type="button" class="ws-btn primary" id="super-create-agent">${icon('user')} Create agent</button></div></div>
    <section class="ws-card">
      <div class="ws-toolbar"><form id="super-agent-filter" class="ws-search-form">${icon('search')}<input name="search" value="${esc(state.superUserSearch || '')}" placeholder="Search name, phone or promo code"><button type="submit" class="ws-btn dark">Search</button></form></div>
      ${table(['Agent / code', 'Status', 'Users', 'New 24h / week', 'Referral link', ''], (data.agents || []).map((row) => `<tr>
        <td>${avatar(row.name)}<div><b>${esc(row.name)}</b><div class="ws-cell-sub">${esc(row.phone || '')}</div></div></td>
        <td>${pill(row.status)}</td><td><b>${num(row.referred_users)}</b><div class="ws-cell-sub">${num(row.new_users_24h)} / ${num(row.new_users_week)}</div></td>
        <td><span class="ws-mono copyable">${esc(row.promo_code)}</span></td>
        <td><a class="ws-link">${esc(row.referral_url || '#')}</a></td>
        <td><button type="button" class="ws-btn tiny" data-super-agent-edit="${row.id}">Edit</button> <button type="button" class="ws-btn tiny ${row.status === 'active' ? 'bad' : 'alt'}" data-super-agent-status="${row.id}" data-status="${row.status}">${row.status === 'active' ? 'Suspend' : 'Reactivate'}</button></td>
      </tr>`), empty('agents', 'No agents found', 'Create your first agent account.'))}
    </section>`;
  }

  async function superDepositRequests() {
    const params = new URLSearchParams({ status: state.depositStatus, search: state.depositSearch, limit: '50', offset: '0' });
    const data = await ctx.api(`/superadmin/deposits?${params.toString()}`);
    const pending = data.deposits.filter((row) => row.status === 'pending');
    return `<div class="ws-page-head"><div><span class="ws-kicker">FINANCE</span><h2>Deposit Requests</h2><p>Only Super Admin can approve customer deposits.</p></div><div class="ws-head-actions">${segmented([['pending','Pending'],['approved','Approved'],['rejected','Rejected'],['all','All']], state.depositStatus, 'deposit-status')}<button type="button" class="ws-btn ghost" id="super-deposit-refresh">${icon('refresh')} Refresh</button></div></div>
    <section class="ws-card">
      <form id="super-deposit-filter" class="ws-filter-grid">
        <label class="ws-field">${icon('search')}<input name="search" value="${esc(state.depositSearch)}" placeholder="Customer, phone or reference"></label>
        <button type="submit" class="ws-btn dark">Apply</button>
      </form>
      ${table(['Customer', 'Provider', 'Amount', 'Ref', 'Receipt', 'Status', ''], (data.deposits || []).map((row) => `<tr>
        <td>${userPill(row)}</td><td><b>${esc(row.provider)}</b></td><td><b>${money(row.amount)} ETB</b></td><td class="ws-mono">${esc(row.tx_ref)}</td><td><span class="ws-cell-badge">${row.has_receipt ? 'Attached' : 'None'}</span></td><td>${pill(row.status)}</td><td>${row.status === 'pending' ? `<button type="button" class="ws-btn tiny" data-deposit-review="${row.id}">Review</button>` : ''}</td>
      </tr>`), empty('deposit', 'No deposit requests', 'New customer deposits appear here.'))}
    </section>
    <div class="ws-quick-actions">
      ${pending.length ? `<button type="button" class="ws-btn primary full" id="super-review-deposit">${icon('check')} Review oldest pending deposit</button>` : `<p class="ws-muted">No pending deposits.</p>`}</div>`;
  }

  async function superWithdrawalRequests() {
    const params = new URLSearchParams({ status: state.withdrawalStatus, search: state.withdrawalSearch, limit: '50', offset: '0' });
    const data = await ctx.api(`/superadmin/withdrawals?${params.toString()}`);
    const pending = data.withdrawals.filter((row) => row.status === 'pending');
    return `<div class="ws-page-head"><div><span class="ws-kicker">FINANCE</span><h2>Withdrawal Requests</h2><p>Approve payouts and confirm external payment.</p></div><div class="ws-head-actions">${segmented([['pending','Pending'],['approved','Approved'],['paid','Paid'],['rejected','Rejected'],['all','All']], state.withdrawalStatus, 'withdrawal-status')}<button type="button" class="ws-btn ghost" id="super-withdrawal-refresh">${icon('refresh')} Refresh</button></div></div>
    <section class="ws-card">
      <form id="super-withdrawal-filter" class="ws-filter-grid">
        <label class="ws-field">${icon('search')}<input name="search" value="${esc(state.withdrawalSearch)}" placeholder="Customer, phone or account"></label>
        <button type="submit" class="ws-btn dark">Apply</button>
      </form>
      ${table(['Customer', 'Method', 'Amount', 'Destination', 'Status', ''], (data.withdrawals || []).map((row) => `<tr>
        <td>${userPill(row)}</td><td><b>${esc(row.provider)}</b></td><td><b>${money(row.amount)} ETB</b></td><td class="ws-mono">${esc(row.account_number)}</td><td>${pill(row.status)}</td><td>
          ${row.status === 'pending' ? `<button type="button" class="ws-btn tiny" data-withdraw-review="${row.id}">Review</button>` : row.status === 'approved' ? `<button type="button" class="ws-btn tiny" data-withdraw-complete="${row.id}">Mark paid</button>` : ''}
        </td>
      </tr>`), empty('withdraw', 'No withdrawal requests', 'New withdrawal requests appear here.'))}
    </section>
    <div class="ws-quick-actions">
      ${pending.length ? `<button type="button" class="ws-btn primary full" id="super-review-withdrawal">${icon('check')} Review oldest pending withdrawal</button>` : `<p class="ws-muted">No pending withdrawals.</p>`}</div>`;
  }

  async function superManagement() {
    if (state.managementTab === 'commissions') {
      const [commissions] = await Promise.all([
        ctx.api('/superadmin/commissions').catch(() => ({ settlements: [], estimated: [] }))
      ]);
      const estimated = commissions.estimated || [];
      const settlements = commissions.settlements || [];
      return `<div class="ws-page-head"><div><span class="ws-kicker">COMPENSATION</span><h2>Agent Management</h2><p>Commission review and settlement control.</p></div></div>
      ${managementTabs()}
      <div class="ws-layout-2-1">
        <section class="ws-card">
          <div class="ws-card-head"><div><h2>This week — estimated commission</h2><p>${esc(commissions.week_start ? dateShort(commissions.week_start) : '—')}</p></div></div>
          ${table(['Agent', 'Code', 'NGR', 'Carry-in', 'Commission'], estimated.map((row) => `<tr>
            <td>${avatar(row.agent_name)}<div><b>${esc(row.agent_name)}</b><div class="ws-cell-sub">#${num(row.agent_id)}</div></div></td>
            <td class="ws-mono">${esc(row.promo_code || '—')}</td>
            <td>${money(row.ngr)} ETB</td>
            <td class="${Number(row.carried_loss_in_santim) > 0 ? 'ws-negative' : 'ws-muted'}">${money(row.carried_loss_in_santim || 0)} ETB</td>
            <td class="yellow"><b>${money(row.commission_santim)} ETB</b></td>
          </tr>`), empty('wallet', 'No agent activity yet', 'Commission appears once settled weeks close.'))}
        </section>
        <section class="ws-card">
          <div class="ws-card-head"><div><h2>Closed settlements</h2><p>Stage and payment history.</p></div></div>
          ${table(['Agent', 'Week', 'NGR', 'Commission', 'Paid', 'Stage', ''], settlements.map((row) => `<tr>
            <td>${avatar(row.agent_name)}<div><b>${esc(row.agent_name)}</b></div></td>
            <td class="ws-mono">${dateShort(row.week_start)}</td>
            <td>${money(row.profit_santim)} ETB</td>
            <td><b>${money(row.commission_santim)} ETB</b></td><td>${money(row.commission_paid)} ETB</td>
            <td>${pill(row.stage)}</td>
            <td>
              ${row.stage === 'accrued' && Number(row.commission_santim) > 0 ? `<button type="button" class="ws-btn tiny" data-commission-approve="${row.id}">Approve</button>` : ''}
              ${row.stage === 'approved' ? `<button type="button" class="ws-btn tiny bad" data-commission-pay="${row.id}">Pay</button>` : ''}
            </td>
          </tr>`), empty('wallet', 'No closed weeks yet', 'Close a previous week in Super Admin settlements.'))}
        </section>
      </div>`;
    }
    const data = await ctx.api(`/superadmin/agents?limit=100&search=${encodeURIComponent(state.superUserSearch || '')}`);
    return `<div class="ws-page-head"><div><span class="ws-kicker">NETWORK</span><h2>Agent Management</h2><p>Create, edit, suspend and credit agent accounts.</p></div><div class="ws-head-actions"><span class="ws-count-chip"><b>${num(data.total)}</b> agents</span><button type="button" class="ws-btn primary" id="super-create-agent">${icon('user')} Create agent</button></div></div>
    ${managementTabs()}
    <section class="ws-card">
      <div class="ws-toolbar"><form id="super-agent-filter" class="ws-search-form">${icon('search')}<input name="search" value="${esc(state.superUserSearch || '')}" placeholder="Search name, phone or promo code"><button type="submit" class="ws-btn dark">Search</button></form></div>
      ${table(['Agent / code', 'Status', 'Users', 'New 24h / week', 'Referral link', ''], (data.agents || []).map((row) => `<tr>
        <td>${avatar(row.name)}<div><b>${esc(row.name)}</b><div class="ws-cell-sub">${esc(row.phone || '')}</div></div></td>
        <td>${pill(row.status)}</td><td><b>${num(row.referred_users)}</b><div class="ws-cell-sub">${num(row.new_users_24h)} / ${num(row.new_users_week)}</div></td>
        <td><span class="ws-mono copyable">${esc(row.promo_code)}</span></td>
        <td><a class="ws-link">${esc(row.referral_url || '#')}</a></td>
        <td><button type="button" class="ws-btn tiny" data-super-agent-edit="${row.id}">Edit</button> <button type="button" class="ws-btn tiny ${row.status === 'active' ? 'bad' : 'alt'}" data-super-agent-status="${row.id}" data-status="${row.status}">${row.status === 'active' ? 'Suspend' : 'Reactivate'}</button></td>
      </tr>`), empty('agents', 'No agents found', 'Create your first agent account.'))}
    </section>`;
  }

  async function superReports() {
    const startDate = state.reportStart || eatDateLabel(new Date(Date.now() - 29 * DAY_MS));
    const endDate = state.reportEnd || eatDateLabel(new Date());
    state.reportStart = startDate;
    state.reportEnd = endDate;
    const report = await ctx.api(`/superadmin/reports?start=${encodeURIComponent(startDate)}&end=${encodeURIComponent(endDate)}`).catch(() => ({ summary: {}, daily: [], games: [], agents: [], commission: {} }));
    state.reportData = report;
    const s = report.summary || {};
    return `<div class="ws-page-head"><div><span class="ws-kicker">REPORTING</span><h2>Reports</h2><p>Financial performance and agent overview for a custom period.</p></div><div class="ws-head-actions"><form id="super-report-filter" class="ws-report-filter">
      <label class="ws-report-field"><span>From</span><input name="start" type="date" value="${esc(state.reportStart)}"></label>
      <label class="ws-report-field"><span>To</span><input name="end" type="date" value="${esc(state.reportEnd)}"></label>
      <button type="submit" class="ws-btn primary">Apply</button>
      <button type="button" class="ws-btn dark" id="super-report-csv">📥 Export CSV</button>
    </form></div></div>
    <div class="ws-stats-grid four">
      ${statCard({ label: 'New Users', value: num(s.new_users), iconName: 'users', tone: 'yellow' })}
      ${statCard({ label: 'Deposits', value: etb(s.deposit_total), iconName: 'deposit', tone: 'blue', footer: `${num(s.deposit_count)} settled` })}
      ${statCard({ label: 'Withdrawals', value: etb(s.withdrawal_total), iconName: 'withdraw', tone: 'gold', footer: `${num(s.withdrawal_count)} paid` })}
      ${statCard({ label: 'Commission', value: etb(s.commission_accrued), iconName: 'wallet', tone: 'green', footer: `${num(s.settlement_count)} settlements` })}
    </div>
    <div class="ws-layout-2-1">
      <section class="ws-card ws-chart-card">
        <div class="ws-card-head"><div><h2>Daily NGR Trend</h2><p>Stakes minus payouts per day.</p></div></div>
        ${lineChart(report.daily.map((row) => ({ bucket: row.date, ngr: Number(row.ngr || 0) })), { value: 'ngr' })}
      </section>
      <section class="ws-card">
        <div class="ws-card-head"><div><h2>Game Revenue</h2><p>Stakes, payouts and GGR by game.</p></div></div>
        ${table(['Game', 'Rounds', 'Stakes', 'Payouts', 'NGR'], (report.games || []).map((row) => `<tr>
          <td><b>${esc(row.game)}</b></td><td>${num(row.rounds)}</td><td>${money(row.stakes)} ETB</td><td>${money(row.payouts)} ETB</td><td class="${Number(row.ngr) >= 0 ? 'ws-positive' : 'ws-negative'}">${money(row.ngr)} ETB</td>
        </tr>`), empty('trend', 'No game data', 'Settled rounds will appear here.'))}
      </section>
    </div>
    <section class="ws-card">
      <div class="ws-card-head"><div><h2>Agent Performance</h2><p>Ranking within the selected period.</p></div></div>
      ${table(['Agent', 'Code', 'NGR', 'Commission', 'Deposits', 'Users'], (report.agents || []).map((row) => `<tr>
        <td>${avatar(row.name)}<div><b>${esc(row.name)}</b></div></td>
        <td class="ws-mono">${esc(row.promo_code || '—')}</td>
        <td>${money(row.ngr)} ETB</td>
        <td><b>${money(row.commission)} ETB</b></td>
        <td>${money(row.deposits)} ETB</td><td>${num(row.users)}</td>
      </tr>`), empty('agents', 'No agents', 'Create agents first.'))}
    </section>`;
  }

  async function superSettings() {
    const data = await ctx.api('/superadmin/settings');
    const settings = data.settings || {};
    return `<div class="ws-page-head"><div><span class="ws-kicker">CONFIGURATION</span><h2>Settings</h2><p>Platform configuration and support controls.</p></div></div>
    <section class="ws-card">
      <div class="ws-card-head"><div><h2>Platform settings</h2><p>Branding, support and commission defaults.</p></div></div>
      <form id="super-settings-form" class="ws-form-grid">
        <label class="ws-field"><span>Platform name</span><input name="platform_name" value="${esc(settings.platform_name)}" maxlength="80" required></label>
        <label class="ws-field"><span>Support email</span><input name="support_email" type="email" value="${esc(settings.support_email)}" maxlength="160"></label>
        <label class="ws-field"><span>Support phone</span><input name="support_phone" value="${esc(settings.support_phone)}" maxlength="40"></label>
        <label class="ws-field"><span>Support hours</span><input name="support_hours" value="${esc(settings.support_hours)}" maxlength="80"></label>
        <label class="ws-field full"><span>Site-wide announcement</span><textarea name="announcement" rows="2" maxlength="500" placeholder="Announcement shown to agents">${esc(settings.announcement)}</textarea></label>
        <label class="ws-field"><span>AI support enabled</span><label class="ws-toggle"><input type="checkbox" name="ai_support_enabled" ${settings.ai_support_enabled ? 'checked' : ''}><span class="ws-toggle-track"></span></label></label>
        <label class="ws-field"><span>Commission rate</span><b class="ws-mono">${esc(settings.commission_bps / 100)}% weekly</b><div class="ws-cell-sub">Editable only through agent profile updates.</div></label>
        <label class="ws-field full">${passwordField('Confirm changes (Super Admin password)')}</label>
        <div class="ws-form-actions"><button type="submit" class="ws-btn primary">Save settings</button></div>
      </form>
    </section>
    <section class="ws-card">
      <div class="ws-card-head"><div><h2>Platform snapshot</h2><p>Live counts and this week&#39;s NGR.</p></div></div>
      <div class="ws-stats-grid four">
        ${statCard({ label: 'Agents', value: num(data.platform.agents), iconName: 'agents', tone: 'yellow' })}
        ${statCard({ label: 'Customers', value: num(data.platform.users), iconName: 'users', tone: 'blue' })}
        ${statCard({ label: 'Week NGR', value: etb(data.platform.week_ngr), iconName: 'trend', tone: 'gold' })}
        ${statCard({ label: 'Time zone', value: 'Addis Ababa', iconName: 'clock', tone: 'muted' })}
      </div>
    </section>`;
  }

  async function superSupport() {
    const params = new URLSearchParams({ status: state.superSupportStatus });
    const [tickets, agents] = await Promise.all([
      ctx.api(`/admin/tickets?${params.toString()}`).catch(() => ({ tickets: [] })),
      ctx.api('/superadmin/agents?limit=100&search=').catch(() => ({ agents: [] }))
    ]);
    const list = tickets.tickets || [];
    if (!state.selectedSuperTicket && list.length) state.selectedSuperTicket = list[0].id;
    const selectedAgentMap = {};
    (agents.agents || []).forEach((agent) => { selectedAgentMap[String(agent.id)] = agent; });
    let detail = null;
    if (state.selectedSuperTicket) {
      detail = await ctx.api(`/support/ticket/${state.selectedSuperTicket}`);
    }
    const selected = detail?.ticket;
    return `<div class="ws-page-head"><div><span class="ws-kicker">CONVERSATIONS</span><h2>Support</h2><p>All customer conversations routed to agents and Super Admin.</p></div><div class="ws-head-actions">${segmented([['all','All'],['open','Open'],['escalated','Escalated'],['resolved','Resolved']], state.superSupportStatus, 'super-support-filter')}<button type="button" class="ws-btn ghost" id="super-support-refresh">${icon('refresh')} Refresh</button></div></div>
    <div class="ws-support-shell">
      <section class="ws-card ws-ticket-list">
        <div class="ws-ticket-list-head"><h3>Inbox <span>${list.length}</span></h3></div>
        <div class="ws-segmented compact">${[['all','All'],['open','Open'],['escalated','Escalated'],['resolved','Resolved']].map(([value,label]) => `<button type="button" data-super-support-status="${value}" class="${state.superSupportStatus === value ? 'on' : ''}">${label}</button>`).join('')}</div>
        <div class="ws-ticket-scroll">${list.length ? list.map((ticket) => `<button type="button" class="ws-ticket-item ${String(state.selectedSuperTicket) === String(ticket.id) ? 'active' : ''}" data-super-ticket="${ticket.id}">
          <span class="ws-ticket-avatar">${avatar(ticket.user_name)}${onlineDot(ticket.user_online, '')}</span>
          <span class="ws-ticket-copy"><span><b>${esc(ticket.user_name)}</b><small>${timeAgo(ticket.latest_message_at || ticket.updated_at || ticket.created_at)}</small></span><em>${esc(ticket.latest_message || ticket.message || '')}</em><span class="ws-ticket-meta">${pill(ticket.status)}${ticket.unread_count ? `<i class="ws-unread-count">${ticket.unread_count}</i>` : ''}</span></span>
        </button>`).join('') : empty('chat', 'No conversations', '')}</div>
      </section>
      <section class="ws-card ws-chat-panel">
        ${selected ? `<div class="ws-chat-head"><div>${avatar(selected.user_name, 'lg')}<div><b>${esc(selected.user_name)}</b><span>${onlineDot(selected.user_online)} · ${esc(selected.user_phone || '')}</span></div></div><div class="ws-chat-actions"><span>${pill(selected.status)}</span>
          ${ctx.me.role === 'superadmin' ? `<select id="super-assign-agent"><option value="">Unassigned</option>${Object.entries(selectedAgentMap).map(([agentId, agent]) => `<option value="${agentId}" ${String(selected.assigned_agent_id) === agentId ? 'selected' : ''}>${esc(agent.name)} · ${esc(agent.promo_code)}</option>`).join('')}</select>` : ''}
          <button type="button" class="ws-btn tiny" id="super-chat-resolve" ${selected.status === 'resolved' ? 'disabled' : ''}>Resolve</button><button type="button" class="ws-btn tiny bad" id="super-chat-escalate">Escalate</button></div></div>
        <div class="ws-chat-stream" id="ws-chat-stream">${(detail.messages || []).map((message) => `<div class="ws-chat-message ${message.sender_role === 'user' ? 'them' : message.sender_role === 'ai' ? 'ai' : 'me'}"><div class="ws-chat-bubble">${esc(message.message)}</div><span>${message.sender_role === 'ai' ? 'Fetan AI' : esc(message.sender_name)} · ${dateTime(message.created_at)}</span></div>`).join('') || empty('chat', 'No messages yet', '')}</div>
        <form class="ws-chat-compose" id="super-chat-form"><input id="ws-chat-input" name="message" maxlength="1000" placeholder="Write a reply to ${esc(selected.user_name)}..." autocomplete="off" required><button type="submit" class="ws-btn primary">${icon('arrow')} Send</button></form>
        <div class="ws-chat-foot">${selected.assigned_agent_id ? `Assigned to ${esc(selected.agent_name || 'an agent')}` : 'Unassigned'} · ${selected.user_online ? 'Customer online' : 'Customer offline'}</div>` : empty('chat', 'Select a conversation', 'Choose a ticket from the inbox.')}
      </section>
    </div>`;
  }

  async function renderSuperPage() {
    switch (state.page) {
      case 'dashboard': return superDashboard();
      case 'users': return superUsers();
      case 'agents': return superManagement();
      case 'deposit-requests': return superDepositRequests();
      case 'withdrawal-requests': return superWithdrawalRequests();
      case 'agent-management': return superManagement();
      case 'reports': return superReports();
      case 'support': return superSupport();
      case 'settings': return superSettings();
      default: return superDashboard();
    }
  }

  async function openDepositReview(deposit) {
    const body = `<form class="ws-form-grid full-form">
      <label class="ws-field"><span>Customer</span>${userPill(deposit)}</label>
      <label class="ws-field"><span>Provider / Amount</span><b>${esc(deposit.provider)}</b> · ${money(deposit.amount)} ETB</label>
      <label class="ws-field"><span>Reference</span><span class="ws-mono">${esc(deposit.tx_ref)}</span></label>
      <label class="ws-field"><span>Receipt</span>${deposit.has_receipt ? `<a class="ws-link" href="/api/deposits/${encodeURIComponent(deposit.id)}/receipt" target="_blank" rel="noopener">View receipt</a>` : 'None'}</label>
      <label class="ws-field"><span>Internal note</span><textarea name="internal_note" rows="2" maxlength="500" placeholder="Staff-only note">${esc(deposit.internal_note || '')}</textarea></label>
      <label class="ws-field"><span>Reason</span><input name="reason" placeholder="Reason (required to reject)"></label>
      <div class="ws-checklist" style="margin-top:10px">
        <label class="ws-check-item"><input type="checkbox" name="check_amount_matches" value="true"> Amount matches receipt</label>
        <label class="ws-check-item"><input type="checkbox" name="check_reference_matches" value="true"> Reference matches deposit</label>
        <label class="ws-check-item"><input type="checkbox" name="check_recipient_matches" value="true"> Recipient matches account</label>
        <label class="ws-check-item"><input type="checkbox" name="check_date_plausible" value="true"> Date plausible</label>
        <label class="ws-check-item"><input type="checkbox" name="check_independently_verified" value="true"> Independently verified</label>
      </div>
      ${passwordField()}
      <div class="ws-form-actions full">
        <button type="button" class="ws-btn bad" data-deposit-action="reject">Reject</button>
        <button type="submit" class="ws-btn primary" data-deposit-action="approve">Approve and credit</button>
      </div>
    </form>`;
    openModal(`Review deposit #${deposit.id}`, body, async (modal) => {
      const form = modal.querySelector('.ws-form-grid');
      const buttons = {
        approve: modal.querySelector('[data-deposit-action="approve"]'),
        reject: modal.querySelector('[data-deposit-action="reject"]')
      };
      const run = async (action) => {
        if (!buttons[action]) return;
        if (form.dataset.busy === '1') return;
        form.dataset.busy = '1';
        const submitButtons = Object.values(buttons).filter(Boolean);
        submitButtons.forEach((button) => { button.disabled = true; });
        const label = buttons[action].textContent;
        if (action === 'approve') buttons[action].textContent = 'Approving…';
        clearFormError(form);
        const fd = new FormData(form);
        const checks = {};
        for (const key of ['amount_matches','reference_matches','recipient_matches','date_plausible','independently_verified']) checks[key] = fd.get(`check_${key}`) === 'true';
        const restore = () => {
          delete form.dataset.busy;
          submitButtons.forEach((button) => { button.disabled = false; });
          buttons[action].textContent = label;
        };
        if (action === 'approve' && !Object.values(checks).every(Boolean)) {
          showFormError(form, { message: 'VERIFICATION_REQUIRED' });
          ctx.fail({ message: 'VERIFICATION_REQUIRED' });
          restore();
          return;
        }
        try {
          await ctx.api(`/superadmin/deposits/${encodeURIComponent(deposit.id)}/decide`, {
            action,
            reason: fd.get('reason') || '',
            internal_note: fd.get('internal_note') || '',
            verification: checks,
            reauth_password: fd.get('reauth_password')
          });
          ctx.success(`Deposit ${action === 'approve' ? 'approved and credited' : 'rejected'}.`);
          modal.remove(); document.body.classList.remove('ws-modal-open');
          renderPage();
        } catch (error) {
          ctx.fail(error);
          showFormError(form, error);
          restore();
        }
      };
      form.addEventListener('submit', (event) => { event.preventDefault(); run('approve'); });
      buttons.reject.addEventListener('click', () => run('reject'));
    }, 'ws-modal-wide');
  }

  async function openWithdrawalReview(withdrawal) {
    openModal(`Review withdrawal #${withdrawal.id}`, `<form class="ws-form-grid full-form">
      <label class="ws-field"><span>Customer</span>${userPill(withdrawal)}</label>
      <label class="ws-field"><span>Provider / Amount</span><b>${esc(withdrawal.provider)}</b> · ${money(withdrawal.amount)} ETB</label>
      <label class="ws-field"><span>Destination</span><span class="ws-mono">${esc(withdrawal.account_number)}</span></label>
      <label class="ws-field"><span>Reason</span><input name="reason" placeholder="Reason (required to reject)"></label>
      <label class="ws-field"><span>Internal note</span><textarea name="internal_note" rows="2" maxlength="500" placeholder="Staff-only note">${esc(withdrawal.internal_note || '')}</textarea></label>
      ${passwordField()}
      <div class="ws-form-actions full">
        <button type="button" class="ws-btn bad" data-withdraw-action="reject">Reject</button>
        <button type="submit" class="ws-btn primary" data-withdraw-action="approve">Approve for payout</button>
      </div>
    </form>`, async (modal) => {
      const form = modal.querySelector('.ws-form-grid');
      const run = async (action) => {
        if (form.dataset.busy === '1') return;
        form.dataset.busy = '1';
        const buttons = modal.querySelectorAll('[data-withdraw-action]');
        buttons.forEach((b) => b.disabled = true);
        clearFormError(form);
        const fd = new FormData(form);
        try {
          await ctx.api(`/superadmin/withdrawals/${encodeURIComponent(withdrawal.id)}/decide`, {
            action,
            reason: fd.get('reason') || '',
            internal_note: fd.get('internal_note') || '',
            reauth_password: fd.get('reauth_password')
          });
          ctx.success(`Withdrawal ${action === 'approve' ? 'approved for payout' : 'rejected'}.`);
          modal.remove(); document.body.classList.remove('ws-modal-open');
          renderPage();
        } catch (error) {
          ctx.fail(error);
          showFormError(form, error);
          delete form.dataset.busy;
          buttons.forEach((b) => b.disabled = false);
        }
      };
      form.addEventListener('submit', (event) => { event.preventDefault(); run('approve'); });
      modal.querySelector('[data-withdraw-action="reject"]').addEventListener('click', () => run('reject'));
    }, 'ws-modal-wide');
  }

  async function openWithdrawalComplete(withdrawal) {
    openModal(`Confirm payment #${withdrawal.id}`, `<form class="ws-form-grid full-form">
      <label class="ws-field"><span>Customer</span>${userPill(withdrawal)}</label>
      <label class="ws-field"><span>Amount</span><b>${money(withdrawal.amount)} ETB</b></label>
      <label class="ws-field"><span>Destination</span><span class="ws-mono">${esc(withdrawal.account_number)}</span></label>
      <label class="ws-field"><span>External payment reference</span><input name="payment_reference" minlength="4" maxlength="100" required placeholder="Transaction reference"></label>
      ${passwordField()}
      <div class="ws-form-actions full"><button type="submit" class="ws-btn primary">Mark paid</button></div>
    </form>`, async (modal) => {
      const form = modal.querySelector('.ws-form-grid');
      const submit = form.querySelector('button[type="submit"]');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const fd = new FormData(form);
        submit.disabled = true;
        clearFormError(form);
        try {
          await ctx.api(`/superadmin/withdrawals/${encodeURIComponent(withdrawal.id)}/complete`, {
            payment_reference: fd.get('payment_reference'),
            reauth_password: fd.get('reauth_password')
          });
          ctx.success('Withdrawal marked paid.');
          modal.remove(); document.body.classList.remove('ws-modal-open');
          renderPage();
        } catch (error) {
          ctx.fail(error);
          showFormError(form, error);
          submit.disabled = false;
        }
      });
    }, 'ws-modal-wide');
  }

  async function openCreateAgent() {
    openModal(`Register agent`, `<form class="ws-form-grid full-form">
      <label class="ws-field"><span>Full name</span><input name="name" minlength="2" maxlength="60" required></label>
      <label class="ws-field"><span>Phone</span><input name="phone" type="tel" required></label>
      <label class="ws-field"><span>Initial password</span><input name="password" type="password" minlength="12" autocomplete="new-password" required></label>
      <label class="ws-field"><span>Promo code</span><input name="promo_code" maxlength="20" placeholder="Auto-generated if empty"></label>
      <label class="ws-field"><span>Contact details</span><input name="contact_info" maxlength="200"></label>
      <label class="ws-field"><span>Weekly fee (ETB)</span><input name="weekly_fee_etb" type="number" min="0" step="0.01" value="0"></label>
      <label class="ws-field"><span>Commission %</span><input name="commission_percent" type="number" min="0" max="100" step="0.01" value="25"></label>
      <label class="ws-field"><span>Email</span><input name="email" type="email" maxlength="160" placeholder="agent@example.com"></label>
      <label class="ws-field"><span>Username</span><input name="username" maxlength="30" placeholder="agent_handle"></label>
      ${passwordField()}
      <div class="ws-form-actions full"><button type="submit" class="ws-btn primary">Create agent</button></div>
    </form>`, async (modal) => {
      const form = modal.querySelector('.ws-form-grid');
      const submit = form.querySelector('button[type="submit"]');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const fd = new FormData(form);
        submit.disabled = true;
        clearFormError(form);
        try {
          await ctx.api('/superadmin/agents', {
            name: fd.get('name'),
            phone: fd.get('phone'),
            password: fd.get('password'),
            promo_code: fd.get('promo_code') || undefined,
            contact_info: fd.get('contact_info') || '',
            weekly_fee_santim: Math.round(Number(fd.get('weekly_fee_etb') || 0) * 100),
            commission_bps: Math.round(Number(String(fd.get('commission_percent') || '').trim() || 25) * 100),
            email: fd.get('email') || undefined,
            username: fd.get('username') || undefined,
            reauth_password: fd.get('reauth_password')
          });
          ctx.success('Agent created.');
          modal.remove(); document.body.classList.remove('ws-modal-open');
          renderPage();
        } catch (error) {
          ctx.fail(error);
          showFormError(form, error);
          submit.disabled = false;
        }
      });
    }, 'ws-modal-wide');
  }

  async function openEditAgent(id) {
    const data = await ctx.api(`/superadmin/agents?limit=100&search=`);
    const row = (data.agents || []).find((agent) => num(agent.id) === num(id));
    if (!row) { ctx.fail({ message: 'NOT_FOUND' }); return; }
    openModal(`Edit ${esc(row.name)}`, `<form class="ws-form-grid full-form">
      <label class="ws-field"><span>Full name</span><input name="name" value="${esc(row.name)}" required></label>
      <label class="ws-field"><span>Phone</span><input name="phone" value="${esc(row.phone)}" required></label>
      <label class="ws-field"><span>Promo code</span><input name="promo_code" value="${esc(row.promo_code)}" required></label>
      <label class="ws-field"><span>Contact details</span><input name="contact_info" value="${esc(row.contact_info || '')}"></label>
      <label class="ws-field"><span>Email</span><input name="email" type="email" value="${esc(row.email || '')}"></label>
      <label class="ws-field"><span>Username</span><input name="username" value="${esc(row.username || '')}"></label>
      <label class="ws-field"><span>Status</span><select name="status"><option value="active" ${row.status === 'active' ? 'selected' : ''}>Active</option><option value="suspended" ${row.status === 'suspended' ? 'selected' : ''}>Suspended</option></select></label>
      <label class="ws-field"><span>Weekly fee (ETB)</span><input name="weekly_fee_etb" type="number" min="0" step="0.01" value="${Number(row.weekly_fee_santim || 0) / 100}"></label>
      <label class="ws-field"><span>Commission %</span><input name="commission_percent" type="number" min="0" max="100" step="0.01" value="${Number(row.commission_bps || 0) / 100}"></label>
      ${passwordField()}
      <div class="ws-form-actions full"><button type="submit" class="ws-btn primary">Save agent</button></div>
    </form>`, async (modal) => {
      const form = modal.querySelector('.ws-form-grid');
      const submit = form.querySelector('button[type="submit"]');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const fd = new FormData(form);
        submit.disabled = true;
        clearFormError(form);
        try {
          await ctx.api(`/superadmin/agents/${id}`, {
            name: fd.get('name'), phone: fd.get('phone'), promo_code: fd.get('promo_code'),
            contact_info: fd.get('contact_info') || '', status: fd.get('status'),
            weekly_fee_santim: Math.round(Number(fd.get('weekly_fee_etb') || 0) * 100),
            commission_bps: Math.round(Number(fd.get('commission_percent') || 0) * 100),
            email: fd.get('email') || '', username: fd.get('username') || '',
            reauth_password: fd.get('reauth_password')
          }, 'PATCH');
          ctx.success('Agent updated.');
          modal.remove(); document.body.classList.remove('ws-modal-open');
          renderPage();
        } catch (error) {
          ctx.fail(error);
          showFormError(form, error);
          submit.disabled = false;
        }
      });
    }, 'ws-modal-wide');
  }

  function openCommissionApprove(settlementId) {
    openReauth({
      title: 'Approve commission',
      message: 'Approving moves this week\u2019s 25% commission to the payable stage. Confirm your Super Admin password.',
      confirmLabel: 'Approve commission',
      onConfirm: async (password) => {
        await ctx.api(`/superadmin/commissions/${encodeURIComponent(settlementId)}/approve`, { reauth_password: password });
        ctx.success('Commission approved.');
        renderPage();
      }
    });
  }

  function openCommissionPay(settlementId) {
    openReauth({
      title: 'Pay commission',
      message: 'Payment credits the agent wallet immediately and cannot be reversed. Confirm your Super Admin password.',
      confirmLabel: 'Pay commission',
      tone: 'bad',
      onConfirm: async (password) => {
        await ctx.api(`/superadmin/commissions/${encodeURIComponent(settlementId)}/pay`, { reauth_password: password });
        ctx.success('Commission paid to agent wallet.');
        renderPage();
      }
    });
  }

  // =====================================================
  // SUPER ADMIN PAGE BINDINGS
  // =====================================================

  function bindSuperPage() {
    if (state.page === 'support') bindSuperChat();
    bindGenericFilters();
    document.getElementById('ws-super-refresh')?.addEventListener('click', () => renderPage());
    document.querySelectorAll('[data-pending-tab]').forEach((button) => {
      button.addEventListener('click', () => { state.pendingTab = button.dataset.pendingTab; renderPage(); });
    });
    document.querySelectorAll('[data-pending-open]').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          if (button.dataset.pendingKind === 'withdrawals') {
            const data = await ctx.api(`/superadmin/withdrawals/${button.dataset.pendingOpen}`);
            await openWithdrawalReview(data.withdrawals[0]);
          } else {
            const data = await ctx.api(`/superadmin/deposits/${button.dataset.pendingOpen}`);
            await openDepositReview(data.deposits[0]);
          }
        } catch (error) { ctx.fail(error); }
      });
    });
    document.querySelectorAll('[data-notification-link]').forEach((button) => {
      button.addEventListener('click', () => navigate(button.dataset.notificationLink || 'dashboard'));
    });
    document.getElementById('super-create-agent')?.addEventListener('click', openCreateAgent);
    document.querySelectorAll('[data-super-agent-edit]').forEach((button) => {
      button.addEventListener('click', () => openEditAgent(Number(button.dataset.superAgentEdit)));
    });
    document.querySelectorAll('[data-super-agent-status]').forEach((button) => {
      button.addEventListener('click', () => {
        const current = button.dataset.status;
        const target = current === 'active' ? 'suspended' : 'active';
        openReauth({
          title: target === 'suspended' ? 'Suspend agent' : 'Reactivate agent',
          message: `Confirm your Super Admin password to ${target === 'suspended' ? 'suspend' : 'reactivate'} this agent. Suspended agents cannot sign in or earn commissions.`,
          confirmLabel: target === 'suspended' ? 'Suspend agent' : 'Reactivate agent',
          tone: target === 'suspended' ? 'bad' : 'primary',
          onConfirm: async (password) => {
            await ctx.api(`/superadmin/agents/${button.dataset.superAgentStatus}`, { status: target, reauth_password: password }, 'PATCH');
            ctx.success(`Agent ${target === 'suspended' ? 'suspended' : 'reactivated'}.`);
            renderPage();
          }
        });
      });
    });
    document.querySelectorAll('[data-deposit-review]').forEach((button) => {
      button.addEventListener('click', async () => {
        const data = await ctx.api(`/superadmin/deposits/${button.dataset.depositReview}`);
        await openDepositReview(data.deposits[0]);
      });
    });
    document.querySelectorAll('[data-withdraw-review]').forEach((button) => {
      button.addEventListener('click', async () => {
        const data = await ctx.api(`/superadmin/withdrawals/${button.dataset.withdrawReview}`);
        await openWithdrawalReview(data.withdrawals[0]);
      });
    });
    document.querySelectorAll('[data-withdraw-complete]').forEach((button) => {
      button.addEventListener('click', async () => {
        const data = await ctx.api(`/superadmin/withdrawals/${button.dataset.withdrawComplete}`);
        await openWithdrawalComplete(data.withdrawals[0]);
      });
    });
    document.querySelectorAll('[data-commission-approve]').forEach((button) => {
      button.addEventListener('click', () => openCommissionApprove(Number(button.dataset.commissionApprove)));
    });
    document.querySelectorAll('[data-commission-pay]').forEach((button) => {
      button.addEventListener('click', () => openCommissionPay(Number(button.dataset.commissionPay)));
    });
    document.getElementById('super-deposit-refresh')?.addEventListener('click', () => renderPage());
    document.getElementById('super-withdrawal-refresh')?.addEventListener('click', () => renderPage());
    document.getElementById('super-review-deposit')?.addEventListener('click', async () => {
      const data = await ctx.api(`/superadmin/deposits?status=pending&limit=1`);
      const row = data.deposits?.[0];
      if (row) await openDepositReview(row); else ctx.success('No pending deposits.');
    });
    document.getElementById('super-review-withdrawal')?.addEventListener('click', async () => {
      const data = await ctx.api(`/superadmin/withdrawals?status=pending&limit=1`);
      const row = data.withdrawals?.[0];
      if (row) await openWithdrawalReview(row); else ctx.success('No pending withdrawals.');
    });
    document.getElementById('super-report-csv')?.addEventListener('click', () => exportReportCsv());
    document.getElementById('super-settings-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const fd = new FormData(event.target);
      try {
        await ctx.api('/superadmin/settings', {
          platform_name: fd.get('platform_name'),
          support_email: fd.get('support_email') || undefined,
          support_phone: fd.get('support_phone') || undefined,
          support_hours: fd.get('support_hours') || undefined,
          announcement: fd.get('announcement') || undefined,
          ai_support_enabled: fd.get('ai_support_enabled') === 'on',
          reauth_password: fd.get('reauth_password')
        }, 'PATCH');
        ctx.success('Settings saved.');
        renderPage();
      } catch (error) { ctx.fail(error); }
    });
    document.getElementById('super-report-filter')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const fd = new FormData(event.target);
      state.reportStart = String(fd.get('start') || '');
      state.reportEnd = String(fd.get('end') || '');
      renderPage();
    });
    document.querySelectorAll('[data-management-tab]').forEach((button) => {
      button.addEventListener('click', () => { state.managementTab = button.dataset.managementTab; renderPage(); });
    });
  }

  function bindGenericFilters() {
    document.getElementById('super-user-filter')?.addEventListener('submit', (event) => {
      event.preventDefault();
      state.superUserSearch = String(new FormData(event.target).get('search') || '');
      state.superUserOffset = 0;
      renderPage();
    });
    document.getElementById('super-user-role')?.addEventListener('change', (event) => {
      state.superUserRole = event.target.value; state.superUserOffset = 0; renderPage();
    });
    document.getElementById('super-user-status')?.addEventListener('change', (event) => {
      state.superUserStatus = event.target.value; state.superUserOffset = 0; renderPage();
    });
    document.querySelectorAll('[data-super-user]').forEach((button) => {
      button.addEventListener('click', () => openSuperUserDetail(Number(button.dataset.superUser)).catch(ctx.fail));
    });
    document.querySelectorAll('[data-page-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const direction = button.dataset.dir === 'next' ? 1 : -1;
        const action = button.dataset.pageAction;
        if (action === 'super-user-page') state.superUserOffset = Math.max(0, state.superUserOffset + direction * 25);
        else if (action === 'agent-user-page') state.userOffset = Math.max(0, state.userOffset + direction * 25);
        else if (action === 'agent-tx-page') state.txOffset = Math.max(0, state.txOffset + direction * 25);
        renderPage();
      });
    });
    document.getElementById('super-agent-filter')?.addEventListener('submit', (event) => {
      event.preventDefault();
      state.superUserSearch = String(new FormData(event.target).get('search') || '');
      renderPage();
    });
    document.getElementById('super-deposit-filter')?.addEventListener('submit', (event) => {
      event.preventDefault();
      state.depositSearch = String(new FormData(event.target).get('search') || '');
      renderPage();
    });
    document.getElementById('super-withdrawal-filter')?.addEventListener('submit', (event) => {
      event.preventDefault();
      state.withdrawalSearch = String(new FormData(event.target).get('search') || '');
      renderPage();
    });
    document.querySelectorAll('[data-support-status]').forEach((button) => {
      button.addEventListener('click', () => { state.supportStatus = button.dataset.supportStatus; state.selectedTicket = null; renderPage(); });
    });
    document.querySelectorAll('[data-super-support-status]').forEach((button) => {
      button.addEventListener('click', () => { state.superSupportStatus = button.dataset.superSupportStatus; state.selectedSuperTicket = null; renderPage(); });
    });
    document.querySelectorAll('[data-agent-ticket]').forEach((button) => {
      button.addEventListener('click', () => { state.selectedTicket = Number(button.dataset.agentTicket); renderPage(); });
    });
    document.querySelectorAll('[data-super-ticket]').forEach((button) => {
      button.addEventListener('click', () => { state.selectedSuperTicket = Number(button.dataset.superTicket); renderPage(); });
    });
  }

  function bindSuperChat() {
    const detail = state.selectedSuperTicket;
    if (!detail) return;
    document.getElementById('super-support-refresh')?.addEventListener('click', () => renderPage());
    document.getElementById('super-chat-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = document.getElementById('ws-chat-input');
      const message = String(input?.value || '').trim();
      if (!message) return;
      const button = event.target.querySelector('button[type=submit]');
      if (button) button.disabled = true;
      try {
        await ctx.api(`/support/ticket/${detail}/reply`, { message });
        input.value = '';
        renderPage();
      } catch (error) { ctx.fail(error); if (button) button.disabled = false; }
    });
    document.getElementById('super-chat-resolve')?.addEventListener('click', async () => {
      try { await ctx.api(`/support/ticket/${detail}/status`, { status: 'resolved' }); ctx.success('Ticket resolved.'); renderPage(); } catch (error) { ctx.fail(error); }
    });
    document.getElementById('super-chat-escalate')?.addEventListener('click', async () => {
      try { await ctx.api(`/support/ticket/${detail}/escalate`, { reason: 'Escalated by Super Admin' }); ctx.success('Escalated.'); renderPage(); } catch (error) { ctx.fail(error); }
    });
    document.getElementById('super-assign-agent')?.addEventListener('change', (event) => {
      const select = event.target;
      const previous = select.querySelector('option[selected]')?.value || '';
      const agentId = select.value;
      const status = agentId ? 'in_progress' : 'open';
      const restore = () => { if (select.isConnected) select.value = previous; };
      openReauth({
        title: agentId ? 'Assign conversation' : 'Return to queue',
        message: agentId
          ? 'Confirm your Super Admin password to assign this conversation to the selected agent.'
          : 'Confirm your Super Admin password to return this conversation to the unassigned queue.',
        confirmLabel: agentId ? 'Assign ticket' : 'Unassign ticket',
        onConfirm: async (password) => {
          await ctx.api(`/support/ticket/${detail}/status`, { status, assigned_agent_id: agentId || null, reauth_password: password });
          ctx.success('Ticket assigned.');
          renderPage();
        },
        onCancel: restore,
        onError: restore
      });
    });
    pageTimer = window.setInterval(async () => {
      if (state.page !== 'support' || !state.selectedSuperTicket || document.querySelector('.ws-modal-backdrop')) return;
      const input = document.getElementById('ws-chat-input');
      if (input && input.value) return;
      try {
        const fresh = await ctx.api(`/support/ticket/${state.selectedSuperTicket}`);
        const target = document.getElementById('ws-chat-stream');
        if (target) {
          target.innerHTML = (fresh.messages || []).map((message) => `<div class="ws-chat-message ${message.sender_role === 'user' ? 'them' : message.sender_role === 'ai' ? 'ai' : 'me'}"><div class="ws-chat-bubble">${esc(message.message)}</div><span>${message.sender_role === 'ai' ? 'Fetan AI' : esc(message.sender_name)} · ${dateTime(message.created_at)}</span></div>`).join('');
          target.scrollTop = target.scrollHeight;
        }
      } catch (_) { /* best effort */ }
    }, 12000);
  }

  function exportReportCsv() {
    const report = state.reportData;
    if (!report) { ctx.success('Open the report before exporting.'); return; }
    const cell = (value) => `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
    const line = (values) => values.map(cell).join(',');
    const s = report.summary || {};
    const rows = [
      line(['Fetan Bet report', state.reportStart || '', state.reportEnd || '']),
      line(['New users', s.new_users || 0]),
      line(['Deposits (ETB)', money(s.deposit_total || 0, 2)]),
      line(['Withdrawals (ETB)', money(s.withdrawal_total || 0, 2)]),
      line(['Commission accrued (ETB)', money(s.commission_accrued || 0, 2)]),
      line(['Commission paid (ETB)', money(s.commission_paid || 0, 2)]),
      '',
      line(['Date', 'NGR (ETB)', 'Deposits (ETB)', 'Withdrawals (ETB)']),
      ...(report.daily || []).map((row) => line([row.date, money(row.ngr || 0, 2), money(row.deposits || 0, 2), money(row.withdrawals || 0, 2)])),
      '',
      line(['Agent', 'Promo code', 'NGR (ETB)', 'Commission (ETB)', 'Deposits (ETB)', 'Customers']),
      ...(report.agents || []).map((row) => line([row.name, row.promo_code || '', money(row.ngr || 0, 2), money(row.commission || 0, 2), money(row.deposits || 0, 2), row.users || 0]))
    ].join('\r\n');
    const blob = new Blob([rows], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fetan-bet-report-${state.reportStart}-${state.reportEnd}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // =====================================================
  // PAGE BINDINGS
  // =====================================================

  function bindAgentPage() {
    document.querySelectorAll('[data-agent-user]').forEach((element) => {
      element.addEventListener('click', () => openAgentUser(Number(element.dataset.agentUser)).catch(ctx.fail));
    });
    document.querySelectorAll('[data-support-ticket]').forEach((element) => {
      element.addEventListener('click', () => { state.selectedTicket = Number(element.dataset.supportTicket); navigate('support'); });
    });
    document.getElementById('agent-user-filter')?.addEventListener('submit', (event) => {
      event.preventDefault();
      state.userSearch = String(new FormData(event.target).get('search') || '');
      state.userOffset = 0;
      renderPage();
    });
    document.getElementById('agent-user-status')?.addEventListener('change', (event) => {
      state.userStatus = event.target.value; state.userOffset = 0; renderPage();
    });
    document.getElementById('agent-tx-filter')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = new FormData(event.target);
      state.txSearch = String(form.get('search') || '');
      state.txType = String(form.get('type') || 'all');
      state.txStatus = String(form.get('status') || 'all');
      state.txStart = String(form.get('start') || '');
      state.txEnd = String(form.get('end') || '');
      state.txOffset = 0;
      renderPage();
    });
    if (state.page === 'support') bindAgentChat();
    if (state.page === 'earnings') bindAgentEarnings();
    if (state.page === 'profile') bindAgentProfile();
  }

  function bindAgentChat() {
    const detail = state.selectedTicket;
    if (!detail) return;
    const stream = document.getElementById('ws-chat-stream');
    if (stream) stream.scrollTop = stream.scrollHeight;
    document.getElementById('agent-support-refresh')?.addEventListener('click', () => renderPage());
    document.getElementById('agent-chat-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = document.getElementById('ws-chat-input');
      const message = String(input?.value || '').trim();
      if (!message) return;
      const button = event.target.querySelector('button[type=submit]');
      if (button) button.disabled = true;
      try {
        await ctx.api(`/support/ticket/${detail}/reply`, { message });
        input.value = '';
        await ctx.api(`/support/ticket/${detail}`).catch(() => null);
        renderPage();
      } catch (error) { ctx.fail(error); if (button) button.disabled = false; }
    });
    document.getElementById('agent-chat-resolve')?.addEventListener('click', async () => {
      try { await ctx.api(`/support/ticket/${detail}/status`, { status: 'resolved' }); ctx.success('Ticket resolved.'); renderPage(); } catch (error) { ctx.fail(error); }
    });
    document.getElementById('agent-chat-escalate')?.addEventListener('click', async () => {
      try { await ctx.api(`/support/ticket/${detail}/escalate`, { reason: 'Escalated by agent' }); ctx.success('Escalated to Super Admin.'); renderPage(); } catch (error) { ctx.fail(error); }
    });
    pageTimer = window.setInterval(async () => {
      if (state.page !== 'support' || !state.selectedTicket || document.querySelector('.ws-modal-backdrop')) return;
      const input = document.getElementById('ws-chat-input');
      if (input && input.value) return;
      try {
        const fresh = await ctx.api(`/support/ticket/${state.selectedTicket}`);
        const target = document.getElementById('ws-chat-stream');
        if (target) {
          target.innerHTML = (fresh.messages || []).map((message) => `<div class="ws-chat-message ${message.sender_role === 'user' ? 'them' : message.sender_role === 'ai' ? 'ai' : 'me'}"><div class="ws-chat-bubble">${esc(message.message)}</div><span>${message.sender_role === 'ai' ? 'Fetan AI' : esc(message.sender_name)} · ${dateTime(message.created_at)}</span></div>`).join('');
          target.scrollTop = target.scrollHeight;
        }
      } catch (_) { /* polling is best effort */ }
    }, 12000);
  }

  function bindAgentEarnings() {
    document.querySelectorAll('[data-request-payout]').forEach((button) => {
      if (button.disabled) return;
      button.addEventListener('click', async () => {
        const type = button.dataset.requestPayout;
        button.disabled = true;
        try {
          await ctx.api('/agent/payout-requests', { payout_type: type });
          ctx.success(type === 'weekly_fee' ? 'Weekly fee request sent.' : 'Commission request sent.');
          renderPage();
        } catch (error) { ctx.fail(error); button.disabled = false; }
      });
    });
  }

  function bindAgentProfile() {
    document.getElementById('agent-profile-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.target));
      try {
        await ctx.api('/agent/profile', {
          name: data.name,
          username: data.username || '',
          email: data.email || '',
          contact_info: data.contact_info
        }, 'PATCH');
        ctx.success('Profile updated.');
        renderPage();
      } catch (error) { ctx.fail(error); }
    });
  }

  async function openAgentUser(id) {
    const data = await ctx.api(`/agent/users/${id}`);
    const user = data.user || {};
    openModal(`Customer · ${user.name}`, `<div class="ws-modal-user">${avatar(user.name, 'xl')}<div><h3>${esc(user.name)}</h3><span>${esc(user.phone || '')} · joined ${dateShort(user.created_at)}</span><div class="ws-modal-badges">${pill(user.status)}${user.promo_balance ? `<span class="ws-pill warning">${money(user.promo_balance)} promo credits</span>` : ''}</div></div></div>
      <div class="ws-modal-stats"><div><span>Wallet</span><b>${money(user.balance)} ETB</b></div><div><span>Promo credits</span><b>${money(user.promo_balance)} ETB</b></div><div><span>Referral bonus</span><b>${user.referral_bonus == null ? '—' : `${money(user.referral_bonus)} ETB`}</b></div><div><span>Last seen</span><b>${user.online ? 'Online now' : timeAgo(user.last_seen_at)}</b></div></div>
      <div class="ws-modal-tabs"><button type="button" class="on" data-modal-tab="ledger">Wallet ledger</button><button type="button" data-modal-tab="deposits">Deposits</button><button type="button" data-modal-tab="games">Games</button></div>
      <div id="ws-modal-tab-body">
        ${table(['Date', 'Type', 'Amount', 'Balance'], (data.ledger || []).map((row) => `<tr><td>${dateTime(row.created_at)}</td><td><span class="ws-type-chip">${esc(row.type)}</span></td><td class="${Number(row.amount) >= 0 ? 'ws-positive' : 'ws-negative'}">${Number(row.amount) >= 0 ? '+' : ''}${money(row.amount)} ETB</td><td>${money(row.balance_after)} ETB</td></tr>`))}
      </div>`, (modal) => {
      const bodies = {
        ledger: () => table(['Date', 'Type', 'Amount', 'Balance'], (data.ledger || []).map((row) => `<tr><td>${dateTime(row.created_at)}</td><td><span class="ws-type-chip">${esc(row.type)}</span></td><td class="${Number(row.amount) >= 0 ? 'ws-positive' : 'ws-negative'}">${money(row.amount)} ETB</td><td>${money(row.balance_after)} ETB</td></tr>`)),
        deposits: () => table(['Date', 'Provider', 'Amount', 'Status'], (data.deposits || []).map((row) => `<tr><td>${dateTime(row.created_at)}</td><td>${esc(row.provider)}</td><td>${money(row.amount)} ETB</td><td>${pill(row.status)}</td></tr>`)),
        games: () => table(['Game', 'Rounds', 'Stakes', 'Payouts', 'NGR'], (data.games || []).map((row) => `<tr><td><b>${esc(row.game)}</b></td><td>${num(row.rounds)}</td><td>${money(row.stakes)} ETB</td><td>${money(row.payouts)} ETB</td><td class="${Number(row.ngr) >= 0 ? 'ws-positive' : 'ws-negative'}">${money(row.ngr)} ETB</td></tr>`))
      };
      modal.querySelectorAll('[data-modal-tab]').forEach((button) => {
        button.addEventListener('click', () => {
          modal.querySelectorAll('[data-modal-tab]').forEach((item) => item.classList.toggle('on', item === button));
          const body = document.getElementById('ws-modal-tab-body');
          if (body) body.innerHTML = bodies[button.dataset.modalTab]();
        });
      });
    });
  }

  // =====================================================
  // MODAL HELPERS
  // =====================================================

  function openModal(title, body, onBind, size, onDismiss, options = {}) {
    // Re-authentication dialogs stack above an existing modal instead of
    // replacing it, so cancelling returns the user to their previous context.
    const stack = Boolean(options.stack);
    if (!stack) document.getElementById('ws-modal')?.remove();
    const wrapper = document.createElement('div');
    wrapper.id = stack ? 'ws-modal-reauth' : 'ws-modal';
    wrapper.className = `ws-modal-backdrop${stack ? ' ws-modal-layer' : ''}`;
    wrapper.innerHTML = `<div class="ws-modal ${size || ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="ws-modal-head"><div><span class="ws-kicker">FETAN BET</span><h2>${esc(title)}</h2></div><button type="button" class="ws-icon-btn" id="ws-modal-close" aria-label="Close">${icon('close')}</button></div>
      <div class="ws-modal-body">${body}</div>
    </div>`;
    document.body.appendChild(wrapper);
    const close = () => {
      if (!wrapper.isConnected) return;
      wrapper.remove();
      if (!document.querySelector('.ws-modal-backdrop')) document.body.classList.remove('ws-modal-open');
      document.removeEventListener('keydown', onKey);
      if (onDismiss) onDismiss();
    };
    document.body.classList.add('ws-modal-open');
    wrapper.querySelector('#ws-modal-close').addEventListener('click', close);
    wrapper.addEventListener('click', (event) => { if (event.target === wrapper) close(); });
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      const layers = document.querySelectorAll('.ws-modal-backdrop');
      if (layers[layers.length - 1] !== wrapper) return;
      close();
    };
    document.addEventListener('keydown', onKey);
    if (onBind) onBind(wrapper, close);
    return { close, wrapper };
  }

  function passwordField(label = 'Confirm your Super Admin password') {
    return `<label class="ws-field full"><span>${esc(label)}</span><input name="reauth_password" type="password" autocomplete="current-password" required placeholder="Required for financial actions"></label>`;
  }

  // Reusable re-authentication dialog for sensitive Super Admin actions.
  // Keeps the premium workspace look and replaces native prompt()/confirm().
  function openReauth({ title, message, confirmLabel = 'Confirm', tone = 'primary', onConfirm, onCancel, onError }) {
    let completed = false;
    openModal(title, `<div class="ws-reauth">
      <p class="ws-muted">${esc(message || 'Confirm your Super Admin password to continue.')}</p>
      <form class="ws-reauth-form" novalidate>
        ${passwordField('Super Admin password')}
        <div class="ws-form-actions">
          <button type="button" class="ws-btn ghost" data-reauth-cancel>Cancel</button>
          <button type="submit" class="ws-btn ${tone}" data-reauth-submit>${esc(confirmLabel)}</button>
        </div>
      </form>
    </div>`, (modal, close) => {
      const form = modal.querySelector('.ws-reauth-form');
      const submit = modal.querySelector('[data-reauth-submit]');
      modal.querySelector('[data-reauth-cancel]').addEventListener('click', close);
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const password = String(new FormData(form).get('reauth_password') || '');
        if (!password) { form.querySelector('input[name="reauth_password"]')?.focus(); return; }
        submit.disabled = true;
        try {
          await onConfirm(password);
          completed = true;
          close();
        } catch (error) {
          submit.disabled = false;
          if (onError) onError(error);
          else ctx.fail(error);
        }
      });
      window.setTimeout(() => form.querySelector('input[name="reauth_password"]')?.focus(), 40);
    }, undefined, () => {
      if (!completed && onCancel) onCancel();
    }, { stack: true });
  }

  function failureMessage(error) {
    const code = String((error && error.message) || 'GENERIC');
    const messages = {
      REAUTH_REQUIRED: 'Super Admin password is incorrect. Please re-enter it.',
      VERIFICATION_REQUIRED: 'Complete all verification checks before approving.',
      NOT_FOUND: 'This request is no longer pending. Refresh the list and try again.',
      SELF: 'You cannot approve your own request.',
      FORBIDDEN: 'You do not have permission for this action.',
      NETWORK: 'Network error. Check your connection and try again.',
      RATE: 'Too many attempts. Wait a moment and try again.',
      SERVICE_UNAVAILABLE: 'The service is temporarily unavailable. Try again shortly.',
      SCHEMA_NOT_READY: 'The database update is not available yet. Try again shortly.',
      INVALID: 'Some details are invalid. Check the form and try again.',
      GENERIC: 'The server could not complete this action. Please try again.'
    };
    return messages[code] || 'Something went wrong. Please try again.';
  }

  function clearFormError(form) {
    form.querySelector('.ws-inline-error')?.remove();
  }

  function showFormError(form, error) {
    let box = form.querySelector('.ws-inline-error');
    if (!box) {
      box = document.createElement('div');
      box.className = 'ws-inline-error';
      box.setAttribute('role', 'alert');
      form.prepend(box);
    }
    box.textContent = failureMessage(error);
    box.hidden = false;
  }

  function errorBox(message) {
    return `<div class="ws-inline-error" role="alert">${esc(message || 'Something went wrong.')}</div>`;
  }

  // =====================================================
  // MOUNT
  // =====================================================

  async function mount(app, context) {
    cleanup();
    ctx = context;
    root = app;
    document.body.classList.add('workspace-mode', ctx.me.role === 'agent' ? 'ws-agent' : 'ws-superadmin');
    const hash = /^#\/(agent|superadmin)\/([a-z-]+)$/.exec(window.location.hash || '');
    const requested = hash && hash[1] === ctx.me.role && hash[2] ? hash[2] : '';
    state.page = allowedPage(requested) ? requested : defaultPage();
    renderShell();
    await loadNotifications(true);
    await renderPage();
  }

  window.FetanWorkspace = { mount, cleanup };
})();

