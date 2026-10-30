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
const { commissionForWeek, utcWeekBounds, completedWeekBounds, addDays, DEFAULT_COMMISSION_BPS, WEEK_TIME_ZONE } = require('./agent-finance');

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
    touchLastSeen(req.user.id);
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

function setToken(res, uid, remember = true) {
  const options = {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  };
  if (remember) {
    options.maxAge = 7 * 864e5;
    options.expires = new Date(Date.now() + 7 * 864e5);
  }
  res.cookie('token', jwt.sign({ uid }, SECRET, { expiresIn: remember ? '7d' : '12h' }), options);
}

async function balanceOf(id) {
  const res = await query('SELECT balance FROM wallets WHERE user_id=$1', [id]);
  return Number(res.rows[0]?.balance || 0);
}

// ---------- workspace helpers ----------
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function eatDayBounds(date = new Date()) {
  const d = new Date(date);
  const eat = new Date(d.getTime() + EAT_OFFSET_MS);
  const midnightUtc = Date.UTC(eat.getUTCFullYear(), eat.getUTCMonth(), eat.getUTCDate());
  return {
    start: new Date(midnightUtc - EAT_OFFSET_MS),
    end: new Date(midnightUtc - EAT_OFFSET_MS + DAY_MS),
  };
}

function eatMonthBounds(date = new Date()) {
  const d = new Date(date);
  const eat = new Date(d.getTime() + EAT_OFFSET_MS);
  const firstUtc = Date.UTC(eat.getUTCFullYear(), eat.getUTCMonth(), 1);
  const nextUtc = Date.UTC(eat.getUTCFullYear(), eat.getUTCMonth() + 1, 1);
  return {
    start: new Date(firstUtc - EAT_OFFSET_MS),
    end: new Date(nextUtc - EAT_OFFSET_MS),
  };
}

function percentChange(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return Number((((current - previous) / Math.abs(previous)) * 100).toFixed(1));
}

function validEmail(value) {
  return !value || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!email) return null;
  if (email.length > 160 || !validEmail(email)) throw new Error('INVALID');
  return email;
}

function normalizeUsername(value) {
  const username = String(value || '').trim().toLowerCase();
  if (!username) return null;
  if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(username)) throw new Error('INVALID');
  return username;
}

