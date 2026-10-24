import { Hono } from 'hono'
import type { AppContext } from '../types'
import { nanoid } from 'nanoid'
import { requireAuth, optionalAuth } from '../middleware/auth'
import { clampInt } from '../lib/validate'
import { getSyncStatus } from '../lib/ingestion'

const app = new Hono<AppContext>()

type Row = Record<string, any>

const JOB_SELECT = `SELECT j.id, j.origin, j.title, j.body, j.employment_type, j.workplace_arrangement,
  j.application_method, j.status, j.published_at, j.discovered_at, j.checked_at, j.last_seen_at, j.last_fetched_at,
  j.expires_at, j.deadline, j.canonical_url, j.application_url, j.location_text, j.salary_text,
  j.provider_updated_at, j.organization_id, j.source_id, j.company_name,
  o.name as org_name, o.slug as org_slug, s.name as source_name, s.attribution_text as source_attribution,
  je.mode as eligibility_mode, je.evidence as eligibility_evidence
  FROM jobs j
  LEFT JOIN organizations o ON o.id = j.organization_id
  LEFT JOIN sources s ON s.id = j.source_id
  LEFT JOIN job_eligibility je ON je.job_id = j.id`

async function attachJobDetails(c: any, jobs: Row[], userId?: string) {
  if (jobs.length === 0) return jobs
  const ids = jobs.map((job) => job.id)
  const placeholders = ids.map(() => '?').join(',')
  const [salaries, locations, skills, saved, provenance] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM salary_ranges WHERE job_id IN (${placeholders})`).bind(...ids).all(),
    c.env.DB.prepare(`SELECT job_id, country_code, city, region FROM job_locations WHERE job_id IN (${placeholders})`).bind(...ids).all(),
    c.env.DB.prepare(
      `SELECT js.job_id, s.label_normalized FROM job_skills js JOIN skills s ON s.id = js.skill_id WHERE js.job_id IN (${placeholders})`
    ).bind(...ids).all(),
    userId
      ? c.env.DB.prepare(`SELECT job_id FROM saved_jobs WHERE user_id = ? AND job_id IN (${placeholders})`).bind(userId, ...ids).all()
      : Promise.resolve({ results: [] as Row[] }),
    c.env.DB.prepare(
      `SELECT l.job_id, l.source_id, s.name as source_name, l.canonical_url, l.first_seen_at, l.last_seen_at
       FROM job_source_links l JOIN sources s ON s.id = l.source_id
       WHERE l.job_id IN (${placeholders}) ORDER BY l.first_seen_at ASC`
    ).bind(...ids).all(),
  ])

  const salaryByJob = new Map<string, Row>()
  for (const row of salaries.results as Row[]) salaryByJob.set(row.job_id, row)
  const savedSet = new Set((saved.results as Row[]).map((row) => row.job_id))

  return jobs.map((job) => ({
    ...job,
    org_name: job.org_name || job.company_name || null,
    salary: salaryByJob.get(job.id) || null,
    locations: (locations.results as Row[]).filter((row) => row.job_id === job.id),
    skills: (skills.results as Row[]).filter((row) => row.job_id === job.id).map((row) => row.label_normalized),
    provenance: (provenance.results as Row[]).filter((row) => row.job_id === job.id),
    saved: savedSet.has(job.id),
  }))
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

app.get('/', optionalAuth, async (c) => {
  const q = c.req.query()
  const limit = clampInt(q.limit, 1, 100, 20)
  const offset = clampInt(q.offset, 0, 100000, 0)
  const now = Math.floor(Date.now() / 1000)
  const user = c.get('user')

  try {
    const where: string[] = [`j.status = 'published'`, `(j.expires_at IS NULL OR j.expires_at > ?)`]
    const params: unknown[] = [now]

    if (q.country) {
      const code = q.country.toUpperCase()
      if (!/^[A-Z]{2}$/.test(code)) {
        return c.json({ error: { code: 'INVALID_COUNTRY', message: 'Country must be a two-letter ISO 3166-1 code' } }, 400)
      }
      const country = await c.env.DB.prepare('SELECT name FROM countries WHERE code = ?').bind(code).first<{ name: string }>()
      where.push(`(je.mode = 'worldwide'
        OR EXISTS (SELECT 1 FROM job_eligible_countries ec WHERE ec.job_id = j.id AND ec.country_code = ?)
        OR EXISTS (SELECT 1 FROM job_locations jl WHERE jl.job_id = j.id AND jl.country_code = ?)
        OR LOWER(COALESCE(j.location_text, '')) LIKE ? ESCAPE '\\')`)
      params.push(code, code, `%${escapeLike((country?.name || code).toLowerCase())}%`)
    }

    const query = typeof q.q === 'string' ? q.q.trim().slice(0, 120) : ''
    if (query) {
      const like = `%${escapeLike(query.toLowerCase())}%`
      where.push(`(
        LOWER(j.title) LIKE ? ESCAPE '\\'
        OR LOWER(j.body) LIKE ? ESCAPE '\\'
        OR LOWER(COALESCE(o.name, j.company_name, '')) LIKE ? ESCAPE '\\'
        OR LOWER(COALESCE(j.location_text, '')) LIKE ? ESCAPE '\\'
        OR EXISTS (
          SELECT 1 FROM job_skills js JOIN skills sk ON sk.id = js.skill_id
          WHERE js.job_id = j.id AND LOWER(sk.label_normalized) LIKE ? ESCAPE '\\'
        )
        OR EXISTS (
          SELECT 1 FROM job_locations jl2
          WHERE jl2.job_id = j.id AND LOWER(COALESCE(jl2.city, '')) LIKE ? ESCAPE '\\'
        )
      )`)
      params.push(like, like, like, like, like, like)
    }

    const location = typeof q.location === 'string' ? q.location.trim().slice(0, 80) : ''
    if (location) {
      const like = `%${escapeLike(location.toLowerCase())}%`
      where.push(`(
        LOWER(COALESCE(j.location_text, '')) LIKE ? ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM job_locations jl3 WHERE jl3.job_id = j.id AND LOWER(COALESCE(jl3.city, '')) LIKE ? ESCAPE '\\')
      )`)
      params.push(like, like)
    }

    if (q.source) {
      where.push('j.source_id = ?')
      params.push(q.source)
    }
    if (q.arrangement) {
      where.push('j.workplace_arrangement = ?')
      params.push(q.arrangement)
    }
    if (q.remote === '1' || q.remote === 'true') {
      where.push(`j.workplace_arrangement = 'remote'`)
    }
    if (q.employment_type) {
      where.push('j.employment_type = ?')
      params.push(q.employment_type)
    }
    if (q.eligible === 'me') {
      if (!user) {
        return c.json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to filter jobs by your eligibility' } }, 401)
      }
      const profile = await c.env.DB.prepare('SELECT country_code FROM profiles WHERE user_id = ?').bind(user.id).first<any>()
      if (!profile?.country_code) {
        return c.json(
          { error: { code: 'PROFILE_INCOMPLETE', message: 'Add your country in Settings to filter jobs by eligibility' } },
          400
        )
      }
      where.push(`(je.mode = 'worldwide' OR EXISTS (SELECT 1 FROM job_eligible_countries ec2 WHERE ec2.job_id = j.id AND ec2.country_code = ?))`)
      params.push(profile.country_code)
    }

    const whereSql = where.join(' AND ')
    const countRow = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM jobs j
       LEFT JOIN organizations o ON o.id = j.organization_id
       LEFT JOIN job_eligibility je ON je.job_id = j.id
       WHERE ${whereSql}`
    )
      .bind(...params)
      .first<{ total: number }>()

    const catalogRow = await c.env.DB.prepare(
      "SELECT COUNT(*) as total FROM jobs WHERE status = 'published' AND (expires_at IS NULL OR expires_at > ?)"
    )
      .bind(now)
      .first<{ total: number }>()

    const { results } = await c.env.DB.prepare(
      `${JOB_SELECT} WHERE ${whereSql}
       ORDER BY COALESCE(j.published_at, j.discovered_at, j.created_at) DESC, j.id DESC
       LIMIT ? OFFSET ?`
    )
      .bind(...params, limit, offset)
      .all()

    const jobs = await attachJobDetails(c, results as Row[], user?.id)
    const total = countRow?.total ?? 0
    const sources = await c.env.DB.prepare(
      "SELECT id, name FROM sources WHERE permission_state = 'import_allowed' AND enabled = 1 ORDER BY name"
    ).all()
    const sync = await getSyncStatus(c.env)
    const sourceTotal = await c.env.DB.prepare(
      "SELECT COUNT(*) as total FROM jobs WHERE status = 'published' AND origin = 'imported'"
    ).first<{ total: number }>()

    return c.json({
      data: jobs,
      meta: {
        limit,
        offset,
        total,
        has_more: offset + jobs.length < total,
        next_offset: offset + jobs.length,
        catalog_total: catalogRow?.total ?? 0,
        imported_total: sourceTotal?.total ?? 0,
        last_updated_at: sync.last_success_at,
        generated_at: now,
        sync,
        sources: (sources.results as Row[]).map((source) => ({ id: source.id, name: source.name })),
      },
    })
  } catch (error) {
    console.error('jobs feed query failed', error instanceof Error ? error.message : 'unknown error')
    return c.json(
      { error: { code: 'FEED_UNAVAILABLE', message: 'The jobs feed is temporarily unavailable. Please retry in a moment.' } },
      503
    )
  }
})

