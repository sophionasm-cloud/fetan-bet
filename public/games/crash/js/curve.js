// Pure chart math. Dual browser/CommonJS module so the static Node tests can
// require it without a bundler.
'use strict';
(function (root) {
  const DEFAULT_K = 0.087;
  const MAX_HUNDREDTHS = 100000;
  const MAX_WIN_SANTIM = 1000000;

  function multiplierAt(elapsedMs, growthK = DEFAULT_K) {
    if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 100;
    const value = 100 * Math.exp(Number(growthK) * (elapsedMs / 1000));
    if (!Number.isFinite(value) || value >= MAX_HUNDREDTHS) return MAX_HUNDREDTHS;
    return Math.floor(value);
  }

  function crashDurationMs(crashHundredths, growthK = DEFAULT_K) {
    const crash = Math.trunc(Number(crashHundredths) || 100);
    if (crash <= 100) return 0;
    const seconds = Math.log(crash / 100) / Number(growthK);
    return Math.max(0, Math.round(seconds * 1000));
  }

  function yAxisTarget(multiplierHundredths) {
    return Math.max(200, Math.ceil(Number(multiplierHundredths || 100) * 1.25 / 100) * 100);
  }

  function xAxisTarget(elapsedMs) {
    const seconds = Math.max(0, Number(elapsedMs) || 0) / 1000;
    return Math.max(5, seconds * 1.15);
  }

  // Axis smoothing: current + (target-current)*rate, never below the current
  // value while the round is running. A caller resets axes explicitly.
  function smoothAxis(current, target, rate = 0.08, lockGrowth = true) {
    const c = Number(current);
    const t = Number(target);
    if (!Number.isFinite(c)) return t;
    if (!Number.isFinite(t)) return c;
    const next = c + (t - c) * Math.max(0, Math.min(1, rate));
    if (lockGrowth) return Math.max(c, next);
    return next;
  }

  function yTicks(maxHundredths) {
    const max = Math.max(200, Math.trunc(Number(maxHundredths) || 200));
    const step = (max - 100) / 4;
    const ticks = [];
    for (let i = 0; i < 5; i++) {
      const value = Math.round(100 + step * i);
      if (!ticks.includes(value)) ticks.push(value);
    }
    return ticks;
  }

  function xTicks(maxSeconds) {
    const max = Math.max(5, Number(maxSeconds) || 5);
    const step = max <= 10 ? 1 : max <= 30 ? 2 : max <= 60 ? 5 : 10;
    const ticks = [];
    for (let t = 0; t <= max + 0.0001; t += step) ticks.push(t);
    return ticks;
  }

  function payoutSantim(stakeSantim, multiplierHundredths, maxWinSantim = MAX_WIN_SANTIM) {
    const stake = Math.trunc(Number(stakeSantim) || 0);
    const m = Math.trunc(Number(multiplierHundredths) || 0);
    if (stake <= 0 || m < 100) return 0;
    const raw = (BigInt(stake) * BigInt(m)) / 100n;
    const cap = BigInt(Math.max(1, Math.trunc(Number(maxWinSantim) || MAX_WIN_SANTIM)));
    return Number(raw > cap ? cap : raw);
  }

  function curvePoint(elapsedMs, multiplierHundredths, xMax, yMax, plot) {
    const x = plot.left + (Math.min(Number(elapsedMs) || 0, xMax * 1000) / 1000 / xMax) * plot.width;
    const y = plot.top + plot.height - ((multiplierHundredths - 100) / (yMax - 100)) * plot.height;
    return { x, y };
  }

  const api = {
    DEFAULT_K,
    MAX_HUNDREDTHS,
    multiplierAt,
    crashDurationMs,
    yAxisTarget,
    xAxisTarget,
    smoothAxis,
    yTicks,
    xTicks,
    payoutSantim,
    curvePoint
  };
  root.CrashCurve = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
