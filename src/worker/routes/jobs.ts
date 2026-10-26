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
  j.provider_updated_at, j.organization_id, j.source_id, j.company_name, j.application_questions_json, j.archived_at,
  o.name as org_name, o.slug as org_slug, s.name as source_name, s.attribution_text as source_attribution,
  je.mode as eligibility_mode, je.evidence as eligibility_evidence
  FROM jobs j
  LEFT JOIN organizations o ON o.id = j.organization_id
  LEFT JOIN sources s ON s.id = j.source_id
  LEFT JOIN job_eligibility je ON je.job_id = j.id`

function parseApplicationQuestions(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 5) return null
  const questions: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim() || item.trim().length > 240) return null
    const question = item.trim()
    if (questions.includes(question)) return null
    questions.push(question)
  }
  return questions
}

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

    let userCountry: string | null = null
    if (user && !q.country) {
      const onboarding = await c.env.DB.prepare(
        'SELECT country_code FROM user_onboarding WHERE user_id = ?'
      ).bind(user.id).first<{ country_code: string | null }>()
      userCountry = onboarding?.country_code || null
      if (!userCountry) {
        const profile = await c.env.DB.prepare(
          'SELECT country_code FROM profiles WHERE user_id = ?'
        ).bind(user.id).first<{ country_code: string | null }>()
        userCountry = profile?.country_code || null
      }
    }

    let orderSql = 'ORDER BY COALESCE(j.published_at, j.discovered_at, j.created_at) DESC, j.id DESC'
    const orderParams: unknown[] = []
    if (userCountry) {
      orderSql = `ORDER BY (CASE
        WHEN EXISTS (SELECT 1 FROM job_locations jl_pref WHERE jl_pref.job_id = j.id AND jl_pref.country_code = ?) THEN 0
        WHEN je.mode = 'worldwide' OR EXISTS (SELECT 1 FROM job_eligible_countries ec_pref WHERE ec_pref.job_id = j.id AND ec_pref.country_code = ?) THEN 1
        WHEN j.workplace_arrangement = 'remote' THEN 2
        ELSE 3
      END) ASC, COALESCE(j.published_at, j.discovered_at, j.created_at) DESC, j.id DESC`
      orderParams.push(userCountry, userCountry)
    }

    const { results } = await c.env.DB.prepare(
      `${JOB_SELECT} WHERE ${whereSql}
       ${orderSql}
       LIMIT ? OFFSET ?`
    )
      .bind(...params, ...orderParams, limit, offset)
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
  const questions = body.application_questions === undefined ? [] : parseApplicationQuestions(body.application_questions)
  const errors: Record<string, string> = {}
  if (!organizationId) errors.organization_id = 'Organization is required'
  if (title.length < 3 || title.length > 160) errors.title = 'Title must be between 3 and 160 characters'
  if (description.length < 20 || description.length > 20000) errors.body = 'Description must be between 20 and 20,000 characters'
  if (questions === null) errors.application_questions = 'Use up to five distinct questions, each 240 characters or fewer'
  const employmentType = body.employment_type === undefined || body.employment_type === null || body.employment_type === ''
    ? null
    : typeof body.employment_type === 'string' ? body.employment_type.trim() : null
  if (body.employment_type !== undefined && body.employment_type !== null &&
      (typeof body.employment_type !== 'string' || body.employment_type.trim().length > 100)) {
    errors.employment_type = 'Employment type must be text up to 100 characters'
  }
  const workplaceArrangement = body.workplace_arrangement === undefined || body.workplace_arrangement === null || body.workplace_arrangement === ''
    ? null
    : typeof body.workplace_arrangement === 'string' ? body.workplace_arrangement : ''
  if (body.workplace_arrangement !== undefined && body.workplace_arrangement !== null &&
      (typeof body.workplace_arrangement !== 'string' || !['', 'remote', 'hybrid', 'onsite'].includes(workplaceArrangement || ''))) {
    errors.workplace_arrangement = 'Choose remote, hybrid, onsite, or leave it unspecified'
  }
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
  const countryCodes: string[] = Array.isArray(body.country_codes)
    ? [...new Set<string>(body.country_codes.map((code: unknown) => typeof code === 'string' ? code.toUpperCase() : ''))]
    : []
  if (countryCodes.length > 250 || countryCodes.some((code) => !/^[A-Z]{2}$/.test(code))) {
    return c.json({ error: { code: 'INVALID', message: 'Provide valid ISO country codes' } }, 400)
  }
  const eligibilityMode = typeof body.eligibility_mode === 'string' ? body.eligibility_mode : null
  if (body.eligibility_mode !== undefined &&
      (!eligibilityMode || !['worldwide', 'countries', 'unknown'].includes(eligibilityMode))) {
    return c.json({ error: { code: 'INVALID', message: 'Choose worldwide, countries, or unknown eligibility' } }, 400)
  }
  const foundCountries = countryCodes.length
    ? await c.env.DB.prepare(`SELECT code FROM countries WHERE code IN (${countryCodes.map(() => '?').join(',')})`)
      .bind(...countryCodes).all<{ code: string }>()
    : { results: [] }
  if (foundCountries.results.length !== countryCodes.length) {
    return c.json({ error: { code: 'INVALID', message: 'One or more country codes are not in the country directory' } }, 400)
  }
  const statements = [
    c.env.DB.prepare(
      `INSERT INTO jobs (id, origin, organization_id, title, body, employment_type, workplace_arrangement, application_method, status, version, application_questions_json, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      jobId,
      'native',
      organizationId,
      title,
      description,
      employmentType,
      workplaceArrangement,
      'native',
      'draft',
      1,
      JSON.stringify(questions),
      now,
      now
    ),
  ]
  if (eligibilityMode) {
    statements.push(c.env.DB.prepare('INSERT INTO job_eligibility (id, job_id, mode, evidence) VALUES (?,?,?,?)')
      .bind(nanoid(), jobId, eligibilityMode, typeof body.eligibility_evidence === 'string' ? body.eligibility_evidence.slice(0, 1000) : null))
  }
  if (countryCodes.length) {
    const countryValues: unknown[] = []
    for (const code of countryCodes) countryValues.push(jobId, code)
    statements.push(c.env.DB.prepare(
      `INSERT INTO job_eligible_countries (job_id, country_code) VALUES ${countryCodes.map(() => '(?,?)').join(',')}`
    ).bind(...countryValues))
  }
  statements.push(c.env.DB.prepare(
    `INSERT INTO audit_events (id, actor_id, organization_id, action, target_type, target_id, metadata_json, created_at)
     SELECT ?, ?, ?, 'job.created', 'job', ?, '{"status":"draft"}', ? WHERE EXISTS (SELECT 1 FROM jobs WHERE id = ?)`
  ).bind(nanoid(), user.id, organizationId, jobId, now, jobId))
  await c.env.DB.batch(statements)

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
  if (job.archived_at) return c.json({ error: { code: 'ARCHIVED', message: 'Archived jobs cannot be edited' } }, 409)
  if (!Number.isInteger(body.expected_version) || body.expected_version !== job.version) {
    return c.json({ error: { code: 'CONFLICT', message: 'This job changed since it was loaded. Refresh and retry.' } }, 409)
  }

  const allowedFields = new Set(['expected_version', 'title', 'body', 'employment_type', 'workplace_arrangement', 'application_questions'])
  if (Object.keys(body).some((key) => !allowedFields.has(key))) {
    return c.json({ error: { code: 'INVALID', message: 'Only supported job fields can be edited' } }, 400)
  }
  const fields: string[] = []
  const values: unknown[] = []
  const editableStrings = ['title', 'body', 'employment_type', 'workplace_arrangement'] as const
  for (const key of editableStrings) {
    if (body[key] !== undefined) {
      if (typeof body[key] !== 'string') return c.json({ error: { code: 'INVALID', message: `${key} must be text` } }, 400)
      const value = body[key].trim()
      if ((key === 'title' && (value.length < 3 || value.length > 160)) ||
          (key === 'body' && (value.length < 20 || value.length > 20000)) ||
          (key === 'employment_type' && value.length > 100) ||
          (key === 'workplace_arrangement' && value !== '' && !['remote', 'hybrid', 'onsite'].includes(value))) {
        return c.json({ error: { code: 'INVALID', message: `${key} is not valid` } }, 400)
      }
      fields.push(`${key} = ?`)
      values.push(value || (key === 'employment_type' || key === 'workplace_arrangement' ? null : ''))
    }
  }
  if (body.application_questions !== undefined) {
    const questions = parseApplicationQuestions(body.application_questions)
    if (!questions) return c.json({ error: { code: 'INVALID', message: 'Use up to five distinct questions, each 240 characters or fewer' } }, 400)
    fields.push('application_questions_json = ?')
    values.push(JSON.stringify(questions))
  }
  if (fields.length === 0) return c.json({ error: { code: 'INVALID', message: 'Provide at least one job field to update' } }, 400)
  const now = Math.floor(Date.now() / 1000)
  const auditId = nanoid()
  fields.push('version = version + 1', 'updated_at = ?')
  values.push(now, id, job.version)
  const results = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE jobs SET ${fields.join(', ')} WHERE id = ? AND version = ? AND archived_at IS NULL`).bind(...values),
    c.env.DB.prepare(
      `INSERT INTO audit_events (id, actor_id, organization_id, action, target_type, target_id, metadata_json, created_at)
       SELECT ?, ?, ?, 'job.updated', 'job', ?, ?, ? WHERE changes() = 1`
    ).bind(auditId, user.id, job.organization_id, id, JSON.stringify({ fields: Object.keys(body).filter((key) => key !== 'expected_version') }), now),
  ])
  if ((results[0] as any)?.meta?.changes !== 1) return c.json({ error: { code: 'CONFLICT', message: 'This job changed; refresh and retry.' } }, 409)
  return c.json({ data: { id, version: job.version + 1 } })
})

app.post('/:id/publish', requireAuth, async (c) => {
  const user = c.get('user')!
  const id = c.req.param('id')
  const job = await c.env.DB.prepare('SELECT * FROM jobs WHERE id = ?').bind(id).first<any>()
  if (!job) return c.json({ error: { code: 'NOT_FOUND', message: 'Job not found' } }, 404)
  if (job.archived_at) return c.json({ error: { code: 'ARCHIVED', message: 'Archived jobs cannot be published' } }, 409)
  if (job.status === 'closed') {
    return c.json({ error: { code: 'REOPEN_CONFIRMATION_REQUIRED', message: 'Reopen this job with an explicit reason before publishing it again' } }, 409)
  }
  if (job.origin !== 'native' || job.application_method !== 'native') {
    return c.json({ error: { code: 'INVALID', message: 'Only native jobs can be published via this endpoint' } }, 400)
  }

  const membership = await c.env.DB.prepare('SELECT role FROM memberships WHERE organization_id = ? AND user_id = ?')
    .bind(job.organization_id, user.id)
    .first<any>()
  if (!membership || !['owner', 'admin', 'recruiter'].includes(membership.role)) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403)
  }

  const body = await c.req.json().catch(() => ({}))
  if (!Number.isInteger(body.expected_version) || body.expected_version !== job.version) {
    return c.json({ error: { code: 'CONFLICT', message: 'This job changed; refresh and retry.' } }, 409)
  }
  const now = Math.floor(Date.now() / 1000)
  const auditId = nanoid()
  const eventId = nanoid()
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE jobs SET status = 'published', published_at = COALESCE(published_at, ?), updated_at = ?, version = version + 1 WHERE id = ? AND version = ? AND archived_at IS NULL"
    ).bind(now, now, id, job.version),
    c.env.DB.prepare(
      `INSERT INTO audit_events (id, actor_id, organization_id, action, target_type, target_id, metadata_json, created_at)
       SELECT ?, ?, ?, 'job.published', 'job', ?, ?, ? WHERE changes() = 1`
    ).bind(auditId, user.id, job.organization_id, id, JSON.stringify({ version: job.version + 1 }), now),
    c.env.DB.prepare(
      `INSERT INTO outbox (id, event_id, event_type, payload_json, state, created_at)
       SELECT ?, ?, 'job.published', ?, 'pending', ? WHERE EXISTS (SELECT 1 FROM audit_events WHERE id = ?)`
    ).bind(nanoid(), eventId, JSON.stringify({ job_id: id, organization_id: job.organization_id }), now, auditId),
  ])
  if ((results[0] as any)?.meta?.changes !== 1) return c.json({ error: { code: 'CONFLICT', message: 'This job changed; refresh and retry.' } }, 409)
  return c.json({ data: { id, status: 'published', published_at: now } })
})

app.post('/:id/close', requireAuth, async (c) => {
  const user = c.get('user')!
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const job = await c.env.DB.prepare('SELECT * FROM jobs WHERE id = ?').bind(id).first<any>()
  if (!job) return c.json({ error: { code: 'NOT_FOUND', message: 'Job not found' } }, 404)
  const membership = await c.env.DB.prepare('SELECT role FROM memberships WHERE organization_id = ? AND user_id = ?')
    .bind(job.organization_id, user.id)
    .first<any>()
  if (!membership || !['owner', 'admin', 'recruiter'].includes(membership.role)) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403)
  }
  if (job.status === 'closed') return c.json({ data: { id, status: 'closed', version: job.version } })
  const now = Math.floor(Date.now() / 1000)
  const auditId = nanoid()
  const expectedVersion = Number.isInteger(body.expected_version) ? body.expected_version : null
  if (expectedVersion !== null && expectedVersion !== job.version) {
    return c.json({ error: { code: 'CONFLICT', message: 'This job changed; refresh and retry.' } }, 409)
  }
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE jobs SET status = 'closed', updated_at = ?, version = version + 1
       WHERE id = ? AND (? IS NULL OR version = ?) AND NOT EXISTS (
         SELECT 1 FROM applications WHERE job_id = jobs.id AND stage IN ('submitted','in_review','shortlisted','interview','offer')
       )`
    ).bind(now, id, expectedVersion, expectedVersion),
    c.env.DB.prepare(
      `INSERT INTO audit_events (id, actor_id, organization_id, action, target_type, target_id, metadata_json, created_at)
       SELECT ?, ?, ?, 'job.closed', 'job', ?, '{}', ? WHERE changes() = 1`
    ).bind(auditId, user.id, job.organization_id, id, now),
  ])
  if ((results[0] as any)?.meta?.changes !== 1) {
    const latest = await c.env.DB.prepare('SELECT version FROM jobs WHERE id = ?').bind(id).first<{ version: number }>()
    return c.json({ error: { code: latest?.version !== job.version ? 'CONFLICT' : 'ACTIVE_APPLICANTS', message: latest?.version !== job.version ? 'This job changed; refresh and retry.' : 'Resolve active applications before closing.' } }, 409)
  }
  return c.json({ data: { id, status: 'closed' } })
})

