'use strict';

// Real Chromium integration checks. TEST_DATABASE_URL must be supplied by the
// caller; this file deliberately does not load the project .env file.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { Client } = require('pg');
const jwt = require('jsonwebtoken');
const { chromium } = require('playwright');
const { assertExpectedNeonTestEndpoint } = require('./test-db-safety');
const { commitSeed, laneOutcomes, merkleTree, ENGINE_VERSION, PROBABILITY_VERSION } = require('../chicken-road-committed');
const { ladderFor } = require('../chicken-road-demo-service');

const PROJECT_ID = 'muddy-dew-45860324';
const BRANCH_ID = 'br-patient-recipe-b58ey3ge';
const ENDPOINT_ID = 'ep-withered-pond-b5xflte3';
const PORT = Number(process.env.CHICKEN_ROAD_TEST_PORT || 3137);
const BASE = `http://127.0.0.1:${PORT}`;
const failures = [];
const results = [];
let recoverActiveDemoRound = null;
let testDbPool = null;

function record(name, fn) {
  return fn().then(() => results.push({ name, passed: true })).catch((error) => {
    failures.push({ name, error: error.message });
    results.push({ name, passed: false, error: error.message });
  });
}

function makeSeed(roundId, difficulty, mode) {
  for (let n = 0; n < 100000; n++) {
    const seed = crypto.createHash('sha256').update(`fetan-browser-fixture|${mode}|${n}`).digest();
    const outcomes = laneOutcomes(seed, roundId, difficulty);
    if (mode === 'all-safe' && outcomes.every((item) => item.outcome === 'safe')) return { seed, outcomes };
    if (mode === 'first-crash' && outcomes[0].outcome === 'collision') return { seed, outcomes };
  }
  throw new Error(`Could not generate deterministic ${mode} fixture.`);
}

