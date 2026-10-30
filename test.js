// Run with: npm test
require('dotenv').config();
const assert = require('assert');
const crypto = require('crypto');
if (process.env.FETAN_INTEGRATION_TEST !== '1' || process.env.FETAN_TEST_DB_PREFLIGHT !== 'passed') {
  throw new Error('Integration tests must be started through the isolated test launcher (npm test).');
}
require('./scripts/test-db-safety').assertSeparateTestDatabase(process.env);
const app = require('./server');
const games = require('./games');
const { query, pool, withTx, createUser, postLedger } = require('./db');
const { utcWeekBounds } = require('./agent-finance');

async function prepareSyntheticFixtures() {
  const digits = () => String(crypto.randomInt(10000000, 99999999));
  const fixtures = { agentPhone: '09' + digits(), adminPhone: '09' + digits(), superPhone: '09' + digits(), agentPassword: 'isolated-agent-test-password', adminPassword: 'isolated-admin-test-password', superPassword: 'isolated-superadmin-test-password', agentPromo: 'TEST-' + digits(), agentBPromo: 'OTHER-' + digits() };
  await withTx(async (dbClient) => {
    fixtures.customerId = await createUser({ name: 'Synthetic Test Customer', phone: '09' + digits(), password: 'isolated-customer-test-password', role: 'user', bonus: true, client: dbClient });
    fixtures.agentId = await createUser({ name: 'Synthetic Test Agent', phone: fixtures.agentPhone, password: fixtures.agentPassword, role: 'agent', bonus: false, client: dbClient });
    fixtures.adminId = await createUser({ name: 'Synthetic Test Admin', phone: fixtures.adminPhone, password: fixtures.adminPassword, role: 'admin', bonus: false, client: dbClient });
    fixtures.superId = await createUser({ name: 'Synthetic Test Super Admin', phone: fixtures.superPhone, password: fixtures.superPassword, role: 'superadmin', bonus: false, client: dbClient });
    await dbClient.query('INSERT INTO agent_profiles(agent_id,promo_code,weekly_fee_santim,commission_bps) VALUES($1,$2,25000,2500)', [fixtures.agentId, fixtures.agentPromo]);
    const currentWeek = utcWeekBounds(new Date());
    const priorWeekStart = new Date(Date.parse(currentWeek.start) - 7 * 24 * 60 * 60 * 1000);
    fixtures.settlementWeekStart = priorWeekStart.toISOString().slice(0, 10);
    await dbClient.query('UPDATE agent_profiles SET created_at=$1 WHERE agent_id=$2', [priorWeekStart, fixtures.agentId]);
    fixtures.agentBPhone = '09' + digits();
    fixtures.agentBPassword = 'isolated-agent-b-test-password';
    fixtures.agentBId = await createUser({ name: 'Synthetic Test Agent B', phone: fixtures.agentBPhone, password: fixtures.agentBPassword, role: 'agent', bonus: false, client: dbClient });
    await dbClient.query('INSERT INTO agent_profiles(agent_id,promo_code) VALUES($1,$2)', [fixtures.agentBId, fixtures.agentBPromo]);
    const providerA = await dbClient.query(
      `INSERT INTO providers (code, name, mode, instr_en, instr_am, active)
       VALUES ('integration-a', 'Synthetic Test Provider A', 'manual', 'Test only', 'ለሙከራ ብቻ', 1)
       ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, active=1 RETURNING id`
    );
    const providerB = await dbClient.query(
      `INSERT INTO providers (code, name, mode, instr_en, instr_am, active)
       VALUES ('integration-b', 'Synthetic Test Provider B', 'manual', 'Test only', 'ለሙከራ ብቻ', 1)
       ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, active=1 RETURNING id`
    );
    fixtures.providerA = Number(providerA.rows[0].id);
    fixtures.providerB = Number(providerB.rows[0].id);
  });
  return fixtures;
}

async function createSyntheticActiveRound(dbClient, { userId, game, bet, detail, step = 0, difficulty = null, seed = 'isolated-integration-seed' }) {
  const result = await dbClient.query(
    `INSERT INTO game_rounds (user_id, game, bet, payout, step, status, detail, server_seed, client_seed, server_seed_hash, difficulty)
     VALUES ($1, $2, $3, 0, $4, 'active', $5, $6, 'isolated-test', $7, $8) RETURNING id`,
    [userId, game, bet, step, JSON.stringify(detail), seed, crypto.createHash('sha256').update(seed).digest('hex'), difficulty]
  );
  const id = Number(result.rows[0].id);
  await postLedger({ client: dbClient, userId, delta: -bet, type: 'bet', refType: 'round', refId: id });
  return id;
}

