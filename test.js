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

    // Games
    ok('bet below minimum rejected', (await user('/games/roulette', { bet: 1, kind: 'color', value: 'red' })).data.error === 'INVALID');
    const before = (await user('/me')).data.balance;
    const rr = await user('/games/roulette', { bet: 1000, kind: 'color', value: 'red' });
    ok('roulette plays', rr.status === 200 && rr.data.n >= 0 && rr.data.n <= 36);
    ok('roulette balance consistent', rr.data.balance === before - 1000 + rr.data.payout);

    const sp = await user('/games/star', { bet: 1000 });
    ok('star spin plays', sp.status === 200 && sp.data.reels.length === 3);

    ok('road start', (await user('/games/road/start', { bet: 1000 })).data.active === true);
    ok('cannot start two road rounds', (await user('/games/road/start', { bet: 1000 })).data.error === 'ACTIVE_ROUND');
    ok('cannot cash out at step 0', (await user('/games/road/cashout', {})).data.error === 'INVALID');
    for (let i = 0; i < 12; i++) {
      const s = await user('/games/road/step', {});
      if (s.data.crashed || s.data.finished) break;
      if (i === 1) { await user('/games/road/cashout', {}); break; }
    }

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

    // Ledger balance equals wallet balance for every user
    const bad = db.prepare(`SELECT w.user_id FROM wallets w
      WHERE w.balance != COALESCE((SELECT SUM(amount) FROM ledger l WHERE l.user_id = w.user_id), 0)`).all();
    ok('wallet balance equals sum of ledger for every user', bad.length === 0);
    ok('audit log has entries', db.prepare('SELECT COUNT(*) c FROM audit_logs').get().c > 3);
    ok('amharic translations load', (await fetch(base + '/i18n/am').then((r) => r.json())).brand === 'ፍጣን ቤት');

    console.log(`\nAll ${passed} checks passed.`);
    server.close(); process.exit(0);
  } catch (e) {
    console.error('\nFAILED:', e.message); server.close(); process.exit(1);
  }
});
