import { Hono } from 'hono'
import type { AppContext } from '../types'
import { clampInt, sanitizeText } from '../lib/validate'

const app = new Hono<AppContext>()

app.get('/', async (c) => {
  const q = sanitizeText(c.req.query('q') || '', 60).toLowerCase()
  const limit = clampInt(c.req.query('limit'), 1, 50, 15)
  if (!q) {
    const { results } = await c.env.DB.prepare(
      'SELECT label_normalized FROM skills ORDER BY label_normalized ASC LIMIT ?'
    )
      .bind(limit)
      .all<{ label_normalized: string }>()
    return c.json({ data: results.map((row) => row.label_normalized) })
  }
  const escaped = q.replace(/[\\%_]/g, (char) => `\\${char}`)
  const { results } = await c.env.DB.prepare(
    "SELECT label_normalized FROM skills WHERE label_normalized LIKE ? ESCAPE '\\' ORDER BY label_normalized ASC LIMIT ?"
  )
    .bind(`%${escaped}%`, limit)
    .all<{ label_normalized: string }>()
  return c.json({ data: results.map((row) => row.label_normalized) })
})

export default app
