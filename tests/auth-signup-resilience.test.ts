import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nanoid } from 'nanoid'
import worker from '../src/worker/index'
import type { Env } from '../src/worker/types'
import { createTestEnv } from './helpers/d1'

// Regression coverage for the production signup incident: a verification email
// could be delivered while POST /api/v1/auth/challenges returned HTTP 500
// (INTERNAL). These tests drive the *full* Worker (including its onError
// handler) so the incident symptom is pinned end to end: once the provider has
// accepted the message, no later failure may surface as a 500 or lose the code.
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext

describe('signup challenge resilience (full worker)', () => {
  let env: Env
  let d1: ReturnType<typeof createTestEnv>['d1']
  let close: () => void

  beforeEach(() => {
    const test = createTestEnv()
    env = test.env
    d1 = test.d1
    close = test.close
    env.TEST_MAIL_SINK = undefined
    env.EMAIL_API_KEY = 'test-signup-key'
    env.EMAIL_FROM = 'Joblite <auth@example.test>'
  })

  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); close() })

  function challenges(email: string, key: string) {
    return worker.fetch(new Request('https://joblite.test/api/v1/auth/challenges', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, idempotency_key: key }),
    }), env, ctx)
  }

  it('returns 200 with provider acceptance and never leaks the code', async () => {
    let deliveredCode = ''
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      deliveredCode = (JSON.parse(String(init?.body)) as { text: string }).text.match(/\b\d{6}\b/)?.[0] || ''
      return new Response(JSON.stringify({ id: 'provider-accepted-1' }), { status: 200 })
    }))

    const response = await challenges('resilient@example.test', nanoid(24))
    expect(response.status).toBe(200)
    const payload = await response.json() as any
    expect(payload.data.delivery_status).toBe('accepted')
    expect(payload.data.code).toBeUndefined()
    expect(deliveredCode).toMatch(/^\d{6}$/)
    expect(JSON.stringify(payload)).not.toContain(deliveredCode)
  })

  it('returns a usable 202, not a 500, when the provider accepted but the acceptance record write fails', async () => {
    let deliveredCode = ''
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      deliveredCode = (JSON.parse(String(init?.body)) as { text: string }).text.match(/\b\d{6}\b/)?.[0] || ''
      return new Response(JSON.stringify({ id: 'provider-accepted-2' }), { status: 200 })
    }))
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    // Simulate the original failure window: the email is out, but the D1 write
    // that records provider acceptance fails.
    d1.failNextRunMatching = "SET delivery_status = 'accepted'"
    const key = nanoid(24)

    const first = await challenges('window@example.test', key)
    expect(first.status).toBe(202)
    expect(first.status).not.toBe(500)
    const firstPayload = await first.json() as any
    expect(firstPayload.data.delivery_status).toBe('unknown')
    expect(firstPayload.data.challenge_id).toBeTruthy()
    expect(firstPayload.data.code).toBeUndefined()

    // The code was delivered, so the challenge must remain usable.
    const challenge = await d1.prepare('SELECT consumed_at FROM auth_challenges WHERE email_normalized = ?')
      .bind('window@example.test').first<{ consumed_at: number | null }>()
    expect(challenge?.consumed_at).toBeNull()

    // A retry with the same browser session must not send a second email.
    const retry = await challenges('window@example.test', key)
    expect(retry.status).toBe(202)
    const retryPayload = await retry.json() as any
    expect(retryPayload.data.challenge_id).toBe(firstPayload.data.challenge_id)
    expect((globalThis.fetch as any).mock.calls).toHaveLength(1)

    // Diagnostics must be redacted: no recipient address, no verification code, no key.
    const logged = errorLog.mock.calls.map((call) => String(call[0])).join('\n')
    expect(logged).toContain('auth_challenge_acceptance_update_failed')
    expect(logged).not.toContain('window@example.test')
    expect(logged).not.toContain(deliveredCode)
    expect(logged).not.toContain('test-signup-key')
  })

  it('keeps a usable challenge and avoids a 500 when the provider response is ambiguous', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network unavailable') }))
    const warnLog = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const response = await challenges('ambiguous@example.test', nanoid(24))
    expect(response.status).toBe(202)
    expect((await response.json() as any).data.delivery_status).toBe('unknown')

    const challenge = await d1.prepare('SELECT consumed_at FROM auth_challenges WHERE email_normalized = ?')
      .bind('ambiguous@example.test').first<{ consumed_at: number | null }>()
    expect(challenge?.consumed_at).toBeNull()
    const logged = warnLog.mock.calls.map((call) => String(call[0])).join('\n')
    expect(logged).toContain('auth_email_delivery_outcome_unknown')
    expect(logged).not.toContain('ambiguous@example.test')
  })
})
