-- Model C financial rounds. Wallet and ledger postings remain in application transactions.
CREATE TABLE IF NOT EXISTS chicken_road_dash_rounds (
  id UUID PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('easy','medium','hard')),
  status TEXT NOT NULL CHECK (status IN ('active','crashed','cashed_out','finished')),
  progress SMALLINT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 15),
  bet_santim BIGINT NOT NULL CHECK (bet_santim > 0),
  payout_santim BIGINT NOT NULL DEFAULT 0 CHECK (payout_santim >= 0),
  seed_commitment CHAR(64) NOT NULL,
  outcome_root CHAR(64) NOT NULL,
  detail JSONB NOT NULL,
  engine_version INTEGER NOT NULL,
  probability_version INTEGER NOT NULL,
  payout_version INTEGER NOT NULL,
  start_action_id UUID NOT NULL,
  start_request JSONB NOT NULL,
  game_round_id BIGINT NOT NULL UNIQUE REFERENCES game_rounds(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), settled_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_chicken_road_dash_start_action ON chicken_road_dash_rounds(user_id,start_action_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_chicken_road_dash_one_active ON chicken_road_dash_rounds(user_id) WHERE status='active';
CREATE TABLE IF NOT EXISTS chicken_road_dash_actions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  round_id UUID NOT NULL REFERENCES chicken_road_dash_rounds(id) ON DELETE RESTRICT,
  action_id UUID NOT NULL, sequence SMALLINT NOT NULL CHECK (sequence BETWEEN 1 AND 16),
  action_type TEXT NOT NULL CHECK (action_type IN ('cross','cashout')),
  request JSONB NOT NULL, response JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(round_id,action_id), UNIQUE(round_id,sequence)
);
