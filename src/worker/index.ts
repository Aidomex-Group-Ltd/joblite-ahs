import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import type { AppContext } from './types'
import auth from './routes/auth'
import me from './routes/me'
import countries from './routes/countries'
import jobs from './routes/jobs'
import posts from './routes/posts'
import organizations from './routes/organizations'
import applications from './routes/applications'
import media from './routes/media'
import health from './routes/health'
import boards from './routes/boards'

const app = new Hono<AppContext>()

app.use('*', secureHeaders())
app.use('/api/*', cors({
  origin: (origin, c) => {
    const allowed = (c.env as any).APP_URL || 'http://localhost:8787'
    if (origin === allowed || origin?.endsWith('.workers.dev')) return origin
    return allowed
  },
  credentials: true,
}))

app.route('/api/health', health)
app.route('/api/v1/boards', boards)
app.route('/api/v1/auth', auth)
app.route('/api/v1/me', me)
app.route('/api/v1/countries', countries)
app.route('/api/v1/jobs', jobs)
app.route('/api/v1/posts', posts)
app.route('/api/v1/organizations', organizations)
app.route('/api/v1/applications', applications)
app.route('/api/v1/media', media)

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<any>, env: any) {
    for (const message of batch.messages) {
      message.ack()
    }
  },
  async scheduled(event: ScheduledEvent, env: any, ctx: ExecutionContext) {
  }
}

// SPA fallback for non-API routes
app.get('*', async (c) => {
  // Try to serve static asset if available
  if ((c.env as any).ASSETS) {
    try {
      return (c.env as any).ASSETS.fetch(c.req.raw)
    } catch {}
  }
  // Fallback to index.html
  try {
    const res = await fetch(new URL('/index.html', c.req.url))
    const html = await res.text()
    return c.html(html)
  } catch {
    return c.text('Not Found', 404)
  }
})
