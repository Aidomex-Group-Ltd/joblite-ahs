import { Hono } from 'hono'
import type { AppContext, Env } from '../types'
import { nanoid } from 'nanoid'
import { optionalAuth, requireAuth } from '../middleware/auth'
import { slugify } from '../lib/validate'
import {
  formatMegabytes,
  IMAGE_MAX_BYTES,
  IMAGE_TYPES,
  VIDEO_HARD_MAX_BYTES,
  VIDEO_PART_BYTES,
  VIDEO_RECOMMENDED_MAX_BYTES,
  VIDEO_TYPES,
  videoPartCount,
} from '../../shared/media-limits'

const app = new Hono<AppContext>()

// Single-request uploads are buffered in Worker memory, so large videos must use
// the multipart endpoints below instead of POST /upload.
const RULES: Record<string, { kind: 'image' | 'video' | 'document'; maxBytes: number; types: string[] }> = {
  post_image: { kind: 'image', maxBytes: IMAGE_MAX_BYTES, types: IMAGE_TYPES },
  post_video: { kind: 'video', maxBytes: 50 * 1024 * 1024, types: VIDEO_TYPES },
  cv: { kind: 'document', maxBytes: 10 * 1024 * 1024, types: ['application/pdf'] },
}

type MultipartMediaRow = {
  id: string
  object_key: string
  provider_id: string | null
  size: number
  mime_type: string | null
  state: string
}

