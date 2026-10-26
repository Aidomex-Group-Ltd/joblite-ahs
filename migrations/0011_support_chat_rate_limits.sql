CREATE TABLE IF NOT EXISTS support_chat_rate_limits (
  identity_hash TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count >= 1)
);

CREATE INDEX IF NOT EXISTS idx_support_chat_rate_limits_window
  ON support_chat_rate_limits(window_started_at);