async function insertNotifications(client, userIds, payload) {
  const ids = [...new Set((userIds || []).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (!ids.length) return;
  const runner = client ? (sql, params) => client.query(sql, params) : (sql, params) => query(sql, params);
  for (const userId of ids) {
    await runner(
      `INSERT INTO notifications(user_id,type,title,message,link,related_user_id)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [userId, payload.type, payload.title, payload.message, payload.link || null, payload.relatedUserId || null]
    );
  }
}

async function notifySuperadmins(payload, client = null) {
  const runner = client ? (sql, params) => client.query(sql, params) : (sql, params) => query(sql, params);
  const rows = await runner("SELECT id FROM users WHERE role='superadmin' AND status='active'");
  await insertNotifications(client, rows.rows.map((row) => row.id), payload);
}

async function notifyAgents(payload, client = null) {
  const runner = client ? (sql, params) => client.query(sql, params) : (sql, params) => query(sql, params);
  const rows = await runner("SELECT id FROM users WHERE role='agent' AND status='active'");
  await insertNotifications(client, rows.rows.map((row) => row.id), payload);
}

function referralUrl(req, promoCode) {
  const configured = String(process.env.PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
  const host = String(req.get('host') || '').replace(/[^a-z0-9.:-]/gi, '');
  const base = configured || `${req.protocol}://${host}`;
  return `${base}/?promo=${encodeURIComponent(promoCode)}`;
}

async function unreadNotificationCount(userId) {
  const result = await query('SELECT COUNT(*)::bigint AS c FROM notifications WHERE user_id=$1 AND is_read=FALSE', [userId]);
  return Number(result.rows[0]?.c || 0);
}

async function markSupportRead(ticketId, userId, client = null) {
  const runner = client ? (sql, params) => client.query(sql, params) : (sql, params) => query(sql, params);
  await runner(
    `INSERT INTO support_ticket_reads(ticket_id,user_id,last_read_at)
     VALUES($1,$2,NOW())
     ON CONFLICT(ticket_id,user_id) DO UPDATE SET last_read_at=NOW()`,
    [ticketId, userId]
  );
}

async function supportUnreadCount(ticketId, userId, client = null) {
  const runner = client ? (sql, params) => client.query(sql, params) : (sql, params) => query(sql, params);
  const result = await runner(
    `SELECT COUNT(*)::bigint AS c FROM support_messages m
     WHERE m.ticket_id=$1 AND m.is_internal=0 AND m.sender_id IS DISTINCT FROM $2
       AND m.created_at > COALESCE((SELECT last_read_at FROM support_ticket_reads
                                    WHERE ticket_id=$1 AND user_id=$2), 'epoch'::timestamptz)`,
    [ticketId, userId]
  );
  return Number(result.rows[0]?.c || 0);
}

function isOnline(lastSeenAt) {
  if (!lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt).getTime() < 5 * 60 * 1000;
}

// Settlement time is the latest bet/win ledger entry for a completed round.
// Refunded rounds are excluded, as are active (unsettled) rounds.
const SETTLED_ROUND_SOURCE = `
  SELECT r.id, r.user_id, r.bet, r.payout,
         COALESCE((SELECT MAX(l.created_at) FROM ledger l
                   WHERE l.ref_type='round' AND l.ref_id=r.id AND l.type IN ('bet','win')), r.created_at) AS settled_at
  FROM game_rounds r
  WHERE r.status='done'
    AND NOT EXISTS (SELECT 1 FROM ledger rf
                    WHERE rf.type='refund' AND rf.ref_type='round' AND rf.ref_id=r.id)
`;

async function settledNgrForAgent(agentId, start, end, client = null) {
  const runner = client ? (sql, params) => client.query(sql, params) : (sql, params) => query(sql, params);
  const result = await runner(
    `WITH settled AS (${SETTLED_ROUND_SOURCE})
     SELECT COALESCE(SUM(r.bet - r.payout),0)::bigint AS ngr
     FROM settled r JOIN users u ON u.id=r.user_id
     WHERE u.referred_by_agent_id=$1 AND r.settled_at >= $2 AND r.settled_at < $3`,
    [agentId, start, end]
  );
  return Number(result.rows[0]?.ngr || 0);
}

async function settledNgrForAll(start, end, client = null, referredOnly = false) {
  const runner = client ? (sql, params) => client.query(sql, params) : (sql, params) => query(sql, params);
  const result = await runner(
    `WITH settled AS (${SETTLED_ROUND_SOURCE})
     SELECT COALESCE(SUM(r.bet - r.payout),0)::bigint AS ngr
     FROM settled r ${referredOnly ? 'JOIN users u ON u.id=r.user_id AND u.referred_by_agent_id IS NOT NULL' : ''}
     WHERE r.settled_at >= $1 AND r.settled_at < $2`,
    [start, end]
  );
  return Number(result.rows[0]?.ngr || 0);
}

async function agentPeriodMetrics(agentId, start, end) {
  const deposit = await query(
    `SELECT COALESCE(SUM(d.amount),0)::bigint AS total
     FROM deposits d JOIN users u ON u.id=d.user_id
     WHERE u.referred_by_agent_id=$1 AND d.status='approved'
       AND COALESCE(d.reviewed_at,d.created_at) >= $2 AND COALESCE(d.reviewed_at,d.created_at) < $3`,
    [agentId, start, end]
  );
  const withdrawal = await query(
    `SELECT COALESCE(SUM(w.amount),0)::bigint AS total
     FROM withdrawals w JOIN users u ON u.id=w.user_id
     WHERE u.referred_by_agent_id=$1 AND w.status IN ('approved','paid')
       AND COALESCE(w.reviewed_at,w.created_at) >= $2 AND COALESCE(w.reviewed_at,w.created_at) < $3`,
    [agentId, start, end]
  );
  const users = await query(
    `SELECT COUNT(DISTINCT l.user_id)::bigint AS total
     FROM ledger l JOIN users u ON u.id=l.user_id
     WHERE u.referred_by_agent_id=$1 AND l.created_at >= $2 AND l.created_at < $3`,
    [agentId, start, end]
  );
  return {
    deposits: Number(deposit.rows[0]?.total || 0),
    withdrawals: Number(withdrawal.rows[0]?.total || 0),
    users: Number(users.rows[0]?.total || 0),
    ngr: await settledNgrForAgent(agentId, start, end),
  };
}

const lastSeenCache = new Map();
function touchLastSeen(userId) {
  const now = Date.now();
  const previous = lastSeenCache.get(userId) || 0;
  if (now - previous < 120000) return;
  lastSeenCache.set(userId, now);
  query('UPDATE users SET last_seen_at=NOW() WHERE id=$1', [userId]).catch(() => {});
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
  const email = normalizeEmail(req.body.email);
  const username = normalizeUsername(req.body.username);
  if (name.length < 2 || name.length > 60 || !validPhone(phone) || password.length < 6) throw new Error('INVALID');

  const promoCode = String(req.body.promo_code || '').trim();
  const registration = await withTx(async(client)=>{
    let referredByAgentId = null;
    if (promoCode) {
      const referral = await client.query(
        `SELECT p.agent_id, u.status, u.name FROM agent_profiles p JOIN users u ON u.id=p.agent_id
         WHERE LOWER(p.promo_code)=LOWER($1) FOR SHARE OF u`, [promoCode]
      );
      if (!referral.rows[0]) throw new Error('PROMO_INVALID');
      if (referral.rows[0].status !== 'active') throw new Error('PROMO_SUSPENDED');
      referredByAgentId = Number(referral.rows[0].agent_id);
    }
    const createdId = await createUser({ name, phone, password, lang, referredByAgentId, email, username, client });
    if (referredByAgentId) {
      // Promotional credits are recorded separately from the withdrawable
      // wallet. The unique referred_user_id makes this award exactly-once.
      await client.query(
        `INSERT INTO referral_bonuses(agent_id,referred_user_id,amount_santim)
         VALUES($1,$2,200000)`,
        [referredByAgentId, createdId]
      );
      await client.query('UPDATE wallets SET promo_balance=promo_balance+200000 WHERE user_id=$1', [createdId]);
      await insertNotifications(client, [referredByAgentId], {
        type: 'referral_signup',
        title: 'New referred customer',
        message: `${name} registered with your promo code.`,
        link: 'users',
        relatedUserId: createdId
      });
    }
    await audit(createdId, 'register', { referred_by_agent_id: referredByAgentId, promo_bonus: Boolean(referredByAgentId), actor_ip: req.ip }, client);
    return { id: createdId, referredByAgentId };
  }).catch((error)=>{if(error.code==='23505')throw new Error('EXISTS');throw error;});
  setToken(res, registration.id);
  return { ok: true, referred: Boolean(registration.referredByAgentId), promo_credits: registration.referredByAgentId ? 200000 : 0 };
}));

app.post('/api/login', authLimiter, wrap(async (req, res) => {
  const rawInput = String(req.body.phone || req.body.username || '').trim();
  const phone = normPhone(rawInput);
  const pass = String(req.body.password || '');
  if (!rawInput || !pass) throw new Error('LOGIN');

  const lower = rawInput.toLowerCase();
  const stripped = lower.replace(/\s+/g, '');
  let uRes = await query(
    `SELECT * FROM users
     WHERE phone=$1 OR LOWER(name)=$2 OR LOWER(REPLACE(name, ' ', ''))=$3
        OR LOWER(COALESCE(username,''))=$2 OR LOWER(COALESCE(email,''))=$2
     LIMIT 1`,
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
  setToken(res, uid, req.body.remember !== false);
  await query('UPDATE users SET last_seen_at=NOW() WHERE id=$1', [uid]).catch(() => {});
  await audit(uid, 'login');
  return { ok: true, role: u.role };
}));

app.post('/api/password-reset-request', authLimiter, wrap(async (req) => {
  const raw = String(req.body.identifier || req.body.phone || req.body.username || '').trim();
  if (!raw) throw new Error('INVALID');
  const lower = raw.toLowerCase();
  const phone = normPhone(raw);
  const found = (await query(
    `SELECT id,name,phone,referred_by_agent_id FROM users
     WHERE phone=$1 OR LOWER(name)=$2 OR LOWER(COALESCE(username,''))=$2 OR LOWER(COALESCE(email,''))=$2
     LIMIT 1`,
    [phone, lower]
  )).rows[0];
  if (found) {
    await withTx(async (client) => {
      const ticket = await client.query(
        `INSERT INTO support_tickets(user_id,subject,message,status,assigned_agent_id)
         VALUES($1,'Password reset request','A password reset was requested from the login screen. Verify the customer identity before resetting credentials.','open',$2)
         RETURNING id`,
        [found.id, found.referred_by_agent_id || null]
      );
      const ticketId = Number(ticket.rows[0].id);
      await client.query(
        `INSERT INTO support_messages(ticket_id,sender_id,sender_role,sender_name,message,is_internal)
         VALUES($1,$2,'user',$3,$4,0)`,
        [ticketId, found.id, found.name, 'Password reset requested from the login screen.']
      );
      const payload = {
        type: 'password_reset',
        title: 'Password reset request',
        message: `${found.name} requested a password reset.`,
        link: 'support',
        relatedUserId: found.id
      };
      if (found.referred_by_agent_id) await insertNotifications(client, [found.referred_by_agent_id], payload);
      else await notifySuperadmins(payload, client);
      await audit(found.id, 'password_reset.request', { ticket_id: ticketId }, client);
    });
  }
  // Always return the same response so account existence is not disclosed.
  return { ok: true };
}));

app.post('/api/logout', wrap((req, res) => {
  res.clearCookie('token');
  return { ok: true };
}));

app.get('/api/me', auth, wrap(async (req) => {
  const wallet = (await query('SELECT balance,promo_balance FROM wallets WHERE user_id=$1', [req.user.id])).rows[0] || {};
  let agentProfile = null;
  if (req.user.role === 'agent') {
    const profile = (await query('SELECT promo_code,commission_bps,weekly_fee_santim FROM agent_profiles WHERE agent_id=$1', [req.user.id])).rows[0];
    if (profile) agentProfile = {
      promo_code: profile.promo_code,
      commission_bps: Number(profile.commission_bps),
      weekly_fee_santim: Number(profile.weekly_fee_santim),
    };
  }
  return {
    user: req.user,
    balance: Number(wallet.balance || 0),
    promo_credits: Number(wallet.promo_balance || 0),
    agent_profile: agentProfile,
    limits: { min: games.MIN_BET, max: games.MAX_BET }
  };
}));

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
      await notifySuperadmins({
        type: 'deposit_request',
        title: 'New deposit request',
        message: `${req.user.name} submitted a deposit of ${(amount / 100).toFixed(2)} ETB.`,
        link: 'deposits',
        relatedUserId: req.user.id
      }, client);
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
    await notifySuperadmins({
      type: 'withdrawal_request',
      title: 'New withdrawal request',
      message: `${req.user.name} requested a withdrawal of ${(amount / 100).toFixed(2)} ETB.`,
      link: 'withdrawals',
      relatedUserId: req.user.id
    }, client);
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

app.post(['/api/agent/deposits/:id/decide', '/api/superadmin/deposits/:id/decide'], auth, need('money.decide'), wrap(async (req) => {
  const depositId = Number(req.params.id);
  if (!Number.isSafeInteger(depositId) || depositId <= 0) throw new Error('NOT_FOUND');
  const action = req.body.action;
  const approve = action === 'approve';
  await requireRecentPassword(req, req.body.reauth_password);
  if (!['approve', 'reject', 'escalate'].includes(action)) throw new Error('INVALID');
  const reason = String(req.body.reason || '').trim().slice(0, 200);
  const internalNote = String(req.body.internal_note || '').trim().slice(0, 500);
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
        `UPDATE deposits SET status=$1, reviewed_by=$2, reason=$3, reviewed_at=NOW(),
         internal_note=COALESCE(NULLIF($4,''),internal_note) WHERE id=$5`,
        [nextStatus, req.user.id, reason || null, internalNote, d.id]
      );
    } else if (internalNote) {
      await client.query('UPDATE deposits SET internal_note=COALESCE(NULLIF($1,\'\'),internal_note) WHERE id=$2', [internalNote, d.id]);
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
      [Number(d.id), req.user.id, action, reason || internalNote || null, approve ? JSON.stringify(checks) : null, d.status, nextStatus, String(req.ip || '').slice(0, 100)]
    );
    if (action !== 'escalate') {
      await insertNotifications(client, [Number(d.user_id)], {
        type: `deposit_${nextStatus}`,
        title: `Deposit ${nextStatus}`,
        message: action === 'approve'
          ? `Your deposit of ${(Number(d.amount) / 100).toFixed(2)} ETB was approved and credited.`
          : `Your deposit of ${(Number(d.amount) / 100).toFixed(2)} ETB was rejected.${reason ? ` Reason: ${reason}` : ''}`,
        link: 'wallet',
        relatedUserId: req.user.id
      });
    }
    await auditSensitive(req, client, `deposit.${action}`, 'deposit', Number(d.id), { status: d.status }, { status: nextStatus, amount_santim: Number(d.amount), internal_note: internalNote || null }, reason || null);
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

// ---------- Super Admin approval center ----------
app.get('/api/superadmin/deposits', auth, need('money.decide'), wrap(async (req) => {
  const status = ['pending','approved','rejected','all'].includes(req.query.status) ? req.query.status : 'pending';
  const search = String(req.query.search || '').trim().slice(0, 100);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const params = [status, `%${search}%`];
  const where = `($1='all' OR d.status=$1) AND ($2='%%' OR u.name ILIKE $2 OR u.phone ILIKE $2 OR d.tx_ref ILIKE $2)`;
  const rows = await query(
    `SELECT d.id,d.amount,d.tx_ref,d.status,d.reason,d.internal_note,d.created_at,d.reviewed_at,
            (d.receipt_key IS NOT NULL) AS has_receipt,u.id AS user_id,u.name AS user_name,u.phone,
            u.referred_by_agent_id,a.name AS agent_name,p.name AS provider,rev.name AS reviewer_name
     FROM deposits d
     JOIN users u ON u.id=d.user_id
     JOIN providers p ON p.id=d.provider_id
     LEFT JOIN users a ON a.id=u.referred_by_agent_id
     LEFT JOIN users rev ON rev.id=d.reviewed_by
     WHERE ${where}
     ORDER BY CASE WHEN d.status='pending' THEN 0 ELSE 1 END, d.id DESC
     LIMIT $3 OFFSET $4`,
    [...params, limit, offset]
  );
  const count = await query(
    `SELECT COUNT(*)::bigint AS c FROM deposits d JOIN users u ON u.id=d.user_id WHERE ${where}`,
    params
  );
  return {
    deposits: rows.rows.map((r) => ({
      ...r,
      amount: Number(r.amount),
      user_id: Number(r.user_id),
      referred_by_agent_id: r.referred_by_agent_id == null ? null : Number(r.referred_by_agent_id)
    })),
    total: Number(count.rows[0]?.c || 0), limit, offset
  };
}));

app.get('/api/superadmin/withdrawals', auth, need('money.decide'), wrap(async (req) => {
  const status = ['pending','approved','rejected','paid','all'].includes(req.query.status) ? req.query.status : 'pending';
  const search = String(req.query.search || '').trim().slice(0, 100);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const params = [status, `%${search}%`];
  const where = `($1='all' OR w.status=$1) AND ($2='%%' OR u.name ILIKE $2 OR u.phone ILIKE $2 OR w.account_number ILIKE $2)`;
  const rows = await query(
    `SELECT w.id,w.amount,w.account_number,w.status,w.reason,w.internal_note,w.created_at,w.reviewed_at,
            u.id AS user_id,u.name AS user_name,u.phone,u.referred_by_agent_id,a.name AS agent_name,
            p.name AS provider,rev.name AS reviewer_name
     FROM withdrawals w
     JOIN users u ON u.id=w.user_id
     JOIN providers p ON p.id=w.provider_id
     LEFT JOIN users a ON a.id=u.referred_by_agent_id
     LEFT JOIN users rev ON rev.id=w.reviewed_by
     WHERE ${where}
     ORDER BY CASE WHEN w.status='pending' THEN 0 ELSE 1 END, w.id DESC
     LIMIT $3 OFFSET $4`,
    [...params, limit, offset]
  );
  const count = await query(
    `SELECT COUNT(*)::bigint AS c FROM withdrawals w JOIN users u ON u.id=w.user_id WHERE ${where}`,
    params
  );
  return {
    withdrawals: rows.rows.map((r) => ({
      ...r,
      amount: Number(r.amount),
      user_id: Number(r.user_id),
      referred_by_agent_id: r.referred_by_agent_id == null ? null : Number(r.referred_by_agent_id)
    })),
    total: Number(count.rows[0]?.c || 0), limit, offset
  };
}));

app.get('/api/superadmin/deposits/:id', auth, need('money.decide'), wrap(async (req) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('NOT_FOUND');
  const row = await query(
    `SELECT d.id,d.amount,d.tx_ref,d.status,d.reason,d.internal_note,d.created_at,d.reviewed_at,
            (d.receipt_key IS NOT NULL) AS has_receipt,u.id AS user_id,u.name AS user_name,u.phone,
            u.referred_by_agent_id,a.name AS agent_name,p.name AS provider,rev.name AS reviewer_name
     FROM deposits d JOIN users u ON u.id=d.user_id JOIN providers p ON p.id=d.provider_id
     LEFT JOIN users a ON a.id=u.referred_by_agent_id LEFT JOIN users rev ON rev.id=d.reviewed_by
     WHERE d.id=$1`, [id]
  );
  const deposit = row.rows[0];
  if (!deposit) throw new Error('NOT_FOUND');
  return {
    deposits: [{
      ...deposit,
      amount: Number(deposit.amount),
      user_id: Number(deposit.user_id),
      referred_by_agent_id: deposit.referred_by_agent_id == null ? null : Number(deposit.referred_by_agent_id)
    }]
  };
}));

app.get('/api/superadmin/withdrawals/:id', auth, need('money.decide'), wrap(async (req) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('NOT_FOUND');
  const row = await query(
    `SELECT w.id,w.amount,w.account_number,w.status,w.reason,w.internal_note,w.created_at,w.reviewed_at,
            u.id AS user_id,u.name AS user_name,u.phone,u.referred_by_agent_id,a.name AS agent_name,
            p.name AS provider,rev.name AS reviewer_name
     FROM withdrawals w JOIN users u ON u.id=w.user_id JOIN providers p ON p.id=w.provider_id
     LEFT JOIN users a ON a.id=u.referred_by_agent_id LEFT JOIN users rev ON rev.id=w.reviewed_by
     WHERE w.id=$1`, [id]
  );
  const withdrawal = row.rows[0];
  if (!withdrawal) throw new Error('NOT_FOUND');
  return {
    withdrawals: [{
      ...withdrawal,
      amount: Number(withdrawal.amount),
      user_id: Number(withdrawal.user_id),
      referred_by_agent_id: withdrawal.referred_by_agent_id == null ? null : Number(withdrawal.referred_by_agent_id)
    }]
  };
}));

app.post(['/api/agent/withdrawals/:id/decide', '/api/superadmin/withdrawals/:id/decide'], auth, need('money.decide'), wrap(async (req) => {
  const id = Number(req.params.id);
  const action = req.body.action;
  const reason = String(req.body.reason || '').trim().slice(0, 200);
  const internalNote = String(req.body.internal_note || '').trim().slice(0, 500);
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
      `UPDATE withdrawals SET status=$1, reviewed_by=$2, reviewed_at=NOW(), reason=$3,
       internal_note=COALESCE(NULLIF($5,''),internal_note) WHERE id=$4`,
      [next, req.user.id, reason || null, id, internalNote]
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
      [id, req.user.id, action, w.status, next, reason || internalNote || null, String(req.ip || '').slice(0, 100)]
    );
    await insertNotifications(client, [Number(w.user_id)], {
      type: `withdrawal_${next}`,
      title: `Withdrawal ${next}`,
      message: action === 'approve'
        ? `Your withdrawal of ${(Number(w.amount) / 100).toFixed(2)} ETB was approved for manual payout.`
        : `Your withdrawal of ${(Number(w.amount) / 100).toFixed(2)} ETB was rejected and the hold was released.${reason ? ` Reason: ${reason}` : ''}`,
      link: 'wallet',
      relatedUserId: req.user.id
    });
    await auditSensitive(req, client, 'withdraw.' + action, 'withdrawal', id, { status: w.status }, { status: next, amount_santim: Number(w.amount), internal_note: internalNote || null }, reason || null);
    return { ok: true, status: next };
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
    await insertNotifications(client,[Number(w.user_id)],{
      type:'withdrawal_paid',
      title:'Withdrawal paid',
      message:`Your withdrawal of ${(Number(w.amount)/100).toFixed(2)} ETB has been paid.`,
      link:'wallet',
      relatedUserId:req.user.id
    });
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
  const tRes = await query(
    `SELECT t.*, a.name AS agent_name, a.last_seen_at AS agent_last_seen
     FROM support_tickets t LEFT JOIN users a ON a.id=t.assigned_agent_id
     WHERE t.user_id = $1 ORDER BY t.id DESC LIMIT 1`,
    [req.user.id]
  );
  const activeTicket = tRes.rows[0] || null;
  const unread = activeTicket ? await supportUnreadCount(activeTicket.id, req.user.id) : 0;
  const messages = activeTicket
    ? (await query('SELECT * FROM support_messages WHERE ticket_id = $1 AND is_internal = 0 ORDER BY id ASC', [activeTicket.id])).rows
    : [];
  if (activeTicket) await markSupportRead(activeTicket.id, req.user.id);
  const aiSetting = (await query("SELECT value FROM system_settings WHERE key='ai_support_enabled'")).rows[0];
  return {
    ticket: activeTicket ? { ...activeTicket, unread_count: unread, agent_online: isOnline(activeTicket.agent_last_seen) } : null,
    messages,
    ai_enabled: !aiSetting || aiSetting.value === '1'
  };
}));

app.post('/api/support', auth, need('support.own'), wrap(async (req) => {
  const message = String(req.body.message || '').trim().slice(0, 1000);
  if (message.length < 2) throw new Error('INVALID');

  let tRes = await query("SELECT * FROM support_tickets WHERE user_id = $1 AND status != 'resolved' ORDER BY id DESC LIMIT 1", [req.user.id]);
  let ticket = tRes.rows[0];
  let assignedAgentId = ticket?.assigned_agent_id == null ? null : Number(ticket.assigned_agent_id);
  if (!ticket) {
    const referral = await query('SELECT referred_by_agent_id FROM users WHERE id=$1', [req.user.id]);
    assignedAgentId = referral.rows[0]?.referred_by_agent_id || null;
    const r = await query(
      "INSERT INTO support_tickets (user_id, message, status, assigned_agent_id) VALUES ($1, $2, 'open', $3) RETURNING id",
      [req.user.id, message, assignedAgentId]
    );
    ticket = { id: Number(r.rows[0].id), user_id: req.user.id, status: 'open', assigned_agent_id: assignedAgentId };
  }

  await query(
    "INSERT INTO support_messages (ticket_id, sender_id, sender_role, sender_name, message, is_internal) VALUES ($1, $2, 'user', $3, $4, 0)",
    [ticket.id, req.user.id, req.user.name, message]
  );
  await markSupportRead(ticket.id, req.user.id);
  {
    const payload = {
      type: 'support_message',
      title: 'New support message',
      message: `${req.user.name}: ${message.slice(0, 120)}`,
      link: 'support',
      relatedUserId: req.user.id
    };
    if (assignedAgentId) await insertNotifications(null, [assignedAgentId], payload);
    else await notifySuperadmins(payload);
  }

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
      const escalated = await query(
        `UPDATE support_tickets t SET status='escalated', escalated_reason=$1,
         assigned_agent_id=COALESCE(t.assigned_agent_id, u.referred_by_agent_id), updated_at=NOW()
         FROM users u WHERE u.id=t.user_id AND t.id=$2
         RETURNING t.assigned_agent_id`,
        [aiRes.reason, ticket.id]
      );
      const assignee = escalated.rows[0]?.assigned_agent_id;
      const payload = {
        type: 'support_escalated',
        title: 'Support request needs a human',
        message: `${req.user.name}: ${message.slice(0, 120)}`,
        link: 'support',
        relatedUserId: req.user.id
      };
      if (assignee) await insertNotifications(null, [assignee], payload);
      else await notifySuperadmins(payload);
      await audit(req.user.id, 'support.escalate', { ticketId: ticket.id, reason: aiRes.reason });
      ticket.status = 'escalated';
      assignedAgentId = assignee == null ? null : Number(assignee);
    }
  }

  const messages = (await query('SELECT * FROM support_messages WHERE ticket_id = $1 AND is_internal = 0 ORDER BY id ASC', [ticket.id])).rows;
  return { ticketId: ticket.id, status: ticket.status, messages };
}));

app.post('/api/support/ticket/:id/escalate', auth, need('support.own', 'support.assigned', 'support.all'), wrap(async (req) => {
  const ticketId = Number(req.params.id);
  if (!Number.isSafeInteger(ticketId) || ticketId <= 0) throw new Error('NOT_FOUND');
  const reason = String(req.body.reason || 'Customer requested a human agent.').trim().slice(0, 300);
  return withTx(async (client) => {
    const result = await client.query(
      `SELECT t.*, u.name AS user_name, u.referred_by_agent_id
       FROM support_tickets t JOIN users u ON u.id=t.user_id WHERE t.id=$1 FOR UPDATE OF t`,
      [ticketId]
    );
    const ticket = result.rows[0];
    if (!ticket) throw new Error('NOT_FOUND');
    if (req.user.role === 'user' && Number(ticket.user_id) !== req.user.id) throw new Error('FORBIDDEN');
    if (req.user.role === 'agent' && Number(ticket.referred_by_agent_id) !== req.user.id) throw new Error('FORBIDDEN');
    const assignee = ticket.assigned_agent_id || ticket.referred_by_agent_id || null;
    await client.query(
      "UPDATE support_tickets SET status='escalated',escalated_reason=$1,assigned_agent_id=$2,updated_at=NOW() WHERE id=$3",
      [reason, assignee, ticketId]
    );
    await markSupportRead(ticketId, req.user.id, client);
    const payload = {
      type: 'support_escalated',
      title: 'Escalated support request',
      message: `${ticket.user_name}: ${reason}`,
      link: 'support',
      relatedUserId: Number(ticket.user_id)
    };
    if (assignee) await insertNotifications(client, [assignee], payload);
    else await notifySuperadmins(payload, client);
    await auditSensitive(req, client, 'support.escalate', 'support_ticket', ticketId,
      { status: ticket.status }, { status: 'escalated', assigned_agent_id: assignee == null ? null : Number(assignee) }, reason);
    return { ok: true, status: 'escalated' };
  });
}));

