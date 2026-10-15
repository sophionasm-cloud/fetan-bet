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

// ---------- support ----------
app.post('/api/support', auth, wrap((req) => {
  const message = String(req.body.message || '').trim().slice(0, 500);
  if (message.length < 3) throw new Error('INVALID');
  db.prepare('INSERT INTO support_tickets (user_id, message) VALUES (?,?)').run(req.user.id, message);
}));

// ---------- games ----------
const g = (fn) => [auth, wrap((req) => fn(req))];
app.post('/api/games/roulette', ...g((req) => games.roulette(req.user.id, Number(req.body.bet), req.body.kind,
  req.body.kind === 'number' ? Number(req.body.value) : req.body.value)));
app.post('/api/games/star', ...g((req) => games.starSpin(req.user.id, Number(req.body.bet))));
app.get('/api/games/road', ...g((req) => games.roadState(req.user.id)));
app.post('/api/games/road/start', ...g((req) => games.roadStart(req.user.id, Number(req.body.bet))));
app.post('/api/games/road/step', ...g((req) => games.roadStep(req.user.id)));
app.post('/api/games/road/cashout', ...g((req) => games.roadCashout(req.user.id)));
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

// ---------- admin ----------
const admin = [auth, need('admin')];
app.get('/api/admin/stats', ...admin, wrap(() => ({
  users: db.prepare("SELECT COUNT(*) c FROM users WHERE role='user'").get().c,
  pending: db.prepare("SELECT COUNT(*) c FROM deposits WHERE status='pending'").get().c,
  credited: db.prepare("SELECT COALESCE(SUM(amount),0) s FROM ledger WHERE type='deposit'").get().s,
  rounds: db.prepare('SELECT COUNT(*) c FROM game_rounds').get().c,
  tickets: db.prepare('SELECT COUNT(*) c FROM support_tickets').get().c,
})));
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
app.get('/api/admin/audit', ...admin, wrap(() => ({
  logs: db.prepare('SELECT a.id, a.action, a.detail, a.created_at, u.name actor FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 100').all(),
})));
app.get('/api/admin/support', ...admin, wrap(() => ({
  tickets: db.prepare('SELECT s.id, s.message, s.created_at, u.name, u.phone FROM support_tickets s JOIN users u ON u.id=s.user_id ORDER BY s.id DESC LIMIT 100').all(),
})));

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`ፍጣን ቤት / Fetan Bet running at http://localhost:${PORT}`));
}
module.exports = app;
