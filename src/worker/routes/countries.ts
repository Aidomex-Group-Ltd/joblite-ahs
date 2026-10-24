import { Hono } from 'hono'
import type { AppContext } from '../types'
import type { Env } from '../types'

const app = new Hono<AppContext>()

app.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT code, name, region, is_territory FROM countries ORDER BY name'
  ).all()
  return c.json({ data: results })
})

app.get('/:code', async (c) => {
  const code = c.req.param('code').toUpperCase()
  const country = await c.env.DB.prepare(
    'SELECT code, name, region, is_territory FROM countries WHERE code = ?'
  ).bind(code).first()
  if (!country) return c.json({ error: { code: 'NOT_FOUND', message: 'Country not found' } }, 404)
  return c.json({ data: country })
})

export default app
