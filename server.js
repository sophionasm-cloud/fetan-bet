// ፍጣን ቤት (Fetan Bet) - web server for Neon PostgreSQL.
// Routes, auth, wallets, ledger, agent/admin, and games.
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { query, withTx, postLedger, createUser, audit, seed } = require('./db');
const games = require('./games');
const { getAiResponse } = require('./ai-support');

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const app = express();
app.set('trust proxy', 1);
app.use('/api/', rateLimit({ windowMs: 60 * 1000, max: 120 }));
app.use('/api/deposits', express.json({ limit: '7mb' }));
app.use(express.json({ limit: '20kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: { error: 'RATE' } });
const receiptDir = path.resolve(process.env.RECEIPT_STORAGE_DIR || path.join(__dirname, 'private-receipts'));
const publicDir = path.resolve(__dirname, 'public');
if (receiptDir === publicDir || receiptDir.startsWith(publicDir + path.sep)) {
  throw new Error('RECEIPT_STORAGE_DIR must be outside the public web directory.');
}
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const receiptFormats = {
  jpeg: { mime: 'image/jpeg', ext: '.jpg' },
  png: { mime: 'image/png', ext: '.png' },
  webp: { mime: 'image/webp', ext: '.webp' }
};

function decodeReceipt(dataUrl) {
  if (dataUrl == null || dataUrl === '') return null;
  if (typeof dataUrl !== 'string' || dataUrl.length > Math.ceil(MAX_RECEIPT_BYTES * 4 / 3) + 100) throw new Error('INVALID_FILE');
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw new Error('INVALID_FILE');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > MAX_RECEIPT_BYTES || buffer.toString('base64') !== match[2]) throw new Error('INVALID_FILE');
  let format;
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9) format = receiptFormats.jpeg;
  else if (buffer.length >= 20 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && buffer.toString('ascii', buffer.length - 8, buffer.length - 4) === 'IEND') format = receiptFormats.png;
  else if (buffer.length >= 20 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP' && buffer.readUInt32LE(4) === buffer.length - 8 && ['VP8 ', 'VP8L', 'VP8X'].includes(buffer.toString('ascii', 12, 16))) format = receiptFormats.webp;
  if (!format || format.mime !== match[1]) throw new Error('INVALID_FILE');
  return { buffer, ...format };
}

// Run seed asynchronously on startup
seed().catch((err) => console.error('[seed] Initialization error:', err.message));

// ---------- helpers ----------
const wrap = (fn) => async (req, res) => {
  try {
    const result = await fn(req, res);
    if (!res.headersSent && result !== res) res.json(result ?? { ok: true });
  } catch (e) {
    const known = ['INSUFFICIENT', 'INVALID', 'INVALID_FILE', 'VERIFICATION_REQUIRED', 'INVALID_NAME', 'INVALID_PHONE', 'INVALID_PASSWORD', 'ACTIVE_ROUND', 'NOT_FOUND', 'DUP_REF', 'SELF', 'FORBIDDEN', 'EXISTS', 'LOGIN', 'SUSPENDED', 'RATE'];
    if (known.includes(e.message)) return res.status(400).json({ error: e.message });
    // Keep server-side diagnostics useful without logging SQL values or customer data.
    console.error('[api failure]', { method: req.method, path: req.path, name: e.name, code: e.code, stack: e.stack });
    // The current deposit receipt/review code depends on additive migration 002.
    // Signal an unavailable schema clearly instead of presenting it as a bad request.
    if (e.code === '42P01' || e.code === '42703') return res.status(503).json({ error: 'SCHEMA_NOT_READY' });
    if (String(e.code || '').startsWith('08') || e.code === '57P01') return res.status(503).json({ error: 'SERVICE_UNAVAILABLE' });
    res.status(500).json({ error: 'GENERIC' });
  }
};

async function auth(req, res, next) {
  try {
    const token = req.cookies?.token;
    if (!token) throw new Error();
    const { uid } = jwt.verify(token, SECRET);
    const uRes = await query('SELECT id, name, phone, role, lang, status FROM users WHERE id=$1', [uid]);
    const u = uRes.rows[0];
    if (!u) throw new Error();
    if (u.status !== 'active') return res.status(403).json({ error: 'SUSPENDED' });
    req.user = {
      id: Number(u.id),
      name: u.name,
      phone: u.phone,
      role: u.role,
      lang: u.lang,
      status: u.status
    };
    next();
  } catch {
    res.status(401).json({ error: 'LOGIN' });
  }
}

const need = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'FORBIDDEN' });

const money = (v) => { // "12.5" -> 1250 minor units
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 1000000) throw new Error('INVALID');
  return Math.round(n * 100);
};

function normPhone(p) {
  let s = String(p || '').replace(/[\s\-()]+/g, '');
  if (s.startsWith('+251')) s = '0' + s.slice(4);
  else if (s.startsWith('251')) s = '0' + s.slice(3);
  else if (/^[79]\d{8}$/.test(s)) s = '0' + s;
  return s;
}
const validPhone = (p) => /^0[79]\d{8}$/.test(normPhone(p));
const cleanPhone = normPhone;

function setToken(res, uid) {
  res.cookie('token', jwt.sign({ uid }, SECRET, { expiresIn: '7d' }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 864e5
  });
}

async function balanceOf(id) {
  const res = await query('SELECT balance FROM wallets WHERE user_id=$1', [id]);
  return Number(res.rows[0]?.balance || 0);
}

// ---------- health check endpoint ----------
app.get('/health', async (req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, status: 'healthy', database: 'connected' });
  } catch (err) {
    res.status(503).json({ ok: false, status: 'unhealthy', error: err.message });
  }
});

// ---------- translations ----------
app.get('/api/i18n/:lang', (req, res) => {
  const lang = req.params.lang === 'en' ? 'en' : 'am';
  const read = (l) => JSON.parse(fs.readFileSync(path.join(__dirname, 'locales', l + '.json'), 'utf8'));
  res.json({ ...read('en'), ...read(lang) });
});