async function loadOwnMultipart(env: Env, mediaId: string, ownerId: string): Promise<MultipartMediaRow | null> {
  return await env.DB.prepare(
    "SELECT id, object_key, provider_id, size, mime_type, state FROM media WHERE id = ? AND owner_id = ? AND purpose = 'post_video'"
  ).bind(mediaId, ownerId).first<MultipartMediaRow>()
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

/**
 * Starts a chunked post-video upload backed by an R2 multipart upload. Videos
 * above the recommended size need `acknowledge_large_file: true`, which the
 * client only sends after the uploader confirms the large-file warning.
 */
app.post('/multipart', requireAuth, async (c) => {
  const user = c.get('user')!
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  if (body.purpose !== 'post_video') {
    return c.json({ error: { code: 'INVALID_PURPOSE', message: 'Chunked uploads are only available for post videos' } }, 400)
  }
  const contentType = typeof body.content_type === 'string' ? body.content_type : ''
  if (!VIDEO_TYPES.includes(contentType)) {
    return c.json({ error: { code: 'INVALID_TYPE', message: `Unsupported file type. Allowed: ${VIDEO_TYPES.join(', ')}` } }, 400)
  }
  const size = typeof body.size === 'number' && Number.isSafeInteger(body.size) ? body.size : 0
  if (size <= 0) return c.json({ error: { code: 'INVALID_FILE', message: 'The selected file is empty' } }, 400)
  if (size > VIDEO_HARD_MAX_BYTES) {
    return c.json(
      { error: { code: 'FILE_TOO_LARGE', message: `Videos can be at most ${formatMegabytes(VIDEO_HARD_MAX_BYTES)}` } },
      413
    )
  }
  if (size > VIDEO_RECOMMENDED_MAX_BYTES && body.acknowledge_large_file !== true) {
    return c.json(
      {
        error: {
          code: 'LARGE_FILE_CONFIRMATION_REQUIRED',
          message: `This video is larger than the recommended ${formatMegabytes(VIDEO_RECOMMENDED_MAX_BYTES)}. Confirm to upload it anyway.`,
        },
      },
      409
    )
  }

  const mediaId = nanoid()
  const rawName = typeof body.filename === 'string' ? body.filename.replace(/\.[^.]+$/, '') : ''
  const filename = slugify(rawName || 'upload', 40) || 'upload'
  const objectKey = `uploads/${user.id}/${mediaId}/${filename}.${extensionFor(contentType)}`
  const upload = await c.env.MEDIA.createMultipartUpload(objectKey, {
    httpMetadata: { contentType, cacheControl: 'public, max-age=31536000, immutable' },
  })

  const now = Math.floor(Date.now() / 1000)
  try {
    await c.env.DB.prepare(
      `INSERT INTO media (id, owner_id, object_key, provider_id, purpose, type, size, state, mime_type, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    )
      .bind(mediaId, user.id, objectKey, upload.uploadId, 'post_video', 'video', size, 'uploading', contentType, now, now)
      .run()
  } catch (error) {
    await upload.abort().catch(() => {})
    throw error
  }

  return c.json(
    {
      data: {
        media_id: mediaId,
        state: 'uploading',
        part_size: VIDEO_PART_BYTES,
        part_count: videoPartCount(size),
        size,
      },
    },
    201
  )
})

app.put('/multipart/:id/parts/:part', requireAuth, async (c) => {
  const user = c.get('user')!
  const media = await loadOwnMultipart(c.env, c.req.param('id') || '', user.id)
  if (!media) return c.json({ error: { code: 'NOT_FOUND', message: 'Upload not found' } }, 404)
  if (media.state !== 'uploading' || !media.provider_id) {
    return c.json({ error: { code: 'UPLOAD_CLOSED', message: 'This upload is no longer accepting parts' } }, 409)
  }

  const partCount = videoPartCount(media.size)
  const partParam = c.req.param('part') || ''
  const partNumber = /^\d+$/.test(partParam) ? Number.parseInt(partParam, 10) : 0
  if (partNumber < 1 || partNumber > partCount) {
    return c.json({ error: { code: 'INVALID_PART', message: `Part number must be between 1 and ${partCount}` } }, 400)
  }
  const expected = partNumber < partCount ? VIDEO_PART_BYTES : media.size - VIDEO_PART_BYTES * (partCount - 1)
  const declared = Number.parseInt(c.req.header('Content-Length') || '', 10)
  if (Number.isFinite(declared) && declared > expected) {
    return c.json({ error: { code: 'PART_SIZE_MISMATCH', message: `Part ${partNumber} must be exactly ${expected} bytes` } }, 413)
  }

  const data = await c.req.arrayBuffer()
  if (data.byteLength !== expected) {
    return c.json({ error: { code: 'PART_SIZE_MISMATCH', message: `Part ${partNumber} must be exactly ${expected} bytes` } }, 400)
  }

  const upload = c.env.MEDIA.resumeMultipartUpload(media.object_key, media.provider_id)
  const part = await upload.uploadPart(partNumber, data)
  return c.json({ data: { part_number: part.partNumber, etag: part.etag } })
})

app.post('/multipart/:id/complete', requireAuth, async (c) => {
  const user = c.get('user')!
  const media = await loadOwnMultipart(c.env, c.req.param('id') || '', user.id)
  if (!media) return c.json({ error: { code: 'NOT_FOUND', message: 'Upload not found' } }, 404)
  if (media.state !== 'uploading' || !media.provider_id) {
    return c.json({ error: { code: 'UPLOAD_CLOSED', message: 'This upload has already been completed or cancelled' } }, 409)
  }

  const body = (await c.req.json().catch(() => ({}))) as { parts?: unknown }
  const partCount = videoPartCount(media.size)
  const parts = (Array.isArray(body.parts) ? body.parts : [])
    .map((value: unknown) => {
      const item = (value && typeof value === 'object' ? value : {}) as { part_number?: unknown; etag?: unknown }
      return { partNumber: Number(item.part_number), etag: typeof item.etag === 'string' ? item.etag : '' }
    })
    .sort((a, b) => a.partNumber - b.partNumber)
  const complete = parts.length === partCount && parts.every((part, index) => part.partNumber === index + 1 && part.etag)
  if (!complete) {
    return c.json({ error: { code: 'UPLOAD_INCOMPLETE', message: `All ${partCount} parts must be uploaded before completing` } }, 400)
  }

  const upload = c.env.MEDIA.resumeMultipartUpload(media.object_key, media.provider_id)
  let object: R2Object
  try {
    object = await upload.complete(parts)
  } catch {
    return c.json({ error: { code: 'UPLOAD_INCOMPLETE', message: 'The uploaded parts could not be assembled. Retry the upload.' } }, 400)
  }
  if (object.size !== media.size) {
    await c.env.MEDIA.delete(media.object_key).catch(() => {})
    await c.env.DB.prepare('DELETE FROM media WHERE id = ?').bind(media.id).run()
    return c.json({ error: { code: 'UPLOAD_INCOMPLETE', message: 'The uploaded video does not match the declared size' } }, 400)
  }

  await c.env.DB.prepare(
    "UPDATE media SET state = 'ready', provider_id = NULL, size = ?, updated_at = ? WHERE id = ? AND state = 'uploading'"
  )
    .bind(object.size, Math.floor(Date.now() / 1000), media.id)
    .run()

  return c.json(
    {
      data: {
        id: media.id,
        url: `/api/v1/media/${media.id}/content`,
        kind: 'video',
        mime_type: media.mime_type,
        size: object.size,
        name: media.object_key.split('/').pop()?.replace(/\.[^.]+$/, '') || 'upload',
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

app.get('/:id/content', optionalAuth, async (c) => {
  const mediaId = c.req.param('id')
  const media = await c.env.DB.prepare("SELECT * FROM media WHERE id = ? AND state = 'ready'").bind(mediaId).first<any>()
  if (!media) return c.json({ error: { code: 'NOT_FOUND', message: 'Media not found' } }, 404)

  const publicAttachment = await c.env.DB.prepare(
    `SELECT pm.post_id FROM post_media pm JOIN posts p ON p.id = pm.post_id
     WHERE pm.media_id = ? AND p.state = 'published' AND p.visibility = 'public' LIMIT 1`
  ).bind(mediaId).first()
  const user = c.get('user')
  // A CV is only readable by its owner or by a hiring member of the organization
  // that received it on an application. The snapshot keeps the original media id,
  // so replacing the profile CV later never rewrites submitted evidence.
  const applicationCv = !publicAttachment && user && media.purpose === 'cv'
    ? await c.env.DB.prepare(
      `SELECT a.id FROM application_snapshots s
       JOIN applications a ON a.id = s.application_id JOIN jobs j ON j.id = a.job_id
       JOIN memberships m ON m.organization_id = j.organization_id
       WHERE s.cv_media_id = ? AND m.user_id = ? LIMIT 1`
    ).bind(mediaId, user.id).first()
    : null
  if (!publicAttachment && !applicationCv && (!user || user.id !== media.owner_id)) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Media not found' } }, 404)
  }

  const rangeHeader = c.req.header('Range')
  const contentType = media.mime_type || 'application/octet-stream'
  const headers = new Headers({
    'Content-Type': contentType,
    'Cache-Control': publicAttachment ? 'public, max-age=300, s-maxage=300' : 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
  })
  if (media.purpose === 'cv' && !publicAttachment) {
    headers.set('Content-Disposition', 'inline; filename="submitted-cv.pdf"')
  }

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
  const submittedEvidence = await c.env.DB.prepare(
    'SELECT application_id FROM application_snapshots WHERE cv_media_id = ? LIMIT 1'
  ).bind(mediaId).first()
  if (submittedEvidence) {
    return c.json({ error: { code: 'MEDIA_IN_USE', message: 'This CV is preserved as submitted application evidence' } }, 409)
  }

  if (media.state === 'uploading' && media.provider_id) {
    await c.env.MEDIA.resumeMultipartUpload(media.object_key, media.provider_id).abort().catch(() => {})
  }
  await c.env.MEDIA.delete(media.object_key).catch(() => {})
  await c.env.DB.prepare('DELETE FROM media WHERE id = ?').bind(mediaId).run()
  return c.json({ data: { id: mediaId, deleted: true } })
})

export default app
