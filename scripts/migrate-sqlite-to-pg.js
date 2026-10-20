// One-time and Re-runnable SQLite (data.db) to Neon PostgreSQL Data Importer
require('dotenv').config();
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { Client } = require('pg');
const { sanitizeConnectionString } = require('./run-migrations');

async function migrateData(options = {}) {
  const sqlitePath = options.sqlitePath || path.join(__dirname, '..', 'data.db');
  const pgUrl = options.targetUrl || process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;

  if (!pgUrl) {
    throw new Error('Target database URL is not provided (DIRECT_DATABASE_URL or DATABASE_URL).');
  }

  console.log(`[1/5] Opening source SQLite database: ${sqlitePath}`);
  const sqlite = new DatabaseSync(sqlitePath);

  console.log('[2/5] Connecting to target PostgreSQL database...');
  const pg = new Client({
    connectionString: sanitizeConnectionString(pgUrl),
    ssl: { rejectUnauthorized: false }
  });
  await pg.connect();

  try {
    console.log('[3/5] Transferring records table by table (preserving IDs and relationships)...');

    await pg.query('BEGIN');

    // Helper to insert with identity override if needed
    async function importTable(tableName, columns, conflictCol = 'id') {
      const rows = sqlite.prepare(`SELECT * FROM ${tableName}`).all();
      console.log(`  Importing ${rows.length} rows into ${tableName}...`);

      if (rows.length === 0) return { imported: 0, total: 0 };

      const colList = columns.join(', ');
      const valPlaceholders = columns.map((_, i) => `$${i + 1}`).join(', ');

      const conflictClause = conflictCol === 'composite_provider_tx'
        ? 'ON CONFLICT (provider_id, tx_ref) DO NOTHING'
        : conflictCol === 'key'
          ? 'ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at'
          : `ON CONFLICT (${conflictCol}) DO NOTHING`;

      const insertSql = `
        INSERT INTO ${tableName} (${colList})
        VALUES (${valPlaceholders})
        ${conflictClause}
      `;

      let imported = 0;
      for (const row of rows) {
        const values = columns.map((c) => {
          let val = row[c];
          if (c === 'updated_at' && (val === undefined || val === null)) {
            val = row.created_at || new Date().toISOString();
          }
          if (val === undefined) val = null;
          return val;
        });
        const res = await pg.query(insertSql, values);
        imported += res.rowCount;
      }
      return { imported, total: rows.length };
    }

    // 1. users
    await importTable('users', ['id', 'name', 'phone', 'password_hash', 'role', 'lang', 'status', 'created_at']);

    // 2. wallets
    await importTable('wallets', ['user_id', 'balance'], 'user_id');

    // 3. providers
    await importTable('providers', ['id', 'code', 'name', 'mode', 'instr_en', 'instr_am', 'active']);

    // 4. deposits
    await importTable('deposits', ['id', 'user_id', 'provider_id', 'amount', 'tx_ref', 'status', 'reviewed_by', 'reason', 'created_at', 'reviewed_at']);

    // 5. withdrawals
    await importTable('withdrawals', ['id', 'user_id', 'provider_id', 'amount', 'account_number', 'status', 'reviewed_by', 'reason', 'created_at', 'reviewed_at']);

    // 6. game_rounds
    await importTable('game_rounds', ['id', 'user_id', 'game', 'bet', 'payout', 'step', 'status', 'detail', 'server_seed', 'client_seed', 'server_seed_hash', 'difficulty', 'created_at']);

    // 7. support_tickets
    await importTable('support_tickets', ['id', 'user_id', 'subject', 'message', 'status', 'assigned_agent_id', 'escalated_reason', 'ai_handled', 'created_at', 'updated_at']);

    // 8. support_messages
    await importTable('support_messages', ['id', 'ticket_id', 'sender_id', 'sender_role', 'sender_name', 'message', 'is_internal', 'created_at']);

    // 9. announcements
    await importTable('announcements', ['id', 'author_id', 'target_role', 'title', 'content', 'created_at']);

    // 10. system_settings
    await importTable('system_settings', ['key', 'value', 'updated_at'], 'key');

    // 11. audit_logs
    await importTable('audit_logs', ['id', 'actor_id', 'action', 'detail', 'created_at']);

    // 12. agent_funding_requests
    await importTable('agent_funding_requests', ['id', 'agent_id', 'amount', 'note', 'status', 'admin_id', 'admin_note', 'created_at', 'decided_at']);

    // 13. ledger
    await importTable('ledger', ['id', 'user_id', 'type', 'amount', 'balance_after', 'ref_type', 'ref_id', 'created_by', 'created_at']);

    // Reset sequences to MAX(id)
    const tablesWithSerial = [
      'users', 'providers', 'deposits', 'withdrawals', 'game_rounds',
      'support_tickets', 'support_messages', 'announcements',
      'audit_logs', 'agent_funding_requests', 'ledger'
    ];

    console.log('[4/5] Resetting PostgreSQL sequences after importing explicit IDs...');
    for (const tbl of tablesWithSerial) {
      await pg.query(`
        SELECT setval(
          pg_get_serial_sequence('${tbl}', 'id'),
          COALESCE((SELECT MAX(id) FROM ${tbl}), 1),
          (SELECT COUNT(*) > 0 FROM ${tbl})
        );
      `);
    }

    await pg.query('COMMIT');
    console.log('  All tables successfully committed.');

    // 5. Verification and reconciliation
    console.log('[5/5] Reconciling row counts and balances...');
    const allTables = ['users', 'wallets', 'ledger', 'providers', 'deposits', 'withdrawals', 'game_rounds', 'support_tickets', 'support_messages', 'announcements', 'system_settings', 'audit_logs', 'agent_funding_requests'];

    let countMismatch = false;
    for (const t of allTables) {
      const sqCount = sqlite.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
      const pgCount = parseInt((await pg.query(`SELECT COUNT(*) c FROM ${t}`)).rows[0].c, 10);
      const match = sqCount === pgCount;
      console.log(`  Table ${t.padEnd(25)}: SQLite=${sqCount}, Postgres=${pgCount} [${match ? 'OK' : 'MISMATCH'}]`);
      if (!match) countMismatch = true;
    }

    if (countMismatch) {
      throw new Error('Row count mismatch detected between SQLite and PostgreSQL!');
    }

    // Ledger balance reconciliation
    const users = (await pg.query('SELECT u.id, u.name, w.balance FROM users u JOIN wallets w ON w.user_id = u.id')).rows;
    for (const u of users) {
      const bal = Number(u.balance);
      const sumRes = await pg.query('SELECT COALESCE(SUM(amount), 0) s FROM ledger WHERE user_id = $1', [u.id]);
      const ledgerSum = Number(sumRes.rows[0].s);
      if (bal !== ledgerSum) {
        throw new Error(`CRITICAL: Ledger discrepancy for user ${u.name} (id=${u.id}): Wallet balance is ${bal}, but ledger sum is ${ledgerSum}!`);
      }
      console.log(`  Wallet Reconciliation [OK] -> User ${u.name} (id=${u.id}): Balance = ${bal} santim, Ledger Sum = ${ledgerSum} santim`);
    }

    console.log('\nMigration and verification completed with 100% data integrity!');
  } catch (err) {
    await pg.query('ROLLBACK').catch(() => {});
    console.error('Data migration error:', err);
    throw err;
  } finally {
    await pg.end();
  }
}

if (require.main === module) {
  migrateData()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}

module.exports = { migrateData };
