import { Hono } from 'hono'
import type { AppContext } from '../types'
import { optionalAuth } from '../middleware/auth'
import { safeHttpUrl } from '../lib/validate'

const app = new Hono<AppContext>()

type SourceRow = Record<string, any>

async function listSources(c: any, countryCode?: string) {
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, kind, base_url, permission_state, policy_url, enabled, coverage, industry, countries_json,
       attribution_text, feed_url, last_attempt_at, last_success_at, last_error, last_error_at, reviewed_at, disable_reason
     FROM sources
     WHERE permission_state != 'suspended'
     ORDER BY name ASC`
  ).all()

  const counts = await c.env.DB.prepare(
    `SELECT source_id, COUNT(*) as total FROM jobs
     WHERE status = 'published' AND origin = 'imported' AND source_id IS NOT NULL GROUP BY source_id`
  ).all()
  const countBySource = new Map((counts.results as SourceRow[]).map((row) => [row.source_id, row.total]))

  const mapped = (results as SourceRow[])
    .map((row) => {
      const url = safeHttpUrl(row.base_url)
      if (!url) return null
      let countries: string[] = []
      try {
        const parsed = JSON.parse(row.countries_json || '[]')
        if (Array.isArray(parsed)) countries = parsed.filter((code) => typeof code === 'string')
      } catch {
        countries = []
      }
      const importing = row.permission_state === 'import_allowed' && Boolean(row.enabled)
      return {
        id: row.id,
        name: row.name,
        url,
        coverage: row.coverage || 'Coverage not specified',
        kind: row.kind,
        industry: row.industry || null,
        countries,
        permission_state: row.permission_state,
        permission_label:
          row.permission_state === 'import_allowed'
            ? importing
              ? 'Approved feed'
              : 'Approved but disabled'
            : row.permission_state === 'link_only'
              ? 'External directory link'
              : 'Pending review',
        importing,
        imported_jobs: countBySource.get(row.id) || 0,
        attribution: row.attribution_text || null,
        policy_url: safeHttpUrl(row.policy_url),
        last_attempt_at: row.last_attempt_at || null,
        last_success_at: row.last_success_at || null,
        last_error: row.last_error || null,
        last_error_at: row.last_error_at || null,
        reviewed_at: row.reviewed_at || null,
        disable_reason: row.disable_reason || null,
      }
    })
    .filter((source): source is NonNullable<typeof source> => source !== null)

  if (!countryCode) return mapped
  const code = countryCode.toUpperCase()
  return mapped.filter((source) => source.countries.length === 0 || source.countries.includes(code))
}

app.get('/', optionalAuth, async (c) => {
  const country = c.req.query('country')
  const boards = await listSources(c, country)
  return c.json({
    data: boards,
    meta: {
      total: boards.length,
      importing: boards.filter((board) => board.importing).length,
      directory_links: boards.filter((board) => !board.importing).length,
      generated_at: Math.floor(Date.now() / 1000),
      note: 'External directories are listed for discovery. Only approved feeds import vacancies every 30 minutes.',
    },
  })
})

app.get('/countries/:code', optionalAuth, async (c) => {
  const code = (c.req.param('code') || '').toUpperCase()
  const country = await c.env.DB.prepare('SELECT code, name FROM countries WHERE code = ?').bind(code).first()
  if (!country) return c.json({ error: { code: 'NOT_FOUND', message: 'Country not found' } }, 404)

  const boards = await listSources(c, code)
  const counts = await c.env.DB.prepare(
    `SELECT
       SUM(CASE WHEN j.origin = 'native' THEN 1 ELSE 0 END) as native_jobs,
       SUM(CASE WHEN j.origin = 'imported' THEN 1 ELSE 0 END) as imported_jobs
     FROM jobs j
     WHERE j.status = 'published'
       AND (
         EXISTS (SELECT 1 FROM job_locations jl WHERE jl.job_id = j.id AND jl.country_code = ?)
         OR EXISTS (SELECT 1 FROM job_eligible_countries ec WHERE ec.job_id = j.id AND ec.country_code = ?)
         OR EXISTS (SELECT 1 FROM job_eligibility je WHERE je.job_id = j.id AND je.mode = 'worldwide')
       )`
  )
    .bind(code, code)
    .first<any>()

  return c.json({
    data: {
      country,
      boards,
      counts: { native: counts?.native_jobs || 0, imported: counts?.imported_jobs || 0 },
      note:
        'Coverage describes jobs visible for this country in Joblite. External links are directories, not verified vacancies.',
    },
  })
})

export default app
