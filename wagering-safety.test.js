'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  MODES,
  NON_STAKE_POST_PATHS,
  isDocumentedAuthorization,
  resolveWageringPolicy,
  relativeGamePath,
  isNewStakeRequest,
  createWageringGuard,
} = require('./wagering-safety');

const read = (file) => fs.readFileSync(path.join(__dirname, file), 'utf8');

// ---------- policy resolution ----------
assert.deepEqual([...MODES], ['demo', 'real', 'disabled']);

const defaultPolicy = resolveWageringPolicy({});
assert.equal(defaultPolicy.mode, 'demo');
assert.equal(defaultPolicy.stakesAllowed, true);
assert.equal(defaultPolicy.reason, null);

assert.equal(resolveWageringPolicy({ WAGERING_MODE: '' }).mode, 'demo');
assert.equal(resolveWageringPolicy({ WAGERING_MODE: '  DEMO  ' }).mode, 'demo');
assert.equal(resolveWageringPolicy({ WAGERING_MODE: 'demo' }).stakesAllowed, true);

const disabled = resolveWageringPolicy({ WAGERING_MODE: 'disabled' });
assert.equal(disabled.mode, 'disabled');
assert.equal(disabled.stakesAllowed, false);
assert.equal(disabled.reason, 'WAGERING_DISABLED');
assert.equal(resolveWageringPolicy({ WAGERING_MODE: 'disabled', REAL_MONEY_AUTHORIZATION: 'ET-GCB-2026-0042' }).stakesAllowed, false);

const realWithoutAuthorization = resolveWageringPolicy({ WAGERING_MODE: 'real' });
assert.equal(realWithoutAuthorization.stakesAllowed, false);
assert.equal(realWithoutAuthorization.reason, 'REAL_MONEY_AUTHORIZATION_REQUIRED');

for (const placeholder of ['1', 'true', 'TRUE', 'yes', 'on', 'enabled', 'approved', 'authorized', 'demo', 'test', ' short ']) {
  const policy = resolveWageringPolicy({ WAGERING_MODE: 'real', REAL_MONEY_AUTHORIZATION: placeholder });
  assert.equal(policy.stakesAllowed, false, `placeholder authorization rejected: ${placeholder}`);
  assert.equal(policy.reason, 'REAL_MONEY_AUTHORIZATION_REQUIRED');
}
assert.equal(isDocumentedAuthorization(12345678), false);
assert.equal(isDocumentedAuthorization(null), false);

for (const reference of ['ET-GCB-2026-0042', 'licence/2026/0007', 'APPROVAL-REF-9']) {
  assert.equal(isDocumentedAuthorization(reference), true, `authorization accepted: ${reference}`);
  const policy = resolveWageringPolicy({ WAGERING_MODE: 'real', REAL_MONEY_AUTHORIZATION: reference });
  assert.equal(policy.mode, 'real');
  assert.equal(policy.authorizationPresent, true);
  assert.equal(policy.stakesAllowed, true);
  assert.equal(policy.reason, null);
}

for (const mode of ['live', 'real-money', 'off', 'enabled']) {
  const policy = resolveWageringPolicy({ WAGERING_MODE: mode });
  assert.equal(policy.stakesAllowed, false, `unknown mode fails closed: ${mode}`);
  assert.equal(policy.reason, 'WAGERING_MODE_INVALID');
}

assert.ok(Object.isFrozen(resolveWageringPolicy({})));
assert.ok(Object.isFrozen(NON_STAKE_POST_PATHS));

// ---------- new-stake classification ----------
const stakePosts = [
  '/api/games/roulette',
  '/api/games/star',
  '/api/games/road/start',
  '/api/games/penalty/start',
  '/api/games/chicken-road-dash/real/start',
  '/api/games/mines/start',
  '/api/games/plinko',
  '/api/games/keno',
  '/api/games/bingo/start',
];
for (const route of stakePosts) {
  assert.equal(isNewStakeRequest('POST', route), true, `stake route gated: ${route}`);
  assert.equal(isNewStakeRequest('post', route), true, `method is case-insensitive: ${route}`);
  assert.equal(isNewStakeRequest('POST', route + '?x=1'), true, `query string ignored: ${route}`);
  assert.equal(isNewStakeRequest('POST', route + '/'), true, `trailing slash ignored: ${route}`);
  assert.equal(isNewStakeRequest('GET', route), false, `reads are never stakes: ${route}`);
}

