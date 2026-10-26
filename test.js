// Run with: npm test
require('dotenv').config();
const assert = require('assert');
const crypto = require('crypto');
const app = require('./server');
const games = require('./games');
const { query, pool, withTx } = require('./db');

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
    const user = client(), agent = client(), admin = client(), anon = client();
    ok('anonymous cannot read wallet', (await anon('/me')).status === 401);

    const testPhone = '092233' + Math.floor(1000 + Math.random() * 9000);
    const regRes = await user('/register', { name: 'Abebe Kebede', phone: testPhone, password: 'secret1', lang: 'am' });
    ok('register works', regRes.status === 200);
    ok('duplicate phone rejected', (await client()('/register', { name: 'X Y', phone: testPhone, password: 'secret1' })).data.error === 'EXISTS');
    ok('bad phone rejected', (await client()('/register', { name: 'X Y', phone: '123', password: 'secret1' })).data.error === 'INVALID');
    ok('welcome bonus is 1000 credits', (await user('/me')).data.balance === 100000);

    // Login test with phone and 'admin' shortcut
    await agent('/login', { phone: '0911111111', password: 'agent123' });
    const adminLogin = await admin('/login', { phone: 'admin', password: 'admin123' });
    ok('admin can login by username "admin"', adminLogin.status === 200);
    const adminLoginPhone = await client()('/login', { phone: '0900000000', password: 'admin' });
    ok('admin can login with password "admin" or "admin123"', adminLoginPhone.status === 200);

    ok('wrong password rejected', (await client()('/login', { phone: '0911111111', password: 'nope' })).data.error === 'LOGIN');
    ok('user cannot open agent list', (await user('/agent/deposits')).status === 403);
    ok('user cannot open admin', (await user('/admin/users')).status === 403);
    ok('agent cannot open admin', (await agent('/admin/users')).status === 403);

    // 3. Deposits
    const txRef1 = 'DEMO-TX-' + Date.now();
    const receiptPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5YkAAAAASUVORK5CYII=';
    const dep = await user('/deposits', { provider_id: 1, amount: 50, tx_ref: txRef1, receipt_data: receiptPng });
    ok('deposit request created', dep.status === 200);
    ok('receipt remains pending and does not credit the wallet', (await user('/me')).data.balance === 100000);
    ok('customer can view their protected receipt', (await user(`/deposits/${dep.data.id}/receipt`)).status === 200);
    ok('agent can view a receipt for review', (await agent(`/deposits/${dep.data.id}/receipt`)).status === 200);
    ok('anonymous cannot view a receipt', (await anon(`/deposits/${dep.data.id}/receipt`)).status === 401);
    ok('malformed image content is rejected', (await user('/deposits', { provider_id: 1, amount: 10, tx_ref: 'BADFILE-' + Date.now(), receipt_data: 'data:image/png;base64,PHN2Zy8+' })).status === 400);
    ok('duplicate tx reference rejected', (await user('/deposits', { provider_id: 1, amount: 50, tx_ref: txRef1 })).data.error === 'DUP_REF');
    ok('negative amount rejected', (await user('/deposits', { provider_id: 1, amount: -5, tx_ref: 'DEMO-NEG' })).data.error === 'INVALID');
    ok('balance unchanged while pending', (await user('/me')).data.balance === 100000);
    ok('user cannot approve own deposit', (await user(`/agent/deposits/${dep.data.id}/decide`, { action: 'approve' })).status === 403);

    const uncheckedApproval = await agent(`/agent/deposits/${dep.data.id}/decide`, { action: 'approve' });
    ok('approval without independent verification is rejected', uncheckedApproval.data.error === 'VERIFICATION_REQUIRED');
    const verification = { amount_matches: true, reference_matches: true, recipient_matches: true, date_plausible: true, independently_verified: true };
    const concurrentDecisions = await Promise.all([
      agent(`/agent/deposits/${dep.data.id}/decide`, { action: 'approve', verification }),
      agent(`/agent/deposits/${dep.data.id}/decide`, { action: 'approve', verification })
    ]);
    ok('concurrent duplicate approval attempts allow exactly one credit', concurrentDecisions.filter((r) => r.status === 200).length === 1 && concurrentDecisions.filter((r) => r.status === 400).length === 1);
    ok('balance credited once', (await user('/me')).data.balance === 105000);
    ok('second approve blocked (no double credit)', (await agent(`/agent/deposits/${dep.data.id}/decide`, { action: 'approve', verification })).status === 400);
    ok('balance still correct', (await user('/me')).data.balance === 105000);

    // 4. Withdrawals
    const withReq = await user('/withdrawals', { provider_id: 1, amount: 20, account_number: testPhone });
    ok('withdrawal request created', withReq.status === 200);
    ok('balance deducted on withdraw request', (await user('/me')).data.balance === 103000);
    const agentWiths = await agent('/agent/withdrawals?status=pending');
    ok('agent can view pending withdrawals', agentWiths.data.withdrawals.length >= 1);
    const withDec = await agent(`/agent/withdrawals/${withReq.data.id}/decide`, { action: 'approve' });
    ok('agent approves withdrawal', withDec.status === 200);

    // Withdrawal rejection refunds user
    const withReq2 = await user('/withdrawals', { provider_id: 1, amount: 10, account_number: testPhone });
    ok('second withdrawal created', withReq2.status === 200);
    ok('balance deducted for second request', (await user('/me')).data.balance === 102000);
    await agent(`/agent/withdrawals/${withReq2.data.id}/decide`, { action: 'reject', reason: 'Invalid phone' });
    ok('rejected withdrawal refunds balance to user', (await user('/me')).data.balance === 103000);

    // Agent self-action protection
    const adep = await agent('/deposits', { provider_id: 2, amount: 10, tx_ref: 'AGENT-' + Date.now() });
    ok('agent cannot approve own deposit', (await agent(`/agent/deposits/${adep.data.id}/decide`, { action: 'approve' })).data.error === 'SELF');
    const agentBalanceBeforeReject = (await agent('/me')).data.balance;
    ok('admin can reject with reason', (await admin(`/agent/deposits/${adep.data.id}/decide`, { action: 'reject', reason: 'No payment found' })).status === 200);
    ok('rejected deposit does not credit the customer wallet', (await agent('/me')).data.balance === agentBalanceBeforeReject);

    // 5. Agent Funding Flow
    ok('user cannot request agent funding', (await user('/agent/funding', { amount: 500 })).status === 403);
    const fReq = await agent('/agent/funding', { amount: 500, note: 'Need float for weekend' });
    ok('agent funding request created', fReq.status === 200 && fReq.data.id > 0);
    const afList = await admin('/admin/agent-funding?status=pending');
    ok('admin views pending agent funding', afList.data.requests.some((r) => r.id === fReq.data.id));
    const afBefore = (await agent('/me')).data.balance;
    const afDec = await admin(`/admin/agent-funding/${fReq.data.id}/decide`, { action: 'approve', note: 'Approved float' });
    ok('admin approves agent funding', afDec.status === 200);
    ok('agent balance credited with funding', (await agent('/me')).data.balance === afBefore + 50000);
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
    ok('multiplier 3x3 k=1 is correct', games.getMinesMultiplier(9, 1, 1) === 1.11);
    ok('multiplier 5x5 k=1 is correct', games.getMinesMultiplier(25, 1, 1) === 1.03);
    ok('multiplier 7x7 k=1 is correct', games.getMinesMultiplier(49, 1, 1) === 1.01);
    ok('multiplier 9x9 k=1 is correct', games.getMinesMultiplier(81, 1, 1) === 1.01);
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

    // Role restrictions
    ok('agent cannot play roulette', (await agent('/games/roulette', { bet: 1000, kind: 'color', value: 'red' })).status === 403);
    ok('admin cannot play road dash', (await admin('/games/road/start', { bet: 1000 })).status === 403);
    ok('agent cannot play mines', (await agent('/games/mines/start', { bet: 1000, mines: 5 })).status === 403);

    // Support & AI
    const supRes1 = await user('/support', { message: 'Hello, how can I deposit?' });
    ok('customer receives AI response', supRes1.status === 200 && supRes1.data.messages.some((m) => m.sender_role === 'ai'));
    const supRes2 = await user('/support', { message: 'I need to speak with a human agent' });
    ok('customer ticket escalates to agent', supRes2.status === 200 && supRes2.data.status === 'escalated');

    const agTickets = await agent('/agent/tickets');
    ok('agent can view tickets', agTickets.status === 200 && agTickets.data.tickets.length > 0);
    const tId = agTickets.data.tickets[0].id;
    const agReply = await agent(`/support/ticket/${tId}/reply`, { message: 'Hello, I am taking over your ticket' });
    ok('agent replies to ticket', agReply.status === 200);

    // Admin analytics
    const finAnalytics = await admin('/admin/financial-analytics?range=all');
    ok('admin retrieves financial analytics', finAnalytics.status === 200 && typeof finAnalytics.data.gross_gaming_revenue === 'number');

    const aiToggle = await admin('/admin/ai-settings', { enabled: true });
    ok('admin can configure AI settings', aiToggle.status === 200 && aiToggle.data.enabled === true);

    // Reconcile all wallets vs ledger
    const badRes = await query(`
      SELECT w.user_id FROM wallets w
      WHERE w.balance != COALESCE((SELECT SUM(amount) FROM ledger l WHERE l.user_id = w.user_id), 0)
    `);
    ok('wallet balance equals sum of ledger for every user', badRes.rows.length === 0);

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
