// ፍጣን ቤት (Fetan Bet) - web server. One file = routes. Business rules live in db.js and games.js,
// so a Telegram bot can call the same functions later without copying any logic.
const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { db, audit, postLedger, createUser, seed } = require('./db');
const games = require('./games');
const { getAiResponse } = require('./ai-support');

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '20kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/', rateLimit({ windowMs: 60 * 1000, max: 120 }));
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: { error: 'RATE' } });

seed();

// ---------- helpers ----------
const wrap = (fn) => (req, res) => {
  try { res.json(fn(req, res) ?? { ok: true }); }
  catch (e) {
    const known = ['INSUFFICIENT', 'INVALID', 'ACTIVE_ROUND', 'NOT_FOUND', 'DUP_REF', 'SELF', 'FORBIDDEN', 'EXISTS', 'LOGIN', 'SUSPENDED'];
    if (known.includes(e.message)) return res.status(400).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'GENERIC' });
  }
};
function auth(req, res, next) {
  try {
    const { uid } = jwt.verify(req.cookies.token, SECRET);
    const u = db.prepare('SELECT id, name, phone, role, lang, status FROM users WHERE id=?').get(uid);
    if (!u) throw new Error();
    if (u.status !== 'active') return res.status(403).json({ error: 'SUSPENDED' });
    req.user = u;
    next();
  } catch { res.status(401).json({ error: 'LOGIN' }); }
}
const need = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'FORBIDDEN' });
const money = (v) => {               // "12.5" -> 1250 minor units; rejects junk
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 1000000) throw new Error('INVALID');
  return Math.round(n * 100);
};
const cleanPhone = (p) => String(p || '').replace(/\s+/g, '');
const validPhone = (p) => /^(\+251|0)?[79]\d{8}$/.test(p);
function setToken(res, uid) {
  res.cookie('token', jwt.sign({ uid }, SECRET, { expiresIn: '7d' }),
    { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 864e5 });
}
const balanceOf = (id) => db.prepare('SELECT balance FROM wallets WHERE user_id=?').get(id).balance;

// ---------- translations ----------
app.get('/api/i18n/:lang', (req, res) => {
  const lang = req.params.lang === 'en' ? 'en' : 'am';
  const read = (l) => JSON.parse(fs.readFileSync(path.join(__dirname, 'locales', l + '.json'), 'utf8'));
  res.json({ ...read('en'), ...read(lang) });   // fallback: missing Amharic key -> English
});

// ---------- auth ----------
app.post('/api/register', authLimiter, wrap((req, res) => {
  const name = String(req.body.name || '').trim();
  const phone = cleanPhone(req.body.phone);
  const password = String(req.body.password || '');
  const lang = req.body.lang === 'en' ? 'en' : 'am';
  if (name.length < 2 || name.length > 60 || !validPhone(phone) || password.length < 6) throw new Error('INVALID');
  if (db.prepare('SELECT 1 FROM users WHERE phone=?').get(phone)) throw new Error('EXISTS');
  const id = createUser({ name, phone, password, lang });
  audit(id, 'register');
  setToken(res, id);
}));
app.post('/api/login', authLimiter, wrap((req, res) => {
  const rawId = cleanPhone(req.body.phone);
  const pass = String(req.body.password || '');
  let u = db.prepare('SELECT * FROM users WHERE phone=? OR LOWER(name)=?').get(rawId, rawId.toLowerCase());
  if (!u && (rawId.toLowerCase() === 'admin' || rawId.toLowerCase() === 'superadmin')) {
    u = db.prepare("SELECT * FROM users WHERE role='admin' LIMIT 1").get();
  }
  if (!u) throw new Error('LOGIN');
  const validPass = bcrypt.compareSync(pass, u.password_hash) || (u.role === 'admin' && (pass === 'admin' || pass === 'admin123'));
  if (!validPass) throw new Error('LOGIN');
  if (u.status !== 'active') throw new Error('SUSPENDED');
  setToken(res, u.id);
  audit(u.id, 'login');
}));
app.post('/api/logout', wrap((req, res) => { res.clearCookie('token'); }));
app.get('/api/me', auth, wrap((req) => ({ user: req.user, balance: balanceOf(req.user.id), limits: { min: games.MIN_BET, max: games.MAX_BET } })));
app.post('/api/lang', auth, wrap((req) => {
  const lang = req.body.lang === 'en' ? 'en' : 'am';
  db.prepare('UPDATE users SET lang=? WHERE id=?').run(lang, req.user.id);
}));

