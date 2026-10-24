import { Hono } from 'hono'
import type { AppContext } from '../types'
import { nanoid } from 'nanoid'
import { clearedSessionCookie, sessionCookie, shouldUseSecureCookie } from '../middleware/security'
import { CURRENT_TERMS_VERSION } from '../../shared/legal-versions'

const app = new Hono<AppContext>()
const CODE_TTL_SECONDS = 10 * 60
const RATE_WINDOW_SECONDS = 10 * 60
const EMAIL_LIMIT = 5
const IP_LIMIT = 12
const MAX_CODE_ATTEMPTS = 5
const DEFAULT_RESEND_SECONDS = 60

type ChallengeRow = {
  id: string
  token_hash: string
  email_normalized: string
  expires_at: number
  attempts: number
  consumed_at: number | null
  presented_region: string | null
  language: string | null
}

// Local Playwright mail sink only. This route is absent from production behavior.
app.get('/test-mail/latest', async (c) => {
  if (c.env.ENVIRONMENT !== 'test' || c.env.TEST_MAIL_SINK !== 'enabled') {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } }, 404)
  }
  const email = (c.req.query('email') || '').normalize('NFKC').toLowerCase().trim()
  if (!email) return c.json({ error: { code: 'INVALID_EMAIL', message: 'Email is required' } }, 400)
  const mail = await c.env.DB.prepare(
    'SELECT challenge_id, code, created_at FROM auth_test_mail WHERE email_normalized = ? ORDER BY created_at DESC LIMIT 1'
  ).bind(email).first<{ challenge_id: string; code: string; created_at: number }>()
  if (!mail) return c.json({ error: { code: 'MAIL_NOT_FOUND', message: 'No test mail for this email' } }, 404)
  return c.json({ data: mail })
})

app.post('/challenges', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const email = typeof body.email === 'string' ? body.email.normalize('NFKC').toLowerCase().trim() : ''
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return c.json({ error: { code: 'INVALID_EMAIL', message: 'Enter a valid email address' } }, 400)
  }

  const now = Math.floor(Date.now() / 1000)
  const recent = await c.env.DB.prepare(
    'SELECT created_at FROM auth_challenges WHERE email_normalized = ? ORDER BY created_at DESC LIMIT 1'
  ).bind(email).first<{ created_at: number }>()
  const cooldown = Math.max(1, Number(c.env.AUTH_RESEND_COOLDOWN_SECONDS || DEFAULT_RESEND_SECONDS))
  if (recent && recent.created_at + cooldown > now) {
    return c.json(
      { error: { code: 'RESEND_COOLDOWN', message: 'Please wait before requesting another code.', retry_after: recent.created_at + cooldown - now } },
      429
    )
  }

  const emailLimit = await takeRateLimit(c.env.DB, c.env.SESSION_SECRET, `email:${email}`, now, EMAIL_LIMIT)
  // Do not trust X-Forwarded-For supplied by the browser; Cloudflare overwrites
  // CF-Connecting-IP at the edge. Unavailable IPs share a conservative bucket.
  const clientIp = c.req.header('CF-Connecting-IP') || 'unknown'
  const ipLimit = await takeRateLimit(c.env.DB, c.env.SESSION_SECRET, `ip:${clientIp}`, now, IP_LIMIT)
  if (!emailLimit || !ipLimit) {
    return c.json({ error: { code: 'RATE_LIMITED', message: 'Too many code requests. Try again later.' } }, 429)
  }

  const code = createCode()
  const challengeId = nanoid()
  const tokenHash = await hashToken(code, c.env.SESSION_SECRET)
  const expiresAt = now + CODE_TTL_SECONDS

  // Supersede earlier codes and create the new challenge in one D1 batch.
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE auth_challenges SET consumed_at = ? WHERE email_normalized = ? AND consumed_at IS NULL')
      .bind(now, email),
    c.env.DB.prepare(
      'INSERT INTO auth_challenges (id, token_hash, email_normalized, purpose, expires_at, created_at, terms_version, presented_region, language) VALUES (?,?,?,?,?,?,?,?,?)'
    ).bind(challengeId, tokenHash, email, 'login', expiresAt, now, CURRENT_TERMS_VERSION, validRegion(body.region), validLanguage(body.language)),
  ])

  try {
    if (c.env.ENVIRONMENT === 'test' && c.env.TEST_MAIL_SINK === 'enabled') {
      await c.env.DB.prepare(
        'INSERT INTO auth_test_mail (id, email_normalized, challenge_id, code, created_at) VALUES (?,?,?,?,?)'
      ).bind(nanoid(), email, challengeId, code, now).run()
    } else {
      await deliverCode(c.env, email, code)
    }
  } catch (error) {
    await c.env.DB.prepare('UPDATE auth_challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL')
      .bind(now, challengeId).run()
    if (error instanceof EmailConfigurationError) {
      return c.json({ error: { code: 'EMAIL_NOT_CONFIGURED', message: 'Email sign-in is not configured. Please contact Joblite support.' } }, 503)
    }
    // Provider response bodies can contain recipient or credential details; never log them.
    console.error('passwordless email delivery failed')
    return c.json({ error: { code: 'EMAIL_DELIVERY_FAILED', message: 'We could not deliver a sign-in code. Please retry shortly.', retry_after: cooldown } }, 502)
  }

  return c.json({
    data: {
      challenge_id: challengeId,
      expires_at: expiresAt,
      resend_after: cooldown,
      message: 'If this email can receive Joblite sign-in codes, one has been sent.',
    },
  })
})

