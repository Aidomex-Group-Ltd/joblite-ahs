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
      typeof error?.request_id === 'string' ? error.request_id : undefined
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
  return new Promise<UploadedMedia>((resolve, reject) => {
    const form = new FormData()
    form.append('file', file)
    form.append('purpose', purpose)
    form.append('filename', file.name)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/v1/media/upload')
    xhr.withCredentials = true
    xhr.setRequestHeader('Accept', 'application/json')

    const abort = () => xhr.abort()
    if (signal) {
      if (signal.aborted) {
        reject(new DOMException('Upload cancelled', 'AbortError'))
        return
      }
      signal.addEventListener('abort', abort, { once: true })
    }

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total === 0) return
      onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)))
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
        onProgress(100)
        resolve(payload.data as UploadedMedia)
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
    xhr.send(form)
  })
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Something went wrong. Please try again.'
}
