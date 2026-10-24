-- Additive production-ready passwordless authentication support.
-- Test mail lives in the isolated local E2E database and is never populated in production.
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  key_hash TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_updated ON auth_rate_limits(updated_at);

CREATE TABLE IF NOT EXISTS auth_test_mail (
  id TEXT PRIMARY KEY,
  email_normalized TEXT NOT NULL,
  challenge_id TEXT NOT NULL,
  code TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_test_mail_email_created
  ON auth_test_mail(email_normalized, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_challenges_active_email
  ON auth_challenges(email_normalized, created_at DESC, consumed_at, expires_at);
