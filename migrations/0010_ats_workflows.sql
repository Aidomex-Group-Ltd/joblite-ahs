ALTER TABLE offers ADD COLUMN issued_by TEXT;
ALTER TABLE interviews ADD COLUMN updated_at INTEGER;

WITH ranked_offers AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY application_id ORDER BY created_at, id) AS assigned_version
  FROM offers
)
UPDATE offers
SET version = (SELECT assigned_version FROM ranked_offers WHERE ranked_offers.id = offers.id);

CREATE INDEX IF NOT EXISTS idx_applications_stage_submitted
  ON applications(stage, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_interviews_scheduled
  ON interviews(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_offers_application_status
  ON offers(application_id, status, version DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_offers_application_version
  ON offers(application_id, version);

CREATE TABLE IF NOT EXISTS reviewer_assignments (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL,
  membership_id TEXT NOT NULL,
  assigned_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(application_id, membership_id),
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE,
  FOREIGN KEY (membership_id) REFERENCES memberships(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS scorecards (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL,
  membership_id TEXT NOT NULL,
  ratings_json TEXT NOT NULL,
  recommendation TEXT NOT NULL CHECK (recommendation IN ('strong_yes', 'yes', 'mixed', 'no', 'strong_no')),
  summary TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(application_id, membership_id),
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE,
  FOREIGN KEY (membership_id) REFERENCES memberships(id) ON DELETE CASCADE
);

CREATE TRIGGER IF NOT EXISTS application_snapshots_immutable_update
BEFORE UPDATE ON application_snapshots
BEGIN
  SELECT RAISE(ABORT, 'application snapshots are immutable');
END;

CREATE TRIGGER IF NOT EXISTS application_snapshots_immutable_delete
BEFORE DELETE ON application_snapshots
BEGIN
  SELECT RAISE(ABORT, 'application snapshots are immutable');
END;
