'use strict';

(() => {
  const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
  const isLocalHost = localHosts.has(location.hostname.replace(/^\[|\]$/g, ''));
  const query = new URLSearchParams(location.search);
  const mockEnabled = Boolean(window.SLOT_RUNTIME?.mockAllowed && isLocalHost && query.get('mock') === '1');

  async function request(path, body) {
    if (mockEnabled) {
      if (path === '/state') return window.SLOT_MOCK.getState(localStorage.getItem('lang'));
      if (path === '/paytable') return window.SLOT_MOCK.paytable();
      if (path === '/spin') return window.SLOT_MOCK.spin(body);
    }
    let response;
    try {
      response = await fetch(`/api/games/slot${path}`, {
        method: body ? 'POST' : 'GET',
        credentials: 'same-origin',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (_) {
      throw Object.assign(new Error('UNAVAILABLE'), { code: 'UNAVAILABLE', retryable: true });
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code = data.error || 'UNAVAILABLE';
      throw Object.assign(new Error(code), { code, status: response.status,
        retryable: response.status >= 500 || response.status === 429 || (response.status === 409 && code === 'SPIN_IN_PROGRESS') });
    }
    return data;
  }
  window.SLOT_NET = Object.freeze({ state: () => request('/state'), spin: (body) => request('/spin', body), paytable: () => request('/paytable'), mockEnabled });
})();
