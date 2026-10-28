export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fields?: Record<string, string>
  readonly retryAfter?: number
  readonly requestId?: string

  constructor(status: number, code: string, message: string, fields?: Record<string, string>, retryAfter?: number, requestId?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fields = fields
    this.retryAfter = retryAfter
    this.requestId = requestId
  }
}

export type ApiEnvelope<T> = { data: T; meta?: Record<string, unknown> }

async function request<T>(path: string, init: RequestInit = {}): Promise<ApiEnvelope<T>> {
  let response: Response
  try {
    response = await fetch(`/api/v1${path}`, {
      credentials: 'include',
      ...init,
      headers: {
        Accept: 'application/json',
        ...(['POST', 'PUT', 'PATCH'].includes((init.method || 'GET').toUpperCase()) && !(init.body instanceof FormData)
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...init.headers,
      },
    })
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach Joblite. Check your connection and try again.')
  }

  if (response.status === 204) return { data: undefined as T }

  let payload: any = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    const error = payload?.error
    throw new ApiError(
      response.status,
      typeof error?.code === 'string' ? error.code : 'REQUEST_FAILED',
      typeof error?.message === 'string' ? error.message : `Request failed with status ${response.status}`,
      error?.fields,
      typeof error?.retry_after === 'number' ? error.retry_after : undefined,
      typeof error?.request_id === 'string'
        ? error.request_id
        : response.headers.get('X-Request-ID') || undefined
    )
  }

  return { data: (payload?.data ?? null) as T, meta: payload?.meta }
}

export function apiGet<T>(path: string, signal?: AbortSignal): Promise<ApiEnvelope<T>> {
  return request<T>(path, { method: 'GET', signal })
}

export function apiPost<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<ApiEnvelope<T>> {
  return request<T>(path, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })
}

export function apiPatch<T>(path: string, body?: unknown): Promise<ApiEnvelope<T>> {
  return request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) })
}

/** Downloads an authorized non-JSON resource (for example a CSV export) as a file. */
export async function apiDownload(path: string, filename: string): Promise<void> {
  let response: Response
  try {
    response = await fetch(`/api/v1${path}`, { credentials: 'include', headers: { Accept: 'text/csv' } })
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach Joblite. Check your connection and try again.')
  }
  if (!response.ok) {
    const payload: any = await response.json().catch(() => null)
    throw new ApiError(
      response.status,
      typeof payload?.error?.code === 'string' ? payload.error.code : 'REQUEST_FAILED',
      typeof payload?.error?.message === 'string' ? payload.error.message : `Export failed with status ${response.status}`
    )
  }
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function apiPut<T>(path: string, body?: unknown): Promise<ApiEnvelope<T>> {
  return request<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) })
}

export function apiDelete<T>(path: string): Promise<ApiEnvelope<T>> {
  return request<T>(path, { method: 'DELETE' })
}

export type UploadedMedia = { id: string; url: string; kind: 'image' | 'video' | 'document'; size: number }

export function uploadMedia(file: File, purpose: 'post_image' | 'post_video' | 'cv'): Promise<UploadedMedia> {
  const form = new FormData()
  form.append('file', file)
  form.append('purpose', purpose)
  form.append('filename', file.name)
  return request<UploadedMedia>('/media/upload', {
    method: 'POST',
    body: form,
  }).then((envelope) => envelope.data)
}

/**
 * Uploads with real progress events (fetch has no upload progress). Validation
 * still happens on the server; this only improves the composer experience.
 */
export function uploadMediaWithProgress(
  file: File,
  purpose: 'post_image' | 'post_video',
  onProgress: (percent: number) => void,
  signal?: AbortSignal
): Promise<UploadedMedia> {
  const form = new FormData()
  form.append('file', file)
  form.append('purpose', purpose)
  form.append('filename', file.name)
  return sendWithProgress<UploadedMedia>('POST', '/api/v1/media/upload', form, {}, (loaded, total) => {
    if (total > 0) onProgress(Math.min(99, Math.round((loaded / total) * 100)))
  }, signal).then((media) => {
    onProgress(100)
    return media
  })
}

