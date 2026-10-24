import { Hono } from 'hono'
import type { AppContext } from '../types'
import { nanoid } from 'nanoid'
import { requireAuth, optionalAuth } from '../middleware/auth'
import { clampInt, sanitizeText } from '../lib/validate'

const app = new Hono<AppContext>()

type Row = Record<string, any>

const POST_SELECT = `SELECT p.id, p.body, p.created_at, p.updated_at, p.author_id, p.job_id, p.visibility,
  u.display_name as author_display_name,
  pr.handle as author_handle,
  pr.headline as author_headline,
  COALESCE(u.display_name, pr.handle, 'Joblite member') as author_name,
  (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.state = 'published') as comment_count,
  (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p.id) as like_count
  FROM posts p
  JOIN users u ON u.id = p.author_id
  LEFT JOIN profiles pr ON pr.user_id = p.author_id`

async function attachPostMedia(c: any, posts: Row[]): Promise<Row[]> {
  if (posts.length === 0) return posts
  const ids = posts.map((post) => post.id)
  const placeholders = ids.map(() => '?').join(',')
  const { results } = await c.env.DB.prepare(
    `SELECT pm.post_id, pm.ordering, pm.alt_text as post_alt, m.id, m.type, m.mime_type, m.object_key, m.state, m.alt_text
     FROM post_media pm JOIN media m ON m.id = pm.media_id
     WHERE pm.post_id IN (${placeholders}) AND m.state = 'ready'
     ORDER BY pm.ordering ASC`
  )
    .bind(...ids)
    .all()
  const media = results as Row[]
  return posts.map((post): Row => ({
    ...post,
    media: media
      .filter((row) => row.post_id === post.id)
      .map((row) => ({
        id: row.id,
        kind: row.type === 'video' ? 'video' : 'image',
        url: `/api/v1/media/${row.id}/content`,
        mime_type: row.mime_type || null,
        alt: row.post_alt || row.alt_text || '',
      })),
  }))
}

async function likedSet(c: any, postIds: string[], userId?: string) {
  if (!userId || postIds.length === 0) return new Set<string>()
  const placeholders = postIds.map(() => '?').join(',')
  const { results } = await c.env.DB.prepare(
    `SELECT post_id FROM post_likes WHERE user_id = ? AND post_id IN (${placeholders})`
  )
    .bind(userId, ...postIds)
    .all()
  return new Set((results as Row[]).map((row) => row.post_id))
}

app.get('/', optionalAuth, async (c) => {
  const limit = clampInt(c.req.query('limit'), 1, 100, 20)
  const offset = clampInt(c.req.query('offset'), 0, 100000, 0)
  const user = c.get('user')
  const followingOnly = c.req.query('following') === '1'
  if (followingOnly && !user) {
    return c.json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to see people you follow' } }, 401)
  }

  const whereSql = followingOnly
    ? `p.state = 'published' AND p.visibility = 'public' AND p.author_id IN (SELECT followee_id FROM follows WHERE follower_id = ?)`
    : `p.state = 'published' AND p.visibility = 'public'`
  const filterParams = followingOnly ? [user!.id] : []

  const countRow = await c.env.DB.prepare(`SELECT COUNT(*) as total FROM posts p WHERE ${whereSql}`)
    .bind(...filterParams)
    .first<{ total: number }>()

  const { results } = await c.env.DB.prepare(
    `${POST_SELECT}
     WHERE ${whereSql}
     ORDER BY p.created_at DESC, p.id DESC LIMIT ? OFFSET ?`
  )
    .bind(...filterParams, limit, offset)
    .all()

  const withMedia = await attachPostMedia(c, results as Row[])
  const liked = await likedSet(c, withMedia.map((post) => post.id), user?.id)
  const total = countRow?.total ?? 0
  return c.json({
    data: withMedia.map((post) => ({ ...post, liked: liked.has(post.id), is_own: post.author_id === user?.id })),
    meta: { limit, offset, total, has_more: offset + withMedia.length < total, next_offset: offset + withMedia.length },
  })
})

app.get('/:id', optionalAuth, async (c) => {
  const id = c.req.param('id')
  const user = c.get('user')
  const post = await c.env.DB.prepare(`${POST_SELECT} WHERE p.id = ?`).bind(id).first<Row>()
  if (!post || post.visibility !== 'public') {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Post not found' } }, 404)
  }
  const [withMedia] = await attachPostMedia(c, [post])
  const liked = await likedSet(c, [post.id], user?.id)
  return c.json({ data: { ...withMedia, liked: liked.has(post.id), is_own: post.author_id === user?.id } })
})

