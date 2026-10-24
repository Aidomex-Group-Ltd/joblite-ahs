-- Additive migration: real provider ingestion, provenance links, freshness and indexes.
-- Never drops or rewrites existing data.

-- Provider-specific display and provenance data kept separate from first-seen time.
ALTER TABLE jobs ADD COLUMN location_text TEXT;
ALTER TABLE jobs ADD COLUMN application_url TEXT;
ALTER TABLE jobs ADD COLUMN salary_text TEXT;
ALTER TABLE jobs ADD COLUMN canonical_key TEXT;
ALTER TABLE jobs ADD COLUMN last_seen_at INTEGER;
ALTER TABLE jobs ADD COLUMN last_fetched_at INTEGER;
ALTER TABLE jobs ADD COLUMN provider_updated_at INTEGER;

-- Every imported vacancy keeps its provider provenance. A vacancy that appears in
-- more than one approved source is one jobs row with multiple links, which keeps
-- counts honest and lets an individual provider fail without data loss.
CREATE TABLE IF NOT EXISTS job_source_links (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_job_id TEXT NOT NULL,
  canonical_url TEXT,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  UNIQUE(source_id, source_job_id),
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (source_id) REFERENCES sources(id)
);
CREATE INDEX IF NOT EXISTS idx_job_source_links_job ON job_source_links(job_id);
CREATE INDEX IF NOT EXISTS idx_job_source_links_seen ON job_source_links(source_id, last_seen_at);

-- Backfill existing imported jobs so refresh/expiry logic keeps working for rows
-- created before this migration.
INSERT OR IGNORE INTO job_source_links
  (id, job_id, source_id, source_job_id, canonical_url, first_seen_at, last_seen_at)
SELECT
  'legacy_' || id,
  id,
  source_id,
  source_job_id,
  canonical_url,
  COALESCE(discovered_at, created_at),
  COALESCE(last_seen_at, checked_at, updated_at, created_at)
FROM jobs
WHERE source_id IS NOT NULL AND source_job_id IS NOT NULL;

-- Query-pattern indexes for the public feed and the freshness sweep.
CREATE INDEX IF NOT EXISTS idx_jobs_published_order ON jobs(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_source_status ON jobs(source_id, status);
CREATE INDEX IF NOT EXISTS idx_jobs_canonical_key ON jobs(canonical_key);
CREATE INDEX IF NOT EXISTS idx_jobs_last_seen ON jobs(origin, status, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_job_locations_country_job ON job_locations(country_code, job_id);
CREATE INDEX IF NOT EXISTS idx_job_skills_job ON job_skills(job_id);
CREATE INDEX IF NOT EXISTS idx_job_eligible_countries_country_job ON job_eligible_countries(country_code, job_id);
CREATE INDEX IF NOT EXISTS idx_sources_enabled_permission ON sources(enabled, permission_state);

-- Verified public feeds. Each entry documents its official endpoint, attribution,
-- and provider refresh interval in config_json. Remotive explicitly asks for no
-- more than a few requests per day, so it is refreshed every six hours even though
-- the scheduler runs every thirty minutes.
INSERT OR IGNORE INTO sources
  (id, name, kind, base_url, permission_state, policy_url, reviewed_at, enabled, config_json,
   coverage, industry, countries_json, feed_url, attribution_text, created_at, updated_at)
VALUES
  ('src_remotive', 'Remotive', 'api', 'https://remotive.com', 'import_allowed',
   'https://remotive.com/remote-jobs/api', strftime('%s','now'), 1,
   '{"adapter":"remotive","min_interval_seconds":21600,"max_records":150,"timeout_ms":15000,"max_retries":2}',
   'Remote roles with stated candidate regions', 'Cross-industry', '[]',
   'https://remotive.com/api/remote-jobs?limit=200', 'Remotive (link back to the original listing)', strftime('%s','now'), strftime('%s','now')),

  ('src_remoteok', 'Remote OK', 'api', 'https://remoteok.com', 'import_allowed',
   'https://remoteok.com/api', strftime('%s','now'), 1,
   '{"adapter":"remoteok","min_interval_seconds":1800,"max_records":120,"timeout_ms":15000,"max_retries":2}',
   'Remote roles, global feed', 'Cross-industry', '[]',
   'https://remoteok.com/api', 'Remote OK (link back to the original listing)', strftime('%s','now'), strftime('%s','now')),

  ('src_arbeitnow', 'Arbeitnow', 'api', 'https://www.arbeitnow.com', 'import_allowed',
   'https://www.arbeitnow.com/blog/job-board-api', strftime('%s','now'), 1,
   '{"adapter":"arbeitnow","min_interval_seconds":1800,"max_records":100,"max_pages":2,"timeout_ms":15000,"max_retries":2}',
   'Europe-focused roles from employer ATS feeds', 'Cross-industry', '["DE","GB"]',
   'https://www.arbeitnow.com/api/job-board-api', 'Arbeitnow', strftime('%s','now'), strftime('%s','now')),

  ('src_greenhouse_vercel', 'Vercel (Greenhouse)', 'ats', 'https://job-boards.greenhouse.io/vercel', 'import_allowed',
   'https://boards-api.greenhouse.io/v1/boards/vercel/jobs', strftime('%s','now'), 1,
   '{"adapter":"greenhouse","board_token":"vercel","company":"Vercel","min_interval_seconds":1800,"max_records":80,"timeout_ms":15000,"max_retries":2}',
   'Employer job board', 'Technology', '[]',
   'https://boards-api.greenhouse.io/v1/boards/vercel/jobs?content=true', 'Vercel via Greenhouse job board', strftime('%s','now'), strftime('%s','now')),

  ('src_greenhouse_figma', 'Figma (Greenhouse)', 'ats', 'https://boards.greenhouse.io/figma', 'import_allowed',
   'https://boards-api.greenhouse.io/v1/boards/figma/jobs', strftime('%s','now'), 1,
   '{"adapter":"greenhouse","board_token":"figma","company":"Figma","min_interval_seconds":1800,"max_records":80,"timeout_ms":15000,"max_retries":2}',
   'Employer job board', 'Technology', '[]',
   'https://boards-api.greenhouse.io/v1/boards/figma/jobs?content=true', 'Figma via Greenhouse job board', strftime('%s','now'), strftime('%s','now')),

  ('src_greenhouse_discord', 'Discord (Greenhouse)', 'ats', 'https://job-boards.greenhouse.io/discord', 'import_allowed',
   'https://boards-api.greenhouse.io/v1/boards/discord/jobs', strftime('%s','now'), 1,
   '{"adapter":"greenhouse","board_token":"discord","company":"Discord","min_interval_seconds":1800,"max_records":60,"timeout_ms":15000,"max_retries":2}',
   'Employer job board', 'Technology', '[]',
   'https://boards-api.greenhouse.io/v1/boards/discord/jobs?content=true', 'Discord via Greenhouse job board', strftime('%s','now'), strftime('%s','now')),

  ('src_lever_spotify', 'Spotify (Lever)', 'ats', 'https://jobs.lever.co/spotify', 'import_allowed',
   'https://api.lever.co/v0/postings/spotify', strftime('%s','now'), 1,
   '{"adapter":"lever","board_token":"spotify","company":"Spotify","min_interval_seconds":1800,"max_records":80,"timeout_ms":15000,"max_retries":2}',
   'Employer job board', 'Technology', '[]',
   'https://api.lever.co/v0/postings/spotify?mode=json', 'Spotify via Lever job board', strftime('%s','now'), strftime('%s','now'));
