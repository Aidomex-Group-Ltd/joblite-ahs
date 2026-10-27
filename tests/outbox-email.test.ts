import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from '../src/worker/index'
import type { Env } from '../src/worker/types'
import { createTestEnv } from './helpers/d1'

const now = () => Math.floor(Date.now() / 1000)

function message(eventId: string, body: { type: string; payload?: unknown }) {
  return { body: { event_id: eventId, ...body }, ack: vi.fn(), retry: vi.fn() }
}

describe('outbox interview invitation email', () => {
  let env: Env
  let d1: ReturnType<typeof createTestEnv>['d1']
  let close: () => void

  beforeEach(async () => {
    const test = createTestEnv()
    env = test.env
    d1 = test.d1
    close = test.close
    env.EMAIL_API_KEY = 'test-email-key'
    env.EMAIL_FROM = 'Joblite <jobs@example.test>'
    env.APP_URL = 'https://joblite.test'

    await env.DB.prepare('INSERT INTO organizations (id, slug, name) VALUES (?,?,?)')
      .bind('org-1', 'acme', 'Acme Studios').run()
    await env.DB.prepare('INSERT INTO users (id, email_normalized, verified_at, display_name) VALUES (?,?,?,?)')
      .bind('cand-1', 'candidate@example.test', now(), 'Casey Candidate').run()
    await env.DB.prepare(
      `INSERT INTO jobs (id, origin, organization_id, title, body, status, application_method, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).bind('job-1', 'native', 'org-1', 'Senior Linguist', 'A real job description.', 'published', 'native', now(), now()).run()
    await env.DB.prepare(
      'INSERT INTO applications (id, candidate_id, job_id, stage, version, submitted_at, updated_at) VALUES (?,?,?,?,?,?,?)'
    ).bind('app-1', 'cand-1', 'job-1', 'interview', 1, now(), now()).run()
    await env.DB.prepare(
      'INSERT INTO interviews (id, application_id, scheduled_at, timezone, status, created_at) VALUES (?,?,?,?,?,?)'
    ).bind('int-1', 'app-1', now() + 86_400, 'Europe/London', 'planned', now()).run()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); close() })

  const inviteBody = { type: 'interview.scheduled', payload: { application_id: 'app-1', interview_id: 'int-1' } }

  async function delivery(eventId: string) {
    return env.DB.prepare('SELECT outcome, attempts, last_error FROM outbox_deliveries WHERE event_id = ?')
      .bind(eventId)
      .first<{ outcome: string; attempts: number; last_error: string | null }>()
  }

  it('emails the candidate once with provider idempotency and records the delivery', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'resend-1' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const first = message('evt-1', inviteBody)
    await worker.queue({ messages: [first] } as unknown as MessageBatch<any>, env)

    expect(first.ack).toHaveBeenCalledTimes(1)
    expect(first.retry).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.resend.com/emails')
    const payload = JSON.parse(String(init.body)) as { to: string[]; subject: string; text: string }
    expect(payload.to).toEqual(['candidate@example.test'])
    expect(payload.subject).toContain('Senior Linguist')
    expect(payload.text).toContain('Acme Studios')
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe('evt-1')
    expect(await delivery('evt-1')).toEqual({ outcome: 'handled', attempts: 1, last_error: null })
  })

  it('does not send a second email when the same event is delivered twice', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'resend-1' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await worker.queue({ messages: [message('evt-dup', inviteBody)] } as unknown as MessageBatch<any>, env)
    const second = message('evt-dup', inviteBody)
    await worker.queue({ messages: [second] } as unknown as MessageBatch<any>, env)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(second.ack).toHaveBeenCalledTimes(1)
    expect((await delivery('evt-dup'))?.attempts).toBe(1)
  })

  it('retries after a provider failure and recovers without duplicating the email', async () => {
    const fetchMock = vi.fn()
    fetchMock.mockRejectedValueOnce(new TypeError('network down'))
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'resend-2' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const failed = message('evt-recover', inviteBody)
    await worker.queue({ messages: [failed] } as unknown as MessageBatch<any>, env)
    expect(failed.retry).toHaveBeenCalledTimes(1)
    expect(failed.ack).not.toHaveBeenCalled()
    expect(await delivery('evt-recover')).toEqual({ outcome: 'retrying', attempts: 1, last_error: 'email_send_network' })

    const recovered = message('evt-recover', inviteBody)
    await worker.queue({ messages: [recovered] } as unknown as MessageBatch<any>, env)
    expect(recovered.ack).toHaveBeenCalledTimes(1)
    expect(recovered.retry).not.toHaveBeenCalled()
    expect(await delivery('evt-recover')).toEqual({ outcome: 'handled', attempts: 2, last_error: null })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('parks a persistently failing event as failed instead of retrying forever', async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError('network down') })
    vi.stubGlobal('fetch', fetchMock)

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const deliveryAttempt = message('evt-exhaust', inviteBody)
      await worker.queue({ messages: [deliveryAttempt] } as unknown as MessageBatch<any>, env)
      if (attempt < 5) {
        expect(deliveryAttempt.retry).toHaveBeenCalledTimes(1)
        expect(deliveryAttempt.ack).not.toHaveBeenCalled()
      } else {
        // Budget exhausted: acknowledged (not retried) and visible as failed.
        expect(deliveryAttempt.retry).not.toHaveBeenCalled()
        expect(deliveryAttempt.ack).toHaveBeenCalledTimes(1)
      }
    }

    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(await delivery('evt-exhaust')).toEqual({ outcome: 'failed', attempts: 5, last_error: 'email_send_network' })
  })

  it('treats missing email configuration as a retryable failure, not a silent success', async () => {
    env.EMAIL_API_KEY = undefined
    env.RESEND_API_KEY = undefined
    env.EMAIL_FROM = undefined
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const attempt = message('evt-unconfigured', inviteBody)
    await worker.queue({ messages: [attempt] } as unknown as MessageBatch<any>, env)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(attempt.retry).toHaveBeenCalledTimes(1)
    expect(attempt.ack).not.toHaveBeenCalled()
    expect(await delivery('evt-unconfigured')).toEqual({ outcome: 'retrying', attempts: 1, last_error: 'email_configuration_error' })
  })

  it('sends no invitation when the interview is no longer planned', async () => {
    await env.DB.prepare("UPDATE interviews SET status = 'cancelled' WHERE id = 'int-1'").run()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const attempt = message('evt-cancelled', inviteBody)
    await worker.queue({ messages: [attempt] } as unknown as MessageBatch<any>, env)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(attempt.ack).toHaveBeenCalledTimes(1)
    // Handled means "resolved, no side effect"; it must not be retried.
    expect(await delivery('evt-cancelled')).toEqual({ outcome: 'handled', attempts: 1, last_error: null })
  })

  it('records an unknown event type as no_handler rather than dropping it', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const attempt = message('evt-unknown', { type: 'application.hired', payload: {} })
    await worker.queue({ messages: [attempt] } as unknown as MessageBatch<any>, env)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(attempt.ack).toHaveBeenCalledTimes(1)
    expect((await delivery('evt-unknown'))?.outcome).toBe('no_handler')
  })
})