app.post('/verify', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const challengeId = typeof body.challenge_id === 'string' ? body.challenge_id.trim() : ''
  const code = typeof body.code === 'string' ? body.code.replace(/\s+/g, '') : ''
  if (!challengeId || !/^\d{6}$/.test(code)) {
    return c.json({ error: { code: 'INVALID_CODE', message: 'Enter the six-digit code from your email.' } }, 400)
  }

  const now = Math.floor(Date.now() / 1000)
  const challenge = await c.env.DB.prepare(
    'SELECT id, token_hash, email_normalized, expires_at, attempts, consumed_at, presented_region, language FROM auth_challenges WHERE id = ?'
  ).bind(challengeId).first<ChallengeRow>()
  if (!challenge) return invalidCode(c)
  if (challenge.consumed_at !== null) {
    return c.json({ error: { code: 'CODE_USED', message: 'This code is no longer valid. Request a new code.' } }, 401)
  }
  if (challenge.expires_at <= now) {
    return c.json({ error: { code: 'CODE_EXPIRED', message: 'This code has expired. Request a new one.' } }, 401)
  }
  if (challenge.attempts >= MAX_CODE_ATTEMPTS) {
    return c.json({ error: { code: 'ATTEMPTS_EXCEEDED', message: 'Too many incorrect codes. Request a new one.' } }, 429)
  }

  const tokenHash = await hashToken(code, c.env.SESSION_SECRET)
  if (!constantTimeEqual(tokenHash, challenge.token_hash)) {
    const attempt = await c.env.DB.prepare(
      'UPDATE auth_challenges SET attempts = attempts + 1 WHERE id = ? AND consumed_at IS NULL AND expires_at > ? AND attempts < ?'
    ).bind(challenge.id, now, MAX_CODE_ATTEMPTS).run()
    if ((attempt.meta?.changes ?? 0) === 0) {
      return c.json({ error: { code: 'ATTEMPTS_EXCEEDED', message: 'Too many incorrect codes. Request a new one.' } }, 429)
    }
    return invalidCode(c)
  }

  const existingUser = await c.env.DB.prepare('SELECT id FROM users WHERE email_normalized = ?')
    .bind(challenge.email_normalized).first<{ id: string }>()
  const termsAccepted = body.terms_accepted === true && body.terms_version === CURRENT_TERMS_VERSION
  if (!existingUser && !termsAccepted) {
    return c.json({ error: { code: 'TERMS_ACCEPTANCE_REQUIRED', message: 'Accept the current Terms and confirm you meet Joblite’s age requirement to create an account. Your verification code is still valid.' } }, 428)
  }
  if (!existingUser && body.age_confirmed !== true) {
    return c.json({ error: { code: 'AGE_CONFIRMATION_REQUIRED', message: 'Confirm that you are at least 18 to create a Joblite account. Your verification code is still valid.' } }, 428)
  }

  // This conditional update is the single-use lock. Concurrent correct requests
  // race on the same row; exactly one can consume the challenge and create a session.
  const consumed = await c.env.DB.prepare(
    'UPDATE auth_challenges SET consumed_at = ?, attempts = attempts + 1 WHERE id = ? AND token_hash = ? AND consumed_at IS NULL AND expires_at > ? AND attempts < ?'
  ).bind(now, challenge.id, tokenHash, now, MAX_CODE_ATTEMPTS).run()
  if ((consumed.meta?.changes ?? 0) !== 1) return invalidCode(c)

  const newUserId = nanoid()
  const records = [
    c.env.DB.prepare('INSERT OR IGNORE INTO users (id, email_normalized, verified_at, created_at, updated_at) VALUES (?,?,?,?,?)')
      .bind(newUserId, challenge.email_normalized, now, now, now),
  ]
  if (!existingUser && termsAccepted) {
    records.push(c.env.DB.prepare(
      `INSERT OR IGNORE INTO legal_records (id, user_id, document_id, document_version, action, region, language, created_at)
       SELECT ?, id, 'terms', ?, 'acceptance', ?, ?, ? FROM users WHERE email_normalized = ?`
    ).bind(nanoid(), CURRENT_TERMS_VERSION, challenge.presented_region || 'unknown', challenge.language || 'en', now, challenge.email_normalized))
    records.push(c.env.DB.prepare(
      `INSERT OR IGNORE INTO legal_records (id, user_id, document_id, document_version, action, purpose, region, language, created_at)
       SELECT ?, id, 'privacy-choices', 'v1-2026-10-24', ?, 'marketing', ?, ?, ? FROM users WHERE email_normalized = ?`
    ).bind(nanoid(), body.marketing_consent === true ? 'consent_grant' : 'consent_refusal', challenge.presented_region || 'unknown', challenge.language || 'en', now, challenge.email_normalized))
    records.push(c.env.DB.prepare(
      `INSERT OR IGNORE INTO legal_records (id, user_id, document_id, document_version, action, region, language, created_at)
       SELECT ?, id, 'age-attestation', 'age-policy-v1-2026-10-24-draft', 'acceptance', ?, ?, ? FROM users WHERE email_normalized = ?`
    ).bind(nanoid(), challenge.presented_region || 'unknown', challenge.language || 'en', now, challenge.email_normalized))
  }
  await c.env.DB.batch(records)
  const user = await c.env.DB.prepare('SELECT id, email_normalized, state, display_name FROM users WHERE email_normalized = ?')
    .bind(challenge.email_normalized).first<{ id: string; email_normalized: string; state: string; display_name: string | null }>()
  if (!user || user.state !== 'active') {
    return c.json({ error: { code: 'ACCOUNT_UNAVAILABLE', message: 'This account is not available.' } }, 403)
  }

  // Revoke the presented session before issuing a fresh opaque session token.
  const existingCookie = c.req.header('Cookie')?.match(/(?:^|;\s*)joblite_session=([^;]+)/)?.[1]
  if (existingCookie) {
    const existingHash = await hashToken(existingCookie, c.env.SESSION_SECRET)
    await c.env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
      .bind(now, existingHash).run()
  }

  const sessionToken = randomToken(32)
  const sessionExpires = now + 60 * 60 * 24 * 7
  await c.env.DB.prepare('INSERT INTO sessions (id, token_hash, user_id, expires_at) VALUES (?,?,?,?)')
    .bind(nanoid(), await hashToken(sessionToken, c.env.SESSION_SECRET), user.id, sessionExpires).run()
  c.header('Set-Cookie', sessionCookie(sessionToken, sessionExpires - now, shouldUseSecureCookie(c.env.APP_URL)))
  return c.json({
    data: {
      user: { id: user.id, email: user.email_normalized, display_name: user.display_name },
      session_expires_at: sessionExpires,
    },
  })
})

