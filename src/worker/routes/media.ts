import { Hono } from 'hono'
import type { AppContext } from '../types'
import { nanoid } from 'nanoid'
import type { Env } from '../types'
import { requireAuth } from '../middleware/auth'

const app = new Hono<AppContext>()

app.use('/*', requireAuth)

app.post('/intents', async (c) => {
  const user = c.get('user')!
  const body = await c.req.json().catch(() => ({}))
  const purpose = body.purpose || 'post_image'
  const type = body.type || 'image'
  
  // Validation
  const allowedTypes: Record<string, string[]> = {
    post_image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    post_video: ['video/mp4', 'video/webm'],
    cv: ['application/pdf']
  }
  if (allowedTypes[purpose] && body.content_type && !allowedTypes[purpose].includes(body.content_type)) {
    return c.json({ error: { code: 'INVALID_TYPE', message: 'File type not allowed' } }, 400)
  }
  
  const mediaId = nanoid()
  const objectKey = `uploads/${user.id}/${mediaId}/${body.filename || 'file'}`
  const now = Math.floor(Date.now()/1000)
  
  await c.env.DB.prepare(
    'INSERT INTO media (id, owner_id, object_key, purpose, type, size, state, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)'
  ).bind(mediaId, user.id, objectKey, purpose, type, body.size || 0, 'quarantined', now, now).run()
  
  // For R2, we could generate presigned upload URL in production
  // In dev/local, indicate direct upload capability
  return c.json({ data: { 
    media_id: mediaId, 
    object_key: objectKey,
    upload_url: null, // Would be presigned URL in production
    state: 'quarantined',
    note: purpose === 'post_video' ? 'Video uploads require Cloudflare Stream configuration' : 'Upload to R2 via binding'
  } }, 201)
})

app.post('/:id/complete', async (c) => {
  const user = c.get('user')!
  const mediaId = c.req.param('id')
  const media = await c.env.DB.prepare('SELECT * FROM media WHERE id = ? AND owner_id = ?').bind(mediaId, user.id).first<any>()
  if (!media) return c.json({ error: { code: 'NOT_FOUND', message: 'Media not found' } }, 404)
  
  // Validate (basic checks)
  // In production would check object exists in R2
  await c.env.DB.prepare('UPDATE media SET state = ?, updated_at = ? WHERE id = ?')
    .bind('ready', Math.floor(Date.now()/1000), mediaId).run()
  
  return c.json({ data: { id: mediaId, state: 'ready' } })
})

export default app
