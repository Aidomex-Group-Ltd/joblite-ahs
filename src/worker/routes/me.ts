import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import type { AppContext } from '../types'
import { requireAuth } from '../middleware/auth'
import { clampInt, sanitizeText, slugify } from '../lib/validate'

const app = new Hono<AppContext>()

app.use('/*', requireAuth)

async function unreadNotificationCount(c: any, userId: string): Promise<number> {
  const row = (await c.env.DB.prepare('SELECT COUNT(*) as total FROM notifications WHERE user_id = ? AND read_at IS NULL')
    .bind(userId)
    .first()) as { total: number } | null
  return row?.total ?? 0
}

app.get('/', async (c) => {
  const user = c.get('user')!
  const [profile, memberships, unread] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM profiles WHERE user_id = ?').bind(user.id).first<any>(),
    c.env.DB.prepare(
      'SELECT m.organization_id, m.role, o.name as org_name, o.slug as org_slug, o.verification_state FROM memberships m JOIN organizations o ON o.id = m.organization_id WHERE m.user_id = ?'
    )
      .bind(user.id)
      .all(),
    unreadNotificationCount(c, user.id),
  ])

  return c.json({
    data: {
      user: {
        id: user.id,
        email: user.email,
        display_name: user.display_name || profile?.handle || user.email.split('@')[0],
      },
      profile: profile || null,
      memberships: memberships.results,
      unread_notifications: unread,
    },
  })
})

app.get('/summary', async (c) => {
  const user = c.get('user')!
  const [rows, saved, external] = await Promise.all([
    c.env.DB.prepare('SELECT stage, COUNT(*) as total FROM applications WHERE candidate_id = ? GROUP BY stage')
      .bind(user.id)
      .all(),
    c.env.DB.prepare('SELECT COUNT(*) as total FROM saved_jobs WHERE user_id = ?').bind(user.id).first() as Promise<{ total: number } | null>,
    c.env.DB.prepare('SELECT COUNT(*) as total FROM external_application_trackers WHERE user_id = ?')
      .bind(user.id)
      .first() as Promise<{ total: number } | null>,
  ])

  const byStage: Record<string, number> = {}
  let total = 0
  for (const row of rows.results as Array<{ stage: string; total: number }>) {
    byStage[row.stage] = row.total
    total += row.total
  }

  return c.json({
    data: {
      applications: {
        total,
        inReview: (byStage.in_review || 0) + (byStage.shortlisted || 0),
        interviews: byStage.interview || 0,
        offers: byStage.offer || 0,
        submitted: byStage.submitted || 0,
        by_stage: byStage,
      },
      saved: saved?.total ?? 0,
      external_tracked: external?.total ?? 0,
    },
  })
})

app.patch('/profile', async (c) => {
  const user = c.get('user')!
  const body = await c.req.json().catch(() => ({}))

  if (typeof body.display_name === 'string' && body.display_name.trim()) {
    await c.env.DB.prepare('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?')
      .bind(sanitizeText(body.display_name, 80), Math.floor(Date.now() / 1000), user.id)
      .run()
  }

  let profile = await c.env.DB.prepare('SELECT * FROM profiles WHERE user_id = ?').bind(user.id).first<any>()
  if (!profile) {
    const requestedHandle = typeof body.handle === 'string' && body.handle ? body.handle : null
    const base = slugify(requestedHandle || user.email.split('@')[0] || 'member', 24) || 'member'
    let handle = base
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const existing = await c.env.DB.prepare('SELECT id FROM profiles WHERE handle = ?').bind(handle).first()
      if (!existing) break
      handle = `${base}-${nanoid(4).toLowerCase()}`
    }

    const profileId = nanoid()
    await c.env.DB.prepare(
      'INSERT INTO profiles (id, user_id, handle, headline, bio, country_code, visibility, availability) VALUES (?,?,?,?,?,?,?,?)'
    )
      .bind(
        profileId,
        user.id,
        handle,
        sanitizeText(body.headline, 120) || null,
        sanitizeText(body.bio, 2000) || null,
        typeof body.country_code === 'string' && body.country_code ? body.country_code.toUpperCase() : null,
        ['public', 'private', 'recruiter_only'].includes(body.visibility) ? body.visibility : 'public',
        sanitizeText(body.availability, 80) || null
      )
      .run()
    profile = await c.env.DB.prepare('SELECT * FROM profiles WHERE id = ?').bind(profileId).first()
    return c.json({ data: profile }, 201)
  }

  const updates: string[] = []
  const values: unknown[] = []
  const allowed = ['headline', 'bio', 'availability'] as const
  for (const key of allowed) {
    if (body[key] !== undefined) {
      updates.push(`${key} = ?`)
      values.push(sanitizeText(body[key], key === 'bio' ? 2000 : 160) || null)
    }
  }
  if (body.country_code !== undefined) {
    const code = typeof body.country_code === 'string' && body.country_code ? body.country_code.toUpperCase() : null
    if (code) {
      const country = await c.env.DB.prepare('SELECT code FROM countries WHERE code = ?').bind(code).first()
      if (!country) return c.json({ error: { code: 'INVALID_COUNTRY', message: 'Unknown country code' } }, 400)
    }
    updates.push('country_code = ?')
    values.push(code)
  }
  if (body.visibility !== undefined) {
    if (!['public', 'private', 'recruiter_only'].includes(body.visibility)) {
      return c.json({ error: { code: 'INVALID_VISIBILITY', message: 'Unsupported profile visibility' } }, 400)
    }
    updates.push('visibility = ?')
    values.push(body.visibility)
  }
  if (updates.length === 0) return c.json({ data: profile })

  updates.push('updated_at = ?')
  values.push(Math.floor(Date.now() / 1000), user.id)
  await c.env.DB.prepare(`UPDATE profiles SET ${updates.join(', ')} WHERE user_id = ?`).bind(...values).run()
  profile = await c.env.DB.prepare('SELECT * FROM profiles WHERE user_id = ?').bind(user.id).first()
  return c.json({ data: profile })
})