app.post('/logout', async (c) => {
  const cookie = c.req.header('Cookie') || ''
  const match = cookie.match(/(?:^|;\s*)joblite_session=([^;]+)/)
  if (match) {
    const sessionHash = await hashToken(match[1], c.env.SESSION_SECRET)
    await c.env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
      .bind(Math.floor(Date.now() / 1000), sessionHash).run()
  }
  c.header('Set-Cookie', clearedSessionCookie(shouldUseSecureCookie(c.env.APP_URL)))
  return c.json({ data: { ok: true } })
})

async function takeRateLimit(
  db: D1Database,
  secret: string,
  identity: string,
  now: number,
  limit: number
): Promise<boolean> {
  const keyHash = await hashToken(identity, secret)
  await db.prepare(
    `INSERT INTO auth_rate_limits (key_hash, window_started_at, request_count, updated_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(key_hash) DO UPDATE SET
       request_count = CASE WHEN auth_rate_limits.window_started_at <= ? THEN 1 ELSE auth_rate_limits.request_count + 1 END,
       window_started_at = CASE WHEN auth_rate_limits.window_started_at <= ? THEN ? ELSE auth_rate_limits.window_started_at END,
       updated_at = excluded.updated_at`
  ).bind(keyHash, now, now, now - RATE_WINDOW_SECONDS, now - RATE_WINDOW_SECONDS, now).run()
  const counter = await db.prepare('SELECT request_count FROM auth_rate_limits WHERE key_hash = ?')
    .bind(keyHash).first<{ request_count: number }>()
  return (counter?.request_count || 0) <= limit
}