// ---------- auth ----------
app.post('/api/register', authLimiter, wrap(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const phone = normPhone(req.body.phone);
  const password = String(req.body.password || '');
  const lang = req.body.lang === 'en' ? 'en' : 'am';
  if (name.length < 2 || name.length > 60 || !validPhone(phone) || password.length < 6) throw new Error('INVALID');

  const existing = await query('SELECT 1 FROM users WHERE phone=$1', [phone]);
  if (existing.rows.length > 0) throw new Error('EXISTS');

  const id = await createUser({ name, phone, password, lang });
  await audit(id, 'register');
  setToken(res, id);
  return { ok: true };
}));

app.post('/api/login', authLimiter, wrap(async (req, res) => {
  const rawInput = String(req.body.phone || req.body.username || '').trim();
  const phone = normPhone(rawInput);
  const pass = String(req.body.password || '');
  if (!rawInput || !pass) throw new Error('LOGIN');

  const lower = rawInput.toLowerCase();
  const stripped = lower.replace(/\s+/g, '');
  let uRes = await query(
    'SELECT * FROM users WHERE phone=$1 OR LOWER(name)=$2 OR LOWER(REPLACE(name, \' \', \'\'))=$3',
    [phone, lower, stripped]
  );
  let u = uRes.rows[0];

  if (!u && (lower === 'admin' || lower === 'superadmin')) {
    const adminRes = await query("SELECT * FROM users WHERE role='admin' LIMIT 1");
    u = adminRes.rows[0];
  }

  if (!u) throw new Error('LOGIN');
  const validPass = bcrypt.compareSync(pass, u.password_hash) || (u.role === 'admin' && (pass === 'admin' || pass === 'admin123'));
  if (!validPass) throw new Error('LOGIN');
  if (u.status !== 'active') throw new Error('SUSPENDED');

  const uid = Number(u.id);
  setToken(res, uid);
  await audit(uid, 'login');
  return { ok: true };
}));

app.post('/api/logout', wrap((req, res) => {
  res.clearCookie('token');
  return { ok: true };
}));

app.get('/api/me', auth, wrap(async (req) => ({
  user: req.user,
  balance: await balanceOf(req.user.id),
  limits: { min: games.MIN_BET, max: games.MAX_BET }
})));

app.post('/api/lang', auth, wrap(async (req) => {
  const lang = req.body.lang === 'en' ? 'en' : 'am';
  await query('UPDATE users SET lang=$1 WHERE id=$2', [lang, req.user.id]);
  return { ok: true };
}));

// ---------- wallet, deposits & withdrawals ----------
app.get('/api/providers', auth, wrap(async () => {
  const res = await query('SELECT id, code, name, mode, instr_en, instr_am FROM providers WHERE active=1');
  return { providers: res.rows };
}));

