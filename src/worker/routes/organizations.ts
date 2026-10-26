import { Hono } from 'hono'
import type { AppContext } from '../types'
import { nanoid } from 'nanoid'
import { requireAuth } from '../middleware/auth'
import { slugify } from '../lib/validate'
import { clampInt } from '../lib/validate'

const app = new Hono<AppContext>()

const RECRUITER_ROLES = ['owner', 'admin', 'recruiter']

app.use('/:id/*', async (c, next) => {
  await next()
  c.header('Cache-Control', 'private, no-store')
})

app.get('/:slug', async (c) => {
  const slug = c.req.param('slug')
  const org = await c.env.DB.prepare(
    'SELECT id, slug, name, verification_state, created_at FROM organizations WHERE slug = ?'
  )
    .bind(slug)
    .first<any>()
  if (!org) return c.json({ error: { code: 'NOT_FOUND', message: 'Organization not found' } }, 404)

  const jobs = await c.env.DB.prepare(
    `SELECT j.id, j.title, j.workplace_arrangement, j.employment_type, j.origin, j.published_at
     FROM jobs j WHERE j.organization_id = ? AND j.status = 'published'
     ORDER BY COALESCE(j.published_at, j.created_at) DESC LIMIT 50`
  )
    .bind(org.id)
    .all()

  return c.json({ data: { ...org, jobs: jobs.results } })
})

app.post('/', requireAuth, async (c) => {
  const user = c.get('user')!
  const body = await c.req.json().catch(() => ({}))
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (name.length < 2) return c.json({ error: { code: 'INVALID', message: 'Organization name is required' } }, 400)

  const base = slugify(typeof body.slug === 'string' && body.slug ? body.slug : name) || 'organization'
  let slug = base
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const existing = await c.env.DB.prepare('SELECT id FROM organizations WHERE slug = ?').bind(slug).first()
    if (!existing) break
    slug = `${base}-${nanoid(4).toLowerCase()}`
  }

  const orgId = nanoid()
  const now = Math.floor(Date.now() / 1000)
  await c.env.DB.prepare('INSERT INTO organizations (id, slug, name, verification_state, created_at, updated_at) VALUES (?,?,?,?,?,?)')
    .bind(orgId, slug, name, 'unverified', now, now)
    .run()
  await c.env.DB.prepare('INSERT INTO memberships (id, organization_id, user_id, role) VALUES (?,?,?,?)')
    .bind(nanoid(), orgId, user.id, 'owner')
    .run()
  return c.json({ data: { id: orgId, slug, name } }, 201)
})

