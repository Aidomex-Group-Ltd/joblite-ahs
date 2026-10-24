import { Hono } from 'hono'
import type { AppContext } from '../types'
import { optionalAuth } from '../middleware/auth'

const app = new Hono<AppContext>()

app.get('/', optionalAuth, async (c) => {
  // Return empty list honestly - no fake boards
  return c.json({ data: [], meta: { message: 'Board directory - configure sources to populate' } })
})

app.get('/countries/:code', optionalAuth, async (c) => {
  const code = c.req.param('code').toUpperCase()
  return c.json({ data: [], country_code: code })
})

export default app