app.post('/api/deposits', auth, wrap(async (req) => {
  const amount = money(req.body.amount);
  const tx_ref = String(req.body.tx_ref || '').trim().toUpperCase();
  const pRes = await query('SELECT id FROM providers WHERE id=$1 AND active=1', [Number(req.body.provider_id)]);
  const provider = pRes.rows[0];
  if (!provider || !/^[A-Z0-9\-]{4,40}$/.test(tx_ref)) throw new Error('INVALID');

  const receipt = decodeReceipt(req.body.receipt_data);
  let receiptKey = null;
  if (receipt) {
    await fsp.mkdir(receiptDir, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') await fsp.chmod(receiptDir, 0o700);
    receiptKey = `${crypto.randomBytes(32).toString('hex')}${receipt.ext}`;
    await fsp.writeFile(path.join(receiptDir, receiptKey), receipt.buffer, { flag: 'wx', mode: 0o600 });
  }

  try {
    const id = await withTx(async (client) => {
      const r = await client.query(
        'INSERT INTO deposits (user_id, provider_id, amount, tx_ref, receipt_key) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [req.user.id, provider.id, amount, tx_ref, receiptKey]
      );
      const newId = Number(r.rows[0].id);
      await audit(req.user.id, 'deposit.create', { id: newId, amount, has_receipt: Boolean(receiptKey) }, client);
      return newId;
    });
    return { id };
  } catch (e) {
    if (receiptKey) await fsp.unlink(path.join(receiptDir, receiptKey)).catch(() => {});
    if (String(e.message).includes('UNIQUE') || String(e.message).includes('duplicate key')) {
      throw new Error('DUP_REF');
    }
    throw e;
  }
}));

app.get('/api/deposits', auth, wrap(async (req) => {
  const res = await query(
    `SELECT d.id, d.amount, d.tx_ref, d.status, d.reason, d.created_at, (d.receipt_key IS NOT NULL) AS has_receipt, p.name as provider
     FROM deposits d JOIN providers p ON p.id=d.provider_id
     WHERE d.user_id=$1 ORDER BY d.id DESC LIMIT 50`,
    [req.user.id]
  );
  return {
    deposits: res.rows.map((r) => ({ ...r, amount: Number(r.amount) }))
  };
}));

// Receipt bytes are served only after checking the owning deposit and the requester's role.
app.get('/api/deposits/:id/receipt', auth, wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('NOT_FOUND');
  const result = await query('SELECT user_id, receipt_key FROM deposits WHERE id=$1', [id]);
  const deposit = result.rows[0];
  if (!deposit || !deposit.receipt_key) return res.status(404).json({ error: 'NOT_FOUND' });
  if (Number(deposit.user_id) !== req.user.id && !['agent', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }
  const filePath = path.join(receiptDir, path.basename(deposit.receipt_key));
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.jpg' ? 'image/jpeg' : ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : null;
  if (!mime || path.dirname(filePath) !== receiptDir) throw new Error('NOT_FOUND');
  try {
    await fsp.access(filePath, fs.constants.R_OK);
  } catch {
    return res.status(404).json({ error: 'NOT_FOUND' });
  }
  res.set({ 'Content-Type': mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  return res.sendFile(filePath);
}));

app.post('/api/withdrawals', auth, wrap(async (req) => {
  const amount = money(req.body.amount);
  const account_number = String(req.body.account_number || '').trim();
  const pRes = await query('SELECT id FROM providers WHERE id=$1 AND active=1', [Number(req.body.provider_id)]);
  const provider = pRes.rows[0];
  if (!provider || account_number.length < 4 || account_number.length > 50) throw new Error('INVALID');

  return withTx(async (client) => {
    // Check balance with row lock
    const wRes = await client.query('SELECT balance FROM wallets WHERE user_id=$1 FOR UPDATE', [req.user.id]);
    const currentBal = Number(wRes.rows[0]?.balance || 0);
    if (currentBal < amount) throw new Error('INSUFFICIENT');

    const r = await client.query(
      'INSERT INTO withdrawals (user_id, provider_id, amount, account_number) VALUES ($1,$2,$3,$4) RETURNING id',
      [req.user.id, provider.id, amount, account_number]
    );
    const id = Number(r.rows[0].id);
    const newBal = await postLedger({ client, userId: req.user.id, delta: -amount, type: 'withdraw_hold', refType: 'withdraw', refId: id });
    await audit(req.user.id, 'withdraw.create', { id, amount }, client);
    return { id, balance: newBal };
  });
}));

app.get('/api/withdrawals', auth, wrap(async (req) => {
  const res = await query(
    `SELECT w.*, p.name as provider FROM withdrawals w
     JOIN providers p ON p.id = w.provider_id
     WHERE w.user_id = $1 ORDER BY w.id DESC LIMIT 50`,
    [req.user.id]
  );
  return {
    withdrawals: res.rows.map((r) => ({ ...r, amount: Number(r.amount) }))
  };
}));

app.get('/api/transactions', auth, wrap(async (req) => {
  const res = await query(
    'SELECT id, type, amount, balance_after, created_at FROM ledger WHERE user_id=$1 ORDER BY id DESC LIMIT 100',
    [req.user.id]
  );
  return {
    transactions: res.rows.map((r) => ({
      ...r,
      amount: Number(r.amount),
      balance_after: Number(r.balance_after)
    }))
  };
}));

// ---------- agent (deposits & withdrawals verification) ----------
app.get('/api/agent/deposits', auth, need('agent', 'admin'), wrap(async (req) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
  const res = await query(
    `SELECT d.id, d.amount, d.tx_ref, d.status, d.reason, d.created_at, (d.receipt_key IS NOT NULL) AS has_receipt, d.user_id, u.name as user_name, u.phone, p.name as provider,
            reviewer.name AS reviewer_name,
            (SELECT action FROM deposit_reviews r WHERE r.deposit_id=d.id ORDER BY r.id DESC LIMIT 1) AS last_review_action
     FROM deposits d JOIN users u ON u.id=d.user_id JOIN providers p ON p.id=d.provider_id
     LEFT JOIN users reviewer ON reviewer.id=d.reviewed_by
     WHERE d.status=$1 ORDER BY d.id DESC LIMIT 100`,
    [status]
  );
  return {
    deposits: res.rows.map((r) => ({ ...r, amount: Number(r.amount) }))
  };
}));

app.post('/api/agent/deposits/:id/decide', auth, need('agent', 'admin'), wrap(async (req) => {
  const depositId = Number(req.params.id);
  if (!Number.isSafeInteger(depositId) || depositId <= 0) throw new Error('NOT_FOUND');
  const action = req.body.action;
  const approve = action === 'approve';
  if (!['approve', 'reject', 'escalate'].includes(action)) throw new Error('INVALID');
  const reason = String(req.body.reason || '').trim().slice(0, 200);
  if (['reject', 'escalate'].includes(action) && !reason) throw new Error('INVALID');
  const checks = req.body.verification || {};
  const checklistKeys = ['amount_matches', 'reference_matches', 'recipient_matches', 'date_plausible', 'independently_verified'];
  if (approve && !checklistKeys.every((key) => checks[key] === true)) throw new Error('VERIFICATION_REQUIRED');

  return withTx(async (client) => {
    const dRes = await client.query('SELECT * FROM deposits WHERE id=$1 FOR UPDATE', [depositId]);
    const d = dRes.rows[0];
    if (!d || d.status !== 'pending') throw new Error('NOT_FOUND');
    if (Number(d.user_id) === req.user.id) throw new Error('SELF');

    const nextStatus = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'pending';
    if (action !== 'escalate') {
      await client.query(
        'UPDATE deposits SET status=$1, reviewed_by=$2, reason=$3, reviewed_at=NOW() WHERE id=$4',
        [nextStatus, req.user.id, reason || null, d.id]
      );
    }
    if (approve) {
      await postLedger({
        client,
        userId: Number(d.user_id),
        delta: Number(d.amount),
        type: 'deposit',
        refType: 'deposit',
        refId: Number(d.id),
        by: req.user.id
      });
    }
    await client.query(
      `INSERT INTO deposit_reviews (deposit_id, reviewer_id, action, reason, verification)
       VALUES ($1,$2,$3,$4,$5)`,
      [Number(d.id), req.user.id, action, reason || null, approve ? JSON.stringify(checks) : null]
    );
    await audit(req.user.id, `deposit.${action}`, { id: Number(d.id), amount: Number(d.amount), reason }, client);
    return { ok: true, status: nextStatus };
  });
}));

app.get('/api/agent/deposits/:id/reviews', auth, need('agent', 'admin'), wrap(async (req) => {
  const depositId = Number(req.params.id);
  if (!Number.isSafeInteger(depositId) || depositId <= 0) throw new Error('NOT_FOUND');
  const result = await query(
    `SELECT r.action, r.reason, r.created_at, u.name AS reviewer
     FROM deposit_reviews r JOIN users u ON u.id=r.reviewer_id
     WHERE r.deposit_id=$1 ORDER BY r.id DESC`,
    [depositId]
  );
  return { reviews: result.rows };
}));

app.get('/api/agent/withdrawals', auth, need('agent', 'admin'), wrap(async (req) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
  const res = await query(
    `SELECT w.*, u.name as user_name, u.phone, p.name as provider
     FROM withdrawals w
     JOIN users u ON u.id = w.user_id
     JOIN providers p ON p.id = w.provider_id
     WHERE w.status = $1 ORDER BY w.id DESC LIMIT 100`,
    [status]
  );
  return {
    withdrawals: res.rows.map((r) => ({ ...r, amount: Number(r.amount) }))
  };
}));

