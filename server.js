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
const { hasPermission } = require('./permissions');
const { commissionForWeek, utcWeekBounds, completedWeekBounds, DEFAULT_COMMISSION_BPS } = require('./agent-finance');

if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET must be configured with at least 32 characters in production.');
}
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

// Integration tests supply explicit synthetic fixtures; never run application seeding there.
if (process.env.FETAN_INTEGRATION_TEST !== '1') {
  seed().catch((err) => console.error('[seed] Initialization error:', err.message));
}

// ---------- helpers ----------
const wrap = (fn) => async (req, res) => {
  try {
    const result = await fn(req, res);
    if (!res.headersSent && result !== res) res.json(result ?? { ok: true });
  } catch (e) {
    const known = ['INSUFFICIENT', 'INVALID', 'INVALID_FILE', 'VERIFICATION_REQUIRED', 'REAUTH_REQUIRED', 'PROMO_INVALID', 'PROMO_SUSPENDED', 'INVALID_NAME', 'INVALID_PHONE', 'INVALID_PASSWORD', 'ACTIVE_ROUND', 'NOT_FOUND', 'DUP_REF', 'SELF', 'FORBIDDEN', 'EXISTS', 'LOGIN', 'SUSPENDED', 'RATE'];
    if (e.message === 'SETTLEMENT_GAP') return res.status(409).json({ error: 'SETTLEMENT_GAP' });
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
  roles.some((permission) => hasPermission(req.user.role, permission)) ? next() : res.status(403).json({ error: 'FORBIDDEN' });

async function requireRecentPassword(req, password) {
  if (typeof password !== 'string' || !password) throw new Error('REAUTH_REQUIRED');
  const result = await query('SELECT password_hash FROM users WHERE id=$1 AND role=\'superadmin\' AND status=\'active\'', [req.user.id]);
  if (!result.rows[0] || !bcrypt.compareSync(password, result.rows[0].password_hash)) throw new Error('REAUTH_REQUIRED');
}

async function auditSensitive(req, client, action, targetType, targetId, beforeValue, afterValue, reason = null) {
  const beforeJson = beforeValue == null ? null : JSON.stringify(beforeValue);
  const afterJson = afterValue == null ? null : JSON.stringify(afterValue);
  const actorIp = String(req.ip || '').slice(0, 100);
  await client.query(
    `INSERT INTO staff_action_history(actor_id, action, target_type, target_id, before_value, after_value, reason, actor_ip)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)`,
    [req.user.id, action, targetType, targetId, beforeJson, afterJson, reason, actorIp]
  );
  await client.query(
    `INSERT INTO audit_logs(actor_id, action, detail, actor_ip, before_value, after_value)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
    [req.user.id, action, JSON.stringify({ target_type: targetType, target_id: targetId, reason }), actorIp, beforeJson, afterJson]
  );
}

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

  const promoCode = String(req.body.promo_code || '').trim();
  const id = await withTx(async(client)=>{
    let referredByAgentId = null;
    if (promoCode) {
      const referral = await client.query(
        `SELECT p.agent_id, u.status FROM agent_profiles p JOIN users u ON u.id=p.agent_id
         WHERE LOWER(p.promo_code)=LOWER($1) FOR SHARE OF u`, [promoCode]
      );
      if (!referral.rows[0]) throw new Error('PROMO_INVALID');
      if (referral.rows[0].status !== 'active') throw new Error('PROMO_SUSPENDED');
      referredByAgentId = Number(referral.rows[0].agent_id);
    }
    const createdId = await createUser({ name, phone, password, lang, referredByAgentId, client });
    await audit(createdId, 'register', { referred_by_agent_id: referredByAgentId, actor_ip: req.ip }, client);
    return createdId;
  }).catch((error)=>{if(error.code==='23505')throw new Error('EXISTS');throw error;});
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

  if (!u && lower === 'admin') {
    const adminRes = await query("SELECT * FROM users WHERE role IN ('admin','superadmin') ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, id LIMIT 1");
    u = adminRes.rows[0];
  } else if (!u && lower === 'superadmin') {
    const adminRes = await query("SELECT * FROM users WHERE role='superadmin' ORDER BY id LIMIT 1");
    u = adminRes.rows[0];
  }

  if (!u) throw new Error('LOGIN');
  const validPass = bcrypt.compareSync(pass, u.password_hash);
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
app.get('/api/providers', auth, need('customer'), wrap(async () => {
  const res = await query('SELECT id, code, name, mode, instr_en, instr_am FROM providers WHERE active=1');
  return { providers: res.rows };
}));

app.post('/api/deposits', auth, need('customer'), wrap(async (req) => {
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
    return { id, existing: false };
  } catch (e) {
    if (receiptKey) await fsp.unlink(path.join(receiptDir, receiptKey)).catch(() => {});
    if (e.code === '23505') {
      const duplicate = await query(
        'SELECT id, user_id, status FROM deposits WHERE provider_id=$1 AND tx_ref=$2',
        [provider.id, tx_ref]
      );
      const existing = duplicate.rows[0];
      if (existing && Number(existing.user_id) === req.user.id) {
        return { id: Number(existing.id), existing: true, status: existing.status };
      }
      if (existing) throw new Error('DUP_REF');
    }
    throw e;
  }
}));

app.get('/api/deposits', auth, need('customer'), wrap(async (req) => {
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
  const result = await query(`SELECT d.user_id,d.receipt_key,u.referred_by_agent_id FROM deposits d JOIN users u ON u.id=d.user_id WHERE d.id=$1`, [id]);
  const deposit = result.rows[0];
  if (!deposit || !deposit.receipt_key) return res.status(404).json({ error: 'NOT_FOUND' });
  const staffAllowed = ['admin','superadmin'].includes(req.user.role);
  const agentAllowed = req.user.role === 'agent' && Number(deposit.referred_by_agent_id) === req.user.id;
  if (Number(deposit.user_id) !== req.user.id && !staffAllowed && !agentAllowed) {
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

app.post('/api/withdrawals', auth, need('customer'), wrap(async (req) => {
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

app.get('/api/withdrawals', auth, need('customer'), wrap(async (req) => {
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

app.get('/api/transactions', auth, need('customer'), wrap(async (req) => {
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
app.get('/api/agent/deposits', auth, need('admin.workspace'), wrap(async (req) => {
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

app.post('/api/agent/deposits/:id/decide', auth, need('money.decide'), wrap(async (req) => {
  const depositId = Number(req.params.id);
  if (!Number.isSafeInteger(depositId) || depositId <= 0) throw new Error('NOT_FOUND');
  const action = req.body.action;
  const approve = action === 'approve';
  await requireRecentPassword(req, req.body.reauth_password);
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
      `INSERT INTO deposit_reviews (deposit_id, reviewer_id, action, reason, verification, before_status, after_status, actor_ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [Number(d.id), req.user.id, action, reason || null, approve ? JSON.stringify(checks) : null, d.status, nextStatus, String(req.ip || '').slice(0, 100)]
    );
    await auditSensitive(req, client, `deposit.${action}`, 'deposit', Number(d.id), { status: d.status }, { status: nextStatus, amount_santim: Number(d.amount) }, reason || null);
    return { ok: true, status: nextStatus };
  });
}));

