import { Context, Next } from 'hono'
import type { Env } from '../types'

async function hashToken(token: string, secret: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(token))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2,'0')).join('')
}

export async function requireAuth(c: Context<any>, next: Next) {
  const cookie = c.req.header('Cookie') || ''
  const match = cookie.match(/joblite_session=([^;]+)/)
  if (!match) {
    return c.json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }, 401)
  }
  const sessionHash = await hashToken(match[1], (c.env as Env).SESSION_SECRET)
  const session = await (c.env as Env).DB.prepare(
    'SELECT s.*, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?'
  ).bind(sessionHash, Math.floor(Date.now()/1000)).first<any>()
  if (!session) {
    return c.json({ error: { code: 'UNAUTHENTICATED', message: 'Invalid session' } }, 401)
  }
  c.set('user' as any, { id: session.user_id, email: session.email_normalized, verified_at: session.verified_at, display_name: session.display_name || null })
  c.set('session' as any, session)
  await next()
}

export type SessionUser = {
  id: string
  email: string
  verified_at?: number | null
  display_name?: string | null
}

/** Resolves an optional session without requiring one. Used by public reads and admin checks. */
export async function readSessionUser(c: Context<any>): Promise<SessionUser | null> {
  const cookie = c.req.header('Cookie') || ''
  const match = cookie.match(/joblite_session=([^;]+)/)
  if (!match) return null
  try {
    const sessionHash = await hashToken(match[1], (c.env as Env).SESSION_SECRET)
    const session = await (c.env as Env).DB.prepare(
      'SELECT s.*, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?'
    ).bind(sessionHash, Math.floor(Date.now()/1000)).first<any>()
    if (!session) return null
    return {
      id: session.user_id,
      email: session.email_normalized,
      verified_at: session.verified_at,
      display_name: session.display_name || null,
    }
  } catch {
    return null
  }
}

export async function optionalAuth(c: Context<any>, next: Next) {
  const user = await readSessionUser(c)
  if (user) c.set('user' as any, user)
  await next()
}
