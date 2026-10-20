-- =====================================================================
-- Setup Script: Restricted Database Role (fetan_app) for Neon PostgreSQL
-- Run this script as the database OWNER (neondb_owner) via Neon Console SQL Editor
-- or via psql / DIRECT_DATABASE_URL.
-- =====================================================================

-- 1. Create the application role with a secure password (replace 'CHANGE_ME_TO_STRONG_PASSWORD')
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'fetan_app') THEN
    CREATE ROLE fetan_app WITH LOGIN PASSWORD 'CHANGE_ME_TO_STRONG_PASSWORD';
  END IF;
END
$$;

-- 2. Grant basic connection rights on the database
GRANT CONNECT ON DATABASE neondb TO fetan_app;
GRANT USAGE ON SCHEMA public TO fetan_app;

-- 3. Grant DML only (SELECT, INSERT, UPDATE, DELETE) on existing tables to fetan_app
-- Note: schema_migrations is EXCLUDED so runtime cannot tamper with migrations.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  users,
  wallets,
  ledger,
  providers,
  deposits,
  withdrawals,
  game_rounds,
  support_tickets,
  support_messages,
  announcements,
  system_settings,
  audit_logs,
  agent_funding_requests
TO fetan_app;

-- Read-only on schema_migrations if needed for status checks
GRANT SELECT ON TABLE schema_migrations TO fetan_app;

-- 4. Grant USAGE on all sequences for ID generation
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fetan_app;

-- 5. Automatically grant DML on future tables created by the owner
ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fetan_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT USAGE, SELECT ON SEQUENCES TO fetan_app;

-- 6. Ensure fetan_app has NO permission to ALTER, DROP, or CREATE tables (no DDL)
REVOKE CREATE ON SCHEMA public FROM fetan_app;

-- Verification query:
-- SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants WHERE grantee = 'fetan_app';
