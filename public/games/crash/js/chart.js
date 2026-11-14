// Rocket Crash canvas. Presentation only: every value here is derived from
// server timestamps and the shared multiplier formula. Particles are seeded
// locally so the module never needs a random-number generator.
'use strict';
window.CrashChart = (function () {
  const CFG = window.CrashConfig;
  const CURVE = window.CrashCurve;
  const FMT = window.CrashFormat;
  const YELLOW = '#f3d21b';
  const ORANGE = '#ff9a1f';
  const RED = '#ff3b30';
  const WHITE = '#f5f5f7';
  const BLUE = '#47a7ff';
  const FONT = 'Inter, "Segoe UI", system-ui, sans-serif';

  let canvas = null;
  let ctx = null;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let raf = null;
  let running = false;
  let reduced = false;
  let resizeObserver = null;
  let lastFrame = 0;
  let lastRoundId = null;
  let lastPhase = null;
  let crashVisual = null;
  let sparks = [];
  let embers = [];
  let emitterCarry = 0;
  let stars = [];
  let yMax = 200;
  let xMax = 5;
  let lastHead = null;
  let coin = null;
  let idleClock = 0;
  let hidden = false;

  const plot = { left: 48, top: 18, right: 16, bottom: 28, width: 100, height: 100 };

  function prng(seed) {
    let a = (Number(seed) || 1) >>> 0;
    return function next() {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
  }

  function resize() {
    if (!canvas) return;
    const host = canvas.parentElement || canvas;
    const rect = host.getBoundingClientRect();
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    dpr = Math.min(window.devicePixelRatio || 1, width < 700 ? CFG.lowDprCap : CFG.dprCap);
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    plot.left = width < 480 ? 40 : 52;
    plot.right = width < 480 ? 10 : 16;
    plot.top = 16;
    plot.bottom = 26;
    plot.width = Math.max(10, width - plot.left - plot.right);
    plot.height = Math.max(10, height - plot.top - plot.bottom);
    seedStars();
  }

  function seedStars() {
    const rand = prng(width * 131 + height * 17 + 907);
    const count = width < 600 ? 44 : 78;
    stars = [];
    for (let i = 0; i < count; i++) {
      stars.push({
        x: rand() * width,
        y: rand() * height * 0.86,
        r: 0.4 + rand() * 1.2,
        a: 0.12 + rand() * 0.4,
        phase: rand() * Math.PI * 2,
        speed: 0.4 + rand() * 1.2
      });
    }
  }

  function resetRound(round) {
    yMax = 200;
    xMax = 5;
    lastHead = null;
    crashVisual = null;
    sparks = [];
    embers = [];
    emitterCarry = 0;
    coin = prng((round && round.id ? round.id : 1) * 2654435761);
  }

  function start() {
    if (running) return;
    running = true;
    lastFrame = 0;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  }

  function onVisibility() {
    hidden = document.hidden;
    if (hidden) stop();
    else start();
  }

  function init(element) {
    canvas = element;
    ctx = canvas.getContext('2d', { alpha: true });
    resize();
    if (window.ResizeObserver) {
      resizeObserver = new ResizeObserver(() => resize());
      resizeObserver.observe(canvas.parentElement || canvas);
    }
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);
    start();
  }

  function setReduced(value) {
    reduced = Boolean(value);
    if (reduced) {
      sparks = sparks.slice(0, CFG.lowCrashParticles);
      embers = [];
    }
  }

  function px(timeMs) {
    return plot.left + (timeMs / 1000 / xMax) * plot.width;
  }

  function py(mult) {
    return clamp(
      plot.top + plot.height - ((mult - 100) / Math.max(1, yMax - 100)) * plot.height,
      plot.top,
      plot.top + plot.height
    );
  }

  function drawStars(ts) {
    if (!ctx) return;
    for (const star of stars) {
      const twinkle = reduced ? 0.75 : 0.62 + 0.38 * Math.sin(ts / 950 * star.speed + star.phase);
      ctx.globalAlpha = star.a * twinkle;
      ctx.fillStyle = '#dfe6ff';
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawGrid() {
    const ticks = CURVE.yTicks(yMax);
    ctx.font = `11px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,.055)';
    ctx.fillStyle = 'rgba(255,255,255,.30)';
    for (const tick of ticks) {
      const y = py(tick);
      ctx.beginPath();
      ctx.moveTo(plot.left, y);
      ctx.lineTo(plot.left + plot.width, y);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(FMT.formatAxisMultiplier(tick), plot.left - 7, y);
    }
    const xTicks = CURVE.xTicks(xMax);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const t of xTicks) {
      const x = px(t * 1000);
      if (x < plot.left - 1 || x > plot.left + plot.width + 1) continue;
      ctx.beginPath();
      ctx.moveTo(x, plot.top);
      ctx.lineTo(x, plot.top + plot.height);
      ctx.stroke();
      const labelX = clamp(x, plot.left + 10, plot.left + plot.width - 10);
      ctx.fillText(`${Math.round(t)}s`, labelX, plot.top + plot.height + 8);
    }
    ctx.strokeStyle = 'rgba(255,255,255,.12)';
    ctx.beginPath();
    ctx.moveTo(plot.left, plot.top);
    ctx.lineTo(plot.left, plot.top + plot.height);
    ctx.lineTo(plot.left + plot.width, plot.top + plot.height);
    ctx.stroke();
  }

  function buildPoints(round, phase, elapsed) {
    const growthK = (window.CrashStore.state.config || CFG).growthK;
    const crash = Number(round.crashHundredths) || 100;
    const cap = phase === 'flying' ? Math.max(100, crash - 1) : crash;
    const total = Math.max(0, elapsed);
    const steps = Math.max(10, Math.min(CFG.maxCurvePoints, Math.ceil(total / 40)));
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const t = (total * i) / steps;
      pts.push({ t, m: Math.min(cap, CURVE.multiplierAt(t, growthK)) });
    }
    if (phase === 'crashed') pts[pts.length - 1] = { t: total, m: crash };
    return pts;
  }

  function drawCurve(points) {
    if (!points.length) return;
    const first = points[0];
    const head = points[points.length - 1];
    const fill = ctx.createLinearGradient(0, plot.top, 0, plot.top + plot.height);
    fill.addColorStop(0, 'rgba(243,210,27,.20)');
    fill.addColorStop(0.55, 'rgba(243,210,27,.07)');
    fill.addColorStop(1, 'rgba(243,210,27,0)');

    ctx.beginPath();
    ctx.moveTo(px(first.t), py(first.m));
    for (const point of points) ctx.lineTo(px(point.t), py(point.m));
    ctx.lineTo(px(head.t), plot.top + plot.height);
    ctx.lineTo(px(first.t), plot.top + plot.height);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(px(first.t), py(first.m));
    for (const point of points) ctx.lineTo(px(point.t), py(point.m));
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = YELLOW;
    if (!reduced) {
      ctx.shadowColor = 'rgba(243,210,27,.55)';
      ctx.shadowBlur = 14;
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
  }

  function rocketPath(scale) {
    ctx.scale(scale, scale);
    // Flame first so the body overlaps it.
    const flicker = reduced ? 0 : (coin() - 0.5) * 6;
    const flame = ctx.createLinearGradient(-34, 0, -14, 0);
    flame.addColorStop(0, 'rgba(255,59,48,0)');
    flame.addColorStop(0.45, 'rgba(255,59,48,.72)');
    flame.addColorStop(1, 'rgba(255,205,80,.95)');
    ctx.beginPath();
    ctx.moveTo(-15, -4);
    ctx.quadraticCurveTo(-27, -6 + flicker, -35, flicker * 0.4);
    ctx.quadraticCurveTo(-27, 7 + flicker, -15, 4);
    ctx.closePath();
    ctx.fillStyle = flame;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(-11, -4);
    ctx.lineTo(-21, -13);
    ctx.lineTo(-19, 0);
    ctx.lineTo(-21, 13);
    ctx.lineTo(-11, 4);
    ctx.closePath();
    ctx.fillStyle = ORANGE;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(18, 0);
    ctx.bezierCurveTo(10, -7, -9, -6, -14, -3);
    ctx.lineTo(-14, 3);
    ctx.bezierCurveTo(-9, 6, 10, 7, 18, 0);
    ctx.closePath();
    ctx.fillStyle = WHITE;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(-13, -2.5);
    ctx.lineTo(-6, -2.5);
    ctx.lineTo(-6, 2.5);
    ctx.lineTo(-13, 2.5);
    ctx.closePath();
    ctx.fillStyle = 'rgba(243,210,27,.9)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(3, 0, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = BLUE;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.7)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawRocket(x, y, angle, scale, alpha) {
    if (!ctx || alpha <= 0) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.globalAlpha = clamp(alpha, 0, 1);
    if (!reduced) {
      ctx.shadowColor = 'rgba(243,210,27,.5)';
      ctx.shadowBlur = 12;
    }
    rocketPath(scale);
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  function emitEmbers(x, y, angle, dt) {
    if (reduced) return;
    const rate = width < 600 ? CFG.lowEmbers : CFG.embersPerSecond;
    emitterCarry += (rate * dt) / 1000;
    while (emitterCarry >= 1) {
      emitterCarry -= 1;
      if (embers.length >= CFG.maxEmbers) break;
      const spread = (coin() - 0.5) * 0.9;
      const speed = 18 + coin() * 42;
      embers.push({
        x: x - Math.cos(angle) * 10,
        y: y - Math.sin(angle) * 10,
        vx: -Math.cos(angle + spread) * speed,
        vy: -Math.sin(angle + spread) * speed,
        life: 0.45 + coin() * 0.65,
        age: 0,
        size: 1 + coin() * 2.2,
        hot: coin() > 0.45
      });
    }
  }

  function updateEmbers(dt) {
    for (const ember of embers) {
      ember.age += dt;
      ember.x += ember.vx * dt;
      ember.y += ember.vy * dt;
      ember.vy += 22 * dt;
      ember.vx *= 0.985;
    }
    embers = embers.filter((ember) => ember.age < ember.life);
  }

  function drawEmbers() {
    for (const ember of embers) {
      const remaining = 1 - ember.age / ember.life;
      ctx.globalAlpha = remaining * 0.8;
      ctx.fillStyle = ember.hot ? YELLOW : ORANGE;
      ctx.beginPath();
      ctx.arc(ember.x, ember.y, ember.size * remaining, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function makeSparks(x, y) {
    const rand = prng((lastRoundId || 1) * 7919 + 13);
    const total = reduced ? CFG.lowCrashParticles : CFG.crashParticles;
    const list = [];
    for (let i = 0; i < total; i++) {
      const angle = rand() * Math.PI * 2;
      const speed = 50 + rand() * 260;
      list.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 30,
        life: 0.45 + rand() * 0.9,
        age: 0,
        size: 1 + rand() * 2.8,
        color: rand() > 0.56 ? RED : rand() > 0.45 ? ORANGE : YELLOW
      });
    }
    return list;
  }

  function updateSparks(dt) {
    for (const spark of sparks) {
      spark.age += dt;
      spark.x += spark.vx * dt;
      spark.y += spark.vy * dt;
      spark.vy += 330 * dt;
      spark.vx *= 0.988;
    }
    sparks = sparks.filter((spark) => spark.age < spark.life);
  }

  function drawSparks() {
    for (const spark of sparks) {
      const remain = 1 - spark.age / spark.life;
      ctx.globalAlpha = Math.max(0, remain);
      ctx.fillStyle = spark.color;
      ctx.beginPath();
      ctx.arc(spark.x, spark.y, spark.size * remain, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawExplosion(ts) {
    if (!crashVisual) return;
    const age = (ts - crashVisual.at) / 1000;
    if (age < 0 || age > 1.5) return;
    const progress = Math.min(1, age / 0.55);
    ctx.globalAlpha = (1 - progress) * 0.8;
    ctx.strokeStyle = RED;
    ctx.lineWidth = 2 + (1 - progress) * 4;
    ctx.beginPath();
    ctx.arc(crashVisual.x, crashVisual.y, 14 + progress * 78, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawIdle(ts) {
    const bob = Math.sin(ts / 900) * 5;
    const x = plot.left + plot.width * 0.14;
    const y = plot.top + plot.height * (width < 600 ? 0.52 : 0.6) + bob;
    ctx.globalAlpha = 0.5;
    drawRocket(x, y, -0.28, width < 600 ? 0.62 : 0.8, 0.55);
    ctx.globalAlpha = 1;
  }

  function render(ts, dt) {
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    const state = window.CrashStore.state;
    const round = state.round;
    drawStars(ts);
    if (!round) {
      drawGrid();
      return;
    }
    if (round.id !== lastRoundId) {
      lastRoundId = round.id;
      resetRound(round);
      lastPhase = null;
    }
    const phase = state.phase;
    if (phase && phase !== lastPhase) {
      if (phase === 'flying' || phase === 'betting') {
        yMax = 200;
        xMax = 5;
        crashVisual = null;
        sparks = [];
        embers = [];
      }
      lastPhase = phase;
    }

    const growthK = state.config ? state.config.growthK : CFG.growthK;
    let elapsed = 0;
    if (phase === 'flying' && round.startedAt) {
      elapsed = Math.max(0, state.now() - round.startedAt);
    } else if (phase === 'crashed') {
      elapsed = CURVE.crashDurationMs(round.crashHundredths, growthK);
    }
    const crashDuration = phase === 'crashed'
      ? elapsed
      : CURVE.crashDurationMs(round.crashHundredths, growthK);
    if (phase === 'flying' && elapsed > crashDuration) elapsed = crashDuration;

    const points = buildPoints(round, phase, elapsed);
    const head = points[points.length - 1] || { t: 0, m: 100 };
    const targetY = Math.max(200, Math.ceil((head.m * (phase === 'betting' ? 2 : 1.28)) / 100) * 100);
    yMax = Math.max(yMax, 200);
    yMax += (targetY - yMax) * 0.12;
    if (yMax < head.m + 20) yMax = head.m + 20;
    const seconds = elapsed / 1000;
    const targetX = Math.max(5, seconds * 1.2);
    xMax += (targetX - xMax) * 0.1;
    if (xMax < seconds + 1) xMax = seconds + 1;

    drawGrid();

    if (phase === 'betting') {
      drawIdle(ts);
      return;
    }

    drawCurve(points);

    const last = points[points.length - 1];
    const prev = points[Math.max(0, points.length - 3)] || last;
    const dx = px(last.t) - px(prev.t);
    const dy = py(last.m) - py(prev.m);
    let angle = dx > 0.1 ? Math.atan2(dy, dx) : -0.2;
    angle = clamp(angle, -1.15, -0.02);
    const headX = px(last.t);
    const headY = py(last.m);
    lastHead = { x: headX, y: headY, angle };

    if (phase === 'flying') {
      emitEmbers(headX, headY, angle, dt);
      updateEmbers(dt);
      drawEmbers();
      drawRocket(headX, headY, angle, width < 600 ? 0.62 : 0.82, 1);
    } else if (phase === 'crashed') {
      if (!crashVisual) {
        const crashAt = Number(round.crashedAt) || state.now();
        const recent = Math.abs(state.now() - crashAt) < 12000;
        crashVisual = {
          x: headX,
          y: headY,
          at: recent ? ts - Math.max(0, state.now() - crashAt) : ts - 2000
        };
        sparks = makeSparks(headX, headY);
      }
      updateSparks(dt);
      drawExplosion(ts);
      drawSparks();
      const age = (ts - crashVisual.at) / 1000;
      if (age < 0.95) {
        const drift = Math.min(1, age / 0.95);
        drawRocket(
          headX + drift * 58,
          headY - drift * (70 + 50 * drift),
          -0.9,
          width < 600 ? 0.55 : 0.74,
          1 - drift
        );
      }
    }
  }

  function frame(ts) {
    if (!running) return;
    const dt = lastFrame ? Math.min(50, ts - lastFrame) : 16;
    lastFrame = ts;
    render(ts, dt);
    raf = requestAnimationFrame(frame);
  }

  function destroy() {
    stop();
    if (resizeObserver) resizeObserver.disconnect();
    resizeObserver = null;
    window.removeEventListener('resize', resize);
    document.removeEventListener('visibilitychange', onVisibility);
    canvas = null;
    ctx = null;
  }

  return {
    init,
    setReduced,
    destroy,
    isReduced: () => reduced,
    _render: render
  };
})();
