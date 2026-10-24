import { Hono } from 'hono'
import type { AppContext } from '../types'
import { optionalAuth, requireAuth } from '../middleware/auth'

const app = new Hono<AppContext>()

app.get('/:handle', optionalAuth, async (c) => {
  const handle = (c.req.param('handle') || '').toLowerCase()
  const profile = await c.env.DB.prepare(
    `SELECT p.id, p.handle, p.headline, p.bio, p.country_code, p.visibility, p.availability,
       p.updated_at, COALESCE(u.display_name, p.handle) as display_name
     FROM profiles p JOIN users u ON u.id = p.user_id
     WHERE p.handle = ?`
  )
    .bind(handle)
    .first<any>()

  if (!profile || profile.visibility !== 'public') {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Profile not found' } }, 404)
  }

  const [skills, experience, education, links] = await Promise.all([
    c.env.DB.prepare(
      'SELECT s.label_normalized FROM profile_skills ps JOIN skills s ON s.id = ps.skill_id WHERE ps.profile_id = ? ORDER BY s.label_normalized'
    )
      .bind(profile.id)
      .all(),
    c.env.DB.prepare(
      'SELECT organization, role, start_date, end_date, description, current FROM experience WHERE profile_id = ? ORDER BY start_date DESC'
    )
      .bind(profile.id)
      .all(),
    c.env.DB.prepare('SELECT organization, qualification, start_date, end_date, description FROM education WHERE profile_id = ? ORDER BY start_date DESC')
      .bind(profile.id)
      .all(),
    c.env.DB.prepare('SELECT url, label FROM profile_links WHERE profile_id = ?').bind(profile.id).all(),
  ])

  const viewer = c.get('user')
  let isFollowing = false
  if (viewer) {
    const follow = await c.env.DB.prepare(
      'SELECT 1 as present FROM follows f JOIN profiles p ON p.user_id = f.followee_id WHERE f.follower_id = ? AND p.handle = ?'
    )
      .bind(viewer.id, handle)
      .first()
    isFollowing = Boolean(follow)
  }

  // Private fields (email, CV media, visibility internals) never leave the server.
  return c.json({
    data: {
      is_following: isFollowing,
      handle: profile.handle,
      display_name: profile.display_name,
      headline: profile.headline,
      bio: profile.bio,
      country_code: profile.country_code,
      availability: profile.availability,
      updated_at: profile.updated_at,
      skills: (skills.results as Array<{ label_normalized: string }>).map((row) => row.label_normalized),
      experience: experience.results,
      education: education.results,
      links: (links.results as Array<{ url: string; label: string | null }>)
        .filter((link) => /^https?:\/\//i.test(link.url))
        .map((link) => ({ url: link.url, label: link.label })),
    },
  })
})

app.post('/:handle/follow', requireAuth, async (c) => {
  const user = c.get('user')!
  const handle = (c.req.param('handle') || '').toLowerCase()
  const profile = await c.env.DB.prepare('SELECT user_id, visibility FROM profiles WHERE handle = ?').bind(handle).first<any>()
  if (!profile || profile.visibility !== 'public') {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Profile not found' } }, 404)
  }
  if (profile.user_id === user.id) {
    return c.json({ error: { code: 'INVALID', message: 'You cannot follow yourself' } }, 400)
  }
  await c.env.DB.prepare('INSERT OR IGNORE INTO follows (follower_id, followee_id) VALUES (?,?)')
    .bind(user.id, profile.user_id)
    .run()
  return c.json({ data: { following: true } })
})

app.delete('/:handle/follow', requireAuth, async (c) => {
  const user = c.get('user')!
  const handle = (c.req.param('handle') || '').toLowerCase()
  const profile = await c.env.DB.prepare('SELECT user_id FROM profiles WHERE handle = ?').bind(handle).first<any>()
  if (!profile) return c.json({ error: { code: 'NOT_FOUND', message: 'Profile not found' } }, 404)
  await c.env.DB.prepare('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?')
    .bind(user.id, profile.user_id)
    .run()
  return c.json({ data: { following: false } })
})

export default app
