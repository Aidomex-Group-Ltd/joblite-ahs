-- Non-destructive additions for short, resumable onboarding preferences and job alerts
ALTER TABLE user_onboarding ADD COLUMN status TEXT NOT NULL DEFAULT 'in_progress';
ALTER TABLE user_onboarding ADD COLUMN current_step INTEGER NOT NULL DEFAULT 1;
ALTER TABLE user_onboarding ADD COLUMN country_code TEXT;
ALTER TABLE user_onboarding ADD COLUMN city TEXT;
ALTER TABLE user_onboarding ADD COLUMN skills_json TEXT;
ALTER TABLE user_onboarding ADD COLUMN work_preference TEXT;
ALTER TABLE user_onboarding ADD COLUMN employment_types_json TEXT;
ALTER TABLE user_onboarding ADD COLUMN organization_name TEXT;
ALTER TABLE user_onboarding ADD COLUMN organization_country TEXT;
ALTER TABLE user_onboarding ADD COLUMN organization_city TEXT;
ALTER TABLE user_onboarding ADD COLUMN organization_website TEXT;
ALTER TABLE user_onboarding ADD COLUMN expected_roles TEXT;
ALTER TABLE user_onboarding ADD COLUMN job_alerts_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_onboarding ADD COLUMN notification_channels_json TEXT;
ALTER TABLE user_onboarding ADD COLUMN alert_frequency TEXT DEFAULT 'daily';
ALTER TABLE user_onboarding ADD COLUMN created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'));
ALTER TABLE user_onboarding ADD COLUMN updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'));

CREATE INDEX IF NOT EXISTS idx_user_onboarding_status ON user_onboarding(status);
