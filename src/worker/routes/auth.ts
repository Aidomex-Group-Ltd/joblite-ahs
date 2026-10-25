import { Hono, type Context } from 'hono'
import type { AppContext } from '../types'
import { nanoid } from 'nanoid'
import { clearedSessionCookie, sessionCookie, shouldUseSecureCookie } from '../middleware/security'
import { sanitizeText, slugify } from '../lib/validate'
import { CURRENT_TERMS_VERSION } from '../../shared/legal-versions'

const app = new Hono<AppContext>()
const CODE_TTL_SECONDS = 10 * 60
const RATE_WINDOW_SECONDS = 10 * 60
const EMAIL_LIMIT = 5
const IP_LIMIT = 12
const MAX_CODE_ATTEMPTS = 5
const DEFAULT_RESEND_SECONDS = 60

app.use('*', async (c, next) => {
  await next()
  c.header('Cache-Control', 'no-store')
})

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
  const requestId = nanoid(12)
  c.header('X-Request-ID', requestId)
  const body = await c.req.json().catch(() => ({}))
  const email = typeof body.email === 'string' ? body.email.normalize('NFKC').toLowerCase().trim() : ''
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return challengeError(c, 400, requestId, 'INVALID_EMAIL', 'Enter a valid email address')
  }

  const now = Math.floor(Date.now() / 1000)
  const recent = await c.env.DB.prepare(
    'SELECT created_at FROM auth_challenges WHERE email_normalized = ? ORDER BY created_at DESC LIMIT 1'
  ).bind(email).first<{ created_at: number }>()
  const cooldown = Math.max(1, Number(c.env.AUTH_RESEND_COOLDOWN_SECONDS || DEFAULT_RESEND_SECONDS))
  if (recent && recent.created_at + cooldown > now) {
    return challengeError(
      c,
      429,
      requestId,
      'RESEND_COOLDOWN',
      'Please wait before requesting another code.',
      recent.created_at + cooldown - now
    )
  }

  const emailLimit = await takeRateLimit(c.env.DB, c.env.SESSION_SECRET, `email:${email}`, now, EMAIL_LIMIT)
  // Do not trust X-Forwarded-For supplied by the browser; Cloudflare overwrites
  // CF-Connecting-IP at the edge. Unavailable IPs share a conservative bucket.
  const clientIp = c.req.header('CF-Connecting-IP') || 'unknown'
  const ipLimit = await takeRateLimit(c.env.DB, c.env.SESSION_SECRET, `ip:${clientIp}`, now, IP_LIMIT)
  if (!emailLimit || !ipLimit) {
    return challengeError(c, 429, requestId, 'RATE_LIMITED', 'Too many code requests. Try again later.')
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
      console.warn(JSON.stringify({ event: 'auth_email_delivery_failed', request_id: requestId, reason: 'configuration_missing' }))
      return challengeError(c, 503, requestId, 'EMAIL_NOT_CONFIGURED', 'Sign-in email is temporarily unavailable. Please try again later.', cooldown)
    }
    const deliveryError = error instanceof EmailDeliveryError ? error : null
    const status = deliveryError?.kind === 'timeout'
      ? 504
      : deliveryError?.kind === 'provider_rate_limited' || deliveryError?.kind === 'provider_unavailable'
        ? 503
        : 502
    const code = deliveryError?.kind === 'timeout'
      ? 'EMAIL_DELIVERY_TIMEOUT'
      : deliveryError?.kind === 'provider_rate_limited'
        ? 'EMAIL_PROVIDER_BUSY'
        : deliveryError?.kind === 'provider_unavailable'
          ? 'EMAIL_PROVIDER_UNAVAILABLE'
          : 'EMAIL_DELIVERY_FAILED'
    console.warn(JSON.stringify({
      event: 'auth_email_delivery_failed',
      request_id: requestId,
      reason: deliveryError?.kind || 'network_or_unexpected_failure',
      ...(deliveryError?.providerStatus ? { provider_status: deliveryError.providerStatus } : {}),
      ...(deliveryError?.providerErrorName ? { provider_error_name: deliveryError.providerErrorName } : {}),
      ...(deliveryError?.providerDetail ? { provider_detail: deliveryError.providerDetail } : {}),
      ...(getSenderDomain(c.env.EMAIL_FROM) ? { sender_domain: getSenderDomain(c.env.EMAIL_FROM) } : {}),
    }))
    return challengeError(c, status, requestId, code, 'We could not send a sign-in code. Please retry shortly.', cooldown)
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
  const displayName = typeof body.display_name === 'string' && body.display_name.trim().length >= 2
    ? sanitizeText(body.display_name, 80)
    : null
  const onboarding = existingUser ? null : await validateOnboarding(c.env.DB, body.onboarding)
  if (!existingUser && !onboarding && !displayName) {
    return c.json({ error: { code: 'ONBOARDING_REQUIRED', message: 'Complete the account setup questions to create your Joblite account.' } }, 428)
  }

  // This conditional update is the single-use lock. Concurrent correct requests
  // race on the same row; exactly one can consume the challenge and create a session.
  const consumed = await c.env.DB.prepare(
    'UPDATE auth_challenges SET consumed_at = ?, attempts = attempts + 1 WHERE id = ? AND token_hash = ? AND consumed_at IS NULL AND expires_at > ? AND attempts < ?'
  ).bind(now, challenge.id, tokenHash, now, MAX_CODE_ATTEMPTS).run()
  if ((consumed.meta?.changes ?? 0) !== 1) return invalidCode(c)

  const newUserId = nanoid()
  const profileId = existingUser ? null : nanoid()
  const handle = existingUser ? null : await uniqueProfileHandle(c.env.DB, challenge.email_normalized)
  const resolvedDisplayName = onboarding?.displayName || displayName || challenge.email_normalized.split('@')[0]
  const records = [
    c.env.DB.prepare('INSERT OR IGNORE INTO users (id, email_normalized, verified_at, display_name, created_at, updated_at) VALUES (?,?,?,?,?,?)')
      .bind(newUserId, challenge.email_normalized, now, resolvedDisplayName, now, now),
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
    records.push(c.env.DB.prepare(
      `INSERT OR IGNORE INTO profiles (id, user_id, handle, headline, country_code, visibility, availability, created_at, updated_at)
       SELECT ?, id, ?, ?, ?, 'public', ?, ?, ? FROM users WHERE email_normalized = ?`
    ).bind(profileId!, handle!, onboarding?.desiredRole || null, onboarding?.countryCode || null, onboarding?.availability || null, now, now, challenge.email_normalized))

    if (onboarding) {
      records.push(c.env.DB.prepare(
        `INSERT INTO user_onboarding (user_id, status, current_step, account_type, experience_level, desired_role, employer_title, organization_name, completed_at, created_at, updated_at)
         SELECT id, 'completed', 3, ?, ?, ?, ?, ?, ?, ?, ? FROM users WHERE email_normalized = ?`
      ).bind(onboarding.accountType, onboarding.experienceLevel, onboarding.desiredRole, onboarding.employerTitle, onboarding.organizationName, now, now, now, challenge.email_normalized))
    } else {
      records.push(c.env.DB.prepare(
        `INSERT INTO user_onboarding (user_id, status, current_step, account_type, completed_at, created_at, updated_at)
         SELECT id, 'in_progress', 1, 'candidate', 0, ?, ? FROM users WHERE email_normalized = ?`
      ).bind(now, now, challenge.email_normalized))
    }
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

type EmailDeliveryFailureKind =
  | 'provider_auth'
  | 'provider_rejected'
  | 'provider_rate_limited'
  | 'provider_unavailable'
  | 'timeout'
  | 'network'

type ProviderErrorDetail =
  | 'sender_domain_unverified'
  | 'sender_not_authorized'
  | 'recipient_restricted'
  | 'api_key_or_account'
  | 'other'

class EmailDeliveryError extends Error {
  constructor(
    readonly kind: EmailDeliveryFailureKind,
    readonly providerStatus?: number,
    readonly providerErrorName?: string,
    readonly providerDetail?: ProviderErrorDetail
  ) {
    super('Email delivery failed')
  }
}

function getProviderErrorName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const name = value.trim().toLowerCase()
  return /^[a-z0-9_-]{1,48}$/.test(name) ? name : undefined
}

