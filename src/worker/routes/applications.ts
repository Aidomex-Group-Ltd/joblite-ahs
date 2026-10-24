import { Hono } from 'hono'
import type { AppContext } from '../types'
import { nanoid } from 'nanoid'
import type { Env } from '../types'
import { requireAuth } from '../middleware/auth'

const app = new Hono<AppContext>()

app.use('/*', requireAuth)

app.post('/', async (c) => {
  const user = c.get('user')!
  const body = await c.req.json().catch(() => ({}))
  const jobId = body.job_id
  if (!jobId) return c.json({ error: { code: 'INVALID', message: 'job_id required' } }, 400)
  
  const job = await c.env.DB.prepare('SELECT * FROM jobs WHERE id = ?').bind(jobId).first<any>()
  if (!job) return c.json({ error: { code: 'NOT_FOUND', message: 'Job not found' } }, 404)
  if (job.status !== 'published') return c.json({ error: { code: 'INVALID', message: 'Job not accepting applications' } }, 400)
  if (job.origin !== 'native' || job.application_method !== 'native') {
    return c.json({ error: { code: 'INVALID', message: 'External jobs must be applied at source' } }, 400)
  }
  
  // Check duplicate
  const existing = await c.env.DB.prepare('SELECT * FROM applications WHERE candidate_id = ? AND job_id = ?')
    .bind(user.id, jobId).first()
  if (existing) {
    return c.json({ data: existing }) // idempotent return
  }
  
  const appId = nanoid()
  const now = Math.floor(Date.now()/1000)
  
  // Get profile for snapshot
  const profile = await c.env.DB.prepare('SELECT * FROM profiles WHERE user_id = ?').bind(user.id).first()
  
  // Atomic-ish operations
  await c.env.DB.prepare(
    'INSERT INTO applications (id, candidate_id, job_id, stage, version, submitted_at, updated_at) VALUES (?,?,?,?,?,?,?)'
  ).bind(appId, user.id, jobId, 'submitted', 1, now, now).run()
  
  await c.env.DB.prepare(
    'INSERT INTO application_snapshots (id, application_id, profile_json, job_json, cv_media_id, schema_version, created_at) VALUES (?,?,?,?,?,?,?)'
  ).bind(nanoid(), appId, JSON.stringify(profile || {}), JSON.stringify(job), body.cv_media_id || null, 'v1', now).run()
  
  await c.env.DB.prepare(
    'INSERT INTO application_events (id, application_id, actor_id, actor_type, event_type, old_stage, new_stage, candidate_visible, metadata_json, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).bind(nanoid(), appId, user.id, 'candidate', 'application.submitted', null, 'submitted', 1, JSON.stringify({}), now).run()
  
  await c.env.DB.prepare(
    'INSERT INTO outbox (id, event_id, event_type, payload_json, state, created_at) VALUES (?,?,?,?,?,?)'
  ).bind(nanoid(), nanoid(), 'application.submitted', JSON.stringify({ application_id: appId, job_id: jobId }), 'pending', now).run()
  
  return c.json({ data: { id: appId, stage: 'submitted' } }, 201)
})

app.get('/:id', async (c) => {
  const user = c.get('user')!
  const appId = c.req.param('id')
  const application = await c.env.DB.prepare(
    `SELECT a.*, j.title, j.organization_id, o.name as org_name FROM applications a 
     JOIN jobs j ON j.id = a.job_id LEFT JOIN organizations o ON o.id = j.organization_id WHERE a.id = ?`
  ).bind(appId).first<any>()
  if (!application) return c.json({ error: { code: 'NOT_FOUND', message: 'Application not found' } }, 404)
  
  // Check access: candidate or org member
  if (application.candidate_id !== user.id) {
    if (application.organization_id) {
      const membership = await c.env.DB.prepare('SELECT * FROM memberships WHERE organization_id = ? AND user_id = ?')
        .bind(application.organization_id, user.id).first()
      if (!membership) return c.json({ error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403)
    } else {
      return c.json({ error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403)
    }
  }
  
  const snapshot = await c.env.DB.prepare('SELECT * FROM application_snapshots WHERE application_id = ?').bind(appId).first()
  const events = await c.env.DB.prepare('SELECT * FROM application_events WHERE application_id = ? ORDER BY created_at ASC').bind(appId).all()
  const notes = application.candidate_id === user.id ? { results: [] } : await c.env.DB.prepare('SELECT * FROM employer_notes WHERE application_id = ?').bind(appId).all()
  const offers = await c.env.DB.prepare('SELECT * FROM offers WHERE application_id = ? ORDER BY version DESC').bind(appId).all()
  
  return c.json({ data: { ...application, snapshot, events: events.results, notes: notes.results, offers: offers.results } })
})

app.post('/:id/transitions', async (c) => {
  const user = c.get('user')!
  const appId = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  
  const application = await c.env.DB.prepare(
    `SELECT a.*, j.organization_id FROM applications a JOIN jobs j ON j.id = a.job_id WHERE a.id = ?`
  ).bind(appId).first<any>()
  if (!application) return c.json({ error: { code: 'NOT_FOUND', message: 'Application not found' } }, 404)
  
  const membership = await c.env.DB.prepare('SELECT * FROM memberships WHERE organization_id = ? AND user_id = ?')
    .bind(application.organization_id, user.id).first()
  if (!membership) return c.json({ error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403)
  
  const allowedTransitions = ['in_review', 'shortlisted', 'interview', 'rejected', 'closed']
  if (!allowedTransitions.includes(body.to)) {
    return c.json({ error: { code: 'INVALID', message: 'Invalid transition' } }, 400)
  }
  if (body.to === 'rejected' && !body.confirmed) {
    return c.json({ error: { code: 'CONFIRMATION_REQUIRED', message: 'Rejection requires confirmation' } }, 400)
  }
  
  const oldStage = application.stage
  const now = Math.floor(Date.now()/1000)
  if (body.expected_version && body.expected_version !== application.version) {
    return c.json({ error: { code: 'CONFLICT', message: 'Stale version, refresh and retry' } }, 409)
  }
  
  await c.env.DB.prepare('UPDATE applications SET stage = ?, version = version + 1, updated_at = ? WHERE id = ?')
    .bind(body.to, now, appId).run()
  
  await c.env.DB.prepare(
    'INSERT INTO application_events (id, application_id, actor_id, actor_type, event_type, old_stage, new_stage, candidate_visible, metadata_json, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).bind(nanoid(), appId, user.id, 'employer', 'application.stage_changed', oldStage, body.to, body.to === 'rejected' ? 0 : 1, JSON.stringify({ reason: body.reason || null }), now).run()
  
  return c.json({ data: { stage: body.to, version: application.version + 1 } })
})

app.post('/:id/offers', async (c) => {
  const user = c.get('user')!
  const appId = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  
  const application = await c.env.DB.prepare(
    `SELECT a.*, j.organization_id FROM applications a JOIN jobs j ON j.id = a.job_id WHERE a.id = ?`
  ).bind(appId).first<any>()
  if (!application) return c.json({ error: { code: 'NOT_FOUND', message: 'Application not found' } }, 404)
  
  const membership = await c.env.DB.prepare('SELECT * FROM memberships WHERE organization_id = ? AND user_id = ?')
    .bind(application.organization_id, user.id).first()
  if (!membership) return c.json({ error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403)
  
  const offerId = nanoid()
  const now = Math.floor(Date.now()/1000)
  await c.env.DB.prepare(
    'INSERT INTO offers (id, application_id, version, terms_json, issued_at, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)'
  ).bind(offerId, appId, 1, JSON.stringify(body.terms || {}), now, 'issued', now, now).run()
  
  await c.env.DB.prepare(
    'INSERT INTO application_events (id, application_id, actor_id, actor_type, event_type, old_stage, new_stage, candidate_visible, metadata_json, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).bind(nanoid(), appId, user.id, 'employer', 'offer.issued', application.stage, application.stage, 1, JSON.stringify({ offer_id: offerId }), now).run()
  
  return c.json({ data: { id: offerId, status: 'issued' } }, 201)
})

export default app