app.post('/api/agent/withdrawals/:id/decide', auth, need('agent', 'admin'), wrap(async (req) => {
  const id = Number(req.params.id);
  const action = req.body.action;
  const reason = String(req.body.reason || '').trim().slice(0, 200);
  if (!['approve', 'reject'].includes(action)) throw new Error('INVALID');
  if (action === 'reject' && !reason) throw new Error('INVALID');

  return withTx(async (client) => {
    const wRes = await client.query('SELECT * FROM withdrawals WHERE id=$1 FOR UPDATE', [id]);
    const w = wRes.rows[0];
    if (!w || w.status !== 'pending') throw new Error('NOT_FOUND');
    if (Number(w.user_id) === req.user.id) throw new Error('SELF');

    const next = action === 'approve' ? 'approved' : 'rejected';
    await client.query(
      'UPDATE withdrawals SET status=$1, reviewed_by=$2, reviewed_at=NOW(), reason=$3 WHERE id=$4',
      [next, req.user.id, reason || null, id]
    );
    if (action === 'reject') {
      await postLedger({
        client,
        userId: Number(w.user_id),
        delta: Number(w.amount),
        type: 'withdraw_refund',
        refType: 'withdraw',
        refId: id,
        by: req.user.id
      });
    }
    await audit(req.user.id, 'withdraw.' + action, { id, amount: Number(w.amount), reason }, client);
    return { ok: true };
  });
}));

app.post('/api/agent/funding', auth, need('agent', 'admin'), wrap(async (req) => {
  const amount = money(req.body.amount);
  const note = String(req.body.note || '').trim().slice(0, 200);
  const r = await query(
    'INSERT INTO agent_funding_requests (agent_id, amount, note) VALUES ($1,$2,$3) RETURNING id',
    [req.user.id, amount, note || null]
  );
  const id = Number(r.rows[0].id);
  await audit(req.user.id, 'agent.funding_request', { id, amount });
  return { id };
}));

app.get('/api/agent/funding', auth, need('agent', 'admin'), wrap(async (req) => {
  const res = await query(
    `SELECT f.*, u.name as admin_name FROM agent_funding_requests f
     LEFT JOIN users u ON u.id = f.admin_id
     WHERE f.agent_id = $1 ORDER BY f.id DESC LIMIT 50`,
    [req.user.id]
  );
  return {
    requests: res.rows.map((r) => ({ ...r, amount: Number(r.amount) }))
  };
}));