async function insertRoundFixture(client, userId, mode, difficulty = 'easy', betSantim = 300) {
  if (recoverActiveDemoRound) await recoverActiveDemoRound();
  const id = crypto.randomUUID();
  const { seed, outcomes } = makeSeed(id, difficulty, mode);
  const tree = merkleTree(id, outcomes);
  const detail = { seed: seed.toString('hex'), outcomes, tree, payoutVersion: 1, finishBonusBps: 15000 };
  await client.query('BEGIN');
  try {
    await client.query(`INSERT INTO chicken_road_dash_demo_balances(user_id,balance_santim)
      VALUES($1,100000000) ON CONFLICT(user_id) DO NOTHING`, [userId]);
    const bal = await client.query('SELECT balance_santim FROM chicken_road_dash_demo_balances WHERE user_id=$1 FOR UPDATE', [userId]);
    if (Number(bal.rows[0].balance_santim) < betSantim) throw new Error('Test DEMO ETB balance unexpectedly low.');
    const active = await client.query("SELECT 1 FROM chicken_road_dash_demo_rounds WHERE user_id=$1 AND status='active'", [userId]);
    if (active.rowCount) throw new Error('Cannot add a round fixture while another round is active.');
    await client.query('UPDATE chicken_road_dash_demo_balances SET balance_santim=balance_santim-$2,updated_at=NOW() WHERE user_id=$1', [userId, betSantim]);
    await client.query(`INSERT INTO chicken_road_dash_demo_rounds
      (id,user_id,difficulty,status,progress,bet_santim,payout_santim,seed_commitment,outcome_root,detail,engine_version,probability_version,payout_version)
      VALUES($1,$2,$3,'active',0,$4,0,$5,$6,$7::jsonb,$8,$9,1)`,
    [id, userId, difficulty, betSantim, commitSeed(seed), tree.root, JSON.stringify(detail), ENGINE_VERSION, PROBABILITY_VERSION]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  return { id, outcomes, betSantim, difficulty };
}

async function getRound(client, id) {
  const r = await client.query('SELECT status,progress,payout_santim,detail FROM chicken_road_dash_demo_rounds WHERE id=$1', [id]);
  assert.equal(r.rowCount, 1);
  return { ...r.rows[0], detail: typeof r.rows[0].detail === 'string' ? JSON.parse(r.rows[0].detail) : r.rows[0].detail };
}

async function main() {
  if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL was not supplied to the browser test runner.');
  if (process.env.TEST_DATABASE_BRANCH_ID !== BRANCH_ID) throw new Error('Explicit test branch ID is missing or incorrect.');
  if (process.env.FETAN_TEST_DB_PREFLIGHT !== 'passed') throw new Error('Test DB preflight flag is required.');
  const target = assertExpectedNeonTestEndpoint(process.env.TEST_DATABASE_URL, ENDPOINT_ID);

  const db = new Client({ connectionString: process.env.TEST_DATABASE_URL, ssl: { rejectUnauthorized: true } });
  await db.connect();
  let browser;
  let app;
  let tempDotenv;
  let context;
  try {
    const identity = await db.query("SELECT current_setting('neon.project_id',true) project,current_setting('neon.branch_id',true) branch,current_setting('neon.endpoint_id',true) endpoint");
    assert.deepEqual(identity.rows[0], { project: PROJECT_ID, branch: BRANCH_ID, endpoint: ENDPOINT_ID }, 'Live database identity must match the approved Neon test target before writes.');
    const schema = await db.query(`SELECT
      EXISTS(SELECT 1 FROM schema_migrations WHERE name='005_chicken_road_dash_demo.sql') AS migration,
      to_regclass('public.chicken_road_dash_demo_balances') IS NOT NULL AS balances,
      to_regclass('public.chicken_road_dash_demo_rounds') IS NOT NULL AS rounds,
      to_regclass('public.chicken_road_dash_demo_actions') IS NOT NULL AS actions`);
    assert.ok(schema.rows[0].migration && schema.rows[0].balances && schema.rows[0].rounds && schema.rows[0].actions,
      'Test branch migration 005 and demo tables must exist.');

    process.env.NODE_ENV = 'test';
    process.env.FETAN_INTEGRATION_TEST = '1';
    process.env.FETAN_TEST_DATABASE_ONLY = '1';
    process.env.FETAN_TEST_DB_PREFLIGHT = 'passed';
    process.env.FETAN_EXPECTED_TEST_ENDPOINT_ID = ENDPOINT_ID;
    process.env.FETAN_EXPECTED_TEST_PROJECT_ID = PROJECT_ID;
    process.env.FETAN_EXPECTED_TEST_BRANCH_ID = BRANCH_ID;
    const dbHelpers = require('../db');
    testDbPool = dbHelpers.pool;
    const { createChickenRoadDemoService } = require('../chicken-road-demo-service');
    const demoService = createChickenRoadDemoService({ query: dbHelpers.query, withTx: dbHelpers.withTx });
    let userId;
    recoverActiveDemoRound = async () => {
      const current = await demoService.current(userId);
      if (!current.round?.active) return;
      if (Number(current.round.step) > 0) {
        await demoService.cashout(userId, current.round.id, crypto.randomUUID());
      } else {
        const crossing = await demoService.cross(userId, current.round.id, crypto.randomUUID());
        if (!crossing.crashed && !crossing.finished) await demoService.cashout(userId, current.round.id, crypto.randomUUID());
      }
    };

    const suffix = crypto.randomInt(100000000, 999999999);
    const userResult = await db.query(`INSERT INTO users(name,phone,password_hash,role,lang,status)
      VALUES('Chicken Road Dash Playwright test',$1,'browser-test-no-password','user','en','active') RETURNING id`, [`+998${suffix}`]);
    userId = Number(userResult.rows[0].id);
    // The main customer shell performs read-only Road Dash/Mines status calls.
    // Give this synthetic user a zero balance so those existing reads succeed;
    // no real customer wallet or financial ledger row is touched.
    await db.query('INSERT INTO wallets(user_id,balance) VALUES($1,0)', [userId]);
    const initialFinancial = await db.query(`SELECT
      (SELECT count(*)::int FROM wallets WHERE user_id=$1) AS wallets,
      (SELECT balance::int FROM wallets WHERE user_id=$1) AS wallet_balance,
      (SELECT count(*)::int FROM ledger WHERE user_id=$1) AS ledger`, [userId]);
    assert.equal(Number(initialFinancial.rows[0].wallets), 1);
    assert.equal(Number(initialFinancial.rows[0].wallet_balance), 0);
    assert.equal(Number(initialFinancial.rows[0].ledger), 0);

    tempDotenv = path.join(os.tmpdir(), `fetan-test-only-${crypto.randomUUID()}.env`);
    fs.writeFileSync(tempDotenv, '# Deliberately empty: app environment is passed explicitly.\n', { flag: 'wx' });
    const childEnv = {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP || os.tmpdir(),
      TMP: process.env.TMP || os.tmpdir(),
      USERPROFILE: process.env.USERPROFILE,
      PORT: String(PORT),
      DOTENV_CONFIG_PATH: tempDotenv,
      TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
      TEST_DATABASE_BRANCH_ID: BRANCH_ID,
      FETAN_TEST_DATABASE_ONLY: '1',
      FETAN_INTEGRATION_TEST: '1',
      FETAN_TEST_DB_PREFLIGHT: 'passed',
      FETAN_EXPECTED_TEST_ENDPOINT_ID: ENDPOINT_ID,
      FETAN_EXPECTED_TEST_PROJECT_ID: PROJECT_ID,
      FETAN_EXPECTED_TEST_BRANCH_ID: BRANCH_ID,
      // Receipt storage is not exercised; these placeholders are never sent to B2.
      B2_KEY_ID: 'test-only-no-access',
      B2_APPLICATION_KEY: 'test-only-no-access',
      B2_BUCKET_NAME: 'test-only-unused',
      B2_BUCKET_ID: 'test-only-unused',
      B2_ENDPOINT: 'https://unused.invalid',
      NODE_ENV: 'test',
    };
    app = spawn(process.execPath, ['--no-warnings', 'server.js'], { cwd: path.resolve(__dirname, '..'), env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let appLog = '';
    app.stdout.on('data', (data) => { appLog += data.toString(); });
    app.stderr.on('data', (data) => { appLog += data.toString(); });
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      if (app.exitCode !== null) throw new Error(`Test-only app exited before ready: ${appLog.slice(-1200)}`);
      try {
        const response = await fetch(BASE);
        if (response.ok) { ready = true; break; }
      } catch { /* wait for the local test-only server */ }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.ok(ready, `Test-only app did not become ready: ${appLog.slice(-1200)}`);

    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
    const token = jwt.sign({ uid: userId }, 'dev-secret-change-me', { expiresIn: '2h' });
    await context.addCookies([{ name: 'token', value: token, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }]);
    const page = await context.newPage();
    const consoleErrors = [];
    const failedLocalResponses = [];
    const observedRequests = [];
    page.on('request', (request) => {
      if (request.url().startsWith(BASE)) observedRequests.push({ method: request.method(), path: new URL(request.url()).pathname });
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('response', (response) => {
      if (response.url().startsWith(BASE) && response.status() >= 400) failedLocalResponses.push({ status: response.status(), path: new URL(response.url()).pathname });
    });

    async function openGame() {
      await page.goto(`${BASE}/#/game/chicken-road-2`, { waitUntil: 'domcontentloaded' });
      try { await page.waitForSelector('iframe.integrated-game-frame', { timeout: 40000 }); }
      catch { throw new Error(`Game iframe did not appear; url=${page.url()}; body=${(await page.locator('body').innerText().catch(() => '')).slice(0, 500)}; requests=${JSON.stringify(observedRequests.slice(-12))}; failed=${JSON.stringify(failedLocalResponses)}; console=${JSON.stringify(consoleErrors)}; app=${appLog.slice(-900)}`); }
      const frame = page.frameLocator('iframe.integrated-game-frame');
      await frame.locator('#balance').waitFor({ state: 'visible', timeout: 15000 });
      try {
        await frame.locator('#balance').filter({ hasText: /^\d[\d, ]*(?:\.\d{2})? DEMO ETB$/ }).waitFor({ timeout: 20000 });
      } catch {
        const observed = await frame.locator('#balance').innerText().catch(() => '(balance unavailable)');
        const status = await frame.locator('#integrationWalletStatus').innerText().catch(() => '(status unavailable)');
        throw new Error(`Demo API did not resolve; balance=${observed}; status=${status}; responses=${JSON.stringify(failedLocalResponses)}; app=${appLog.slice(-600) || '(no server log)'}`);
      }
      const balanceText = await frame.locator('#balance').innerText();
      assert.match(balanceText, /^\d[\d, ]*(?:\.\d{2})? DEMO ETB$/);
      await frame.locator('#integrationBlocker').waitFor({ state: 'hidden', timeout: 15000 });
      return frame;
    }
    async function cross(frame) {
      const responsePromise = page.waitForResponse((response) => response.url().includes('/api/games/chicken-road-dash/demo/cross') && response.request().method() === 'POST', { timeout: 15000 });
      await frame.locator('#goBtn').click();
      const response = await responsePromise;
      const result = await response.json();
      await page.waitForFunction(() => {
        const f = document.querySelector('iframe.integrated-game-frame');
        if (!f?.contentDocument) return false;
        const doc = f.contentDocument;
        return doc.querySelector('#resultOverlay.show') !== null ||
          (doc.querySelector('#goBtn')?.disabled === false);
      }, undefined, { timeout: 12000 }).catch(() => {});
      return result;
    }
    async function layoutMetrics(frame) {
      return frame.locator('body').evaluate(() => {
        const controls = ['.home-btn','#balance','#soundBtn','#menuBtn','#playBtn','#goBtn','#cashBtn','#betPanel'];
        const boxes = Object.fromEntries(controls.map((selector) => {
          const el = document.querySelector(selector);
          if (!el) return [selector, null];
          const r = el.getBoundingClientRect();
          return [selector, { left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height, visible:!!(r.width&&r.height) }];
        }));
        return { innerWidth, innerHeight, clientWidth:document.documentElement.clientWidth, clientHeight:document.documentElement.clientHeight,
          scrollWidth:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth),
          scrollHeight:Math.max(document.documentElement.scrollHeight,document.body.scrollHeight), boxes };
      });
    }
    function assertLayout(metrics, label) {
      assert.ok(metrics.scrollWidth <= metrics.clientWidth + 1, `${label} game iframe has horizontal overflow: ${metrics.scrollWidth}/${metrics.clientWidth}`);
      assert.ok(metrics.scrollHeight <= metrics.clientHeight + 1, `${label} game iframe requires vertical scrolling: ${metrics.scrollHeight}/${metrics.clientHeight}`);
      for (const key of ['.home-btn','#balance','#soundBtn','#menuBtn','#betPanel']) {
        const box = metrics.boxes[key];
        assert.ok(box?.visible, `${label} ${key} is not visible`);
        assert.ok(box.left >= -1 && box.right <= metrics.clientWidth + 1, `${label} ${key} does not fit horizontally`);
        assert.ok(box.top >= -1 && box.bottom <= metrics.clientHeight + 1, `${label} ${key} does not fit vertically`);
      }
      for (const key of ['#playBtn','#goBtn','#cashBtn']) {
        const box = metrics.boxes[key];
        if (box?.visible) assert.ok(box.top >= -1 && box.bottom <= metrics.clientHeight + 1, `${label} ${key} is outside the visible game area`);
      }
    }

    const screenshots = path.resolve(__dirname, '..', 'test-results', 'chicken-road-dash');
    fs.mkdirSync(screenshots, { recursive: true });
    let frame = await openGame();
    assert.match(await frame.locator('.brand-text').innerText(), /CHICKEN\s+ROAD\s+DASH/i);
    assert.match(await frame.locator('#balance').innerText(), /DEMO ETB/);
    assert.equal(await frame.locator('#modelCNote').isVisible(), true);
    await page.screenshot({ path: path.join(screenshots, 'desktop.png') });

    await record('desktop integrated game, DEMO ETB, and controls load', async () => {
      assert.equal(await frame.locator('#playBtn').isVisible(), true);
      assert.equal(await frame.locator('#difficulty').inputValue(), 'medium');
      assert.equal(await frame.locator('#integrationBlocker').isVisible(), false);
      const canvasBefore = await frame.locator('#game').evaluate((canvas) => canvas.toDataURL());
      await page.waitForTimeout(350);
      const canvasAfter = await frame.locator('#game').evaluate((canvas) => canvas.toDataURL());
      assert.notEqual(canvasAfter, canvasBefore, 'Canvas traffic/scene should animate between frames.');
      const oldSoundLabel = await frame.locator('#soundBtn').getAttribute('aria-label');
      await frame.locator('#soundBtn').click();
      assert.notEqual(await frame.locator('#soundBtn').getAttribute('aria-label'), oldSoundLabel, 'Sound control should toggle its accessible state.');
      await frame.locator('#menuBtn').click();
      await frame.locator('#menuModal.open').waitFor({ state: 'visible' });
      await frame.locator('#menuModal button[data-close="menuModal"]').last().click();
      await page.waitForFunction(() => {
        const frame = document.querySelector('iframe.integrated-game-frame');
        return frame?.contentDocument && !frame.contentDocument.querySelector('#menuModal')?.classList.contains('open');
      });
    });

    await record('round starts through UI and first crossing reflects the server result', async () => {
      frame = await openGame();
      await frame.locator('#playBtn').click();
      const active = await page.waitForResponse((r) => r.url().endsWith('/api/games/chicken-road-dash/demo/start') && r.request().method() === 'POST', { timeout: 30000 }).catch(async () => {
        throw new Error(`Start request absent; buttonDisabled=${await frame.locator('#playBtn').isDisabled()}; hint=${await frame.locator('#stageHint').innerText()}; balance=${await frame.locator('#balance').innerText()}; requests=${JSON.stringify(observedRequests.slice(-12))}; console=${JSON.stringify(consoleErrors)}`);
      });
      assert.equal(active.status(), 200);
      const round = await active.json();
      const serverRound = await getRound(db, round.id);
      const laneOne = serverRound.detail.outcomes[0].outcome;
      const result = await cross(frame);
      assert.equal(result.crashed, laneOne === 'collision', 'Crossing response must match committed server outcome.');
      if (result.crashed) {
        await frame.locator('#resultOverlay.show').waitFor({ timeout: 5000 });
        assert.equal(await frame.locator('#resultTitle').innerText(), 'CRASHED!');
      } else {
        assert.equal(await frame.locator('#multiplier').innerText(), `${ladderFor(round.difficulty)[0]}x`);
        await frame.locator('#cashBtn').click();
        await frame.locator('#resultOverlay.show').waitFor({ timeout: 5000 });
      }
    });

    await record('three safe crossings update multiplier and cash out at server payout', async () => {
      const fixture = await insertRoundFixture(db, userId, 'all-safe', 'easy');
      frame = await openGame();
      for (let i = 1; i <= 3; i++) {
        const result = await cross(frame);
        assert.equal(result.crashed, false);
        assert.equal(result.step, i);
        assert.equal(await frame.locator('#multiplier').innerText(), `${ladderFor('easy')[i - 1]}x`);
      }
      const cashResponse = page.waitForResponse((r) => r.url().endsWith('/api/games/chicken-road-dash/demo/cashout') && r.request().method() === 'POST');
      await frame.locator('#cashBtn').click();
      const payout = await (await cashResponse).json();
      await frame.locator('#resultOverlay.show').waitFor({ timeout: 5000 });
      assert.equal((await getRound(db, fixture.id)).status, 'cashed_out');
      assert.equal(Number(payout.payout_santim), Math.round(fixture.betSantim * ladderFor('easy')[2]));
      const proof = await (await page.request.get(`${BASE}/api/games/chicken-road-dash/demo/verify/${fixture.id}`, { headers: { Cookie: `token=${token}` } })).json();
      assert.ok(proof.seed_commit_valid && proof.outcomes_match_seed && proof.merkle_proofs_valid);
    });

    await record('refresh restores an active round and its committed progress', async () => {
      const fixture = await insertRoundFixture(db, userId, 'all-safe', 'easy');
      frame = await openGame();
      await cross(frame);
      await cross(frame);
      await page.reload({ waitUntil: 'domcontentloaded' });
      frame = page.frameLocator('iframe.integrated-game-frame');
      await frame.locator('#balance').filter({ hasText: /^\d[\d, ]*(?:\.\d{2})? DEMO ETB$/ }).waitFor({ timeout: 15000 });
      const current = await getRound(db, fixture.id);
      assert.equal(current.status, 'active');
      assert.equal(Number(current.progress), 2);
      assert.equal(await frame.locator('#goBtn').isVisible(), true);
      await cross(frame);
      await frame.locator('#cashBtn').click();
      await frame.locator('#resultOverlay.show').waitFor({ timeout: 5000 });
    });

    await record('server-committed crash displays crash result in the game', async () => {
      const fixture = await insertRoundFixture(db, userId, 'first-crash', 'easy');
      frame = await openGame();
      const result = await cross(frame);
      assert.equal(result.crashed, true);
      await frame.locator('#resultOverlay.show').waitFor({ timeout: 5000 });
      assert.equal(await frame.locator('#resultTitle').innerText(), 'CRASHED!');
      assert.equal(await frame.locator('#multiplier').innerText(), '0x');
      assert.equal((await getRound(db, fixture.id)).status, 'crashed');
    });

    await record('all 14 lanes and finish crossing pay the server finish bonus', async () => {
      const fixture = await insertRoundFixture(db, userId, 'all-safe', 'easy');
      frame = await openGame();
      for (let i = 1; i <= 14; i++) {
        const result = await cross(frame);
        assert.equal(result.crashed, false);
        assert.equal(result.step, i);
        assert.equal(await frame.locator('#multiplier').innerText(), `${ladderFor('easy')[i - 1]}x`);
      }
      assert.match(await frame.locator('#goBtn').innerText(), /FINISH/i);
      const finishResponse = page.waitForResponse((r) => r.url().endsWith('/api/games/chicken-road-dash/demo/cross') && r.request().method() === 'POST');
      await frame.locator('#goBtn').click();
      const finishedAction = await (await finishResponse).json();
      await frame.locator('#resultOverlay.show').waitFor({ timeout: 5000 });
      const stored = await getRound(db, fixture.id);
      const expected = Math.round(fixture.betSantim * ladderFor('easy')[13] * 1.5);
      assert.equal(finishedAction.finished, true);
      assert.equal(Number(stored.progress), 15);
      assert.equal(Number(stored.payout_santim), expected);
      assert.equal(await frame.locator('#resultTitle').innerText(), 'ROAD CLEARED!');
      assert.equal(await frame.locator('#resultAmount').innerText(), `${(expected / 100).toFixed(2)} DEMO ETB`);
      assert.match(await frame.locator('#resultSub').innerText(), /1\.5x finish bonus/);
    });

    await record('desktop, tablet, and mobile controls fit without game-frame scrolling', async () => {
      for (const [label, viewport] of [
        ['desktop', { width: 1440, height: 960 }],
        ['tablet', { width: 820, height: 1180 }],
        ['mobile', { width: 390, height: 844 }],
      ]) {
        await page.setViewportSize(viewport);
        if (label === 'mobile') await insertRoundFixture(db, userId, 'all-safe', 'easy');
        frame = await openGame();
        if (label === 'mobile') {
          const result = await cross(frame);
          assert.equal(result.crashed, false, 'Mobile screenshot fixture must resolve a safe crossing.');
          assert.equal(await frame.locator('.brand-icon').isVisible(), true);
          assert.equal(await frame.locator('.brand').getAttribute('aria-label'), 'Back to Fetan Bet games');
        }
        const metrics = await layoutMetrics(frame);
        assertLayout(metrics, label);
        const outer = await page.evaluate(() => ({ scrollWidth:document.documentElement.scrollWidth, clientWidth:document.documentElement.clientWidth,
          scrollHeight:document.documentElement.scrollHeight, clientHeight:document.documentElement.clientHeight }));
        assert.ok(outer.scrollWidth <= outer.clientWidth + 1, `${label} outer page has horizontal overflow`);
        if (label === 'mobile') {
          await page.screenshot({ path: path.join(screenshots, 'mobile.png') });
          await frame.locator('#cashBtn').click();
          await frame.locator('#resultOverlay.show').waitFor({ timeout: 5000 });
        }
      }
    });

    await record('Home returns to the Games lobby', async () => {
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await page.locator('[data-g="chicken-road-2"]').click();
      await page.waitForSelector('iframe.integrated-game-frame', { timeout: 15000 });
      frame = page.frameLocator('iframe.integrated-game-frame');
      await frame.locator('#balance').filter({ hasText: /^\d[\d, ]*(?:\.\d{2})? DEMO ETB$/ }).waitFor({ timeout: 15000 });
      await frame.locator('.home-btn').click();
      await page.waitForFunction(() => !document.querySelector('iframe.integrated-game-frame'), { timeout: 10000 });
      assert.match(await page.locator('#app').innerText(), /Your game\. Your moment\.|Chicken Road Dash/i);
      assert.equal(new URL(page.url()).hash, '');
    });

    await record('DEMO ETB loading state is visible until the API responds', async () => {
      const loadingPage = await context.newPage();
      let releaseRequest;
      const held = new Promise((resolve) => { releaseRequest = resolve; });
      await loadingPage.route('**/api/games/chicken-road-dash/demo', async (route) => {
        await held;
        await route.continue();
      });
      await loadingPage.goto(`${BASE}/#/game/chicken-road-2`, { waitUntil: 'domcontentloaded' });
      const loadingFrame = loadingPage.frameLocator('iframe.integrated-game-frame');
      await loadingFrame.locator('#balance').waitFor({ state: 'visible', timeout: 10000 });
      assert.match(await loadingFrame.locator('#balance').innerText(), /Loading DEMO ETB/);
      releaseRequest();
      await loadingFrame.locator('#balance').filter({ hasText: /^\d[\d, ]*(?:\.\d{2})? DEMO ETB$/ }).waitFor({ timeout: 15000 });
      await loadingPage.close();
    });

    await record('API failure shows an explicit unavailable state without local balance fallback', async () => {
      const errorPage = await context.newPage();
      await errorPage.route('**/api/games/chicken-road-dash/demo', (route) => route.abort());
      await errorPage.goto(`${BASE}/#/game/chicken-road-2`, { waitUntil: 'domcontentloaded' });
      const errorFrame = errorPage.frameLocator('iframe.integrated-game-frame');
      await errorFrame.locator('#integrationBlocker:not([hidden])').waitFor({ timeout: 15000 });
      assert.match(await errorFrame.locator('#integrationBlocker').innerText(), /DEMO BALANCE UNAVAILABLE/);
      assert.match(await errorFrame.locator('#balance').innerText(), /Unavailable.*DEMO ETB/);
      await errorPage.close();
    });

    const finalCheck = new Client({ connectionString: process.env.TEST_DATABASE_URL, ssl: { rejectUnauthorized: true } });
    await finalCheck.connect();
    try {
      const finalIdentity = await finalCheck.query("SELECT current_setting('neon.project_id',true) project,current_setting('neon.branch_id',true) branch,current_setting('neon.endpoint_id',true) endpoint");
      assert.deepEqual(finalIdentity.rows[0], { project: PROJECT_ID, branch: BRANCH_ID, endpoint: ENDPOINT_ID }, 'Final wallet-isolation check must remain on the approved test target.');
    } catch (error) {
      await finalCheck.end().catch(() => {});
      throw error;
    }
    const finalFinancial = await finalCheck.query(`SELECT
      (SELECT count(*)::int FROM wallets WHERE user_id=$1) AS wallets,
      (SELECT balance::int FROM wallets WHERE user_id=$1) AS wallet_balance,
      (SELECT count(*)::int FROM ledger WHERE user_id=$1) AS ledger`, [userId]);
    await finalCheck.end();
    assert.equal(Number(finalFinancial.rows[0].wallets), 1, 'Synthetic test wallet row unexpectedly changed.');
    assert.equal(Number(finalFinancial.rows[0].wallet_balance), Number(initialFinancial.rows[0].wallet_balance), 'Demo gameplay changed the synthetic real-wallet balance.');
    assert.equal(Number(finalFinancial.rows[0].ledger), 0, 'Browser demo created a real ledger row.');
    console.log(JSON.stringify({ endpointId: target.endpointId, projectId: PROJECT_ID, branchId: BRANCH_ID,
      results, consoleErrors, failedLocalResponses,
      syntheticUserFinancialRows: { wallets: Number(finalFinancial.rows[0].wallets), walletBalanceSantim: Number(finalFinancial.rows[0].wallet_balance), ledger: Number(finalFinancial.rows[0].ledger) },
      screenshots: [path.join(screenshots, 'desktop.png'), path.join(screenshots, 'mobile.png')] }, null, 2));
    assert.deepEqual(consoleErrors, [], `Browser console errors: ${consoleErrors.join(' | ')}`);
    assert.deepEqual(failedLocalResponses, [], `Failed local responses: ${JSON.stringify(failedLocalResponses)}`);
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (app && app.exitCode === null) {
      app.kill();
      await Promise.race([once(app, 'exit'), new Promise((resolve) => setTimeout(resolve, 3000))]);
    }
    if (tempDotenv) fs.rmSync(tempDotenv, { force: true });
    if (testDbPool) await testDbPool.end().catch(() => {});
    await db.end();
  }
  if (failures.length) {
    console.error(`Browser checks failed: ${failures.length}/${results.length}`);
    for (const failure of failures) console.error(`- ${failure.name}: ${failure.error}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`Chicken Road Dash Chromium test failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
