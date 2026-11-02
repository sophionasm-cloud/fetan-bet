'use strict';

function createHealthHandler({ query, logger = console }) {
  if (typeof query !== 'function') throw new TypeError('Health check requires a query function.');

  return async function healthHandler(_req, res) {
    try {
      await query('SELECT 1');
      return res.json({ ok: true, status: 'healthy', database: 'connected' });
    } catch (error) {
      const rawCode = typeof error?.code === 'string' ? error.code : '';
      const code = /^[0-9A-Z]{5}$/.test(rawCode) ? rawCode : 'UNKNOWN';
      // Do not log database messages, hostnames, usernames, or connection details.
      logger.error('[health] database check failed', { code });
      return res.status(503).json({ ok: false, status: 'unhealthy' });
    }
  };
}

module.exports = { createHealthHandler };