app.get('/:id', optionalAuth, async (c) => {
  const id = c.req.param('id')
  const user = c.get('user')
  const job = await c.env.DB.prepare(`${JOB_SELECT} WHERE j.id = ?`).bind(id).first<Row>()
  if (!job) return c.json({ error: { code: 'NOT_FOUND', message: 'Job not found' } }, 404)

  if (job.status !== 'published') {
    let authorized = false
    if (user && job.organization_id) {
      const membership = await c.env.DB.prepare('SELECT id FROM memberships WHERE organization_id = ? AND user_id = ?')
        .bind(job.organization_id, user.id)
        .first()
      authorized = Boolean(membership)
    }
    if (!authorized) return c.json({ error: { code: 'NOT_FOUND', message: 'Job not found' } }, 404)
  }

  const [enriched] = await attachJobDetails(c, [job], user?.id)
  const eligible = await c.env.DB.prepare('SELECT country_code FROM job_eligible_countries WHERE job_id = ?').bind(id).all()
  return c.json({ data: { ...enriched, eligible_countries: eligible.results } })
})

app.post('/', requireAuth, async (c) => {
  const user = c.get('user')!
  const body = await c.req.json().catch(() => ({}))

  const organizationId = typeof body.organization_id === 'string' ? body.organization_id : ''
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const description = typeof body.body === 'string' ? body.body.trim() : ''
  const errors: Record<string, string> = {}
  if (!organizationId) errors.organization_id = 'Organization is required'
  if (title.length < 3) errors.title = 'Title must be at least 3 characters'
  if (description.length < 20) errors.body = 'Description must be at least 20 characters'
  if (Object.keys(errors).length > 0) {
    return c.json({ error: { code: 'INVALID', message: 'Please correct the highlighted fields', fields: errors } }, 400)
  }

  const membership = await c.env.DB.prepare(
    'SELECT id, role FROM memberships WHERE organization_id = ? AND user_id = ?'
  )
    .bind(organizationId, user.id)
    .first<any>()
  if (!membership) return c.json({ error: { code: 'FORBIDDEN', message: 'Not a member of this organization' } }, 403)
  if (!['owner', 'admin', 'recruiter'].includes(membership.role)) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Your membership role cannot create jobs' } }, 403)
  }

  const jobId = nanoid()
  const now = Math.floor(Date.now() / 1000)
  await c.env.DB.prepare(
    `INSERT INTO jobs (id, origin, organization_id, title, body, employment_type, workplace_arrangement, application_method, status, version, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      jobId,
      'native',
      organizationId,
      title,
      description,
      typeof body.employment_type === 'string' ? body.employment_type : null,
      typeof body.workplace_arrangement === 'string' ? body.workplace_arrangement : null,
      'native',
      'draft',
      1,
      now,
      now
    )
    .run()

  if (body.eligibility_mode) {
    await c.env.DB.prepare('INSERT INTO job_eligibility (id, job_id, mode, evidence) VALUES (?,?,?,?)')
      .bind(nanoid(), jobId, body.eligibility_mode, body.eligibility_evidence || null)
      .run()
  }
  if (Array.isArray(body.country_codes)) {
    for (const code of body.country_codes) {
      if (typeof code !== 'string') continue
      await c.env.DB.prepare('INSERT OR IGNORE INTO job_eligible_countries (job_id, country_code) VALUES (?,?)')
        .bind(jobId, code.toUpperCase())
        .run()
    }
  }

  return c.json({ data: { id: jobId, status: 'draft' } }, 201)
})

app.patch('/:id', requireAuth, async (c) => {
  const user = c.get('user')!
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const job = await c.env.DB.prepare('SELECT * FROM jobs WHERE id = ?').bind(id).first<any>()
  if (!job) return c.json({ error: { code: 'NOT_FOUND', message: 'Job not found' } }, 404)
  if (job.origin !== 'native') return c.json({ error: { code: 'INVALID', message: 'Imported jobs cannot be edited' } }, 400)

  const membership = await c.env.DB.prepare('SELECT role FROM memberships WHERE organization_id = ? AND user_id = ?')
    .bind(job.organization_id, user.id)
    .first<any>()
  if (!membership || !['owner', 'admin', 'recruiter'].includes(membership.role)) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403)
  }
  if (body.expected_version !== undefined && Number(body.expected_version) !== job.version) {
    return c.json({ error: { code: 'CONFLICT', message: 'This job changed since it was loaded. Refresh and retry.' } }, 409)
  }

  const fields: string[] = []
  const values: unknown[] = []
  for (const key of ['title', 'body', 'employment_type', 'workplace_arrangement']) {
    if (typeof body[key] === 'string' && body[key].trim().length > 0) {
      fields.push(`${key} = ?`)
      values.push(body[key].trim())
    }
  }
  if (fields.length === 0) return c.json({ data: { id, version: job.version } })
  fields.push('version = version + 1', 'updated_at = ?')
  values.push(Math.floor(Date.now() / 1000), id)
  await c.env.DB.prepare(`UPDATE jobs SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run()
  return c.json({ data: { id, version: job.version + 1 } })
})

