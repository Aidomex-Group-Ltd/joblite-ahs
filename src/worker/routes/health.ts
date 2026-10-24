import { Hono } from 'hono'
import type { AppContext } from '../types'
import type { Env } from '../types'

const app = new Hono<AppContext>()

app.get('/', async (c) => {
  return c.json({ status: 'ok', service: 'joblite-ahs', timestamp: new Date().toISOString() })
})

app.get('/ready', async (c) => {
  try {
    await c.env.DB.prepare('SELECT 1').first()
    return c.json({ status: 'ready' })
  } catch (e: any) {
    return c.json({ status: 'not_ready', error: e.message }, 503)
  }
})

export default app