app.get('/applications', async (c) => {
  const user = c.get('user')!
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.stage, a.version, a.submitted_at, a.updated_at, j.id as job_id, j.title, j.origin,
       COALESCE(o.name, j.company_name) as org_name, o.slug as org_slug
     FROM applications a
     JOIN jobs j ON j.id = a.job_id
     LEFT JOIN organizations o ON o.id = j.organization_id
     WHERE a.candidate_id = ? ORDER BY a.submitted_at DESC`
  )
    .bind(user.id)
    .all()
  return c.json({ data: results })
})

app.get('/external-applications', async (c) => {
  const user = c.get('user')!
  const { results } = await c.env.DB.prepare(
    `SELECT t.job_id, t.self_reported_status as status, t.marked_at, j.title,
       COALESCE(o.name, j.company_name) as org_name, s.name as source_name
     FROM external_application_trackers t
     JOIN jobs j ON j.id = t.job_id
     LEFT JOIN organizations o ON o.id = j.organization_id
     LEFT JOIN sources s ON s.id = j.source_id
     WHERE t.user_id = ? ORDER BY t.marked_at DESC`
  ).bind(user.id).all()
  return c.json({ data: results })
})

app.get('/saved', async (c) => {
  const user = c.get('user')!
  const { results } = await c.env.DB.prepare(
    `SELECT j.id, j.title, j.origin, j.application_method, j.workplace_arrangement, j.employment_type,
       j.published_at, j.canonical_url, j.company_name, COALESCE(o.name, j.company_name) as org_name,
       o.slug as org_slug, s.created_at as saved_at, sal.currency, sal.min_minor, sal.max_minor, sal.period
     FROM saved_jobs s
     JOIN jobs j ON j.id = s.job_id
     LEFT JOIN organizations o ON o.id = j.organization_id
     LEFT JOIN salary_ranges sal ON sal.job_id = j.id
     WHERE s.user_id = ? AND j.status = 'published'
     ORDER BY s.created_at DESC`
  )
    .bind(user.id)
    .all()
  return c.json({ data: results })
})

app.get('/notifications', async (c) => {
  const user = c.get('user')!
  const limit = clampInt(c.req.query('limit'), 1, 100, 30)
  const offset = clampInt(c.req.query('offset'), 0, 100000, 0)
  const [{ results }, unread] = await Promise.all([
    c.env.DB.prepare(
      'SELECT id, type, payload_json, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
    )
      .bind(user.id, limit, offset)
      .all(),
    unreadNotificationCount(c, user.id),
  ])
  return c.json({
    data: (results as Array<Record<string, any>>).map((row) => {
      let payload: Record<string, unknown> = {}
      try {
        payload = JSON.parse(row.payload_json || '{}')
      } catch {
        payload = {}
      }
      return { id: row.id, type: row.type, payload, read_at: row.read_at, created_at: row.created_at }
    }),
    meta: { unread_count: unread, limit, offset },
  })
})

app.patch('/notifications/:id', async (c) => {
  const user = c.get('user')!
  const id = c.req.param('id')
  const notification = await c.env.DB.prepare('SELECT id FROM notifications WHERE id = ? AND user_id = ?')
    .bind(id, user.id)
    .first()
  if (!notification) return c.json({ error: { code: 'NOT_FOUND', message: 'Notification not found' } }, 404)
  await c.env.DB.prepare('UPDATE notifications SET read_at = ? WHERE id = ?').bind(Math.floor(Date.now() / 1000), id).run()
  return c.json({ data: { id, read: true, unread_count: await unreadNotificationCount(c, user.id) } })
})

app.patch('/notifications', async (c) => {
  const user = c.get('user')!
  await c.env.DB.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL')
    .bind(Math.floor(Date.now() / 1000), user.id)
    .run()
  return c.json({ data: { read: true, unread_count: 0 } })
})

app.put('/external-applications/:jobId', async (c) => {
  const user = c.get('user')!
  const jobId = c.req.param('jobId')
  const job = await c.env.DB.prepare("SELECT id, origin FROM jobs WHERE id = ? AND status = 'published'").bind(jobId).first<any>()
  if (!job) return c.json({ error: { code: 'NOT_FOUND', message: 'Job not found' } }, 404)
  if (job.origin === 'native') {
    return c.json({ error: { code: 'INVALID', message: 'Native jobs are tracked automatically when you apply inside Joblite' } }, 400)
  }

  const statuses = ['applied', 'interviewing', 'offer', 'rejected', 'withdrawn']
  const body = await c.req.json().catch(() => ({}))
  const status = statuses.includes(body.status) ? body.status : 'applied'
  const now = Math.floor(Date.now() / 1000)
  await c.env.DB.prepare(
    `INSERT INTO external_application_trackers (id, user_id, job_id, self_reported_status, marked_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(user_id, job_id) DO UPDATE SET self_reported_status = excluded.self_reported_status, marked_at = excluded.marked_at`
  )
    .bind(nanoid(), user.id, jobId, status, now)
    .run()
  return c.json({ data: { job_id: jobId, status, marked_at: now } })
})

export default app