function getSenderDomain(value: string | undefined): string | undefined {
  if (!value) return undefined
  const address = value.match(/<([^<>]+)>/)?.[1] || value
  return address.trim().match(/@([a-z0-9.-]+)\s*$/i)?.[1]?.toLowerCase()
}

function classifyProviderError(message: unknown): ProviderErrorDetail | undefined {
  if (typeof message !== 'string') return undefined
  const normalized = message.toLowerCase()
  if (normalized.includes('domain') && /not verified|unverified/.test(normalized)) {
    return 'sender_domain_unverified'
  }
  if (/(sender|from address|from field)/.test(normalized) && /not authorized|not allowed|invalid/.test(normalized)) {
    return 'sender_not_authorized'
  }
  if (/(testing|test mode)/.test(normalized) && /(recipient|own email|only send)/.test(normalized)) {
    return 'recipient_restricted'
  }
  if (/(api key|account|permission)/.test(normalized) && /(invalid|restricted|not authorized|permission)/.test(normalized)) {
    return 'api_key_or_account'
  }
  return 'other'
}

function challengeError(
  c: Context<AppContext>,
  status: 400 | 429 | 502 | 503 | 504,
  requestId: string,
  code: string,
  message: string,
  retryAfter?: number
) {
  return c.json({
    error: {
      code,
      message,
      request_id: requestId,
      ...(retryAfter ? { retry_after: retryAfter } : {}),
    },
  }, status)
}

