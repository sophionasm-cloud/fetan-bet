-- Additive operations migration. Apply only after review and backup on the intended DB.
-- No wallet, ledger, deposit or withdrawal rows are changed.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'agent', 'admin', 'superadmin'));

-- Bootstrap the existing earliest Admin as Super Admin so this deployment does not
-- lock privileged workflows. Super Admin retains all Admin capabilities.
CREATE TABLE superadmin_role_bootstrap (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  previous_role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
WITH first_admin AS (
  SELECT id FROM users WHERE role='admin' ORDER BY id ASC LIMIT 1
), promoted AS (
  UPDATE users SET role='superadmin'
  WHERE id=(SELECT id FROM first_admin)
  RETURNING id
)
INSERT INTO superadmin_role_bootstrap(user_id, previous_role)
SELECT id, 'admin' FROM promoted
ON CONFLICT (user_id) DO NOTHING;

ALTER TABLE users ADD COLUMN referred_by_agent_id BIGINT REFERENCES users(id) ON DELETE RESTRICT;
CREATE INDEX idx_users_referrer_created ON users(referred_by_agent_id, created_at DESC) WHERE referred_by_agent_id IS NOT NULL;
ALTER TABLE withdrawals DROP CONSTRAINT IF EXISTS withdrawals_status_check;
ALTER TABLE withdrawals ADD CONSTRAINT withdrawals_status_check CHECK (status IN ('pending','approved','rejected','paid'));

CREATE TABLE agent_profiles (
  agent_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  promo_code TEXT NOT NULL,
  contact_info TEXT,
  weekly_fee_santim BIGINT NOT NULL DEFAULT 0 CHECK (weekly_fee_santim >= 0),
  commission_bps INTEGER NOT NULL DEFAULT 1000 CHECK (commission_bps BETWEEN 0 AND 10000),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  migration_backfill BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_agent_profiles_promo_code_ci ON agent_profiles(LOWER(promo_code));
INSERT INTO agent_profiles(agent_id, promo_code, contact_info, migration_backfill)
SELECT id, 'FB-' || LPAD(id::text, 7, '0'), phone, TRUE FROM users WHERE role='agent'
ON CONFLICT (agent_id) DO NOTHING;

CREATE TABLE staff_action_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id BIGINT NOT NULL,
  before_value JSONB,
  after_value JSONB,
  reason TEXT,
  actor_ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_staff_action_target ON staff_action_history(target_type, target_id, created_at DESC);
CREATE INDEX idx_staff_action_actor ON staff_action_history(actor_id, created_at DESC);

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor_ip TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS before_value JSONB;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS after_value JSONB;

ALTER TABLE deposit_reviews ADD COLUMN IF NOT EXISTS before_status TEXT;
ALTER TABLE deposit_reviews ADD COLUMN IF NOT EXISTS after_status TEXT;
ALTER TABLE deposit_reviews ADD COLUMN IF NOT EXISTS actor_ip TEXT;

CREATE TABLE withdrawal_reviews (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  withdrawal_id BIGINT NOT NULL REFERENCES withdrawals(id) ON DELETE RESTRICT,
  reviewer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('approve', 'reject', 'complete')),
  before_status TEXT NOT NULL,
  after_status TEXT NOT NULL,
  reason TEXT,
  actor_ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_withdrawal_reviews_history ON withdrawal_reviews(withdrawal_id, id DESC);

CREATE TABLE agent_payout_requests (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agent_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  payout_type TEXT NOT NULL CHECK (payout_type IN ('weekly_fee', 'commission')),
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  amount_santim BIGINT NOT NULL CHECK (amount_santim > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'paid')),
  note TEXT,
  decided_by BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  decision_reason TEXT,
  decided_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (period_end > period_start)
);
CREATE INDEX idx_agent_payout_requests_queue ON agent_payout_requests(status, created_at DESC);
CREATE INDEX idx_agent_payout_requests_agent ON agent_payout_requests(agent_id, created_at DESC);
CREATE UNIQUE INDEX uq_agent_payout_request_period ON agent_payout_requests(agent_id,payout_type,period_start,period_end);

CREATE TABLE agent_weekly_settlements (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agent_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  week_start TIMESTAMPTZ NOT NULL,
  week_end TIMESTAMPTZ NOT NULL,
  profit_santim BIGINT NOT NULL,
  carried_loss_in_santim BIGINT NOT NULL DEFAULT 0 CHECK (carried_loss_in_santim >= 0),
  carried_loss_out_santim BIGINT NOT NULL DEFAULT 0 CHECK (carried_loss_out_santim >= 0),
  commission_bps INTEGER NOT NULL CHECK (commission_bps BETWEEN 0 AND 10000),
  commission_santim BIGINT NOT NULL CHECK (commission_santim >= 0),
  weekly_fee_santim BIGINT NOT NULL DEFAULT 0 CHECK (weekly_fee_santim >= 0),
  created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (week_end > week_start),
  UNIQUE(agent_id, week_start, week_end)
);
CREATE INDEX idx_agent_settlements_agent_week ON agent_weekly_settlements(agent_id, week_start DESC);

CREATE TABLE agent_settlement_payments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  settlement_id BIGINT NOT NULL REFERENCES agent_weekly_settlements(id) ON DELETE RESTRICT,
  agent_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  payment_type TEXT NOT NULL CHECK (payment_type IN ('weekly_fee', 'commission')),
  amount_santim BIGINT NOT NULL CHECK (amount_santim > 0),
  paid_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ledger_id BIGINT REFERENCES ledger(id) ON DELETE RESTRICT,
  UNIQUE(settlement_id, payment_type)
);
CREATE INDEX idx_agent_settlement_payments_agent ON agent_settlement_payments(agent_id, paid_at DESC);
CREATE VIEW agent_weekly_settlement_status AS
SELECT s.*,
  CASE WHEN (s.commission_santim=0 OR COUNT(p.id) FILTER (WHERE p.payment_type='commission') > 0)
         AND (s.weekly_fee_santim=0 OR COUNT(p.id) FILTER (WHERE p.payment_type='weekly_fee') > 0)
       THEN 'paid' ELSE 'ready' END AS status,
  COALESCE(SUM(p.amount_santim) FILTER (WHERE p.payment_type='commission'),0)::bigint AS commission_paid,
  COALESCE(SUM(p.amount_santim) FILTER (WHERE p.payment_type='weekly_fee'),0)::bigint AS fee_paid,
  MAX(p.paid_by) AS paid_by,
  MAX(p.paid_at) AS paid_at
