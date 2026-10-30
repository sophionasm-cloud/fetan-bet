-- Additive migration for the Agent / Super Admin workspace.
-- Review and back up the target database before applying. This migration does
-- not update or delete any wallet, ledger, deposit, withdrawal or game row.

-- Staff / agent identity fields. Phone remains the primary customer login.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_username_ci
  ON users (LOWER(username)) WHERE username IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_ci
  ON users (LOWER(email)) WHERE email IS NOT NULL;

-- Promotional credits are deliberately separate from withdrawable wallet funds.
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS promo_balance BIGINT NOT NULL DEFAULT 0;
ALTER TABLE wallets DROP CONSTRAINT IF EXISTS wallets_promo_balance_check;
ALTER TABLE wallets ADD CONSTRAINT wallets_promo_balance_check CHECK (promo_balance >= 0);

-- One permanent referral-bonus record per referred customer. The unique
-- referred_user_id is the exactly-once guard for the 2,000-credit award.
CREATE TABLE IF NOT EXISTS referral_bonuses (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agent_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  referred_user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  amount_santim BIGINT NOT NULL DEFAULT 200000 CHECK (amount_santim = 200000),
  status TEXT NOT NULL DEFAULT 'awarded' CHECK (status IN ('awarded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_referral_bonuses_agent
  ON referral_bonuses(agent_id, created_at DESC);

-- Internal approval notes are staff-only. The existing review tables remain
-- the append-only decision history.
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS internal_note TEXT;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS internal_note TEXT;

-- In-app notification feed for Super Admin, agents and customers.
CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT,
  related_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_created
  ON notifications(created_at DESC);

-- Per-staff read state for support conversations.
CREATE TABLE IF NOT EXISTS support_ticket_reads (
  ticket_id BIGINT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ticket_id, user_id)
);

-- Commission review stages. Existing payment records stay append-only.
ALTER TABLE agent_payout_requests ADD COLUMN IF NOT EXISTS approved_by BIGINT REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE agent_payout_requests ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- The business rule is a 25% weekly share of positive eligible net gaming
-- revenue. Historical settled rows keep the rate stored on their own record.
ALTER TABLE agent_profiles ALTER COLUMN commission_bps SET DEFAULT 2500;
UPDATE agent_profiles SET commission_bps = 2500, updated_at = NOW()
WHERE commission_bps = 1000;

-- Dashboard query indexes.
CREATE INDEX IF NOT EXISTS idx_deposits_user_status_created
  ON deposits(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawals_user_status_created
  ON withdrawals(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_rounds_user_status_created
  ON game_rounds(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_round_ref
  ON ledger(ref_type, ref_id) WHERE ref_type = 'round';
CREATE INDEX IF NOT EXISTS idx_support_tickets_user_updated
  ON support_tickets(user_id, updated_at DESC);
