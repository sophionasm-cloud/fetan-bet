// Database Migration Runner for Neon PostgreSQL
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { assertExpectedNeonTestEndpoint } = require('./test-db-safety');
const { postgresSslOptions } = require('./database-config');

function sanitizeConnectionString(url) {
  if (!url) return '';
  // Strip channel_binding=require if present because some pg/Node environments reject it
  return url.replace(/([?&])channel_binding=[^&]+(&|$)/, '$1').replace(/[?&]$/, '');
}

function testOptionsFromArgs(args) {
  const get = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  return {
    target: 'test',
    expectedEndpointId: get('endpoint-id'),
    expectedProjectId: get('project-id'),
    expectedBranchId: get('branch-id'),
  };
}

function validTestMetadata(options) {
  return /^muddy-dew-45860324$/.test(options.expectedProjectId || '') &&
    /^br-patient-recipe-b58ey3ge$/.test(options.expectedBranchId || '');
}

async function runMigrations(options = null) {
  const testTarget = options?.target === 'test';
  const customUrl = typeof options === 'string' ? options : null;
  let connString;
  if (testTarget) {
    if (!validTestMetadata(options)) throw new Error('Expected test Neon project and branch IDs are required.');
    if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required; refusing test migration.');
    assertExpectedNeonTestEndpoint(process.env.TEST_DATABASE_URL, options.expectedEndpointId);
    connString = sanitizeConnectionString(process.env.TEST_DATABASE_URL);
  } else {
    // Preserve the existing default behavior for non-test migration runs.
    connString = customUrl || process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
  }
  if (!connString) {
    throw new Error(testTarget ? 'TEST_DATABASE_URL is required.' : 'Neither DIRECT_DATABASE_URL nor DATABASE_URL environment variable is set.');
  }

  const client = new Client({
    connectionString: sanitizeConnectionString(connString),
    ssl: postgresSslOptions()
  });

  console.log(testTarget
    ? `Connecting to verified Neon test endpoint ${options.expectedEndpointId} for branch ${options.expectedBranchId}...`
    : 'Connecting to PostgreSQL for migrations...');
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
        console.error(`  [error] Migration ${file} failed (code ${err.code || 'unknown'}).`);
        throw err;
      }
    }

    console.log(`\nMigrations complete. ${count} new migration(s) applied.`);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const testMode = args.includes('--test');
  const options = testMode ? testOptionsFromArgs(args) : null;
  runMigrations(options)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Migration runner error:', err.message);
      process.exit(1);
    });
}

module.exports = { runMigrations, sanitizeConnectionString, testOptionsFromArgs };
