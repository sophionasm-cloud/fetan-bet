// ፍጣን ቤት front-end — Stake-inspired professional UI, no build step.
'use strict';
let T = {}, lang = localStorage.getItem('lang') || 'en', me = null, balance = 0, promoCredits = 0,
    limits = { min: 100, max: 100000 }, tab = 'games', agentSubtab = 'deposits';
let homePromoCleanup = null;
let gameImmersiveScrollY = null;

window.setFetanGameImmersive = (active) => {
  const root = document.documentElement;
  if (active) {
    if (gameImmersiveScrollY === null) gameImmersiveScrollY = window.scrollY || 0;
    root.classList.add('fetan-game-immersive');
    document.body.classList.add('game-open');
    return;
  }
  const wasImmersive = root.classList.contains('fetan-game-immersive');
  root.classList.remove('fetan-game-immersive', 'chicken-road-immersive');
  document.body.classList.remove('game-open', 'immersive-sheet-open');
  if (wasImmersive && document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {});
  }
  if (wasImmersive && gameImmersiveScrollY !== null) {
    const restoreY = gameImmersiveScrollY;
    gameImmersiveScrollY = null;
    requestAnimationFrame(() => window.scrollTo({ top: restoreY, behavior: 'auto' }));
  }
};
window.setFetanChickenImmersive = window.setFetanGameImmersive;

const $ = (id) => document.getElementById(id);
const t = (k) => T[k] ?? k;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const csvCell = (value) => {
  let text = String(value ?? '');
  if (/^[=+@]/.test(text) || /^-\D/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};
const downloadCsv = (filename, rows) => {
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};
const fmt = (n) => (n / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const rel = (cents) => (cents >= 0 ? '+' : '') + fmt(cents);
const initials = (name) => String(name || '?').trim().charAt(0).toUpperCase();
const uiIcon = (name) => {
  const paths = {
    games: '<path d="M6 11h4m-2-2v4m8-3h.01M19 13h.01"/><path d="M7.5 6h9a4 4 0 0 1 3.8 2.8l1.1 3.6a2.7 2.7 0 0 1-4.2 2.9l-2.3-1.7H9.1l-2.3 1.7a2.7 2.7 0 0 1-4.2-2.9l1.1-3.6A4 4 0 0 1 7.5 6Z"/>',
    wallet: '<rect x="3" y="6" width="18" height="15" rx="2.5"/><path d="M3 9h18M16 14h2"/><path d="M6 6V4.8A1.8 1.8 0 0 1 7.8 3H19"/>',
    deposit: '<path d="M12 3v12m-5-5 5 5 5-5"/><path d="M5 17v3h14v-3"/>',
    withdraw: '<path d="M12 21V9m-5 5 5-5 5 5"/><path d="M5 7V4h14v3"/>',
    history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    profile: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
    support: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9a2.5 2.5 0 1 1 4.2 1.8c-1.2 1-1.8 1.4-1.8 2.7m0 3h.01"/>',
    home: '<path d="m3 10 9-7 9 7"/><path d="M5 9v11h14V9M9 20v-6h6v6"/>',
    promo: '<path d="M20 12v8H4v-8"/><path d="M2 7h20v5H2zM12 7v13"/><path d="M12 7H8.5a2.5 2.5 0 1 1 2.2-3.7L12 7Zm0 0h3.5a2.5 2.5 0 1 0-2.2-3.7L12 7Z"/>',
    login: '<path d="M10 17l5-5-5-5m5 5H3"/><path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7"/>',
    logout: '<path d="M14 17l5-5-5-5m5 5H3"/><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    soundOn: '<path d="M11 5 6.5 9H3v6h3.5L11 19V5Z"/><path d="M15 9.5a4 4 0 0 1 0 5M17.8 6.7a8 8 0 0 1 0 10.6"/>',
    soundOff: '<path d="M11 5 6.5 9H3v6h3.5L11 19V5Z"/><path d="m16 9 5 5m0-5-5 5"/>',
    chevronLeft: '<path d="m14.5 6-6 6 6 6"/>',
    chevronRight: '<path d="m9.5 6 6 6-6 6"/>',
    arrowRight: '<path d="M4 12h15m-5-5 5 5-5 5"/>',
  };
  return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true">${paths[name] || ''}</svg>`;
};

function scrollPublicTarget(target) {
  if (target === 'top') {
    window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    return;
  }
  const node = document.getElementById(target);
  if (!node) return;
  node.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

function clearPromoSlider() {
  homePromoCleanup?.();
  homePromoCleanup = null;
}

function syncPublicNavigation(enabled) {
  // Login and registration live in the header; the menu holds secondary
  // public links. Avoid mounting customer destinations for guests.
  document.body.classList.toggle('guest-mode', enabled);
}

function balanceMarkup(amount, unit) {
  return `<span class="balance-dot" aria-hidden="true"></span><span class="balance-value">${fmt(amount)}</span><span class="balance-unit">${esc(unit)}</span>`;
}

function soundIsMuted() {
  if (window.Games?.isMuted) return Boolean(window.Games.isMuted());
  return localStorage.getItem('mute') === '1';
}

function toggleSound() {
  const next = !soundIsMuted();
  if (window.Games?.setMuted) window.Games.setMuted(next);
  else localStorage.setItem('mute', next ? '1' : '0');
  renderMobileHeaderMenu();
}

function mountPromoSlider(app) {
  clearPromoSlider();
  const gameCount = new Set([...app.querySelectorAll('.home-game-card')].map((card) => card.dataset.game)).size;
  const currentCustomer = me?.role === 'user';
  const gameTokens = [
    ['road', 'Chicken Road Dash'], ['mines', 'Mines'], ['plinko', 'Plinko'],
    ['penalty', 'Penalty Unlimited'], ['keno', 'Keno'], ['roulette', 'Roulette'], ['star', 'Star Spin']
  ];
  const tokenMarkup = () => gameTokens.map(([key, label], index) => `
    <span class="promo-game-token promo-game-token--${key}" style="--token-index:${index}" title="${esc(label)}">
      <svg viewBox="0 0 64 64" focusable="false" aria-hidden="true"><use href="/images/promotions/game-tokens.svg#token-${key}"></use></svg>
    </span>`).join('');
  const am = lang === 'am';
  const slides = [
    {
      key: 'daily-winning', image: '/images/promotions/daily-winning.svg',
      title: am ? 'ለእያንዳንዱ ስሜት ጨዋታ አለ' : 'A game for every mood',
      copy: am ? 'ኦሪጅናል፣ የቁጥር እና የጠረጴዛ ጨዋታዎችን በአንድ ቦታ ይመልከቱ።' : 'Explore original, number and table games in one lobby.',
      note: am ? 'የጨዋታ ውጤቶች በአገልጋዩ ይወሰናሉ።' : 'Game results are determined by the server.',
      action: 'games', cta: am ? 'ጨዋታዎችን ይመልከቱ' : 'Explore games'
    },
    {
      key: 'six-games', image: '/images/promotions/six-games.svg',
      title: am ? `${gameCount} ጨዋታዎች፣ አንድ ሎቢ` : `${gameCount} games, one lobby`,
      copy: am ? 'የሚወዱትን ይምረጡ፤ ሁሉም ጨዋታዎች እዚህ ይገኛሉ።' : 'Browse the available games and choose what you feel like playing.',
      note: am ? 'ምሳሌያዊ የጨዋታ ምስሎች።' : 'Illustrative artwork; the game posters are below.',
      action: 'games', cta: am ? 'ሁሉንም ይመልከቱ' : 'Browse games'
    },
    {
      key: 'fast-withdrawals', image: '/images/promotions/fast-withdrawals.svg',
      title: am ? 'ጥያቄዎን በኪስ ቦርሳ ይከታተሉ' : 'Keep up with your wallet',
      copy: am ? 'የማውጣት ጥያቄ ያስገቡና ሁኔታውን በኪስ ቦርሳ ይመልከቱ።' : 'Submit a withdrawal request and follow its status in Wallet.',
      note: am ? 'የጥያቄ ጊዜዎች ሊለያዩ ይችላሉ።' : 'Review and processing times vary.',
      action: 'wallet', cta: am ? 'ኪስ ቦርሳ' : 'View wallet'
    }
  ];
  if (!currentCustomer) slides.push({
    key: 'registration-bonus', image: '/images/promotions/registration-bonus.svg',
    title: am ? 'በሪፈራል ኮድ ይመዝገቡ' : 'Register with an active referral code',
    offer: am ? '2,000 የፕሮሞ ክሬዲት' : '2,000 promo credits',
    copy: am ? 'ብቁ የሆኑ አዳዲስ መለያዎች ንቁ የወኪል ኮድ ሲጠቀሙ አንድ ጊዜ ይሸለማሉ።' : 'Eligible new accounts receive a one-time reward when they register with an active agent code.',
    note: am ? 'የፕሮሞ ክሬዲት ከገንዘብ ቀሪ ሂሳብ የተለየ ሲሆን ለማውጣት አይቻልም።' : 'Promo credits are separate from cash balance and cannot be withdrawn.',
    action: 'register', cta: am ? 'ይመዝገቡ' : 'Register now'
  });

  const slider = document.createElement('section');
  slider.className = 'promo-slider';
  slider.id = 'promoSlider';
  slider.setAttribute('aria-label', am ? 'የፍጣን ቤት ማስታወቂያዎች' : 'Fetan Bet promotions');
  slider.setAttribute('aria-roledescription', 'carousel');
  const promoCode = new URLSearchParams(location.search).get('promo') || new URLSearchParams(location.search).get('promo_code') || '';
  const tokenHtml = tokenMarkup();
  const slideMarkup = (slide, logicalIndex, clone = false) => `
    <article class="promo-slide promo-slide--${slide.key}" role="group" aria-roledescription="slide" aria-label="${logicalIndex + 1} of ${slides.length}" data-slide-key="${slide.key}"${clone ? ' data-slide-clone="true" inert aria-hidden="true"' : ''}>
      <div class="promo-slide-copy">
        <span class="promo-slide-kicker">FETAN BET <i></i> ${currentCustomer ? (am ? 'ለእርስዎ' : 'FOR YOU') : (am ? 'ማስታወቂያ' : 'PROMOTIONS')}</span>
        <h2>${esc(slide.title)}</h2>
        ${slide.offer ? `<strong class="promo-slide-offer">${esc(slide.offer)}</strong>` : ''}
        <p>${esc(slide.copy)}</p>
        <small class="promo-slide-note">${esc(slide.note)}</small>
        <button type="button" class="promo-slide-cta" data-promo-action="${slide.action}">${esc(slide.cta)} <span aria-hidden="true">→</span></button>
      </div>
      ${slide.key === 'six-games' ? `<div class="promo-slide-art promo-slide-art--showcase" aria-hidden="true"><span class="promo-art-glow"></span><div class="promo-showcase"><div class="promo-game-orbit">${tokenHtml}</div><img class="promo-showcase-collage" src="/images/promotions/game-collage.svg" width="640" height="520" alt="" loading="eager" decoding="async"></div></div><div class="promo-game-strip" aria-hidden="true">${tokenHtml}</div>` : `<div class="promo-slide-art" aria-hidden="true"><span class="promo-art-glow"></span><img src="${slide.image}" width="560" height="360" alt="" loading="eager" decoding="async"></div>`}
    </article>`;
  const copies = [slides[slides.length - 1], ...slides, slides[0]];
  slider.innerHTML = `
    <div class="promo-slider-frame"><div class="promo-slider-track">${copies.map((slide, index) => {
      const clone = index === 0 || index === copies.length - 1;
      const logicalIndex = index === 0 ? slides.length - 1 : index === copies.length - 1 ? 0 : index - 1;
      return slideMarkup(slide, logicalIndex, clone);
    }).join('')}</div></div>
    <div class="promo-slider-bar">
      <span class="promo-slider-counter" aria-hidden="true">01 / ${String(slides.length).padStart(2, '0')}</span>
      <div class="promo-slider-controls">
        <button type="button" class="promo-slider-arrow" data-promo-prev aria-label="${am ? 'ቀዳሚ ማስታወቂያ' : 'Previous promotion'}">‹</button>
        <div class="promo-slider-dots" role="group" aria-label="${am ? 'ማስታወቂያ ይምረጡ' : 'Choose a promotion'}">${slides.map((slide, i) => `<button type="button" data-promo-dot="${i}" aria-label="${am ? `ማስታወቂያ ${i + 1}` : `Show promotion ${i + 1}`}" aria-pressed="${i === 0}"${i === 0 ? ' class="is-active"' : ''}></button>`).join('')}</div>
        <button type="button" class="promo-slider-arrow" data-promo-next aria-label="${am ? 'ቀጣይ ማስታወቂያ' : 'Next promotion'}">›</button>
      </div>
    </div>`;
  app.prepend(slider);

  const track = slider.querySelector('.promo-slider-track');
  const panels = [...track.children];
  const dots = [...slider.querySelectorAll('[data-promo-dot]')];
  const counter = slider.querySelector('.promo-slider-counter');
  const realCount = slides.length;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const hoverCapable = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  let index = 1;
  let timer = null;
  let transitionTimer = null;
  let touchStart = null;
  const setTrack = () => { track.style.transform = `translate3d(-${index * 100}%, 0, 0)`; };
  const realIndex = () => index === 0 ? realCount - 1 : index === realCount + 1 ? 0 : index - 1;
  const paint = () => {
    const active = realIndex();
    panels.forEach((panel, panelIndex) => {
      const isActive = panelIndex === index;
      panel.setAttribute('aria-hidden', String(!isActive));
      panel.inert = !isActive;
    });
    dots.forEach((dot, dotIndex) => {
      const selected = dotIndex === active;
      dot.classList.toggle('is-active', selected);
      dot.setAttribute('aria-pressed', String(selected));
    });
    counter.textContent = `${String(active + 1).padStart(2, '0')} / ${String(realCount).padStart(2, '0')}`;
  };
  const snap = (nextIndex) => {
    track.classList.add('is-snapping');
    index = nextIndex;
    setTrack();
    paint();
    requestAnimationFrame(() => requestAnimationFrame(() => track.classList.remove('is-snapping')));
  };
  const move = (nextIndex) => {
    clearTimeout(transitionTimer);
    index = nextIndex;
    setTrack();
    paint();
    transitionTimer = setTimeout(() => {
      if (index === 0) snap(realCount);
      else if (index === realCount + 1) snap(1);
    }, 720);
  };
  const next = () => move(index >= realCount ? realCount + 1 : index + 1);
  const previous = () => move(index <= 1 ? 0 : index - 1);
  const pauseAuto = () => { clearInterval(timer); timer = null; };
  const startAuto = () => {
    pauseAuto();
    if (!reduceMotion.matches && !slider.matches(':hover') && document.visibilityState === 'visible') {
      timer = setInterval(() => slider.isConnected ? next() : cleanup(), 6000);
    }
  };
  const onMouseEnter = () => pauseAuto();
  const onMouseLeave = () => startAuto();
  const onFocusIn = () => pauseAuto();
  const onFocusOut = (event) => { if (!slider.contains(event.relatedTarget)) startAuto(); };
  const onVisibility = () => document.visibilityState === 'visible' ? startAuto() : pauseAuto();
  const onMotionChange = () => startAuto();
  const onTransitionEnd = (event) => {
    if (event.target !== track || event.propertyName !== 'transform') return;
    if (index === 0) snap(realCount);
    else if (index === realCount + 1) snap(1);
  };
  const onTouchStart = (event) => { const point = event.changedTouches[0]; touchStart = { x: point.clientX, y: point.clientY }; };
  const onTouchEnd = (event) => {
    if (!touchStart) return;
    const point = event.changedTouches[0];
    const dx = point.clientX - touchStart.x;
    const dy = point.clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) < 40 || Math.abs(dx) <= Math.abs(dy)) return;
    dx < 0 ? next() : previous();
    startAuto();
  };
  const onClick = (event) => {
    if (event.target.closest('[data-promo-next]')) { next(); startAuto(); return; }
    if (event.target.closest('[data-promo-prev]')) { previous(); startAuto(); return; }
    const dot = event.target.closest('[data-promo-dot]');
    if (dot) { move(Number(dot.dataset.promoDot) + 1); startAuto(); return; }
    const button = event.target.closest('[data-promo-action]');
    if (!button) return;
    const action = button.dataset.promoAction;
    if (action === 'games') { scrollPublicTarget('ggrid'); return; }
    if (action === 'wallet') {
      if (me?.role === 'user') { tab = 'wallet'; render(); }
      else $('headerLoginBtn')?.click();
    }
    if (action === 'register') authView(app, 'register', promoCode);
  };
  track.addEventListener('transitionend', onTransitionEnd);
  slider.addEventListener('click', onClick);
  slider.addEventListener('touchstart', onTouchStart, { passive: true });
  slider.addEventListener('touchend', onTouchEnd, { passive: true });
  if (hoverCapable) { slider.addEventListener('mouseenter', onMouseEnter); slider.addEventListener('mouseleave', onMouseLeave); }
  slider.addEventListener('focusin', onFocusIn);
  slider.addEventListener('focusout', onFocusOut);
  document.addEventListener('visibilitychange', onVisibility);
  reduceMotion.addEventListener?.('change', onMotionChange);
  setTrack();
  paint();
  startAuto();
  const cleanup = () => {
    pauseAuto();
    clearTimeout(transitionTimer);
    track.removeEventListener('transitionend', onTransitionEnd);
    slider.removeEventListener('click', onClick);
    slider.removeEventListener('touchstart', onTouchStart);
    slider.removeEventListener('touchend', onTouchEnd);
    slider.removeEventListener('mouseenter', onMouseEnter);
    slider.removeEventListener('mouseleave', onMouseLeave);
    slider.removeEventListener('focusin', onFocusIn);
    slider.removeEventListener('focusout', onFocusOut);
    document.removeEventListener('visibilitychange', onVisibility);
    reduceMotion.removeEventListener?.('change', onMotionChange);
  };
  homePromoCleanup = cleanup;
}

function syncCustomerTheme(enabled) {
  // One dark theme only. Staff workspaces keep their own palette.
  document.body.classList.toggle('customer-theme', enabled);
  document.body.dataset.customerTheme = 'dark';
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) themeMeta.content = '#141414';
}

