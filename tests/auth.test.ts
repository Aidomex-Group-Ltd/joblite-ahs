import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../src/worker/types'
import authRoute from '../src/worker/routes/auth'
import meRoute from '../src/worker/routes/me'
import { createTestEnv } from './helpers/d1'

function api(env: Env) {
  const app = new Hono()
  app.route('/auth', authRoute)
  app.route('/me', meRoute)
  return (path: string, init?: RequestInit) => app.request(path, init, env as any)
}

describe('passwordless email authentication', () => {
  let env: Env
  let db: ReturnType<typeof createTestEnv>['d1']
  let close: () => void
  beforeEach(() => { const test = createTestEnv(); env = test.env; db = test.d1; close = test.close; env.TEST_MAIL_SINK = 'enabled' })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); close() })

  async function requestCode(email = 'person@example.test') {
    const response = await api(env)('/auth/challenges', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) })
    return { response, payload: await response.json() as any }
  }
  async function readCode(email: string) {
    return db.prepare('SELECT code, challenge_id FROM auth_test_mail WHERE email_normalized = ? ORDER BY created_at DESC LIMIT 1').bind(email).first<{ code: string; challenge_id: string }>()
  }
  async function verifyCode(challengeId: string | undefined, code: string | undefined, accepted = true) {
    return api(env)('/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challenge_id: challengeId, code, terms_accepted: accepted, terms_version: 'terms-v1-2026-10-24-draft', age_confirmed: accepted, onboarding: { account_type: 'candidate', display_name: 'Taylor Example', country_code: 'UG', desired_role: 'Product designer', experience_level: 'mid' } }) })
  }

  it('creates one account after a successful test-mail verification and supports existing-account sign-in', async () => {
    const first = await requestCode()
    expect(first.response.status).toBe(200)
    expect(first.response.headers.get('Cache-Control')).toBe('no-store')
    expect(first.payload.data.token).toBeUndefined()
    expect(first.payload.data.code).toBeUndefined()
    const mail = await readCode('person@example.test')
    expect(mail?.code).toMatch(/^\d{6}$/)
    const protectedCode = await db.prepare('SELECT token_hash FROM auth_challenges WHERE id = ?').bind(mail?.challenge_id).first<{ token_hash: string }>()
    expect(protectedCode?.token_hash).not.toBe(mail?.code)
    const verified = await verifyCode(mail?.challenge_id, mail?.code)
    expect(verified.status).toBe(200)
    expect(verified.headers.get('Cache-Control')).toBe('no-store')
    const cookie = verified.headers.get('set-cookie') || ''
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('Max-Age=604800')
    expect(cookie).not.toContain('Domain=')
    const count = await db.prepare('SELECT COUNT(*) as total FROM users WHERE email_normalized = ?').bind('person@example.test').first<{ total: number }>()
    expect(count?.total).toBe(1)
    const onboarding = await db.prepare('SELECT account_type, experience_level, desired_role FROM user_onboarding WHERE user_id = (SELECT id FROM users WHERE email_normalized = ?)').bind('person@example.test').first<{ account_type: string; experience_level: string; desired_role: string }>()
    expect(onboarding).toEqual({ account_type: 'candidate', experience_level: 'mid', desired_role: 'Product designer' })
    const profile = await db.prepare('SELECT headline, country_code FROM profiles WHERE user_id = (SELECT id FROM users WHERE email_normalized = ?)').bind('person@example.test').first<{ headline: string; country_code: string }>()
    expect(profile).toEqual({ headline: 'Product designer', country_code: 'UG' })
    await db.prepare('UPDATE auth_challenges SET created_at = created_at - 120 WHERE email_normalized = ?').bind('person@example.test').run()
    await db.prepare('UPDATE auth_test_mail SET created_at = created_at - 120 WHERE email_normalized = ?').bind('person@example.test').run()
    await requestCode()
    const secondMail = await readCode('person@example.test')
    const second = await verifyCode(secondMail?.challenge_id, secondMail?.code)
    expect(second.status).toBe(200)
    expect((await db.prepare('SELECT COUNT(*) as total FROM users WHERE email_normalized = ?').bind('person@example.test').first<{ total: number }>())?.total).toBe(1)
  })

  it('loads the verified user from the persisted session, then rejects revoked, expired, and invalid sessions', async () => {
    await requestCode('session@example.test')
    const firstMail = (await readCode('session@example.test'))!
    const verified = await verifyCode(firstMail.challenge_id, firstMail.code)
    expect(verified.status).toBe(200)
    const cookie = verified.headers.get('set-cookie')?.split(';', 1)[0]
    expect(cookie).toMatch(/^joblite_session=.+$/)

    const me = await api(env)('/me', { headers: { Cookie: cookie! } })
    expect(me.status).toBe(200)
    expect((await me.json() as any).data.user.email).toBe('session@example.test')

    const logout = await api(env)('/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie! },
      body: JSON.stringify({}),
    })
    expect(logout.status).toBe(200)
    const clearedCookie = logout.headers.get('set-cookie') || ''
    expect(clearedCookie).toContain('Max-Age=0')
    expect(clearedCookie).toContain('Secure')
    expect((await api(env)('/me', { headers: { Cookie: cookie! } })).status).toBe(401)

    await db.prepare('UPDATE auth_challenges SET created_at = created_at - 120 WHERE email_normalized = ?')
      .bind('session@example.test').run()
    await db.prepare('UPDATE auth_test_mail SET created_at = created_at - 120 WHERE email_normalized = ?')
      .bind('session@example.test').run()
    await requestCode('session@example.test')
    const secondMail = (await readCode('session@example.test'))!
    const secondLogin = await verifyCode(secondMail.challenge_id, secondMail.code)
    const expiredCookie = secondLogin.headers.get('set-cookie')?.split(';', 1)[0]
    const user = await db.prepare('SELECT id FROM users WHERE email_normalized = ?')
      .bind('session@example.test').first<{ id: string }>()
    await db.prepare('UPDATE sessions SET expires_at = 0 WHERE user_id = ?').bind(user?.id).run()

    expect((await api(env)('/me', { headers: { Cookie: expiredCookie! } })).status).toBe(401)
    expect((await api(env)('/me', { headers: { Cookie: 'joblite_session=invalid-session-token' } })).status).toBe(401)
    expect((await api(env)('/me')).status).toBe(401)
  })

  it('allows unauthenticated challenge creation while the private session resource returns the expected 401', async () => {
    const challenge = await requestCode('guest@example.test')
    expect(challenge.response.status).toBe(200)
    expect(challenge.payload.data.challenge_id).toBeTruthy()

    const session = await api(env)('/me')
    expect(session.status).toBe(401)
    expect((await session.json() as any).error.code).toBe('UNAUTHENTICATED')
  })

  it('requires profile setup and ensures role selection does not grant privilege escalation or organization membership', async () => {
    const requested = await requestCode('founder@example.test')
    const mail = (await readCode('founder@example.test'))!
    const incomplete = await api(env)('/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challenge_id: mail.challenge_id, code: mail.code, terms_accepted: true, terms_version: 'terms-v1-2026-10-24-draft', age_confirmed: true }) })
    expect(requested.response.status).toBe(200)
    expect(incomplete.status).toBe(428)
    expect((await incomplete.json() as any).error.code).toBe('ONBOARDING_REQUIRED')
    const created = await api(env)('/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challenge_id: mail.challenge_id, code: mail.code, terms_accepted: true, terms_version: 'terms-v1-2026-10-24-draft', age_confirmed: true, onboarding: { account_type: 'employer', display_name: 'Taylor Example', country_code: 'UG', organization_name: 'North Star Studio', employer_title: 'Founder' } }) })
    expect(created.status).toBe(200)
    // Selecting "Hire talent" must not grant organization membership or administrative privileges
    const membership = await db.prepare("SELECT m.role FROM memberships m WHERE m.user_id = (SELECT id FROM users WHERE email_normalized = ?)").bind('founder@example.test').first<{ role: string }>()
    expect(membership).toBeNull()
    const onboarding = await db.prepare("SELECT account_type, organization_name, employer_title FROM user_onboarding WHERE user_id = (SELECT id FROM users WHERE email_normalized = ?)").bind('founder@example.test').first<{ account_type: string; organization_name: string; employer_title: string }>()
    expect(onboarding).toEqual({ account_type: 'employer', organization_name: 'North Star Studio', employer_title: 'Founder' })
  })

  it('rejects bad, expired, reused, and superseded codes', async () => {
    await requestCode()
    const old = (await readCode('person@example.test'))!
    await requestCode('new@example.test')
    const bad = await verifyCode(old.challenge_id, '111111')
    expect(bad.status).toBe(401)
    const success = await verifyCode(old.challenge_id, old.code)
    expect(success.status).toBe(200)
    const reused = await verifyCode(old.challenge_id, old.code)
    expect(reused.status).toBe(401)

    await requestCode('expired@example.test')
    const expired = (await readCode('expired@example.test'))!
    await db.prepare('UPDATE auth_challenges SET expires_at = 1 WHERE id = ?').bind(expired.challenge_id).run()
    const expiredResponse = await verifyCode(expired.challenge_id, expired.code)
    expect(expiredResponse.status).toBe(401)

    await requestCode('superseded@example.test')
    const superseded = (await readCode('superseded@example.test'))!
    await db.prepare('UPDATE auth_challenges SET created_at = created_at - 100 WHERE id = ?').bind(superseded.challenge_id).run()
    await requestCode('superseded@example.test')
    const supersededResponse = await verifyCode(superseded.challenge_id, superseded.code)
    expect(supersededResponse.status).toBe(401)
  })

  it('allows only one concurrent verification to consume a challenge', async () => {
    await requestCode('concurrent@example.test')
    const mail = (await readCode('concurrent@example.test'))!
    const verify = () => verifyCode(mail.challenge_id, mail.code)
    const responses = await Promise.all([verify(), verify()])
    expect(responses.map((response) => response.status).sort()).toEqual([200, 401])
    expect((await db.prepare('SELECT COUNT(*) as total FROM users WHERE email_normalized = ?').bind('concurrent@example.test').first<{ total: number }>())?.total).toBe(1)
  })

  it('enforces cooldown, bounded code attempts, and honest delivery failures', async () => {
    const { response } = await requestCode()
    expect(response.status).toBe(200)
    expect((await requestCode()).response.status).toBe(429)
    const mail = (await readCode('person@example.test'))!
    let last = 0
    const wrong = mail.code === '000000' ? '000001' : '000000'
    for (let count = 0; count < 5; count += 1) last = (await api(env)('/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challenge_id: mail.challenge_id, code: wrong }) })).status
    expect(last).toBe(401)
    expect((await api(env)('/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challenge_id: mail.challenge_id, code: wrong }) })).status).toBe(429)

    env.TEST_MAIL_SINK = undefined
    const noDelivery = await api(env)('/auth/challenges', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'delivery@example.test' }) })
    expect(noDelivery.status).toBe(503)
    expect((await noDelivery.json() as any).error.code).toBe('EMAIL_NOT_CONFIGURED')
  })

  it('delivers through Resend and returns a challenge only after provider acceptance', async () => {
    env.TEST_MAIL_SINK = undefined
    env.RESEND_API_KEY = 'test-resend-key'
    env.EMAIL_FROM = 'Joblite <auth@example.test>'
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe('POST')
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-resend-key')
      const payload = JSON.parse(String(init?.body)) as { from: string; to: string[]; text: string }
      expect(payload.from).toBe('Joblite <auth@example.test>')
      expect(payload.to).toEqual(['person@example.test'])
      expect(payload.text).toMatch(/\d{6}/)
      return new Response(JSON.stringify({ id: 'resend-message-id' }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { response, payload } = await requestCode()
    expect(response.status).toBe(200)
    expect(response.headers.get('X-Request-ID')).toBeTruthy()
    expect(payload.data.challenge_id).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it.each([
    { providerStatus: 401, status: 502, code: 'EMAIL_DELIVERY_FAILED', reason: 'provider_auth' },
    { providerStatus: 403, status: 502, code: 'EMAIL_DELIVERY_FAILED', reason: 'provider_auth' },
    { providerStatus: 422, status: 502, code: 'EMAIL_DELIVERY_FAILED', reason: 'provider_rejected' },
    { providerStatus: 429, status: 503, code: 'EMAIL_PROVIDER_BUSY', reason: 'provider_rate_limited' },
    { providerStatus: 503, status: 503, code: 'EMAIL_PROVIDER_UNAVAILABLE', reason: 'provider_unavailable' },
  ])('reports sanitized provider failure for HTTP $providerStatus and invalidates its challenge', async ({ providerStatus, status, code, reason }) => {
    env.TEST_MAIL_SINK = undefined
    env.EMAIL_API_KEY = 'test-resend-key'
    env.EMAIL_FROM = 'Joblite <auth@example.test>'
    const providerBody = 'private recipient or credential details'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(providerBody, { status: providerStatus })))
    const diagnostic = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const { response, payload } = await requestCode('failed@example.test')
    expect(response.status).toBe(status)
    expect(response.headers.get('X-Request-ID')).toBe(payload.error.request_id)
    expect(payload.error.code).toBe(code)
    expect(payload.error.message).not.toContain(providerBody)
    expect(payload.data).toBeUndefined()
    const challenge = await db.prepare('SELECT consumed_at FROM auth_challenges WHERE email_normalized = ?').bind('failed@example.test').first<{ consumed_at: number | null }>()
    expect(challenge?.consumed_at).toBeTruthy()
    const log = JSON.parse(String(diagnostic.mock.calls[0]?.[0]))
    expect(log).toMatchObject({ event: 'auth_email_delivery_failed', request_id: payload.error.request_id, reason, provider_status: providerStatus })
    expect(JSON.stringify(log)).not.toContain('failed@example.test')
  })

  it('logs only allowlisted Resend rejection details for maintainer diagnosis', async () => {
    env.TEST_MAIL_SINK = undefined
    env.EMAIL_API_KEY = 'test-resend-key'
    env.EMAIL_FROM = 'Joblite <auth@example.test>'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      name: 'validation_error',
      message: 'The domain example.test is not verified for recipient private@example.test',
    }), { status: 400, headers: { 'Content-Type': 'application/json' } })))
    const diagnostic = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const { response, payload } = await requestCode('private@example.test')
    expect(response.status).toBe(502)
    const log = JSON.parse(String(diagnostic.mock.calls[0]?.[0]))
    expect(log).toMatchObject({
      request_id: payload.error.request_id,
      provider_status: 400,
      provider_error_name: 'validation_error',
      provider_detail: 'sender_domain_unverified',
      sender_domain: 'example.test',
    })
    expect(JSON.stringify(log)).not.toContain('private@example.test')
    expect(JSON.stringify(log)).not.toContain('not verified for recipient')
  })

  it('returns a retryable timeout without leaving a usable code challenge', async () => {
    env.TEST_MAIL_SINK = undefined
    env.EMAIL_API_KEY = 'test-resend-key'
    env.EMAIL_FROM = 'Joblite <auth@example.test>'
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('Aborted', 'AbortError') }))

    const { response, payload } = await requestCode('timeout@example.test')
    expect(response.status).toBe(504)
    expect(payload.error.code).toBe('EMAIL_DELIVERY_TIMEOUT')
    expect(payload.error.retry_after).toBeGreaterThan(0)
    const challenge = await db.prepare('SELECT consumed_at FROM auth_challenges WHERE email_normalized = ?').bind('timeout@example.test').first<{ consumed_at: number | null }>()
    expect(challenge?.consumed_at).toBeTruthy()
  })

  it('does not report success or preserve a challenge after Resend network failure', async () => {
    env.TEST_MAIL_SINK = undefined
    env.EMAIL_API_KEY = 'test-resend-key'
    env.EMAIL_FROM = 'Joblite <auth@example.test>'
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network unavailable') }))

    const { response, payload } = await requestCode('network@example.test')
    expect(response.status).toBe(502)
    expect(payload.error.code).toBe('EMAIL_DELIVERY_FAILED')
    expect(payload.data).toBeUndefined()
    const challenge = await db.prepare('SELECT consumed_at FROM auth_challenges WHERE email_normalized = ?').bind('network@example.test').first<{ consumed_at: number | null }>()
    expect(challenge?.consumed_at).toBeTruthy()
  })

  it('allows a new challenge after delivery failure cooldown has elapsed', async () => {
    env.TEST_MAIL_SINK = undefined
    env.EMAIL_API_KEY = 'test-resend-key'
    env.EMAIL_FROM = 'Joblite <auth@example.test>'
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network unavailable') }))

    const failed = await requestCode('retry@example.test')
    expect(failed.response.status).toBe(502)
    const failedChallenge = await db.prepare(
      'SELECT id, consumed_at FROM auth_challenges WHERE email_normalized = ? ORDER BY created_at DESC LIMIT 1'
    ).bind('retry@example.test').first<{ id: string; consumed_at: number | null }>()
    expect(failedChallenge?.consumed_at).toBeTruthy()

    await db.prepare('UPDATE auth_challenges SET created_at = created_at - 120 WHERE email_normalized = ?')
      .bind('retry@example.test').run()
    env.TEST_MAIL_SINK = 'enabled'
    const retried = await requestCode('retry@example.test')
    expect(retried.response.status).toBe(200)
    const retryMail = await readCode('retry@example.test')
    expect(retryMail?.challenge_id).not.toBe(failedChallenge?.id)
    const retryChallenge = await db.prepare('SELECT consumed_at FROM auth_challenges WHERE id = ?')
      .bind(retryMail?.challenge_id).first<{ consumed_at: number | null }>()
    expect(retryChallenge?.consumed_at).toBeNull()
  })
})
