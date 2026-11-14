// Pure display helpers shared by the browser and Node tests. Money never
// passes through floating point: santim are split into whole/fraction parts.
'use strict';
(function (root) {
  function santimToEtb(santim) {
    const n = Math.trunc(Number(santim) || 0);
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    const whole = Math.floor(abs / 100).toLocaleString('en-US');
    const frac = String(abs % 100).padStart(2, '0');
    return `${sign}${whole}.${frac}`;
  }

  function formatMoney(santim, currency = 'ETB') {
    return `${santimToEtb(santim)} ${currency}`;
  }

  function parseEtbToSantim(text) {
    const raw = String(text == null ? '' : text).trim().replace(/,/g, '');
    if (!/^\d{1,9}(?:\.\d{0,2})?$/.test(raw)) return null;
    const [whole, fraction = ''] = raw.split('.');
    const santim = Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
    return Number.isSafeInteger(santim) ? santim : null;
  }

  function formatMultiplier(hundredths) {
    const n = Math.trunc(Number(hundredths) || 0);
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}\u00D7`;
  }

  function formatAxisMultiplier(hundredths) {
    const n = Math.max(100, Math.trunc(Number(hundredths) || 100));
    if (n === 100) return '1.00\u00D7';
    return `${Math.floor(n / 100)}.${Math.floor((n % 100) / 10)}\u00D7`;
  }

  function formatMultiplierNumber(hundredths) {
    const n = Math.trunc(Number(hundredths) || 0);
    return `${Math.floor(n / 100)}.${String(Math.abs(n % 100)).padStart(2, '0')}`;
  }

  function shortHash(hash, head = 6, tail = 4) {
    const value = String(hash || '');
    if (value.length <= head + tail + 1) return value;
    return `${value.slice(0, head)}…${value.slice(-tail)}`;
  }

  function formatClock(date = new Date()) {
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  function formatTime(epochMs) {
    if (!Number.isFinite(Number(epochMs))) return '—';
    const d = new Date(Number(epochMs));
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  }

  function formatCountdown(ms) {
    const tenths = Math.max(0, Math.floor((Number(ms) || 0) / 100));
    return `${Math.floor(tenths / 10)}.${tenths % 10}s`;
  }

  const api = {
    santimToEtb,
    formatMoney,
    parseEtbToSantim,
    formatMultiplier,
    formatAxisMultiplier,
    formatMultiplierNumber,
    shortHash,
    formatClock,
    formatTime,
    formatCountdown
  };
  root.CrashFormat = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
