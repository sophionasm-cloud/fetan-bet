// Animated game screens — results always come from the server.
// Visual and audio animations with Stake-inspired polish.
'use strict';
window.Games = (function () {
  let C; // context: { api, t, esc, fmt, setBalance, fail, limits, roadState, minesState, reload }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (id) => document.getElementById(id);
  const payoutPreview = (stakeCents, multiplier) => {
    const match = String(multiplier).match(/^(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);
    if (!match || !Number.isSafeInteger(stakeCents)) return 0;
    const fractional = match[2] || '', exponent = Number(match[3] || 0);
    let numerator = BigInt(match[1] + fractional), scale = fractional.length - exponent;
    if (scale < 0) { numerator *= 10n ** BigInt(-scale); scale = 0; }
    return Number((BigInt(stakeCents) * numerator) / (10n ** BigInt(scale)));
  };
  const grossNetText = (grossCents, stakeCents) =>
    `Gross payout ${C.fmt(grossCents)} · Net ${C.fmt(grossCents - stakeCents)}`;
  function combBigIntClient(n, r) {
    if (r < 0 || r > n) return 0n;
    const take = Math.min(r, n - r);
    let value = 1n;
    for (let i = 1; i <= take; i++) value = (value * BigInt(n - take + i)) / BigInt(i);
    return value;
  }
  const GAME_PAYOUT_RULE_VERSION = 3;
  const GAME_TARGET_RTP_CENTS = 30n;
  const GAME_POSTERS = {
    road: '/img/road-dash.webp.jpg',
    'chicken-road-2': '/img/chicken-road-2-card.jpg',
    penalty: '/img/penalty-unlimited-preview.jpg',
    mines: '/img/mines.webp.jpg',
    plinko: '/img/plinko.webp.jpg',
    keno: '/img/keno.webp.jpg',
    bingo: '/img/ethiopian-bingo.webp.jpg',
    roulette: '/img/roulette.webp.jpg',
    star: '/img/star-spin.webp.jpg',
  };
  const GAME_ART = {
    road: '<svg viewBox="0 0 64 64" fill="none"><path d="M18 42c0-11 7-19 18-19 7 0 13 4 16 10l-6 11H18Z" fill="#F2D98B"/><path d="m22 45-5 8m24-8 4 8" stroke="#F2D98B" stroke-width="4" stroke-linecap="round"/><path d="m26 22 4-7 5 6 5-5 2 8" fill="#E66A45"/><circle cx="44" cy="29" r="2" fill="#0B0E0D"/><path d="m51 34 9 3-9 4" fill="#E9A23B"/></svg>',
    'chicken-road-2': '<svg viewBox="0 0 64 64" fill="none"><path d="M18 42c0-11 7-19 18-19 7 0 13 4 16 10l-6 11H18Z" fill="#F2D98B"/><path d="m22 45-5 8m24-8 4 8" stroke="#F2D98B" stroke-width="4" stroke-linecap="round"/><path d="m26 22 4-7 5 6 5-5 2 8" fill="#E66A45"/><circle cx="44" cy="29" r="2" fill="#0B0E0D"/><path d="m51 34 9 3-9 4" fill="#E9A23B"/></svg>',
    penalty: '<svg viewBox="0 0 64 64" fill="none"><circle cx="32" cy="32" r="23" stroke="#D6BD72" stroke-width="3"/><path d="M32 14v8m17 10h-8M32 50v-8M15 32h8M20 20l6 6m18 18-6-6m6-18-6 6M20 44l6-6" stroke="#F2D98B" stroke-width="3" stroke-linecap="round"/><circle cx="32" cy="32" r="8" fill="#F2D98B"/></svg>',
    mines: '<svg viewBox="0 0 64 64" fill="none"><path d="m32 7 23 17-9 29H18L9 24 32 7Z" fill="#28C895"/><path d="m32 7-4 17h27L32 7Z" fill="#9BF0CA"/><path d="m28 24-10 29 14-14 13 14-8-29H28Z" fill="#087B60"/><path d="M9 24h46" stroke="#D6BD72" stroke-width="2"/></svg>',
    plinko: '<svg viewBox="0 0 64 64" fill="none"><path d="M13 12h38L45 52H19L13 12Z" stroke="#D6BD72" stroke-width="3"/><g fill="#F2D98B"><circle cx="25" cy="21" r="2.5"/><circle cx="38" cy="21" r="2.5"/><circle cx="19" cy="31" r="2.5"/><circle cx="32" cy="31" r="2.5"/><circle cx="45" cy="31" r="2.5"/><circle cx="25" cy="41" r="2.5"/><circle cx="38" cy="41" r="2.5"/></g><circle cx="32" cy="12" r="4" fill="#F27C3D"/></svg>',
    keno: '<svg viewBox="0 0 64 64" fill="none"><circle cx="32" cy="32" r="24" fill="#252135" stroke="#B893F2" stroke-width="4"/><circle cx="32" cy="32" r="17" fill="#33294B"/><text x="32" y="39" fill="#F5EFFF" font-family="Arial,sans-serif" font-size="22" font-weight="800" text-anchor="middle">8</text><circle cx="19" cy="18" r="3" fill="#F2D98B"/></svg>',
    bingo: '<svg viewBox="0 0 64 64" fill="none"><rect x="10" y="9" width="44" height="46" rx="6" fill="#241A36" stroke="#BB8CF0" stroke-width="3"/><path d="M10 23h44M10 34h44M10 45h44M24 23v32M39 23v32" stroke="#71558F" stroke-width="2"/><circle cx="32" cy="34" r="6" fill="#F2D98B"/><path d="M20 16h24" stroke="#F2D98B" stroke-width="3" stroke-linecap="round"/></svg>',
    roulette: '<svg viewBox="0 0 64 64" fill="none"><circle cx="32" cy="32" r="25" fill="#15251D" stroke="#D6BD72" stroke-width="3"/><circle cx="32" cy="32" r="19" stroke="#F2D98B" stroke-width="2"/><circle cx="32" cy="32" r="7" fill="#D6BD72"/><path d="M32 13v12m19 7H39m-7 19V39m-19-7h12M18.5 18.5l8.5 8.5m22.5-8.5L41 27m4.5 18.5L37 37m-19 8.5 8.5-8.5" stroke="#F2D98B" stroke-width="2"/><circle cx="32" cy="12" r="3" fill="#E65B53"/></svg>',
    star: '<svg viewBox="0 0 64 64" fill="none"><rect x="9" y="10" width="46" height="44" rx="8" fill="#27211A" stroke="#D6BD72" stroke-width="3"/><path d="M17 19h30v26H17z" fill="#101512"/><path d="m24 25 2.5 5.5 6 0.7-4.4 4.1 1.2 5.9-5.3-3-5.2 3 1-5.9-4.3-4.1 6-.7 2.5-5.5Z" fill="#F2D98B"/><text x="40" y="39" fill="#F2D98B" font-family="Arial,sans-serif" font-size="14" font-weight="800" text-anchor="middle">7</text></svg>'
  };
  const posterMarkup = (id, title, loading = 'lazy') => `
    <div class="gcard-icon-wrap">
      <img class="game-poster" src="${GAME_POSTERS[id]}" alt="${C.esc(title)} game poster" loading="${loading}" decoding="async"${loading === 'eager' ? ' fetchpriority="high"' : ''}>
      <span class="poster-fallback" aria-hidden="true">${GAME_ART[id]}</span>
    </div>`;

  // ---------- WebAudio SFX ----------
  let actx = null, muted = localStorage.getItem('mute') === '1';
  function beep(freq, dur, type = 'sine', vol = 0.06, delay = 0) {
    if (muted) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.value = freq; g.gain.value = vol;
      o.connect(g); g.connect(actx.destination);
      const t0 = actx.currentTime + delay; o.start(t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur); o.stop(t0 + dur);
    } catch (e) { /* sound optional */ }
  }
  const sfx = {
    tick:   () => beep(900, 0.04, 'square', 0.03),
    hop:    () => { beep(520, 0.07, 'triangle', 0.07); beep(780, 0.05, 'triangle', 0.04, 0.06); },
    win:    () => [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.18, 'sine', 0.07, i * 0.11)),
    lose:   () => { beep(220, 0.25, 'sawtooth', 0.05); beep(160, 0.35, 'sawtooth', 0.05, 0.2); },
    crash:  () => { beep(90, 0.4, 'sawtooth', 0.09); beep(60, 0.5, 'sawtooth', 0.06, 0.1); },
    click:  () => beep(1200, 0.03, 'square', 0.02),
    reveal: () => { beep(659, 0.08, 'triangle', 0.06); beep(987, 0.12, 'sine', 0.08, 0.06); },
    boom:   () => { beep(80, 0.4, 'sawtooth', 0.12); beep(45, 0.5, 'square', 0.1, 0.1); },
    plink:  () => beep(750 + Math.random() * 500, 0.06, 'triangle', 0.04),
    coin:   () => { beep(987, 0.08, 'sine', 0.08); beep(1318, 0.15, 'sine', 0.08, 0.07); },
    horn:   () => { beep(350, 0.18, 'sawtooth', 0.06); beep(350, 0.22, 'sawtooth', 0.06, 0.1); },
  };

  function soundBtn(host) {
    const b = document.createElement('button');
    b.className = 'chip';
    const paint = () => (b.textContent = (muted ? '🔇 ' : '🔊 ') + C.t('sound'));
    b.onclick = () => { setMuted(!muted); paint(); };
    paint(); host.appendChild(b);
  }

  function setMuted(value) {
    muted = Boolean(value);
    localStorage.setItem('mute', muted ? '1' : '0');
  }

  function isMuted() {
    return muted;
  }

  function coinRain(stage) {
    for (let i = 0; i < 28; i++) {
      const c = document.createElement('span');
      c.className = 'coin'; c.textContent = '🪙';
      c.style.left = Math.random() * 94 + '%';
      c.style.animationDelay = (Math.random() * 0.8) + 's';
      stage.appendChild(c);
      setTimeout(() => c.remove(), 2800);
    }
  }

  function say(el, html, cls) {
    if (!el) return;
    el.className = 'msg ' + (cls || '');
    el.innerHTML = html;
  }

  // ---------- Bet Bar with Stake-style quick half / double buttons ----------
  function betBar(host, start = 10, opts = {}) {
    const vals = [1, 5, 10, 50, 100];
    const halfLabel = opts.halfLabel || '½';
    const doubleLabel = opts.doubleLabel || '2×';
    const currencyLabel = opts.currencyLabel || C.t('credits');
    const quickStyle = opts.compactQuick ? '' : ' style="padding:4px 8px;font-size:12px;font-weight:700"';
    host.innerHTML = `
      <div class="betbar">
        <div class="chips">
          ${vals.map((v) => `<button type="button" class="chipb c${v}" data-v="${v}">${v}</button>`).join('')}
        </div>
        <div class="betrow">
          <button type="button" class="chip" id="b-half"${quickStyle}>${C.esc(halfLabel)}</button>
          <span class="muted">${C.esc(C.t('bet'))}</span>
          <input type="number" min="1" max="${C.limits.max / 100}" step="1" value="${start}">
          <span class="muted">${C.esc(currencyLabel)}</span>
          <button type="button" class="chip" id="b-double"${quickStyle}>${C.esc(doubleLabel)}</button>
        </div>
      </div>`;
    const input = host.querySelector('input');
    const mark = () => host.querySelectorAll('.chipb').forEach(
      (b) => b.classList.toggle('on', Number(b.dataset.v) === Number(input.value))
    );
    host.querySelectorAll('.chipb').forEach((b) => (b.onclick = () => {
      input.value = b.dataset.v; mark(); sfx.tick();
    }));
    host.querySelector('#b-half').onclick = () => {
      input.value = Math.max(1, Math.floor(Number(input.value) / 2));
      mark(); sfx.tick();
    };
    host.querySelector('#b-double').onclick = () => {
      input.value = Math.min(C.limits.max / 100, Math.floor(Number(input.value) * 2));
      mark(); sfx.tick();
    };
    input.oninput = mark; mark();
    return {
      get: () => Math.round(Number(input.value) * 100),
      lock: (x) => host.querySelectorAll('button,input').forEach((e) => (e.disabled = x)),
    };
  }

  // =========================================================
  // LOBBY
  // =========================================================
  function mount(app, ctx) {
    C = ctx;
    const { t, esc } = C;
    const games = [
      { id: 'chicken-road-2', title: 'Chicken Road Dash', cat: 'originals', badge: 'HOT', hot: true, eager: true },
      { id: 'mines', title: t('mines_title'), cat: 'originals', badge: 'ORIGINAL' },
      { id: 'plinko', title: t('plinko_title'), cat: 'originals', badge: 'ORIGINAL' },
      { id: 'penalty', title: 'Penalty Unlimited', cat: 'originals', badge: 'ORIGINAL' },
      { id: 'keno', title: t('keno_title'), cat: 'lottery', badge: 'POPULAR' },
      { id: 'roulette', title: t('roulette_title'), cat: 'table', badge: 'CLASSIC' },
      { id: 'star', title: t('star_title'), cat: 'table', badge: 'SLOT' }
    ];
    const classicsLabel = lang === 'am' ? t('cat_classic') : 'Classics';
    const rows = [
      { id: 'popular', title: lang === 'am' ? 'ተወዳጅ' : 'Popular', games },
      { id: 'originals', title: t('cat_originals'), games: games.filter((game) => game.cat === 'originals') },
      { id: 'classics', title: classicsLabel, games: games.filter((game) => game.cat === 'table') }
    ];
    const filters = [
      ['all', t('cat_all')],
      ['originals', t('cat_originals')],
      ['table', classicsLabel],
      ['lottery', lang === 'am' ? 'ኬኖ' : 'Keno']
    ];
    const arrow = (direction) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${direction === 'prev' ? 'm15 6-6 6 6 6' : 'm9 6 6 6-6 6'}"/></svg>`;
    const cardMarkup = (game) => `
      <a class="home-game-card" href="#/game/${game.id}" data-game="${game.id}" data-cat="${game.cat}" aria-label="${esc(game.title)}">
        <img src="${GAME_POSTERS[game.id]}" alt="" loading="${game.eager ? 'eager' : 'lazy'}" decoding="async"${game.eager ? ' fetchpriority="high"' : ''}>
        <span class="home-card-fallback" aria-hidden="true">${GAME_ART[game.id]}</span>
        <span class="home-card-shade" aria-hidden="true"></span>
        <span class="home-card-badge${game.hot ? ' is-hot' : ''}">${esc(game.badge)}</span>
        <span class="home-card-title">${esc(game.title)}</span>
      </a>`;
    const rowMarkup = (row) => `
      <section class="home-row" data-home-row="${row.id}" aria-labelledby="home-row-${row.id}">
        <div class="home-row-head">
          <h2 class="home-row-title" id="home-row-${row.id}">${esc(row.title)}</h2>
          <div class="home-row-arrows">
            <button type="button" class="home-row-arrow" data-scroll="prev" aria-label="Scroll ${esc(row.title)} left">${arrow('prev')}</button>
            <button type="button" class="home-row-arrow" data-scroll="next" aria-label="Scroll ${esc(row.title)} right">${arrow('next')}</button>
          </div>
        </div>
        <div class="home-row-scroller" data-row-scroller aria-label="${esc(row.title)} games">${row.games.map(cardMarkup).join('')}</div>
      </section>`;

    app.innerHTML = `
      <div class="home-ambient" aria-hidden="true">
        <span class="ambient-gold-a"></span>
        <span class="ambient-green"></span>
        <span class="ambient-gold-b"></span>
      </div>
      <div class="home-catalog" id="ggrid">
        <div class="home-filters" id="gfilters" role="group" aria-label="${lang === 'am' ? 'ጨዋታዎችን ያጣሩ' : 'Filter games'}">
          ${filters.map(([cat, label], index) => `<button type="button" class="home-filter${index === 0 ? ' is-active' : ''}" data-cat="${cat}" aria-pressed="${index === 0}">${esc(label)}</button>`).join('')}
        </div>
        <div class="home-rows">${rows.map(rowMarkup).join('')}</div>
      </div>`;

    const filterButtons = [...app.querySelectorAll('.home-filter')];
    const rowElements = [...app.querySelectorAll('.home-row')];
    const cards = [...app.querySelectorAll('.home-game-card')];
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const scrollerFor = (row) => row.querySelector('[data-row-scroller]');
    const updateArrows = (row) => {
      const scroller = scrollerFor(row);
      if (!scroller) return;
      const max = scroller.scrollWidth - scroller.clientWidth;
      const prev = row.querySelector('[data-scroll="prev"]');
      const next = row.querySelector('[data-scroll="next"]');
      row.classList.toggle('is-static', max <= 4);
      prev.disabled = max <= 4 || scroller.scrollLeft <= 2;
      next.disabled = max <= 4 || scroller.scrollLeft >= max - 2;
    };
    const applyFilter = (cat) => {
      filterButtons.forEach((button) => {
        const active = button.dataset.cat === cat;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      rowElements.forEach((row) => {
        let visible = 0;
        row.querySelectorAll('.home-game-card').forEach((card) => {
          const show = cat === 'all' || card.dataset.cat === cat;
          card.hidden = !show;
          if (show) visible += 1;
        });
        row.hidden = visible === 0;
        const scroller = scrollerFor(row);
        if (scroller) scroller.scrollLeft = 0;
        if (visible) requestAnimationFrame(() => updateArrows(row));
      });
    };

    filterButtons.forEach((button) => {
      button.addEventListener('click', () => applyFilter(button.dataset.cat));
    });

    rowElements.forEach((row) => {
      const scroller = scrollerFor(row);
      if (!scroller) return;
      row.querySelectorAll('.home-row-arrow').forEach((button) => {
        button.addEventListener('click', () => {
          const step = Math.max(scroller.clientWidth * 0.82, 148);
          scroller.scrollBy({
            left: button.dataset.scroll === 'next' ? step : -step,
            behavior: reduceMotion.matches ? 'auto' : 'smooth'
          });
        });
      });
      scroller.addEventListener('scroll', () => updateArrows(row), { passive: true });
    });

    cards.forEach((card) => {
      const poster = card.querySelector('img');
      poster?.addEventListener('error', () => {
        poster.remove();
        card.classList.add('poster-missing');
      }, { once: true });
      card.addEventListener('click', (event) => {
        event.preventDefault();
        if (C.guest) { C.onLogin?.(); return; }
        open(app, card.dataset.game, true);
      });
    });

    requestAnimationFrame(() => rowElements.forEach(updateArrows));
    app._homeRowObserver?.disconnect();
    if (window.ResizeObserver) {
      const observer = new ResizeObserver(() => rowElements.forEach(updateArrows));
      rowElements.forEach((row) => {
        const scroller = scrollerFor(row);
        if (scroller) observer.observe(scroller);
      });
      app._homeRowObserver = observer;
    }
  }

  let stopFns = [];
  let shell = null;
  function open(app, game, pushHistory = false) {
    app._homeRowObserver?.disconnect();
    if (shell) { shell.cleanup(); shell = null; }
    stopFns.forEach((stop) => stop());
    stopFns = [];
    let leaveStarted = false;
    const routeSlug = game === 'road' ? 'road-dash' : game;
    if (pushHistory && location.hash !== `#/game/${routeSlug}`) {
      history.pushState({ fetanPage: 'game', game }, '', `#/game/${routeSlug}`);
    } else if (!pushHistory && location.hash === `#/game/${routeSlug}` &&
        !(history.state?.fetanPage === 'game' &&
          (!history.state.game || history.state.game === game || history.state.game === routeSlug))) {
      // A direct game URL or a page reload has no in-app lobby entry behind
      // it. Add one so Back and the exit control return to the lobby instead
      // of leaving the site.
      const lobbyUrl = `${location.pathname}${location.search}#/lobby`;
      history.replaceState({ fetanPage: 'lobby', gameReturnEntry: true }, '', lobbyUrl);
      history.pushState({ fetanPage: 'game', game }, '', `#/game/${routeSlug}`);
    }
    window.setFetanGameImmersive?.(true);
    document.body.classList.add('game-open');
    const titles = {
      road: '🐔 ' + C.t('road_title'),
      'chicken-road-2': '🐔 Chicken Road Dash',
      penalty: '⚽ Penalty Unlimited',
      mines: '💎 ' + C.t('mines_title'),
      plinko: '⚡ ' + C.t('plinko_title'),
      roulette: C.t('roulette_title'),
      star: '🎰 ' + C.t('star_title'),
      keno: '🎱 ' + C.t('keno_title'),
      bingo: '🇪🇹 ' + C.t('bingo_title'),
    };
    const title = titles[game] || String(game);
    app.innerHTML = `
      <div class="mobile-game-shell" data-game="${C.esc(game)}">
        ${window.FetanGameShell.markup(title, C.t, C.esc, game)}
        <div class="stage">
          <div class="stage-head"><button class="chip" id="gback" type="button">← ${C.esc(C.t('back'))}</button><span id="sbtn"></span></div>
          <h2 class="legacy-game-title" style="text-align:center;margin:0 0 8px;color:var(--text)">${C.esc(title)}</h2>
          <div id="gbody"></div>
        </div>
      </div>`;
    const root = app.querySelector('.mobile-game-shell');
    soundBtn($('sbtn'));
    const gameView = {
      road, roulette, star, mines, plinko, keno, bingo,
      'chicken-road-2': (body) => integratedFrame(body, 'chicken-road-2', 'Chicken Road Dash'),
      penalty: (body) => integratedFrame(body, 'penalty', 'Penalty Unlimited')
    }[game];

    const readRoundState = () => {
      if (game === 'bingo') {
        const button = $('bcall');
        const active = Boolean(button && !button.disabled);
        return { active, canAct: active, actionLabel: 'Continue Bingo' };
      }
      if (game === 'road') {
        const button = $('rcashout-btn');
        const active = Boolean(button && button.style.display !== 'none' && !button.hidden);
        return { active, canAct: Boolean(active && !button.disabled), actionLabel: 'Cash out now' };
      }
      if (game === 'mines') {
        const button = $('mmob-cash') || $('mcash');
        const active = Boolean(button && button.style.display !== 'none' && !button.hidden);
        return { active, canAct: Boolean(active && !button.disabled), actionLabel: 'Cash out now' };
      }
      return { active: false, canAct: false, actionLabel: '' };
    };
    const initialRound = game === 'road' ? C.roadState : game === 'mines' ? C.minesState : game === 'bingo' ? C.bingoState : null;
    const initialRoundState = initialRound?.active
      ? { active: true, canAct: game !== 'road' || Number(initialRound.step) > 0, actionLabel: game === 'bingo' ? 'Continue Bingo' : 'Cash out now' }
      : readRoundState();
    let shellSoundOn = localStorage.getItem('mute') !== '1';

    const leaveGame = () => {
      if (leaveStarted) return;
      leaveStarted = true;
      stopFns.forEach((stop) => stop()); stopFns = [];
      shell?.cleanup(); shell = null;
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      if (location.hash === `#/game/${routeSlug}`) history.back();
      else {
        window.setFetanGameImmersive?.(false);
        document.body.classList.remove('game-open');
        C.reload();
      }
    };
    const action = (name) => {
      if (['chicken-road-2', 'penalty'].includes(game)) {
        shell?.postFrameAction(name);
        return;
      }
      if (name === 'sound') {
        const roadSound = $('road-sound-btn');
        if (roadSound) roadSound.click();
        else $('sbtn')?.querySelector('button')?.click();
      } else if (name === 'how') {
        if (game === 'mines') $('mbtn-rules')?.click();
        else $('road-how-btn')?.click();
      } else if (name === 'fair' && game === 'mines') $('mbtn-fair')?.click();
      else if (name === 'fair' && game === 'road') {
        $('tab-fair-btn')?.click();
        document.querySelector('.road-subtabs')?.classList.add('mobile-overlay');
      }
      else if (name === 'history' && game === 'roulette') document.querySelector('.roulette-recent-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else if (name === 'history') {
        $('tab-bets-btn')?.click();
        document.querySelector('.road-subtabs')?.classList.toggle('mobile-overlay');
      } else if (name === 'critical') {
        if (game === 'road') $('rcashout-btn')?.click();
        else if (game === 'mines') ($('mmob-cash') || $('mcash'))?.click();
        else if (game === 'bingo') $('bcall')?.click();
      }
    };
    $('gback').onclick = leaveGame;
    if (gameView) gameView($('gbody'), root.querySelector('.stage'));
    shell = window.FetanGameShell.mount(root, { game, ctx: C, onExit: leaveGame, onAction: action, roundState: initialRoundState });
    const shellSoundButton = root.querySelector('[data-game-sound]');
    if (shellSoundButton) {
      shellSoundButton.textContent = shellSoundOn ? '🔊' : '🔇';
      shellSoundButton.onclick = () => {
        action('sound');
        shellSoundOn = !shellSoundOn;
        shellSoundButton.textContent = shellSoundOn ? '🔊' : '🔇';
      };
    }

    const updateRound = () => shell?.setRoundActive(readRoundState());
    const bodyObserver = new MutationObserver(updateRound);
    bodyObserver.observe($('gbody'), { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'style', 'hidden'] });
    stopFns.push(() => bodyObserver.disconnect());
    if (initialRoundState.active) shell.setRoundActive(initialRoundState);
  }

  function integratedFrame(body, game, title) {
    const frame = document.createElement('iframe');
    frame.className = 'integrated-game-frame';
    frame.title = title;
    frame.loading = 'eager';
    frame.allow = 'fullscreen; autoplay';
    frame.referrerPolicy = 'same-origin';
    frame.setAttribute('allowfullscreen', '');
    const syncFrameTheme = () => {
      try {
        const frameRoot = frame.contentDocument?.documentElement;
        if (!frameRoot?.classList.contains('fetan-integrated')) return;
        frameRoot.dataset.customerTheme = 'dark';
      } catch (_) { /* The embedded game is optional to the customer shell. */ }
    };
    frame.addEventListener('load', syncFrameTheme);
    window.addEventListener('fetan-customer-theme-change', syncFrameTheme);
    body.replaceChildren(frame);
    frame.src = `/games/${game}/?fetan=1&fetan-shell=1`;
    const onMessage = (event) => {
      if (event.origin !== location.origin || event.source !== frame.contentWindow || typeof event.data?.type !== 'string') return;
      if (event.data.type === 'fetan-game-close') {
        document.querySelector('.mobile-game-shell [data-game-exit]')?.click();
        return;
      }
      if (event.data.type === 'fetan-round-state') {
        shell?.setRoundActive({ active: Boolean(event.data.active), canAct: Boolean(event.data.canAct), actionLabel: event.data.actionLabel });
        if (event.data.previousActive && !event.data.active) shell?.refreshBalance().catch(() => {});
        return;
      }
      if (event.data.type === 'fetan-wallet-refresh') { shell?.refreshBalance().catch(() => {}); return; }
      if (event.data.type === 'fetan-open-wallet') { shell?.openWallet(); return; }
      if (event.data.type === 'fetan-open-deposit') { shell?.openDeposit(); return; }
      if (event.data.type === 'fetan-game-navigate' &&
          ['wallet', 'deposit', 'withdraw', 'profile', 'support', 'history'].includes(event.data.route)) {
        shell?.cleanup();
        shell = null;
        stopFns.forEach((stop) => stop());
        stopFns = [];
        C.navigateCustomer?.(event.data.route);
      }
    };
    window.addEventListener('message', onMessage);
    stopFns.push(() => window.removeEventListener('message', onMessage));
    stopFns.push(() => window.removeEventListener('fetan-customer-theme-change', syncFrameTheme));
    stopFns.push(() => { frame.src = 'about:blank'; });
  }

  // =========================================================
  // MINES (Diamond Hunt — Original SVG Art, Multi-Grid, Stake Polish)
  // =========================================================
  function mines(body, stage) {
    const { t, esc } = C;
    let curGrid = 5;
    let totalCells = 25;
    let mineCount = 5;
    let isCustomMines = false;
    let gameActive = false, busy = false;
    let minesPayoutVersion = GAME_PAYOUT_RULE_VERSION;
    let minesActiveBetCents = 1000;
    let revealed = [];
    let currentMult = 1, currentPotential = 0;
    let nextMults = [];
    let lastWinAmount = 0;
    let activeServerSeed = null, activeClientSeed = '', activeNonce = 1, activeSeedHash = '';

    // Monochrome target artwork. The reveal animation is applied by the
    // existing .revealed-safe / .revealed-mine CSS classes.
    const GEM_SVG = `
      <svg class="tile-gem-svg" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M6.2 3.5h11.6L21 9l-9 11.5L3 9l3.2-5.5Z" fill="#5ee0f2" fill-opacity=".14" stroke="#5ee0f2" stroke-width="1.5" stroke-linejoin="round"/>
        <path d="M3.2 9h17.6M9 3.5 12 9l3-5.5M12 9v11.2" stroke="#5ee0f2" stroke-width="1.1" stroke-linejoin="round" opacity=".75"/>
      </svg>
    `;

    const BOMB_SVG = `
      <svg class="tile-bomb-svg" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="10.5" cy="13.5" r="6.3" fill="#ff5a6a" fill-opacity=".14" stroke="#ff5a6a" stroke-width="1.5"/>
        <path d="m15.2 8.8 2.2-2.2M17.4 6.6l2 2M19.4 8.6 21 7" stroke="#ff5a6a" stroke-width="1.5" stroke-linecap="round"/>
        <circle cx="18.8" cy="4.2" r="1.4" fill="#ff5a6a"/>
      </svg>
    `;

    // Render the target single-column layout. Every id, handler and game-state
    // hook is preserved; this is presentation markup only.
    body.innerHTML = `
      <div class="mines-arena">
        <div class="mines-main-area">
          <!-- 1. FOUR-COLUMN LIVE STATS -->
          <div class="mines-top-strip">
            <div class="mines-live-stats">
              <div class="stat-item">
                <span class="stat-title">SAFE LEFT</span>
                <span class="stat-val green" id="msafe">20</span>
              </div>
              <div class="stat-item">
                <span class="stat-title">CURRENT</span>
                <span class="stat-val" id="mmult">×1.00</span>
              </div>
              <div class="stat-item">
                <span class="stat-title">NEXT</span>
                <span class="stat-val green" id="mnext">—</span>
              </div>
              <div class="stat-item">
                <span class="stat-title">WIN</span>
                <span class="stat-val" id="mlastwin">0 ETB</span>
              </div>
            </div>

            <!-- Kept for the existing multiplier helper; hidden in the target layout. -->
            <div class="mines-mult-strip-wrap" id="mmult-strip"></div>
          </div>

          <!-- 2. BOARD CARD -->
          <div class="mines-board-container" id="mboard-wrap">
            <div class="mines-grid-view mines-grid-5" id="mgrid"></div>
            <div id="mmodal-slot"></div>
          </div>

          <!-- 3. QUICK ACTIONS -->
          <div class="mines-quick-actions">
            <button type="button" class="btn-random-pick" id="mbtn-random" disabled>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="4" y="4" width="16" height="16" rx="4"/>
                <circle cx="9" cy="9" r="1" fill="currentColor" stroke="none"/>
                <circle cx="15" cy="9" r="1" fill="currentColor" stroke="none"/>
                <circle cx="9" cy="15" r="1" fill="currentColor" stroke="none"/>
                <circle cx="15" cy="15" r="1" fill="currentColor" stroke="none"/>
              </svg>
              <span>${esc(t('random_pick'))}</span>
            </button>
            <!-- TODO: Auto game is not implemented by the current Mines logic; this switch is visual-only. -->
            <button type="button" class="mines-auto-toggle" id="mbtn-auto" aria-pressed="false" disabled>
              <span class="mines-auto-switch" aria-hidden="true"></span>
              <span>Auto game</span>
            </button>
          </div>
        </div>

        <!-- 4. SETTINGS, BET AND PRIMARY ACTION -->
        <div class="mines-sidebar">
          <div class="mines-settings" id="msettings">
            <div class="mines-sidebar-section">
              <div class="mines-sidebar-label">
                <span>${esc(t('grid_size'))}</span>
                <span class="mines-setting-value" id="mgrid-lbl">5×5</span>
              </div>
              <div class="mines-seg-control" id="mgrid-selector">
                <button type="button" class="mines-seg-btn" data-grid="3">3×3</button>
                <button type="button" class="mines-seg-btn active" data-grid="5">5×5</button>
                <button type="button" class="mines-seg-btn" data-grid="7">7×7</button>
                <button type="button" class="mines-seg-btn" data-grid="9">9×9</button>
              </div>
            </div>

            <div class="mines-sidebar-section">
              <div class="mines-sidebar-label">
                <span>${esc(t('mines_count'))}</span>
                <span class="mines-setting-value" id="mcount-lbl">5</span>
              </div>
              <div class="mines-seg-control" id="mmines-presets">
                <button type="button" class="mines-seg-btn" data-mines="1">1</button>
                <button type="button" class="mines-seg-btn" data-mines="3">3</button>
                <button type="button" class="mines-seg-btn active" data-mines="5">5</button>
                <button type="button" class="mines-seg-btn" data-mines="7">7</button>
                <button type="button" class="mines-seg-btn" data-mines="custom">${esc(t('custom_mines'))}</button>
              </div>
              <div class="mines-custom-box" id="mmines-custom-box" style="display:none">
                <span class="mines-custom-range">1–<span id="mmax-mines">24</span></span>
                <input type="number" id="mmines-custom-input" class="mines-custom-input" min="1" max="24" value="5" step="1">
              </div>
            </div>
          </div>

          <div class="mines-sidebar-section mines-bet-section">
            <div class="mines-sidebar-label mines-bet-label">
              <span>BET</span>
              <span class="mines-chip-caption">Chip <b id="mchip-lbl">10</b> ETB</span>
            </div>
            <div class="mines-bet-card">
              <span class="mines-chip-nav" aria-hidden="true">‹</span>
              <div id="mbet"></div>
              <span class="mines-chip-nav" aria-hidden="true">›</span>
            </div>
          </div>

          <div class="mines-actions-row">
            <button class="btn-mines-start" id="mstart">${esc(t('start'))}</button>
            <button class="btn-mines-cashout" id="mcash" disabled style="display:none">${esc(t('cashout'))}</button>
          </div>

          <!-- Existing rules / fairness triggers kept available on wide screens. -->
          <div class="mines-utility-links">
            <button type="button" class="chip" id="mbtn-rules">ℹ ${esc(t('how_to_play'))}</button>
            <button type="button" class="chip" id="mbtn-fair">🛡️ ${esc(t('provably_fair'))}</button>
          </div>
        </div>

        <div class="msg" id="mmsg"></div>

        <!-- PROVABLY FAIR VERIFIER CARD (Toggleable) -->
        <div class="mines-fair-card" id="mfair-card" style="display:none">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <h4 style="margin:0;color:var(--accent);font-size:14px">🛡️ ${esc(t('mines_verify_title'))}</h4>
            <button type="button" class="chip" id="mfair-close" style="font-size:11px">✕</button>
          </div>
          <p style="font-size:12px;color:var(--text-secondary);margin:0 0 10px">${esc(t('mines_verify_desc'))}</p>
          <div style="display:flex;flex-direction:column;gap:6px;font-size:12px">
            <div>
              <label style="color:var(--text-muted)">${esc(t('server_seed_hash'))}:</label>
              <input id="mfair-hash" type="text" readonly style="width:100%;background:var(--input-bg);border:1px solid var(--input-border);color:var(--text-muted);padding:4px 8px;border-radius:6px;font-family:monospace;font-size:11px" value="">
            </div>
            <div>
              <label style="color:var(--text-muted)">${esc(t('server_seed'))}:</label>
              <input id="mfair-server-seed" type="text" placeholder="Revealed after round" style="width:100%;background:var(--input-bg);border:1px solid var(--input-border);color:var(--text);padding:4px 8px;border-radius:6px;font-family:monospace;font-size:11px">
            </div>
            <div style="display:flex;gap:8px">
              <div style="flex:1">
                <label style="color:var(--text-muted)">${esc(t('client_seed'))}:</label>
                <input id="mfair-client-seed" type="text" style="width:100%;background:var(--input-bg);border:1px solid var(--input-border);color:var(--text);padding:4px 8px;border-radius:6px;font-family:monospace;font-size:11px">
              </div>
              <div style="width:70px">
                <label style="color:var(--text-muted)">Nonce:</label>
                <input id="mfair-nonce" type="number" value="1" style="width:100%;background:var(--input-bg);border:1px solid var(--input-border);color:var(--text);padding:4px 8px;border-radius:6px;font-size:11px">
              </div>
            </div>
            <button type="button" class="btn btn-gold" id="mfair-verify-btn" style="padding:6px;margin-top:4px;font-size:12px">${esc(t('verify_btn'))}</button>
            <div id="mfair-result" style="font-size:12px;margin-top:6px"></div>
          </div>
        </div>
      </div>

      <!-- Duplicate mobile action bar retained for existing handler wiring; hidden visually. -->
      <div class="mines-mobile-sticky-bar" id="mmobile-bar">
        <button class="btn-mines-start" id="mmob-start">${esc(t('start'))}</button>
        <button class="btn-mines-cashout" id="mmob-cash" disabled style="display:none">${esc(t('cashout'))}</button>
      </div>
    `;

    const bet = betBar($('mbet'), 10, {
      halfLabel: '1/2',
      doubleLabel: '2x',
      currencyLabel: 'ETB',
      compactQuick: true,
    });
    const betInput = $('mbet').querySelector('.betrow input');
    const updateChipCaption = () => { $('mchip-lbl').textContent = String(Number(betInput.value) || 0); };
    betInput.addEventListener('input', updateChipCaption);
    $('mbet').addEventListener('click', updateChipCaption);
    updateChipCaption();

    // Synchronize Desktop & Mobile Start/Cashout buttons
    function updateActionButtons(active, canCashout, payoutText) {
      const dStart = $('mstart'), dCash = $('mcash');
      const mStart = $('mmob-start'), mCash = $('mmob-cash');

      if (!active) {
        if (dStart) { dStart.style.display = 'block'; dStart.disabled = false; }
        if (dCash) { dCash.style.display = 'none'; dCash.disabled = true; }
        if (mStart) { mStart.style.display = 'block'; mStart.disabled = false; }
        if (mCash) { mCash.style.display = 'none'; mCash.disabled = true; }
      } else {
        if (dStart) { dStart.style.display = 'none'; }
        if (dCash) {
          dCash.style.display = 'block';
          dCash.disabled = !canCashout;
          dCash.textContent = canCashout ? `${esc(t('cashout'))} · Gross ${payoutText} ETB` : esc(t('cashout'));
        }
        if (mStart) { mStart.style.display = 'none'; }
        if (mCash) {
          mCash.style.display = 'block';
          mCash.disabled = !canCashout;
          mCash.textContent = canCashout ? `${esc(t('cashout'))} · Gross ${payoutText} ETB` : esc(t('cashout'));
        }
      }
    }

    // Modal Payout Pop
    function showCashoutModal(mult, payout, stake) {
      const slot = $('mmodal-slot');
      if (!slot) return;
      slot.innerHTML = `
        <div class="mines-modal">
          <h1 class="mines-modal-mult">×${Number(mult).toFixed(2)}</h1>
          <div class="mines-modal-divider"></div>
          <p class="mines-modal-win">Gross ${C.fmt(payout)}</p>
          <p class="mines-modal-win">Net ${C.fmt(payout - stake)}</p>
        </div>`;
      setTimeout(() => { if (slot) slot.innerHTML = ''; }, 3200);
    }

    // Update Top Multiplier Progression Strip
    function updateMultiplierStrip(currMult, nextList) {
      const strip = $('mmult-strip');
      if (!strip) return;
      let html = '';
      if (currMult > 1) {
        html += `<span class="mult-pill current">×${Number(currMult).toFixed(2)}</span>`;
      }
      if (Array.isArray(nextList)) {
        nextList.forEach((m, idx) => {
          const isNext = idx === 0;
          html += `<span class="mult-pill ${isNext ? 'next-highlight' : ''}">×${Number(m).toFixed(2)}</span>`;
        });
      }
      strip.innerHTML = html;
    }

    // Build Board Grid DOM
    function buildGrid(locked = false) {
      const grid = $('mgrid');
      if (!grid) return;
      grid.className = `mines-grid-view mines-grid-${curGrid}`;
      grid.innerHTML = '';
      for (let i = 0; i < totalCells; i++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mine-tile' + (revealed[i] ? ' revealed-safe' : '');
        if (revealed[i]) {
          btn.innerHTML = GEM_SVG;
        }
        btn.disabled = locked || !gameActive || revealed[i];
        btn.onclick = () => clickCell(i);
        grid.appendChild(btn);
      }
    }

    // Update Live Stats
    function updateStats(safeLeft, mult, potential) {
      const s = $('msafe'), m = $('mmult'), p = $('mpotential');
      const next = $('mnext');
      if (s) s.textContent = (safeLeft !== null && safeLeft !== undefined) ? safeLeft : '—';
      if (m) m.textContent = (mult !== null && mult !== undefined) ? '×' + Number(mult).toFixed(2) : '—';
      if (p) p.textContent = (potential !== null && potential !== undefined && potential > 0) ? `+${C.fmt(potential)}` : '—';
      if (next) next.textContent = nextMults.length ? `×${Number(nextMults[0]).toFixed(2)}` : '—';
    }

    function lockSettings(locked) {
      $('msettings')?.classList.toggle('is-locked', locked);
      bet.lock(locked);
      $('mgrid-selector').querySelectorAll('button').forEach((b) => (b.disabled = locked));
      $('mmines-presets').querySelectorAll('button').forEach((b) => (b.disabled = locked));
      const customInput = $('mmines-custom-input');
      if (customInput) customInput.disabled = locked;
      const rndBtn = $('mbtn-random');
      if (rndBtn) rndBtn.disabled = !locked || !gameActive;
    }

    // Grid Size Switching Handler
    function setGrid(g) {
      if (gameActive || busy) return;
      curGrid = Number(g);
      totalCells = curGrid * curGrid;
      revealed = new Array(totalCells).fill(false);
      $('mgrid-lbl').textContent = `${curGrid}×${curGrid}`;
      $('mmax-mines').textContent = String(totalCells - 1);
      const customInput = $('mmines-custom-input');
      if (customInput) customInput.max = totalCells - 1;

      // Adjust mine count if current exceeds N - 1
      if (mineCount >= totalCells) {
        mineCount = Math.min(5, totalCells - 1);
        $('mcount-lbl').textContent = String(mineCount);
        if (customInput) customInput.value = String(mineCount);
      }

      $('mgrid-selector').querySelectorAll('.mines-seg-btn').forEach((b) => {
        b.classList.toggle('active', Number(b.dataset.grid) === curGrid);
      });

      updateStats(totalCells - mineCount, 1, 0);
      buildGrid(true);
      calculateUpcomingMultipliers();
    }

    // Mine Count Presets Handler
    function setMineCount(m, isCustom = false) {
      if (gameActive || busy) return;
      isCustomMines = isCustom;
      mineCount = Math.max(1, Math.min(totalCells - 1, Number(m)));
      $('mcount-lbl').textContent = String(mineCount);
      const customBox = $('mmines-custom-box');
      if (customBox) customBox.style.display = isCustom ? 'flex' : 'none';

      $('mmines-presets').querySelectorAll('.mines-seg-btn').forEach((b) => {
        if (isCustom) {
          b.classList.toggle('active', b.dataset.mines === 'custom');
        } else {
          b.classList.toggle('active', Number(b.dataset.mines) === mineCount);
        }
      });

      updateStats(totalCells - mineCount, 1, 0);
      calculateUpcomingMultipliers();
    }

    // Preview Multipliers on Setting Changes
    function calculateUpcomingMultipliers() {
      const list = [];
      const N = totalCells, M = mineCount;
      for (let k = 1; k <= Math.min(4, N - M); k++) {
        let multCents;
        const denominator = combBigIntClient(N - M, k);
        if (minesPayoutVersion >= GAME_PAYOUT_RULE_VERSION) {
          multCents = (GAME_TARGET_RTP_CENTS * combBigIntClient(N, k) + denominator / 2n) / denominator;
        } else if (minesPayoutVersion === 2) {
          multCents = (92n * combBigIntClient(N, k)) / denominator;
        } else {
          let product = 1;
          for (let i = 0; i < k; i++) product *= (N - i) / (N - M - i);
          multCents = BigInt(Math.round(Math.max(1.01, Math.floor(0.99 * product * 100) / 100) * 100));
        }
        const mult = Number(multCents) / 100;
        list.push(mult);
      }
      nextMults = list;
      const next = $('mnext');
      if (next) next.textContent = list.length ? `×${Number(list[0]).toFixed(2)}` : '—';
      updateMultiplierStrip(1, list);
    }

    // Wire Grid & Mine selector buttons
    $('mgrid-selector').querySelectorAll('.mines-seg-btn').forEach((b) => {
      b.onclick = () => { setGrid(b.dataset.grid); sfx.tick(); };
    });

    $('mmines-presets').querySelectorAll('.mines-seg-btn').forEach((b) => {
      b.onclick = () => {
        if (b.dataset.mines === 'custom') {
          setMineCount($('mmines-custom-input').value || 5, true);
        } else {
          setMineCount(b.dataset.mines, false);
        }
        sfx.tick();
      };
    });

    $('mmines-custom-input').oninput = (e) => {
      let val = parseInt(e.target.value, 10);
      if (isNaN(val) || val < 1) val = 1;
      if (val > totalCells - 1) val = totalCells - 1;
      setMineCount(val, true);
    };

    // Random Pick action
    $('mbtn-random').onclick = () => {
      if (!gameActive || busy) return;
      const unrevealed = [];
      for (let i = 0; i < totalCells; i++) {
        if (!revealed[i]) unrevealed.push(i);
      }
      if (unrevealed.length === 0) return;
      const pick = unrevealed[Math.floor(Math.random() * unrevealed.length)];
      clickCell(pick);
    };

    // Info / Rules Modal
    $('mbtn-rules').onclick = () => {
      alert(`${t('mines_rules_title')}\n\n${t('mines_rules_content')}`);
    };

    // Provably Fair Verifier Open/Close
    $('mbtn-fair').onclick = () => {
      const card = $('mfair-card');
      card.style.display = card.style.display === 'none' ? 'block' : 'none';
      if (card.style.display === 'block') {
        $('mfair-hash').value = activeSeedHash || '';
        $('mfair-client-seed').value = activeClientSeed || '';
        if (activeServerSeed) $('mfair-server-seed').value = activeServerSeed;
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    };
    $('mfair-close').onclick = () => { $('mfair-card').style.display = 'none'; };

    // Provably Fair Verification Trigger
    $('mfair-verify-btn').onclick = async () => {
      const sSeed = $('mfair-server-seed').value.trim();
      const cSeed = $('mfair-client-seed').value.trim();
      const nonce = Number($('mfair-nonce').value) || 1;
      if (!sSeed || !cSeed) {
        $('mfair-result').innerHTML = `<span style="color:var(--danger)">Enter Server Seed and Client Seed</span>`;
        return;
      }
      try {
        const res = await C.api('/games/mines/verify', {
          server_seed: sSeed,
          client_seed: cSeed,
          nonce,
          grid: curGrid,
          mines: mineCount
        });
        const matchHash = res.server_seed_hash === activeSeedHash;
        $('mfair-result').innerHTML = `
          <div style="background:var(--success-bg);padding:8px;border-radius:6px;border:1px solid var(--success-border);color:var(--success)">
            <b>✓ Verification Reproducible!</b><br>
            <span style="color:var(--text-secondary);font-size:11px">Mine Positions (${res.mines.length}): [${res.mines.join(', ')}]</span><br>
            <span style="font-size:10px;color:var(--text-secondary)">SHA-256: ${res.server_seed_hash.slice(0, 24)}... ${matchHash ? '✓ Matches Round Hash' : ''}</span>
          </div>`;
      } catch (e) {
        $('mfair-result').innerHTML = `<span style="color:var(--danger)">${esc(e.message || 'Verification failed')}</span>`;
      }
    };

    // Tile Click Handler
    async function clickCell(idx) {
      if (!gameActive || revealed[idx] || busy) return;
      busy = true;
      const tiles = $('mgrid').querySelectorAll('.mine-tile');
      tiles[idx].textContent = '⌛';
      tiles[idx].disabled = true;
      sfx.click();

      try {
        const r = await C.api('/games/mines/step', { cell: idx });
        C.setBalance(r.balance);

        if (r.mine || r.result === 'mine') {
          // BOMB HIT!
          tiles[idx].textContent = '';
          tiles[idx].innerHTML = BOMB_SVG;
          tiles[idx].className = 'mine-tile revealed-mine revealed-hit';

          // Shake Board
          const board = $('mboard-wrap');
          if (board) {
            board.classList.add('mines-board-shake');
            setTimeout(() => board.classList.remove('mines-board-shake'), 400);
          }
          sfx.boom();
          sfx.lose();
          say($('mmsg'), `💥 ${esc(t('crashed'))}: ${grossNetText(r.payout, bet.get())}`, 'lose');

          // Reveal all other mines and unpicked gems dimmed
          if (r.mines) {
            r.mines.forEach((mi) => {
              if (mi !== idx && tiles[mi]) {
                tiles[mi].innerHTML = BOMB_SVG;
                tiles[mi].className = 'mine-tile revealed-mine revealed-dim';
              }
            });
          }
          for (let i = 0; i < totalCells; i++) {
            if (!revealed[i] && !(r.mines || []).includes(i) && tiles[i]) {
              tiles[i].innerHTML = GEM_SVG;
              tiles[i].className = 'mine-tile revealed-safe revealed-dim';
            }
          }

          // Save seeds for fairness
          if (r.server_seed) {
            activeServerSeed = r.server_seed;
            $('mfair-server-seed').value = r.server_seed;
          }

          gameActive = false;
          minesPayoutVersion = GAME_PAYOUT_RULE_VERSION;
          lockSettings(false);
          updateActionButtons(false, false, '0');
          updateStats(0, 0, 0);
          updateMultiplierStrip(0, []);
        } else {
          // SAFE GEM UNCOVERED!
          tiles[idx].textContent = '';
          tiles[idx].innerHTML = GEM_SVG;
          tiles[idx].className = 'mine-tile revealed-safe';
          revealed[idx] = true;
          sfx.reveal();

          currentMult = r.multiplier || r.mult;
          currentPotential = r.potential;
          nextMults = r.next_multipliers || [];
          updateStats(r.safe_left, currentMult, currentPotential);
          updateMultiplierStrip(currentMult, nextMults);
          updateActionButtons(true, true, C.fmt(currentPotential));

          if (r.safe_left === 0 || r.finished) {
            // JACKPOT: All safe tiles revealed! Auto Cashout
            say($('mmsg'), `Round complete · ${grossNetText(r.payout ?? currentPotential, minesActiveBetCents)}`, 'win');
            sfx.win();
            coinRain(stage);
            showCashoutModal(currentMult, r.payout ?? currentPotential, minesActiveBetCents);
            lastWinAmount = r.payout || currentPotential;
            $('mlastwin').textContent = `${C.fmt(lastWinAmount)} ETB`;

            // Reveal mine positions dimmed
            if (r.mines) {
              r.mines.forEach((mi) => {
                if (tiles[mi]) {
                  tiles[mi].innerHTML = BOMB_SVG;
                  tiles[mi].className = 'mine-tile revealed-mine revealed-dim';
                }
              });
            }

            if (r.server_seed) {
              activeServerSeed = r.server_seed;
              $('mfair-server-seed').value = r.server_seed;
            }

            gameActive = false;
            minesPayoutVersion = GAME_PAYOUT_RULE_VERSION;
            lockSettings(false);
            updateActionButtons(false, false, '0');
          } else {
            say($('mmsg'), `💎 ×${Number(currentMult).toFixed(2)}`, 'win');
          }
        }
      } catch (e) {
        C.fail(e);
        tiles[idx].disabled = false;
        tiles[idx].textContent = '';
      }
      busy = false;
    }

    // Start Game Function (invoked by Desktop or Mobile button)
    async function doStart() {
      if (busy) return;
      busy = true;
      const modalSlot = $('mmodal-slot');
      if (modalSlot) modalSlot.innerHTML = '';
      say($('mmsg'), '');

      const customSeed = 'c_' + Math.random().toString(36).slice(2, 10);
      try {
        const r = await C.api('/games/mines/start', {
          bet: bet.get(),
          mines: mineCount,
          grid: curGrid,
          client_seed: customSeed
        });

        C.setBalance(r.balance);
        gameActive = true;
        minesPayoutVersion = r.payout_version || GAME_PAYOUT_RULE_VERSION;
        minesActiveBetCents = r.bet;
        revealed = new Array(totalCells).fill(false);
        activeSeedHash = r.server_seed_hash || '';
        activeClientSeed = r.client_seed || customSeed;
        activeServerSeed = null;

        $('mfair-hash').value = activeSeedHash;
        $('mfair-client-seed').value = activeClientSeed;
        $('mfair-server-seed').value = '';

        currentMult = 1;
        currentPotential = bet.get();
        nextMults = r.next_multipliers || [];

        updateStats(r.safe_left, 1, currentPotential);
        updateMultiplierStrip(1, nextMults);
        updateActionButtons(true, false, '0');
        lockSettings(true);
        say($('mmsg'), `💎 ${esc(t('mines_hint'))}`, '');
        buildGrid(false);
      } catch (e) {
        C.fail(e);
        updateActionButtons(false, false, '0');
      }
      busy = false;
    }

    // Cashout Function (invoked by Desktop or Mobile button)
    async function doCashout() {
      if (!gameActive || busy) return;
      busy = true;
      try {
        const r = await C.api('/games/mines/cashout', {});
        C.setBalance(r.balance);
        lastWinAmount = r.payout;
        $('mlastwin').textContent = `${C.fmt(lastWinAmount)} ETB`;
        say($('mmsg'), `Cashout · ${grossNetText(r.payout, minesActiveBetCents)} 🎉`, 'win');
        sfx.win();
        showCashoutModal(r.multiplier || r.mult, r.payout, minesActiveBetCents);
        if (r.multiplier >= 2 || r.mult >= 2) coinRain(stage);

        // Reveal mines dimmed
        const tiles = $('mgrid').querySelectorAll('.mine-tile');
        if (r.mines) {
          r.mines.forEach((mi) => {
            if (tiles[mi] && !tiles[mi].classList.contains('revealed-safe')) {
              tiles[mi].innerHTML = BOMB_SVG;
              tiles[mi].className = 'mine-tile revealed-mine revealed-dim';
            }
          });
        }
        for (let i = 0; i < totalCells; i++) {
          if (!revealed[i] && !(r.mines || []).includes(i) && tiles[i]) {
            tiles[i].innerHTML = GEM_SVG;
            tiles[i].className = 'mine-tile revealed-safe revealed-dim';
          }
        }

        if (r.server_seed) {
          activeServerSeed = r.server_seed;
          $('mfair-server-seed').value = r.server_seed;
        }

        gameActive = false;
        minesPayoutVersion = GAME_PAYOUT_RULE_VERSION;
        lockSettings(false);
        updateActionButtons(false, false, '0');
        updateStats(null, null, null);
        updateMultiplierStrip(0, []);
      } catch (e) {
        C.fail(e);
      }
      busy = false;
    }

    // Connect button click triggers
    $('mstart').onclick = doStart;
    $('mmob-start').onclick = doStart;
    $('mcash').onclick = doCashout;
    $('mmob-cash').onclick = doCashout;

    // Restore state if active round exists
    async function initMinesState() {
      try {
        const st = C.minesState && C.minesState.active !== undefined
          ? C.minesState
          : await C.api('/games/mines');

        if (st && st.active) {
          gameActive = true;
          minesPayoutVersion = st.payout_version || 1;
          minesActiveBetCents = st.bet;
          curGrid = st.grid || 5;
          totalCells = curGrid * curGrid;
          mineCount = st.mines || 5;
          currentMult = st.mult || 1;
          currentPotential = st.potential || st.bet;
          nextMults = st.next_multipliers || [];
          revealed = new Array(totalCells).fill(false);
          (st.revealed || []).forEach((idx) => { revealed[idx] = true; });

          activeSeedHash = st.server_seed_hash || '';
          activeClientSeed = st.client_seed || '';
          $('mfair-hash').value = activeSeedHash;
          $('mfair-client-seed').value = activeClientSeed;

          $('mgrid-lbl').textContent = `${curGrid}×${curGrid}`;
          $('mgrid-selector').querySelectorAll('.mines-seg-btn').forEach((b) => {
            b.classList.toggle('active', Number(b.dataset.grid) === curGrid);
          });
          $('mcount-lbl').textContent = String(mineCount);

          updateStats(st.safe_left, st.mult, currentPotential);
          updateMultiplierStrip(currentMult, nextMults);
          buildGrid(false);
          lockSettings(true);
          const canCash = (st.revealed || []).length > 0;
          updateActionButtons(true, canCash, C.fmt(currentPotential));
          say($('mmsg'), `💎 ×${Number(st.mult).toFixed(2)}`, 'win');
        } else {
          setGrid(5);
          setMineCount(5);
          buildGrid(true);
        }
      } catch (e) {
        setGrid(5);
        setMineCount(5);
        buildGrid(true);
      }
    }

    initMinesState();
  }

  // =========================================================
  // PLINKO (Stake Reference / AnsonH)
  // =========================================================
  // =========================================================
  // PLINKO (Stake Reference / Multi-Ball / Auto Mode / Provably Fair)
  // =========================================================
  const PLINKO_BASE_TABLES = {
    8: {
      low: [5.6, 2.1, 1.1, 1.0, 0.5, 1.0, 1.1, 2.1, 5.6],
      medium: [13, 3.0, 1.3, 0.7, 0.4, 0.7, 1.3, 3.0, 13],
      high: [29, 4.0, 1.5, 0.3, 0.2, 0.3, 1.5, 4.0, 29]
    },
    9: {
      low: [5.6, 2.0, 1.6, 1.0, 0.7, 0.7, 1.0, 1.6, 2.0, 5.6],
      medium: [18, 4.0, 1.7, 0.9, 0.5, 0.5, 0.9, 1.7, 4.0, 18],
      high: [43, 7.0, 2.0, 0.6, 0.2, 0.2, 0.6, 2.0, 7.0, 43]
    },
    10: {
      low: [8.9, 3.0, 1.4, 1.1, 1.0, 0.5, 1.0, 1.1, 1.4, 3.0, 8.9],
      medium: [22, 5.0, 2.0, 1.4, 0.6, 0.4, 0.6, 1.4, 2.0, 5.0, 22],
      high: [76, 10, 3.0, 0.9, 0.3, 0.2, 0.3, 0.9, 3.0, 10, 76]
    },
    11: {
      low: [8.4, 3.0, 1.9, 1.3, 1.0, 0.7, 0.7, 1.0, 1.3, 1.9, 3.0, 8.4],
      medium: [24, 6.0, 3.0, 1.8, 0.7, 0.5, 0.5, 0.7, 1.8, 3.0, 6.0, 24],
      high: [120, 14, 5.2, 1.4, 0.4, 0.2, 0.2, 0.4, 1.4, 5.2, 14, 120]
    },
    12: {
      low: [10, 3.0, 1.6, 1.4, 1.1, 1.0, 0.5, 1.0, 1.1, 1.4, 1.6, 3.0, 10],
      medium: [33, 11, 4.0, 2.0, 1.1, 0.6, 0.3, 0.6, 1.1, 2.0, 4.0, 11, 33],
      high: [170, 24, 8.1, 2.0, 0.7, 0.2, 0.2, 0.2, 0.7, 2.0, 8.1, 24, 170]
    },
    13: {
      low: [8.1, 4.0, 3.0, 1.9, 1.2, 0.9, 0.7, 0.7, 0.9, 1.2, 1.9, 3.0, 4.0, 8.1],
      medium: [43, 13, 6.0, 3.0, 1.3, 0.7, 0.4, 0.4, 0.7, 1.3, 3.0, 6.0, 13, 43],
      high: [260, 37, 11, 4.0, 1.0, 0.2, 0.2, 0.2, 0.2, 1.0, 4.0, 11, 37, 260]
    },
    14: {
      low: [7.1, 4.0, 1.9, 1.4, 1.3, 1.1, 1.0, 0.5, 1.0, 1.1, 1.3, 1.4, 1.9, 4.0, 7.1],
      medium: [58, 15, 7.0, 4.0, 1.9, 1.0, 0.5, 0.2, 0.5, 1.0, 1.9, 4.0, 7.0, 15, 58],
      high: [420, 56, 18, 5.0, 1.9, 0.3, 0.2, 0.2, 0.2, 0.3, 1.9, 5.0, 18, 56, 420]
    },
    15: {
      low: [15, 8.0, 3.0, 2.0, 1.5, 1.1, 1.0, 0.7, 0.7, 1.0, 1.1, 1.5, 2.0, 3.0, 8.0, 15],
      medium: [88, 18, 11, 5.0, 3.0, 1.3, 0.5, 0.3, 0.3, 0.5, 1.3, 3.0, 5.0, 11, 18, 88],
      high: [620, 83, 27, 8.0, 3.0, 0.5, 0.2, 0.2, 0.2, 0.2, 0.5, 3.0, 8.0, 27, 83, 620]
    },
    16: {
      low: [16, 9.0, 2.0, 1.4, 1.4, 1.2, 1.1, 1.0, 0.5, 1.0, 1.1, 1.2, 1.4, 1.4, 2.0, 9.0, 16],
      medium: [110, 41, 10, 5.0, 3.0, 1.5, 1.0, 0.5, 0.3, 0.5, 1.0, 1.5, 3.0, 5.0, 10, 41, 110],
      high: [1000, 130, 26, 9.0, 4.0, 2.0, 0.2, 0.2, 0.2, 0.2, 0.2, 2.0, 4.0, 9.0, 26, 130, 1000]
    }
  };

  function plinkoTargetTables(baseTables) {
    const result = {};
    const asCents = (value) => BigInt(Math.round(Number(value) * 100));
    for (const [rowText, risks] of Object.entries(baseTables)) {
      const rows = Number(rowText), weights = [1n];
      for (let i = 0; i < rows; i++) {
        const next = Array(weights.length + 1).fill(0n);
        weights.forEach((weight, index) => { next[index] += weight; next[index + 1] += weight; });
        weights.splice(0, weights.length, ...next);
      }
      const targetWeighted = 30n * (1n << BigInt(rows));
      result[rows] = {};
      for (const [risk, multipliers] of Object.entries(risks)) {
        const cents = multipliers.map(asCents);
        const weightedTotal = cents.reduce((sum, value, index) => sum + value * weights[index], 0n);
        result[rows][risk] = cents.map((value) => {
          const scaled = (value * targetWeighted + weightedTotal / 2n) / weightedTotal;
          return Number(scaled < 1n ? 1n : scaled) / 100;
        });
      }
    }
    return result;
  }
  const PLINKO_TABLES = plinkoTargetTables(PLINKO_BASE_TABLES);

  // Show the complete configured santim multiplier precision.
  function formatBucketLabel(m) {
    return Number(m).toFixed(2);
  }

  // Keep the existing dark gradient; light mode uses payout-ranked cocoa/cherry tiers.
  function getBinColors(count, multipliers = []) {
    const colors = [];
    if (document.body?.dataset.customerTheme === 'light') {
      const theme = getComputedStyle(document.body);
      const tierColors = [
        theme.getPropertyValue('--plinko-tier-low').trim() || '#5C4033',
        theme.getPropertyValue('--plinko-tier-mid').trim() || '#A77B52',
        theme.getPropertyValue('--plinko-tier-high').trim() || '#C8553D',
        theme.getPropertyValue('--plinko-tier-highest').trim() || '#E3173E'
      ];
      const values = multipliers.map(Number);
      const unique = [...new Set(values)].sort((a, b) => a - b);
      const maxRank = Math.max(1, unique.length - 1);
      for (let i = 0; i < count; i++) {
        const rank = Math.max(0, unique.indexOf(values[i])) / maxRank;
        const tier = rank >= .75 ? 3 : rank >= .5 ? 2 : rank >= .25 ? 1 : 0;
        colors.push(tierColors[tier]);
      }
      return colors;
    }

    const mid = (count - 1) / 2;
    for (let i = 0; i < count; i++) {
      const dist = Math.abs(i - mid) / mid; // 0 at center, 1 at edges
      if (dist >= 0.85) colors.push('#ef4444');      // Intense Red
      else if (dist >= 0.65) colors.push('#f97316'); // Orange
      else if (dist >= 0.45) colors.push('#f59e0b'); // Amber / Gold
      else if (dist >= 0.25) colors.push('#0d9488'); // Dark Teal / Cool
      else colors.push('#1e293b');                    // Dark Slate (Center)
    }
    return colors;
  }

  function plinko(body, stage) {
    const { t, esc } = C;
    let selectedRows = 10;
    let selectedRisk = 'medium';
    let currentMode = 'manual'; // 'manual' or 'auto'
    const recentWins = [];
    let stats = { bets: 0, wins: 0, profit: 0 };

    // Auto Mode state
    let autoRunning = false;
    let autoRemaining = 0; // 0 = infinite or counter
    let autoStartBal = 0;
    let autoBaseBet = 1000;
    let autoStopProfit = null;
    let autoStopLoss = null;
    let autoOnWinAction = 'reset'; // 'reset' or 'increase'
    let autoOnWinPct = 0;
    let autoOnLossAction = 'reset';
    let autoOnLossPct = 0;
    let autoTimer = null;

    // Multi-ball active simulation state
    let activeBalls = [];
    let animFrameId = null;
    let plinkoAlive = true;
    let roundNonceSeq = 0;
    let activeClientSeed = 'client_' + Math.random().toString(36).slice(2, 10);
    let lastServerSeed = '', lastSeedHash = '', nextServerSeedHash = '';
    let lastPayoutVersion = GAME_PAYOUT_RULE_VERSION;

    const W = 620;
    const H = 460;

    body.innerHTML = `
      <div class="plinko-arena">
        <!-- LEFT CONTROL PANEL -->
        <div class="plinko-sidebar">
          <!-- Manual / Auto Mode Tabs -->
          <div class="plinko-mode-tabs">
            <button type="button" class="plinko-mode-btn active" id="ptab-manual">${esc(t('manual'))}</button>
            <button type="button" class="plinko-mode-btn" id="ptab-auto">${esc(t('auto'))}</button>
          </div>

          <!-- Bet Amount Bar -->
          <div class="plinko-sidebar-section">
            <div class="plinko-sidebar-label"><span>${esc(t('bet'))}</span></div>
            <div id="pbet"></div>
          </div>

          <!-- Risk Selector -->
          <div class="plinko-sidebar-section">
            <div class="plinko-sidebar-label"><span>${esc(t('risk'))}</span></div>
            <select id="p-risk" class="plinko-select">
              <option value="low">${esc(t('low'))}</option>
              <option value="medium" selected>${esc(t('medium'))}</option>
              <option value="high">${esc(t('high'))}</option>
            </select>
          </div>

          <!-- Rows Selector (8 to 16) -->
          <div class="plinko-sidebar-section">
            <div class="plinko-sidebar-label"><span>${esc(t('rows'))}</span></div>
            <select id="p-rows" class="plinko-select">
              ${[8, 9, 10, 11, 12, 13, 14, 15, 16].map((r) => `
                <option value="${r}" ${r === 10 ? 'selected' : ''}>${r}</option>
              `).join('')}
            </select>
          </div>

          <!-- AUTO MODE CONTROLS (Hidden in manual mode) -->
          <div id="p-auto-controls" style="display:none;flex-direction:column;gap:10px">
            <div class="plinko-sidebar-section">
              <div class="plinko-sidebar-label">
                <span>${esc(t('auto_bets'))}</span>
                <span style="font-size:11px;color:var(--text-secondary)">0 = ${esc(t('infinity'))}</span>
              </div>
              <div class="plinko-input-box">
                <input type="number" id="p-auto-count" min="0" max="1000" step="1" value="10">
              </div>
            </div>

            <div class="plinko-sidebar-section">
              <div class="plinko-sidebar-label"><span>${esc(t('stop_profit'))}</span></div>
              <div class="plinko-input-box">
                <input type="number" id="p-stop-profit" placeholder="Optional (credits)">
              </div>
            </div>

            <div class="plinko-sidebar-section">
              <div class="plinko-sidebar-label"><span>${esc(t('stop_loss'))}</span></div>
              <div class="plinko-input-box">
                <input type="number" id="p-stop-loss" placeholder="Optional (credits)">
              </div>
            </div>

            <!-- On Win / On Loss Strategy -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <div>
                <label style="font-size:11px;color:var(--text-secondary);font-weight:700">${esc(t('on_win'))}</label>
                <select id="p-win-action" class="plinko-select" style="padding:4px 6px;font-size:11px">
                  <option value="reset">${esc(t('reset'))}</option>
                  <option value="increase">+%</option>
                </select>
                <input id="p-win-pct" type="number" placeholder="%" value="50" style="display:none;width:100%;margin-top:4px;background:var(--input-bg);border:1px solid var(--input-border);color:var(--text);border-radius:6px;padding:3px;font-size:11px">
              </div>
              <div>
                <label style="font-size:11px;color:var(--text-secondary);font-weight:700">${esc(t('on_loss'))}</label>
                <select id="p-loss-action" class="plinko-select" style="padding:4px 6px;font-size:11px">
                  <option value="reset">${esc(t('reset'))}</option>
                  <option value="increase">+%</option>
                </select>
                <input id="p-loss-pct" type="number" placeholder="%" value="50" style="display:none;width:100%;margin-top:4px;background:var(--input-bg);border:1px solid var(--input-border);color:var(--text);border-radius:6px;padding:3px;font-size:11px">
              </div>
            </div>
          </div>

          <!-- Action Drop & Stop Buttons -->
          <div class="plinko-desktop-drop" style="display:flex;flex-direction:column;gap:8px;margin-top:4px">
            <button class="btn-plinko-drop" id="pdrop">
              <span>⚡</span> ${esc(t('drop_ball'))}
            </button>
            <button class="btn-plinko-stop" id="pstop" style="display:none">
              🛑 ${esc(t('stop_auto'))}
            </button>
          </div>
        </div>

        <!-- RIGHT MAIN AREA -->
        <div class="plinko-main-area">
          <!-- Recent Results Strip -->
          <div class="plinko-recent-bar" id="p-recent"></div>

          <!-- Board Canvas & Buckets Container -->
          <div class="plinko-board-container" id="pboard-wrap">
            <div class="plinko-canvas-wrap">
              <canvas id="plinko-canvas" width="${W}" height="${H}"></canvas>
            </div>
            <div class="plinko-buckets" id="plinko-buckets"></div>
          </div>

          <!-- Bottom Bar: Sound, Stats, Fairness Button -->
          <div class="plinko-bottom-bar">
            <div class="plinko-stats-group">
              <div class="plinko-stat">${esc(t('bets'))}: <span class="val" id="pstat-bets">0</span></div>
              <div class="plinko-stat">${esc(t('wins'))}: <span class="val green" id="pstat-wins">0</span></div>
              <div class="plinko-stat">${esc(t('profit'))}: <span class="val" id="pstat-profit">🪙 0</span></div>
            </div>
            <div style="display:flex;gap:8px;align-items:center">
              <button type="button" class="chip" id="pbtn-sound" style="font-size:11px">🔊 ${esc(t('sound_toggle'))}</button>
              <button type="button" class="chip" id="pbtn-fair" style="font-size:11px">🛡️ ${esc(t('fairness'))}</button>
            </div>
          </div>

          <!-- PROVABLY FAIR CARD (Toggleable) -->
          <div class="plinko-fair-card" id="pfair-card" style="display:none">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <h4 style="margin:0;color:var(--accent);font-size:14px">🛡️ ${esc(t('plinko_verify_title'))}</h4>
              <button type="button" class="chip" id="pfair-close" style="font-size:11px">✕</button>
            </div>
            <p style="font-size:12px;color:var(--text-secondary);margin:0 0 8px">${esc(t('plinko_verify_desc'))}</p>
            <div style="font-size:11px;color:var(--accent);margin-bottom:8px">${esc(t('formula'))}</div>

            <div style="display:flex;flex-direction:column;gap:6px;font-size:12px">
              <div>
                <label style="color:var(--text-muted)">${esc(t('server_seed_hash'))}:</label>
                <input id="pfair-hash" type="text" readonly style="width:100%;background:var(--input-bg);border:1px solid var(--input-border);color:var(--text-muted);padding:4px 8px;border-radius:6px;font-family:monospace;font-size:11px" value="">
              </div>
              <div>
                <label style="color:var(--text-muted)">${esc(t('server_seed'))}:</label>
                <input id="pfair-server-seed" type="text" placeholder="Revealed after round" style="width:100%;background:var(--input-bg);border:1px solid var(--input-border);color:var(--text);padding:4px 8px;border-radius:6px;font-family:monospace;font-size:11px">
              </div>
              <div style="display:flex;gap:8px">
                <div style="flex:1">
                  <label style="color:var(--text-muted)">${esc(t('client_seed'))}:</label>
                  <input id="pfair-client-seed" type="text" style="width:100%;background:var(--input-bg);border:1px solid var(--input-border);color:var(--text);padding:4px 8px;border-radius:6px;font-family:monospace;font-size:11px">
                </div>
                <div style="width:80px">
                  <label style="color:var(--text-muted)">Nonce:</label>
                  <input id="pfair-nonce" type="number" value="1" style="width:100%;background:var(--input-bg);border:1px solid var(--input-border);color:var(--text);padding:4px 8px;border-radius:6px;font-size:11px">
                </div>
              </div>
              <button type="button" class="btn btn-gold" id="pfair-verify-btn" style="padding:6px;margin-top:4px;font-size:12px">${esc(t('verify_btn'))}</button>
              <div id="pfair-result" style="font-size:12px;margin-top:6px"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- MOBILE STICKY BOTTOM BAR -->
      <div class="plinko-mobile-sticky-bar" id="pmob-bar">
        <button class="btn-plinko-drop" id="pmob-drop">
          <span>⚡</span> ${esc(t('drop_ball'))}
        </button>
        <button class="btn-plinko-stop" id="pmob-stop" style="display:none">
          🛑 ${esc(t('stop_auto'))}
        </button>
      </div>
    `;

    const cv = $('plinko-canvas');
    const ctx = cv.getContext('2d');
    const resizePlinkoCanvas = () => {
      if (!plinkoAlive) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.round(W * dpr), height = Math.round(H * dpr);
      if (cv.width !== width || cv.height !== height) {
        cv.width = width; cv.height = height;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Resizing a canvas clears its bitmap. Schedule a fresh static-board draw
      // so the pegs and background are present before the first ball is dropped.
      startAnimLoopIfNeeded();
    };
    const canvasResizeObserver = new ResizeObserver(resizePlinkoCanvas);
    canvasResizeObserver.observe($('pboard-wrap'));
    window.addEventListener('orientationchange', resizePlinkoCanvas, { passive: true });
    stopFns.push(() => {
      plinkoAlive = false;
      canvasResizeObserver.disconnect();
      window.removeEventListener('orientationchange', resizePlinkoCanvas);
      if (animFrameId !== null) cancelAnimationFrame(animFrameId);
      animFrameId = null;
      if (autoTimer) clearTimeout(autoTimer);
      autoRunning = false;
    });
    let pegRows = [];
    let bucketsCount = selectedRows + 1;
    let colSpacing = 0, rowSpacing = 0;
    const padX = 26, padY = 32;

    const bet = betBar($('pbet'));

    // Sound toggle in plinko bottom bar
    const sBtn = $('pbtn-sound');
    if (sBtn) {
      let isMute = localStorage.getItem('mute') === '1';
      sBtn.textContent = (isMute ? '🔇 ' : '🔊 ') + C.t('sound_toggle');
      sBtn.onclick = () => {
        isMute = !isMute;
        localStorage.setItem('mute', isMute ? '1' : '0');
        sBtn.textContent = (isMute ? '🔇 ' : '🔊 ') + C.t('sound_toggle');
      };
    }

    // Manual vs Auto Tab Switching
    $('ptab-manual').onclick = () => {
      if (autoRunning) return;
      currentMode = 'manual';
      $('ptab-manual').classList.add('active');
      $('ptab-auto').classList.remove('active');
      $('p-auto-controls').style.display = 'none';
    };
    $('ptab-auto').onclick = () => {
      if (autoRunning) return;
      currentMode = 'auto';
      $('ptab-auto').classList.add('active');
      $('ptab-manual').classList.remove('active');
      $('p-auto-controls').style.display = 'flex';
    };

    $('p-win-action').onchange = (e) => {
      $('p-win-pct').style.display = e.target.value === 'increase' ? 'block' : 'none';
    };
    $('p-loss-action').onchange = (e) => {
      $('p-loss-pct').style.display = e.target.value === 'increase' ? 'block' : 'none';
    };

    // Calculate Peg Geometry & Render Buckets
    function buildGeometry() {
      bucketsCount = selectedRows + 1;
      colSpacing = (W - padX * 2) / (bucketsCount - 1);
      rowSpacing = (H - padY - 50) / (selectedRows + 1);

      pegRows = [];
      for (let r = 0; r < selectedRows; r++) {
        const pegsInRow = r + 2;
        const rowY = padY + (r + 1) * rowSpacing;
        const startX = W / 2 - ((pegsInRow - 1) / 2) * colSpacing;
        const rowList = [];
        for (let c = 0; c < pegsInRow; c++) {
          rowList.push({ x: startX + c * colSpacing, y: rowY });
        }
        pegRows.push(rowList);
      }

      // Render Bottom Buckets with Plain Numbers & Smooth Gradient
      const mults = PLINKO_TABLES[selectedRows][selectedRisk];
      const colors = getBinColors(bucketsCount, mults);
      const host = $('plinko-buckets');
      host.innerHTML = mults.map((m, i) => `
        <div class="plinko-bucket" id="p-bk-${i}" style="background:${colors[i]};color:#ffffff;font-size:${selectedRows >= 14 ? '9.5px' : '11px'}">
          ${formatBucketLabel(m)}
        </div>
      `).join('');
    }

    function renderRecent() {
      const el = $('p-recent');
      if (!el) return;
      el.innerHTML = recentWins.slice(-10).map((item) => `
        <span class="plinko-pill" style="background:${item.color}">${Number(item.mult).toFixed(2)}</span>
      `).join('');
    }

    function updateStats() {
      $('pstat-bets').textContent = stats.bets;
      $('pstat-wins').textContent = stats.wins;
      const profEl = $('pstat-profit');
      profEl.textContent = `${stats.profit >= 0 ? '+' : ''}${C.fmt(stats.profit)}`;
      profEl.className = 'val ' + (stats.profit >= 0 ? 'green' : 'red');
    }

    function showFloatingWin(bucketIdx, payout) {
      if (payout <= 0) return;
      const wrap = $('pboard-wrap');
      if (!wrap) return;
      const targetX = padX + bucketIdx * colSpacing;
      const notice = document.createElement('div');
      notice.className = 'plinko-floating-win';
      notice.textContent = `Gross ${C.fmt(payout)}`;
      notice.style.left = `${(targetX / W) * 100}%`;
      notice.style.bottom = '46px';
      wrap.appendChild(notice);
      setTimeout(() => notice.remove(), 1250);
    }

    // Master Animation Loop (Supports Multiple Balls Concurrently)
    function animLoop() {
      if (!plinkoAlive) { animFrameId = null; return; }
      ctx.clearRect(0, 0, W, H);

      // Background Gradient
      const lightTheme = document.body?.dataset.customerTheme === 'light';
      const theme = lightTheme ? getComputedStyle(document.body) : null;
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, lightTheme ? (theme.getPropertyValue('--plinko-board-top').trim() || '#3E2B22') : '#0a101d');
      bg.addColorStop(1, lightTheme ? (theme.getPropertyValue('--plinko-board-bottom').trim() || '#2A1C16') : '#05080f');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Draw Pegs (with flash hit effect)
      const now = performance.now();
      const pegR = selectedRows >= 14 ? 3.2 : 3.8;
      pegRows.forEach((row, ri) => {
        row.forEach((p, ci) => {
          let isFlashing = false;
          for (let b of activeBalls) {
            if (b.lastPeg && b.lastPeg.r === ri && b.lastPeg.c === ci && (now - b.lastPeg.time < 180)) {
              isFlashing = true;
              break;
            }
          }
          ctx.beginPath();
          ctx.arc(p.x, p.y, pegR, 0, Math.PI * 2);
          ctx.fillStyle = isFlashing ? '#ffffff' : (lightTheme ? (theme.getPropertyValue('--plinko-peg').trim() || '#E8A93A') : '#c9a227');
          if (isFlashing) {
            ctx.shadowColor = '#ffffff';
            ctx.shadowBlur = 14;
          }
          ctx.fill();
          ctx.shadowBlur = 0;
        });
      });

      // Update & Draw All Active Balls
      for (let i = activeBalls.length - 1; i >= 0; i--) {
        const ball = activeBalls[i];
        ball.progress += ball.speed;
        const p0 = ball.path[ball.seg];
        const p1 = ball.path[ball.seg + 1];

        if (!p1) {
          // Ball arrived in bucket!
          activeBalls.splice(i, 1);
          const bk = $(`p-bk-${ball.targetBucket}`);
          if (bk) {
            bk.classList.add('hit');
            setTimeout(() => bk.classList.remove('hit'), 400);
          }
          sfx.coin();
          showFloatingWin(ball.targetBucket, ball.payout);

          const colors = getBinColors(bucketsCount, PLINKO_TABLES[selectedRows][selectedRisk]);
          recentWins.push({ mult: ball.mult, color: colors[ball.targetBucket] || '#d97706' });
          renderRecent();

          stats.bets++;
          if (ball.payout > ball.bet) stats.wins++;
          stats.profit += (ball.payout - ball.bet);
          updateStats();

          if (ball.onFinish) ball.onFinish(ball);
          continue;
        }

        const ease = ball.progress * ball.progress * (3 - 2 * ball.progress);
        const arc = Math.sin(ball.progress * Math.PI) * 5.5;
        const bx = p0.x + (p1.x - p0.x) * ease + ball.wobble * (1 - ball.progress);
        const by = p0.y + (p1.y - p0.y) * ease - arc;

        if (ball.progress >= 1) {
          ball.seg++;
          ball.progress = 0;
          if (ball.path[ball.seg] && ball.path[ball.seg].r !== undefined) {
            ball.lastPeg = { r: ball.path[ball.seg].r, c: ball.path[ball.seg].c, time: performance.now() };
            sfx.plink();
          }
        }

        // Draw Glowing Ball
        const ballR = selectedRows >= 14 ? 5.8 : 7.2;
        ctx.beginPath();
        ctx.arc(bx, by, ballR, 0, Math.PI * 2);
        const grad = ctx.createRadialGradient(bx - 2, by - 2, 1, bx, by, ballR);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.3, '#facc15');
        grad.addColorStop(1, '#ea580c');
        ctx.fillStyle = grad;
        ctx.shadowColor = 'rgba(250, 204, 21, 0.85)';
        ctx.shadowBlur = 12;
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      if (activeBalls.length > 0 || autoRunning) {
        animFrameId = requestAnimationFrame(animLoop);
      } else {
        animFrameId = null;
      }
    }

    function startAnimLoopIfNeeded() {
      if (!animFrameId) {
        animFrameId = requestAnimationFrame(animLoop);
      }
    }

    const plinkoThemeObserver = new MutationObserver(() => startAnimLoopIfNeeded());
    plinkoThemeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-customer-theme'] });
    stopFns.push(() => plinkoThemeObserver.disconnect());

    // Launch single ball through queue
    async function launchBall(onFinishCallback = null) {
      const currentBet = bet.get();
      roundNonceSeq++;
      const thisNonce = roundNonceSeq;

      try {
        const r = await C.api('/games/plinko', {
          bet: currentBet,
          rows: selectedRows,
          risk: selectedRisk,
          client_seed: activeClientSeed,
          nonce: thisNonce
        });

        C.setBalance(r.balance);
        lastServerSeed = r.server_seed;
        lastSeedHash = r.server_seed_hash;
        nextServerSeedHash = r.next_server_seed_hash || '';
        lastPayoutVersion = r.payout_version || GAME_PAYOUT_RULE_VERSION;

        $('pfair-hash').value = lastSeedHash;
        $('pfair-server-seed').value = lastServerSeed;
        $('pfair-client-seed').value = activeClientSeed;
        $('pfair-nonce').value = thisNonce;

        const steps = r.path || Array.from({ length: selectedRows }, () => Math.round(Math.random()));
        const targetBucket = r.bucket;

        // Construct 2D trajectory path
        const path = [{ x: W / 2, y: 12 }];
        let curCol = 0;
        for (let rowIdx = 0; rowIdx < selectedRows; rowIdx++) {
          const rowPegs = pegRows[rowIdx];
          const peg = rowPegs[Math.min(curCol, rowPegs.length - 1)];
          path.push({ x: peg.x, y: peg.y, r: rowIdx, c: curCol });
          if (steps[rowIdx] === 1) curCol++;
        }
        const finalX = padX + targetBucket * colSpacing;
        path.push({ x: finalX, y: H - 16 });

        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const ballObj = {
          path,
          seg: 0,
          progress: 0,
          speed: reduced ? 0.35 : 0.082 + Math.random() * 0.012, // subtle natural wobble in timing
          wobble: (Math.random() - 0.5) * 2,
          targetBucket,
          mult: r.mult,
          payout: r.payout,
          bet: currentBet,
          lastPeg: null,
          onFinish: onFinishCallback
        };

        activeBalls.push(ballObj);
        startAnimLoopIfNeeded();
        return r;
      } catch (e) {
        C.fail(e);
        throw e;
      }
    }

    // Row & Risk change handlers
    $('p-rows').onchange = (e) => {
      selectedRows = Number(e.target.value);
      buildGeometry();
      startAnimLoopIfNeeded();
    };
    $('p-risk').onchange = (e) => {
      selectedRisk = e.target.value;
      buildGeometry();
      startAnimLoopIfNeeded();
    };

    // Provably Fair Verifier
    $('pbtn-fair').onclick = () => {
      const card = $('pfair-card');
      card.style.display = card.style.display === 'none' ? 'block' : 'none';
    };
    $('pfair-close').onclick = () => { $('pfair-card').style.display = 'none'; };

    $('pfair-verify-btn').onclick = async () => {
      const sSeed = $('pfair-server-seed').value.trim();
      const cSeed = $('pfair-client-seed').value.trim();
      const nonce = Number($('pfair-nonce').value) || 1;
      if (!sSeed || !cSeed) {
        $('pfair-result').innerHTML = `<span style="color:var(--danger)">Enter Server Seed and Client Seed</span>`;
        return;
      }
      try {
        const res = await C.api('/games/plinko/verify', {
          server_seed: sSeed,
          client_seed: cSeed,
          nonce,
          rows: selectedRows,
          risk: selectedRisk,
          payout_version: lastPayoutVersion
        });
        const matchHash = res.server_seed_hash === lastSeedHash;
        $('pfair-result').innerHTML = `
          <div style="background:var(--success-bg);padding:8px;border-radius:6px;border:1px solid var(--success-border);color:var(--success)">
            <b>✓ Verification Reproducible!</b><br>
            <span style="color:var(--text-secondary);font-size:11px">Landed Bucket: ${res.bucket} (×${res.multiplier})</span><br>
            <span style="font-size:10px;color:var(--text-secondary)">Path: [${res.path.map((b) => b ? 'R' : 'L').join(', ')}] ${matchHash ? '✓ Matches Round Hash' : ''}</span>
          </div>`;
      } catch (e) {
        $('pfair-result').innerHTML = `<span style="color:var(--danger)">${esc(e.message || 'Verification failed')}</span>`;
      }
    };

    // Auto Mode Engine
    function startAuto() {
      if (autoRunning) return;
      autoRunning = true;
      $('pdrop').style.display = 'none';
      $('pstop').style.display = 'block';
      $('pmob-drop').style.display = 'none';
      $('pmob-stop').style.display = 'block';
      bet.lock(true);
      $('p-rows').disabled = true;
      $('p-risk').disabled = true;

      const countInput = Number($('p-auto-count').value);
      autoRemaining = countInput > 0 ? countInput : Infinity;
      autoBaseBet = bet.get();
      autoStartBal = C.roadState?.balance || 0;
      autoStopProfit = Number($('p-stop-profit').value) || null;
      autoStopLoss = Number($('p-stop-loss').value) || null;
      autoOnWinAction = $('p-win-action').value;
      autoOnWinPct = Number($('p-win-pct').value) || 0;
      autoOnLossAction = $('p-loss-action').value;
      autoOnLossPct = Number($('p-loss-pct').value) || 0;

      scheduleNextAutoDrop();
    }

    function stopAuto() {
      autoRunning = false;
      if (autoTimer) clearTimeout(autoTimer);
      autoTimer = null;
      $('pdrop').style.display = 'block';
      $('pstop').style.display = 'none';
      $('pmob-drop').style.display = 'block';
      $('pmob-stop').style.display = 'none';
      bet.lock(false);
      $('p-rows').disabled = false;
      $('p-risk').disabled = false;
    }

    async function scheduleNextAutoDrop() {
      if (!autoRunning) return;

      // Check Stop on Profit / Loss
      if (autoStopProfit !== null && stats.profit >= autoStopProfit * 100) {
        stopAuto(); return;
      }
      if (autoStopLoss !== null && stats.profit <= -autoStopLoss * 100) {
        stopAuto(); return;
      }

      if (autoRemaining !== Infinity) {
        if (autoRemaining <= 0) {
          stopAuto(); return;
        }
        autoRemaining--;
      }

      try {
        await launchBall((finishedBall) => {
          if (!autoRunning) return;
          const isWin = finishedBall.payout > finishedBall.bet;
          const betInput = $('pbet').querySelector('input');
          if (isWin) {
            if (autoOnWinAction === 'increase' && autoOnWinPct > 0) {
              const nextVal = Math.min(C.limits.max / 100, Math.round(Number(betInput.value) * (1 + autoOnWinPct / 100)));
              betInput.value = nextVal;
            } else {
              betInput.value = autoBaseBet / 100;
            }
          } else {
            if (autoOnLossAction === 'increase' && autoOnLossPct > 0) {
              const nextVal = Math.min(C.limits.max / 100, Math.round(Number(betInput.value) * (1 + autoOnLossPct / 100)));
              betInput.value = nextVal;
            } else {
              betInput.value = autoBaseBet / 100;
            }
          }
        });

        // Stake-style drop cadence: allow another ball every 380ms
        autoTimer = setTimeout(scheduleNextAutoDrop, 380);
      } catch (e) {
        stopAuto();
      }
    }

    $('pstop').onclick = stopAuto;
    $('pmob-stop').onclick = stopAuto;

    // Drop Button Click
    const handleDrop = () => {
      if (currentMode === 'auto') {
        if (autoRunning) stopAuto();
        else startAuto();
      } else {
        launchBall(); // Manual mode drops single ball, queueable simultaneously
      }
    };

    $('pdrop').onclick = handleDrop;
    $('pmob-drop').onclick = handleDrop;

    buildGeometry();
    startAnimLoopIfNeeded();
  }

  // =========================================================
  // ROAD DASH (Chicken Crossing — Chicken Road 3G Style)
  // =========================================================
  // The scene uses responsive lane widths on small screens. Keep the camera and
  // chicken coordinates in sync with the rendered geometry instead of assuming
  // the desktop pixel dimensions.
  let LANE_W = 118, CURB_W = 140;
  const heroLeft = (step) =>
    step === 0 ? (CURB_W - 76) / 2 : CURB_W + (step - 1) * LANE_W + (LANE_W - 76) / 2;

  const CHICKEN_SVG = `<svg viewBox="0 0 542 460" width="100%" height="100%" class="chicken-svg">
    <defs>
      <linearGradient id="chk-grad1" x1="663.212" x2="669.206" y1="358.176" y2="361.644" gradientUnits="userSpaceOnUse"><stop class="stop0" offset="0" stop-color="#f20809" stop-opacity=".624"/><stop class="stop1" offset="1" stop-color="#f20b0b" stop-opacity=".686"/></linearGradient><linearGradient id="chk-grad2" x1="1253.73" x2="1256.99" y1="1790.66" y2="1778.4" gradientUnits="userSpaceOnUse"><stop class="stop0" offset="0" stop-color="#a45004" stop-opacity=".561"/><stop class="stop1" offset="1" stop-color="#9b4b01" stop-opacity=".655"/></linearGradient><linearGradient id="chk-grad3" x1="355.619" x2="363.518" y1="957.023" y2="968.171" gradientUnits="userSpaceOnUse"><stop class="stop0" offset="0" stop-opacity=".976"/><stop class="stop1" offset="1" stop-color="#220101"/></linearGradient><linearGradient id="chk-grad4" x1="769.828" x2="765.803" y1="367.259" y2="351.791" gradientUnits="userSpaceOnUse"><stop class="stop0" offset="0" stop-color="#250003" stop-opacity=".902"/><stop class="stop1" offset="1" stop-color="#370009" stop-opacity=".976"/></linearGradient><linearGradient id="chk-grad5" x1="914.159" x2="939.489" y1="998.446" y2="1053.13" gradientUnits="userSpaceOnUse"><stop class="stop0" offset="0" stop-color="#050005" stop-opacity=".988"/><stop class="stop1" offset="1" stop-color="#1e0006" stop-opacity=".988"/></linearGradient><linearGradient id="chk-grad6" x1="415.981" x2="667.709" y1="1070.39" y2="1092.83" gradientUnits="userSpaceOnUse"><stop class="stop0" offset="0" stop-color="#270000"/><stop class="stop1" offset="1" stop-color="#180014"/></linearGradient><linearGradient id="chk-grad7" x1="571.431" x2="567.662" y1="967.52" y2="955.771" gradientUnits="userSpaceOnUse"><stop class="stop0" offset="0" stop-color="#020100" stop-opacity=".929"/><stop class="stop1" offset="1" stop-opacity=".969"/></linearGradient><linearGradient id="chk-grad8" x1="672.447" x2="350.724" y1="912.129" y2="767.52" gradientUnits="userSpaceOnUse"><stop class="stop0" offset="0" stop-color="#010001" stop-opacity=".988"/><stop class="stop1" offset="1" stop-color="#2d0001"/></linearGradient><linearGradient id="chk-grad9" x1="412.586" x2="398.552" y1="1347.64" y2="1342.01" gradientUnits="userSpaceOnUse"><stop class="stop0" offset="0" stop-color="#9f8e96"/><stop class="stop1" offset="1" stop-color="#99989a"/></linearGradient><linearGradient id="chk-grad10" x1="1369.86" x2="1355.2" y1="1719.02" y2="1908.06" gradientUnits="userSpaceOnUse"><stop class="stop0" offset="0" stop-color="#aa3131" stop-opacity=".078"/><stop class="stop1" offset="1" stop-color="#a3312e" stop-opacity=".298"/></linearGradient><linearGradient id="chk-grad11" x1="768.139" x2="870.143" y1="798.481" y2="670.907" gradientUnits="userSpaceOnUse"><stop class="stop0" offset="0" stop-color="#160102"/><stop class="stop1" offset="1" stop-color="#370000"/></linearGradient><linearGradient id="chk-grad12" x1="495.605" x2="469.405" y1="759.225" y2="752.243" gradientUnits="userSpaceOnUse"><stop class="stop0" offset="0" stop-color="#fb1e00"/><stop class="stop1" offset="1" stop-color="#d40400"/></linearGradient><linearGradient id="chk-grad13" x1="627.421" x2="544.618" y1="589.009" y2="551.904" gradientUnits="userSpaceOnUse"><stop class="stop0" offset="0" stop-color="#9b958c"/><stop class="stop1" offset="1" stop-color="#b2acba"/></linearGradient><linearGradient id="chk-grad14" x1="608.111" x2="625.629" y1="783.043" y2="896.261" gradientUnits="userSpaceOnUse"><stop class="stop0" offset="0" stop-color="#b85500"/><stop class="stop1" offset="1" stop-color="#d97201"/></linearGradient><linearGradient id="chk-grad15" x1="1594.41" x2="1608.91" y1="1125.94" y2="1112.03" gradientUnits="userSpaceOnUse"><stop class="stop0" offset="0" stop-color="#a50011" stop-opacity=".78"/><stop class="stop1" offset="1" stop-color="#9c0010" stop-opacity=".816"/></linearGradient><linearGradient id="chk-grad16" x1="1374" x2="1493.45" y1="872.715" y2="933.503" gradientUnits="userSpaceOnUse"><stop class="stop0" offset="0" stop-color="#ec1211" stop-opacity=".82"/><stop class="stop1" offset="1" stop-color="#f51817" stop-opacity=".929"/></linearGradient><linearGradient id="chk-grad17" x1="934.349" x2="953.159" y1="1534.17" y2="1472.82" gradientUnits="userSpaceOnUse"><stop class="stop0" offset="0" stop-color="#555c72"/><stop class="stop1" offset="1" stop-color="#65728b"/></linearGradient><linearGradient id="chk-grad18" x1="678.319" x2="691.617" y1="1302.38" y2="1592.46" gradientUnits="userSpaceOnUse"><stop class="stop0" offset="0" stop-color="#bd936d"/><stop class="stop1" offset="1" stop-color="#e0ae6b"/></linearGradient><linearGradient id="chk-grad19" x1="677.493" x2="1650.94" y1="1732.61" y2="647.974" gradientUnits="userSpaceOnUse"><stop class="stop0" offset="0" stop-color="#1b0208"/><stop class="stop1" offset="1" stop-color="#45000f" stop-opacity=".988"/></linearGradient>
    </defs>
    <g id="chicken-character">
      <g id="tail">
        <g transform="translate(543.225 -31.225) scale(-0.25 0.25)">
        <path fill="#a20411" fill-opacity=".953" d="M1611.97 1243.58c1.71.85 1.61 1.05 3.06 2.43 3.25 8.84.66 40.4-2.19 50.43l-1.26-1.24c-.13-5.03 1.16-14.5 1.21-20.9.05-8.25-1.89-24.08-.82-30.72"/>
        <path fill="#590002" fill-opacity=".165" d="M1663.77 1394.48c4.29-.48 12.51-2.07 15.64.39l-1.27 2.75-2.47.75c-5.59 2.09-9.64 3.43-14.63-.84l.11-1.73z"/>
        <path fill="#f21714" fill-opacity=".839" d="m1657.41 684.227.92 1.639c.88 4.735 1.59 8.611 2.89 13.29-1.17 7.481-1.27 10.802-1.31 18.427-5.63 80.17-27.16 163.939-56.65 238.646-8.18 20.717-19.83 41.035-27.73 60.691-3.11 5.92-9.72 17.87-11.02 23.85-4.97-1.97-12.36-2.07-17.55-1.09l-.32.85c2.91.44 3.18-.06 4.89 1.36-3.61 1.38-6.04 2.19-9.37 4.12l7.12.59c.31-.36-29.45 15.51-29.67 15.56-2.94-2.8-2.73-1.5-3.14-4.39 5.76-.37 14.97-.49 18.32-6.16l-.91-1.36-2.73.07-3.03 2.09c-12.02 8.4-15.85-1-25.52-7.69-4.28-2.97-7.44-4.21-11.42-8.13-.37-3.69-.11-13.01.72-16.36 3.27-13.22 15.3-73.03 19.84-81.556.94 2.583-.66 16.416-1.88 18.52-6.75 11.579-8.51 27.38-9.98 40.876l.81.716c7.58-4.566 4.54-24.348 7-29.521 8.96-19.367 11.49-41.234 16.42-62.092 3.6-15.19 11.32-32.269 13.95-46.999l.29-1.645c1.93-1.947 3.49-4.291 5.12-6.522.74-4.312.72-8.854.86-13.251 1.64-5.486 7.51-17.279 10.15-22.946 14.97-32.088 31.88-58.661 53.19-86.719.96-.59 10.65-11.493 12.28-13.359 11.3-12.946 23.23-22.01 37.46-31.505"/>
        <path fill="#f21714" fill-opacity=".765" d="M1751.94 913.448c2.21-.035 11.48-.129 13.08-.72 4.73-1.739 11.92-13.447 17.8-8.74 2.13 7.326-2.69 18.595-.44 31.045-6.58 17.619-25.15 48.676-35.74 64.449-12.89-.031-15.52 17.768-25.61 24.708-2.62 4.77-1.92 3.09-4.96 6.19-11.59 11.86-22.24 26.83-32.41 40.03-1.34 1.74-3.18 2.6-4.67 4.48-2.74 8.53-36.64 34.81-37.84 40.61-7.63 4.89-20.98 15.91-24.93 24.06l.11 2.18c4.16 2.79 5.44-.16 9.35-1.75-1.85 2.33-2.16 3.21-4.6 4.78-2.62-.01-5.32 1.36-7.84 2.35-8.53-7.78 15.76-50.39-29.16-43.25l6.07-11.32c10.67-20.23 21.1-40.59 31.28-61.08l3.38-6.46c12.89-22.91 27.9-46.988 45.59-66.588 3.22-3.569 6.51-7.067 9.72-10.656a571 571 0 0 1 17.98-15.176c4.04-.414 12.93-6.621 17.03-9.139l1.48.5c3.74 1.297 5.81 3.57 9.84 3.21 3.48-2.423 4.47-6.909 8.57-7.384 9.93-1.147 10.16 3.543 16.92-6.329"/>
        <path fill="#a92a27" fill-opacity=".788" d="m1659.91 717.583 2.21-7.657.46-.182c4.13 12.566 16.31 52.419 14.94 64.453-1.81-.572-2.4-2.749-3.67-4.981-.97 4.888 5.03 34.448 5.85 41.541.66 5.703.38 8.862.53 14.461l.84-.389c.11-8.748-1.24-18.897-.66-26.716.63 8.125 1.62 12.889 2.66 20.546 1.2 8.944-2.56 14.509.03 24.905l-.17-2.561c1.22 7.869 1.53 14.638 3.39 22.371-.7 14.909-1.66 25.201-4.09 39.997-1.19 7.319-7.22 34.098-6.9 38.875-2.09 4.185-4.91 6.929-8 10.449-15.18 16.552-36.29 48.095-46.56 68.745l-5.29 10.09c-7.69 15.42-20.68 48.45-28.84 59.57-.74-18.13 4.94-31.33-11.85-44.87-1.82-9.93-.88-19.39.74-29.31 7.9-19.656 19.55-39.974 27.73-60.691 29.49-74.707 51.02-158.476 56.65-238.646"/>
        <path fill="url(#chk-grad16)" d="m1422.38 777.596 1.24-2.6c1.68 4.348 8.83 18.768 11.91 21.47 36.24 74.897 24.62 141.049 20.39 220.344-14.28-6.91-29.24-13.59-44.33-18.431-9.67-3.1-19.5-4.996-29.29-7.75-1.27-53.558-1.61-133.786 23.24-182.409 8.28-4.39.24-8.231 17.38-9.519 1.51-7.144 2.8-14.282-.54-21.105"/>
        <path fill="#a92a27" fill-opacity=".059" d="M1744.91 1033.55c.86-3.95.97-4.83 2.67-8.41 3.61-2.29 3.34-1.52 8.3-1.75 4.06 14.49-.54 11.59-7.66 19.18-1.93 2.06-1.16 15.98-2.51 19.27-1.26 3.97-6.66 6.15-6.92 11.26 2.15 3.81 2.33 3.9 5.9 6.58 2.54.44 1.32.67 3.78-.42-9.83 16.69-17.83 29.22-30.49 44.36-8.39 10.03-19.24 20.32-27.09 29.96-22.18 20.16-36.04 35.25-62.25 52.93-3.17-4.05-6.78-8.22-10.09-12.2-6.01 1.74-11.92 11.29-18.78 11.75-2.98-4.26-4.72-21.44-3.58-26.65-2.83-.02-1.5.28-3.91-1.34 1.84-4.68 6.13-18.99 8.07-22.13l.58 1.12c-.37 2.96-1.23 5.86.15 8.26 1.9-1.18 1.46-1.91 2.23-4.89 5.74-3.77 20.15 7.98 17.8-14.74l-.03-.92c2.44-1.57 2.75-2.45 4.6-4.78l2.56-2.91c16.54-12.55 50.44-47.24 62.57-62.9 4.03-3.06 30.76-36.63 34.98-42.12 7.84 8.83-1.52 16.26 1.17 22.01 3.51.47 5.37 1.56 8.44 2.01-3.1-7.13 6.15-16.06 9.51-22.53"/>
        <path fill="#9b0311" fill-opacity=".816" d="M1434.4 777.221c10.66 7.363 18.96 14.746 28.4 23.646 17.78 21.804 33.18 44.785 42.94 71.375-14.88 32.747-23.69 76.756-25.38 112.628-.65 13.969.39 32.65.83 46.98-5.1-3.12-21.29-11.8-25.27-15.04 4.23-79.295 15.85-145.447-20.39-220.344 1.55-2.836-1.23-2.564-2.84-8.457 1.66-4.553 2.57-5.969 1.71-10.788"/>
        <path fill="#f21714" fill-opacity=".725" d="M1796.92 1122.96c15.03-.82 13.62 6.22 26.2 1.09l-1.79 3.2-1.85.54c-2.68.8-4.19 1.57-6.66 2.81-4.97-1.16-5.43-1.53-9.98-4.09-5.11-.36-13.05 7.29-16.47 10.87-6.61-.91-9.96-1.46-16.65-1.32l-.92.02c-10.65.4-10.55 3.02-20.17 6.7-5.24 2-9.53.49-15.25 3.69l-1.49 2.3c2.55 7.92 18.72 4.6 24.54 9.68.48.24.97.47 1.45.71 8.56-2.29 12.96-6.51 20.41-8.45 4.6 3.54-3.61 3.78 9.12 9.86-2.59 5.43-5.63 2.56-5.64 6.48-1.84 1.38-5.86 4.65-7.72 5.34l-1.98-1.63c-1.58.29-18.14 4.96-19.5 5.51-6.54 7.12-16.23 9.06-24.65 13.96-8.88 5.17-18.25 9.85-27.19 14.93-2.99 1.59-10.98.87-14.41.66-2.61 4.06-1.42 4.59.1 9.22l1.37.56c-2.25.6-1.2.75-2.91.26-7.71-2.2-17.16-2.54-25.16-2.68l-1.03 1.07.31 2.08.15 1.6c-6.53 4.76-17.83 5.25-24.97 1.86-1.09-.51.36-7.21-.36-10.13 1.87-1.93 18.8-12.8 22.7-15.74 18.03-13.58 31.65-25.39 47.49-41.39l5.95-5.8c6.22-.64 30.15-10.2 39.75-12.49 9.36-1.24 11.17-.22 20.05.19 4.18-.47 8.38-.34 10.97-4.13 1.72-2.52 5-3.95 7.22-5.82z"/>
        <path fill="#f5d0cb" fill-opacity=".988" d="M1626.25 692.687c5.68-.126 16.36-13.912 21.87-13.926l-.57 2.026c-2.31 3.603-2.17 4.438-2.19 8.728-10.5 9.459-31.58 25.431-37.81 37.723l.12 1.853c-21.31 28.058-38.22 54.631-53.19 86.719-2.64 5.667-8.51 17.46-10.15 22.946-18.17 39.45-29.85 80.535-40.84 122.395-3.27 12.493-9.78 46.679-13.77 57.049-.22-100.214 58.55-260.542 136.53-325.513"/>
        <path fill="#807096" d="M1734.32 1354.05c1.27 5.62.97 6.61-3.05 12.46-36.47 53.14-73.91 87.6-134.91 108.32-7.34 8.48-59.17 14.56-72.86 16.54l.75 1.35c6.61 1.49 21.08-.86 24.05.74-8.26 1.05-42.24 3.08-50.2 2.25 9.14-3.47 15.19-4.69 24.65-6.75 1.15-1.83 2.79-2.93 4.88-3.36 72.27-14.92 132.64-53.37 183.35-105.98 7.86-8.16 15.15-17.31 23.34-25.57"/>
        <path fill="#7f0213" d="M1522.75 1488.96c16.52.95 56.63-9.63 73.61-14.13-7.34 8.48-59.17 14.56-72.86 16.54l.75 1.35c6.61 1.49 21.08-.86 24.05.74-8.26 1.05-42.24 3.08-50.2 2.25 9.14-3.47 15.19-4.69 24.65-6.75"/>
        <path fill="#9b0311" fill-opacity=".835" d="m1795.88 906.844 2.23.138-.3 6.104c-.96 6.726-1.42 13.506-1.98 20.279-1.07 10.105-2.83 26.056-5.33 35.927-4.88.984-3.13-.25-5.85 3.183-.31 3.531-.69 1.902 1.44 4.986l2.74.496c-5.85 21.117-11.41 39.743-20.21 59.893-1.7 3.9-3.47 7.21-3.3 11.33-1 4.03-4.81 10.11-7.98 13 .06-18.45 39.79-79.786-14.85-55.14 1.01-2.12 2.96-5.4 4.15-7.558 10.59-15.773 29.16-46.83 35.74-64.449l4.03-8.344c1.75-3.256 3.77-8.085 5.35-11.561 1.35-1.651 3.13-6.096 4.12-8.284"/>
        <path fill="#c09cba" fill-opacity=".988" d="M1660.07 670.921c4.24 6.81 9.73 19.782 12.84 27.539 27.07 67.55 26.45 145.845 10.03 215.835a551 551 0 0 1-7.61 27.951c-.32-4.777 5.71-31.556 6.9-38.875 2.43-14.796 3.39-25.088 4.09-39.997 4.3-40.667-10.02-125.01-25.1-164.218-1.3-4.679-2.01-8.555-2.89-13.29 2.49-7.534 2.2-6.932 1.74-14.945"/>
        <path fill="#f5d0cb" d="M1371.31 988.683c-5.43-54.477.76-109.105 19.82-160.897 2.2-5.979 12.03-30.176 17.8-32.671.95 5.509-.87 7.663-3.39 13.105-24.85 48.623-24.51 128.851-23.24 182.409-3.74-1.207-7.12-1.458-10.99-1.946"/>
        <path fill="#f21714" fill-opacity=".561" d="M1786.37 1137.38c3.42-3.58 11.36-11.23 16.47-10.87 4.55 2.56 5.01 2.93 9.98 4.09 2.47-1.24 3.98-2.01 6.66-2.81l1.85-.54.39 1.8-.76-.06c-8.09 8.26-16.6 6.12-10.09 21.26l-3.08 5.1c-12.48 2.46-22.3 11.39-26.02 11.7.01-3.92 3.05-1.05 5.64-6.48-12.73-6.08-4.52-6.32-9.12-9.86-7.45 1.94-11.85 6.16-20.41 8.45-.48-.24-.97-.47-1.45-.71-5.82-5.08-21.99-1.76-24.54-9.68l1.49-2.3c5.72-3.2 10.01-1.69 15.25-3.69 9.62-3.68 9.52-6.3 20.17-6.7-3.42 1.27-7.25 2.18-9.38 4.95l-.35 2.29c4.63 3.28 16.39 1.55 19.34-3.17-1-3.04-5.88-3.54-8.69-4.09 6.69-.14 10.04.41 16.65 1.32"/>
        <path fill="#f21714" fill-opacity=".988" d="M1544.33 838.756c-.14 4.397-.12 8.939-.86 13.251-1.63 2.231-3.19 4.575-5.12 6.522l-.29 1.645c-2.63 14.73-10.35 31.809-13.95 46.999-4.93 20.858-7.46 42.725-16.42 62.092-2.46 5.173.58 24.955-7 29.521l-.81-.716c1.47-13.496 3.23-29.297 9.98-40.876 1.22-2.104 2.82-15.937 1.88-18.52-4.54 8.526-16.57 68.336-19.84 81.556-.83 3.35-1.09 12.67-.72 16.36 3.98 3.92 7.14 5.16 11.42 8.13 9.67 6.69 13.5 16.09 25.52 7.69l3.03-2.09 2.73-.07.91 1.36c-3.35 5.67-12.56 5.79-18.32 6.16.41 2.89.2 1.59 3.14 4.39.22-.05 29.98-15.92 29.67-15.56l-7.12-.59c3.33-1.93 5.76-2.74 9.37-4.12-1.71-1.42-1.98-.92-4.89-1.36l.32-.85c5.19-.98 12.58-.88 17.55 1.09-2.31 2.97-1.04 2.39-3.94 3.63-12.27 3.73-28.74 13.84-41.12 19.84-10.17-10.84-17.86-18.33-30.37-26.25.02-6.48-.18-13.39.64-19.79 3.99-10.37 10.5-44.556 13.77-57.049 10.99-41.86 22.67-82.945 40.84-122.395"/>
        <path fill="#f11812" fill-opacity=".98" d="M1633.82 1209.66c.72 2.92-.73 9.62.36 10.13 7.14 3.39 18.44 2.9 24.97-1.86l-.15-1.6c7.27.12 20-.66 25.25 3.43-11.87 4.52-28.56 8.5-40.96 12.31-9.6 2.94-21.94 7.13-31.3 9.23-2.03-.96-1.49-.24-2.13-1.62-2.66-4.86-5.58-8.6-8.85-13.05 11.33-5.03 18.56-8.49 29.4-14.68z"/>
        <path fill="#f21714" fill-opacity=".965" d="m1783.31 893.383 1.04-.216c5.34-1.143 9.76-3.947 13.56-3.032 1.66 2.693 1.18 2.339 1.29 5.913l-1.16 6.55c-.17-3.898.14-7.977-1.8-11.229l.79 2.851-1.95-1.15c-.81 5.136-.83 8.697.8 13.774-.99 2.188-2.77 6.633-4.12 8.284l-1.4-1.808c-5.66.416-5.63 9.45-3.95 13.369l-4.03 8.344c-2.25-12.45 2.57-23.719.44-31.045-5.88-4.707-13.07 7.001-17.8 8.74-1.6.591-10.87.685-13.08.72-6.76 9.872-6.99 5.182-16.92 6.329-4.1.475-5.09 4.961-8.57 7.384-4.03.36-6.1-1.913-9.84-3.21l-1.48-.5c20.04-11.401 46.22-23.16 68.18-30.068"/>
        <path fill="#9b0311" fill-opacity=".49" d="M1742.49 1007.04c54.64-24.646 14.91 36.69 14.85 55.14-3.43 4.41-2.86 7.3-5.89 11.98.26-16.79 2.78-26.18 8.03-42.01.99-2.99-1.62-6.54-3.6-8.76-4.96.23-4.69-.54-8.3 1.75-1.7 3.58-1.81 4.46-2.67 8.41-.76-4.99-.63-7.44-3.79-11.39-3.09-1.39-3.55-1.86-6.96-1.99 2.73-4.41 5.51-8.78 8.33-13.13"/>
        <path fill="url(#chk-grad15)" d="M1584.08 1103.87c44.92-7.14 20.63 35.47 29.16 43.25 2.52-.99 5.22-2.36 7.84-2.35l.03.92-9.27 6.6c-4.11-1.21-6.26-2.31-10.3-1.5l-2.03 1.91c5.01-17.49-.05-40.5-23.27-30.65 2.69-7.25 4.33-11.32 7.84-18.18"/>
        <path fill="#a92a27" fill-opacity=".631" d="M1781.77 1167.05c3.72-.31 13.54-9.24 26.02-11.7-2.54 4.42-16.79 33.13-18.26 34.5-8.06-10.52-18.13.39-32.54-6.45 2.86-1.5 5.28-3.2 7.95-4.99 2.51-1.06 6.72-4.33 9.11-6.02 1.86-.69 5.88-3.96 7.72-5.34"/>
        <path fill="#807096" d="m1821.72 1129.05 5.84.54c-6.49 19.07-23.2 60.21-37.02 73.32-.08-3.55 3.51-6.97 5.81-10.2-2.41-1.04-2.33-1.24-4.88-.94-2.35 4.23-2.78 6.2-7.19 8.23 1.23-3.25 3.53-7.05 5.25-10.15 1.47-1.37 15.72-30.08 18.26-34.5l3.08-5.1c3.14-5.22 8.7-15.5 10.09-21.26z"/>
        <path fill="#f11812" fill-opacity=".98" d="M1678.99 1074.89c5.58-1.27 6.41-1.77 11.82-.71-12.13 15.66-46.03 50.35-62.57 62.9l-1.07-1.87c.2-4.15 10.87-14.75 13.98-19.71 1.2-5.8 35.1-32.08 37.84-40.61"/>
        <path fill="#300106" fill-opacity=".871" d="M1690.89 1153.58c5.74-1.22 7.3-1.1 13.12-1.05-15.84 16-29.46 27.81-47.49 41.39-3.9 2.94-20.83 13.81-22.7 15.74l-3.41 2.29c-1.7-2.16-1.4-1.92-2.6-4.48l.83-.96c26.21-17.68 40.07-32.77 62.25-52.93"/>
        <path fill="#9b0311" fill-opacity=".294" d="M1578.64 1205.29c2.22-4.64 5.28-10.06 8.2-14.29 3.34-4.83 3.45-7.64 5.44-12.93 2.41 1.62 1.08 1.32 3.91 1.34-1.14 5.21.6 22.39 3.58 26.65 6.86-.46 12.77-10.01 18.78-11.75 3.31 3.98 6.92 8.15 10.09 12.2l-.83.96-1.51.63c-2.03-.76-2.47-1.1-4.02-2.62-8.53-2.16-14.71 1.41-23.07 4.6-1.02 5.18-.18 4.94-3.13 8.44l-1.88.19c-4.85-4.6-4.67-8.75-7.8-9.15l-.95 2.43c-1.27-1.5-4.88-4.62-6.81-6.7"/>
        <path fill="#f11812" fill-opacity=".925" d="M1721.03 1024.19c4.43.49 4.19.42 7.83 3.01l-3.07 4.86c-4.22 5.49-30.95 39.06-34.98 42.12-5.41-1.06-6.24-.56-11.82.71 1.49-1.88 3.33-2.74 4.67-4.48 10.17-13.2 20.82-28.17 32.41-40.03 3.04-3.1 2.34-1.42 4.96-6.19"/>
        <path fill="#9b0311" fill-opacity=".561" d="m1626.3 1208.1 1.51-.63c1.2 2.56.9 2.32 2.6 4.48-10.84 6.19-18.07 9.65-29.4 14.68 3.27 4.45 6.19 8.19 8.85 13.05-2.62-2.3-3.66-3.75-7.09-4.11-2.55 1.38-2.96 2.44-4.69 4.8-4.31 1.58-4.82.76-9.52-1.18-2.62.47-3.13.58-5.62 1.5.17-1.75.65-3.64 1.01-5.38-1.57-2.1-2.37-3.44-3.72-5.66 2.45-2.16 4.34-4.31 6.54-6.7 6.4-1.16 4.26 3.9 9.51 3.74 2.76-2.27 2.63-6.12 5.22-10.65 10.06-5.66 17.4-2.04 24.8-7.94"/>
        <path fill="#a20411" fill-opacity=".898" d="M1661.22 699.156c15.08 39.208 29.4 123.551 25.1 164.218-1.86-7.733-2.17-14.502-3.39-22.371l.17 2.561c-2.59-10.396 1.17-15.961-.03-24.905-1.04-7.657-2.03-12.421-2.66-20.546-.58 7.819.77 17.968.66 26.716l-.84.389c-.15-5.599.13-8.758-.53-14.461-.82-7.093-6.82-36.653-5.85-41.541 1.27 2.232 1.86 4.409 3.67 4.981 1.37-12.034-10.81-51.887-14.94-64.453l-.46.182-2.21 7.657c.04-7.625.14-10.946 1.31-18.427"/>
        <path fill="#be050c" fill-opacity=".776" d="M1568.62 1364.79c7.17-1.3 15.03-2.55 22.3-2.72 7.24 8.98-5.09 13.79-.4 21.5 2.35.66 3.6.95 6.01 1.36-8.37.5-11.4 1.18-18.28-3.52-7.25-4.96-14.77-7.96-23.38-9.89 4.87-2.57 8.69-4.46 13.75-6.73"/>
        <path fill="#c09cba" d="M1784.28 1200c4.41-2.03 4.84-4 7.19-8.23 2.55-.3 2.47-.1 4.88.94-2.3 3.23-5.89 6.65-5.81 10.2-8.39 13.56-42.49 53.6-55.45 62.59.03-1.63.04-2.92 1.21-4.25 17.38-19.86 32.83-39.65 47.98-61.25"/>
        <path fill="#f21714" fill-opacity=".839" d="M1752.57 1176.27c4.42.15 8.87-.33 12.37 2.14-2.67 1.79-5.09 3.49-7.95 4.99-5.51 3.86-13.78 8.65-20.06 10.94-7.11-5.95-19.19 4.95-26.17 9.33-1.3 2.83-1.37 1.53-.65 4.01-1.74.9-4.36 2.4-6.13 2.99-7.72-3.14-12.51-1.9-17.56 4.37-1.52-4.63-2.71-5.16-.1-9.22 3.43.21 11.42.93 14.41-.66 8.94-5.08 18.31-9.76 27.19-14.93 8.42-4.9 18.11-6.84 24.65-13.96"/>
        <path fill="#a20411" fill-opacity=".192" d="m1594.16 1360.99 6.43-1.22c8.33 4.25 9.7 14.11 6.31 22.22l-1.98 1.75 1.19 1.92-9.58-.73c-2.41-.41-3.66-.7-6.01-1.36-4.69-7.71 7.64-12.52.4-21.5z"/>
        <path fill="#250008" fill-opacity=".855" d="m1667.33 952.695 1.09 1.34c-9.99 14.041-23.47 27.25-31.36 43.289-1.66 3.386-6.8 9.066-7.15 9.946l2.61-.96-.23.07c8.38-7.829 36.29-55.224 46.19-59.497l1.64.883c-3.21 3.589-6.5 7.087-9.72 10.656-17.69 19.6-32.7 43.678-45.59 66.588l-4.04-3.57c10.27-20.65 31.38-52.193 46.56-68.745"/>
        <path fill="#a92a27" fill-opacity=".31" d="M1755.88 1023.39c1.98 2.22 4.59 5.77 3.6 8.76-5.25 15.83-7.77 25.22-8.03 42.01l-2.98 5.1c-2.46 1.09-1.24.86-3.78.42-3.57-2.68-3.75-2.77-5.9-6.58.26-5.11 5.66-7.29 6.92-11.26 1.35-3.29.58-17.21 2.51-19.27 7.12-7.59 11.72-4.69 7.66-19.18"/>
        <path fill="#be050c" fill-opacity=".922" d="M1554.87 1371.52c8.61 1.93 16.13 4.93 23.38 9.89 6.88 4.7 9.91 4.02 18.28 3.52l9.58.73c3.71.4 3.99.31 7.6 1.68-11.82 6.01-54.05-1.86-64.95-10.85z"/>
        <path fill="#a20411" fill-opacity=".533" d="M1595.61 1329.14c3.15 1.02 3.94.47 5.2 3.96 1.27 3.52 6.29 10.92 7.05 13.58-5.39 1.78-10.45 3.46-15.93 4.97l-1.71-.84-.56-1.1c-4.86-1.54-7.07-.2-11.07-3.33 8.27-4.12 12.11-9.87 17.02-17.24"/>
        <path fill="#f5d0cb" fill-opacity=".984" d="M1762.78 1124.27c.78 1.59 1.8 3.47 2.37 5.11-4.77 1.46-10.87 3.14-15.44 4.86-9.6 2.29-33.53 11.85-39.75 12.49 9.87-11.51 38.02-18.11 52.82-22.46"/>
        <path fill="#190108" fill-opacity=".945" d="m1615.48 1031.53 5.95-.06a2830 2830 0 0 1-31.28 61.08l-3.51-1.45c8.16-11.12 21.15-44.15 28.84-59.57"/>
        <path fill="#9b0311" fill-opacity=".459" d="M1599.21 1210.08c8.36-3.19 14.54-6.76 23.07-4.6 1.55 1.52 1.99 1.86 4.02 2.62-7.4 5.9-14.74 2.28-24.8 7.94-2.59 4.53-2.46 8.38-5.22 10.65-5.25.16-3.11-4.9-9.51-3.74.5-5.27.35-5.92-1.32-10.96l.95-2.43c3.13.4 2.95 4.55 7.8 9.15l1.88-.19c2.95-3.5 2.11-3.26 3.13-8.44"/>
        <path fill="#ebbec4" fill-opacity=".973" d="M1795.83 933.365c3.42-2.624 3.75-2.962 5.9-6.69.22 2.647.39 5.002.5 7.667-2.28 17.546-6.62 32.935-10.78 49.979-.1-2.913-.01-3.574-.75-6.447l-1.87.083 1.67-8.665c2.5-9.871 4.26-25.822 5.33-35.927"/>
        <path fill="#a92a27" fill-opacity=".384" d="m1602.61 1316.4 1.3 4.56c1.5-1.62 1.03-.96 1.88-3.02 1.56 10.17 7.32 16.46 6.92 25.72.08.28.16.57.24.86l-5.09 2.16c-.76-2.66-5.78-10.06-7.05-13.58-1.26-3.49-2.05-2.94-5.2-3.96 3.95-5.56 4.48-6.43 7-12.74"/>
        <path fill="#300106" fill-opacity=".925" d="M1423.41 771.464c2.93-3.139 1.22-2.067 5.31-3.352 6.23 2.487 4.65 8.051 10.98 8.802l2.93-1.667c7.17 1.978 18.68 19.352 20.17 25.62-9.44-8.9-17.74-16.283-28.4-23.646-4.4-2.753-6.22-3.724-10.99-5.757"/>
        <path fill="#e8c5cd" d="m1788.83 977.957 1.87-.083c.74 2.873.65 3.534.75 6.447-9.89 30.769-13.98 37.279-26.13 64.859-.17-4.12 1.6-7.43 3.3-11.33 8.8-20.15 14.36-38.776 20.21-59.893"/>
        <path fill="#a20411" fill-opacity=".11" d="m1611.84 1152.29 9.27-6.6c2.35 22.72-12.06 10.97-17.8 14.74-.77 2.98-.33 3.71-2.23 4.89-1.38-2.4-.52-5.3-.15-8.26l-.58-1.12-.84-3.24 2.03-1.91c4.04-.81 6.19.29 10.3 1.5"/>
        <path fill="#ebbec4" fill-opacity=".976" d="M1779.65 889.765c5.87-2.988 21.81-12.098 26.15-2.678.78 1.693.32 7.218.19 9.432-2-.209-4.9-.671-6.79-.471-.11-3.574.37-3.22-1.29-5.913-3.8-.915-8.22 1.889-13.56 3.032l-1.04.216z"/>
        <path fill="#ebbec4" fill-opacity=".984" d="M1647.55 680.787c3.1-.51 5.17-1.277 7.91.074 1.12 1.614 1.29 1.569 1.95 3.366-14.23 9.495-26.16 18.559-37.46 31.505-1.63 1.866-11.32 12.769-12.28 13.359l-.12-1.853c6.23-12.292 27.31-28.264 37.81-37.723.02-4.29-.12-5.125 2.19-8.728"/>
        <path fill="#f21714" fill-opacity=".984" d="M1422.38 777.596c3.34 6.823 2.05 13.961.54 21.105-17.14 1.288-9.1 5.129-17.38 9.519 2.52-5.442 4.34-7.596 3.39-13.105l1.35 1.258c2.82-2.118 9.54-14.65 12.1-18.777"/>
        <path fill="#3d0135" fill-opacity=".827" d="M1553.44 1361.84c6.25-4.77 10.9-2.48 14.64-6.22 3.6 1.79 9.27.03 13.56-.77 1.69 2.48 2.49 4.04 4.93 5.82 2.86.36 4.75.33 7.59.32l-3.24 1.08c-7.27.17-15.13 1.42-22.3 2.72-5.58-3.19-8.83-2.72-15.18-2.95"/>
        <path fill="#fefefc" fill-opacity=".973" d="M1780.7 1120.22c9.85-2.32 19.8-4.25 29.8-5.8l1.83 2.57c-2.63 4.64-10.25 4.95-15.41 5.97l-8.97 1.52-5.89 1.12-3.26-2.06c1.61-2.07.99-.95 1.9-3.32"/>
        <path fill="#f21714" fill-opacity=".792" d="m1824.29 1113.12 1.28.88c-.74 3.48-1.34 6.66-2.45 10.05-12.58 5.13-11.17-1.91-26.2-1.09 5.16-1.02 12.78-1.33 15.41-5.97l-1.83-2.57c5.14-1.36 7.43.97 13.79-1.3"/>
        <path fill="#7f0213" fill-opacity=".737" d="M1553.44 1361.84c6.35.23 9.6-.24 15.18 2.95-5.06 2.27-8.88 4.16-13.75 6.73l-6.11 4.97c-1.74-1.94-2.7-1.98-5.19-2.71l-.87-.25-.26-1.58c3.08-4.24 6.92-6.53 11-10.11"/>
        <path fill="#e8c5cd" fill-opacity=".875" d="M1626.25 692.687c3.61-4.319 26.85-23.372 32.63-23.288l1.19 1.522c.46 8.013.75 7.411-1.74 14.945l-.92-1.639c-.66-1.797-.83-1.752-1.95-3.366-2.74-1.351-4.81-.584-7.91-.074l.57-2.026c-5.51.014-16.19 13.8-21.87 13.926"/>
        <path fill="#f21714" fill-opacity=".933" d="M1686.42 1215.04c5.05-6.27 9.84-7.51 17.56-4.37-7.38 4.44-12.58 5.57-19.73 9.09-5.25-4.09-17.98-3.31-25.25-3.43l-.31-2.08 1.03-1.07c8 .14 17.45.48 25.16 2.68 1.71.49.66.34 2.91-.26z"/>
        <path fill="#f11812" fill-opacity=".945" d="M1625.68 1139.99c-3.91 1.59-5.19 4.54-9.35 1.75l-.11-2.18c3.95-8.15 17.3-19.17 24.93-24.06-3.11 4.96-13.78 15.56-13.98 19.71l1.07 1.87z"/>
        <path fill="#a92a27" fill-opacity=".855" d="M1575.53 1016.92c-1.62 9.92-2.56 19.38-.74 29.31-5.38-1.64-8.65-1.54-14.22-1.83 2.9-1.24 1.63-.66 3.94-3.63 1.3-5.98 7.91-17.93 11.02-23.85"/>
        <path fill="#f21714" fill-opacity=".941" d="M1787.95 1124.48c-2.22 1.87-5.5 3.3-7.22 5.82-2.59 3.79-6.79 3.66-10.97 4.13-8.88-.41-10.69-1.43-20.05-.19 4.57-1.72 10.67-3.4 15.44-4.86 3.85-.43 12.72-2.78 16.91-3.78z"/>
        <path fill="#7f0213" fill-opacity=".871" d="M1578.59 1346.38c4 3.13 6.21 1.79 11.07 3.33l.56 1.1 1.71.84c-3.16 1.02-7.14 2.43-10.29 3.2-4.29.8-9.96 2.56-13.56.77 3.05-5.32 5.16-6.55 10.51-9.24"/>
        <path fill="#e8c5cd" fill-opacity=".804" d="M1804.99 911.738c-.39 4.46-1.43 19.083-2.76 22.604-.11-2.665-.28-5.02-.5-7.667-2.15 3.728-2.48 4.066-5.9 6.69.56-6.773 1.02-13.553 1.98-20.279 2.55-.864 4.54-1.006 7.18-1.348"/>
        <path fill="#f21714" fill-opacity=".906" d="M1710.11 1207.68c-.72-2.48-.65-1.18.65-4.01 6.98-4.38 19.06-15.28 26.17-9.33-6.12 3.91-19.99 11.14-26.82 13.34"/>
        <path fill="#9b0311" fill-opacity=".961" d="M1423.41 771.464c4.77 2.033 6.59 3.004 10.99 5.757.86 4.819-.05 6.235-1.71 10.788 1.61 5.893 4.39 5.621 2.84 8.457-3.08-2.702-10.23-17.122-11.91-21.47l-.57-1.534z"/>
        <path fill="#83599c" fill-opacity=".988" d="m1824.29 1113.12 1.23-1.86 5.19-.98 1.42.98c.82 5.02-2.75 13.22-4.57 18.33l-5.84-.54-.39-1.8 1.79-3.2c1.11-3.39 1.71-6.57 2.45-10.05z"/>
        <path fill="#f21714" fill-opacity=".471" d="m1768.8 1136.08.92-.02c2.81.55 7.69 1.05 8.69 4.09-2.95 4.72-14.71 6.45-19.34 3.17l.35-2.29c2.13-2.77 5.96-3.68 9.38-4.95"/>
        <path fill="#e8c5cd" fill-opacity=".886" d="M1799.2 896.048c1.89-.2 4.79.262 6.79.471l-1 15.219c-2.64.342-4.63.484-7.18 1.348l.3-6.104-.07-4.384z"/>
        <path fill="#f11812" fill-opacity=".388" d="M1820.96 1128.99c-1.39 5.76-6.95 16.04-10.09 21.26-6.51-15.14 2-13 10.09-21.26"/>
        <path fill="#f5d0cb" fill-opacity=".369" d="M1762.78 1124.27c5.96-1.38 11.94-2.73 17.92-4.05-.91 2.37-.29 1.25-1.9 3.32l3.26 2.06c-4.19 1-13.06 3.35-16.91 3.78-.57-1.64-1.59-3.52-2.37-5.11"/>
        <path fill="#ebbec4" fill-opacity=".031" d="m1423.05 773.462.57 1.534-1.24 2.6c-2.56 4.127-9.28 16.659-12.1 18.777l-1.35-1.258c.99-7.166 9.11-16.452 14.12-21.653"/>
        <path fill="#f21714" fill-opacity=".757" d="M1752.57 1176.27c1.36-.55 17.92-5.22 19.5-5.51l1.98 1.63c-2.39 1.69-6.6 4.96-9.11 6.02-3.5-2.47-7.95-1.99-12.37-2.14"/>
        <path fill="#250008" fill-opacity=".82" d="m1615.48 1031.53 5.29-10.09 4.04 3.57-3.38 6.46z"/>
        <path fill="#f21714" fill-opacity=".984" d="M1786.41 926.689c-1.68-3.919-1.71-12.953 3.95-13.369l1.4 1.808c-1.58 3.476-3.6 8.305-5.35 11.561"/>
        <path fill="#f21714" fill-opacity=".976" d="M1795.88 906.844c-1.63-5.077-1.61-8.638-.8-13.774l1.95 1.15-.79-2.851c1.94 3.252 1.63 7.331 1.8 11.229l.07 4.384z"/>
        <path fill="#a92a27" fill-opacity=".733" d="m1788.83 977.957-2.74-.496c-2.13-3.084-1.75-1.455-1.44-4.986 2.72-3.433.97-2.199 5.85-3.183z"/>
        <path fill="#a92a27" fill-opacity=".647" d="M1607.29 1302.78c-.35 5.27-.54 9.95-1.5 15.16-.85 2.06-.38 1.4-1.88 3.02l-1.3-4.56c1.47-4.54 2.88-9.2 4.68-13.62"/>
        </g>
      </g>
      <g id="body">
        <g transform="translate(543.225 -31.225) scale(-0.25 0.25)">
        <path fill="url(#chk-grad19)" d="M1424.73 759.022c31.65 14.844 60.98 48.471 77.19 78.625 1.73 3.218 7.46 14.153 10.79 13.289 7.26-8.722 15.55-35.382 20.6-46.879 23.84-54.191 59.63-105.668 109.07-139.306 5.27-3.586 10.44-7.584 16.89-8.556 9.71-1.465 20.85 30.176 22.6 34.683a359.3 359.3 0 0 1 21.96 165.16c-2.03 21.489-6.72 45.055-11.41 66.166 51.48-33.334 67.76-39.299 125.37-59.176 2.22 12.162 2.2 27.302 2.3 39.919.53 67.832-20.38 133.183-57.25 189.763-5.15 7.91-13.94 18.48-19.99 25.84 19.9-5.74 40.03-10.58 60.36-14.54 14.64-2.76 29.05-4.53 43.82-7.52a346.08 346.08 0 0 1-143.33 221.53c-10.15 7.05-21 13.05-32.38 17.9 22.84.33 46.29 4.42 69.19 5.45 5.42.24 11.52.69 16.87 1.52-5.68 13.76-15.37 29.85-23.61 42.18-31.18 46.67-69.58 81.2-121.8 103.16-63.47 26.69-132.32 24.24-198.28 9.08-18.02 31.37-48.63 70.43-75.32 95 46.92 53.65 24 49.46-5.2 100.65-16.19 28.4-7.21 76.24-40.79 101.43-24.74 18.57-59.28 14.8-69.68-16.22-14.83 7.67-30.43 13.42-47.39 8.31a38.3 38.3 0 0 1-23.11-19.83c-19.2-38.65 31.56-74.29 62.91-85.02 1.31-.2 6.02-1.5 7.53-1.88 1.62 2.43 1.36 1.39 1.69 4.07l.69 3.67-.08 1.97-.45 2.01c-23.07 6.11-43.05 15.33-55.46 37.11a55 55 0 0 0-1.72 3.32c-9.55 18.57-6.89 36.71 14.39 44.48 5.46.69 6.72.77 12.18.23 6-1.02 8.43-2.07 13.77-4.65 6.43-3.73 11.57-5.32 12.44-13.07 1.96-5.56 5.3-20.1 4.78-25.81 1.1-3.22 1.51-3.91 3.07-6.81l1.48-2.85c4.24-5.25 16.11-14.94 21.58-19.58l1.79-.66c5.46-2.72 11.73-6.96 17.33-5.54 1.05 2.86.76 1.35-.14 4.83-10.18 6.09-22.3 21.2-28.03 31.69l.01.61c-1.27 2.39-2.6 4.76-3.67 7.24-.98 2.78-2.63 6.89-3.18 9.65-.98 5-1.4 7.33-1.61 12.39 1.01 7.06 1.59 10.18 5.12 16.67 2.96 4.26 3.42 5.17 7.26 8.48 3.06 1.56 4.69 2.69 8 3.52 15.89 4.57 31-4.23 40.15-16.95 7.51-9.1 11.29-20.01 13.36-31.46 1.68-4.27 1.81-6.98 2.39-11.45l.41-2.61c1.11-8.37 3.58-19.68 5.6-28.02 1.03-2.08 1.19-2.76 1.93-4.97 5.86-12.57 9.7-18.75 17.86-30 8.16-10.71 15.05-18.61 20.12-31.18-5.11-15.64-14.66-24.85-24.49-37.77-26.32 23.29-37.53 30-66.14 49.18-12.74 6.56-23.27 14.62-36.95 20.18l-1.12 1.02-6.52 3.2c-3.18 1.29-7.94 3.04-10.87 4.54-35.38 12.8-81.6 26.92-119.12 31.18-11.84 19.81-23.5 32.05-46.12 39.42l-3.45.69-1.51 2.24c-4.56 3.94-6.34 4.53-6.87 10.3-.9 7.57-2.15 11.96-4.16 19.37-2.29 3.95-4.68 8.25-7.1 12.07-4.63 4.65-6.89 7.25-12.45 10.73-6.76 4.2-9.814 5.73-17.878 7.52-7.307 1.06-13.237 1.7-20.603 2.28-61.964-1.28-101.889-64.88-127.424-112.92a150 150 0 0 0-26.073-8.86c-65.688-20.84-123.514-56.08-177.23-99.02-10.736-8.58-19.606-18.71-31.804-25.5-.081 3.18-.141 14.36-1.324 16.35-11.649 19.63-50.88-6.19-63.022-14.55-8.838-6.08-15.795-14.13-25.026-19.29l-.418 1.21c1.114 16.74-15.456 17.17-27.148 11.81-26.006-11.92-43.115-37.85-53.853-63.35-1.914 4.6-2.608 7.51-6.961 9.91-19.703 2.28-37.334-65.8-39.468-82.12-.005-3.7-.662-9.91-.944-13.8l-.793-.48c-.955 4.28-.685 10.87-3.28 13.68l.305 1.14c-2.157.96-1.488.68-3.932.94-1.123-.59-2.2-1.22-2.809-2.4-28.033-54.5-19.68-122.61 4.769-176.59 12.553-27.71 44.143-77.96 69.289-93.72 3.777-.63 2.179.14 5.013-2.32l1.29.92c-2.025 4.75-9.319 6.21-10.446 10.9l.89.95c-8.355 9.92-18.645 21.44-25.947 31.88-25.426 36.36-46.658 83.55-48.291 128.13-2.631 24.51-1.661 55.29 6.092 78.83 2.48-7.76 4.351-18.59 12.412-22.07l1.753 2.38c-2.301 31.1 16.355 83.47 29.591 110.97 2.123-12.36 2.788-22.31 2.283-34.9-.181-4.5-.597-13.9 2.082-17.38 3.863 3.67 7.942 27.93 10.304 35.56 2.245 7.3 5.031 14.43 8.333 21.33 13.709 28.42 29.73 45.04 59.004 55.39-1.409-8.42-6.091-30.9-2.672-37.48-.821-.01 50.648 56.52 92.068 61.04.326-10.96-.861-19.23-2.218-30.01-13.432-17.3-27.505-34.2-39.838-52.3a466.3 466.3 0 0 1-81.71-234.9c-1.026-15.06-.062-30.98-.358-46.17.512-7.7 2.595-14.51 3.61-22.15-.776-1.8-1.428-3.32-1.956-4.55l4.705 3.26 1.581-.75c.893-3.53 1.488-4.98 2.898-8.37 6.77 11.73 15.571 24.92 25.826 33.9 12.196 12.79 46.648 21.79 64.528 26.48l14.931 2.91c21.14 3.3 85.141 9.01 104.004 5.04l.976-1.54c3.556 1.01 8.213 1.64 11.809.75q10.54-.645 21.061-1.53c6.885-.71 13.763-1.48 20.632-2.34l7.328-1.06a835.3 835.3 0 0 0 171.056-43.33c112.733-40.39 216.323-106.06 290.483-202.815 2.77-3.616 4.57-8.528 7.04-12.651l.76.639c2.2-1.653 4.5-6.665 6.02-9.397-5.65-6.659-10.68-12.437-15.62-19.699l1.2-.154c.24-2.982-10.63-14.669-13.51-20.91-6.56-14.227-18.52-30.484-23.01-45.728-.28-.946.97-1.594 1.94-2.428l1.93.895c8.67 21.459 22.74 42.594 34.97 62.266.43.701 3.88 1.573 4.75 1.763 6.77 5.986 13.95 15.448 17.54 23.734 9.74 3.324 17.44 6.989 26.73 11.283 34.46-5.533 58.04-7.68 93.58-2.722-.56-8.774-1.12-18.312-1.6-27.017-3.03-54.705 17.74-168.071 65.7-200.177m78.93 596.488c3.82 5.94 6.46 9.54 4.98 16.94-3.27 16.43-27.41 33.73-40.75 42.08-6.77 4.19-13.63 8.23-20.59 12.11-3.82 17.89-20.23 44.17-29.01 61.25 32.76 6.97 45.8 9.09 79.81 7.82 9.14-3.47 15.19-4.69 24.65-6.75 1.15-1.83 2.79-2.93 4.88-3.36 72.27-14.92 132.64-53.37 183.35-105.98 7.86-8.16 15.15-17.31 23.34-25.57l-.7-1.37c-2.74-.61-18.51-5.39-18.79-5.38-20.97.73-47.3-7.07-67.36-1.23-16.87 4.91-31.43 10.8-46.88 13.7l-6.43 1.22c-2.84.01-4.73.04-7.59-.32-2.44-1.78-3.24-3.34-4.93-5.82 3.15-.77 7.13-2.18 10.29-3.2 5.48-1.51 10.54-3.19 15.93-4.97l5.09-2.16c49.75-17.83 84.64-42.05 122.14-79.02.03-1.63.04-2.92 1.21-4.25 17.38-19.86 32.83-39.65 47.98-61.25 1.23-3.25 3.53-7.05 5.25-10.15 1.47-1.37 15.72-30.08 18.26-34.5l3.08-5.1c3.14-5.22 8.7-15.5 10.09-21.26l.76.06 5.84.54c1.82-5.11 5.39-13.31 4.57-18.33l-1.42-.98-5.19.98-1.23 1.86c-6.36 2.27-8.65-.06-13.79 1.3-10 1.55-19.95 3.48-29.8 5.8-5.98 1.32-11.96 2.67-17.92 4.05-14.8 4.35-42.95 10.95-52.82 22.46l-5.95 5.8c-5.82-.05-7.38-.17-13.12 1.05 7.85-9.64 18.7-19.93 27.09-29.96 12.66-15.14 20.66-27.67 30.49-44.36l2.98-5.1c3.03-4.68 2.46-7.57 5.89-11.98 3.17-2.89 6.98-8.97 7.98-13-.17-4.12 1.6-7.43 3.3-11.33 8.8-20.15 14.36-38.776 20.21-59.893l1.87-.083c.74 2.873.65 3.534.75 6.447 4.16-17.044 8.5-32.433 10.78-49.979 1.33-3.521 2.37-18.144 2.76-22.604l1-15.219c.13-2.214.59-7.739-.19-9.432-4.34-9.42-20.28-.31-26.15 2.678-23.75 6.866-62.51 27.715-81.55 42.825a571 571 0 0 0-17.98 15.176l-1.64-.883c-9.9 4.273-37.81 51.668-46.19 59.497l.23-.07-2.61.96c.35-.88 5.49-6.56 7.15-9.946 7.89-16.039 21.37-29.248 31.36-43.289l-1.09-1.34c3.09-3.52 5.91-6.264 8-10.449a551 551 0 0 0 7.61-27.951c16.42-69.99 17.04-148.285-10.03-215.835-3.11-7.757-8.6-20.729-12.84-27.539l-1.19-1.522c-5.78-.084-29.02 18.969-32.63 23.288-77.98 64.971-136.75 225.299-136.53 325.513-.82 6.4-.62 13.31-.64 19.79 12.51 7.92 20.2 15.41 30.37 26.25 12.38-6 28.85-16.11 41.12-19.84 5.57.29 8.84.19 14.22 1.83 16.79 13.54 11.11 26.74 11.85 44.87l3.51 1.45-6.07 11.32c-3.51 6.86-5.15 10.93-7.84 18.18 23.22-9.85 28.28 13.16 23.27 30.65l.84 3.24c-1.94 3.14-6.23 17.45-8.07 22.13-1.99 5.29-2.1 8.1-5.44 12.93-2.92 4.23-5.98 9.65-8.2 14.29l-8.57 15.55c3.48 2.68 7.5 5.41 10.16 8.81 1.35 2.22 2.15 3.56 3.72 5.66-.36 1.74-.84 3.63-1.01 5.38-2.71 28.62-28.92 66.54-48.75 86.27-9.69 9.64-20.59 19.1-30.53 28.55m-47.74-338.7c3.98 3.24 20.17 11.92 25.27 15.04-.44-14.33-1.48-33.011-.83-46.98 1.69-35.872 10.5-79.881 25.38-112.628-9.76-26.59-25.16-49.571-42.94-71.375-1.49-6.268-13-23.642-20.17-25.62l-2.93 1.667c-6.33-.751-4.75-6.315-10.98-8.802-4.09 1.285-2.38.213-5.31 3.352l-.36 1.998c-5.01 5.201-13.13 14.487-14.12 21.653.95 5.509-.87 7.663-3.39 13.105-24.85 48.623-24.51 128.851-23.24 182.409 9.79 2.754 19.62 4.65 29.29 7.75 15.09 4.841 30.05 11.521 44.33 18.431M885.323 1735.3l-.61 1.61c-3.924-4.84-15.746-27.32-17.314-28.11-6.85 9.17 9.572 21.87 11.66 30.61l-.724.79c13.557 22.39 45.964 51.74 72.171 57.63 28.477 10.1 66.524-.5 70.844-34.66 7.59-24.33-14.36-74.24-23.342-97.63-1.438-3.74-4.29-11.98-7.503-14.33l-3.437.84-2.825-.04c-.074-8.01.814-10.82 5.836-16.82 4.379-7.15 27.271-19.21 35.671-23.43 7.48-18.39-10.21-38.74-25.43-47.29.38 4.59.82 9.25 1 13.84.65 4.93.59 8.67.63 13.6-22.259 17.18-35.194 28.08-39.933 58.06-5.454 34.52 19.307 55.66 34.647 83.5.472.85 1.902 2.15 2.61 2.83.43 2.81.719 4.3 1.436 7.13-1.271-.31-4.702-5.93-6.382-7.76-2.012-2.88-3.716-5.89-5.665-8.83-19.401-29.31-56.389-46.8-89.916-53.48-12.976-2.2-32.51-4.1-42.276 6.4 8.562 19.68 17.108 37.44 28.852 55.54"/>
        <path fill="#fefefc" d="M1234.9 988.421c10.28 3.236 19.68 6.449 28.98 12.019 36.98 22.14 83.58 71.71 104.39 109.33-3.62.4-11.77 1.08-15.05 1.7-31.34 3.26-63.18 3.06-94.63 2.78-74.23-.68-161.91-5.34-213.79 58.59a118.4 118.4 0 0 0-25.79 87.84c4.79 45.38 33.53 90.35 66.56 120.58 17.2 15.74 36.95 28.58 56.68 40.89a544 544 0 0 1-29.66 30.5l-.64-.29c-13.7 11.35-23.51 19.34-38.99 28.66-10.44 6.29-20.03 10.24-30.2 15.86-53.348-61.55-156.711-84.1-206.558-6.07-7.747 15.73-9.16 18.57-9.198 35.87-22.7 13.15-32.78 28.11-34.383 54.53 1.701 38.1 22.72 67.56 42.839 99.55 1.522 2.47 1.254 1.43 1.548 4.17-5.668 1.57-34.236-11.08-41.645-13.9-84.4-32.08-154.275-83.77-210.824-153.58a441.4 441.4 0 0 1-95.204-212.08c-4.916-29.73-7.33-58.65-4.167-88.73-.083-3.32-.725-3.18.595-5.11 2.439 2.26 9.135 8.9 11.014 10.37 54.036 42.21 157.372 44.23 221.25 39.64 148.009-10.66 329.473-85.09 439.013-184.02a439 439 0 0 0 41.98-43.8c9.53-11.57 19.16-24.89 28.91-36.012z"/>
        <path fill="#a08f96" d="M1234.9 988.421c10.28 3.236 19.68 6.449 28.98 12.019 36.98 22.14 83.58 71.71 104.39 109.33-3.62.4-11.77 1.08-15.05 1.7-31.34 3.26-63.18 3.06-94.63 2.78-74.23-.68-161.91-5.34-213.79 58.59a118.4 118.4 0 0 0-25.79 87.84c4.79 45.38 33.53 90.35 66.56 120.58 17.2 15.74 36.95 28.58 56.68 40.89a544 544 0 0 1-29.66 30.5l-.64-.29c-21.06-16.41-45.94-39.84-62.48-60.83a234.02 234.02 0 0 1-48.32-173.78c-105.84 51.05-212.304 75.16-329.842 71.85-27.615-.78-50.653-.14-78.398-5.17a269 269 0 0 1-37.144-9.86c-38.627-12.91-48.186-25.54-70.598-57.93-.083-3.32-.725-3.18.595-5.11 2.439 2.26 9.135 8.9 11.014 10.37 54.036 42.21 157.372 44.23 221.25 39.64 148.009-10.66 329.473-85.09 439.013-184.02a439 439 0 0 0 41.98-43.8c9.53-11.57 19.16-24.89 28.91-36.012z"/>
        <path fill="url(#chk-grad18)" d="m533.493 1310.8.614-1.7 1.526-.69c5.499 35.22 13.78 64.15 26.243 97.71 4.412 11.88 9.653 28.01 15.769 38.88 70.332 39.16 126.015 51.14 206.443 49.22 18.05-.43 34.606-2.47 52.114-3.41-7.747 15.73-9.16 18.57-9.198 35.87-22.7 13.15-32.78 28.11-34.383 54.53-1.013 3.17-.498 5.82-.347 9.26-33.802-3.39-62.819-7.5-95.195-18.47-12.651-4.28-38.96-16.96-50.938-18.8-13.159-14.5-26.62-28.94-38.415-44.59-44.702-59.29-68.165-124.09-74.233-197.81"/>
        <path fill="#a08f96" d="M646.141 1553.2c11.978 1.84 38.287 14.52 50.938 18.8 32.376 10.97 61.393 15.08 95.195 18.47-.151-3.44-.666-6.09.347-9.26 1.701 38.1 22.72 67.56 42.839 99.55-32.443-10.43-65.063-31.37-94.087-49.11-33.977-20.77-69.938-47.64-95.232-78.45"/>
        <path fill="#c7a8a1" d="M533.493 1310.8c-.548-2.28-.855-8.69.105-10.98 1.632 2.53 1.568 5.34 2.035 8.59l-1.526.69z"/>
        <path fill="#300106" d="M596.679 1362.73c41.696-33.1 28.286-36.47 84.364-35.73 2.84 52.59 12.269 85.14 28.371 135.58l-18.898 4.04c-7.069.8-17.596 2.26-24.462.97l-1.185-1.79c-11.101-23.82-20.724-57.72-24.469-83.28-11.526 8.71-22.331 17.14-35.295 23.72-3.748-12.98-7.753-29.97-8.426-43.51"/>
        <path fill="#797887" d="M641.763 1330.49c11.308-.11 23.823.35 35.218.54 2.876 35.92 8.185 66.37 18.878 101.04-8.833 3.6-27.265 5.87-37.391 7.38-1.17-5.61-4.723-15.52-6.32-22.37-3.154-13.5-5.872-26.7-8.81-40.22-10.906 8.65-23.7 16.58-35.458 24.22-3.028-12.86-5.759-22.96-7.926-36.13 16.136-10.96 28.384-25.46 41.809-34.46"/>
        <path fill="#5a3c3e" d="M695.859 1432.07c2.653 8.66 6.16 20.61 9.61 28.72-5.034.75-14.421 1.79-18.632 3.67l.377 1.25 3.302.91c-7.069.8-17.596 2.26-24.462.97l-1.185-1.79 1.168-1.04c.339-6.68-5.018-18.75-7.569-25.31 10.126-1.51 28.558-3.78 37.391-7.38"/>
        <path fill="#a08f96" d="M741.248 1423.18c20.873 2 29.689 25.25 9.827 30.9-20.047-2.31-31.502-26.95-9.827-30.9"/>
        <path fill="#cd6f07" fill-opacity=".886" d="M999.274 1736.3c4.456 5.19 7.646 16.1 4.606 22.45-2.44-7.17-6.513-15.9-9.552-23.08 1.68 1.83 5.111 7.45 6.382 7.76-.717-2.83-1.006-4.32-1.436-7.13"/>
        <path fill="#a08f96" d="M461.455 1154.58c2.018 6.73 8.587 30.17 13.037 34.14.528 1.23 1.18 2.75 1.956 4.55-1.015 7.64-3.098 14.45-3.61 22.15.296 15.19-.668 31.11.358 46.17a466.3 466.3 0 0 0 81.71 234.9c12.333 18.1 26.406 35 39.838 52.3 1.357 10.78 2.544 19.05 2.218 30.01-41.42-4.52-92.889-61.05-92.068-61.04-3.419 6.58 1.263 29.06 2.672 37.48-29.274-10.35-45.295-26.97-59.004-55.39a155 155 0 0 1-8.333-21.33c-2.362-7.63-6.441-31.89-10.304-35.56-2.679 3.48-2.263 12.88-2.082 17.38.505 12.59-.16 22.54-2.283 34.9-13.236-27.5-31.892-79.87-29.591-110.97l-1.753-2.38c-8.061 3.48-9.932 14.31-12.412 22.07-7.753-23.54-8.723-54.32-6.092-78.83 1.633-44.58 22.865-91.77 48.291-128.13 7.302-10.44 17.592-21.96 25.947-31.88 4.129-3.2 7.747-6.91 11.505-10.54"/>
        <path fill="#fefefc" d="M461.455 1154.58c2.018 6.73 8.587 30.17 13.037 34.14.528 1.23 1.18 2.75 1.956 4.55-1.015 7.64-3.098 14.45-3.61 22.15-7.837 35.72-10.005 58.39-12.939 95.36-1.39 5.54-1.296 9.44-1.338 15.08l-.8-2.97c-1.141.86-5.461 6.25-6.028 7.5-25.22 46-25.869 48.74-34.232 99.13-11.458-14.94-16.743-21.09-17.565-40.37l-.104-2.18-3.863-2.7-1.753-2.38c-8.061 3.48-9.932 14.31-12.412 22.07-7.753-23.54-8.723-54.32-6.092-78.83 1.633-44.58 22.865-91.77 48.291-128.13 7.302-10.44 17.592-21.96 25.947-31.88 4.129-3.2 7.747-6.91 11.505-10.54"/>
        <path fill="#afa5aa" d="M375.712 1325.13c2.53 13.74 9.415 45.79 18.163 56.19l.341.57c-8.061 3.48-9.932 14.31-12.412 22.07-7.753-23.54-8.723-54.32-6.092-78.83"/>
        <path fill="url(#chk-grad9)" d="M393.875 1381.32c1.454-24.97 7.95-46.76 17.477-69.79 1.108-2.67 4.706-12.2 6.496-13.66-.522 5.86-2.097 10.65-3.872 16.2-7.694 24.04-11.74 47.85-14.144 72.9l-3.863-2.7-1.753-2.38z"/>
        <path fill="#d8d5d9" d="M459.899 1310.78c-1.192 58.24-1.637 98.3 5.916 156.32-2.366-1.15-7.143-.16-9.806.25-1.091-.96-4.917-7.11-5.893-8.68-14.654-23.52-12.323-44.6-14.503-69.73 3.821-12.32 8.363-23.47 12.88-35.5 1.634-4.42 4.884-18.67 3.24-23.05.567-1.25 4.887-6.64 6.028-7.5l.8 2.97c.042-5.64-.052-9.54 1.338-15.08"/>
        <path fill="#250008" d="M435.613 1388.94c-2.787-6.32 6.397-32.11 12.88-35.5-4.517 12.03-9.059 23.18-12.88 35.5"/>
        <path fill="#fefefc" d="M456.009 1467.35c2.663-.41 7.44-1.4 9.806-.25l.386 14.31z"/>
        <path fill="#f11812" fill-opacity=".031" d="M681.041 1114.13c8.218.65 38.34-2.79 46.992-3.99a899.5 899.5 0 0 0 168.954-38.92c18.404-6.15 40.519-16.41 56.645-21.53l1.933-.6c2.943 3.08 1.641 2.15 7.049 2.55-7.093 4.55-33.616 14.31-9.822 23.19.462 2.54.987 6.01 2.04 8.32 1.091 2.39 9.938 11.7 9.584 13.43-1.439 7.04-16.242 18.9-15.564 26.64 9.742 6.55 38.167-11.07 48.502-13.64.725-1.58 3.746-8.29 4.706-9.36 3.46-3.86 10.35-2.84 11.03-8.32l1.51-.98c-3.45-.26-4.69-.56-6.7 2.43-1.71 2.53-6.84 4.78-9.616 6.21l-.804-.52c1.484-3.75 8.93-7.25 12.6-9.28 5.24.56 6.49.85 11.54-.42-10.81 17.53-18.99 25.85-35.402 38.24-8.965 5.74-15.915 9.75-25.182 14.79l-3.631 1.96c-3.319 1.67-10.909 5.23-13.698 7.09-28.689 12.86-52.895 22.73-83.128 32.48-7.873 2.62-14.971 4.67-22.981 6.87-11.42 3-23.142 6.26-34.631 8.87l-16.531 3.52-4.736.88-1.011.24c-2.022-.16-3.32.18-4.828-.98-18.892-14.53-40.777 2.61-61.511-.54-7.092-1.08-25.927 3.62-29.632 2.18-2.179-2.67-2.097-4.04-2.665-7.42l.108.2-1.428-.17c-3.74 4.5.71 9.92-2.157 15.92-1.732.6-3.173 1.09-4.322 1.49l-1.613-.56-.578-1.01-.23-1.19.594-3.76c11.535-9.76 1.665-13.04 5.825-18.34l2.828 1.68c3.475-.25 3.536-.03 6.507-2.09l-.49-1.38c-3.812-1.29-14.436-1.95-17.885-1.07l-.624 5.77-1.535.72c-4.815-21.09-4.674-55.4-.318-76.95 2.167-2.53 9.824-2.22 14.306-2.65"/>
        <path fill="#fefefc" d="M577.835 1114.46c9.567.42 88.759 1.67 88.207 1.48l.693.84c-4.356 21.55-4.497 55.86.318 76.95.618 5.84 2.742 12.9 4.78 18.47l.23 1.19.578 1.01c2.202 9.06 8.623 23.41 15.374 29.94 1.967 1.85 3.781 3.69 5.926 5.31l-.976 1.54c-18.863 3.97-82.864-1.74-104.004-5.04-1.344-4.38-2.977-7.12-5.091-11.14-5.171-11.82-7.036-18.23-9.641-30.89l-.329-.83c-5.784-26.48-6.76-40.94-2.11-67.58z"/>
        <path fill="#afa5aa" d="M574.229 1204.12c19.72 5.88 77.439 16.56 96.999 11.33l.835-2.06.578 1.01c2.202 9.06 8.623 23.41 15.374 29.94 1.967 1.85 3.781 3.69 5.926 5.31l-.976 1.54c-18.863 3.97-82.864-1.74-104.004-5.04-1.344-4.38-2.977-7.12-5.091-11.14-5.171-11.82-7.036-18.23-9.641-30.89"/>
        <path fill="url(#chk-grad6)" d="M444.096 952.112a1233 1233 0 0 0 22.81-4.887 476 476 0 0 0 4.533 49.221c2.315 13.994 5.813 27.624 8.021 40.784 4.521 17.67 7.758 27.33 25.386 35.16 8.054 16.3 14.261 17.1 22.189 28.76 39.326 10.77 107.238 10.95 148.32 9.71l-5.15 2.03c3.629 1.22 6.613.5 10.836 1.24-4.482.43-12.139.12-14.306 2.65l-.693-.84c.552.19-78.64-1.06-88.207-1.48-5.46.43-20.414-1.36-26.279-2-13.836-2.42-26.77-4.7-40.454-7.81-9.428-2.65-20.467-6.96-29.798-10.39-2.864 29.42.085 65.51 12.944 92.44 3.719 8.39 13.017 24.1 15.254 30.06-10.255-8.98-19.056-22.17-25.826-33.9-1.41 3.39-2.005 4.84-2.898 8.37l-1.581.75-4.705-3.26c-4.45-3.97-11.019-27.41-13.037-34.14-3.758 3.63-7.376 7.34-11.505 10.54l-.89-.95c1.127-4.69 8.421-6.15 10.446-10.9l-1.29-.92c-2.834 2.46-1.236 1.69-5.013 2.32 1.938-2.21 4.908-4.98 7.05-7.1-1.072-26.81-1.951-36.25 8.724-61.04-22.957-48.24-33.289-75.86-44.716-128.91 4.936-1.734 6.894-2.375 12.02-3.255z"/>
        <path fill="#fefefc" d="M444.096 952.112a1233 1233 0 0 0 22.81-4.887 476 476 0 0 0 4.533 49.221c2.315 13.994 5.813 27.624 8.021 40.784 4.521 17.67 7.758 27.33 25.386 35.16 8.054 16.3 14.261 17.1 22.189 28.76-12.203-2.58-34.687-8.19-45.364-13.91-9.029-19.09-18.795-39.05-25.791-58.94-8.363-23.77-13.898-49.338-19.599-73.935z"/>
        <path fill="#c19661" d="M444.096 952.112a1233 1233 0 0 0 22.81-4.887 476 476 0 0 0 4.533 49.221c2.315 13.994 5.813 27.624 8.021 40.784-25.506-14.27-25.484-63.883-35.364-85.118"/>
        <path fill="#fefefc" d="M483.676 1182.86c-9.749-22.35-14.92-40.43-13.262-65.02.474-7.03-.004-21.72 6.924-25.11l3.966 1.53c-2.864 29.42.085 65.51 12.944 92.44 3.719 8.39 13.017 24.1 15.254 30.06-10.255-8.98-19.056-22.17-25.826-33.9"/>
        <path fill="#f21714" fill-opacity=".757" d="M511.102 1104.65c13.684 3.11 26.618 5.39 40.454 7.81-6.558 5.07-18.966.05-22.777 7.24 5.221.95 8.576-.58 13.658 1.18 20.093 6.95 23.126-.55 20.888 27.11 3.085-6.89 2.107-7.29 8.465-12.28-4.65 26.64-3.674 41.1 2.11 67.58-16.613-1.88-46.752-8.25-62.691-14.94-1.394-1.3-1.91-1.56-3.898-2.58-26.55-13.7-18.148-42.7-17.553-66.34.107-4.23 18.048-12.79 21.344-14.78"/>
        <path fill="#7f0213" fill-opacity=".039" d="M1187.67 685.139c3.77 1.802 7.65 3.549 11.26 5.642 3.09 1.972 3.6 3.247 7.24 1.663l2.23-.657c4.02 5.737 6.02 9.242 10.51 14.808l-.78.376-3.97-1.391c2.59 5.634 16.29 17.926 14.28 25.408-.11.421-2.96 4.349-3.48 5.067l1.61.271c-1.42 2.465-4.32 7.632-6.38 9.274-14.86 11.883-41.56 18.776-59.53 24.508-2.42-6.559-5.27-13.812-7.28-20.425l1.06-1.717c1.16 2.171 1.45 2.514 3 4.445.82-4.925-2.85-18.924-1.24-22.924 4.66-11.567 17.77-25.08 23.55-36.723 2.88-5.812 2.81-5.595 7.92-7.625"/>
        <path fill="#f11812" fill-opacity=".09" d="M961.964 1049.26c8.974.49 20.484 3.19 29.248 1.72l.373-1.19-3.415-1.51c2.85-1.31 12.85-2.98 14.36.65-4.29 2.93-6.166-.86-9.021 2.88-3.11.61-4.64 1.57-7.338 3.1.477.17.955.33 1.432.5 8.478 4.93 7.419 9.39 19.277 7.8 1.91-.26 4.48-.56 5.95 1.11 2.25 2.54 4.27 5.48 6.63 7.97 0 .01 3.95 1.12 3.95 1.12.29 1.4.53 4.49.61 5.93l2.22 2.23-.4 1.94-4.22 5.83c-5.05 1.27-6.3.98-11.54.42-3.67 2.03-11.116 5.53-12.6 9.28l.804.52c2.776-1.43 7.906-3.68 9.616-6.21 2.01-2.99 3.25-2.69 6.7-2.43l-1.51.98c-.68 5.48-7.57 4.46-11.03 8.32-.96 1.07-3.981 7.78-4.706 9.36-10.335 2.57-38.76 20.19-48.502 13.64-.678-7.74 14.125-19.6 15.564-26.64.354-1.73-8.493-11.04-9.584-13.43-1.053-2.31-1.578-5.78-2.04-8.32-23.794-8.88 2.729-18.64 9.822-23.19-5.408-.4-4.106.53-7.049-2.55l1.433-.71c3.51 1.68 1.902 1.75 4.966.88"/>
        <path fill="url(#chk-grad5)" d="m1157.73 896.272 2.42-.158c.92-1.11 2.21-2.995 3.35-3.501 1.25 2.934.2 6.719-1.49 9.379-8.79 10.533-16.78 20.163-26.43 29.965l-4.94 4.918-5.86 5.25c-12.44 10.385-24.87 20.784-37.68 30.696-31.85 24.636-67.75 43.519-103.091 62.499-3.335 1.45-5.247 2.31-8.386 4.11-5.287 2.28-14.001 5.84-18.625 8.95l-1.433.71-1.933.6c-16.126 5.12-38.241 15.38-56.645 21.53a899.5 899.5 0 0 1-168.954 38.92c-8.652 1.2-38.774 4.64-46.992 3.99-4.223-.74-7.207-.02-10.836-1.24l5.15-2.03c9.668-1.86 27.884-2.79 38.59-3.94a792 792 0 0 0 67.48-10.21c117.467-23.58 249.395-79.73 339.075-161.167 13.72-12.465 25.07-25.353 37.23-39.271"/>
        <path fill="#a92a27" fill-opacity=".345" d="m988.796 1128.2 1.383-.21c-.33 1.74-.375 2.61-.124 4.36-5.161 10.01-16.573 7.62-21.146 11.49-10.737 9.11-13.879 16.88-29.56 20.18-2.657 2.64-2.575 2.38-3.621 5.95 1.233 2.25.4 1.34 2.855 2.42-5.127 3.11-10.691 6.96-15.852 9.83-15.506 8.5-32.336 13.95-48.112 21.74-2.159.74-4.988.74-7.161.76-6.827.08-13.277 4.57-19.721 7.09-8.732 3.42-24.939 5.35-32.022 11.15-21.694-1.7-30.723-.58-50.361 7.36-3.591 1.45-18.6.79-23.29 1.88-7.995 1.14-34.988 6.42-40.53 9.6-.465 2.67 2.164 6.97 4.216 8.6-3.596.89-8.253.26-11.809-.75-2.145-1.62-3.959-3.46-5.926-5.31 4.595-7.4 40.096-16.41 49.072-16.61l5.33 1.38c18.393 4.53 19.036-2.14 33.944-6.69 10.486-3.21 48.725-5.65 52.802-17.58.874-.74.505-.23.801-1.71l-3.723-1.76c1.18-1.57 2.972-1.51 5.419-2.15 6.373-1.05 7.445.95 12.297.61 1.434-1.75 1.49-1.97 2.007-4.11l.417-1.81c9.573-7.62 22.952 4.38 27.163-8.79 11.144-2.84 12.943-.45 20.965-8.98 4.477-.64 8.889-1.51 13.337-2.33 7.224-7.28 24.661-12.91 34.342-16.55 5.267-4.92 9.031-5.95 15.333-9.43l6.659-4.51c6.476-1.99 20.494-9.57 24.616-15.12"/>
        <path fill="#a20411" fill-opacity=".902" d="M494.248 1186.7c4.117-3.26 11.806.66 16.961 1.65 15.939 6.69 46.078 13.06 62.691 14.94l.329.83c2.605 12.66 4.47 19.07 9.641 30.89-3.24 4.47-4.798 5.61-9.84 8.23-17.88-4.69-52.332-13.69-64.528-26.48-2.237-5.96-11.535-21.67-15.254-30.06"/>
        <path fill="#c8277c" fill-opacity=".82" d="M1174.17 884.725c7.89 19.667 26.5 57.942 40.34 73.492 4.94 7.262 9.97 13.04 15.62 19.699-1.52 2.732-3.82 7.744-6.02 9.397l-.76-.639c-7.75-9.953-18.6-21.559-25.61-31.275-2.5-3.458-11.39-21.354-13.97-26.267-8.37-16.588-21.78-27.337-9.6-44.407"/>
        <path fill="#f11812" fill-opacity=".357" d="M674.254 1214.96c1.149-.4 2.59-.89 4.322-1.49 2.867-6-1.583-11.42 2.157-15.92l1.428.17-.108-.2c.568 3.38.486 4.75 2.665 7.42 3.705 1.44 22.54-3.26 29.632-2.18 20.734 3.15 42.619-13.99 61.511.54 1.508 1.16 2.806.82 4.828.98-2.65.45-17.062 2.61-18.318 3.33l-18.318 2.66c-13.682 1.75-25.571 2.9-39.351 3.17-9.206.69-21.949 3.23-30.448 1.52"/>
        <path fill="#a20411" fill-opacity=".459" d="M674.254 1214.96c8.499 1.71 21.242-.83 30.448-1.52.694 3.5 1.067 7.19 4.354 8.88 8.291 4.25 17.656 3.02 28.031 5.41-8.976.2-44.477 9.21-49.072 16.61-6.751-6.53-13.172-20.88-15.374-29.94z"/>
        <path fill="#a20411" fill-opacity=".388" d="M975.623 1039.43c3.139-1.8 5.051-2.66 8.386-4.11 1.221 2.17 1.138 2.03 3.102 3.58 12.32 1.86 26.439 3.57 36.289 12.29-3.11-.8-5.84-2.01-8.67-.93 2.39 4.32 7.57 6.75 9.74 14.16 1.99 6.79-.72 9.05 2.32 15.34l-.55 1.81-2.22-2.23c-.08-1.44-.32-4.53-.61-5.93 0 0-3.95-1.11-3.95-1.12-2.36-2.49-4.38-5.43-6.63-7.97-1.47-1.67-4.04-1.37-5.95-1.11-11.858 1.59-10.799-2.87-19.277-7.8-.477-.17-.955-.33-1.432-.5 2.698-1.53 4.228-2.49 7.338-3.1 2.855-3.74 4.731.05 9.021-2.88-1.51-3.63-11.51-1.96-14.36-.65l3.415 1.51-.373 1.19c-8.764 1.47-20.274-1.23-29.248-1.72 5.107-1.88 18.858-4.86 20.994-7.46-1.866-2.34-3.333-1.74-7.335-2.37"/>
        <path fill="#f21714" fill-opacity=".988" d="M481.304 1094.26c9.331 3.43 20.37 7.74 29.798 10.39-3.296 1.99-21.237 10.55-21.344 14.78-.595 23.64-8.997 52.64 17.553 66.34 1.988 1.02 2.504 1.28 3.898 2.58-5.155-.99-12.844-4.91-16.961-1.65-12.859-26.93-15.808-63.02-12.944-92.44"/>
        <path fill="#a20411" fill-opacity=".671" d="m744.735 1212.49.683 2.32c13.052 4.83 37.784-6.93 45.362-6.25l-8.85 7.45c-9.797 1.79-15.441 2.24-25.514 2.34 2.4.92 2.632.81 5.222 1.26l.893 1.36c-3.652 6.03-13.511 8.29-20.114 8.14l-5.33-1.38c-10.375-2.39-19.74-1.16-28.031-5.41-3.287-1.69-3.66-5.38-4.354-8.88 13.78-.27 25.669-1.42 39.351-3.17l-.218 1.58z"/>
        <path fill="#be050c" fill-opacity=".212" d="M705.75 1250.4c-2.052-1.63-4.681-5.93-4.216-8.6 5.542-3.18 32.535-8.46 40.53-9.6 4.69-1.09 19.699-.43 23.29-1.88 19.638-7.94 28.667-9.06 50.361-7.36l-.985.17c-3.338.52-15.412 1.28-16.86 1.63-7.328 1.78-33.854 8.35-38.929 11.3-1.601 6.63-.102 5.23-4.17 9.41l-7.328 1.06 1.878-2.93c-2.499-6.56-14.363-2.8-18.845-.16l2.105 1-3.351 1.27 2.297.81c-2.067 1.24-2.468 1.55-4.716 2.35q-10.521.885-21.061 1.53"/>
        <path fill="#a92a27" fill-opacity=".435" d="M804.884 1206.19c.249.05.498.11.748.16 9.534 5.05 12.272.68 22.519-1.32l1.012-.19c-4.077 11.93-42.316 14.37-52.802 17.58-14.908 4.55-15.551 11.22-33.944 6.69 6.603.15 16.462-2.11 20.114-8.14l-.893-1.36c-2.59-.45-2.822-.34-5.222-1.26 10.073-.1 15.717-.55 25.514-2.34l8.85-7.45 8.587-1.3z"/>
        <path fill="#be050c" fill-opacity=".071" d="M1028.68 1083.33c.02 2.52-.47 3.59 2.18 5.46 4.73 3.33 8.6 9.7 13.98 9.81l1.2 2.51c-4.05 7.17-28.18 17.19-35.96 21.24.47-.24-10.48 2.89-11.47 3.24 5.66-6.76 19.77-15.01 22.5-22 2.42-6.2 3.54-11.9 6.84-19.34z"/>
        <path fill="#f11812" fill-opacity=".729" d="M551.556 1112.46c5.865.64 20.819 2.43 26.279 2l-6.045 21.25c-6.358 4.99-5.38 5.39-8.465 12.28 2.238-27.66-.795-20.16-20.888-27.11-5.082-1.76-8.437-.23-13.658-1.18 3.811-7.19 16.219-2.17 22.777-7.24"/>
        <path fill="#9b0311" fill-opacity=".678" d="M860.579 1183.9c30.233-9.75 54.439-19.62 83.128-32.48l-1.519 5.84c-9.681 3.64-27.118 9.27-34.342 16.55-4.448.82-8.86 1.69-13.337 2.33-8.022 8.53-9.821 6.14-20.965 8.98-2.974.65-8.629 3.53-11.903 4.87.799-4.12 1.026-2.14-1.062-6.09"/>
        <path fill="#be050c" fill-opacity=".686" d="m1025.84 1083.51 2.11.74c-3.3 7.44-4.42 13.14-6.84 19.34-2.73 6.99-16.84 15.24-22.5 22-2.833.76-5.649 1.48-8.431 2.4l-1.383.21-2.578-.62c16.412-12.39 24.592-20.71 35.402-38.24z"/>
        <path fill="#a92a27" fill-opacity=".91" d="M802.967 1199.64c11.489-2.61 23.211-5.87 34.631-8.87-.444 6.17.651 6.15-5.938 8.45-2.447.64-4.239.58-5.419 2.15l3.723 1.76c-.296 1.48.073.97-.801 1.71l-1.012.19c-10.247 2-12.985 6.37-22.519 1.32-.25-.05-.499-.11-.748-.16 1.017-.42 2.039-.82 3.065-1.22-2.852-1.96-3.196-2.36-4.982-5.33"/>
        <path fill="#7f0213" fill-opacity=".882" d="M1153.53 953.658c6.25 8.111 6.98 19.336 5.57 29.513-4.23 30.649-27.84 53.469-50.68 72.099-1.47 1.2-3.74 2.48-5.39 3.35 5.08-5.5 12.12-11.59 17.8-16.69 20.21-18.12 50.42-60.079 30.84-87.644z"/>
        <path fill="#f11812" fill-opacity=".275" d="m667.053 1193.73 1.535-.72.624-5.77c3.449-.88 14.073-.22 17.885 1.07l.49 1.38c-2.971 2.06-3.032 1.84-6.507 2.09l-2.828-1.68c-4.16 5.3 5.71 8.58-5.825 18.34l-.594 3.76c-2.038-5.57-4.162-12.63-4.78-18.47"/>
        <path fill="#a92a27" fill-opacity=".847" d="M837.598 1190.77c8.01-2.2 15.108-4.25 22.981-6.87 2.088 3.95 1.861 1.97 1.062 6.09 3.274-1.34 8.929-4.22 11.903-4.87-4.211 13.17-17.59 1.17-27.163 8.79l-.417 1.81c-.517 2.14-.573 2.36-2.007 4.11-4.852.34-5.924-1.66-12.297-.61 6.589-2.3 5.494-2.28 5.938-8.45"/>
        <path fill="#a92a27" fill-opacity=".702" d="m780.689 1204.28 1.011-.24c6.685 2.85 8.857 3.2 16.132 2.67l1.535.55-8.587 1.3c-7.578-.68-32.31 11.08-45.362 6.25l-.683-2.32c4.34 1.61 12.927 3.48 16.509-.15l-.539-2.58 2.831-.91-1.165-1.24c1.256-.72 15.668-2.88 18.318-3.33"/>
        <path fill="#f11812" fill-opacity=".808" d="m1026.24 1081.57.55-1.81c-3.04-6.29-.33-8.55-2.32-15.34-2.17-7.41-7.35-9.84-9.74-14.16 2.83-1.08 5.56.13 8.67.93 8.45 10.9 7.3 17.07 5.45 30.91l-.17 1.23-.73.92-2.11-.74z"/>
        <path fill="#be050c" fill-opacity=".353" d="M726.811 1248.87c2.248-.8 2.649-1.11 4.716-2.35l-2.297-.81 3.351-1.27-2.105-1c4.482-2.64 16.346-6.4 18.845.16l-1.878 2.93c-6.869.86-13.747 1.63-20.632 2.34"/>
        <path fill="#9b0311" fill-opacity=".094" d="M1139.98 935.412c5.05 6.823 6.03 2.521 10.86 7.381 1.13 3.959.94 4.309.41 8.507-2.64-3.689-4.13-6.415-8.58-7.493-2.9 1.01-1.72.149-3.52 2.826l-3.19-.711-2.29-5.948z"/>
        <path fill="#a20411" fill-opacity=".498" d="M956.998 1048.38c4.624-3.11 13.338-6.67 18.625-8.95 4.002.63 5.469.03 7.335 2.37-2.136 2.6-15.887 5.58-20.994 7.46-3.064.87-1.456.8-4.966-.88"/>
        <path fill="#9b0311" fill-opacity=".553" d="m986.218 1127.58 2.578.62c-4.122 5.55-18.14 13.13-24.616 15.12l-3.144-.95c9.267-5.04 16.217-9.05 25.182-14.79"/>
        <path fill="#a92a27" fill-opacity=".792" d="m744.053 1210.27 18.318-2.66 1.165 1.24-2.831.91.539 2.58c-3.582 3.63-12.169 1.76-16.509.15l-.9-.64z"/>
        <path fill="#a92a27" fill-opacity=".961" d="m786.436 1203.16 16.531-3.52c1.786 2.97 2.13 3.37 4.982 5.33-1.026.4-2.048.8-3.065 1.22l-5.517 1.07-1.535-.55c-3.401-1.22-7.861-2.46-11.396-3.55"/>
        <path fill="#be050c" fill-opacity=".98" d="M583.87 1235.01c2.114 4.02 3.747 6.76 5.091 11.14l-14.931-2.91c5.042-2.62 6.6-3.76 9.84-8.23"/>
        <path fill="#9b0311" fill-opacity=".545" d="m957.405 1144.33.116 3.5c-6.302 3.48-10.066 4.51-15.333 9.43l1.519-5.84c2.789-1.86 10.379-5.42 13.698-7.09"/>
        <path fill="#7f0213" fill-opacity=".176" d="M1139.15 946.633c1.8-2.677.62-1.816 3.52-2.826 4.45 1.078 5.94 3.804 8.58 7.493l2.28 2.358-1.86.628c-5.08-3.674-7.01-4.78-12.52-7.653"/>
        <path fill="#c09cba" d="m385.886 1426.44-.305-1.14c2.595-2.81 2.325-9.4 3.28-13.68l.793.48c.282 3.89.939 10.1.944 13.8z"/>
        <path fill="#9b0311" fill-opacity=".012" d="m1124.78 942.125 5.86-5.25c.88.955 2.05 2.393 3.03 3.099l2.29 5.948c-4.46-2.453-6.16-2.915-11.18-3.797"/>
        <path fill="#9b0311" fill-opacity=".043" d="M1135.58 931.957c.84.646 3.83 2.851 4.4 3.455l-6.31 4.562c-.98-.706-2.15-2.144-3.03-3.099z"/>
        <path fill="#a92a27" fill-opacity=".863" d="m781.7 1204.04 4.736-.88c3.535 1.09 7.995 2.33 11.396 3.55-7.275.53-9.447.18-16.132-2.67"/>
        <path fill="#9b0311" fill-opacity=".4" d="m957.405 1144.33 3.631-1.96 3.144.95-6.659 4.51z"/>
        </g>
      </g>
      <g id="legs">
        <g transform="translate(543.225 -31.225) scale(-0.25 0.25)">
        <path fill="#8e686b" d="M1142.25 1422.15c26.01 14.06 68.44 29.96 97.84 34.61 56.72 13.23 102.13 7.89 157-8.42 13.62-5.35 26.25-10.22 39.45-16.51-10.16 19.14-20.01 38.46-30.64 57.34-51.23 91.03-136.04 158.26-236.27 188.85l-1.37.42c-16.29 6.67-56.1 15.11-73.64 17.14 9.73-37.77 8.08-64.37-.14-101.46-13.52-41.83-24.03-62.23-51.72-97.24 10.17-5.62 19.76-9.57 30.2-15.86 15.48-9.32 25.29-17.31 38.99-28.66l.64.29a544 544 0 0 0 29.66-30.5"/>
        <path fill="#afa5aa" d="m1111.95 1452.36.64.29c34.09 22.58 56.88 35.8 97.63 46.64-19.51 30.36-82.64 80.02-115.74 94.83-13.52-41.83-24.03-62.23-51.72-97.24 10.17-5.62 19.76-9.57 30.2-15.86 15.48-9.32 25.29-17.31 38.99-28.66"/>
        <path fill="#a08f96" d="M1397.09 1448.34c13.62-5.35 26.25-10.22 39.45-16.51-10.16 19.14-20.01 38.46-30.64 57.34-51.23 91.03-136.04 158.26-236.27 188.85l-1.37.42c.08-.7 1.04-3.2 1.16-3.28 12.31-8.12 35.6-20.65 47.51-27.53a275 275 0 0 0 38.64-26.47c38.74-31.66 107.04-106.09 127.97-151.34 5.08-4.72 11-14.97 13.55-21.48"/>
        <path fill="#795056" d="M1240.09 1456.76c56.72 13.23 102.13 7.89 157-8.42-2.55 6.51-8.47 16.76-13.55 21.48-8.72 5.11-19.13 11.74-28.24 15.68-38.37 16.6-103.82 27.65-144.48 13.63 2-4.36 25.55-37.08 29.27-42.37"/>
        <path fill="#4e4b66" d="M923.583 1451.5c29.332-3.81 87.217 21.13 104.637 44.53 13.28 11.85 29.71 36.55 36.22 52.99 21.99 33.11 31.49 90.93 23.77 130.08-6.39 32.41-23.9 50.66-55.49 59.86-4.13-28.37-22.22-61.07-31.91-88.25 14.06-12.83 34.48-25.1 35.11-45.22.43-13.39-6.32-28.83-14.64-39.09-12.75-12.6-32.719-19.22-50.385-16.2-9.661-28.19-38.43-44.75-67.99-42.06-16.931 1.54-24.714 9.59-34.49 22.15-5.894-2.52-11.932-4.95-17.868-7.4-4.348-.51-9.193-.61-12.871-2.68-1.059-3.11-.573-2.37 1.097-6.39 3.171-11.29 5.734-17.45 12.451-26.88 17.891-25.61 42.235-34.16 72.359-35.44"/>
        <path fill="#3a2a47" d="M1064.44 1549.02c21.99 33.11 31.49 90.93 23.77 130.08-6.39 32.41-23.9 50.66-55.49 59.86-4.13-28.37-22.22-61.07-31.91-88.25 14.06-12.83 34.48-25.1 35.11-45.22.43-13.39-6.32-28.83-14.64-39.09 1.35-.15 4.91-.61 5.94.08 19.19 12.83 33.51 66.91 41.72 85.53 11.23-29.07 4.28-52.2-.76-82.01-1.12-6.66-3.51-14.5-3.74-20.98"/>
        <path fill="#a4e1ed" d="M923.583 1451.5c29.332-3.81 87.217 21.13 104.637 44.53 4.65 10.14 17.1 20.34 22.92 31.73l-1.35-.53c-6.85-2.65-13.86-3.97-18.93 2.69-1.72-4.25-5.72-14.73-9.12-17.29-1.43-2.54-3.54-5.3-5.26-7.71l-1.71 1.23c-22.353-22.55-54.925-36.9-86.517-38.77-28.502-1.69-49.732 7.14-70.762 25.49-3.736-2.13-4.644-2.24-6.267-5.93 17.891-25.61 42.235-34.16 72.359-35.44"/>
        <path fill="#4c5b77" d="M923.583 1451.5c29.332-3.81 87.217 21.13 104.637 44.53 4.65 10.14 17.1 20.34 22.92 31.73l-1.35-.53c-6.85-2.65-13.86-3.97-18.93 2.69-1.72-4.25-5.72-14.73-9.12-17.29-1.43-2.54-3.54-5.3-5.26-7.71-28.718-33.26-52.105-43.45-92.897-53.42"/>
        <path fill="url(#chk-grad17)" d="M857.491 1492.87c21.03-18.35 42.26-27.18 70.762-25.49 31.592 1.87 64.164 16.22 86.517 38.77l1.71-1.23c1.72 2.41 3.83 5.17 5.26 7.71 3.4 2.56 7.4 13.04 9.12 17.29 1 2.75 1.34 5.27 1.91 8.15-44.419-40.78-126.506-82.04-176.956-29.19-3.169.52-7.251 1.82-10.442 2.74-2.336 2.41-4.215 3.73-4.741 6.96 1.982 2.09 5.72 2.15 9.11 2.8l.806 1.51c-4.348-.51-9.193-.61-12.871-2.68-1.059-3.11-.573-2.37 1.097-6.39 3.171-11.29 5.734-17.45 12.451-26.88 1.623 3.69 2.531 3.8 6.267 5.93"/>
        <path fill="#c6dee5" d="M851.224 1486.94c1.623 3.69 2.531 3.8 6.267 5.93-6.291 6.44-12.206 12.35-16.898 20.11l-1.82.84c3.171-11.29 5.734-17.45 12.451-26.88"/>
        <path fill="#78bee5" d="M1016.48 1504.92c1.72 2.41 3.83 5.17 5.26 7.71-2.56-1.69-4.8-4.26-6.97-6.48z"/>
        <path fill="#f5aa05" d="M870.95 1598.23c-3.46-15.09-3.374-36.17.99-51.19 8.639-29.72 30.875-32.88 57.296-24.85 9.387 3.42 13.029 5.83 20.538 12.4 5.867 7.33 8.221 11.11 11.903 20.04-8.51 5.01-11.662 7.36-18.057 15.25-10.74 16.84-14.42 26.64-17.819 46.39.652 10.85 1.522 18.25 4.791 28.66-.184-10.43-.737-18.43 1.829-28.69 3.884-25.92 23.883-61.12 54.849-56.88 3.783.52 9.478 3.42 13.05 5.11.38 4.59.82 9.25 1 13.84.65 4.93.59 8.67.63 13.6-22.259 17.18-35.194 28.08-39.933 58.06-5.454 34.52 19.307 55.66 34.647 83.5.472.85 1.902 2.15 2.61 2.83.43 2.81.719 4.3 1.436 7.13-1.271-.31-4.702-5.93-6.382-7.76-2.012-2.88-3.716-5.89-5.665-8.83-19.401-29.31-56.389-46.8-89.916-53.48-12.976-2.2-32.51-4.1-42.276 6.4l-1.454.97c-6.054-13.85-13.315-27.12-18.087-41.28 9.354-8.16 20.932-19.82 31.683-24.57 3.103 6.55 5.339 10.1 9.275 16.22-.661-9.11-4.981-22.98-6.938-32.87"/>
        <path fill="#fef21d" d="M870.95 1598.23c-3.46-15.09-3.374-36.17.99-51.19 8.639-29.72 30.875-32.88 57.296-24.85-6.071 3.4-14.029 6.69-19.411 10.16-14.963 9.66-25.973 25.06-30.912 42.12-1.795 6.2-3.888 20.47-7.963 23.76m61.471 18.01c3.884-25.92 23.883-61.12 54.849-56.88 3.783.52 9.478 3.42 13.05 5.11.38 4.59.82 9.25 1 13.84-2.073 1.25-1.01 1.21-2.969.84-16.831-3.14-25.022-.29-38.928 8.35-9.372 5.83-20.117 27.32-25.216 29.89z"/>
        <path fill="#b05403" d="M949.774 1534.59c5.867 7.33 8.221 11.11 11.903 20.04-8.51 5.01-11.662 7.36-18.057 15.25-2.827-1.75-7.785-7.78-12.769-11.36 4.719-11.88 7.225-18.73 18.923-23.93"/>
        <path fill="#a6580b" d="M930.851 1558.52c4.984 3.58 9.942 9.61 12.769 11.36-10.74 16.84-14.42 26.64-17.819 46.39-4.832-17.98-.308-40.45 5.05-57.75"/>
        <path fill="#a6580b" fill-opacity=".973" d="M856.471 1679.76c9.766-10.5 29.3-8.6 42.276-6.4l-1.658 1.54c3.614 4.33 17.107 11.15 21.788 16.47 16.845 19.13 55.885 48.96 62.46 73.74 1.033 3.9-5.542 8.93-7.554 10.86-9.392 8.98-30.487 3.16-37.841 6.59-15.568-3.52-41.082-35.32-50.619-47.26-11.744-18.1-20.29-35.86-28.852-55.54m143.849-115.29c15.22 8.55 32.91 28.9 25.43 47.29-8.4 4.22-31.292 16.28-35.671 23.43-5.022 6-5.91 8.81-5.836 16.82l2.825.04 3.437-.84c3.213 2.35 6.065 10.59 7.503 14.33 8.982 23.39 30.932 73.3 23.342 97.63-3.51.91-8.17 5.67-9.57 8.92-3.11 3.66-5.55 7.38-9.81 9.27l-2.364-.43c3.894-7.08 5.814-14.21 4.274-22.18 3.04-6.35-.15-17.26-4.606-22.45-.708-.68-2.138-1.98-2.61-2.83-15.34-27.84-40.101-48.98-34.647-83.5 4.739-29.98 17.674-40.88 39.933-58.06-.04-4.93.02-8.67-.63-13.6-.18-4.59-.62-9.25-1-13.84"/>
        <path fill="#fccd0c" d="M838.577 1533.01c4.746.77 6.917 1.53 11.503 3.08 3.814 1.52 8.511 3.03 11.597 5.58-6.179 28.47-4.794 46.33 6.936 73.21-10.751 4.75-22.329 16.41-31.683 24.57 4.772 14.16 12.033 27.43 18.087 41.28-3.693.49-4.685.75-8.476.25-5.023-9.17-14.953-25.38-18.828-34.01-24.297-35.37-44.922-95.31 10.864-113.96"/>
        <path fill="#fef21d" d="M838.577 1533.01c4.746.77 6.917 1.53 11.503 3.08 3.814 1.52 8.511 3.03 11.597 5.58-8.107 9.51-13.638 8.78-25.481 10.64-29.726 13.78-27.127 39.51-14.609 63.18 4.41 8.34 29.359 57.21 29.827 63.11-7.967 1.46-17.64-31.43-23.701-31.63-24.297-35.37-44.922-95.31 10.864-113.96"/>
        <path fill="#8b3f06" fill-opacity=".961" d="M898.747 1673.36c33.527 6.68 70.515 24.17 89.916 53.48 1.949 2.94 3.653 5.95 5.665 8.83 3.039 7.18 7.112 15.91 9.552 23.08 1.54 7.97-.38 15.1-4.274 22.18-18.579 15.84-39.167 10.55-59.732 3.48l-3.932-1.85c7.354-3.43 28.449 2.39 37.841-6.59 2.012-1.93 8.587-6.96 7.554-10.86-6.575-24.78-45.615-54.61-62.46-73.74-4.681-5.32-18.174-12.14-21.788-16.47z"/>
        <path fill="#df8206" fill-opacity=".961" d="m878.335 1740.2.724-.79c-2.088-8.74-18.51-21.44-11.66-30.61 1.568.79 13.39 23.27 17.314 28.11l.61-1.61c9.537 11.94 35.051 43.74 50.619 47.26l3.932 1.85c9.068 8.06 28.721 10.06 40.418 7.82.927.06 9.975-2.35 9.99-2.34 7.236 3.84 9.43 0 16.248-8.05l1.27.31c-1.81 14.07-20.575 15.37-32.033 16.62l2.734.27c-10.289.43-18.526-1.48-27.995-1.21-26.207-5.89-58.614-35.24-72.171-57.63"/>
        <path fill="#8b3f06" d="M990.079 1635.19c4.379-7.15 27.271-19.21 35.671-23.43-5.66 12.9-21.43 23.55-31.572 33.31-1.855 1.78-5.593 5.87-7.11 6.98l-2.825-.04c-.074-8.01.814-10.82 5.836-16.82"/>
        <path fill="#190108" d="M990.079 1635.19c-1.24 4.18-3.758 13.43-5.836 16.82-.074-8.01.814-10.82 5.836-16.82"/>
        <path fill="#f5aa05" d="M846.541 1680.98c3.791.5 4.783.24 8.476-.25l1.454-.97c8.562 19.68 17.108 37.44 28.852 55.54l-.61 1.61c-3.924-4.84-15.746-27.32-17.314-28.11-6.85 9.17 9.572 21.87 11.66 30.61l-.724.79c-11.926-14.72-23.43-41.25-31.794-59.22"/>
        <path fill="#cd6f07" fill-opacity=".961" d="M1011.78 1772.09c1.4-3.25 6.06-8.01 9.57-8.92-4.32 34.16-42.367 44.76-70.844 34.66 9.469-.27 17.706 1.64 27.995 1.21l-2.734-.27c11.458-1.25 30.223-2.55 32.033-16.62.13-2.91 2.6-7.22 3.98-10.06"/>
        <path fill="#b05403" fill-opacity=".914" d="m999.606 1780.93 2.364.43c4.26-1.89 6.7-5.61 9.81-9.27-1.38 2.84-3.85 7.15-3.98 10.06l-1.27-.31c-6.818 8.05-9.012 11.89-16.248 8.05-.015-.01-9.063 2.4-9.99 2.34-11.697 2.24-31.35.24-40.418-7.82 20.565 7.07 41.153 12.36 59.732-3.48"/>
        <path fill="#b05403" fill-opacity=".243" d="M1287.23 1644.6c2.24-2.84 21.79-11.88 26.04-12.75-.02 2.31-3.79 2.72-6.7 6.44l1.74 1.38 3.3-.44-1.59 3.19 1.15.01c7.09.13 12.98 4.76 15.26 11.57-.66 4.35-2.01 4.7-5.56 7.96-10.25 9.44 1.67 8.15-11.06 16.16-2.12 9.01 3.5 16.62 2.91 21.78-1.75 15.48-10.97 12.93-2.53 30.35l-.41 2.61-.92.54c-8-5-7.76-9.39-9.59-18.13-8.7-5.18-7.67-5.21-14.02-13l-.63 2.41c-1.7-1.03-3.92-2.37-6.65-4.02-2.59-3.85-.92-7.68-4.88-9.95-6.08-.45-9.02 1.24-14.24 4.44-1.49 1.4-2.94 2.81-4.52 4.11 3.04-12.11-6.89-10.24-16.02-18.97l-.92-.9c13.05-3.96 20-7.83 31.76-14.94 5.16-3.12 4.57-2.7 7.87-8.26.85-.11 2.08-.87 2.95-1.32 2.33-1.18 5.1-2.92 7.4-4.29 3.83-1.97 7.3-3.29 10.05-6.51l-.42-1.36c-3.94-.65-5.85.5-9.77 1.89"/>
        <path fill="#b05403" fill-opacity=".537" d="M1258.85 1695.15c3.52-.75 8.19-2.23 11.46-1.28 5.05 11.4 4.23 8.77 15.08 15.33 2.83 1.72 5.7 12.38 6.13 15.95 3.42 18.49-10.17 46.14-24.65 57.31l-1.55.25.37-3.24c-4.11-3.64-10.5-1.65-15.02.4-2.48 3.38-.66 4.27-2.44 7.17-.93-1.87-.91-2.27-1.12-4.29l-.19-1.97c-3.07-1.63-3.95-.68-8.3-.06-3.53-6.49-4.11-9.61-5.12-16.67 3.95-2.77 3.51-1.99 5.15-6-.49-3.44-1.22-3.84-3.54-6.39.55-2.76 2.2-6.87 3.18-9.65 4.27 1.52 4.95 2.31 8.84-.15l.37-2.15c-1.78-3.59-1.41-2.54-5.54-4.94l-.01-.61c12.68.68 6.39-4.41 11.02-10.21 6.79-8.49 12.4-11.05 17.01-21.48.9-3.48 1.19-1.97.14-4.83-5.6-1.42-11.87 2.82-17.33 5.54l.09-1.4 1.45-2.52c1.58-1.3 3.03-2.71 4.52-4.11"/>
        <path fill="#8b3f06" fill-opacity=".039" d="M1265.07 1647.49c28.61-19.18 39.82-25.89 66.14-49.18 9.83 12.92 19.38 22.13 24.49 37.77-5.07 12.57-11.96 20.47-20.12 31.18l-2.91-.58c-1.22-2.38-.88-2.55-.53-5.3l-1.31-1.19c-5.33 8.52-9.42 18.36-14.03 25.74l.92 11.33c-.74 2.21-.9 2.89-1.93 4.97.33-4.8-2.74-17.82-2.63-18.04 2.62-4.99 8.52-19.74 13.64-22.96 4.65-2.93 12.86-16.93 9.53-21.25l-5.78.45c-1.06-2.13-.46-1.08-1.84-3.13l-4.12-.53-1.48 2.43c.09 5.14 6.25 3.6 7.95 9.25l-1.41 2.29-1.53.03c-4.4-7.86-7.58-9.59-16.51-11.54l-3.3.44-1.74-1.38c2.91-3.72 6.68-4.13 6.7-6.44-4.25.87-23.8 9.91-26.04 12.75-1.56 1.09-3.64 2.67-5.24 3.55-5.87-.86-11.16-1.88-16.92-.66m75.31-7.67c.89-4.79 1.64-6.51-2.09-10.2-1.23 4.5-1.88 4.09-.81 7.89z"/>
        <path fill="#8b3f06" fill-opacity=".165" d="M1338.29 1629.62c3.73 3.69 2.98 5.41 2.09 10.2l-2.9-2.31c-1.07-3.8-.42-3.39.81-7.89"/>
        <path fill="#b05403" fill-opacity=".263" d="M1206.19 1703.14c10.87 10.59 17.09-.08 21.28 3.58-1.72 6.36 5.22 8.71-4.12 12.49 1.61 2.87 2.66 4.39 4.59 7.06-1.56 2.9-1.97 3.59-3.07 6.81-5.05 5.25-7.78 3.93-9.02 5.04-12.12 10.83-13.59 27.41-33.59 28.09 5.24 2.2 5.83-.17 8.24 2.75l-1.6 3.55c3.7 5.64 3.21-2.12 4.98 4.1-5.46.54-6.72.46-12.18-.23l7.27-.89.15-.54c-4.25.25-8.97-5.39-11.5-8.6-6.91-8.74-11.42-17.3-10.31-28.72 2.58-1.43 3.34-1.9 5.35-4.04l2.92-3.77c1.45 4.55 1.18 5.01 5.37 6.59 6.52-1.03 8.44-6.58 9.15-12.36l-1-.89-8.29.6c4.94-5 19.38-17.2 25.38-20.62"/>
        <path fill="#a6580b" fill-opacity=".514" d="M1258.85 1695.15c5.22-3.2 8.16-4.89 14.24-4.44 3.96 2.27 2.29 6.1 4.88 9.95 2.73 1.65 4.95 2.99 6.65 4.02l.63-2.41c6.35 7.79 5.32 7.82 14.02 13 1.83 8.74 1.59 13.13 9.59 18.13l.92-.54c-.58 4.47-.71 7.18-2.39 11.45-2.12 2.39-2.13 2.51-3.62 5.37l-2.26-1.06c-2.83 3.77-2.05 6.96-1.4 11.69l.18 1.26c-2.19 3.96-4.74 8.9-7.23 12.58l.97 1.62c-9.15 12.72-24.26 21.52-40.15 16.95 4.4-.87 4.85-.24 7.82-2.73.89-3.71 1.04-4.49 3.62-7.28l1.55-.25c14.48-11.17 28.07-38.82 24.65-57.31-.43-3.57-3.3-14.23-6.13-15.95-10.85-6.56-10.03-3.93-15.08-15.33-3.27-.95-7.94.53-11.46 1.28"/>
        <path fill="#8b3f06" fill-opacity=".365" d="M1193.88 1776.61c-1.77-6.22-1.28 1.54-4.98-4.1l1.6-3.55c-2.41-2.92-3-.55-8.24-2.75 20-.68 21.47-17.26 33.59-28.09 1.24-1.11 3.97.21 9.02-5.04.52 5.71-2.82 20.25-4.78 25.81l-.42-1.83-.55 1.32c-3.36-1.7-3.29-1.53-6.88-1.5-5.26 2.82-5.01 4.7-5.36 10.44-.33 2.42-.16 2.33.77 4.64-5.34 2.58-7.77 3.63-13.77 4.65"/>
        <path fill="#a6580b" fill-opacity=".125" d="M1311.61 1639.23c8.93 1.95 12.11 3.68 16.51 11.54l1.53-.03 1.41-2.29c-1.7-5.65-7.86-4.11-7.95-9.25l1.48-2.43 4.12.53c1.38 2.05.78 1 1.84 3.13l5.78-.45c3.33 4.32-4.88 18.32-9.53 21.25-5.12 3.22-11.02 17.97-13.64 22.96-.11.22 2.96 13.24 2.63 18.04-2.02 8.34-4.49 19.65-5.6 28.02-8.44-17.42.78-14.87 2.53-30.35.59-5.16-5.03-12.77-2.91-21.78 12.73-8.01.81-6.72 11.06-16.16 3.55-3.26 4.9-3.61 5.56-7.96-2.28-6.81-8.17-11.44-15.26-11.57l-1.15-.01z"/>
        <path fill="#8b3f06" fill-opacity=".106" d="M1265.07 1647.49c5.76-1.22 11.05-.2 16.92.66l.05.62c-3.7 1.77-4.19 1.29-6.25 4.16 1.81 2.12.74 1.2 4.18 1.94-.87.45-2.1 1.21-2.95 1.32l-3.43 1.82c-3.74-1.05-4.3-1.48-7.96-.07-1.83 2.59-2.13 2.73-1.54 6.08-2.08-2-1.46-.76-2.25-3.52-4.52-.12-21.02 13.88-26.18 13.84l-.92-1.06c-2.38-2.76-3.25-4.27-6.62-5.61 13.68-5.56 24.21-13.62 36.95-20.18"/>
        <path fill="#a6580b" fill-opacity=".098" d="M1225.42 1686.31c3.8-.48 4.39-.79 7.82 1.06 2.21 2.78 2.13 6.75 2.51 10.44l1.31-.87c4.71-3.08 11.13-6.47 15.34-.49l.48 5.33-.09 1.4-1.79.66c-.36-4.53.38-3.43-2.03-6.51-6.27-1.81-11.01 3.37-15.39 7.36-.82 5.41-5.52 15.73-4.16 18.73l-1.48 2.85c-1.93-2.67-2.98-4.19-4.59-7.06 9.34-3.78 2.4-6.13 4.12-12.49-4.19-3.66-10.41 7.01-21.28-3.58l3.36-1.64c7.66 4.16 24.38-1.47 21.37-11.01-3.4-2.1-1.52-1.56-5.98-1.03l.08-1.97z"/>
        <path fill="#8b3f06" fill-opacity=".384" d="m1273.59 1658.01 3.43-1.82c-3.3 5.56-2.71 5.14-7.87 8.26-11.76 7.11-18.71 10.98-31.76 14.94-3.86 2.34-7.94 4.97-11.97 6.92l-.4 1.18-.69-3.67c3.88-.47 3.74-.35 5.87-3.11.5-4.41-1.47-7.78-3.2-12.02l1.12-1.02c3.37 1.34 4.24 2.85 6.62 5.61l.92 1.06c5.16.04 21.66-13.96 26.18-13.84.79 2.76.17 1.52 2.25 3.52 4.76-2.08 5.48-2.66 9.5-6.01"/>
        <path fill="#b05403" fill-opacity=".067" d="m1167.31 1731.9 5.35 1.69c-2.01 2.14-2.77 2.61-5.35 4.04-1.11 11.42 3.4 19.98 10.31 28.72 2.53 3.21 7.25 8.85 11.5 8.6l-.15.54-7.27.89c-21.28-7.77-23.94-25.91-14.39-44.48"/>
        <path fill="#a6580b" fill-opacity=".012" d="M1233.58 1704.69c4.38-3.99 9.12-9.17 15.39-7.36 2.41 3.08 1.67 1.98 2.03 6.51-5.47 4.64-17.34 14.33-21.58 19.58-1.36-3 3.34-13.32 4.16-18.73"/>
        <path fill="#a6580b" fill-opacity=".173" d="m1237.39 1679.39.92.9c9.13 8.73 19.06 6.86 16.02 18.97l-1.45 2.52-.48-5.33c-4.21-5.98-10.63-2.59-15.34.49l-1.31.87c-.38-3.69-.3-7.66-2.51-10.44-3.43-1.85-4.02-1.54-7.82-1.06 4.03-1.95 8.11-4.58 11.97-6.92"/>
        <path fill="url(#chk-grad2)" d="M1248.23 1787.04c1.78-2.9-.04-3.79 2.44-7.17 4.52-2.05 10.91-4.04 15.02-.4l-.37 3.24c-2.58 2.79-2.73 3.57-3.62 7.28-2.97 2.49-3.42 1.86-7.82 2.73-3.31-.83-4.94-1.96-8-3.52z"/>
        <path fill="#b05403" fill-opacity=".557" d="M1241.95 1734.16c5.73-10.49 17.85-25.6 28.03-31.69-4.61 10.43-10.22 12.99-17.01 21.48-4.63 5.8 1.66 10.89-11.02 10.21"/>
        <path fill="#a6580b" fill-opacity=".02" d="M1224.94 1689.46c4.46-.53 2.58-1.07 5.98 1.03 3.01 9.54-13.71 15.17-21.37 11.01 9.73-2.41 5.37-3.16 14.15-8.39l1.23-.66-.44-.98z"/>
        <path fill="#b05403" fill-opacity=".349" d="m1180.81 1723.76 8.29-.6 1 .89c-.71 5.78-2.63 11.33-9.15 12.36-4.19-1.58-3.92-2.04-5.37-6.59z"/>
        <path fill="#8b3f06" fill-opacity=".541" d="m1220.48 1671.89 6.52-3.2c1.73 4.24 3.7 7.61 3.2 12.02-2.13 2.76-1.99 2.64-5.87 3.11-.33-2.68-.07-1.64-1.69-4.07-2.02-3.44-1.9-3.76-2.16-7.86"/>
        <path fill="#a6580b" fill-opacity=".4" d="m1294.03 1775.77-.97-1.62c2.49-3.68 5.04-8.62 7.23-12.58l-.18-1.26c-.65-4.73-1.43-7.92 1.4-11.69l2.26 1.06c1.49-2.86 1.5-2.98 3.62-5.37-2.07 11.45-5.85 22.36-13.36 31.46"/>
        <path fill="#e27659" fill-opacity=".078" d="M1220.48 1671.89c.26 4.1.14 4.42 2.16 7.86-1.51.38-6.22 1.68-7.53 1.88-2.59-.54-4.72-.61-6.51-2.43l1.01-2.77c2.93-1.5 7.69-3.25 10.87-4.54"/>
        <path fill="#8b3f06" fill-opacity=".204" d="m1219.12 1758.38.55-1.32.42 1.83c-.87 7.75-6.01 9.34-12.44 13.07-.93-2.31-1.1-2.22-.77-4.64 3.31-1.36 9.18-6.49 12.24-8.94"/>
        <path fill="#8b3f06" fill-opacity=".557" d="M1287.23 1644.6c3.92-1.39 5.83-2.54 9.77-1.89l.42 1.36c-2.75 3.22-6.22 4.54-10.05 6.51-1.53-.82-3.61-1.3-5.33-1.81l-.05-.62c1.6-.88 3.68-2.46 5.24-3.55"/>
        <path fill="#8b3f06" fill-opacity=".31" d="M1206.88 1767.32c.35-5.74.1-7.62 5.36-10.44 3.59-.03 3.52-.2 6.88 1.5-3.06 2.45-8.93 7.58-12.24 8.94"/>
        <path fill="#b05403" fill-opacity=".467" d="M1241.96 1734.77c4.13 2.4 3.76 1.35 5.54 4.94l-.37 2.15c-3.89 2.46-4.57 1.67-8.84.15 1.07-2.48 2.4-4.85 3.67-7.24"/>
        <path fill="#a6580b" fill-opacity=".486" d="M1238.62 1780.72c4.35-.62 5.23-1.57 8.3.06l.19 1.97c.21 2.02.19 2.42 1.12 4.29l-2.35 2.16c-3.84-3.31-4.3-4.22-7.26-8.48"/>
        <path fill="#8b3f06" fill-opacity=".659" d="M1279.97 1654.87c-3.44-.74-2.37.18-4.18-1.94 2.06-2.87 2.55-2.39 6.25-4.16 1.72.51 3.8.99 5.33 1.81-2.3 1.37-5.07 3.11-7.4 4.29"/>
        <path fill="#b05403" fill-opacity=".443" d="M1235.11 1751.66c2.32 2.55 3.05 2.95 3.54 6.39-1.64 4.01-1.2 3.23-5.15 6 .21-5.06.63-7.39 1.61-12.39"/>
        <path fill="#8b3f06" fill-opacity=".537" d="M1264.09 1664.02c-.59-3.35-.29-3.49 1.54-6.08 3.66-1.41 4.22-.98 7.96.07-4.02 3.35-4.74 3.93-9.5 6.01"/>
        </g>
      </g>
      <g id="wing">
        <g transform="translate(543.225 -31.225) scale(-0.25 0.25)">
        <path fill="#fefefc" d="M1234.9 988.421c10.28 3.236 19.68 6.449 28.98 12.019 36.98 22.14 83.58 71.71 104.39 109.33-3.62.4-11.77 1.08-15.05 1.7-31.78-45.39-71.23-96.07-125.29-113.762z"/>
        <path fill="#fefefc" d="M1565.33 1055.42c3.86 1.03 9.39 2.19 10.8 6.33 4.22 12.45-.78 35.18-5.03 46.89-16.95 46.75-61.58 62.87-102.94 82.65-9.41 4.5-41.8 17.84-51.34 19.06-7.87 3.4-15.2 6.49-23.22 9.53l1.94 1.58c4.39-1.71 9.39-3.31 13.89-4.85 17.59-6.88 35.63-12.95 53.05-20.03 34.5-14.03 66.76-33.4 98.05-53.46 7.71-4.94 18.71-16.08 27.79-13.89 2.36 1.6 4.27 3.53 4.33 6.61.55 27.3-20.04 65.44-35.67 85.98-18.19 23.91-32.86 33.14-57.2 46.77l.23 2.49c10.69-5.81 59.22-33.76 68.63-34.9 9.51 3.46-2.08 29.22-5.5 35.74-21.75 41.44-61.36 79.61-104.02 98.86-9 3.94-37.97 7.87-48 9.23l1.05 2.73c24.88-2.67 51.43-10.81 76.38-14.38 3.49-.51 8-.74 10.86 1.55l-.01 2.51c-20.74 41.03-127.48 76.61-172.14 80.21-25.57 2.05-53.14-.21-78.56-5.46-71.81-14.82-148.36-47.83-190.28-110.82-22.18-34.25-37.4-74.12-28.59-115.48 28.38-116.15 189.05-94.05 277.43-95.85 37.49-.72 74.81-5.1 111.45-13.08 31.02-6.98 61.13-16.7 90.37-29.23 15.63-6.7 40.45-24.34 56.25-27.29"/>
        <path fill="#a08f96" d="M1029.83 1220.87c10.76 132.32 169.72 192.87 284.9 172.03 4.73-.85 30.17-6.36 31.03-11.58 26.59 2.74 39.37 3.68 66.41 1.42 24.88-2.67 51.43-10.81 76.38-14.38 3.49-.51 8-.74 10.86 1.55l-.01 2.51c-20.74 41.03-127.48 76.61-172.14 80.21-25.57 2.05-53.14-.21-78.56-5.46-71.81-14.82-148.36-47.83-190.28-110.82-22.18-34.25-37.4-74.12-28.59-115.48"/>
        <path fill="#a08f96" d="M1500.01 1271.08c10.69-5.81 59.22-33.76 68.63-34.9 9.51 3.46-2.08 29.22-5.5 35.74-21.75 41.44-61.36 79.61-104.02 98.86-9 3.94-37.97 7.87-48 9.23-36.75 3.38-73.8-.66-108.96-11.87-7.59-2.42-19.21-6.44-25.28-11.46 3.05.12 6.1.3 9.14.54 85.33 6.56 152.5-8.45 218.35-64.8-38.8 15.03-71.1 15.46-110.81 6.71 38.17-.52 72.64-11.12 106.45-28.05"/>
        <path fill="#a08f96" d="M1409.43 1216.61c17.59-6.88 35.63-12.95 53.05-20.03 34.5-14.03 66.76-33.4 98.05-53.46 7.71-4.94 18.71-16.08 27.79-13.89 2.36 1.6 4.27 3.53 4.33 6.61.55 27.3-20.04 65.44-35.67 85.98-18.19 23.91-32.86 33.14-57.2 46.77l.23 2.49c-33.81 16.93-68.28 27.53-106.45 28.05-24.75-.98-36.04-1.67-60.03-7.92 5.65-.17 11.42.64 17.58.49 84.6-8.14 171.93-51.76 211.97-129.72-29.23 18.02-121.25 60.48-153.65 54.63"/>
        <path fill="#190108" d="m1499.78 1268.59.23 2.49c-33.81 16.93-68.28 27.53-106.45 28.05-24.75-.98-36.04-1.67-60.03-7.92 5.65-.17 11.42.64 17.58.49.65.29 1.83.84 2.43.97 50.75 10.78 100.54-2.13 146.24-24.08"/>
        <path fill="#a08f96" d="M1565.33 1055.42c3.86 1.03 9.39 2.19 10.8 6.33 4.22 12.45-.78 35.18-5.03 46.89-16.95 46.75-61.58 62.87-102.94 82.65-9.41 4.5-41.8 17.84-51.34 19.06 5.52-4.59 17.6-9.5 24.57-13.69 43.11-25.88 87.5-61.72 111.71-106.6 5.83-10.8 9.03-23.12 12.23-34.64"/>
        <path fill="#190108" d="M1345.76 1381.32c-26.49-2.8-85.11-24.67-108.64-38.51 8.55 1.41 27.57 10.6 39.76 13.87 6.07 5.02 17.69 9.04 25.28 11.46a275.6 275.6 0 0 0 108.96 11.87l1.05 2.73c-27.04 2.26-39.82 1.32-66.41-1.42"/>
        <path fill="#3d393a" d="m1393.6 1219.88 1.94 1.58c-7.28 2.59-18.9 6.85-26.46 7.76 7.22-3.44 16.84-6.59 24.52-9.34"/>
        <path fill="#afa5aa" d="M1278.29 996.678c59.03-6.004 112.26.012 165.59 27.872 19.19 8.75 50.69 30.17 64.69 44.81-30.66 17.84-90.08 32.78-125.59 38.56-7.71-10.02-15.41-22.37-23.2-32.86-14.99-20.17-28.92-34.25-47.36-51.1-11.73-9.85-21.83-18.23-34.13-27.282"/>
        <path fill="#fefefc" d="M1278.29 996.678c59.03-6.004 112.26.012 165.59 27.872-3.97 1.86-25.09-1.82-30.89-2.9-35.51-6.65-65.12-3.49-100.57 2.31-11.73-9.85-21.83-18.23-34.13-27.282"/>
        <path fill="#9b0311" fill-opacity=".012" d="M1162.01 901.992c5.27 1.555 4.13.435 7.02 5.344 3.87 6.556 8.18 17.607 14.74 21.796 2.58 4.913 11.47 22.809 13.97 26.267 7.01 9.716 17.86 21.322 25.61 31.275-2.47 4.123-4.27 9.035-7.04 12.651-74.16 96.755-177.75 162.425-290.483 202.815a835.3 835.3 0 0 1-171.056 43.33c4.068-4.18 2.569-2.78 4.17-9.41 5.075-2.95 31.601-9.52 38.929-11.3 1.448-.35 13.522-1.11 16.86-1.63l.985-.17c7.083-5.8 23.29-7.73 32.022-11.15 6.444-2.52 12.894-7.01 19.721-7.09 2.173-.02 5.002-.02 7.161-.76 15.776-7.79 32.606-13.24 48.112-21.74 5.161-2.87 10.725-6.72 15.852-9.83-2.455-1.08-1.622-.17-2.855-2.42 1.046-3.57.964-3.31 3.621-5.95 15.681-3.3 18.823-11.07 29.56-20.18 4.573-3.87 15.985-1.48 21.146-11.49-.251-1.75-.206-2.62.124-4.36 2.782-.92 5.598-1.64 8.431-2.4.99-.35 11.94-3.48 11.47-3.24 7.78-4.05 31.91-14.07 35.96-21.24l-1.2-2.51c25.01-14.58 36.38-25.47 58.19-39.98 1.65-.87 3.92-2.15 5.39-3.35 22.84-18.63 46.45-41.45 50.68-72.099 1.41-10.177.68-21.402-5.57-29.513l-2.28-2.358c.53-4.198.72-4.548-.41-8.507-4.83-4.86-5.81-.558-10.86-7.381-.57-.604-3.56-2.809-4.4-3.455 9.65-9.802 17.64-19.432 26.43-29.965"/>
        </g>
      </g>
      <g id="head">
        <g transform="translate(543.225 -31.225) scale(-0.25 0.25)">
        <path fill="#f7da93" d="M580.967 400.769c5.507-.802 12.044 2.789 16.905 5.379 13.928 9.353 18.043 28.458 20.279 44.032l1.62.681c-.092-4.507-.947-5.019 1.201-7.624l4.287.105c-1.252 6.423-1.257 8.534-1.317 15.002l-.998 7.961c.117 11.894-1.286 40.376-3.953 52.003-.69 2.691-1.301 4.227-.99 7.012 9.747-.92 32.621-6.469 39.224-4.965 1.98 1.767 1.771 1.866 2.626 4.447a396 396 0 0 0 7.634 15.332c1.833 18.578 25.284 38.893 42.314 44.242 5.219-.602 11.336 1.696 15.51-.916l-3.561-.911 2.005-1.037 4.723.79c15.93-1.47 30.636 2.118 46.331 2.91 7.183.363 24-3.679 29.778-2.125 42.258-6.243 93.679-21.694 116.792-60.801 68.941 30.636 122.663 65.15 168.873 126.295 7.41 9.801 20.62 27.413 24.95 38.576-1.64 4.288-1 3.24.33 8.655 18.84 49.524 33.58 96.7 41.02 149.404 1.16 8.214 4.93 36.072 7.69 41.752-2.16 3.004-4.57 6.186-6.51 9.304-12.16 13.918-23.51 26.806-37.23 39.271-89.68 81.437-221.608 137.587-339.075 161.167a792 792 0 0 1-67.48 10.21c-10.706 1.15-28.922 2.08-38.59 3.94-41.082 1.24-108.994 1.06-148.32-9.71-7.928-11.66-14.135-12.46-22.189-28.76-17.628-7.83-20.865-17.49-25.386-35.16-2.208-13.16-5.706-26.79-8.021-40.784 4.087.346 4.747-.273 8.667-2.005-.812-10.79-3.894-39.852-2.402-49.499a325 325 0 0 0 16.982-3.114c2.593 22.397 3.341 43.233 6.935 65.672 1.671 10.44 9.361 32.82 9.962 39.74 9.846-1.16 21.928-9.15 30.486-14.38 38.963-23.81 73.1-52.598 102.011-88.06 4.976-7.644 23.931-36.439 30.489-39.878 2.209-1.159 3.769-2.054 5.606-3.738l-.316-1.998 1.542-1.774c-.56-11.884-.318-22.404 1.253-34.172-4.753-.116-9.814-.462-14.591-.7-14.647 26.113-64.772 42.65-93.515 42.52 13.396-4.658 32.621-18.272 40.177-30.827 1.86-16.144-9.29-56.039-17.342-70.91-3.56-6.574-8.59-13.235-14.277-18.286l-.053-1.724 3.839-1.316-3.825-1.326c-14.518-7.124-32.561-6.644-48.35-6.466-43.223 4.293-70.382 15.049-105.096 42.067l-3.432-1.527c-1.818-2.473-1.571-2.427-1.693-5.56l7.792-7.159c-4.284-12.14-.438-27.338-2.369-35.137l-1.057.814c-.196 2.465-.767 3.126-2.127 5.172 1.38-41.173 21.3-101.711 38.227-139.058 3.681-7.116 6.823-13.007 9.724-20.458l1.398-3.757c-12.856-5.845-19.206-20.068-23.777-32.618-2.729-3.307-2.795-5.081-3.901-9.382-.236-2.177-.675-3.429-1.242-5.525 8.765-17.566 18.045 1.452 33.671.755 23.105-1.029 44.493-14.225 60.306-30.242 26.033-26.37 41.889-54.363 42.059-91.829-.833-1.193-.516-.518-.851-1.799-6.127-23.435-9.944-29.254-33.876-30.856 8.742-3.64 17.533-5.626 25.604.462.492-2.222.559-2.311 1.35-4.42 2.205-.979 3.091-1.405 4.836-3.065z"/>
        <path fill="#fefefc" d="M804.585 583.087c42.258-6.243 93.679-21.694 116.792-60.801 68.941 30.636 122.663 65.15 168.873 126.295 7.41 9.801 20.62 27.413 24.95 38.576-1.64 4.288-1 3.24.33 8.655 18.84 49.524 33.58 96.7 41.02 149.404 1.16 8.214 4.93 36.072 7.69 41.752-2.16 3.004-4.57 6.186-6.51 9.304-12.16 13.918-23.51 26.806-37.23 39.271-89.68 81.437-221.608 137.587-339.075 161.167a792 792 0 0 1-67.48 10.21c-10.706 1.15-28.922 2.08-38.59 3.94-41.082 1.24-108.994 1.06-148.32-9.71-7.928-11.66-14.135-12.46-22.189-28.76-17.628-7.83-20.865-17.49-25.386-35.16-2.208-13.16-5.706-26.79-8.021-40.784 4.087.346 4.747-.273 8.667-2.005-.812-10.79-3.894-39.852-2.402-49.499a325 325 0 0 0 16.982-3.114c2.593 22.397 3.341 43.233 6.935 65.672 1.671 10.44 9.361 32.82 9.962 39.74 9.846-1.16 21.928-9.15 30.486-14.38 38.963-23.81 73.1-52.598 102.011-88.06 4.976-7.644 23.931-36.439 30.489-39.878 2.209-1.159 3.769-2.054 5.606-3.738l-.316-1.998 1.542-1.774c-.56-11.884-.318-22.404 1.253-34.172-4.753-.116-9.814-.462-14.591-.7-14.647 26.113-64.772 42.65-93.515 42.52 13.396-4.658 32.621-18.272 40.177-30.827 1.86-16.144-9.29-56.039-17.342-70.91-3.56-6.574-8.59-13.235-14.277-18.286l-.053-1.724 3.839-1.316-3.825-1.326c-14.518-7.124-32.561-6.644-48.35-6.466 3.75-3.236 3.91-3.638 9.176-2.182 10.748 2.972 22.25-5.115 33.069-3.277 7.809 1.358 22.687 15.436 27.675 16.046 9.443 10.25 12.221 21.564 17.789 34 15.498 34.615 43.81 38.995 77.402 38.173l-10.436 8.427c-.914 15.189-1.069 27.353 1.598 42.369 17.353 97.689 138.867 93.399 210.018 64.511l1.174 1.784c.549-.186 1.237-.399 1.982-.75 42.982-20.228 75.337-51.87 94.904-95.237 5.642-12.5 9.332-24.041 13.982-36.7.7-8.432 1.71-19.822.99-28.109.49-86.73-64.331-174.379-139.357-213.669-7.711-2.416-18.293-8.623-27.588-11.201-14.344-3.978-27.157-3.152-41.486-5.153z"/>
        <path fill="#afa5aa" d="M804.585 583.087c42.258-6.243 93.679-21.694 116.792-60.801 68.941 30.636 122.663 65.15 168.873 126.295 7.41 9.801 20.62 27.413 24.95 38.576-1.64 4.288-1 3.24.33 8.655 18.84 49.524 33.58 96.7 41.02 149.404 1.16 8.214 4.93 36.072 7.69 41.752-2.16 3.004-4.57 6.186-6.51 9.304-12.16 13.918-23.51 26.806-37.23 39.271-89.68 81.437-221.608 137.587-339.075 161.167a792 792 0 0 1-67.48 10.21c-10.706 1.15-28.922 2.08-38.59 3.94-41.082 1.24-108.994 1.06-148.32-9.71-7.928-11.66-14.135-12.46-22.189-28.76 5.685 1.42 10.754 2.7 16.533 3.74 1.274 1.15 3.351 1.46 5.063 1.42 38.836-.78 76.702-29.23 103.51-55 7.483-7.19 13.097-16.11 20.407-22.52.188 2.25.092 1.69.756 3.99l4.147-.36c2.33 2.6 2.325 3.07 5.742 3.92 3.928-.45 4.611-1.47 7.454-3.93.791 2.4-22.163 45.15-21.02 53.58-2.781 8.37-5.165 15.53-7.264 24.15 2.467-.15 5.33-.38 7.847-.71 112.314-14.95 239.395-39.03 334.218-104.067 13.777-10.525 27.371-23.561 37.901-37.362 91.04-119.372 34.77-292.891-74.821-378.774-13.477 12.324-31.757 21.969-48.387 29.482-7.114 3.214-15.579 5.754-22.249 9.642-7.711-2.416-18.293-8.623-27.588-11.201-14.344-3.978-27.157-3.152-41.486-5.153z"/>
        <path fill="#190108" d="M1067.59 904.203c7.36 13.473-5.29 30.49-16.5 37.639l-.47-.341c1.54-3.372 4.1-6.667 6.11-9.897 6.15-9.908 8.19-16.182 10.86-27.401"/>
        <path fill="#4e4b66" d="M1069.88 732.645c12.26 11.455 16.05 66.918 12.62 83.626-.48-8.84-.1-17.973-.64-26.994-1.25-20.921-5.83-36.978-11.98-56.632"/>
        <path fill="#190108" d="M1100.67 869.033c-.83 7.302-10.01 41.411-15.39 44.016l.52-2.276c2.21-6.831 6.95-20.311 7.04-27.085-2.34-.591-3.7-1.018-5.97-1.829l-.46-1.421 7.83-1.473c1.84-3.231 4.35-6.799 6.43-9.932"/>
        <path fill="#c19661" d="M902.182 974.056c.549-.186 1.237-.399 1.982-.75 42.982-20.228 75.337-51.87 94.904-95.237 5.642-12.5 9.332-24.041 13.982-36.7-2.66 39.459-25.41 81.728-54.937 107.857-27.665 24.481-69.577 39.609-106.12 44.431-39.961 6.713-97.406 12.073-131.652-12.4-9.564-6.835-18.944-16.483-27.21-24.962-13.491 33.507-31.422 65.725-45.693 100.935-1.143-8.43 21.811-51.18 21.02-53.58-2.843 2.46-3.526 3.48-7.454 3.93-3.417-.85-3.412-1.32-5.742-3.92l-4.147.36c-.664-2.3-.568-1.74-.756-3.99-7.31 6.41-12.924 15.33-20.407 22.52-26.808 25.77-64.674 54.22-103.51 55-1.712.04-3.789-.27-5.063-1.42 43.515-.61 79.885-27.9 109.449-57.55 24.88-24.952 42.956-56.533 60.003-87.044 33.932 67.764 107.563 69.034 173.145 55.49 13.973-3.604 25.026-7.648 38.206-12.97"/>
        <path fill="#c19661" d="M580.967 400.769c5.507-.802 12.044 2.789 16.905 5.379 13.928 9.353 18.043 28.458 20.279 44.032l1.62.681c-.092-4.507-.947-5.019 1.201-7.624l4.287.105c-1.252 6.423-1.257 8.534-1.317 15.002l-.998 7.961c.117 11.894-1.286 40.376-3.953 52.003-.69 2.691-1.301 4.227-.99 7.012 9.747-.92 32.621-6.469 39.224-4.965 1.98 1.767 1.771 1.866 2.626 4.447a396 396 0 0 0 7.634 15.332c1.833 18.578 25.284 38.893 42.314 44.242 5.219-.602 11.336 1.696 15.51-.916l-3.561-.911 2.005-1.037 4.723.79c15.93-1.47 30.636 2.118 46.331 2.91 7.183.363 24-3.679 29.778-2.125l1.024.15c14.329 2.001 27.142 1.175 41.486 5.153 9.295 2.578 19.877 8.785 27.588 11.201 75.026 39.29 139.847 126.939 139.357 213.669.72 8.287-.29 19.677-.99 28.109-4.65 12.659-8.34 24.2-13.982 36.7-19.567 43.367-51.922 75.009-94.904 95.237-.745.351-1.433.564-1.982.75l-1.174-1.784c-71.151 28.888-192.665 33.178-210.018-64.511-2.667-15.016-2.512-27.18-1.598-42.369l10.436-8.427c1.358 20.805 20.474 43.739 36.695 55.394 29.4 21.124 65.095 27.085 100.479 21.091 45.375-7.687 88.753-37.98 115.355-75.061 22.731-31.808 29.269-70.052 22.778-108.252-8.485-45.853-38.437-80.155-75.263-106.503-30.786-22.026-53.336-15.567-88.783-17.274-47.717-2.298-94.848-6.834-142.523-.288-33.851 4.648-66.261 14.596-100.034 19.508-24.73 3.631-49.511.53-73.805 4.981-2.848-.414-9.905-5.662-12.558-7.504l-17.207-9.24c3.681-7.116 6.823-13.007 9.724-20.458l1.398-3.757c-12.856-5.845-19.206-20.068-23.777-32.618-2.729-3.307-2.795-5.081-3.901-9.382-.236-2.177-.675-3.429-1.242-5.525 8.765-17.566 18.045 1.452 33.671.755 23.105-1.029 44.493-14.225 60.306-30.242 26.033-26.37 41.889-54.363 42.059-91.829-.833-1.193-.516-.518-.851-1.799-6.127-23.435-9.944-29.254-33.876-30.856 8.742-3.64 17.533-5.626 25.604.462.492-2.222.559-2.311 1.35-4.42 2.205-.979 3.091-1.405 4.836-3.065z"/>
        <path fill="#5a3c3e" d="M580.967 400.769c5.507-.802 12.044 2.789 16.905 5.379 13.928 9.353 18.043 28.458 20.279 44.032l1.62.681c-.092-4.507-.947-5.019 1.201-7.624l4.287.105c-1.252 6.423-1.257 8.534-1.317 15.002l-.998 7.961c.117 11.894-1.286 40.376-3.953 52.003-.69 2.691-1.301 4.227-.99 7.012 9.747-.92 32.621-6.469 39.224-4.965 1.98 1.767 1.771 1.866 2.626 4.447-7.372 3.053-11.733 2.31-19.477 1.594-18.98 29.344-30.983 47.621-59.76 68.668-2.971 2.173-14.664 9.256-14.549 12.342-15.782 5.137-36.281 10.092-52.573 13.841l2.506-3.652c-3.476.581-6.907 1.268-10.411 1.522-14.004-.015-18.276-.344-30.901-5.758l1.398-3.757c-12.856-5.845-19.206-20.068-23.777-32.618-2.729-3.307-2.795-5.081-3.901-9.382-.236-2.177-.675-3.429-1.242-5.525 8.765-17.566 18.045 1.452 33.671.755 23.105-1.029 44.493-14.225 60.306-30.242 26.033-26.37 41.889-54.363 42.059-91.829-.833-1.193-.516-.518-.851-1.799-6.127-23.435-9.944-29.254-33.876-30.856 8.742-3.64 17.533-5.626 25.604.462.492-2.222.559-2.311 1.35-4.42 2.205-.979 3.091-1.405 4.836-3.065z"/>
        <path fill="#795056" d="M580.967 400.769c5.507-.802 12.044 2.789 16.905 5.379 2.616 3.815 4.401 6.448 7.437 9.978 3.409 43.124-8.087 71.169-29.534 108.346-21.225 36.795-82.071 73.509-123.468 52.512-2.729-3.307-2.795-5.081-3.901-9.382-.236-2.177-.675-3.429-1.242-5.525 8.765-17.566 18.045 1.452 33.671.755 23.105-1.029 44.493-14.225 60.306-30.242 26.033-26.37 41.889-54.363 42.059-91.829-.833-1.193-.516-.518-.851-1.799-6.127-23.435-9.944-29.254-33.876-30.856 8.742-3.64 17.533-5.626 25.604.462.492-2.222.559-2.311 1.35-4.42 2.205-.979 3.091-1.405 4.836-3.065z"/>
        <path fill="#a08f96" d="M548.473 408.106c8.742-3.64 17.533-5.626 25.604.462l6.751 7.373c3.36-1.995 5.28-2.272 8.982-3.025 16.949 68.865-29.696 138.648-96.508 158.064-20.653 6.002-27.594-1.85-44.896-3.378-.236-2.177-.675-3.429-1.242-5.525 8.765-17.566 18.045 1.452 33.671.755 23.105-1.029 44.493-14.225 60.306-30.242 26.033-26.37 41.889-54.363 42.059-91.829-.833-1.193-.516-.518-.851-1.799-6.127-23.435-9.944-29.254-33.876-30.856"/>
        <path fill="#8e686b" d="M548.473 408.106c8.742-3.64 17.533-5.626 25.604.462l6.751 7.373c3.74 6.006 5.759 13.419 5.057 20.494-1.131-1.882-1.524-2.862-2.436-4.866l-.636.06c.554 2.663 1.043 5.06 1.459 7.763l-1.072 1.369c-.833-1.193-.516-.518-.851-1.799-6.127-23.435-9.944-29.254-33.876-30.856"/>
        <path fill="#c7a8a1" d="m580.263 401.083.704-.314c5.4 4.841 6.366 5.559 8.843 12.147-3.702.753-5.622 1.03-8.982 3.025l-6.751-7.373c.492-2.222.559-2.311 1.35-4.42 2.205-.979 3.091-1.405 4.836-3.065"/>
        <path fill="url(#chk-grad13)" d="M618.001 525.32c9.747-.92 32.621-6.469 39.224-4.965 1.98 1.767 1.771 1.866 2.626 4.447-7.372 3.053-11.733 2.31-19.477 1.594-18.98 29.344-30.983 47.621-59.76 68.668-2.971 2.173-14.664 9.256-14.549 12.342-15.782 5.137-36.281 10.092-52.573 13.841l2.506-3.652c45.735-8.857 86.284-49.468 102.003-92.275"/>
        <path fill="#300106" d="M619.771 450.861c-.092-4.507-.947-5.019 1.201-7.624l4.287.105c-1.252 6.423-1.257 8.534-1.317 15.002l-.998 7.961c.117 11.894-1.286 40.376-3.953 52.003-.69 2.691-1.301 4.227-.99 7.012-15.719 42.807-56.268 83.418-102.003 92.275-3.476.581-6.907 1.268-10.411 1.522-14.004-.015-18.276-.344-30.901-5.758l1.398-3.757c8.367 2.412 18.412 4.688 27.22 3.928 34.215-2.951 60.662-21.824 82.644-46.587 23.375-26.332 29.169-41.69 31.35-76.524.932-14.884 1.556-25.055.853-40.239z"/>
        <path fill="#590002" d="M619.771 450.861c-.092-4.507-.947-5.019 1.201-7.624l4.287.105c-1.252 6.423-1.257 8.534-1.317 15.002l-.998 7.961c-4.2-4.386-3.225-9.316-3.173-15.444"/>
        <path fill="#250008" d="M640.374 526.396c7.744.716 12.105 1.459 19.477-1.594a396 396 0 0 0 7.634 15.332c1.833 18.578 25.284 38.893 42.314 44.242 5.219-.602 11.336 1.696 15.51-.916l-3.561-.911 2.005-1.037 4.723.79c15.93-1.47 30.636 2.118 46.331 2.91 7.183.363 24-3.679 29.778-2.125l1.024.15c14.329 2.001 27.142 1.175 41.486 5.153 9.295 2.578 19.877 8.785 27.588 11.201 75.026 39.29 139.847 126.939 139.357 213.669-1.59 2.464-1.22 4.394-1.2 7.375l-.62.963c.64-62.972-29.752-119.137-73.496-162.959-24.638-24.681-56.266-49.579-89.542-60.283-21.995-7.076-48.69-4.943-71.541-4.818-60.321.301-120.086 5.206-179.531 15.567-26.775 4.667-52.448 11.987-79.099 16.866-4.798.878-19.768 2.7-23.884.512 3.349-3.947 12.961-4.472 18.365-5.236 16.292-3.749 36.791-8.704 52.573-13.841-.115-3.086 11.578-10.169 14.549-12.342 28.777-21.047 40.78-39.324 59.76-68.668"/>
        <path fill="#fefefc" d="M640.374 526.396c7.744.716 12.105 1.459 19.477-1.594a396 396 0 0 0 7.634 15.332c1.833 18.578 25.284 38.893 42.314 44.242-1.252 2.202-.38 1.33-2.651 2.581-44.428 1.273-97.254 12.089-141.083 20.449-.115-3.086 11.578-10.169 14.549-12.342 28.777-21.047 40.78-39.324 59.76-68.668"/>
        <path fill="#e8c5cd" d="m723.753 581.512 4.723.79 20.131 3.104c-13.653 1.074-27.734 1.215-41.459 1.551 2.271-1.251 1.399-.379 2.651-2.581 5.219-.602 11.336 1.696 15.51-.916l-3.561-.911z"/>
        <path fill="#986f4e" d="M467.612 633.294c1.617.98 9.513 5.837 11.091 5.925 16.09.894 40.096-.537 55.635-1.88 6.103-.528 13.424-10.646 23.583-12.619 24.08-4.678 43.024-5.62 66.999-6.783 6.223-.302 27.066-6.749 34.764-8.207 5.7-1.08 18.776-4.23 23.714-6.686l.054.946c-7.245 6.396-138.231 33.643-156.069 35.547-10.553 1.127-37.728-1.536-45.214 3.52l-17.207-9.24c3.681-7.116 6.823-13.007 9.724-20.458 12.625 5.414 16.897 5.743 30.901 5.758-12.964 3.151-17.357 1.158-29.666-3.074z"/>
        <path fill="#614a31" d="m1012.22 821.598.62-.963c-.02-2.981-.39-4.911 1.2-7.375.72 8.287-.29 19.677-.99 28.109-4.65 12.659-8.34 24.2-13.982 36.7-19.567 43.367-51.922 75.009-94.904 95.237-.745.351-1.433.564-1.982.75l-1.174-1.784c2.948-2.224 13.132-6.767 17.195-8.956 43.857-23.624 75.256-64.401 89.257-112.008 2.84-9.639 3.54-19.776 4.76-29.71"/>
        <path fill="#8e686b" d="M814.729 350.926c12.374 1.105 30.428 2.396 41.92 6.732l3.186.548c2.966.185 4.492.561 7.211-.653l.982-2.601c3.524 1.565 16.373 7.766 19.165 8.678l6.662 3.907c18.155 15.31 28.258 26.233 34.246 49.992 1.82 7.22 4.72 17.568 4.54 24.867-2.254 13.552.647 25.885-1.882 39.966-1.368-.885-.623-.351-2.19-1.662-5.003 10.756 1.817 19.075-4.749 29.525-.957 1.524-1.338 3.243-.775 5.021 10.198-17.133 10.24-47.113 10.046-66.437 18.112 8.34 39.501 16.271 56.973 25.431 30.716 15.251 61.526 34.067 85.246 59.18 6.43 5.657 16.09 15.541 21.19 22.49 10.45 10.822 13.92 18.043 22.48 29.519 17.29 30.336 18.06 44.717 27.17 75.126l.76 4.262.12 3.93.07 13.279c-.92 9.145-1.94 18.279-3.07 27.4-.29 19.584 1.69 21.993 9.35 40.257 2.01 6.613 4.86 13.866 7.28 20.425 17.97-5.732 44.67-12.625 59.53-24.508 2.06-1.642 4.96-6.809 6.38-9.274 2.33-2.857 4.13-4.906 6.69-7.56 2.74-2.313 12.39-14.788 14.96-18.314 1.21-1.673-.01-5.989-.62-8.167-3.64-14.708-26.28-39.422-42.53-36.983-7.43 1.493-9.97 2.155-17.2.034l-.3-5.645c4.9-.497 7.47-.967 12.28-2.073a488 488 0 0 0 8.95-2.114c33.27-3.612 63.2-23.413 81.95-50.742 5.81-8.178 13.07-22.992 12.66-33.16-1.06 3.531-.13 3.042-2.22 4.298-1.53-3.271-1.28-1.578-.58-5.285 2.98-3.001 3.46-3.188 4.56-7.094-3.64-23.126-12.34-32.365-31.42-44.763 2.18-5.055 2.59-4.782 7.59-7.522 37.66 21.675 41.9 58.788 21.4 94.12-14.44 24.883-49.69 53.04-78.17 57.172 23.92 14.554 46.45 37.422 27.71 66.961-16.49 25.984-46.51 37.993-75.37 44.481a252 252 0 0 1-14.27 2.899c5.41 19.956 9.83 36.981 13.01 57.396 1.91 12.247 3.56 38.193 7.06 48.782 7.32 22.143 26.37 52.228 40.07 70.874-.87-.19-4.32-1.062-4.75-1.763-12.23-19.672-26.3-40.807-34.97-62.266l-1.93-.895c-.97.834-2.22 1.482-1.94 2.428 4.49 15.244 16.45 31.501 23.01 45.728 2.88 6.241 13.75 17.928 13.51 20.91l-1.2.154c-13.84-15.55-32.45-53.825-40.34-73.492-12.18 17.07 1.23 27.819 9.6 44.407-6.56-4.189-10.87-15.24-14.74-21.796-2.89-4.909-1.75-3.789-7.02-5.344 1.69-2.66 2.74-6.445 1.49-9.379-1.14.506-2.43 2.391-3.35 3.501l-2.42.158c1.94-3.118 4.35-6.3 6.51-9.304-2.76-5.68-6.53-33.538-7.69-41.752-7.44-52.704-22.18-99.88-41.02-149.404-1.33-5.415-1.97-4.367-.33-8.655-4.33-11.163-17.54-28.775-24.95-38.576-46.21-61.145-99.932-95.659-168.873-126.295-23.113 39.107-74.534 54.558-116.792 60.801-5.778-1.554-22.595 2.488-29.778 2.125-15.695-.792-30.401-4.38-46.331-2.91l-4.723-.79-2.005 1.037 3.561.911c-4.174 2.612-10.291.314-15.51.916-17.03-5.349-40.481-25.664-42.314-44.242a396 396 0 0 1-7.634-15.332c-.855-2.581-.646-2.68-2.626-4.447-6.603-1.504-29.477 4.045-39.224 4.965-.311-2.785.3-4.321.99-7.012 2.667-11.627 4.07-40.109 3.953-52.003l.998-7.961c5.624 5.593 15.807 6.118 23.101 4.307l.035-3.91c.447-4.125 2.234-11.075 3.194-15.335l3.182-3.959-.907-2.621 2.293-.906c1.505-2.966 1.413-3.09 3.692-5.431 8.398-18.077 25.284-31.651 41.064-42.88 37.329-24.417 71.144-34.723 115.133-36.683"/>
        <path fill="#190108" d="M868.028 354.952c3.524 1.565 16.373 7.766 19.165 8.678l6.662 3.907c18.155 15.31 28.258 26.233 34.246 49.992 1.82 7.22 4.72 17.568 4.54 24.867-2.254 13.552.647 25.885-1.882 39.966-1.368-.885-.623-.351-2.19-1.662-5.003 10.756 1.817 19.075-4.749 29.525-.957 1.524-1.338 3.243-.775 5.021 10.198-17.133 10.24-47.113 10.046-66.437 18.112 8.34 39.501 16.271 56.973 25.431 30.716 15.251 61.526 34.067 85.246 59.18 6.43 5.657 16.09 15.541 21.19 22.49 10.45 10.822 13.92 18.043 22.48 29.519 17.29 30.336 18.06 44.717 27.17 75.126l.76 4.262.12 3.93.07 13.279c-.92 9.145-1.94 18.279-3.07 27.4-.29 19.584 1.69 21.993 9.35 40.257 2.01 6.613 4.86 13.866 7.28 20.425 17.97-5.732 44.67-12.625 59.53-24.508 2.06-1.642 4.96-6.809 6.38-9.274 2.33-2.857 4.13-4.906 6.69-7.56 2.74-2.313 12.39-14.788 14.96-18.314 1.21-1.673-.01-5.989-.62-8.167-3.64-14.708-26.28-39.422-42.53-36.983-7.43 1.493-9.97 2.155-17.2.034l-.3-5.645c4.9-.497 7.47-.967 12.28-2.073a488 488 0 0 0 8.95-2.114c33.27-3.612 63.2-23.413 81.95-50.742 5.81-8.178 13.07-22.992 12.66-33.16-1.06 3.531-.13 3.042-2.22 4.298-1.53-3.271-1.28-1.578-.58-5.285 2.98-3.001 3.46-3.188 4.56-7.094-3.64-23.126-12.34-32.365-31.42-44.763 2.18-5.055 2.59-4.782 7.59-7.522 37.66 21.675 41.9 58.788 21.4 94.12-14.44 24.883-49.69 53.04-78.17 57.172 23.92 14.554 46.45 37.422 27.71 66.961-16.49 25.984-46.51 37.993-75.37 44.481a252 252 0 0 1-14.27 2.899c5.41 19.956 9.83 36.981 13.01 57.396 1.91 12.247 3.56 38.193 7.06 48.782 7.32 22.143 26.37 52.228 40.07 70.874-.87-.19-4.32-1.062-4.75-1.763-12.23-19.672-26.3-40.807-34.97-62.266l-1.93-.895c-.97.834-2.22 1.482-1.94 2.428 4.49 15.244 16.45 31.501 23.01 45.728 2.88 6.241 13.75 17.928 13.51 20.91l-1.2.154c-13.84-15.55-32.45-53.825-40.34-73.492-12.18 17.07 1.23 27.819 9.6 44.407-6.56-4.189-10.87-15.24-14.74-21.796-2.89-4.909-1.75-3.789-7.02-5.344 1.69-2.66 2.74-6.445 1.49-9.379-1.14.506-2.43 2.391-3.35 3.501l-2.42.158c1.94-3.118 4.35-6.3 6.51-9.304-2.76-5.68-6.53-33.538-7.69-41.752-7.44-52.704-22.18-99.88-41.02-149.404-1.33-5.415-1.97-4.367-.33-8.655-4.33-11.163-17.54-28.775-24.95-38.576-46.21-61.145-99.932-95.659-168.873-126.295-23.113 39.107-74.534 54.558-116.792 60.801-5.778-1.554-22.595 2.488-29.778 2.125-15.695-.792-30.401-4.38-46.331-2.91l-4.723-.79-2.005 1.037 3.561.911c-4.174 2.612-10.291.314-15.51.916-17.03-5.349-40.481-25.664-42.314-44.242a396 396 0 0 1-7.634-15.332c-.855-2.581-.646-2.68-2.626-4.447-6.603-1.504-29.477 4.045-39.224 4.965-.311-2.785.3-4.321.99-7.012 2.667-11.627 4.07-40.109 3.953-52.003l.998-7.961c5.624 5.593 15.807 6.118 23.101 4.307l.035-3.91 2.64-2.151c.373 22.914 2.548 35.6 10.954 56.968 3.244 6.896 5.691 11.007 9.727 17.529 3.934 2.223 4.766 2.841 9.033 4.009 12.934 14.528 36.784 17.26 55.334 16.999 49.47-.697 108.094-6.657 145.151-42.831 18.348-17.911 33.282-46.809 37.533-72.157.68-4.692.32-21.264.378-27.207l-.25-.912a64.52 64.52 0 0 0-30.864-38.334c-7.104-3.962-16.397-8.82-24.117-11.258l-2.762-1.19c2.966.185 4.492.561 7.211-.653z"/>
        <path fill="#4e4b66" d="M933.091 448.809c18.112 8.34 39.501 16.271 56.973 25.431 30.716 15.251 61.526 34.067 85.246 59.18 6.43 5.657 16.09 15.541 21.19 22.49-2.09 11.262-5.16 18.757-15.09 25.652-5.51 3.824-23.8 11.088-30.17 12.341a623 623 0 0 0-55.394-42.325c-7.373-3.312-17.092-10.952-27.75-15.648-15.051-6.59-29.556-14.055-45.051-20.684 10.198-17.133 10.24-47.113 10.046-66.437"/>
        <path fill="#3d3755" d="M933.091 448.809c18.112 8.34 39.501 16.271 56.973 25.431-3.916 12.661-6.825 23.791-11.531 36.325-1.955 5.207-9.667 21.753-10.437 25.365-15.051-6.59-29.556-14.055-45.051-20.684 10.198-17.133 10.24-47.113 10.046-66.437m142.219 84.611c6.43 5.657 16.09 15.541 21.19 22.49-2.09 11.262-5.16 18.757-15.09 25.652-5.51 3.824-23.8 11.088-30.17 12.341a623 623 0 0 0-55.394-42.325c12.484-2.712 34.284 6.961 47.624 8.801 8.79 1.212 10.04 1.191 19.24.605 12.24-7.341 11.96-14.299 12.6-27.564"/>
        <path fill="#5a3c3e" d="M917.828 409.9c10.486 14.755 10.697 59.745 7.215 77.824-3.832 23.554-12.065 41.979-32.409 55.816-45.677 31.065-104.884 41.861-159.181 33.567-31.079-4.748-48.846-18.288-63.054-46.02 3.934 2.223 4.766 2.841 9.033 4.009 12.934 14.528 36.784 17.26 55.334 16.999 49.47-.697 108.094-6.657 145.151-42.831 18.348-17.911 33.282-46.809 37.533-72.157.68-4.692.32-21.264.378-27.207"/>
        <path fill="#3a2a47" d="M1096.5 555.91c10.45 10.822 13.92 18.043 22.48 29.519 17.29 30.336 18.06 44.717 27.17 75.126l.76 4.262.12 3.93.07 13.279c-.92 9.145-1.94 18.279-3.07 27.4l-2.4 8.535-1.32-.196c-3.07-7.23-7.35-13.492-10.66-20.392-20.05-41.693-46.25-71.159-78.41-103.47 6.37-1.253 24.66-8.517 30.17-12.341 9.93-6.895 13-14.39 15.09-25.652"/>
        <path fill="#fefefc" d="m1115.53 695.812 4.72.807c31.8 61.817 43.37 111.589 51.54 180.615l-7.55 9.734c-2.76-5.68-6.53-33.538-7.69-41.752-7.44-52.704-22.18-99.88-41.02-149.404"/>
        <path fill="#5a3c3e" d="M623.942 458.344c5.624 5.593 15.807 6.118 23.101 4.307.172 19.516 1.743 32.685 8.568 51.152-12.367 1.066-24.33 3.173-36.62 4.505 2.667-11.627 4.07-40.109 3.953-52.003z"/>
        <path fill="#afa5aa" d="M667.485 540.134c12.524 17.384 20.689 27.469 41.12 36.054 3.059 1.286 13.703 4.613 15.148 5.324l-2.005 1.037 3.561.911c-4.174 2.612-10.291.314-15.51.916-17.03-5.349-40.481-25.664-42.314-44.242"/>
        <path fill="#fefefc" d="M1115.53 695.812c-1.33-5.415-1.97-4.367-.33-8.655l5.05 9.462zM814.729 350.926c12.374 1.105 30.428 2.396 41.92 6.732l3.186.548 2.762 1.19c-.507 1.211-.802 2.168-1.513 3.242-11.41-3.447-20.664-4.375-32.698-4.802-63.673-2.263-123.513 26.188-167.588 71.011-1.278 1.3-.791.919-2.266 1.642 8.398-18.077 25.284-31.651 41.064-42.88 37.329-24.417 71.144-34.723 115.133-36.683"/>
        <path fill="#795056" d="M660.672 513.558c8.424 3.385 14.151 13.786 18.76 21.538-4.267-1.168-5.099-1.786-9.033-4.009-4.036-6.522-6.483-10.633-9.727-17.529"/>
        <path fill="#c7a8a1" d="M862.597 359.396c7.72 2.438 17.013 7.296 24.117 11.258-4.106 1.755-19.811-5.867-25.63-8.016.711-1.074 1.006-2.031 1.513-3.242"/>
        <path fill="#590002" d="M653.454 439.447c-.576 5.896-2.687 11.295-3.736 17.143l-2.64 2.151c.447-4.125 2.234-11.075 3.194-15.335z"/>
        <path fill="#250008" d="M807.365 368.417c21.9-1.248 51.102 1.502 68.144 16.772 26.446 23.696 19.336 76.73-3.565 100.782-30.334 31.857-74.392 43.812-116.945 46.077-22.836.584-52.339-1.407-70.568-17.166-29.025-25.093-17.066-73.491 6.373-98.276 30.896-32.67 72.625-45.691 116.561-48.189"/>
        <path fill="#1bdbef" d="M755.937 383.75c31.002-9.882 78.36-16.996 107.874.668 28.54 12.874 27.203 59.978 15.558 82.596-25.524 49.573-116.78 68.128-166.796 55.506-15.471-3.904-30.333-13.141-35.42-28.407-7.594-20.584.45-54.089 16.08-69.292 14.868-19.592 39.929-33.079 62.704-41.071"/>
        <path fill="#1a8ebd" d="M755.937 383.75c31.002-9.882 78.36-16.996 107.874.668 28.54 12.874 27.203 59.978 15.558 82.596-25.524 49.573-116.78 68.128-166.796 55.506-15.471-3.904-30.333-13.141-35.42-28.407-7.594-20.584.45-54.089 16.08-69.292l3.423 2.041-.96 1.484c-6.957 5.542-12.904 22.605-14.082 31.292-4.149 30.614 20.637 36.061 44.663 37.335 46.127 2.446 94.098-4.592 130.475-35.192 4.484-3.78 8.681-9.182 11.59-14.148.22-4.985.736-12.773-.705-17.355-.766-2.437-.663-1.316-.944-3.907l-.157-1.592c1.22-18.499-5.995-27.813-20.212-38.068-29.435-11.575-62.038-5.594-91.641 2.825 1.491-1.858 2.043-2.112 4.188-3.155-1.128-.751-1.99-1.663-2.934-2.631"/>
        <path fill="#0b90da" d="M755.937 383.75c31.002-9.882 78.36-16.996 107.874.668-5.562.477-11.858-3.355-17.503-4.828-10.815-2.824-22.509-5.031-33.703-3.713-4.606.564-7.964 2.095-12.8 2.193l-.599.684c3.733.836 9.578-.667 12.531-.542 9.78.412 40.505 4.883 47.393 10.002l-.726 1.193c-4.989-2.168-6.598-2.151-12.08-2.696-29.435-11.575-62.038-5.594-91.641 2.825 1.491-1.858 2.043-2.112 4.188-3.155-1.128-.751-1.99-1.663-2.934-2.631"/>
        <path fill="#26b3df" d="M846.324 386.711c5.482.545 7.091.528 12.08 2.696 19.077 14.427 22.483 38.205 9.938 58.226.22-4.985.736-12.773-.705-17.355-.766-2.437-.663-1.316-.944-3.907l-.157-1.592c1.22-18.499-5.995-27.813-20.212-38.068"/>
        <path fill="#a4e1ed" d="M754.683 389.536c29.603-8.419 62.206-14.4 91.641-2.825 14.217 10.255 21.432 19.569 20.212 38.068-1.144 9.909-1.663 13.572-6.413 22.8-12.997-10.276-24.329-8.769-40.125-13.387-19.05-7.554-22.89-2.684-44.147-18.471 1.751-1.107.845-.471 2.69-1.949-2.468-.159-16.084 2.72-19.707 3.357-8.04 2.023-58.603 13.739-62.117 11.95-.373-.19-.681-.489-1.021-.733l.96-1.484-3.423-2.041c14.868-19.592 39.929-33.079 62.704-41.071.944.968 1.806 1.88 2.934 2.631-2.145 1.043-2.697 1.297-4.188 3.155"/>
        <path fill="#0b90da" d="M755.937 383.75c.944.968 1.806 1.88 2.934 2.631-2.145 1.043-2.697 1.297-4.188 3.155-25.661 11.416-38.767 14.403-58.027 37.326l-3.423-2.041c14.868-19.592 39.929-33.079 62.704-41.071"/>
        <path fill="#fefefc" d="M748.594 446.34c7.569-5.145 12.568-8.754 21.658-11.184 14.785-3.953 39.749-.461 33.162 20.729q-.381 1.213-.79 2.417c-30.113 27.741-52.754 2.306-63.021 6.413-.252-9.099 2.456-12.278 8.991-18.375"/>
        <path fill="#6cdeea" d="M758.834 417.129c3.623-.637 17.239-3.516 19.707-3.357-1.845 1.478-.939.842-2.69 1.949 21.257 15.787 25.097 10.917 44.147 18.471-3.999 11.104 2.457 19.061-11.387 31.118-20.117 17.521-50.536 21.872-69.008-.595 10.267-4.107 32.908 21.328 63.021-6.413q.409-1.204.79-2.417c6.587-21.19-18.377-24.682-33.162-20.729-9.09 2.43-14.089 6.039-21.658 11.184.916-6.631 7.564-9.716 12.789-15.7-1.965-5.1-3.04-8.045-2.549-13.511"/>
        <path fill="#26b3df" d="M536.129 417.436c9.115-3.787 15.717-3.659 25.015-2.114 13.681 6.03 15.847 21.705 16.345 34.948-2.125 34.866-19.186 59.114-44.68 82.517-11.647 10.69-28.716 20.568-44.467 23.335-10.342 1.998-17.737 2.801-20.398-8.628-1.122-5.637-.874-8.886-.755-14.538l.091-10.172c.426-.94.383-.665.497-1.852 3.954-41.27 28.161-87.052 68.352-103.496"/>
        <path fill="#1a8ebd" d="M536.129 417.436c9.115-3.787 15.717-3.659 25.015-2.114 13.681 6.03 15.847 21.705 16.345 34.948-13.561-2.532-19.427-8.097-37.271-5.592-.288 2.852.254 4.034-2.488 5.716-3.946 3.218-5.193 4.292-9.574 6.722l-1.3-1.89c-6.618 3.168-15.79 4.945-22.781 2.532 3.919-5.132 5.616-7.21 10.287-11.816 2.877-3.204 7.377-7.202 10.602-10.245 2.18-8.528 10.172-9.577 11.165-18.261"/>
        <path fill="#57b4e2" d="M514.362 445.942a386 386 0 0 1 25.856-1.264c-.288 2.852.254 4.034-2.488 5.716-3.946 3.218-5.193 4.292-9.574 6.722l-1.3-1.89c-6.618 3.168-15.79 4.945-22.781 2.532 3.919-5.132 5.616-7.21 10.287-11.816"/>
        <path fill="#c6dee5" d="M536.129 417.436c9.115-3.787 15.717-3.659 25.015-2.114-15.794 7.321-21.545 10.193-36.18 20.375 2.18-8.528 10.172-9.577 11.165-18.261"/>
        <path fill="#fefefc" d="M467.28 522.784c.426-.94.383-.665.497-1.852 3.954-41.27 28.161-87.052 68.352-103.496-.993 8.684-8.985 9.733-11.165 18.261-3.225 3.043-7.725 7.041-10.602 10.245-4.671 4.606-6.368 6.684-10.287 11.816-11.403 11.17-28.933 44.101-31.645 60.38-.415 1.924-1.469 6.295-1.632 8.038-.72 2.239-1.212 6.072-3.609 6.78z"/>
        <path fill="#78bee5" d="m526.856 455.226 1.3 1.89c-22.106 15.261-39.647 36.714-52.186 60.413-1.341.276-2.172.491-3.54.609 2.712-16.279 20.242-49.21 31.645-60.38 6.991 2.413 16.163.636 22.781-2.532"/>
        <path fill="#1a8ebd" d="M470.798 526.176c4.004 4.367 3.534 9.244 2.817 14.99-2.068 2.614-3.064 4.311-5.671 6.328-1.122-5.637-.874-8.886-.755-14.538 2.397-.708 2.889-4.541 3.609-6.78"/>
        <path fill="#0b90da" d="M467.944 547.494c2.607-2.017 3.603-3.714 5.671-6.328 2.812 11.791 1.571 14.796 14.727 14.956-10.342 1.998-17.737 2.801-20.398-8.628"/>
        <path fill="#fefefc" d="M533.597 487.176c5.314-.326 8.408-.298 10.874 4.868-.139 11.363-13.142 20.834-23.155 23.91-6.085.367-8.439.92-10.886-4.876.75-11.947 12.244-20.983 23.167-23.902"/>
        <path fill="url(#chk-grad4)" d="M694.75 384.123c32.959-26.983 89.649-42.299 132.189-39.559 5.574.639 10.791 1.048 16.222 2.472-.791 1.495-1.565 3.604-3.697 3.44-11.241-.863-13.782-2.081-24.735.45-43.989 1.96-77.804 12.266-115.133 36.683-1.554-1.345-3.145-2.331-4.846-3.486"/>
        <path fill="#795056" d="M634.087 438.16c6.438-.244 12.046-.723 18.46-1.334l.907 2.621-3.182 3.959c-.96 4.26-2.747 11.21-3.194 15.335l-.035 3.91c-7.294 1.811-17.477 1.286-23.101-4.307.06-6.468.065-8.579 1.317-15.002l.594-2.055-.221-1.278c2.17-2.015 4.697-1.491 8.455-1.849"/>
        <path fill="#c7a8a1" d="M634.087 438.16c6.438-.244 12.046-.723 18.46-1.334l.907 2.621-3.182 3.959c-9.925 2.426-15.311 1.938-24.419-2.119l-.221-1.278c2.17-2.015 4.697-1.491 8.455-1.849"/>
        <path fill="#a92a27" fill-opacity=".647" d="M867.97 354.447c2.52-1.655 8.543-10.786 10.939-13.842 1.898 6.429 12.484 13.374 8.284 23.025-2.792-.912-15.641-7.113-19.165-8.678z"/>
        <path fill="#0b0001" fill-opacity=".984" d="M694.75 384.123c1.701 1.155 3.292 2.141 4.846 3.486-15.78 11.229-32.666 24.803-41.064 42.88-2.279 2.341-2.187 2.465-3.692 5.431l-2.293.906c-6.414.611-12.022 1.09-18.46 1.334l-6.028-.799c-.089.062 22.179-2.067 25.264-2.744 4.02-6.371 9.172-14.72 13.329-20.767 3.253-4.731 10.551-9.938 14.808-15.365l-.877-3.007c5.269-4.678 8.426-7.317 14.167-11.355"/>
        <path fill="#fefefc" d="M530.073 414.272c15.042-11.367 30.76-19.283 50.19-13.189-1.745 1.66-2.631 2.086-4.836 3.065-.791 2.109-.858 2.198-1.35 4.42-8.071-6.088-16.862-4.102-25.604-.462-7.045 1.585-11.684 3.54-18.4 6.166"/>
        <path fill="#0b0001" fill-opacity=".949" d="M465.376 499.255c4.663 9.733.476 16.872 1.904 23.529l-.091 10.172c-3.819 3.225-3.253 6.963-6.212 10.885-1.67-16.012 1.18-29.166 4.399-44.586"/>
        <path fill="url(#chk-grad1)" d="M665.307 354.108c3.47-2.456 4.254-4.233 8.334-1.626 1.78 6.259-1.205 7.328-5.515 11.634l.652 1.215c-5.93 4.089-5.862 5.555-12.673 2.358 3.163-5.417 5.481-8.57 9.202-13.581"/>
        <path fill="#300106" fill-opacity=".898" d="M843.161 347.036c4.394.984 8.508 1.839 12.822 3.167-.13 3.196-.387 4.383.666 7.455-11.492-4.336-29.546-5.627-41.92-6.732 10.953-2.531 13.494-1.313 24.735-.45 2.132.164 2.906-1.945 3.697-3.44"/>
        <path fill="#fefefc" d="m616.662 390.098.042.908c.349 6.283 6.061 19.685-.894 25.911-1.959-3.84-4.905-7.812-7.381-11.406z"/>
        <path fill="#f21714" fill-opacity=".725" d="m668.778 365.331 1.816 1.521c-1.18 4.693-13.219 12.298-17.668 15.167l-1.9-.088c-.8-1.234-1.292-1.853-1.889-3.196 2.398-4.183 4.057-7.119 6.968-11.046 6.811 3.197 6.743 1.731 12.673-2.358"/>
        <path fill="#250008" fill-opacity=".843" d="m855.983 350.203 11.987 4.244.058.505-.982 2.601c-2.719 1.214-4.245.838-7.211.653l-3.186-.548c-1.053-3.072-.796-4.259-.666-7.455"/>
        </g>
        <g id="eye">
          <g transform="translate(543.225 -31.225) scale(-0.25 0.25)">
        <path fill="#fefefc" d="M449.298 790.511c-.684-6.113-2.064-12.416-3.229-19.231-6.129-35.879 15.131-115 64.932-101.032 14.401 4.039 25.856 19.857 32.676 33.513l-5.848.98 6.36 13.237-2.902 2.232c6.153 15.736 7.454 27.806 7.856 44.837l-13.271 1.14c-7.151 1.121-34.301 5.785-40.226 5.382-6.201 1.417-13.616 3.304-19.326 6.122-8.712 4.05-18.606 8.384-27.022 12.82"/>
        <path fill="#590002" d="M506.62 720.42c1.807-1.814 3.048-3.039 5.823-2.796 19.83 1.738 24.839 26.19 24.153 40.348q-.226 4.12-.724 8.215c-7.151 1.121-34.301 5.785-40.226 5.382.346-8.842.552-15.406 2.727-23.966 7.528-8.943 10.492-15.655 8.247-27.183"/>
        <path fill="#f11812" d="M505.323 694.963c20.79-1.785 27.639 7.8 35.964 25.247 6.153 15.736 7.454 27.806 7.856 44.837l-13.271 1.14q.498-4.096.724-8.215c.686-14.158-4.323-38.61-24.153-40.348-2.775-.243-4.016.982-5.823 2.796-5.253-8.178-9.519-10.719-19.052-8.615 2.498-6.833 11.404-12.904 17.755-16.842"/>
        <path fill="#fefefc" d="M487.568 711.805c9.533-2.104 13.799.437 19.052 8.615 2.245 11.528-.719 18.24-8.247 27.183-14.117 2.299-16.753-6.731-19.854-18.032 1.407-9.359 2.687-11.002 9.049-17.766"/>
        <path fill="url(#chk-grad12)" d="M473.371 728.283c1.646.453 3.487 1.043 5.148 1.288 3.101 11.301 5.737 20.331 19.854 18.032-2.175 8.56-2.381 15.124-2.727 23.966-6.201 1.417-13.616 3.304-19.326 6.122-5.499-19.189-5.942-29.976-2.949-49.408"/>
        <path fill="#300106" d="M493.131 693.616c18.365-9.805 32.061-5.522 44.698 11.125l6.36 13.237-2.902 2.232c-8.325-17.447-15.174-27.032-35.964-25.247-5.217-.152-7.085-.323-12.192-1.347"/>
        <path fill="#9b0311" d="M493.131 693.616c5.107 1.024 6.975 1.195 12.192 1.347-6.351 3.938-15.257 10.009-17.755 16.842-6.362 6.764-7.642 8.407-9.049 17.766-1.661-.245-3.502-.835-5.148-1.288 3.153-14.761 8.175-24.614 19.76-34.667"/>
        <path fill="#300106" d="M500.133 655.569c24.076 5.205 43.201 24.748 46.088 49.524l-.54.876-2.004-2.208c-6.82-13.656-18.275-29.474-32.676-33.513-49.801-13.968-71.061 65.153-64.932 101.032 1.165 6.815 2.545 13.118 3.229 19.231l-.84.768c-13.076-37.246-10.101-82.786 14.204-115.458 9.766-13.128 21.596-18.475 37.471-20.252"/>
        <path fill="#250008" d="m541.287 720.21 2.902-2.232c6.175 17.413 6.823 28.434 7.085 46.755 21.33-.929 38.856 3.014 53.363 20.059-4.988-.61-19.866-14.688-27.675-16.046-10.819-1.838-22.321 6.249-33.069 3.277-5.266-1.456-5.426-1.054-9.176 2.182-43.223 4.293-70.382 15.049-105.096 42.067l-3.432-1.527c-1.818-2.473-1.571-2.427-1.693-5.56l7.792-7.159c5.777-4.168 10.079-7.073 16.17-10.747l.84-.768c8.416-4.436 18.31-8.77 27.022-12.82 5.71-2.818 13.125-4.705 19.326-6.122 5.925.403 33.075-4.261 40.226-5.382l13.271-1.14c-.402-17.031-1.703-29.101-7.856-44.837"/>
        <path fill="#0b0001" d="M699.706 755.177c-3.048-20.472 14.101-55.28 25.914-71.177 66.214-89.106 167.781-33.301 178.724 63.951 2.46 21.866 1.875 35.929-4.371 57.384-1.256-15.873.194-30.936-2.728-46.607-3.986 18.932.417 35.939-10.077 55.065-3.202 5.837-11.636 17.661-13.365 22.343-6.841 14.72-24.864 24.434-39.381 29.82-21.422 7.949-48.744 7.189-69.503-2.526a98 98 0 0 1-11.634-6.477c-4.478-2.674-8.5-5.626-11.784-9.681-3.614-4.329-9.608-8.897-12.395-12.412-17.061-21.514-29.906-52.566-29.4-79.683"/>
        <path fill="#fefefc" d="M699.706 755.177c-3.048-20.472 14.101-55.28 25.914-71.177 66.214-89.106 167.781-33.301 178.724 63.951 2.46 21.866 1.875 35.929-4.371 57.384-1.256-15.873.194-30.936-2.728-46.607-3.986 18.932.417 35.939-10.077 55.065-3.202 5.837-11.636 17.661-13.365 22.343-6.562 6.852-11.623 11.962-19.379 17.464 5.08-7.117 13.716-17.408 17.53-24.535 10.375-19.385 14.73-44.977 11.19-66.682-5.192-36.101-35.095-85.201-77.921-77.087-46.319 8.776-62.416 66.038-53.531 106.676 4.868 23.958 20.631 54.773 43.038 66.633 7.239 4.479 12.997 4.959 18.414 8.071-24.385.115-36.079-.525-58.034-10.83l-1.825 1.107c-4.478-2.674-8.5-5.626-11.784-9.681-3.614-4.329-9.608-8.897-12.395-12.412-17.061-21.514-29.906-52.566-29.4-79.683"/>
        <path fill="url(#chk-grad11)" d="M699.706 755.177c-3.048-20.472 14.101-55.28 25.914-71.177 66.214-89.106 167.781-33.301 178.724 63.951 2.46 21.866 1.875 35.929-4.371 57.384-1.256-15.873.194-30.936-2.728-46.607-14.775-98.301-115.865-149.269-178.581-54.616-10.189 15.377-14.926 33.197-18.958 51.065"/>
        <path fill="#614a31" d="m741.501 847.272 13.609 8.574-1.825 1.107c-4.478-2.674-8.5-5.626-11.784-9.681"/>
        <path fill="#f11812" d="M766.37 817.918c-13.833-29.811-16.644-57.021-6.394-88.137 8.79-26.685 41.699-51.389 68.873-38.089 48.415 23.694 64.053 81.387 44.316 127.93a154 154 0 0 1-2.403 5.362c-11.275 1.731-24.033 20.312-38.919 24.721-20.474 6.905-39.184-5.817-52.476-20.311-3.378-3.683-8.445-9.559-12.997-11.476"/>
        <path fill="#590002" d="M774.453 755.863c-15.48-20.113.743-60.322 28.586-43.77 13.538.851 20.639 1.765 32.491 9.95 29.667 20.49 45.264 81.25 14.352 106.436a44.77 44.77 0 0 1-34.432 9.576c-37.509-5.24-47.603-44.717-41.962-76.964q.46-2.619.965-5.228"/>
        <path fill="#fefefc" d="M774.453 755.863c-15.48-20.113.743-60.322 28.586-43.77 23.288 27.919-2.247 65.996-28.586 43.77m69.758 24.924c19 1.756 18.777 25.198 3.027 33.887-18.395 1.462-18.226-23.18-3.027-33.887"/>
        <path fill="#be050c" d="M766.37 817.918c4.552 1.917 9.619 7.793 12.997 11.476 13.292 14.494 32.002 27.216 52.476 20.311 14.886-4.409 27.644-22.99 38.919-24.721-8.11 18.42-18.407 29.191-37.604 36.57a96 96 0 0 1-20.014 5.122c-5.417-3.112-11.175-3.592-18.414-8.071-1.439-4.065-13.099-15.628-16.551-20.292-5.685-7.68-8.165-11.392-11.809-20.395"/>
          </g>
        </g>
      </g>
      <g id="comb">
        <g transform="translate(543.225 -31.225) scale(-0.25 0.25)">
        <path fill="#f11812" fill-opacity=".659" d="m1186.82 318.548 4.31.869c-.6 2.195-1.29 4.273-2.22 6.355l.75.727-2.67 1.315c1.53 6.68 1.54 6.578.62 12.728 3.75-.728 4.45-.853 8.19-.279l-4.99 2.787-4.15 4.854-1.4-2.187c-2.07 1.805-2.17 5.579-2.84 8.858-3.41-2.003-1.88-2.011-4.77-1.292-4.06 12.531 2.61 18.442-11.53 31.295l.15-2.899c-3.3.053-5.77 1.44-7.74 3.89-23.34 29.045-56.33 48.039-85.22 70.966-1.69 1.335-5.36 4.096-7.17 4.831-6.43 2.61-13.24-1.738-9.56 8.561-3.19 6.157-23.88 10.522-28.03 15.648-4-1.453-12.53-6.823-17.02-9.148-16.791-8.706-33.673-15.875-51.243-22.831-12.557-14.381-15.361-6.563-21.628-12.366-1.563-4.61-.345-8.335-.131-15.319.322-10.489-5.628-21.918-12.536-29.973-1.258.006-5.121-.493-5.499-2.551-.424-2.305-8.78-13.154-8.933-13.75 14.801-9.175 62.383-29.286 81.264-33.92 1.988-.488 3.332 1.428 4.359 2.622l.066-.988-1.063-.845.557 2.342c-3.939 2.813-9.234 2.804-12.314 5.628 3.832 1.26 6.384 2.119 9.717 4.497 18.974 2.624 11.924-6.655 14.294-14.405 19.85-4.933 40.7-13.697 63.64-19.488l-1.23 2.41.45.791-.71 1.215c5.24 4.26 14.59 7.751 19.78 1.862-2.48-4.311-1.19 1.287-4.96-2.753 1.61-.423 1.53-.451 3.04-1.157l-2.17-.961c4.75-1.752 3.17-.352 5.58-5.085 1.18 2.261.89 2.929 2.77 3.192 6.7.936 17.46-.377 24.1-.933 26.05-2.136 42.41.959 66.61 1.819 1.66-1.968 1.2-3.748 1.48-6.932m-161-135.945c4.16.627 17.71 2.508 20.95 4.635-4.43 3.42-8.73 15.412-14.32 19.914-16.56 13.327-36.129 22.864-53.538 35.056-4.409 3.433-16.367 13.219-20.539 15.692l-1.579-1.078c-9.535 7.52-19.524 17.514-28.843 24.478 2.548-4.723 13.209-16.246 13.528-18.787-7.736 6.439-34.952 29.344-39.033 37.2l2.123 1.69c2.945-.95 2.962-1.195 5.484-3.1l.626 1.407c-.782 1.034-17.304 17.573-17.902 17.985-1.483-1.672-.949-.656-.851-3.512 2.274-2.404 4.054-2.859 7.084-4.143 1.44-2.766 1.199-4.01.554-7.278-6.439 7.121-11.627 15.223-17.876 22.59-2.65 3.124-10.8 10.258-10.392 14.065.41 3.815 2.258 5.116.48 9.449-9.442 8.203-14.675-4.803-24.651-4.105-3.355.234-11.746.028-14.773-1.239-9.595-1.316-25.103-.446-34.791.088-4.15.229-3.552.578-7.328-1.688l-.32-1.32c12.786-2.672 43.763-3.05 57.137-.326 2.844.579.93.966 3.381-.069l-.698-1.783c-10.48-7.126-48.513-2.829-62.554-2.409-2.207.066-13.186 5.59-14.158 5.606-7.278.117-29.07 8.259-33.794 7.086 4.155-1.129 7.964-1.856 11.648-4.031-1.664-.536-3.961.42-5.828.604-7.859.771-.692-5.414-5.894-8.481-4.606-2.715-15.004-1.803-18.116-4.883-2.545-13.105 6.961-20.937 6.736-26.07-5.329-.39-5.848 3.33-11.206 2.874l-1.085-2.753-1.26-.29-4.875 4.176c2.701-5.471 7.76-8.326 10.536-14.547 1.675-2.196 4.011-3.809 6.197-5.545 8.557-.705 21.663-15.139 31.419-21.096 20.502-12.52 44.628-29.92 66.807-38.922 25.438-10.324 56.848-20.476 83.59-27.141 5.218-1.193 10.273-3.609 15.447-4.828 9.762-2.301 25.912 1.293 32.565-7.929-5.791.499-14.271 1.491-19.77 1.086 2.172-2.167 5.084-2.172 8.602-2.907a125 125 0 0 1 22.035-2.696c17.616-.439 43.115 2.623 59.045-2.725"/>
        <path fill="#a20411" fill-opacity=".133" d="m933.003 280.788.831-.534c9.249-6.039 21.705-17.407 30.782-21.656 16.761-7.847 34.21-11.874 50.784-21.309 10.71-6.096 25.73-21.285 36.33-25.102 5.58 2.164 19.27 11.039 14.47 17.969 4 5.916 5.35 4.83 12.5 4.732 3.6 2.338 2.11.832 4.18 5.078-.32 3.551-7.09 7.455-10.19 9.221-1.32 2.12-1.1 2.194-1.17 4.754l-3.42-4.267-.7.474c1.37 6.017 4.16 1.99 3.97 7.067-.39 10.656-10 18.809-2.07 28.536-12.03 14.608-35.38 39.63-52.92 46.567-5.51-.675-11.28 3.527-16.486 6.44-2.214-1.816-1.611-.639-2.2-3.383l-2.86-.72c-2.465 2.79-2.427 4.335-2.694 8.172-19.744 7.199-39.213 14.174-58.196 23.312-4.377 2.108-12.247 5.694-17.348 6.577-7.169-.869-13.652-6.305-22.741-5.179l-6.662-3.907c4.2-9.651-6.386-16.596-8.284-23.025 21.554-24.433 27.473-35.959 54.094-59.817"/>
        <path fill="#9b0311" fill-opacity=".055" d="M1202.21 339.613c3.1-.251 3.4-.414 6.53.23.77-1.845-1.1 2.901-1.13 2.727.61 4.765-7.97 10.397-8.11 12.381 3.66-1.806 12.29-7.586 14.77-8.088l-1.3-3.011c5.57-1.93 23.06 17.143 26.95 21.7 6.32 2.144 6.49.996 11.62 5.787l3.35 4.528c1.2 5.27.5 7.971-.14 13.306-1.39 6.755-2.41 10.104-4.62 16.632-2.07 4.416-4.97 11.405-8.19 14.798l-1.19-.87-1.07 1.739c-15.8 25.161-43.78 51.363-68.27 68.849-2.22 1.584-12.07 4.414-16.23 6.313l1.47.905c-11.83 4.528-27.29 7.591-37.77 12.284l-2.82 1.078c-5.98 2.02-16.45 4.638-21.18 6.468-3.55-.284-5.63-.533-9.12-1.171-6.77-14.043 5.9-16 16.17-18.571-4-.178-11.68-.179-15.12-1.694-2.85-1.254-1.23-.895-4.85-1.491l-1.85 1.43c-.82 3.89-1.08 4.795-3.24 8.107-10.63-10.303-6.64-11.316-14.1-22.955l.59-.375c4.71 2.456 5.25 3.286 10.02 2.144 1.59-2.901 1.31-1.412 1.04-4.592-2.91-1.348-6.87-.002-10.25.694l-.64-1.194c9.2-5.816 8.84-4.091 11.96-13.983 19.08-6.212 51.32-36.034 67.47-50.017 13.49-11.682 27.5-28.803 36.39-44.329 3.01-5.262 5.42-15.164 7.31-21.468l4.15-4.854 1.79 3.392c3.68 1.804 1.84 1.586 5.69.937 3.3-2.312 3.28-2.8 4.96-6.661z"/>
        <path fill="#300106" fill-opacity=".984" d="M600.884 399.794a457 457 0 0 1 86.654-116.314c19.271-18.605 53.344-47.178 76.33-61.235 67.368-41.2 149.607-66.902 228.925-65.312 31.947.641 75.557 9.068 98.077 33.565a59.06 59.06 0 0 1 15.56 43.478c-2.08 32.459-33.63 66.313-56.59 87.036 11.79-2.116 24.88-6.527 36.98-8.861 37.2-7.176 87.7-11.332 123.56 1.079-5.16 1.066-20.51-2.821-26.92-3.904-14.25-2.411-52.64-3.863-64.99.694 7.25 1.758 13.81 4.047 21.1 5.859-2.51.204-17.99 1.289-19.54 1.773-7.43.497-21.09 1.774-28.17 3.75-7.76.996-12.17 1.829-19.78 3.678-22.94 5.791-43.79 14.555-63.64 19.488-4.08 1.161-8.815 2.221-12.984 3.263 7.044-5.088 14.124-10.106 20.924-15.513 17.54-6.937 40.89-31.959 52.92-46.567.93-1.142 2.19-3.221 3.05-4.519 9.25-9.954 18.85-29.817 19.69-43.549.92-13.617-1.35-20.897-7.82-32.502-4.36-5.77-6.19-7.605-11.84-12.009-12.37-9.303-34.74-17.193-50.03-18.315-150.66-20.297-305.416 64.793-388.656 187.79-4.53 6.694-14.504 20.277-17.032 27.451l-8.233 15.413c2.476 3.594 5.422 7.566 7.381 11.406 1.363 3.513 5.279 14.657 7.426 16.936 7.928-1.443 20.772-2.403 29.153-3.238 8.433-14.783 16.299-23.249 28.194-35.137l.877 3.007c-4.257 5.427-11.555 10.634-14.808 15.365-4.157 6.047-9.309 14.396-13.329 20.767-3.085.677-25.353 2.806-25.264 2.744l6.028.799c-3.758.358-6.285-.166-8.455 1.849l.221 1.278-.594 2.055-4.287-.105c-2.148 2.605-1.293 3.117-1.201 7.624l-1.62-.681c-2.236-15.574-6.351-34.679-20.279-44.032-4.861-2.59-11.398-6.181-16.905-5.379l-.704.314c-19.43-6.094-35.148 1.822-50.19 13.189 6.716-2.626 11.355-4.581 18.4-6.166 23.932 1.602 27.749 7.421 33.876 30.856.335 1.281.018.606.851 1.799-.17 37.466-16.026 65.459-42.059 91.829-15.813 16.017-37.201 29.213-60.306 30.242-15.626.697-24.906-18.321-33.671-.755-2.06-2.278-1.744-4.178-1.907-7.316 3.677-5.447 9.956-8.369 15.72-10.92 2.959-3.922 2.393-7.66 6.212-10.885-.119 5.652-.367 8.901.755 14.538 2.661 11.429 10.056 10.626 20.398 8.628 15.751-2.767 32.82-12.645 44.467-23.335 25.494-23.403 42.555-47.651 44.68-82.517-.498-13.243-2.664-28.918-16.345-34.948-9.298-1.545-15.9-1.673-25.015 2.114-40.191 16.444-64.398 62.226-68.352 103.496-.114 1.187-.071.912-.497 1.852-1.428-6.657 2.759-13.796-1.904-23.529a138 138 0 0 1 7.089-22.717c7.193-17.598 16.852-31.918 29.92-45.735 30.427-32.171 54.728-49.307 98.499-31.009"/>
        <path fill="#a20411" fill-opacity=".027" d="M1221.79 574.138c26.99-9.406 34.27-25.918 54.69-36.839 3.39 3.891 17.45 19.533 21.09 21.731l1.29 2.143 3.99-.107 2.32 2.455c-1.1 3.906-1.58 4.093-4.56 7.094-.7 3.707-.95 2.014.58 5.285 2.09-1.256 1.16-.767 2.22-4.298.41 10.168-6.85 24.982-12.66 33.16-2.28-4.802 1.44-11.879.01-18.32l-1.61.753c-.83 2.29-2.13 8.843-2.96 10-19.57 27.228-46.37 48.23-78.75 57.372l1.36.937a488 488 0 0 1-8.95 2.114l-1.2-.636c-1.46-3.181-1.27-3.015-4.17-4.955l-1.52-.629c-12.57-11.778-20.81-6.074-32.19-18.072-2.26-2.389-1.44-2.092-4.19-3.264l-.13 4.001-1.83.225c-3.07-6.402-5.85-16.938-8.05-20.866l-2.38 5.487c-2.37.804-1.35.982-3.21.202v-2.047c6.66-5.677 5.89-12.563 7.39-22.198 5.6-6.413 45.02-9.606 53.81-17.372.4-.252.81-.503 1.22-.755 6.48.088 12.28-.404 18.39-2.601"/>
        <path fill="#f21714" fill-opacity=".624" d="M1170.92 505.012c5.78 2.044 6.09 8.512 15.7 8.228 14.55-.43 30.28 7.372 44.63-.016 7.29-3.756 12.35-2.732 19.79-.238 2.37.76 1.45 3.836 1.22 5.704l1.6 2.698c2.4.003 2.22-.032 4.58-.438 5.17 2.139 5.22 2.093 5.64 7.68 3.9 3.623 3.33 1.791 7.31 2.114-2.07 5.057-8.69 14.064-12.81 17.398-5.61-1.355-16.6 4.291-17.91 9.838.38.752.95 2.013 1.42 2.64-9.66 8.67-13.18 2.772-20.3 13.518-6.11 2.197-11.91 2.689-18.39 2.601 4.33-1.639 7.28-2.286 10.46-5.636l.11-2.317c-11.07-2.331-22.23 3.046-32.23 5.194-9.16 1.97-26.42-.476-34.68 4.731-1.84 3.117-1.57 1.54-1.34 4.766 1.93.438 2.34.524 4.37.761l-.54.575-13.21.459c-3.34.215-6.54.348-9.85.877l-1.74-2.984c-7.33-13.672-12.68-21.155-22.04-33.219.58-8.8-16.85-16.569-14.02-25.844 6.02-5.712 26.93-10.153 36.18-12.867a76 76 0 0 1 9.72-2.235c7.29-1.109 9.01-.209 14.67 3.937 4.68-.05 6.86-.069 11.46.518l-1.81-.011-.62.716 4.96 1.648.11.891c-8.77 2.612-23.47-3.431-29.83 4.03 4.77 2.675 36.58 4.186 40.26-2.732 2.56-4.828-3.95-4.687-5.28-10.158z"/>
        <path fill="#e8c5cd" fill-opacity=".984" d="M616.662 390.098c2.528-7.174 12.502-20.757 17.032-27.451 83.24-122.997 237.996-208.087 388.656-187.79.42 3.157.12 2.424-1.53 5.865l-1.58.698c-96.742-8.595-214.734 41.485-287.872 103.413-1.961 1.661-3.597 2.947-5.288 4.928-2.186 1.736-4.522 3.349-6.197 5.545-14.273 12.178-44.291 43.411-54.576 58.802-3.721 5.011-6.039 8.164-9.202 13.581-2.911 3.927-4.57 6.863-6.968 11.046-5.708 9.389-9.06 15.047-13.587 25.136-3.109 6.928-8.638 25.124-12.314 29.982-2.147-2.279-6.063-13.423-7.426-16.936 6.955-6.226 1.243-19.628.894-25.911z"/>
        <path fill="#f21714" fill-opacity=".796" d="M719.883 295.306c-2.776 6.221-7.835 9.076-10.536 14.547l4.875-4.176 1.26.29 1.085 2.753c5.358.456 5.877-3.264 11.206-2.874.225 5.133-9.281 12.965-6.736 26.07 3.112 3.08 13.51 2.168 18.116 4.883 5.202 3.067-1.965 9.252 5.894 8.481 1.867-.184 4.164-1.14 5.828-.604-3.684 2.175-7.493 2.902-11.648 4.031 4.724 1.173 26.516-6.969 33.794-7.086.972-.016 11.951-5.54 14.158-5.606 14.041-.42 52.074-4.717 62.554 2.409l.698 1.783c-2.451 1.035-.537.648-3.381.069-13.374-2.724-44.351-2.346-57.137.326l.32 1.32c3.776 2.266 3.178 1.917 7.328 1.688 9.688-.534 25.196-1.404 34.791-.088l-5.413 1.042c-42.54-2.74-99.23 12.576-132.189 39.559-5.741 4.038-8.898 6.677-14.167 11.355-11.895 11.888-19.761 20.354-28.194 35.137-8.381.835-21.225 1.795-29.153 3.238 3.676-4.858 9.205-23.054 12.314-29.982 4.527-10.089 7.879-15.747 13.587-25.136.597 1.343 1.089 1.962 1.889 3.196l1.9.088c4.449-2.869 16.488-10.474 17.668-15.167l-1.816-1.521-.652-1.215c4.31-4.306 7.295-5.375 5.515-11.634-4.08-2.607-4.864-.83-8.334 1.626 10.285-15.391 40.303-46.624 54.576-58.802"/>
        <path fill="#250008" fill-opacity=".988" d="M1139.57 315.879c-7.29-1.812-13.85-4.101-21.1-5.859 12.35-4.557 50.74-3.105 64.99-.694 6.41 1.083 21.76 4.97 26.92 3.904 18.82 3.339 44.42 16.678 55.34 32.814 37.15 54.91-32.11 120.744-75.63 146.196 6.22-.035 12.01-.279 18.17.576-4.68.456-4.87-.323-7.82 2.12-.95 5.7 5.8 6.99 10.15 7.756-12.5-.388-20.6-.839-33.13.46-4.87.065-7.26.276-12.08.987-16-.444-38.16 6.072-46.5 5.684 10.48-4.693 25.94-7.756 37.77-12.284 24.65-5.79 58.29-35.182 75.82-53.89 6.47-5.424 12.69-14.124 17.62-20.92l2.44-3.865c2.71-4.657 5.83-9.839 7.33-14.953 7.62-13.876 7.38-30.107 1.04-44.362-2.15-5.362-5.33-9.502-9.41-13.511-6.95-9.204-22.05-15.265-32.63-18.872-10.4-3.771-16.95-5.635-27.73-7.749l-4.31-.869c-17.08-2.329-30.15-2.49-47.25-2.669"/>
        <path fill="#250008" fill-opacity=".988" d="M923.045 515.246c-.563-1.778-.182-3.497.775-5.021 6.566-10.45-.254-18.769 4.749-29.525 1.567 1.311.822.777 2.19 1.662 2.529-14.081-.372-26.414 1.882-39.966 4.76 3.823 21.218 8.961 27.646 11.2 17.57 6.956 34.452 14.125 51.243 22.831 4.49 2.325 13.02 7.695 17.02 9.148l11.81 8.291c11 8.01 25.34 17.905 34.81 27.328 7.71 7.998 20.98 20.736 27.54 28.752 9.36 12.064 14.71 19.547 22.04 33.219-2.18.961-3.45 1.629-5.77 2.264-8.56-11.476-12.03-18.697-22.48-29.519-5.1-6.949-14.76-16.833-21.19-22.49-23.72-25.113-54.53-43.929-85.246-59.18-17.472-9.16-38.861-17.091-56.973-25.431.194 19.324.152 49.304-10.046 66.437"/>
        <path fill="#9b0311" fill-opacity=".49" d="M978.912 242.208c22.608-3.709 47.828-31.032 72.938-39.462 3.87 2.055 9.37 4.756 12.34 7.838 8.31 8.609 5.4 14.488 17.29 16.941l2.02-1.183c9.45 26.901-10.62 36.767-11.15 54.89-.86 1.298-2.12 3.377-3.05 4.519-7.93-9.727 1.68-17.88 2.07-28.536.19-5.077-2.6-1.05-3.97-7.067l.7-.474 3.42 4.267c.07-2.56-.15-2.634 1.17-4.754 3.1-1.766 9.87-5.67 10.19-9.221-2.07-4.246-.58-2.74-4.18-5.078-7.15.098-8.5 1.184-12.5-4.732 4.8-6.93-8.89-15.805-14.47-17.969-10.6 3.817-25.62 19.006-36.33 25.102-16.574 9.435-34.023 13.462-50.784 21.309-9.077 4.249-21.533 15.617-30.782 21.656l-.831.534c6.133-7.209 17.83-15.861 25.37-22.888 4.172-2.473 16.13-12.259 20.539-15.692"/>
        <path fill="#f11812" fill-opacity=".761" d="M726.08 289.761c1.691-1.981 3.327-3.267 5.288-4.928 73.138-61.928 191.13-112.008 287.872-103.413 3.15 1.162 3.16 1.03 6.58 1.183-15.93 5.348-41.429 2.286-59.045 2.725a125 125 0 0 0-22.035 2.696c-3.518.735-6.43.74-8.602 2.907 5.499.405 13.979-.587 19.77-1.086-6.653 9.222-22.803 5.628-32.565 7.929-5.174 1.219-10.229 3.635-15.447 4.828-26.742 6.665-58.152 16.817-83.59 27.141-22.179 9.002-46.305 26.402-66.807 38.922-9.756 5.957-22.862 20.391-31.419 21.096"/>
        <path fill="#f11812" fill-opacity=".835" d="M1028.55 485.575c4.15-5.126 24.84-9.491 28.03-15.648-3.68-10.299 3.13-5.951 9.56-8.561 1.81-.735 5.48-3.496 7.17-4.831 28.89-22.927 61.88-41.921 85.22-70.966 1.97-2.45 4.44-3.837 7.74-3.89l-.15 2.899c14.14-12.853 7.47-18.764 11.53-31.295 2.89-.719 1.36-.711 4.77 1.292.67-3.279.77-7.053 2.84-8.858l1.4 2.187c-1.89 6.304-4.3 16.206-7.31 21.468-8.89 15.526-22.9 32.647-36.39 44.329-16.15 13.983-48.39 43.805-67.47 50.017-5.51 3.074-11.54 6.758-17.42 8.866-3.74 1.759-2.88 2.017-5.6 3.893-9.56 6.6-12.11 4.579-12.11 17.389z"/>
        <path fill="#a20411" fill-opacity=".02" d="M1205.07 665.302c16.25-2.439 38.89 22.275 42.53 36.983l-1.15 1.326c-2.15-3.689-2.89-5.466-4.52-9.45.05 3.944.23 8.45-.62 12.297-1.16 5.204-7.99 17.795-8.05 22.308-2.56 2.654-4.36 4.703-6.69 7.56l-1.61-.271c.52-.718 3.37-4.646 3.48-5.067 2.01-7.482-11.69-19.774-14.28-25.408l3.97 1.391.78-.376c-4.49-5.566-6.49-9.071-10.51-14.808l-2.23.657c-2.48-2.873-3.92-3.652-6.99-5.761-.09-5.424.5-7.81 5.64-9.35 3.35.783 3.17.732 6.61.369 3.01-2.315 1.8-.861 3.22-4.911-3.24-.719-6.01.038-8.5-2.07-.21-1.861-.58-3.614-1.08-5.419"/>
        <path fill="#a92a27" fill-opacity=".412" d="M1150.09 584.238c12.99-.705 32.33-.817 44.77-4.952 3.69-1.227 4.33-1.874 8.54-2.547-.41.252-.82.503-1.22.755-8.79 7.766-48.21 10.959-53.81 17.372-1.5 9.635-.73 16.521-7.39 22.198v2.047c1.86.78.84.602 3.21-.202l2.38-5.487c2.2 3.928 4.98 14.464 8.05 20.866l1.83-.225.13-4.001c2.75 1.172 1.93.875 4.19 3.264 11.38 11.998 19.62 6.294 32.19 18.072-11.47-1.281-31.57-3.839-41.81 3.721-3.14 2.315-3.53 6.016-4.24 9.698l-.76-4.262c-1.14-19.27-5.99-38.391-11.97-56.667 5.71-3.009 3.87-8.08 11.04-13.914 2.48-1.876 2.66-2.565 4.33-5.161z"/>
        <path fill="#9b0311" fill-opacity=".255" d="M1147.1 682.026c12.79 16.561 21.34 1.943 38.1 2.488l2.47.625c-5.11 2.03-5.04 1.813-7.92 7.625-5.78 11.643-18.89 25.156-23.55 36.723-1.61 4 2.06 17.999 1.24 22.924-1.55-1.931-1.84-2.274-3-4.445l-1.06 1.717c-7.66-18.264-9.64-20.673-9.35-40.257 1.13-9.121 2.15-18.255 3.07-27.4"/>
        <path fill="#9b0311" fill-opacity=".616" d="M978.912 242.208c17.409-12.192 36.978-21.729 53.538-35.056 5.59-4.502 9.89-16.494 14.32-19.914 10.09 5.078 16.18 8.578 25.06 15.677 2.53 2.951 5.08 5.881 7.66 8.789 6.09 9.847 7.02 22.49 12.55 25.979-.84 13.732-10.44 33.595-19.69 43.549.53-18.123 20.6-27.989 11.15-54.89l-2.02 1.183c-11.89-2.453-8.98-8.332-17.29-16.941-2.97-3.082-8.47-5.783-12.34-7.838-25.11 8.43-50.33 35.753-72.938 39.462"/>
        <path fill="#f11812" fill-opacity=".78" d="M999.894 338.758c5.206-2.913 10.976-7.115 16.486-6.44-6.8 5.407-13.88 10.425-20.924 15.513 4.169-1.042 8.904-2.102 12.984-3.263-2.37 7.75 4.68 17.029-14.294 14.405-3.333-2.378-5.885-3.237-9.717-4.497 3.08-2.824 8.375-2.815 12.314-5.628l-.557-2.342 1.063.845-.066.988c-1.027-1.194-2.371-3.11-4.359-2.622-18.881 4.634-66.463 24.745-81.264 33.92.153.596 8.509 11.445 8.933 13.75.378 2.058 4.241 2.557 5.499 2.551 6.908 8.055 12.858 19.484 12.536 29.973-.214 6.984-1.432 10.709.131 15.319 6.267 5.803 9.071-2.015 21.628 12.366-6.428-2.239-22.886-7.377-27.646-11.2.18-7.299-2.72-17.647-4.54-24.867-5.988-23.759-16.091-34.682-34.246-49.992 9.089-1.126 15.572 4.31 22.741 5.179 5.101-.883 12.971-4.469 17.348-6.577 18.983-9.138 38.452-16.113 58.196-23.312 3.567-1.341 4.483-2 7.754-4.069"/>
        <path fill="#a20411" fill-opacity=".698" d="M1148.83 674.453c2.34-9.819 7.92-11.583 16.39-15.133 7.31-3.065 14.21-5.871 22.16-6.483-2.43 1.064-10.48 4.218-11.68 5.894l2.24.792-5.32.693-.17.78c5.57 2.071 10.72 2.559 15.42 4.34 7.23 2.121 9.77 1.459 17.2-.034.5 1.805.87 3.558 1.08 5.419 2.49 2.108 5.26 1.351 8.5 2.07-4.81.245-5.44-.515-8.86 1.721l-.97 2.821c-5.14 1.54-5.73 3.926-5.64 9.35l-.25 4.098c-3.61-2.093-7.49-3.84-11.26-5.642l-2.47-.625c-11.5-6.43-23.61-8.078-36.37-10.061"/>
        <path fill="#f21714" fill-opacity=".773" d="M832.352 343.522c3.027 1.267 11.418 1.473 14.773 1.239 9.976-.698 15.209 12.308 24.651 4.105 1.778-4.333-.07-5.634-.48-9.449-.408-3.807 7.742-10.941 10.392-14.065 6.249-7.367 11.437-15.469 17.876-22.59.645 3.268.886 4.512-.554 7.278-3.03 1.284-4.81 1.739-7.084 4.143-.098 2.856-.632 1.84.851 3.512.598-.412 17.12-16.951 17.902-17.985l-.626-1.407c-2.522 1.905-2.539 2.15-5.484 3.1l-2.123-1.69c4.081-7.856 31.297-30.761 39.033-37.2-.319 2.541-10.98 14.064-13.528 18.787 9.319-6.964 19.308-16.958 28.843-24.478l1.579 1.078c-7.54 7.027-19.237 15.679-25.37 22.888-26.621 23.858-32.54 35.384-54.094 59.817-2.396 3.056-8.419 12.187-10.939 13.842l-11.987-4.244c-4.314-1.328-8.428-2.183-12.822-3.167-5.431-1.424-10.648-1.833-16.222-2.472z"/>
        <path fill="#0b0001" fill-opacity=".988" d="M1208.26 492.816c24.83.561 51.65 5.108 73.08 18.42-5 2.74-5.41 2.467-7.59 7.522l-5.34-2.246c-2.63-2.592-11.48-5.522-15.27-6.89-5.71-2.822-19.11-5.415-25.56-5.406-5.68-.779-11.28-1.108-16.99-1.524-4.35-.766-11.1-2.056-10.15-7.756 2.95-2.443 3.14-1.664 7.82-2.12"/>
        <path fill="#f21714" fill-opacity=".416" d="M1165.38 504.139c4.82-.711 7.21-.922 12.08-.987 9.44 1.48 8.86 4.057 14.68 7.099 2.81 1.466 20.14-4.266 23.45-4.593 4.23-.777 8.36-.693 11.99-1.442 6.45-.009 19.85 2.584 25.56 5.406l.08 1.375c5.68 4.82 11.73 7.878 16.25 13.149 1.03 1.198.42.61 2.21 1.715l1.3 1.079-1.59 3.804c-3.98-.323-3.41 1.509-7.31-2.114-.42-5.587-.47-5.541-5.64-7.68-2.36.406-2.18.441-4.58.438l-1.6-2.698c.23-1.868 1.15-4.944-1.22-5.704-7.44-2.494-12.5-3.518-19.79.238-14.35 7.388-30.08-.414-44.63.016-9.61.284-9.92-6.184-15.7-8.228-1.89-.15-3.67-.536-5.54-.873"/>
        <path fill="#f21714" fill-opacity=".792" d="M1150.09 584.238c-2.03-.237-2.44-.323-4.37-.761-.23-3.226-.5-1.649 1.34-4.766 8.26-5.207 25.52-2.761 34.68-4.731 10-2.148 21.16-7.525 32.23-5.194l-.11 2.317c-3.18 3.35-6.13 3.997-10.46 5.636-4.21.673-4.85 1.32-8.54 2.547-12.44 4.135-31.78 4.247-44.77 4.952"/>
        <path fill="#f21714" fill-opacity=".675" d="M1118.88 509.823c8.34.388 30.5-6.128 46.5-5.684 1.87.337 3.65.723 5.54.873l-2.41 2.827c1.33 5.471 7.84 5.33 5.28 10.158-3.68 6.918-35.49 5.407-40.26 2.732 6.36-7.461 21.06-1.418 29.83-4.03l-.11-.891-4.96-1.648.62-.716 1.81.011c-4.6-.587-6.78-.568-11.46-.518-5.66-4.146-7.38-5.046-14.67-3.937a76 76 0 0 0-9.72 2.235c-2.62.022-6.12-.221-8.81-.334z"/>
        <path fill="#a92a27" fill-opacity=".553" d="M1040.36 493.866c0-12.81 2.55-10.789 12.11-17.389 2.72-1.876 1.86-2.134 5.6-3.893l-.02 1.046c-3.26 3.306-4.43 9.955-7.33 15.052 9.23 9.35 23.18 28.303 35.91 29.665-3.72.491-8.74.596-11.46 2.847-9.47-9.423-23.81-19.318-34.81-27.328"/>
        <path fill="#a92a27" fill-opacity=".384" d="M1050.72 488.682c2.9-5.097 4.07-11.746 7.33-15.052.05 13.305 5.16 26.486 17.99 32.553 1.15-1.379.95-.62.83-2.204 2.16-3.312 2.42-4.217 3.24-8.107l1.85-1.43c3.62.596 2 .237 4.85 1.491 3.44 1.515 11.12 1.516 15.12 1.694-10.27 2.571-22.94 4.528-16.17 18.571 3.49.638 5.57.887 9.12 1.171-3.07.525-5.09.956-8.25.978-12.73-1.362-26.68-20.315-35.91-29.665"/>
        <path fill="#e8c5cd" fill-opacity=".914" d="M1139.57 315.879c17.1.179 30.17.34 47.25 2.669-.28 3.184.18 4.964-1.48 6.932-24.2-.86-40.56-3.955-66.61-1.819l1.92-2.067-.13.417 2.93-1.609-1.2.852 1.31-.622-.06-.671-1.3.786c-1.9-1.161-1.03-.505-2.17-3.095 1.55-.484 17.03-1.569 19.54-1.773"/>
        <path fill="#9b0311" fill-opacity=".604" d="m1271.39 530.744 1.59-3.804c11.84 8.345 22.62 16.67 24.59 32.09-3.64-2.198-17.7-17.84-21.09-21.731-20.42 10.921-27.7 27.433-54.69 36.839 7.12-10.746 10.64-4.848 20.3-13.518 6.87-4.246 10.58-7.152 16.49-12.478 4.12-3.334 10.74-12.341 12.81-17.398"/>
        <path fill="#f93674" fill-opacity=".678" d="M1022.35 174.857c15.29 1.122 37.66 9.012 50.03 18.315l-.02 1.722c-.02 2.335.14 3.62.41 5.926l-.94 2.095c-8.88-7.099-14.97-10.599-25.06-15.677-3.24-2.127-16.79-4.008-20.95-4.635-3.42-.153-3.43-.021-6.58-1.183l1.58-.698c1.65-3.441 1.95-2.708 1.53-5.865"/>
        <path fill="#f754a2" fill-opacity=".827" d="M1218.86 327.166c10.58 3.607 25.68 9.668 32.63 18.872.56 4.267.39 9.08-1.97 12.831-6.91-8.911-8.61-11.429-18.31-17.288-4.34-2.436-9.33-4.585-13.87-6.985 0-4.885-.71-3.894 1.52-7.43"/>
        <path fill="#9b0311" fill-opacity=".639" d="m1147.03 668.747 1.37 5.711.43-.005c12.76 1.983 24.87 3.631 36.37 10.061-16.76-.545-25.31 14.073-38.1-2.488z"/>
        <path fill="#a20411" fill-opacity=".98" d="M1189.66 326.499c7.17 1.522 20.76 5.263 27.68 8.097 4.54 2.4 9.53 4.549 13.87 6.985-4.06.022-9.5-.116-13.42.331-3.08-.82-5.93-1.416-9.05-2.069-3.13-.644-3.43-.481-6.53-.23l-6.41.65c-3.74-.574-4.44-.449-8.19.279.92-6.15.91-6.048-.62-12.728z"/>
        <path fill="#a20411" fill-opacity=".522" d="M1146.91 664.817c.71-3.682 1.1-7.383 4.24-9.698 10.24-7.56 30.34-5.002 41.81-3.721l1.52.629c-1.22.127-6.22.561-7.1.81-7.95.612-14.85 3.418-22.16 6.483-8.47 3.55-14.05 5.314-16.39 15.133l-.43.005-1.37-5.711z"/>
        <path fill="#a20411" fill-opacity=".204" d="M1208.74 339.843c3.12.653 5.97 1.249 9.05 2.069 13.66 3.05 29.09 16.382 33.75 29.427-5.13-4.791-5.3-3.643-11.62-5.787-3.89-4.557-21.38-23.63-26.95-21.7l1.3 3.011c-2.48.502-11.11 6.282-14.77 8.088.14-1.984 8.72-7.616 8.11-12.381.03.174 1.9-4.572 1.13-2.727"/>
        <path fill="#0b0001" fill-opacity=".988" d="m1124.75 583.165 1.74 2.984c1.87 4.333 5.68 13.967 7.69 17.739 5.98 18.276 10.83 37.397 11.97 56.667-9.11-30.409-9.88-44.79-27.17-75.126 2.32-.635 3.59-1.303 5.77-2.264"/>
        <path fill="#f754a2" d="M1260.9 359.549c6.34 14.255 6.58 30.486-1.04 44.362l-1.01-.415c-.44-6.181.25-9.571-4.1-14.323.64-5.335 1.34-8.036.14-13.306l.04-2.756c.66-3.202 4.44-10.612 5.97-13.562"/>
        <path fill="#9b0311" fill-opacity=".341" d="M1058.07 472.584c5.88-2.108 11.91-5.792 17.42-8.866-3.12 9.892-2.76 8.167-11.96 13.983l.64 1.194c3.38-.696 7.34-2.042 10.25-.694.27 3.18.55 1.691-1.04 4.592-4.77 1.142-5.31.312-10.02-2.144l-.59.375c7.46 11.639 3.47 12.652 14.1 22.955.12 1.584.32.825-.83 2.204-12.83-6.067-17.94-19.248-17.99-32.553z"/>
        <path fill="#f21714" fill-opacity=".925" d="M1094.88 517.369c4.73-1.83 15.2-4.448 21.18-6.468 2.69.113 6.19.356 8.81.334-9.25 2.714-30.16 7.155-36.18 12.867-2.83 9.275 14.6 17.044 14.02 25.844-6.56-8.016-19.83-20.754-27.54-28.752 2.72-2.251 7.74-2.356 11.46-2.847 3.16-.022 5.18-.453 8.25-.978"/>
        <path fill="#f21714" fill-opacity=".137" d="M1177.46 503.152c12.53-1.299 20.63-.848 33.13-.46 5.71.416 11.31.745 16.99 1.524-3.63.749-7.76.665-11.99 1.442-3.31.327-20.64 6.059-23.45 4.593-5.82-3.042-5.24-5.619-14.68-7.099"/>
        <path fill="#a20411" fill-opacity=".949" d="M1231.21 341.581c9.7 5.859 11.4 8.377 18.31 17.288 2.05 4.731 4.27 9.235 5.41 14.242l-.04 2.756-3.35-4.528c-4.66-13.045-20.09-26.377-33.75-29.427 3.92-.447 9.36-.309 13.42-.331"/>
        <path fill="#f93674" fill-opacity=".416" d="M1084.22 205.181c6.47 11.605 8.74 18.885 7.82 32.502-5.53-3.489-6.46-16.132-12.55-25.979z"/>
        <path fill="#9b0311" fill-opacity=".655" d="M1126.49 586.149c3.31-.529 6.51-.662 9.85-.877 3.04 5.358 2.28 5.281 8.88 4.702-7.17 5.834-5.33 10.905-11.04 13.914-2.01-3.772-5.82-13.406-7.69-17.739"/>
        <path fill="#f754a2" fill-opacity=".953" d="M1242.07 421.678c2.71.464 5.31 1.096 8.02 1.051-4.93 6.796-11.15 15.496-17.62 20.92-1.72-1.856-1.63-1.697-2.25-4.152 1.86-6.002 7.81-12.657 11.85-17.819"/>
        <path fill="#f754a2" fill-opacity=".98" d="M1254.75 389.173c4.35 4.752 3.66 8.142 4.1 14.323l1.01.415c-1.5 5.114-4.62 10.296-7.33 14.953-2.3-5.425-2.16-7.256-2.4-13.059 2.21-6.528 3.23-9.877 4.62-16.632"/>
        <path fill="#c8277c" fill-opacity=".118" d="M1233.26 728.766c.06-4.513 6.89-17.104 8.05-22.308.85-3.847.67-8.353.62-12.297 1.63 3.984 2.37 5.761 4.52 9.45l1.15-1.326c.61 2.178 1.83 6.494.62 8.167-2.57 3.526-12.22 16.001-14.96 18.314"/>
        <path fill="#e8c5cd" fill-opacity=".965" d="M1091.86 321.402c7.08-1.976 20.74-3.253 28.17-3.75 1.14 2.59.27 1.934 2.17 3.095l1.3-.786.06.671-1.31.622 1.2-.852-2.93 1.609.13-.417-1.92 2.067c-6.64.556-17.4 1.869-24.1.933-1.88-.263-1.59-.931-2.77-3.192"/>
        <path fill="#f93674" fill-opacity=".859" d="M1251.49 346.038c4.08 4.009 7.26 8.149 9.41 13.511-1.53 2.95-5.31 10.36-5.97 13.562-1.14-5.007-3.36-9.511-5.41-14.242 2.36-3.751 2.53-8.564 1.97-12.831"/>
        <path fill="#a92a27" fill-opacity=".753" d="M1194.48 652.027c2.9 1.94 2.71 1.774 4.17 4.955l1.2.636c-4.81 1.106-7.38 1.576-12.28 2.073-3.3.13-6.34-.036-9.63-.168l-2.24-.792c1.2-1.676 9.25-4.83 11.68-5.894.88-.249 5.88-.683 7.1-.81"/>
        <path fill="#f93674" fill-opacity=".627" d="M1072.38 193.172c5.65 4.404 7.48 6.239 11.84 12.009l-4.73 6.523a687 687 0 0 1-7.66-8.789l.94-2.095c-.27-2.306-.43-3.591-.41-5.926z"/>
        <path fill="#f21714" fill-opacity=".878" d="m1071.3 328.281 14.98-1.794 2.17.961c-1.51.706-1.43.734-3.04 1.157 3.77 4.04 2.48-1.558 4.96 2.753-5.19 5.889-14.54 2.398-19.78-1.862z"/>
        <path fill="#f21714" fill-opacity=".671" d="M1242.09 560.62c-.47-.627-1.04-1.888-1.42-2.64 1.31-5.547 12.3-11.193 17.91-9.838-5.91 5.326-9.62 8.232-16.49 12.478"/>
        <path fill="#f754a2" fill-opacity=".855" d="M1241.94 420.603c3.22-3.393 6.12-10.382 8.19-14.798.24 5.803.1 7.634 2.4 13.059l-2.44 3.865c-2.71.045-5.31-.587-8.02-1.051z"/>
        <path fill="#f11812" fill-opacity=".349" d="M1253.14 509.622c3.79 1.368 12.64 4.298 15.27 6.89.82 2.039 2.82 8.483 3.27 9.349-1.79-1.105-1.18-.517-2.21-1.715-4.52-5.271-10.57-8.329-16.25-13.149z"/>
        <path fill="#ebbec4" fill-opacity=".035" d="M1072.08 325.08c7.61-1.849 12.02-2.682 19.78-3.678-2.41 4.733-.83 3.333-5.58 5.085l-14.98 1.794-.45-.791z"/>
        <path fill="#a20411" fill-opacity=".024" d="m1195.8 340.263 6.41-.65 1.04 1.105c-1.68 3.861-1.66 4.349-4.96 6.661-3.85.649-2.01.867-5.69-.937l-1.79-3.392z"/>
        <path fill="#300106" fill-opacity=".729" d="M1177.94 659.523c3.29.132 6.33.298 9.63.168l.3 5.645c-4.7-1.781-9.85-2.269-15.42-4.34l.17-.78z"/>
        <path fill="#9b0311" fill-opacity=".722" d="m1136.34 585.272 13.21-.459c-1.67 2.596-1.85 3.285-4.33 5.161-6.6.579-5.84.656-8.88-4.702"/>
        <path fill="#9b0311" fill-opacity=".149" d="M992.14 342.827c.267-3.837.229-5.382 2.694-8.172l2.86.72c.589 2.744-.014 1.567 2.2 3.383-3.271 2.069-4.187 2.728-7.754 4.069"/>
        <path fill="#be050c" fill-opacity=".875" d="M1214.65 672.791c-1.42 4.05-.21 2.596-3.22 4.911-3.44.363-3.26.414-6.61-.369l.97-2.821c3.42-2.236 4.05-1.476 8.86-1.721"/>
        <path fill="#a20411" fill-opacity=".624" d="M1199.18 686.683c3.07 2.109 4.51 2.888 6.99 5.761-3.64 1.584-4.15.309-7.24-1.663z"/>
        </g>
      </g>
      <g id="beak">
        <g transform="translate(543.225 -31.225) scale(-0.25 0.25)">
        <path fill="#0b0001" d="M534.717 774.205c3.75-3.236 3.91-3.638 9.176-2.182 10.748 2.972 22.25-5.115 33.069-3.277 7.809 1.358 22.687 15.436 27.675 16.046 9.443 10.25 12.221 21.564 17.789 34 15.498 34.615 43.81 38.995 77.402 38.173l-10.436 8.427c-.914 15.189-1.069 27.353 1.598 42.369 17.353 97.689 138.867 93.399 210.018 64.511l1.174 1.784c-13.18 5.322-24.233 9.366-38.206 12.97-65.582 13.544-139.213 12.274-173.145-55.49-17.047 30.511-35.123 62.092-60.003 87.044-29.564 29.65-65.934 56.94-109.449 57.55-5.779-1.04-10.848-2.32-16.533-3.74-17.628-7.83-20.865-17.49-25.386-35.16-2.208-13.16-5.706-26.79-8.021-40.784 4.087.346 4.747-.273 8.667-2.005-.812-10.79-3.894-39.852-2.402-49.499a325 325 0 0 0 16.982-3.114c2.593 22.397 3.341 43.233 6.935 65.672 1.671 10.44 9.361 32.82 9.962 39.74 9.846-1.16 21.928-9.15 30.486-14.38 38.963-23.81 73.1-52.598 102.011-88.06 4.976-7.644 23.931-36.439 30.489-39.878 2.209-1.159 3.769-2.054 5.606-3.738l-.316-1.998 1.542-1.774c-.56-11.884-.318-22.404 1.253-34.172-4.753-.116-9.814-.462-14.591-.7-14.647 26.113-64.772 42.65-93.515 42.52 13.396-4.658 32.621-18.272 40.177-30.827 1.86-16.144-9.29-56.039-17.342-70.91-3.56-6.574-8.59-13.235-14.277-18.286l-.053-1.724 3.839-1.316-3.825-1.326c-14.518-7.124-32.561-6.644-48.35-6.466"/>
        <path fill="#f5aa05" d="M477.704 944.942a325 325 0 0 0 16.982-3.114c2.593 22.397 3.341 43.233 6.935 65.672 1.671 10.44 9.361 32.82 9.962 39.74 9.846-1.16 21.928-9.15 30.486-14.38 38.963-23.81 73.1-52.598 102.011-88.06l8.113.572.899 1.052c-2.088 6.543-9.824 14.418-14.611 20.083-29.339 34.723-64.253 65.313-102.628 89.673-7.351 4.66-19.888 6.82-28.146 7.92-22.856-9.48-25.33-48.39-27.601-69.659-.812-10.79-3.894-39.852-2.402-49.499"/>
        <path fill="#8b3f06" d="M477.704 944.942a325 325 0 0 0 16.982-3.114c2.593 22.397 3.341 43.233 6.935 65.672 1.671 10.44 9.361 32.82 9.962 39.74-33.094-14.04-15.289-80.987-33.879-102.298"/>
        <path fill="#b05403" d="m679.859 899.186 1.542-1.774c1.564 8.163 2.735 14.848 5.27 22.781-29.43 55.759-76.891 121.197-139.321 143.507-12.53 4.48-26.912 4.6-39.643.4 8.258-1.1 20.795-3.26 28.146-7.92 38.375-24.36 73.289-54.95 102.628-89.673 4.787-5.665 12.523-13.54 14.611-20.083l-.899-1.052-8.113-.572c4.976-7.644 23.931-36.439 30.489-39.878 2.209-1.159 3.769-2.054 5.606-3.738z"/>
        <path fill="url(#chk-grad14)" d="M586.892 781.997c35.878 24.153 15.7 69.137 81.171 80.543-14.647 26.113-64.772 42.65-93.515 42.52 13.396-4.658 32.621-18.272 40.177-30.827 1.86-16.144-9.29-56.039-17.342-70.91-3.56-6.574-8.59-13.235-14.277-18.286l-.053-1.724z"/>
        <path fill="#f5aa05" d="M534.717 774.205c15.789-.178 33.832-.658 48.35 6.466l3.825 1.326-3.839 1.316.053 1.724c5.687 5.051 10.717 11.712 14.277 18.286 8.052 14.871 19.202 54.766 17.342 70.91-4.091.214-9.626-.038-12.962 1.63l.284.751c-4.876.786-9.395 1.561-14.328 2.016l-3.513-2.084c-3.782.319-8.019.386-11.848.536-1.995.288-12.319 1.331-13.021 1.633-5.645.434-12.113 1.103-17.71 1.16-5.943.93-20.572 2.301-25.414 3.473-46.642 7.912-77.352 21.016-118.5 42.068-8.416 5.843-16.469 11.388-24.573 17.69-10.179 8.373-15.249 12.966-23.731 22.98-4.836 8.354-6.856 13.921-10.943 21.852l-.427.281-.859-.564c-.097-1.487-.234-3.152-.074-4.642 4.643-43.14 21.887-86.229 48.054-120.81 12.712-16.799 28.622-31.943 44.461-45.931 34.714-27.018 61.873-37.774 105.096-42.067"/>
        <path fill="#fefefc" d="M534.717 774.205c15.789-.178 33.832-.658 48.35 6.466-10.551.299-19.696-2.546-31.357-.781-48.144 7.289-97.034 30.732-131.675 65.138-26.709 26.693-62.004 85.137-70.626 121.058-4.836 8.354-6.856 13.921-10.943 21.852l-.427.281-.859-.564c-.097-1.487-.234-3.152-.074-4.642 4.643-43.14 21.887-86.229 48.054-120.81 12.712-16.799 28.622-31.943 44.461-45.931 34.714-27.018 61.873-37.774 105.096-42.067"/>
        <path fill="#d45e02" d="M397.713 925.416c5.222-7.032 23.747-15.562 31.726-19.551 32.987-16.493 65.102-28.4 102.458-29.075 3.239.436 6.99.582 9.66 2.278l.07.807c-5.943.93-20.572 2.301-25.414 3.473-46.642 7.912-77.352 21.016-118.5 42.068"/>
        <path fill="#cd6f07" d="M531.897 876.79c16.03-1.638 24.742-.53 40.461.292-1.995.288-12.319 1.331-13.021 1.633-5.645.434-12.113 1.103-17.71 1.16l-.07-.807c-2.67-1.696-6.421-1.842-9.66-2.278"/>
        <path fill="#8b3f06" d="m601.763 875.863.284.751c-4.876.786-9.395 1.561-14.328 2.016l-3.513-2.084c2.886-.835 14.156-.693 17.557-.683"/>
        <path fill="url(#chk-grad8)" d="M445.257 554.761c.163 3.138-.153 5.038 1.907 7.316.567 2.096 1.006 3.348 1.242 5.525 1.106 4.301 1.172 6.075 3.901 9.382 4.571 12.55 10.921 26.773 23.777 32.618l-1.398 3.757c-2.901 7.451-6.043 13.342-9.724 20.458-16.927 37.347-36.847 97.885-38.227 139.058-2.599 7.13-2.932 28.532-2.239 36.31.122 3.133-.125 3.087 1.693 5.56l3.432 1.527c-15.839 13.988-31.749 29.132-44.461 45.931-26.167 34.581-43.411 77.67-48.054 120.81-.16 1.49-.023 3.155.074 4.642l.859.564.427-.281c3.526-1.283 4.46-1.338 6.886-4.264 11.191-9.36 24.443-15.669 37.359-22.303 81.282-32.265 153.845-32.887 238.561-47.054 17.054-2.852 41.306-10.256 58.587-15.131l.316 1.998c-1.837 1.684-3.397 2.579-5.606 3.738-6.558 3.439-25.513 32.234-30.489 39.878-28.911 35.462-63.048 64.25-102.011 88.06-8.558 5.23-20.64 13.22-30.486 14.38-.601-6.92-8.291-29.3-9.962-39.74-3.594-22.439-4.342-43.275-6.935-65.672a325 325 0 0 1-16.982 3.114c-1.492 9.647 1.59 38.709 2.402 49.499-3.92 1.732-4.58 2.351-8.667 2.005a476 476 0 0 1-4.533-49.221 1233 1233 0 0 1-22.81 4.887l-7.815 2.253c-5.126.88-7.084 1.521-12.02 3.255-36.677 11.68-72.63 22.596-93.348 56.6.345-10.07-.342-20.77-.039-31.015 1.952-66.005 32.228-118.573 78.746-163.089 4.276-80.236 18.051-140.746 54.463-213.369-11.936-11.814-29.215-35.047-18.826-51.986m213.106 358.763c-30.744 7.262-59.476 11.668-90.709 16.832l-34.143 5.231c-10.442 1.477-21.272 2.856-31.641 4.616l1.78 12.167.475 4.624c-.167 10.055 1.303 23.68 2.124 33.96.946 7.495 1.821 15.866 3.22 23.206 1.046 5.74 2.935 20.17 6.788 23.53l1.099.16c37.662-22.75 66.524-44.21 98.488-74.4 8.667-4.563 34.764-39.927 42.519-49.926"/>
        <path fill="#b05403" fill-opacity=".988" d="M668.063 862.54c4.777.238 9.838.584 14.591.7-1.571 11.768-1.813 22.288-1.253 34.172l-1.542 1.774c-17.281 4.875-41.533 12.279-58.587 15.131-84.716 14.167-157.279 14.789-238.561 47.054l-.692-.805c-6.916.167-13.854 7.518-18.814 2.887l.246-4.014c2.294-2.56 11.668-10.095 14.732-12.664 4.635-3.503 8.061-6.127 13.103-9.137 3.573 1.614 25.925-4.642 31.607-6.271 51.238-14.684 98.784-20.25 151.655-26.307 28.743.13 78.868-16.407 93.515-42.52"/>
        <path fill="#f5aa05" d="M601.763 875.863c3.336-1.668 8.871-1.416 12.962-1.63-7.556 12.555-26.781 26.169-40.177 30.827-52.871 6.057-100.417 11.623-151.655 26.307-5.682 1.629-28.034 7.885-31.607 6.271 34.414-23.822 88.36-42.07 129.273-50.821-2.352-3.201-.881-2.177-4.346-3.469 4.842-1.172 19.471-2.543 25.414-3.473 5.597-.057 12.065-.726 17.71-1.16.702-.302 11.026-1.345 13.021-1.633 3.829-.15 8.066-.217 11.848-.536l3.513 2.084c4.933-.455 9.452-1.23 14.328-2.016z"/>
        <path fill="#0b0001" d="M559.337 878.715c1.378 1.69 1.21.97 1.538 2.865-14.231 1.407-26.683 3.664-40.316 5.237-2.352-3.201-.881-2.177-4.346-3.469 4.842-1.172 19.471-2.543 25.414-3.473 5.597-.057 12.065-.726 17.71-1.16"/>
        <path fill="#590002" d="m584.206 876.546 3.513 2.084q-13.44 1.307-26.844 2.95c-.328-1.895-.16-1.175-1.538-2.865.702-.302 11.026-1.345 13.021-1.633 3.829-.15 8.066-.217 11.848-.536"/>
        <path fill="#0b0001" fill-opacity=".984" d="M397.713 925.416c41.148-21.052 71.858-34.156 118.5-42.068 3.465 1.292 1.994.268 4.346 3.469-40.913 8.751-94.859 26.999-129.273 50.821-5.042 3.01-8.468 5.634-13.103 9.137l-1.753-3.157-3.29-.512c8.104-6.302 16.157-11.847 24.573-17.69"/>
        <path fill="url(#chk-grad3)" d="m373.14 943.106 3.29.512 1.753 3.157c-3.064 2.569-12.438 10.104-14.732 12.664-7.232 7.158-13.908 14.807-18.099 24.235-2.426 2.926-3.36 2.981-6.886 4.264 4.087-7.931 6.107-13.498 10.943-21.852 8.482-10.014 13.552-14.607 23.731-22.98"/>
        <path fill="#f5aa05" fill-opacity=".988" d="M426.735 772.875c1.36-2.046 1.931-2.707 2.127-5.172l1.057-.814c1.931 7.799-1.915 22.997 2.369 35.137l-7.792 7.159c-.693-7.778-.36-29.18 2.239-36.31"/>
        <path fill="#d45e02" fill-opacity=".969" d="m363.451 959.439-.246 4.014c4.96 4.631 11.898-2.72 18.814-2.887l.692.805c-12.916 6.634-26.168 12.943-37.359 22.303 4.191-9.428 10.867-17.077 18.099-24.235"/>
        </g>
      </g>
      <g id="wattle">
        <g transform="translate(543.225 -31.225) scale(-0.25 0.25)">
        <path fill="#f11812" fill-opacity=".98" d="m576.571 959.405 2.036.117c11.734.57 25.575-2.695 37.237 3.928-31.964 30.19-60.826 51.65-98.488 74.4-.253-13.82 1.168-17.48 6.798-29.44 13.944-23.583 27.237-38.088 52.417-49.005"/>
        <path fill="#7f0213" fill-opacity=".929" d="M567.654 930.356c31.233-5.164 59.965-9.57 90.709-16.832-7.755 9.999-33.852 45.363-42.519 49.926-11.662-6.623-25.503-3.358-37.237-3.928l-2.036-.117c9.272-6.93 22.563-10.619 32.194-17.254-27.839 8.944-42.632 10.871-64.526 30.689.032-11.884 24.315-21.842 34.223-23.796 4.273-4.521 7.592-7.081 4.929-13.428-4.868-4.423-9.24-4.471-15.737-5.26"/>
        <path fill="#7f0213" fill-opacity=".639" d="M514.062 952.61c.349 4.301-.426 4.697 1.912 6.983 2.819-.601 4.777-3.172 6.135-5.7.044 2.515-.227 4.891-.576 7.376l1.199.678c2.106-1.825 2.084-1.977 3.631-4.347 4.197-.415 2.491-.944 5.633.603-.765 4.054-1.864 3.001-4.758 6.648-.375.196-2.035 1.619-2.426 1.943l.804 1.234c8.341-1.734 17.263-8.972 23.846-8.72l-6.615 5.565c-10.701 9.051-19.094 23.757-20.537 37.777-8.818 5.36-.594 10.66-9.585 9.48-.178-3.51 2.628-9.5 3.734-13.602-3.002-3.14-5.834-6.52-10.21-7.574-.821-10.28-2.291-23.905-2.124-33.96l1.037 1.323 3.65.262c4.486-2.391 2.999-.942 5.25-5.969"/>
        <path fill="#7f0213" fill-opacity=".749" d="m533.511 935.587 34.143-5.231c6.497.789 10.869.837 15.737 5.26 2.663 6.347-.656 8.907-4.929 13.428-9.908 1.954-34.191 11.912-34.223 23.796-10.983 13.133-15.853 18.961-21.466 35.02l-1.153 1.38c-1.645 1.98-2.285 3.1-3.606 5.3-3.407 1.48-4.254.6-8.545-.38-1.399-7.34-2.274-15.711-3.22-23.206 4.376 1.054 7.208 4.434 10.21 7.574-1.106 4.102-3.912 10.092-3.734 13.602 8.991 1.18.767-4.12 9.585-9.48 1.443-14.02 9.836-28.726 20.537-37.777l6.615-5.565c6.356-4.939 8.676-7.063 16.47-8.961 2.236-2.092 1.466-1.278 2.806-4.293-2.942-12.16-32.493-5.429-41.465-3.689 2.256-4.053 2.314-4.203 6.238-6.778"/>
        <path fill="#7f0213" fill-opacity=".537" d="M527.273 942.365c8.972-1.74 38.523-8.471 41.465 3.689-1.34 3.015-.57 2.201-2.806 4.293-4.15-1.191-6.216-2.301-10.18-1.214-2.433 2.374-2.591 3.243-3.893 6.309-4.687 3.253-6.747 1.306-12.099-.525-6.189 5.952-3.106 7.024-12.522 9.934 2.894-3.647 3.993-2.594 4.758-6.648-3.142-1.547-1.436-1.018-5.633-.603-1.547 2.37-1.525 2.522-3.631 4.347l-1.199-.678c.349-2.485.62-4.861.576-7.376l-8.047-1.283c4.434-.71 6.739-.661 10.351-3.082 1.853-3.126 1.733-2.904 2.13-6.534z"/>
        <path fill="url(#chk-grad7)" d="M608.765 942.151c-9.631 6.635-22.922 10.324-32.194 17.254-25.18 10.917-38.473 25.422-52.417 49.005l-1.381-.55c5.613-16.059 10.483-21.887 21.466-35.02 21.894-19.818 36.687-21.745 64.526-30.689"/>
        <path fill="#7f0213" fill-opacity=".035" d="M503.65 952.37c.099-6.433 1.104-9.377 8.406-9.566 4.686-.121 9.769.146 14.487.19-.397 3.63-.277 3.408-2.13 6.534-3.612 2.421-5.917 2.372-10.351 3.082-2.251 5.027-.764 3.578-5.25 5.969l-3.65-.262-1.037-1.323z"/>
        <path fill="#590002" fill-opacity=".976" d="m522.773 1007.86 1.381.55c-5.63 11.96-7.051 15.62-6.798 29.44l-1.099-.16c-3.853-3.36-5.742-17.79-6.788-23.53 4.291.98 5.138 1.86 8.545.38 1.321-2.2 1.961-3.32 3.606-5.3z"/>
        <path fill="#7f0213" fill-opacity=".592" d="M527.238 964.851c9.416-2.91 6.333-3.982 12.522-9.934 5.352 1.831 7.412 3.778 12.099.525 1.302-3.066 1.46-3.935 3.893-6.309 3.964-1.087 6.03.023 10.18 1.214-7.794 1.898-10.114 4.022-16.47 8.961-6.583-.252-15.505 6.986-23.846 8.72l-.804-1.234c.391-.324 2.051-1.747 2.426-1.943"/>
        <path fill="#7f0213" fill-opacity=".886" d="M501.87 940.203c10.369-1.76 21.199-3.139 31.641-4.616-3.924 2.575-3.982 2.725-6.238 6.778l-.73.629c-4.718-.044-9.801-.311-14.487-.19-7.302.189-8.307 3.133-8.406 9.566z"/>
        <path fill="#7f0213" fill-opacity=".655" d="m514.062 952.61 8.047 1.283c-1.358 2.528-3.316 5.099-6.135 5.7-2.338-2.286-1.563-2.682-1.912-6.983"/>
        </g>
      </g>
    </g>
  </svg>`;

  // Original Sidewalk Start Zone (width: 140px, height: 350px)
  const SIDEWALK_SVG = `
    <svg viewBox="0 0 140 350" width="140" height="350" class="sidewalk-svg" preserveAspectRatio="none">
      <defs>
        <pattern id="sw-tiles" width="35" height="35" patternUnits="userSpaceOnUse">
          <rect width="35" height="35" fill="#4e555e" stroke="#3d434a" stroke-width="1.5"/>
          <rect x="1" y="1" width="33" height="33" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>
        </pattern>
        <radialGradient id="sw-lamp-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#fef08a" stop-opacity="0.6"/>
          <stop offset="35%" stop-color="#fde047" stop-opacity="0.32"/>
          <stop offset="70%" stop-color="#eab308" stop-opacity="0.1"/>
          <stop offset="100%" stop-color="#ca8a04" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="140" height="350" fill="url(#sw-tiles)"/>
      <rect x="0" y="0" width="36" height="350" fill="#15803d"/>
      <rect x="32" y="0" width="4" height="350" fill="#166534"/>
      <rect x="135" y="0" width="5" height="350" fill="#2d333a"/>
      <line x1="135" y1="0" x2="135" y2="350" stroke="#64748b" stroke-width="2"/>
      <!-- Tree on grass -->
      <ellipse cx="19" cy="88" rx="22" ry="22" fill="rgba(0,0,0,0.35)"/>
      <circle cx="17" cy="85" r="21" fill="#14532d"/>
      <circle cx="16" cy="83" r="17" fill="#16a34a"/>
      <circle cx="15" cy="80" r="12" fill="#22c55e"/>
      <circle cx="13" cy="78" r="7" fill="#4ade80"/>
      <circle cx="17" cy="85" r="4.5" fill="#78350f" stroke="#451a03" stroke-width="1"/>
      <!-- Bushes -->
      <circle cx="17" cy="240" r="13" fill="#166534"/>
      <circle cx="16" cy="239" r="10" fill="#22c55e"/>
      <circle cx="17" cy="290" r="12" fill="#14532d"/>
      <circle cx="16" cy="289" r="9" fill="#16a34a"/>
      <!-- Street lamp post with warm glow -->
      <circle cx="100" cy="52" r="75" fill="url(#sw-lamp-glow)"/>
      <ellipse cx="106" cy="56" rx="14" ry="14" fill="rgba(0,0,0,0.4)"/>
      <circle cx="100" cy="52" r="8" fill="#1e293b" stroke="#0f172a" stroke-width="1.5"/>
      <rect x="91" y="50.5" width="18" height="3" rx="1.5" fill="#334155"/>
      <rect x="98.5" y="43" width="3" height="18" rx="1.5" fill="#334155"/>
      <circle cx="100" cy="52" r="4.5" fill="#fef08a" stroke="#facc15" stroke-width="1"/>
    </svg>
  `;

  // 7 Original Detailed Top-Down SVGs (Downward Only: headlights & bumper at bottom, taillights at top)
  const VEHICLE_SVGS = {
    taxi: `<svg viewBox="0 0 64 114" width="64" height="114" class="topdown-car">
      <rect x="2" y="16" width="6" height="18" rx="2" fill="#18181b"/>
      <rect x="56" y="16" width="6" height="18" rx="2" fill="#18181b"/>
      <rect x="2" y="80" width="6" height="18" rx="2" fill="#18181b"/>
      <rect x="56" y="80" width="6" height="18" rx="2" fill="#18181b"/>
      <rect x="6" y="4" width="52" height="106" rx="14" fill="#f59e0b" stroke="#b45309" stroke-width="2"/>
      <path d="M 12 108 Q 32 112 52 108" stroke="#78350f" stroke-width="3" fill="none" stroke-linecap="round"/>
      <ellipse cx="14" cy="104" rx="4.5" ry="3" fill="#fef08a" stroke="#ca8a04" stroke-width="1"/>
      <ellipse cx="50" cy="104" rx="4.5" ry="3" fill="#fef08a" stroke="#ca8a04" stroke-width="1"/>
      <path d="M 14 74 L 14 86 Q 32 92 50 86 L 50 74 Z" fill="#1e293b" stroke="#0f172a" stroke-width="1.5"/>
      <path d="M 18 76 L 24 76 L 36 88 L 30 88 Z" fill="rgba(255,255,255,0.3)"/>
      <rect x="12" y="32" width="40" height="42" rx="6" fill="#d97706" stroke="#92400e" stroke-width="1.5"/>
      <rect x="20" y="48" width="24" height="11" rx="3" fill="#fef3c7" stroke="#b45309" stroke-width="1.5"/>
      <text x="32" y="56.5" font-family="sans-serif" font-weight="900" font-size="6.5" fill="#1e293b" text-anchor="middle" letter-spacing="0.5">TAXI</text>
      <path d="M 14 30 L 14 20 Q 32 16 50 20 L 50 30 Z" fill="#1e293b" stroke="#0f172a" stroke-width="1.5"/>
      <rect x="10" y="6" width="9" height="4" rx="1.5" fill="#ef4444" stroke="#991b1b" stroke-width="1"/>
      <rect x="45" y="6" width="9" height="4" rx="1.5" fill="#ef4444" stroke="#991b1b" stroke-width="1"/>
      <rect x="1" y="70" width="5" height="8" rx="2" fill="#d97706"/>
      <rect x="58" y="70" width="5" height="8" rx="2" fill="#d97706"/>
    </svg>`,

    police: `<svg viewBox="0 0 64 118" width="64" height="118" class="topdown-car">
      <rect x="2" y="18" width="6" height="18" rx="2" fill="#18181b"/>
      <rect x="56" y="18" width="6" height="18" rx="2" fill="#18181b"/>
      <rect x="2" y="82" width="6" height="18" rx="2" fill="#18181b"/>
      <rect x="56" y="82" width="6" height="18" rx="2" fill="#18181b"/>
      <rect x="6" y="4" width="52" height="110" rx="14" fill="#ffffff" stroke="#0f172a" stroke-width="2"/>
      <path d="M 6 86 C 6 100 16 114 32 114 C 48 114 58 100 58 86 Z" fill="#0f172a"/>
      <path d="M 6 28 C 6 14 16 4 32 4 C 48 4 58 14 58 28 Z" fill="#0f172a"/>
      <rect x="14" y="112" width="36" height="4" rx="2" fill="#334155"/>
      <ellipse cx="14" cy="107" rx="4.5" ry="3" fill="#60a5fa" stroke="#1d4ed8" stroke-width="1"/>
      <ellipse cx="50" cy="107" rx="4.5" ry="3" fill="#60a5fa" stroke="#1d4ed8" stroke-width="1"/>
      <path d="M 13 74 L 13 84 Q 32 90 51 84 L 51 74 Z" fill="#1e293b" stroke="#0f172a" stroke-width="1.5"/>
      <path d="M 17 76 L 23 76 L 35 87 L 29 87 Z" fill="rgba(255,255,255,0.3)"/>
      <rect x="12" y="32" width="40" height="42" rx="5" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1"/>
      <rect x="16" y="49" width="32" height="9" rx="2.5" fill="#1e293b"/>
      <rect x="17" y="50" width="14" height="7" rx="2" fill="#ef4444"/>
      <rect x="33" y="50" width="14" height="7" rx="2" fill="#3b82f6"/>
      <path d="M 13 32 L 13 22 Q 32 18 51 22 L 51 32 Z" fill="#1e293b" stroke="#0f172a" stroke-width="1.5"/>
      <rect x="10" y="6" width="9" height="4" rx="1.5" fill="#ef4444"/>
      <rect x="45" y="6" width="9" height="4" rx="1.5" fill="#ef4444"/>
      <rect x="1" y="72" width="5" height="8" rx="2" fill="#0f172a"/>
      <rect x="58" y="72" width="5" height="8" rx="2" fill="#0f172a"/>
    </svg>`,

    fire_truck: `<svg viewBox="0 0 70 148" width="70" height="148" class="topdown-car">
      <rect x="1" y="20" width="6" height="20" rx="2" fill="#18181b"/>
      <rect x="63" y="20" width="6" height="20" rx="2" fill="#18181b"/>
      <rect x="1" y="54" width="6" height="20" rx="2" fill="#18181b"/>
      <rect x="63" y="54" width="6" height="20" rx="2" fill="#18181b"/>
      <rect x="1" y="108" width="6" height="20" rx="2" fill="#18181b"/>
      <rect x="63" y="108" width="6" height="20" rx="2" fill="#18181b"/>
      <rect x="6" y="4" width="58" height="140" rx="8" fill="#dc2626" stroke="#991b1b" stroke-width="2"/>
      <rect x="8" y="141" width="54" height="5" rx="2" fill="#e2e8f0" stroke="#94a3b8" stroke-width="1"/>
      <rect x="11" y="136" width="8" height="4" rx="1" fill="#fef08a"/>
      <rect x="51" y="136" width="8" height="4" rx="1" fill="#fef08a"/>
      <rect x="10" y="96" width="50" height="38" rx="4" fill="#f1f5f9" stroke="#cbd5e1" stroke-width="1.5"/>
      <rect x="12" y="122" width="46" height="12" rx="2" fill="#0f172a"/>
      <ellipse cx="16" cy="100" rx="4" ry="4" fill="#ef4444"/>
      <ellipse cx="54" cy="100" rx="4" ry="4" fill="#ef4444"/>
      <rect x="22" y="8" width="26" height="82" rx="2" fill="#94a3b8" stroke="#64748b" stroke-width="1.5"/>
      <line x1="22" y1="18" x2="48" y2="18" stroke="#cbd5e1" stroke-width="2"/>
      <line x1="22" y1="30" x2="48" y2="30" stroke="#cbd5e1" stroke-width="2"/>
      <line x1="22" y1="42" x2="48" y2="42" stroke="#cbd5e1" stroke-width="2"/>
      <line x1="22" y1="54" x2="48" y2="54" stroke="#cbd5e1" stroke-width="2"/>
      <line x1="22" y1="66" x2="48" y2="66" stroke="#cbd5e1" stroke-width="2"/>
      <line x1="22" y1="78" x2="48" y2="78" stroke="#cbd5e1" stroke-width="2"/>
      <rect x="8" y="14" width="10" height="74" fill="#b91c1c" stroke="#7f1d1d" stroke-width="1"/>
      <rect x="52" y="14" width="10" height="74" fill="#b91c1c" stroke="#7f1d1d" stroke-width="1"/>
      <rect x="1" y="118" width="5" height="10" rx="2" fill="#475569"/>
      <rect x="64" y="118" width="5" height="10" rx="2" fill="#475569"/>
    </svg>`,

    delivery_truck: `<svg viewBox="0 0 68 138" width="68" height="138" class="topdown-car">
      <rect x="1" y="18" width="6" height="20" rx="2" fill="#18181b"/>
      <rect x="61" y="18" width="6" height="20" rx="2" fill="#18181b"/>
      <rect x="1" y="98" width="6" height="20" rx="2" fill="#18181b"/>
      <rect x="61" y="98" width="6" height="20" rx="2" fill="#18181b"/>
      <rect x="6" y="4" width="56" height="84" rx="4" fill="#e2d9cc" stroke="#a89f91" stroke-width="2"/>
      <line x1="12" y1="18" x2="56" y2="18" stroke="#c4baa9" stroke-width="1.5"/>
      <line x1="12" y1="34" x2="56" y2="34" stroke="#c4baa9" stroke-width="1.5"/>
      <line x1="12" y1="50" x2="56" y2="50" stroke="#c4baa9" stroke-width="1.5"/>
      <line x1="12" y1="66" x2="56" y2="66" stroke="#c4baa9" stroke-width="1.5"/>
      <rect x="8" y="4" width="52" height="4" fill="#78716c"/>
      <rect x="8" y="88" width="52" height="44" rx="10" fill="#2563eb" stroke="#1d4ed8" stroke-width="2"/>
      <path d="M 13 116 L 13 126 Q 34 130 55 126 L 55 116 Z" fill="#1e293b"/>
      <path d="M 17 118 L 23 118 L 37 127 L 31 127 Z" fill="rgba(255,255,255,0.3)"/>
      <ellipse cx="14" cy="130" rx="4" ry="2.5" fill="#fef08a"/>
      <ellipse cx="54" cy="130" rx="4" ry="2.5" fill="#fef08a"/>
      <rect x="1" y="108" width="5" height="10" rx="2" fill="#1e293b"/>
      <rect x="62" y="108" width="5" height="10" rx="2" fill="#1e293b"/>
    </svg>`,

    bus: `<svg viewBox="0 0 70 160" width="70" height="160" class="topdown-car">
      <rect x="1" y="22" width="6" height="22" rx="2" fill="#18181b"/>
      <rect x="63" y="22" width="6" height="22" rx="2" fill="#18181b"/>
      <rect x="1" y="116" width="6" height="22" rx="2" fill="#18181b"/>
      <rect x="63" y="116" width="6" height="22" rx="2" fill="#18181b"/>
      <rect x="6" y="4" width="58" height="152" rx="12" fill="#0284c7" stroke="#0369a1" stroke-width="2"/>
      <rect x="12" y="24" width="46" height="108" rx="6" fill="#f0f9ff" stroke="#bae6fd" stroke-width="1.5"/>
      <rect x="20" y="38" width="30" height="16" rx="3" fill="#cbd5e1" stroke="#94a3b8" stroke-width="1"/>
      <rect x="20" y="82" width="30" height="16" rx="3" fill="#cbd5e1" stroke="#94a3b8" stroke-width="1"/>
      <path d="M 10 138 C 10 152 20 156 35 156 C 50 156 60 152 60 138 Z" fill="#0f172a"/>
      <ellipse cx="15" cy="152" rx="4" ry="2.5" fill="#fef08a"/>
      <ellipse cx="55" cy="152" rx="4" ry="2.5" fill="#fef08a"/>
      <rect x="12" y="8" width="46" height="10" rx="3" fill="#0f172a"/>
      <rect x="8" y="6" width="8" height="4" rx="1.5" fill="#ef4444"/>
      <rect x="54" y="6" width="8" height="4" rx="1.5" fill="#ef4444"/>
      <rect x="0" y="136" width="6" height="9" rx="2" fill="#0369a1"/>
      <rect x="64" y="136" width="6" height="9" rx="2" fill="#0369a1"/>
    </svg>`,

    ice_cream: `<svg viewBox="0 0 66 124" width="66" height="124" class="topdown-car">
      <rect x="1" y="16" width="6" height="18" rx="2" fill="#18181b"/>
      <rect x="59" y="16" width="6" height="18" rx="2" fill="#18181b"/>
      <rect x="1" y="88" width="6" height="18" rx="2" fill="#18181b"/>
      <rect x="59" y="88" width="6" height="18" rx="2" fill="#18181b"/>
      <rect x="6" y="4" width="54" height="116" rx="12" fill="#f472b6" stroke="#db2777" stroke-width="2"/>
      <rect x="10" y="24" width="46" height="58" rx="6" fill="#fff1f2" stroke="#fbcfe8" stroke-width="1.5"/>
      <polygon points="33,66 26,44 40,44" fill="#f59e0b" stroke="#d97706" stroke-width="1"/>
      <circle cx="33" cy="38" r="9" fill="#ec4899"/>
      <circle cx="33" cy="32" r="6" fill="#38bdf8"/>
      <circle cx="33" cy="27" r="3" fill="#ef4444"/>
      <path d="M 8 92 C 8 110 18 118 33 118 C 48 118 58 110 58 92 Z" fill="#fb7185"/>
      <path d="M 12 96 L 12 106 Q 33 110 54 106 L 54 96 Z" fill="#0f172a"/>
      <ellipse cx="14" cy="112" rx="4" ry="2.5" fill="#fef08a"/>
      <ellipse cx="52" cy="112" rx="4" ry="2.5" fill="#fef08a"/>
      <rect x="8" y="6" width="8" height="4" rx="1.5" fill="#ef4444"/>
      <rect x="50" y="6" width="8" height="4" rx="1.5" fill="#ef4444"/>
      <rect x="1" y="94" width="5" height="8" rx="2" fill="#db2777"/>
      <rect x="60" y="94" width="5" height="8" rx="2" fill="#db2777"/>
    </svg>`,

    sports_car: `<svg viewBox="0 0 64 112" width="64" height="112" class="topdown-car">
      <rect x="2" y="16" width="6" height="18" rx="2" fill="#18181b"/>
      <rect x="56" y="16" width="6" height="18" rx="2" fill="#18181b"/>
      <rect x="2" y="78" width="6" height="18" rx="2" fill="#18181b"/>
      <rect x="56" y="78" width="6" height="18" rx="2" fill="#18181b"/>
      <path d="M 8 16 C 6 36 6 80 8 96 C 14 112 50 112 56 96 C 58 80 58 36 56 16 C 48 4 16 4 8 16 Z" fill="#ea580c" stroke="#c2410c" stroke-width="2"/>
      <rect x="26" y="6" width="4" height="100" fill="#0f172a"/>
      <rect x="34" y="6" width="4" height="100" fill="#0f172a"/>
      <path d="M 16 52 C 16 40 22 36 32 36 C 42 36 48 40 48 52 C 48 72 44 80 32 80 C 20 80 16 72 16 52 Z" fill="#0f172a"/>
      <path d="M 20 48 C 22 42 26 40 32 40 C 34 40 36 41 38 42 L 32 64 Z" fill="rgba(255,255,255,0.25)"/>
      <rect x="6" y="8" width="52" height="6" rx="2" fill="#1e293b" stroke="#0f172a" stroke-width="1"/>
      <polygon points="12,100 18,106 14,107" fill="#67e8f9"/>
      <polygon points="52,100 46,106 50,107" fill="#67e8f9"/>
      <line x1="12" y1="12" x2="22" y2="12" stroke="#ef4444" stroke-width="2.5"/>
      <line x1="42" y1="12" x2="52" y2="12" stroke="#ef4444" stroke-width="2.5"/>
      <rect x="1" y="62" width="5" height="7" rx="2" fill="#0f172a"/>
      <rect x="58" y="62" width="5" height="7" rx="2" fill="#0f172a"/>
    </svg>`,

    f1_red: `<svg viewBox="0 0 64 112" width="64" height="112" class="topdown-car">
      <rect x="3" y="3" width="58" height="9" rx="2" fill="#111827" stroke="#000" stroke-width="1.5"/>
      <rect x="18" y="10" width="28" height="5" fill="#7f1d1d"/>
      <rect x="0" y="18" width="13" height="23" rx="4" fill="#0b0d10" stroke="#000" stroke-width="1"/>
      <rect x="51" y="18" width="13" height="23" rx="4" fill="#0b0d10" stroke="#000" stroke-width="1"/>
      <rect x="0" y="77" width="13" height="21" rx="4" fill="#0b0d10" stroke="#000" stroke-width="1"/>
      <rect x="51" y="77" width="13" height="21" rx="4" fill="#0b0d10" stroke="#000" stroke-width="1"/>
      <path d="M32 7 C42 7 49 16 50 35 L49 70 C49 91 43 103 32 106 C21 103 15 91 15 70 L14 35 C15 16 22 7 32 7 Z" fill="#e11d2e" stroke="#7f1d1d" stroke-width="2"/>
      <path d="M32 9 L40 18 L37 36 L32 58 L27 36 L24 18 Z" fill="#f8fafc" opacity=".92"/>
      <rect x="10" y="44" width="8" height="26" rx="3" fill="#b91c1c"/>
      <rect x="46" y="44" width="8" height="26" rx="3" fill="#b91c1c"/>
      <ellipse cx="32" cy="49" rx="9" ry="12" fill="#0f172a"/>
      <circle cx="32" cy="55" r="4.5" fill="#facc15" stroke="#a16207" stroke-width="1"/>
      <path d="M27 82 L32 104 L37 82 Z" fill="#b91c1c"/>
      <rect x="5" y="102" width="54" height="7" rx="2" fill="#111827" stroke="#000" stroke-width="1.5"/>
      <rect x="20" y="108" width="24" height="3" fill="#e11d2e"/>
      <rect x="10" y="8" width="8" height="4" rx="1.5" fill="#ef4444"/>
      <rect x="46" y="8" width="8" height="4" rx="1.5" fill="#ef4444"/>
      <text x="32" y="74" font-family="sans-serif" font-weight="900" font-size="7" fill="#ffffff" text-anchor="middle">1</text>
    </svg>`,

    f1_blue: `<svg viewBox="0 0 64 112" width="64" height="112" class="topdown-car">
      <rect x="3" y="3" width="58" height="9" rx="2" fill="#111827" stroke="#000" stroke-width="1.5"/>
      <rect x="18" y="10" width="28" height="5" fill="#1e3a8a"/>
      <rect x="0" y="18" width="13" height="23" rx="4" fill="#0b0d10" stroke="#000" stroke-width="1"/>
      <rect x="51" y="18" width="13" height="23" rx="4" fill="#0b0d10" stroke="#000" stroke-width="1"/>
      <rect x="0" y="77" width="13" height="21" rx="4" fill="#0b0d10" stroke="#000" stroke-width="1"/>
      <rect x="51" y="77" width="13" height="21" rx="4" fill="#0b0d10" stroke="#000" stroke-width="1"/>
      <path d="M32 7 C42 7 49 16 50 35 L49 70 C49 91 43 103 32 106 C21 103 15 91 15 70 L14 35 C15 16 22 7 32 7 Z" fill="#2563eb" stroke="#1e40af" stroke-width="2"/>
      <path d="M32 9 L40 18 L37 36 L32 58 L27 36 L24 18 Z" fill="#f8fafc" opacity=".92"/>
      <rect x="10" y="44" width="8" height="26" rx="3" fill="#1d4ed8"/>
      <rect x="46" y="44" width="8" height="26" rx="3" fill="#1d4ed8"/>
      <ellipse cx="32" cy="49" rx="9" ry="12" fill="#0f172a"/>
      <circle cx="32" cy="55" r="4.5" fill="#facc15" stroke="#a16207" stroke-width="1"/>
      <path d="M27 82 L32 104 L37 82 Z" fill="#1d4ed8"/>
      <rect x="5" y="102" width="54" height="7" rx="2" fill="#111827" stroke="#000" stroke-width="1.5"/>
      <rect x="20" y="108" width="24" height="3" fill="#2563eb"/>
      <rect x="10" y="8" width="8" height="4" rx="1.5" fill="#60a5fa"/>
      <rect x="46" y="8" width="8" height="4" rx="1.5" fill="#60a5fa"/>
      <text x="32" y="74" font-family="sans-serif" font-weight="900" font-size="7" fill="#ffffff" text-anchor="middle">7</text>
    </svg>`
  };
  const VEHICLE_KEYS = Object.keys(VEHICLE_SVGS);

  // 3D Metallic Grate Manhole Badge HTML
  function makeManholeHtml(laneNum, multVal, isTarget) {
    return `
      <div class="manhole-cover ${isTarget ? 'is-target' : ''}" id="manhole-${laneNum}">
        <svg viewBox="0 0 76 76" width="76" height="76" class="manhole-svg">
          <defs>
            <radialGradient id="mh-grad-${laneNum}" cx="38%" cy="32%" r="65%">
              <stop offset="0%" stop-color="${isTarget ? '#524322' : '#3d444e'}"/>
              <stop offset="60%" stop-color="${isTarget ? '#292112' : '#222830'}"/>
              <stop offset="100%" stop-color="${isTarget ? '#141008' : '#11151a'}"/>
            </radialGradient>
          </defs>
          <circle cx="38" cy="38" r="36" fill="url(#mh-grad-${laneNum})" stroke="${isTarget ? '#F2D98B' : '#56606e'}" stroke-width="${isTarget ? '3' : '2.5'}"/>
          <circle cx="38" cy="38" r="30" fill="${isTarget ? '#1d170d' : '#161a20'}" stroke="${isTarget ? '#b45309' : '#0d1014'}" stroke-width="2"/>
          <g stroke="${isTarget ? '#78350f' : '#2d3440'}" stroke-width="2.5" stroke-linecap="round">
            <line x1="20" y1="24" x2="20" y2="52"/>
            <line x1="26" y1="18" x2="26" y2="58"/>
            <line x1="32" y1="14" x2="32" y2="62"/>
            <line x1="38" y1="12" x2="38" y2="64"/>
            <line x1="44" y1="14" x2="44" y2="62"/>
            <line x1="50" y1="18" x2="50" y2="58"/>
            <line x1="56" y1="24" x2="56" y2="52"/>
          </g>
          <rect x="11" y="25" width="54" height="26" rx="13" fill="${isTarget ? '#1a140a' : '#14181f'}" stroke="${isTarget ? '#F2D98B' : '#4b5563'}" stroke-width="1.5" opacity="0.95"/>
        </svg>
        <span class="manhole-mult-text ${isTarget ? 'target-glow' : ''}">${multVal}×</span>
      </div>
    `;
  }

  // 3D Gold Coin Emblem (Cleared Lane)
  function makeCoinEmblemHtml() {
    return `
      <div class="cleared-coin-emblem">
        <svg viewBox="0 0 76 76" width="76" height="76" class="coin-svg">
          <defs>
            <radialGradient id="coin-gold-grad" cx="35%" cy="30%" r="65%">
              <stop offset="0%" stop-color="#fffbeb"/>
              <stop offset="35%" stop-color="#fde047"/>
              <stop offset="70%" stop-color="#d97706"/>
              <stop offset="100%" stop-color="#78350f"/>
            </radialGradient>
          </defs>
          <circle cx="38" cy="38" r="36" fill="url(#coin-gold-grad)" stroke="#fef08a" stroke-width="2.5"/>
          <circle cx="38" cy="38" r="30" fill="#b45309" stroke="#78350f" stroke-width="2"/>
          <g stroke="#f59e0b" stroke-width="2" stroke-linecap="round" opacity="0.65">
            <line x1="20" y1="24" x2="20" y2="52"/>
            <line x1="26" y1="18" x2="26" y2="58"/>
            <line x1="32" y1="14" x2="32" y2="62"/>
            <line x1="38" y1="12" x2="38" y2="64"/>
            <line x1="44" y1="14" x2="44" y2="62"/>
            <line x1="50" y1="18" x2="50" y2="58"/>
            <line x1="56" y1="24" x2="56" y2="52"/>
          </g>
          <ellipse cx="38" cy="38" rx="14" ry="14" fill="#fbbf24" stroke="#d97706" stroke-width="1.5"/>
          <text x="38" y="44" font-size="16" text-anchor="middle">🍗</text>
        </svg>
      </div>
    `;
  }

  // Striped Hazard Construction Barrier
  function makeBarrierHtml() {
    return `
      <div class="road-barrier-hazard">
        <div class="barrier-beam top"></div>
        <div class="barrier-beam bot"></div>
        <div class="barrier-post left"></div>
        <div class="barrier-post right"></div>
      </div>
    `;
  }

  function road(body, stage) {
    const { t, esc } = C;
    let st = C.roadState || { active: false, balance: 100000, difficulty: 'easy', ladder: [], maxSteps: 24, next: 1.00, next_crash_chance: 1.8 };
    let curDiff = st.difficulty || 'easy';
    let busy = false;
    let roadRoundSerial = 0;
    let resultShownForRound = -1;
    let closeResultModal = null;
    let currentBetCents = 1000; // 10 credits default
    let activeSubTab = 'bets';
    let roundHistory = [];
    let customClientSeed = 'fetan_' + Math.random().toString(36).slice(2, 10);

    // Active downward traffic state
    let activeVehicles = []; // { id, lane, el, y, speed, h, fading }
    let laneNextSpawn = {};
    let clearingTargetLane = null;
    let isCrashAnimActive = false;
    let trafficRunning = true;
    let trafficAnimId = null;
    let lastTrafficTime = performance.now();
    let carIdSeq = 1;

    body.innerHTML = `
      <div class="road-container">
        <!-- Slim in-game top bar -->
        <div class="road-topbar">
          <div class="road-brand-pill">
            <span class="road-brand-badge">ፈ</span>
            <span class="road-brand-title">${esc(t('road_title'))}</span>
          </div>
          <div class="road-topbar-actions">
            <button class="road-btn-icon" id="road-how-btn" type="button">
              <span>❓</span> ${esc(t('how_to_play'))}
            </button>
            <div class="road-balance-pill" id="road-bal-pill">
              <span>🪙</span> <span id="road-bal-val">${C.fmt(st.balance || 0)}</span>
            </div>
            <button class="road-btn-icon" id="road-sound-btn" type="button" title="${esc(t('sound_toggle'))}">
              <span id="road-sound-icon">${muted ? '🔇' : '🔊'}</span>
            </button>
            <button class="road-btn-icon" id="road-fs-btn" type="button" title="${esc(t('fullscreen'))}">
              <span>⛶</span>
            </button>
            <button class="road-btn-icon" id="road-menu-btn" type="button" title="${esc(t('menu'))}">
              <span>☰</span>
            </button>
          </div>
        </div>

        <!-- Road scene with edge-to-edge asphalt & camera tracking -->
        <div class="road-viewport" id="rviewport">
          <div class="road-scroll" id="rsc">
            <div class="road-track" id="rtrack">
              <!-- F1 track edges: checkered safety rail, red/white curbs and tire wall -->
              <div class="f1-track-edge top" aria-hidden="true"></div>
              <div class="f1-track-edge bottom" aria-hidden="true"></div>
              <!-- Sidewalk start zone -->
              <div class="road-sidewalk-start" id="rsidewalk">
                ${SIDEWALK_SVG}
                <div class="f1-start-zone" aria-hidden="true">
                  <div class="f1-pit-wall"></div>
                  <div class="f1-gantry">
                    <span class="f1-light on"></span>
                    <span class="f1-light on"></span>
                    <span class="f1-light on"></span>
                    <span class="f1-light"></span>
                    <span class="f1-light"></span>
                    <span class="f1-gantry-label">START</span>
                  </div>
                  <div class="f1-flag-pole"></div>
                  <div class="f1-pit-sign">F1</div>
                  <div class="f1-bench"></div>
                  <div class="f1-tire-stack left"><span></span><span></span><span></span><span></span></div>
                  <div class="f1-tire-stack right"><span></span><span></span><span></span></div>
                  <div class="f1-start-line"></div>
                </div>
              </div>
              <!-- Lanes container -->
              <div class="road-lanes-wrap" id="rlanes"></div>
              <!-- Finish line -->
              <div class="road-finish-curb">
                <span class="finish-text">FINISH</span>
                <span class="finish-trophy">🏆</span>
                <span class="finish-text">FINISH</span>
              </div>
              <!-- The Chicken Hero -->
              <div class="chicken-hero" id="road-chicken">
                <div class="chicken-svg-wrap">
                  ${CHICKEN_SVG}
                </div>
                <div class="chicken-tag blue-sign" id="chicken-tag">
                  <div class="tag-pointer"></div>
                  <span class="tag-mult-text">1.00×</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Bottom control panel -->
        <div class="road-panel">
          <!-- Stepper and chips -->
          <div class="road-stepper-row">
            <div class="road-input-box">
              <button class="road-step-btn" id="bet-min" type="button">MIN</button>
              <button class="road-step-btn" id="bet-minus" type="button">−</button>
              <input class="road-bet-input" id="rbet-val" type="text" value="10" />
              <button class="road-step-btn" id="bet-plus" type="button">+</button>
              <button class="road-step-btn" id="bet-max" type="button">MAX</button>
            </div>
            <div class="road-chips-group">
              <button class="road-chip-btn" id="chip-1" type="button">1</button>
              <button class="road-chip-btn" id="chip-2" type="button">2</button>
              <button class="road-chip-btn" id="chip-5" type="button">5</button>
              <button class="road-chip-btn" id="chip-10" type="button">10</button>
              <button class="road-chip-btn" id="chip-half" type="button">½</button>
              <button class="road-chip-btn" id="chip-double" type="button">2×</button>
            </div>
          </div>

          <!-- Difficulty segmented selector & Shot down indicator -->
          <div class="road-diff-row">
            <div class="road-diff-block">
              <span class="road-diff-label">${esc(t('difficulty') || 'Difficulty')}</span>
              <div class="road-segmented" id="rdiff-segment">
                <button class="road-seg-btn ${curDiff === 'easy' ? 'active' : ''}" data-diff="easy" type="button">${esc(t('diff_easy'))}</button>
                <button class="road-seg-btn ${curDiff === 'medium' ? 'active' : ''}" data-diff="medium" type="button">${esc(t('diff_medium'))}</button>
                <button class="road-seg-btn ${curDiff === 'hard' ? 'active' : ''}" data-diff="hard" type="button">${esc(t('diff_hard'))}</button>
                <button class="road-seg-btn ${curDiff === 'hardcore' ? 'active' : ''}" data-diff="hardcore" type="button">${esc(t('diff_hardcore'))}</button>
              </div>
            </div>
            <div class="road-shot-down">
              <span>⚠️ ${esc(t('chance_shot_down'))}:</span>
              <span class="road-shot-down-val" id="rshot-val">—</span>
            </div>
          </div>

          <!-- Action buttons (Play / GO & CASH OUT) -->
          <div class="road-actions-row" id="ractions-row">
            <button class="btn-road-cashout" id="rcashout-btn" disabled type="button" style="display:none">
              <span>💰</span>
              <span id="rcashout-label">${esc(t('cashout'))}</span>
            </button>
            <button class="btn-road-go" id="rgo-btn" type="button">
              <span id="rgo-icon">▶</span>
              <span id="rgo-label">${esc(t('play') || 'Play')}</span>
            </button>
          </div>

          <!-- Virtual demo credits note -->
          <div class="road-demo-notice">${esc(t('demo_notice'))}</div>
          <div class="msg" id="rmsg" style="text-align:center;margin-top:2px"></div>
        </div>

        <!-- Sub-tabs: My bets & Provably Fair -->
        <div class="road-subtabs">
          <div class="road-tabs-nav">
            <button class="road-tab-btn ${activeSubTab === 'bets' ? 'active' : ''}" id="tab-bets-btn" type="button">
              <span>📊</span> ${esc(t('my_bets'))}
            </button>
            <button class="road-tab-btn ${activeSubTab === 'fairness' ? 'active' : ''}" id="tab-fair-btn" type="button">
              <span>🛡️</span> ${esc(t('provably_fair'))}
            </button>
          </div>
          <div class="road-tab-body" id="road-tab-pane"></div>
        </div>
      </div>

      <!-- Rules modal container -->
      <div id="road-modal-slot"></div>
    `;

    // Hook sound toggle
    $('road-sound-btn').onclick = () => {
      muted = !muted;
      localStorage.setItem('mute', muted ? '1' : '0');
      $('road-sound-icon').textContent = muted ? '🔇' : '🔊';
    };

    // Fullscreen toggle
    $('road-fs-btn').onclick = () => {
      if (!document.fullscreenElement) {
        if (stage.requestFullscreen) stage.requestFullscreen();
        else if (stage.webkitRequestFullscreen) stage.webkitRequestFullscreen();
      } else {
        if (document.exitFullscreen) document.exitFullscreen();
      }
    };

    // Menu toggle -> Lobby
    $('road-menu-btn').onclick = () => {
      if ($('gback')) $('gback').click();
    };

    // Rules modal
    $('road-how-btn').onclick = () => showRulesModal();
    stopFns.push(() => { if (closeResultModal) closeResultModal(); });
    function showRoadResult(kind, result, stake) {
      if (resultShownForRound === roadRoundSerial) return;
      resultShownForRound = roadRoundSerial;
      const slot = $('road-modal-slot');
      if (!slot) return;
      const net = Number(result.net) || 0;
      const gross = Number(result.payout) || 0;
      const isCrash = kind === 'crash';
      const isWin = !isCrash && net > 0;
      const isRefund = !isCrash && net === 0;
      const icon = isCrash ? '💥' : isWin ? '🎉' : '🪙';
      const title = isCrash ? t('road_result_crashed') : isWin ? `${t('road_result_win')}${C.fmt(net)}!` : isRefund ? t('road_result_refund') : t('road_result_complete');
      const subtitle = isCrash ? t('road_result_try_again') : isWin ? t('road_result_congrats') : isRefund ? t('road_result_refund_note') : t('road_result_complete_note');
      const detail = isCrash
        ? `<p class="road-result-detail">${esc(t('road_result_lost_stake'))} ${C.fmt(stake)}</p>`
        : `<p class="road-result-detail">${esc(t('road_result_gross'))} ${C.fmt(gross)}${net < 0 ? ` · ${esc(t('road_result_net_loss'))} ${C.fmt(-net)}` : ''}</p>`;
      slot.innerHTML = `
        <div class="road-modal-overlay road-result-overlay" id="road-result-overlay">
          <section class="road-modal-box road-result-card ${isCrash ? 'is-loss' : 'is-win'}" role="dialog" aria-modal="true" aria-labelledby="road-result-title">
            <div class="road-result-icon" aria-hidden="true">${icon}</div>
            <h2 class="road-result-title" id="road-result-title">${esc(title)}</h2>
            <p class="road-result-subtitle">${esc(subtitle)}</p>
            ${detail}
            <button class="road-result-close" id="road-result-close" type="button">${esc(t('close') || 'Close')}</button>
          </section>
        </div>`;
      const close = () => {
        slot.innerHTML = '';
        document.removeEventListener('keydown', onKeyDown);
        if (closeResultModal === close) closeResultModal = null;
      };
      const onKeyDown = (event) => { if (event.key === 'Escape') close(); };
      closeResultModal = close;
      $('road-result-close').onclick = close;
      $('road-result-overlay').onclick = (event) => { if (event.target.id === 'road-result-overlay') close(); };
      document.addEventListener('keydown', onKeyDown);
      $('road-result-close').focus();
    }

    function showRulesModal() {
      const slot = $('road-modal-slot');
      if (!slot) return;
      slot.innerHTML = `
        <div class="road-modal-overlay" id="road-rules-overlay">
          <div class="road-modal-box">
            <h3 class="road-modal-title"><span>🐔</span> ${esc(t('rules_title'))}</h3>
            <p class="road-modal-body">${esc(t('rules_content'))}</p>
            <div style="text-align:right">
              <button class="btn btn-gold" id="road-rules-close" style="padding:8px 24px">${esc(t('close') || 'OK')}</button>
            </div>
          </div>
        </div>`;
      $('road-rules-close').onclick = () => { slot.innerHTML = ''; };
      $('road-rules-overlay').onclick = (e) => { if (e.target.id === 'road-rules-overlay') slot.innerHTML = ''; };
    }

    // Stepper & Chip inputs
    const betInput = $('rbet-val');
    function getBetCents() {
      const v = parseFloat(betInput.value) || 1;
      return Math.round(Math.max(1, Math.min(1000, v)) * 100);
    }
    function setBetDisplay(credits) {
      betInput.value = (Math.max(1, Math.min(1000, credits))).toFixed(0);
      currentBetCents = getBetCents();
    }
    betInput.onchange = () => setBetDisplay(parseFloat(betInput.value) || 1);
    $('bet-min').onclick = () => setBetDisplay(1);
    $('bet-max').onclick = () => setBetDisplay(1000);
    $('bet-minus').onclick = () => setBetDisplay(Math.max(1, parseFloat(betInput.value) - 1));
    $('bet-plus').onclick = () => setBetDisplay(Math.min(1000, parseFloat(betInput.value) + 1));
    $('chip-1').onclick = () => setBetDisplay(1);
    $('chip-2').onclick = () => setBetDisplay(2);
    $('chip-5').onclick = () => setBetDisplay(5);
    $('chip-10').onclick = () => setBetDisplay(10);
    $('chip-half').onclick = () => setBetDisplay(Math.max(1, Math.floor(parseFloat(betInput.value) / 2)));
    $('chip-double').onclick = () => setBetDisplay(Math.min(1000, parseFloat(betInput.value) * 2));

    // Difficulty Segmented Control
    const segBtns = body.querySelectorAll('.road-seg-btn');
    segBtns.forEach((b) => {
      b.onclick = async () => {
        if (st.active || busy) return;
        curDiff = b.dataset.diff;
        segBtns.forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        sfx.tick();
        try {
          st = await C.api(`/games/road?difficulty=${curDiff}`);
          renderScene(true);
          updateControls();
        } catch (e) { /* ignore */ }
      };
    });

    // Sub-tabs handling
    $('tab-bets-btn').onclick = () => {
      activeSubTab = 'bets';
      $('tab-bets-btn').classList.add('active');
      $('tab-fair-btn').classList.remove('active');
      renderSubTab();
    };
    $('tab-fair-btn').onclick = () => {
      activeSubTab = 'fairness';
      $('tab-fair-btn').classList.add('active');
      $('tab-bets-btn').classList.remove('active');
      renderSubTab();
    };

    async function loadHistory() {
      try {
        const r = await C.api('/games/road/history');
        roundHistory = r.rounds || r.history || [];
        if (activeSubTab === 'bets') renderSubTab();
      } catch (e) { /* ignore */ }
    }

    function renderSubTab() {
      const pane = $('road-tab-pane');
      if (!pane) return;
      if (activeSubTab === 'bets') {
        if (roundHistory.length === 0) {
          pane.innerHTML = `<div style="text-align:center;color:#8c9b91;padding:16px">${esc(t('no_data'))}</div>`;
          return;
        }
        pane.innerHTML = `
          <div style="overflow-x:auto">
            <table class="road-history-table">
              <thead>
                <tr>
                  <th>${esc(t('date'))}</th>
                  <th>${esc(t('difficulty') || 'Difficulty')}</th>
                  <th>${esc(t('bet'))}</th>
                  <th>${esc(t('lane'))}</th>
                  <th>${esc(t('multiplier') || 'Multiplier')}</th>
                  <th>${esc(t('payout') || 'Payout')}</th>
                  <th>${esc(t('status'))}</th>
                  <th>${esc(t('verify_btn'))}</th>
                </tr>
              </thead>
              <tbody>
                ${roundHistory.map((row) => `
                  <tr>
                    <td>${esc(row.created_at ? row.created_at.slice(11, 19) : '—')}</td>
                    <td style="text-transform:capitalize">${esc(row.difficulty)}</td>
                    <td>${C.fmt(row.bet)}</td>
                    <td>${row.step}</td>
                    <td style="font-weight:800;color:#F2D98B">×${Number(row.multiplier || 1).toFixed(2)}</td>
                    <td class="${row.payout > 0 ? 'tag-win' : 'tag-lose'}">${row.payout > 0 ? '+' + C.fmt(row.payout) : '0'}</td>
                    <td><span class="${row.result === 'win' ? 'tag-win' : 'tag-lose'}">${row.result === 'win' ? 'WIN' : 'CRASH'}</span></td>
                    <td>
                      ${row.server_seed ? `
                        <button class="chip" style="font-size:11px;padding:3px 8px" onclick="window.verifyRoadRound('${esc(row.server_seed)}', '${esc(row.client_seed || '')}', ${row.step}, '${esc(row.difficulty)}')">
                          ${esc(t('verify_btn'))}
                        </button>
                      ` : '<span style="color:#666">—</span>'}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>`;
      } else {
        // Provably Fair tab
        pane.innerHTML = `
          <div class="fairness-grid">
            <div class="fairness-field">
              <label class="fairness-label">${esc(t('server_seed_hash'))}</label>
              <input class="fairness-input" id="pf-server-hash" type="text" readonly value="${esc(st.server_seed_hash || 'Round not started yet')}" />
            </div>
            <div class="fairness-field">
              <label class="fairness-label">${esc(t('client_seed'))}</label>
              <input class="fairness-input" id="pf-client-seed" type="text" value="${esc(st.client_seed || customClientSeed)}" ${st.active ? 'readonly' : ''} />
            </div>
            <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:8px 0" />
            <h4 style="margin:0;color:#F2D98B;font-size:14px">🔍 ${esc(t('verify_tool'))}</h4>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <div class="fairness-field">
                <label class="fairness-label">${esc(t('server_seed'))}</label>
                <input class="fairness-input" id="v-server-seed" placeholder="e.g. 32-byte hex seed" />
              </div>
              <div class="fairness-field">
                <label class="fairness-label">${esc(t('client_seed'))}</label>
                <input class="fairness-input" id="v-client-seed" placeholder="e.g. client seed" />
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <div class="fairness-field">
                <label class="fairness-label">${esc(t('target_lane'))}</label>
                <input class="fairness-input" id="v-lane" type="number" min="1" max="24" value="1" />
              </div>
              <div class="fairness-field">
                <label class="fairness-label">${esc(t('difficulty') || 'Difficulty')}</label>
                <select class="fairness-input" id="v-diff">
                  <option value="easy">Easy (24)</option>
                  <option value="medium">Medium (22)</option>
                  <option value="hard">Hard (20)</option>
                  <option value="hardcore">Hardcore (15)</option>
                </select>
              </div>
            </div>
            <div>
              <button class="btn btn-gold" id="btn-run-verify" style="padding:8px 18px" type="button">
                ${esc(t('verify_btn'))}
              </button>
            </div>
            <div class="fairness-result-box" id="v-result" style="display:none"></div>
          </div>`;

        $('pf-client-seed').oninput = (e) => { customClientSeed = e.target.value; };
        $('btn-run-verify').onclick = async () => {
          const sSeed = $('v-server-seed').value.trim();
          const cSeed = $('v-client-seed').value.trim();
          const lane = Number($('v-lane').value);
          const diff = $('v-diff').value;
          const resBox = $('v-result');
          if (!sSeed || !cSeed || !lane) {
            resBox.style.display = 'block';
            resBox.innerHTML = `<span style="color:var(--danger)">Please enter server seed, client seed, and lane number.</span>`;
            return;
          }
          try {
            const r = await C.api('/games/road/verify', { server_seed: sSeed, client_seed: cSeed, lane, difficulty: diff });
            resBox.style.display = 'block';
            resBox.innerHTML = `
              <div style="display:flex;align-items:center;gap:8px;font-weight:900;font-size:14px;color:${r.is_hazard ? '#ef4444' : '#4ade80'};margin-bottom:6px">
                <span>${r.is_hazard ? '💥' : '✅'}</span>
                <span>${r.is_hazard ? esc(t('verified_hazard')) : esc(t('verified_safe'))}</span>
              </div>
              <div style="font-family:monospace;font-size:11px;color:#9ca3af;word-break:break-all">
                Hash: ${r.hash}<br/>
                Computed Value: ${r.value} (Threshold p: ${r.crash_chance})
              </div>`;
          } catch (e) {
            resBox.style.display = 'block';
            resBox.innerHTML = `<span style="color:var(--danger)">Verification error: ${esc(e.message || 'Invalid parameters')}</span>`;
          }
        };
      }
    }

    // Global helper for row click in history
    window.verifyRoadRound = (serverSeed, clientSeed, lane, diff) => {
      activeSubTab = 'fairness';
      $('tab-fair-btn').classList.add('active');
      $('tab-bets-btn').classList.remove('active');
      renderSubTab();
      setTimeout(() => {
        if ($('v-server-seed')) $('v-server-seed').value = serverSeed;
        if ($('v-client-seed')) $('v-client-seed').value = clientSeed;
        if ($('v-lane')) $('v-lane').value = lane;
        if ($('v-diff')) $('v-diff').value = diff;
        if ($('btn-run-verify')) $('btn-run-verify').click();
      }, 50);
    };

    // Render Road Lanes & Objects with layer separation
    function renderScene(fullReset = true) {
      const lanesWrap = $('rlanes');
      if (!lanesWrap) return;
      const maxSteps = st.maxSteps || 24;
      const ladder = st.ladder || [];

      if (fullReset) {
        // Clear all vehicles and reset spawn schedules on fresh round or reset
        activeVehicles.forEach((v) => { if (v.el) v.el.remove(); });
        activeVehicles = [];
        laneNextSpawn = {};
        clearingTargetLane = null;
        isCrashAnimActive = false;

        let html = '';
        for (let i = 1; i <= maxSteps; i++) {
          const isCleared = st.active && i <= st.step;
          const isTarget = st.active && i === st.step + 1;
          const multVal = ladder[i - 1] ? Number(ladder[i - 1]).toFixed(2) : '1.00';

          let layers = '';
          if (isCleared) {
            layers = `
              <div class="lane-traffic-layer" id="lane-traffic-${i}"></div>
              <div class="lane-barrier-layer">${makeBarrierHtml()}</div>
              <div class="lane-coin-layer">${makeCoinEmblemHtml()}</div>
            `;
          } else {
            layers = `
              <div class="lane-manhole-layer">${makeManholeHtml(i, multVal, isTarget)}</div>
              <div class="lane-traffic-layer" id="lane-traffic-${i}"></div>
            `;
          }

          html += `
            <div class="road-lane ${isCleared ? 'lane-cleared' : ''} ${isTarget ? 'lane-target' : ''}" id="road-ln-${i}" data-lane="${i}">
              ${layers}
            </div>
          `;
        }
        lanesWrap.innerHTML = html;
      } else {
        // Incremental update on hop to preserve ahead traffic animation
        const currentL = st.active ? st.step : 0;
        for (let i = 1; i <= maxSteps; i++) {
          const laneEl = $('road-ln-' + i);
          if (!laneEl) continue;
          const isCleared = st.active && i <= currentL;
          const isTarget = st.active && i === currentL + 1;
          const multVal = ladder[i - 1] ? Number(ladder[i - 1]).toFixed(2) : '1.00';

          laneEl.classList.toggle('lane-cleared', isCleared);
          laneEl.classList.toggle('lane-target', isTarget);

          if (isCleared) {
            const mhLayer = laneEl.querySelector('.lane-manhole-layer');
            if (mhLayer) mhLayer.remove();

            if (!laneEl.querySelector('.lane-barrier-layer')) {
              const bLayer = document.createElement('div');
              bLayer.className = 'lane-barrier-layer';
              bLayer.innerHTML = makeBarrierHtml();
              laneEl.appendChild(bLayer);
            }
            if (!laneEl.querySelector('.lane-coin-layer')) {
              const cLayer = document.createElement('div');
              cLayer.className = 'lane-coin-layer';
              cLayer.innerHTML = makeCoinEmblemHtml();
              laneEl.appendChild(cLayer);
            }
          } else {
            let mhLayer = laneEl.querySelector('.lane-manhole-layer');
            if (!mhLayer) {
              mhLayer = document.createElement('div');
              mhLayer.className = 'lane-manhole-layer';
              mhLayer.innerHTML = makeManholeHtml(i, multVal, isTarget);
              laneEl.insertBefore(mhLayer, laneEl.firstChild);
            } else {
              const cover = mhLayer.querySelector('.manhole-cover');
              if (cover) {
                cover.classList.toggle('is-target', isTarget);
                const txt = cover.querySelector('.manhole-mult-text');
                if (txt) txt.classList.toggle('target-glow', isTarget);
              }
            }
          }
        }
      }

      updateChickenPosition(st.active ? st.step : 0, false);
    }

    // Dust puff on chicken landing
    function spawnDustPuff(chicken) {
      if (!chicken) return;
      const puff = document.createElement('div');
      puff.className = 'dust-puff';
      puff.innerHTML = `<svg viewBox="0 0 50 16" width="44" height="14" fill="#cbd5e1" opacity="0.8">
        <ellipse cx="14" cy="9" rx="9" ry="4"/>
        <ellipse cx="25" cy="8" rx="13" ry="5"/>
        <ellipse cx="36" cy="9" rx="8" ry="4"/>
      </svg>`;
      chicken.appendChild(puff);
      setTimeout(() => puff.remove(), 420);
    }

    // Camera and Hero tracking
    function updateChickenPosition(step, hop = true) {
      const chicken = $('road-chicken');
      const tagText = chicken ? chicken.querySelector('.tag-mult-text') : null;
      const sc = $('rsc');
      if (!chicken) return;

      const lx = heroLeft(step);
      chicken.style.transform = `translateX(${lx}px)`;

      if (tagText) {
        if (step > 0 && st.mult) {
          tagText.textContent = Number(st.mult).toFixed(2) + '×';
        } else {
          tagText.textContent = '1.00×';
        }
      }

      if (hop) {
        chicken.classList.remove('is-hopping', 'is-dead', 'is-win');
        void chicken.offsetWidth;
        chicken.classList.add('is-hopping');
        sfx.hop();
        setTimeout(() => {
          if (chicken) {
            chicken.classList.remove('is-hopping');
            spawnDustPuff(chicken);
          }
        }, 450);
      }

      // Smooth horizontal camera tracking: keep chicken at ~1/8th (12.5%) from left edge
      if (sc) {
        const targetScroll = Math.max(0, lx - sc.clientWidth * 0.125);
        sc.scrollTo({ left: targetScroll, behavior: 'smooth' });
      }
    }

    // Update Controls & Buttons
    function updateControls() {
      const goBtn = $('rgo-btn');
      const cashoutBtn = $('rcashout-btn');
      const cashoutLabel = $('rcashout-label');
      const shotVal = $('rshot-val');
      const balVal = $('road-bal-val');

      if (balVal && st.balance !== undefined) {
        balVal.textContent = C.fmt(st.balance);
      }

      // Next lane crash chance
      if (shotVal) {
        const ch = st.next_crash_chance;
        shotVal.textContent = (ch !== undefined && ch !== null) ? `${Number(ch).toFixed(2)}%` : '—';
      }

      // Lock/unlock inputs based on active round
      betInput.disabled = st.active;
      $('bet-min').disabled = st.active;
      $('bet-max').disabled = st.active;
      $('bet-minus').disabled = st.active;
      $('bet-plus').disabled = st.active;
      body.querySelectorAll('.road-chip-btn').forEach((b) => { b.disabled = st.active; });
      body.querySelectorAll('.road-seg-btn').forEach((b) => { b.disabled = st.active; });

      if (!st.active) {
        goBtn.disabled = false;
        $('rgo-icon').textContent = '▶';
        $('rgo-label').textContent = esc(t('play') || 'Play');
        cashoutBtn.style.display = 'none';
        cashoutBtn.disabled = true;
      } else {
        goBtn.disabled = false;
        $('rgo-icon').textContent = '🐔';
        $('rgo-label').textContent = `${esc(t('go'))} (Lane ${st.step + 1})`;
        cashoutBtn.style.display = 'inline-flex';
        if (st.step >= 1) {
          cashoutBtn.disabled = false;
          const payoutAmt = payoutPreview(st.bet, st.mult);
          cashoutLabel.textContent = `${esc(t('cashout'))} · Gross ${C.fmt(payoutAmt)}`;
        } else {
          cashoutBtn.disabled = true;
          cashoutLabel.textContent = esc(t('cashout'));
        }
      }
    }

    function lockButtons(locked) {
      const goBtn = $('rgo-btn');
      const cashoutBtn = $('rcashout-btn');
      if (goBtn) {
        goBtn.disabled = locked;
        goBtn.classList.toggle('is-dimmed', locked);
      }
      if (cashoutBtn) {
        cashoutBtn.disabled = locked || (st.active && st.step < 1);
        cashoutBtn.classList.toggle('is-dimmed', locked);
      }
    }

    // Trigger feather burst on car collision
    function spawnFeathers(laneEl) {
      if (!laneEl) return;
      for (let i = 0; i < 8; i++) {
        const f = document.createElement('span');
        f.className = 'feather-particle';
        f.textContent = '🪶';
        const angle = (i / 8) * 2 * Math.PI;
        const dist = 50 + Math.random() * 50;
        f.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
        f.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
        f.style.setProperty('--rot', `${Math.random() * 360}deg`);
        f.style.left = '50%';
        f.style.top = '170px';
        laneEl.appendChild(f);
        setTimeout(() => f.remove(), 1200);
      }
    }

    // =========================================================
    // TRAFFIC ENGINE: DOWNWARD ONLY, PASSED LANES ARE TRAFFIC-FREE
    // =========================================================
    function fadeCar(v) {
      if (!v || v.fading) return;
      v.fading = true;
      if (v.el) {
        v.el.classList.add('car-fade-out');
      }
      setTimeout(() => {
        removeCar(v);
      }, 240);
    }

    function removeCar(v) {
      if (v.el) {
        v.el.remove();
      }
      const idx = activeVehicles.indexOf(v);
      if (idx !== -1) activeVehicles.splice(idx, 1);
    }

    function canSpawnInLane(laneNum) {
      // If round is active:
      // 1. Any lane <= current chicken step is passed -> Traffic is strictly forbidden!
      if (st.active && laneNum <= st.step) return false;
      // 2. If this lane is the target lane currently being cleared before hop landing -> Do not spawn!
      if (clearingTargetLane !== null && laneNum === clearingTargetLane) return false;
      return true;
    }

    // Consistent speed per lane so cars in the same lane never overtake each other
    function getLaneSpeed(laneNum, reduced) {
      if (reduced) return 1.4 + ((laneNum * 3) % 4) * 0.2;
      // Range: 2.2 to 3.6 px/frame
      return 2.2 + ((laneNum * 7) % 5) * 0.35;
    }

    function spawnCarInLane(laneNum, forceType = null, customY = -170, customSpeed = null) {
      const trafficLayer = $('lane-traffic-' + laneNum);
      if (!trafficLayer) return null;

      const type = forceType || VEHICLE_KEYS[Math.floor(Math.random() * VEHICLE_KEYS.length)];
      const el = document.createElement('div');
      el.className = 'traffic-car-wrap';
      el.innerHTML = VEHICLE_SVGS[type] || VEHICLE_SVGS.taxi;
      trafficLayer.appendChild(el);

      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const baseSpeed = customSpeed || getLaneSpeed(laneNum, reduced);

      const carObj = {
        id: ++carIdSeq,
        lane: laneNum,
        type,
        el,
        y: customY,
        speed: baseSpeed,
        h: type === 'bus' ? 160 : type === 'fire_truck' ? 148 : 120,
        fading: false
      };
      el.style.transform = `translate3d(0, ${carObj.y}px, 0)`;
      activeVehicles.push(carObj);
      return carObj;
    }

    function clearPassedLanes(currentL) {
      if (currentL <= 0) return;
      for (let i = 1; i <= currentL; i++) {
        laneNextSpawn[i] = Infinity;
      }
      for (const v of activeVehicles) {
        if (v.lane <= currentL && !v.fading) {
          v.speed = Math.max(v.speed * 2.8, 9.5);
          // If above or near barrier/chicken (y < 235), fade out immediately so it never touches barrier/chicken
          if (v.y < 235) {
            fadeCar(v);
          } else {
            // Lower vehicle speeds off bottom; if still visible after ~550ms, fade out
            setTimeout(() => {
              if (v && !v.fading) fadeCar(v);
            }, 550);
          }
        }
      }
    }

    function updateTraffic(dtScale, now) {
      const sc = $('rsc');
      const maxSteps = st.maxSteps || 24;
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      // Determine visible lanes
      const scrollL = sc ? sc.scrollLeft : 0;
      const viewW = sc ? sc.clientWidth : 800;
      const firstVisLane = Math.max(1, Math.floor((scrollL - CURB_W) / LANE_W) - 1);
      const lastVisLane = Math.min(maxSteps, Math.ceil((scrollL + viewW - CURB_W) / LANE_W) + 2);

      // Spawn traffic ONLY in valid ahead lanes (lanes > current chicken lane)
      for (let i = firstVisLane; i <= lastVisLane; i++) {
        if (!canSpawnInLane(i)) continue;

        if (!laneNextSpawn[i]) laneNextSpawn[i] = now + Math.random() * (reduced ? 3500 : 2000);

        if (now >= laneNextSpawn[i]) {
          const carsInLane = activeVehicles.filter((v) => v.lane === i && !v.fading);
          // Strictly prevent double cars: only spawn if lane is empty OR the previous car is almost completely off screen (y > 270)
          const canSpawnNewCar = carsInLane.length === 0 || (carsInLane.length === 1 && carsInLane[0].y > 270);
          if (canSpawnNewCar) {
            spawnCarInLane(i);
          }
          const interval = reduced ? 4500 + Math.random() * 3000 : 2500 + Math.random() * 2500;
          laneNextSpawn[i] = now + interval;
        }
      }

      // Move active vehicles strictly DOWNWARD
      for (let i = activeVehicles.length - 1; i >= 0; i--) {
        const v = activeVehicles[i];
        v.y += v.speed * dtScale;
        if (v.el) {
          v.el.style.transform = `translate3d(0, ${v.y}px, 0)`;
        }
        // Remove if exited bottom
        if (v.y > 380) {
          removeCar(v);
        }
      }

      // Anti-tailgating & anti-overlap physics clamp: enforce strict gap between cars in same lane
      for (let i = 1; i <= maxSteps; i++) {
        const inLane = activeVehicles.filter((v) => v.lane === i && !v.fading).sort((a, b) => b.y - a.y);
        for (let k = 1; k < inLane.length; k++) {
          const leader = inLane[k - 1];
          const trailer = inLane[k];
          const minGap = 180; // Minimum bumper-to-bumper gap in pixels
          if (leader.y - trailer.y < minGap) {
            trailer.speed = leader.speed;
            trailer.y = leader.y - minGap;
            if (trailer.el) {
              trailer.el.style.transform = `translate3d(0, ${trailer.y}px, 0)`;
            }
          }
        }
      }
    }

    // Development Check: in dev mode, log console warning if vehicle overlaps chicken, tag, barrier, or another vehicle
    function devCheckCollisions() {
      const isDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1' || window.DEV_MODE;
      if (!isDev || isCrashAnimActive) return;

      const currentL = st.active ? st.step : 0;
      for (let i = 0; i < activeVehicles.length; i++) {
        const v = activeVehicles[i];
        if (v.fading) continue;

        // 1. Check overlap with chicken & tag in chicken's current lane (y range ~125 to 225)
        if (currentL > 0 && v.lane === currentL) {
          const carTop = v.y;
          const carBottom = v.y + v.h;
          if (carBottom > 125 && carTop < 225) {
            console.warn(`[Road Dash Dev Check] Overlap detected: Vehicle ${v.id} (${v.type}) overlaps chicken/tag in current lane ${v.lane}! (carY: ${v.y.toFixed(1)}, carBottom: ${carBottom.toFixed(1)})`);
          }
        }

        // 2. Check overlap with barrier in any passed lane <= currentL (barrier at y: 60 to 98)
        if (currentL > 0 && v.lane <= currentL) {
          const carTop = v.y;
          const carBottom = v.y + v.h;
          if (carBottom > 58 && carTop < 100) {
            console.warn(`[Road Dash Dev Check] Overlap detected: Vehicle ${v.id} (${v.type}) overlaps barrier in passed lane ${v.lane}! (carY: ${v.y.toFixed(1)})`);
          }
        }

        // 3. Check if vehicle is in passed lane above road
        if (currentL > 0 && v.lane <= currentL && v.y < 50) {
          console.warn(`[Road Dash Dev Check] Vehicle ${v.id} spawned or moving in passed lane ${v.lane}! (carY: ${v.y.toFixed(1)})`);
        }

        // 4. Check if two vehicles overlap in the same lane (Double car check!)
        for (let j = i + 1; j < activeVehicles.length; j++) {
          const v2 = activeVehicles[j];
          if (v.lane === v2.lane && !v2.fading) {
            if (v.y + v.h > v2.y && v2.y + v2.h > v.y) {
              console.warn(`[Road Dash Dev Check] Double car overlap in lane ${v.lane}! Car ${v.id} (${v.type}, y: ${v.y.toFixed(1)}) and Car ${v2.id} (${v2.type}, y: ${v2.y.toFixed(1)})`);
            }
          }
        }
      }
    }

    function trafficLoop(now) {
      if (!trafficRunning) return;
      const dt = Math.min(100, now - lastTrafficTime);
      lastTrafficTime = now;
      const dtScale = dt / 16.67;

      updateTraffic(dtScale, now);
      devCheckCollisions();
      trafficAnimId = requestAnimationFrame(trafficLoop);
    }
    // Visibility Listener
    function onVisChange() {
      if (document.hidden) {
        trafficRunning = false;
        if (trafficAnimId) cancelAnimationFrame(trafficAnimId);
      } else {
        trafficRunning = true;
        lastTrafficTime = performance.now();
        trafficAnimId = requestAnimationFrame(trafficLoop);
      }
    }
    document.addEventListener('visibilitychange', onVisChange);
    stopFns.push(() => {
      trafficRunning = false;
      if (trafficAnimId) cancelAnimationFrame(trafficAnimId);
      document.removeEventListener('visibilitychange', onVisChange);
    });

    // Start traffic loop
    trafficAnimId = requestAnimationFrame(trafficLoop);

    // =========================================================
    // STEP ACTION
    // =========================================================
    async function doStep() {
      if (busy) return;
      busy = true;
      lockButtons(true);
      say($('rmsg'), '');

      // Inactive round -> Start it!
      if (!st.active) {
        try {
          st = await C.api('/games/road/start', {
            bet: currentBetCents,
            difficulty: curDiff,
            client_seed: customClientSeed
          });
          C.setBalance(st.balance);
          roadRoundSerial++;
          const chicken = $('road-chicken');
          if (chicken) chicken.classList.remove('is-dead', 'is-win', 'is-hopping');
          renderScene(true); // Full reset: all lanes active, traffic in every lane
          updateControls();
          renderSubTab();
        } catch (e) {
          C.fail(e);
        }
        busy = false;
        lockButtons(false);
        return;
      }

      // Active round -> Hop to next lane
      const targetLane = st.step + 1;
      clearingTargetLane = targetLane;
      laneNextSpawn[targetLane] = Infinity;

      // Immediately accelerate vehicles in target lane so chicken row is empty before landing
      for (const v of activeVehicles) {
        if (v.lane === targetLane && !v.fading) {
          v.speed = Math.max(v.speed * 3.2, 10.5);
          if (v.y < 100) {
            setTimeout(() => {
              if (v && !v.fading) fadeCar(v);
            }, 200);
          }
        }
      }

      // Begin hop motion (450ms)
      updateChickenPosition(targetLane, true);

      // At landing time (430ms): remove any vehicle whose box still overlaps chicken row
      setTimeout(() => {
        for (const v of activeVehicles) {
          if (v.lane === targetLane && v.y + v.h > 105 && v.y < 235) {
            fadeCar(v);
          }
        }
      }, 430);

      try {
        const r = await C.api('/games/road/step', {});
        C.setBalance(r.balance);

        if (r.crashed) {
          isCrashAnimActive = true;
          clearingTargetLane = null;
          // Fade ambient cars in target lane so only the crash car hits
          for (const v of activeVehicles) {
            if (v.lane === targetLane) fadeCar(v);
          }

          await sleep(180);
          const laneEl = $('road-ln-' + targetLane);
          // Spawn dedicated crash car entering from top downward
          const crashCar = spawnCarInLane(targetLane, 'police', -180, 18);
          sfx.horn();
          await sleep(150);
          sfx.crash();

          const vp = $('rviewport');
          if (vp) {
            vp.classList.add('road-shake');
            setTimeout(() => vp.classList.remove('road-shake'), 320);
          }
          const chicken = $('road-chicken');
          if (chicken) {
            chicken.classList.remove('is-hopping', 'is-win');
            chicken.classList.add('is-dead');
          }
          spawnFeathers(laneEl);
          say($('rmsg'), '');
          sfx.lose();
          showRoadResult('crash', r, st.bet);

          isCrashAnimActive = false;
          st = {
            active: false,
            balance: r.balance,
            difficulty: curDiff,
            ladder: r.ladder || st.ladder,
            maxSteps: r.maxSteps || st.maxSteps,
            next: (r.ladder && r.ladder[0]) || 1.00,
            next_crash_chance: 1.8
          };
          renderScene(true); // Full reset for upcoming round
          updateControls();
          loadHistory();
        } else if (r.finished) {
          // Final lane reached! Maximum win
          clearingTargetLane = null;
          clearPassedLanes(targetLane);
          renderScene(false);
          await sleep(250);
          const chicken = $('road-chicken');
          if (chicken) {
            chicken.classList.remove('is-hopping', 'is-dead');
            chicken.classList.add('is-win');
          }
          sfx.coin();
          if (r.net > 0) { sfx.win(); coinRain(stage); }
          say($('rmsg'), '');
          showRoadResult('complete', r, st.bet);

          st = {
            active: false,
            balance: r.balance,
            difficulty: curDiff,
            ladder: r.ladder || st.ladder,
            maxSteps: r.maxSteps || st.maxSteps,
            next: (r.ladder && r.ladder[0]) || 1.00,
            next_crash_chance: 1.8
          };
          renderScene(true); // Reset for new round
          updateControls();
          loadHistory();
        } else {
          // Safe step landed!
          sfx.coin();
          st = r;
          clearingTargetLane = null;
          clearPassedLanes(st.step);
          renderScene(false); // Incremental update
          updateControls();
        }
      } catch (e) {
        clearingTargetLane = null;
        C.fail(e);
        updateChickenPosition(st.step, false);
      }

      busy = false;
      lockButtons(false);
    }

    // =========================================================
    // CASHOUT ACTION
    // =========================================================
    async function doCashout() {
      if (busy || !st.active || st.step < 1) return;
      busy = true;
      lockButtons(true);
      try {
        const r = await C.api('/games/road/cashout', {});
        C.setBalance(r.balance);
        const chicken = $('road-chicken');
        if (chicken) {
          chicken.classList.remove('is-hopping', 'is-dead');
          chicken.classList.add('is-win');
        }
        if (r.net > 0) { sfx.win(); coinRain(stage); }
        say($('rmsg'), '');
        showRoadResult('cashout', r, st.bet);

        st = {
          active: false,
          balance: r.balance,
          difficulty: curDiff,
          ladder: r.ladder || st.ladder,
          maxSteps: r.maxSteps || st.maxSteps,
          next: (r.ladder && r.ladder[0]) || 1.00,
          next_crash_chance: 1.8
        };
        renderScene(true); // Reset for new round!
        updateControls();
        loadHistory();
      } catch (e) {
        C.fail(e);
      }
      busy = false;
      lockButtons(false);
    }

    $('rgo-btn').onclick = doStep;
    $('rcashout-btn').onclick = doCashout;

    // Keyboard Shortcuts: Space = GO, Enter = Cash Out
    function handleKeyDown(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
      if (e.code === 'Space') {
        e.preventDefault();
        doStep();
      } else if (e.code === 'Enter') {
        e.preventDefault();
        if (st.active && st.step >= 1) doCashout();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    stopFns.push(() => window.removeEventListener('keydown', handleKeyDown));

    // Initialize state
    async function initGame() {
      try {
        const serverState = await C.api(`/games/road?difficulty=${curDiff}`);
        if (serverState) {
          st = serverState;
          if (st.difficulty) curDiff = st.difficulty;
        }
      } catch (e) { /* ignore */ }
      renderScene(true);
      const roadViewport = $('rviewport');
      if (roadViewport && window.ResizeObserver) {
        const syncRoadGeometry = () => {
          const lane = $('road-ln-1');
          const curb = $('rsidewalk');
          if (lane) LANE_W = lane.getBoundingClientRect().width || 118;
          if (curb) CURB_W = curb.getBoundingClientRect().width || 140;
          updateChickenPosition(st.active ? st.step : 0, false);
        };
        const roadResizeObserver = new ResizeObserver(syncRoadGeometry);
        roadResizeObserver.observe(roadViewport);
        stopFns.push(() => roadResizeObserver.disconnect());
        syncRoadGeometry();
      }
      updateControls();
      renderSubTab();
      loadHistory();
    }
    initGame();
  }
  // =========================================================
  // ROULETTE
  // =========================================================
  const ORDER = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
  const REDS  = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
  const colorOf = (n) => (n === 0 ? 'green' : REDS.has(n) ? 'red' : 'black');

  function roulette(body, stage) {
    const { t, esc } = C;
    let sel = null, spinning = false, everSpun = false, balanceVisible = false, wheelA = 0, ballA = 0, ballR = 150, history = [];
    const selectionUndo = [];
    body.innerHTML = `
      <div class="roulette-screen">
        <div class="roulette-play-layout">
          <section class="roulette-wheel-panel" aria-label="Roulette wheel and recent results">
            <div class="roulette-recent-wrap">
              <span class="roulette-section-label roulette-results-label">RECENT RESULTS</span>
              <div class="history" id="hist" aria-label="Recent roulette results"><span class="roulette-history-empty">No results yet</span></div>
            </div>
            <div class="wheel-box">
              <span class="roulette-last-result" id="roulette-last-result" aria-label="Last result">—</span>
              <canvas id="wheel" aria-label="European roulette wheel"></canvas>
              <span class="roulette-wheel-spacer" aria-hidden="true"></span>
            </div>
          </section>
          <section class="roulette-bet-panel" aria-label="Roulette betting table">
            <div class="roulette-bet-tools">
              <button type="button" id="rundo" disabled>↶ <span>Undo</span></button>
              <button type="button" id="rclear" disabled><span>Clear</span> ↻</button>
            </div>
            <p class="roulette-payout-guide">Gross payout: straight-up 11.10× · even-money 0.62× (partial return)</p>
            <div class="rtable-wrap"><div class="rtable" id="rtab"></div></div>
            <!-- TODO: Dozen bets (1 to 12 / 13 to 24 / 25 to 36) are not
                 supported by the current roulette bet logic. These cells are
                 rendered for layout parity only and must stay disabled. -->
            <div class="roulette-outside-dozens" aria-label="Dozen bets (visual only, unsupported)">
              <button type="button" disabled title="Dozen bets are not supported by the current roulette rules">1 to 12</button>
              <button type="button" disabled title="Dozen bets are not supported by the current roulette rules">13 to 24</button>
              <button type="button" disabled title="Dozen bets are not supported by the current roulette rules">25 to 36</button>
            </div>
            <div class="outside roulette-outside-supported" id="rout"></div>
            <div class="pick" id="rpick">${esc(t('pick_prompt'))}</div>
            <button class="roulette-bet-button" id="rgo" aria-label="Place roulette bet and spin">${esc(t('bet'))}</button>
            <div id="rbet"></div>
            <div class="msg" id="rmsg"></div>
          </section>
        </div>
      </div>`;

    const bet = betBar($('rbet'));
    const betBarElement = $('rbet').querySelector('.betbar');
    const chips = betBarElement.querySelector('.chips');
    const betRow = betBarElement.querySelector('.betrow');
    const currencyLabel = betRow.querySelectorAll('span.muted')[1];
    if (currencyLabel) currencyLabel.textContent = 'ETB';
    const chipLabel = document.createElement('div');
    chipLabel.className = 'roulette-chip-value';
    chipLabel.setAttribute('aria-live', 'polite');
    const chipScroller = document.createElement('div');
    chipScroller.className = 'roulette-chip-scroller';
    const chipBack = document.createElement('button');
    chipBack.type = 'button'; chipBack.className = 'roulette-chip-arrow';
    chipBack.setAttribute('aria-label', 'Scroll chips left'); chipBack.textContent = '‹';
    const chipForward = document.createElement('button');
    chipForward.type = 'button'; chipForward.className = 'roulette-chip-arrow';
    chipForward.setAttribute('aria-label', 'Scroll chips right'); chipForward.textContent = '›';
    chipScroller.append(chipBack, chips, chipForward);
    betBarElement.replaceChildren(chipLabel, chipScroller, betRow);
    const updateChipLabel = () => { chipLabel.textContent = `Chip value ${(bet.get() / 100).toFixed(2)} ETB`; };
    updateChipLabel();
    betBarElement.querySelector('input').addEventListener('input', updateChipLabel);
    chips.addEventListener('click', updateChipLabel);
    betRow.addEventListener('click', updateChipLabel);
    chipBack.onclick = () => chips.scrollBy({ left: -140, behavior: 'smooth' });
    chipForward.onclick = () => chips.scrollBy({ left: 140, behavior: 'smooth' });

    const accountValue = $('roulette-account-value');
    const paintAccountBalance = () => {
      if (!accountValue) return;
      const value = C.fmt(C.getBalance?.() || 0) + ' ETB';
      accountValue.textContent = balanceVisible ? value : '•••••• ETB';
      $('roulette-account-visibility')?.setAttribute('aria-pressed', String(balanceVisible));
      $('roulette-account-visibility')?.setAttribute('aria-label', balanceVisible ? 'Hide wallet balance' : 'Show wallet balance');
    };
    paintAccountBalance();
    $('roulette-account-visibility')?.addEventListener('click', () => { balanceVisible = !balanceVisible; paintAccountBalance(); });
    $('roulette-account-dropdown-toggle')?.addEventListener('click', (event) => {
      const menu = $('roulette-account-menu');
      menu.hidden = !menu.hidden;
      event.currentTarget.setAttribute('aria-expanded', String(!menu.hidden));
    });
    $('roulette-account-avatar')?.addEventListener('click', () => document.querySelector('#nav [data-k="profile"]')?.click());
    $('roulette-account-menu')?.querySelectorAll('[data-roulette-nav]').forEach((button) => {
      button.addEventListener('click', () => document.querySelector(`#nav [data-k="${button.dataset.rouletteNav}"]`)?.click());
    });
    $('roulette-deposit-button')?.addEventListener('click', () => $('quickDepositBtn')?.click());
    const closeAccountMenu = (event) => {
      if (!event.target.closest('.roulette-account-strip')) {
        const menu = $('roulette-account-menu');
        const toggle = $('roulette-account-dropdown-toggle');
        if (menu && !menu.hidden) { menu.hidden = true; toggle?.setAttribute('aria-expanded', 'false'); }
      }
    };
    document.addEventListener('click', closeAccountMenu);
    stopFns.push(() => document.removeEventListener('click', closeAccountMenu));

    const tab = $('rtab');
    let html = `<button class="zero" data-k="number" data-v="0">0</button>`;
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 12; col++) {
        const n = col * 3 + (3 - row);
        html += `<button class="${colorOf(n)}" data-k="number" data-v="${n}">${n}</button>`;
      }
      html += '<button class="roulette-unavailable roulette-column-marker" type="button" disabled title="Column bets are not supported by the current roulette rules">2:1</button>';
    }
    // TODO: The server currently accepts only number, color and parity wagers.
    // Keep the familiar 2:1 column markers visible but inert until that bet
    // type is supported by the authoritative endpoint.
    tab.innerHTML = html;
    // TODO: Low (1 to 18) and high (19 to 36) bets are not supported by the
    // current roulette bet logic. They are rendered for layout parity only
    // and must stay disabled until the authoritative endpoint supports them.
    $('rout').innerHTML = `
      <button class="roulette-unavailable" type="button" disabled title="Low bets are not supported by the current roulette rules">1 to 18</button>
      <button class="eo"   data-k="parity" data-v="even" >${esc(t('even'))}</button>
      <button class="red"  data-k="color"  data-v="red"  aria-label="${esc(t('red'))}"></button>
      <button class="black" data-k="color" data-v="black" aria-label="${esc(t('black'))}"></button>
      <button class="eo"   data-k="parity" data-v="odd"  >${esc(t('odd'))}</button>
      <button class="roulette-unavailable" type="button" disabled title="High bets are not supported by the current roulette rules">19 to 36</button>`;

    function paintSelection() {
      body.querySelectorAll('[data-k]').forEach((button) => {
        button.classList.toggle('sel', Boolean(sel && button.dataset.k === sel.kind &&
          String(button.dataset.v) === String(sel.value)));
      });
      $('rpick').textContent = sel
        ? `${t('picked')}: ${sel.kind === 'number' ? sel.value : sel.value}  (gross ×${sel.kind === 'number' ? '11.10' : '0.62'})`
        : t('pick_prompt');
      $('rundo').disabled = !sel;
      $('rclear').disabled = !sel && selectionUndo.length === 0;
    }

    body.querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => {
      if (spinning) return;
      if (sel) selectionUndo.push(sel);
      sel = { kind: b.dataset.k, value: b.dataset.k === 'number' ? Number(b.dataset.v) : b.dataset.v };
      paintSelection();
      sfx.tick();
    }));
    $('rundo').onclick = () => { if (spinning || !sel) return; sel = selectionUndo.pop() || null; paintSelection(); };
    $('rclear').onclick = () => { if (spinning) return; sel = null; selectionUndo.length = 0; paintSelection(); };

    const cv = $('wheel'), S = 320;
    const g = cv.getContext('2d');
    const seg = (Math.PI * 2) / 37, cx = S / 2, cy = S / 2;

    function drawWheel() {
      g.clearRect(0, 0, S, S);
      const rim = g.createRadialGradient(cx, cy, 118, cx, cy, 162);
      rim.addColorStop(0, '#7a4820'); rim.addColorStop(1, '#1e0c02');
      g.fillStyle = rim; g.beginPath(); g.arc(cx, cy, 162, 0, 7); g.fill();

      // Pockets background
      for (let i = 0; i < 37; i++) {
        const n = ORDER[i], a0 = wheelA + i * seg - Math.PI / 2;
        g.beginPath();
        g.moveTo(cx, cy);
        g.arc(cx, cy, 148, a0, a0 + seg);
        g.closePath();
        g.fillStyle = n === 0 ? '#0a8a3a' : REDS.has(n) ? '#c1121f' : '#111111';
        g.fill();

        // Pocket number with player-facing readable orientation
        const midA = a0 + seg / 2;
        const tx = cx + Math.cos(midA) * 122;
        const ty = cy + Math.sin(midA) * 122;
        g.save();
        g.translate(tx, ty);
        let rot = midA + Math.PI / 2;
        // Keep numbers readable so they are never inverted/upside-down on the bottom half
        if (Math.sin(midA) > 0) {
          rot += Math.PI;
        }
        g.rotate(rot);
        g.fillStyle = '#ffffff';
        g.font = `bold ${S < 300 ? 9.5 : 11}px Inter, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(String(n), 0, 0);
        g.restore();
      }

      // Golden fret separators between pockets
      for (let i = 0; i < 37; i++) {
        const a = wheelA + i * seg - Math.PI / 2;
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * 96, cy + Math.sin(a) * 96);
        g.lineTo(cx + Math.cos(a) * 148, cy + Math.sin(a) * 148);
        g.strokeStyle = '#c9a227';
        g.lineWidth = 1;
        g.stroke();
      }

      // Outer & inner gold rims
      g.beginPath(); g.arc(cx, cy, 148, 0, Math.PI * 2);
      g.strokeStyle = '#c9a227'; g.lineWidth = 2; g.stroke();

      g.fillStyle = '#0d1d14'; g.beginPath(); g.arc(cx, cy, 96, 0, 7); g.fill();
      g.beginPath(); g.arc(cx, cy, 96, 0, Math.PI * 2);
      g.strokeStyle = '#c9a227'; g.lineWidth = 2; g.stroke();

      // Gold spokes and hub provide the compact central roulette-wheel detail.
      g.strokeStyle = '#e6a923'; g.lineWidth = 5; g.lineCap = 'round';
      for (let spoke = 0; spoke < 4; spoke++) {
        const angle = spoke * Math.PI / 2 + Math.PI / 4;
        g.beginPath();
        g.moveTo(cx + Math.cos(angle) * 15, cy + Math.sin(angle) * 15);
        g.lineTo(cx + Math.cos(angle) * 48, cy + Math.sin(angle) * 48);
        g.stroke();
        g.beginPath(); g.arc(cx + Math.cos(angle) * 49, cy + Math.sin(angle) * 49, 5, 0, Math.PI * 2);
        g.fillStyle = '#f3b52a'; g.fill();
      }
      const hub = g.createRadialGradient(cx - 5, cy - 6, 2, cx, cy, 16);
      hub.addColorStop(0, '#ffe58a'); hub.addColorStop(1, '#c57a08');
      g.fillStyle = hub; g.beginPath(); g.arc(cx, cy, 14, 0, Math.PI * 2); g.fill();

      // Top indicator pointer
      g.fillStyle = '#c9a227';
      g.beginPath(); g.moveTo(cx - 9, 2); g.lineTo(cx + 9, 2); g.lineTo(cx, 20); g.closePath(); g.fill();

      // Ball
      const bx = cx + ballR * Math.sin(ballA), by = cy - ballR * Math.cos(ballA);
      g.shadowColor = 'rgba(0,0,0,0.7)'; g.shadowBlur = 8;
      g.fillStyle = '#fff'; g.beginPath(); g.arc(bx, by, 7, 0, 7); g.fill();
      g.shadowBlur = 0;
    }

    // Match the backing store to the displayed wheel size and device pixel
    // ratio so the canvas stays sharp as the responsive layout changes size.
    let canvasSize = 0, canvasDpr = 0;
    function syncCanvasResolution() {
      const size = Math.max(1, cv.getBoundingClientRect().width);
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      if (Math.abs(size - canvasSize) < 1 && dpr === canvasDpr) return;
      canvasSize = size;
      canvasDpr = dpr;
      cv.width = Math.round(size * dpr);
      cv.height = Math.round(size * dpr);
      g.setTransform((size * dpr) / S, 0, 0, (size * dpr) / S, 0, 0);
      drawWheel();
    }
    syncCanvasResolution();
    const wheelResizeObserver = new ResizeObserver(syncCanvasResolution);
    wheelResizeObserver.observe(cv);
    stopFns.push(() => wheelResizeObserver.disconnect());
    window.addEventListener('resize', syncCanvasResolution, { passive: true });
    stopFns.push(() => window.removeEventListener('resize', syncCanvasResolution));

    let alive = true; stopFns.push(() => (alive = false));
    (function idle() {
      if (!alive || !cv.isConnected) return;
      if (!spinning && !everSpun) { wheelA += 0.003; drawWheel(); }
      requestAnimationFrame(idle);
    })();
    ballA = 0; ballR = 150; drawWheel();

    const easeOut = (x) => 1 - Math.pow(1 - x, 4);
    function animate(n) {
      return new Promise((res) => {
        const i = ORDER.indexOf(n), TAU = Math.PI * 2, start = wheelA, dur = 5500;
        const delta = ((((-(i + 0.5) * seg - start) % TAU) + TAU) % TAU);
        const target = start + TAU * 5 + delta, t0 = performance.now(); let lastTick = 0;
        (function frame(now) {
          const p = Math.min(1, (now - t0) / dur), e = easeOut(p);
          wheelA = start + (target - start) * e;
          ballA = -TAU * 9 * easeOut(Math.min(1, p));
          const q = Math.max(0, (p - 0.45) / 0.55); ballR = 150 - 44 * q * q * (3 - 2 * q);
          if (now - lastTick > 110 + p * 280) { sfx.tick(); lastTick = now; }
          drawWheel();
          if (p < 1) requestAnimationFrame(frame);
          else { wheelA = target % TAU; ballA = 0; ballR = 104; drawWheel(); res(); }
        })(t0);
      });
    }

    function paintHistory() {
      const recent = history.slice(-7).reverse();
      $('hist').innerHTML = recent.length ? recent.map(({ n }) =>
        `<span class="roulette-result-tile ${colorOf(n)}">${n}</span>`
      ).join('') : '<span class="roulette-history-empty">No results yet</span>';
      const lastSlot = $('roulette-last-result');
      if (lastSlot) lastSlot.textContent = recent.length ? String(recent[0].n) : '—';
    }

    $('rgo').onclick = async () => {
      if (spinning) return;
      if (!sel) { say($('rmsg'), esc(t('pick_prompt')), 'lose'); return; }
      spinning = true; everSpun = true; $('rgo').disabled = true; bet.lock(true); say($('rmsg'), '');
      try {
        const r = await C.api('/games/roulette', { bet: bet.get(), kind: sel.kind, value: sel.value });
        await animate(r.n); history.push({ n: r.n, mult: r.mult }); paintHistory(); C.setBalance(r.balance); paintAccountBalance();
        if (r.payout) {
          say($('rmsg'), `Result: ${grossNetText(r.payout, bet.get())} 🎉`, 'win'); sfx.win();
          if (r.payout >= bet.get() * 5) coinRain(stage);
        } else {
          say($('rmsg'), `${r.n} · ${esc(t('lose'))}: ${grossNetText(r.payout, bet.get())}`, 'lose'); sfx.lose();
        }
      } catch (e) { C.fail(e); }
      spinning = false; $('rgo').disabled = false; bet.lock(false);
    };
    paintHistory();
  }

  // =========================================================
  // STAR SPIN (Slot Machine)
  // =========================================================
  const SYMS = ['🍒', '🍋', '🔔', '⭐', '7️⃣', '🌟'];
  const STAR_SYMBOL_ASSETS = {
    '🍒': { file: 'sym_coffee_cherries.png', alt: 'Coffee cherries', key: 'coffee-cherries' },
    '🍋': { file: 'sym_sini_cup.png', alt: 'Sini cup', key: 'sini-cup' },
    '🔔': { file: 'sym_jebena.png', alt: 'Jebena', key: 'jebena' },
    '⭐': { file: 'sym_mesob.png', alt: 'Mesob', key: 'mesob' },
    '7️⃣': { file: 'sym_birr_200.png', alt: '200 birr', key: 'birr-200' },
    '🌟': { file: 'sym_wild_cross.png', alt: 'Gold cross wild symbol', key: 'wild-cross' },
  };
  const STAR_SYMBOL_ASSETS_ALL = [
    ...Object.values(STAR_SYMBOL_ASSETS),
    { file: 'sym_birr_100.png', alt: '100 birr', key: 'birr-100' },
  ];
  const rs = () => SYMS[Math.floor(Math.random() * SYMS.length)];
  const SYM_H = 84;

  function star(body, stage) {
    const { t, esc } = C;
    // Preload the custom artwork as soon as Star Spin opens, before the first spin.
    const preloadedSymbols = STAR_SYMBOL_ASSETS_ALL.map((asset) => {
      const image = new Image();
      image.src = `/img/slots/${asset.file}`;
      return image;
    });
    const symbolImageMarkup = (symbol, compact = false) => {
      const asset = STAR_SYMBOL_ASSETS[symbol];
      if (!asset) return '<span class="slot-symbol-fallback" aria-hidden="true"></span>';
      return `<img class="slot-symbol-image${compact ? ' compact' : ''} ${asset.key}" src="/img/slots/${asset.file}" alt="${esc(asset.alt)}" width="${compact ? 18 : 44}" height="${compact ? 18 : 44}" decoding="async">`;
    };
    const symbolGroupMarkup = (symbol, count = 3) =>
      Array.from({ length: count }, () => symbolImageMarkup(symbol, true)).join('');
    const cur = [0, 1, 2].map(() => [rs(), rs(), rs()]);
    body.innerHTML = `
      <div class="slot">
        <div class="slot-title">HABESHA STARS</div>
        <div class="star-multiplier-arc" aria-label="Last spin multiplier">
          <svg viewBox="0 0 180 44" aria-hidden="true"><path d="M8 40 A82 82 0 0 1 172 40" /></svg>
          <span class="star-multiplier-value" id="smult">—×</span>
        </div>
        <div class="star-reel-frame">
          <div class="slot-tibeb" aria-hidden="true"></div>
          <div class="reels3">
            ${[0,1,2].map((i) => `<div class="reelwin" id="rw${i}"><div class="strip" id="st${i}"></div></div>`).join('')}
            <div class="payline"></div>
          </div>
        </div>
        <div class="paytable" aria-label="Star Spin paytable">
          <span class="star-pay-item">${symbolGroupMarkup('🍒')} <b>×1.07</b></span>
          <span class="star-pay-item">${symbolGroupMarkup('🍋')} <b>×1.72</b></span>
          <span class="star-pay-item">${symbolGroupMarkup('🔔')} <b>×2.58</b></span>
          <span class="star-pay-item">${symbolGroupMarkup('⭐')} <b>×5.38</b></span>
          <span class="star-pay-item">${symbolGroupMarkup('7️⃣')} / ${symbolGroupMarkup('🌟')} <b>×10.76</b></span>
          <span class="star-pay-item">${symbolGroupMarkup('🍒', 2)} / ${symbolGroupMarkup('🌟', 2)} 2+ <b>×0.33 (partial return)</b></span>
        </div>
      </div>
      <div class="star-spin-row">
        <!-- TODO: Auto and Turbo are visual-only until supported by the existing game. -->
        <button type="button" class="star-side-control" disabled aria-label="Auto play unavailable"><span>↻</span><small>Auto</small></button>
        <button class="bigbtn star-spin-button" id="sgo" aria-label="Spin">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.7 9A7 7 0 0 1 18 6l2 2M4 16l2 2a7 7 0 0 0 12.3-3"/></svg>
          <span>SPIN</span>
        </button>
        <button type="button" class="star-side-control" disabled aria-label="Turbo unavailable"><span>ϟ</span><small>Turbo</small></button>
      </div>
      <div class="star-info-row" aria-live="polite">
        <div class="star-info-card"><span>LAST WIN</span><strong><b id="slastwin">${C.fmt(0)}</b> ETB</strong></div>
        <div class="star-info-card"><span>BET</span><strong><b id="sstake">${C.fmt(1000)}</b> ETB</strong></div>
      </div>
      <div id="sbet"></div>
      <div class="msg" id="smsg"></div>`;

    // Keep the established bet handlers and lock behavior; only expose ETB labels.
    const bet = betBar($('sbet'), 10, { currencyLabel: 'ETB' });
    const betInput = $('sbet').querySelector('input');
    const updateStake = () => {
      const amount = bet.get();
      $('sstake').textContent = Number.isSafeInteger(amount) && amount > 0 ? C.fmt(amount) : '—';
    };
    betInput.addEventListener('input', updateStake);
    $('sbet').addEventListener('click', (event) => {
      if (event.target.closest('.chipb, #b-half, #b-double')) updateStake();
    });
    updateStake();
    const paint = (i) => ($('st' + i).innerHTML = cur[i].map((s) => `<div class="sym">${symbolImageMarkup(s)}</div>`).join(''));
    [0, 1, 2].forEach(paint);

    function spinReel(i, finalSym, dur) {
      const strip = $('st' + i);
      const symEl = strip.querySelector('.sym');
      const actualH = symEl ? symEl.offsetHeight : SYM_H;

      const items = [...cur[i]];
      const n = 18 + i * 6;
      for (let k = 0; k < n; k++) items.push(rs());
      const top = rs(), bot = rs();
      items.push(top, finalSym, bot);

      strip.innerHTML = items.map((s) => `<div class="sym">${symbolImageMarkup(s)}</div>`).join('');
      strip.style.transition = 'none';
      strip.style.transform = 'translateY(0)';
      void strip.offsetHeight;

      const symH = strip.querySelector('.sym') ? strip.querySelector('.sym').offsetHeight : actualH;
      strip.style.transition = `transform ${dur}ms cubic-bezier(.1,.8,.15,1)`;
      strip.style.transform = `translateY(${-(items.length - 3) * symH}px)`;
      cur[i] = [top, finalSym, bot];

      return sleep(dur + 80).then(() => {
        sfx.hop();
        // Reset cleanly to the 3 final symbols at translateY(0)
        // so no leftover offset or media-query scale can ever cause symbols to disappear!
        strip.style.transition = 'none';
        strip.innerHTML = cur[i].map((s) => `<div class="sym">${symbolImageMarkup(s)}</div>`).join('');
        strip.style.transform = 'translateY(0)';
      });
    }

    let busy = false;
    $('sgo').onclick = async () => {
      if (busy) return; busy = true; $('sgo').disabled = true; bet.lock(true); say($('smsg'), '');
      body.querySelector('.slot')?.classList.remove('is-win');
      body.querySelector('.slot')?.classList.add('is-spinning');
      [0, 1, 2].forEach((i) => $('rw' + i).classList.remove('win'));
      try {
        const r = await C.api('/games/star', { bet: bet.get() });
        $('smult').textContent = Number.isFinite(Number(r.mult)) ? `×${r.mult}` : '—×';
        const spinTick = setInterval(sfx.tick, 85);
        await Promise.all(r.reels.map((s, i) => spinReel(i, s, 1400 + i * 700)));
        clearInterval(spinTick); C.setBalance(r.balance);
        $('slastwin').textContent = C.fmt(r.payout || 0);
        if (r.payout) {
          await sleep(100);
          if (r.net > 0) {
            body.querySelector('.slot')?.classList.add('is-win');
            [0, 1, 2].forEach((i) => $('rw' + i).classList.add('win'));
          }
          say($('smsg'), `${r.net === 0 ? 'Stake returned' : 'Result'} · ${grossNetText(r.payout, bet.get())} (×${r.mult}) 🎉`, r.net > 0 ? 'win' : '');
          if (r.net > 0) sfx.win();
          if (r.net > 0 && r.mult >= 5) { coinRain(stage); say($('smsg'), `${esc(t('big_win'))}: ${grossNetText(r.payout, bet.get())} (×${r.mult})`, 'win'); }
        } else { say($('smsg'), `${esc(t('lose'))} · ${grossNetText(r.payout, bet.get())}`, 'lose'); sfx.lose(); }
      } catch (e) { C.fail(e); }
      body.querySelector('.slot')?.classList.remove('is-spinning');
      busy = false; $('sgo').disabled = false; bet.lock(false);
    };
  }

  // =========================================================
  // KENO (1-80 number board, pick 1-10, draw 20)
  // =========================================================
  // Payout table frontend mirror (for live display before draw)
  const KENO_PAY_DISPLAY = {
    1:  { 1: '1.20×' },
    2:  { 2: '4.99×' },
    3:  { 2: '0.72×', 3: '14.41×' },
    4:  { 2: '0.53×', 3: '1.79×', 4: '35.74×' },
    5:  { 3: '1.18×', 4: '7.85×', 5: '164.83×' },
    6:  { 3: '0.64×', 4: '2.55×', 5: '25.49×', 6: '509.87×' },
    7:  { 3: '0.39×', 4: '1.31×', 5: '6.56×', 6: '84.02×', 7: '1837.98×' },
    8:  { 4: '0.99×', 5: '3.40×', 6: '28.37×', 7: '482.38×', 8: '2837.52×' },
    9:  { 4: '0.60×', 5: '1.68×', 6: '12.03×', 7: '120.33×', 8: '962.61×', 9: '7219.55×' },
    10: { 5: '1.16×', 6: '5.81×', 7: '58.15×', 8: '465.23×', 9: '2326.17×', 10: '23261.75×' },
  };

  function keno(body, stage) {
    const { t, esc } = C;
    let picks = new Set();
    let busy = false;

    body.innerHTML = `
      <div class="keno-game">
        <section class="keno-main" aria-label="Keno number board">
          <div class="keno-meta">
            <span class="keno-info" id="kpick-info">
              ${esc(t('keno_pick'))} (0/10)
            </span>
            <button class="chip" id="kclear" style="font-size:12px">${esc(t('keno_clear'))}</button>
          </div>
          <div class="keno-board" id="kboard"></div>
          <div class="keno-drawn-row" id="kdrawn" aria-live="polite"></div>
        </section>
        <aside class="keno-controls" aria-label="Keno wager controls">
          <div class="keno-controls-title">ፍጣን ቤት <span>KENO 80</span></div>
          <div id="kbet"></div>
          <div class="keno-paytable" id="kpay"></div>
          <button class="bigbtn" id="kdraw" disabled>🎱 ${esc(t('keno_draw'))}</button>
          <div class="msg" id="kmsg" aria-live="polite"></div>
        </aside>
      </div>`;

    const bet = betBar($('kbet'));

    // Build 80-number board
    const board = $('kboard');
    for (let n = 1; n <= 80; n++) {
      const btn = document.createElement('button');
      btn.className = 'keno-num';
      btn.textContent = n;
      btn.dataset.n = n;
      btn.onclick = () => togglePick(n, btn);
      board.appendChild(btn);
    }

    function togglePick(n, btn) {
      if (busy) return;
      if (picks.has(n)) {
        picks.delete(n);
        btn.classList.remove('selected');
      } else {
        if (picks.size >= 10) { say($('kmsg'), esc(t('keno_max')), 'lose'); return; }
        picks.add(n);
        btn.classList.add('selected');
        sfx.tick();
      }
      say($('kmsg'), '');
      $('kdraw').disabled = picks.size === 0;
      $('kpick-info').textContent = `${esc(t('keno_picked'))}: ${picks.size}/10`;
      renderPaytable();
    }

    function renderPaytable() {
      const el = $('kpay');
      if (picks.size === 0) {
        el.innerHTML = `<div class="keno-pay-empty">${esc(t('keno_pick'))}</div>`;
        return;
      }
      const row = KENO_PAY_DISPLAY[picks.size] || {};
      el.innerHTML = `
        <div class="keno-pay-title">Paytable for ${picks.size} spot${picks.size > 1 ? 's' : ''}:</div>
        <div class="keno-pay-row">
          ${Object.entries(row).map(([match, mult]) => `
            <span class="keno-pay-chip"><b>${match}</b> hit = <b>${mult}</b></span>
          `).join('')}
        </div>`;
    }

    renderPaytable();

    $('kclear').onclick = () => {
      if (busy) return;
      picks.clear();
      board.querySelectorAll('.keno-num').forEach((b) => b.classList.remove('selected', 'drawn', 'hit'));
      $('kpick-info').textContent = `${esc(t('keno_picked'))}: 0/10`;
      $('kdraw').disabled = true;
      renderPaytable();
      $('kdrawn').innerHTML = '';
      say($('kmsg'), '');
    };

    $('kdraw').onclick = async () => {
      if (busy || picks.size === 0) return;
      busy = true;
      $('kdraw').disabled = true;
      bet.lock(true);
      board.querySelectorAll('.keno-num').forEach((b) => b.classList.remove('drawn', 'hit'));
      $('kdrawn').innerHTML = '';
      say($('kmsg'), '');

      try {
        const r = await C.api('/games/keno', { bet: bet.get(), picks: [...picks] });
        C.setBalance(r.balance);

        // Animate drawing numbers one by one
        const drawn = [...r.drawn].sort((a, b) => a - b);
        const drawnRow = $('kdrawn');
        drawnRow.innerHTML = `<span class="keno-drawn-label">${esc(t('keno_drawn'))}:</span>`;

        for (let i = 0; i < r.drawn.length; i++) {
          await sleep(60);
          const n = r.drawn[i];
          const pill = document.createElement('span');
          const isHit = picks.has(n);
          pill.className = 'keno-ball' + (isHit ? ' hit' : '');
          pill.textContent = n;
          drawnRow.appendChild(pill);
          sfx.plink();

          const btn = board.querySelector(`[data-n="${n}"]`);
          if (btn) {
            btn.classList.add('drawn');
            if (isHit) { btn.classList.add('hit'); }
          }
        }

        await sleep(300);
        if (r.payout > 0) {
          say($('kmsg'),
            `${esc(t('keno_matched'))} ${r.matched} ${esc(t('keno_of'))} ${picks.size}! ${grossNetText(r.payout, bet.get())} (×${r.mult})`,
            r.net > 0 ? 'win' : '');
          if (r.net > 0) sfx.win();
          if (r.net > 0 && r.matched >= 4) coinRain(stage);
        } else {
          say($('kmsg'),
            `${esc(t('keno_matched'))} ${r.matched} ${esc(t('keno_of'))} ${picks.size}. ${esc(t('lose'))} · ${grossNetText(r.payout, bet.get())}`,
            'lose');
          sfx.lose();
        }
      } catch (e) { C.fail(e); }

      busy = false;
      $('kdraw').disabled = picks.size === 0;
      bet.lock(false);
    };
  }

  // =========================================================
  // ETHIOPIAN BINGO (ቢንጎ ሜዳ — Traditional Ethiopian Style)
  // =========================================================
  // Columns labelled: ቢ / ን / ጎ / ሜ / ዳ  (Ethiopian B-I-N-G-O variant)
  const BINGO_COLS = ['ቢ', 'ን', 'ጎ', 'ሜ', 'ዳ'];
  // Ethiopian number words for 1-15 style display
  const ETH_NUMS = ['', 'አንድ','ሁለት','ሶስት','አራት','አምስት','ስድስት','ሰባት','ስምንት','ዘጠኝ','አስር',
    '11','12','13','14','አስራ አምስት','16','17','18','19','ሃያ',
    '21','22','23','24','25','26','27','28','29','ሰላሳ',
    '31','32','33','34','35','36','37','38','39','አርባ',
    '41','42','43','44','45','46','47','48','49','ሃምሳ',
    '51','52','53','54','55','56','57','58','59','ስድሳ',
    '61','62','63','64','65','66','67','68','69','ሰባ',
    '71','72','73','74','75'];

  function bingo(body, stage) {
    const { t, esc } = C;
    let card = null;        // card[col][row]
    let drawn = [];
    let marked = new Array(25).fill(false); // marked[row*5+col]
    let gameActive = false;
    let busy = false;
    let currentBet = 1000;
    let autoCallInterval = null;

    body.innerHTML = `
      <div id="bbet"></div>
      <div class="bingo-layout">
        <div class="bingo-left">
          <div class="bingo-card-wrap">
            <div class="bingo-card" id="bcard" aria-label="Ethiopian Bingo card">
              <div class="bingo-header">
                ${BINGO_COLS.map((c) => `<div class="bingo-col-head">${c}</div>`).join('')}
              </div>
              <div class="bingo-grid" id="bgrid"></div>
            </div>
          </div>
          <div class="bingo-called-bar" id="bcalled-bar">
            <div class="bingo-called-label">${esc(t('bingo_called'))}:</div>
            <div class="bingo-balls" id="bballs"></div>
          </div>
        </div>
        <div class="bingo-right">
          <div class="bingo-multiplier-table">
            <div class="bingo-pay-title">🏆 Payout Guide</div>
            <div id="bpay-rows"></div>
          </div>
          <div class="bingo-draw-count" id="bdrawcount">Draws: 0</div>
          <div class="bingo-last-ball" id="blastball">—</div>
        </div>
      </div>
      <div class="bingo-controls">
        <button class="bigbtn" id="bcall" disabled>📢 ${esc(t('bingo_call'))}</button>
        <button class="chip" id="bauto" style="margin-left:8px">⏩ Auto</button>
      </div>
      <p class="bingo-retired-round-note" id="bretired-note" hidden>Bingo has been retired. You can continue this active round until it settles.</p>
      <div class="msg" id="bmsg"></div>`;

    const bet = betBar($('bbet'));

    function renderBingoPaytable(version = GAME_PAYOUT_RULE_VERSION) {
      const rows = version >= GAME_PAYOUT_RULE_VERSION
        ? [['≤20 draws', '1.26'], ['21–30 draws', '0.65'], ['31–40 draws', '0.32'], ['41–50 draws', '0.20'], ['51–75 draws', '0.12']]
        : version === 2
          ? [['≤20 draws', '3.71'], ['21–30 draws', '1.98'], ['31–40 draws', '0.99'], ['41–50 draws', '0.62'], ['51–75 draws', '0.37']]
          : [['≤20 draws', '15.00'], ['21–30 draws', '8.00'], ['31–40 draws', '4.00'], ['41–50 draws', '2.50'], ['51–75 draws', '1.50']];
      $('bpay-rows').innerHTML = rows.map(([range, mult]) => `<div class="bingo-pay-row"><span>${range}</span><span class="bingo-pay-mult">×${mult}</span></div>`).join('');
    }
    renderBingoPaytable();

    function buildGrid() {
      const grid = $('bgrid');
      grid.innerHTML = '';
      for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 5; col++) {
          const cell = document.createElement('div');
          const isFree = row === 2 && col === 2;
          const num = isFree ? 0 : card[col][row];
          cell.className = 'bingo-cell' + (isFree ? ' free' : '');
          cell.dataset.row = row;
          cell.dataset.col = col;

          if (isFree) {
            cell.innerHTML = '<span class="bingo-free">ፍጣን</span>';
            cell.classList.add('marked');
          } else {
            // Display: Ethiopic column letter + number
            cell.innerHTML = `<span class="bingo-col-tag">${BINGO_COLS[col]}</span><span class="bingo-num-big">${num}</span>`;
            if (marked[row * 5 + col]) cell.classList.add('marked');
          }
          grid.appendChild(cell);
        }
      }
    }

    function addBall(n, isNew = false) {
      const el = $('bballs');
      const b = document.createElement('span');
      b.className = 'bingo-ball-called' + (isNew ? ' new-ball' : '');
      b.textContent = n;
      // Color by column
      const col = n <= 15 ? 0 : n <= 30 ? 1 : n <= 45 ? 2 : n <= 60 ? 3 : 4;
      b.style.background = ['#c1121f','#1e40af','#047857','#92400e','#6b21a8'][col];
      el.appendChild(b);
      el.scrollLeft = el.scrollWidth;

      // Update last ball display
      const lastBall = $('blastball');
      if (lastBall) {
        lastBall.textContent = `${BINGO_COLS[col]}-${n}`;
        lastBall.style.background = ['#c1121f','#1e40af','#047857','#92400e','#6b21a8'][col];
        if (isNew) {
          lastBall.classList.remove('ball-pop');
          void lastBall.offsetWidth;
          lastBall.classList.add('ball-pop');
        }
      }
    }

    function markCell(row, col) {
      const cell = $('bgrid').querySelector(`[data-row="${row}"][data-col="${col}"]`);
      if (cell) {
        cell.classList.add('marked', 'just-marked');
        setTimeout(() => cell.classList.remove('just-marked'), 600);
      }
    }

    async function initBingoState() {
      try {
        const st = await C.api('/games/bingo');
        if (!st?.active) { C.reload(); return; }
        renderBingoPaytable(st.payout_version || 1);
        currentBet = st.bet;
        card = st.card;
        drawn = st.drawn || [];
        marked = st.marked || new Array(25).fill(false);
        gameActive = true;
        buildGrid();
        drawn.forEach((n) => addBall(n));
        $('bcall').disabled = false;
        $('bretired-note').hidden = false;
        $('bdrawcount').textContent = `Draws: ${drawn.length}`;
        say($('bmsg'), esc(t('bingo_waiting')), '');
        bet.lock(true);
      } catch (e) { C.reload(); }
    }

    async function callOne() {
      if (!gameActive || busy) return;
      busy = true;
      try {
        const r = await C.api('/games/bingo/call', {});
        C.setBalance(r.balance);
        drawn = r.drawn;
        marked = r.marked;

        addBall(r.called, true);
        sfx.plink();

        // Mark matching cells
        for (let col = 0; col < 5; col++) {
          for (let row = 0; row < 5; row++) {
            if (card[col][row] === r.called) markCell(row, col);
          }
        }

        $('bdrawcount').textContent = `Draws: ${drawn.length}`;

        if (r.won) {
          stopAutoCall();
          say($('bmsg'), `Bingo result: ${grossNetText(r.payout, currentBet)} (×${r.mult}) 🎊`, r.net > 0 ? 'win' : '');
          if (r.net > 0) { sfx.win(); coinRain(stage); }
          gameActive = false;
          renderBingoPaytable(GAME_PAYOUT_RULE_VERSION);
          $('bcall').disabled = true;
          $('bretired-note').textContent = 'Bingo has been retired. This active round is complete.';
          bet.lock(false);
          $('bdrawcount').textContent = `✅ Bingo in ${drawn.length} draws!`;
        }
      } catch (e) { C.fail(e); stopAutoCall(); }
      busy = false;
    }

    $('bcall').onclick = callOne;

    let autoOn = false;
    function stopAutoCall() {
      if (autoCallInterval) { clearInterval(autoCallInterval); autoCallInterval = null; }
      autoOn = false;
      const ab = $('bauto');
      if (ab) { ab.textContent = '⏩ Auto'; ab.classList.remove('on'); }
    }

    $('bauto').onclick = () => {
      if (!gameActive) return;
      autoOn = !autoOn;
      const ab = $('bauto');
      if (autoOn) {
        ab.textContent = '⏸ Pause'; ab.classList.add('on');
        autoCallInterval = setInterval(async () => {
          if (!gameActive || busy) return;
          await callOne();
          if (!gameActive) stopAutoCall();
        }, 1400);
      } else {
        stopAutoCall();
      }
    };

    stopFns.push(() => stopAutoCall());
    initBingoState();
  }

  function cleanupCurrent() {
    stopFns.forEach((stop) => stop());
    stopFns = [];
    shell?.cleanup();
    shell = null;
  }

  return { mount, openRoute: (app, game) => open(app, game, false), cleanupCurrent, setMuted, isMuted };
})();
