import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import worker from '../src/worker/index'
import adminRoute from '../src/worker/routes/admin'
import type { Env } from '../src/worker/types'
import { createTestEnv } from './helpers/d1'

function makeCtx() {
  const pending: Promise<unknown>[] = []
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => { pending.push(promise) },
    passThroughOnException: () => undefined,
  } as unknown as ExecutionContext
  return { ctx, wait: () => Promise.all(pending) }
}

describe('outbox delivery', () => {
  let env: Env
  let d1: ReturnType<typeof createTestEnv>['d1']
  let close: () => void
  let send: ReturnType<typeof vi.fn>

  beforeEach(() => {
    const test = createTestEnv()
    env = test.env
    d1 = test.d1
    close = test.close
    send = vi.fn(async () => undefined)
    ;(env as any).OUTBOX_QUEUE = { send }
  })

  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); close() })

  async function insertOutbox(row: {
    id: string
    eventId: string
    state?: string
    attempts?: number
    createdAt?: number
    claimedAt?: number | null
    nextAttemptAt?: number | null
  }) {
    await env.DB.prepare(
      `INSERT INTO outbox (id, event_id, event_type, payload_json, state, attempts, created_at, claimed_at, next_attempt_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).bind(
      row.id,
      row.eventId,
      'application.submitted',
      JSON.stringify({ application_id: row.eventId }),
      row.state || 'pending',
      row.attempts ?? 0,
      row.createdAt ?? Math.floor(Date.now() / 1000),
      row.claimedAt ?? null,
      row.nextAttemptAt ?? null
    ).run()
  }

  async function runDispatchPump() {
    const { ctx, wait } = makeCtx()
    worker.scheduled({ cron: '*/5 * * * *' } as unknown as ScheduledEvent, env, ctx)
    await wait()
  }

  it('re-claims and dispatches an outbox row whose dispatch lease expired', async () => {
    const now = Math.floor(Date.now() / 1000)
    await insertOutbox({ id: 'stuck', eventId: 'evt-stuck', state: 'dispatching', attempts: 1, claimedAt: now - 600 })

    await runDispatchPump()

    expect(send).toHaveBeenCalledTimes(1)
    const row = await env.DB.prepare('SELECT state, claimed_at FROM outbox WHERE id = ?').bind('stuck')
      .first<{ state: string; claimed_at: number | null }>()
    expect(row?.state).toBe('dispatched')
    expect(row?.claimed_at).toBeNull()
  })

  it('does not re-send a row whose dispatch lease is still active', async () => {
    const now = Math.floor(Date.now() / 1000)
    await insertOutbox({ id: 'inflight', eventId: 'evt-inflight', state: 'dispatching', attempts: 1, claimedAt: now })

    await runDispatchPump()

    expect(send).not.toHaveBeenCalled()
    const row = await env.DB.prepare('SELECT state FROM outbox WHERE id = ?').bind('inflight')
      .first<{ state: string }>()
    expect(row?.state).toBe('dispatching')
  })

  it('backs off a failed enqueue and records only a failure label', async () => {
    send.mockRejectedValueOnce(new Error('queue unavailable'))
    await insertOutbox({ id: 'pending-1', eventId: 'evt-pending' })

    await runDispatchPump()

    const row = await env.DB.prepare('SELECT state, attempts, next_attempt_at, last_error FROM outbox WHERE id = ?')
      .bind('pending-1')
      .first<{ state: string; attempts: number; next_attempt_at: number | null; last_error: string | null }>()
    expect(row?.state).toBe('pending')
    expect(row?.attempts).toBe(1)
    expect(row?.next_attempt_at).toBeGreaterThan(Math.floor(Date.now() / 1000))
    expect(row?.last_error).toBe('Error')
    expect(row?.last_error).not.toContain('application_id')
  })

  it('processes an outbox event idempotently and marks events with no channel', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const body = { type: 'application.submitted', event_id: 'evt-consume', payload: { application_id: 'a1' } }

    const firstAck = vi.fn()
    await worker.queue({ messages: [{ body, ack: firstAck, retry: vi.fn() }] } as unknown as MessageBatch<any>, env)
    expect(firstAck).toHaveBeenCalledTimes(1)

    const delivered = await env.DB.prepare('SELECT event_type, outcome FROM outbox_deliveries WHERE event_id = ?')
      .bind('evt-consume')
      .first<{ event_type: string; outcome: string }>()
    expect(delivered).toEqual({ event_type: 'application.submitted', outcome: 'no_handler' })
    expect(warn.mock.calls.map((call) => String(call[0])).join('\n')).toContain('outbox_event_without_handler')

    // Redelivery must not repeat processing or the diagnostic.
    const secondAck = vi.fn()
    await worker.queue({ messages: [{ body, ack: secondAck, retry: vi.fn() }] } as unknown as MessageBatch<any>, env)
    expect(secondAck).toHaveBeenCalledTimes(1)
    const total = await env.DB.prepare('SELECT COUNT(*) AS count FROM outbox_deliveries WHERE event_id = ?')
      .bind('evt-consume').first<{ count: number }>()
    expect(total?.count).toBe(1)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('retries instead of acknowledging when consumer processing fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const ack = vi.fn()
    const retry = vi.fn()
    d1.failNextRunMatching = 'INSERT OR IGNORE INTO outbox_deliveries'
    await worker.queue({
      messages: [{ body: { type: 'offer.issued', event_id: 'evt-fail' }, ack, retry }],
    } as unknown as MessageBatch<any>, env)

    expect(ack).not.toHaveBeenCalled()
    expect(retry).toHaveBeenCalledTimes(1)
    expect(await env.DB.prepare('SELECT event_id FROM outbox_deliveries WHERE event_id = ?').bind('evt-fail').first()).toBeNull()
  })

  it('exposes a read-only outbox inspection to administrators', async () => {
    const now = Math.floor(Date.now() / 1000)
    await insertOutbox({ id: 'b1', eventId: 'evt-b1', state: 'failed', attempts: 5 })
    await insertOutbox({ id: 'b2', eventId: 'evt-b2', state: 'dispatching', claimedAt: now - 600 })

    const app = new Hono()
    app.route('/api/v1/admin', adminRoute)

    const unauthorized = await app.request('/api/v1/admin/outbox', {}, env as any)
    expect(unauthorized.status).toBe(401)

    const response = await app.request('/api/v1/admin/outbox', { headers: { Authorization: 'Bearer test-ingest-token' } }, env as any)
    expect(response.status).toBe(200)
    const payload = await response.json() as any
    const backlog = payload.data.backlog as Array<{ id: string; state: string; lease_expired: boolean }>
    expect(backlog.find((row) => row.id === 'b2')?.lease_expired).toBe(true)
    expect(backlog.find((row) => row.id === 'b1')?.lease_expired).toBe(false)
    expect(payload.data.counts).toEqual(expect.arrayContaining([
      { state: 'failed', count: 1 },
      { state: 'dispatching', count: 1 },
    ]))
    // The inspection must never expose payload contents.
    expect(JSON.stringify(payload)).not.toContain('application_id')
  })
})