const nonStakePosts = [
  '/api/games/road/step',
  '/api/games/road/cashout',
  '/api/games/road/verify',
  '/api/games/penalty/shoot',
  '/api/games/penalty/cashout',
  '/api/games/chicken-road-dash/demo/start',
  '/api/games/chicken-road-dash/demo/cross',
  '/api/games/chicken-road-dash/demo/cashout',
  '/api/games/chicken-road-dash/demo/reset',
  '/api/games/chicken-road-dash/real/cross',
  '/api/games/chicken-road-dash/real/cashout',
  '/api/games/mines/step',
  '/api/games/mines/cashout',
  '/api/games/mines/verify',
  '/api/games/plinko/verify',
  '/api/games/bingo/call',
  '/api/games/bingo/abandon',
];
for (const route of nonStakePosts) {
  assert.equal(isNewStakeRequest('POST', route), false, `settlement/demo route stays available: ${route}`);
}
assert.deepEqual([...NON_STAKE_POST_PATHS].sort(), nonStakePosts.map(relativeGamePath).sort());
assert.equal(isNewStakeRequest('POST', '/api/games/future-stake'), true, 'unknown POST routes fail closed');
assert.equal(relativeGamePath('/api/games'), '/');
assert.equal(relativeGamePath('/api/games/road/step?x=1'), '/road/step');
assert.equal(relativeGamePath('/road/step'), '/road/step');
assert.equal(relativeGamePath('/api/gamesfoo'), '/api/gamesfoo');

// ---------- middleware ----------
function invoke(policy, method, route) {
  const calls = [];
  let statusCode = null;
  let body = null;
  const req = { method, path: route };
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { body = value; return this; },
  };
  const next = () => calls.push('next');
  createWageringGuard(policy)(req, res, next);
  return { calls, statusCode, body };
}

const allowed = invoke(resolveWageringPolicy({}), 'POST', '/api/games/roulette');
assert.deepEqual(allowed.calls, ['next']);
assert.equal(allowed.statusCode, null);

const blockedStake = invoke(disabled, 'POST', '/api/games/roulette');
assert.deepEqual(blockedStake.calls, []);
assert.equal(blockedStake.statusCode, 403);
assert.deepEqual(blockedStake.body, { error: 'WAGERING_DISABLED' });

for (const route of nonStakePosts) {
  const result = invoke(disabled, 'POST', route);
  assert.deepEqual(result.calls, ['next'], `blocked policy still permits ${route}`);
}
for (const route of ['/api/games/road', '/api/games/penalty', '/api/games/mines', '/api/games/bingo', '/api/games/chicken-road-dash/demo', '/api/games/chicken-road-dash/real']) {
  assert.deepEqual(invoke(disabled, 'GET', route).calls, ['next'], `blocked policy still permits read ${route}`);
}
assert.deepEqual(invoke(resolveWageringPolicy({ WAGERING_MODE: 'real' }), 'POST', '/api/games/roulette').calls, []);
assert.deepEqual(invoke(resolveWageringPolicy({ WAGERING_MODE: 'real', REAL_MONEY_AUTHORIZATION: 'ET-GCB-2026-0042' }), 'POST', '/api/games/roulette').calls, ['next']);
assert.throws(() => createWageringGuard(null), /resolved wagering policy/);

// ---------- server wiring and customer messaging ----------
const server = read('server.js');
const guardMount = "app.use('/api/games', wageringGuard)";
const guardIndex = server.indexOf(guardMount);
const firstGameRoute = server.indexOf("app.post('/api/games/roulette'");
assert.ok(guardIndex !== -1, 'server mounts the wagering guard');
assert.ok(firstGameRoute !== -1, 'game routes exist');
assert.ok(guardIndex < firstGameRoute, 'guard runs before the first game route');
const gameRoute = /app\.(?:get|post)\('\/api\/games\//g;
let routeMatch;
let gameRouteCount = 0;
while ((routeMatch = gameRoute.exec(server))) {
  gameRouteCount++;
  assert.ok(routeMatch.index > guardIndex, `every game route is registered after the guard: ${routeMatch[0]}`);
}
assert.ok(gameRouteCount >= 30, `all game routes are covered by the mounted guard (${gameRouteCount})`);
assert.ok(server.includes('resolveWageringPolicy(process.env)'), 'server resolves policy from environment');
assert.ok(server.includes('New stakes are blocked'), 'server logs a disabled policy at startup');

const en = JSON.parse(read('locales/en.json'));
const am = JSON.parse(read('locales/am.json'));
assert.equal(typeof en.err_WAGERING_DISABLED, 'string');
assert.equal(typeof am.err_WAGERING_DISABLED, 'string');
assert.ok(en.err_WAGERING_DISABLED.length > 20);
assert.ok(am.err_WAGERING_DISABLED.length > 10);
assert.ok(read('public/games/penalty/js/game.js').includes('WAGERING_DISABLED'));
assert.ok(read('public/games/chicken-road-2/js/game.js').includes('WAGERING_DISABLED'));

console.log('wagering-safety tests passed');
