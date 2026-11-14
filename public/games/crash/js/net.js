// Rocket Crash transport. One SSE stream carries every public event; a slow
// snapshot poll only takes over after repeated stream failures. The mock
// adapter is selected by js/mock.js and never touches wallet endpoints.
'use strict';
window.CrashNet = (function () {
  const C = window.CrashConfig;
  const listeners = { event: () => {}, status: () => {} };
  const isMock = window.CrashMock && window.CrashMock.enabled();
  let source = null;
  let pollTimer = null;
  let reconnectTimer = null;
  let pollInFlight = false;
  let failures = 0;
  let backoffIndex = 0;
  let stopped = false;
  let mockStop = null;
  let status = 'connecting';

  function setStatus(next) {
    if (status === next) return;
    status = next;
    listeners.status(next);
  }

  function dispatch(event, data) {
    try {
      listeners.event(event, data);
    } catch (err) {
      console.error('[crash] event handler failed', event, err);
    }
  }

  async function request(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(path, Object.assign({
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal
      }, options, {
        headers: Object.assign({ 'Content-Type': 'application/json' }, options.headers || {})
      }));
      let body = null;
      try { body = await response.json(); } catch (_) { body = null; }
      if (!response.ok) {
        const code = body && body.error ? String(body.error) : response.status === 401 ? 'SESSION' : 'SERVER';
        const error = new Error(code);
        error.status = response.status;
        throw error;
      }
      return body;
    } catch (err) {
      if (err.name === 'AbortError') {
        const timeout = new Error('TIMEOUT');
        timeout.status = 0;
        throw timeout;
      }
      if (err instanceof TypeError) {
        const offline = new Error('NETWORK');
        offline.status = 0;
        throw offline;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchState() {
    return request('/api/games/crash/state');
  }

  async function pollOnce() {
    if (pollInFlight || stopped) return;
    pollInFlight = true;
    try {
      const snapshot = await fetchState();
      failures = 0;
      setStatus('online');
      dispatch('snapshot', snapshot);
    } catch (err) {
      setStatus(err.status === 401 ? 'offline' : 'offline');
      if (err.status === 401 || err.message === 'CRASH_DISABLED') {
        dispatch('fatal', err);
        stopPolling();
      }
    } finally {
      pollInFlight = false;
    }
  }

  function startPolling() {
    if (pollTimer || stopped || isMock) return;
    void pollOnce();
    pollTimer = setInterval(() => { void pollOnce(); }, C.pollMs);
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  function closeSource() {
    if (source) {
      try { source.close(); } catch (_) { /* already closed */ }
    }
    source = null;
  }

  function scheduleReconnect() {
    if (stopped || isMock || reconnectTimer) return;
    const delay = C.streamBackoff[Math.min(backoffIndex, C.streamBackoff.length - 1)];
    backoffIndex += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      openStream();
    }, delay);
  }

  function parseEvent(event) {
    try {
      return JSON.parse(event.data);
    } catch (err) {
      console.warn('[crash] malformed stream event', err.message);
      return null;
    }
  }

  function openStream() {
    if (stopped || isMock) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    closeSource();
    setStatus(failures ? 'reconnecting' : 'connecting');
    let stream;
    try {
      stream = new EventSource('/api/games/crash/stream', { withCredentials: true });
    } catch (err) {
      failures += 1;
      startPolling();
      scheduleReconnect();
      return;
    }
    source = stream;

    const onData = (name) => (event) => {
      const data = parseEvent(event);
      if (data == null) return;
      if (name === 'snapshot') {
        failures = 0;
        backoffIndex = 0;
        stopPolling();
        setStatus('online');
      }
      dispatch(name, data);
    };

    for (const name of ['snapshot', 'phase', 'tick', 'bet', 'cashout', 'crash', 'history']) {
      stream.addEventListener(name, onData(name));
    }

    stream.onerror = () => {
      if (stopped) return;
      failures += 1;
      if (failures >= 3) {
        closeSource();
        startPolling();
        scheduleReconnect();
        setStatus('offline');
      } else {
        setStatus('reconnecting');
      }
    };
  }

  function connect(handlers = {}) {
    listeners.event = typeof handlers.event === 'function' ? handlers.event : () => {};
    listeners.status = typeof handlers.status === 'function' ? handlers.status : () => {};
    stopped = false;
    failures = 0;
    backoffIndex = 0;

    if (isMock) {
      setStatus('online');
      window.CrashStore.setMock(true);
      mockStop = window.CrashMock.connect((event, data) => dispatch(event, data));
      return;
    }

    setStatus('connecting');
    openStream();
    // The stream can be blocked by a proxy while the API still works. Probe
    // once so the first paint does not wait for three SSE errors.
    setTimeout(() => {
      if (!stopped && status !== 'online') void pollOnce();
    }, 1500);
  }

  function stop() {
    stopped = true;
    closeSource();
    stopPolling();
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (mockStop) mockStop();
    mockStop = null;
  }

  function placeBet(payload) {
    if (isMock) return window.CrashMock.placeBet(payload.panel, payload.stake, payload.autoCashout, payload.requestId);
    return request('/api/games/crash/bet', {
      method: 'POST',
      body: JSON.stringify({
        panel: payload.panel,
        stake: payload.stake,
        autoCashout: payload.autoCashout,
        requestId: payload.requestId
      })
    });
  }

  function cashout(betId) {
    if (isMock) return window.CrashMock.cashout(betId);
    return request('/api/games/crash/cashout', {
      method: 'POST',
      body: JSON.stringify({ betId })
    });
  }

  function fetchHistory() {
    if (isMock) return window.CrashMock.fetchHistory();
    return request('/api/games/crash/history?limit=50');
  }

  function fetchMyBets() {
    if (isMock) return window.CrashMock.fetchMyBets();
    return request('/api/games/crash/my-bets?limit=50');
  }

  function fetchVerify(roundId) {
    if (isMock) return window.CrashMock.fetchVerify(roundId);
    return request(`/api/games/crash/rounds/${encodeURIComponent(roundId)}/verify`);
  }

  function refresh() {
    if (isMock) return window.CrashMock.refresh();
    return fetchState();
  }

  return {
    isMock: () => Boolean(isMock),
    connect,
    stop,
    refresh,
    placeBet,
    cashout,
    fetchHistory,
    fetchMyBets,
    fetchVerify,
    getStatus: () => status
  };
})();
