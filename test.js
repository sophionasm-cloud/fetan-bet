// Run with: npm test  (uses a temporary database, your real data.db is untouched)
process.env.DB_PATH = ':memory:';
const assert = require('assert');
const app = require('./server');
const { db } = require('./db');

const server = app.listen(0, async () => {
  const base = `http://localhost:${server.address().port}/api`;
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
      return { status: r.status, data: await r.json() };
    };
  };
  let passed = 0;
  const ok = (name, cond) => { assert.ok(cond, name); passed++; console.log('  ok -', name); };
  try {
    const user = client(), agent = client(), admin = client(), anon = client();
    ok('anonymous cannot read wallet', (await anon('/me')).status === 401);
    ok('register works', (await user('/register', { name: 'Abebe Kebede', phone: '0922334455', password: 'secret1', lang: 'am' })).status === 200);
    ok('duplicate phone rejected', (await client()('/register', { name: 'X Y', phone: '0922334455', password: 'secret1' })).data.error === 'EXISTS');
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

    // Deposits
    const dep = await user('/deposits', { provider_id: 1, amount: 50, tx_ref: 'demo-001' });
    ok('deposit request created', dep.status === 200);
    ok('duplicate tx reference rejected', (await user('/deposits', { provider_id: 1, amount: 50, tx_ref: 'DEMO-001' })).data.error === 'DUP_REF');
    ok('negative amount rejected', (await user('/deposits', { provider_id: 1, amount: -5, tx_ref: 'DEMO-002' })).data.error === 'INVALID');
    ok('balance unchanged while pending', (await user('/me')).data.balance === 100000);
    ok('user cannot approve own deposit', (await user(`/agent/deposits/${dep.data.id}/decide`, { action: 'approve' })).status === 403);

    const dec = await agent(`/agent/deposits/${dep.data.id}/decide`, { action: 'approve' });
    ok('agent approves deposit', dec.status === 200);
    ok('balance credited once', (await user('/me')).data.balance === 105000);
    ok('second approve blocked (no double credit)', (await agent(`/agent/deposits/${dep.data.id}/decide`, { action: 'approve' })).status === 400);
    ok('balance still correct', (await user('/me')).data.balance === 105000);

    // Withdrawals
    const withReq = await user('/withdrawals', { provider_id: 1, amount: 20, account_number: '0922334455' });
    ok('withdrawal request created', withReq.status === 200);
    ok('balance deducted on withdraw request', (await user('/me')).data.balance === 103000);
    const agentWiths = await agent('/agent/withdrawals?status=pending');
    ok('agent can view pending withdrawals', agentWiths.data.withdrawals.length >= 1);
    const withDec = await agent(`/agent/withdrawals/${withReq.data.id}/decide`, { action: 'approve' });
    ok('agent approves withdrawal', withDec.status === 200);

    // Withdrawal rejection refunds user
    const withReq2 = await user('/withdrawals', { provider_id: 1, amount: 10, account_number: '0922334455' });
    ok('second withdrawal created', withReq2.status === 200);
    ok('balance deducted for second request', (await user('/me')).data.balance === 102000);
    await agent(`/agent/withdrawals/${withReq2.data.id}/decide`, { action: 'reject', reason: 'Invalid phone' });
    ok('rejected withdrawal refunds balance to user', (await user('/me')).data.balance === 103000);

    // Agent self-action protection
    const adep = await agent('/deposits', { provider_id: 2, amount: 10, tx_ref: 'AGENT-001' });
    ok('agent cannot approve own deposit', (await agent(`/agent/deposits/${adep.data.id}/decide`, { action: 'approve' })).data.error === 'SELF');
    ok('admin can reject with reason', (await admin(`/agent/deposits/${adep.data.id}/decide`, { action: 'reject', reason: 'No payment found' })).status === 200);

    // Agent Funding Flow (Agent requests from Admin, Admin decides)
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

    // Games
    ok('bet below minimum rejected', (await user('/games/roulette', { bet: 1, kind: 'color', value: 'red' })).data.error === 'INVALID');
    const before = (await user('/me')).data.balance;
    const rr = await user('/games/roulette', { bet: 1000, kind: 'color', value: 'red' });
    ok('roulette plays', rr.status === 200 && rr.data.n >= 0 && rr.data.n <= 36);
    ok('roulette balance consistent', rr.data.balance === before - 1000 + rr.data.payout);

    const sp = await user('/games/star', { bet: 1000 });
    ok('star spin plays', sp.status === 200 && sp.data.reels.length === 3);

    // Road Dash (Chicken Crossing)
    const cryptoMod = require('crypto');
    const userBalBeforeRoad = (await user('/me')).data.balance;
    const rStart = await user('/games/road/start', { bet: 1000, difficulty: 'easy', client_seed: 'test-seed-123' });
    ok('road start deducts bet', rStart.status === 200 && rStart.data.active === true);
    ok('road start returns seed hash and hides secret seed', rStart.data.server_seed_hash && !rStart.data.server_seed);
    ok('road start deducted wallet balance', (await user('/me')).data.balance === userBalBeforeRoad - 1000);
    ok('cannot start two road rounds', (await user('/games/road/start', { bet: 1000 })).data.error === 'ACTIVE_ROUND');
    ok('cannot cash out at step 0', (await user('/games/road/cashout', {})).data.error === 'INVALID');

    // Step through the active round
    let lastStepRes = null;
    let crashedOrFinished = false;
    for (let lane = 1; lane <= 24; lane++) {
      lastStepRes = await user('/games/road/step', {});
      if (lastStepRes.data.crashed || lastStepRes.data.finished) {
        crashedOrFinished = true;
        break;
      }
      if (lane === 1) {
        ok('safe step advances lane & increases multiplier', lastStepRes.data.lane === 1 && lastStepRes.data.multiplier >= 1.01);
        const cashRes = await user('/games/road/cashout', {});
        ok('cash-out pays correctly & updates wallet', cashRes.status === 200 && cashRes.data.payout > 0);
        crashedOrFinished = true;
        break;
      }
    }

    // Attempting to step after round ended should fail
    const postStep = await user('/games/road/step', {});
    ok('no step after round finished', postStep.data.error === 'NOT_FOUND');

    // Start a new round to test hit & seed revelation
    const rStart2 = await user('/games/road/start', { bet: 1000, difficulty: 'hardcore', client_seed: 'provably_fair_test' });
    ok('new road round starts after previous ended', rStart2.status === 200 && rStart2.data.active === true);
    let hitFound = false;
    for (let lane = 1; lane <= 15; lane++) {
      const stepRes = await user('/games/road/step', {});
      if (stepRes.data.crashed) {
        hitFound = true;
        ok('hit ends round & reveals server_seed', stepRes.data.server_seed && stepRes.data.finished === true);
        const sha = cryptoMod.createHash('sha256').update(stepRes.data.server_seed).digest('hex');
        ok('revealed server_seed matches server_seed_hash', sha === stepRes.data.server_seed_hash);

        // Test provably fair verify endpoint
        const ver = await user('/games/road/verify', {
          server_seed: stepRes.data.server_seed,
          client_seed: stepRes.data.client_seed,
          lane: stepRes.data.lane,
          difficulty: 'hardcore'
        });
        ok('fairness verification endpoint reproduces hazard', ver.status === 200 && ver.data.is_hazard === true);
        break;
      } else if (stepRes.data.finished) {
        // Reached end
        ok('auto cashout reached end', stepRes.data.finished === true && stepRes.data.payout > 0);
        break;
      }
    }

    // Insufficient balance test
    const rInsuff = await user('/games/road/start', { bet: 99999999 });
    ok('insufficient balance rejected', rInsuff.data.error === 'INSUFFICIENT' || rInsuff.data.error === 'INVALID');

    // Road history
    const rHist = await user('/games/road/history');
    ok('road history returns list of rounds', rHist.status === 200 && Array.isArray(rHist.data.rounds) && rHist.data.rounds.length > 0);


    // Mines
    const mstate0 = await user('/games/mines');
    ok('mines state retrieves', mstate0.status === 200);
    const mstart = await user('/games/mines/start', { bet: 1000, mines: 5 });
    ok('mines start plays', mstart.status === 200 && mstart.data.active === true);
    const mstep = await user('/games/mines/step', { cell: 0 });
    ok('mines step plays', mstep.status === 200 && (mstep.data.mine === true || mstep.data.mine === false));
    if (!mstep.data.mine) {
      const mco = await user('/games/mines/cashout', {});
      ok('mines cashout works', mco.status === 200 && mco.data.payout > 0);
    }

    // Plinko
    const pk = await user('/games/plinko', { bet: 1000 });
    ok('plinko plays', pk.status === 200 && pk.data.bucket >= 0 && pk.data.bucket <= 10 && Array.isArray(pk.data.steps));

    // Keno
    const knBad = await user('/games/keno', { bet: 1000, picks: [] });
    ok('keno empty picks rejected', knBad.data.error === 'INVALID');
    const kn = await user('/games/keno', { bet: 1000, picks: [3, 7, 12, 25, 42] });
    ok('keno plays', kn.status === 200 && Array.isArray(kn.data.drawn) && kn.data.drawn.length === 20 && typeof kn.data.matched === 'number');

    // Bingo
    const bg0 = await user('/games/bingo');
    ok('bingo state retrieves', bg0.status === 200 && typeof bg0.data.active === 'boolean');
    const bgStart = await user('/games/bingo/start', { bet: 1000 });
    ok('bingo start works', bgStart.status === 200 && Array.isArray(bgStart.data.card) && bgStart.data.card.length === 5);
    const bgCall = await user('/games/bingo/call', {});
    ok('bingo call draws ball', bgCall.status === 200 && bgCall.data.drawn.length === 1 && bgCall.data.called >= 1 && bgCall.data.called <= 75);
    const bgAbandon = await user('/games/bingo/abandon', {});
    ok('bingo abandon cleans up active round', bgAbandon.status === 200 && (await user('/games/bingo')).data.active === false);

    // Role restriction: Agents and Admins CANNOT play games!
    ok('agent cannot play roulette', (await agent('/games/roulette', { bet: 1000, kind: 'color', value: 'red' })).status === 403);
    ok('admin cannot play road dash', (await admin('/games/road/start', { bet: 1000 })).status === 403);
    ok('agent cannot play mines', (await agent('/games/mines/start', { bet: 1000, mines: 5 })).status === 403);

    // AI Support & Customer Communication
    const supRes1 = await user('/support', { message: 'Hello, how can I deposit?' });
    ok('customer receives AI response', supRes1.status === 200 && supRes1.data.messages.some((m) => m.sender_role === 'ai'));

    // AI Escalation to Human Agent
    const supRes2 = await user('/support', { message: 'I need to speak with a human agent' });
    ok('customer ticket escalates to agent', supRes2.status === 200 && supRes2.data.status === 'escalated');

    // Agent viewing tickets and replying
    const agTickets = await agent('/agent/tickets');
    ok('agent can view tickets', agTickets.status === 200 && agTickets.data.tickets.length > 0);
    const tId = agTickets.data.tickets[0].id;
    const agReply = await agent(`/support/ticket/${tId}/reply`, { message: 'Hello, I am taking over your ticket' });
    ok('agent replies to ticket', agReply.status === 200);

    // Admin financial analytics & reports
    const finAnalytics = await admin('/admin/financial-analytics?range=all');
    ok('admin retrieves financial analytics', finAnalytics.status === 200 && typeof finAnalytics.data.gross_gaming_revenue === 'number');

    // Admin AI Support settings toggle
    const aiToggle = await admin('/admin/ai-settings', { enabled: true });
    ok('admin can configure AI settings', aiToggle.status === 200 && aiToggle.data.enabled === true);

    // Ledger balance equals wallet balance for every user
    const bad = db.prepare(`SELECT w.user_id FROM wallets w
      WHERE w.balance != COALESCE((SELECT SUM(amount) FROM ledger l WHERE l.user_id = w.user_id), 0)`).all();
    ok('wallet balance equals sum of ledger for every user', bad.length === 0);
    ok('audit log has entries', db.prepare('SELECT COUNT(*) c FROM audit_logs').get().c > 3);
    ok('amharic translations load', (await fetch(base + '/i18n/am').then((r) => r.json())).brand === 'ፈጣን ቤት');

    console.log(`\nAll ${passed} checks passed.`);
    server.close(); process.exit(0);
  } catch (e) {
    console.error('\nFAILED:', e.message); server.close(); process.exit(1);
  }
});
