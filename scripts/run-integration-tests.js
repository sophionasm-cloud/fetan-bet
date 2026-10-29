'use strict';

require('dotenv').config();
const { Client } = require('pg');
const { assertSeparateTestDatabase, formatIdentity } = require('./test-db-safety');
const { sanitizeConnectionString } = require('./run-migrations');

async function verifyTestDatabase(testUrl, expectedIdentity) {
  const client = new Client({
    connectionString: sanitizeConnectionString(testUrl),
    ssl: { rejectUnauthorized: false },
    options: '-c default_transaction_read_only=on',
  });
  await client.connect();
  try {
    const identity = await client.query('SELECT current_database() AS database_name, current_setting(\'server_version\') AS server_version');
    const actualName = String(identity.rows[0].database_name);
    if (actualName !== expectedIdentity.database) {
      throw new Error('Connected database name does not match the configured test target.');
    }

    const migrationsTable = await client.query("SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists");
    const migrations = migrationsTable.rows[0].exists
      ? await client.query("SELECT name FROM public.schema_migrations WHERE name = ANY($1::text[])", [['001_initial_schema.sql', '002_deposit_receipts_and_reviews.sql', '003_agent_referrals_superadmin_settlements.sql']])
      : { rows: [] };
    const applied = new Set(migrations.rows.map((row) => row.name));
    const objects = await client.query(`
      SELECT
        to_regclass('public.users') IS NOT NULL AS users,
        to_regclass('public.wallets') IS NOT NULL AS wallets,
        to_regclass('public.ledger') IS NOT NULL AS ledger,
        to_regclass('public.game_rounds') IS NOT NULL AS game_rounds,
        to_regclass('public.providers') IS NOT NULL AS providers,
        to_regclass('public.deposits') IS NOT NULL AS deposits,
        to_regclass('public.withdrawals') IS NOT NULL AS withdrawals,
        to_regclass('public.deposit_reviews') IS NOT NULL AS deposit_reviews,
        to_regclass('public.support_tickets') IS NOT NULL AS support_tickets,
        to_regclass('public.support_messages') IS NOT NULL AS support_messages,
        to_regclass('public.announcements') IS NOT NULL AS announcements,
        to_regclass('public.system_settings') IS NOT NULL AS system_settings,
        to_regclass('public.audit_logs') IS NOT NULL AS audit_logs,
        to_regclass('public.agent_funding_requests') IS NOT NULL AS agent_funding_requests,
        to_regclass('public.agent_profiles') IS NOT NULL AS agent_profiles,
        to_regclass('public.staff_action_history') IS NOT NULL AS staff_action_history,
        to_regclass('public.withdrawal_reviews') IS NOT NULL AS withdrawal_reviews,
        to_regclass('public.agent_payout_requests') IS NOT NULL AS agent_payout_requests,
        to_regclass('public.agent_weekly_settlements') IS NOT NULL AS agent_weekly_settlements,
        to_regclass('public.agent_settlement_payments') IS NOT NULL AS agent_settlement_payments,
        to_regclass('public.agent_weekly_settlement_status') IS NOT NULL AS agent_weekly_settlement_status,
        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='deposits' AND column_name='receipt_key') AS receipt_key
        , EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='referred_by_agent_id') AS referral_column
        , EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='audit_logs' AND column_name='actor_ip') AS audit_actor_ip
        , EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='audit_logs' AND column_name='before_value') AS audit_before_after
        , EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uq_agent_profiles_promo_code_ci') AS unique_promo_index
        , EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.users') AND conname='users_role_check' AND pg_get_constraintdef(oid) LIKE '%superadmin%') AS superadmin_role_constraint
        , EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.support_messages') AND conname='support_messages_sender_role_check' AND pg_get_constraintdef(oid) LIKE '%superadmin%') AS superadmin_support_role_constraint
        , EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uq_ledger_ref') AS ledger_ref_index
        , EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_ledger_immutable' AND NOT tgisinternal AND tgenabled <> 'D') AS ledger_immutable_trigger
        , EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_deposit_reviews_immutable' AND NOT tgisinternal AND tgenabled <> 'D') AS deposit_review_immutable_trigger
        , EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_staff_action_history_immutable' AND NOT tgisinternal AND tgenabled <> 'D') AS staff_action_immutable_trigger
        , EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_agent_weekly_settlements_immutable' AND NOT tgisinternal AND tgenabled <> 'D') AS settlement_immutable_trigger
        , EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_agent_settlement_payments_immutable' AND NOT tgisinternal AND tgenabled <> 'D') AS settlement_payment_immutable_trigger
    `);
    const missingObjects = Object.entries(objects.rows[0]).filter(([, present]) => !present).map(([name]) => name);
    let businessDataEmpty = null;
    if (missingObjects.length === 0) {
      const empty = await client.query(`
        SELECT
          NOT EXISTS (SELECT 1 FROM users) AS users,
          NOT EXISTS (SELECT 1 FROM wallets) AS wallets,
          NOT EXISTS (SELECT 1 FROM ledger) AS ledger,
          NOT EXISTS (SELECT 1 FROM providers) AS providers,
          NOT EXISTS (SELECT 1 FROM deposits) AS deposits,
          NOT EXISTS (SELECT 1 FROM withdrawals) AS withdrawals,
          NOT EXISTS (SELECT 1 FROM game_rounds) AS game_rounds,
          NOT EXISTS (SELECT 1 FROM support_tickets) AS support_tickets,
          NOT EXISTS (SELECT 1 FROM support_messages) AS support_messages,
          NOT EXISTS (SELECT 1 FROM announcements) AS announcements,
          NOT EXISTS (SELECT 1 FROM system_settings) AS system_settings,
          NOT EXISTS (SELECT 1 FROM audit_logs) AS audit_logs,
          NOT EXISTS (SELECT 1 FROM agent_funding_requests) AS agent_funding_requests,
          NOT EXISTS (SELECT 1 FROM deposit_reviews) AS deposit_reviews,
          NOT EXISTS (SELECT 1 FROM agent_profiles) AS agent_profiles,
          NOT EXISTS (SELECT 1 FROM staff_action_history) AS staff_action_history,
          NOT EXISTS (SELECT 1 FROM withdrawal_reviews) AS withdrawal_reviews,
          NOT EXISTS (SELECT 1 FROM agent_payout_requests) AS agent_payout_requests,
          NOT EXISTS (SELECT 1 FROM agent_weekly_settlements) AS agent_weekly_settlements,
          NOT EXISTS (SELECT 1 FROM agent_settlement_payments) AS agent_settlement_payments
      `);
      businessDataEmpty = Object.values(empty.rows[0]).every(Boolean);
    }

    console.log(`Read-only test target verified: ${formatIdentity({ ...expectedIdentity, database: actualName })}`);
    console.log(`PostgreSQL version: ${identity.rows[0].server_version}`);
    console.log(`Schema migrations present: ${[...applied].sort().join(', ') || 'none'}`);
    console.log(`Required schema objects: ${missingObjects.length ? `missing ${missingObjects.join(', ')}` : 'present'}`);
    console.log(`Application tables contain only migration metadata: ${businessDataEmpty === null ? 'not checked until schema is complete' : businessDataEmpty ? 'yes (empty)' : 'no (contains rows)'}`);
    return { client, applied, missingObjects, businessDataEmpty };
  } catch (error) {
    await client.end().catch(() => {});
    throw error;
  }
}