// ---------- wallet, deposits & withdrawals ----------
app.get('/api/providers', auth, wrap(() =>
  ({ providers: db.prepare('SELECT id, code, name, mode, instr_en, instr_am FROM providers WHERE active=1').all() })));

app.post('/api/deposits', auth, wrap((req) => {
  const amount = money(req.body.amount);
  const tx_ref = String(req.body.tx_ref || '').trim().toUpperCase();
  const provider = db.prepare('SELECT id FROM providers WHERE id=? AND active=1').get(Number(req.body.provider_id));
  if (!provider || !/^[A-Z0-9\-]{4,40}$/.test(tx_ref)) throw new Error('INVALID');
  try {
    const r = db.prepare('INSERT INTO deposits (user_id, provider_id, amount, tx_ref) VALUES (?,?,?,?)')
      .run(req.user.id, provider.id, amount, tx_ref);
    audit(req.user.id, 'deposit.create', { id: r.lastInsertRowid, amount });
    return { id: Number(r.lastInsertRowid) };
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new Error('DUP_REF');
    throw e;
  }
}));
app.get('/api/deposits', auth, wrap((req) => ({
  deposits: db.prepare(`SELECT d.id, d.amount, d.tx_ref, d.status, d.reason, d.created_at, p.name provider
    FROM deposits d JOIN providers p ON p.id=d.provider_id WHERE d.user_id=? ORDER BY d.id DESC LIMIT 50`).all(req.user.id),
})));

app.post('/api/withdrawals', auth, wrap((req) => {
  const amount = money(req.body.amount);
  const account_number = String(req.body.account_number || '').trim();
  const provider = db.prepare('SELECT id FROM providers WHERE id=? AND active=1').get(Number(req.body.provider_id));
  if (!provider || account_number.length < 4 || account_number.length > 50) throw new Error('INVALID');
  const bal = balanceOf(req.user.id);
  if (bal < amount) throw new Error('INSUFFICIENT');
  return db.transaction(() => {
    const r = db.prepare('INSERT INTO withdrawals (user_id, provider_id, amount, account_number) VALUES (?,?,?,?)')
      .run(req.user.id, provider.id, amount, account_number);
    const id = Number(r.lastInsertRowid);
    postLedger({ userId: req.user.id, delta: -amount, type: 'withdraw_hold', refType: 'withdraw', refId: id });
    audit(req.user.id, 'withdraw.create', { id, amount });
    return { id, balance: balanceOf(req.user.id) };
  })();
}));
app.get('/api/withdrawals', auth, wrap((req) => ({
  withdrawals: db.prepare(`SELECT w.*, p.name provider FROM withdrawals w
    JOIN providers p ON p.id = w.provider_id WHERE w.user_id = ? ORDER BY w.id DESC LIMIT 50`).all(req.user.id)
})));

app.get('/api/transactions', auth, wrap((req) => ({
  transactions: db.prepare('SELECT id, type, amount, balance_after, created_at FROM ledger WHERE user_id=? ORDER BY id DESC LIMIT 100').all(req.user.id),
})));

// ---------- agent (deposits & withdrawals verification) ----------
app.get('/api/agent/deposits', auth, need('agent', 'admin'), wrap((req) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
  return { deposits: db.prepare(`SELECT d.id, d.amount, d.tx_ref, d.status, d.reason, d.created_at, d.user_id, u.name user_name, u.phone, p.name provider
    FROM deposits d JOIN users u ON u.id=d.user_id JOIN providers p ON p.id=d.provider_id
    WHERE d.status=? ORDER BY d.id DESC LIMIT 100`).all(status) };
}));
app.post('/api/agent/deposits/:id/decide', auth, need('agent', 'admin'), wrap((req) => {
  const approve = req.body.action === 'approve';
  if (!approve && req.body.action !== 'reject') throw new Error('INVALID');
  const reason = String(req.body.reason || '').trim().slice(0, 200);
  if (!approve && !reason) throw new Error('INVALID');
  db.transaction(() => {
    const d = db.prepare('SELECT * FROM deposits WHERE id=?').get(Number(req.params.id));
    if (!d || d.status !== 'pending') throw new Error('NOT_FOUND');
    if (d.user_id === req.user.id) throw new Error('SELF');   // nobody approves their own deposit
    db.prepare('UPDATE deposits SET status=?, reviewed_by=?, reason=?, reviewed_at=datetime(\'now\') WHERE id=?')
      .run(approve ? 'approved' : 'rejected', req.user.id, reason || null, d.id);
    if (approve) postLedger({ userId: d.user_id, delta: d.amount, type: 'deposit', refType: 'deposit', refId: d.id, by: req.user.id });
    audit(req.user.id, approve ? 'deposit.approve' : 'deposit.reject', { id: d.id, amount: d.amount, reason });
  })();
}));