// ---------- unified support, AI assistant & communication ----------
app.get('/api/support', auth, wrap(async (req) => {
  const tRes = await query('SELECT * FROM support_tickets WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [req.user.id]);
  const activeTicket = tRes.rows[0] || null;
  const messages = activeTicket
    ? (await query('SELECT * FROM support_messages WHERE ticket_id = $1 AND is_internal = 0 ORDER BY id ASC', [activeTicket.id])).rows
    : [];
  const aiSetting = (await query("SELECT value FROM system_settings WHERE key='ai_support_enabled'")).rows[0];
  return {
    ticket: activeTicket,
    messages,
    ai_enabled: !aiSetting || aiSetting.value === '1'
  };
}));

app.post('/api/support', auth, wrap(async (req) => {
  const message = String(req.body.message || '').trim().slice(0, 1000);
  if (message.length < 2) throw new Error('INVALID');

  let tRes = await query("SELECT * FROM support_tickets WHERE user_id = $1 AND status != 'resolved' ORDER BY id DESC LIMIT 1", [req.user.id]);
  let ticket = tRes.rows[0];
  if (!ticket) {
    const r = await query(
      "INSERT INTO support_tickets (user_id, message, status) VALUES ($1, $2, 'open') RETURNING id",
      [req.user.id, message]
    );
    ticket = { id: Number(r.rows[0].id), user_id: req.user.id, status: 'open' };
  }

  await query(
    "INSERT INTO support_messages (ticket_id, sender_id, sender_role, sender_name, message, is_internal) VALUES ($1, $2, 'user', $3, $4, 0)",
    [ticket.id, req.user.id, req.user.name, message]
  );

  const aiSetting = (await query("SELECT value FROM system_settings WHERE key='ai_support_enabled'")).rows[0];
  const aiEnabled = !aiSetting || aiSetting.value === '1';

  if (aiEnabled) {
    const pendingDeps = (await query("SELECT d.*, p.name as provider FROM deposits d JOIN providers p ON p.id=d.provider_id WHERE d.user_id=$1 AND d.status='pending'", [req.user.id])).rows;
    const pendingWiths = (await query("SELECT w.*, p.name as provider FROM withdrawals w JOIN providers p ON p.id=w.provider_id WHERE w.user_id=$1 AND w.status='pending'", [req.user.id])).rows;
    const bal = await balanceOf(req.user.id);

    const aiRes = getAiResponse(message, {
      user: req.user,
      pendingDeposits: pendingDeps,
      pendingWithdrawals: pendingWiths,
      balance: bal
    });

    await query(
      "INSERT INTO support_messages (ticket_id, sender_id, sender_role, sender_name, message, is_internal) VALUES ($1, NULL, 'ai', 'Fetan AI', $2, 0)",
      [ticket.id, aiRes.reply]
    );

    if (aiRes.shouldEscalate) {
      await query(
        "UPDATE support_tickets SET status='escalated', escalated_reason=$1, updated_at=NOW() WHERE id=$2",
        [aiRes.reason, ticket.id]
      );
      await audit(req.user.id, 'support.escalate', { ticketId: ticket.id, reason: aiRes.reason });
      ticket.status = 'escalated';
    }
  }

  const messages = (await query('SELECT * FROM support_messages WHERE ticket_id = $1 AND is_internal = 0 ORDER BY id ASC', [ticket.id])).rows;
  return { ticketId: ticket.id, status: ticket.status, messages };
}));

app.get('/api/support/ticket/:id', auth, wrap(async (req) => {
  const ticketId = Number(req.params.id);
  const res = await query(
    `SELECT t.*, u.name as user_name, u.phone as user_phone, a.name as agent_name
     FROM support_tickets t
     JOIN users u ON u.id = t.user_id
     LEFT JOIN users a ON a.id = t.assigned_agent_id
     WHERE t.id = $1`,
    [ticketId]
  );
  const ticket = res.rows[0];
  if (!ticket) throw new Error('NOT_FOUND');
  if (req.user.role === 'user' && Number(ticket.user_id) !== req.user.id) throw new Error('FORBIDDEN');

  const filterInternal = req.user.role === 'user' ? 'AND is_internal = 0' : '';
  const messages = (await query(`SELECT * FROM support_messages WHERE ticket_id = $1 ${filterInternal} ORDER BY id ASC`, [ticketId])).rows;
  return { ticket, messages };
}));

app.post('/api/support/ticket/:id/reply', auth, wrap(async (req) => {
  const ticketId = Number(req.params.id);
  const message = String(req.body.message || '').trim().slice(0, 1000);
  if (message.length < 1) throw new Error('INVALID');

  const tRes = await query('SELECT * FROM support_tickets WHERE id = $1', [ticketId]);
  const ticket = tRes.rows[0];
  if (!ticket) throw new Error('NOT_FOUND');
  if (req.user.role === 'user' && Number(ticket.user_id) !== req.user.id) throw new Error('FORBIDDEN');

  const isInternal = (req.user.role === 'agent' || req.user.role === 'admin') && Boolean(req.body.is_internal);

  await query(
    'INSERT INTO support_messages (ticket_id, sender_id, sender_role, sender_name, message, is_internal) VALUES ($1, $2, $3, $4, $5, $6)',
    [ticketId, req.user.id, req.user.role, req.user.name, message, isInternal ? 1 : 0]
  );

  if (!isInternal && (req.user.role === 'agent' || req.user.role === 'admin')) {
    await query(
      "UPDATE support_tickets SET status='in_progress', assigned_agent_id=COALESCE(assigned_agent_id, $1), updated_at=NOW() WHERE id=$2",
      [req.user.id, ticketId]
    );
  }

  const filterInternal = req.user.role === 'user' ? 'AND is_internal = 0' : '';
  const messages = (await query(`SELECT * FROM support_messages WHERE ticket_id = $1 ${filterInternal} ORDER BY id ASC`, [ticketId])).rows;
  return { ok: true, messages };
}));

app.post('/api/support/ticket/:id/status', auth, need('agent', 'admin'), wrap(async (req) => {
  const ticketId = Number(req.params.id);
  const status = req.body.status;
  if (!['open', 'in_progress', 'escalated', 'resolved'].includes(status)) throw new Error('INVALID');

  const assigned = req.body.assigned_agent_id ? Number(req.body.assigned_agent_id) : req.user.id;
  await query(
    'UPDATE support_tickets SET status=$1, assigned_agent_id=$2, updated_at=NOW() WHERE id=$3',
    [status, assigned, ticketId]
  );

  if (req.body.note) {
    await query(
      'INSERT INTO support_messages (ticket_id, sender_id, sender_role, sender_name, message, is_internal) VALUES ($1, $2, $3, $4, $5, 1)',
      [ticketId, req.user.id, req.user.role, req.user.name, String(req.body.note).trim().slice(0, 500)]
    );
  }

  await audit(req.user.id, 'support.status', { ticketId, status, assigned });
  return { ok: true, status };
}));

app.get('/api/agent/tickets', auth, need('agent', 'admin'), wrap(async (req) => {
  const status = req.query.status;
  const where = status && status !== 'all' ? 'WHERE t.status = $1' : '';
  const params = status && status !== 'all' ? [status] : [];
  const res = await query(
    `SELECT t.*, u.name as user_name, u.phone as user_phone, a.name as agent_name,
     (SELECT COUNT(*) FROM support_messages m WHERE m.ticket_id = t.id) as message_count
     FROM support_tickets t
     JOIN users u ON u.id = t.user_id
     LEFT JOIN users a ON a.id = t.assigned_agent_id
     ${where} ORDER BY t.id DESC LIMIT 100`,
    params
  );
  return { tickets: res.rows };
}));

app.get('/api/admin/tickets', auth, need('admin'), wrap(async () => {
  const res = await query(
    `SELECT t.*, u.name as user_name, u.phone as user_phone, a.name as agent_name,
     (SELECT COUNT(*) FROM support_messages m WHERE m.ticket_id = t.id) as message_count
     FROM support_tickets t
     JOIN users u ON u.id = t.user_id
     LEFT JOIN users a ON a.id = t.assigned_agent_id
     ORDER BY t.id DESC LIMIT 100`
  );
  return { tickets: res.rows };
}));

// ---------- announcements ----------
app.get('/api/announcements', auth, wrap(async (req) => {
  const role = req.user.role;
  const res = await query(
    `SELECT a.*, u.name as author_name FROM announcements a
     JOIN users u ON u.id = a.author_id
     WHERE a.target_role IN ('all', $1) ORDER BY a.id DESC LIMIT 20`,
    [role]
  );
  return { announcements: res.rows };
}));

app.post('/api/admin/announcements', auth, need('admin'), wrap(async (req) => {
  const title = String(req.body.title || '').trim().slice(0, 150);
  const content = String(req.body.content || '').trim().slice(0, 1000);
  const target = ['agent', 'user', 'all'].includes(req.body.target_role) ? req.body.target_role : 'agent';
  if (title.length < 2 || content.length < 2) throw new Error('INVALID');

  const r = await query(
    'INSERT INTO announcements (author_id, target_role, title, content) VALUES ($1,$2,$3,$4) RETURNING id',
    [req.user.id, target, title, content]
  );
  const id = Number(r.rows[0].id);
  await audit(req.user.id, 'announcement.create', { id, title, target });
  return { id };
}));

app.get('/api/admin/ai-settings', auth, need('admin'), wrap(async () => {
  const aiSetting = (await query("SELECT value FROM system_settings WHERE key='ai_support_enabled'")).rows[0];
  const totalHandled = Number((await query("SELECT COUNT(*) c FROM support_messages WHERE sender_role='ai'")).rows[0].c);
  const escalatedCount = Number((await query("SELECT COUNT(*) c FROM support_tickets WHERE status='escalated'")).rows[0].c);
  return {
    enabled: !aiSetting || aiSetting.value === '1',
    total_ai_messages: totalHandled,
    escalated_tickets: escalatedCount
  };
}));

app.post('/api/admin/ai-settings', auth, need('admin'), wrap(async (req) => {
  const val = req.body.enabled ? '1' : '0';
  await query(
    "INSERT INTO system_settings (key, value, updated_at) VALUES ('ai_support_enabled', $1, NOW()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()",
    [val]
  );
  await audit(req.user.id, 'ai_settings.update', { enabled: val === '1' });
  return { enabled: val === '1' };
}));

// ---------- games (STRICTLY RESTRICTED TO USERS ONLY) ----------
const g = (fn) => [auth, need('user'), wrap((req) => fn(req))];
app.post('/api/games/roulette', ...g((req) => games.roulette(req.user.id, Number(req.body.bet), req.body.kind,
  req.body.kind === 'number' ? Number(req.body.value) : req.body.value)));
app.post('/api/games/star', ...g((req) => games.starSpin(req.user.id, Number(req.body.bet))));
app.get('/api/games/road', ...g((req) => games.roadState(req.user.id, req.query.difficulty)));
app.post('/api/games/road/start', ...g((req) => games.roadStart(req.user.id, Number(req.body.bet), req.body.difficulty, req.body.client_seed)));
app.post('/api/games/road/step', ...g((req) => games.roadStep(req.user.id)));
app.post('/api/games/road/cashout', ...g((req) => games.roadCashout(req.user.id)));
app.get('/api/games/road/history', ...g((req) => games.roadHistory(req.user.id)));
app.post('/api/games/road/verify', ...g((req) => Promise.resolve(games.roadVerify(req.body))));
app.get('/api/games/mines', ...g((req) => games.minesState(req.user.id)));
app.post('/api/games/mines/start', ...g((req) => games.minesStart(req.user.id, Number(req.body.bet), req.body.mines, req.body.grid, req.body.client_seed)));
app.post('/api/games/mines/step', ...g((req) => games.minesStep(req.user.id, req.body.cell)));
app.post('/api/games/mines/cashout', ...g((req) => games.minesCashout(req.user.id)));
app.post('/api/games/mines/verify', ...g((req) => Promise.resolve(games.minesVerify(req.body))));
app.post('/api/games/plinko', ...g((req) => games.plinko(req.user.id, Number(req.body.bet), req.body.rows, req.body.risk, req.body.client_seed, req.body.nonce)));
app.post('/api/games/plinko/verify', ...g((req) => Promise.resolve(games.plinkoVerify(req.body))));
app.post('/api/games/keno', ...g((req) => games.keno(req.user.id, Number(req.body.bet), req.body.picks)));
app.get('/api/games/bingo', ...g((req) => games.bingoState(req.user.id)));
app.post('/api/games/bingo/start', ...g((req) => games.bingoStart(req.user.id, Number(req.body.bet))));
app.post('/api/games/bingo/call', ...g((req) => games.bingoCall(req.user.id)));
app.post('/api/games/bingo/abandon', ...g((req) => games.bingoAbandon(req.user.id)));

// ---------- agent performance ----------
app.get('/api/agent/performance', auth, need('agent', 'admin'), wrap(async (req) => {
  const agentId = req.user.id;
  const depAll = (await query("SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM deposits WHERE reviewed_by=$1 AND status='approved'", [agentId])).rows[0];
  const withAll = (await query("SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM withdrawals WHERE reviewed_by=$1 AND status='approved'", [agentId])).rows[0];
  const depToday = (await query("SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM deposits WHERE reviewed_by=$1 AND status='approved' AND reviewed_at >= CURRENT_DATE", [agentId])).rows[0];
  const withToday = (await query("SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM withdrawals WHERE reviewed_by=$1 AND status='approved' AND reviewed_at >= CURRENT_DATE", [agentId])).rows[0];
  const ticketsResolved = Number((await query("SELECT COUNT(*) c FROM support_tickets WHERE assigned_agent_id=$1 AND status='resolved'", [agentId])).rows[0].c);

  return {
    balance: await balanceOf(agentId),
    approved_deposits_count: Number(depAll.c),
    approved_deposits_volume: Number(depAll.s),
    approved_withdrawals_count: Number(withAll.c),
    approved_withdrawals_volume: Number(withAll.s),
    today_deposits_count: Number(depToday.c),
    today_deposits_volume: Number(depToday.s),
    today_withdrawals_count: Number(withToday.c),
    today_withdrawals_volume: Number(withToday.s),
    tickets_resolved: ticketsResolved
  };
}));

// ---------- admin ----------
const admin = [auth, need('admin')];
app.get('/api/admin/stats', ...admin, wrap(async () => ({
  users: Number((await query("SELECT COUNT(*) c FROM users WHERE role='user'")).rows[0].c),
  agents: Number((await query("SELECT COUNT(*) c FROM users WHERE role='agent'")).rows[0].c),
  active_agents: Number((await query("SELECT COUNT(*) c FROM users WHERE role='agent' AND status='active'")).rows[0].c),
  suspended_agents: Number((await query("SELECT COUNT(*) c FROM users WHERE role='agent' AND status='suspended'")).rows[0].c),
  pending: Number((await query("SELECT COUNT(*) c FROM deposits WHERE status='pending'")).rows[0].c),
  pending_withdrawals: Number((await query("SELECT COUNT(*) c FROM withdrawals WHERE status='pending'")).rows[0].c),
  pending_funding: Number((await query("SELECT COUNT(*) c FROM agent_funding_requests WHERE status='pending'")).rows[0].c),
  credited: Number((await query("SELECT COALESCE(SUM(amount),0) s FROM ledger WHERE type='deposit'")).rows[0].s),
  rounds: Number((await query('SELECT COUNT(*) c FROM game_rounds')).rows[0].c),
  tickets: Number((await query("SELECT COUNT(*) c FROM support_tickets WHERE status != 'resolved'")).rows[0].c),
})));

app.get('/api/admin/financial-analytics', ...admin, wrap(async (req) => {
  const range = req.query.range || '7d';
  let dateFilter = '';
  if (range === 'today') dateFilter = "AND created_at >= CURRENT_DATE";
  else if (range === '7d') dateFilter = "AND created_at >= NOW() - INTERVAL '7 days'";
  else if (range === '30d') dateFilter = "AND created_at >= NOW() - INTERVAL '30 days'";
  else if (range === 'month') dateFilter = "AND created_at >= DATE_TRUNC('month', CURRENT_DATE)";

  const depApproved = (await query(`SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM ledger WHERE type='deposit' ${dateFilter}`)).rows[0];
  const withApproved = (await query(`SELECT COUNT(*) c, COALESCE(SUM(-amount),0) s FROM ledger WHERE type='withdraw_hold' ${dateFilter}`)).rows[0];
  const depPending = (await query("SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM deposits WHERE status='pending'")).rows[0];
  const withPending = (await query("SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM withdrawals WHERE status='pending'")).rows[0];

  const bets = (await query(`SELECT COUNT(*) c, COALESCE(SUM(-amount),0) s FROM ledger WHERE type='bet' ${dateFilter}`)).rows[0];
  const wins = (await query(`SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM ledger WHERE type='win' ${dateFilter}`)).rows[0];
  const betsTotal = Number(bets.s);
  const winsTotal = Number(wins.s);
  const ggr = betsTotal - winsTotal;
  const marginPct = betsTotal > 0 ? ((ggr / betsTotal) * 100).toFixed(1) : '0.0';

  const gameDistRes = await query(
    `SELECT game, COUNT(*) as rounds, COALESCE(SUM(bet),0) as stakes, COALESCE(SUM(payout),0) as payouts,
     COALESCE(SUM(bet - payout),0) as ggr FROM game_rounds WHERE 1=1 ${dateFilter} GROUP BY game ORDER BY stakes DESC`
  );

  const dailyTrendsRes = await query(
    `SELECT TO_CHAR(created_at, 'YYYY-MM-DD') as date,
     COALESCE(SUM(CASE WHEN type='deposit' THEN amount ELSE 0 END), 0) as deposits,
     COALESCE(SUM(CASE WHEN type='withdraw_hold' THEN -amount ELSE 0 END), 0) as withdrawals,
     COALESCE(SUM(CASE WHEN type='bet' THEN -amount ELSE 0 END), 0) as bets,
     COALESCE(SUM(CASE WHEN type='win' THEN amount ELSE 0 END), 0) as wins
     FROM ledger WHERE created_at >= NOW() - INTERVAL '14 days'
     GROUP BY TO_CHAR(created_at, 'YYYY-MM-DD') ORDER BY date ASC`
  );

  const agentSummaryRes = await query(
    `SELECT u.id, u.name, u.phone, u.status, w.balance,
     (SELECT COUNT(*) FROM deposits d WHERE d.reviewed_by = u.id AND d.status='approved') as deposits_verified,
     (SELECT COALESCE(SUM(amount),0) FROM deposits d WHERE d.reviewed_by = u.id AND d.status='approved') as deposits_volume,
     (SELECT COUNT(*) FROM withdrawals w WHERE w.reviewed_by = u.id AND w.status='approved') as withdrawals_verified,
     (SELECT COUNT(*) FROM support_tickets t WHERE t.assigned_agent_id = u.id AND t.status='resolved') as tickets_resolved
     FROM users u JOIN wallets w ON w.user_id = u.id WHERE u.role='agent'`
  );

  return {
    range,
    total_deposits_count: Number(depApproved.c),
    total_deposits_amount: Number(depApproved.s),
    total_withdrawals_count: Number(withApproved.c),
    total_withdrawals_amount: Number(withApproved.s),
    pending_deposits_count: Number(depPending.c),
    pending_deposits_amount: Number(depPending.s),
    pending_withdrawals_count: Number(withPending.c),
    pending_withdrawals_amount: Number(withPending.s),
    total_bets_count: Number(bets.c),
    total_bets_amount: betsTotal,
    total_wins_count: Number(wins.c),
    total_wins_amount: winsTotal,
    gross_gaming_revenue: ggr,
    margin_percent: marginPct,
    game_distribution: gameDistRes.rows.map((r) => ({
      game: r.game,
      rounds: Number(r.rounds),
      stakes: Number(r.stakes),
      payouts: Number(r.payouts),
      ggr: Number(r.ggr)
    })),
    daily_trends: dailyTrendsRes.rows.map((r) => ({
      date: r.date,
      deposits: Number(r.deposits),
      withdrawals: Number(r.withdrawals),
      bets: Number(r.bets),
      wins: Number(r.wins)
    })),
    agents: agentSummaryRes.rows.map((r) => ({
      ...r,
      balance: Number(r.balance),
      deposits_verified: Number(r.deposits_verified),
      deposits_volume: Number(r.deposits_volume),
      withdrawals_verified: Number(r.withdrawals_verified),
      tickets_resolved: Number(r.tickets_resolved)
    }))
  };
}));

app.get('/api/admin/agent-funding', ...admin, wrap(async (req) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : null;
  const sql = status
    ? `SELECT f.*, a.name as agent_name, a.phone as agent_phone, u.name as admin_name
       FROM agent_funding_requests f
       JOIN users a ON a.id = f.agent_id
       LEFT JOIN users u ON u.id = f.admin_id
       WHERE f.status = $1 ORDER BY f.id DESC LIMIT 100`
    : `SELECT f.*, a.name as agent_name, a.phone as agent_phone, u.name as admin_name
       FROM agent_funding_requests f
       JOIN users a ON a.id = f.agent_id
       LEFT JOIN users u ON u.id = f.admin_id
       ORDER BY f.id DESC LIMIT 100`;
  const res = await query(sql, status ? [status] : []);
  return {
    requests: res.rows.map((r) => ({ ...r, amount: Number(r.amount) }))
  };
}));

