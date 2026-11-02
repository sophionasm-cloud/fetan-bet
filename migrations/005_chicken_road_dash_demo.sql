-- Isolated Model C demo persistence. This migration creates no financial game,
-- wallet, or ledger records and makes no changes to customer balances.
-- Apply only through the normal reviewed migration process; never at runtime.

CREATE TABLE IF NOT EXISTS chicken_road_dash_demo_balances (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance_santim BIGINT NOT NULL DEFAULT 100000000 CHECK (balance_santim >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chicken_road_dash_demo_rounds (
  id UUID PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('easy','medium','hard')),
  status TEXT NOT NULL CHECK (status IN ('active','crashed','cashed_out','finished','review')),
  progress SMALLINT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 15),
  bet_santim BIGINT NOT NULL CHECK (bet_santim > 0),
  payout_santim BIGINT NOT NULL DEFAULT 0 CHECK (payout_santim >= 0),
  seed_commitment CHAR(64) NOT NULL,
  outcome_root CHAR(64) NOT NULL,
  detail JSONB NOT NULL,
  engine_version INTEGER NOT NULL,
  probability_version INTEGER NOT NULL,
  payout_version INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_chicken_road_dash_demo_one_active
  ON chicken_road_dash_demo_rounds(user_id) WHERE status='active';
CREATE INDEX IF NOT EXISTS idx_chicken_road_dash_demo_history
  ON chicken_road_dash_demo_rounds(user_id, created_at DESC);

CREATE OR REPLACE FUNCTION protect_chicken_road_dash_demo_commitment()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(OLD.user_id, OLD.difficulty, OLD.bet_santim, OLD.seed_commitment,
         OLD.outcome_root, OLD.detail, OLD.engine_version, OLD.probability_version, OLD.payout_version)
     IS DISTINCT FROM
     ROW(NEW.user_id, NEW.difficulty, NEW.bet_santim, NEW.seed_commitment,
         NEW.outcome_root, NEW.detail, NEW.engine_version, NEW.probability_version, NEW.payout_version) THEN
    RAISE EXCEPTION 'Chicken Road Dash demo round commitment is immutable';
  END IF;
  IF OLD.status <> 'active' THEN
    RAISE EXCEPTION 'Settled Chicken Road Dash demo rounds are immutable';
  END IF;
  IF NEW.progress < OLD.progress OR NEW.progress > OLD.progress + 1 THEN
    RAISE EXCEPTION 'Chicken Road Dash demo progress must advance one lane at a time';
  END IF;
  IF (NEW.status='crashed' AND (NEW.progress <= OLD.progress OR NEW.payout_santim <> 0)) OR
     (NEW.status='cashed_out' AND (OLD.progress < 1 OR NEW.progress <> OLD.progress OR NEW.payout_santim <= 0)) OR
     (NEW.status='finished' AND (NEW.progress <> 15 OR NEW.payout_santim <= 0)) THEN
    RAISE EXCEPTION 'Invalid Chicken Road Dash demo settlement transition';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_chicken_road_dash_demo_commitment_immutable ON chicken_road_dash_demo_rounds;
CREATE TRIGGER trg_chicken_road_dash_demo_commitment_immutable
BEFORE UPDATE ON chicken_road_dash_demo_rounds
FOR EACH ROW EXECUTE FUNCTION protect_chicken_road_dash_demo_commitment();

CREATE TABLE IF NOT EXISTS chicken_road_dash_demo_actions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  round_id UUID NOT NULL REFERENCES chicken_road_dash_demo_rounds(id) ON DELETE CASCADE,
  action_id UUID NOT NULL,
  sequence SMALLINT NOT NULL CHECK (sequence BETWEEN 1 AND 16),
  action_type TEXT NOT NULL CHECK (action_type IN ('cross','cashout')),
  request JSONB NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(round_id, action_id),
  UNIQUE(round_id, sequence)
);

CREATE OR REPLACE FUNCTION protect_chicken_road_dash_demo_actions()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Chicken Road Dash demo action audit rows are immutable';
END;
$$;
DROP TRIGGER IF EXISTS trg_chicken_road_dash_demo_actions_immutable ON chicken_road_dash_demo_actions;
CREATE TRIGGER trg_chicken_road_dash_demo_actions_immutable
BEFORE UPDATE OR DELETE ON chicken_road_dash_demo_actions
FOR EACH ROW EXECUTE FUNCTION protect_chicken_road_dash_demo_actions();
