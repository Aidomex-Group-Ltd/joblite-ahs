ALTER TABLE jobs ADD COLUMN archived_at INTEGER;
ALTER TABLE jobs ADD COLUMN application_questions_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE application_snapshots ADD COLUMN answers_json TEXT NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_jobs_org_archived
  ON jobs(organization_id, archived_at, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_application_snapshots_cv_media
  ON application_snapshots(cv_media_id)
  WHERE cv_media_id IS NOT NULL;