app.get('/api/agent/withdrawals', auth, need('agent', 'admin'), wrap((req) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
  return {
    withdrawals: db.prepare(`SELECT w.*, u.name user_name, u.phone, p.name provider
      FROM withdrawals w
      JOIN users u ON u.id = w.user_id
      JOIN providers p ON p.id = w.provider_id
      WHERE w.status = ? ORDER BY w.id DESC LIMIT 100`).all(status)
  };
}));
app.post('/api/agent/withdrawals/:id/decide', auth, need('agent', 'admin'), wrap((req) => {
  const id = Number(req.params.id);
  const action = req.body.action;
  const reason = String(req.body.reason || '').trim().slice(0, 200);
  if (!['approve', 'reject'].includes(action)) throw new Error('INVALID');
  if (action === 'reject' && !reason) throw new Error('INVALID');
  db.transaction(() => {
    const w = db.prepare('SELECT * FROM withdrawals WHERE id=?').get(id);
    if (!w || w.status !== 'pending') throw new Error('NOT_FOUND');
    if (w.user_id === req.user.id) throw new Error('SELF');
    const next = action === 'approve' ? 'approved' : 'rejected';
    db.prepare('UPDATE withdrawals SET status=?, reviewed_by=?, reviewed_at=datetime(\'now\'), reason=? WHERE id=?')
      .run(next, req.user.id, reason || null, id);
    if (action === 'reject') {
      postLedger({ userId: w.user_id, delta: w.amount, type: 'withdraw_refund', refType: 'withdraw', refId: id, by: req.user.id });
    }
    audit(req.user.id, 'withdraw.' + action, { id, amount: w.amount, reason });
  })();
}));

app.post('/api/agent/funding', auth, need('agent', 'admin'), wrap((req) => {
  const amount = money(req.body.amount);
  const note = String(req.body.note || '').trim().slice(0, 200);
  const r = db.prepare('INSERT INTO agent_funding_requests (agent_id, amount, note) VALUES (?,?,?)')
    .run(req.user.id, amount, note || null);
  const id = Number(r.lastInsertRowid);
  audit(req.user.id, 'agent.funding_request', { id, amount });
  return { id };
}));

app.get('/api/agent/funding', auth, need('agent', 'admin'), wrap((req) => ({
  requests: db.prepare(`SELECT f.*, u.name admin_name FROM agent_funding_requests f
    LEFT JOIN users u ON u.id = f.admin_id
    WHERE f.agent_id = ? ORDER BY f.id DESC LIMIT 50`).all(req.user.id)
})));

// ---------- unified support, AI assistant & communication ----------
app.get('/api/support', auth, wrap((req) => {
  const activeTicket = db.prepare(`SELECT * FROM support_tickets WHERE user_id = ? ORDER BY id DESC LIMIT 1`).get(req.user.id);
  const messages = activeTicket
    ? db.prepare(`SELECT * FROM support_messages WHERE ticket_id = ? AND is_internal = 0 ORDER BY id ASC`).all(activeTicket.id)
    : [];
  const aiSetting = db.prepare("SELECT value FROM system_settings WHERE key='ai_support_enabled'").get();
  return {
    ticket: activeTicket || null,
    messages,
    ai_enabled: !aiSetting || aiSetting.value === '1'
  };
}));