app.post('/:id/archive', requireAuth, async (c) => {
  const user = c.get('user')!
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const job = await c.env.DB.prepare(
    'SELECT id, origin, organization_id, status, version, archived_at FROM jobs WHERE id = ?'
  ).bind(id).first<any>()
  if (!job) return c.json({ error: { code: 'NOT_FOUND', message: 'Job not found' } }, 404)
  if (job.origin !== 'native') return c.json({ error: { code: 'INVALID', message: 'Imported jobs cannot be archived' } }, 400)
  const membership = await c.env.DB.prepare('SELECT role FROM memberships WHERE organization_id = ? AND user_id = ?')
    .bind(job.organization_id, user.id).first<any>()
  if (!membership || !['owner', 'admin', 'recruiter'].includes(membership.role)) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403)
  }
  if (job.status !== 'closed') return c.json({ error: { code: 'INVALID_STATE', message: 'Close the vacancy before archiving it' } }, 409)
  if (job.archived_at) return c.json({ data: { id, archived_at: job.archived_at, version: job.version } })
  if (!Number.isInteger(body.expected_version) || body.expected_version !== job.version) {
    return c.json({ error: { code: 'CONFLICT', message: 'This job changed; refresh and retry.' } }, 409)
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 1000) : ''
  if (!reason) return c.json({ error: { code: 'REASON_REQUIRED', message: 'Provide a reason for archiving this job' } }, 400)
  const now = Math.floor(Date.now() / 1000)
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE jobs SET archived_at = ?, version = version + 1, updated_at = ?
       WHERE id = ? AND status = 'closed' AND archived_at IS NULL AND version = ?`
    ).bind(now, now, id, job.version),
    c.env.DB.prepare(
      `INSERT INTO audit_events (id, actor_id, organization_id, action, target_type, target_id, metadata_json, created_at)
       SELECT ?, ?, ?, 'job.archived', 'job', ?, ?, ? WHERE changes() = 1`
    ).bind(nanoid(), user.id, job.organization_id, id, JSON.stringify({ reason, version: job.version + 1 }), now),
  ])
  if ((results[0] as any)?.meta?.changes !== 1) {
    return c.json({ error: { code: 'CONFLICT', message: 'This job changed; refresh and retry.' } }, 409)
  }
  return c.json({ data: { id, archived_at: now, version: job.version + 1 } })
})

app.patch('/:id/status', requireAuth, async (c) => {
  const user = c.get('user')!
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const job = await c.env.DB.prepare('SELECT id, origin, organization_id, status, version, archived_at FROM jobs WHERE id = ?').bind(id).first<any>()
  if (!job) return c.json({ error: { code: 'NOT_FOUND', message: 'Job not found' } }, 404)
  if (job.origin !== 'native') return c.json({ error: { code: 'INVALID', message: 'Imported job status is controlled by its source' } }, 400)
  const membership = await c.env.DB.prepare('SELECT role FROM memberships WHERE organization_id = ? AND user_id = ?')
    .bind(job.organization_id, user.id).first<any>()
  if (!membership || !['owner', 'admin', 'recruiter'].includes(membership.role)) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403)
  }
  if (job.archived_at) return c.json({ error: { code: 'ARCHIVED', message: 'Archived jobs cannot be reopened or changed' } }, 409)
  if (!['draft', 'published', 'paused', 'closed'].includes(body.status)) {
    return c.json({ error: { code: 'INVALID', message: 'Choose draft, published, paused, or closed' } }, 400)
  }
  if (!Number.isInteger(body.expected_version) || body.expected_version !== job.version) {
    return c.json({ error: { code: 'CONFLICT', message: 'This job changed since it was loaded. Refresh and retry.' } }, 409)
  }
  if (body.status === job.status) return c.json({ data: { id, status: job.status, version: job.version } })
  if (job.status === 'closed' && body.status !== 'closed' && (body.reopen_confirmed !== true || typeof body.reason !== 'string' || !body.reason.trim())) {
    return c.json({ error: { code: 'REOPEN_CONFIRMATION_REQUIRED', message: 'Reopening a closed vacancy requires confirmation and a reason' } }, 400)
  }
  if (body.status === 'closed') {
    const active = await c.env.DB.prepare(
      "SELECT COUNT(*) AS total FROM applications WHERE job_id = ? AND stage IN ('submitted','in_review','shortlisted','interview','offer')"
    ).bind(id).first<{ total: number }>()
    if (active?.total) return c.json({ error: { code: 'ACTIVE_APPLICANTS', message: 'Resolve active applications before closing this vacancy' } }, 409)
  }
  const now = Math.floor(Date.now() / 1000)
  const eventId = nanoid()
  const auditId = nanoid()
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
    `UPDATE jobs SET status = ?, published_at = CASE WHEN ? = 'published' THEN COALESCE(published_at, ?) ELSE published_at END,
     updated_at = ?, version = version + 1 WHERE id = ? AND version = ?
       AND (? != 'closed' OR NOT EXISTS (
         SELECT 1 FROM applications WHERE job_id = jobs.id AND stage IN ('submitted','in_review','shortlisted','interview','offer')
       ))`
    ).bind(body.status, body.status, now, now, id, job.version, body.status),
    c.env.DB.prepare(
      `INSERT INTO audit_events (id, actor_id, organization_id, action, target_type, target_id, metadata_json, created_at)
       SELECT ?, ?, ?, 'job.status_changed', 'job', ?, ?, ? WHERE changes() = 1`
    ).bind(auditId, user.id, job.organization_id, id, JSON.stringify({ from: job.status, to: body.status, reason: typeof body.reason === 'string' ? body.reason.trim().slice(0, 1000) : null, version: job.version + 1 }), now),
    c.env.DB.prepare(
      `INSERT INTO outbox (id, event_id, event_type, payload_json, state, created_at)
       SELECT ?, ?, 'job.published', ?, 'pending', ? WHERE ? = 'published' AND EXISTS (SELECT 1 FROM audit_events WHERE id = ?)`
    ).bind(nanoid(), eventId, JSON.stringify({ job_id: id, organization_id: job.organization_id }), now, body.status, auditId),
  ])
  if ((results[0] as any)?.meta?.changes !== 1) return c.json({ error: { code: 'CONFLICT', message: 'This job changed or still has active applicants; refresh and retry.' } }, 409)
  return c.json({ data: { id, status: body.status, version: job.version + 1 } })
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
