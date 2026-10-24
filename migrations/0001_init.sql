-- Joblite AHS Initial Schema
PRAGMA foreign_keys = ON;

-- Users and auth
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email_normalized TEXT UNIQUE NOT NULL,
  verified_at INTEGER,
  display_name TEXT,
  state TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT UNIQUE NOT NULL,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS auth_challenges (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  purpose TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS idx_auth_challenges_email ON auth_challenges(email_normalized);

-- Countries
CREATE TABLE IF NOT EXISTS countries (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  region TEXT,
  is_territory INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_countries_name ON countries(name);

-- Organizations and memberships
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  verification_state TEXT NOT NULL DEFAULT 'unverified',
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  UNIQUE(organization_id, user_id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);

-- Profiles
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT UNIQUE NOT NULL,
  handle TEXT UNIQUE NOT NULL,
  headline TEXT,
  bio TEXT,
  country_code TEXT,
  visibility TEXT NOT NULL DEFAULT 'public',
  cv_media_id TEXT,
  availability TEXT,
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (country_code) REFERENCES countries(code)
);
CREATE INDEX IF NOT EXISTS idx_profiles_handle ON profiles(handle);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  label_normalized TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS profile_skills (
  profile_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  PRIMARY KEY (profile_id, skill_id),
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS education (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  organization TEXT,
  qualification TEXT,
  start_date TEXT,
  end_date TEXT,
  description TEXT,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS experience (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  organization TEXT,
  role TEXT,
  start_date TEXT,
  end_date TEXT,
  description TEXT,
  current INTEGER DEFAULT 0,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS profile_links (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  url TEXT NOT NULL,
  label TEXT,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- Media
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  object_key TEXT NOT NULL,
  provider_id TEXT,
  purpose TEXT NOT NULL,
  type TEXT NOT NULL,
  size INTEGER,
  state TEXT NOT NULL DEFAULT 'quarantined',
  alt_text TEXT,
  caption TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS idx_media_owner ON media(owner_id);

-- Jobs
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  origin TEXT NOT NULL DEFAULT 'native',
  organization_id TEXT,
  source_id TEXT,
  source_job_id TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  employment_type TEXT,
  workplace_arrangement TEXT,
  application_method TEXT NOT NULL DEFAULT 'native',
  status TEXT NOT NULL DEFAULT 'draft',
  published_at INTEGER,
  discovered_at INTEGER,
  checked_at INTEGER,
  expires_at INTEGER,
  deadline TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  canonical_url TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_source_unique ON jobs(source_id, source_job_id) WHERE source_id IS NOT NULL AND source_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_status_published ON jobs(status, published_at);

CREATE TABLE IF NOT EXISTS job_locations (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  country_code TEXT,
  city TEXT,
  region TEXT,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS job_eligibility (
  id TEXT PRIMARY KEY,
  job_id TEXT UNIQUE NOT NULL,
  mode TEXT NOT NULL DEFAULT 'unknown',
  evidence TEXT,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS job_eligible_countries (
  job_id TEXT NOT NULL,
  country_code TEXT NOT NULL,
  PRIMARY KEY (job_id, country_code),
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (country_code) REFERENCES countries(code)
);

CREATE TABLE IF NOT EXISTS job_skills (
  job_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  PRIMARY KEY (job_id, skill_id),
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS salary_ranges (
  job_id TEXT PRIMARY KEY,
  min_minor INTEGER,
  max_minor INTEGER,
  currency TEXT,
  period TEXT,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

-- Posts (feed)
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL,
  organization_id TEXT,
  job_id TEXT,
  body TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'public',
  state TEXT NOT NULL DEFAULT 'published',
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  FOREIGN KEY (author_id) REFERENCES users(id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at);

CREATE TABLE IF NOT EXISTS post_media (
  post_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  ordering INTEGER DEFAULT 0,
  alt_text TEXT,
  caption TEXT,
  PRIMARY KEY (post_id, media_id),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  body TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'published',
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS follows (
  follower_id TEXT NOT NULL,
  followee_id TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  PRIMARY KEY (follower_id, followee_id),
  FOREIGN KEY (follower_id) REFERENCES users(id),
  FOREIGN KEY (followee_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS saved_jobs (
  user_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  PRIMARY KEY (user_id, job_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

-- Applications and ATS
CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'submitted',
  version INTEGER NOT NULL DEFAULT 1,
  submitted_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  UNIQUE(candidate_id, job_id),
  FOREIGN KEY (candidate_id) REFERENCES users(id),
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);
CREATE INDEX IF NOT EXISTS idx_applications_job ON applications(job_id);
CREATE INDEX IF NOT EXISTS idx_applications_candidate ON applications(candidate_id);

CREATE TABLE IF NOT EXISTS application_snapshots (
  id TEXT PRIMARY KEY,
  application_id TEXT UNIQUE NOT NULL,
  profile_json TEXT NOT NULL,
  job_json TEXT NOT NULL,
  cv_media_id TEXT,
  schema_version TEXT NOT NULL DEFAULT 'v1',
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS application_events (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL,
  actor_id TEXT,
  actor_type TEXT NOT NULL DEFAULT 'system',
  event_type TEXT NOT NULL,
  old_stage TEXT,
  new_stage TEXT,
  candidate_visible INTEGER NOT NULL DEFAULT 1,
  metadata_json TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_app_events_app ON application_events(application_id);

CREATE TABLE IF NOT EXISTS employer_notes (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL,
  author_membership_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS interviews (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL,
  scheduled_at INTEGER,
  timezone TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  details TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS offers (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  terms_json TEXT,
  issued_at INTEGER,
  expires_at INTEGER,
  response TEXT,
  responded_at INTEGER,
  status TEXT NOT NULL DEFAULT 'draft',
  superseded_by TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS external_application_trackers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  self_reported_status TEXT NOT NULL DEFAULT 'applied',
  marked_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  UNIQUE(user_id, job_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

-- Sources
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  base_url TEXT,
  permission_state TEXT NOT NULL DEFAULT 'pending_review',
  policy_url TEXT,
  reviewed_at INTEGER,
  disable_reason TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  config_json TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS source_runs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  checkpoint_json TEXT,
  counts_json TEXT,
  errors_json TEXT,
  started_at INTEGER,
  finished_at INTEGER,
  FOREIGN KEY (source_id) REFERENCES sources(id)
);

-- Notifications and outbox
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT,
  read_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  UNIQUE(user_id, event_key),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);

CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,
  event_id TEXT UNIQUE NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER,
  state TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  processed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox(state, next_attempt_at);

CREATE TABLE IF NOT EXISTS saved_searches (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  filters_json TEXT NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'daily',
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  body TEXT,
  state TEXT NOT NULL DEFAULT 'open',
  resolution TEXT,
  actor_id TEXT,
  resolved_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  organization_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  metadata_json TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_events(organization_id);