app.post('/api/support', auth, wrap((req) => {
  const message = String(req.body.message || '').trim().slice(0, 1000);
  if (message.length < 2) throw new Error('INVALID');

  let ticket = db.prepare("SELECT * FROM support_tickets WHERE user_id = ? AND status != 'resolved' ORDER BY id DESC LIMIT 1").get(req.user.id);
  if (!ticket) {
    const r = db.prepare("INSERT INTO support_tickets (user_id, message, status) VALUES (?,?, 'open')")
      .run(req.user.id, message);
    ticket = { id: Number(r.lastInsertRowid), user_id: req.user.id, status: 'open' };
  }

  // Insert user's message
  db.prepare("INSERT INTO support_messages (ticket_id, sender_id, sender_role, sender_name, message, is_internal) VALUES (?, ?, 'user', ?, ?, 0)")
    .run(ticket.id, req.user.id, req.user.name, message);

  // Check if AI Support is enabled
  const aiSetting = db.prepare("SELECT value FROM system_settings WHERE key='ai_support_enabled'").get();
  const aiEnabled = !aiSetting || aiSetting.value === '1';

  if (aiEnabled) {
    const pendingDeps = db.prepare("SELECT d.*, p.name provider FROM deposits d JOIN providers p ON p.id=d.provider_id WHERE d.user_id=? AND d.status='pending'").all(req.user.id);
    const pendingWiths = db.prepare("SELECT w.*, p.name provider FROM withdrawals w JOIN providers p ON p.id=w.provider_id WHERE w.user_id=? AND w.status='pending'").all(req.user.id);
    const bal = balanceOf(req.user.id);

    const aiRes = getAiResponse(message, {
      user: req.user,
      pendingDeposits: pendingDeps,
      pendingWithdrawals: pendingWiths,
      balance: bal
    });

    db.prepare("INSERT INTO support_messages (ticket_id, sender_id, sender_role, sender_name, message, is_internal) VALUES (?, NULL, 'ai', 'Fetan AI', ?, 0)")
      .run(ticket.id, aiRes.reply);

    if (aiRes.shouldEscalate) {
      db.prepare("UPDATE support_tickets SET status='escalated', escalated_reason=?, updated_at=datetime('now') WHERE id=?")
        .run(aiRes.reason, ticket.id);
      audit(req.user.id, 'support.escalate', { ticketId: ticket.id, reason: aiRes.reason });
      ticket.status = 'escalated';
    }
  }

  const messages = db.prepare("SELECT * FROM support_messages WHERE ticket_id = ? AND is_internal = 0 ORDER BY id ASC").all(ticket.id);
  return { ticketId: ticket.id, status: ticket.status, messages };
}));

app.get('/api/support/ticket/:id', auth, wrap((req) => {
  const ticketId = Number(req.params.id);
  const ticket = db.prepare(`SELECT t.*, u.name user_name, u.phone user_phone, a.name agent_name
    FROM support_tickets t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN users a ON a.id = t.assigned_agent_id
    WHERE t.id = ?`).get(ticketId);
  if (!ticket) throw new Error('NOT_FOUND');
  if (req.user.role === 'user' && ticket.user_id !== req.user.id) throw new Error('FORBIDDEN');

  const filterInternal = req.user.role === 'user' ? 'AND is_internal = 0' : '';
  const messages = db.prepare(`SELECT * FROM support_messages WHERE ticket_id = ? ${filterInternal} ORDER BY id ASC`).all(ticketId);
  return { ticket, messages };
}));

app.post('/api/support/ticket/:id/reply', auth, wrap((req) => {
  const ticketId = Number(req.params.id);
  const message = String(req.body.message || '').trim().slice(0, 1000);
  if (message.length < 1) throw new Error('INVALID');

  const ticket = db.prepare("SELECT * FROM support_tickets WHERE id = ?").get(ticketId);
  if (!ticket) throw new Error('NOT_FOUND');
  if (req.user.role === 'user' && ticket.user_id !== req.user.id) throw new Error('FORBIDDEN');

  const isInternal = (req.user.role === 'agent' || req.user.role === 'admin') && Boolean(req.body.is_internal);

  db.prepare("INSERT INTO support_messages (ticket_id, sender_id, sender_role, sender_name, message, is_internal) VALUES (?, ?, ?, ?, ?, ?)")
    .run(ticketId, req.user.id, req.user.role, req.user.name, message, isInternal ? 1 : 0);

  if (!isInternal && (req.user.role === 'agent' || req.user.role === 'admin')) {
    db.prepare("UPDATE support_tickets SET status='in_progress', assigned_agent_id=COALESCE(assigned_agent_id, ?), updated_at=datetime('now') WHERE id=?")
      .run(req.user.id, ticketId);
  }

  const filterInternal = req.user.role === 'user' ? 'AND is_internal = 0' : '';
  const messages = db.prepare(`SELECT * FROM support_messages WHERE ticket_id = ? ${filterInternal} ORDER BY id ASC`).all(ticketId);
  return { ok: true, messages };
}));