class EmailConfigurationError extends Error {}

async function deliverCode(env: AppContext['Bindings'], email: string, code: string): Promise<void> {
  const apiKey = env.EMAIL_API_KEY || env.RESEND_API_KEY
  if (!apiKey || !env.EMAIL_FROM) throw new EmailConfigurationError()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [email],
        subject: 'Your Joblite sign-in code',
        text: `Your Joblite sign-in code is ${code}. It expires in 10 minutes. If you did not request this code, you can ignore this email.`,
      }),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error('email provider rejected message')
  } finally {
    clearTimeout(timeout)
  }
}

function createCode(): string {
  const bytes = new Uint32Array(1)
  const acceptedRange = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000
  do crypto.getRandomValues(bytes)
  while (bytes[0] >= acceptedRange)
  return (bytes[0] % 1_000_000).toString().padStart(6, '0')
}

function randomToken(size: number): string {
  const bytes = new Uint8Array(size)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let i = 0; i < left.length; i += 1) difference |= left.charCodeAt(i) ^ right.charCodeAt(i)
  return difference === 0
}

function invalidCode(c: any) {
  return c.json({ error: { code: 'INVALID_CODE', message: 'This code is invalid, expired, or no longer active.' } }, 401)
}

async function hashToken(token: string, secret: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(token))
  return Array.from(new Uint8Array(sig), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function validRegion(value: unknown): string {
  return typeof value === 'string' && ['UG','EEA','UK','other','unknown'].includes(value) ? value : 'unknown'
}

function validLanguage(value: unknown): string {
  return typeof value === 'string' && /^[a-z]{2}(-[A-Z]{2})?$/.test(value) ? value : 'en'
}

export default app
