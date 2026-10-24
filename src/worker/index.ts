import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import type { AppContext, Env } from './types'
import { sameOriginMutations } from './middleware/security'
import { flagStaleSources, runSourceIngestion } from './lib/ingestion'
import auth from './routes/auth'
import admin from './routes/admin'
import me from './routes/me'
import countries from './routes/countries'
import jobs from './routes/jobs'
import posts from './routes/posts'
import organizations from './routes/organizations'
import applications, { offers } from './routes/applications'
import media from './routes/media'
import health from './routes/health'
import boards from './routes/boards'
import profiles from './routes/profiles'

const app = new Hono<AppContext>()

app.use('*', secureHeaders())
app.use('/api/*', sameOriginMutations)
app.use('/api/*', cors({
  origin: (origin, c) => {
    const allowed = (c.env as any).APP_URL || 'https://joblite-ahs.aidomexgroupltd.workers.dev'
    if (!origin) return allowed
    if (origin === allowed) return origin
    if (origin.endsWith('.workers.dev')) return origin
    return allowed
  },
  credentials: true,
}))

app.route('/api/health', health)
app.route('/api/v1/boards', boards)
app.route('/api/v1/admin', admin)
app.route('/api/v1/auth', auth)
app.route('/api/v1/me', me)
app.route('/api/v1/profiles', profiles)
app.route('/api/v1/countries', countries)
app.route('/api/v1/jobs', jobs)
app.route('/api/v1/posts', posts)
app.route('/api/v1/offers', offers)
app.route('/api/v1/organizations', organizations)
app.route('/api/v1/applications', applications)
app.route('/api/v1/media', media)

// API failures must stay machine-readable instead of falling through to the SPA shell.
app.onError((error, c) => {
  console.error('unhandled worker error', error instanceof Error ? error.message : 'unknown error')
  if (c.req.path.startsWith('/api/')) {
    return c.json({ error: { code: 'INTERNAL', message: 'Joblite could not complete this request. Please retry.' } }, 500)
  }
  return c.text('Internal Server Error', 500)
})

// 404 for unknown API routes - return JSON not HTML
app.notFound((c) => {
  if (c.req.path.startsWith('/api/')) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } }, 404)
  }
  return c.text('Not Found', 404)
})

/** Serves the SPA shell for client-side routes so deep links reload correctly. */
async function serveAppShell(c: any) {
  if (c.req.path.startsWith('/api/')) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404)
  }

  const assets = (c.env as Env).ASSETS
  if (assets) {
    const assetResponse = await assets.fetch(c.req.raw)
    if (assetResponse.status !== 404) return assetResponse
    const shell = await assets.fetch(new Request(new URL('/index.html', c.req.url).toString(), c.req.raw))
    if (shell.status !== 404) return shell
  }

  try {
    const response = await fetch(new URL('/index.html', c.req.url))
    if (response.ok) return c.html(await response.text())
  } catch {
    // fall through
  }
  return c.text('Not Found', 404)
}

app.get('*', serveAppShell)
app.on(['POST', 'PUT', 'PATCH', 'DELETE'], '*', serveAppShell)

async function dispatchOutbox(env: Env): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  const { results } = await env.DB.prepare(
    "SELECT id, event_id, event_type, payload_json, attempts FROM outbox WHERE state = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY created_at ASC LIMIT 20"
  )
    .bind(now)
    .all()

  for (const row of results as Array<Record<string, any>>) {
    const claimed = await env.DB.prepare("UPDATE outbox SET state = 'dispatching' WHERE id = ? AND state = 'pending'")
      .bind(row.id)
      .run()
    if ((claimed.meta?.changes ?? 0) === 0) continue

    try {
      await env.OUTBOX_QUEUE.send({
        type: row.event_type,
        event_id: row.event_id,
        payload: JSON.parse(row.payload_json || '{}'),
      })
      await env.DB.prepare("UPDATE outbox SET state = 'dispatched', processed_at = ? WHERE id = ?")
        .bind(Math.floor(Date.now() / 1000), row.id)
        .run()
    } catch {
      const attempts = Number(row.attempts || 0) + 1
      const failed = attempts >= 5
      const backoffUntil = Math.floor(Date.now() / 1000) + Math.min(60 * 2 ** attempts, 3600)
      await env.DB.prepare('UPDATE outbox SET state = ?, attempts = ?, next_attempt_at = ? WHERE id = ?')
        .bind(failed ? 'failed' : 'pending', attempts, backoffUntil, row.id)
        .run()
    }
  }
}

async function enqueueSourceRefreshes(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(
    "SELECT id FROM sources WHERE permission_state = 'import_allowed' AND enabled = 1 ORDER BY last_attempt_at IS NOT NULL, last_attempt_at ASC LIMIT 20"
  ).all()

  for (const row of results as Array<{ id: string }>) {
    try {
      await env.INGEST_QUEUE.send({ type: 'source.refresh', source_id: row.id, enqueued_at: Date.now() })
    } catch {
      // Local development and queue outages fall back to an in-request refresh.
      await runSourceIngestion(env, row.id)
    }
  }
}

export default {
  fetch: app.fetch,

  async queue(batch: MessageBatch<any>, env: Env) {
    for (const message of batch.messages) {
      try {
        if (message.body?.type === 'source.refresh' && typeof message.body.source_id === 'string') {
          await runSourceIngestion(env, message.body.source_id)
        }
        // Outbox events are consumed after their side effects have been applied;
        // consumers acknowledge idempotently by event id.
        message.ack()
      } catch {
        message.retry()
      }
    }
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    if (event.cron === '*/30 * * * *') {
      // Refresh approved feeds every 30 minutes and flag stale sources. Bounded,
      // queue-backed and protected against overlapping runs per source.
      ctx.waitUntil(
        (async () => {
          await enqueueSourceRefreshes(env)
          await flagStaleSources(env)
        })()
      )
    } else if (event.cron === '*/5 * * * *') {
      // Existing five-minute outbox dispatch is preserved and runs separately
      // from the thirty-minute source refresh.
      ctx.waitUntil(dispatchOutbox(env))
    }
  },
}