app.post('/:id/publish', requireAuth, async (c) => {
  const user = c.get('user')!
  const id = c.req.param('id')
  const job = await c.env.DB.prepare('SELECT * FROM jobs WHERE id = ?').bind(id).first<any>()
  if (!job) return c.json({ error: { code: 'NOT_FOUND', message: 'Job not found' } }, 404)
  if (job.origin !== 'native' || job.application_method !== 'native') {
    return c.json({ error: { code: 'INVALID', message: 'Only native jobs can be published via this endpoint' } }, 400)
  }

  const membership = await c.env.DB.prepare('SELECT role FROM memberships WHERE organization_id = ? AND user_id = ?')
    .bind(job.organization_id, user.id)
    .first<any>()
  if (!membership || !['owner', 'admin', 'recruiter'].includes(membership.role)) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403)
  }

  const now = Math.floor(Date.now() / 1000)
  await c.env.DB.prepare('UPDATE jobs SET status = ?, published_at = COALESCE(published_at, ?), updated_at = ?, version = version + 1 WHERE id = ?')
    .bind('published', now, now, id)
    .run()
  await c.env.DB.prepare(
    "INSERT INTO outbox (id, event_id, event_type, payload_json, state, created_at) VALUES (?,?,?,?,'pending',?)"
  )
    .bind(nanoid(), nanoid(), 'job.published', JSON.stringify({ job_id: id, organization_id: job.organization_id }), now)
    .run()
  return c.json({ data: { id, status: 'published', published_at: now } })
})