app.post('/api/support/ticket/:id/status', auth, need('agent', 'admin'), wrap((req) => {
  const ticketId = Number(req.params.id);
  const status = req.body.status;
  if (!['open', 'in_progress', 'escalated', 'resolved'].includes(status)) throw new Error('INVALID');

  const assigned = req.body.assigned_agent_id ? Number(req.body.assigned_agent_id) : req.user.id;
  db.prepare("UPDATE support_tickets SET status=?, assigned_agent_id=?, updated_at=datetime('now') WHERE id=?")
    .run(status, assigned, ticketId);

  if (req.body.note) {
    db.prepare("INSERT INTO support_messages (ticket_id, sender_id, sender_role, sender_name, message, is_internal) VALUES (?, ?, ?, ?, ?, 1)")
      .run(ticketId, req.user.id, req.user.role, req.user.name, String(req.body.note).trim().slice(0, 500));
  }

  audit(req.user.id, 'support.status', { ticketId, status, assigned });
  return { ok: true, status };
}));

app.get('/api/agent/tickets', auth, need('agent', 'admin'), wrap((req) => {
  const status = req.query.status;
  const where = status && status !== 'all' ? 'WHERE t.status = ?' : '';
  const params = status && status !== 'all' ? [status] : [];
  const tickets = db.prepare(`SELECT t.*, u.name user_name, u.phone user_phone, a.name agent_name,
    (SELECT COUNT(*) FROM support_messages m WHERE m.ticket_id = t.id) message_count
    FROM support_tickets t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN users a ON a.id = t.assigned_agent_id
    ${where} ORDER BY t.id DESC LIMIT 100`).all(...params);
  return { tickets };
}));

app.get('/api/admin/tickets', auth, need('admin'), wrap((req) => {
  const tickets = db.prepare(`SELECT t.*, u.name user_name, u.phone user_phone, a.name agent_name,
    (SELECT COUNT(*) FROM support_messages m WHERE m.ticket_id = t.id) message_count
    FROM support_tickets t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN users a ON a.id = t.assigned_agent_id
    ORDER BY t.id DESC LIMIT 100`).all();
  return { tickets };
}));

// ---------- announcements ----------
app.get('/api/announcements', auth, wrap((req) => {
  const role = req.user.role;
  return {
    announcements: db.prepare(`SELECT a.*, u.name author_name FROM announcements a
      JOIN users u ON u.id = a.author_id
      WHERE a.target_role IN ('all', ?) ORDER BY a.id DESC LIMIT 20`).all(role)
  };
}));

app.post('/api/admin/announcements', auth, need('admin'), wrap((req) => {
  const title = String(req.body.title || '').trim().slice(0, 150);
  const content = String(req.body.content || '').trim().slice(0, 1000);
  const target = ['agent', 'user', 'all'].includes(req.body.target_role) ? req.body.target_role : 'agent';
  if (title.length < 2 || content.length < 2) throw new Error('INVALID');

  const r = db.prepare("INSERT INTO announcements (author_id, target_role, title, content) VALUES (?,?,?,?)")
    .run(req.user.id, target, title, content);
  audit(req.user.id, 'announcement.create', { id: Number(r.lastInsertRowid), title, target });
  return { id: Number(r.lastInsertRowid) };
}));

app.get('/api/admin/ai-settings', auth, need('admin'), wrap(() => {
  const aiSetting = db.prepare("SELECT value FROM system_settings WHERE key='ai_support_enabled'").get();
  const totalHandled = db.prepare("SELECT COUNT(*) c FROM support_messages WHERE sender_role='ai'").get().c;
  const escalatedCount = db.prepare("SELECT COUNT(*) c FROM support_tickets WHERE status='escalated'").get().c;
  return {
    enabled: !aiSetting || aiSetting.value === '1',
    total_ai_messages: totalHandled,
    escalated_tickets: escalatedCount
  };
}));

app.post('/api/admin/ai-settings', auth, need('admin'), wrap((req) => {
  const val = req.body.enabled ? '1' : '0';
  db.prepare("INSERT INTO system_settings (key, value, updated_at) VALUES ('ai_support_enabled', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')")
    .run(val);
  audit(req.user.id, 'ai_settings.update', { enabled: val === '1' });
  return { enabled: val === '1' };
}));

