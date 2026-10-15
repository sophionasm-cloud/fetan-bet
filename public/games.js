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
      <div class="stage-head" style="margin-bottom:12px">
        <h2 style="color:#111;margin:0;font-size:22px;display:flex;align-items:center;gap:8px">
          🎰 ${esc(t('lobby_title'))}
        </h2>
        <span id="sbtn"></span>
      </div>
      <div class="lobby">
        <div class="gcard g1" data-g="road">
          <span class="big">🐔</span>
          <h3>${esc(t('road_title'))}</h3>
          <p>${esc(t('road_desc'))}</p>
          <button class="btn">${esc(t('play_now'))}</button>
        </div>
        <div class="gcard g4" data-g="mines">
          <span class="big">💎</span>
          <h3>${esc(t('mines_title'))}</h3>
          <p>${esc(t('mines_desc'))}</p>
          <button class="btn">${esc(t('play_now'))}</button>
        </div>
        <div class="gcard g5" data-g="plinko">
          <span class="big">⚡</span>
          <h3>${esc(t('plinko_title'))}</h3>
          <p>${esc(t('plinko_desc'))}</p>
          <button class="btn">${esc(t('play_now'))}</button>
        </div>
        <div class="gcard g2" data-g="roulette">
          <span class="big">🎡</span>
          <h3>${esc(t('roulette_title'))}</h3>
          <p>${esc(t('roulette_desc'))}</p>
          <button class="btn">${esc(t('play_now'))}</button>
        </div>
        <div class="gcard g3" data-g="star">
          <span class="big">🎰</span>
          <h3>${esc(t('star_title'))}</h3>
          <p>${esc(t('star_desc'))}</p>
          <button class="btn">${esc(t('play_now'))}</button>
        </div>
      </div>`;
    soundBtn($('sbtn'));
    app.querySelectorAll('.gcard').forEach((c) => (c.onclick = () => open(app, c.dataset.g)));
  }

  let stopFns = [];
  function open(app, game) {
    const titles = {
      road:     '🐔 ' + C.t('road_title'),
      mines:    '💎 ' + C.t('mines_title'),
      plinko:   '⚡ ' + C.t('plinko_title'),
      roulette: '🎡 ' + C.t('roulette_title'),
      star:     '🎰 ' + C.t('star_title'),
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
    ({ road, roulette, star, mines, plinko })[game]($('gbody'), app.querySelector('.stage'));
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
  // ROAD DASH (Original Chicken Road crossing)
  // =========================================================
  const LANE_W = 74, CURB_W = 80;
  const heroLeft = (step) =>
    step === 0 ? CURB_W / 2 - 21 : CURB_W + (step - 1) * LANE_W + LANE_W / 2 - 21;

  const CARS_DN = [
    { e: '🚗', cls: 'md' }, { e: '🚕', cls: 'md' }, { e: '🚙', cls: 'md' },
    { e: '🚌', cls: 'lg' }, { e: '🚓', cls: 'md' }, { e: '🏎', cls: 'sm' },
  ];
  const CARS_UP = [
    { e: '🚐', cls: 'md' }, { e: '🚑', cls: 'md' }, { e: '🚒', cls: 'lg' },
    { e: '🛻', cls: 'md' }, { e: '🚛', cls: 'lg' }, { e: '🏍', cls: 'sm' },
  ];

  function road(body, stage) {
    const { t, esc } = C;
    let st = C.roadState, busy = false;

    body.innerHTML = `
      <div id="rscene"></div>
      <div class="road-info" id="rinfo"></div>
      <div id="rctl"></div>
      <div class="msg" id="rmsg"></div>`;

    let bet = null;

    function buildScene() {
      let lanes = '';
      for (let i = 1; i <= st.maxSteps; i++) {
        const dir = i % 2 ? 'dn' : 'up';
        const carCount = 1 + (i % 3 === 0 ? 2 : i % 2);
        let cs = '';
        const pool = dir === 'dn' ? CARS_DN : CARS_UP;
        for (let k = 0; k < carCount; k++) {
          const car = pool[(i * 3 + k) % pool.length];
          const dur = (2.2 + ((i * 7 + k * 4) % 7) * 0.4).toFixed(2);
          const delay = (-((i * 11 + k * 19) % 10) * 0.35).toFixed(2);
          cs += `<span class="car ${car.cls} ${dir}" style="animation-duration:${dur}s;animation-delay:${delay}s">${car.e}</span>`;
        }
        lanes += `<div class="lane" id="ln${i}">
          <span class="badge">×${st.ladder[i - 1]}</span>${cs}
        </div>`;
      }
      $('rscene').innerHTML = `
        <div class="road-scene-wrap">
          <div class="road-sky"></div>
          <div class="road-scroll" id="rsc">
            <div class="road-track">
              <div class="curb">🏠</div>
              ${lanes}
              <div class="road-end">🏁</div>
              <span class="hero" id="hero">🐔</span>
            </div>
          </div>
        </div>`;
      placeHero(st.active ? st.step : 0, false);
      updateLaneStates();
    }

    function placeHero(step, hop = true) {
      const h = $('hero');
      if (!h) return;
      const lx = heroLeft(step);
      h.style.setProperty('--tx', `translateX(${lx}px)`);
      h.style.transform = `translateX(${lx}px)`;
      if (hop) {
        h.classList.remove('hop', 'run');
        void h.offsetWidth;
        h.classList.add('hop');
        sfx.hop();
        setTimeout(() => { if (h) { h.classList.remove('hop'); h.classList.add('run'); } }, 420);
        setTimeout(() => { if (h) h.classList.remove('run'); }, 800);
      }
      const sc = $('rsc');
      if (sc) sc.scrollLeft = Math.max(0, lx - 120);
    }

    function updateLaneStates() {
      for (let i = 1; i <= st.maxSteps; i++) {
        const el = $('ln' + i); if (!el) continue;
        el.classList.toggle('done', st.active && i <= st.step);
        el.classList.toggle('cur',  st.active && i === st.step + 1);
      }
    }

    function controls() {
      const ctl = $('rctl'), info = $('rinfo');
      if (!st.active) {
        info.innerHTML = `<span>${esc(t('balance'))}: <span class="highlight">${C.fmt(st.balance)}</span></span><span></span>`;
        ctl.innerHTML = `<div id="rbet"></div><button class="bigbtn green" id="rstart">${esc(t('start'))}</button>`;
        bet = betBar($('rbet'));
        $('rstart').onclick = async () => {
          if (busy) return; busy = true;
          try {
            st = await C.api('/games/road/start', { bet: bet.get() });
            C.setBalance(st.balance); say($('rmsg'), ''); buildScene(); controls();
          } catch (e) { C.fail(e); }
          busy = false;
        };
        return;
      }
      const cashAmt = st.step >= 1 ? C.fmt(Math.floor(st.bet * st.mult)) : '';
      info.innerHTML = `
        <span>${esc(t('bet'))}: <span class="highlight">${C.fmt(st.bet)}</span></span>
        <span>${esc(t('lane'))} <span class="highlight">${st.step}/${st.maxSteps}</span></span>
        <span>${esc(t('next_win'))}: <span class="highlight">×${st.next}</span></span>`;
      ctl.innerHTML = `
        <div class="road-actions">
          <button class="bigbtn green" id="rgo2">🐔 ${esc(t('go'))}</button>
          <button class="bigbtn" id="rco" ${st.step < 1 ? 'disabled' : ''}>
            ${esc(t('cashout'))}${cashAmt ? ' +' + cashAmt : ''}
          </button>
        </div>`;
      $('rgo2').onclick = stepFn;
      $('rco').onclick = cashout;
    }

    function lock(x) {
      ['rgo2', 'rco'].forEach((id) => {
        const b = $(id); if (b) b.disabled = x || (id === 'rco' && st.step < 1);
      });
    }

    async function stepFn() {
      if (busy) return; busy = true; lock(true);
      try {
        const r = await C.api('/games/road/step', {});
        if (r.crashed) {
          placeHero(r.step);
          await sleep(480);
          const lane = $('ln' + r.step);
          if (lane) {
            const car = document.createElement('span');
            car.className = 'crashcar'; car.textContent = '🚚';
            car.style.left = '6px'; lane.appendChild(car);
            void car.offsetHeight; car.style.top = '140px';
            await sleep(320); sfx.crash();
            const h = $('hero');
            if (h) { h.classList.remove('hop', 'run'); h.textContent = '💥'; h.classList.add('dead'); }
            await sleep(900);
          }
          say($('rmsg'), `💥 ${esc(t('crashed'))}`, 'lose'); sfx.lose(); C.setBalance(r.balance);
          await sleep(1200);
          st = { active: false, balance: r.balance, ladder: st.ladder, maxSteps: st.maxSteps };
          buildScene(); controls();
        } else if (r.finished) {
          placeHero(st.maxSteps); await sleep(500); C.setBalance(r.balance);
          say($('rmsg'), `🏆 ${esc(t('big_win'))} +${C.fmt(r.payout)}`, 'win'); sfx.win(); coinRain(stage);
          st = { active: false, balance: r.balance, ladder: st.ladder, maxSteps: st.maxSteps };
          await sleep(1500); controls();
        } else {
          st = r; placeHero(st.step); updateLaneStates(); controls();
        }
      } catch (e) { C.fail(e); lock(false); }
      busy = false;
    }

    async function cashout() {
      if (busy) return; busy = true; lock(true);
      try {
        const r = await C.api('/games/road/cashout', {});
        C.setBalance(r.balance);
        say($('rmsg'), `${esc(t('win'))}: +${C.fmt(r.payout)} 🎉`, 'win'); sfx.win(); coinRain(stage);
        st = { active: false, balance: r.balance, ladder: st.ladder, maxSteps: st.maxSteps };
        await sleep(400); controls();
      } catch (e) { C.fail(e); lock(false); }
      busy = false;
    }

    buildScene(); controls();
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
      g.fillText('ፍ', cx, cy);

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

  return { mount };
})();