app.post('/', requireAuth, async (c) => {
  const user = c.get('user')!
  const body = await c.req.json().catch(() => ({}))
  const text = sanitizeText(body.body, 5000)
  if (!text) {
    return c.json({ error: { code: 'INVALID', message: 'Post text is required', fields: { body: 'Write something to post' } } }, 400)
  }

  const mediaIds: string[] = Array.isArray(body.media_ids)
    ? body.media_ids.filter((value: unknown): value is string => typeof value === 'string').slice(0, 4)
    : []

  for (const mediaId of mediaIds) {
    const media = await c.env.DB.prepare("SELECT id, type, state FROM media WHERE id = ? AND owner_id = ?")
      .bind(mediaId, user.id)
      .first<any>()
    if (!media) return c.json({ error: { code: 'INVALID_MEDIA', message: 'Attachment not found or not owned by you' } }, 400)
    if (media.state !== 'ready') {
      return c.json({ error: { code: 'MEDIA_NOT_READY', message: 'An attachment is still uploading' } }, 409)
    }
    if (!['image', 'video'].includes(media.type)) {
      return c.json({ error: { code: 'INVALID_MEDIA', message: 'Only images and videos can be attached to posts' } }, 400)
    }
  }

  let jobId: string | null = null
  if (typeof body.job_id === 'string' && body.job_id) {
    const job = await c.env.DB.prepare("SELECT id FROM jobs WHERE id = ? AND status = 'published'").bind(body.job_id).first()
    if (!job) return c.json({ error: { code: 'NOT_FOUND', message: 'Job not found' } }, 404)
    jobId = body.job_id
  }

  const postId = nanoid()
  const now = Math.floor(Date.now() / 1000)
  await c.env.DB.prepare(
    'INSERT INTO posts (id, author_id, job_id, body, visibility, state, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)'
  )
    .bind(postId, user.id, jobId, text, 'public', 'published', now, now)
    .run()

  for (const [index, mediaId] of mediaIds.entries()) {
    await c.env.DB.prepare('INSERT INTO post_media (post_id, media_id, ordering) VALUES (?,?,?)')
      .bind(postId, mediaId, index)
      .run()
  }

  await c.env.DB.prepare(
    "INSERT INTO outbox (id, event_id, event_type, payload_json, state, created_at) VALUES (?,?,?,?,'pending',?)"
  )
    .bind(nanoid(), nanoid(), 'post.published', JSON.stringify({ post_id: postId, author_id: user.id }), now)
    .run()

  return c.json({ data: { id: postId, created_at: now } }, 201)
})

app.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user')!
  const id = c.req.param('id')
  const post = await c.env.DB.prepare('SELECT id, author_id FROM posts WHERE id = ?').bind(id).first<any>()
  if (!post) return c.json({ error: { code: 'NOT_FOUND', message: 'Post not found' } }, 404)
  if (post.author_id !== user.id) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'You can only delete your own posts' } }, 403)
  }
  await c.env.DB.prepare("UPDATE posts SET state = 'deleted', updated_at = ? WHERE id = ?")
    .bind(Math.floor(Date.now() / 1000), id)
    .run()
  return c.json({ data: { id, state: 'deleted' } })
})

app.post('/:id/like', requireAuth, async (c) => {
  const user = c.get('user')!
  const id = c.req.param('id')
  const post = await c.env.DB.prepare("SELECT id FROM posts WHERE id = ? AND state = 'published'").bind(id).first()
  if (!post) return c.json({ error: { code: 'NOT_FOUND', message: 'Post not found' } }, 404)
  await c.env.DB.prepare('INSERT OR IGNORE INTO post_likes (post_id, user_id) VALUES (?,?)').bind(id, user.id).run()
  const count = await c.env.DB.prepare('SELECT COUNT(*) as total FROM post_likes WHERE post_id = ?').bind(id).first<any>()
  return c.json({ data: { liked: true, like_count: count?.total ?? 0 } })
})

app.delete('/:id/like', requireAuth, async (c) => {
  const user = c.get('user')!
  const id = c.req.param('id')
  const post = await c.env.DB.prepare('SELECT id FROM posts WHERE id = ?').bind(id).first()
  if (!post) return c.json({ error: { code: 'NOT_FOUND', message: 'Post not found' } }, 404)
  await c.env.DB.prepare('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?').bind(id, user.id).run()
  const count = await c.env.DB.prepare('SELECT COUNT(*) as total FROM post_likes WHERE post_id = ?').bind(id).first<any>()
  return c.json({ data: { liked: false, like_count: count?.total ?? 0 } })
})

app.get('/:id/comments', optionalAuth, async (c) => {
  const postId = c.req.param('id')
  const post = await c.env.DB.prepare("SELECT id FROM posts WHERE id = ? AND state = 'published'").bind(postId).first()
  if (!post) return c.json({ error: { code: 'NOT_FOUND', message: 'Post not found' } }, 404)
  const { results } = await c.env.DB.prepare(
    `SELECT co.id, co.body, co.created_at, co.author_id,
       COALESCE(u.display_name, pr.handle, 'Joblite member') as author_name,
       pr.handle as author_handle
     FROM comments co
     JOIN users u ON u.id = co.author_id
     LEFT JOIN profiles pr ON pr.user_id = co.author_id
     WHERE co.post_id = ? AND co.state = 'published'
     ORDER BY co.created_at ASC LIMIT 200`
  )
    .bind(postId)
    .all()
  return c.json({ data: results })
})

app.post('/:id/comments', requireAuth, async (c) => {
  const user = c.get('user')!
  const postId = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const text = sanitizeText(body.body, 2000)
  if (!text) return c.json({ error: { code: 'INVALID', message: 'Comment text is required' } }, 400)
  const post = await c.env.DB.prepare("SELECT id FROM posts WHERE id = ? AND state = 'published'").bind(postId).first()
  if (!post) return c.json({ error: { code: 'NOT_FOUND', message: 'Post not found' } }, 404)

  const commentId = nanoid()
  const now = Math.floor(Date.now() / 1000)
  await c.env.DB.prepare(
    'INSERT INTO comments (id, post_id, author_id, body, state, created_at) VALUES (?,?,?,?,?,?)'
  )
    .bind(commentId, postId, user.id, text, 'published', now)
    .run()

  const comment = await c.env.DB.prepare(
    `SELECT co.id, co.body, co.created_at, co.author_id,
       COALESCE(u.display_name, pr.handle, 'Joblite member') as author_name,
       pr.handle as author_handle
     FROM comments co JOIN users u ON u.id = co.author_id
     LEFT JOIN profiles pr ON pr.user_id = co.author_id WHERE co.id = ?`
  )
    .bind(commentId)
    .first()

  return c.json({ data: comment }, 201)
})

export default app
