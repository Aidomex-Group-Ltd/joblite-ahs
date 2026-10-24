import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import type { AppContext } from '../types'
import { requireAuth } from '../middleware/auth'

const app = new Hono<AppContext>()

app.use('/*', requireAuth)

app.get('/', async (c) => {
  const user = c.get('user')!
  const profile = await c.env.DB.prepare('SELECT * FROM profiles WHERE user_id = ?').bind(user.id).first()
  const memberships = await c.env.DB.prepare(
    'SELECT m.*, o.name as org_name, o.slug as org_slug FROM memberships m JOIN organizations o ON o.id = m.organization_id WHERE m.user_id = ?'
  ).bind(user.id).all()
  return c.json({ data: { user, profile, memberships: memberships.results } })
})

app.patch('/profile', async (c) => {
  const user = c.get('user')!
  const body = await c.req.json().catch(() => ({}))
  
  let profile = await c.env.DB.prepare('SELECT * FROM profiles WHERE user_id = ?').bind(user.id).first<any>()
  if (!profile) {
    const profileId = nanoid()
    const handle = (body.handle || user.email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '')) + nanoid(4)
    await c.env.DB.prepare(
      'INSERT INTO profiles (id, user_id, handle, headline, bio, country_code, visibility) VALUES (?,?,?,?,?,?,?)'
    ).bind(profileId, user.id, handle.toLowerCase(), body.headline || null, body.bio || null, body.country_code || null, body.visibility || 'public').run()
    profile = await c.env.DB.prepare('SELECT * FROM profiles WHERE id = ?').bind(profileId).first()
    return c.json({ data: profile }, 201)
  }
  
  const updates: string[] = []
  const values: any[] = []
  const allowed = ['headline', 'bio', 'country_code', 'visibility', 'availability']
  for (const key of allowed) {
    if (body[key] !== undefined) {
      updates.push(`${key} = ?`)
      values.push(body[key])
    }
  }
  if (updates.length === 0) return c.json({ data: profile })
  updates.push('updated_at = ?')
  values.push(Math.floor(Date.now()/1000))
  values.push(user.id)
  await c.env.DB.prepare(`UPDATE profiles SET ${updates.join(', ')} WHERE user_id = ?`).bind(...values).run()
  profile = await c.env.DB.prepare('SELECT * FROM profiles WHERE user_id = ?').bind(user.id).first()
  return c.json({ data: profile })
})

app.get('/applications', async (c) => {
  const user = c.get('user')!
  const { results } = await c.env.DB.prepare(
    `SELECT a.*, j.title, j.id as job_id, o.name as org_name FROM applications a 
     JOIN jobs j ON j.id = a.job_id 
     LEFT JOIN organizations o ON o.id = j.organization_id 
     WHERE a.candidate_id = ? ORDER BY a.submitted_at DESC`
  ).bind(user.id).all()
  return c.json({ data: results })
})

app.get('/saved', async (c) => {
  const user = c.get('user')!
  const { results } = await c.env.DB.prepare(
    `SELECT j.*, s.created_at as saved_at FROM saved_jobs s JOIN jobs j ON j.id = s.job_id WHERE s.user_id = ? ORDER BY s.created_at DESC`
  ).bind(user.id).all()
  return c.json({ data: results })
})

export default app
