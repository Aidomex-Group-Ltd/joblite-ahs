import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import media from '../src/worker/routes/media'
import posts from '../src/worker/routes/posts'
import { sameOriginMutations } from '../src/worker/middleware/security'
import type { Env } from '../src/worker/types'
import { VIDEO_HARD_MAX_BYTES, VIDEO_PART_BYTES, VIDEO_RECOMMENDED_MAX_BYTES } from '../src/shared/media-limits'
import { createTestEnv } from './helpers/d1'

const now = Math.floor(Date.now() / 1000)

async function tokenHash(token: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token))
  return Array.from(new Uint8Array(signature)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Minimal in-memory stand-in for the R2 multipart API used by the media routes. */
function fakeBucket() {
  const objects = new Map<string, { size: number; contentType?: string }>()
  const uploads = new Map<string, { key: string; contentType?: string; parts: Map<number, number> }>()
  let counter = 0

  const handle = (key: string, uploadId: string) => ({
    key,
    uploadId,
    async uploadPart(partNumber: number, value: ArrayBuffer) {
      const upload = uploads.get(uploadId)
      if (!upload) throw new Error('NoSuchUpload')
      upload.parts.set(partNumber, value.byteLength)
      return { partNumber, etag: `etag-${uploadId}-${partNumber}` }
    },
    async abort() {
      uploads.delete(uploadId)
    },
    async complete(parts: Array<{ partNumber: number; etag: string }>) {
      const upload = uploads.get(uploadId)
      if (!upload) throw new Error('NoSuchUpload')
      let size = 0
      for (const part of parts) {
        if (part.etag !== `etag-${uploadId}-${part.partNumber}` || !upload.parts.has(part.partNumber)) throw new Error('InvalidPart')
        size += upload.parts.get(part.partNumber)!
      }
      uploads.delete(uploadId)
      objects.set(key, { size, contentType: upload.contentType })
      return { key, size }
    },
  })

  const bucket = {
    async createMultipartUpload(key: string, options?: { httpMetadata?: { contentType?: string } }) {
      counter += 1
      const uploadId = `upload-${counter}`
      uploads.set(uploadId, { key, contentType: options?.httpMetadata?.contentType, parts: new Map() })
      return handle(key, uploadId)
    },
    resumeMultipartUpload(key: string, uploadId: string) {
      return handle(key, uploadId)
    },
    async head(key: string) {
      return objects.get(key) ?? null
    },
    async delete(key: string) {
      objects.delete(key)
    },
  }
  return { bucket, objects, uploads }
}

describe('chunked post-video uploads', () => {
  let env: Env
  let close: () => void
  let r2: ReturnType<typeof fakeBucket>
  let request: (path: string, userId: string, init?: RequestInit) => Promise<Response>
  const tokens: Record<string, string> = {}

  beforeEach(async () => {
    const test = createTestEnv()
    env = test.env
    close = test.close
    r2 = fakeBucket()
    ;(env as any).MEDIA = r2.bucket
    for (const id of ['uploader', 'other']) {
      await env.DB.prepare('INSERT INTO users (id, email_normalized, display_name) VALUES (?,?,?)').bind(id, `${id}@media.test`, id).run()
      tokens[id] = `${id}-session`
      await env.DB.prepare('INSERT INTO sessions (id, token_hash, user_id, expires_at) VALUES (?,?,?,?)')
        .bind(`${id}-row`, await tokenHash(tokens[id], env.SESSION_SECRET), id, now + 3600)
        .run()
    }
    const router = new Hono()
    router.use('/api/*', sameOriginMutations)
    router.route('/api/v1/media', media)
    router.route('/api/v1/posts', posts)
    request = async (path, userId, init = {}) => await router.request(path, {
      ...init,
      headers: { Cookie: `joblite_session=${tokens[userId]}`, ...(init.headers || {}) },
    }, env as any)
  })

  afterEach(() => close())

  const start = (userId: string, body: Record<string, unknown>) => request('/api/v1/media/multipart', userId, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ purpose: 'post_video', content_type: 'video/mp4', filename: 'clip.mp4', ...body }),
  })

  const sendPart = (userId: string, mediaId: string, partNumber: number, bytes: number) =>
    request(`/api/v1/media/multipart/${mediaId}/parts/${partNumber}`, userId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(bytes),
    })

  it('accepts videos up to the recommended size without confirmation', async () => {
    const response = await start('uploader', { size: VIDEO_RECOMMENDED_MAX_BYTES })
    expect(response.status).toBe(201)
    const { data } = await response.json() as any
    expect(data.part_size).toBe(VIDEO_PART_BYTES)
    expect(data.part_count).toBe(30)
  })

  it('requires explicit confirmation above the recommended size and accepts it once granted', async () => {
    const size = VIDEO_RECOMMENDED_MAX_BYTES + 1
    const refused = await start('uploader', { size })
    expect(refused.status).toBe(409)
    expect(((await refused.json()) as any).error.code).toBe('LARGE_FILE_CONFIRMATION_REQUIRED')
    expect(r2.uploads.size).toBe(0)

    const confirmed = await start('uploader', { size, acknowledge_large_file: true })
    expect(confirmed.status).toBe(201)
  })

  it('still rejects videos above the hard ceiling even when confirmed', async () => {
    const response = await start('uploader', { size: VIDEO_HARD_MAX_BYTES + 1, acknowledge_large_file: true })
    expect(response.status).toBe(413)
  })

  it('uploads parts, completes, and lets the video be attached to a post', async () => {
    const size = VIDEO_PART_BYTES + 1234
    const { data: session } = await (await start('uploader', { size })).json() as any

    const parts = []
    for (const [number, bytes] of [[1, VIDEO_PART_BYTES], [2, 1234]] as const) {
      const response = await sendPart('uploader', session.media_id, number, bytes)
      expect(response.status).toBe(200)
      parts.push((await response.json() as any).data)
    }

    const early = await request('/api/v1/posts', 'uploader', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Watch this', media_ids: [session.media_id] }),
    })
    expect(early.status).toBe(409)

    const completed = await request(`/api/v1/media/multipart/${session.media_id}/complete`, 'uploader', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parts }),
    })
    expect(completed.status).toBe(201)
    const { data: uploaded } = await completed.json() as any
    expect(uploaded).toMatchObject({ id: session.media_id, kind: 'video', size })

    const row = await env.DB.prepare('SELECT state, size, provider_id FROM media WHERE id = ?').bind(session.media_id).first<any>()
    expect(row).toMatchObject({ state: 'ready', size, provider_id: null })

    const post = await request('/api/v1/posts', 'uploader', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Watch this', media_ids: [session.media_id] }),
    })
    expect(post.status).toBe(201)
  })

  it('rejects parts with the wrong size, out-of-range numbers, and other users', async () => {
    const { data: session } = await (await start('uploader', { size: VIDEO_PART_BYTES + 10 })).json() as any
    expect((await sendPart('uploader', session.media_id, 2, 11)).status).toBe(400)
    expect((await sendPart('uploader', session.media_id, 3, 10)).status).toBe(400)
    expect((await sendPart('other', session.media_id, 2, 10)).status).toBe(404)

    const incomplete = await request(`/api/v1/media/multipart/${session.media_id}/complete`, 'uploader', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parts: [] }),
    })
    expect(incomplete.status).toBe(400)
  })

  it('aborts the R2 multipart upload when an in-progress video is deleted', async () => {
    const { data: session } = await (await start('uploader', { size: 100 })).json() as any
    expect(r2.uploads.size).toBe(1)
    const deleted = await request(`/api/v1/media/${session.media_id}`, 'uploader', { method: 'DELETE' })
    expect(deleted.status).toBe(200)
    expect(r2.uploads.size).toBe(0)
  })

  it('only allows raw octet-stream bodies on the video part route', async () => {
    const response = await request('/api/v1/posts', 'uploader', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(4),
    })
    expect(response.status).toBe(415)
  })
})
