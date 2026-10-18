// Animated game screens — results always come from the server.
// Visual and audio animations with Stake-inspired polish.
'use strict';
window.Games = (function () {
  let C; // context: { api, t, esc, fmt, setBalance, fail, limits, roadState, minesState, reload }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (id) => document.getElementById(id);

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
    b.onclick = () => { muted = !muted; localStorage.setItem('mute', muted ? '1' : '0'); paint(); };
    paint(); host.appendChild(b);
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
  function betBar(host, start = 10) {
    const vals = [1, 5, 10, 50, 100];
    host.innerHTML = `
      <div class="betbar">
        <div class="chips">
          ${vals.map((v) => `<button type="button" class="chipb c${v}" data-v="${v}">${v}</button>`).join('')}
        </div>
        <div class="betrow">
          <button type="button" class="chip" id="b-half" style="padding:4px 8px;font-size:12px;font-weight:700">½</button>
          <span class="muted">${C.esc(C.t('bet'))}</span>
          <input type="number" min="1" max="${C.limits.max / 100}" step="1" value="${start}">
          <span class="muted">${C.esc(C.t('credits'))}</span>
          <button type="button" class="chip" id="b-double" style="padding:4px 8px;font-size:12px;font-weight:700">2×</button>
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
    app.innerHTML = `
      <!-- FETAN BET HERO BANNER -->
      <div class="lobby-hero">
        <div class="lobby-hero-content">
          <div class="lobby-hero-badge">⚡ FETAN BET CASINO ARENA</div>
          <h1 class="lobby-hero-title">${esc(t('hero_headline'))}</h1>
          <p class="lobby-hero-sub">${esc(t('hero_sub'))}</p>
          <div class="lobby-hero-pills">
            <span class="hero-pill">🛡️ ${lang === 'am' ? 'ፍትሃዊ የጨዋታ ውጤቶች' : 'Provably Fair RNG'}</span>
            <span class="hero-pill">⚡ ${lang === 'am' ? 'ፈጣን የክሬዲት ዝውውር' : 'Instant Agent Cash'}</span>
            <span class="hero-pill">🪙 ${lang === 'am' ? '1,000 ነፃ የሙከራ ክሬዲት' : '1,000 Free Credits'}</span>
          </div>
        </div>
      </div>

      <!-- GAME DISCOVERY & CATEGORY TABS -->
      <div class="lobby-nav-bar">
        <div class="lobby-filter-pills" id="gfilters">
          <button type="button" class="gfilter on" data-cat="all">${esc(t('cat_all'))} <span class="gcount">7</span></button>
          <button type="button" class="gfilter" data-cat="originals">${esc(t('cat_originals'))} <span class="gcount">3</span></button>
          <button type="button" class="gfilter" data-cat="table">${esc(t('cat_classic'))} <span class="gcount">2</span></button>
          <button type="button" class="gfilter" data-cat="lottery">🎱 ${lang === 'am' ? 'ኬኖ እና ቢንጎ' : 'Keno & Bingo'} <span class="gcount">2</span></button>
        </div>
        <div class="lobby-sound-slot" id="sbtn"></div>
      </div>

      <!-- GAMES GRID -->
      <div class="lobby" id="ggrid">
        <!-- 1. Road Dash -->
        <div class="gcard g1" data-g="road" data-cat="originals">
          <span class="gcard-badge hot">HOT</span>
          <div class="gcard-icon-wrap"><span class="big">🐔</span></div>
          <h3>${esc(t('road_title'))}</h3>
          <p>${esc(t('road_desc'))}</p>
          <div class="gcard-meta"><span>Up to ×1000</span></div>
          <button class="btn btn-gold">${esc(t('play_now'))}</button>
        </div>

        <!-- 2. Mines -->
        <div class="gcard g4" data-g="mines" data-cat="originals">
          <span class="gcard-badge original">ORIGINAL</span>
          <div class="gcard-icon-wrap"><span class="big">💎</span></div>
          <h3>${esc(t('mines_title'))}</h3>
          <p>${esc(t('mines_desc'))}</p>
          <div class="gcard-meta"><span>1–24 Mines · Pick & Win</span></div>
          <button class="btn btn-gold">${esc(t('play_now'))}</button>
        </div>

        <!-- 3. Plinko -->
        <div class="gcard g5" data-g="plinko" data-cat="originals">
          <span class="gcard-badge original">ORIGINAL</span>
          <div class="gcard-icon-wrap"><span class="big">⚡</span></div>
          <h3>${esc(t('plinko_title'))}</h3>
          <p>${esc(t('plinko_desc'))}</p>
          <div class="gcard-meta"><span>8–16 Rows · 3 Risk Levels</span></div>
          <button class="btn btn-gold">${esc(t('play_now'))}</button>
        </div>

        <!-- 4. Keno -->
        <div class="gcard g-keno" data-g="keno" data-cat="lottery">
          <span class="gcard-badge popular">POPULAR</span>
          <div class="gcard-icon-wrap"><span class="big">🎱</span></div>
          <h3>${esc(t('keno_title'))}</h3>
          <p>${esc(t('keno_desc'))}</p>
          <div class="gcard-meta"><span>Pick 1–10 of 80 · 20 Drawn</span></div>
          <button class="btn btn-gold">${esc(t('play_now'))}</button>
        </div>

        <!-- 5. Ethiopian Bingo -->
        <div class="gcard g-bingo" data-g="bingo" data-cat="lottery">
          <span class="gcard-badge ethiopia">🇪🇹 ቢንጎ</span>
          <div class="gcard-icon-wrap"><span class="big">🇪🇹</span></div>
          <h3>${esc(t('bingo_title'))}</h3>
          <p>${esc(t('bingo_desc'))}</p>
          <div class="gcard-meta"><span>Traditional 5×5 · Auto Call</span></div>
          <button class="btn btn-gold">${esc(t('play_now'))}</button>
        </div>

        <!-- 6. Roulette -->
        <div class="gcard g2" data-g="roulette" data-cat="table">
          <span class="gcard-badge classic">CLASSIC</span>
          <div class="gcard-icon-wrap"><span class="big">🎡</span></div>
          <h3>${esc(t('roulette_title'))}</h3>
          <p>${esc(t('roulette_desc'))}</p>
          <div class="gcard-meta"><span>European 37-Pocket Wheel</span></div>
          <button class="btn btn-gold">${esc(t('play_now'))}</button>
        </div>

        <!-- 7. Star Spin -->
        <div class="gcard g3" data-g="star" data-cat="table">
          <span class="gcard-badge classic">SLOT</span>
          <div class="gcard-icon-wrap"><span class="big">🎰</span></div>
          <h3>${esc(t('star_title'))}</h3>
          <p>${esc(t('star_desc'))}</p>
          <div class="gcard-meta"><span>3-Reel Slots · Wild Star</span></div>
          <button class="btn btn-gold">${esc(t('play_now'))}</button>
        </div>
      </div>`;

    soundBtn($('sbtn'));
    
    // Category filter logic
    const filterBtns = app.querySelectorAll('.gfilter');
    const cards = app.querySelectorAll('.gcard');
    filterBtns.forEach((b) => {
      b.onclick = () => {
        filterBtns.forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        const cat = b.dataset.cat;
        cards.forEach((c) => {
          if (cat === 'all' || c.dataset.cat === cat) {
            c.style.display = '';
          } else {
            c.style.display = 'none';
          }
        });
      };
    });

    cards.forEach((c) => (c.onclick = () => open(app, c.dataset.g)));
  }

  let stopFns = [];
  function open(app, game) {
    const titles = {
      road:     '🐔 ' + C.t('road_title'),
      mines:    '💎 ' + C.t('mines_title'),
      plinko:   '⚡ ' + C.t('plinko_title'),
      roulette: '🎡 ' + C.t('roulette_title'),
      star:     '🎰 ' + C.t('star_title'),
      keno:     '🎱 ' + C.t('keno_title'),
      bingo:    '🇪🇹 ' + C.t('bingo_title'),
    };
    app.innerHTML = `
      <div class="stage">
        <div class="stage-head">
          <button class="chip" id="gback">← ${C.esc(C.t('back'))}</button>
          <span id="sbtn"></span>
        </div>
        <h2 style="text-align:center;margin:0 0 8px;color:#fff">${C.esc(titles[game])}</h2>
        <div id="gbody"></div>
      </div>`;
    soundBtn($('sbtn'));
    $('gback').onclick = () => { stopFns.forEach((f) => f()); stopFns = []; C.reload(); };
    ({ road, roulette, star, mines, plinko, keno, bingo })[game]($('gbody'), app.querySelector('.stage'));
  }

  // =========================================================
  // MINES (Diamond Hunt — Stake Reference / TechnoVisionDev)
  // =========================================================
  function mines(body, stage) {
    const { t, esc } = C;
    const GRID = 25;
    let gameActive = false, busy = false, revealed = new Array(GRID).fill(false);
    let currentMult = 1, currentPotential = 0, currentBet = 1000;

    body.innerHTML = `
      <div id="mbet"></div>
      <div style="display:flex;gap:12px;align-items:center;justify-content:center;margin:10px 0">
        <label style="color:#aaa;font-size:13px;font-weight:600">${esc(t('mines_count'))}:</label>
        <select id="mine-count" style="width:84px;background:#1a1a2a;color:#fff;border:1px solid #444;border-radius:8px;padding:6px 8px;font-size:14px;font-weight:700">
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
          <option value="4">4</option>
          <option value="5" selected>5</option>
          <option value="8">8</option>
          <option value="10">10</option>
          <option value="12">12</option>
          <option value="15">15</option>
          <option value="20">20</option>
          <option value="24">24</option>
        </select>
      </div>
      <div class="mines-info">
        <span>${esc(t('mines_safe'))}: <span class="val" id="msafe">20</span></span>
        <span>${esc(t('mines_mult'))}: <span class="val" id="mmult">×1.00</span></span>
      </div>
      <div class="mines-wrap">
        <div class="mines-grid" id="mgrid"></div>
        <div id="mmodal-slot"></div>
      </div>
      <div style="display:flex;gap:10px;justify-content:center;margin-top:14px">
        <button class="bigbtn green" id="mstart" style="flex:1;max-width:180px">${esc(t('start'))}</button>
        <button class="bigbtn" id="mcash" disabled style="flex:1;max-width:200px">${esc(t('cashout'))}</button>
      </div>
      <div class="msg" id="mmsg"></div>`;

    const bet = betBar($('mbet'));

    function showCashoutModal(mult, payout) {
      const slot = $('mmodal-slot');
      if (!slot) return;
      slot.innerHTML = `
        <div class="mines-modal">
          <h1 class="mines-modal-mult">×${Number(mult).toFixed(2)}</h1>
          <div class="mines-modal-divider"></div>
          <p class="mines-modal-win">+${C.fmt(payout)}</p>
        </div>`;
      setTimeout(() => { if (slot) slot.innerHTML = ''; }, 3200);
    }

    function buildGrid(locked = false) {
      const grid = $('mgrid');
      if (!grid) return;
      grid.innerHTML = '';
      for (let i = 0; i < GRID; i++) {
        const btn = document.createElement('button');
        btn.className = 'mine-cell' + (revealed[i] ? ' revealed-safe' : '');
        btn.textContent = revealed[i] ? '💎' : '';
        btn.disabled = locked || !gameActive || revealed[i];
        btn.onclick = () => clickCell(i);
        grid.appendChild(btn);
      }
    }

    function updateInfo(safeLeft, mult) {
      const s = $('msafe'), m = $('mmult');
      if (s) s.textContent = safeLeft !== null ? safeLeft : '—';
      if (m) m.textContent = mult !== null ? '×' + Number(mult).toFixed(2) : '—';
    }

    // Restore active game if exists
    async function initMinesState() {
      try {
        const st = C.minesState && C.minesState.active !== undefined
          ? C.minesState
          : await C.api('/games/mines');
        if (st && st.active) {
          gameActive = true;
          currentBet = st.bet;
          currentMult = st.mult || 1;
          currentPotential = st.potential || st.bet;
          revealed.fill(false);
          (st.revealed || []).forEach((idx) => { revealed[idx] = true; });
          $('mine-count').value = String(st.mines || 5);
          $('mine-count').disabled = true;
          updateInfo(st.safe_left, st.mult);
          buildGrid(false);
          bet.lock(true);
          $('mstart').disabled = true;
          if ((st.revealed || []).length > 0) {
            $('mcash').textContent = `${esc(t('cashout'))} +${C.fmt(st.potential)}`;
            $('mcash').disabled = false;
          }
          say($('mmsg'), `💎 ×${Number(st.mult).toFixed(2)}`, 'win');
        } else {
          buildGrid(true);
        }
      } catch (e) {
        buildGrid(true);
      }
    }

    async function clickCell(idx) {
      if (!gameActive || revealed[idx] || busy) return;
      busy = true;
      const cells = $('mgrid').querySelectorAll('.mine-cell');
      cells[idx].textContent = '⌛';
      cells[idx].disabled = true;
      try {
        const r = await C.api('/games/mines/step', { cell: idx });
        C.setBalance(r.balance);
        if (r.mine) {
          cells[idx].textContent = '💣';
          cells[idx].className = 'mine-cell revealed-mine';
          sfx.boom();
          say($('mmsg'), `💥 ${esc(t('crashed'))}`, 'lose');
          if (r.mines) r.mines.forEach((mi) => {
            if (mi !== idx) {
              cells[mi].textContent = '💣';
              cells[mi].className = 'mine-cell revealed-mine revealed-dim';
            }
          });
          for (let i = 0; i < GRID; i++) {
            if (!revealed[i] && !(r.mines || []).includes(i)) {
              cells[i].textContent = '💎';
              cells[i].className = 'mine-cell revealed-safe revealed-dim';
            }
          }
          sfx.lose();
          gameActive = false;
          bet.lock(false);
          $('mstart').disabled = false;
          $('mcash').disabled = true;
          $('mine-count').disabled = false;
        } else {
          cells[idx].textContent = '💎';
          cells[idx].className = 'mine-cell revealed-safe';
          revealed[idx] = true;
          sfx.reveal();
          currentMult = r.mult;
          currentPotential = r.potential;
          updateInfo(r.safe_left, r.mult);
          $('mcash').textContent = `${esc(t('cashout'))} +${C.fmt(r.potential)}`;
          $('mcash').disabled = false;
          if (r.safe_left === 0) {
            say($('mmsg'), `🏆 ${esc(t('big_win'))} +${C.fmt(r.payout || r.potential)}`, 'win');
            sfx.win(); coinRain(stage);
            showCashoutModal(r.mult, r.payout || r.potential);
            gameActive = false;
            bet.lock(false);
            $('mstart').disabled = false;
            $('mcash').disabled = true;
            $('mine-count').disabled = false;
          } else {
            say($('mmsg'), `💎 ×${r.mult ? r.mult.toFixed(2) : '?'}`, 'win');
            buildGrid(false);
          }
        }
      } catch (e) {
        C.fail(e);
        cells[idx].disabled = false;
        cells[idx].textContent = '';
      }
      busy = false;
    }

    $('mstart').onclick = async () => {
      if (busy) return; busy = true;
      const mineCount = Number($('mine-count').value);
      $('mstart').disabled = true;
      const modalSlot = $('mmodal-slot');
      if (modalSlot) modalSlot.innerHTML = '';
      try {
        const r = await C.api('/games/mines/start', { bet: bet.get(), mines: mineCount });
        C.setBalance(r.balance);
        gameActive = true;
        revealed.fill(false);
        updateInfo(GRID - mineCount, 1);
        $('mcash').textContent = esc(t('cashout'));
        $('mcash').disabled = true;
        $('mine-count').disabled = true;
        say($('mmsg'), `💎 ${esc(t('mines_hint'))}`, '');
        buildGrid(false);
        bet.lock(true);
      } catch (e) {
        C.fail(e);
        $('mstart').disabled = false;
      }
      busy = false;
    };

    $('mcash').onclick = async () => {
      if (!gameActive || busy) return; busy = true; $('mcash').disabled = true;
      try {
        const r = await C.api('/games/mines/cashout', {});
        C.setBalance(r.balance);
        say($('mmsg'), `${esc(t('win'))}: +${C.fmt(r.payout)} 🎉`, 'win');
        sfx.win();
        showCashoutModal(r.mult, r.payout);
        if (r.mult >= 2) coinRain(stage);
        if (r.mines) r.mines.forEach((mi) => {
          const cells = $('mgrid').querySelectorAll('.mine-cell');
          if (!cells[mi].classList.contains('revealed-safe')) {
            cells[mi].textContent = '💣';
            cells[mi].className = 'mine-cell revealed-mine revealed-dim';
          }
        });
        for (let i = 0; i < GRID; i++) {
          const cells = $('mgrid').querySelectorAll('.mine-cell');
          if (!revealed[i] && !(r.mines || []).includes(i)) {
            cells[i].textContent = '💎';
            cells[i].className = 'mine-cell revealed-safe revealed-dim';
          }
        }
        gameActive = false;
        bet.lock(false);
        $('mstart').disabled = false;
        $('mine-count').disabled = false;
        updateInfo(null, null);
      } catch (e) { C.fail(e); $('mcash').disabled = false; }
      busy = false;
    };

    initMinesState();
  }

  // =========================================================
  // PLINKO (Stake Reference / AnsonH)
  // =========================================================
  const PLINKO_TABLES = {
    8: {
      low: [5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6],
      medium: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13],
      high: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29],
    },
    10: {
      low: [8.9, 3, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 3, 8.9],
      medium: [22, 5, 2, 1.4, 0.6, 0.4, 0.6, 1.4, 2, 5, 22],
      high: [76, 10, 3, 0.9, 0.3, 0.2, 0.3, 0.9, 3, 10, 76],
    },
    12: {
      low: [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10],
      medium: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
      high: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170],
    },
    14: {
      low: [7.1, 4, 1.9, 1.4, 1.3, 1.1, 1, 0.5, 1, 1.1, 1.3, 1.4, 1.9, 4, 7.1],
      medium: [58, 15, 7, 4, 1.9, 1, 0.5, 0.2, 0.5, 1, 1.9, 4, 7, 15, 58],
      high: [420, 56, 18, 5, 1.9, 0.3, 0.2, 0.2, 0.2, 0.3, 1.9, 5, 18, 56, 420],
    },
    16: {
      low: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.4, 1.4, 2, 9, 16],
      medium: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110],
      high: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000],
    },
  };

  function getBinColors(count) {
    const colors = [];
    const mid = (count - 1) / 2;
    for (let i = 0; i < count; i++) {
      const dist = Math.abs(i - mid) / mid; // 0 at center, 1 at edges
      if (dist > 0.75) colors.push('#dc2626');       // Red
      else if (dist > 0.5) colors.push('#ea580c');   // Orange
      else if (dist > 0.25) colors.push('#d97706');  // Amber
      else colors.push('#334155');                   // Slate
    }
    return colors;
  }

  function plinko(body, stage) {
    const { t, esc } = C;
    let selectedRows = 10;
    let selectedRisk = 'medium';
    const recentWins = [];

    const W = Math.min(380, window.innerWidth - 60);
    const H = 350;

    body.innerHTML = `
      <div id="pbet"></div>
      <div class="plinko-controls">
        <label>
          ${esc(t('risk') || 'Risk')}:
          <select id="p-risk">
            <option value="low">Low</option>
            <option value="medium" selected>Medium</option>
            <option value="high">High</option>
          </select>
        </label>
        <label>
          ${esc(t('rows') || 'Rows')}:
          <select id="p-rows">
            <option value="8">8</option>
            <option value="10" selected>10</option>
            <option value="12">12</option>
            <option value="14">14</option>
            <option value="16">16</option>
          </select>
        </label>
      </div>
      <div class="plinko-recent" id="p-recent"></div>
      <div class="plinko-canvas-wrap">
        <canvas id="plinko-canvas" width="${W}" height="${H}"></canvas>
      </div>
      <div class="plinko-buckets" id="plinko-buckets" style="max-width:${W}px"></div>
      <button class="bigbtn" id="pdrop" style="margin-top:14px">⚡ ${esc(t('plinko_drop'))}</button>
      <div class="msg" id="pmsg"></div>`;

    const cv = $('plinko-canvas');
    const ctx = cv.getContext('2d');
    let pegRows = [];
    let bucketsCount = selectedRows + 1;
    let colSpacing = 0, rowSpacing = 0;
    const padX = 20, padY = 24;

    function buildGeometry() {
      bucketsCount = selectedRows + 1;
      colSpacing = (W - padX * 2) / (bucketsCount - 1);
      rowSpacing = (H - padY - 45) / (selectedRows + 1);

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

      // Render bottom buckets
      const mults = PLINKO_TABLES[selectedRows][selectedRisk];
      const colors = getBinColors(bucketsCount);
      const host = $('plinko-buckets');
      host.innerHTML = mults.map((m, i) => `
        <div class="plinko-bucket" id="p-bk-${i}" style="background:${colors[i]};color:#fff;font-size:${selectedRows >= 14 ? '9px' : '11px'}">
          ×${m}
        </div>
      `).join('');
    }

    function renderRecent() {
      const el = $('p-recent');
      if (!el) return;
      el.innerHTML = recentWins.slice(-6).map((item) => `
        <span class="plinko-pill" style="background:${item.color}">${item.mult}×</span>
      `).join('');
    }

    function drawBoard(ball = null, activeBucket = -1, pulsePeg = null) {
      ctx.clearRect(0, 0, W, H);

      // Canvas background gradient
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#0a101d');
      bg.addColorStop(1, '#05080f');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Triangular pegs
      const pegR = selectedRows >= 14 ? 3 : 3.8;
      pegRows.forEach((row, ri) => {
        row.forEach((p, ci) => {
          ctx.beginPath();
          ctx.arc(p.x, p.y, pegR, 0, Math.PI * 2);
          const isPulse = pulsePeg && pulsePeg.r === ri && pulsePeg.c === ci;
          ctx.fillStyle = isPulse ? '#ffffff' : '#c9a227';
          if (isPulse) {
            ctx.shadowColor = '#ffffff';
            ctx.shadowBlur = 12;
          }
          ctx.fill();
          ctx.shadowBlur = 0;
        });
      });

      // Bottom bin dividers
      for (let b = 0; b <= bucketsCount; b++) {
        const bx = padX + b * colSpacing - colSpacing / 2;
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(bx, H - 36);
        ctx.lineTo(bx, H);
        ctx.stroke();
      }

      // Winning bucket highlight
      if (activeBucket >= 0) {
        const bx = padX + activeBucket * colSpacing - colSpacing / 2;
        ctx.fillStyle = 'rgba(201,162,39,0.35)';
        ctx.fillRect(bx + 1, H - 36, colSpacing - 2, 36);
      }

      // Ball
      if (ball) {
        ctx.beginPath();
        const ballR = selectedRows >= 14 ? 5.5 : 6.8;
        ctx.arc(ball.x, ball.y, ballR, 0, Math.PI * 2);
        const grad = ctx.createRadialGradient(ball.x - 2, ball.y - 2, 1, ball.x, ball.y, ballR);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(1, '#ef4444');
        ctx.fillStyle = grad;
        ctx.shadowColor = 'rgba(239,68,68,0.7)';
        ctx.shadowBlur = 10;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }

    async function runBall(steps, targetBucket) {
      return new Promise((res) => {
        const path = [{ x: W / 2, y: 10 }];
        let curCol = 0;
        for (let r = 0; r < selectedRows; r++) {
          const rowPegs = pegRows[r];
          const peg = rowPegs[Math.min(curCol, rowPegs.length - 1)];
          path.push({ x: peg.x, y: peg.y, r, c: curCol });
          if (steps[r] === 1) curCol++;
        }
        const finalX = padX + targetBucket * colSpacing;
        path.push({ x: finalX, y: H - 18 });

        let seg = 0, progress = 0;
        const SEG_FRAMES = 12;
        let lastPulse = null;

        function stepFrame() {
          if (seg >= path.length - 1) {
            drawBoard(path[path.length - 1], targetBucket, null);
            const bk = $(`p-bk-${targetBucket}`);
            if (bk) {
              bk.classList.add('hit');
              setTimeout(() => bk.classList.remove('hit'), 450);
            }
            res(); return;
          }
          const p0 = path[seg], p1 = path[seg + 1];
          progress += 1 / SEG_FRAMES;
          const ease = progress * progress * (3 - 2 * progress);
          const arc = Math.sin(progress * Math.PI) * 5;
          const bx = p0.x + (p1.x - p0.x) * ease;
          const by = p0.y + (p1.y - p0.y) * ease - arc;

          if (progress >= 1) {
            seg++; progress = 0;
            if (path[seg].r !== undefined) {
              lastPulse = { r: path[seg].r, c: path[seg].c };
              sfx.plink();
            }
          }
          drawBoard({ x: bx, y: by }, -1, lastPulse);
          requestAnimationFrame(stepFrame);
        }
        stepFrame();
      });
    }

    buildGeometry();
    drawBoard();
    const bet = betBar($('pbet'));

    $('p-rows').onchange = (e) => {
      selectedRows = Number(e.target.value);
      buildGeometry();
      drawBoard();
    };
    $('p-risk').onchange = (e) => {
      selectedRisk = e.target.value;
      buildGeometry();
      drawBoard();
    };

    $('pdrop').onclick = async () => {
      const btn = $('pdrop');
      if (btn.disabled) return;
      btn.disabled = true;
      bet.lock(true);
      $('p-rows').disabled = true;
      $('p-risk').disabled = true;
      say($('pmsg'), '');
      try {
        const r = await C.api('/games/plinko', {
          bet: bet.get(),
          rows: selectedRows,
          risk: selectedRisk,
        });
        C.setBalance(r.balance);
        const steps = r.steps || Array.from({ length: selectedRows }, () => Math.round(Math.random()));
        const target = typeof r.bucket === 'number' ? r.bucket : Math.floor(bucketsCount / 2);
        await runBall(steps, target);

        const colors = getBinColors(bucketsCount);
        recentWins.push({ mult: r.mult, color: colors[target] || '#d97706' });
        renderRecent();

        if (r.payout) {
          say($('pmsg'), `${esc(t('win'))}: +${C.fmt(r.payout)} (×${r.mult}) 🎉`, 'win');
          sfx.win();
          if (r.mult >= 2) coinRain(stage);
        } else {
          say($('pmsg'), `${esc(t('lose'))} (×${r.mult})`, 'lose');
          sfx.lose();
        }
        await sleep(1200);
        drawBoard();
      } catch (e) {
        C.fail(e);
      }
      btn.disabled = false;
      bet.lock(false);
      $('p-rows').disabled = false;
      $('p-risk').disabled = false;
    };
  }

  // =========================================================
  // ROAD DASH (Chicken Crossing — Chicken Road 3G Style)
  // =========================================================
  const LANE_W = 96, CURB_W = 90;
  const heroLeft = (step) =>
    step === 0 ? CURB_W / 2 - 29 : CURB_W + (step - 1) * LANE_W + LANE_W / 2 - 29;

  const CARS_DN = [
    { e: '🚗', cls: 'md' }, { e: '🚕', cls: 'md' }, { e: '🚙', cls: 'md' },
    { e: '🚌', cls: 'lg' }, { e: '🚓', cls: 'md' }, { e: '🏎️', cls: 'sm' },
  ];
  const CARS_UP = [
    { e: '🚐', cls: 'md' }, { e: '🚑', cls: 'md' }, { e: '🚒', cls: 'lg' },
    { e: '🛻', cls: 'md' }, { e: '🚛', cls: 'lg' }, { e: '🏍️', cls: 'sm' },
  ];

  function road(body, stage) {
    const { t, esc } = C;
    let st = C.roadState || { active: false, balance: 100000, difficulty: 'easy', ladder: [], maxSteps: 24, next: 1.01, next_crash_chance: 1.8 };
    let curDiff = st.difficulty || 'easy';
    let busy = false;
    let currentBetCents = 1000; // 10 credits default
    let activeSubTab = 'bets';
    let roundHistory = [];
    let customClientSeed = 'fetan_' + Math.random().toString(36).slice(2, 10);

    body.innerHTML = `
      <div class="road-container">
        <!-- Top bar -->
        <div class="road-topbar">
          <div class="road-brand-pill">
            <span class="road-brand-badge">ፈ</span>
            <span>${esc(t('road_title'))}</span>
          </div>
          <div class="road-topbar-actions">
            <button class="road-btn-icon" id="road-how-btn">
              <span>❓</span> ${esc(t('how_to_play'))}
            </button>
            <div class="road-balance-pill" id="road-bal-pill">
              <span>🪙</span> <span id="road-bal-val">${C.fmt(st.balance || 0)}</span>
            </div>
            <button class="road-btn-icon" id="road-sound-btn">
              <span id="road-sound-icon">${muted ? '🔇' : '🔊'}</span>
            </button>
            <button class="road-btn-icon" id="road-fs-btn" title="${esc(t('fullscreen'))}">
              <span>⛶</span>
            </button>
          </div>
        </div>

        <!-- Road scene with horizontal camera tracking -->
        <div class="road-viewport" id="rviewport">
          <div class="road-scroll" id="rsc">
            <div class="road-track" id="rtrack"></div>
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
              <button class="road-chip-btn" id="chip-1" type="button">+1</button>
              <button class="road-chip-btn" id="chip-5" type="button">+5</button>
              <button class="road-chip-btn" id="chip-10" type="button">+10</button>
              <button class="road-chip-btn" id="chip-50" type="button">+50</button>
              <button class="road-chip-btn" id="chip-half" type="button">½</button>
              <button class="road-chip-btn" id="chip-double" type="button">2×</button>
            </div>
          </div>

          <!-- Difficulty segmented selector & Shot down indicator -->
          <div class="road-diff-row">
            <div class="road-segmented" id="rdiff-segment">
              <button class="road-seg-btn ${curDiff === 'easy' ? 'active' : ''}" data-diff="easy" type="button">${esc(t('diff_easy'))}</button>
              <button class="road-seg-btn ${curDiff === 'medium' ? 'active' : ''}" data-diff="medium" type="button">${esc(t('diff_medium'))}</button>
              <button class="road-seg-btn ${curDiff === 'hard' ? 'active' : ''}" data-diff="hard" type="button">${esc(t('diff_hard'))}</button>
              <button class="road-seg-btn ${curDiff === 'hardcore' ? 'active' : ''}" data-diff="hardcore" type="button">${esc(t('diff_hardcore'))}</button>
            </div>
            <div class="road-shot-down">
              <span>⚠️ ${esc(t('chance_shot_down'))}:</span>
              <span class="road-shot-down-val" id="rshot-val">—</span>
            </div>
          </div>

          <!-- Action buttons (GO & CASH OUT) -->
          <div class="road-actions-row">
            <button class="btn-road-cashout" id="rcashout-btn" disabled type="button">
              <span>💰</span>
              <span id="rcashout-label">${esc(t('cashout'))}</span>
            </button>
            <button class="btn-road-go" id="rgo-btn" type="button">
              <span id="rgo-icon">🐔</span>
              <span id="rgo-label">${esc(t('go'))}</span>
            </button>
          </div>

          <div class="msg" id="rmsg" style="text-align:center;margin-top:4px"></div>
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

    // Rules modal
    $('road-how-btn').onclick = () => showRulesModal();
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
    $('chip-1').onclick = () => setBetDisplay(parseFloat(betInput.value) + 1);
    $('chip-5').onclick = () => setBetDisplay(parseFloat(betInput.value) + 5);
    $('chip-10').onclick = () => setBetDisplay(parseFloat(betInput.value) + 10);
    $('chip-50').onclick = () => setBetDisplay(parseFloat(betInput.value) + 50);
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
          renderScene();
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
            resBox.innerHTML = `<span style="color:#ef4444">Please enter server seed, client seed, and lane number.</span>`;
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
            resBox.innerHTML = `<span style="color:#ef4444">Verification error: ${esc(e.message || 'Invalid parameters')}</span>`;
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

    // Render Road Track and Lanes
    function renderScene() {
      const track = $('rtrack');
      if (!track) return;
      const maxSteps = st.maxSteps || 24;
      const ladder = st.ladder || [];

      let lanesHtml = '';
      for (let i = 1; i <= maxSteps; i++) {
        const isCleared = st.active && i <= st.step;
        const isTarget = st.active && i === st.step + 1;
        const multVal = ladder[i - 1] ? Number(ladder[i - 1]).toFixed(2) : '1.00';

        // Passing cars animation
        const dir = i % 2 ? 'dn' : 'up';
        const pool = dir === 'dn' ? CARS_DN : CARS_UP;
        const car = pool[(i * 3) % pool.length];
        const dur = (2.2 + ((i * 7) % 7) * 0.4).toFixed(2);
        const delay = (-((i * 11) % 10) * 0.35).toFixed(2);
        const carHtml = `<span class="lane-car ${car.cls} ${dir}" style="animation-duration:${dur}s;animation-delay:${delay}s">${car.e}</span>`;

        let laneItem = '';
        if (isCleared) {
          laneItem = `
            <div class="coin-badge">🪙</div>
            <div class="road-barrier"></div>
          `;
        } else {
          laneItem = `
            <div class="manhole-badge">
              <span class="manhole-mult">${multVal}×</span>
              <span class="manhole-sub">LANE ${i}</span>
            </div>
            ${carHtml}
          `;
        }

        lanesHtml += `
          <div class="road-lane ${isCleared ? 'lane-cleared' : ''} ${isTarget ? 'lane-target' : ''}" id="road-ln-${i}">
            ${laneItem}
          </div>
        `;
      }

      track.innerHTML = `
        <div class="road-curb-start">
          <span class="curb-label">START</span>
          <span class="curb-icon">🏠</span>
          <span class="curb-label">START</span>
        </div>
        ${lanesHtml}
        <div class="road-curb-end">
          <span class="curb-label" style="color:#F2D98B">FINISH</span>
          <span class="curb-icon">🏆</span>
          <span class="curb-label" style="color:#F2D98B">FINISH</span>
        </div>
        <div class="chicken-hero" id="road-chicken">
          <div class="chicken-body">🐔</div>
          <div class="chicken-tag" id="chicken-tag">1.00×</div>
        </div>
      `;

      updateChickenPosition(st.active ? st.step : 0, false);
    }

    // Camera and Hero tracking
    function updateChickenPosition(step, hop = true) {
      const chicken = $('road-chicken');
      const tag = $('chicken-tag');
      const sc = $('rsc');
      if (!chicken) return;

      const lx = heroLeft(step);
      chicken.style.transform = `translateX(${lx}px)`;

      if (tag) {
        if (step > 0 && st.mult) {
          tag.textContent = Number(st.mult).toFixed(2) + '×';
        } else {
          tag.textContent = '1.00×';
        }
      }

      if (hop) {
        chicken.classList.remove('is-hopping');
        void chicken.offsetWidth;
        chicken.classList.add('is-hopping');
        sfx.hop();
        setTimeout(() => { if (chicken) chicken.classList.remove('is-hopping'); }, 450);
      }

      // Smooth horizontal camera tracking: keep chicken at ~25% from left edge
      if (sc) {
        const targetScroll = Math.max(0, lx - sc.clientWidth * 0.25);
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

      // Update next crash chance
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
        $('rgo-label').textContent = esc(t('start'));
        cashoutBtn.disabled = true;
        cashoutLabel.textContent = esc(t('cashout'));
      } else {
        goBtn.disabled = false;
        $('rgo-label').textContent = `${esc(t('go'))} (Lane ${st.step + 1})`;
        if (st.step >= 1) {
          cashoutBtn.disabled = false;
          const payoutAmt = Math.floor(st.bet * st.mult);
          cashoutLabel.textContent = `${esc(t('cashout'))} +${C.fmt(payoutAmt)}`;
        } else {
          cashoutBtn.disabled = true;
          cashoutLabel.textContent = esc(t('cashout'));
        }
      }
    }

    function lockButtons(locked) {
      const goBtn = $('rgo-btn');
      const cashoutBtn = $('rcashout-btn');
      if (goBtn) goBtn.disabled = locked;
      if (cashoutBtn) cashoutBtn.disabled = locked || (st.active && st.step < 1);
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
        f.style.left = '38px';
        f.style.top = '170px';
        laneEl.appendChild(f);
        setTimeout(() => f.remove(), 1200);
      }
    }

    // STEP ACTION
    async function doStep() {
      if (busy) return;
      busy = true;
      lockButtons(true);
      say($('rmsg'), '');

      // If game is not active yet, START IT!
      if (!st.active) {
        try {
          st = await C.api('/games/road/start', {
            bet: currentBetCents,
            difficulty: curDiff,
            client_seed: customClientSeed
          });
          C.setBalance(st.balance);
          renderScene();
          updateControls();
          renderSubTab();
        } catch (e) {
          C.fail(e);
        }
        busy = false;
        lockButtons(false);
        return;
      }

      // Taking step in active game
      const targetLane = st.step + 1;
      updateChickenPosition(targetLane, true);

      try {
        const r = await C.api('/games/road/step', {});
        C.setBalance(r.balance);

        if (r.crashed) {
          // Crash Hazard
          await sleep(200);
          const laneEl = $('road-ln-' + targetLane);
          if (laneEl) {
            const hCar = document.createElement('div');
            hCar.className = 'hazard-car';
            hCar.textContent = '🏎️';
            laneEl.appendChild(hCar);
            sfx.horn();
            await sleep(180);
            sfx.crash();
            const vp = $('rviewport');
            if (vp) {
              vp.classList.add('road-shake');
              setTimeout(() => vp.classList.remove('road-shake'), 350);
            }
            const chicken = $('road-chicken');
            if (chicken) chicken.classList.add('is-dead');
            spawnFeathers(laneEl);
          }
          say($('rmsg'), `💥 ${esc(t('crashed'))} (${esc(t('server_seed'))}: ${esc(r.server_seed.slice(0, 16))}...)`, 'lose');
          sfx.lose();
          await sleep(1400);

          st = {
            active: false,
            balance: r.balance,
            difficulty: curDiff,
            ladder: r.ladder || st.ladder,
            maxSteps: r.maxSteps || st.maxSteps,
            next: (r.ladder && r.ladder[0]) || 1.01,
            next_crash_chance: 1.8
          };
          renderScene();
          updateControls();
          loadHistory();
        } else if (r.finished) {
          // Win - Reached Final Lane!
          await sleep(250);
          sfx.coin();
          sfx.win();
          coinRain(stage);
          say($('rmsg'), `🏆 ${esc(t('big_win'))} +${C.fmt(r.payout)}! (${esc(t('server_seed'))}: ${esc(r.server_seed.slice(0, 16))}...)`, 'win');
          await sleep(1400);

          st = {
            active: false,
            balance: r.balance,
            difficulty: curDiff,
            ladder: r.ladder || st.ladder,
            maxSteps: r.maxSteps || st.maxSteps,
            next: (r.ladder && r.ladder[0]) || 1.01,
            next_crash_chance: 1.8
          };
          renderScene();
          updateControls();
          loadHistory();
        } else {
          // Safe step
          sfx.coin();
          st = r;
          renderScene();
          updateControls();
        }
      } catch (e) {
        C.fail(e);
        updateChickenPosition(st.step, false);
      }

      busy = false;
      lockButtons(false);
    }

    // CASHOUT ACTION
    async function doCashout() {
      if (busy || !st.active || st.step < 1) return;
      busy = true;
      lockButtons(true);
      try {
        const r = await C.api('/games/road/cashout', {});
        C.setBalance(r.balance);
        sfx.win();
        coinRain(stage);
        say($('rmsg'), `🎉 ${esc(t('win'))} +${C.fmt(r.payout)} (×${r.mult})!`, 'win');
        await sleep(1200);

        st = {
          active: false,
          balance: r.balance,
          difficulty: curDiff,
          ladder: r.ladder || st.ladder,
          maxSteps: r.maxSteps || st.maxSteps,
          next: (r.ladder && r.ladder[0]) || 1.01,
          next_crash_chance: 1.8
        };
        renderScene();
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
      renderScene();
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
    let sel = null, spinning = false, everSpun = false, wheelA = 0, ballA = 0, ballR = 150, history = [];
    body.innerHTML = `
      <div class="wheel-box"><canvas id="wheel"></canvas></div>
      <div class="history" id="hist"></div>
      <div class="rtable" id="rtab"></div>
      <div class="outside" id="rout"></div>
      <div class="pick" id="rpick">${esc(t('pick_prompt'))}</div>
      <div id="rbet"></div>
      <button class="bigbtn" id="rgo">${esc(t('spin'))}</button>
      <div class="msg" id="rmsg"></div>`;

    const bet = betBar($('rbet'));
    const tab = $('rtab');
    let html = `<button class="zero" data-k="number" data-v="0">0</button>`;
    for (let row = 0; row < 3; row++)
      for (let col = 0; col < 12; col++) {
        const n = col * 3 + (3 - row);
        html += `<button class="${colorOf(n)}" data-k="number" data-v="${n}">${n}</button>`;
      }
    tab.innerHTML = html;
    $('rout').innerHTML = `
      <button class="red"  data-k="color"  data-v="red"  >${esc(t('red'))}</button>
      <button class="black" data-k="color" data-v="black">${esc(t('black'))}</button>
      <button class="eo"   data-k="parity" data-v="even" >${esc(t('even'))}</button>
      <button class="eo"   data-k="parity" data-v="odd"  >${esc(t('odd'))}</button>`;

    body.querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => {
      if (spinning) return;
      body.querySelectorAll('[data-k]').forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel');
      sel = { kind: b.dataset.k, value: b.dataset.k === 'number' ? Number(b.dataset.v) : b.dataset.v };
      $('rpick').textContent = `${t('picked')}: ${b.textContent}  (x${sel.kind === 'number' ? 36 : 2})`;
      sfx.tick();
    }));

    const cv = $('wheel'), dpr = Math.min(window.devicePixelRatio || 1, 2), S = 320;
    cv.width = S * dpr; cv.height = S * dpr;
    const g = cv.getContext('2d'); g.scale(dpr, dpr);
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

      // Center gold turret / hub
      const hub = g.createRadialGradient(cx - 8, cy - 8, 4, cx, cy, 56);
      hub.addColorStop(0, '#ffe58a'); hub.addColorStop(1, '#8a6200');
      g.fillStyle = hub; g.beginPath(); g.arc(cx, cy, 50, 0, 7); g.fill();
      g.fillStyle = '#1a0e00'; g.font = 'bold 20px Noto Sans Ethiopic,sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('ፈ', cx, cy);

      // Top indicator pointer
      g.fillStyle = '#c9a227';
      g.beginPath(); g.moveTo(cx - 9, 2); g.lineTo(cx + 9, 2); g.lineTo(cx, 20); g.closePath(); g.fill();

      // Ball
      const bx = cx + ballR * Math.sin(ballA), by = cy - ballR * Math.cos(ballA);
      g.shadowColor = 'rgba(0,0,0,0.7)'; g.shadowBlur = 8;
      g.fillStyle = '#fff'; g.beginPath(); g.arc(bx, by, 7, 0, 7); g.fill();
      g.shadowBlur = 0;
    }

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
      $('hist').innerHTML = history.slice(-14).map(
        (n) => `<span class="hnum ${colorOf(n)}">${n}</span>`
      ).join('');
    }

    $('rgo').onclick = async () => {
      if (spinning) return;
      if (!sel) { say($('rmsg'), esc(t('pick_prompt')), 'lose'); return; }
      spinning = true; everSpun = true; $('rgo').disabled = true; bet.lock(true); say($('rmsg'), '');
      try {
        const r = await C.api('/games/roulette', { bet: bet.get(), kind: sel.kind, value: sel.value });
        await animate(r.n); history.push(r.n); paintHistory(); C.setBalance(r.balance);
        if (r.payout) {
          say($('rmsg'), `${esc(t('win'))}: +${C.fmt(r.payout)} 🎉`, 'win'); sfx.win();
          if (r.payout >= bet.get() * 5) coinRain(stage);
        } else {
          say($('rmsg'), `${r.n} · ${esc(t('lose'))}`, 'lose'); sfx.lose();
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
  const rs = () => SYMS[Math.floor(Math.random() * SYMS.length)];
  const SYM_H = 84;

  function star(body, stage) {
    const { t, esc } = C;
    const cur = [0, 1, 2].map(() => [rs(), rs(), rs()]);
    body.innerHTML = `
      <div class="slot">
        <div class="slot-title">★ STAR SPIN ★</div>
        <div class="reels3">
          ${[0,1,2].map((i) => `<div class="reelwin" id="rw${i}"><div class="strip" id="st${i}"></div></div>`).join('')}
          <div class="payline"></div>
        </div>
        <div class="paytable">🍒🍒🍒 ×5 &nbsp;|&nbsp; 🍋 ×8 &nbsp;|&nbsp; 🔔 ×12 &nbsp;|&nbsp; ⭐ ×25 &nbsp;|&nbsp; 7️⃣ ×50 &nbsp;|&nbsp; 🌟=wild</div>
      </div>
      <div id="sbet"></div>
      <button class="bigbtn" id="sgo">${esc(t('spin'))}</button>
      <div class="msg" id="smsg"></div>`;

    const bet = betBar($('sbet'));
    const paint = (i) => ($('st' + i).innerHTML = cur[i].map((s) => `<div class="sym">${s}</div>`).join(''));
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

      strip.innerHTML = items.map((s) => `<div class="sym">${s}</div>`).join('');
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
        strip.innerHTML = cur[i].map((s) => `<div class="sym">${s}</div>`).join('');
        strip.style.transform = 'translateY(0)';
      });
    }

    let busy = false;
    $('sgo').onclick = async () => {
      if (busy) return; busy = true; $('sgo').disabled = true; bet.lock(true); say($('smsg'), '');
      [0, 1, 2].forEach((i) => $('rw' + i).classList.remove('win'));
      try {
        const r = await C.api('/games/star', { bet: bet.get() });
        const spinTick = setInterval(sfx.tick, 85);
        await Promise.all(r.reels.map((s, i) => spinReel(i, s, 1400 + i * 700)));
        clearInterval(spinTick); C.setBalance(r.balance);
        if (r.payout) {
          await sleep(100);
          [0, 1, 2].forEach((i) => $('rw' + i).classList.add('win'));
          say($('smsg'), `${esc(t('win'))}: +${C.fmt(r.payout)} (×${r.mult}) 🎉`, 'win'); sfx.win();
          if (r.mult >= 5) { coinRain(stage); say($('smsg'), `${esc(t('big_win'))} +${C.fmt(r.payout)} (×${r.mult})`, 'win'); }
        } else { say($('smsg'), esc(t('lose')), 'lose'); sfx.lose(); }
      } catch (e) { C.fail(e); }
      busy = false; $('sgo').disabled = false; bet.lock(false);
    };
  }

  // =========================================================
  // KENO (1-80 number board, pick 1-10, draw 20)
  // =========================================================
  // Payout table frontend mirror (for live display before draw)
  const KENO_PAY_DISPLAY = {
    1:  { 1: '3.8×' },
    2:  { 2: '12×' },
    3:  { 2: '2×', 3: '40×' },
    4:  { 2: '1.5×', 3: '5×', 4: '100×' },
    5:  { 3: '3×', 4: '20×', 5: '420×' },
    6:  { 3: '2×', 4: '8×', 5: '80×', 6: '1600×' },
    7:  { 3: '1.5×', 4: '5×', 5: '25×', 6: '320×', 7: '7000×' },
    8:  { 4: '3.5×', 5: '12×', 6: '100×', 7: '1700×', 8: '10000×' },
    9:  { 4: '2.5×', 5: '7×', 6: '50×', 7: '500×', 8: '4000×', 9: '30000×' },
    10: { 5: '5×', 6: '25×', 7: '250×', 8: '2000×', 9: '10000×', 10: '100000×' },
  };

  function keno(body, stage) {
    const { t, esc } = C;
    let picks = new Set();
    let busy = false;

    body.innerHTML = `
      <div id="kbet"></div>
      <div class="keno-meta">
        <span class="keno-info" id="kpick-info">
          ${esc(t('keno_pick'))} (0/10)
        </span>
        <button class="chip" id="kclear" style="font-size:12px">${esc(t('keno_clear'))}</button>
      </div>
      <div class="keno-board" id="kboard"></div>
      <div class="keno-paytable" id="kpay"></div>
      <div class="keno-drawn-row" id="kdrawn"></div>
      <button class="bigbtn" id="kdraw" disabled>🎱 ${esc(t('keno_draw'))}</button>
      <div class="msg" id="kmsg"></div>`;

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
      if (picks.size === 0) { el.innerHTML = ''; return; }
      const row = KENO_PAY_DISPLAY[picks.size] || {};
      el.innerHTML = `
        <div class="keno-pay-title">Paytable for ${picks.size} spot${picks.size > 1 ? 's' : ''}:</div>
        <div class="keno-pay-row">
          ${Object.entries(row).map(([match, mult]) => `
            <span class="keno-pay-chip"><b>${match}</b> hit = <b>${mult}</b></span>
          `).join('')}
        </div>`;
    }

    $('kclear').onclick = () => {
      if (busy) return;
      picks.clear();
      board.querySelectorAll('.keno-num').forEach((b) => b.classList.remove('selected', 'drawn', 'hit'));
      $('kpick-info').textContent = `${esc(t('keno_picked'))}: 0/10`;
      $('kdraw').disabled = true;
      $('kpay').innerHTML = '';
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
            `🎉 ${esc(t('keno_matched'))} ${r.matched} ${esc(t('keno_of'))} ${picks.size}! +${C.fmt(r.payout)} (×${r.mult})`,
            'win');
          sfx.win();
          if (r.matched >= 4) coinRain(stage);
        } else {
          say($('kmsg'),
            `${esc(t('keno_matched'))} ${r.matched} ${esc(t('keno_of'))} ${picks.size}. ${esc(t('lose'))}`,
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
            <div class="bingo-card" id="bcard">
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
            <div class="bingo-pay-row"><span>≤20 draws</span><span class="bingo-pay-mult">×15</span></div>
            <div class="bingo-pay-row"><span>≤30 draws</span><span class="bingo-pay-mult">×8</span></div>
            <div class="bingo-pay-row"><span>≤40 draws</span><span class="bingo-pay-mult">×4</span></div>
            <div class="bingo-pay-row"><span>≤50 draws</span><span class="bingo-pay-mult">×2.5</span></div>
            <div class="bingo-pay-row"><span>51+ draws</span><span class="bingo-pay-mult">×1.5</span></div>
          </div>
          <div class="bingo-draw-count" id="bdrawcount">Draws: 0</div>
          <div class="bingo-last-ball" id="blastball">—</div>
        </div>
      </div>
      <div class="bingo-controls">
        <button class="bigbtn green" id="bnew">${esc(t('bingo_new_card'))}</button>
        <button class="bigbtn" id="bcall" disabled>📢 ${esc(t('bingo_call'))}</button>
        <button class="chip" id="bauto" style="margin-left:8px">⏩ Auto</button>
      </div>
      <div class="msg" id="bmsg"></div>`;

    const bet = betBar($('bbet'));

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
        if (st && st.active) {
          card = st.card;
          drawn = st.drawn || [];
          marked = st.marked || new Array(25).fill(false);
          gameActive = true;
          buildGrid();
          drawn.forEach((n) => addBall(n));
          $('bcall').disabled = false;
          $('bnew').textContent = 'Abandon & New';
          $('bdrawcount').textContent = `Draws: ${drawn.length}`;
          say($('bmsg'), esc(t('bingo_waiting')), '');
          bet.lock(true);
        }
      } catch (e) { /* no active game */ }
    }

    $('bnew').onclick = async () => {
      if (busy) return; busy = true;
      stopAutoCall();
      try {
        if (gameActive) {
          await C.api('/games/bingo/abandon', {});
          gameActive = false;
        }
        const r = await C.api('/games/bingo/start', { bet: bet.get() });
        C.setBalance(r.balance);
        card = r.card;
        drawn = [];
        marked = new Array(25).fill(false);
        gameActive = true;
        $('bballs').innerHTML = '';
        $('blastball').textContent = '—';
        $('blastball').style.background = '';
        $('bdrawcount').textContent = 'Draws: 0';
        buildGrid();
        $('bcall').disabled = false;
        $('bnew').textContent = 'Abandon & New';
        bet.lock(true);
        say($('bmsg'), esc(t('bingo_waiting')), '');
        sfx.tick();
      } catch (e) { C.fail(e); }
      busy = false;
    };

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
          say($('bmsg'), `${esc(t('bingo_win'))} +${C.fmt(r.payout)} (×${r.mult}) 🎊`, 'win');
          sfx.win(); coinRain(stage);
          gameActive = false;
          $('bcall').disabled = true;
          $('bnew').textContent = esc(t('bingo_new_card'));
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

  return { mount };
})();