app.get('/:id/jobs', requireAuth, async (c) => {
  const user = c.get('user')!
  const orgId = c.req.param('id')
  const membership = await c.env.DB.prepare('SELECT role FROM memberships WHERE organization_id = ? AND user_id = ?')
    .bind(orgId, user.id)
    .first<any>()
  if (!membership) return c.json({ error: { code: 'FORBIDDEN', message: 'Not a member of this organization' } }, 403)

  const limit = clampInt(c.req.query('limit'), 1, 100, 25)
  const offset = clampInt(c.req.query('offset'), 0, 100000, 0)
  const status = c.req.query('status')
  const whereStatus = ['draft', 'published', 'paused', 'closed'].includes(status || '') ? 'AND j.status = ?' : ''
  const params: unknown[] = [orgId]
  if (whereStatus) params.push(status)
  const { results } = await c.env.DB.prepare(
    `SELECT j.id, j.title, j.body, j.status, j.origin, j.employment_type, j.workplace_arrangement,
     j.application_questions_json, j.archived_at, j.published_at, j.expires_at, j.version,
       (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id) as application_count
     FROM jobs j WHERE j.organization_id = ? ${whereStatus} ORDER BY j.created_at DESC LIMIT ? OFFSET ?`
  )
    .bind(...params, limit, offset)
    .all()
  const total = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total FROM jobs j WHERE j.organization_id = ? ${whereStatus}`
  ).bind(...params).first<{ total: number }>()
  return c.json({ data: results, meta: { limit, offset, total: total?.total || 0, has_more: offset + results.length < (total?.total || 0) } })
})

app.get('/:id/overview', requireAuth, async (c) => {
  const user = c.get('user')!
  const orgId = c.req.param('id')
  const membership = await c.env.DB.prepare('SELECT role FROM memberships WHERE organization_id = ? AND user_id = ?')
    .bind(orgId, user.id).first<any>()
  if (!membership) return c.json({ error: { code: 'FORBIDDEN', message: 'Not a member of this organization' } }, 403)

  const now = Math.floor(Date.now() / 1000)
  const [jobs, stages, interviews, recent, applications, offers] = await Promise.all([
    c.env.DB.prepare(
      `SELECT COUNT(*) AS total,
        SUM(CASE WHEN j.status = 'published' AND (j.expires_at IS NULL OR j.expires_at > ?) AND j.archived_at IS NULL THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN j.status = 'published' THEN 1 ELSE 0 END) AS published,
        SUM(CASE WHEN j.status = 'draft' THEN 1 ELSE 0 END) AS drafts
       FROM jobs j WHERE j.organization_id = ? AND j.origin = 'native'`
    ).bind(now, orgId).first<any>(),
    c.env.DB.prepare(
      `SELECT a.stage, COUNT(*) AS total FROM applications a JOIN jobs j ON j.id = a.job_id
       WHERE j.organization_id = ? GROUP BY a.stage`
    ).bind(orgId).all<any>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS total FROM interviews i JOIN applications a ON a.id = i.application_id
       JOIN jobs j ON j.id = a.job_id WHERE j.organization_id = ? AND i.status = 'planned' AND i.scheduled_at >= ?`
    ).bind(orgId, now).first<any>(),
    c.env.DB.prepare(
      `SELECT a.id, a.stage, a.submitted_at, j.id AS job_id, j.title,
        COALESCE(u.display_name, p.handle, 'Candidate') AS candidate_name
       FROM applications a JOIN jobs j ON j.id = a.job_id JOIN users u ON u.id = a.candidate_id
       LEFT JOIN profiles p ON p.user_id = a.candidate_id
       WHERE j.organization_id = ? ORDER BY a.submitted_at DESC LIMIT 5`
    ).bind(orgId).all<any>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS total,
        SUM(CASE WHEN a.stage = 'in_review' THEN 1 ELSE 0 END) AS in_review
       FROM applications a JOIN jobs j ON j.id = a.job_id WHERE j.organization_id = ?`
    ).bind(orgId).first<any>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS total,
        SUM(CASE WHEN o.status = 'issued' THEN 1 ELSE 0 END) AS issued
       FROM offers o JOIN applications a ON a.id = o.application_id
       JOIN jobs j ON j.id = a.job_id WHERE j.organization_id = ? AND o.status != 'draft'`
    ).bind(orgId).first<any>(),
  ])
  return c.json({
    data: {
      jobs: { ...jobs, active: jobs?.active || 0 },
      applications: { total: applications?.total || 0, in_review: applications?.in_review || 0 },
      offers: { total: offers?.total || 0, issued: offers?.issued || 0 },
      stages: stages.results,
      upcoming_interviews: interviews?.total || 0,
      recent_applications: recent.results,
    },
  })
})

app.get('/:id/members', requireAuth, async (c) => {
  const user = c.get('user')!
  const orgId = c.req.param('id')
  const membership = await c.env.DB.prepare('SELECT id FROM memberships WHERE organization_id = ? AND user_id = ?')
    .bind(orgId, user.id).first()
  if (!membership) return c.json({ error: { code: 'FORBIDDEN', message: 'Not a member of this organization' } }, 403)
  const { results } = await c.env.DB.prepare(
    `SELECT m.user_id, m.role, COALESCE(u.display_name, 'Organization member') AS display_name
     FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.organization_id = ? ORDER BY display_name`
  ).bind(orgId).all()
  return c.json({ data: results })
})