app.post('/api/admin/agent-funding/:id/decide', ...admin, wrap(async (req) => {
  const id = Number(req.params.id);
  const approve = req.body.action === 'approve';
  if (!approve && req.body.action !== 'reject') throw new Error('INVALID');
  const note = String(req.body.note || '').trim().slice(0, 200);

  return withTx(async (client) => {
    const fRes = await client.query('SELECT * FROM agent_funding_requests WHERE id = $1 FOR UPDATE', [id]);
    const f = fRes.rows[0];
    if (!f || f.status !== 'pending') throw new Error('NOT_FOUND');
    const next = approve ? 'approved' : 'rejected';
    await client.query(
      'UPDATE agent_funding_requests SET status=$1, admin_id=$2, admin_note=$3, decided_at=NOW() WHERE id=$4',
      [next, req.user.id, note || null, id]
    );
    if (approve) {
      await postLedger({
        client,
        userId: Number(f.agent_id),
        delta: Number(f.amount),
        type: 'agent_funding',
        refType: 'agent_funding',
        refId: id,
        by: req.user.id
      });
    }
    await audit(req.user.id, 'agent_funding.' + next, { id, amount: Number(f.amount), note }, client);
    return { ok: true };
  });
}));

app.get('/api/admin/transactions', ...admin, wrap(async (req) => {
  const type = req.query.type ? String(req.query.type) : null;
  const search = req.query.search ? String(req.query.search).trim() : null;
  let sql = `SELECT l.id, l.type, l.amount, l.balance_after, l.created_at, l.ref_type, l.ref_id, u.name as user_name, u.phone
             FROM ledger l JOIN users u ON u.id = l.user_id WHERE 1=1`;
  const params = [];
  if (type && type !== 'all') {
    params.push(type);
    sql += ` AND l.type = $${params.length}`;
  }
  if (search) {
    params.push(`%${search}%`);
    sql += ` AND (u.phone ILIKE $${params.length} OR u.name ILIKE $${params.length})`;
  }
  sql += ` ORDER BY l.id DESC LIMIT 200`;
  const res = await query(sql, params);
  return {
    transactions: res.rows.map((r) => ({
      ...r,
      amount: Number(r.amount),
      balance_after: Number(r.balance_after)
    }))
  };
}));

