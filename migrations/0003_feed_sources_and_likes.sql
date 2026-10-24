-- Additive migration: feed engagement, media metadata, source freshness and directory seed.
-- Never drops or rewrites existing data.

-- Post likes
CREATE TABLE IF NOT EXISTS post_likes (
  post_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  PRIMARY KEY (post_id, user_id),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_post_likes_post ON post_likes(post_id);

-- Media metadata used by the renderer and upload validation
ALTER TABLE media ADD COLUMN mime_type TEXT;
ALTER TABLE media ADD COLUMN width INTEGER;
ALTER TABLE media ADD COLUMN height INTEGER;
CREATE INDEX IF NOT EXISTS idx_media_object_key ON media(object_key);

-- Imported job company label (organizations are only created by their owners)
ALTER TABLE jobs ADD COLUMN company_name TEXT;
CREATE INDEX IF NOT EXISTS idx_jobs_imported_checked ON jobs(origin, checked_at);

-- Source registry freshness and directory metadata
ALTER TABLE sources ADD COLUMN last_attempt_at INTEGER;
ALTER TABLE sources ADD COLUMN last_success_at INTEGER;
ALTER TABLE sources ADD COLUMN last_error TEXT;
ALTER TABLE sources ADD COLUMN last_error_at INTEGER;
ALTER TABLE sources ADD COLUMN coverage TEXT;
ALTER TABLE sources ADD COLUMN industry TEXT;
ALTER TABLE sources ADD COLUMN countries_json TEXT;
ALTER TABLE sources ADD COLUMN feed_url TEXT;
ALTER TABLE sources ADD COLUMN attribution_text TEXT;
CREATE INDEX IF NOT EXISTS idx_sources_permission ON sources(permission_state, enabled);

-- Link-only external directory entries. These are external directories, not approved
-- ingestion feeds: permission_state 'link_only' never runs an adapter.
INSERT OR IGNORE INTO sources
  (id, name, kind, base_url, permission_state, enabled, coverage, industry, attribution_text)
VALUES
  ('src_greenhouse_directory', 'Greenhouse job boards', 'directory', 'https://boards.greenhouse.io', 'link_only', 0, 'Global (per-employer boards)', 'Cross-industry', 'External directory'),
  ('src_lever_directory', 'Lever job boards', 'directory', 'https://jobs.lever.co', 'link_only', 0, 'Global (per-employer boards)', 'Cross-industry', 'External directory'),
  ('src_ashby_directory', 'Ashby job boards', 'directory', 'https://jobs.ashbyhq.com', 'link_only', 0, 'Global (per-employer boards)', 'Cross-industry', 'External directory'),
  ('src_workable_directory', 'Workable job boards', 'directory', 'https://jobs.workable.com', 'link_only', 0, 'Global (per-employer boards)', 'Cross-industry', 'External directory'),
  ('src_wellfound_directory', 'Wellfound', 'directory', 'https://wellfound.com/jobs', 'link_only', 0, 'Global', 'Startups and technology', 'External directory'),
  ('src_un_careers_directory', 'UN Careers', 'directory', 'https://careers.un.org', 'link_only', 0, 'Global', 'International public sector', 'External directory'),
  ('src_reliefweb_directory', 'ReliefWeb Jobs', 'directory', 'https://reliefweb.int/jobs', 'link_only', 0, 'Global', 'Humanitarian and development', 'External directory'),
  ('src_remoteok_directory', 'Remote OK', 'directory', 'https://remoteok.com', 'link_only', 0, 'Remote worldwide', 'Technology', 'External directory');
