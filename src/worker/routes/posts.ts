import { Hono } from 'hono'
import type { AppContext } from '../types'
import { nanoid } from 'nanoid'
import type { Env } from '../types'
import { requireAuth, optionalAuth } from '../middleware/auth'

const app = new Hono<AppContext>()

app.get('/', optionalAuth, async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100)
  const offset = parseInt(c.req.query('offset') || '0')
  const { results } = await c.env.DB.prepare(
    `SELECT p.*, u.email_normalized as author_email, pr.handle as author_handle, pr.headline as author_headline
     FROM posts p 
     JOIN users u ON u.id = p.author_id 
     LEFT JOIN profiles pr ON pr.user_id = p.author_id 
     WHERE p.state = 'published' AND p.visibility = 'public'
     ORDER BY p.created_at DESC LIMIT ? OFFSET ?`
  ).bind(limit, offset).all()
  return c.json({ data: results, meta: { limit, offset } })
})

app.post('/', requireAuth, async (c) => {
  const user = c.get('user')!
  const body = await c.req.json().catch(() => ({}))
  if (!body.body || body.body.trim().length === 0) {
    return c.json({ error: { code: 'INVALID', message: 'Post body required' } }, 400)
  }
  const postId = nanoid()
  const now = Math.floor(Date.now()/1000)
  await c.env.DB.prepare(
    'INSERT INTO posts (id, author_id, body, visibility, state, created_at, updated_at) VALUES (?,?,?,?,?,?,?)'
  ).bind(postId, user.id, body.body.trim(), body.visibility || 'public', 'published', now, now).run()
  return c.json({ data: { id: postId } }, 201)
})

app.get('/:id/comments', optionalAuth, async (c) => {
  const postId = c.req.param('id')
  const { results } = await c.env.DB.prepare(
    `SELECT co.*, pr.handle FROM comments co LEFT JOIN profiles pr ON pr.user_id = co.author_id WHERE co.post_id = ? AND co.state = 'published' ORDER BY co.created_at ASC`
  ).bind(postId).all()
  return c.json({ data: results })
})

app.post('/:id/comments', requireAuth, async (c) => {
  const user = c.get('user')!
  const postId = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  if (!body.body) return c.json({ error: { code: 'INVALID', message: 'Comment body required' } }, 400)
  const commentId = nanoid()
  await c.env.DB.prepare(
    'INSERT INTO comments (id, post_id, author_id, body, state, created_at) VALUES (?,?,?,?,?,?)'
  ).bind(commentId, postId, user.id, body.body.trim(), 'published', Math.floor(Date.now()/1000)).run()
  return c.json({ data: { id: commentId } }, 201)
})

export default app
