import { Hono } from 'hono'
import type { AppContext } from '../types'
import { nanoid } from 'nanoid'
import type { Env } from '../types'
import { requireAuth } from '../middleware/auth'

const app = new Hono<AppContext>()

app.use('/*', requireAuth)

app.post('/', async (c) => {
  const user = c.get('user')!
  const body = await c.req.json().catch(() => ({}))
  if (!body.name) return c.json({ error: { code: 'INVALID', message: 'Name required' } }, 400)
  const slug = (body.slug || body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')) + '-' + nanoid(4)
  const orgId = nanoid()
  const now = Math.floor(Date.now()/1000)
  await c.env.DB.prepare('INSERT INTO organizations (id, slug, name, verification_state, created_at, updated_at) VALUES (?,?,?,?,?,?)')
    .bind(orgId, slug, body.name, 'unverified', now, now).run()
  // Make creator owner
  await c.env.DB.prepare('INSERT INTO memberships (id, organization_id, user_id, role) VALUES (?,?,?,?)')
    .bind(nanoid(), orgId, user.id, 'owner').run()
  return c.json({ data: { id: orgId, slug, name: body.name } }, 201)
})

app.get('/:id/applications', async (c) => {
  const user = c.get('user')!
  const orgId = c.req.param('id')
  const membership = await c.env.DB.prepare('SELECT * FROM memberships WHERE organization_id = ? AND user_id = ?')
    .bind(orgId, user.id).first()
  if (!membership) return c.json({ error: { code: 'FORBIDDEN', message: 'Not a member' } }, 403)
  
  const { results } = await c.env.DB.prepare(
    `SELECT a.*, j.title, u.email_normalized as candidate_email FROM applications a 
     JOIN jobs j ON j.id = a.job_id 
     JOIN users u ON u.id = a.candidate_id 
     WHERE j.organization_id = ? ORDER BY a.submitted_at DESC`
  ).bind(orgId).all()
  return c.json({ data: results })
})

export default app
