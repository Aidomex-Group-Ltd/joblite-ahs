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
import legal from './routes/legal'
import { DEFAULT_METADATA, metadataHeadMarkup, SITE_ORIGIN, type PageMetadata } from '../shared/page-metadata'

const app = new Hono<AppContext>()

app.use('*', secureHeaders())
app.use('/api/*', sameOriginMutations)
app.use('/api/v1/me/*', async (c, next) => { await next(); c.header('Cache-Control', 'private, no-store') })
app.use('/api/v1/me', async (c, next) => { await next(); c.header('Cache-Control', 'private, no-store') })
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
app.route('/api/v1/legal', legal)
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

function plainText(value: unknown, limit: number): string {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&#\d+;|&#x[\da-f]+;|&[a-z]+;/gi, ' ').replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, limit)
}

function routeCanonical(path: string): string {
  return `${SITE_ORIGIN}${path === '/' ? '/' : path}`
}

async function publicMetadata(env: Env, pathname: string): Promise<{ metadata: PageMetadata; status: number; cache: string }> {
  if (pathname === '/') return { metadata: DEFAULT_METADATA, status: 200, cache: 'public, max-age=60, s-maxage=300, stale-while-revalidate=60' }
  const jobMatch = /^\/jobs\/([A-Za-z0-9_-]+)$/.exec(pathname)
  if (jobMatch) {
    const row = await env.DB.prepare(
      `SELECT j.id, j.title, j.body, j.status, j.expires_at, j.location_text, j.workplace_arrangement,
        j.salary_text, j.company_name, o.name AS organization_name
       FROM jobs j LEFT JOIN organizations o ON o.id = j.organization_id
       WHERE j.id = ? AND j.status = 'published' AND (j.expires_at IS NULL OR j.expires_at > ?)`
    ).bind(jobMatch[1], Math.floor(Date.now() / 1000)).first<Record<string, unknown>>()
    if (!row) return { metadata: { ...DEFAULT_METADATA, url: routeCanonical(pathname), noindex: true }, status: 404, cache: 'private, no-store' }
    const company = plainText(row.organization_name || row.company_name || 'Employer', 120)
    const title = plainText(row.title, 160)
    const pieces = [plainText(row.location_text, 100), row.workplace_arrangement === 'remote' ? 'Remote' : '', plainText(row.salary_text, 100)].filter(Boolean)
    const description = [title, company, ...pieces].join(' · ').slice(0, 300)
    return { metadata: { ...DEFAULT_METADATA, title: `${title} · ${company} | Joblite AHIS`, description, url: routeCanonical(pathname), type: 'website' }, status: 200, cache: 'public, max-age=30, s-maxage=60, stale-while-revalidate=30' }
  }
  const postMatch = /^\/posts\/([A-Za-z0-9_-]+)$/.exec(pathname)
  if (postMatch) {
    const row = await env.DB.prepare(
      `SELECT p.id, p.body FROM posts p WHERE p.id = ? AND p.visibility = 'public' AND p.state = 'published'`
    ).bind(postMatch[1]).first<{ id: string; body: string }>()
    if (!row) return { metadata: { ...DEFAULT_METADATA, url: routeCanonical(pathname), noindex: true }, status: 404, cache: 'private, no-store' }
    const media = await env.DB.prepare(
      `SELECT m.id, m.mime_type FROM post_media pm JOIN media m ON m.id = pm.media_id
       WHERE pm.post_id = ? AND m.state = 'ready' AND m.type = 'image' AND m.mime_type LIKE 'image/%'
       ORDER BY pm.ordering LIMIT 1`
    ).bind(row.id).first<{ id: string; mime_type: string }>()
    const excerpt = plainText(row.body, 260) || 'A public post from the Joblite community.'
    const image = media ? `${SITE_ORIGIN}/api/v1/media/${encodeURIComponent(media.id)}/content` : DEFAULT_METADATA.image!
    return { metadata: { ...DEFAULT_METADATA, title: `${excerpt.slice(0, 90)} | Joblite AHIS`, description: excerpt, url: routeCanonical(pathname), type: 'article', image, imageType: media?.mime_type || 'image/png', imageWidth: media ? undefined : 1200, imageHeight: media ? undefined : 630, imageAlt: media ? `Image shared in a public Joblite post: ${excerpt.slice(0, 120)}` : DEFAULT_METADATA.imageAlt }, status: 200, cache: 'public, max-age=30, s-maxage=60, stale-while-revalidate=30' }
  }
  const legalMatch = /^\/legal(?:\/[a-z-]+)?$/.test(pathname)
  const publicRoute = pathname === '/' || pathname === '/jobs' || pathname === '/boards' || legalMatch
  const safePath = pathname.replace(/[\u0000-\u001f<>"']/g, '')
  const metadata = legalMatch
    ? { ...DEFAULT_METADATA, title: `${pathname === '/legal' ? 'Legal center' : pathname.split('/').pop()?.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())} | Joblite AHIS`, description: 'Joblite policies, terms, privacy information, and user rights.', url: routeCanonical(safePath), noindex: false }
    : { ...DEFAULT_METADATA, url: routeCanonical(safePath), noindex: !publicRoute }
  return { metadata, status: 200, cache: publicRoute ? 'public, max-age=60, s-maxage=300' : 'private, no-store' }
}

function injectMetadata(html: string, metadata: PageMetadata): string {
  const markup = metadataHeadMarkup(metadata)
  const clean = html
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, '')
    .replace(/<meta\b(?=[^>]*\b(?:name|property)=["'](?:description|robots|og:[^"']+|twitter:[^"']+)["'])[^>]*>/gi, '')
    .replace(/<link\s+[^>]*rel=["']canonical["'][^>]*>/gi, '')
  return clean.replace(/<\/head>/i, `    ${markup}\n  </head>`)
}

/** Serves safe public metadata in the SPA's initial response and keeps private routes out of shared caches. */
async function serveAppShell(c: any) {
  if (c.req.path.startsWith('/api/')) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404)
  }

  const assets = (c.env as Env).ASSETS
  if (assets) {
    const pathname = new URL(c.req.url).pathname
    const isFileRequest = pathname.startsWith('/assets/') || /\.[a-z\d]{2,8}$/i.test(pathname)
    if (isFileRequest) {
      const assetResponse = await assets.fetch(c.req.raw)
      if (assetResponse.status === 404) return assetResponse
      return new Response(assetResponse.body, {
        status: assetResponse.status,
        statusText: assetResponse.statusText,
        headers: new Headers(assetResponse.headers),
      })
    }
    // The asset binding serves the SPA shell at `/`; requesting `/index.html`
    // can produce an empty stream on some Workers asset deployments.
    const shell = await assets.fetch(new Request(new URL('/', c.req.url).toString()))
    if (shell.status !== 404) {
      const page = await publicMetadata(c.env as Env, pathname)
      const headers = new Headers(shell.headers)
      headers.set('Content-Type', 'text/html; charset=UTF-8')
      headers.set('Cache-Control', page.cache)
      if (page.metadata.noindex) headers.set('X-Robots-Tag', 'noindex, nofollow')
      return new Response(injectMetadata(await shell.text(), page.metadata), { status: page.status, headers })
    }
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