app.get('/api/agent/deposits/:id/reviews', auth, need('admin.workspace'), wrap(async (req) => {
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

app.get('/api/agent/withdrawals', auth, need('admin.workspace'), wrap(async (req) => {
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

app.post('/api/agent/withdrawals/:id/decide', auth, need('money.decide'), wrap(async (req) => {
  const id = Number(req.params.id);
  const action = req.body.action;
  const reason = String(req.body.reason || '').trim().slice(0, 200);
  if (!['approve', 'reject'].includes(action)) throw new Error('INVALID');
  if (action === 'reject' && !reason) throw new Error('INVALID');
  await requireRecentPassword(req, req.body.reauth_password);

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
    await client.query(
      `INSERT INTO withdrawal_reviews(withdrawal_id, reviewer_id, action, before_status, after_status, reason, actor_ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, req.user.id, action, w.status, next, reason || null, String(req.ip || '').slice(0, 100)]
    );
    await auditSensitive(req, client, 'withdraw.' + action, 'withdrawal', id, { status: w.status }, { status: next, amount_santim: Number(w.amount) }, reason || null);
    return { ok: true };
  });
}));

// Manual payout completion is recorded only after an authorized operator confirms
// the external payment. The existing withdrawal hold is not charged a second time.
app.post('/api/superadmin/withdrawals/:id/complete', auth, need('money.decide'), wrap(async (req) => {
  const id=Number(req.params.id), paymentReference=String(req.body.payment_reference||'').trim().slice(0,100);
  if (!Number.isSafeInteger(id)||id<=0||paymentReference.length<4) throw new Error('INVALID');
  await requireRecentPassword(req,req.body.reauth_password);
  return withTx(async (client)=>{
    const result=await client.query('SELECT * FROM withdrawals WHERE id=$1 FOR UPDATE',[id]);
    const w=result.rows[0];
    if (!w||w.status!=='approved') throw new Error('NOT_FOUND');
    await client.query("UPDATE withdrawals SET status='paid', reviewed_by=$1, reviewed_at=NOW(), reason=$2 WHERE id=$3",[req.user.id,`External payout reference: ${paymentReference}`,id]);
    await client.query(`INSERT INTO withdrawal_reviews(withdrawal_id,reviewer_id,action,before_status,after_status,reason,actor_ip)
      VALUES($1,$2,'complete','approved','paid',$3,$4)`,[id,req.user.id,`External payout reference: ${paymentReference}`,String(req.ip||'').slice(0,100)]);
    await auditSensitive(req,client,'withdraw.complete','withdrawal',id,{status:'approved'},{status:'paid',payment_reference:paymentReference});
    return {ok:true,status:'paid'};
  });
}));

app.post('/api/agent/funding', auth, need('agent.workspace'), (req, res) =>
  res.status(410).json({ error: 'LEGACY_DISABLED' })
);

app.get('/api/agent/funding', auth, need('agent.workspace'), wrap(async (req) => {
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
app.get('/api/support', auth, need('support.own'), wrap(async (req) => {
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

app.post('/api/support', auth, need('support.own'), wrap(async (req) => {
  const message = String(req.body.message || '').trim().slice(0, 1000);
  if (message.length < 2) throw new Error('INVALID');

  let tRes = await query("SELECT * FROM support_tickets WHERE user_id = $1 AND status != 'resolved' ORDER BY id DESC LIMIT 1", [req.user.id]);
  let ticket = tRes.rows[0];
  if (!ticket) {
    const referral = await query('SELECT referred_by_agent_id FROM users WHERE id=$1', [req.user.id]);
    const assignedAgentId = referral.rows[0]?.referred_by_agent_id || null;
    const r = await query(
      "INSERT INTO support_tickets (user_id, message, status, assigned_agent_id) VALUES ($1, $2, 'open', $3) RETURNING id",
      [req.user.id, message, assignedAgentId]
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
        `UPDATE support_tickets t SET status='escalated', escalated_reason=$1,
         assigned_agent_id=COALESCE(t.assigned_agent_id, u.referred_by_agent_id), updated_at=NOW()
         FROM users u WHERE u.id=t.user_id AND t.id=$2`,
        [aiRes.reason, ticket.id]
      );
      await audit(req.user.id, 'support.escalate', { ticketId: ticket.id, reason: aiRes.reason });
      ticket.status = 'escalated';
    }
  }

  const messages = (await query('SELECT * FROM support_messages WHERE ticket_id = $1 AND is_internal = 0 ORDER BY id ASC', [ticket.id])).rows;
  return { ticketId: ticket.id, status: ticket.status, messages };
}));

app.get('/api/support/ticket/:id', auth, need('support.own', 'support.assigned', 'support.all'), wrap(async (req) => {
  const ticketId = Number(req.params.id);
  const res = await query(
    `SELECT t.*, u.name as user_name, u.phone as user_phone, u.referred_by_agent_id, a.name as agent_name
     FROM support_tickets t
     JOIN users u ON u.id = t.user_id
     LEFT JOIN users a ON a.id = t.assigned_agent_id
     WHERE t.id = $1`,
    [ticketId]
  );
  const ticket = res.rows[0];
  if (!ticket) throw new Error('NOT_FOUND');
  if (req.user.role === 'user' && Number(ticket.user_id) !== req.user.id) throw new Error('FORBIDDEN');
  if (req.user.role === 'agent' && Number(ticket.referred_by_agent_id) !== req.user.id) throw new Error('FORBIDDEN');

  const filterInternal = req.user.role === 'user' ? 'AND is_internal = 0' : '';
  const messages = (await query(`SELECT * FROM support_messages WHERE ticket_id = $1 ${filterInternal} ORDER BY id ASC`, [ticketId])).rows;
  return { ticket, messages };
}));

app.post('/api/support/ticket/:id/reply', auth, need('support.reply'), wrap(async (req) => {
  const ticketId = Number(req.params.id);
  const message = String(req.body.message || '').trim().slice(0, 1000);
  if (message.length < 1) throw new Error('INVALID');

  const tRes = await query(`SELECT t.*, u.referred_by_agent_id FROM support_tickets t JOIN users u ON u.id=t.user_id WHERE t.id = $1`, [ticketId]);
  const ticket = tRes.rows[0];
  if (!ticket) throw new Error('NOT_FOUND');
  if (req.user.role === 'user' && Number(ticket.user_id) !== req.user.id) throw new Error('FORBIDDEN');
  if (req.user.role === 'agent' && Number(ticket.referred_by_agent_id) !== req.user.id) throw new Error('FORBIDDEN');

  const isInternal = ['agent', 'admin', 'superadmin'].includes(req.user.role) && Boolean(req.body.is_internal);

  await query(
    'INSERT INTO support_messages (ticket_id, sender_id, sender_role, sender_name, message, is_internal) VALUES ($1, $2, $3, $4, $5, $6)',
    [ticketId, req.user.id, req.user.role, req.user.name, message, isInternal ? 1 : 0]
  );

  if (!isInternal && ['agent', 'admin', 'superadmin'].includes(req.user.role)) {
    await query(
      "UPDATE support_tickets SET status='in_progress', assigned_agent_id=COALESCE(assigned_agent_id, $1), updated_at=NOW() WHERE id=$2",
      [req.user.role === 'agent' ? req.user.id : ticket.assigned_agent_id, ticketId]
    );
  }

  const filterInternal = req.user.role === 'user' ? 'AND is_internal = 0' : '';
  const messages = (await query(`SELECT * FROM support_messages WHERE ticket_id = $1 ${filterInternal} ORDER BY id ASC`, [ticketId])).rows;
  return { ok: true, messages };
}));

app.post('/api/support/ticket/:id/status', auth, need('support.assigned', 'support.all'), wrap(async (req) => {
  const ticketId = Number(req.params.id);
  const status = req.body.status;
  if (!['open', 'in_progress', 'escalated', 'resolved'].includes(status)) throw new Error('INVALID');
  if (!Number.isSafeInteger(ticketId) || ticketId <= 0) throw new Error('NOT_FOUND');
  return withTx(async (client) => {
    const tRes = await client.query(
      `SELECT t.id,t.user_id,t.status,t.assigned_agent_id,u.referred_by_agent_id
       FROM support_tickets t JOIN users u ON u.id=t.user_id WHERE t.id=$1 FOR UPDATE OF t`, [ticketId]
    );
    const ticket = tRes.rows[0];
    if (!ticket) throw new Error('NOT_FOUND');
    if (req.user.role === 'agent' && Number(ticket.referred_by_agent_id) !== req.user.id) throw new Error('FORBIDDEN');
    const assigned = req.user.role === 'agent' ? req.user.id : (req.body.assigned_agent_id ? Number(req.body.assigned_agent_id) : ticket.assigned_agent_id);
    if (req.user.role !== 'agent' && assigned != null) {
      const assignee = await client.query("SELECT 1 FROM users WHERE id=$1 AND role='agent' AND status='active'", [assigned]);
      if (!assignee.rows[0]) throw new Error('INVALID');
    }
    await client.query('UPDATE support_tickets SET status=$1,assigned_agent_id=$2,updated_at=NOW() WHERE id=$3', [status, assigned, ticketId]);
    if (req.body.note) {
      await client.query(
        'INSERT INTO support_messages (ticket_id,sender_id,sender_role,sender_name,message,is_internal) VALUES ($1,$2,$3,$4,$5,1)',
        [ticketId, req.user.id, req.user.role, req.user.name, String(req.body.note).trim().slice(0, 500)]
      );
    }
    await auditSensitive(req, client, 'support.status', 'support_ticket', ticketId,
      { status: ticket.status, assigned_agent_id: ticket.assigned_agent_id == null ? null : Number(ticket.assigned_agent_id) },
      { status, assigned_agent_id: assigned == null ? null : Number(assigned) }, req.body.note || null);
    return { ok: true, status };
  });
}));

app.get('/api/agent/tickets', auth, need('support.assigned', 'support.all'), wrap(async (req) => {
  const status = req.query.status;
  const conditions = [];
  const params = [];
  if (req.user.role === 'agent') { params.push(req.user.id); conditions.push(`u.referred_by_agent_id=$${params.length}`); }
  if (status && status !== 'all') { params.push(status); conditions.push(`t.status=$${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
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

app.get('/api/admin/tickets', auth, need('support.all'), wrap(async () => {
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

app.post('/api/admin/announcements', auth, need('admin.manage'), wrap(async (req) => {
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

app.get('/api/admin/ai-settings', auth, need('admin.workspace'), wrap(async () => {
  const aiSetting = (await query("SELECT value FROM system_settings WHERE key='ai_support_enabled'")).rows[0];
  const totalHandled = Number((await query("SELECT COUNT(*) c FROM support_messages WHERE sender_role='ai'")).rows[0].c);
  const escalatedCount = Number((await query("SELECT COUNT(*) c FROM support_tickets WHERE status='escalated'")).rows[0].c);
  return {
    enabled: !aiSetting || aiSetting.value === '1',
    total_ai_messages: totalHandled,
    escalated_tickets: escalatedCount
  };
}));

app.post('/api/admin/ai-settings', auth, need('admin.manage'), wrap(async (req) => {
  const val = req.body.enabled ? '1' : '0';
  if (req.user.role === 'superadmin') await requireRecentPassword(req, req.body.reauth_password);
  return withTx(async (client) => {
    const previous = await client.query("SELECT value FROM system_settings WHERE key='ai_support_enabled' FOR UPDATE");
    const before = previous.rows[0]?.value ?? '1';
    await client.query(
      "INSERT INTO system_settings (key, value, updated_at) VALUES ('ai_support_enabled', $1, NOW()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()",
      [val]
    );
    await auditSensitive(req, client, 'ai_settings.update', 'system_setting', 1, { enabled: before === '1' }, { enabled: val === '1' });
    return { enabled: val === '1' };
  });
}));

// ---------- games (STRICTLY RESTRICTED TO USERS ONLY) ----------
const g = (fn) => [auth, need('customer'), wrap((req) => fn(req))];
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
app.get('/api/agent/performance', auth, need('agent.workspace'), wrap(async (req) => {
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

// ---------- agent referral, activity and compensation ----------
app.get('/api/agent/referrals', auth, need('agent.workspace'), wrap(async (req) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const offset = Math.max(0, Math.min(1000000, Number(req.query.offset) || 0));
  const { start: weekStart } = utcWeekBounds();
  const users = await query(
    `SELECT id, name, phone, status, created_at FROM users WHERE referred_by_agent_id=$1
     ORDER BY id DESC LIMIT $2 OFFSET $3`, [req.user.id, limit, offset]
  );
  const counts = await query(
    `SELECT COUNT(*)::bigint AS total,
      COUNT(*) FILTER (WHERE created_at >= NOW()-INTERVAL '24 hours')::bigint AS new_24h,
      COUNT(*) FILTER (WHERE created_at >= $2)::bigint AS new_week
     FROM users WHERE referred_by_agent_id=$1`, [req.user.id, weekStart]
  );
  const profile = await query('SELECT promo_code, weekly_fee_santim, commission_bps FROM agent_profiles WHERE agent_id=$1', [req.user.id]);
  if (!profile.rows[0]) throw new Error('NOT_FOUND');
  const activity = await query(
    `SELECT COALESCE(SUM(CASE WHEN l.type='bet' AND l.created_at >= NOW()-INTERVAL '24 hours' THEN -l.amount ELSE 0 END),0)::bigint AS stakes_24h,
      COALESCE(SUM(CASE WHEN l.type='win' AND l.created_at >= NOW()-INTERVAL '24 hours' THEN l.amount ELSE 0 END),0)::bigint AS winnings_24h,
      COALESCE(SUM(CASE WHEN l.type='bet' AND l.created_at >= $2 THEN -l.amount ELSE 0 END),0)::bigint AS stakes_week,
      COALESCE(SUM(CASE WHEN l.type='win' AND l.created_at >= $2 THEN l.amount ELSE 0 END),0)::bigint AS winnings_week,
      COUNT(*)::bigint AS tx_count,
      COUNT(*) FILTER (WHERE l.created_at >= NOW()-INTERVAL '24 hours')::bigint AS tx_24h,
      COALESCE(SUM(ABS(l.amount)) FILTER (WHERE l.created_at >= NOW()-INTERVAL '24 hours'),0)::bigint AS volume_24h,
      COUNT(*) FILTER (WHERE l.created_at >= $2)::bigint AS tx_week,
      COALESCE(SUM(ABS(l.amount)) FILTER (WHERE l.created_at >= $2),0)::bigint AS volume_week
     FROM ledger l JOIN users u ON u.id=l.user_id WHERE u.referred_by_agent_id=$1`, [req.user.id, weekStart]
  );
  const tx = await query(
    `WITH referred AS (SELECT id,name FROM users WHERE referred_by_agent_id=$1), activity AS (
       SELECT 'L-'||l.id::text AS id,l.user_id,u.name AS user_name,l.type,l.amount,l.balance_after,l.ref_type,l.ref_id::text AS ref_id,NULL::text AS status,l.created_at
       FROM ledger l JOIN referred u ON u.id=l.user_id WHERE l.type NOT IN ('deposit','withdraw_hold','withdraw_refund')
       UNION ALL
       SELECT 'D-'||d.id::text,d.user_id,u.name,'deposit',d.amount,
         (SELECT l.balance_after FROM ledger l WHERE l.type='deposit' AND l.ref_type='deposit' AND l.ref_id=d.id ORDER BY l.id DESC LIMIT 1),
         'deposit',d.id::text,d.status,d.created_at
       FROM deposits d JOIN referred u ON u.id=d.user_id
       UNION ALL
       SELECT 'W-'||w.id::text,w.user_id,u.name,'withdrawal',-w.amount,
         (SELECT l.balance_after FROM ledger l WHERE l.ref_type='withdraw' AND l.ref_id=w.id AND l.type IN ('withdraw_hold','withdraw_refund') ORDER BY l.id DESC LIMIT 1),
         'withdrawal',w.id::text,w.status,w.created_at
       FROM withdrawals w JOIN referred u ON u.id=w.user_id
     ) SELECT * FROM activity ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3`, [req.user.id, limit, offset]
  );
  const transactionCount = await query(
    `SELECT
      (SELECT COUNT(*) FROM ledger l JOIN users u ON u.id=l.user_id WHERE u.referred_by_agent_id=$1 AND l.type NOT IN ('deposit','withdraw_hold','withdraw_refund'))
      +(SELECT COUNT(*) FROM deposits d JOIN users u ON u.id=d.user_id WHERE u.referred_by_agent_id=$1)
      +(SELECT COUNT(*) FROM withdrawals w JOIN users u ON u.id=w.user_id WHERE u.referred_by_agent_id=$1) AS total`, [req.user.id]
  );
  const settlement = await query(
    `SELECT s.id,s.week_start,s.week_end,s.profit_santim,s.commission_santim,s.weekly_fee_santim,
      COALESCE(SUM(p.amount_santim) FILTER (WHERE p.payment_type='commission'),0)::bigint AS commission_paid,
      COALESCE(SUM(p.amount_santim) FILTER (WHERE p.payment_type='weekly_fee'),0)::bigint AS fee_paid
     FROM agent_weekly_settlements s LEFT JOIN agent_settlement_payments p ON p.settlement_id=s.id
     WHERE s.agent_id=$1 GROUP BY s.id ORDER BY s.week_start DESC LIMIT 1`, [req.user.id]
  );
  const payoutRequests = await query(
    `SELECT id,payout_type,period_start,period_end,amount_santim,status,note,decision_reason,created_at,decided_at,paid_at
     FROM agent_payout_requests WHERE agent_id=$1 ORDER BY id DESC LIMIT 50`, [req.user.id]
  );
  return {
    profile: { ...profile.rows[0], weekly_fee_santim: Number(profile.rows[0].weekly_fee_santim), commission_bps: Number(profile.rows[0].commission_bps) },
    users: users.rows,
    user_counts: Object.fromEntries(Object.entries(counts.rows[0]).map(([key, value]) => [key, Number(value)])),
    activity: { ...activity.rows[0], stakes_24h: Number(activity.rows[0].stakes_24h), winnings_24h: Number(activity.rows[0].winnings_24h), profit_24h: Number(activity.rows[0].stakes_24h)-Number(activity.rows[0].winnings_24h), stakes_week: Number(activity.rows[0].stakes_week), winnings_week: Number(activity.rows[0].winnings_week), profit: Number(activity.rows[0].stakes_week)-Number(activity.rows[0].winnings_week), tx_count: Number(activity.rows[0].tx_count), tx_24h: Number(activity.rows[0].tx_24h), volume_24h: Number(activity.rows[0].volume_24h), tx_week: Number(activity.rows[0].tx_week), volume_week: Number(activity.rows[0].volume_week) },
    transactions: tx.rows.map((row) => ({ ...row, amount: Number(row.amount), balance_after: row.balance_after == null ? null : Number(row.balance_after) })),
    transaction_count: Number(transactionCount.rows[0].total), transaction_offset: offset, transaction_limit: limit,
    latest_settlement: settlement.rows[0] ? Object.fromEntries(Object.entries(settlement.rows[0]).map(([key, value]) => [key, ['id','profit_santim','commission_santim','weekly_fee_santim','commission_paid','fee_paid'].includes(key) ? Number(value) : value])) : null,
    payout_requests: payoutRequests.rows.map((row) => ({ ...row, amount_santim: Number(row.amount_santim) }))
  };
}));

app.post('/api/agent/payout-requests', auth, need('agent.workspace'), wrap(async (req) => {
  const type = req.body.payout_type || 'weekly_fee';
  if (!['weekly_fee', 'commission'].includes(type)) throw new Error('INVALID');
  const current = utcWeekBounds();
  const end = current.start, startDate = new Date(end); startDate.setUTCDate(startDate.getUTCDate()-7);
  const start = startDate.toISOString();
  return withTx(async (client) => {
    const s = await client.query('SELECT weekly_fee_santim,commission_santim FROM agent_weekly_settlements WHERE agent_id=$1 AND week_start=$2 AND week_end=$3 FOR UPDATE', [req.user.id, start, end]);
    if (!s.rows[0]) throw new Error('NOT_FOUND');
    const amount = Number(type === 'weekly_fee' ? s.rows[0].weekly_fee_santim : s.rows[0].commission_santim);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('INVALID');
    const r = await client.query(
      `INSERT INTO agent_payout_requests(agent_id,payout_type,period_start,period_end,amount_santim,note)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id`,
      [req.user.id, type, start, end, amount, String(req.body.note || '').trim().slice(0, 300) || null]
    );
    if (!r.rows[0]) throw new Error('EXISTS');
    const id = Number(r.rows[0].id);
    await auditSensitive(req,client,'agent.payout_request','agent_payout_request',id,null,{type,amount_santim:amount,period_start:start,period_end:end,status:'pending'});
    return { id, status: 'pending', amount_santim: amount };
  });
}));

// ---------- Super Admin agent/referral/settlement operations ----------
function normalizePromoCode(value) {
  return String(value || '').trim().toUpperCase();
}
function validPromoCode(value) { return /^[A-Z0-9][A-Z0-9-]{3,19}$/.test(value); }

app.get('/api/superadmin/agents', auth, need('agents.manage'), wrap(async (req) => {
  const search = String(req.query.search || '').trim().slice(0, 100);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const rows = await query(
    `SELECT u.id,u.name,u.phone,u.status,u.created_at,p.promo_code,p.contact_info,p.weekly_fee_santim,p.commission_bps,
      COUNT(r.id)::bigint AS referred_users,
      COUNT(r.id) FILTER (WHERE r.created_at >= NOW()-INTERVAL '24 hours')::bigint AS new_users_24h,
      COUNT(r.id) FILTER (WHERE r.created_at >= date_trunc('week',NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::bigint AS new_users_week
     FROM users u JOIN agent_profiles p ON p.agent_id=u.id LEFT JOIN users r ON r.referred_by_agent_id=u.id
     WHERE u.role='agent' AND ($1='' OR u.name ILIKE '%'||$1||'%' OR u.phone ILIKE '%'||$1||'%' OR p.promo_code ILIKE '%'||$1||'%')
     GROUP BY u.id,p.agent_id ORDER BY u.id DESC LIMIT $2 OFFSET $3`, [search, limit, offset]
  );
  return { agents: rows.rows.map((r) => Object.fromEntries(Object.entries(r).map(([k,v]) => ['weekly_fee_santim','commission_bps','referred_users','new_users_24h','new_users_week'].includes(k) ? [k,Number(v)] : [k,v]))) };
}));

app.post('/api/superadmin/agents', auth, need('agents.manage'), wrap(async (req) => {
  const name = String(req.body.name || '').trim();
  const phone = normPhone(req.body.phone);
  const password = String(req.body.password || '');
  const code = normalizePromoCode(req.body.promo_code || `FB-${crypto.randomBytes(4).toString('hex').toUpperCase()}`);
  const contact = String(req.body.contact_info || phone).trim().slice(0, 200);
  const fee = Number(req.body.weekly_fee_santim ?? 0);
  const bps = Number(req.body.commission_bps ?? DEFAULT_COMMISSION_BPS);
  if (name.length < 2 || name.length > 60 || !validPhone(phone) || password.length < 12 || !validPromoCode(code) || !Number.isSafeInteger(fee) || fee < 0 || !Number.isInteger(bps) || bps < 0 || bps > 10000) throw new Error('INVALID');
  await requireRecentPassword(req, req.body.reauth_password);
  return withTx(async (client) => {
    const id = await createUser({ name, phone, password, role: 'agent', bonus: false, client });
    await client.query('INSERT INTO agent_profiles(agent_id,promo_code,contact_info,weekly_fee_santim,commission_bps,created_by) VALUES ($1,$2,$3,$4,$5,$6)', [id,code,contact,fee,bps,req.user.id]);
    await auditSensitive(req, client, 'agent.create', 'agent', id, null, { name, phone, promo_code: code, weekly_fee_santim: fee, commission_bps: bps, status: 'active' });
    return { id, promo_code: code, status: 'active' };
  }).catch((error) => { if (error.code === '23505') throw new Error('EXISTS'); throw error; });
}));

app.patch('/api/superadmin/agents/:id', auth, need('agents.manage'), wrap(async (req) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0 || id === req.user.id) throw new Error('INVALID');
  await requireRecentPassword(req, req.body.reauth_password);
  return withTx(async (client) => {
    const oldRes = await client.query(`SELECT u.id,u.name,u.phone,u.status,p.promo_code,p.contact_info,p.weekly_fee_santim,p.commission_bps
      FROM users u JOIN agent_profiles p ON p.agent_id=u.id WHERE u.id=$1 AND u.role='agent' FOR UPDATE OF u,p`, [id]);
    const old = oldRes.rows[0];
    if (!old) throw new Error('NOT_FOUND');
    const name = req.body.name == null ? old.name : String(req.body.name).trim();
    const phone = req.body.phone == null ? old.phone : normPhone(req.body.phone);
    const status = req.body.status == null ? old.status : req.body.status;
    const promo = req.body.promo_code == null ? old.promo_code : normalizePromoCode(req.body.promo_code);
    const contact = req.body.contact_info == null ? old.contact_info : String(req.body.contact_info).trim().slice(0,200);
    const fee = req.body.weekly_fee_santim == null ? Number(old.weekly_fee_santim) : Number(req.body.weekly_fee_santim);
    const bps = req.body.commission_bps == null ? Number(old.commission_bps) : Number(req.body.commission_bps);
    if (name.length < 2 || name.length > 60 || !validPhone(phone) || !['active','suspended'].includes(status) || !validPromoCode(promo) || !Number.isSafeInteger(fee) || fee < 0 || !Number.isInteger(bps) || bps < 0 || bps > 10000) throw new Error('INVALID');
    await client.query('UPDATE users SET name=$1,phone=$2,status=$3 WHERE id=$4', [name,phone,status,id]);
    await client.query('UPDATE agent_profiles SET promo_code=$1,contact_info=$2,weekly_fee_santim=$3,commission_bps=$4,updated_at=NOW(),migration_backfill=FALSE WHERE agent_id=$5', [promo,contact,fee,bps,id]);
    const after = { name,phone,status,promo_code:promo,contact_info:contact,weekly_fee_santim:fee,commission_bps:bps };
    await auditSensitive(req,client,'agent.update','agent',id,old,after);
    return { ok:true, agent:after };
  }).catch((error) => { if (error.code === '23505') throw new Error('EXISTS'); throw error; });
}));

app.post('/api/superadmin/users/:id/reassign-agent', auth, need('referrals.reassign'), wrap(async (req) => {
  const id = Number(req.params.id);
  const agentId = req.body.agent_id == null || req.body.agent_id === '' ? null : Number(req.body.agent_id);
  if (!Number.isSafeInteger(id) || id <= 0 || (agentId != null && (!Number.isSafeInteger(agentId) || agentId <= 0))) throw new Error('INVALID');
  const reason = String(req.body.reason || '').trim().slice(0,300);
  if (!reason) throw new Error('INVALID');
  await requireRecentPassword(req, req.body.reauth_password);
  return withTx(async (client) => {
    if (agentId != null) {
      const a = await client.query("SELECT 1 FROM users WHERE id=$1 AND role='agent' AND status='active'", [agentId]);
      if (!a.rows[0]) throw new Error('INVALID');
    }
    const old = await client.query("SELECT id,referred_by_agent_id FROM users WHERE id=$1 AND role='user' FOR UPDATE", [id]);
    if (!old.rows[0]) throw new Error('NOT_FOUND');
    const openTickets = await client.query("SELECT id,assigned_agent_id FROM support_tickets WHERE user_id=$1 AND status IN ('open','pending','in_progress','escalated') ORDER BY id FOR UPDATE", [id]);
    const before = {
      referred_by_agent_id: old.rows[0].referred_by_agent_id == null ? null : Number(old.rows[0].referred_by_agent_id),
      active_ticket_assignments: openTickets.rows.map((ticket) => ({ id: Number(ticket.id), agent_id: ticket.assigned_agent_id == null ? null : Number(ticket.assigned_agent_id) }))
    };
    await client.query('UPDATE users SET referred_by_agent_id=$1 WHERE id=$2', [agentId,id]);
    await client.query("UPDATE support_tickets SET assigned_agent_id=$1,updated_at=NOW() WHERE user_id=$2 AND status IN ('open','pending','in_progress','escalated')", [agentId,id]);
    await auditSensitive(req,client,'referral.reassign','user',id,before,{
      referred_by_agent_id:agentId,
      active_ticket_assignments:openTickets.rows.map((ticket) => ({ id: Number(ticket.id), agent_id: agentId }))
    },reason);
    return {ok:true};
  });
}));

app.get('/api/superadmin/agent-report', auth, need('settlements.manage'), wrap(async (req) => {
  const { start: weekStart, end: weekEnd } = utcWeekBounds();
  const validDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value;
  const rangeStart = validDate(req.query.start) ? `${req.query.start}T00:00:00.000Z` : weekStart;
  const rangeEnd = validDate(req.query.end) ? new Date(Date.parse(`${req.query.end}T00:00:00.000Z`)+86400000).toISOString() : weekEnd;
  if (Date.parse(rangeEnd) <= Date.parse(rangeStart) || Date.parse(rangeEnd)-Date.parse(rangeStart) > 366*86400000) throw new Error('INVALID');
  const rows = await query(
    `SELECT u.id,u.name,u.phone,u.status,p.promo_code,p.weekly_fee_santim,p.commission_bps,
      COUNT(DISTINCT r.id)::bigint AS users_total,
      COUNT(DISTINCT r.id) FILTER (WHERE r.created_at >= NOW()-INTERVAL '24 hours')::bigint AS users_24h,
      COUNT(DISTINCT r.id) FILTER (WHERE r.created_at >= $1)::bigint AS users_week,
      COUNT(DISTINCT r.id) FILTER (WHERE r.created_at >= $3 AND r.created_at < $4)::bigint AS users_range,
      COALESCE(SUM(CASE WHEN l.created_at >= NOW()-INTERVAL '24 hours' THEN ABS(l.amount) ELSE 0 END),0)::bigint AS tx_volume_24h,
      COUNT(l.id) FILTER (WHERE l.created_at >= NOW()-INTERVAL '24 hours')::bigint AS tx_count_24h,
      COALESCE(SUM(ABS(l.amount)) FILTER (WHERE l.created_at >= $1),0)::bigint AS tx_volume_week,
      COUNT(l.id) FILTER (WHERE l.created_at >= $1)::bigint AS tx_count_week,
      COALESCE(SUM(ABS(l.amount)) FILTER (WHERE l.created_at >= NOW()-INTERVAL '14 days' AND l.created_at < NOW()-INTERVAL '7 days'),0)::bigint AS tx_volume_prev_week,
      COUNT(l.id) FILTER (WHERE l.type='withdraw_hold' AND l.created_at >= NOW()-INTERVAL '24 hours')::bigint AS withdrawals_24h,
      COALESCE(SUM(-l.amount) FILTER (WHERE l.type='withdraw_hold' AND l.created_at >= $1),0)::bigint AS withdrawal_volume_week,
      COALESCE(SUM(l.amount) FILTER (WHERE l.type='deposit' AND l.created_at >= $1),0)::bigint AS deposit_volume_week,
      COALESCE(SUM(ABS(l.amount)) FILTER (WHERE l.created_at >= $3 AND l.created_at < $4),0)::bigint AS tx_volume_range,
      COUNT(l.id) FILTER (WHERE l.created_at >= $3 AND l.created_at < $4)::bigint AS tx_count_range,
      COALESCE(SUM(CASE WHEN l.type='bet' AND l.created_at >= $1 THEN -l.amount WHEN l.type='win' AND l.created_at >= $1 THEN -l.amount ELSE 0 END),0)::bigint AS profit_week,
      COALESCE(SUM(CASE WHEN l.type='bet' AND l.created_at >= $3 AND l.created_at < $4 THEN -l.amount WHEN l.type='win' AND l.created_at >= $3 AND l.created_at < $4 THEN -l.amount ELSE 0 END),0)::bigint AS profit_range,
      COALESCE((SELECT SUM(s.commission_santim) FROM agent_weekly_settlements s WHERE s.agent_id=u.id AND s.week_start=$1 AND s.week_end=$2),0)::bigint AS commission_owed,
      COALESCE((SELECT SUM(pmt.amount_santim) FROM agent_settlement_payments pmt JOIN agent_weekly_settlements s ON s.id=pmt.settlement_id WHERE s.agent_id=u.id AND s.week_start=$1 AND s.week_end=$2 AND pmt.payment_type='commission'),0)::bigint AS commission_paid,
      COALESCE((SELECT SUM(s.weekly_fee_santim) FROM agent_weekly_settlements s WHERE s.agent_id=u.id AND s.week_start=$1 AND s.week_end=$2),0)::bigint AS fee_owed,
      COALESCE((SELECT SUM(pmt.amount_santim) FROM agent_settlement_payments pmt JOIN agent_weekly_settlements s ON s.id=pmt.settlement_id WHERE s.agent_id=u.id AND s.week_start=$1 AND s.week_end=$2 AND pmt.payment_type='weekly_fee'),0)::bigint AS fee_paid
     FROM users u JOIN agent_profiles p ON p.agent_id=u.id
     LEFT JOIN users r ON r.referred_by_agent_id=u.id
     LEFT JOIN ledger l ON l.user_id=r.id AND (l.created_at >= NOW()-INTERVAL '7 days' OR (l.created_at >= $3 AND l.created_at < $4))
     WHERE u.role='agent' GROUP BY u.id,p.agent_id ORDER BY profit_week DESC,u.id`, [weekStart,weekEnd,rangeStart,rangeEnd]
  );
  return { week_start:weekStart,week_end:weekEnd,range_start:rangeStart,range_end:rangeEnd,time_zone:'UTC',agents:rows.rows.map((r) => { const row=Object.fromEntries(Object.entries(r).map(([k,v]) => ['id','weekly_fee_santim','commission_bps','users_total','users_24h','users_week','users_range','tx_volume_24h','tx_count_24h','tx_volume_week','tx_count_week','tx_volume_prev_week','withdrawals_24h','withdrawal_volume_week','deposit_volume_week','tx_volume_range','tx_count_range','profit_week','profit_range','commission_owed','commission_paid','fee_owed','fee_paid'].includes(k) ? [k,Number(v)] : [k,v])); row.commission_outstanding=Math.max(0,row.commission_owed-row.commission_paid); row.fee_outstanding=Math.max(0,row.fee_owed-row.fee_paid); row.withdrawal_ratio_week=row.deposit_volume_week>0?row.withdrawal_volume_week/row.deposit_volume_week:0; return row; }) };
}));

app.get('/api/superadmin/agents/:id/transactions', auth, need('settlements.manage'), wrap(async (req) => {
  const id=Number(req.params.id), limit=Math.min(100,Math.max(1,Number(req.query.limit)||50)), offset=Math.max(0,Number(req.query.offset)||0);
  if (!Number.isSafeInteger(id)||id<=0) throw new Error('INVALID');
  const start=String(req.query.start||'').trim(),end=String(req.query.end||'').trim();
  if ((start&&!/^\d{4}-\d{2}-\d{2}$/.test(start))||(end&&!/^\d{4}-\d{2}-\d{2}$/.test(end))) throw new Error('INVALID');
  const rows=await query(`SELECT l.id,l.user_id,u.name AS user_name,l.type,l.amount,l.balance_after,l.ref_type,l.ref_id,l.created_at
    FROM ledger l JOIN users u ON u.id=l.user_id WHERE u.referred_by_agent_id=$1
    AND ($4='' OR l.created_at >= $4::date) AND ($5='' OR l.created_at < ($5::date + INTERVAL '1 day'))
    ORDER BY l.id DESC LIMIT $2 OFFSET $3`,[id,limit,offset,start,end]);
  return {transactions:rows.rows.map((r)=>({...r,amount:Number(r.amount),balance_after:Number(r.balance_after)}))};
}));

app.post('/api/superadmin/settlements/close-previous-week', auth, need('settlements.manage'), wrap(async (req) => {
  await requireRecentPassword(req,req.body.reauth_password);
  let bounds;
  try { bounds = completedWeekBounds(req.body.week_start); } catch { throw new Error('INVALID'); }
  const weekStart=bounds.start, weekEnd=bounds.end;
  return withTx(async (client) => {
    const agents=await client.query("SELECT u.id,p.weekly_fee_santim,p.commission_bps,p.created_at FROM users u JOIN agent_profiles p ON p.agent_id=u.id WHERE u.role='agent' ORDER BY u.id FOR UPDATE OF u,p");
    const eligibleAgents=agents.rows.filter(a=>new Date(a.created_at).getTime()<new Date(weekEnd).getTime());
    const created=[];
    for (const a of eligibleAgents) {
      const prior=await client.query('SELECT carried_loss_out_santim FROM agent_weekly_settlements WHERE agent_id=$1 AND week_end <= $2 ORDER BY week_end DESC LIMIT 1',[a.id,weekStart]);
      const priorWeek=await client.query('SELECT week_end FROM agent_weekly_settlements WHERE agent_id=$1 AND week_end <= $2 ORDER BY week_end DESC LIMIT 1',[a.id,weekStart]);
      if(priorWeek.rows[0]&&new Date(priorWeek.rows[0].week_end).getTime()!==new Date(weekStart).getTime()) throw new Error('SETTLEMENT_GAP');
      const firstWeek=utcWeekBounds(a.created_at).start;
      if(!priorWeek.rows[0]&&new Date(weekStart).getTime()>new Date(firstWeek).getTime()) throw new Error('SETTLEMENT_GAP');
      const carry=Number(prior.rows[0]?.carried_loss_out_santim||0);
      const profitRes=await client.query(`SELECT COALESCE(SUM(CASE WHEN l.type='bet' THEN -l.amount WHEN l.type='win' THEN -l.amount ELSE 0 END),0)::bigint AS profit
        FROM ledger l JOIN users r ON r.id=l.user_id WHERE r.referred_by_agent_id=$1 AND l.created_at >= $2 AND l.created_at < $3`,[a.id,weekStart,weekEnd]);
      const profit=Number(profitRes.rows[0].profit);
      const result=commissionForWeek(profit,carry,Number(a.commission_bps));
      const ins=await client.query(`INSERT INTO agent_weekly_settlements(agent_id,week_start,week_end,profit_santim,carried_loss_in_santim,carried_loss_out_santim,commission_bps,commission_santim,weekly_fee_santim,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(agent_id,week_start,week_end) DO NOTHING RETURNING id`,
        [a.id,weekStart,weekEnd,profit,carry,result.carriedLossSantim,Number(a.commission_bps),result.commissionSantim,Number(a.weekly_fee_santim),req.user.id]);
      if (ins.rows[0]) {
        const id=Number(ins.rows[0].id);
        await auditSensitive(req,client,'settlement.close','agent_weekly_settlement',id,null,{agent_id:Number(a.id),week_start:weekStart,week_end:weekEnd,profit_santim:profit,commission_santim:result.commissionSantim,weekly_fee_santim:Number(a.weekly_fee_santim),carried_loss_out_santim:result.carriedLossSantim});
        created.push(id);
      }
    }
    return {week_start:weekStart,week_end:weekEnd,created:created.length,existing:eligibleAgents.length-created.length};
  });
}));

app.post('/api/superadmin/settlements/:id/pay', auth, need('settlements.manage'), wrap(async (req) => {
  const id=Number(req.params.id), type=req.body.payment_type;
  if (!Number.isSafeInteger(id)||id<=0||!['weekly_fee','commission'].includes(type)) throw new Error('INVALID');
  await requireRecentPassword(req,req.body.reauth_password);
  return withTx(async (client) => {
    const s=await client.query('SELECT * FROM agent_weekly_settlements WHERE id=$1 FOR UPDATE',[id]);
    if (!s.rows[0]) throw new Error('NOT_FOUND');
    const settlement=s.rows[0], amount=Number(type==='weekly_fee'?settlement.weekly_fee_santim:settlement.commission_santim);
    if (!amount) throw new Error('INVALID');
    const exists=await client.query('SELECT id FROM agent_settlement_payments WHERE settlement_id=$1 AND payment_type=$2',[id,type]);
    if (exists.rows[0]) return {ok:true,already_paid:true};
    await postLedger({client,userId:Number(settlement.agent_id),delta:amount,type:type==='weekly_fee'?'agent_fee':'agent_commission',refType:'agent_settlement',refId:id,by:req.user.id});
    const ledger=await client.query('SELECT id FROM ledger WHERE type=$1 AND ref_type=\'agent_settlement\' AND ref_id=$2',[type==='weekly_fee'?'agent_fee':'agent_commission',id]);
    await client.query('INSERT INTO agent_settlement_payments(settlement_id,agent_id,payment_type,amount_santim,paid_by,ledger_id) VALUES($1,$2,$3,$4,$5,$6)',[id,settlement.agent_id,type,amount,req.user.id,ledger.rows[0]?.id||null]);
    await auditSensitive(req,client,'settlement.pay','agent_weekly_settlement',id,null,{payment_type:type,amount_santim:amount,agent_id:Number(settlement.agent_id)});
    return {ok:true,paid_santim:amount};
  });
}));

app.get('/api/superadmin/settlements', auth, need('settlements.manage'), wrap(async () => {
  const r=await query(`SELECT v.*,u.name AS agent_name,u.phone AS agent_phone,payer.name AS paid_by_name FROM agent_weekly_settlement_status v JOIN users u ON u.id=v.agent_id LEFT JOIN users payer ON payer.id=v.paid_by ORDER BY v.week_start DESC,v.agent_id DESC LIMIT 200`);
  return {settlements:r.rows.map((s)=>Object.fromEntries(Object.entries(s).map(([k,v])=>['id','agent_id','profit_santim','carried_loss_in_santim','carried_loss_out_santim','commission_bps','commission_santim','weekly_fee_santim','commission_paid','fee_paid'].includes(k)?[k,Number(v)]:[k,v])))};
}));

app.get('/api/superadmin/payout-requests', auth, need('settlements.manage'), wrap(async () => {
  const r=await query(`SELECT q.*,u.name AS agent_name,u.phone AS agent_phone,d.name AS decided_by_name FROM agent_payout_requests q JOIN users u ON u.id=q.agent_id LEFT JOIN users d ON d.id=q.decided_by ORDER BY q.id DESC LIMIT 100`);
  return {requests:r.rows.map((x)=>({...x,amount_santim:Number(x.amount_santim)}))};
}));

app.post('/api/superadmin/payout-requests/:id/decide', auth, need('settlements.manage'), wrap(async (req) => {
  const id=Number(req.params.id), action=req.body.action, reason=String(req.body.reason||'').trim().slice(0,300);
  if (!Number.isSafeInteger(id)||id<=0||!['approve','reject'].includes(action)||(action==='reject'&&!reason)) throw new Error('INVALID');
  await requireRecentPassword(req,req.body.reauth_password);
  return withTx(async (client)=>{
    const r=await client.query('SELECT * FROM agent_payout_requests WHERE id=$1 FOR UPDATE',[id]), item=r.rows[0];
    if (!item||item.status!=='pending') throw new Error('NOT_FOUND');
    let next='rejected';
    if (action==='approve') {
      const settlementRes=await client.query('SELECT * FROM agent_weekly_settlements WHERE agent_id=$1 AND week_start=$2 AND week_end=$3 FOR UPDATE',[item.agent_id,item.period_start,item.period_end]);
      const settlement=settlementRes.rows[0];
      if(!settlement) throw new Error('NOT_FOUND');
      const expected=Number(item.payout_type==='weekly_fee'?settlement.weekly_fee_santim:settlement.commission_santim);
      if(expected<=0||expected!==Number(item.amount_santim)) throw new Error('INVALID');
      const paymentRes=await client.query('SELECT id FROM agent_settlement_payments WHERE settlement_id=$1 AND payment_type=$2',[settlement.id,item.payout_type]);
      const alreadyPaid=Boolean(paymentRes.rows[0]);
      if(!alreadyPaid) {
        const ledgerType=item.payout_type==='weekly_fee'?'agent_fee':'agent_commission';
        await postLedger({client,userId:Number(item.agent_id),delta:expected,type:ledgerType,refType:'agent_settlement',refId:Number(settlement.id),by:req.user.id});
        const ledger=await client.query('SELECT id FROM ledger WHERE type=$1 AND ref_type=\'agent_settlement\' AND ref_id=$2',[ledgerType,settlement.id]);
        await client.query('INSERT INTO agent_settlement_payments(settlement_id,agent_id,payment_type,amount_santim,paid_by,ledger_id) VALUES($1,$2,$3,$4,$5,$6)',[settlement.id,item.agent_id,item.payout_type,expected,req.user.id,ledger.rows[0].id]);
      }
      next='paid';
      await client.query('UPDATE agent_payout_requests SET status=$1,decided_by=$2,decision_reason=$3,decided_at=NOW(),paid_at=NOW() WHERE id=$4',[next,req.user.id,reason||null,id]);
      await auditSensitive(req,client,'agent.payout.approve','agent_payout_request',id,{status:'pending'},{status:next,amount_santim:Number(item.amount_santim),agent_id:Number(item.agent_id),already_paid:alreadyPaid},reason||null);
      return {ok:true,status:next,already_paid:alreadyPaid};
    }
    await client.query('UPDATE agent_payout_requests SET status=$1,decided_by=$2,decision_reason=$3,decided_at=NOW(),paid_at=CASE WHEN $1=\'paid\' THEN NOW() ELSE NULL END WHERE id=$4',[next,req.user.id,reason||null,id]);
    await auditSensitive(req,client,`agent.payout.${action}`,'agent_payout_request',id,{status:'pending'},{status:next,amount_santim:Number(item.amount_santim),agent_id:Number(item.agent_id)},reason||null);
    return {ok:true,status:next};
  });
}));

// ---------- admin ----------
const admin = [auth, need('admin.workspace')];
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
    `SELECT u.id, u.name, u.phone, u.status, p.promo_code,
     (SELECT COUNT(*) FROM users referred WHERE referred.referred_by_agent_id=u.id) AS referred_users,
     (SELECT COUNT(*) FROM users referred WHERE referred.referred_by_agent_id=u.id AND referred.created_at >= NOW()-INTERVAL '7 days') AS new_users_week,
     (SELECT COUNT(*) FROM support_tickets t WHERE t.assigned_agent_id = u.id AND t.status='resolved') as tickets_resolved
     FROM users u JOIN agent_profiles p ON p.agent_id=u.id WHERE u.role='agent' ORDER BY u.id DESC LIMIT 100`
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
      referred_users: Number(r.referred_users),
      new_users_week: Number(r.new_users_week),
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

app.post('/api/admin/agent-funding/:id/decide', auth, need('admin.workspace'), (req, res) =>
  res.status(410).json({ error: 'LEGACY_DISABLED' })
);

app.get('/api/admin/transactions', ...admin, wrap(async (req) => {
  const type = String(req.query.type || 'all');
  const search = String(req.query.search || '').trim().slice(0, 100);
  const status = String(req.query.status || 'all');
  const paymentMethod = String(req.query.payment_method || '').trim().slice(0, 80);
  const dateValue = (value) => !value || (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value);
  const minAmount = req.query.min_amount === '' || req.query.min_amount == null ? null : Number(req.query.min_amount);
  const maxAmount = req.query.max_amount === '' || req.query.max_amount == null ? null : Number(req.query.max_amount);
  const agentId = req.query.agent_id === '' || req.query.agent_id == null ? null : Number(req.query.agent_id);
  if ((type !== 'all' && !/^[a-z_]{1,32}$/.test(type)) || !['all','pending','approved','rejected','paid'].includes(status) ||
      (paymentMethod && paymentMethod.length > 80) || !dateValue(String(req.query.start || '')) || !dateValue(String(req.query.end || '')) ||
      (minAmount != null && (!Number.isFinite(minAmount) || minAmount < 0 || minAmount > 1000000)) ||
      (maxAmount != null && (!Number.isFinite(maxAmount) || maxAmount < 0 || maxAmount > 1000000)) ||
      (minAmount != null && maxAmount != null && maxAmount < minAmount) ||
      (agentId != null && (!Number.isSafeInteger(agentId) || agentId <= 0))) throw new Error('INVALID');
  const limit = Math.min(200, Math.max(1, Math.floor(Number(req.query.limit) || 100)));
  const offset = Math.max(0, Math.min(1000000, Math.floor(Number(req.query.offset) || 0)));
  if (req.query.start && req.query.end && Date.parse(`${req.query.end}T00:00:00Z`) < Date.parse(`${req.query.start}T00:00:00Z`)) throw new Error('INVALID');
  let sql = `SELECT l.id,l.type,l.amount,l.balance_after,l.created_at,l.ref_type,l.ref_id,
             u.name AS user_name,u.phone,u.referred_by_agent_id,d.status AS deposit_status,w.status AS withdrawal_status,
             COALESCE(p.name,'') AS payment_method,COALESCE(d.tx_ref,w.account_number,l.ref_id::text,'') AS transaction_reference,
             COALESCE(d.status,w.status) AS request_status
             FROM ledger l JOIN users u ON u.id=l.user_id
             LEFT JOIN deposits d ON l.ref_type='deposit' AND l.ref_id=d.id
             LEFT JOIN withdrawals w ON l.ref_type='withdraw' AND l.ref_id=w.id
             LEFT JOIN providers p ON p.id=COALESCE(d.provider_id,w.provider_id) WHERE 1=1`;
  const params = [];
  if (type !== 'all') {
    params.push(type);
    sql += ` AND l.type = $${params.length}`;
  }
  if (search) {
    params.push(`%${search}%`);
    sql += ` AND (l.id::text ILIKE $${params.length} OR u.phone ILIKE $${params.length} OR u.name ILIKE $${params.length} OR COALESCE(d.tx_ref,w.account_number,l.ref_id::text,'') ILIKE $${params.length})`;
  }
  if (status !== 'all') { params.push(status); sql += ` AND COALESCE(d.status,w.status)=$${params.length}`; }
  if (paymentMethod) { params.push(`%${paymentMethod}%`); sql += ` AND p.name ILIKE $${params.length}`; }
  if (agentId != null) { params.push(agentId); sql += ` AND u.referred_by_agent_id=$${params.length}`; }
  if (req.query.start) { params.push(req.query.start); sql += ` AND l.created_at >= $${params.length}::date`; }
  if (req.query.end) { params.push(req.query.end); sql += ` AND l.created_at < ($${params.length}::date + INTERVAL '1 day')`; }
  if (minAmount != null) { params.push(Math.round(minAmount * 100)); sql += ` AND ABS(l.amount) >= $${params.length}`; }
  if (maxAmount != null) { params.push(Math.round(maxAmount * 100)); sql += ` AND ABS(l.amount) <= $${params.length}`; }
  params.push(limit, offset);
  sql += ` ORDER BY l.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;
  const res = await query(sql, params);
  return {
    transactions: res.rows.map((r) => ({
      ...r,
      amount: Number(r.amount),
      balance_after: Number(r.balance_after),
      referred_by_agent_id: r.referred_by_agent_id == null ? null : Number(r.referred_by_agent_id)
    })),
    limit,offset
  };
}));

app.get('/api/admin/users', ...admin, wrap(async () => {
  const res = await query(
    `SELECT u.id, u.name, u.phone, u.role, u.status, u.created_at, u.referred_by_agent_id, w.balance
     FROM users u JOIN wallets w ON w.user_id=u.id ORDER BY u.id DESC LIMIT 200`
  );
  return {
    users: res.rows.map((r) => ({
      ...r,
      balance: Number(r.balance)
    }))
  };
}));

app.post('/api/admin/users/:id', auth, need('admin.manage'), wrap(async (req) => {
  const id = Number(req.params.id);
  if (id === req.user.id) throw new Error('SELF');
  const { role, status } = req.body;
  // Agent accounts are created and managed only through Super Admin controls.
  if (role) throw new Error('FORBIDDEN');
  if (status && !['active', 'suspended'].includes(status)) throw new Error('INVALID');

  return withTx(async(client)=>{
    const uRes = await client.query('SELECT id,role,status FROM users WHERE id=$1 FOR UPDATE', [id]);
    if (uRes.rows.length === 0) throw new Error('NOT_FOUND');
    if (['agent','superadmin'].includes(uRes.rows[0].role)) throw new Error('FORBIDDEN');
    const before={role:uRes.rows[0].role,status:uRes.rows[0].status};
    if (status) await client.query('UPDATE users SET status=$1 WHERE id=$2', [status, id]);
    await auditSensitive(req,client,'user.status','user',id,before,{role:before.role,status:status||before.status});
    return {ok:true};
  });
}));

app.get('/api/admin/audit', auth, need('audit.read'), wrap(async (req) => {
  const search = req.query.search ? String(req.query.search).trim() : null;
  let sql = `SELECT a.id, a.action, a.detail, a.actor_ip, a.before_value, a.after_value, a.created_at, u.name as actor
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
