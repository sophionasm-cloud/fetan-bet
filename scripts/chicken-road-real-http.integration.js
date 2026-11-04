'use strict';

// Authenticated HTTP integration checks against synthetic accounts on the pinned Neon test branch.
require('dotenv').config({ quiet: true });
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { Client } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { assertExpectedNeonTestEndpoint } = require('./test-db-safety');
const { laneOutcomesV2, commitSeed, merkleTreeV2, ENGINE_VERSION_V2, PROBABILITY_VERSION_V2 } = require('../chicken-road-committed');
const { MODES, CONFIG_VERSION, PAYOUT_VERSION, payoutFor } = require('../chicken-road-2-config');

const EXPECTED = Object.freeze({
  project: 'muddy-dew-45860324', branch: 'br-patient-recipe-b58ey3ge',
  endpoint: 'ep-withered-pond-b5xflte3', hostname: 'ep-withered-pond-b5xflte3-pooler.c-7.us-east-2.aws.neon.tech',
});
const PORT = Number(process.env.CHICKEN_ROAD_HTTP_TEST_PORT || 3141);
const BASE = `http://127.0.0.1:${PORT}`;
const LOCAL_SECRET = 'chicken-road-http-test-only-secret';

async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is required.');
  if (new URL(url).hostname.toLowerCase() !== EXPECTED.hostname) throw new Error('TEST_DATABASE_URL hostname mismatch; refusing connection.');
  assertExpectedNeonTestEndpoint(url, EXPECTED.endpoint);
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: true } });
  await client.connect();
  let app;
  let db;
  try {
    await client.query('BEGIN READ ONLY');
    const identity = (await client.query("SELECT current_setting('neon.project_id',true) project,current_setting('neon.branch_id',true) branch,current_setting('neon.endpoint_id',true) endpoint")).rows[0];
    assert.deepEqual(identity, { project: EXPECTED.project, branch: EXPECTED.branch, endpoint: EXPECTED.endpoint });
    const schema = await client.query("SELECT to_regclass('public.chicken_road_dash_rounds') rounds,to_regclass('public.chicken_road_dash_actions') actions");
    assert.ok(schema.rows[0].rounds && schema.rows[0].actions, 'migration 006 tables must exist');
    await client.query('ROLLBACK');

    process.env.NODE_ENV = 'test';
    process.env.FETAN_INTEGRATION_TEST = '1';
    process.env.FETAN_TEST_DATABASE_ONLY = '1';
    process.env.FETAN_TEST_DB_PREFLIGHT = 'passed';
    process.env.FETAN_EXPECTED_TEST_ENDPOINT_ID = EXPECTED.endpoint;
    process.env.FETAN_EXPECTED_TEST_PROJECT_ID = EXPECTED.project;
    process.env.FETAN_EXPECTED_TEST_BRANCH_ID = EXPECTED.branch;
    process.env.TEST_DATABASE_BRANCH_ID = EXPECTED.branch;
    process.env.JWT_SECRET = LOCAL_SECRET;
    db = require('../db');
    const userPhones = new Map();
    const loginPassword = 'SyntheticHttpPass!9';
    const loginHash = bcrypt.hashSync(loginPassword, 4);

    async function makeUser(role = 'user', startingBalance = 250000) {
      const marker = crypto.randomUUID().replaceAll('-', '');
      const phone = `+997${Date.now()}${crypto.randomInt(1000, 9999)}`;
      return db.withTx(async (c) => {
        const inserted = await c.query("INSERT INTO users(name,phone,password_hash,role,lang,status) VALUES($1,$2,$3,$4,'en','active') RETURNING id",
          [`SYNTHETIC Chicken Dash HTTP ${marker}`, phone, loginHash, role]);
        const userId = Number(inserted.rows[0].id);
        userPhones.set(userId, phone);
        if (role === 'user') {
          await c.query('INSERT INTO wallets(user_id,balance) VALUES($1,0)', [userId]);
          if (startingBalance > 0) await db.postLedger({ client: c, userId, delta: startingBalance, type: 'test_funding', refType: 'chicken_dash_http_test', refId: userId });
        }
        return userId;
      });
    }

    const player = await makeUser('user', 250000);
    const poor = await makeUser('user', 99);
    const agent = await makeUser('agent', 0);
    const tokenFor = (uid) => jwt.sign({ uid }, LOCAL_SECRET, { expiresIn: '20m' });
    let playerToken = tokenFor(player);

    const childEnv = {
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
      PORT: String(PORT), NODE_ENV: 'test', JWT_SECRET: LOCAL_SECRET,
      TEST_DATABASE_URL: url, TEST_DATABASE_BRANCH_ID: EXPECTED.branch,
      FETAN_TEST_DATABASE_ONLY: '1', FETAN_INTEGRATION_TEST: '1', FETAN_TEST_DB_PREFLIGHT: 'passed',
      FETAN_EXPECTED_TEST_ENDPOINT_ID: EXPECTED.endpoint, FETAN_EXPECTED_TEST_PROJECT_ID: EXPECTED.project,
      FETAN_EXPECTED_TEST_BRANCH_ID: EXPECTED.branch,
      // Receipt routes are not exercised; placeholders satisfy storage construction without contacting B2.
      B2_KEY_ID: 'test-only-no-access', B2_APPLICATION_KEY: 'test-only-no-access',
      B2_BUCKET_NAME: 'test-only-unused', B2_BUCKET_ID: 'test-only-unused', B2_ENDPOINT: 'https://unused.invalid',
    };
    app = spawn(process.execPath, ['--no-warnings', 'server.js'], { cwd: require('node:path').resolve(__dirname, '..'), env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let serverLog = '';
    app.stdout.on('data', (data) => { serverLog += data.toString(); });
    app.stderr.on('data', (data) => { serverLog += data.toString(); });
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (app.exitCode !== null) throw new Error(`Test-only server exited: ${serverLog.slice(-1000)}`);
      try { if ((await fetch(BASE)).ok) { ready = true; break; } } catch { /* wait */ }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.ok(ready, `Test-only server did not start: ${serverLog.slice(-1000)}`);
    console.log('HTTP test server ready on isolated TEST database.');

    async function request(path, { method = 'GET', body, token = playerToken, captureCookie = false } = {}) {
      let response;
      try { response = await fetch(`${BASE}${path}`, {
          method,
          headers: { ...(token ? { Cookie: `token=${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
      } catch (error) { throw new Error(`${method} ${path} network error: ${error.message}; app=${serverLog.slice(-800)}`); }
      const json = await response.json().catch(() => ({}));
      return { status: response.status, json, ...(captureCookie ? { setCookie: response.headers.get('set-cookie') } : {}) };
    }
    const real = '/api/games/chicken-road-dash/real';
    const results = [];

    const login = await request('/api/login', { method: 'POST', token: null, captureCookie: true,
      body: { phone: userPhones.get(player), password: loginPassword } });
    assert.equal(login.status, 200); assert.equal(login.json.ok, true);
    const cookieToken = /(?:^|;\s*)token=([^;]+)/.exec(login.setCookie || '')?.[1];
    assert.ok(cookieToken, 'login response must set the authenticated session cookie');
    assert.equal(Number(jwt.verify(cookieToken, LOCAL_SECRET).uid), player);
    playerToken = cookieToken;
    const me = await request('/api/me');
    assert.equal(me.status, 200); assert.equal(Number(me.json.user.id), player); assert.equal(Number(me.json.balance), 250000);
    results.push('synthetic customer login issues a valid authenticated session and loads main wallet');

    const unauthorized = await request(real, { token: null });
    assert.equal(unauthorized.status, 401); assert.equal(unauthorized.json.error, 'LOGIN');
    const forbidden = await request(real, { token: tokenFor(agent) });
    assert.equal(forbidden.status, 403); assert.equal(forbidden.json.error, 'FORBIDDEN');
    results.push('unauthenticated and agent access rejected');
    console.log('HTTP auth checks passed.');

    const invalid = await request(`${real}/start`, { method: 'POST', body: { difficulty: 'impossible', bet_santim: 100, action_id: crypto.randomUUID() } });
    assert.equal(invalid.status, 400); assert.equal(invalid.json.error, 'INVALID');
    const low = await request(`${real}/start`, { method: 'POST', token: tokenFor(poor), body: { difficulty: 'easy', bet_santim: 100, action_id: crypto.randomUUID() } });
    assert.equal(low.status, 400); assert.equal(low.json.error, 'INSUFFICIENT');
    const poorState = await db.query('SELECT w.balance,COUNT(l.id)::int ledger_count FROM wallets w LEFT JOIN ledger l ON l.user_id=w.user_id WHERE w.user_id=$1 GROUP BY w.balance', [poor]);
    assert.equal(poorState.rows[0].balance, 99); assert.equal(poorState.rows[0].ledger_count, 1);
    assert.equal((await db.query('SELECT count(*)::int n FROM chicken_road_dash_rounds WHERE user_id=$1', [poor])).rows[0].n, 0);
    results.push('invalid request and insufficient balance return expected HTTP errors without debit');
    console.log('HTTP validation and insufficient balance checks passed.');

    const startKey = crypto.randomUUID();
    const startBody = { difficulty: 'easy', bet_santim: 1000, action_id: startKey };
    const started = await request(`${real}/start`, { method: 'POST', body: startBody });
    assert.equal(started.status, 200); assert.equal(started.json.balance_santim, 249000);
    const duplicateStart = await request(`${real}/start`, { method: 'POST', body: startBody });
    assert.equal(duplicateStart.status, 200); assert.equal(duplicateStart.json.id, started.json.id);
    const mismatchedStart = await request(`${real}/start`, { method: 'POST', body: { ...startBody, difficulty: 'hard' } });
    assert.equal(mismatchedStart.status, 409); assert.equal(mismatchedStart.json.error, 'STALE_ACTION');
    const recovered = await request(real);
    assert.equal(recovered.status, 200); assert.equal(recovered.json.round.id, started.json.id);
    assert.equal(recovered.json.round.status, 'active');
    const currentOutcome = await db.query('SELECT detail FROM chicken_road_dash_rounds WHERE id=$1', [started.json.id]);
    const storedFirst = currentOutcome.rows[0].detail.outcomes[0].outcome;
    const crossId = crypto.randomUUID();
    const firstCross = await request(`${real}/cross`, { method: 'POST', body: { round_id: started.json.id, action_id: crossId } });
    assert.equal(firstCross.status, 200); assert.equal(firstCross.json.outcome, storedFirst);
    assert.equal(firstCross.json.step, 1);
    const duplicateCross = await request(`${real}/cross`, { method: 'POST', body: { round_id: started.json.id, action_id: crossId } });
    assert.deepEqual(duplicateCross, firstCross);
    const realState = await db.query('SELECT w.balance,COALESCE(SUM(l.amount),0)::bigint ledger_total FROM wallets w LEFT JOIN ledger l ON l.user_id=w.user_id WHERE w.user_id=$1 GROUP BY w.balance', [player]);
    assert.equal(Number(realState.rows[0].balance), Number(realState.rows[0].ledger_total));
    results.push('start debit, idempotent retry, key mismatch rejection, active recovery, committed crossing and duplicate replay');
    console.log('HTTP start, recovery, and crossing checks passed.');

    const ownership = await request(`${real}/cross`, { method: 'POST', token: tokenFor(poor), body: { round_id: started.json.id, action_id: crypto.randomUUID() } });
    assert.equal(ownership.status, 400); assert.equal(ownership.json.error, 'NOT_FOUND');
    // Close the real-start round deterministically according to its committed outcome.
    if (storedFirst === 'safe') {
      const payoutKey = crypto.randomUUID();
      const [paid, retried] = await Promise.all([
        request(`${real}/cashout`, { method: 'POST', body: { round_id: started.json.id, action_id: payoutKey } }),
        request(`${real}/cashout`, { method: 'POST', body: { round_id: started.json.id, action_id: payoutKey } }),
      ]);
      assert.equal(paid.status, 200); assert.deepEqual(retried, paid);
      assert.equal(paid.json.payout_santim, payoutFor(1000, MODES.easy.multiplierCents[0]));
    }
    results.push('round ownership enforced; cash-out after safe crossing settles once (when committed safe)');

    async function createFixture({ mode, difficulty = 'easy', bet = 200, finish = false }) {
      const id = crypto.randomUUID();
      let seed;
      for (let n = 0; n < 2000000; n++) {
        const candidate = Buffer.alloc(32); candidate.writeUInt32BE(n, 28);
        const outcomes = laneOutcomesV2(candidate, id, difficulty);
        if (finish ? outcomes.every((x) => x.outcome === 'safe') : outcomes[0].outcome === mode) { seed = candidate; break; }
      }
      assert.ok(seed, `could not prepare ${mode || 'all-safe'} committed fixture`);
      const outcomes = laneOutcomesV2(seed, id, difficulty); const tree = merkleTreeV2(id, outcomes);
      const detail = { seed: seed.toString('hex'), outcomes, tree, configVersion: CONFIG_VERSION, payoutVersion: PAYOUT_VERSION, lanes: MODES[difficulty].lanes, lines: [...MODES[difficulty].lines] };
      const startAction = crypto.randomUUID(); const gameDetail = JSON.stringify({ round_id: id, config_version: CONFIG_VERSION });
      await db.withTx(async (c) => {
        const game = await c.query("INSERT INTO game_rounds(user_id,game,bet,payout,step,status,detail,server_seed,server_seed_hash,difficulty) VALUES($1,'chicken-road-dash',$2,0,0,'active',$3,$4,$5,$6) RETURNING id",
          [player, bet, gameDetail, seed.toString('hex'), commitSeed(seed), difficulty]);
        const gameId = Number(game.rows[0].id);
        await db.postLedger({ client: c, userId: player, delta: -bet, type: 'bet', refType: 'game_round', refId: gameId });
        await c.query(`INSERT INTO chicken_road_dash_rounds
          (id,user_id,difficulty,status,progress,bet_santim,payout_santim,seed_commitment,outcome_root,detail,engine_version,probability_version,payout_version,start_action_id,start_request,game_round_id)
          VALUES($1,$2,$3,'active',0,$4,0,$5,$6,$7::jsonb,$8,$9,$10,$11,$12::jsonb,$13)`,
        [id, player, difficulty, bet, commitSeed(seed), tree.root, JSON.stringify(detail), ENGINE_VERSION_V2, PROBABILITY_VERSION_V2, PAYOUT_VERSION, startAction, JSON.stringify({ difficulty, bet_santim: bet }), gameId]);
      });
      return { id, bet, difficulty };
    }

    const safeRound = await createFixture({ mode: 'safe', bet: 200 });
    const safeKey = crypto.randomUUID();
    const [safe, safeRetry] = await Promise.all([
      request(`${real}/cross`, { method: 'POST', body: { round_id: safeRound.id, action_id: safeKey } }),
      request(`${real}/cross`, { method: 'POST', body: { round_id: safeRound.id, action_id: safeKey } }),
    ]);
    assert.equal(safe.status, 200); assert.equal(safe.json.outcome, 'safe'); assert.deepEqual(safeRetry, safe);
    const replayKind = await request(`${real}/cashout`, { method: 'POST', body: { round_id: safeRound.id, action_id: safeKey } });
    assert.equal(replayKind.status, 409); assert.equal(replayKind.json.error, 'STALE_ACTION');
    const cashKey = crypto.randomUUID();
    const [cash, cashRetry] = await Promise.all([
      request(`${real}/cashout`, { method: 'POST', body: { round_id: safeRound.id, action_id: cashKey } }),
      request(`${real}/cashout`, { method: 'POST', body: { round_id: safeRound.id, action_id: cashKey } }),
    ]);
    assert.equal(cash.status, 200); assert.deepEqual(cashRetry, cash);
    assert.equal(cash.json.payout_santim, payoutFor(safeRound.bet, MODES.easy.multiplierCents[0]));
    assert.equal((await db.query("SELECT status FROM chicken_road_dash_rounds WHERE id=$1", [safeRound.id])).rows[0].status, 'cashed_out');
    results.push('safe crossing, replay protection, concurrent duplicate crossing/cash-out and exact cash-out payout');

    const crashRound = await createFixture({ mode: 'collision', bet: 200 });
    const beforeCrash = (await db.query('SELECT balance FROM wallets WHERE user_id=$1', [player])).rows[0].balance;
    const crash = await request(`${real}/cross`, { method: 'POST', body: { round_id: crashRound.id, action_id: crypto.randomUUID() } });
    assert.equal(crash.status, 200); assert.equal(crash.json.crashed, true); assert.equal(crash.json.payout_santim, 0);
    const crashDb = await db.query("SELECT r.status,w.balance,COUNT(l.id)::int AS round_ledger_rows FROM chicken_road_dash_rounds r JOIN wallets w ON w.user_id=r.user_id LEFT JOIN ledger l ON l.ref_type='game_round' AND l.ref_id=r.game_round_id WHERE r.id=$1 GROUP BY r.status,w.balance", [crashRound.id]);
    assert.equal(crashDb.rows[0].status, 'crashed'); assert.equal(crashDb.rows[0].balance, beforeCrash); assert.equal(crashDb.rows[0].round_ledger_rows, 1);
    results.push('crash is settled with no credit and only the original bet ledger row');

    const finishRound = await createFixture({ finish: true, bet: 200 });
    for (let lane = 1; lane <= MODES.easy.lanes; lane++) {
      const crossing = await request(`${real}/cross`, { method: 'POST', body: { round_id: finishRound.id, action_id: crypto.randomUUID() } });
      assert.equal(crossing.status, 200); assert.equal(crossing.json.crashed, false); assert.equal(crossing.json.step, lane);
    }
    const finish = await request(`${real}/cross`, { method: 'POST', body: { round_id: finishRound.id, action_id: crypto.randomUUID() } });
    const expectedFinish = payoutFor(finishRound.bet, MODES.easy.multiplierCents[MODES.easy.lanes - 1]);
    assert.equal(finish.status, 200); assert.equal(finish.json.outcome, 'finish'); assert.equal(finish.json.payout_santim, expectedFinish);
    const proof = await request(`${real}/verify/${finishRound.id}`);
    assert.equal(proof.status, 200); assert.ok(proof.json.seed_commit_valid && proof.json.outcomes_match_seed && proof.json.probabilities_match_config && proof.json.merkle_proofs_valid);
    results.push('all 15 Easy crossings, exact final multiplier and fairness verification through authenticated HTTP routes');

    for (const uid of [player, poor]) {
      const reconciliation = await db.query('SELECT w.balance,COALESCE(SUM(l.amount),0)::bigint total FROM wallets w LEFT JOIN ledger l ON l.user_id=w.user_id WHERE w.user_id=$1 GROUP BY w.balance', [uid]);
      assert.equal(Number(reconciliation.rows[0].balance), Number(reconciliation.rows[0].total));
    }
    console.log(JSON.stringify({ identity: { ...identity, hostname: EXPECTED.hostname }, results, syntheticUserCount: 3,
      playerReconciliation: 'wallet balance equals signed ledger sum', realWalletModeEnabled: true }, null, 2));
  } finally {
    if (app && app.exitCode === null) { app.kill(); await Promise.race([once(app, 'exit'), new Promise((resolve) => setTimeout(resolve, 3000))]); }
    if (db?.pool) await db.pool.end().catch(() => {});
    await client.end();
  }
}

main().catch((error) => { console.error('Chicken Road authenticated HTTP integration failed:', error.code || error.name || 'error', error.message, String(error.stack || '').split('\n').slice(1, 3).join('\n')); process.exitCode = 1; });