async function main() {
  let identities;
  try {
    identities = assertSeparateTestDatabase(process.env);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  let verified;
  try {
    verified = await verifyTestDatabase(process.env.TEST_DATABASE_URL, identities.test);
  } catch (error) {
    console.error(`Test database preflight failed (${error.name}${error.code ? `, ${error.code}` : ''}); no test suite was started.`);
    process.exitCode = 1;
    return;
  }

  if (process.argv.includes('--check')) {
    await verified.client.end();
    return;
  }

  const requiredMigrations = ['001_initial_schema.sql', '002_deposit_receipts_and_reviews.sql', '003_agent_referrals_superadmin_settlements.sql'];
  const missing = requiredMigrations.filter((name) => !verified.applied.has(name));
  if (missing.length || verified.missingObjects.length || verified.businessDataEmpty !== true) {
    await verified.client.end();
    const dataState = verified.businessDataEmpty === false ? 'the test database contains rows; use a newly created empty test database' : 'database emptiness could not be verified';
    console.error(`Test database is not ready; missing migrations: ${missing.join(', ') || 'none'}; missing objects: ${verified.missingObjects.join(', ') || 'none'}; ${dataState}. No migrations or tests were run.`);
    process.exitCode = 1;
    return;
  }

  // The test pool must use TEST_DATABASE_URL even if the shell or .env has another DATABASE_URL.
  process.env.FETAN_INTEGRATION_TEST = '1';
  process.env.FETAN_TEST_DB_PREFLIGHT = 'passed';
  await verified.client.end();
  require('../test');
}

main().catch((error) => {
  console.error(`Integration-test launcher failed (${error.name}${error.code ? `, ${error.code}` : ''}).`);
  process.exitCode = 1;
});
