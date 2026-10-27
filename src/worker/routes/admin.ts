import { Hono } from 'hono'
import type { AppContext } from '../types'
import { readSessionUser } from '../middleware/auth'
import { getSyncStatus, runIngestion } from '../lib/ingestion'
import { OUTBOX_LEASE_SECONDS } from '../lib/outbox'
import { clampInt } from '../lib/validate'

const app = new Hono<AppContext>()

async function digest(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value)
  const hash = await crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function authorized(c: any): Promise<{ ok: true; via: 'token' | 'session' } | { ok: false }> {
  const configured = typeof c.env.INGEST_TOKEN === 'string' ? c.env.INGEST_TOKEN.trim() : ''
  const header = c.req.header('Authorization') || ''
  if (configured && header.startsWith('Bearer ')) {
    const provided = header.slice('Bearer '.length).trim()
    if (provided && (await digest(provided)) === (await digest(configured))) {
      return { ok: true, via: 'token' }
    }
  }

  const user = await readSessionUser(c)
  if (!user) return { ok: false }
  const membership = await c.env.DB.prepare(
    "SELECT id FROM memberships WHERE user_id = ? AND role IN ('owner', 'admin') LIMIT 1"
  )
    .bind(user.id)
    .first()
  return membership ? { ok: true, via: 'session' } : { ok: false }
}

app.get('/sync', async (c) => {
  const access = await authorized(c)
  if (!access.ok) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Administrative authorization is required' } }, 401)
  }

  const [status, sources, runs] = await Promise.all([
    getSyncStatus(c.env),
    c.env.DB.prepare(
      `SELECT id, name, kind, permission_state, enabled, feed_url, last_attempt_at, last_success_at,
         last_error, last_error_at, attribution_text, config_json
       FROM sources WHERE permission_state = 'import_allowed' ORDER BY name`
    ).all(),
    c.env.DB.prepare(
      `SELECT r.id, r.source_id, s.name as source_name, r.state, r.counts_json, r.errors_json,
         r.started_at, r.finished_at
       FROM source_runs r JOIN sources s ON s.id = r.source_id
       ORDER BY r.started_at DESC LIMIT 20`
    ).all(),
  ])

  return c.json({
    data: {
      status,
      sources: (sources.results as Array<Record<string, any>>).map((source) => {
        let config: Record<string, unknown> = {}
        try {
          config = JSON.parse(source.config_json || '{}')
        } catch {
          config = {}
        }
        return {
          id: source.id,
          name: source.name,
          kind: source.kind,
          permission_state: source.permission_state,
          enabled: Boolean(source.enabled),
          attribution: source.attribution_text,
          adapter: typeof config.adapter === 'string' ? config.adapter : null,
          min_interval_seconds: typeof config.min_interval_seconds === 'number' ? config.min_interval_seconds : null,
          last_attempt_at: source.last_attempt_at,
          last_success_at: source.last_success_at,
          last_error: source.last_error,
          last_error_at: source.last_error_at,
        }
      }),
      recent_runs: runs.results,
      authorized_via: access.via,
    },
  })
})

app.post('/sync', async (c) => {
  const access = await authorized(c)
  if (!access.ok) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Administrative authorization is required' } }, 401)
  }

  const body = await c.req.json().catch(() => ({}))
  const limit = clampInt(body.limit, 1, 20, 20)
  const sourceIds = Array.isArray(body.source_ids)
    ? body.source_ids.filter((value: unknown): value is string => typeof value === 'string').slice(0, 20)
    : undefined
  const ignoreInterval = body.ignore_interval === true

  const summary = await runIngestion(c.env, { limit, sourceIds, ignoreInterval })
  return c.json({ data: summary })
})

/**
 * Read-only outbox inspection: state counts, recorded delivery outcomes, and the
 * current backlog (pending, in-flight, and parked rows) including whether an
 * in-flight row's lease has expired. No mutation and no payload/recipient data.
 */
app.get('/outbox', async (c) => {
  const access = await authorized(c)
  if (!access.ok) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Administrative authorization is required' } }, 401)
  }

  const now = Math.floor(Date.now() / 1000)
  const [counts, backlog, deliveries, failures] = await Promise.all([
    c.env.DB.prepare('SELECT state, COUNT(*) AS count FROM outbox GROUP BY state').all(),
    c.env.DB.prepare(
      `SELECT id, event_id, event_type, state, attempts, next_attempt_at, created_at, claimed_at, processed_at, last_error
       FROM outbox WHERE state IN ('pending', 'dispatching', 'failed')
       ORDER BY created_at ASC LIMIT 50`
    ).all(),
    c.env.DB.prepare('SELECT outcome, COUNT(*) AS count FROM outbox_deliveries GROUP BY outcome').all(),
    c.env.DB.prepare(
      `SELECT event_id, event_type, outcome, attempts, last_error, claimed_at,
              datetime(processed_at, 'unixepoch') AS processed_utc
       FROM outbox_deliveries WHERE outcome IN ('retrying', 'failed')
       ORDER BY processed_at DESC LIMIT 50`
    ).all(),
  ])

  return c.json({
    data: {
      counts: counts.results,
      deliveries: deliveries.results,
      // Delivery attempts that are still retrying or have been parked as failed.
      delivery_failures: failures.results,
      backlog: (backlog.results as Array<Record<string, any>>).map((row) => ({
        ...row,
        lease_expired: row.state === 'dispatching' && (row.claimed_at === null || row.claimed_at <= now - OUTBOX_LEASE_SECONDS),
      })),
      lease_seconds: OUTBOX_LEASE_SECONDS,
      checked_at: now,
    },
  })
})

export default app
