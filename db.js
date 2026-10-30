// Database + wallet ledger for Neon PostgreSQL.
// All money is stored as INTEGER minor units (1 credit = 100 santim).
require('dotenv').config();
const { Pool, types } = require('pg');
const bcrypt = require('bcryptjs');
const { sanitizeConnectionString } = require('./scripts/run-migrations');
const { assertSeparateTestDatabase } = require('./scripts/test-db-safety');

// Parse BIGINT (int8) as JavaScript numbers for smooth arithmetic and strict === comparison
types.setTypeParser(types.builtins.INT8, (val) => (val === null ? null : parseInt(val, 10)));

const integrationTestMode = process.env.FETAN_INTEGRATION_TEST === '1';
if (integrationTestMode && process.env.FETAN_TEST_DB_PREFLIGHT !== 'passed') {
  throw new Error('Integration database must pass the isolated launcher preflight before pool initialization.');
}
const connString = integrationTestMode
  ? (() => {
      assertSeparateTestDatabase(process.env);
      return sanitizeConnectionString(process.env.TEST_DATABASE_URL);
    })()
  : sanitizeConnectionString(process.env.DATABASE_URL || process.env.TEST_DATABASE_URL || '');

if (!connString) {
  console.warn('[db.js] Warning: no database connection is configured. Database operations will fail until configured.');
}

// Configured for Neon serverless: small pool, idle timeouts, keepalives
const pool = new Pool({
  connectionString: connString,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 25000,
});

pool.on('error', (err) => {
  console.warn('[pg-pool] Background idle client error handled:', err.message);
});

// Prevent background socket drops (ECONNRESET) during Neon scale-to-zero from terminating the Node process
process.on('uncaughtException', (err) => {
  if (err?.code === 'ECONNRESET' || String(err?.message).includes('Connection terminated')) {
    console.warn('[process] Handled background DB connection drop:', err.message);
    return;
  }
  console.error('[process] Fatal uncaught exception:', err);
  process.exit(1);
});

// Scale-to-zero retry helper for cold starts
async function query(text, params = [], retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await pool.query(text, params);
    } catch (err) {
      const msg = String(err?.message || '');
      const isTransient =
        err?.code === '57P01' || // admin_shutdown (Neon scale-to-zero wake)
        err?.code === 'ECONNRESET' ||
        err?.code === 'ETIMEDOUT' ||
        err?.code === 'EPIPE' ||
        msg.includes('Connection terminated') ||
        msg.includes('timeout') ||
        msg.includes('connection timeout');

      if (isTransient && attempt < retries) {
        const delay = (attempt + 1) * 800;
        console.warn(`[db] Transient error (${err.message}). Retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

// Transaction helper with BEGIN/COMMIT/ROLLBACK and guaranteed release
async function withTx(fn) {
  const client = await pool.connect();
  const onError = (err) => {
    console.warn('[pg-client] Handled active client error:', err.message);
  };
  client.on('error', onError);
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.removeListener('error', onError);
    client.release();
  }
}

// Audit logging
async function audit(actorId, action, detail = null, client = null) {
  const executor = client ? (t, p) => client.query(t, p) : query;
  try {
    await executor(
      'INSERT INTO audit_logs (actor_id, action, detail) VALUES ($1, $2, $3)',
      [actorId || null, action, detail ? JSON.stringify(detail) : null]
    );
  } catch (err) {
    console.error('[audit] Failed to write audit log:', err.message);
  }
}

// The ONLY way to change a balance. Locks wallet row (SELECT ... FOR UPDATE) and updates ledger.
async function postLedger({ userId, delta, type, refType = null, refId = null, by = null, client = null }) {
  const execute = async (c) => {
    // Row-level lock to prevent race conditions & double spends
    const wRes = await c.query('SELECT balance FROM wallets WHERE user_id = $1 FOR UPDATE', [userId]);
    if (wRes.rows.length === 0) throw new Error('NOT_FOUND');

    const currentBalance = Number(wRes.rows[0].balance);
    const nb = currentBalance + delta;
    if (nb < 0) throw new Error('INSUFFICIENT');

    await c.query('UPDATE wallets SET balance = $1 WHERE user_id = $2', [nb, userId]);
    await c.query(
      `INSERT INTO ledger (user_id, type, amount, balance_after, ref_type, ref_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, type, delta, nb, refType, refId, by]
    );
    return nb;
  };

  if (client) {
    return execute(client);
  }
  return withTx(execute);
}

