import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import type { AppContext } from '../types'
import { optionalAuth } from '../middleware/auth'

const app = new Hono<AppContext>()
const REGION_CODES = new Set(['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IS','IE','IT','LV','LI','LT','LU','MT','NL','NO','PL','PT','RO','SK','SI','ES','SE'])

function regionFor(country: string): string {
  if (country === 'UG') return 'UG'
  if (country === 'GB') return 'UK'
  if (REGION_CODES.has(country)) return 'EEA'
  return 'unknown'
}

app.get('/region', (c) => {
  const country = String((c.req.raw as Request & { cf?: { country?: string } }).cf?.country || '').toUpperCase()
  c.header('Cache-Control', 'private, no-store')
  return c.json({ data: { detected_country: /^[A-Z]{2}$/.test(country) ? country : null, detected_region: regionFor(country), basis: 'approximate_edge_country' } })
})

app.post('/choices', optionalAuth, async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const action = body.action
  if (!['consent_grant','consent_refusal','withdrawal'].includes(action)) return c.json({ error: { code: 'INVALID_ACTION', message: 'Choose a supported privacy preference action.' } }, 400)
  const purpose = typeof body.purpose === 'string' && ['optional_analytics','optional_marketing'].includes(body.purpose) ? body.purpose : 'optional_tracking'
  const region = typeof body.region === 'string' && ['UG','EEA','UK','other','unknown'].includes(body.region) ? body.region : 'unknown'
  const language = typeof body.language === 'string' && /^[a-z]{2}(-[A-Z]{2})?$/.test(body.language) ? body.language : 'en'
  const user = c.get('user')
  let anonymousIdHash: string | null = null
  if (!user) {
    const anonymousId = typeof body.anonymous_id === 'string' ? body.anonymous_id : ''
    if (!/^[a-f\d-]{36}$/i.test(anonymousId)) return c.json({ error: { code: 'INVALID_SUBJECT', message: 'A local preference identifier is required.' } }, 400)
    anonymousIdHash = await hashAnonymousId(anonymousId, c.env.SESSION_SECRET)
  }
  const now = Math.floor(Date.now() / 1000)
  await c.env.DB.prepare(
    `INSERT INTO legal_records (id, user_id, anonymous_id_hash, document_id, document_version, action, purpose, region, language, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).bind(nanoid(), user?.id || null, anonymousIdHash, 'privacy-choices', 'v1-2026-10-24', action, purpose, region, language, now).run()
  c.header('Cache-Control', 'private, no-store')
  return c.json({ data: { recorded: true } }, 201)
})

export default app

async function hashAnonymousId(id: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`anonymous:${id}`))
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