app.post('/:id/close', requireAuth, async (c) => {
  const user = c.get('user')!
  const id = c.req.param('id')
  const job = await c.env.DB.prepare('SELECT * FROM jobs WHERE id = ?').bind(id).first<any>()
  if (!job) return c.json({ error: { code: 'NOT_FOUND', message: 'Job not found' } }, 404)
  const membership = await c.env.DB.prepare('SELECT role FROM memberships WHERE organization_id = ? AND user_id = ?')
    .bind(job.organization_id, user.id)
    .first<any>()
  if (!membership || !['owner', 'admin', 'recruiter'].includes(membership.role)) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403)
  }
  await c.env.DB.prepare("UPDATE jobs SET status = 'closed', updated_at = ?, version = version + 1 WHERE id = ?")
    .bind(Math.floor(Date.now() / 1000), id)
    .run()
  return c.json({ data: { id, status: 'closed' } })
})

app.post('/:id/save', requireAuth, async (c) => {
  const user = c.get('user')!
  const id = c.req.param('id')
  const job = await c.env.DB.prepare("SELECT id FROM jobs WHERE id = ? AND status = 'published'").bind(id).first()
  if (!job) return c.json({ error: { code: 'NOT_FOUND', message: 'Job not found' } }, 404)
  await c.env.DB.prepare('INSERT OR IGNORE INTO saved_jobs (user_id, job_id) VALUES (?,?)').bind(user.id, id).run()
  return c.json({ data: { saved: true } })
})

app.delete('/:id/save', requireAuth, async (c) => {
  const user = c.get('user')!
  const id = c.req.param('id')
  const job = await c.env.DB.prepare('SELECT id FROM jobs WHERE id = ?').bind(id).first()
  if (!job) return c.json({ error: { code: 'NOT_FOUND', message: 'Job not found' } }, 404)
  await c.env.DB.prepare('DELETE FROM saved_jobs WHERE user_id = ? AND job_id = ?').bind(user.id, id).run()
  return c.json({ data: { saved: false } })
})

export default app
