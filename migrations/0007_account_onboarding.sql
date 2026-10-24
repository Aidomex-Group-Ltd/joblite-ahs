-- Capture the user's initial Joblite journey without inferring it from email.
CREATE TABLE IF NOT EXISTS user_onboarding (
  user_id TEXT PRIMARY KEY,
  account_type TEXT NOT NULL DEFAULT 'candidate' CHECK (account_type IN ('candidate','employer','both')),
  experience_level TEXT CHECK (experience_level IS NULL OR experience_level IN ('student','entry','mid','senior','executive','career_change','not_sure')),
  desired_role TEXT,
  employer_title TEXT,
  organization_id TEXT,
  completed_at INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_user_onboarding_account_type ON user_onboarding(account_type);
