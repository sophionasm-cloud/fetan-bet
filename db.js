// Database + wallet ledger. All money is stored as INTEGER minor units (1 credit = 100).
// Uses the SQLite that is built into Node.js 22 (no native packages, nothing to compile).
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');

const raw = new DatabaseSync(process.env.DB_PATH || 'data.db');
raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

// Small transaction helper (supports nesting through savepoints).
let depth = 0;
function transaction(fn) {
  return (...args) => {
    const sp = 'sp' + depth;
    raw.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
    depth++;
    try {
      const result = fn(...args);
      depth--;
      raw.exec(depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
      return result;
    } catch (e) {
      depth--;
      raw.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
      throw e;
    }
  };
}
const db = { prepare: (sql) => raw.prepare(sql), exec: (sql) => raw.exec(sql), transaction };

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','agent','admin')),
  lang TEXT NOT NULL DEFAULT 'am',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS wallets (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0)
);
-- Ledger: every balance change is a row. Balance can always be rebuilt from this table.
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  ref_type TEXT,
  ref_id INTEGER,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger(user_id, id);
-- Idempotency: the same business event can never be credited twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_ref ON ledger(type, ref_type, ref_id) WHERE ref_type IS NOT NULL;

CREATE TABLE IF NOT EXISTS providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'manual',
  instr_en TEXT NOT NULL,
  instr_am TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  tx_ref TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by INTEGER REFERENCES users(id),
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT,
  UNIQUE (provider_id, tx_ref)
);
CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  account_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by INTEGER REFERENCES users(id),
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT
);
CREATE TABLE IF NOT EXISTS game_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  game TEXT NOT NULL,
  bet INTEGER NOT NULL,
  payout INTEGER NOT NULL DEFAULT 0,
  step INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'done',
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS support_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  subject TEXT DEFAULT 'Support Request',
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','escalated','resolved')),
  assigned_agent_id INTEGER REFERENCES users(id),
  escalated_reason TEXT,
  ai_handled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS support_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES support_tickets(id),
  sender_id INTEGER REFERENCES users(id),
  sender_role TEXT NOT NULL CHECK (sender_role IN ('user','agent','admin','ai')),
  sender_name TEXT NOT NULL,
  message TEXT NOT NULL,
  is_internal INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id INTEGER NOT NULL REFERENCES users(id),
  target_role TEXT NOT NULL DEFAULT 'agent' CHECK (target_role IN ('agent','user','all')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS agent_funding_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  admin_id INTEGER REFERENCES users(id),
  admin_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT
);
`);

// Safe migrations for existing databases
try { raw.exec('ALTER TABLE support_tickets ADD COLUMN subject TEXT DEFAULT "Support Request";'); } catch {}
try { raw.exec('ALTER TABLE support_tickets ADD COLUMN status TEXT NOT NULL DEFAULT "open";'); } catch {}
try { raw.exec('ALTER TABLE support_tickets ADD COLUMN assigned_agent_id INTEGER REFERENCES users(id);'); } catch {}
try { raw.exec('ALTER TABLE support_tickets ADD COLUMN escalated_reason TEXT;'); } catch {}
try { raw.exec('ALTER TABLE support_tickets ADD COLUMN ai_handled INTEGER NOT NULL DEFAULT 0;'); } catch {}
try { raw.exec('ALTER TABLE support_tickets ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime("now"));'); } catch {}

function audit(actorId, action, detail) {
  db.prepare('INSERT INTO audit_logs (actor_id, action, detail) VALUES (?,?,?)')
    .run(actorId || null, action, detail ? JSON.stringify(detail) : null);
}

// The ONLY way to change a balance. Runs in a transaction, refuses negative balances.
function postLedger({ userId, delta, type, refType = null, refId = null, by = null }) {
  return db.transaction(() => {
    const w = db.prepare('SELECT balance FROM wallets WHERE user_id = ?').get(userId);
    if (!w) throw new Error('NOT_FOUND');
    const nb = w.balance + delta;
    if (nb < 0) throw new Error('INSUFFICIENT');
    db.prepare('UPDATE wallets SET balance = ? WHERE user_id = ?').run(nb, userId);
    db.prepare(`INSERT INTO ledger (user_id, type, amount, balance_after, ref_type, ref_id, created_by)
                VALUES (?,?,?,?,?,?,?)`).run(userId, type, delta, nb, refType, refId, by);
    return nb;
  })();
}

function createUser({ name, phone, password, role = 'user', lang = 'am', bonus = true }) {
  return db.transaction(() => {
    const hash = bcrypt.hashSync(password, 10);
    const r = db.prepare('INSERT INTO users (name, phone, password_hash, role, lang) VALUES (?,?,?,?,?)')
      .run(name, phone, hash, role, lang);
    const id = Number(r.lastInsertRowid);
    db.prepare('INSERT INTO wallets (user_id, balance) VALUES (?, 0)').run(id);
    if (bonus) postLedger({ userId: id, delta: 100000, type: 'demo_bonus', refType: 'signup', refId: id });
    return id;
  })();
}

function seed() {
  if (db.prepare('SELECT COUNT(*) c FROM providers').get().c === 0) {
    const ins = db.prepare('INSERT INTO providers (code, name, mode, instr_en, instr_am) VALUES (?,?,?,?,?)');
    const en = 'DEMO ONLY: no real money. Pretend you sent the amount to demo account 0000-DEMO, then type any reference code (for example DEMO123).';
    const am = 'ለሙከራ ብቻ፡ እውነተኛ ገንዘብ አይደለም። መጠኑን ወደ ሙከራ አካውንት 0000-DEMO እንደላኩ አስመስለው፣ ከዚያ ማንኛውንም የማመሳከሪያ ቁጥር (ለምሳሌ DEMO123) ያስገቡ።';
    [['telebirr', 'Telebirr'], ['cbe', 'Commercial Bank of Ethiopia'], ['boa', 'Bank of Abyssinia'],
     ['dashen', 'Dashen Bank'], ['awash', 'Awash Bank'], ['mpesa', 'M-PESA Ethiopia']]
      .forEach(([c, n]) => ins.run(c, n, 'manual', en, am));
  }
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c === 0) {
    createUser({ name: 'Super Admin', phone: '0900000000', password: process.env.ADMIN_PASSWORD || 'admin123', role: 'admin', lang: 'en', bonus: true });
    createUser({ name: 'Demo Agent', phone: '0911111111', password: process.env.AGENT_PASSWORD || 'agent123', role: 'agent', lang: 'en', bonus: true });
  } else {
    // Top up admin/agent if balance is 0 for demo testing
    const admin = db.prepare("SELECT id FROM users WHERE role='admin'").get();
    if (admin) {
      const w = db.prepare('SELECT balance FROM wallets WHERE user_id=?').get(admin.id);
      if (w && w.balance === 0) {
        postLedger({ userId: admin.id, delta: 100000, type: 'demo_bonus', refType: 'admin_topup', refId: admin.id });
      }
    }
  }
  // Initialize default system settings
  if (db.prepare("SELECT COUNT(*) c FROM system_settings WHERE key='ai_support_enabled'").get().c === 0) {
    db.prepare("INSERT INTO system_settings (key, value) VALUES ('ai_support_enabled', '1')").run();
  }
  // Initialize default announcement for agents
  if (db.prepare('SELECT COUNT(*) c FROM announcements').get().c === 0) {
    const adminUser = db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get();
    if (adminUser) {
      db.prepare(`INSERT INTO announcements (author_id, target_role, title, content)
        VALUES (?, 'agent', 'Welcome to Fetan Bet Operations', 'Welcome to the Agent Portal. Please verify all customer deposits promptly and check transaction references carefully.')`)
        .run(adminUser.id);
    }
  }
}

module.exports = { db, audit, postLedger, createUser, seed };