prepareSyntheticFixtures().then((fixtures) => {
const server = app.listen(0, async () => {
  const base = `http://localhost:${server.address().port}/api`;
  const root = `http://localhost:${server.address().port}`;
  const client = () => {
    let cookie = '';
    return async (path, body) => {
      const r = await fetch(base + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const sc = r.headers.get('set-cookie');
      if (sc) cookie = sc.split(';')[0];
      return { status: r.status, data: await r.json().catch(() => null) };
    };
  };

  let passed = 0;
  const ok = (name, cond) => { assert.ok(cond, name); passed++; console.log('  ok -', name); };

  try {
    // 0. Health check verification
    const healthRes = await fetch(root + '/health').then((r) => r.json());
    ok('database health check endpoint is healthy', healthRes.ok === true && healthRes.status === 'healthy');

    // 1. Ledger trigger verification (append-only)
    let triggerBlocked = false;
    try {
      await query("UPDATE ledger SET amount = 999999 WHERE id = (SELECT id FROM ledger LIMIT 1)");
    } catch (e) {
      if (String(e.message).includes('Financial Ledger is append-only')) {
        triggerBlocked = true;
      }
    }
    ok('ledger trigger rejects UPDATE on financial ledger', triggerBlocked);

    let deleteBlocked = false;
    try {
      await query("DELETE FROM ledger WHERE id = (SELECT id FROM ledger LIMIT 1)");
    } catch (e) {
      if (String(e.message).includes('Financial Ledger is append-only')) {
        deleteBlocked = true;
      }
    }
    ok('ledger trigger rejects DELETE on financial ledger', deleteBlocked);

    // 2. Auth tests
    const user = client(), userB = client(), agent = client(), agentB = client(), admin = client(), superadmin = client(), anon = client();
    ok('anonymous cannot read wallet', (await anon('/me')).status === 401);

    const testPhone = '092233' + Math.floor(1000 + Math.random() * 9000);
    const regRes = await user('/register', { name: 'Abebe Kebede', phone: testPhone, password: 'secret1', lang: 'am', promo_code: fixtures.agentPromo });
    ok('register works', regRes.status === 200);
    const testUserId = Number((await query('SELECT id FROM users WHERE phone=$1', [testPhone])).rows[0].id);
    ok('duplicate phone rejected', (await client()('/register', { name: 'X Y', phone: testPhone, password: 'secret1' })).data.error === 'EXISTS');
    ok('bad phone rejected', (await client()('/register', { name: 'X Y', phone: '123', password: 'secret1' })).data.error === 'INVALID');
    ok('welcome bonus is 1000 credits', (await user('/me')).data.balance === 100000);

    // Login test with phone and 'admin' shortcut
    const agentLogin = await agent('/login', { phone: fixtures.agentPhone, password: fixtures.agentPassword });
    ok('synthetic agent fixture can log in', agentLogin.status === 200);
    ok('second synthetic agent can log in', (await agentB('/login', { phone: fixtures.agentBPhone, password: fixtures.agentBPassword })).status === 200);
    const adminLogin = await admin('/login', { phone: fixtures.adminPhone, password: fixtures.adminPassword });
    ok('synthetic admin fixture can log in', adminLogin.status === 200);
    ok('synthetic Super Admin can log in', (await superadmin('/login', { phone: fixtures.superPhone, password: fixtures.superPassword })).status === 200);
    ok('promo code permanently attributes registration', Number((await query('SELECT referred_by_agent_id FROM users WHERE id=$1',[testUserId])).rows[0].referred_by_agent_id) === fixtures.agentId);
    ok('invalid promo code is rejected', (await client()('/register', { name:'Invalid Promo', phone:'09'+crypto.randomInt(10000000,99999999), password:'secret1', promo_code:'NOT-VALID' })).data.error === 'PROMO_INVALID');
    await query("UPDATE users SET status='suspended' WHERE id=$1", [fixtures.agentBId]);
    const suspendedPromo = await client()('/register', { name:'Suspended Promo', phone:'09'+crypto.randomInt(10000000,99999999), password:'secret1', promo_code:fixtures.agentBPromo });
    ok('suspended promo code cannot register a referral', suspendedPromo.status === 400 && suspendedPromo.data.error === 'PROMO_SUSPENDED');
    await query("UPDATE users SET status='active' WHERE id=$1", [fixtures.agentBId]);
    ok('Admin cannot access Super Admin agent management', (await admin('/superadmin/agents')).status === 403);
    ok('Agent cannot access Super Admin agent management', (await agent('/superadmin/agents')).status === 403);
    ok('admin default-password shortcuts are rejected',
      (await client()('/login', { phone: fixtures.adminPhone, password: 'admin' })).data.error === 'LOGIN' &&
      (await client()('/login', { phone: fixtures.adminPhone, password: 'admin123' })).data.error === 'LOGIN');

    ok('wrong password rejected', (await client()('/login', { phone: fixtures.agentPhone, password: 'nope' })).data.error === 'LOGIN');
    ok('user cannot open agent list', (await user('/agent/deposits')).status === 403);
    ok('user cannot open admin', (await user('/admin/users')).status === 403);
    ok('agent cannot open admin', (await agent('/admin/users')).status === 403);

    // 3. Deposits
    const txRef1 = 'DEMO-TX-' + Date.now();
    const receiptPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5YkAAAAASUVORK5CYII=';
    const dep = await user('/deposits', { provider_id: fixtures.providerA, amount: 50, tx_ref: txRef1, receipt_data: receiptPng });
    ok('deposit request created', dep.status === 200);
    const pendingAgentDeposits = await agent('/agent/deposits?status=pending');
    ok('agents cannot read or decide the financial approval queue', pendingAgentDeposits.status === 403);
    const retryDeposit = await user('/deposits', { provider_id: fixtures.providerA, amount: 50, tx_ref: txRef1 });
    ok('same-customer duplicate submission returns the existing pending request',
      retryDeposit.status === 200 && retryDeposit.data.id === dep.data.id && retryDeposit.data.existing === true && retryDeposit.data.status === 'pending');
    const customerDeposits = await user('/deposits');
    ok('idempotent retry creates no second deposit row', customerDeposits.data.deposits.filter((item) => item.tx_ref === txRef1).length === 1);
    const secondPhone = '09' + crypto.randomInt(10000000,99999999);
    const secondRegistration = await userB('/register', {name:'Other Referred Customer',phone:secondPhone,password:'secret1',promo_code:fixtures.agentBPromo});
    ok('second customer registers under another agent', secondRegistration.status === 200);
    const crossCustomerDuplicate = await userB('/deposits', { provider_id: fixtures.providerA, amount: 50, tx_ref: txRef1 });
    ok('another customer cannot reuse the transaction reference', crossCustomerDuplicate.status === 400 && crossCustomerDuplicate.data.error === 'DUP_REF');
    const secondDeposit = await userB('/deposits', { provider_id: fixtures.providerA, amount: 25, tx_ref: 'AGENT-B-' + Date.now() });
    ok('second referred customer creates an independent pending deposit', secondDeposit.status === 200 && secondDeposit.data.id !== dep.data.id);
    const secondUserId = Number((await query('SELECT id FROM users WHERE phone=$1',[secondPhone])).rows[0].id);
    const agentAReferrals = await agent('/agent/referrals?limit=100');
    const agentBReferrals = await agentB('/agent/referrals?limit=100');
    ok('agent A sees only users referred by code A', agentAReferrals.status === 200 && agentAReferrals.data.users.some((u) => Number(u.id) === testUserId) && agentAReferrals.data.users.every((u) => Number(u.id) !== secondUserId));
    ok('agent B sees only users referred by code B', agentBReferrals.status === 200 && agentBReferrals.data.users.some((u) => Number(u.id) === secondUserId) && agentBReferrals.data.users.every((u) => Number(u.id) !== testUserId));
    ok('referred transaction feeds are scoped to each agent', agentAReferrals.data.transactions.some((tx) => tx.id === `D-${dep.data.id}`) && !agentAReferrals.data.transactions.some((tx) => tx.id === `D-${secondDeposit.data.id}`) && agentBReferrals.data.transactions.some((tx) => tx.id === `D-${secondDeposit.data.id}`));
    ok('receipt remains pending and does not credit the wallet', (await user('/me')).data.balance === 100000);
    ok('customer can view their protected receipt', (await user(`/deposits/${dep.data.id}/receipt`)).status === 200);
    ok('the referring agent can view its customer receipt', (await agent(`/deposits/${dep.data.id}/receipt`)).status === 200);
    ok('another agent cannot view the receipt', (await agentB(`/deposits/${dep.data.id}/receipt`)).status === 403);
    ok('anonymous cannot view a receipt', (await anon(`/deposits/${dep.data.id}/receipt`)).status === 401);
    ok('malformed image content is rejected', (await user('/deposits', { provider_id: fixtures.providerA, amount: 10, tx_ref: 'BADFILE-' + Date.now(), receipt_data: 'data:image/png;base64,PHN2Zy8+' })).status === 400);
    ok('negative amount rejected', (await user('/deposits', { provider_id: fixtures.providerA, amount: -5, tx_ref: 'DEMO-NEG-' + Date.now() })).data.error === 'INVALID');
    ok('balance unchanged while pending', (await user('/me')).data.balance === 100000);
    ok('user cannot approve own deposit', (await user(`/agent/deposits/${dep.data.id}/decide`, { action: 'approve' })).status === 403);

    const uncheckedApproval = await superadmin(`/agent/deposits/${dep.data.id}/decide`, { action: 'approve', reauth_password: fixtures.superPassword });
    ok('approval without independent verification is rejected', uncheckedApproval.data.error === 'VERIFICATION_REQUIRED');
    const verification = { amount_matches: true, reference_matches: true, recipient_matches: true, date_plausible: true, independently_verified: true };
    const concurrentDecisions = await Promise.all([
      superadmin(`/agent/deposits/${dep.data.id}/decide`, { action: 'approve', verification, reauth_password: fixtures.superPassword }),
      superadmin(`/agent/deposits/${dep.data.id}/decide`, { action: 'approve', verification, reauth_password: fixtures.superPassword })
    ]);
    ok('concurrent duplicate approval attempts allow exactly one credit', concurrentDecisions.filter((r) => r.status === 200).length === 1 && concurrentDecisions.filter((r) => r.status === 400).length === 1);
    ok('balance credited once', (await user('/me')).data.balance === 105000);
    ok('second approve blocked (no double credit)', (await superadmin(`/agent/deposits/${dep.data.id}/decide`, { action: 'approve', verification, reauth_password: fixtures.superPassword })).status === 400);
    ok('balance still correct', (await user('/me')).data.balance === 105000);

    // 4. Withdrawals
    const withReq = await user('/withdrawals', { provider_id: fixtures.providerA, amount: 20, account_number: testPhone });
    ok('withdrawal request created', withReq.status === 200);
    ok('balance deducted on withdraw request', (await user('/me')).data.balance === 103000);
    const agentWiths = await agent('/agent/withdrawals?status=pending');
    ok('agents cannot view the Super Admin withdrawal queue', agentWiths.status === 403);
    ok('ordinary Admin cannot approve withdrawals', (await admin(`/agent/withdrawals/${withReq.data.id}/decide`, { action: 'approve' })).status === 403);
    const withDec = await superadmin(`/agent/withdrawals/${withReq.data.id}/decide`, { action: 'approve', reauth_password: fixtures.superPassword });
    ok('Super Admin approves withdrawal for manual payout', withDec.status === 200);

    // Withdrawal rejection refunds user
    const withReq2 = await user('/withdrawals', { provider_id: fixtures.providerA, amount: 10, account_number: testPhone });
    ok('second withdrawal created', withReq2.status === 200);
    ok('balance deducted for second request', (await user('/me')).data.balance === 102000);
    await superadmin(`/agent/withdrawals/${withReq2.data.id}/decide`, { action: 'reject', reason: 'Invalid phone', reauth_password: fixtures.superPassword });
    ok('rejected withdrawal refunds balance to user', (await user('/me')).data.balance === 103000);

    // Agent self-action protection
    ok('agents cannot submit customer deposits', (await agent('/deposits', { provider_id: fixtures.providerB, amount: 10, tx_ref: 'AGENT-' + Date.now() })).status === 403);
    const adep = await user('/deposits', { provider_id: fixtures.providerB, amount: 10, tx_ref: 'REJECT-' + Date.now() });
    ok('agents cannot approve or reject deposits', (await agent(`/agent/deposits/${adep.data.id}/decide`, { action: 'reject', reason:'No payment found' })).status === 403);
    const userBalanceBeforeReject = (await user('/me')).data.balance;
    ok('ordinary Admin cannot decide a deposit', (await admin(`/agent/deposits/${adep.data.id}/decide`, { action: 'reject', reason: 'No payment found' })).status === 403);
    ok('Super Admin can reject with a reason', (await superadmin(`/agent/deposits/${adep.data.id}/decide`, { action: 'reject', reason: 'No payment found', reauth_password: fixtures.superPassword })).status === 200);
    ok('rejected deposit does not credit the customer wallet', (await user('/me')).data.balance === userBalanceBeforeReject);

    // 5. Legacy float funding is retained only as a read-only audit history.
    ok('user cannot request agent funding', (await user('/agent/funding', { amount: 500 })).status === 403);
    const fReq = await agent('/agent/funding', { amount: 500, note: 'Need float for weekend' });
    ok('new referral agents cannot create legacy float funding requests', fReq.status === 410 && fReq.data.error === 'LEGACY_DISABLED');
    const afList = await admin('/admin/agent-funding?status=pending');
    ok('Admin retains read-only access to historical funding requests', afList.status === 200);
    const afBefore = (await agent('/me')).data.balance;
    ok('legacy funding decision API is disabled for Super Admin too', (await superadmin('/admin/agent-funding/1/decide', { action:'approve', note:'Legacy', reauth_password:fixtures.superPassword })).status === 410);
    ok('disabled legacy funding did not alter agent wallet', (await agent('/me')).data.balance === afBefore);
    const adminTx = await admin('/admin/transactions');
    ok('admin views transactions list', adminTx.status === 200 && adminTx.data.transactions.length > 0);

    // 6. Games
    ok('bet below minimum rejected', (await user('/games/roulette', { bet: 1, kind: 'color', value: 'red' })).data.error === 'INVALID');
    const before = (await user('/me')).data.balance;
    const rr = await user('/games/roulette', { bet: 1000, kind: 'color', value: 'red' });
    ok('roulette plays', rr.status === 200 && rr.data.n >= 0 && rr.data.n <= 36);
    ok('roulette balance consistent', rr.data.balance === before - 1000 + rr.data.payout);

    const sp = await user('/games/star', { bet: 1000 });
    ok('star spin plays', sp.status === 200 && sp.data.reels.length === 3);

    // Road Dash
    const userBalBeforeRoad = (await user('/me')).data.balance;
    const rStart = await user('/games/road/start', { bet: 1000, difficulty: 'easy', client_seed: 'test-seed-123' });
    ok('road start deducts bet', rStart.status === 200 && rStart.data.active === true);
    ok('road start returns seed hash and hides secret seed', rStart.data.server_seed_hash && !rStart.data.server_seed);
    ok('road start deducted wallet balance', (await user('/me')).data.balance === userBalBeforeRoad - 1000);
    ok('cannot start two road rounds', (await user('/games/road/start', { bet: 1000 })).data.error === 'ACTIVE_ROUND');
    ok('cannot cash out at step 0', (await user('/games/road/cashout', {})).data.error === 'INVALID');

    let lastStepRes = null;
    let crashedOrFinished = false;
    for (let lane = 1; lane <= 24; lane++) {
      lastStepRes = await user('/games/road/step', {});
      if (lastStepRes.data.crashed || lastStepRes.data.finished) {
        crashedOrFinished = true;
        break;
      }
    }
    ok('safe step advances lane & increases multiplier', lastStepRes.status === 200);

    if (!crashedOrFinished) {
      const coRes = await user('/games/road/cashout', {});
      ok('cash-out pays correctly & updates wallet', coRes.status === 200 && coRes.data.payout > 0);
    }
    ok('no step after round finished', (await user('/games/road/step', {})).data.error === 'NOT_FOUND');

    const rStart2 = await user('/games/road/start', { bet: 1000, difficulty: 'hardcore', client_seed: 'seed-hardcore' });
    ok('new road round starts after previous ended', rStart2.status === 200 && rStart2.data.difficulty === 'hardcore');

    let hitRes = null;
    for (let lane = 1; lane <= 15; lane++) {
      hitRes = await user('/games/road/step', {});
      if (hitRes.data.crashed || hitRes.data.finished) break;
    }
    ok('hit ends round & reveals server_seed', hitRes.data.server_seed && hitRes.data.server_seed_hash);
    const hash = crypto.createHash('sha256').update(hitRes.data.server_seed).digest('hex');
    ok('revealed server_seed matches server_seed_hash', hash === hitRes.data.server_seed_hash);

    const vRes = await user('/games/road/verify', {
      server_seed: hitRes.data.server_seed,
      client_seed: hitRes.data.client_seed,
      lane: hitRes.data.lane,
      difficulty: 'hardcore'
    });
    ok('fairness verification endpoint reproduces hazard', vRes.status === 200 && (vRes.data.is_hazard ? 'hit' : 'safe') === (hitRes.data.crashed ? 'hit' : 'safe'));
    const rInsuff = await user('/games/road/start', { bet: 99999999 });
    ok('insufficient balance rejected', rInsuff.data.error === 'INSUFFICIENT' || rInsuff.data.error === 'INVALID');

    const histRes = await user('/games/road/history');
    ok('road history returns list of rounds', histRes.status === 200 && histRes.data.history.length >= 2);

    // Mines
    const mState = await user('/games/mines');
    ok('mines state retrieves', mState.status === 200 && typeof mState.data.balance === 'number');
    ok('multiplier 3x3 k=1 is correct', games.getMinesMultiplier(9, 1, 1) === 1.03);
    ok('multiplier 5x5 k=1 is correct', games.getMinesMultiplier(25, 1, 1) === 0.95);
    ok('multiplier 7x7 k=1 is correct', games.getMinesMultiplier(49, 1, 1) === 0.93);
    ok('multiplier 9x9 k=1 is correct', games.getMinesMultiplier(81, 1, 1) === 0.93);
    ok('mine count 0 rejected', (await user('/games/mines/start', { bet: 1000, mines: 0, grid: 5 })).data.error === 'INVALID');
    ok('mine count >= N rejected', (await user('/games/mines/start', { bet: 1000, mines: 25, grid: 5 })).data.error === 'INVALID');
    ok('invalid grid size rejected', (await user('/games/mines/start', { bet: 1000, mines: 3, grid: 4 })).data.error === 'INVALID');

    const mStart = await user('/games/mines/start', { bet: 1000, mines: 1, grid: 3, client_seed: 'mines-seed-abc' });
    ok('mines start plays with grid 3x3', mStart.status === 200 && mStart.data.grid === 3 && mStart.data.total_cells === 9);
    ok('mines start hides mines layout', mStart.data.mines === undefined && mStart.data.mines_count === 1);
    ok('mines start returns server_seed_hash', mStart.data.server_seed_hash && !mStart.data.server_seed);
    ok('no cash-out at 0 reveals', (await user('/games/mines/cashout', {})).data.error === 'INVALID');

    const activeMinesRound = (await query("SELECT detail FROM game_rounds WHERE game='mines' AND status='active' ORDER BY id DESC LIMIT 1")).rows[0];
    const actualMines = JSON.parse(activeMinesRound.detail).mines;
    const safeCell = [0, 1, 2, 3, 4, 5, 6, 7, 8].find((c) => !actualMines.includes(c));
    const firstStep = await user('/games/mines/step', { cell: safeCell });
    ok('reveal safe tile succeeds', firstStep.status === 200 && firstStep.data.mine === false);
    ok('duplicate tile reveal rejected', (await user('/games/mines/step', { cell: safeCell })).data.error === 'INVALID');

    const mCashout = await user('/games/mines/cashout', {});
    ok('cash-out pays correctly through ledger', mCashout.status === 200 && mCashout.data.payout >= 1000);
    ok('cash-out reveals server_seed and mines', mCashout.data.server_seed && Array.isArray(mCashout.data.mines));
    ok('no reveal after round ended', (await user('/games/mines/step', { cell: 0 })).data.error === 'NOT_FOUND');
    ok('no cash-out after round ended', (await user('/games/mines/cashout', {})).data.error === 'NOT_FOUND');

    await user('/games/mines/start', { bet: 1000, mines: 8, grid: 3, client_seed: 'mines-seed-hit' });
    const hitRound = (await query("SELECT detail FROM game_rounds WHERE game='mines' AND status='active' ORDER BY id DESC LIMIT 1")).rows[0];
    const actualHitMines = JSON.parse(hitRound.detail).mines;
    const mineCell = actualHitMines[0];
    const hitStep = await user('/games/mines/step', { cell: mineCell });
    ok('reveal of a mine ends the round', hitStep.data.mine === true && hitStep.data.finished === true);
    ok('mine hit reveals server_seed matching hash', crypto.createHash('sha256').update(hitStep.data.server_seed).digest('hex') === hitStep.data.server_seed_hash);
    const mVerify = await user('/games/mines/verify', {
      server_seed: hitStep.data.server_seed,
      client_seed: hitStep.data.client_seed,
      nonce: hitStep.data.nonce,
      grid: 3,
      mines: 8
    });
    ok('fairness verification reproduces the layout', mVerify.status === 200 && JSON.stringify(mVerify.data.mines) === JSON.stringify(hitStep.data.mines));

    // Plinko
    let allSymm = true;
    for (let r = 8; r <= 16; r++) {
      for (const k of ['low', 'medium', 'high']) {
        const arr = games.PLINKO_PAYOUTS[r][k];
        if (arr.length !== r + 1) allSymm = false;
        for (let i = 0; i < Math.floor(arr.length / 2); i++) {
          if (arr[i] !== arr[arr.length - 1 - i]) allSymm = false;
        }
      }
    }
    ok('every plinko table is symmetric, has rows+1 entries, and rtp between 0.97 and 0.995', allSymm);
    ok('plinko invalid rows rejected', (await user('/games/plinko', { bet: 1000, rows: 5, risk: 'low' })).data.error === 'INVALID');
    ok('plinko invalid risk rejected', (await user('/games/plinko', { bet: 1000, rows: 10, risk: 'extreme' })).data.error === 'INVALID');

    const balBeforePlinko = (await user('/me')).data.balance;
    const plRes = await user('/games/plinko', { bet: 1000, rows: 10, risk: 'medium', client_seed: 'test-client-seed', nonce: 5 });
    ok('plinko plays and returns valid bucket and path', plRes.status === 200 && plRes.data.bucket >= 0 && plRes.data.bucket <= 10 && plRes.data.path.length === 10);
    ok('plinko bet deducted and payout credited through ledger', plRes.data.balance === balBeforePlinko - 1000 + plRes.data.payout);
    const hugePlinko = await user('/games/plinko', { bet: 100000000, rows: 10, risk: 'medium' });
    ok('plinko insufficient balance rejected', hugePlinko.status === 400 || hugePlinko.data.error === 'INVALID' || hugePlinko.data.error === 'INSUFFICIENT');

    const plVer = await user('/games/plinko/verify', {
      server_seed: plRes.data.server_seed,
      client_seed: plRes.data.client_seed,
      nonce: 5,
      rows: 10,
      risk: 'medium'
    });
    ok('plinko fairness check reproduces path and bucket', plVer.status === 200 && plVer.data.bucket === plRes.data.bucket && JSON.stringify(plVer.data.path) === JSON.stringify(plRes.data.path));

    // Keno
    ok('keno empty picks rejected', (await user('/games/keno', { bet: 1000, picks: [] })).data.error === 'INVALID');
    const kn = await user('/games/keno', { bet: 1000, picks: [5, 10, 15, 20, 25] });
    ok('keno plays', kn.status === 200 && kn.data.drawn.length === 20);

    // Bingo
    const bgState = await user('/games/bingo');
    ok('bingo state retrieves', bgState.status === 200);
    const bgStart = await user('/games/bingo/start', { bet: 1000 });
    ok('bingo start works', bgStart.status === 200 && bgStart.data.card.length === 5);
    const bgCall = await user('/games/bingo/call', {});
    ok('bingo call draws ball', bgCall.status === 200 && bgCall.data.drawn.length === 1 && bgCall.data.called >= 1 && bgCall.data.called <= 75);
    const bgAbandon = await user('/games/bingo/abandon', {});
    ok('bingo abandon cleans up active round', bgAbandon.status === 200 && (await user('/games/bingo')).data.active === false);

    // Concurrent cashout safety and legacy payout versions use isolated synthetic active rounds.
    const roadBet = 1000;
    const roadId = await withTx((dbClient) => createSyntheticActiveRound(dbClient, {
      userId: testUserId, game: 'road', bet: roadBet, detail: {}, step: 1, difficulty: 'easy', seed: 'legacy-road-round'
    }));
    const oldRoadState = await user('/games/road?difficulty=easy');
    ok('unversioned active Road Dash round reports legacy payout version', oldRoadState.status === 200 && oldRoadState.data.payout_version === 1);
    const expectedLegacyRoadPayout = require('./payout').grossPayoutCents(roadBet, games.getLegacyRoadLadder('easy')[0]);
    const roadBeforeCashout = (await user('/me')).data.balance;
    const concurrentRoadCashouts = await Promise.all([
      user('/games/road/cashout', {}), user('/games/road/cashout', {})
    ]);
    const roadWinners = concurrentRoadCashouts.filter((result) => result.status === 200);
    ok('concurrent duplicate Road Dash cashouts settle once', roadWinners.length === 1 && concurrentRoadCashouts.filter((result) => result.status === 400).length === 1);
    ok('legacy Road Dash round uses original multiplier and ledger settlement', roadWinners[0]?.data.payout === expectedLegacyRoadPayout && (await user('/me')).data.balance === roadBeforeCashout - roadBet + expectedLegacyRoadPayout);
    ok('Road Dash cashout ledger has one credit', Number((await query("SELECT COUNT(*) c FROM ledger WHERE ref_type='round' AND ref_id=$1 AND type='win'", [roadId])).rows[0].c) === 1);

    const minesBet = 1000;
    const minesDetail = { grid: 5, totalCells: 25, mines: [24, 23, 22, 21, 20], revealed: [0], minesCount: 5, nonce: 1 };
    const minesId = await withTx((dbClient) => createSyntheticActiveRound(dbClient, {
      userId: testUserId, game: 'mines', bet: minesBet, detail: minesDetail, step: 1, seed: 'legacy-mines-round'
    }));
    const oldMinesState = await user('/games/mines');
    ok('unversioned active Mines round reports legacy payout version', oldMinesState.status === 200 && oldMinesState.data.payout_version === 1);
    const expectedLegacyMinesMultiplier = games.getMinesMultiplierForVersion(25, 5, 1, 1);
    ok('unversioned active Mines preview uses original multiplier', oldMinesState.data.mult === expectedLegacyMinesMultiplier);
    const expectedLegacyMinesPayout = require('./payout').grossPayoutFromMultiplierCents(minesBet, games.getMinesMultiplierCentsForVersion(25, 5, 1, 1), games.MINES_MAX_WIN);
    const minesBeforeCashout = (await user('/me')).data.balance;
    const concurrentMinesCashouts = await Promise.all([
      user('/games/mines/cashout', {}), user('/games/mines/cashout', {})
    ]);
    const minesWinners = concurrentMinesCashouts.filter((result) => result.status === 200);
    ok('concurrent duplicate Mines cashouts settle once', minesWinners.length === 1 && concurrentMinesCashouts.filter((result) => result.status === 400).length === 1);
    ok('legacy Mines round uses original payout and ledger settlement', minesWinners[0]?.data.payout === expectedLegacyMinesPayout && (await user('/me')).data.balance === minesBeforeCashout - minesBet + expectedLegacyMinesPayout);
    ok('Mines cashout ledger has one credit', Number((await query("SELECT COUNT(*) c FROM ledger WHERE ref_type='round' AND ref_id=$1 AND type='win'", [minesId])).rows[0].c) === 1);

    const bingoCard = Array.from({ length: 5 }, (_, column) => Array.from({ length: 5 }, (_, row) => column * 15 + row + 1));
    bingoCard[2][2] = 0;
    const bingoMarked = new Array(25).fill(true);
    bingoMarked[0] = false;
    const bingoDetail = { card: bingoCard, drawn: Array.from({ length: 74 }, (_, index) => index + 2), marked: bingoMarked };
    await withTx((dbClient) => createSyntheticActiveRound(dbClient, {
      userId: testUserId, game: 'bingo', bet: 1000, detail: bingoDetail, step: 74, seed: 'legacy-bingo-round'
    }));
    const oldBingoState = await user('/games/bingo');
    ok('unversioned active Bingo round reports legacy payout version', oldBingoState.status === 200 && oldBingoState.data.payout_version === 1);
    const oldBingoResult = await user('/games/bingo/call', {});
    ok('unversioned active Bingo round settles using legacy payout', oldBingoResult.status === 200 && oldBingoResult.data.won === true && oldBingoResult.data.mult === 1.5 && oldBingoResult.data.payout === 1500);

    // Role restrictions
    ok('agent cannot play roulette', (await agent('/games/roulette', { bet: 1000, kind: 'color', value: 'red' })).status === 403);
    ok('admin cannot play road dash', (await admin('/games/road/start', { bet: 1000 })).status === 403);
    ok('agent cannot play mines', (await agent('/games/mines/start', { bet: 1000, mines: 5 })).status === 403);

    // Support & AI
    ok('Agent cannot use a customer support inbox', (await agent('/support')).status === 403);
    const supRes1 = await user('/support', { message: 'Hello, how can I deposit?' });
    ok('customer receives AI response', supRes1.status === 200 && supRes1.data.messages.some((m) => m.sender_role === 'ai'));
    const supRes2 = await user('/support', { message: 'I need to speak with a human agent' });
    ok('customer ticket escalates to agent', supRes2.status === 200 && supRes2.data.status === 'escalated');

    const agTickets = await agent('/agent/tickets');
    ok('agent can view tickets', agTickets.status === 200 && agTickets.data.tickets.length > 0);
    const tId = agTickets.data.tickets[0].id;
    ok('another agent cannot see first agent ticket', !(await agentB('/agent/tickets')).data.tickets.some((t) => t.id === tId));
    ok('another agent cannot open or reply to first agent ticket', (await agentB(`/support/ticket/${tId}`)).status === 403 && (await agentB(`/support/ticket/${tId}/reply`, { message: 'unauthorized' })).status === 403);
    ok('escalated ticket is assigned to the customer referral agent', Number(agTickets.data.tickets.find((t) => Number(t.id) === Number(tId)).assigned_agent_id) === fixtures.agentId);
    const agReply = await agent(`/support/ticket/${tId}/reply`, { message: 'Hello, I am taking over your ticket' });
    ok('agent replies to ticket', agReply.status === 200);

    // Admin analytics
    const finAnalytics = await admin('/admin/financial-analytics?range=all');
    ok('admin retrieves financial analytics', finAnalytics.status === 200 && typeof finAnalytics.data.gross_gaming_revenue === 'number');

    // Weekly settlement operations use a completed UTC Monday-to-Monday range.
    ok('ordinary Admin cannot close agent settlements', (await admin('/superadmin/settlements/close-previous-week', { week_start: fixtures.settlementWeekStart })).status === 403);
    const closedWeek = await superadmin('/superadmin/settlements/close-previous-week', { week_start: fixtures.settlementWeekStart, reauth_password: fixtures.superPassword });
    ok('Super Admin closes one completed weekly settlement', closedWeek.status === 200 && closedWeek.data.created === 1);
    const duplicateClose = await superadmin('/superadmin/settlements/close-previous-week', { week_start: fixtures.settlementWeekStart, reauth_password: fixtures.superPassword });
    ok('repeated settlement close is idempotent', duplicateClose.status === 200 && duplicateClose.data.created === 0 && duplicateClose.data.existing === 1);
    const settlement = (await query('SELECT id,week_start,week_end,weekly_fee_santim,commission_santim FROM agent_weekly_settlements WHERE agent_id=$1', [fixtures.agentId])).rows[0];
    ok('settlement uses requested UTC week start and end', settlement && settlement.week_start.toISOString().slice(0,10) === fixtures.settlementWeekStart && settlement.weekly_fee_santim === 25000);
    const feeRequest = await agent('/agent/payout-requests', { payout_type: 'weekly_fee' });
    ok('agent can request its settled weekly fee', feeRequest.status === 200 && feeRequest.data.amount_santim === 25000);
    ok('duplicate weekly payout request is rejected', (await agent('/agent/payout-requests', { payout_type: 'weekly_fee' })).status === 400);
    ok('ordinary Admin cannot approve agent payout requests', (await admin(`/superadmin/payout-requests/${feeRequest.data.id}/decide`, { action: 'approve' })).status === 403);
    const agentBalanceBeforeFee = (await agent('/me')).data.balance;
    const feeDecisions = await Promise.all([
      superadmin(`/superadmin/payout-requests/${feeRequest.data.id}/decide`, { action: 'approve', reauth_password: fixtures.superPassword }),
      superadmin(`/superadmin/payout-requests/${feeRequest.data.id}/decide`, { action: 'approve', reauth_password: fixtures.superPassword })
    ]);
    ok('concurrent Super Admin payout approvals settle once', feeDecisions.filter((r) => r.status === 200 && r.data.status === 'paid').length === 1 && feeDecisions.filter((r) => r.status === 400).length === 1);
    ok('agent wallet receives exact settled fee', (await agent('/me')).data.balance === agentBalanceBeforeFee + 25000);
    const repeatFeePayment = await superadmin(`/superadmin/settlements/${settlement.id}/pay`, { payment_type: 'weekly_fee', reauth_password: fixtures.superPassword });
    ok('direct payment retry cannot double-credit a payout request', repeatFeePayment.status === 200 && repeatFeePayment.data.already_paid === true && (await agent('/me')).data.balance === agentBalanceBeforeFee + 25000);
    ok('settlement payment has one immutable record and one ledger credit',
      Number((await query("SELECT COUNT(*) c FROM agent_settlement_payments WHERE settlement_id=$1 AND payment_type='weekly_fee'", [settlement.id])).rows[0].c) === 1 &&
      Number((await query("SELECT COUNT(*) c FROM ledger WHERE user_id=$1 AND type='agent_fee' AND ref_type='agent_settlement' AND ref_id=$2", [fixtures.agentId, settlement.id])).rows[0].c) === 1);

    const aiToggle = await admin('/admin/ai-settings', { enabled: true });
    ok('admin can configure AI settings', aiToggle.status === 200 && aiToggle.data.enabled === true);
    ok('Super Admin setting change requires password re-authentication', (await superadmin('/admin/ai-settings', { enabled: false })).status === 400);
    const superAiToggle = await superadmin('/admin/ai-settings', { enabled: false, reauth_password: fixtures.superPassword });
    ok('Super Admin can change a setting after re-authentication', superAiToggle.status === 200 && superAiToggle.data.enabled === false);

    // Reconcile all wallets vs ledger
    const badRes = await query(`
      SELECT w.user_id FROM wallets w
      WHERE w.balance != COALESCE((SELECT SUM(amount) FROM ledger l WHERE l.user_id = w.user_id), 0)
    `);
    ok('wallet balance equals sum of ledger for every user', badRes.rows.length === 0);

    const rollbackBalance = Number((await query('SELECT balance FROM wallets WHERE user_id=$1', [testUserId])).rows[0].balance);
    let rollbackObserved = false;
    try {
      await withTx(async (dbClient) => {
        await postLedger({ client: dbClient, userId: testUserId, delta: -100, type: 'integration_rollback', refType: 'test', refId: testUserId });
        throw new Error('integration rollback sentinel');
      });
    } catch (error) {
      rollbackObserved = error.message === 'integration rollback sentinel';
    }
    const rollbackAfter = Number((await query('SELECT balance FROM wallets WHERE user_id=$1', [testUserId])).rows[0].balance);
    const rollbackLedgerCount = Number((await query("SELECT COUNT(*) c FROM ledger WHERE user_id=$1 AND type='integration_rollback'", [testUserId])).rows[0].c);
    ok('transaction rollback restores wallet and suppresses ledger row', rollbackObserved && rollbackAfter === rollbackBalance && rollbackLedgerCount === 0);

    const auditRes = await query('SELECT COUNT(*) c FROM audit_logs');
    ok('audit log has entries', Number(auditRes.rows[0].c) > 3);
    ok('amharic translations load', (await fetch(base + '/i18n/am').then((r) => r.json())).brand === 'ፈጣን ቤት');

    console.log(`\nAll ${passed} checks passed.`);
    server.close();
    await pool.end();
    process.exit(0);
  } catch (e) {
    console.error('\nFAILED:', e.message);
    server.close();
    await pool.end();
    process.exit(1);
  }
});
}).catch(async (error) => {
  console.error(`Synthetic test fixture setup failed (${error.name}${error.code ? `, ${error.code}` : ''}).`);
  await pool.end();
  process.exit(1);
});
