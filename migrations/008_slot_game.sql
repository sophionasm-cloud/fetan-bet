-- Lucky Royale fairness epochs and spin idempotency. Additive only.
CREATE TABLE IF NOT EXISTS slot_seed_epochs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_seed TEXT NOT NULL CHECK (server_seed ~ '^[0-9a-f]{64}$'),
  server_seed_hash CHAR(64) NOT NULL,
  client_seed TEXT NOT NULL,
  next_nonce INTEGER NOT NULL DEFAULT 0 CHECK (next_nonce >= 0),
  completed_spins INTEGER NOT NULL DEFAULT 0 CHECK (completed_spins >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retired_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_slot_active_seed_epoch
  ON slot_seed_epochs(user_id) WHERE retired_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_slot_seed_epochs_user_created
  ON slot_seed_epochs(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_slot_round_request
  ON game_rounds(user_id, ((detail::jsonb ->> 'requestId')))
  WHERE game = 'slot';
CREATE INDEX IF NOT EXISTS idx_slot_round_history
  ON game_rounds(user_id, id DESC) WHERE game = 'slot';
