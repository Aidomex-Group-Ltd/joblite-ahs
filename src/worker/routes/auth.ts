import { Hono } from 'hono'
import type { AppContext } from '../types'
import { nanoid } from 'nanoid'
import { clearedSessionCookie, sessionCookie, shouldUseSecureCookie } from '../middleware/security'

const app = new Hono<AppContext>()

const CHALLENGE_TTL_SECONDS = 600
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7
const MAX_CHALLENGES_PER_WINDOW = 5
const RATE_WINDOW_SECONDS = 600

app.post('/challenges', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const email = typeof body.email === 'string' ? body.email.toLowerCase().trim() : ''
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return c.json({ error: { code: 'INVALID_EMAIL', message: 'Enter a valid email address' } }, 400)
  }

  const now = Math.floor(Date.now() / 1000)
  const recent = await c.env.DB.prepare(
    'SELECT COUNT(*) as total FROM auth_challenges WHERE email_normalized = ? AND created_at > ?'
  )
    .bind(email, now - RATE_WINDOW_SECONDS)
    .first<{ total: number }>()
  if ((recent?.total ?? 0) >= MAX_CHALLENGES_PER_WINDOW) {
    return c.json({ error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Try again in a few minutes.' } }, 429)
  }

  // Production sign-in depends on outbound email delivery. This build has no
  // delivery provider wired up, so it says so instead of pretending a link was
  // sent. Development returns the token for local testing.
  if (c.env.ENVIRONMENT === 'production') {
    return c.json(
      {
        error: {
          code: 'EMAIL_NOT_CONFIGURED',
          message: 'Sign-in email delivery is not configured for this deployment yet.',
        },
      },
      503
    )
  }

  const token = nanoid(32)
  const tokenHash = await hashToken(token, c.env.SESSION_SECRET)
  const expires = now + CHALLENGE_TTL_SECONDS
  await c.env.DB.prepare(
    'INSERT INTO auth_challenges (id, token_hash, email_normalized, purpose, expires_at, created_at) VALUES (?,?,?,?,?,?)'
  )
    .bind(nanoid(), tokenHash, email, 'login', expires, now)
    .run()

  return c.json({
    data: {
      message: 'Development sign-in token created. Use it to finish signing in.',
      expires_at: expires,
      token,
    },
  })
})

app.post('/verify', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const token = typeof body.token === 'string' ? body.token.trim() : ''
  if (!token) return c.json({ error: { code: 'INVALID', message: 'Sign-in token required' } }, 400)

  const now = Math.floor(Date.now() / 1000)
  const tokenHash = await hashToken(token, c.env.SESSION_SECRET)
  const challenge = await c.env.DB.prepare(
    'SELECT * FROM auth_challenges WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?'
  )
    .bind(tokenHash, now)
    .first<any>()
  if (!challenge) return c.json({ error: { code: 'INVALID_TOKEN', message: 'This sign-in link is invalid or has expired' } }, 401)

  const consumed = await c.env.DB.prepare(
    'UPDATE auth_challenges SET consumed_at = ?, attempts = attempts + 1 WHERE id = ? AND consumed_at IS NULL'
  )
    .bind(now, challenge.id)
    .run()
  if ((consumed.meta?.changes ?? 0) === 0) {
    return c.json({ error: { code: 'INVALID_TOKEN', message: 'This sign-in link has already been used' } }, 401)
  }

  let user = await c.env.DB.prepare('SELECT * FROM users WHERE email_normalized = ?').bind(challenge.email_normalized).first<any>()
  if (!user) {
    const userId = nanoid()
    await c.env.DB.prepare('INSERT INTO users (id, email_normalized, verified_at) VALUES (?,?,?)')
      .bind(userId, challenge.email_normalized, now)
      .run()
    user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<any>()
  }
  if (user.state && user.state !== 'active') {
    return c.json({ error: { code: 'ACCOUNT_UNAVAILABLE', message: 'This account is not available' } }, 403)
  }

  const sessionToken = nanoid(48)
  const sessionHash = await hashToken(sessionToken, c.env.SESSION_SECRET)
  const sessionExpires = now + SESSION_TTL_SECONDS
  await c.env.DB.prepare('INSERT INTO sessions (id, token_hash, user_id, expires_at) VALUES (?,?,?,?)')
    .bind(nanoid(), sessionHash, user.id, sessionExpires)
    .run()

  c.header('Set-Cookie', sessionCookie(sessionToken, SESSION_TTL_SECONDS, shouldUseSecureCookie(c.env.APP_URL)))
  return c.json({ data: { user: { id: user.id, email: user.email_normalized }, session_expires_at: sessionExpires } })
})

app.post('/logout', async (c) => {
  const cookie = c.req.header('Cookie') || ''
  const match = cookie.match(/joblite_session=([^;]+)/)
  if (match) {
    const sessionHash = await hashToken(match[1], c.env.SESSION_SECRET)
    await c.env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ?')
      .bind(Math.floor(Date.now() / 1000), sessionHash)
      .run()
  }
  c.header('Set-Cookie', clearedSessionCookie(shouldUseSecureCookie(c.env.APP_URL)))
  return c.json({ data: { ok: true } })
})

async function hashToken(token: string, secret: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(token))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export default app
