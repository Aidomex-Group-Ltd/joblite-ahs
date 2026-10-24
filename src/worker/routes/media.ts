import { Hono } from 'hono'
import type { AppContext } from '../types'
import { nanoid } from 'nanoid'
import { requireAuth } from '../middleware/auth'
import { slugify } from '../lib/validate'

const app = new Hono<AppContext>()

const RULES: Record<string, { kind: 'image' | 'video' | 'document'; maxBytes: number; types: string[] }> = {
  post_image: { kind: 'image', maxBytes: 8 * 1024 * 1024, types: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] },
  post_video: { kind: 'video', maxBytes: 50 * 1024 * 1024, types: ['video/mp4', 'video/webm'] },
  cv: { kind: 'document', maxBytes: 10 * 1024 * 1024, types: ['application/pdf'] },
}

function extensionFor(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'application/pdf': 'pdf',
  }
  return map[mime] || 'bin'
}

app.post('/upload', requireAuth, async (c) => {
  const user = c.get('user')!
  let form: Record<string, unknown>
  try {
    form = await c.req.parseBody()
  } catch {
    return c.json({ error: { code: 'INVALID_BODY', message: 'Expected a multipart form upload' } }, 400)
  }

  const purpose = typeof form.purpose === 'string' ? form.purpose : 'post_image'
  const rule = RULES[purpose]
  if (!rule) return c.json({ error: { code: 'INVALID_PURPOSE', message: 'Unknown upload purpose' } }, 400)

  const file = form.file
  if (!(file instanceof File)) {
    return c.json({ error: { code: 'INVALID_FILE', message: 'Choose a file to upload' } }, 400)
  }
  if (!rule.types.includes(file.type)) {
    return c.json({ error: { code: 'INVALID_TYPE', message: `Unsupported file type. Allowed: ${rule.types.join(', ')}` } }, 400)
  }
  if (file.size === 0) return c.json({ error: { code: 'INVALID_FILE', message: 'The selected file is empty' } }, 400)
  if (file.size > rule.maxBytes) {
    return c.json(
      { error: { code: 'FILE_TOO_LARGE', message: `Maximum size for this upload is ${Math.round(rule.maxBytes / (1024 * 1024))} MB` } },
      413
    )
  }

  const mediaId = nanoid()
  const filename = slugify(typeof form.filename === 'string' ? form.filename : file.name.split('.')[0] || 'upload', 40) || 'upload'
  const objectKey = `uploads/${user.id}/${mediaId}/${filename}.${extensionFor(file.type)}`

  await c.env.MEDIA.put(objectKey, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type, cacheControl: 'public, max-age=31536000, immutable' },
  })

  const now = Math.floor(Date.now() / 1000)
  try {
    await c.env.DB.prepare(
      `INSERT INTO media (id, owner_id, object_key, purpose, type, size, state, mime_type, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    )
      .bind(mediaId, user.id, objectKey, purpose, rule.kind, file.size, 'ready', file.type, now, now)
      .run()
  } catch (error) {
    await c.env.MEDIA.delete(objectKey).catch(() => {})
    throw error
  }

  return c.json(
    {
      data: {
        id: mediaId,
        url: `/api/v1/media/${mediaId}/content`,
        kind: rule.kind,
        mime_type: file.type,
        size: file.size,
        name: filename,
      },
    },
    201
  )
})

app.post('/intents', requireAuth, async (c) => {
  const user = c.get('user')!
  const body = await c.req.json().catch(() => ({}))
  const purpose = body.purpose === 'post_video' ? 'post_video' : body.purpose === 'cv' ? 'cv' : 'post_image'
  const rule = RULES[purpose]
  if (body.content_type && !rule.types.includes(body.content_type)) {
    return c.json({ error: { code: 'INVALID_TYPE', message: 'File type not allowed for this purpose' } }, 400)
  }
  if (typeof body.size === 'number' && body.size > rule.maxBytes) {
    return c.json({ error: { code: 'FILE_TOO_LARGE', message: 'File is larger than the allowed maximum' } }, 413)
  }

  const mediaId = nanoid()
  const now = Math.floor(Date.now() / 1000)
  await c.env.DB.prepare(
    `INSERT INTO media (id, owner_id, object_key, purpose, type, size, state, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  )
    .bind(mediaId, user.id, `uploads/${user.id}/${mediaId}/pending`, purpose, rule.kind, body.size || 0, 'pending', now, now)
    .run()

  return c.json(
    {
      data: {
        media_id: mediaId,
        state: 'pending',
        upload_path: '/api/v1/media/upload',
        note: 'Upload the file to POST /api/v1/media/upload with this purpose; only ready media can be published.',
      },
    },
    201
  )
})

