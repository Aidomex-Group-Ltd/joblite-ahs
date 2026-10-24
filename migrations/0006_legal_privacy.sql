ALTER TABLE auth_challenges ADD COLUMN terms_version TEXT;
ALTER TABLE auth_challenges ADD COLUMN presented_region TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE auth_challenges ADD COLUMN language TEXT NOT NULL DEFAULT 'en';

CREATE TABLE IF NOT EXISTS legal_records (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  anonymous_id_hash TEXT,
  document_id TEXT NOT NULL,
  document_version TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('acceptance','consent_grant','consent_refusal','withdrawal')),
  purpose TEXT,
  region TEXT NOT NULL DEFAULT 'unknown',
  language TEXT NOT NULL DEFAULT 'en',
  created_at INTEGER NOT NULL,
  CHECK (user_id IS NOT NULL OR anonymous_id_hash IS NOT NULL),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_legal_records_user_time ON legal_records(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_legal_records_document_version ON legal_records(document_id, document_version);
CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_acceptance_unique ON legal_records(user_id, document_id, document_version, action)
  WHERE user_id IS NOT NULL AND action = 'acceptance';
CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_marketing_once ON legal_records(user_id, document_version, purpose)
  WHERE user_id IS NOT NULL AND purpose = 'marketing';

CREATE TABLE IF NOT EXISTS privacy_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('access','correction','deletion','export','objection','withdraw_consent')),
  details TEXT,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','under_review','completed','unable_to_fulfil')),
  region TEXT NOT NULL DEFAULT 'unknown',
  language TEXT NOT NULL DEFAULT 'en',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  resolution_note TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_user_time ON privacy_requests(user_id, created_at DESC);