app.get('/api/support/ticket/:id', auth, need('support.own', 'support.assigned', 'support.all'), wrap(async (req) => {
  const ticketId = Number(req.params.id);
  if (!Number.isSafeInteger(ticketId) || ticketId <= 0) throw new Error('NOT_FOUND');
  const res = await query(
    `SELECT t.*, u.name as user_name, u.phone as user_phone, u.referred_by_agent_id,
            u.last_seen_at as user_last_seen, a.name as agent_name, a.last_seen_at as agent_last_seen
     FROM support_tickets t
     JOIN users u ON u.id = t.user_id
     LEFT JOIN users a ON a.id = t.assigned_agent_id
     WHERE t.id = $1`,
    [ticketId]
  );
  const ticket = res.rows[0];
  if (!ticket) throw new Error('NOT_FOUND');
  if (req.user.role === 'user' && Number(ticket.user_id) !== req.user.id) throw new Error('FORBIDDEN');
  if (req.user.role === 'agent' && Number(ticket.referred_by_agent_id) !== req.user.id
      && Number(ticket.assigned_agent_id) !== req.user.id) throw new Error('FORBIDDEN');

  const unread = await supportUnreadCount(ticketId, req.user.id);
  await markSupportRead(ticketId, req.user.id);
  const filterInternal = req.user.role === 'user' ? 'AND is_internal = 0' : '';
  const messages = (await query(`SELECT * FROM support_messages WHERE ticket_id = $1 ${filterInternal} ORDER BY id ASC`, [ticketId])).rows;
  return {
    ticket: {
      ...ticket,
      unread_count: unread,
      user_online: isOnline(ticket.user_last_seen),
      agent_online: isOnline(ticket.agent_last_seen)
    },
    messages
  };
}));

app.post('/api/support/ticket/:id/reply', auth, need('support.reply'), wrap(async (req) => {
  const ticketId = Number(req.params.id);
  const message = String(req.body.message || '').trim().slice(0, 1000);
  if (!Number.isSafeInteger(ticketId) || ticketId <= 0 || message.length < 1) throw new Error('INVALID');

  return withTx(async (client) => {
    const tRes = await client.query(
      `SELECT t.*, u.referred_by_agent_id, u.name AS user_name
       FROM support_tickets t JOIN users u ON u.id=t.user_id WHERE t.id = $1 FOR UPDATE OF t`,
      [ticketId]
    );
    const ticket = tRes.rows[0];
    if (!ticket) throw new Error('NOT_FOUND');
    if (req.user.role === 'user' && Number(ticket.user_id) !== req.user.id) throw new Error('FORBIDDEN');
    if (req.user.role === 'agent' && Number(ticket.referred_by_agent_id) !== req.user.id
        && Number(ticket.assigned_agent_id) !== req.user.id) throw new Error('FORBIDDEN');

    const isStaff = ['agent', 'admin', 'superadmin'].includes(req.user.role);
    const isInternal = isStaff && Boolean(req.body.is_internal);
    await client.query(
      'INSERT INTO support_messages (ticket_id, sender_id, sender_role, sender_name, message, is_internal) VALUES ($1, $2, $3, $4, $5, $6)',
      [ticketId, req.user.id, req.user.role, req.user.name, message, isInternal ? 1 : 0]
    );

    if (!isInternal) {
      const nextStatus = isStaff
        ? 'in_progress'
        : (ticket.status === 'resolved' ? 'open' : ticket.status);
      await client.query(
        `UPDATE support_tickets SET status=$1,
         assigned_agent_id=COALESCE(assigned_agent_id, $2), updated_at=NOW() WHERE id=$3`,
        [nextStatus, isStaff && req.user.role === 'agent' ? req.user.id : null, ticketId]
      );
      const payload = isStaff ? {
        type: 'support_reply',
        title: 'Support replied',
        message: `${req.user.name}: ${message.slice(0, 120)}`,
        link: 'support',
        relatedUserId: req.user.id
      } : {
        type: 'support_message',
        title: 'New customer message',
        message: `${req.user.name}: ${message.slice(0, 120)}`,
        link: 'support',
        relatedUserId: req.user.id
      };
      if (isStaff) {
        await insertNotifications(client, [Number(ticket.user_id)], payload);
        await markSupportRead(ticketId, req.user.id, client);
      } else {
        const assignee = ticket.assigned_agent_id || ticket.referred_by_agent_id;
        if (assignee) await insertNotifications(client, [Number(assignee)], payload);
        else await notifySuperadmins(payload, client);
        await markSupportRead(ticketId, req.user.id, client);
      }
    }

    const filterInternal = req.user.role === 'user' ? 'AND is_internal = 0' : '';
    const messages = (await client.query(`SELECT * FROM support_messages WHERE ticket_id = $1 ${filterInternal} ORDER BY id ASC`, [ticketId])).rows;
    return { ok: true, messages };
  });
}));

app.post('/api/support/ticket/:id/status', auth, need('support.assigned', 'support.all'), wrap(async (req) => {
  const ticketId = Number(req.params.id);
  const status = req.body.status;
  if (!['open', 'in_progress', 'escalated', 'resolved'].includes(status)) throw new Error('INVALID');
  if (!Number.isSafeInteger(ticketId) || ticketId <= 0) throw new Error('NOT_FOUND');
  // Reassignment is a Super Admin privilege; require re-authentication when
  // the caller supplies an assignment change (including explicit unassignment).
  if (req.user.role !== 'agent' && Object.prototype.hasOwnProperty.call(req.body, 'assigned_agent_id')) {
    await requireRecentPassword(req, req.body.reauth_password);
  }
  return withTx(async (client) => {
    const tRes = await client.query(
      `SELECT t.id,t.user_id,t.status,t.assigned_agent_id,u.referred_by_agent_id,u.name AS user_name
       FROM support_tickets t JOIN users u ON u.id=t.user_id WHERE t.id=$1 FOR UPDATE OF t`, [ticketId]
    );
    const ticket = tRes.rows[0];
    if (!ticket) throw new Error('NOT_FOUND');
    if (req.user.role === 'agent' && Number(ticket.referred_by_agent_id) !== req.user.id) throw new Error('FORBIDDEN');
    let assigned;
    if (req.user.role === 'agent') {
      assigned = req.user.id;
    } else if (!Object.prototype.hasOwnProperty.call(req.body, 'assigned_agent_id')) {
      assigned = ticket.assigned_agent_id;
    } else if (req.body.assigned_agent_id == null || req.body.assigned_agent_id === '') {
      assigned = null;
    } else {
      assigned = Number(req.body.assigned_agent_id);
      if (!Number.isSafeInteger(assigned) || assigned <= 0) throw new Error('INVALID');
    }
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
    await markSupportRead(ticketId, req.user.id, client);
    if (assigned != null && Number(assigned) !== Number(ticket.assigned_agent_id)) {
      await insertNotifications(client, [Number(assigned)], {
        type: 'support_assigned',
        title: 'Support ticket assigned',
        message: `Ticket #${ticketId} for ${ticket.user_name || 'a customer'} was assigned to you.`,
        link: 'support',
        relatedUserId: Number(ticket.user_id)
      });
    }
    if (status === 'resolved' && Number(ticket.user_id) !== req.user.id) {
      await insertNotifications(client, [Number(ticket.user_id)], {
        type: 'support_resolved',
        title: 'Support request resolved',
        message: `Your support ticket #${ticketId} has been marked resolved.`,
        link: 'support',
        relatedUserId: req.user.id
      });
    }
    await auditSensitive(req, client, 'support.status', 'support_ticket', ticketId,
      { status: ticket.status, assigned_agent_id: ticket.assigned_agent_id == null ? null : Number(ticket.assigned_agent_id) },
      { status, assigned_agent_id: assigned == null ? null : Number(assigned) }, req.body.note || null);
    return { ok: true, status };
  });
}));

