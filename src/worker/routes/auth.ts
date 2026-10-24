import { Hono } from 'hono'
import type { AppContext } from '../types'
import { nanoid } from 'nanoid'
import type { Env } from '../types'

const app = new Hono<AppContext>()

// Issue challenge (passwordless)
app.post('/challenges', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const email = (body.email || '').toLowerCase().trim()
  if (!email || !email.includes('@')) {
    return c.json({ error: { code: 'INVALID_EMAIL', message: 'Valid email required' } }, 400)
  }
  const token = nanoid(32)
  const tokenHash = await hashToken(token, c.env.SESSION_SECRET)
  const id = nanoid()
  const expires = Math.floor(Date.now() / 1000) + 600 // 10 min
  await c.env.DB.prepare(
    'INSERT INTO auth_challenges (id, token_hash, email_normalized, purpose, expires_at) VALUES (?,?,?,?,?)'
  ).bind(id, tokenHash, email, 'login', expires).run()
  
  // In dev, return token for testing (NEVER in production)
  if (c.env.ENVIRONMENT === 'production') {
    return c.json({ data: { message: 'If an account exists, a login link has been sent.' } })
  }
  return c.json({ data: { message: 'Challenge created (dev mode)', token, expires_at: expires } })
})

app.post('/verify', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const token = body.token
  if (!token) return c.json({ error: { code: 'INVALID', message: 'Token required' } }, 400)
  const tokenHash = await hashToken(token, c.env.SESSION_SECRET)
  const challenge = await c.env.DB.prepare(
    'SELECT * FROM auth_challenges WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?'
  ).bind(tokenHash, Math.floor(Date.now()/1000)).first<any>()
  if (!challenge) return c.json({ error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' } }, 401)
  
  await c.env.DB.prepare('UPDATE auth_challenges SET consumed_at = ?, attempts = attempts + 1 WHERE id = ?')
    .bind(Math.floor(Date.now()/1000), challenge.id).run()
  
  // Find or create user
  let user = await c.env.DB.prepare('SELECT * FROM users WHERE email_normalized = ?').bind(challenge.email_normalized).first<any>()
  if (!user) {
    const userId = nanoid()
    await c.env.DB.prepare('INSERT INTO users (id, email_normalized, verified_at) VALUES (?,?,?)')
      .bind(userId, challenge.email_normalized, Math.floor(Date.now()/1000)).run()
    user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<any>()
  }
  
  // Create session
  const sessionToken = nanoid(48)
  const sessionHash = await hashToken(sessionToken, c.env.SESSION_SECRET)
  const sessionId = nanoid()
  const sessionExpires = Math.floor(Date.now()/1000) + 60*60*24*7 // 7 days
  await c.env.DB.prepare('INSERT INTO sessions (id, token_hash, user_id, expires_at) VALUES (?,?,?,?)')
    .bind(sessionId, sessionHash, user.id, sessionExpires).run()
  
  // Set secure cookie
  const cookie = `joblite_session=${sessionToken}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${60*60*24*7}`
  c.header('Set-Cookie', cookie)
  return c.json({ data: { user: { id: user.id, email: user.email_normalized }, session_expires_at: sessionExpires } })
})

app.post('/logout', async (c) => {
  const cookie = c.req.header('Cookie') || ''
  const match = cookie.match(/joblite_session=([^;]+)/)
  if (match) {
    const sessionHash = await hashToken(match[1], c.env.SESSION_SECRET)
    await c.env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ?')
      .bind(Math.floor(Date.now()/1000), sessionHash).run()
  }
  c.header('Set-Cookie', 'joblite_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0')
  return c.json({ data: { ok: true } })
})

async function hashToken(token: string, secret: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(token))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2,'0')).join('')
}

export default app