function renderMobileHeaderMenu() {
  const panel = $('mobileMenuPanel');
  if (!panel) return;
  const muted = soundIsMuted();
  const soundEntry = {
    action: 'sound',
    icon: uiIcon(muted ? 'soundOff' : 'soundOn'),
    label: `${t('sound')}: ${muted ? (lang === 'am' ? 'ጠፍቷል' : 'Off') : (lang === 'am' ? 'በርቷል' : 'On')}`,
    pressed: muted
  };
  const links = me?.role === 'user'
    ? [
        { action: 'withdraw', icon: uiIcon('withdraw'), label: t('withdraw') },
        { action: 'history', icon: uiIcon('history'), label: t('history') },
        { action: 'support', icon: uiIcon('support'), label: t('support') },
        soundEntry,
        { action: 'language', icon: uiIcon('globe'), label: lang === 'am' ? 'English' : 'አማርኛ' },
        { action: 'logout', icon: uiIcon('logout'), label: t('logout') }
      ]
    : me
      ? [
          { action: 'support', icon: uiIcon('support'), label: t('support') },
          soundEntry,
          { action: 'language', icon: uiIcon('globe'), label: lang === 'am' ? 'English' : 'አማርኛ' },
          { action: 'logout', icon: uiIcon('logout'), label: t('logout') }
        ]
      : [
          { action: 'games', icon: uiIcon('games'), label: t('games') },
          { action: 'promo', icon: uiIcon('promo'), label: lang === 'am' ? 'የሪፈራል ኮድ' : 'Promo code' },
          { action: 'about', icon: uiIcon('home'), label: lang === 'am' ? 'ስለ ፍጣን ቤት' : 'About' },
          { action: 'help', icon: uiIcon('support'), label: lang === 'am' ? 'እገዛ' : 'Help' },
          soundEntry,
          { action: 'login', icon: uiIcon('login'), label: t('login') },
          { action: 'register', icon: uiIcon('profile'), label: t('register') },
          { action: 'language', icon: uiIcon('globe'), label: lang === 'am' ? 'English' : 'አማርኛ' }
        ];
  panel.innerHTML = links.map(({ action, icon, label, pressed }) =>
    `<button type="button" role="menuitem" data-mobile-action="${action}"${pressed === undefined ? '' : ` aria-pressed="${pressed}"`}><span aria-hidden="true">${icon}</span>${esc(label)}</button>`
  ).join('');
  panel.querySelectorAll('[data-mobile-action]').forEach((button) => {
    button.onclick = () => {
      const action = button.dataset.mobileAction;
      if (action === 'sound') {
        toggleSound();
        return;
      }
      panel.hidden = true;
      $('mobileHeaderMenu').setAttribute('aria-expanded', 'false');
      if (action === 'withdraw' || action === 'history') { tab = action; render(); }
      if (action === 'support') { tab = 'support'; render(); }
      if (action === 'games') scrollPublicTarget('ggrid');
      if (action === 'promo') {
        const promo = new URLSearchParams(location.search).get('promo') || new URLSearchParams(location.search).get('promo_code') || '';
        authView($('app'), 'register', promo);
      }
      if (action === 'about') scrollPublicTarget('publicInfo');
      if (action === 'help') scrollPublicTarget('publicHelp');
      if (action === 'language') $('langBtn').click();
      if (action === 'login') $('headerLoginBtn').click();
      if (action === 'register') $('headerRegBtn').click();
      if (action === 'logout') $('logoutBtn').click();
    };
  });
}