// Create a new user with wallet and optional welcome bonus
async function createUser({ name, phone, password, role = 'user', lang = 'am', bonus = true, referredByAgentId = null, email = null, username = null, client = null }) {
  const execute = async (c) => {
    const hash = bcrypt.hashSync(password, 10);
    const r = await c.query(
      `INSERT INTO users (name, phone, password_hash, role, lang, referred_by_agent_id, email, username)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [name, phone, hash, role, lang, referredByAgentId, email, username]
    );
    const id = Number(r.rows[0].id);
    await c.query('INSERT INTO wallets (user_id, balance) VALUES ($1, 0) ON CONFLICT (user_id) DO NOTHING', [id]);
    if (bonus) {
      await postLedger({ client: c, userId: id, delta: 100000, type: 'demo_bonus', refType: 'signup', refId: id });
    }
    return id;
  };

  if (client) {
    return execute(client);
  }
  return withTx(execute);
}

// Seed system defaults if tables are empty
async function seed() {
  try {
    const provCount = await query('SELECT COUNT(*) c FROM providers');
    if (parseInt(provCount.rows[0].c, 10) === 0) {
      const providers = [
        ['telebirr', 'Telebirr'], ['cbe', 'Commercial Bank of Ethiopia'], ['boa', 'Bank of Abyssinia'],
        ['dashen', 'Dashen Bank'], ['awash', 'Awash Bank'], ['mpesa', 'M-PESA Ethiopia']
      ];
      const en = 'DEMO ONLY: no real money. Pretend you sent the amount to demo account 0000-DEMO, then type any reference code (for example DEMO123).';
      const am = 'ለሙከራ ብቻ፡ እውነተኛ ገንዘብ አይደለም። መጠኑን ወደ ሙከራ አካውንት 0000-DEMO እንደላኩ አስመስለው፣ ከዚያ ማንኛውንም የማመሳከሪያ ቁጥር (ለምሳሌ DEMO123) ያስገቡ።';
      for (const [code, name] of providers) {
        await query(
          'INSERT INTO providers (code, name, mode, instr_en, instr_am) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (code) DO NOTHING',
          [code, name, 'manual', en, am]
        );
      }
    }

    const sysCount = await query("SELECT COUNT(*) c FROM system_settings WHERE key='ai_support_enabled'");
    if (parseInt(sysCount.rows[0].c, 10) === 0) {
      await query("INSERT INTO system_settings (key, value) VALUES ('ai_support_enabled', '1') ON CONFLICT (key) DO NOTHING");
    }

    const annCount = await query('SELECT COUNT(*) c FROM announcements');
    if (parseInt(annCount.rows[0].c, 10) === 0) {
      const admin = await query("SELECT id FROM users WHERE role IN ('admin','superadmin') ORDER BY CASE role WHEN 'superadmin' THEN 0 ELSE 1 END LIMIT 1");
      if (admin.rows.length > 0) {
        await query(
          `INSERT INTO announcements (author_id, target_role, title, content)
           VALUES ($1, 'agent', 'Welcome to Fetan Bet Operations', 'Welcome to the Fetan Bet referral portal. Share your referral code, support your referred users, and review your activity and compensation.')`,
          [admin.rows[0].id]
        );
      }
    }
  } catch (err) {
    console.error('[seed] Warning during seed:', err.message);
  }
}

module.exports = {
  pool,
  query,
  withTx,
  postLedger,
  createUser,
  audit,
  seed
};
