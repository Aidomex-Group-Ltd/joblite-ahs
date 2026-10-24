import type { Context, Next } from 'hono'

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function configuredOrigin(c: Context<any>): string | null {
  const appUrl = (c.env as any)?.APP_URL
  if (typeof appUrl === 'string' && appUrl) return appUrl.replace(/\/$/, '')
  return null
}

/**
 * Rejects cross-site state-changing requests. Session cookies are already
 * SameSite=Strict; this is the second line of defence and also protects
 * non-browser clients from being confused about accepted origins.
 */
export async function sameOriginMutations(c: Context<any>, next: Next) {
  if (!MUTATING.has(c.req.method)) return next()

  const origin = c.req.header('Origin')
  const configured = configuredOrigin(c)
  if (origin) {
    let allowed = false
    try {
      const parsed = new URL(origin)
      const requestUrl = new URL(c.req.url)
      allowed = parsed.host === requestUrl.host
      if (!allowed && configured) allowed = origin === configured
    } catch {
      allowed = false
    }
    if (!allowed) {
      return c.json({ error: { code: 'CSRF_REJECTED', message: 'Request origin is not allowed' } }, 403)
    }
  }

  if (MUTATING.has(c.req.method) && c.req.path.startsWith('/api/')) {
    const contentType = c.req.header('Content-Type') || ''
    const hasBody = c.req.method !== 'DELETE'
    if (hasBody && !contentType.includes('application/json') && !contentType.includes('multipart/form-data') && !contentType.includes('application/x-www-form-urlencoded')) {
      return c.json({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Expected a JSON or form request body' } }, 415)
    }
  }

  return next()
}

export function sessionCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  const parts = [
    `joblite_session=${token}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function clearedSessionCookie(secure: boolean): string {
  const parts = ['joblite_session=', 'HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=0']
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function shouldUseSecureCookie(appUrl: string | undefined): boolean {
  if (appUrl && appUrl.startsWith('https://')) return true
  return false
}
