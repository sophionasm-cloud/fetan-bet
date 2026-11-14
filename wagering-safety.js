'use strict';

// Server-side wagering policy.
//
// WAGERING_MODE controls whether wallet-backed (new-stake) game requests are
// accepted. Settlement, continuation, history, verification and Chicken Road
// demo requests are never blocked: those paths can only reduce or preserve
// risk, and an operator must be able to close existing rounds after a stop.
//
// Fail-closed rules:
//   demo       virtual-credit play (default; the platform is a demo)
//   real       allowed only with a documented REAL_MONEY_AUTHORIZATION
//              approval reference, not a boolean/placeholder value
//   disabled   all new stakes blocked
//   anything   all new stakes blocked
const MODES = Object.freeze(['demo', 'real', 'disabled']);
const DEFAULT_MODE = 'demo';
const AUTHORIZATION_MIN_LENGTH = 8;
const PLACEHOLDER_AUTHORIZATIONS = Object.freeze([
  '1', 'true', 'yes', 'on', 'enabled', 'approved', 'authorized', 'demo', 'test',
]);

// POST paths that do not create a new stake. Any other POST under
// /api/games is treated as a new stake so a future route cannot bypass the
// gate by omission.
const NON_STAKE_POST_PATHS = Object.freeze([
  '/road/step',
  '/road/cashout',
  '/road/verify',
  '/penalty/shoot',
  '/penalty/cashout',
  '/chicken-road-dash/demo/start',
  '/chicken-road-dash/demo/cross',
  '/chicken-road-dash/demo/cashout',
  '/chicken-road-dash/demo/reset',
  '/chicken-road-dash/real/cross',
  '/chicken-road-dash/real/cashout',
  '/mines/step',
  '/mines/cashout',
  '/mines/verify',
  // Crash cash-out only settles an existing stake at a server-owned clock,
  // so it must stay available while new stakes are paused.
  '/crash/cashout',
  '/plinko/verify',
  '/bingo/call',
  '/bingo/abandon',
  // B2B Bomber settlement and verification never create a new stake. The bet
  // route remains gated as a normal new-stake request.
  '/b2b-bomber/cashout',
  '/b2b-bomber/verify',
]);

function normalizeMode(value) {
  if (value == null) return DEFAULT_MODE;
  const normalized = String(value).trim().toLowerCase();
  return normalized || DEFAULT_MODE;
}

function isDocumentedAuthorization(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length < AUTHORIZATION_MIN_LENGTH) return false;
  return !PLACEHOLDER_AUTHORIZATIONS.includes(trimmed.toLowerCase());
}

function resolveWageringPolicy(env = process.env) {
  const source = env || {};
  const mode = normalizeMode(source.WAGERING_MODE);
  const authorizationPresent = isDocumentedAuthorization(source.REAL_MONEY_AUTHORIZATION);
  const base = { mode, authorizationPresent };

  if (!MODES.includes(mode)) {
    return Object.freeze({ ...base, stakesAllowed: false, reason: 'WAGERING_MODE_INVALID' });
  }
  if (mode === 'disabled') {
    return Object.freeze({ ...base, stakesAllowed: false, reason: 'WAGERING_DISABLED' });
  }
  if (mode === 'real' && !authorizationPresent) {
    return Object.freeze({ ...base, stakesAllowed: false, reason: 'REAL_MONEY_AUTHORIZATION_REQUIRED' });
  }
  return Object.freeze({ ...base, stakesAllowed: true, reason: null });
}

function relativeGamePath(pathname) {
  let result = String(pathname || '').split('?')[0];
  if (result === '/api/games') result = '/';
  else if (result.startsWith('/api/games/')) result = result.slice('/api/games'.length);
  if (!result.startsWith('/')) result = '/' + result;
  result = result.replace(/\/+$/, '');
  return result || '/';
}

function isNewStakeRequest(method, pathname) {
  if (String(method || '').toUpperCase() !== 'POST') return false;
  return !NON_STAKE_POST_PATHS.includes(relativeGamePath(pathname));
}

function createWageringGuard(policy) {
  if (!policy || typeof policy.stakesAllowed !== 'boolean') {
    throw new TypeError('A resolved wagering policy is required.');
  }
  return function wageringGuard(req, res, next) {
    if (policy.stakesAllowed || !isNewStakeRequest(req.method, req.path)) return next();
    return res.status(403).json({ error: 'WAGERING_DISABLED' });
  };
}

module.exports = {
  MODES,
  DEFAULT_MODE,
  AUTHORIZATION_MIN_LENGTH,
  NON_STAKE_POST_PATHS,
  normalizeMode,
  isDocumentedAuthorization,
  resolveWageringPolicy,
  relativeGamePath,
  isNewStakeRequest,
  createWageringGuard,
};