app.get('/:id/audit', requireAuth, async (c) => {
  const user = c.get('user')!
  const orgId = c.req.param('id')
  const membership = await c.env.DB.prepare('SELECT role FROM memberships WHERE organization_id = ? AND user_id = ?')
    .bind(orgId, user.id).first<any>()
  if (!membership || !['owner', 'admin', 'recruiter'].includes(membership.role)) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Not authorized to view organization audit history' } }, 403)
  }
  const limit = clampInt(c.req.query('limit'), 1, 100, 50)
  const offset = clampInt(c.req.query('offset'), 0, 100000, 0)
  const result = await c.env.DB.prepare(
    `SELECT id, actor_id, action, target_type, target_id, metadata_json, created_at
     FROM audit_events WHERE organization_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
  ).bind(orgId, limit, offset).all<any>()
  const total = await c.env.DB.prepare(
    'SELECT COUNT(*) AS total FROM audit_events WHERE organization_id = ?'
  ).bind(orgId).first<{ total: number }>()
  return c.json({ data: result.results, meta: { limit, offset, total: total?.total || 0, has_more: offset + result.results.length < (total?.total || 0) } })
})

app.get('/:id/applications', requireAuth, async (c) => {
  const user = c.get('user')!
  const orgId = c.req.param('id')
  const membership = await c.env.DB.prepare('SELECT role FROM memberships WHERE organization_id = ? AND user_id = ?')
    .bind(orgId, user.id)
    .first<any>()
  if (!membership) return c.json({ error: { code: 'FORBIDDEN', message: 'Not a member' } }, 403)

  const limit = clampInt(c.req.query('limit'), 1, 100, 25)
  const offset = clampInt(c.req.query('offset'), 0, 100000, 0)
  const stage = c.req.query('stage')
  const jobId = c.req.query('job_id')
  const query = typeof c.req.query('q') === 'string' ? c.req.query('q')!.trim().slice(0, 100) : ''
  const where: string[] = ['j.organization_id = ?']
  const params: unknown[] = [orgId]
  if (['submitted', 'in_review', 'shortlisted', 'interview', 'offer', 'hired', 'rejected', 'withdrawn', 'closed'].includes(stage || '')) {
    where.push('a.stage = ?')
    params.push(stage)
  }
  if (jobId) {
    where.push('j.id = ?')
    params.push(jobId)
  }
  if (query) {
    where.push("(LOWER(COALESCE(u.display_name, pr.handle, '')) LIKE ? OR LOWER(j.title) LIKE ?)")
    params.push(`%${query.toLowerCase()}%`, `%${query.toLowerCase()}%`)
  }
  const predicate = where.join(' AND ')
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.stage, a.version, a.submitted_at, a.updated_at, j.id as job_id, j.title,
       COALESCE(u.display_name, pr.handle, 'Candidate') as candidate_name, pr.handle as candidate_handle
     FROM applications a
     JOIN jobs j ON j.id = a.job_id
     JOIN users u ON u.id = a.candidate_id
     LEFT JOIN profiles pr ON pr.user_id = a.candidate_id
     WHERE ${predicate} ORDER BY a.submitted_at DESC LIMIT ? OFFSET ?`
  )
    .bind(...params, limit, offset)
    .all()
  const total = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total FROM applications a JOIN jobs j ON j.id = a.job_id
     JOIN users u ON u.id = a.candidate_id LEFT JOIN profiles pr ON pr.user_id = a.candidate_id WHERE ${predicate}`
  ).bind(...params).first<{ total: number }>()
  return c.json({ data: results, meta: { limit, offset, total: total?.total || 0, has_more: offset + results.length < (total?.total || 0) } })
})

export { RECRUITER_ROLES }

function dayBounds(rawFrom: unknown, rawTo: unknown): { from: number; to: number } | null {
  const parse = (value: unknown, endOfDay: boolean): number | null => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
    const start = Date.parse(`${value}T00:00:00Z`)
    if (!Number.isFinite(start)) return null
    const date = new Date(start)
    if (date.toISOString().slice(0, 10) !== value) return null
    return Math.floor((start + (endOfDay ? 86399 : 0)) / 1000)
  }
  const from = parse(rawFrom, false)
  const to = parse(rawTo, true)
  if (from === null || to === null) return null
  if (from > to) return null
  if (to - from > 3 * 366 * 86400) return null
  return { from, to }
}

function average(values: number[]): number | null {
  if (!values.length) return null
  return values.reduce((total, value) => total + value, 0) / values.length
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

const REPORT_STAGE_ORDER = ['submitted', 'in_review', 'shortlisted', 'interview', 'offer', 'hired', 'rejected', 'withdrawn', 'closed']

/**
 * Reporting is derived only from persisted application rows and the append-only
 * application_events log. Definitions are returned with the numbers so the UI
 * never shows a metric whose meaning is undocumented.
 */
app.get('/:id/reports', requireAuth, async (c) => {
  const user = c.get('user')!
  const orgId = c.req.param('id')
  const membership = await c.env.DB.prepare('SELECT role FROM memberships WHERE organization_id = ? AND user_id = ?')
    .bind(orgId, user.id).first<{ role: string }>()
  if (!membership) return c.json({ error: { code: 'FORBIDDEN', message: 'Not a member of this organization' } }, 403)
  if (!RECRUITER_ROLES.includes(membership.role)) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Reports require an owner, admin, or recruiter role' } }, 403)
  }
  const now = Math.floor(Date.now() / 1000)
  const defaultFrom = new Date((now - 89 * 86400) * 1000).toISOString().slice(0, 10)
  const defaultTo = new Date(now * 1000).toISOString().slice(0, 10)
  const bounds = dayBounds(c.req.query('from') || defaultFrom, c.req.query('to') || defaultTo)
  if (!bounds) {
    return c.json({ error: { code: 'INVALID', message: 'Use from/to dates as YYYY-MM-DD within a three-year range, with from before to' } }, 400)
  }

  const applications = await c.env.DB.prepare(
    `SELECT a.id, a.stage, a.submitted_at, a.updated_at FROM applications a JOIN jobs j ON j.id = a.job_id
     WHERE j.organization_id = ? AND a.submitted_at >= ? AND a.submitted_at <= ?`
  ).bind(orgId, bounds.from, bounds.to).all<{ id: string; stage: string; submitted_at: number; updated_at: number }>()
  const events = await c.env.DB.prepare(
    `SELECT e.application_id, e.event_type, e.new_stage, e.created_at FROM application_events e
     JOIN applications a ON a.id = e.application_id JOIN jobs j ON j.id = a.job_id
     WHERE j.organization_id = ? AND a.submitted_at >= ? AND a.submitted_at <= ?
     ORDER BY e.created_at ASC, e.id ASC`
  ).bind(orgId, bounds.from, bounds.to).all<{ application_id: string; event_type: string; new_stage: string | null; created_at: number }>()

  const eventsByApplication = new Map<string, Array<{ new_stage: string | null; created_at: number; event_type: string }>>()
  for (const event of events.results) {
    const bucket = eventsByApplication.get(event.application_id) || []
    bucket.push({ new_stage: event.new_stage, created_at: event.created_at, event_type: event.event_type })
    eventsByApplication.set(event.application_id, bucket)
  }

  const statusCounts: Record<string, number> = { submitted: 0, in_review: 0, shortlisted: 0, interview: 0, offer: 0, hired: 0, rejected: 0, withdrawn: 0, closed: 0 }
  const reachedCounts: Record<string, number> = { ...statusCounts }
  const stageDurations = new Map<string, number[]>()
  const hireDurations: number[] = []
  let withoutHistory = 0
  let missingHireTimestamp = 0
  let outOfOrderEvents = 0
  let offeredAndHired = 0

  for (const application of applications.results) {
    statusCounts[application.stage] = (statusCounts[application.stage] || 0) + 1
    const appEvents = eventsByApplication.get(application.id) || []
    const reached = new Set<string>(['submitted'])
    const timeline: Array<{ stage: string; at: number }> = [{ stage: 'submitted', at: application.submitted_at }]
    for (const event of appEvents) {
      if (!event.new_stage) continue
      const last = timeline[timeline.length - 1]
      if (event.created_at < last.at) {
        outOfOrderEvents += 1
        continue
      }
      timeline.push({ stage: event.new_stage, at: event.created_at })
      reached.add(event.new_stage)
    }
    if (timeline.length === 1) withoutHistory += 1
    reached.add(application.stage)
    for (const stage of reached) reachedCounts[stage] = (reachedCounts[stage] || 0) + 1
    if (application.stage === 'hired' && reached.has('offer')) offeredAndHired += 1

    for (let index = 0; index < timeline.length - 1; index += 1) {
      const days = (timeline[index + 1].at - timeline[index].at) / 86400
      const bucket = stageDurations.get(timeline[index].stage) || []
      bucket.push(days)
      stageDurations.set(timeline[index].stage, bucket)
    }

    const hiredEvent = appEvents.find((event) =>
      event.event_type === 'application.hired' && event.created_at >= application.submitted_at
    )
    if (application.stage === 'hired') {
      if (hiredEvent) {
        hireDurations.push((hiredEvent.created_at - application.submitted_at) / 86400)
      } else {
        missingHireTimestamp += 1
      }
    }
  }

  const total = applications.results.length
  const reached = (stage: string) => (reachedCounts[stage] || 0)
  const rate = (count: number) => (total ? Math.round((count / total) * 1000) / 1000 : null)
  const activeStages = ['submitted', 'in_review', 'shortlisted', 'interview', 'offer']
  const stages = REPORT_STAGE_ORDER.map((stage) => ({
    stage,
    current: statusCounts[stage] || 0,
    reached: reached(stage),
    average_days: average(stageDurations.get(stage) || []),
    median_days: median(stageDurations.get(stage) || []),
    samples: (stageDurations.get(stage) || []).length,
  }))

  return c.json({
    data: {
      organization_id: orgId,
      generated_at: now,
      window: {
        from: new Date(bounds.from * 1000).toISOString().slice(0, 10),
        to: new Date(bounds.to * 1000).toISOString().slice(0, 10),
        timezone: 'UTC',
      },
      totals: {
        applications: total,
        active: applications.results.filter((row) => activeStages.includes(row.stage)).length,
        hired: statusCounts.hired || 0,
        rejected: statusCounts.rejected || 0,
        withdrawn: statusCounts.withdrawn || 0,
        closed: statusCounts.closed || 0,
        without_history: withoutHistory,
        missing_hire_timestamp: missingHireTimestamp,
        out_of_order_events: outOfOrderEvents,
      },
      conversion: {
        applied_to_interview: rate(reached('interview')),
        applied_to_offer: rate(reached('offer')),
        applied_to_hired: rate(statusCounts.hired || 0),
        offered_to_hired: reached('offer') ? Math.round((offeredAndHired / reached('offer')) * 1000) / 1000 : null,
      },
      time_to_hire_days: {
        average: average(hireDurations),
        median: median(hireDurations),
        samples: hireDurations.length,
      },
      stages,
      definitions: {
        window: 'Applications whose submitted_at falls inside the UTC date window.',
        reached: 'An application counts for a stage when it currently sits there or a stage-change event recorded that stage, including returned visits.',
        conversion: 'Reached-or-current counts divided by applications in the window; offered_to_hired divides hires by applications that reached offer.',
        stage_duration: 'Mean and median days between consecutive recorded stage entries; repeat visits are summed rather than collapsed. Applications without recorded stage entries are counted in without_history instead of being imputed.',
        time_to_hire: 'Days between submitted_at and a non-early application.hired event; hired applications without a valid event are counted in missing_hire_timestamp.',
        exclusions: 'Withdrawn and closed applications stay in the denominator and are never treated as hires.',
      },
    },
  })
})

const CSV_MAX_ROWS = 5000

/**
 * Neutralises spreadsheet formula injection: a cell that would start with a
 * formula trigger is prefixed with a single quote so spreadsheets treat it as
 * text. Quoting and doubling keep the CSV itself well formed.
 */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value)
  if (/^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

app.get('/:id/applications/export.csv', requireAuth, async (c) => {
  const user = c.get('user')!
  const orgId = c.req.param('id') || ''
  const membership = await c.env.DB.prepare('SELECT role FROM memberships WHERE organization_id = ? AND user_id = ?')
    .bind(orgId, user.id).first<{ role: string }>()
  if (!membership) return c.json({ error: { code: 'FORBIDDEN', message: 'Not a member of this organization' } }, 403)
  if (!RECRUITER_ROLES.includes(membership.role)) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Exports require an owner, admin, or recruiter role' } }, 403)
  }

  const stage = c.req.query('stage')
  const jobId = c.req.query('job_id')
  const where: string[] = ['j.organization_id = ?']
  const params: unknown[] = [orgId]
  if (REPORT_STAGE_ORDER.includes(stage || '')) {
    where.push('a.stage = ?')
    params.push(stage)
  }
  if (jobId) {
    where.push('j.id = ?')
    params.push(jobId)
  }
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.stage, a.version, a.submitted_at, a.updated_at, j.id AS job_id, j.title, j.origin,
       COALESCE(u.display_name, pr.handle, 'Candidate') AS candidate_name, s.cv_media_id
     FROM applications a JOIN jobs j ON j.id = a.job_id JOIN users u ON u.id = a.candidate_id
     LEFT JOIN profiles pr ON pr.user_id = a.candidate_id
     LEFT JOIN application_snapshots s ON s.application_id = a.id
     WHERE ${where.join(' AND ')} ORDER BY a.submitted_at DESC LIMIT ?`
  ).bind(...params, CSV_MAX_ROWS + 1).all<Record<string, unknown>>()

  const truncated = results.length > CSV_MAX_ROWS
  const rows = truncated ? results.slice(0, CSV_MAX_ROWS) : results
  const header = ['application_id', 'job_id', 'job_title', 'job_origin', 'candidate_name', 'stage', 'submitted_at', 'updated_at', 'version', 'cv_attached']
  const lines = [header.map(csvCell).join(',')]
  for (const row of rows) {
    lines.push([
      row.id, row.job_id, row.title, row.origin, row.candidate_name, row.stage,
      new Date(Number(row.submitted_at) * 1000).toISOString(),
      new Date(Number(row.updated_at) * 1000).toISOString(),
      row.version, row.cv_media_id ? 'yes' : 'no',
    ].map(csvCell).join(','))
  }

  await c.env.DB.prepare(
    `INSERT INTO audit_events (id, actor_id, organization_id, action, target_type, target_id, metadata_json, created_at)
     VALUES (?, ?, ?, 'applications.exported', 'organization', ?, ?, ?)`
  ).bind(nanoid(), user.id, orgId, orgId, JSON.stringify({ rows: rows.length, truncated, stage: stage || null, job_id: jobId || null }), Math.floor(Date.now() / 1000)).run()

  return new Response(`${lines.join('\r\n')}\r\n`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="joblite-applications-${orgId.slice(0, 12)}.csv"`,
      'Cache-Control': 'private, no-store',
      'X-Joblite-Export-Rows': String(rows.length),
      'X-Joblite-Export-Truncated': truncated ? 'true' : 'false',
      'X-Content-Type-Options': 'nosniff',
    },
  })
})
export default app
