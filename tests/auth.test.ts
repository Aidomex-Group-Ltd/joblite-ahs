import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../src/worker/types'
import authRoute from '../src/worker/routes/auth'
import { createTestEnv } from './helpers/d1'

function api(env: Env) {
  const app = new Hono()
  app.route('/auth', authRoute)
  return (path: string, init?: RequestInit) => app.request(path, init, env as any)
}

describe('passwordless email authentication', () => {
  let env: Env
  let db: ReturnType<typeof createTestEnv>['d1']
  let close: () => void
  beforeEach(() => { const test = createTestEnv(); env = test.env; db = test.d1; close = test.close; env.TEST_MAIL_SINK = 'enabled' })
  afterEach(() => close())

  async function requestCode(email = 'person@example.test') {
    const response = await api(env)('/auth/challenges', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) })
    return { response, payload: await response.json() as any }
  }
  async function readCode(email: string) {
    return db.prepare('SELECT code, challenge_id FROM auth_test_mail WHERE email_normalized = ? ORDER BY created_at DESC LIMIT 1').bind(email).first<{ code: string; challenge_id: string }>()
  }
  async function verifyCode(challengeId: string | undefined, code: string | undefined, accepted = true) {
    return api(env)('/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challenge_id: challengeId, code, terms_accepted: accepted, terms_version: 'terms-v1-2026-10-24-draft', age_confirmed: accepted }) })
  }

  it('creates one account after a successful test-mail verification and supports existing-account sign-in', async () => {
    const first = await requestCode()
    expect(first.response.status).toBe(200)
    expect(first.payload.data.token).toBeUndefined()
    expect(first.payload.data.code).toBeUndefined()
    const mail = await readCode('person@example.test')
    expect(mail?.code).toMatch(/^\d{6}$/)
    const protectedCode = await db.prepare('SELECT token_hash FROM auth_challenges WHERE id = ?').bind(mail?.challenge_id).first<{ token_hash: string }>()
    expect(protectedCode?.token_hash).not.toBe(mail?.code)
    const verified = await verifyCode(mail?.challenge_id, mail?.code)
    expect(verified.status).toBe(200)
    const cookie = verified.headers.get('set-cookie') || ''
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    const count = await db.prepare('SELECT COUNT(*) as total FROM users WHERE email_normalized = ?').bind('person@example.test').first<{ total: number }>()
    expect(count?.total).toBe(1)
    await db.prepare('UPDATE auth_challenges SET created_at = created_at - 120 WHERE email_normalized = ?').bind('person@example.test').run()
    await db.prepare('UPDATE auth_test_mail SET created_at = created_at - 120 WHERE email_normalized = ?').bind('person@example.test').run()
    await requestCode()
    const secondMail = await readCode('person@example.test')
    const second = await verifyCode(secondMail?.challenge_id, secondMail?.code)
    expect(second.status).toBe(200)
    expect((await db.prepare('SELECT COUNT(*) as total FROM users WHERE email_normalized = ?').bind('person@example.test').first<{ total: number }>())?.total).toBe(1)
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
})