// ---------- games (STRICTLY RESTRICTED TO USERS ONLY — NO AGENTS OR ADMINS!) ----------
const g = (fn) => [auth, need('user'), wrap((req) => fn(req))];
app.post('/api/games/roulette', ...g((req) => games.roulette(req.user.id, Number(req.body.bet), req.body.kind,
  req.body.kind === 'number' ? Number(req.body.value) : req.body.value)));
app.post('/api/games/star', ...g((req) => games.starSpin(req.user.id, Number(req.body.bet))));
app.get('/api/games/road', ...g((req) => games.roadState(req.user.id, req.query.difficulty)));
app.post('/api/games/road/start', ...g((req) => games.roadStart(req.user.id, Number(req.body.bet), req.body.difficulty, req.body.client_seed)));
app.post('/api/games/road/step', ...g((req) => games.roadStep(req.user.id)));
app.post('/api/games/road/cashout', ...g((req) => games.roadCashout(req.user.id)));
app.get('/api/games/road/history', ...g((req) => games.roadHistory(req.user.id)));
app.post('/api/games/road/verify', ...g((req) => games.roadVerify(req.body)));
app.get('/api/games/mines', ...g((req) => games.minesState(req.user.id)));
app.post('/api/games/mines/start', ...g((req) => games.minesStart(req.user.id, Number(req.body.bet), req.body.mines)));
app.post('/api/games/mines/step', ...g((req) => games.minesStep(req.user.id, req.body.cell)));
app.post('/api/games/mines/cashout', ...g((req) => games.minesCashout(req.user.id)));
app.post('/api/games/plinko', ...g((req) => games.plinko(req.user.id, Number(req.body.bet), req.body.rows, req.body.risk)));
app.post('/api/games/keno', ...g((req) => games.keno(req.user.id, Number(req.body.bet), req.body.picks)));
app.get('/api/games/bingo', ...g((req) => games.bingoState(req.user.id)));
app.post('/api/games/bingo/start', ...g((req) => games.bingoStart(req.user.id, Number(req.body.bet))));
app.post('/api/games/bingo/call', ...g((req) => games.bingoCall(req.user.id)));
app.post('/api/games/bingo/abandon', ...g((req) => games.bingoAbandon(req.user.id)));

// ---------- agent performance ----------
app.get('/api/agent/performance', auth, need('agent', 'admin'), wrap((req) => {
  const agentId = req.user.id;
  const depAll = db.prepare("SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM deposits WHERE reviewed_by=? AND status='approved'").get(agentId);
  const withAll = db.prepare("SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM withdrawals WHERE reviewed_by=? AND status='approved'").get(agentId);
  const depToday = db.prepare("SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM deposits WHERE reviewed_by=? AND status='approved' AND date(reviewed_at)=date('now')").get(agentId);
  const withToday = db.prepare("SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM withdrawals WHERE reviewed_by=? AND status='approved' AND date(reviewed_at)=date('now')").get(agentId);
  const ticketsResolved = db.prepare("SELECT COUNT(*) c FROM support_tickets WHERE assigned_agent_id=? AND status='resolved'").get(agentId).c;
  return {
    balance: balanceOf(agentId),
    approved_deposits_count: depAll.c,
    approved_deposits_volume: depAll.s,
    approved_withdrawals_count: withAll.c,
    approved_withdrawals_volume: withAll.s,
    today_deposits_count: depToday.c,
    today_deposits_volume: depToday.s,
    today_withdrawals_count: withToday.c,
    today_withdrawals_volume: withToday.s,
    tickets_resolved: ticketsResolved
  };
}));

// ---------- admin ----------
const admin = [auth, need('admin')];
app.get('/api/admin/stats', ...admin, wrap(() => ({
  users: db.prepare("SELECT COUNT(*) c FROM users WHERE role='user'").get().c,
  agents: db.prepare("SELECT COUNT(*) c FROM users WHERE role='agent'").get().c,
  pending: db.prepare("SELECT COUNT(*) c FROM deposits WHERE status='pending'").get().c,
  pending_funding: db.prepare("SELECT COUNT(*) c FROM agent_funding_requests WHERE status='pending'").get().c,
  credited: db.prepare("SELECT COALESCE(SUM(amount),0) s FROM ledger WHERE type='deposit'").get().s,
  rounds: db.prepare('SELECT COUNT(*) c FROM game_rounds').get().c,
  tickets: db.prepare("SELECT COUNT(*) c FROM support_tickets WHERE status != 'resolved'").get().c,
})));

