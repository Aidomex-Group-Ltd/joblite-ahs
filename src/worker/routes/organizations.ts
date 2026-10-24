import { Hono } from 'hono'
import type { AppContext } from '../types'
import { nanoid } from 'nanoid'
import { requireAuth } from '../middleware/auth'
import { slugify } from '../lib/validate'

const app = new Hono<AppContext>()

const RECRUITER_ROLES = ['owner', 'admin', 'recruiter']

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

  const { results } = await c.env.DB.prepare(
    `SELECT j.id, j.title, j.status, j.origin, j.employment_type, j.workplace_arrangement, j.published_at,
       j.expires_at, j.version,
       (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id) as application_count
     FROM jobs j WHERE j.organization_id = ? ORDER BY j.created_at DESC`
  )
    .bind(orgId)
    .all()
  return c.json({ data: results })
})

app.get('/:id/applications', requireAuth, async (c) => {
  const user = c.get('user')!
  const orgId = c.req.param('id')
  const membership = await c.env.DB.prepare('SELECT role FROM memberships WHERE organization_id = ? AND user_id = ?')
    .bind(orgId, user.id)
    .first<any>()
  if (!membership) return c.json({ error: { code: 'FORBIDDEN', message: 'Not a member' } }, 403)

  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.stage, a.version, a.submitted_at, a.updated_at, j.id as job_id, j.title,
       COALESCE(u.display_name, pr.handle, 'Candidate') as candidate_name, pr.handle as candidate_handle
     FROM applications a
     JOIN jobs j ON j.id = a.job_id
     JOIN users u ON u.id = a.candidate_id
     LEFT JOIN profiles pr ON pr.user_id = a.candidate_id
     WHERE j.organization_id = ? ORDER BY a.submitted_at DESC`
  )
    .bind(orgId)
    .all()
  return c.json({ data: results })
})

export { RECRUITER_ROLES }
export default app