app.get('/api/agent/tickets', auth, need('support.assigned', 'support.all'), wrap(async (req) => {
  const status = String(req.query.status || 'all');
  const conditions = [];
  const params = [req.user.id];
  if (req.user.role === 'agent') conditions.push('u.referred_by_agent_id=$1');
  if (status !== 'all' && ['open','pending','in_progress','escalated','resolved'].includes(status)) {
    params.push(status); conditions.push(`t.status=$${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const res = await query(
    `SELECT t.*, u.name as user_name, u.phone as user_phone, u.last_seen_at,
            a.name as agent_name,
            (SELECT COUNT(*) FROM support_messages m WHERE m.ticket_id = t.id) as message_count,
            (SELECT m.message FROM support_messages m WHERE m.ticket_id=t.id ORDER BY m.id DESC LIMIT 1) AS latest_message,
            (SELECT m.created_at FROM support_messages m WHERE m.ticket_id=t.id ORDER BY m.id DESC LIMIT 1) AS latest_message_at,
            (SELECT COUNT(*) FROM support_messages m
              WHERE m.ticket_id=t.id AND m.is_internal=0 AND m.sender_id IS DISTINCT FROM $1
                AND m.created_at > COALESCE(rd.last_read_at,'epoch'::timestamptz))::bigint AS unread_count
     FROM support_tickets t
     JOIN users u ON u.id = t.user_id
     LEFT JOIN users a ON a.id = t.assigned_agent_id
     LEFT JOIN support_ticket_reads rd ON rd.ticket_id=t.id AND rd.user_id=$1
     ${where} ORDER BY CASE WHEN t.status='escalated' THEN 0 WHEN t.status='open' THEN 1 ELSE 2 END, t.updated_at DESC NULLS LAST, t.id DESC LIMIT 100`,
    params
  );
  return {
    tickets: res.rows.map((row) => ({
      ...row,
      unread_count: Number(row.unread_count || 0),
      message_count: Number(row.message_count || 0),
      user_online: isOnline(row.last_seen_at)
    }))
  };
}));

app.get('/api/admin/tickets', auth, need('support.all'), wrap(async (req) => {
  const status = String(req.query.status || 'all');
  const params = [req.user.id];
  const where = status !== 'all' && ['open','pending','in_progress','escalated','resolved'].includes(status)
    ? 'WHERE t.status=$2' : '';
  if (where) params.push(status);
  const res = await query(
    `SELECT t.*, u.name as user_name, u.phone as user_phone, u.last_seen_at, a.name as agent_name,
     (SELECT COUNT(*) FROM support_messages m WHERE m.ticket_id = t.id) as message_count,
     (SELECT m.message FROM support_messages m WHERE m.ticket_id=t.id ORDER BY m.id DESC LIMIT 1) AS latest_message,
     (SELECT m.created_at FROM support_messages m WHERE m.ticket_id=t.id ORDER BY m.id DESC LIMIT 1) AS latest_message_at,
     (SELECT COUNT(*) FROM support_messages m
       WHERE m.ticket_id=t.id AND m.is_internal=0 AND m.sender_id IS DISTINCT FROM $1
         AND m.created_at > COALESCE(rd.last_read_at,'epoch'::timestamptz))::bigint AS unread_count
     FROM support_tickets t
     JOIN users u ON u.id = t.user_id
     LEFT JOIN users a ON a.id = t.assigned_agent_id
     LEFT JOIN support_ticket_reads rd ON rd.ticket_id=t.id AND rd.user_id=$1
     ${where} ORDER BY CASE WHEN t.status='escalated' THEN 0 WHEN t.status='open' THEN 1 ELSE 2 END, t.updated_at DESC NULLS LAST, t.id DESC LIMIT 100`,
    params
  );
  return {
    tickets: res.rows.map((row) => ({
      ...row,
      unread_count: Number(row.unread_count || 0),
      message_count: Number(row.message_count || 0),
      user_online: isOnline(row.last_seen_at)
    }))
  };
}));

// ---------- in-app notifications ----------
app.get('/api/notifications', auth, wrap(async (req) => {
  const unreadOnly = req.query.unread === '1' || req.query.unread === 'true';
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const rows = await query(
    `SELECT n.*, u.name AS related_user_name
     FROM notifications n LEFT JOIN users u ON u.id=n.related_user_id
     WHERE n.user_id=$1 ${unreadOnly ? 'AND n.is_read=FALSE' : ''}
     ORDER BY n.id DESC LIMIT $2 OFFSET $3`,
    [req.user.id, limit, offset]
  );
  const count = await query(
    `SELECT COUNT(*)::bigint AS total,
            COUNT(*) FILTER (WHERE is_read=FALSE)::bigint AS unread
     FROM notifications WHERE user_id=$1`,
    [req.user.id]
  );
  return {
    notifications: rows.rows,
    total: Number(count.rows[0]?.total || 0),
    unread: Number(count.rows[0]?.unread || 0),
    limit, offset
  };
}));

app.post('/api/notifications/:id/read', auth, wrap(async (req) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('INVALID');
  await query('UPDATE notifications SET is_read=TRUE WHERE id=$1 AND user_id=$2', [id, req.user.id]);
  return { ok: true, unread: await unreadNotificationCount(req.user.id) };
}));

app.post('/api/notifications/read-all', auth, wrap(async (req) => {
  await query('UPDATE notifications SET is_read=TRUE WHERE user_id=$1 AND is_read=FALSE', [req.user.id]);
  return { ok: true, unread: 0 };
}));

app.get('/api/notifications/unread-count', auth, wrap(async (req) => ({
  unread: await unreadNotificationCount(req.user.id)
})));

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

// ---------- agent workspace APIs ----------
function workspaceRange(range, now = new Date()) {
  if (range === 'daily') {
    const current = eatDayBounds(now);
    const previous = eatDayBounds(new Date(current.start.getTime() - DAY_MS));
    return { start: current.start, end: current.end, prevStart: previous.start, prevEnd: previous.end, granularity: 'day' };
  }
  if (range === 'monthly') {
    const current = eatMonthBounds(now);
    const previous = eatMonthBounds(new Date(current.start.getTime() - DAY_MS));
    return { start: current.start, end: current.end, prevStart: previous.start, prevEnd: previous.end, granularity: 'month' };
  }
  const current = utcWeekBounds(now);
  const start = new Date(current.start), end = new Date(current.end);
  const prevStart = new Date(start.getTime() - 7 * DAY_MS);
  return { start, end, prevStart, prevEnd: start, granularity: 'week' };
}

function eatDateLabel(date) {
  const eat = new Date(new Date(date).getTime() + EAT_OFFSET_MS);
  return eat.toISOString().slice(0, 10);
}

async function agentChartSeries(agentId, range) {
  const bounds = workspaceRange(range);
  const count = range === 'daily' ? 14 : range === 'weekly' ? 8 : 6;
  let windowStart;
  if (range === 'daily') windowStart = new Date(bounds.end.getTime() - count * DAY_MS);
  else if (range === 'weekly') windowStart = new Date(bounds.start.getTime() - (count - 1) * 7 * DAY_MS);
  else {
    const eat = new Date(bounds.end.getTime() + EAT_OFFSET_MS);
    windowStart = new Date(Date.UTC(eat.getUTCFullYear(), eat.getUTCMonth() - (count - 1), 1) - EAT_OFFSET_MS);
  }
  const bucketExpr = range === 'daily'
    ? `to_char((r.settled_at + INTERVAL '3 hours')::date,'YYYY-MM-DD')`
    : range === 'weekly'
      ? `to_char(date_trunc('week',(r.settled_at + INTERVAL '3 hours')),'YYYY-MM-DD')`
      : `to_char(date_trunc('month',(r.settled_at + INTERVAL '3 hours')),'YYYY-MM')`;
  const rows = await query(
    `WITH settled AS (${SETTLED_ROUND_SOURCE})
     SELECT ${bucketExpr} AS bucket, COALESCE(SUM(r.bet-r.payout),0)::bigint AS ngr
     FROM settled r JOIN users u ON u.id=r.user_id
     WHERE u.referred_by_agent_id=$1 AND r.settled_at >= $2 AND r.settled_at < $3
     GROUP BY 1 ORDER BY 1`,
    [agentId, windowStart, bounds.end]
  );
  const values = new Map(rows.rows.map((row) => [row.bucket, Number(row.ngr)]));
  const labels = [];
  if (range === 'monthly') {
    const eat = new Date(bounds.end.getTime() + EAT_OFFSET_MS);
    for (let i = count - 1; i >= 0; i -= 1) {
      const d = new Date(Date.UTC(eat.getUTCFullYear(), eat.getUTCMonth() - i, 1));
      labels.push(d.toISOString().slice(0, 7));
    }
  } else if (range === 'weekly') {
    for (let i = count - 1; i >= 0; i -= 1) labels.push(eatDateLabel(new Date(bounds.start.getTime() - i * 7 * DAY_MS)));
  } else {
    for (let i = count - 1; i >= 0; i -= 1) labels.push(eatDateLabel(new Date(bounds.end.getTime() - (i + 1) * DAY_MS)));
  }
  const bps = Number((await query('SELECT commission_bps FROM agent_profiles WHERE agent_id=$1', [agentId])).rows[0]?.commission_bps || DEFAULT_COMMISSION_BPS);
  return labels.map((label) => {
    const ngr = values.get(label) || 0;
    return {
      bucket: label,
      ngr,
      commission: ngr > 0 ? Math.floor((ngr * bps) / 10000) : 0
    };
  });
}

app.get('/api/agent/dashboard', auth, need('agent.workspace'), wrap(async (req) => {
  const range = ['daily', 'weekly', 'monthly'].includes(req.query.range) ? req.query.range : 'weekly';
  const bounds = workspaceRange(range);
  const profile = (await query('SELECT promo_code,commission_bps,weekly_fee_santim,contact_info FROM agent_profiles WHERE agent_id=$1', [req.user.id])).rows[0];
  if (!profile) throw new Error('NOT_FOUND');
  const bps = Number(profile.commission_bps);
  const [metrics, previous, totalUsers, usersAtStart, chart, recentUsers, support, settlement] = await Promise.all([
    agentPeriodMetrics(req.user.id, bounds.start, bounds.end),
    agentPeriodMetrics(req.user.id, bounds.prevStart, bounds.prevEnd),
    query('SELECT COUNT(*)::bigint AS c FROM users WHERE referred_by_agent_id=$1', [req.user.id]),
    query('SELECT COUNT(*)::bigint AS c FROM users WHERE referred_by_agent_id=$1 AND created_at < $2', [req.user.id, bounds.start]),
    agentChartSeries(req.user.id, range),
    query(
      `SELECT u.id,u.name,u.phone,u.status,u.created_at,u.last_seen_at,
              COALESCE(w.balance,0)::bigint AS balance
       FROM users u LEFT JOIN wallets w ON w.user_id=u.id
       WHERE u.referred_by_agent_id=$1 ORDER BY u.id DESC LIMIT 5`, [req.user.id]
    ),
    query(
      `SELECT COUNT(*) FILTER (WHERE t.status!='resolved')::bigint AS open_count,
              COUNT(*) FILTER (WHERE t.status='escalated')::bigint AS escalated_count,
              COALESCE(SUM((SELECT COUNT(*) FROM support_messages m
                WHERE m.ticket_id=t.id AND m.is_internal=0 AND m.sender_id IS DISTINCT FROM $1
                  AND m.created_at > COALESCE(rd.last_read_at,'epoch'::timestamptz))),0)::bigint AS unread_count
       FROM support_tickets t JOIN users u ON u.id=t.user_id
       LEFT JOIN support_ticket_reads rd ON rd.ticket_id=t.id AND rd.user_id=$1
       WHERE u.referred_by_agent_id=$1`, [req.user.id]
    ),
    query(
      `SELECT s.id,s.week_start,s.week_end,s.profit_santim,s.commission_santim,
              COALESCE(SUM(p.amount_santim) FILTER (WHERE p.payment_type='commission'),0)::bigint AS commission_paid
       FROM agent_weekly_settlements s LEFT JOIN agent_settlement_payments p ON p.settlement_id=s.id
       WHERE s.agent_id=$1 GROUP BY s.id ORDER BY s.week_start DESC LIMIT 1`, [req.user.id]
    ),
  ]);
  const commission = metrics.ngr > 0 ? Math.floor((metrics.ngr * bps) / 10000) : 0;
  const previousCommission = previous.ngr > 0 ? Math.floor((previous.ngr * bps) / 10000) : 0;
  const total = Number(totalUsers.rows[0]?.c || 0);
  const totalBefore = Number(usersAtStart.rows[0]?.c || 0);
  return {
    range,
    time_zone: WEEK_TIME_ZONE,
    range_start: bounds.start.toISOString(),
    range_end: bounds.end.toISOString(),
    profile: {
      promo_code: profile.promo_code,
      commission_bps: bps,
      commission_percent: Number((bps / 100).toFixed(2)),
      weekly_fee_santim: Number(profile.weekly_fee_santim),
      contact_info: profile.contact_info,
      referral_url: referralUrl(req, profile.promo_code)
    },
    stats: {
      total_users: { value: total, change: percentChange(total, totalBefore) },
      active_users: { value: metrics.users, change: percentChange(metrics.users, previous.users) },
      deposits: { value: metrics.deposits, change: percentChange(metrics.deposits, previous.deposits) },
      commission: { value: commission, change: percentChange(commission, previousCommission) },
      withdrawal_volume: { value: metrics.withdrawals, change: percentChange(metrics.withdrawals, previous.withdrawals) },
      ngr: { value: metrics.ngr, change: percentChange(metrics.ngr, previous.ngr) }
    },
    chart,
    donut: {
      ngr: metrics.ngr,
      commission,
      platform_share: Math.max(0, metrics.ngr - commission),
      rate_bps: bps
    },
    recent_users: recentUsers.rows.map((row) => ({ ...row, balance: Number(row.balance), online: isOnline(row.last_seen_at) })),
    support: {
      open: Number(support.rows[0]?.open_count || 0),
      escalated: Number(support.rows[0]?.escalated_count || 0),
      unread: Number(support.rows[0]?.unread_count || 0)
    },
    latest_settlement: settlement.rows[0] ? {
      ...settlement.rows[0],
      profit_santim: Number(settlement.rows[0].profit_santim),
      commission_santim: Number(settlement.rows[0].commission_santim),
      commission_paid: Number(settlement.rows[0].commission_paid)
    } : null
  };
}));

app.get('/api/agent/users', auth, need('agent.workspace'), wrap(async (req) => {
  const search = String(req.query.search || '').trim().slice(0, 100);
  const status = ['active', 'suspended', 'all'].includes(req.query.status) ? req.query.status : 'all';
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const params = [req.user.id, `%${search}%`, status];
  const where = `u.referred_by_agent_id=$1 AND ($2='%%' OR u.name ILIKE $2 OR u.phone ILIKE $2 OR COALESCE(u.email,'') ILIKE $2 OR COALESCE(u.username,'') ILIKE $2)
                 AND ($3='all' OR u.status=$3)`;
  const rows = await query(
    `SELECT u.id,u.name,u.phone,u.email,u.username,u.status,u.created_at,u.last_seen_at,
            COALESCE(w.balance,0)::bigint AS balance,COALESCE(w.promo_balance,0)::bigint AS promo_balance,
            (SELECT COUNT(*) FROM deposits d WHERE d.user_id=u.id)::bigint AS deposit_count,
            (SELECT COALESCE(SUM(d.amount),0) FROM deposits d WHERE d.user_id=u.id AND d.status='approved')::bigint AS deposit_total,
            (SELECT COUNT(*) FROM withdrawals wd WHERE wd.user_id=u.id)::bigint AS withdrawal_count,
            (SELECT COUNT(*) FROM game_rounds r WHERE r.user_id=u.id AND r.status='done')::bigint AS rounds_played,
            (SELECT COALESCE(SUM(r.bet-r.payout),0) FROM game_rounds r WHERE r.user_id=u.id AND r.status='done')::bigint AS ngr,
            (SELECT MAX(l.created_at) FROM ledger l WHERE l.user_id=u.id) AS last_activity
     FROM users u LEFT JOIN wallets w ON w.user_id=u.id
     WHERE ${where} ORDER BY u.id DESC LIMIT $4 OFFSET $5`,
    [...params, limit, offset]
  );
  const count = await query(
    `SELECT COUNT(*)::bigint AS c FROM users u WHERE ${where}`, params
  );
  return {
    users: rows.rows.map((row) => ({
      ...row,
      balance: Number(row.balance), promo_balance: Number(row.promo_balance),
      deposit_count: Number(row.deposit_count), deposit_total: Number(row.deposit_total),
      withdrawal_count: Number(row.withdrawal_count), rounds_played: Number(row.rounds_played),
      ngr: Number(row.ngr), online: isOnline(row.last_seen_at)
    })),
    total: Number(count.rows[0]?.c || 0), limit, offset
  };
}));

app.get('/api/agent/users/:id', auth, need('agent.workspace'), wrap(async (req) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('INVALID');
  const userRes = await query(
    `SELECT u.id,u.name,u.phone,u.email,u.username,u.status,u.created_at,u.last_seen_at,
            COALESCE(w.balance,0)::bigint AS balance,COALESCE(w.promo_balance,0)::bigint AS promo_balance,
            rb.amount_santim AS referral_bonus, rb.created_at AS referral_bonus_at
     FROM users u LEFT JOIN wallets w ON w.user_id=u.id
     LEFT JOIN referral_bonuses rb ON rb.referred_user_id=u.id
     WHERE u.id=$1 AND u.referred_by_agent_id=$2`,
    [id, req.user.id]
  );
  const customer = userRes.rows[0];
  if (!customer) throw new Error('NOT_FOUND');
  const [ledger, deposits, withdrawals, games, tickets] = await Promise.all([
    query('SELECT id,type,amount,balance_after,ref_type,ref_id,created_at FROM ledger WHERE user_id=$1 ORDER BY id DESC LIMIT 30', [id]),
    query(`SELECT d.id,d.amount,d.tx_ref,d.status,d.created_at,p.name AS provider FROM deposits d JOIN providers p ON p.id=d.provider_id WHERE d.user_id=$1 ORDER BY d.id DESC LIMIT 20`, [id]),
    query(`SELECT w.id,w.amount,w.account_number,w.status,w.created_at,p.name AS provider FROM withdrawals w JOIN providers p ON p.id=w.provider_id WHERE w.user_id=$1 ORDER BY w.id DESC LIMIT 20`, [id]),
    query(`SELECT game,COUNT(*)::bigint AS rounds,COALESCE(SUM(bet),0)::bigint AS stakes,COALESCE(SUM(payout),0)::bigint AS payouts,COALESCE(SUM(bet-payout),0)::bigint AS ngr FROM game_rounds WHERE user_id=$1 AND status='done' GROUP BY game ORDER BY stakes DESC`, [id]),
    query(`SELECT id,subject,status,created_at,updated_at FROM support_tickets WHERE user_id=$1 ORDER BY id DESC LIMIT 10`, [id]),
  ]);
  return {
    user: { ...customer, balance: Number(customer.balance), promo_balance: Number(customer.promo_balance), referral_bonus: customer.referral_bonus == null ? null : Number(customer.referral_bonus), online: isOnline(customer.last_seen_at) },
    ledger: ledger.rows.map((row) => ({ ...row, amount: Number(row.amount), balance_after: Number(row.balance_after) })),
    deposits: deposits.rows.map((row) => ({ ...row, amount: Number(row.amount) })),
    withdrawals: withdrawals.rows.map((row) => ({ ...row, amount: Number(row.amount) })),
    games: games.rows.map((row) => ({ ...row, rounds: Number(row.rounds), stakes: Number(row.stakes), payouts: Number(row.payouts), ngr: Number(row.ngr) })),
    tickets: tickets.rows
  };
}));

app.get('/api/agent/transactions', auth, need('agent.workspace'), wrap(async (req) => {
  const type = String(req.query.type || 'all').slice(0, 40);
  const status = ['all', 'pending', 'approved', 'rejected', 'paid', 'settled'].includes(req.query.status) ? req.query.status : 'all';
  const search = String(req.query.search || '').trim().slice(0, 100);
  const start = String(req.query.start || '').trim();
  const end = String(req.query.end || '').trim();
  const validDate = (v) => !v || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v);
  if (!validDate(start) || !validDate(end) || (start && end && end < start)) throw new Error('INVALID');
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const params = [req.user.id, type, status, `%${search}%`, start, end, limit, offset];
  const base = `
    WITH referred AS (
      SELECT id,name,phone FROM users WHERE referred_by_agent_id=$1
    ), activity AS (
      SELECT 'L-'||l.id::text AS id,l.user_id,u.name AS user_name,u.phone,l.type,l.amount,l.balance_after,
             l.ref_type,l.ref_id::text AS reference,'settled'::text AS status,l.created_at
      FROM ledger l JOIN referred u ON u.id=l.user_id
      WHERE l.type NOT IN ('deposit','withdraw_hold','withdraw_refund')
      UNION ALL
      SELECT 'D-'||d.id::text,d.user_id,u.name,u.phone,'deposit',d.amount,
             (SELECT l.balance_after FROM ledger l WHERE l.type='deposit' AND l.ref_type='deposit' AND l.ref_id=d.id ORDER BY l.id DESC LIMIT 1),
             'deposit',d.tx_ref,d.status,d.created_at
      FROM deposits d JOIN referred u ON u.id=d.user_id
      UNION ALL
      SELECT 'W-'||w.id::text,w.user_id,u.name,u.phone,'withdrawal',-w.amount,
             (SELECT l.balance_after FROM ledger l WHERE l.ref_type='withdraw' AND l.ref_id=w.id AND l.type IN ('withdraw_hold','withdraw_refund') ORDER BY l.id DESC LIMIT 1),
             'withdrawal',w.account_number,w.status,w.created_at
      FROM withdrawals w JOIN referred u ON u.id=w.user_id
    )`;
  const where = `WHERE ($2='all' OR a.type=$2) AND ($3='all' OR a.status=$3)
    AND ($4='%%' OR a.user_name ILIKE $4 OR a.phone ILIKE $4 OR COALESCE(a.reference,'') ILIKE $4)
    AND ($5='' OR a.created_at >= $5::date) AND ($6='' OR a.created_at < ($6::date + INTERVAL '1 day'))`;
  const rows = await query(
    `${base} SELECT a.* FROM activity a ${where} ORDER BY a.created_at DESC,a.id DESC LIMIT $7 OFFSET $8`, params
  );
  const count = await query(`${base} SELECT COUNT(*)::bigint AS c FROM activity a ${where}`, params.slice(0, 6));
  return {
    transactions: rows.rows.map((row) => ({ ...row, amount: Number(row.amount), balance_after: row.balance_after == null ? null : Number(row.balance_after) })),
    total: Number(count.rows[0]?.c || 0), limit, offset
  };
}));

app.get('/api/agent/earnings', auth, need('agent.workspace'), wrap(async (req) => {
  const profile = (await query('SELECT promo_code,commission_bps,weekly_fee_santim FROM agent_profiles WHERE agent_id=$1', [req.user.id])).rows[0];
  if (!profile) throw new Error('NOT_FOUND');
  const bounds = workspaceRange('weekly');
  const bps = Number(profile.commission_bps);
  const metrics = await agentPeriodMetrics(req.user.id, bounds.start, bounds.end);
  const prior = await query(
    `SELECT carried_loss_out_santim FROM agent_weekly_settlements
     WHERE agent_id=$1 AND week_end <= $2 ORDER BY week_end DESC LIMIT 1`,
    [req.user.id, bounds.start]
  );
  const carry = Number(prior.rows[0]?.carried_loss_out_santim || 0);
  const estimate = commissionForWeek(metrics.ngr, carry, bps);
  const [settlements, requests] = await Promise.all([
    query(
      `SELECT s.id,s.week_start,s.week_end,s.profit_santim,s.carried_loss_in_santim,s.carried_loss_out_santim,
              s.commission_bps,s.commission_santim,s.weekly_fee_santim,
              COALESCE(SUM(p.amount_santim) FILTER (WHERE p.payment_type='commission'),0)::bigint AS commission_paid,
              COALESCE(SUM(p.amount_santim) FILTER (WHERE p.payment_type='weekly_fee'),0)::bigint AS fee_paid,
              MAX(p.paid_at) AS paid_at
       FROM agent_weekly_settlements s LEFT JOIN agent_settlement_payments p ON p.settlement_id=s.id
       WHERE s.agent_id=$1 GROUP BY s.id ORDER BY s.week_start DESC LIMIT 12`, [req.user.id]
    ),
    query(
      `SELECT id,payout_type,period_start,period_end,amount_santim,status,note,decision_reason,created_at,decided_at,paid_at
       FROM agent_payout_requests WHERE agent_id=$1 ORDER BY id DESC LIMIT 20`, [req.user.id]
    ),
  ]);
  const history = settlements.rows.map((row) => {
    const commissionPaid = Number(row.commission_paid);
    const feePaid = Number(row.fee_paid);
    const stage = Number(row.commission_santim) > 0 && commissionPaid >= Number(row.commission_santim)
      ? 'paid' : (requests.rows.some((request) => request.status === 'approved'
        && String(request.period_start) === String(row.week_start) && request.payout_type === 'commission') ? 'approved' : 'accrued');
    return {
      ...row,
      profit_santim: Number(row.profit_santim), carried_loss_in_santim: Number(row.carried_loss_in_santim),
      carried_loss_out_santim: Number(row.carried_loss_out_santim), commission_bps: Number(row.commission_bps),
      commission_santim: Number(row.commission_santim), weekly_fee_santim: Number(row.weekly_fee_santim),
      commission_paid: commissionPaid, fee_paid: feePaid, stage
    };
  });
  return {
    time_zone: WEEK_TIME_ZONE,
    week_start: bounds.start.toISOString(),
    week_end: bounds.end.toISOString(),
    profile: { promo_code: profile.promo_code, commission_bps: bps, commission_percent: Number((bps / 100).toFixed(2)), weekly_fee_santim: Number(profile.weekly_fee_santim) },
    current: {
      profit_santim: metrics.ngr,
      carried_loss_in_santim: carry,
      estimated_commission_santim: estimate.commissionSantim,
      projected_carried_loss_santim: estimate.carriedLossSantim,
      stage: 'estimated'
    },
    totals: {
      commission_paid_santim: history.reduce((sum, row) => sum + row.commission_paid, 0),
      pending_requests_santim: requests.rows.filter((r) => r.status === 'pending').reduce((sum, r) => sum + Number(r.amount_santim), 0)
    },
    history,
    payout_requests: requests.rows.map((row) => ({ ...row, amount_santim: Number(row.amount_santim) }))
  };
}));

app.get('/api/agent/profile', auth, need('agent.workspace'), wrap(async (req) => {
  const row = (await query(
    `SELECT u.id,u.name,u.phone,u.email,u.username,u.status,u.created_at,u.last_seen_at,
            p.promo_code,p.contact_info,p.weekly_fee_santim,p.commission_bps
     FROM users u JOIN agent_profiles p ON p.agent_id=u.id WHERE u.id=$1`,
    [req.user.id]
  )).rows[0];
  if (!row) throw new Error('NOT_FOUND');
  return {
    profile: {
      ...row,
      weekly_fee_santim: Number(row.weekly_fee_santim),
      commission_bps: Number(row.commission_bps),
      commission_percent: Number((Number(row.commission_bps) / 100).toFixed(2)),
      referral_url: referralUrl(req, row.promo_code)
    }
  };
}));

app.patch('/api/agent/profile', auth, need('agent.workspace'), wrap(async (req) => {
  const current = (await query(
    `SELECT u.name,u.email,u.username,p.contact_info FROM users u JOIN agent_profiles p ON p.agent_id=u.id WHERE u.id=$1`,
    [req.user.id]
  )).rows[0];
  if (!current) throw new Error('NOT_FOUND');
  const name = req.body.name == null ? current.name : String(req.body.name).trim();
  if (name.length < 2 || name.length > 60) throw new Error('INVALID');
  const email = req.body.email == null ? current.email : normalizeEmail(req.body.email);
  const username = req.body.username == null ? current.username : normalizeUsername(req.body.username);
  const contact = req.body.contact_info == null ? current.contact_info : String(req.body.contact_info).trim().slice(0, 200);
  return withTx(async (client) => {
    await client.query('UPDATE users SET name=$1,email=$2,username=$3 WHERE id=$4', [name, email, username, req.user.id]);
    await client.query('UPDATE agent_profiles SET contact_info=$1,updated_at=NOW() WHERE agent_id=$2', [contact, req.user.id]);
    await auditSensitive(req, client, 'agent.profile.update', 'agent', req.user.id,
      { name: current.name, email: current.email, username: current.username, contact_info: current.contact_info },
      { name, email, username, contact_info: contact });
    return { ok: true, profile: { name, email, username, contact_info: contact } };
  }).catch((error) => { if (error.code === '23505') throw new Error('EXISTS'); throw error; });
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
    await notifySuperadmins({
      type:'agent_payout_request',
      title:'Agent payout request',
      message:`${req.user.name} requested ${type==='weekly_fee'?'a weekly fee':'commission'} of ${(amount/100).toFixed(2)} ETB.`,
      link:'commissions',
      relatedUserId:req.user.id
    }, client);
    await auditSensitive(req,client,'agent.payout_request','agent_payout_request',id,null,{type,amount_santim:amount,period_start:start,period_end:end,status:'pending'});
    return { id, status: 'pending', amount_santim: amount };
  });
}));

// ---------- Super Admin workspace APIs ----------
function parseDateRange(startValue, endValue, defaults) {
  const validDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if ((startValue && !validDate(startValue)) || (endValue && !validDate(endValue))) throw new Error('INVALID');
  const start = startValue ? new Date(`${startValue}T00:00:00.000+03:00`) : defaults.start;
  const end = endValue ? new Date(Date.parse(`${endValue}T00:00:00.000+03:00`) + DAY_MS) : defaults.end;
  if (end <= start || end - start > 366 * DAY_MS) throw new Error('INVALID');
  return { start, end, startDate: eatDateLabel(start), endDate: eatDateLabel(new Date(end.getTime() - 1)) };
}

function roundBps(amount, bps) {
  if (amount <= 0) return 0;
  return Math.floor((amount * bps) / 10000);
}

app.get('/api/superadmin/dashboard', auth, need('money.decide'), wrap(async (req) => {
  const range = ['daily', 'weekly', 'monthly'].includes(req.query.range) ? req.query.range : 'weekly';
  const bounds = workspaceRange(range);
  const params = [bounds.start, bounds.end, bounds.prevStart, bounds.prevEnd];
  // The Agent P&L chart is always an eight-week series, independent of the
  // stat-card range, so its buckets must align with EAT week starts.
  const trendBounds = utcWeekBounds();
  const trendStart = new Date(trendBounds.start.getTime() - 7 * 7 * DAY_MS);
  const [users, deposits, withdrawals, pendingDep, pendingWith, agentStats, commissionRows, previousCommissionRows, agentBars, trendRows, pendingDeposits, pendingWithdrawals, notifications, support] = await Promise.all([
    query(
      `SELECT COUNT(*)::bigint AS total,
              COUNT(*) FILTER (WHERE created_at >= $1 AND created_at < $2)::bigint AS current_new,
              COUNT(*) FILTER (WHERE created_at >= $3 AND created_at < $4)::bigint AS previous_new
       FROM users WHERE role='user'`, params
    ),
    query(
      `SELECT COUNT(*)::bigint AS c, COALESCE(SUM(d.amount),0)::bigint AS total
       FROM deposits d WHERE d.status='approved'
         AND COALESCE(d.reviewed_at,d.created_at) >= $1 AND COALESCE(d.reviewed_at,d.created_at) < $2`, params
    ),
    query(
      `SELECT COUNT(*)::bigint AS c, COALESCE(SUM(w.amount),0)::bigint AS total
       FROM withdrawals w WHERE w.status IN ('approved','paid')
         AND COALESCE(w.reviewed_at,w.created_at) >= $1 AND COALESCE(w.reviewed_at,w.created_at) < $2`, params
    ),
    query(`SELECT COUNT(*)::bigint AS c, COALESCE(SUM(amount),0)::bigint AS total FROM deposits WHERE status='pending'`),
    query(`SELECT COUNT(*)::bigint AS c, COALESCE(SUM(amount),0)::bigint AS total FROM withdrawals WHERE status='pending'`),
    query(
      `SELECT COUNT(*) FILTER (WHERE status='active')::bigint AS active,
              COUNT(*) FILTER (WHERE status='active' AND last_seen_at >= NOW()-INTERVAL '5 minutes')::bigint AS online,
              COUNT(*)::bigint AS total
       FROM users WHERE role='agent'`
    ),
    query(
      `WITH settled AS (${SETTLED_ROUND_SOURCE}),
       ngr AS (
         SELECT u.referred_by_agent_id AS agent_id, COALESCE(SUM(r.bet-r.payout),0)::bigint AS ngr
         FROM settled r JOIN users u ON u.id=r.user_id
         WHERE u.referred_by_agent_id IS NOT NULL AND r.settled_at >= $1 AND r.settled_at < $2
         GROUP BY 1
       )
       SELECT COALESCE(SUM(n.ngr),0)::bigint AS ngr,
              COALESCE(SUM(CASE WHEN n.ngr>0 THEN (n.ngr*p.commission_bps/10000)::bigint ELSE 0 END),0)::bigint AS commission
       FROM ngr n JOIN agent_profiles p ON p.agent_id=n.agent_id`, params
    ),
    query(
      `WITH settled AS (${SETTLED_ROUND_SOURCE}),
       ngr AS (
         SELECT u.referred_by_agent_id AS agent_id, COALESCE(SUM(r.bet-r.payout),0)::bigint AS ngr
         FROM settled r JOIN users u ON u.id=r.user_id
         WHERE u.referred_by_agent_id IS NOT NULL AND r.settled_at >= $3 AND r.settled_at < $4
         GROUP BY 1
       )
       SELECT COALESCE(SUM(CASE WHEN n.ngr>0 THEN (n.ngr*p.commission_bps/10000)::bigint ELSE 0 END),0)::bigint AS commission
       FROM ngr n JOIN agent_profiles p ON p.agent_id=n.agent_id`, params
    ),
    query(
      `WITH settled AS (${SETTLED_ROUND_SOURCE}),
       ngr AS (
         SELECT u.referred_by_agent_id AS agent_id, COALESCE(SUM(r.bet-r.payout),0)::bigint AS ngr
         FROM settled r JOIN users u ON u.id=r.user_id
         WHERE u.referred_by_agent_id IS NOT NULL AND r.settled_at >= $1 AND r.settled_at < $2
         GROUP BY 1
       )
       SELECT u.id,u.name,u.phone,u.status,p.promo_code,p.commission_bps,
              COALESCE(n.ngr,0)::bigint AS ngr,
              COALESCE(CASE WHEN n.ngr>0 THEN (n.ngr*p.commission_bps/10000)::bigint ELSE 0 END,0)::bigint AS commission
       FROM users u JOIN agent_profiles p ON p.agent_id=u.id
       LEFT JOIN ngr n ON n.agent_id=u.id
       WHERE u.role='agent'
       ORDER BY ngr DESC,u.id LIMIT 10`, params
    ),
    query(
      `WITH settled AS (${SETTLED_ROUND_SOURCE})
       SELECT to_char(date_trunc('week',(r.settled_at + INTERVAL '3 hours')),'YYYY-MM-DD') AS bucket,
              COALESCE(SUM(r.bet-r.payout),0)::bigint AS ngr
       FROM settled r JOIN users u ON u.id=r.user_id
       WHERE u.referred_by_agent_id IS NOT NULL
         AND r.settled_at >= $1 AND r.settled_at < $2
       GROUP BY 1 ORDER BY 1`,
      [trendStart, trendBounds.end]
    ),
    query(
      `SELECT d.id,d.amount,d.tx_ref,d.created_at,u.name AS user_name,u.phone,a.name AS agent_name
       FROM deposits d JOIN users u ON u.id=d.user_id LEFT JOIN users a ON a.id=u.referred_by_agent_id
       WHERE d.status='pending' ORDER BY d.id LIMIT 5`
    ),
    query(
      `SELECT w.id,w.amount,w.account_number,w.created_at,u.name AS user_name,u.phone,a.name AS agent_name
       FROM withdrawals w JOIN users u ON u.id=w.user_id LEFT JOIN users a ON a.id=u.referred_by_agent_id
       WHERE w.status='pending' ORDER BY w.id LIMIT 5`
    ),
    query(
      `SELECT id,type,title,message,link,is_read,created_at FROM notifications
       WHERE user_id=$1 ORDER BY id DESC LIMIT 8`, [req.user.id]
    ),
    query(
      `SELECT COUNT(*) FILTER (WHERE t.status!='resolved')::bigint AS open_count,
              COUNT(*) FILTER (WHERE t.status='escalated')::bigint AS escalated_count,
              COALESCE(SUM((SELECT COUNT(*) FROM support_messages m
                WHERE m.ticket_id=t.id AND m.is_internal=0 AND m.sender_id IS DISTINCT FROM $1
                  AND m.created_at > COALESCE(rd.last_read_at,'epoch'::timestamptz))),0)::bigint AS unread_count
       FROM support_tickets t
       LEFT JOIN support_ticket_reads rd ON rd.ticket_id=t.id AND rd.user_id=$1`,
      [req.user.id]
    ),
  ]);
  const currentCommission = Number(commissionRows.rows[0]?.commission || 0);
  const previousCommission = Number(previousCommissionRows.rows[0]?.commission || 0);
  const currentNgr = Number(commissionRows.rows[0]?.ngr || 0);
  const weeklyLabels = [];
  for (let i = 7; i >= 0; i -= 1) weeklyLabels.push(eatDateLabel(new Date(trendBounds.start.getTime() - i * 7 * DAY_MS)));
  const weeklyMap = new Map(trendRows.rows.map((row) => [row.bucket, Number(row.ngr)]));
  return {
    range,
    time_zone: WEEK_TIME_ZONE,
    range_start: bounds.start.toISOString(),
    range_end: bounds.end.toISOString(),
    stats: {
      total_users: { value: Number(users.rows[0].total), new: Number(users.rows[0].current_new), change: percentChange(Number(users.rows[0].current_new), Number(users.rows[0].previous_new)) },
      active_agents: { value: Number(agentStats.rows[0].active), online: Number(agentStats.rows[0].online), total: Number(agentStats.rows[0].total) },
      deposits: { value: Number(deposits.rows[0].total), count: Number(deposits.rows[0].c) },
      withdrawals: { value: Number(withdrawals.rows[0].total), count: Number(withdrawals.rows[0].c) },
      pending_approvals: { value: Number(pendingDep.rows[0].c) + Number(pendingWith.rows[0].c), deposits: Number(pendingDep.rows[0].c), withdrawals: Number(pendingWith.rows[0].c), amount: Number(pendingDep.rows[0].total) + Number(pendingWith.rows[0].total) },
      commission: { value: currentCommission, change: percentChange(currentCommission, previousCommission) },
      ngr: { value: currentNgr }
    },
    agent_bars: agentBars.rows.map((row) => ({
      ...row,
      commission_bps: Number(row.commission_bps),
      ngr: Number(row.ngr),
      commission: Number(row.commission)
    })),
    weekly_trend: weeklyLabels.map((label) => {
      const ngr = weeklyMap.get(label) || 0;
      return { bucket: label, ngr, commission: roundBps(ngr, DEFAULT_COMMISSION_BPS) };
    }),
    donut: {
      ngr: Math.max(0, currentNgr),
      commission: currentCommission,
      platform_share: Math.max(0, currentNgr - currentCommission),
      rate_bps: DEFAULT_COMMISSION_BPS
    },
    pending_deposits: pendingDeposits.rows.map((row) => ({ ...row, amount: Number(row.amount) })),
    pending_withdrawals: pendingWithdrawals.rows.map((row) => ({ ...row, amount: Number(row.amount) })),
    notifications: notifications.rows,
    support: {
      open: Number(support.rows[0]?.open_count || 0),
      escalated: Number(support.rows[0]?.escalated_count || 0),
      unread: Number(support.rows[0]?.unread_count || 0),
      notifications_unread: await unreadNotificationCount(req.user.id)
    }
  };
}));

app.get('/api/superadmin/agent-performance', auth, need('money.decide'), wrap(async (req) => {
  const period = req.query.period === 'monthly' ? 'monthly' : 'weekly';
  const bounds = workspaceRange(period);
  const params = [bounds.start, bounds.end, bounds.prevStart, bounds.prevEnd];
  const rows = await query(
    `WITH settled AS (${SETTLED_ROUND_SOURCE}),
     current_ngr AS (
       SELECT u.referred_by_agent_id AS agent_id, COALESCE(SUM(r.bet-r.payout),0)::bigint AS ngr
       FROM settled r JOIN users u ON u.id=r.user_id
       WHERE u.referred_by_agent_id IS NOT NULL AND r.settled_at >= $1 AND r.settled_at < $2 GROUP BY 1
     ),
     previous_ngr AS (
       SELECT u.referred_by_agent_id AS agent_id, COALESCE(SUM(r.bet-r.payout),0)::bigint AS ngr
       FROM settled r JOIN users u ON u.id=r.user_id
       WHERE u.referred_by_agent_id IS NOT NULL AND r.settled_at >= $3 AND r.settled_at < $4 GROUP BY 1
     ),
     dep AS (
       SELECT u.referred_by_agent_id AS agent_id, COUNT(*)::bigint AS c, COALESCE(SUM(d.amount),0)::bigint AS total
       FROM deposits d JOIN users u ON u.id=d.user_id
       WHERE u.referred_by_agent_id IS NOT NULL AND d.status='approved'
         AND COALESCE(d.reviewed_at,d.created_at) >= $1 AND COALESCE(d.reviewed_at,d.created_at) < $2 GROUP BY 1
     ),
     wd AS (
       SELECT u.referred_by_agent_id AS agent_id, COUNT(*)::bigint AS c, COALESCE(SUM(w.amount),0)::bigint AS total
       FROM withdrawals w JOIN users u ON u.id=w.user_id
       WHERE u.referred_by_agent_id IS NOT NULL AND w.status IN ('approved','paid')
         AND COALESCE(w.reviewed_at,w.created_at) >= $1 AND COALESCE(w.reviewed_at,w.created_at) < $2 GROUP BY 1
     ),
     new_users AS (
       SELECT referred_by_agent_id AS agent_id, COUNT(*)::bigint AS c
       FROM users WHERE referred_by_agent_id IS NOT NULL AND created_at >= $1 AND created_at < $2 GROUP BY 1
     ),
     active_users AS (
       SELECT u.referred_by_agent_id AS agent_id, COUNT(DISTINCT l.user_id)::bigint AS c
       FROM ledger l JOIN users u ON u.id=l.user_id
       WHERE u.referred_by_agent_id IS NOT NULL AND l.created_at >= $1 AND l.created_at < $2 GROUP BY 1
     )
     SELECT u.id,u.name,u.phone,u.status,p.promo_code,p.commission_bps,p.weekly_fee_santim,
            COALESCE(n.ngr,0)::bigint AS ngr,COALESCE(pn.ngr,0)::bigint AS previous_ngr,
            COALESCE(d.c,0)::bigint AS deposits_count,COALESCE(d.total,0)::bigint AS deposits_total,
            COALESCE(w.c,0)::bigint AS withdrawals_count,COALESCE(w.total,0)::bigint AS withdrawals_total,
            COALESCE(nu.c,0)::bigint AS new_users,COALESCE(au.c,0)::bigint AS active_users,
            (SELECT COUNT(*) FROM users ru WHERE ru.referred_by_agent_id=u.id)::bigint AS total_users
     FROM users u JOIN agent_profiles p ON p.agent_id=u.id
     LEFT JOIN current_ngr n ON n.agent_id=u.id
     LEFT JOIN previous_ngr pn ON pn.agent_id=u.id
     LEFT JOIN dep d ON d.agent_id=u.id
     LEFT JOIN wd w ON w.agent_id=u.id
     LEFT JOIN new_users nu ON nu.agent_id=u.id
     LEFT JOIN active_users au ON au.agent_id=u.id
     WHERE u.role='agent'
     ORDER BY ngr DESC,u.id`,
    params
  );
  return {
    period,
    time_zone: WEEK_TIME_ZONE,
    range_start: bounds.start.toISOString(),
    range_end: bounds.end.toISOString(),
    agents: rows.rows.map((row, index) => {
      const ngr = Number(row.ngr);
      const bps = Number(row.commission_bps);
      return {
        ...row,
        rank: index + 1,
        commission_bps: bps,
        weekly_fee_santim: Number(row.weekly_fee_santim),
        ngr,
        previous_ngr: Number(row.previous_ngr),
        commission: roundBps(ngr, bps),
        deposits_count: Number(row.deposits_count), deposits_total: Number(row.deposits_total),
        withdrawals_count: Number(row.withdrawals_count), withdrawals_total: Number(row.withdrawals_total),
        new_users: Number(row.new_users), active_users: Number(row.active_users), total_users: Number(row.total_users),
        growth_percent: percentChange(ngr, Number(row.previous_ngr))
      };
    })
  };
}));

app.get('/api/superadmin/users', auth, need('money.decide'), wrap(async (req) => {
  const search = String(req.query.search || '').trim().slice(0, 100);
  const role = ['all', 'user', 'agent', 'admin', 'superadmin'].includes(req.query.role) ? req.query.role : 'user';
  const status = ['all', 'active', 'suspended'].includes(req.query.status) ? req.query.status : 'all';
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const params = [`%${search}%`, role, status];
  const where = `($1='%%' OR u.name ILIKE $1 OR u.phone ILIKE $1 OR COALESCE(u.email,'') ILIKE $1 OR COALESCE(u.username,'') ILIKE $1)
                 AND ($2='all' OR u.role=$2) AND ($3='all' OR u.status=$3)`;
  const rows = await query(
    `SELECT u.id,u.name,u.phone,u.email,u.username,u.role,u.status,u.created_at,u.last_seen_at,
            u.referred_by_agent_id,a.name AS agent_name,
            COALESCE(w.balance,0)::bigint AS balance,COALESCE(w.promo_balance,0)::bigint AS promo_balance,
            rb.amount_santim AS referral_bonus,
            (SELECT COALESCE(SUM(d.amount),0) FROM deposits d WHERE d.user_id=u.id AND d.status='approved')::bigint AS deposit_total,
            (SELECT COUNT(*) FROM deposits d WHERE d.user_id=u.id AND d.status='pending')::bigint AS pending_deposits,
            (SELECT COUNT(*) FROM withdrawals wd WHERE wd.user_id=u.id AND wd.status='pending')::bigint AS pending_withdrawals,
            (SELECT COALESCE(SUM(r.bet-r.payout),0) FROM game_rounds r WHERE r.user_id=u.id AND r.status='done')::bigint AS ngr
     FROM users u LEFT JOIN wallets w ON w.user_id=u.id
     LEFT JOIN users a ON a.id=u.referred_by_agent_id
     LEFT JOIN referral_bonuses rb ON rb.referred_user_id=u.id
     WHERE ${where} ORDER BY u.id DESC LIMIT $4 OFFSET $5`,
    [...params, limit, offset]
  );
  const count = await query(`SELECT COUNT(*)::bigint AS c FROM users u WHERE ${where}`, params);
  return {
    users: rows.rows.map((row) => ({
      ...row,
      balance: Number(row.balance), promo_balance: Number(row.promo_balance),
      referral_bonus: row.referral_bonus == null ? null : Number(row.referral_bonus),
      deposit_total: Number(row.deposit_total), pending_deposits: Number(row.pending_deposits),
      pending_withdrawals: Number(row.pending_withdrawals), ngr: Number(row.ngr),
      online: isOnline(row.last_seen_at)
    })),
    total: Number(count.rows[0]?.c || 0), limit, offset
  };
}));

app.get('/api/superadmin/users/:id', auth, need('money.decide'), wrap(async (req) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('INVALID');
  const user = (await query(
    `SELECT u.id,u.name,u.phone,u.email,u.username,u.role,u.status,u.created_at,u.last_seen_at,
            u.referred_by_agent_id,a.name AS agent_name,a.phone AS agent_phone,
            COALESCE(w.balance,0)::bigint AS balance,COALESCE(w.promo_balance,0)::bigint AS promo_balance,
            rb.amount_santim AS referral_bonus,rb.created_at AS referral_bonus_at,
            (SELECT COALESCE(SUM(d.amount),0) FROM deposits d WHERE d.user_id=u.id AND d.status='approved')::bigint AS deposit_total,
            (SELECT COALESCE(SUM(r.bet-r.payout),0) FROM game_rounds r WHERE r.user_id=u.id AND r.status='done')::bigint AS ngr
     FROM users u LEFT JOIN wallets w ON w.user_id=u.id
     LEFT JOIN users a ON a.id=u.referred_by_agent_id
     LEFT JOIN referral_bonuses rb ON rb.referred_user_id=u.id WHERE u.id=$1`, [id]
  )).rows[0];
  if (!user) throw new Error('NOT_FOUND');
  const [ledger, deposits, withdrawals, games, tickets] = await Promise.all([
    query('SELECT id,type,amount,balance_after,ref_type,ref_id,created_at FROM ledger WHERE user_id=$1 ORDER BY id DESC LIMIT 30', [id]),
    query(`SELECT d.id,d.amount,d.tx_ref,d.status,d.created_at,p.name AS provider FROM deposits d JOIN providers p ON p.id=d.provider_id WHERE d.user_id=$1 ORDER BY d.id DESC LIMIT 20`, [id]),
    query(`SELECT w.id,w.amount,w.account_number,w.status,w.created_at,p.name AS provider FROM withdrawals w JOIN providers p ON p.id=w.provider_id WHERE w.user_id=$1 ORDER BY w.id DESC LIMIT 20`, [id]),
    query(`SELECT game,COUNT(*)::bigint AS rounds,COALESCE(SUM(bet),0)::bigint AS stakes,COALESCE(SUM(payout),0)::bigint AS payouts,COALESCE(SUM(bet-payout),0)::bigint AS ngr FROM game_rounds WHERE user_id=$1 AND status='done' GROUP BY game ORDER BY stakes DESC`, [id]),
    query('SELECT id,subject,status,created_at,updated_at FROM support_tickets WHERE user_id=$1 ORDER BY id DESC LIMIT 10', [id]),
  ]);
  return {
    user: {
      ...user,
      balance: Number(user.balance), promo_balance: Number(user.promo_balance),
      referral_bonus: user.referral_bonus == null ? null : Number(user.referral_bonus),
      deposit_total: Number(user.deposit_total), ngr: Number(user.ngr),
      online: isOnline(user.last_seen_at)
    },
    ledger: ledger.rows.map((row) => ({ ...row, amount: Number(row.amount), balance_after: Number(row.balance_after) })),
    deposits: deposits.rows.map((row) => ({ ...row, amount: Number(row.amount) })),
    withdrawals: withdrawals.rows.map((row) => ({ ...row, amount: Number(row.amount) })),
    games: games.rows.map((row) => ({ ...row, rounds: Number(row.rounds), stakes: Number(row.stakes), payouts: Number(row.payouts), ngr: Number(row.ngr) })),
    tickets: tickets.rows
  };
}));

app.patch('/api/superadmin/users/:id', auth, need('money.decide'), wrap(async (req) => {
  const id = Number(req.params.id);
  const status = req.body.status;
  if (!Number.isSafeInteger(id) || id <= 0 || id === req.user.id || !['active', 'suspended'].includes(status)) throw new Error('INVALID');
  await requireRecentPassword(req, req.body.reauth_password);
  return withTx(async (client) => {
    const old = await client.query('SELECT id,role,status FROM users WHERE id=$1 FOR UPDATE', [id]);
    if (!old.rows[0]) throw new Error('NOT_FOUND');
    if (!['user', 'agent'].includes(old.rows[0].role)) throw new Error('FORBIDDEN');
    await client.query('UPDATE users SET status=$1 WHERE id=$2', [status, id]);
    await auditSensitive(req, client, 'user.status', 'user', id, { status: old.rows[0].status }, { status });
    if (status === 'suspended') {
      await insertNotifications(client, [id], {
        type: 'account_suspended', title: 'Account suspended',
        message: 'Your account has been suspended. Contact support for assistance.', link: 'support'
      });
    }
    return { ok: true, status };
  });
}));

app.get('/api/superadmin/reports', auth, need('money.decide'), wrap(async (req) => {
  const defaults = workspaceRange('weekly');
  const range = parseDateRange(String(req.query.start || ''), String(req.query.end || ''), defaults);
  const params = [range.start, range.end];
  const [summary, dailyTrend, games, agents, commission] = await Promise.all([
    query(
      `SELECT
         (SELECT COUNT(*) FROM users WHERE role='user' AND created_at >= $1 AND created_at < $2)::bigint AS new_users,
         (SELECT COUNT(DISTINCT l.user_id) FROM ledger l JOIN users u ON u.id=l.user_id WHERE u.role='user' AND l.created_at >= $1 AND l.created_at < $2)::bigint AS active_users,
         (SELECT COUNT(*) FROM deposits WHERE status='approved' AND COALESCE(reviewed_at,created_at) >= $1 AND COALESCE(reviewed_at,created_at) < $2)::bigint AS deposit_count,
         (SELECT COALESCE(SUM(amount),0) FROM deposits WHERE status='approved' AND COALESCE(reviewed_at,created_at) >= $1 AND COALESCE(reviewed_at,created_at) < $2)::bigint AS deposit_total,
         (SELECT COUNT(*) FROM withdrawals WHERE status IN ('approved','paid') AND COALESCE(reviewed_at,created_at) >= $1 AND COALESCE(reviewed_at,created_at) < $2)::bigint AS withdrawal_count,
         (SELECT COALESCE(SUM(amount),0) FROM withdrawals WHERE status IN ('approved','paid') AND COALESCE(reviewed_at,created_at) >= $1 AND COALESCE(reviewed_at,created_at) < $2)::bigint AS withdrawal_total,
         (SELECT COUNT(*) FROM agent_weekly_settlements WHERE week_start >= $1 AND week_start < $2)::bigint AS settlement_count,
         (SELECT COALESCE(SUM(commission_santim),0) FROM agent_weekly_settlements WHERE week_start >= $1 AND week_start < $2)::bigint AS commission_accrued,
         (SELECT COALESCE(SUM(p.amount_santim),0) FROM agent_settlement_payments p WHERE p.payment_type='commission' AND p.paid_at >= $1 AND p.paid_at < $2)::bigint AS commission_paid`,
      params
    ),
    query(
      `WITH settled AS (${SETTLED_ROUND_SOURCE}),
       ngr AS (
         SELECT to_char((r.settled_at + INTERVAL '3 hours')::date,'YYYY-MM-DD') AS bucket,
                COALESCE(SUM(r.bet-r.payout),0)::bigint AS ngr
         FROM settled r WHERE r.settled_at >= $1 AND r.settled_at < $2 GROUP BY 1
       ),
       dep AS (
         SELECT to_char((COALESCE(d.reviewed_at,d.created_at) + INTERVAL '3 hours')::date,'YYYY-MM-DD') AS bucket,
                COALESCE(SUM(d.amount),0)::bigint AS total
         FROM deposits d WHERE d.status='approved' AND COALESCE(d.reviewed_at,d.created_at) >= $1 AND COALESCE(d.reviewed_at,d.created_at) < $2 GROUP BY 1
       ),
       wd AS (
         SELECT to_char((COALESCE(w.reviewed_at,w.created_at) + INTERVAL '3 hours')::date,'YYYY-MM-DD') AS bucket,
                COALESCE(SUM(w.amount),0)::bigint AS total
         FROM withdrawals w WHERE w.status IN ('approved','paid') AND COALESCE(w.reviewed_at,w.created_at) >= $1 AND COALESCE(w.reviewed_at,w.created_at) < $2 GROUP BY 1
       )
       SELECT COALESCE(n.bucket,d.bucket,w.bucket) AS bucket,COALESCE(n.ngr,0)::bigint AS ngr,
              COALESCE(d.total,0)::bigint AS deposits,COALESCE(w.total,0)::bigint AS withdrawals
       FROM ngr n FULL OUTER JOIN dep d ON d.bucket=n.bucket FULL OUTER JOIN wd w ON w.bucket=COALESCE(n.bucket,d.bucket)
       ORDER BY 1`,
      params
    ),
    query(
      `WITH settled AS (${SETTLED_ROUND_SOURCE})
       SELECT r.game,COUNT(*)::bigint AS rounds,COALESCE(SUM(r.bet),0)::bigint AS stakes,
              COALESCE(SUM(r.payout),0)::bigint AS payouts,COALESCE(SUM(r.bet-r.payout),0)::bigint AS ngr
       FROM settled r WHERE r.settled_at >= $1 AND r.settled_at < $2
       GROUP BY r.game ORDER BY stakes DESC`, params
    ),
    query(
      `WITH settled AS (${SETTLED_ROUND_SOURCE}),
       ngr AS (
         SELECT u.referred_by_agent_id AS agent_id,COALESCE(SUM(r.bet-r.payout),0)::bigint AS ngr
         FROM settled r JOIN users u ON u.id=r.user_id
         WHERE u.referred_by_agent_id IS NOT NULL AND r.settled_at >= $1 AND r.settled_at < $2 GROUP BY 1
       ),
       dep AS (
         SELECT u.referred_by_agent_id AS agent_id,COALESCE(SUM(d.amount),0)::bigint AS total
         FROM deposits d JOIN users u ON u.id=d.user_id
         WHERE d.status='approved' AND COALESCE(d.reviewed_at,d.created_at) >= $1 AND COALESCE(d.reviewed_at,d.created_at) < $2
         GROUP BY 1
       )
       SELECT u.id,u.name,u.phone,p.promo_code,p.commission_bps,COALESCE(n.ngr,0)::bigint AS ngr,
              COALESCE(d.total,0)::bigint AS deposits,
              COALESCE((SELECT COUNT(*) FROM users ru WHERE ru.referred_by_agent_id=u.id),0)::bigint AS users
       FROM users u JOIN agent_profiles p ON p.agent_id=u.id
       LEFT JOIN ngr n ON n.agent_id=u.id LEFT JOIN dep d ON d.agent_id=u.id
       WHERE u.role='agent' ORDER BY ngr DESC,u.id`, params
    ),
    query(
      `SELECT COALESCE(SUM(commission_santim),0)::bigint AS accrued,
              COALESCE(SUM(weekly_fee_santim),0)::bigint AS fees
       FROM agent_weekly_settlements WHERE week_start >= $1 AND week_start < $2`, params
    ),
  ]);
  const s = summary.rows[0];
  const trendMap = new Map(dailyTrend.rows.map((row) => [row.bucket, row]));
  const daily = [];
  const days = Math.min(366, Math.ceil((range.end - range.start) / DAY_MS));
  for (let i = 0; i < days; i += 1) {
    const label = eatDateLabel(new Date(range.start.getTime() + i * DAY_MS));
    const row = trendMap.get(label);
    daily.push({ date: label, ngr: Number(row?.ngr || 0), deposits: Number(row?.deposits || 0), withdrawals: Number(row?.withdrawals || 0) });
  }
  return {
    range: { start: range.startDate, end: range.endDate, time_zone: WEEK_TIME_ZONE },
    summary: {
      new_users: Number(s.new_users), active_users: Number(s.active_users),
      deposit_count: Number(s.deposit_count), deposit_total: Number(s.deposit_total),
      withdrawal_count: Number(s.withdrawal_count), withdrawal_total: Number(s.withdrawal_total),
      settlement_count: Number(s.settlement_count), commission_accrued: Number(s.commission_accrued),
      commission_paid: Number(s.commission_paid)
    },
    daily,
    games: games.rows.map((row) => ({ ...row, rounds: Number(row.rounds), stakes: Number(row.stakes), payouts: Number(row.payouts), ngr: Number(row.ngr) })),
    agents: agents.rows.map((row) => ({ ...row, commission_bps: Number(row.commission_bps), ngr: Number(row.ngr), deposits: Number(row.deposits), users: Number(row.users), commission: roundBps(Number(row.ngr), Number(row.commission_bps)) })),
    commission: { accrued: Number(commission.rows[0]?.accrued || 0), fees: Number(commission.rows[0]?.fees || 0) }
  };
}));

app.get('/api/superadmin/settings', auth, need('money.decide'), wrap(async () => {
  const rows = await query('SELECT key,value,updated_at FROM system_settings');
  const values = Object.fromEntries(rows.rows.map((row) => [row.key, row.value]));
  const currentWeek = workspaceRange('weekly');
  const settled = await query(
    `WITH settled AS (${SETTLED_ROUND_SOURCE})
     SELECT COALESCE(SUM(r.bet-r.payout),0)::bigint AS ngr FROM settled r
     WHERE r.settled_at >= $1 AND r.settled_at < $2`, [currentWeek.start, currentWeek.end]
  );
  return {
    settings: {
      platform_name: values.platform_name || 'Fetan Bet',
      support_email: values.support_email || '',
      support_phone: values.support_phone || '',
      support_hours: values.support_hours || '24/7',
      announcement: values.announcement || '',
      ai_support_enabled: values.ai_support_enabled !== '0',
      commission_bps: DEFAULT_COMMISSION_BPS,
      welcome_credits_santim: 100000,
      promo_credits_santim: 200000,
      time_zone: WEEK_TIME_ZONE,
      min_bet_santim: games.MIN_BET,
      max_bet_santim: games.MAX_BET,
    },
    platform: {
      week_start: currentWeek.start.toISOString(),
      week_ngr: Number(settled.rows[0]?.ngr || 0),
      agents: Number((await query("SELECT COUNT(*)::bigint AS c FROM users WHERE role='agent' AND status='active'")).rows[0].c),
      users: Number((await query("SELECT COUNT(*)::bigint AS c FROM users WHERE role='user'")).rows[0].c),
    }
  };
}));

app.patch('/api/superadmin/settings', auth, need('money.decide'), wrap(async (req) => {
  await requireRecentPassword(req, req.body.reauth_password);
  const updates = {};
  if (req.body.platform_name != null) {
    const name = String(req.body.platform_name).trim().slice(0, 80);
    if (name.length < 2) throw new Error('INVALID');
    updates.platform_name = name;
  }
  if (req.body.support_email != null) updates.support_email = normalizeEmail(req.body.support_email) || '';
  if (req.body.support_phone != null) updates.support_phone = String(req.body.support_phone).trim().slice(0, 40);
  if (req.body.support_hours != null) updates.support_hours = String(req.body.support_hours).trim().slice(0, 80);
  if (req.body.announcement != null) updates.announcement = String(req.body.announcement).trim().slice(0, 500);
  if (req.body.ai_support_enabled != null) updates.ai_support_enabled = req.body.ai_support_enabled ? '1' : '0';
  if (!Object.keys(updates).length) throw new Error('INVALID');
  return withTx(async (client) => {
    const before = await client.query('SELECT key,value FROM system_settings WHERE key = ANY($1)', [Object.keys(updates)]);
    for (const [key, value] of Object.entries(updates)) {
      await client.query(
        `INSERT INTO system_settings(key,value,updated_at) VALUES($1,$2,NOW())
         ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`, [key, value]
      );
    }
    await auditSensitive(req, client, 'settings.update', 'system_setting', 0,
      Object.fromEntries(before.rows.map((row) => [row.key, row.value])), updates);
    return { ok: true, settings: updates };
  });
}));

app.get('/api/superadmin/commissions', auth, need('money.decide'), wrap(async (req) => {
  const requestedStart = String(req.query.week_start || '').trim();
  let weekFilter = null;
  if (requestedStart) {
    try { weekFilter = completedWeekBounds(requestedStart).start; } catch { throw new Error('INVALID'); }
  }
  const params = [];
  let where = '';
  if (weekFilter) { params.push(weekFilter); where = 'WHERE s.week_start=$1'; }
  const rows = await query(
    `SELECT s.*,u.name AS agent_name,u.phone AS agent_phone,p.promo_code,
            COALESCE(SUM(pay.amount_santim) FILTER (WHERE pay.payment_type='commission'),0)::bigint AS commission_paid,
            COALESCE(SUM(pay.amount_santim) FILTER (WHERE pay.payment_type='weekly_fee'),0)::bigint AS fee_paid,
            MAX(pay.paid_at) AS paid_at,
            (SELECT q.id FROM agent_payout_requests q WHERE q.agent_id=s.agent_id AND q.payout_type='commission'
              AND q.period_start=s.week_start AND q.period_end=s.week_end ORDER BY q.id DESC LIMIT 1) AS request_id,
            (SELECT q.status FROM agent_payout_requests q WHERE q.agent_id=s.agent_id AND q.payout_type='commission'
              AND q.period_start=s.week_start AND q.period_end=s.week_end ORDER BY q.id DESC LIMIT 1) AS request_status
     FROM agent_weekly_settlements s JOIN users u ON u.id=s.agent_id JOIN agent_profiles p ON p.agent_id=u.id
     LEFT JOIN agent_settlement_payments pay ON pay.settlement_id=s.id
     ${where} GROUP BY s.id,u.id,p.agent_id ORDER BY s.week_start DESC,s.agent_id DESC LIMIT 200`,
    params
  );
  const current = workspaceRange('weekly');
  const estimated = await query(
    `WITH settled AS (${SETTLED_ROUND_SOURCE}),
     ngr AS (
       SELECT u.referred_by_agent_id AS agent_id,COALESCE(SUM(r.bet-r.payout),0)::bigint AS ngr
       FROM settled r JOIN users u ON u.id=r.user_id
       WHERE u.referred_by_agent_id IS NOT NULL AND r.settled_at >= $1 AND r.settled_at < $2 GROUP BY 1
     )
     SELECT u.id AS agent_id,u.name AS agent_name,p.promo_code,p.commission_bps,COALESCE(n.ngr,0)::bigint AS ngr
     FROM users u JOIN agent_profiles p ON p.agent_id=u.id LEFT JOIN ngr n ON n.agent_id=u.id
     WHERE u.role='agent' ORDER BY ngr DESC,u.id`,
    [current.start, current.end]
  );
  const settlements = rows.rows.map((row) => {
    const commission = Number(row.commission_santim);
    const paid = Number(row.commission_paid);
    let stage = 'accrued';
    if (commission === 0 || paid >= commission) stage = 'paid';
    else if (row.request_status === 'approved') stage = 'approved';
    else if (row.request_status === 'pending') stage = 'accrued';
    return {
      ...row,
      profit_santim: Number(row.profit_santim),
      carried_loss_in_santim: Number(row.carried_loss_in_santim),
      carried_loss_out_santim: Number(row.carried_loss_out_santim),
      commission_bps: Number(row.commission_bps),
      commission_santim: commission,
      weekly_fee_santim: Number(row.weekly_fee_santim),
      commission_paid: paid,
      fee_paid: Number(row.fee_paid),
      stage
    };
  });
  return {
    time_zone: WEEK_TIME_ZONE,
    week_start: current.start.toISOString(),
    week_end: current.end.toISOString(),
    settlements,
    estimated: estimated.rows.map((row) => {
      const ngr = Number(row.ngr);
      const bps = Number(row.commission_bps);
      return {
        agent_id: Number(row.agent_id), agent_name: row.agent_name, promo_code: row.promo_code,
        commission_bps: bps, ngr, commission_santim: roundBps(ngr, bps), stage: 'estimated'
      };
    })
  };
}));

app.post('/api/superadmin/commissions/:id/approve', auth, need('money.decide'), wrap(async (req) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('INVALID');
  await requireRecentPassword(req, req.body.reauth_password);
  return withTx(async (client) => {
    const sRes = await client.query('SELECT * FROM agent_weekly_settlements WHERE id=$1 FOR UPDATE', [id]);
    const settlement = sRes.rows[0];
    if (!settlement) throw new Error('NOT_FOUND');
    const amount = Number(settlement.commission_santim);
    if (!amount) throw new Error('INVALID');
    const paid = await client.query("SELECT id FROM agent_settlement_payments WHERE settlement_id=$1 AND payment_type='commission'", [id]);
    if (paid.rows[0]) return { ok: true, stage: 'paid', already_paid: true };
    const existing = await client.query(
      `SELECT id,status FROM agent_payout_requests
       WHERE agent_id=$1 AND payout_type='commission' AND period_start=$2 AND period_end=$3
       ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [settlement.agent_id, settlement.week_start, settlement.week_end]
    );
    let requestId;
    if (existing.rows[0]) {
      if (existing.rows[0].status === 'rejected') throw new Error('INVALID');
      requestId = Number(existing.rows[0].id);
      await client.query(
        "UPDATE agent_payout_requests SET status='approved',approved_by=$1,approved_at=NOW() WHERE id=$2",
        [req.user.id, requestId]
      );
    } else {
      const inserted = await client.query(
        `INSERT INTO agent_payout_requests(agent_id,payout_type,period_start,period_end,amount_santim,status,approved_by,approved_at,note)
         VALUES($1,'commission',$2,$3,$4,'approved',$5,NOW(),'Approved from commission review') RETURNING id`,
        [settlement.agent_id, settlement.week_start, settlement.week_end, amount, req.user.id]
      );
      requestId = Number(inserted.rows[0].id);
    }
    await insertNotifications(client, [Number(settlement.agent_id)], {
      type: 'commission_approved',
      title: 'Commission approved',
      message: `Your commission of ${(amount / 100).toFixed(2)} ETB for the week starting ${String(settlement.week_start).slice(0, 10)} was approved.`,
      link: 'earnings'
    });
    await auditSensitive(req, client, 'commission.approve', 'agent_weekly_settlement', id,
      { stage: 'accrued' }, { stage: 'approved', amount_santim: amount, payout_request_id: requestId });
    return { ok: true, stage: 'approved', request_id: requestId, amount_santim: amount };
  });
}));