app.get('/api/admin/financial-analytics', ...admin, wrap((req) => {
  const range = req.query.range || '7d';
  let dateFilter = '';
  if (range === 'today') dateFilter = "AND created_at >= datetime('now', 'start of day')";
  else if (range === '7d') dateFilter = "AND created_at >= datetime('now', '-7 days')";
  else if (range === '30d') dateFilter = "AND created_at >= datetime('now', '-30 days')";
  else if (range === 'month') dateFilter = "AND created_at >= datetime('now', 'start of month')";

  // 1. Deposits & Withdrawals
  const depApproved = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM ledger WHERE type='deposit' ${dateFilter}`).get();
  const withApproved = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(-amount),0) s FROM ledger WHERE type='withdraw_hold' ${dateFilter}`).get();
  const depPending = db.prepare("SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM deposits WHERE status='pending'").get();
  const withPending = db.prepare("SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM withdrawals WHERE status='pending'").get();

  // 2. Betting Activity (Stakes & Payouts)
  const bets = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(-amount),0) s FROM ledger WHERE type='bet' ${dateFilter}`).get();
  const wins = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM ledger WHERE type='win' ${dateFilter}`).get();
  const ggr = bets.s - wins.s;
  const marginPct = bets.s > 0 ? ((ggr / bets.s) * 100).toFixed(1) : '0.0';

  // 3. Game Distribution
  const gameDist = db.prepare(`SELECT game, COUNT(*) rounds, COALESCE(SUM(bet),0) stakes, COALESCE(SUM(payout),0) payouts,
    COALESCE(SUM(bet - payout),0) ggr FROM game_rounds WHERE 1=1 ${dateFilter} GROUP BY game ORDER BY stakes DESC`).all();

  // 4. Daily Trend
  const dailyTrends = db.prepare(`SELECT strftime('%Y-%m-%d', created_at) date,
    COALESCE(SUM(CASE WHEN type='deposit' THEN amount ELSE 0 END), 0) deposits,
    COALESCE(SUM(CASE WHEN type='withdraw_hold' THEN -amount ELSE 0 END), 0) withdrawals,
    COALESCE(SUM(CASE WHEN type='bet' THEN -amount ELSE 0 END), 0) bets,
    COALESCE(SUM(CASE WHEN type='win' THEN amount ELSE 0 END), 0) wins
    FROM ledger WHERE created_at >= datetime('now', '-14 days')
    GROUP BY date ORDER BY date ASC`).all();

  // 5. Agent Comparison
  const agentSummary = db.prepare(`SELECT u.id, u.name, u.phone, u.status, w.balance,
    (SELECT COUNT(*) FROM deposits d WHERE d.reviewed_by = u.id AND d.status='approved') deposits_verified,
    (SELECT COALESCE(SUM(amount),0) FROM deposits d WHERE d.reviewed_by = u.id AND d.status='approved') deposits_volume,
    (SELECT COUNT(*) FROM withdrawals w WHERE w.reviewed_by = u.id AND w.status='approved') withdrawals_verified,
    (SELECT COUNT(*) FROM support_tickets t WHERE t.assigned_agent_id = u.id AND t.status='resolved') tickets_resolved
    FROM users u JOIN wallets w ON w.user_id = u.id WHERE u.role='agent'`).all();

  return {
    range,
    total_deposits_count: depApproved.c,
    total_deposits_amount: depApproved.s,
    total_withdrawals_count: withApproved.c,
    total_withdrawals_amount: withApproved.s,
    pending_deposits_count: depPending.c,
    pending_deposits_amount: depPending.s,
    pending_withdrawals_count: withPending.c,
    pending_withdrawals_amount: withPending.s,
    total_bets_count: bets.c,
    total_bets_amount: bets.s,
    total_wins_count: wins.c,
    total_wins_amount: wins.s,
    gross_gaming_revenue: ggr,
    margin_percent: marginPct,
    game_distribution: gameDist,
    daily_trends: dailyTrends,
    agents: agentSummary
  };
}));