FROM agent_weekly_settlements s LEFT JOIN agent_settlement_payments p ON p.settlement_id=s.id
GROUP BY s.id;

ALTER TABLE support_tickets DROP CONSTRAINT IF EXISTS support_tickets_status_check;
ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_status_check
  CHECK (status IN ('open', 'pending', 'in_progress', 'escalated', 'resolved'));
CREATE INDEX idx_support_ticket_agent_status ON support_tickets(assigned_agent_id, status, created_at DESC);

-- Super Admin replies are stored with the authenticated role, so extend the existing role check.
ALTER TABLE support_messages DROP CONSTRAINT IF EXISTS support_messages_sender_role_check;
ALTER TABLE support_messages ADD CONSTRAINT support_messages_sender_role_check
  CHECK (sender_role IN ('user', 'agent', 'admin', 'superadmin', 'ai'));

CREATE INDEX idx_ledger_user_created ON ledger(user_id, created_at DESC);

CREATE OR REPLACE FUNCTION block_staff_action_history_modification()
RETURNS TRIGGER AS $$
BEGIN RAISE EXCEPTION 'Staff action history is append-only'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_staff_action_history_immutable
BEFORE UPDATE OR DELETE ON staff_action_history
FOR EACH ROW EXECUTE FUNCTION block_staff_action_history_modification();

CREATE OR REPLACE FUNCTION block_withdrawal_review_modification()
RETURNS TRIGGER AS $$
BEGIN RAISE EXCEPTION 'Withdrawal review history is append-only'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_withdrawal_reviews_immutable
BEFORE UPDATE OR DELETE ON withdrawal_reviews
FOR EACH ROW EXECUTE FUNCTION block_withdrawal_review_modification();

CREATE OR REPLACE FUNCTION block_agent_settlement_modification()
RETURNS TRIGGER AS $$
BEGIN RAISE EXCEPTION 'Weekly settlements are immutable'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_agent_weekly_settlements_immutable
BEFORE UPDATE OR DELETE ON agent_weekly_settlements
FOR EACH ROW EXECUTE FUNCTION block_agent_settlement_modification();

CREATE OR REPLACE FUNCTION block_agent_settlement_payment_modification()
RETURNS TRIGGER AS $$
BEGIN RAISE EXCEPTION 'Settlement payment history is append-only'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_agent_settlement_payments_immutable
BEFORE UPDATE OR DELETE ON agent_settlement_payments
FOR EACH ROW EXECUTE FUNCTION block_agent_settlement_payment_modification();