app.post('/api/superadmin/commissions/:id/pay', auth, need('money.decide'), wrap(async (req) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('INVALID');
  await requireRecentPassword(req, req.body.reauth_password);
  return withTx(async (client) => {
    const sRes = await client.query('SELECT * FROM agent_weekly_settlements WHERE id=$1 FOR UPDATE', [id]);
    const settlement = sRes.rows[0];
    if (!settlement) throw new Error('NOT_FOUND');
    const amount = Number(settlement.commission_santim);
    if (!amount) throw new Error('INVALID');
    const paid = await client.query("SELECT id FROM agent_settlement_payments WHERE settlement_id=$1 AND payment_type='commission'", [id]);
    if (paid.rows[0]) return { ok: true, stage: 'paid', already_paid: true };
    const request = await client.query(
      `SELECT * FROM agent_payout_requests
       WHERE agent_id=$1 AND payout_type='commission' AND period_start=$2 AND period_end=$3
       ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [settlement.agent_id, settlement.week_start, settlement.week_end]
    );
    if (!request.rows[0] || request.rows[0].status !== 'approved') throw new Error('INVALID');
    await postLedger({
      client, userId: Number(settlement.agent_id), delta: amount,
      type: 'agent_commission', refType: 'agent_settlement', refId: id, by: req.user.id
    });
    const ledger = await client.query(
      "SELECT id FROM ledger WHERE type='agent_commission' AND ref_type='agent_settlement' AND ref_id=$1", [id]
    );
    await client.query(
      `INSERT INTO agent_settlement_payments(settlement_id,agent_id,payment_type,amount_santim,paid_by,ledger_id)
       VALUES($1,$2,'commission',$3,$4,$5)`,
      [id, settlement.agent_id, amount, req.user.id, ledger.rows[0]?.id || null]
    );
    await client.query(
      "UPDATE agent_payout_requests SET status='paid',decided_by=$1,decided_at=NOW(),paid_at=NOW() WHERE id=$2",
      [req.user.id, request.rows[0].id]
    );
    await insertNotifications(client, [Number(settlement.agent_id)], {
      type: 'commission_paid',
      title: 'Commission paid',
      message: `Your commission of ${(amount / 100).toFixed(2)} ETB for the week starting ${String(settlement.week_start).slice(0, 10)} has been paid to your wallet.`,
      link: 'earnings'
    });
    await auditSensitive(req, client, 'commission.pay', 'agent_weekly_settlement', id,
      { stage: 'approved' }, { stage: 'paid', amount_santim: amount, payout_request_id: Number(request.rows[0].id) });
    return { ok: true, stage: 'paid', amount_santim: amount };
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
    `SELECT u.id,u.name,u.phone,u.email,u.username,u.status,u.created_at,u.last_seen_at,
      p.promo_code,p.contact_info,p.weekly_fee_santim,p.commission_bps,
      COUNT(r.id)::bigint AS referred_users,
      COUNT(r.id) FILTER (WHERE r.created_at >= NOW()-INTERVAL '24 hours')::bigint AS new_users_24h,
      COUNT(r.id) FILTER (WHERE r.created_at >= $4)::bigint AS new_users_week
     FROM users u JOIN agent_profiles p ON p.agent_id=u.id LEFT JOIN users r ON r.referred_by_agent_id=u.id
     WHERE u.role='agent' AND ($1='' OR u.name ILIKE '%'||$1||'%' OR u.phone ILIKE '%'||$1||'%' OR COALESCE(u.email,'') ILIKE '%'||$1||'%' OR p.promo_code ILIKE '%'||$1||'%')
     GROUP BY u.id,p.agent_id ORDER BY u.id DESC LIMIT $2 OFFSET $3`,
    [search, limit, offset, utcWeekBounds().start]
  );
  const total = await query(
    `SELECT COUNT(*)::bigint AS c FROM users u JOIN agent_profiles p ON p.agent_id=u.id
     WHERE u.role='agent' AND ($1='' OR u.name ILIKE '%'||$1||'%' OR u.phone ILIKE '%'||$1||'%' OR COALESCE(u.email,'') ILIKE '%'||$1||'%' OR p.promo_code ILIKE '%'||$1||'%')`,
    [search]
  );
  return {
    agents: rows.rows.map((r) => ({
      ...Object.fromEntries(Object.entries(r).map(([k, v]) => ['weekly_fee_santim', 'commission_bps', 'referred_users', 'new_users_24h', 'new_users_week'].includes(k) ? [k, Number(v)] : [k, v])),
      referral_url: referralUrl(req, r.promo_code),
      online: isOnline(r.last_seen_at)
    })),
    total: Number(total.rows[0]?.c || 0), limit, offset
  };
}));

app.post('/api/superadmin/agents', auth, need('agents.manage'), wrap(async (req) => {
  const name = String(req.body.name || '').trim();
  const phone = normPhone(req.body.phone);
  const password = String(req.body.password || '');
  const code = normalizePromoCode(req.body.promo_code || `FB-${crypto.randomBytes(4).toString('hex').toUpperCase()}`);
  const contact = String(req.body.contact_info || phone).trim().slice(0, 200);
  const fee = Number(req.body.weekly_fee_santim ?? 0);
  const bps = Number(req.body.commission_bps ?? DEFAULT_COMMISSION_BPS);
  const email = normalizeEmail(req.body.email);
  const username = normalizeUsername(req.body.username);
  if (name.length < 2 || name.length > 60 || !validPhone(phone) || password.length < 12 || !validPromoCode(code) || !Number.isSafeInteger(fee) || fee < 0 || !Number.isInteger(bps) || bps < 0 || bps > 10000) throw new Error('INVALID');
  await requireRecentPassword(req, req.body.reauth_password);
  return withTx(async (client) => {
    const id = await createUser({ name, phone, password, role: 'agent', bonus: false, email, username, client });
    await client.query('INSERT INTO agent_profiles(agent_id,promo_code,contact_info,weekly_fee_santim,commission_bps,created_by) VALUES ($1,$2,$3,$4,$5,$6)', [id,code,contact,fee,bps,req.user.id]);
    await insertNotifications(client, [id], {
      type: 'agent_created',
      title: 'Welcome to Fetan Bet',
      message: `Your agent account is ready. Share promo code ${code} to start referring customers.`,
      link: 'dashboard'
    });
    await auditSensitive(req, client, 'agent.create', 'agent', id, null, { name, phone, email, username, promo_code: code, weekly_fee_santim: fee, commission_bps: bps, status: 'active' });
    return { id, promo_code: code, status: 'active', referral_url: referralUrl(req, code) };
  }).catch((error) => { if (error.code === '23505') throw new Error('EXISTS'); throw error; });
}));

app.patch('/api/superadmin/agents/:id', auth, need('agents.manage'), wrap(async (req) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0 || id === req.user.id) throw new Error('INVALID');
  await requireRecentPassword(req, req.body.reauth_password);
  return withTx(async (client) => {
    const oldRes = await client.query(`SELECT u.id,u.name,u.phone,u.email,u.username,u.status,p.promo_code,p.contact_info,p.weekly_fee_santim,p.commission_bps
      FROM users u JOIN agent_profiles p ON p.agent_id=u.id WHERE u.id=$1 AND u.role='agent' FOR UPDATE OF u,p`, [id]);
    const old = oldRes.rows[0];
    if (!old) throw new Error('NOT_FOUND');
    const name = req.body.name == null ? old.name : String(req.body.name).trim();
    const phone = req.body.phone == null ? old.phone : normPhone(req.body.phone);
    const email = req.body.email == null ? old.email : normalizeEmail(req.body.email);
    const username = req.body.username == null ? old.username : normalizeUsername(req.body.username);
    const status = req.body.status == null ? old.status : req.body.status;
    const promo = req.body.promo_code == null ? old.promo_code : normalizePromoCode(req.body.promo_code);
    const contact = req.body.contact_info == null ? old.contact_info : String(req.body.contact_info).trim().slice(0,200);
    const fee = req.body.weekly_fee_santim == null ? Number(old.weekly_fee_santim) : Number(req.body.weekly_fee_santim);
    const bps = req.body.commission_bps == null ? Number(old.commission_bps) : Number(req.body.commission_bps);
    if (name.length < 2 || name.length > 60 || !validPhone(phone) || !['active','suspended'].includes(status) || !validPromoCode(promo) || !Number.isSafeInteger(fee) || fee < 0 || !Number.isInteger(bps) || bps < 0 || bps > 10000) throw new Error('INVALID');
    await client.query('UPDATE users SET name=$1,phone=$2,email=$3,username=$4,status=$5 WHERE id=$6', [name,phone,email,username,status,id]);
    await client.query('UPDATE agent_profiles SET promo_code=$1,contact_info=$2,weekly_fee_santim=$3,commission_bps=$4,updated_at=NOW(),migration_backfill=FALSE WHERE agent_id=$5', [promo,contact,fee,bps,id]);
    const after = { name,phone,email,username,status,promo_code:promo,contact_info:contact,weekly_fee_santim:fee,commission_bps:bps };
    if (status !== old.status) {
      await insertNotifications(client, [id], {
        type: status === 'suspended' ? 'account_suspended' : 'account_reactivated',
        title: status === 'suspended' ? 'Agent account suspended' : 'Agent account reactivated',
        message: status === 'suspended'
          ? 'Your agent account has been suspended. Contact Super Admin for assistance.'
          : 'Your agent account has been reactivated.',
        link: 'support'
      });
    }
    await auditSensitive(req,client,'agent.update','agent',id,old,after);
    return {
      ok:true,
      agent: { ...after, referral_url: referralUrl(req, promo) }
    };
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
      // Commission is based only on completed rounds settled in this EAT week.
      // Refunded rounds are excluded by SETTLED_ROUND_SOURCE so stakes are
      // never counted twice and unsettled rounds never leak into a week.
      const profitRes=await client.query(`WITH settled AS (${SETTLED_ROUND_SOURCE})
        SELECT COALESCE(SUM(r.bet-r.payout),0)::bigint AS profit
        FROM settled r JOIN users u ON u.id=r.user_id
        WHERE u.referred_by_agent_id=$1 AND r.settled_at >= $2 AND r.settled_at < $3`,[a.id,weekStart,weekEnd]);
      const profit=Number(profitRes.rows[0].profit);
      const result=commissionForWeek(profit,carry,Number(a.commission_bps));
      const ins=await client.query(`INSERT INTO agent_weekly_settlements(agent_id,week_start,week_end,profit_santim,carried_loss_in_santim,carried_loss_out_santim,commission_bps,commission_santim,weekly_fee_santim,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(agent_id,week_start,week_end) DO NOTHING RETURNING id`,
        [a.id,weekStart,weekEnd,profit,carry,result.carriedLossSantim,Number(a.commission_bps),result.commissionSantim,Number(a.weekly_fee_santim),req.user.id]);
      if (ins.rows[0]) {
        const id=Number(ins.rows[0].id);
        if (result.commissionSantim > 0) {
          await insertNotifications(client,[Number(a.id)],{
            type:'commission_accrued',
            title:'Weekly commission accrued',
            message:`Your commission of ${(result.commissionSantim/100).toFixed(2)} ETB for the week starting ${weekStart.slice(0,10)} is ready for review.`,
            link:'earnings'
          });
        }
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
    await insertNotifications(client,[Number(settlement.agent_id)],{
      type:type==='weekly_fee'?'weekly_fee_paid':'commission_paid',
      title:type==='weekly_fee'?'Weekly fee paid':'Commission paid',
      message:`${type==='weekly_fee'?'Your weekly fee':'Your commission'} of ${(amount/100).toFixed(2)} ETB has been credited to your wallet.`,
      link:'earnings'
    });
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
      await insertNotifications(client,[Number(item.agent_id)],{
        type:item.payout_type==='weekly_fee'?'weekly_fee_paid':'commission_paid',
        title:item.payout_type==='weekly_fee'?'Weekly fee paid':'Commission paid',
        message:`Your ${item.payout_type==='weekly_fee'?'weekly fee':'commission'} of ${(Number(item.amount_santim)/100).toFixed(2)} ETB has been credited to your wallet.`,
        link:'earnings'
      });
      await auditSensitive(req,client,'agent.payout.approve','agent_payout_request',id,{status:'pending'},{status:next,amount_santim:Number(item.amount_santim),agent_id:Number(item.agent_id),already_paid:alreadyPaid},reason||null);
      return {ok:true,status:next,already_paid:alreadyPaid};
    }
    await client.query('UPDATE agent_payout_requests SET status=$1,decided_by=$2,decision_reason=$3,decided_at=NOW(),paid_at=CASE WHEN $1=\'paid\' THEN NOW() ELSE NULL END WHERE id=$4',[next,req.user.id,reason||null,id]);
    await insertNotifications(client,[Number(item.agent_id)],{
      type:'payout_rejected',
      title:'Payout request rejected',
      message:`Your ${item.payout_type==='weekly_fee'?'weekly fee':'commission'} request was rejected.${reason?` Reason: ${reason}`:''}`,
      link:'earnings'
    });
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