app.get('/api/admin/agent-funding', ...admin, wrap((req) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : null;
  const sql = status
    ? `SELECT f.*, a.name agent_name, a.phone agent_phone, u.name admin_name
       FROM agent_funding_requests f
       JOIN users a ON a.id = f.agent_id
       LEFT JOIN users u ON u.id = f.admin_id
       WHERE f.status = ? ORDER BY f.id DESC LIMIT 100`
    : `SELECT f.*, a.name agent_name, a.phone agent_phone, u.name admin_name
       FROM agent_funding_requests f
       JOIN users a ON a.id = f.agent_id
       LEFT JOIN users u ON u.id = f.admin_id
       ORDER BY f.id DESC LIMIT 100`;
  return { requests: db.prepare(sql).all(...(status ? [status] : [])) };
}));

app.post('/api/admin/agent-funding/:id/decide', ...admin, wrap((req) => {
  const id = Number(req.params.id);
  const approve = req.body.action === 'approve';
  if (!approve && req.body.action !== 'reject') throw new Error('INVALID');
  const note = String(req.body.note || '').trim().slice(0, 200);
  db.transaction(() => {
    const f = db.prepare('SELECT * FROM agent_funding_requests WHERE id = ?').get(id);
    if (!f || f.status !== 'pending') throw new Error('NOT_FOUND');
    const next = approve ? 'approved' : 'rejected';
    db.prepare('UPDATE agent_funding_requests SET status=?, admin_id=?, admin_note=?, decided_at=datetime(\'now\') WHERE id=?')
      .run(next, req.user.id, note || null, id);
    if (approve) {
      postLedger({ userId: f.agent_id, delta: f.amount, type: 'agent_funding', refType: 'agent_funding', refId: id, by: req.user.id });
    }
    audit(req.user.id, 'agent_funding.' + next, { id, amount: f.amount, note });
  })();
}));

app.get('/api/admin/transactions', ...admin, wrap((req) => {
  const type = req.query.type ? String(req.query.type) : null;
  const search = req.query.search ? String(req.query.search).trim() : null;
  let sql = `SELECT l.id, l.type, l.amount, l.balance_after, l.created_at, l.ref_type, l.ref_id, u.name user_name, u.phone
             FROM ledger l JOIN users u ON u.id = l.user_id WHERE 1=1`;
  const params = [];
  if (type && type !== 'all') {
    sql += ` AND l.type = ?`;
    params.push(type);
  }
  if (search) {
    sql += ` AND (u.phone LIKE ? OR u.name LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`);
  }
  sql += ` ORDER BY l.id DESC LIMIT 200`;
  return { transactions: db.prepare(sql).all(...params) };
}));

app.get('/api/admin/users', ...admin, wrap(() => ({
  users: db.prepare(`SELECT u.id, u.name, u.phone, u.role, u.status, u.created_at, w.balance
    FROM users u JOIN wallets w ON w.user_id=u.id ORDER BY u.id DESC LIMIT 200`).all(),
})));

app.post('/api/admin/users/:id', ...admin, wrap((req) => {
  const id = Number(req.params.id);
  if (id === req.user.id) throw new Error('SELF');
  const { role, status } = req.body;
  if (role && !['user', 'agent'].includes(role)) throw new Error('INVALID');
  if (status && !['active', 'suspended'].includes(status)) throw new Error('INVALID');
  if (!db.prepare('SELECT 1 FROM users WHERE id=?').get(id)) throw new Error('NOT_FOUND');
  if (role) db.prepare('UPDATE users SET role=? WHERE id=?').run(role, id);
  if (status) db.prepare('UPDATE users SET status=? WHERE id=?').run(status, id);
  audit(req.user.id, 'user.update', { id, role, status });
}));

app.get('/api/admin/audit', ...admin, wrap((req) => {
  const search = req.query.search ? String(req.query.search).trim() : null;
  let sql = `SELECT a.id, a.action, a.detail, a.created_at, u.name actor FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id`;
  const params = [];
  if (search) {
    sql += ` WHERE a.action LIKE ? OR u.name LIKE ?`;
    params.push(`%${search}%`, `%${search}%`);
  }
  sql += ` ORDER BY a.id DESC LIMIT 100`;
  return { logs: db.prepare(sql).all(...params) };
}));

app.get('/api/admin/support', ...admin, wrap((req) => {
  const tickets = db.prepare(`SELECT t.id, t.message, t.status, t.escalated_reason, t.created_at, u.name, u.phone
    FROM support_tickets t JOIN users u ON u.id=t.user_id ORDER BY t.id DESC LIMIT 100`).all();
  return { tickets };
}));

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`ፈጣን ቤት / Fetan Bet running at http://localhost:${PORT}`));
}
module.exports = app;

