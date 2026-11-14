-- Rocket Crash shared-round tables. Additive only: no existing table is
-- altered. wallet/ledger postings remain in application transactions.
CREATE TABLE IF NOT EXISTS crash_rounds (
  id BIGSERIAL PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('betting','flying','crashed')),
  server_seed TEXT NOT NULL,
  server_seed_hash CHAR(64) NOT NULL,
  client_seed TEXT NOT NULL,
  crash_hundredths INTEGER NOT NULL CHECK (crash_hundredths >= 100),
  edge_bp INTEGER NOT NULL CHECK (edge_bp BETWEEN 0 AND 9999),
  growth_k_micro INTEGER NOT NULL CHECK (growth_k_micro > 0),
  max_hundredths INTEGER NOT NULL CHECK (max_hundredths >= 100),
  betting_closes_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  crashed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT crash_rounds_cap_check CHECK (crash_hundredths <= max_hundredths),
  CONSTRAINT crash_rounds_flying_started_check CHECK (status <> 'flying' OR started_at IS NOT NULL),
  CONSTRAINT crash_rounds_crashed_at_check CHECK (status <> 'crashed' OR crashed_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_crash_rounds_created_at ON crash_rounds(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crash_rounds_live ON crash_rounds(status) WHERE status <> 'crashed';

CREATE TABLE IF NOT EXISTS crash_bets (
  id BIGSERIAL PRIMARY KEY,
  crash_round_id BIGINT NOT NULL REFERENCES crash_rounds(id) ON DELETE RESTRICT,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  panel SMALLINT NOT NULL CHECK (panel IN (1,2)),
  stake_santim BIGINT NOT NULL CHECK (stake_santim > 0),
  auto_cashout_hundredths INTEGER CHECK (auto_cashout_hundredths >= 101),
  status TEXT NOT NULL CHECK (status IN ('open','cashed','lost')),
  cashout_hundredths INTEGER CHECK (cashout_hundredths IS NULL OR cashout_hundredths >= 100),
  payout_santim BIGINT NOT NULL DEFAULT 0 CHECK (payout_santim >= 0),
  game_round_id BIGINT NOT NULL UNIQUE REFERENCES game_rounds(id) ON DELETE RESTRICT,
  request_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ,
  CONSTRAINT crash_bets_round_user_panel_uq UNIQUE (crash_round_id, user_id, panel),
  CONSTRAINT crash_bets_user_request_uq UNIQUE (user_id, request_id)
);
CREATE INDEX IF NOT EXISTS idx_crash_bets_round ON crash_bets(crash_round_id);
CREATE INDEX IF NOT EXISTS idx_crash_bets_user_created ON crash_bets(user_id, created_at DESC);