async function deliverCode(env: AppContext['Bindings'], email: string, code: string): Promise<void> {
  const apiKey = env.EMAIL_API_KEY || env.RESEND_API_KEY
  if (!apiKey || !env.EMAIL_FROM) throw new EmailConfigurationError()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    let response: Response
    try {
      response = await fetch('https://api.resend.com/emails', {
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
    } catch (error) {
      throw new EmailDeliveryError(
        controller.signal.aborted || (error instanceof Error && error.name === 'AbortError') ? 'timeout' : 'network'
      )
    }
    if (!response.ok) {
      const kind: EmailDeliveryFailureKind = response.status === 401 || response.status === 403
        ? 'provider_auth'
        : response.status === 429
          ? 'provider_rate_limited'
          : response.status >= 500
            ? 'provider_unavailable'
            : 'provider_rejected'
      const providerError = await response.json().catch(() => null) as { name?: unknown; message?: unknown } | null
      throw new EmailDeliveryError(
        kind,
        response.status,
        getProviderErrorName(providerError?.name),
        classifyProviderError(providerError?.message)
      )
    }
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

type OnboardingInput = {
  accountType: 'candidate' | 'employer' | 'both'
  displayName: string
  countryCode: string
  desiredRole: string | null
  experienceLevel: string | null
  availability: string | null
  employerTitle: string | null
  organizationName: string | null
}

async function validateOnboarding(db: D1Database, input: unknown): Promise<OnboardingInput | null> {
  if (!input || typeof input !== 'object') return null
  const value = input as Record<string, unknown>
  const accountType = value.account_type
  if (!['candidate', 'employer', 'both'].includes(String(accountType))) return null
  const isCandidate = accountType === 'candidate' || accountType === 'both'
  const isEmployer = accountType === 'employer' || accountType === 'both'
  const displayName = sanitizeText(value.display_name, 80)
  const countryCode = typeof value.country_code === 'string' ? value.country_code.toUpperCase() : ''
  const desiredRole = sanitizeText(value.desired_role, 120)
  const experienceLevel = typeof value.experience_level === 'string' ? value.experience_level : ''
  const availability = sanitizeText(value.availability, 80)
  const employerTitle = sanitizeText(value.employer_title, 100)
  const organizationName = sanitizeText(value.organization_name, 120)
  if (displayName.length < 2 || !/^[A-Z]{2}$/.test(countryCode)) return null
  if (isCandidate && desiredRole.length < 2) return null
  if (isCandidate && experienceLevel && !['student','entry','mid','senior','executive','career_change','not_sure'].includes(experienceLevel)) return null
  if (isEmployer && (employerTitle.length < 2 || organizationName.length < 2)) return null
  const country = await db.prepare('SELECT code FROM countries WHERE code = ?').bind(countryCode).first<{ code: string }>()
  if (!country) return null
  return {
    accountType: accountType as OnboardingInput['accountType'],
    displayName,
    countryCode,
    desiredRole: isCandidate ? desiredRole : null,
    experienceLevel: isCandidate && experienceLevel ? experienceLevel : null,
    availability: isCandidate ? availability || null : null,
    employerTitle: isEmployer ? employerTitle : null,
    organizationName: isEmployer ? organizationName : null,
  }
}

async function uniqueProfileHandle(db: D1Database, email: string): Promise<string> {
  const base = slugify(email.split('@')[0] || 'member', 24) || 'member'
  const existing = await db.prepare('SELECT id FROM profiles WHERE handle = ?').bind(base).first()
  return existing ? `${base.slice(0, 18)}-${nanoid(5).toLowerCase()}` : base
}

export default app
