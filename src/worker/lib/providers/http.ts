import { safeHttpUrl } from '../validate'

const DEFAULT_TIMEOUT_MS = 15_000
const MAX_RESPONSE_BYTES = 12_000_000
const MAX_RETRIES = 2
const USER_AGENT = 'JobliteAHS/0.1 (+https://joblite-ahs.aidomexgroupltd.workers.dev; job ingestion)'

export class ProviderFetchError extends Error {
  readonly status: number | null
  readonly retryable: boolean

  constructor(message: string, status: number | null = null, retryable = false) {
    super(message)
    this.name = 'ProviderFetchError'
    this.status = status
    this.retryable = retryable
  }
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host) return true
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true
  if (host === 'metadata.google.internal' || host === 'metadata') return true
  if (host === '0.0.0.0' || host === '::1' || host === '::') return true
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true
  if (/^169\.254\./.test(host)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true
  if (/^fc[0-9a-f]{2}:/i.test(host) || /^fd[0-9a-f]{2}:/i.test(host) || /^fe80:/i.test(host)) return true
  return false
}

export function assertPublicFeedUrl(value: string): string {
  const safe = safeHttpUrl(value)
  if (!safe) throw new ProviderFetchError('Provider URL is not a valid http(s) URL')
  const url = new URL(safe)
  if (url.protocol !== 'https:') throw new ProviderFetchError('Provider feeds must use HTTPS')
  if (url.username || url.password) throw new ProviderFetchError('Provider URL must not contain credentials')
  if (isPrivateHost(url.hostname)) throw new ProviderFetchError('Provider URL points to a private or internal host')
  return url.toString()
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function retryDelayMs(response: Response | null, attempt: number): number {
  const header = response?.headers.get('Retry-After')
  if (header) {
    const seconds = Number(header)
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 10_000)
    const timestamp = Date.parse(header)
    if (!Number.isNaN(timestamp)) return Math.min(Math.max(timestamp - Date.now(), 0), 10_000)
  }
  return Math.min(600 * 2 ** attempt, 4_000)
}

function combineSignals(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('Provider request timed out')), timeoutMs)
  const onAbort = () => controller.abort(signal?.reason)
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason)
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    },
  }
}

export type FetchJsonOptions = {
  timeoutMs?: number
  maxRetries?: number
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}

/**
 * Fetches one JSON document with a hard timeout, bounded retries for transient
 * failures, redirect revalidation, and a response-size cap. Non-retryable
 * failures return immediately so one provider cannot stall the others.
 */
export async function fetchJson(urlValue: string, options: FetchJsonOptions = {}): Promise<unknown> {
  const url = assertPublicFeedUrl(urlValue)
  const timeoutMs = Math.max(1_000, Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 30_000))
  const maxRetries = Math.max(0, Math.min(options.maxRetries ?? MAX_RETRIES, 4))
  const fetchImpl = options.fetchImpl ?? fetch

  let lastError: ProviderFetchError | null = null
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const { signal, cancel } = combineSignals(options.signal, timeoutMs)
    let response: Response | null = null
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': USER_AGENT,
        },
        redirect: 'follow',
        signal,
      })

      if (response.url && isPrivateHost(new URL(response.url).hostname)) {
        throw new ProviderFetchError('Provider redirected to a private host', response.status, false)
      }

      if (!response.ok) {
        const retryable = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500
        lastError = new ProviderFetchError(`Provider responded with HTTP ${response.status}`, response.status, retryable)
        if (!retryable) throw lastError
        if (attempt < maxRetries) {
          await sleep(retryDelayMs(response, attempt))
          continue
        }
        throw lastError
      }

      const contentType = (response.headers.get('content-type') || '').toLowerCase()
      if (!contentType.includes('json')) {
        throw new ProviderFetchError(`Expected JSON from provider, received ${contentType || 'unknown content type'}`, response.status, false)
      }

      const declared = Number(response.headers.get('content-length'))
      if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
        throw new ProviderFetchError('Provider response exceeded the maximum size', response.status, false)
      }

      const text = await response.text()
      if (text.length > MAX_RESPONSE_BYTES) {
        throw new ProviderFetchError('Provider response exceeded the maximum size', response.status, false)
      }
      if (/^\s*</.test(text)) {
        throw new ProviderFetchError('Provider returned HTML instead of JSON', response.status, false)
      }

      try {
        return JSON.parse(text) as unknown
      } catch {
        throw new ProviderFetchError('Provider returned invalid JSON', response.status, false)
      }
    } catch (caught) {
      if (caught instanceof ProviderFetchError) {
        if (!caught.retryable || attempt >= maxRetries) throw caught
        lastError = caught
      } else if (caught instanceof DOMException && caught.name === 'AbortError') {
        const error = new ProviderFetchError('Provider request was cancelled or timed out', null, true)
        if (attempt >= maxRetries) throw error
        lastError = error
      } else {
        const error = new ProviderFetchError(
          `Provider request failed: ${caught instanceof Error ? caught.message : 'network error'}`,
          null,
          true
        )
        if (attempt >= maxRetries) throw error
        lastError = error
      }
      await sleep(retryDelayMs(response, attempt))
    } finally {
      cancel()
    }
  }

  throw lastError ?? new ProviderFetchError('Provider request failed')
}