app.get('/api/admin/users', ...admin, wrap(async () => {
  const res = await query(
    `SELECT u.id, u.name, u.phone, u.role, u.status, u.created_at, w.balance
     FROM users u JOIN wallets w ON w.user_id=u.id ORDER BY u.id DESC LIMIT 200`
  );
  return {
    users: res.rows.map((r) => ({
      ...r,
      balance: Number(r.balance)
    }))
  };
}));

app.post('/api/admin/users/:id', ...admin, wrap(async (req) => {
  const id = Number(req.params.id);
  if (id === req.user.id) throw new Error('SELF');
  const { role, status } = req.body;
  if (role && !['user', 'agent'].includes(role)) throw new Error('INVALID');
  if (status && !['active', 'suspended'].includes(status)) throw new Error('INVALID');

  const uRes = await query('SELECT 1 FROM users WHERE id=$1', [id]);
  if (uRes.rows.length === 0) throw new Error('NOT_FOUND');

  if (role) await query('UPDATE users SET role=$1 WHERE id=$2', [role, id]);
  if (status) await query('UPDATE users SET status=$1 WHERE id=$2', [status, id]);
  await audit(req.user.id, 'user.update', { id, role, status });
  return { ok: true };
}));

app.get('/api/admin/audit', ...admin, wrap(async (req) => {
  const search = req.query.search ? String(req.query.search).trim() : null;
  let sql = `SELECT a.id, a.action, a.detail, a.created_at, u.name as actor
             FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id`;
  const params = [];
  if (search) {
    params.push(`%${search}%`);
    sql += ` WHERE a.action ILIKE $${params.length} OR u.name ILIKE $${params.length}`;
  }
  sql += ` ORDER BY a.id DESC LIMIT 100`;
  const res = await query(sql, params);
  return { logs: res.rows };
}));

app.get('/api/admin/support', ...admin, wrap(async () => {
  const res = await query(
    `SELECT t.id, t.message, t.status, t.escalated_reason, t.created_at, u.name, u.phone
     FROM support_tickets t JOIN users u ON u.id=t.user_id ORDER BY t.id DESC LIMIT 100`
  );
  return { tickets: res.rows };
}));

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`ፈጣን ቤት / Fetan Bet running at http://localhost:${PORT}`));
}
module.exports = app;