// ---------- API ----------
async function api(path, body, method = body === undefined ? 'GET' : 'POST') {
  const opt = method === 'GET' ? {} : {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
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

async function openDepositReview(deposit, onDone, canDecide = false) {
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
      ${canDecide ? `<fieldset class="review-checklist"><legend>Verification checklist</legend>${checks.map(([key, label]) => `<label><input type="checkbox" name="${key}"><span>${label}</span></label>`).join('')}</fieldset>
      <label for="deposit-review-note">Review note / rejection reason</label><textarea id="deposit-review-note" maxlength="200" rows="2" placeholder="Required for reject or escalate"></textarea>
      <label for="superadmin-reauth">Super Admin password confirmation</label><input id="superadmin-reauth" type="password" autocomplete="current-password" required>
      <div class="deposit-review-actions"><button type="button" class="btn btn-outline" data-review-action="escalate">Escalate</button><button type="button" class="btn bad" data-review-action="reject">Reject</button><button type="button" class="btn btn-gold" data-review-action="approve">Approve verified deposit</button></div>` : '<p class="notice">Read-only review. Only a Super Admin can decide this request.</p>'}
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
        const reauth_password = dialog.querySelector('#superadmin-reauth').value;
        await api(`/agent/deposits/${encodeURIComponent(deposit.id)}/decide`, { action, reason, verification, reauth_password });
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
    me = d.user; balance = d.balance; promoCredits = Number(d.promo_credits || 0); limits = d.limits;
  } catch { me = null; }

  // Header controls synchronization
  const isLogged = Boolean(me);
  syncPublicNavigation(!me);
  syncCustomerTheme(!me || me.role === 'user');
  $('balanceBox').hidden = !isLogged;
  $('quickDepositBtn').hidden = !isLogged;
  $('logoutBtn').hidden = !isLogged;
  $('headerLoginBtn').hidden = isLogged;
  $('headerRegBtn').hidden = isLogged;

  if (isLogged) {
    const balanceUnit = me.role === 'user' ? t('currency_etb') : t('credits');
    $('balanceBox').innerHTML = balanceMarkup(balance, balanceUnit);
    $('balanceBox').setAttribute('aria-label', `${t('balance')}: ${fmt(balance)} ${balanceUnit}`);
    if (me.role !== 'user') {
      $('quickDepositBtn').hidden = true;
    }
  }
  renderMobileHeaderMenu();
  return isLogged;
}

function setBalance(b) {
  balance = b;
  $('balanceBox').innerHTML = balanceMarkup(b, t('currency_etb'));
  $('balanceBox').setAttribute('aria-label', `${t('balance')}: ${fmt(b)} ${t('currency_etb')}`);
  window.dispatchEvent(new CustomEvent('fetan-balance-change', { detail: { balance: b } }));
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
$('brandBtn').onkeydown = (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  $('brandBtn').click();
};
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
  const n = $('nav');
  if (!me) {
    n.hidden = true;
    n.replaceChildren();
    document.body.classList.remove('has-app-nav');
    return;
  }
  const tabs = [];
  if (me && (me.role === 'admin' || me.role === 'superadmin')) {
    tabs.push(['admin', '⚙', 'admin']);
  } else if (me?.role === 'agent') {
    tabs.push(['agent', '🔑', 'agent']);
  } else {
    // Customers always get the same four primary destinations. Secondary
    // destinations remain available from the header menu on small screens.
    tabs.push(['games', uiIcon('games'), t('games')]);
    tabs.push(['wallet', uiIcon('wallet'), t('wallet')]);
    tabs.push(['deposit', uiIcon('deposit'), t('deposit')]);
    tabs.push(['profile', uiIcon('profile'), lang === 'am' ? 'ፕሮፋይል' : 'Profile']);
  }

  if (me.role !== 'user') {
    n.hidden = true;
    n.replaceChildren();
    document.body.classList.remove('has-app-nav');
    return;
  }
  n.hidden = false;
  n.setAttribute('aria-label', 'Customer navigation');
  n.className = 'tabs app-bottom-tabs';
  document.body.classList.add('has-app-nav');
  n.innerHTML = tabs.map(([k, icon, label]) =>
    `<button type="button" data-k="${k}" class="${tab === k ? 'on' : ''}"${tab === k ? ' aria-current="page"' : ''}><span class="nav-icon" aria-hidden="true">${icon}</span><span class="nav-label">${esc(label)}</span></button>`
  ).join('');
  n.querySelectorAll('button').forEach((b) => (b.onclick = () => {
    if (!me && b.dataset.k !== 'games') {
      $('headerLoginBtn')?.click();
      return;
    }
    tab = b.dataset.k;
    if (/^#\/game\//.test(location.hash)) {
      document.body.classList.remove('game-open');
      window.Games?.cleanupCurrent?.();
      history.pushState({ fetanPage: 'lobby' }, '', `${location.pathname}${location.search}#/lobby`);
    }
    render();
  }));
}

async function render(subMode = '') {
  clearPromoSlider();
  let gameRoute = /^#\/game\/(road|road-dash|chicken-road-2|penalty|mines|plinko|keno|bingo|roulette|star)$/.exec(location.hash);
  await refreshMe();
  let bingoRouteState = null;
  if (gameRoute?.[1] === 'bingo') {
    if (me?.role === 'user') {
      try { bingoRouteState = await api('/games/bingo'); } catch (_) { bingoRouteState = null; }
    }
    if (me?.role !== 'user' || !bingoRouteState?.active) {
      history.replaceState({ fetanPage: 'lobby' }, '', `${location.pathname}${location.search}#/lobby`);
      gameRoute = null;
    }
  }
  window.setFetanGameImmersive(Boolean(gameRoute && me?.role === 'user'));
  const homeView = !gameRoute && (!me || (me.role === 'user' && tab === 'games'));
  document.body.classList.toggle('home-view', homeView);
  if ((!me || !['agent', 'superadmin'].includes(me.role)) && window.FetanWorkspace) {
    window.FetanWorkspace.cleanup();
  }
  const app = $('app');
  if (!gameRoute || !me || me.role !== 'user') document.body.classList.remove('game-open');
  if (!me) {
    window.setFetanGameImmersive(false);
    document.body.classList.remove('game-open');
    tab = 'games';
    nav();
    guestView(app);
    if (subMode) authView(app, subMode);
    return;
  }

  if (gameRoute && me.role === 'user') tab = 'games';

  // Staff roles use the dedicated premium workspace; they never render
  // customer wallet/deposit/game views.
  if (me.role === 'agent' || me.role === 'superadmin') {
    window.setFetanGameImmersive(false);
    tab = 'workspace';
  } else if (me.role === 'admin') {
    window.setFetanGameImmersive(false);
    // The legacy admin console remains available for existing admin accounts.
    tab = 'admin';
  } else if (['agent', 'admin', 'workspace'].includes(tab)) {
    tab = 'games';
  }

  // Rebuild role-aware navigation on every render so tab contents, active state,
  // and responsive classes stay in sync after login, route changes, and resize.
  nav();
  $('nav').hidden = me.role !== 'user';
  syncTelegramShell(Boolean(gameRoute && me.role === 'user'));

  // While a customer is inside a game, hide the duplicated wallet balance and
  // Deposit chips from the global top header. The game shell renders its own
  // wallet controls (Roulette shows them in its game header) and Wallet /
  // Deposit remain reachable through the bottom navigation / navigation rail.
  // This only affects the game view; the homepage, lobby, wallet, deposit and
  // profile pages keep their global header unchanged.
  if (me && me.role === 'user') {
    const inGameView = Boolean(gameRoute);
    $('balanceBox').hidden = inGameView;
    $('quickDepositBtn').hidden = inGameView;
  }

  const views = {
    games: (root) => gamesView(root, gameRoute, bingoRouteState),
    wallet: walletView,
    deposit: depositView,
    withdraw: withdrawView,
    history: historyView,
    support: supportView,
    profile: profileView,
    agent: renderAgentReferralDashboard,
    admin: adminView,
    workspace: (root) => renderWorkspace(root)
  };
  try {
    const fn = views[tab] || (['admin','superadmin'].includes(me.role) ? adminView : me.role === 'agent' ? renderAgentReferralDashboard : gamesView);
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
    telegramApp.setHeaderColor?.('#141414');
    telegramApp.setBackgroundColor?.('#141414');
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
      // Fullscreen is available on newer Telegram WebApp clients only. Older
      // clients log an unsupported-method error if called despite the stub.
      if (telegramApp.isVersionAtLeast?.('8.0')) telegramApp.requestFullscreen();
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
  const routeIsGame = /^#\/game\/(road|road-dash|chicken-road-2|penalty|mines|plinko|keno|bingo|roulette|star)$/.test(location.hash);
  const shouldOpenShell = routeIsGame && me?.role === 'user';
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
window.addEventListener('popstate', () => {
  Games.cleanupCurrent();
  if (!/^#\/game\//.test(location.hash)) window.setFetanGameImmersive(false);
  render();
});

// =====================================================
// AUTH VIEW — Stake-style Login & Registration
// Reference: Dark green-black & antique-gold split card
// =====================================================
function authView(app, initialMode = 'login', promoPrefill = '') {
  clearPromoSlider();
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
              ${lang === 'am' ? 'የፍጣን ቤት ጨዋታዎችን ይመልከቱና የሚወዱትን ይምረጡ።' : 'Explore the games in the Fetan Bet lobby and choose one to play.'}
            </div>

            <ul class="auth-features">
              <li class="auth-feat-item">
                <span class="auth-feat-icon">⚡</span>
                <span>${lang === 'am' ? '<strong>የኪስ ቦርሳዎ፡</strong> ቀሪ ሂሳብዎንና የግብይት ታሪክዎን ይመልከቱ።' : '<strong>Your wallet:</strong> View your balance and transaction history.'}</span>
              </li>
              <li class="auth-feat-item">
                <span class="auth-feat-icon">⚖️</span>
                <span>${lang === 'am' ? '<strong>የክፍያ ጥያቄዎች፡</strong> የገንዘብ ማስገባትና ማውጣት ጥያቄዎችዎን ይከታተሉ።' : '<strong>Payment requests:</strong> Follow the status of your deposit and withdrawal requests.'}</span>
              </li>
              <li class="auth-feat-item">
                <span class="auth-feat-icon">🎧</span>
                <span>${lang === 'am' ? '<strong>ድጋፍ፡</strong> ከገቡ በኋላ በመለያዎ ውስጥ የድጋፍ አማራጩን ይጠቀሙ።' : '<strong>Support:</strong> Open the Support section from your account after signing in.'}</span>
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

              <label style="display:flex;align-items:center;gap:8px;margin-top:10px;font-size:13px;color:var(--text-secondary);cursor:pointer">
                <input id="l-remember" type="checkbox" checked style="accent-color:var(--gold-bright)">
                <span>${esc(t('remember_me'))}</span>
              </label>
              <p style="text-align:center;margin-top:10px;font-size:13px;color:var(--text-muted)">
                <a href="#" id="forgot-password" style="color:var(--gold-bright);font-weight:700">${esc(t('forgot_password'))}</a>
              </p>

              <button type="submit" class="btn btn-gold" style="margin-top:16px">${esc(t('login'))}</button>
            </form>
            <form id="forgot-form" hidden style="margin-top:14px;padding-top:14px;border-top:1px solid rgba(255,255,255,.08)">
              <label for="forgot-identifier">${lang === 'am' ? 'ስልክ፣ የተጠቃሚ ስም ወይም ኢሜይል' : 'Phone, username or email'}</label>
              <input id="forgot-identifier" name="identifier" type="text" autocomplete="username" required>
              <div style="display:flex;gap:8px;margin-top:10px">
                <button type="submit" class="btn btn-gold" style="flex:1">${lang === 'am' ? 'የይለፍ ቃል ጥያቄ ላክ' : 'Send reset request'}</button>
                <button type="button" class="btn btn-outline" id="forgot-cancel">${lang === 'am' ? 'ሰርዝ' : 'Cancel'}</button>
              </div>
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

              <label for="r-username" style="margin-top:10px">${lang === 'am' ? 'የተጠቃሚ ስም' : 'Username'} <span class="muted">(${esc(t('optional'))})</span></label>
              <input id="r-username" name="username" type="text" maxlength="30" autocomplete="username" placeholder="${lang === 'am' ? 'ለምሳሌ፡ fetan_user' : 'e.g. fetan_user'}">

              <label for="r-email" style="margin-top:10px">${lang === 'am' ? 'ኢሜይል' : 'Email'} <span class="muted">(${esc(t('optional'))})</span></label>
              <input id="r-email" name="email" type="email" maxlength="160" autocomplete="email" placeholder="${lang === 'am' ? 'ኢሜይልዎን ያስገቡ' : 'you@example.com'}">

              <label for="r-promo" style="margin-top:10px">${esc(t('promo_code'))} <span class="muted">(${esc(t('optional'))})</span></label>
              <input id="r-promo" name="promo_code" type="text" maxlength="20" autocomplete="off" value="${esc(promoPrefill)}">
              
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

  const urlPromo = new URLSearchParams(location.search).get('promo') || new URLSearchParams(location.search).get('promo_code');
  if (urlPromo && $('r-promo') && !$('r-promo').value) $('r-promo').value = urlPromo;

  $('forgot-password')?.addEventListener('click', (e) => {
    e.preventDefault();
    const form = $('forgot-form');
    if (!form) return;
    form.hidden = false;
    const input = $('forgot-identifier');
    input.value = String($('l-phone')?.value || '').trim();
    input.focus();
  });
  $('forgot-cancel')?.addEventListener('click', () => {
    const form = $('forgot-form');
    if (form) { form.hidden = true; form.reset(); }
  });
  $('forgot-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const identifier = String($('forgot-identifier')?.value || '').trim();
    if (!identifier) { $('forgot-identifier')?.focus(); return; }
    const button = e.target.querySelector('button[type=submit]');
    if (button) button.disabled = true;
    try {
      await api('/password-reset-request', { identifier });
      toast('If an account matches, a reset request has been opened for review.', 'ok');
      e.target.reset();
      e.target.hidden = true;
    } catch (error) {
      fail(error);
    } finally {
      if (button) button.disabled = false;
    }
  });

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
    const forgot = $('forgot-form'); if (forgot) { forgot.hidden = true; forgot.reset(); }
    $('atb-login').classList.add('active'); $('atb-register').classList.remove('active');
    $('auth-modal-title').textContent = t('login');
    $('l-phone').focus();
  }
  function showRegister() {
    clearAuthError();
    $('auth-login').hidden = true; $('auth-register').hidden = false;
    const forgot = $('forgot-form'); if (forgot) { forgot.hidden = true; forgot.reset(); }
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
      await api('/login', { phone, password, remember: $('l-remember')?.checked !== false });
      if (!await refreshMe()) throw new Error('SESSION');
      tab = (me && me.role !== 'user') ? 'workspace' : 'games';
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
    const username = String(data.username || '').trim();
    const email = String(data.email || '').trim();

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
      await api('/register', {
        name, phone, password, lang,
        username: username || undefined,
        email: email || undefined,
        promo_code: $('r-promo')?.value.trim() || ''
      });
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

function openHomeLegalDialog(title, body) {
  let dialog = $('home-legal-dialog');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'home-legal-dialog';
    dialog.className = 'home-legal-dialog';
    dialog.innerHTML = `
      <div class="home-legal-dialog-inner">
        <h2 id="home-legal-title"></h2>
        <p id="home-legal-copy"></p>
        <form method="dialog"><button type="submit" class="home-btn home-btn-primary">Close</button></form>
      </div>`;
    document.body.appendChild(dialog);
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  }
  dialog.querySelector('#home-legal-title').textContent = title;
  dialog.querySelector('#home-legal-copy').textContent = body;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function mountHomeFooter(app) {
  const site = window.FETAN_SITE || {};
  const legal = site.legal || {};
  const license = site.license || {};
  const supportHours = String(site.supportHours || '').trim();
  const responsible = '18+ only. Set a personal limit before playing and take regular breaks.';
  const cleanConfiguredText = (value, fallback) => {
    const cleaned = String(value || '').replace(/\s*\[YOUR [^\]]+\]\s*/gi, ' ').trim();
    return cleaned && !/^\[[^\]]+\]$/.test(cleaned) ? cleaned : fallback;
  };
  const responsibleDetails = cleanConfiguredText(legal.responsibleGaming, responsible);
  const termsDetails = cleanConfiguredText(legal.terms, 'Terms information is not available here yet. Please contact support for the current terms.');
  const privacyDetails = cleanConfiguredText(legal.privacy, 'Privacy information is not available here yet. Please contact support for current information.');
  const licenseAuthority = String(license.authority || '').trim();
  const licenseNumber = String(license.number || '').trim();
  const licenseConfigured = licenseAuthority && licenseNumber && !/^\[/.test(licenseAuthority) && !/^\[/.test(licenseNumber);
  const footer = document.createElement('footer');
  footer.id = 'homeFooter';
  footer.className = 'home-footer';
  footer.innerHTML = `
    <section class="home-support-card" id="publicHelp" aria-labelledby="home-support-title">
      <div class="home-support-copy">
        <span class="home-support-eyebrow">SUPPORT ${supportHours ? `<span class="home-support-hours">${esc(supportHours)}</span>` : ''}</span>
        <h2 id="home-support-title">Need help?</h2>
        <p>Use chat or contact support for account questions.</p>
      </div>
      <div class="home-support-actions">
        <button type="button" class="home-btn home-btn-primary" data-home-support="chat">Chat</button>
        <button type="button" class="home-btn home-btn-secondary" data-home-support="contact">Contact</button>
      </div>
    </section>
    <nav class="home-footer-links" aria-label="Footer navigation">
      <button type="button" data-home-link="how">How it works</button>
      <button type="button" data-home-link="wallet">Deposit and withdraw</button>
      <button type="button" data-home-link="terms">Terms</button>
      <button type="button" data-home-link="privacy">Privacy</button>
      <button type="button" data-home-link="responsible">Responsible gaming</button>
    </nav>
    <div class="home-responsible">
      <span class="home-18" aria-hidden="true">18+</span>
      <p>${esc(responsible)}</p>
    </div>
    ${licenseConfigured ? `<p class="home-license">Licensed by ${esc(licenseAuthority)} · License ${esc(licenseNumber)}</p>` : ''}`;
  app.append(footer);

  const goSupport = () => {
    if (me?.role === 'user') {
      tab = 'support';
      render();
    } else {
      $('headerLoginBtn')?.click();
    }
  };
  footer.querySelectorAll('[data-home-support]').forEach((button) => {
    button.addEventListener('click', goSupport);
  });
  footer.querySelectorAll('[data-home-link]').forEach((button) => {
    button.addEventListener('click', () => {
      const link = button.dataset.homeLink;
      if (link === 'wallet') {
        if (me?.role === 'user') {
          tab = 'wallet';
          render();
        } else {
          $('headerLoginBtn')?.click();
        }
        return;
      }
      if (link === 'how') openHomeLegalDialog('How it works', legal.howItWorks || 'Browse the games and open a title to play.');
      if (link === 'terms') openHomeLegalDialog('Terms', termsDetails);
      if (link === 'privacy') openHomeLegalDialog('Privacy', privacyDetails);
      if (link === 'responsible') openHomeLegalDialog('Responsible gaming', responsibleDetails);
    });
  });
}

function guestView(app) {
  Games.mount(app, {
    t, esc, fmt, limits, roadState: { active: false, ladder: [], maxSteps: 10 },
    minesState: { active: false, mines: 5 }, guest: true,
    onLogin: () => authView(app, 'login'),
  });
  mountPromoSlider(app);

  const info = document.createElement('section');
  info.id = 'publicInfo';
  info.className = 'guest-info-section';
  info.setAttribute('aria-labelledby', 'guest-info-title');
  info.innerHTML = `
    <div class="guest-info-heading"><div><span>${lang === 'am' ? 'መረጃ' : 'THE ESSENTIALS'}</span><h2 id="guest-info-title">${lang === 'am' ? 'ስለ ፍጣን ቤት' : 'About Fetan Bet'}</h2></div><p>${lang === 'am' ? 'ከመለያዎ ውስጥ ጨዋታዎችን፣ የኪስ ቦርሳ እና ድጋፍን ያግኙ።' : 'Find games, account payments and support in one place.'}</p></div>
    <div class="guest-info-grid">
      <article><span aria-hidden="true">${uiIcon('games')}</span><h3>${lang === 'am' ? 'ጨዋታዎች' : 'Games'}</h3><p>${lang === 'am' ? 'በዚህ ገጽ ላይ ያሉትን ጨዋታዎች ይመልከቱ።' : 'Browse the available game catalog from the lobby.'}</p></article>
      <article><span aria-hidden="true">${uiIcon('wallet')}</span><h3>${lang === 'am' ? 'የኪስ ቦርሳ እና ክፍያዎች' : 'Wallet and payments'}</h3><p>${lang === 'am' ? 'የክፍያ ጥያቄዎችን ከመለያዎ ያስገቡና ሁኔታቸውን ይከታተሉ።' : 'Sign in to submit deposit or withdrawal requests and follow their status.'}</p></article>
      <article><span aria-hidden="true">${uiIcon('support')}</span><h3>${lang === 'am' ? 'ድጋፍ' : 'Support'}</h3><p>${lang === 'am' ? 'በመለያዎ ውስጥ የድጋፍ አማራጩን ይጠቀሙ።' : 'Open Support from your account to contact the support assistant.'}</p></article>
      <article><span aria-hidden="true">${uiIcon('history')}</span><h3>${lang === 'am' ? 'በኃላፊነት ይጫወቱ' : 'Play thoughtfully'}</h3><p>${lang === 'am' ? 'ከመጫወትዎ በፊት የግል ገደብ ያዘጋጁና ዕረፍት ይውሰዱ።' : 'Set a personal limit before playing and take breaks.'}</p></article>
    </div>`;

  app.append(info);
  mountHomeFooter(app);

}

// =====================================================
// GAMES VIEW (Primary Landing Page)
// =====================================================
async function gamesView(app, gameRoute = null, bingoState = null) {
  const [roadState, minesState] = await Promise.all([
    api('/games/road').catch(() => ({ active: false, ladder: [], maxSteps: 10 })),
    api('/games/mines').catch(() => ({ active: false, mines: 5 }))
  ]);
  if (roadState.balance !== undefined) setBalance(roadState.balance);
  Games.mount(app, {
    api, t, esc, fmt, setBalance, fail, limits,
    user: me,
    getBalance: () => balance,
    roadState, minesState, bingoState,
    reload: () => render(),
    refreshAccount: async () => {
      const response = await api('/me');
      if (response.user?.role !== 'user') throw new Error('LOGIN');
      me = response.user;
      promoCredits = Number(response.promo_credits || 0);
      limits = response.limits || limits;
      setBalance(Number(response.balance || 0));
      return response;
    },
    navigateCustomer: (nextTab) => {
      if (me?.role !== 'user' || !['wallet', 'deposit', 'withdraw', 'profile', 'support', 'history'].includes(nextTab)) return;
      tab = nextTab;
      Games.cleanupCurrent();
      window.setFetanGameImmersive(false);
      document.body.classList.remove('game-open');
      if (/^#\/game\//.test(location.hash)) {
        history.replaceState({ fetanPage: 'lobby' }, '', `${location.pathname}${location.search}#/lobby`);
      }
      render();
    }
  });
  if (!gameRoute) {
    mountPromoSlider(app);
    mountHomeFooter(app);
  }
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
        <div class="stat" style="background:var(--surface-hover);border-color:var(--accent-border)">
          <div class="stat-label">${esc(t('balance'))} (${esc(t('currency_etb'))})</div>
          <b style="color:var(--gold-bright);font-size:32px;letter-spacing:0.5px">🪙 ${fmt(balance)}</b>
        </div>
        ${promoCredits > 0 ? `<div class="stat">
          <div class="stat-label">Promotional credits</div>
          <b style="color:var(--ws-success);font-size:26px">🎁 ${fmt(promoCredits)}</b>
          <div class="muted">Welcome bonus · not withdrawable</div>
        </div>` : ''}
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
          <td style="font-weight:800;color:var(--text-strong);font-size:15px">${fmt(w.amount)} ${esc(t('currency_etb'))}</td>
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
        <div style="padding:10px 18px;background:var(--danger-bg);border-top:1px solid var(--danger-border);font-size:12px;color:var(--danger)">
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
async function agentView(app) { return renderAgentReferralDashboard(app); }

let agentSection = 'overview';
let agentActivityOffset = 0;

async function renderAgentReferralDashboard(app) {
  app.innerHTML = '<div class="card agent-loading" role="status">Loading your referral dashboard…</div>';
  const results = await Promise.allSettled([api(`/agent/referrals?limit=50&offset=${agentActivityOffset}`), api('/agent/tickets?status=all'), api('/announcements')]);
  const data = results[0].status === 'fulfilled' ? results[0].value : null;
  const tickets = results[1].status === 'fulfilled' ? results[1].value.tickets : [];
  const announcements = results[2].status === 'fulfilled' ? results[2].value.announcements : [];
  const err = results[0].status === 'rejected' ? results[0].reason : null;
  const profile = data?.profile || {}, activity = data?.activity || {}, counts = data?.user_counts || {};
  const tabs = [['overview','Overview'],['users','Referred users'],['activity','Transactions'],['compensation','Compensation'],['support','Support']];
  const content = err ? `<div class="agent-api-error" role="alert"><div><b>Referral data is unavailable</b><p>${esc(getErrMsg(err))}</p></div><button class="btn sm btn-outline" id="agent-reload">Retry</button></div>` : `
    <div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px">
      <div><small class="muted">Your referral code</small><div style="font-size:23px;font-weight:800;color:var(--gold-bright);font-family:monospace">${esc(profile.promo_code || '—')}</div><small class="muted">${esc(me.name)} · ${esc(me.phone)}</small></div>
      <button class="btn btn-outline" id="agent-copy-code" type="button">Copy code</button>
    </div>
    <div class="admin-stats">
      <div class="admin-stat"><div class="value">${counts.total ?? 0}</div><div class="label">Referred users</div><small>${counts.new_24h ?? 0} in 24h · ${counts.new_week ?? 0} this week</small></div>
      <div class="admin-stat"><div class="value">${fmt(activity.volume_24h ?? 0)} ETB</div><div class="label">Ledger volume · 24h (${activity.tx_24h ?? 0} entries)</div></div>
      <div class="admin-stat"><div class="value">${fmt(activity.volume_week ?? 0)} ETB</div><div class="label">Ledger volume · week (${activity.tx_week ?? 0} entries)</div></div>
      <div class="admin-stat"><div class="value">${fmt(activity.profit ?? 0)} ETB</div><div class="label">User stakes − winnings · week</div></div>
    </div>
    <div class="card"><div class="subtabs" style="overflow:auto">${tabs.map(([key,label])=>`<button class="subtab ${agentSection===key?'on':''}" data-agent-section="${key}">${label}</button>`).join('')}</div>
      ${agentSection==='overview' ? `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;padding-top:16px"><div class="stat"><div class="stat-label">Commission rate</div><b>${((Number(profile.commission_bps||0))/100).toFixed(2)}%</b><small class="muted">Default 10%; negative weekly profit carries forward.</small></div><div class="stat"><div class="stat-label">Weekly fee</div><b>${fmt(profile.weekly_fee_santim||0)} ETB</b><small class="muted">Payment is requested for Super Admin review.</small></div><div class="stat"><div class="stat-label">Open assigned support</div><b>${tickets.filter(t=>['open','pending','in_progress','escalated'].includes(t.status)).length}</b><small class="muted">Only users referred by your code.</small></div></div>${announcements.map(a=>`<div class="announcement-box"><b>${esc(a.title)}</b><p>${esc(a.content)}</p></div>`).join('')}` : ''}
      ${agentSection==='users' ? (!data.users.length ? emptyState('👥','No users have registered with your promo code yet.') : `<div class="scroll"><table><thead><tr><th>User</th><th>Phone</th><th>Status</th><th>Registered</th></tr></thead><tbody>${data.users.map(u=>`<tr><td>${esc(u.name)}</td><td>${esc(u.phone)}</td><td>${statusTag(u.status)}</td><td>${esc(u.created_at)}</td></tr>`).join('')}</tbody></table></div>`) : ''}
      ${agentSection==='activity' ? (!data.transactions.length ? emptyState('📋','No referred-user transactions yet.') : `<div class="scroll"><table><thead><tr><th>Date</th><th>Customer</th><th>Type</th><th>Amount</th><th>Status</th><th>Balance after</th></tr></thead><tbody>${data.transactions.map(x=>`<tr><td>${esc(x.created_at)}</td><td>${esc(x.user_name)}</td><td>${esc(x.type)}</td><td class="${x.amount>=0?'plus':'minus'}">${rel(x.amount)} ETB</td><td>${x.status?statusTag(x.status):'Settled'}</td><td>${x.balance_after==null?'—':`${fmt(x.balance_after)} ETB`}</td></tr>`).join('')}</tbody></table></div><div class="section-head"><span class="muted">Showing ${data.transaction_offset+1}–${Math.min(data.transaction_offset+data.transactions.length,data.transaction_count)} of ${data.transaction_count}</span><div><button class="btn sm btn-outline" data-agent-page="prev" ${data.transaction_offset===0?'disabled':''}>Previous</button> <button class="btn sm btn-outline" data-agent-page="next" ${data.transaction_offset+data.transactions.length>=data.transaction_count?'disabled':''}>Next</button></div></div>`) : ''}
      ${agentSection==='compensation' ? `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;padding:16px 0"><div class="stat"><div class="stat-label">Latest settlement commission</div><b>${fmt(data.latest_settlement?.commission_santim||0)} ETB</b></div><div class="stat"><div class="stat-label">Commission paid</div><b>${fmt(data.latest_settlement?.commission_paid||0)} ETB</b></div><div class="stat"><div class="stat-label">Weekly fee paid</div><b>${fmt(data.latest_settlement?.fee_paid||0)} ETB</b></div><div class="stat"><div class="stat-label">Fee status</div><b>${data.latest_settlement?.fee_paid ? 'Paid' : 'Pending settlement'}</b></div></div><p class="notice">Commission is calculated after a UTC Monday–Monday week closes. This demo records approved compensation as virtual wallet credits; no bank or mobile-money transfer is connected.</p><button class="btn btn-gold" id="agent-request-fee" ${!profile.weekly_fee_santim?'disabled':''}>Request weekly fee</button><button class="btn btn-outline" id="agent-request-commission" ${!data.latest_settlement?.commission_santim?'disabled':''}>Request commission</button><h3 style="margin-top:18px">Payment request history</h3>${data.payout_requests.length ? `<div class="scroll"><table><tr><th>Type</th><th>Period</th><th>Amount</th><th>Status</th><th>Reason</th></tr>${data.payout_requests.map(r=>`<tr><td>${esc(r.payout_type)}</td><td>${esc(r.period_start)} – ${esc(r.period_end)}</td><td>${fmt(r.amount_santim)} ETB</td><td>${statusTag(r.status)}</td><td>${esc(r.decision_reason||'—')}</td></tr>`).join('')}</table></div>` : emptyState('🧾','No payout requests yet.')}` : ''}
      ${agentSection==='support' ? (!tickets.length ? emptyState('💬','No support tickets assigned to your referred users.') : tickets.map(tk=>`<section class="card" style="margin-top:12px"><div class="section-head"><div><b>Ticket #${tk.id} · ${esc(tk.user_name)}</b><div class="muted">${esc(tk.user_phone)} · ${esc(tk.created_at)}</div></div>${statusTag(tk.status)}</div><p>${esc(tk.escalated_reason||tk.message||'Customer support request')}</p><form data-agent-ticket-reply="${tk.id}"><label>Reply to customer<textarea name="message" maxlength="1000" required></textarea></label><button class="btn btn-gold" type="submit">Send reply</button><button class="btn btn-outline" type="button" data-ticket-resolve="${tk.id}">Mark resolved</button></form></section>`).join('')) : ''}
    </div>`;
  app.innerHTML = `<div class="section-head"><div><h2>Agent Dashboard</h2><span class="brand-sub">REFERRALS · ACTIVITY · SUPPORT</span></div><span class="tag ${me.status}">${esc(me.status)}</span></div>${content}`;
  app.querySelector('#agent-reload')?.addEventListener('click',()=>renderAgentReferralDashboard(app));
  app.querySelector('#agent-copy-code')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(profile.promo_code);success('Promo code copied.');}catch{fail({message:'GENERIC'});}});
  app.querySelectorAll('[data-agent-section]').forEach(b=>b.onclick=()=>{agentSection=b.dataset.agentSection;renderAgentReferralDashboard(app);});
  app.querySelectorAll('[data-agent-page]').forEach(b=>b.onclick=()=>{agentActivityOffset=Math.max(0,agentActivityOffset+(b.dataset.agentPage==='next'?50:-50));renderAgentReferralDashboard(app);});
  app.querySelector('#agent-request-fee')?.addEventListener('click',async()=>{try{await api('/agent/payout-requests',{payout_type:'weekly_fee'});success('Weekly fee request sent to Super Admin.');renderAgentReferralDashboard(app);}catch(e){fail(e);}});
  app.querySelector('#agent-request-commission')?.addEventListener('click',async()=>{try{await api('/agent/payout-requests',{payout_type:'commission'});success('Commission request sent to Super Admin.');renderAgentReferralDashboard(app);}catch(e){fail(e);}});
  app.querySelectorAll('[data-agent-ticket-reply]').forEach(form=>form.onsubmit=async(ev)=>{ev.preventDefault();try{await api(`/support/ticket/${form.dataset.agentTicketReply}/reply`,{message:new FormData(form).get('message')});success('Reply sent.');renderAgentReferralDashboard(app);}catch(e){fail(e);}});
  app.querySelectorAll('[data-ticket-resolve]').forEach(b=>b.onclick=async()=>{try{await api(`/support/ticket/${b.dataset.ticketResolve}/status`,{status:'resolved'});success('Ticket resolved.');renderAgentReferralDashboard(app);}catch(e){fail(e);}});
}

let adminSection = 'analytics';
let adminAnalyticsRange = '7d';
let agentReportStart = '';
let agentReportEnd = '';
let adminTransactionFilters = {};
const settlementDefaultDate = (()=>{const d=new Date();d.setUTCHours(0,0,0,0);d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7)-7);return d.toISOString().slice(0,10);})();

async function renderWorkspace(app) {
  if (!window.FetanWorkspace) {
    app.innerHTML = '<div class="card">Workspace shell is loading…</div>';
    return;
  }
  try {
    await window.FetanWorkspace.mount(app, {
      api, t, esc, fail, success, me,
      onLogout: async () => {
        window.FetanWorkspace.cleanup();
        await api('/logout', {});
        me = null;
        tab = 'games';
        await render('login');
      }
    });
  } catch (e) {
    fail(e);
    app.innerHTML = `<div class="card agent-api-error" role="alert"><div><b>Workspace could not start.</b><p>${esc(getErrMsg(e))}</p></div><button type="button" class="btn btn-outline" id="ws-retry">Retry</button></div>`;
    document.getElementById('ws-retry')?.addEventListener('click', () => render());
  }
}

async function adminView(app) {
  const isSuperAdmin = me.role === 'superadmin';
  const transactionQuery = new URLSearchParams(adminTransactionFilters).toString();
  const [s, u, aud, fundReqs, depPending, withPending, withApproved, analytics, txs, ticketsRes, aiConfig, annRes, agentsData, agentReport, settlementsData, payoutQueue, bingoRounds] = await Promise.all([
    api('/admin/stats'),
    api('/admin/users'),
    api('/admin/audit'),
    api('/admin/agent-funding').catch(() => ({ requests: [] })),
    api('/agent/deposits?status=pending').catch(() => ({ deposits: [] })),
    api('/agent/withdrawals?status=pending').catch(() => ({ withdrawals: [] })),
    api('/agent/withdrawals?status=approved').catch(() => ({ withdrawals: [] })),
    api(`/admin/financial-analytics?range=${adminAnalyticsRange}`).catch(() => ({})),
    api(`/admin/transactions${transactionQuery ? `?${transactionQuery}` : ''}`).catch(() => ({ transactions: [] })),
    api('/admin/tickets').catch(() => ({ tickets: [] })),
    api('/admin/ai-settings').catch(() => ({ enabled: true })),
    api('/announcements').catch(() => ({ announcements: [] })),
    isSuperAdmin ? api('/superadmin/agents?limit=100').catch(() => ({ agents: [] })) : Promise.resolve({ agents: [] }),
    isSuperAdmin ? api(`/superadmin/agent-report${agentReportStart||agentReportEnd?`?start=${encodeURIComponent(agentReportStart)}&end=${encodeURIComponent(agentReportEnd)}`:''}`).catch(() => ({ agents: [] })) : Promise.resolve({ agents: [] }),
    isSuperAdmin ? api('/superadmin/settlements').catch(() => ({ settlements: [] })) : Promise.resolve({ settlements: [] }),
    isSuperAdmin ? api('/superadmin/payout-requests').catch(() => ({ requests: [] })) : Promise.resolve({ requests: [] }),
    api('/admin/active-bingo-rounds').catch(() => null),
  ]);

  const pendingFundingCount = (payoutQueue.requests || []).filter((r) => r.status === 'pending').length;

  app.innerHTML = `
    <div class="section-head">
      <div>
        <h2>⚙ ${esc(t('admin'))}</h2>
        <span class="brand-sub" style="color:var(--gold-bright)">${isSuperAdmin ? 'SUPER ADMIN EXECUTIVE DESK' : 'ADMIN OPERATIONS DESK'}</span>
      </div>
      <span class="tag ${isSuperAdmin ? 'rejected' : 'pending'}" style="font-size:12px;letter-spacing:1px;font-weight:800">${isSuperAdmin ? 'SUPER ADMIN' : 'ADMIN'}</span>
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
        <div class="label">Agent payout requests pending</div>
      </div>
      <div class="admin-stat">
        <div class="value">${s.users} customers · ${s.active_agents ?? s.agents} active agents</div>
        <div class="label">${s.suspended_agents ?? 0} suspended · registered agents ${s.agents}</div>
      </div>
    </div>

    <div class="card bingo-retirement-note" role="status" aria-live="polite">
      <div class="section-head"><h3>Bingo retired · active rounds</h3>${bingoRounds ? `<strong>${Number(bingoRounds.count || 0)}</strong>` : '<strong>—</strong>'}</div>
      <p class="muted">New rounds are disabled. Existing rounds remain available to their players until settled; no round or balance is changed by this report.</p>
      ${!bingoRounds ? '<p class="muted">Active-round status is unavailable. Refresh to retry.</p>' : bingoRounds.rounds?.length ? `<div class="scroll"><table><thead><tr><th>Round</th><th>Player</th><th>Stake</th><th>Calls</th><th>Started</th></tr></thead><tbody>${bingoRounds.rounds.map((round) => `<tr><td>#${Number(round.id)}</td><td>${esc(round.user_name)} (#${Number(round.user_id)})</td><td>${fmt(Number(round.bet))} ETB</td><td>${Number(round.step)}</td><td>${esc(round.created_at)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No active Bingo rounds remain.</p>'}
    </div>

    <!-- Admin Subtabs Navigation -->
    <div class="card" style="padding:14px 20px 6px">
      <div class="subtabs" style="margin-bottom:0;border-bottom:none;overflow-x:auto">
        <button class="subtab ${adminSection === 'analytics' ? 'on' : ''}" id="adm-tab-analytics">📊 ${esc(t('financial_analytics'))}</button>
        <button class="subtab ${adminSection === 'deposits' ? 'on' : ''}" id="adm-tab-dep">⬇ ${esc(t('sec_customer_deposits'))}<span class="tag ${depPending.deposits.length ? 'pending' : 'approved'}">${depPending.deposits.length}</span></button>
        <button class="subtab ${adminSection === 'withdrawals' ? 'on' : ''}" id="adm-tab-with">⬆ Withdrawals<span class="tag ${withPending.withdrawals.length ? 'pending' : 'approved'}">${withPending.withdrawals.length}</span></button>
        <button class="subtab ${adminSection === 'funding' ? 'on' : ''}" id="adm-tab-fund">⚡ Legacy funding history</button>
        <button class="subtab ${adminSection === 'transactions' ? 'on' : ''}" id="adm-tab-tx">📋 ${esc(t('sec_system_tx'))}</button>
        <button class="subtab ${adminSection === 'support' ? 'on' : ''}" id="adm-tab-supp">💬 ${esc(t('tickets'))} &amp; AI (${ticketsRes.tickets.length})</button>
        <button class="subtab ${adminSection === 'users' ? 'on' : ''}" id="adm-tab-users">👥 ${esc(t('users'))} &amp; Audit</button>
        ${isSuperAdmin ? `<button class="subtab ${adminSection === 'agents' ? 'on' : ''}" id="adm-tab-agents">🔑 Agents &amp; referrals</button><button class="subtab ${adminSection === 'settlements' ? 'on' : ''}" id="adm-tab-settlements">💸 Settlements &amp; payouts</button>` : ''}
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
            <tr><th>Agent Name</th><th>Phone</th><th>Status</th><th>Promo Code</th><th>Referred Users</th><th>New This Week</th><th>Resolved Tickets</th></tr>
            ${analytics.agents.map((ag) => `<tr>
              <td><b>${esc(ag.name)}</b></td>
              <td>${esc(ag.phone)}</td>
              <td>${statusTag(ag.status)}</td>
              <td>${esc(ag.promo_code)}</td>
              <td>${ag.referred_users}</td>
              <td>${ag.new_users_week}</td>
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

    ${adminSection === 'withdrawals' ? `
      <div class="card"><h3>Withdrawal requests</h3><p class="notice">Approval authorizes manual payout processing. A request is marked Paid only after the authorized operator records the external payment reference. No payout provider is connected.</p>
      ${!withPending.withdrawals.length ? emptyState('⬆','No pending withdrawals.') : `<div class="scroll"><table><tr><th>Customer</th><th>Method</th><th>Amount</th><th>Destination</th><th>Submitted</th><th>Action</th></tr>${withPending.withdrawals.map(w=>`<tr><td>${esc(w.user_name)}<div class="muted">${esc(w.phone)}</div></td><td>${esc(w.provider)}</td><td>${fmt(w.amount)} ETB</td><td>${esc(w.account_number)}</td><td>${esc(w.created_at)}</td><td>${isSuperAdmin?`<button class="btn sm btn-gold" data-withdraw-action="approve" data-id="${w.id}">Approve for processing</button><button class="btn sm bad" data-withdraw-action="reject" data-id="${w.id}">Reject</button>`:'Read only'}</td></tr>`).join('')}</table></div>`}</div>
      ${isSuperAdmin ? `<div class="card"><h3>Approved for manual payout</h3>${!withApproved.withdrawals.length?emptyState('💸','No approved withdrawals awaiting payment confirmation.'):`<div class="scroll"><table><tr><th>Customer</th><th>Amount</th><th>Destination</th><th>Approved</th><th>Confirm external payment</th></tr>${withApproved.withdrawals.map(w=>`<tr><td>${esc(w.user_name)}<div class="muted">${esc(w.phone)}</div></td><td>${fmt(w.amount)} ETB</td><td>${esc(w.account_number)}</td><td>${esc(w.reviewed_at||'')}</td><td><button class="btn sm btn-gold" data-withdraw-complete="${w.id}">Mark paid</button></td></tr>`).join('')}</table></div>`}<p class="notice">Mark paid only after the payout has been independently sent and confirmed. The original balance hold is not charged again.</p></div>` : ''}
    ` : ''}

    ${adminSection === 'agents' && isSuperAdmin ? `
      <div class="card"><div class="section-head"><div><h3>Register an agent</h3><p class="muted">Creates a dedicated Agent login and a unique referral code. Agent access can be suspended, not deleted.</p></div></div>
        <form id="superadmin-agent-create" class="grid" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px">
          <label>Name<input name="name" minlength="2" maxlength="60" required></label><label>Phone<input name="phone" type="tel" required></label>
          <label>Initial password<input name="password" type="password" minlength="12" autocomplete="new-password" required></label><label>Promo code (optional)<input name="promo_code" maxlength="20" placeholder="Auto-generated if empty"></label>
          <label>Contact details<input name="contact_info" maxlength="200"></label><label>Weekly fee (ETB)<input name="weekly_fee_etb" type="number" min="0" step="0.01" value="0" required></label>
          <label>Commission (%)<input name="commission_percent" type="number" min="0" max="100" step="0.01" value="10" required></label>
          <label>Confirm Super Admin password<input name="reauth_password" type="password" autocomplete="current-password" required></label>
          <div><button class="btn btn-gold" type="submit">Create agent</button></div>
        </form>
      </div>
      <div class="card"><div class="section-head"><div><h3>Agent activity & referrals</h3><p class="muted">Weekly profit is user stakes minus winnings, in ETB minor units; UTC Monday week. Negative profit carries forward.</p></div><button id="agents-csv" class="btn sm btn-outline">Export CSV</button></div>
       <form id="agent-report-range" style="display:flex;gap:10px;flex-wrap:wrap;align-items:end"><label>Range start<input name="start" type="date" value="${esc(agentReportStart)}"></label><label>Range end (inclusive)<input name="end" type="date" value="${esc(agentReportEnd)}"></label><button class="btn sm btn-outline">Apply range</button><button type="button" id="agent-report-reset" class="btn sm btn-outline">UTC week</button></form>
       <div class="scroll"><table><tr><th>Agent / code</th><th>Status</th><th>Users</th><th>New 24h / week</th><th>24h volume</th><th>Week volume</th><th>Selected range</th><th>Week profit</th><th>Commission owed / paid / outstanding</th><th>Fee owed / paid / outstanding</th><th>Action</th></tr>${(agentReport.agents||[]).map(a=>`<tr><td><b>${esc(a.name)}</b><div class="muted">${esc(a.phone)} · ${esc(a.promo_code)}</div></td><td>${statusTag(a.status)}</td><td>${a.users_total}</td><td>${a.users_24h} / ${a.users_week}</td><td>${fmt(a.tx_volume_24h)} ETB (${a.tx_count_24h})</td><td>${fmt(a.tx_volume_week)} ETB (${a.tx_count_week})</td><td>${fmt(a.tx_volume_range)} ETB (${a.tx_count_range})</td><td>${fmt(a.profit_week)} ETB</td><td>${fmt(a.commission_owed)} / ${fmt(a.commission_paid)} / ${fmt(a.commission_outstanding)} ETB</td><td>${fmt(a.fee_owed)} / ${fmt(a.fee_paid)} / ${fmt(a.fee_outstanding)} ETB</td><td><button class="btn sm btn-outline" data-agent-edit="${a.id}">Edit</button><button class="btn sm ${a.status==='active'?'bad':'alt'}" data-agent-status="${a.id}" data-status="${a.status==='active'?'suspended':'active'}">${a.status==='active'?'Suspend':'Reactivate'}</button><button class="btn sm btn-outline" data-agent-tx="${a.id}">Transactions</button></td></tr>`).join('')}</table></div>
       ${!(agentReport.agents||[]).length?emptyState('🔑','No agents found.'):''}
       <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;margin-top:16px">${(agentReport.agents||[]).map(a=>`<div class="stat"><b>${esc(a.name)}</b><div class="muted">Activity alerts (heuristic)</div>${Number(a.profit_week)<0?'<p class="tag rejected">Negative weekly user profit</p>':''}${Number(a.tx_volume_prev_week)>=10000&&Number(a.tx_volume_week)>Number(a.tx_volume_prev_week)*3?'<p class="tag pending">Weekly volume is over 3× prior week</p>':''}${Number(a.withdrawals_24h)>=5?'<p class="tag pending">5+ withdrawal holds in 24h</p>':''}${Number(a.withdrawal_ratio_week)>=0.8&&Number(a.deposit_volume_week)>=10000?'<p class="tag pending">Weekly withdrawal/deposit volume ratio ≥80%</p>':''}</div>`).join('')}</div><div id="agent-transaction-results"></div>
      </div>
    ` : ''}

    ${adminSection === 'settlements' && isSuperAdmin ? `
      <div class="card"><div class="section-head"><div><h3>Weekly settlements</h3><p class="muted">UTC Monday–Monday. Each week closes once; commission is configurable per agent, with negative weeks carried forward.</p></div><div><label>Week start (UTC Monday)<input id="settlement-week-start" type="date" value="${settlementDefaultDate}"></label><button id="close-week-settlement" class="btn btn-gold">Close completed week</button></div></div>
      <div class="notice">Payouts here are virtual wallet credits for this demo. There is no bank or mobile-money transfer integration.</div>
      ${(settlementsData.settlements||[]).length?`<div class="scroll"><table><tr><th>Agent</th><th>Week</th><th>Profit</th><th>Loss carried</th><th>Commission</th><th>Weekly fee</th><th>Status / payment history</th><th>Actions</th></tr>${settlementsData.settlements.map(s=>`<tr><td>${esc(s.agent_name)}</td><td>${esc(s.week_start)} – ${esc(s.week_end)}</td><td>${fmt(s.profit_santim)} ETB</td><td>${fmt(s.carried_loss_out_santim)} ETB</td><td>${fmt(s.commission_santim)} ETB</td><td>${fmt(s.weekly_fee_santim)} ETB</td><td>${s.status==='paid'?'<span class="tag approved">Paid</span>':'<span class="tag pending">Ready</span>'}<div class="muted">${s.paid_at?`${esc(s.paid_by_name||'Staff')} · ${esc(s.paid_at)}`:'Awaiting payment'}</div></td><td>${Number(s.commission_santim)>Number(s.commission_paid)?`<button class="btn sm btn-gold" data-settlement-pay="commission" data-id="${s.id}">Pay commission</button>`:''}${Number(s.weekly_fee_santim)>Number(s.fee_paid)?`<button class="btn sm btn-outline" data-settlement-pay="weekly_fee" data-id="${s.id}">Pay fee</button>`:''}</td></tr>`).join('')}</table></div>`:emptyState('🧮','No weekly settlements closed yet.')}</div>
      <div class="card"><h3>Agent payout requests</h3>${(payoutQueue.requests||[]).length?`<div class="scroll"><table><tr><th>Agent</th><th>Type</th><th>Period</th><th>Amount</th><th>Status</th><th>Decision / staff history</th></tr>${payoutQueue.requests.map(r=>`<tr><td>${esc(r.agent_name)}<div class="muted">${esc(r.agent_phone)}</div></td><td>${esc(r.payout_type)}</td><td>${esc(r.period_start)} – ${esc(r.period_end)}</td><td>${fmt(r.amount_santim)} ETB</td><td>${statusTag(r.status)}</td><td>${r.status==='pending'?`<button class="btn sm btn-gold" data-payout-decision="approve" data-id="${r.id}">Approve & credit</button><button class="btn sm bad" data-payout-decision="reject" data-id="${r.id}">Reject</button>`:`${esc(r.decided_by_name||'Staff')} · ${esc(r.decided_at||'—')}<div class="muted">${esc(r.decision_reason||'—')}</div>`}</td></tr>`).join('')}</table></div>`:emptyState('🧾','No payout requests.')}</div>
    ` : ''}

    <!-- SECTION 3: AGENT FUNDING REQUESTS -->
    ${adminSection === 'funding' ? `
      <div class="card">
        <h3>Legacy agent funding history</h3><p class="notice">Legacy float funding is disabled for referral agents. Existing records remain available for audit; use weekly settlements for approved compensation.</p>
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
              <span class="muted" style="font-size:11px">${r.status === 'pending' ? 'Legacy request · no longer actionable' : 'Historical record'}</span>
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
          <button id="download-csv-btn" class="btn sm btn-outline">📥 ${esc(t('export_csv'))}</button>
        </div>
        <form id="transaction-filters" class="admin-filters">
          <input name="search" value="${esc(adminTransactionFilters.search||'')}" placeholder="Customer, phone or reference">
          <select name="type"><option value="all">All types</option>${['deposit','withdraw_hold','withdraw_refund','bet','win','demo_bonus','agent_fee','agent_commission'].map(x=>`<option value="${x}" ${adminTransactionFilters.type===x?'selected':''}>${esc(x)}</option>`).join('')}</select>
          <select name="status"><option value="all">All statuses</option>${['pending','approved','rejected','paid'].map(x=>`<option value="${x}" ${adminTransactionFilters.status===x?'selected':''}>${esc(x)}</option>`).join('')}</select>
          <input name="payment_method" value="${esc(adminTransactionFilters.payment_method||'')}" placeholder="Payment method">
          <input name="agent_id" type="number" min="1" value="${esc(adminTransactionFilters.agent_id||'')}" placeholder="Agent ID">
          <input name="min_amount" type="number" min="0" step="0.01" value="${esc(adminTransactionFilters.min_amount||'')}" placeholder="Min ETB">
          <input name="max_amount" type="number" min="0" step="0.01" value="${esc(adminTransactionFilters.max_amount||'')}" placeholder="Max ETB">
          <input name="start" type="date" value="${esc(adminTransactionFilters.start||'')}" aria-label="Start date">
          <input name="end" type="date" value="${esc(adminTransactionFilters.end||'')}" aria-label="End date">
          <button class="btn sm btn-outline" type="submit">Apply filters</button>
        </form>
        ${!txs.transactions.length ? emptyState('📋', t('no_data')) : `
        <div class="scroll"><table>
          <tr><th>${esc(t('date'))}</th><th>${esc(t('name'))}</th><th>${esc(t('type'))}</th><th>Reference</th><th>Method</th><th>Status</th><th>${esc(t('amount'))}</th><th>${esc(t('balance'))}</th></tr>
          ${txs.transactions.map((x) => `<tr>
            <td class="muted" style="white-space:nowrap">${esc(x.created_at)}</td>
            <td><div style="font-weight:600">${esc(x.user_name)}</div><div class="muted">${esc(x.phone)}</div></td>
            <td><span style="font-weight:600">${esc(t('t_' + x.type) !== 't_' + x.type ? t('t_' + x.type) : x.type)}</span></td>
            <td>${esc(x.transaction_reference || '—')}</td><td>${esc(x.payment_method || '—')}</td><td>${x.request_status?statusTag(x.request_status):'—'}</td>
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
          <tr><th>Ticket ID</th><th>${esc(t('name'))}</th><th>Status</th><th>Escalated Reason</th><th>${esc(t('date'))}</th><th>Actions</th></tr>
          ${ticketsRes.tickets.map((x) => `<tr>
            <td>#${x.id}</td>
            <td><div style="font-weight:600">${esc(x.user_name || x.name)}</div><div class="muted">${esc(x.user_phone || x.phone)}</div></td>
            <td>${statusTag(x.status)}</td>
            <td><span style="font-size:12px;color:var(--gold-bright)">${esc(x.escalated_reason || 'Direct question')}</span></td>
            <td class="muted" style="white-space:nowrap">${esc(x.created_at)}</td>
            <td style="white-space:nowrap"><button class="btn sm btn-outline" data-admin-ticket-reply="${x.id}">View &amp; reply</button>${x.status !== 'resolved' ? ` <button class="btn sm alt" data-admin-ticket-resolve="${x.id}">Resolve</button>` : ''}</td>
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
            <td><span class="tag ${['admin','superadmin'].includes(x.role) ? 'rejected' : x.role === 'agent' ? 'pending' : 'approved'}">${esc(x.role)}</span>${x.referred_by_agent_id?`<div class="muted">Agent #${x.referred_by_agent_id}</div>`:''}</td>
            <td>${statusTag(x.status)}</td>
            <td style="font-weight:700">${fmt(x.balance)} ${esc(t('currency_etb'))}</td>
            <td style="white-space:nowrap">
              ${x.id === me.id ? '<span class="muted">(you)</span>' : `
                ${x.role === 'agent' ? '<span class="muted">Managed in agent operations</span>' : x.role==='user'&&isSuperAdmin ? '<button class="btn sm btn-outline" data-open-reassign="1" data-u="'+x.id+'" data-name="'+esc(x.name)+'" data-agent="'+(x.referred_by_agent_id||'')+'">Referral</button>' : ''}
                ${x.role === 'user' && x.status === 'active'
                  ? `<button class="btn sm bad" data-u="${x.id}" data-status="suspended">${esc(t('suspend'))}</button>`
                  : x.role === 'user' ? `<button class="btn sm alt" data-u="${x.id}" data-status="active">${esc(t('activate'))}</button>` : ''}
              `}
            </td>
          </tr>`).join('')}
        </table></div>
      </div>

      ${isSuperAdmin ? `<div class="card"><h3>Reassign referral attribution</h3><p class="muted">Only the Super Admin can change attribution. Existing history is preserved and this action is audit logged.</p><form id="reassign-agent-form" class="grid" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px"><label>Customer user ID<input name="user_id" type="number" min="1" required></label><label>New agent ID (blank removes attribution)<input name="agent_id" type="number" min="1"></label><label>Reason<input name="reason" minlength="3" maxlength="300" required></label><label>Super Admin password<input name="reauth_password" type="password" required autocomplete="current-password"></label><button class="btn btn-gold">Save reassignment</button></form></div>` : ''}

      <div class="card">
        <div class="section-head">
          <h3>${esc(t('audit'))}</h3>
          <input id="audit-search" placeholder="Search audit logs..." style="padding:6px 14px;font-size:12px;width:180px">
        </div>
        <div class="scroll"><table>
          <tr><th>${esc(t('date'))}</th><th>${esc(t('actor'))}</th><th>IP</th><th>${esc(t('action'))}</th><th>Before / after</th></tr>
          ${aud.logs.slice(0, 40).map((x) => `<tr>
            <td class="muted" style="white-space:nowrap">${esc(x.created_at)}</td>
            <td>${esc(x.actor || 'System')}</td>
            <td class="muted">${esc(x.actor_ip || '—')}</td>
            <td><span style="font-family:monospace;font-size:12px">${esc(x.action)}</span></td>
            <td><details><summary>Details</summary><pre class="muted" style="white-space:pre-wrap">${esc(JSON.stringify({before:x.before_value,after:x.after_value,detail:x.detail},null,2))}</pre></details></td>
          </tr>`).join('')}
        </table></div>
      </div>
    ` : ''}
    </div>
  `;

  // Subtab switching
  $('adm-tab-analytics').onclick = () => { adminSection = 'analytics'; render(); };
  $('adm-tab-dep').onclick = () => { adminSection = 'deposits'; render(); };
  $('adm-tab-with').onclick = () => { adminSection = 'withdrawals'; render(); };
  $('adm-tab-fund').onclick = () => { adminSection = 'funding'; render(); };
  $('adm-tab-tx').onclick = () => { adminSection = 'transactions'; render(); };
  $('adm-tab-supp').onclick = () => { adminSection = 'support'; render(); };
  $('adm-tab-users').onclick = () => { adminSection = 'users'; render(); };
  $('adm-tab-agents')?.addEventListener('click', () => { adminSection = 'agents'; render(); });
  $('adm-tab-settlements')?.addEventListener('click', () => { adminSection = 'settlements'; render(); });

  app.querySelectorAll('[data-open-admin-deposit-review]').forEach((button) => {
    const deposit = depPending.deposits.find((item) => String(item.id) === button.dataset.openAdminDepositReview);
    if (deposit) button.onclick = () => openDepositReview(deposit, render, isSuperAdmin);
  });

  app.querySelectorAll('[data-admin-ticket-reply]').forEach((button) => button.onclick = async () => {
    try {
      const ticketId = button.dataset.adminTicketReply;
      const detail = await api(`/support/ticket/${ticketId}`);
      const transcript = detail.messages.map((m) => `${m.sender_name}: ${m.message}`).join('\n');
      const message = prompt(`Ticket #${ticketId}\n\n${transcript}\n\nReply to customer:`);
      if (message === null || !message.trim()) return;
      await api(`/support/ticket/${ticketId}/reply`, { message: message.trim() });
      success('Support reply sent.');
      render();
    } catch (e) { fail(e); }
  });
  app.querySelectorAll('[data-admin-ticket-resolve]').forEach((button) => button.onclick = async () => {
    try {
      await api(`/support/ticket/${button.dataset.adminTicketResolve}/status`, { status: 'resolved' });
      success('Support ticket marked resolved.');
      render();
    } catch (e) { fail(e); }
  });

  app.querySelector('#superadmin-agent-create')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.currentTarget));
    const feeEtb = Number(f.weekly_fee_etb), commissionPercent = Number(f.commission_percent);
    if (!Number.isFinite(feeEtb) || feeEtb < 0 || !Number.isFinite(commissionPercent) || commissionPercent < 0 || commissionPercent > 100) return fail({message:'INVALID'});
    const submit = ev.currentTarget.querySelector('[type="submit"]'); submit.disabled = true;
    try {
      const result = await api('/superadmin/agents', {name:f.name,phone:f.phone,password:f.password,promo_code:f.promo_code,contact_info:f.contact_info,weekly_fee_santim:Math.round(feeEtb*100),commission_bps:Math.round(commissionPercent*100),reauth_password:f.reauth_password});
      success(`Agent created. Promo code: ${result.promo_code}`); render();
    } catch(e) { fail(e); submit.disabled=false; }
  });
  app.querySelectorAll('[data-agent-status]').forEach((button) => button.onclick = async () => {
    const reauth_password = prompt('Confirm your current Super Admin password:'); if (!reauth_password) return;
    try { await api(`/superadmin/agents/${button.dataset.agentStatus}`,{status:button.dataset.status,reauth_password}); success(`Agent ${button.dataset.status}.`); render(); } catch(e){fail(e);}
  });
  app.querySelectorAll('[data-agent-edit]').forEach((button) => button.onclick = async () => {
    const agent=(agentReport.agents||[]).find(a=>String(a.id)===button.dataset.agentEdit); if(!agent)return;
    const name=prompt('Agent name:',agent.name); if(name===null)return;
    const phone=prompt('Agent phone:',agent.phone); if(phone===null)return;
    const promo_code=prompt('Promo code (unique, case-insensitive):',agent.promo_code); if(promo_code===null)return;
    const weeklyFeeEtb=prompt('Weekly fee in ETB:',String(Number(agent.weekly_fee_santim)/100)); if(weeklyFeeEtb===null)return;
    const commissionPercent=prompt('Commission percent:',String(Number(agent.commission_bps)/100)); if(commissionPercent===null)return;
    const contact_info=prompt('Agent contact information:',agent.phone); if(contact_info===null)return;
    const reauth_password=prompt('Confirm your current Super Admin password:'); if(!reauth_password)return;
    try { await api(`/superadmin/agents/${agent.id}`,{name,phone,promo_code,weekly_fee_santim:Math.round(Number(weeklyFeeEtb)*100),commission_bps:Math.round(Number(commissionPercent)*100),contact_info,reauth_password}); success('Agent profile updated.'); render(); } catch(e){fail(e);}
  });
  app.querySelector('#agents-csv')?.addEventListener('click',()=>{
    const rows=[['agent','phone','promo_code','status','users_total','users_24h','users_week','tx_volume_24h_santim','tx_volume_week_santim','profit_week_santim','commission_owed_santim','commission_paid_santim','fee_owed_santim','fee_paid_santim'],...(agentReport.agents||[]).map(a=>[a.name,a.phone,a.promo_code,a.status,a.users_total,a.users_24h,a.users_week,a.tx_volume_24h,a.tx_volume_week,a.profit_week,a.commission_owed,a.commission_paid,a.fee_owed,a.fee_paid])];
    downloadCsv('fetan-agent-report.csv', rows);
  });
  app.querySelector('#close-week-settlement')?.addEventListener('click',async()=>{const reauth_password=prompt('Confirm your current Super Admin password to close this completed UTC week:');if(!reauth_password)return;try{const r=await api('/superadmin/settlements/close-previous-week',{week_start:$('settlement-week-start').value,reauth_password});success(`Settlement week closed. ${r.created} new agent records.`);render();}catch(e){fail(e);}});
  app.querySelectorAll('[data-settlement-pay]').forEach(b=>b.onclick=async()=>{const reauth_password=prompt('Confirm your current Super Admin password:');if(!reauth_password)return;try{await api(`/superadmin/settlements/${b.dataset.id}/pay`,{payment_type:b.dataset.settlementPay,reauth_password});success('Virtual wallet credit recorded.');render();}catch(e){fail(e);}});
  app.querySelectorAll('[data-payout-decision]').forEach(b=>b.onclick=async()=>{const action=b.dataset.payoutDecision,reason=action==='reject'?prompt('Rejection reason (required):')||'':prompt('Optional decision note:')||'';if(action==='reject'&&!reason.trim())return;const reauth_password=prompt('Confirm your current Super Admin password:');if(!reauth_password)return;try{await api(`/superadmin/payout-requests/${b.dataset.id}/decide`,{action,reason,reauth_password});success(action==='approve'?'Request approved and virtual wallet credited.':'Request rejected.');render();}catch(e){fail(e);}});
  app.querySelectorAll('[data-withdraw-action]').forEach(b=>b.onclick=async()=>{const action=b.dataset.withdrawAction,reason=action==='reject'?prompt('Rejection reason (required):')||'':'';if(action==='reject'&&!reason.trim())return;const reauth_password=prompt('Confirm your current Super Admin password:');if(!reauth_password)return;try{await api(`/agent/withdrawals/${b.dataset.id}/decide`,{action,reason,reauth_password});success(action==='approve'?'Withdrawal approved for manual processing.':'Withdrawal rejected and hold released.');render();}catch(e){fail(e);}});
  app.querySelectorAll('[data-withdraw-complete]').forEach(b=>b.onclick=async()=>{const payment_reference=prompt('External payout reference (required):')||'';if(payment_reference.trim().length<4)return;const reauth_password=prompt('Confirm your current Super Admin password:');if(!reauth_password)return;try{await api(`/superadmin/withdrawals/${b.dataset.withdrawComplete}/complete`,{payment_reference,reauth_password});success('Payout completion recorded.');render();}catch(e){fail(e);}});
  app.querySelector('#agent-report-range')?.addEventListener('submit',async(ev)=>{ev.preventDefault();const f=Object.fromEntries(new FormData(ev.currentTarget));agentReportStart=f.start||'';agentReportEnd=f.end||'';await adminView(app);});
  app.querySelector('#agent-report-reset')?.addEventListener('click',()=>{agentReportStart='';agentReportEnd='';adminView(app);});
  app.querySelectorAll('[data-agent-tx]').forEach(b=>b.onclick=async()=>{try{const query=new URLSearchParams({limit:'50'});if(agentReportStart)query.set('start',agentReportStart);if(agentReportEnd)query.set('end',agentReportEnd);const result=await api(`/superadmin/agents/${b.dataset.agentTx}/transactions?${query}`);const box=$('agent-transaction-results');box.innerHTML=`<div class="card"><h3>Referred-user ledger entries · Agent #${esc(b.dataset.agentTx)}</h3>${result.transactions.length?`<div class="scroll"><table><tr><th>Date</th><th>User</th><th>Type</th><th>Amount</th><th>Reference</th></tr>${result.transactions.map(x=>`<tr><td>${esc(x.created_at)}</td><td>${esc(x.user_name)}</td><td>${esc(x.type)}</td><td>${rel(x.amount)} ETB</td><td>${esc(x.ref_type||'')} ${esc(x.ref_id||'')}</td></tr>`).join('')}</table></div>`:'<p class="muted">No ledger entries for this date range.</p>'}</div>`;box.scrollIntoView({behavior:'smooth'});}catch(e){fail(e);}});
  app.querySelectorAll('[data-open-reassign]').forEach(b=>b.onclick=()=>{const form=$('reassign-agent-form');form.elements.user_id.value=b.dataset.u;form.elements.agent_id.value=b.dataset.agent;form.scrollIntoView({behavior:'smooth'});form.elements.agent_id.focus();});
  app.querySelector('#reassign-agent-form')?.addEventListener('submit',async(ev)=>{ev.preventDefault();const f=Object.fromEntries(new FormData(ev.currentTarget));try{await api(`/superadmin/users/${f.user_id}/reassign-agent`,{agent_id:f.agent_id||null,reason:f.reason,reauth_password:f.reauth_password});success('Referral attribution updated and audited.');render();}catch(e){fail(e);}});

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
        const reauth_password = isSuperAdmin ? prompt('Confirm your current Super Admin password:') : undefined;
        if (isSuperAdmin && !reauth_password) { aiChk.checked = !aiChk.checked; return; }
        await api('/admin/ai-settings', { enabled: aiChk.checked, reauth_password });
        success('AI Support ' + (aiChk.checked ? 'enabled' : 'disabled'));
        adminView(app);
      } catch (e) { aiChk.checked = !aiChk.checked; fail(e); }
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

  // Transaction filters and CSV download.
  const txFilters = $('transaction-filters');
  if (txFilters) txFilters.onsubmit = async (ev) => {
    ev.preventDefault();
    adminTransactionFilters = Object.fromEntries([...new FormData(txFilters)].filter(([, value]) => value !== ''));
    try { await adminView(app); } catch (e) { fail(e); }
  };

  const csvBtn = $('download-csv-btn');
  if (csvBtn) {
    csvBtn.onclick = () => {
      const rows = [
        ['ID', 'Date', 'User', 'Phone', 'Type', 'Reference', 'Payment Method', 'Status', 'Amount (ETB)', 'Balance After (ETB)'],
        ...txs.transactions.map((t) => [t.id, t.created_at, t.user_name, t.phone, t.type, t.transaction_reference, t.payment_method, t.request_status, t.amount / 100, t.balance_after / 100])
      ];
      downloadCsv('fetan_bet_transactions.csv', rows);
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

  // User management listeners
  app.querySelectorAll('button[data-u]').forEach((b) => (b.onclick = async () => {
    const body = {};
    if (b.dataset.role) body.role = b.dataset.role;
    if (b.dataset.status) body.status = b.dataset.status;
    try { await api(`/admin/users/${b.dataset.u}`, body); render(); } catch (e) { fail(e); }
  }));
}

// A direct game link still gets an in-app lobby entry for Back navigation.
const initialGameRoute = /^#\/game\/(road|road-dash|chicken-road-2|penalty|mines|plinko|keno|bingo|roulette|star)$/.test(location.hash);
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
