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
  
  // Atomic-ish operations. The unique(candidate_id, job_id) constraint is the
  // final guard against two concurrent submissions creating duplicates.
  try {
    await c.env.DB.prepare(
      'INSERT INTO applications (id, candidate_id, job_id, stage, version, submitted_at, updated_at) VALUES (?,?,?,?,?,?,?)'
    ).bind(appId, user.id, jobId, 'submitted', 1, now, now).run()
  } catch {
    const raced = await c.env.DB.prepare('SELECT * FROM applications WHERE candidate_id = ? AND job_id = ?')
      .bind(user.id, jobId).first()
    if (raced) return c.json({ data: raced })
    throw new Error('Could not create application')
  }
  
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
  
  const isCandidate = application.candidate_id === user.id
  const snapshot = await c.env.DB.prepare('SELECT * FROM application_snapshots WHERE application_id = ?').bind(appId).first()
  const events = isCandidate
    ? await c.env.DB.prepare(
        'SELECT * FROM application_events WHERE application_id = ? AND candidate_visible = 1 ORDER BY created_at ASC'
      ).bind(appId).all()
    : await c.env.DB.prepare('SELECT * FROM application_events WHERE application_id = ? ORDER BY created_at ASC').bind(appId).all()
  const notes = isCandidate ? { results: [] } : await c.env.DB.prepare('SELECT * FROM employer_notes WHERE application_id = ? ORDER BY created_at DESC').bind(appId).all()
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

  // Tell the candidate about the new stage. Deduplicated by event key.
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO notifications (id, user_id, event_key, type, payload_json, created_at)
     VALUES (?,?,?,?,?,?)`
  ).bind(
    nanoid(),
    application.candidate_id,
    `application-stage:${appId}:${application.version + 1}`,
    'application.stage_changed',
    JSON.stringify({ application_id: appId, job_id: application.job_id, stage: body.to, previous_stage: oldStage }),
    now
  ).run()

  await c.env.DB.prepare(
    "INSERT INTO outbox (id, event_id, event_type, payload_json, state, created_at) VALUES (?,?,?,?,'pending',?)"
  ).bind(nanoid(), nanoid(), 'application.stage_changed', JSON.stringify({ application_id: appId, stage: body.to }), now).run()
  
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

  await c.env.DB.prepare(
    'INSERT OR IGNORE INTO notifications (id, user_id, event_key, type, payload_json, created_at) VALUES (?,?,?,?,?,?)'
  ).bind(
    nanoid(),
    application.candidate_id,
    `offer-issued:${offerId}`,
    'offer.issued',
    JSON.stringify({ application_id: appId, offer_id: offerId, job_id: application.job_id }),
    now
  ).run()
  
  return c.json({ data: { id: offerId, status: 'issued' } }, 201)
})

app.post('/:id/notes', async (c) => {
  const user = c.get('user')!
  const appId = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const text = typeof body.body === 'string' ? body.body.trim() : ''
  if (!text) return c.json({ error: { code: 'INVALID', message: 'Note body required' } }, 400)

  const application = await c.env.DB.prepare(
    `SELECT a.*, j.organization_id FROM applications a JOIN jobs j ON j.id = a.job_id WHERE a.id = ?`
  ).bind(appId).first<any>()
  if (!application) return c.json({ error: { code: 'NOT_FOUND', message: 'Application not found' } }, 404)

  const membership = await c.env.DB.prepare('SELECT id, role FROM memberships WHERE organization_id = ? AND user_id = ?')
    .bind(application.organization_id, user.id).first<any>()
  if (!membership || !['owner', 'admin', 'recruiter'].includes(membership.role)) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403)
  }

  const noteId = nanoid()
  const now = Math.floor(Date.now() / 1000)
  await c.env.DB.prepare(
    'INSERT INTO employer_notes (id, application_id, author_membership_id, body, created_at, updated_at) VALUES (?,?,?,?,?,?)'
  ).bind(noteId, appId, membership.id, text, now, now).run()
  return c.json({ data: { id: noteId } }, 201)
})

export const offers = new Hono<AppContext>()

// Offers are issued and responded to separately; accepting is never a hire.
offers.post('/:id/respond', requireAuth, async (c) => {
  const user = c.get('user')!
  const offerId = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const response = body.response
  if (!['accepted', 'declined'].includes(response)) {
    return c.json({ error: { code: 'INVALID', message: 'response must be accepted or declined' } }, 400)
  }

  const offer = await c.env.DB.prepare(
    `SELECT o.*, a.candidate_id, a.id as application_id FROM offers o JOIN applications a ON a.id = o.application_id WHERE o.id = ?`
  ).bind(offerId).first<any>()
  if (!offer) return c.json({ error: { code: 'NOT_FOUND', message: 'Offer not found' } }, 404)
  if (offer.candidate_id !== user.id) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Only the candidate can respond to this offer' } }, 403)
  }
  if (offer.status !== 'issued') {
    return c.json({ error: { code: 'INVALID', message: 'This offer is no longer awaiting a response' } }, 409)
  }

  const now = Math.floor(Date.now() / 1000)
  await c.env.DB.prepare('UPDATE offers SET response = ?, responded_at = ?, status = ?, updated_at = ? WHERE id = ?')
    .bind(response, now, response, now, offerId).run()
  await c.env.DB.prepare(
    'INSERT INTO application_events (id, application_id, actor_id, actor_type, event_type, old_stage, new_stage, candidate_visible, metadata_json, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).bind(nanoid(), offer.application_id, user.id, 'candidate', 'offer.responded', null, null, 1, JSON.stringify({ offer_id: offerId, response }), now).run()

  return c.json({ data: { id: offerId, response, status: response, hired: false } })
})

export default app
