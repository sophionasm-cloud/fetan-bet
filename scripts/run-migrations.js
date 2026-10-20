// Database Migration Runner for Neon PostgreSQL
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function sanitizeConnectionString(url) {
  if (!url) return '';
  // Strip channel_binding=require if present because some pg/Node environments reject it
  return url.replace(/([?&])channel_binding=[^&]+(&|$)/, '$1').replace(/[?&]$/, '');
}

async function runMigrations(customUrl = null) {
  const connString = customUrl || process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
  if (!connString) {
    throw new Error('Neither DIRECT_DATABASE_URL nor DATABASE_URL environment variable is set.');
  }

  const client = new Client({
    connectionString: sanitizeConnectionString(connString),
    ssl: { rejectUnauthorized: false }
  });

  console.log('Connecting to PostgreSQL for migrations...');
  await client.connect();

  try {
    // 1. Ensure schema_migrations table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 2. Fetch already applied migrations
    const res = await client.query('SELECT name FROM schema_migrations ORDER BY id ASC');
    const applied = new Set(res.rows.map((r) => r.name));

    // 3. Read migration files from /migrations
    const migrationsDir = path.join(__dirname, '..', 'migrations');
    if (!fs.existsSync(migrationsDir)) {
      console.log('No migrations directory found.');
      return;
    }

    const files = fs.readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`  [skip] Migration ${file} is already applied.`);
        continue;
      }

      console.log(`  [exec] Applying migration: ${file}...`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`  [done] Migration ${file} applied successfully.`);
        count++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  [error] Migration ${file} failed:`, err);
        throw err;
      }
    }

    console.log(`\nMigrations complete. ${count} new migration(s) applied.`);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Migration runner error:', err.message);
      process.exit(1);
    });
}

module.exports = { runMigrations, sanitizeConnectionString };
