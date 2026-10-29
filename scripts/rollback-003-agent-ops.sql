-- Manual, guarded rollback for 003_agent_referrals_superadmin_settlements.sql.
-- Review and backup first. This aborts if any referral, staff-action, settlement,
-- payout, withdrawal-paid, or pending-ticket records would be lost by the rollback.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE referred_by_agent_id IS NOT NULL)
     OR EXISTS (SELECT 1 FROM staff_action_history)
     OR EXISTS (SELECT 1 FROM agent_payout_requests)
     OR EXISTS (SELECT 1 FROM agent_weekly_settlements)
     OR EXISTS (SELECT 1 FROM agent_settlement_payments)
     OR EXISTS (SELECT 1 FROM withdrawal_reviews)
     OR EXISTS (SELECT 1 FROM withdrawals WHERE status='paid')
     OR EXISTS (SELECT 1 FROM support_tickets WHERE status='pending')
     OR EXISTS (SELECT 1 FROM support_messages WHERE sender_role='superadmin')
     OR EXISTS (SELECT 1 FROM users u WHERE u.role='superadmin' AND NOT EXISTS (SELECT 1 FROM superadmin_role_bootstrap b WHERE b.user_id=u.id))
     OR EXISTS (SELECT 1 FROM agent_profiles WHERE migration_backfill=FALSE)
  THEN
    RAISE EXCEPTION 'Rollback blocked: migration 003 has operational data. Preserve it and use a forward fix.';
  END IF;
END $$;

UPDATE users u SET role=b.previous_role FROM superadmin_role_bootstrap b WHERE b.user_id=u.id;
DROP VIEW agent_weekly_settlement_status;
DROP TRIGGER trg_agent_settlement_payments_immutable ON agent_settlement_payments;
DROP TRIGGER trg_agent_weekly_settlements_immutable ON agent_weekly_settlements;
DROP TRIGGER trg_withdrawal_reviews_immutable ON withdrawal_reviews;
DROP TRIGGER trg_staff_action_history_immutable ON staff_action_history;
DROP FUNCTION block_agent_settlement_payment_modification();
DROP FUNCTION block_agent_settlement_modification();
DROP FUNCTION block_withdrawal_review_modification();
DROP FUNCTION block_staff_action_history_modification();
DROP TABLE agent_settlement_payments;
DROP TABLE agent_weekly_settlements;
DROP TABLE agent_payout_requests;
DROP TABLE withdrawal_reviews;
DROP TABLE staff_action_history;
DELETE FROM agent_profiles WHERE migration_backfill=TRUE;
DROP TABLE agent_profiles;
DROP TABLE superadmin_role_bootstrap;
ALTER TABLE support_tickets DROP CONSTRAINT support_tickets_status_check;
ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_status_check CHECK (status IN ('open','in_progress','escalated','resolved'));
ALTER TABLE support_messages DROP CONSTRAINT support_messages_sender_role_check;
ALTER TABLE support_messages ADD CONSTRAINT support_messages_sender_role_check CHECK (sender_role IN ('user','agent','admin','ai'));
DROP INDEX idx_support_ticket_agent_status;
ALTER TABLE withdrawals DROP CONSTRAINT withdrawals_status_check;
ALTER TABLE withdrawals ADD CONSTRAINT withdrawals_status_check CHECK (status IN ('pending','approved','rejected'));
DROP INDEX idx_users_referrer_created;
DROP INDEX idx_ledger_user_created;
ALTER TABLE users DROP COLUMN referred_by_agent_id;
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user','agent','admin'));
-- audit_logs and deposit_reviews' added audit columns are intentionally retained.
