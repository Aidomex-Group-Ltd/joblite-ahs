CREATE TABLE IF NOT EXISTS auth_challenge_requests (
  idempotency_hash TEXT PRIMARY KEY,
  email_normalized TEXT NOT NULL,
  challenge_id TEXT NOT NULL UNIQUE,
  delivery_status TEXT NOT NULL CHECK (delivery_status IN ('sending', 'accepted', 'failed')),
  provider_message_id TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (challenge_id) REFERENCES auth_challenges(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_auth_challenge_requests_email_created
  ON auth_challenge_requests(email_normalized, created_at DESC);
