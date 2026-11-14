'use strict';

// Rocket Crash SSE hub. Snapshots are always rebuilt from the database; this
// module never replays a private event stream. A 250 ms poll supplies drift
// ticks and detects phase changes even on a process that does not hold the
// engine advisory lock.
const C = require('./crash-config');
const M = require('./crash-math');

function createCrashHub({ repo, stateFor, clock = () => Date.now(), log = console } = {}) {
  if (!repo || typeof stateFor !== 'function') throw new TypeError('crash hub requires repo and stateFor');
  const clients = new Set(); // { res, userId }
  let tickTimer = null;
  let heartbeatTimer = null;
  let lastDisplayKey = null;
  let lastPollAt = 0;
  let lastFullAt = Date.now();

  function writeEvent(res, event, data) {
    if (res.writableEnded || res.destroyed) return false;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      return true;
    } catch (err) {
      log.warn('[crash] SSE write failed:', err.message);
      return false;
    }
  }

  function broadcast(event, data) {
    for (const client of clients) {
      if (!writeEvent(client.res, event, data)) drop(client);
    }
  }

  function broadcastComment(text = 'hb') {
    for (const client of clients) {
      if (client.res.writableEnded || client.res.destroyed) {
        drop(client);
        continue;
      }
      try {
        client.res.write(`: ${text}\n\n`);
      } catch (_) {
        drop(client);
      }
    }
  }

  function drop(client) {
    clients.delete(client);
  }

  async function sendSnapshot(client) {
    const snapshot = await stateFor(client.userId);
    if (snapshot.round) {
      lastDisplayKey = `${snapshot.round.id}:${snapshot.round.phase}`;
    } else {
      lastDisplayKey = 'none';
    }
    writeEvent(client.res, 'snapshot', snapshot);
  }

  async function broadcastSnapshots() {
    const current = [...clients];
    await Promise.all(current.map((client) => sendSnapshot(client).catch((err) => {
      log.warn('[crash] snapshot failed:', err.message);
    })));
  }

  async function broadcastHistory() {
    try {
      const history = await repo.getHistory(C.STATE_HISTORY_LIMIT);
      broadcast('history', { history });
    } catch (err) {
      log.warn('[crash] history broadcast failed:', err.message);
    }
  }

  function handleStream(req, res, userId) {
    let mine = 0;
    for (const client of clients) if (client.userId === userId) mine++;
    if (clients.size >= C.SSE_GLOBAL_MAX || mine >= C.SSE_MAX_PER_USER) {
      res.status(429).json({ error: 'RATE' });
      return;
    }
    res.status(200);
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.flushHeaders?.();
    if (res.socket) res.socket.setNoDelay?.(true);
    res.write('retry: 1000\n\n');

    const client = { res, userId };
    clients.add(client);
    const cleanup = () => drop(client);
    req.on('close', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);
    sendSnapshot(client).catch((err) => {
      log.warn('[crash] initial snapshot failed:', err.message);
      drop(client);
      if (!res.writableEnded) res.end();
    });
  }

  async function poll() {
    if (!clients.size) return;
    const now = clock();
    if (now - lastPollAt < C.TICK_MS) return;
    lastPollAt = now;
    const rounds = await repo.getRecentRounds(3);
    const { display } = M.selectDisplayRounds(rounds);
    const key = display ? `${display.id}:${display.status}` : 'none';
    if (key !== lastDisplayKey) {
      lastDisplayKey = key;
      await broadcastSnapshots();
      broadcast('phase', { round: M.publicRound(display) });
      if (display?.status === 'crashed') await broadcastHistory();
    }
    if (display?.status === 'flying' && display.startedAt != null) {
      const raw = M.multiplierHundredthsAt(now - display.startedAt, display.growthKMicro);
      const multiplierHundredths = Math.max(100, Math.min(raw, display.crashHundredths - 1));
      broadcast('tick', { serverTime: now, multiplierHundredths });
    }
    if (now - lastFullAt >= 15000) {
      lastFullAt = now;
      await broadcastSnapshots();
    }
  }

  function start() {
    if (tickTimer) return;
    lastFullAt = Date.now();
    tickTimer = setInterval(() => {
      poll().catch((err) => log.warn('[crash] SSE poll failed:', err.message));
    }, C.TICK_MS);
    heartbeatTimer = setInterval(() => broadcastComment(), C.SSE_HEARTBEAT_MS);
    tickTimer.unref?.();
    heartbeatTimer.unref?.();
  }

  function stop() {
    if (tickTimer) clearInterval(tickTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    tickTimer = null;
    heartbeatTimer = null;
    for (const client of clients) {
      try {
        client.res.end();
      } catch (_) { /* already closed */ }
    }
    clients.clear();
  }

  return {
    handleStream,
    broadcast,
    broadcastComment,
    broadcastSnapshots,
    broadcastHistory,
    start,
    stop,
    size: () => clients.size
  };
}

module.exports = { createCrashHub };