function sendWithProgress<T>(
  method: 'POST' | 'PUT',
  url: string,
  body: XMLHttpRequestBodyInit,
  headers: Record<string, string>,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(method, url)
    xhr.withCredentials = true
    xhr.setRequestHeader('Accept', 'application/json')
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value)

    const abort = () => xhr.abort()
    if (signal) {
      if (signal.aborted) {
        reject(new DOMException('Upload cancelled', 'AbortError'))
        return
      }
      signal.addEventListener('abort', abort, { once: true })
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total)
    }
    xhr.onload = () => {
      signal?.removeEventListener('abort', abort)
      let payload: any = null
      try {
        payload = JSON.parse(xhr.responseText)
      } catch {
        payload = null
      }
      if (xhr.status >= 200 && xhr.status < 300 && payload?.data) {
        resolve(payload.data as T)
        return
      }
      const error = payload?.error
      reject(
        new ApiError(
          xhr.status,
          typeof error?.code === 'string' ? error.code : 'UPLOAD_FAILED',
          typeof error?.message === 'string' ? error.message : `Upload failed with status ${xhr.status}`
        )
      )
    }
    xhr.onerror = () => {
      signal?.removeEventListener('abort', abort)
      reject(new ApiError(0, 'NETWORK_ERROR', 'Could not upload this file. Check your connection and retry.'))
    }
    xhr.onabort = () => {
      signal?.removeEventListener('abort', abort)
      reject(new DOMException('Upload cancelled', 'AbortError'))
    }
    xhr.send(body)
  })
}

type MultipartSession = { media_id: string; part_size: number; part_count: number; size: number }
type UploadedPart = { part_number: number; etag: string }

const PART_CONCURRENCY = 3
const PART_ATTEMPTS = 3

function isRetryable(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 0 || error.status === 429 || error.status >= 500)
}

/**
 * Uploads a post video in fixed-size parts so large files never pass through a
 * single Worker request. `acknowledgeLargeFile` must reflect an explicit user
 * confirmation; the server rejects videos above the recommended size without it.
 */
export async function uploadVideoInParts(
  file: File,
  options: { acknowledgeLargeFile: boolean; onProgress: (percent: number) => void; signal?: AbortSignal }
): Promise<UploadedMedia> {
  const { acknowledgeLargeFile, onProgress, signal } = options
  const session = (
    await request<MultipartSession>('/media/multipart', {
      method: 'POST',
      body: JSON.stringify({
        purpose: 'post_video',
        content_type: file.type,
        size: file.size,
        filename: file.name,
        acknowledge_large_file: acknowledgeLargeFile,
      }),
      signal,
    })
  ).data
  const mediaPath = `/media/multipart/${encodeURIComponent(session.media_id)}`
  const partsController = new AbortController()
  const cancelParts = () => partsController.abort()
  signal?.addEventListener('abort', cancelParts, { once: true })
  const loadedByPart = new Map<number, number>()
  const reportProgress = () => {
    let loaded = 0
    for (const value of loadedByPart.values()) loaded += value
    onProgress(Math.min(99, Math.round((loaded / Math.max(file.size, 1)) * 100)))
  }

  const sendPart = async (partNumber: number): Promise<UploadedPart> => {
    const start = (partNumber - 1) * session.part_size
    const chunk = file.slice(start, Math.min(start + session.part_size, file.size))
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await sendWithProgress<UploadedPart>(
          'PUT',
          `/api/v1${mediaPath}/parts/${partNumber}`,
          chunk,
          { 'Content-Type': 'application/octet-stream' },
          (loaded) => {
            loadedByPart.set(partNumber, loaded)
            reportProgress()
          },
          partsController.signal
        )
      } catch (error) {
        loadedByPart.set(partNumber, 0)
        if (attempt >= PART_ATTEMPTS || !isRetryable(error) || partsController.signal.aborted) throw error
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
      }
    }
  }

  try {
    const parts: UploadedPart[] = []
    let next = 1
    const worker = async () => {
      while (next <= session.part_count) {
        const partNumber = next
        next += 1
        const part = await sendPart(partNumber)
        loadedByPart.set(partNumber, chunkSize(partNumber, session))
        reportProgress()
        parts.push(part)
      }
    }
    await Promise.all(Array.from({ length: Math.min(PART_CONCURRENCY, session.part_count) }, worker))
    const media = (await request<UploadedMedia>(`${mediaPath}/complete`, { method: 'POST', body: JSON.stringify({ parts }), signal })).data
    onProgress(100)
    return media
  } catch (error) {
    partsController.abort()
    void request(`/media/${encodeURIComponent(session.media_id)}`, { method: 'DELETE' }).catch(() => {})
    throw error
  } finally {
    signal?.removeEventListener('abort', cancelParts)
  }
}

function chunkSize(partNumber: number, session: MultipartSession): number {
  return partNumber < session.part_count ? session.part_size : session.size - session.part_size * (session.part_count - 1)
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Something went wrong. Please try again.'
}
