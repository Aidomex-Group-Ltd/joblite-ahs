PRAGMA foreign_keys = ON;
INSERT INTO sources (id, name, kind, base_url, permission_state, enabled, attribution_text, created_at, updated_at)
VALUES ('src_e2e', 'E2E Fixture Board', 'api', 'https://jobs.example.test', 'import_allowed', 0, 'Deterministic local test fixture', strftime('%s','now'), strftime('%s','now'));
INSERT INTO jobs (id, origin, source_id, source_job_id, company_name, title, body, workplace_arrangement,
  application_method, status, published_at, discovered_at, checked_at, canonical_url, application_url,
  location_text, created_at, updated_at)
VALUES ('job_e2e', 'imported', 'src_e2e', 'fixture-1', 'Fixture Employer', 'E2E Software Engineer',
  'A deterministic role used only by the isolated end-to-end test database.', 'remote', 'external', 'published',
  strftime('%s','now'), strftime('%s','now'), strftime('%s','now'), 'https://jobs.example.test/roles/fixture-1',
  'https://jobs.example.test/roles/fixture-1/apply', 'Remote · Kenya', strftime('%s','now'), strftime('%s','now'));