app.post('/:id/complete', requireAuth, async (c) => {
  const user = c.get('user')!
  const mediaId = c.req.param('id')
  const media = await c.env.DB.prepare('SELECT * FROM media WHERE id = ? AND owner_id = ?').bind(mediaId, user.id).first<any>()
  if (!media) return c.json({ error: { code: 'NOT_FOUND', message: 'Media not found' } }, 404)

  const object = await c.env.MEDIA.head(media.object_key)
  if (!object) {
    return c.json({ error: { code: 'UPLOAD_MISSING', message: 'No uploaded file was found for this media record' } }, 409)
  }
  await c.env.DB.prepare('UPDATE media SET state = ?, mime_type = COALESCE(mime_type, ?), size = ?, updated_at = ? WHERE id = ?')
    .bind('ready', object.httpMetadata?.contentType || null, object.size, Math.floor(Date.now() / 1000), mediaId)
    .run()
  return c.json({ data: { id: mediaId, state: 'ready', url: `/api/v1/media/${mediaId}/content` } })
})

app.get('/:id/content', async (c) => {
  const mediaId = c.req.param('id')
  const media = await c.env.DB.prepare("SELECT * FROM media WHERE id = ? AND state = 'ready'").bind(mediaId).first<any>()
  if (!media) return c.json({ error: { code: 'NOT_FOUND', message: 'Media not found' } }, 404)

  const rangeHeader = c.req.header('Range')
  const contentType = media.mime_type || 'application/octet-stream'
  const headers = new Headers({
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
  })

  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
    if (match) {
      const start = match[1] ? Number.parseInt(match[1], 10) : 0
      const requestedEnd = match[2] ? Number.parseInt(match[2], 10) : undefined
      if (Number.isFinite(start) && start >= 0) {
        const object = await c.env.MEDIA.get(media.object_key, {
          range: { offset: start, length: requestedEnd !== undefined ? Math.max(requestedEnd - start + 1, 1) : undefined },
        })
        if (!object) return c.json({ error: { code: 'NOT_FOUND', message: 'Media object missing' } }, 404)
        const end = requestedEnd !== undefined ? Math.min(requestedEnd, object.size - 1) : object.size - 1
        headers.set('Content-Range', `bytes ${start}-${end}/${object.size}`)
        headers.set('Content-Length', String(end - start + 1))
        return new Response(object.body, { status: 206, headers })
      }
    }
  }

  const object = await c.env.MEDIA.get(media.object_key)
  if (!object) return c.json({ error: { code: 'NOT_FOUND', message: 'Media object missing' } }, 404)
  headers.set('Content-Length', String(object.size))
  return new Response(object.body, { headers })
})

app.delete('/:id', requireAuth, async (c) => {
  const user = c.get('user')!
  const mediaId = c.req.param('id')
  const media = await c.env.DB.prepare('SELECT * FROM media WHERE id = ? AND owner_id = ?').bind(mediaId, user.id).first<any>()
  if (!media) return c.json({ error: { code: 'NOT_FOUND', message: 'Media not found' } }, 404)

  const attached = await c.env.DB.prepare('SELECT post_id FROM post_media WHERE media_id = ?').bind(mediaId).first()
  if (attached) return c.json({ error: { code: 'MEDIA_IN_USE', message: 'This media is attached to a published post' } }, 409)

  await c.env.MEDIA.delete(media.object_key).catch(() => {})
  await c.env.DB.prepare('DELETE FROM media WHERE id = ?').bind(mediaId).run()
  return c.json({ data: { id: mediaId, deleted: true } })
})

export default app
