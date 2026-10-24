import { Hono } from 'hono'
import type { AppContext } from '../types'
import { nanoid } from 'nanoid'
import type { Env } from '../types'
import { requireAuth, optionalAuth } from '../middleware/auth'

const app = new Hono<AppContext>()

app.get('/', optionalAuth, async (c) => {
  const q = c.req.query()
  const limit = Math.min(parseInt(q.limit || '20'), 100)
  const offset = parseInt(q.offset || '0')
  
  let sql = `SELECT j.*, o.name as org_name, o.slug as org_slug, je.mode as eligibility_mode 
             FROM jobs j 
             LEFT JOIN organizations o ON o.id = j.organization_id 
             LEFT JOIN job_eligibility je ON je.job_id = j.id 
             WHERE j.status = 'published'`
  const params: any[] = []
  
  if (q.country) {
    sql += ` AND (je.mode = 'worldwide' OR EXISTS (SELECT 1 FROM job_eligible_countries ec WHERE ec.job_id = j.id AND ec.country_code = ?))`
    params.push(q.country.toUpperCase())
  }
  if (q.q) {
    sql += ` AND (LOWER(j.title) LIKE ? OR LOWER(j.body) LIKE ?)`
    params.push(`%${q.q.toLowerCase()}%`, `%${q.q.toLowerCase()}%`)
  }
  if (q.arrangement) {
    sql += ` AND j.workplace_arrangement = ?`
    params.push(q.arrangement)
  }
  
  sql += ` ORDER BY COALESCE(j.published_at, j.created_at) DESC LIMIT ? OFFSET ?`
  params.push(limit, offset)
  
  const stmt = c.env.DB.prepare(sql)
  const { results } = await stmt.bind(...params).all()
  return c.json({ data: results, meta: { limit, offset } })
})

app.get('/:id', optionalAuth, async (c) => {
  const id = c.req.param('id')
  const job = await c.env.DB.prepare(
    `SELECT j.*, o.name as org_name, o.slug as org_slug, je.mode as eligibility_mode, je.evidence as eligibility_evidence
     FROM jobs j LEFT JOIN organizations o ON o.id = j.organization_id LEFT JOIN job_eligibility je ON je.job_id = j.id WHERE j.id = ?`
  ).bind(id).first<any>()
  if (!job) return c.json({ error: { code: 'NOT_FOUND', message: 'Job not found' } }, 404)
  
  const locations = await c.env.DB.prepare('SELECT * FROM job_locations WHERE job_id = ?').bind(id).all()
  const eligible = await c.env.DB.prepare('SELECT country_code FROM job_eligible_countries WHERE job_id = ?').bind(id).all()
  const skills = await c.env.DB.prepare(
    `SELECT sk.label_normalized FROM job_skills js JOIN skills sk ON sk.id = js.skill_id WHERE js.job_id = ?`
  ).bind(id).all()
  const salary = await c.env.DB.prepare('SELECT * FROM salary_ranges WHERE job_id = ?').bind(id).first()
  
  return c.json({ data: { ...job, locations: locations.results, eligible_countries: eligible.results, skills: skills.results, salary } })
})

app.post('/', requireAuth, async (c) => {
  const user = c.get('user')!
  const body = await c.req.json().catch(() => ({}))
  
  if (!body.organization_id) return c.json({ error: { code: 'INVALID', message: 'organization_id required' } }, 400)
  if (!body.title) return c.json({ error: { code: 'INVALID', message: 'title required' } }, 400)
  if (!body.body) return c.json({ error: { code: 'INVALID', message: 'body required' } }, 400)
  
  // Check membership
  const membership = await c.env.DB.prepare(
    'SELECT * FROM memberships WHERE organization_id = ? AND user_id = ?'
  ).bind(body.organization_id, user.id).first()
  if (!membership) return c.json({ error: { code: 'FORBIDDEN', message: 'Not a member of organization' } }, 403)
  
  const jobId = nanoid()
  const now = Math.floor(Date.now()/1000)
  await c.env.DB.prepare(
    `INSERT INTO jobs (id, origin, organization_id, title, body, employment_type, workplace_arrangement, application_method, status, version, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(jobId, 'native', body.organization_id, body.title, body.body, body.employment_type || null, body.workplace_arrangement || null, 'native', 'draft', 1, now, now).run()
  
  if (body.eligibility_mode) {
    await c.env.DB.prepare('INSERT INTO job_eligibility (id, job_id, mode, evidence) VALUES (?,?,?,?)')
      .bind(nanoid(), jobId, body.eligibility_mode, body.eligibility_evidence || null).run()
  }
  
  return c.json({ data: { id: jobId, status: 'draft' } }, 201)
})

app.post('/:id/publish', requireAuth, async (c) => {
  const user = c.get('user')!
  const id = c.req.param('id')
  const job = await c.env.DB.prepare('SELECT * FROM jobs WHERE id = ?').bind(id).first<any>()
  if (!job) return c.json({ error: { code: 'NOT_FOUND', message: 'Job not found' } }, 404)
  if (job.origin !== 'native' || job.application_method !== 'native') {
    return c.json({ error: { code: 'INVALID', message: 'Only native jobs can be published via this endpoint' } }, 400)
  }
  
  const membership = await c.env.DB.prepare(
    'SELECT * FROM memberships WHERE organization_id = ? AND user_id = ?'
  ).bind(job.organization_id, user.id).first()
  if (!membership) return c.json({ error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403)
  
  const now = Math.floor(Date.now()/1000)
  await c.env.DB.prepare('UPDATE jobs SET status = ?, published_at = ?, updated_at = ?, version = version + 1 WHERE id = ?')
    .bind('published', now, now, id).run()
  return c.json({ data: { id, status: 'published', published_at: now } })
})

app.post('/:id/save', requireAuth, async (c) => {
  const user = c.get('user')!
  const id = c.req.param('id')
  try {
    await c.env.DB.prepare('INSERT INTO saved_jobs (user_id, job_id) VALUES (?,?)').bind(user.id, id).run()
    return c.json({ data: { saved: true } })
  } catch {
    return c.json({ data: { saved: true } }) // idempotent
  }
})

app.delete('/:id/save', requireAuth, async (c) => {
  const user = c.get('user')!
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM saved_jobs WHERE user_id = ? AND job_id = ?').bind(user.id, id).run()
  return c.json({ data: { saved: false } })
})

export default app
