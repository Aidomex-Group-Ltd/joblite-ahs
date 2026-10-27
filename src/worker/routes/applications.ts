import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import type { AppContext } from '../types'
import { requireAuth } from '../middleware/auth'
import { clampInt } from '../lib/validate'

const app = new Hono<AppContext>()
const RECRUITER_ROLES = ['owner', 'admin', 'recruiter']
const ACTIVE_STAGES = ['submitted', 'in_review', 'shortlisted', 'interview', 'offer']
const BACKTRACK_STAGES = ['in_review', 'shortlisted', 'interview']
const TRANSITIONS: Record<string, string[]> = {
  submitted: ['in_review', 'shortlisted', 'interview', 'rejected', 'closed'],
  in_review: ['submitted', 'shortlisted', 'interview', 'rejected', 'closed'],
  shortlisted: ['submitted', 'in_review', 'interview', 'rejected', 'closed'],
  interview: ['submitted', 'in_review', 'shortlisted', 'rejected', 'closed'],
  offer: ['in_review', 'shortlisted', 'interview', 'rejected', 'closed'],
}
type Row = Record<string, any>

app.use('/*', async (c, next) => {
  await next()
  c.header('Cache-Control', 'private, no-store')
})

function fail(c: any, status: 400 | 403 | 404 | 409 | 500, code: string, message: string) {
  return c.json({ error: { code, message } }, status)
}

function safeJson(value: unknown, max = 10000): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const json = JSON.stringify(value)
  return json.length <= max ? json : null
}

async function applicationAccess(env: AppContext['Bindings'], applicationId: string, userId: string) {
  const application = await env.DB.prepare(
    `SELECT a.*, j.organization_id, j.title, j.origin, j.status AS job_status, o.name AS org_name
     FROM applications a JOIN jobs j ON j.id = a.job_id
     LEFT JOIN organizations o ON o.id = j.organization_id WHERE a.id = ?`
  ).bind(applicationId).first<Row>()
  if (!application) return { application: null, isCandidate: false, membership: null as Row | null }
  if (application.candidate_id === userId) return { application, isCandidate: true, membership: null as Row | null }
  if (!application.organization_id) return { application, isCandidate: false, membership: null as Row | null }
  const membership = await env.DB.prepare(
    'SELECT id, role FROM memberships WHERE organization_id = ? AND user_id = ?'
  ).bind(application.organization_id, userId).first<Row>()
  return { application, isCandidate: false, membership: membership || null }
}

function applicationQuestions(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 5) return null
  const questions: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim() || item.trim().length > 240) return null
    const question = item.trim()
    if (questions.includes(question)) return null
    questions.push(question)
  }
  return questions
}

app.use('/*', requireAuth)

app.post('/', async (c) => {
  const user = c.get('user')!
  const body = await c.req.json().catch(() => ({}))
  const jobId = typeof body.job_id === 'string' ? body.job_id : ''
  if (!jobId) return fail(c, 400, 'INVALID', 'job_id required')
  const now = Math.floor(Date.now() / 1000)
  const job = await c.env.DB.prepare(
    "SELECT * FROM jobs WHERE id = ? AND status = 'published' AND (expires_at IS NULL OR expires_at > ?)"
  ).bind(jobId, now).first<Row>()
  if (!job) return fail(c, 404, 'NOT_FOUND', 'Job not accepting applications')
  if (job.origin !== 'native' || job.application_method !== 'native') {
    return fail(c, 400, 'INVALID', 'External jobs must be applied at source')
  }
  const existing = await c.env.DB.prepare(
    'SELECT id, stage, version, submitted_at FROM applications WHERE candidate_id = ? AND job_id = ?'
  ).bind(user.id, jobId).first<Row>()
  if (existing) return c.json({ data: existing })
  let questions: string[]
  try {
    const parsed: unknown = JSON.parse(job.application_questions_json || '[]')
    const valid = applicationQuestions(parsed)
    if (!valid) return fail(c, 500, 'APPLICATION_UNAVAILABLE', 'This application form is unavailable')
    questions = valid
  } catch {
    return fail(c, 500, 'APPLICATION_UNAVAILABLE', 'This application form is unavailable')
  }
  const submittedAnswers = body.answers === undefined ? [] : body.answers
  if (!Array.isArray(submittedAnswers) || submittedAnswers.length !== questions.length) {
    return fail(c, 400, 'ANSWERS_REQUIRED', 'Answer every application question before submitting')
  }
  const answers: Array<{ question: string; answer: string }> = []
  for (const [index, question] of questions.entries()) {
    const value = submittedAnswers[index]
    if (!value || typeof value !== 'object' || value.question !== question ||
        typeof value.answer !== 'string' || !value.answer.trim() || value.answer.trim().length > 4000) {
      return fail(c, 400, 'INVALID_ANSWER', 'Each answer must match its question and be between 1 and 4,000 characters')
    }
    answers.push({ question, answer: value.answer.trim() })
  }
  const profile = await c.env.DB.prepare('SELECT * FROM profiles WHERE user_id = ?').bind(user.id).first<Row>()
  const cvMediaId = typeof body.cv_media_id === 'string' ? body.cv_media_id : profile?.cv_media_id || null
  if (cvMediaId) {
    const cv = await c.env.DB.prepare(
      "SELECT id FROM media WHERE id = ? AND owner_id = ? AND purpose = 'cv' AND state = 'ready'"
    ).bind(cvMediaId, user.id).first()
    if (!cv) return fail(c, 400, 'INVALID_CV', 'The selected CV is not available to this account')
  }

  const id = nanoid()
  const eventId = nanoid()
  const outboxId = nanoid()
  try {
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO applications (id, candidate_id, job_id, stage, version, submitted_at, updated_at)
         SELECT ?, ?, j.id, 'submitted', 1, ?, ? FROM jobs j
         WHERE j.id = ? AND j.status = 'published' AND (j.expires_at IS NULL OR j.expires_at > ?)`
      ).bind(id, user.id, now, now, jobId, now),
      c.env.DB.prepare(
        `INSERT INTO application_snapshots
         (id, application_id, profile_json, job_json, cv_media_id, answers_json, schema_version, created_at)
         SELECT ?, ?, ?, ?, ?, ?, 'v1', ? WHERE EXISTS (SELECT 1 FROM applications WHERE id = ?)`
      ).bind(nanoid(), id, JSON.stringify(profile || {}), JSON.stringify(job), cvMediaId, JSON.stringify(answers), now, id),
      c.env.DB.prepare(
        `INSERT INTO application_events
         (id, application_id, actor_id, actor_type, event_type, old_stage, new_stage, candidate_visible, metadata_json, created_at)
         SELECT ?, ?, ?, 'candidate', 'application.submitted', NULL, 'submitted', 1, '{}', ?
         WHERE EXISTS (SELECT 1 FROM applications WHERE id = ?)`
      ).bind(eventId, id, user.id, now, id),
      c.env.DB.prepare(
        `INSERT INTO outbox (id, event_id, event_type, payload_json, state, created_at)
         SELECT ?, ?, 'application.submitted', ?, 'pending', ? WHERE EXISTS (SELECT 1 FROM application_events WHERE id = ?)`
      ).bind(outboxId, eventId, JSON.stringify({ application_id: id, job_id: jobId }), now, eventId),
    ])
    if ((results[0] as any)?.meta?.changes !== 1) return fail(c, 409, 'JOB_CLOSED', 'This job is no longer accepting applications')
  } catch {
    const raced = await c.env.DB.prepare(
      'SELECT id, stage, version, submitted_at FROM applications WHERE candidate_id = ? AND job_id = ?'
    ).bind(user.id, jobId).first<Row>()
    if (raced) return c.json({ data: raced })
    throw new Error('Could not create application')
  }
  return c.json({ data: { id, stage: 'submitted', version: 1 } }, 201)
})

app.get('/:id', async (c) => {
  const user = c.get('user')!
  const appId = c.req.param('id')
  const access = await applicationAccess(c.env, appId, user.id)
  const application = access.application
  if (!application) return fail(c, 404, 'NOT_FOUND', 'Application not found')
  if (!access.isCandidate && !access.membership) return fail(c, 403, 'FORBIDDEN', 'Not authorized')

  const [snapshot, rawEvents, rawNotes, rawInterviews, rawOffers, rawAssignments, rawScorecards] = await Promise.all([
    c.env.DB.prepare(
      'SELECT id, profile_json, job_json, cv_media_id, answers_json, schema_version, created_at FROM application_snapshots WHERE application_id = ?'
    ).bind(appId).first<Row>(),
    c.env.DB.prepare(
      `SELECT id, event_type, old_stage, new_stage, candidate_visible, metadata_json, created_at
       FROM application_events WHERE application_id = ? ${access.isCandidate ? 'AND candidate_visible = 1' : ''}
       ORDER BY created_at ASC, id ASC`
    ).bind(appId).all<Row>(),
    access.isCandidate
      ? Promise.resolve({ results: [] as Row[] })
      : c.env.DB.prepare(
        'SELECT id, body, created_at FROM employer_notes WHERE application_id = ? ORDER BY created_at DESC'
      ).bind(appId).all<Row>(),
    c.env.DB.prepare(
      `SELECT id, scheduled_at, timezone, status, details, created_at
       FROM interviews WHERE application_id = ? ${access.isCandidate ? "AND status != 'cancelled'" : ''}
       ORDER BY scheduled_at ASC`
    ).bind(appId).all<Row>(),
    c.env.DB.prepare(
      `SELECT id, version, terms_json, status, issued_at, expires_at, response, responded_at, created_at
       FROM offers WHERE application_id = ? ${access.isCandidate ? "AND status IN ('issued','accepted','declined','expired','withdrawn','superseded')" : ''}
       ORDER BY version DESC`
    ).bind(appId).all<Row>(),
    access.isCandidate
      ? Promise.resolve({ results: [] as Row[] })
      : c.env.DB.prepare(
        `SELECT ra.id, ra.membership_id, m.user_id, u.display_name, m.role
         FROM reviewer_assignments ra JOIN memberships m ON m.id = ra.membership_id
         JOIN users u ON u.id = m.user_id WHERE ra.application_id = ?`
      ).bind(appId).all<Row>(),
    access.isCandidate
      ? Promise.resolve({ results: [] as Row[] })
      : c.env.DB.prepare(
        'SELECT sc.id, sc.membership_id, sc.ratings_json, sc.recommendation, sc.summary, sc.created_at, sc.updated_at FROM scorecards sc WHERE sc.application_id = ? ORDER BY sc.updated_at DESC'
      ).bind(appId).all<Row>(),
  ])

  const events = (rawEvents.results as Row[]).map(({ id, event_type, old_stage, new_stage, created_at, metadata_json }) => ({
    id, event_type, old_stage, new_stage, created_at,
    ...(access.isCandidate ? {} : { metadata_json }),
  }))
  return c.json({
    data: {
      id: application.id, candidate_id: application.candidate_id, job_id: application.job_id,
      stage: application.stage, version: application.version, submitted_at: application.submitted_at,
      updated_at: application.updated_at, title: application.title, org_name: application.org_name,
      organization_id: application.organization_id, snapshot, events, interviews: rawInterviews.results,
      notes: rawNotes.results, offers: rawOffers.results, reviewers: rawAssignments.results,
      scorecards: rawScorecards.results,
    },
  })
})

app.post('/:id/transitions', async (c) => {
  const user = c.get('user')!
  const appId = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const access = await applicationAccess(c.env, appId, user.id)
  const application = access.application
  if (!application) return fail(c, 404, 'NOT_FOUND', 'Application not found')
  if (!access.membership || !RECRUITER_ROLES.includes(access.membership.role)) return fail(c, 403, 'FORBIDDEN', 'Not authorized')
  if (!Number.isInteger(body.expected_version)) return fail(c, 400, 'INVALID', 'expected_version is required')
  if (body.expected_version !== application.version) return fail(c, 409, 'CONFLICT', 'Stale version, refresh and retry')
  const target = typeof body.to === 'string' ? body.to : ''
  if (!TRANSITIONS[application.stage]?.includes(target)) {
    return fail(c, 400, 'INVALID_TRANSITION', 'This application cannot move to that stage')
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 1000) : ''
  const activeOrder = ['submitted', ...BACKTRACK_STAGES]
  const movingBackward = (activeOrder.includes(application.stage) && activeOrder.includes(target) &&
    activeOrder.indexOf(target) < activeOrder.indexOf(application.stage)) ||
    (application.stage === 'offer' && BACKTRACK_STAGES.includes(target))
  if ((target === 'rejected' || target === 'closed' || movingBackward) && !reason) {
    return fail(c, 400, 'REASON_REQUIRED', 'Provide a reason for rejection, closure, or moving backward')
  }
  if (target === 'rejected' && body.confirmed !== true) return fail(c, 400, 'CONFIRMATION_REQUIRED', 'Rejection requires confirmation')
  if (target === 'closed' && body.confirmed !== true) return fail(c, 400, 'CONFIRMATION_REQUIRED', 'Closing this application requires confirmation')
  const protectsAcceptedOffer = target === 'rejected' ||
    (application.stage === 'offer' && BACKTRACK_STAGES.includes(target))
  if (protectsAcceptedOffer) {
    const accepted = await c.env.DB.prepare(
      "SELECT id FROM offers WHERE application_id = ? AND status = 'accepted' LIMIT 1"
    ).bind(appId).first()
    if (accepted) {
      const message = target === 'rejected'
        ? 'An accepted offer cannot be rejected; record the hiring outcome explicitly'
        : 'An accepted offer cannot be moved back to an earlier stage; record the hiring outcome explicitly'
      return fail(c, 409, 'ACCEPTED_OFFER', message)
    }
  }

  const now = Math.floor(Date.now() / 1000)
  const change = await applyStageChange(c.env, application, target, user.id, reason, now)
  if (!change.applied) {
    if (protectsAcceptedOffer) {
      const accepted = await c.env.DB.prepare(
        "SELECT id FROM offers WHERE application_id = ? AND status = 'accepted' LIMIT 1"
      ).bind(appId).first()
      if (accepted) {
        const message = target === 'rejected'
          ? 'An accepted offer cannot be rejected; record the hiring outcome explicitly'
          : 'An accepted offer cannot be moved back to an earlier stage; record the hiring outcome explicitly'
        return fail(c, 409, 'ACCEPTED_OFFER', message)
      }
    }
    return fail(c, 409, 'CONFLICT', 'Application changed; refresh and retry')
  }
  return c.json({ data: { stage: target, version: change.version } })
})

/**
 * Applies one employer stage change atomically: conditional application update,
 * candidate-visible event, offer/interview cleanup for terminal stages,
 * idempotent notification, outbox row and audit record.
 *
 * The caller must already have authorized the actor for the organization and
 * validated that the transition is allowed from the current stage.
 */
async function applyStageChange(
  env: AppContext['Bindings'],
  application: Row,
  target: string,
  actorId: string,
  reason: string,
  now: number
): Promise<{ applied: boolean; version: number; eventId: string }> {
  const eventId = nanoid()
  const newVersion = application.version + 1
  const withdrawOffers = target === 'rejected' || target === 'closed' ||
    (application.stage === 'offer' && BACKTRACK_STAGES.includes(target))
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE applications SET stage = ?, version = version + 1, updated_at = ?
       WHERE id = ? AND version = ? AND stage = ?
       AND (? != 'rejected' OR NOT EXISTS (
         SELECT 1 FROM offers WHERE application_id = applications.id AND status = 'accepted'
       ))
       AND (? NOT IN ('in_review', 'shortlisted', 'interview') OR applications.stage != 'offer' OR NOT EXISTS (
         SELECT 1 FROM offers WHERE application_id = applications.id AND status = 'accepted'
       ))`
    ).bind(target, now, application.id, application.version, application.stage, target, target),
    env.DB.prepare(
      `INSERT INTO application_events
       (id, application_id, actor_id, actor_type, event_type, old_stage, new_stage, candidate_visible, metadata_json, created_at)
       SELECT ?, ?, ?, 'employer', 'application.stage_changed', ?, ?, 1, ?, ?
       WHERE changes() = 1`
    ).bind(eventId, application.id, actorId, application.stage, target, JSON.stringify({ reason: reason || null, rule_version: 'ats-v1' }), now),
    env.DB.prepare(
      `UPDATE offers SET status = 'withdrawn', updated_at = ?
       WHERE application_id = ? AND status IN ('draft','issued') AND ? = 1
       AND EXISTS (SELECT 1 FROM application_events WHERE id = ?)`
    ).bind(now, application.id, withdrawOffers ? 1 : 0, eventId),
    env.DB.prepare(
      `UPDATE interviews SET status = 'cancelled', updated_at = ?
       WHERE application_id = ? AND status = 'planned' AND ? IN ('rejected','closed')
       AND EXISTS (SELECT 1 FROM application_events WHERE id = ?)`
    ).bind(now, application.id, target, eventId),
    env.DB.prepare(
      `INSERT OR IGNORE INTO notifications (id, user_id, event_key, type, payload_json, created_at)
       SELECT ?, ?, ?, 'application.stage_changed', ?, ? WHERE EXISTS (SELECT 1 FROM application_events WHERE id = ?)`
    ).bind(nanoid(), application.candidate_id, `application-stage:${application.id}:${newVersion}`, JSON.stringify({ application_id: application.id, job_id: application.job_id, stage: target, previous_stage: application.stage }), now, eventId),
    env.DB.prepare(
      `INSERT INTO outbox (id, event_id, event_type, payload_json, state, created_at)
       SELECT ?, ?, 'application.stage_changed', ?, 'pending', ? WHERE EXISTS (SELECT 1 FROM application_events WHERE id = ?)`
    ).bind(nanoid(), eventId, JSON.stringify({ application_id: application.id, stage: target }), now, eventId),
    env.DB.prepare(
      `INSERT INTO audit_events (id, actor_id, organization_id, action, target_type, target_id, metadata_json, created_at)
       SELECT ?, ?, ?, 'application.stage_changed', 'application', ?, ?, ? WHERE EXISTS (SELECT 1 FROM application_events WHERE id = ?)`
    ).bind(nanoid(), actorId, application.organization_id, application.id, JSON.stringify({ from: application.stage, to: target, version: newVersion, rule_version: 'ats-v1', reason: reason || null }), now, eventId),
  ])
  return { applied: (results[0] as any)?.meta?.changes === 1, version: newVersion, eventId }
}

const BULK_ACTIONS: Record<string, string> = { stage: '', reject: 'rejected', close: 'closed' }
const BULK_LIMIT = 50

app.post('/bulk', async (c) => {
  const user = c.get('user')!
  const body = await c.req.json().catch(() => ({}))
  const organizationId = typeof body.organization_id === 'string' ? body.organization_id : ''
  if (!organizationId) return fail(c, 400, 'INVALID', 'organization_id is required')
  const action = typeof body.action === 'string' ? body.action : ''
  if (!Object.hasOwn(BULK_ACTIONS, action)) return fail(c, 400, 'INVALID', 'action must be stage, reject, or close')
  const membership = await c.env.DB.prepare(
    'SELECT id, role FROM memberships WHERE organization_id = ? AND user_id = ?'
  ).bind(organizationId, user.id).first<Row>()
  if (!membership || !RECRUITER_ROLES.includes(membership.role)) return fail(c, 403, 'FORBIDDEN', 'Not authorized for bulk hiring actions')
  if (!Array.isArray(body.items) || body.items.length === 0) return fail(c, 400, 'INVALID', 'Choose at least one application')
  if (body.items.length > BULK_LIMIT) return fail(c, 400, 'INVALID', `A bulk action is limited to ${BULK_LIMIT} applications`)
  const stageTarget = action === 'stage' ? (typeof body.to === 'string' ? body.to : '') : BULK_ACTIONS[action]
  if (action === 'stage' && !ACTIVE_STAGES.includes(stageTarget) && !['rejected', 'closed'].includes(stageTarget)) {
    return fail(c, 400, 'INVALID', 'Choose a valid target stage')
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 1000) : ''
  if (action === 'stage' && (stageTarget === 'rejected' || stageTarget === 'closed')) {
    return fail(c, 400, 'INVALID', 'Use the reject or close action for terminal stages')
  }
  if ((stageTarget === 'rejected' || stageTarget === 'closed') && body.confirmed !== true) {
    return fail(c, 400, 'CONFIRMATION_REQUIRED', 'Rejecting or closing applications requires explicit confirmation')
  }
  if ((stageTarget === 'rejected' || stageTarget === 'closed') && !reason) {
    return fail(c, 400, 'REASON_REQUIRED', 'Provide a reason for a bulk rejection or closure')
  }

  const now = Math.floor(Date.now() / 1000)
  const seen = new Set<string>()
  const succeeded: Array<{ id: string; stage: string; version: number }> = []
  const failed: Array<{ id: string; code: string; message: string }> = []
  for (const raw of body.items as unknown[]) {
    const item = (raw && typeof raw === 'object' ? raw : {}) as Row
    const id = typeof item.id === 'string' ? item.id : ''
    if (!id) {
      failed.push({ id: '', code: 'INVALID', message: 'Each item needs an application id' })
      continue
    }
    if (seen.has(id)) {
      failed.push({ id, code: 'DUPLICATE_ITEM', message: 'This application appears more than once in the request' })
      continue
    }
    seen.add(id)
    const access = await applicationAccess(c.env, id, user.id)
    if (!access.application) {
      failed.push({ id, code: 'NOT_FOUND', message: 'Application not found' })
      continue
    }
    if (!access.membership || access.application.organization_id !== organizationId || !RECRUITER_ROLES.includes(access.membership.role)) {
      failed.push({ id, code: 'FORBIDDEN', message: 'Not authorized for this application' })
      continue
    }
    const application = access.application
    if (!Number.isInteger(item.expected_version) || item.expected_version !== application.version) {
      failed.push({ id, code: 'CONFLICT', message: 'Application changed since it was loaded' })
      continue
    }
    if (!TRANSITIONS[application.stage]?.includes(stageTarget)) {
      failed.push({ id, code: 'INVALID_TRANSITION', message: `${application.stage} cannot move to ${stageTarget}` })
      continue
    }
    if (stageTarget === 'rejected') {
      const accepted = await c.env.DB.prepare(
        "SELECT id FROM offers WHERE application_id = ? AND status = 'accepted' LIMIT 1"
      ).bind(id).first()
      if (accepted) {
        failed.push({ id, code: 'ACCEPTED_OFFER', message: 'An accepted offer cannot be rejected' })
        continue
      }
    }
    const change = await applyStageChange(c.env, application, stageTarget, user.id, reason, now)
    if (!change.applied) {
      failed.push({ id, code: 'CONFLICT', message: 'Application changed while the bulk action ran' })
      continue
    }
    succeeded.push({ id, stage: stageTarget, version: change.version })
  }

  await c.env.DB.prepare(
    `INSERT INTO audit_events (id, actor_id, organization_id, action, target_type, target_id, metadata_json, created_at)
     VALUES (?, ?, ?, 'applications.bulk_action', 'organization', ?, ?, ?)`
  ).bind(nanoid(), user.id, organizationId, organizationId, JSON.stringify({
    action, to: stageTarget, requested: body.items.length,
    succeeded: succeeded.map((item) => item.id), failed: failed.map((item) => ({ id: item.id, code: item.code })),
  }), now).run()

  return c.json({
    data: {
      action, to: stageTarget, requested: body.items.length,
      succeeded, failed,
      succeeded_count: succeeded.length, failed_count: failed.length,
    },
  })
})

app.post('/:id/withdraw', async (c) => {
  const user = c.get('user')!
  const appId = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const access = await applicationAccess(c.env, appId, user.id)
  const application = access.application
  if (!application) return fail(c, 404, 'NOT_FOUND', 'Application not found')
  if (!access.isCandidate) return fail(c, 403, 'FORBIDDEN', 'Only the candidate can withdraw this application')
  if (!ACTIVE_STAGES.includes(application.stage)) return fail(c, 409, 'TERMINAL', 'This application is no longer active')
  if (body.confirmed !== true) return fail(c, 400, 'CONFIRMATION_REQUIRED', 'Confirm that you want to withdraw this application')
  if (!Number.isInteger(body.expected_version)) return fail(c, 400, 'INVALID', 'expected_version is required')
  if (body.expected_version !== application.version) return fail(c, 409, 'CONFLICT', 'Stale version, refresh and retry')
  const now = Math.floor(Date.now() / 1000)
  const eventId = nanoid()
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE applications SET stage = 'withdrawn', version = version + 1, updated_at = ? WHERE id = ? AND candidate_id = ? AND version = ? AND stage IN ('submitted','in_review','shortlisted','interview','offer')"
    ).bind(now, appId, user.id, application.version),
    c.env.DB.prepare(
      `UPDATE offers SET status = 'withdrawn', updated_at = ?
       WHERE application_id = ? AND status IN ('draft','issued') AND EXISTS (SELECT 1 FROM applications WHERE id = ? AND stage = 'withdrawn' AND version = ?)`
    ).bind(now, appId, appId, application.version + 1),
    c.env.DB.prepare(
      `UPDATE interviews SET status = 'cancelled', updated_at = ?
       WHERE application_id = ? AND status = 'planned' AND EXISTS (SELECT 1 FROM applications WHERE id = ? AND stage = 'withdrawn' AND version = ?)`
    ).bind(now, appId, appId, application.version + 1),
    c.env.DB.prepare(
      `INSERT INTO application_events
       (id, application_id, actor_id, actor_type, event_type, old_stage, new_stage, candidate_visible, metadata_json, created_at)
       SELECT ?, ?, ?, 'candidate', 'application.withdrawn', ?, 'withdrawn', 1, '{}', ? WHERE EXISTS (SELECT 1 FROM applications WHERE id = ? AND stage = 'withdrawn' AND version = ?)`
    ).bind(eventId, appId, user.id, application.stage, now, appId, application.version + 1),
    c.env.DB.prepare(
      `INSERT INTO outbox (id, event_id, event_type, payload_json, state, created_at)
       SELECT ?, ?, 'application.withdrawn', ?, 'pending', ? WHERE EXISTS (SELECT 1 FROM application_events WHERE id = ?)`
    ).bind(nanoid(), eventId, JSON.stringify({ application_id: appId }), now, eventId),
    c.env.DB.prepare(
      `INSERT INTO audit_events (id, actor_id, organization_id, action, target_type, target_id, metadata_json, created_at)
       SELECT ?, ?, ?, 'application.withdrawn', 'application', ?, ?, ? WHERE EXISTS (SELECT 1 FROM application_events WHERE id = ?)`
    ).bind(nanoid(), user.id, application.organization_id, appId, JSON.stringify({ from: application.stage, to: 'withdrawn', version: application.version + 1 }), now, eventId),
  ])
  if ((results[0] as any)?.meta?.changes !== 1) return fail(c, 409, 'CONFLICT', 'Application changed; refresh and retry')
  return c.json({ data: { stage: 'withdrawn', version: application.version + 1 } })
})

app.post('/:id/hire', async (c) => {
  const user = c.get('user')!
  const appId = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const access = await applicationAccess(c.env, appId, user.id)
  const application = access.application
  if (!application) return fail(c, 404, 'NOT_FOUND', 'Application not found')
  if (!access.membership || !RECRUITER_ROLES.includes(access.membership.role)) return fail(c, 403, 'FORBIDDEN', 'Not authorized')
  if (body.confirmed !== true) return fail(c, 400, 'CONFIRMATION_REQUIRED', 'Explicit confirmation is required to mark a candidate hired')
  if (!Number.isInteger(body.expected_version)) return fail(c, 400, 'INVALID', 'expected_version is required')
  if (body.expected_version !== application.version) return fail(c, 409, 'CONFLICT', 'Stale version, refresh and retry')
  if (!ACTIVE_STAGES.includes(application.stage)) return fail(c, 409, 'TERMINAL', 'This application is no longer active')
  const accepted = await c.env.DB.prepare(
    "SELECT id FROM offers WHERE application_id = ? AND status = 'accepted' ORDER BY version DESC LIMIT 1"
  ).bind(appId).first()
  if (!accepted) return fail(c, 409, 'OFFER_REQUIRED', 'An accepted offer is required before hiring')

  const now = Math.floor(Date.now() / 1000)
  const eventId = nanoid()
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      'UPDATE applications SET stage = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ? AND stage = ?'
    ).bind('hired', now, appId, application.version, application.stage),
    c.env.DB.prepare(
      `INSERT INTO application_events
       (id, application_id, actor_id, actor_type, event_type, old_stage, new_stage, candidate_visible, metadata_json, created_at)
       SELECT ?, ?, ?, 'employer', 'application.hired', ?, 'hired', 1, ?, ? WHERE changes() = 1`
    ).bind(eventId, appId, user.id, application.stage, JSON.stringify({ accepted_offer_id: accepted.id, rule_version: 'ats-v1' }), now),
    c.env.DB.prepare(
      `INSERT INTO notifications (id, user_id, event_key, type, payload_json, created_at)
       SELECT ?, ?, ?, 'application.hired', ?, ? WHERE EXISTS (SELECT 1 FROM application_events WHERE id = ?)`
    ).bind(nanoid(), application.candidate_id, `application-hired:${appId}`, JSON.stringify({ application_id: appId, job_id: application.job_id }), now, eventId),
    c.env.DB.prepare(
      `INSERT INTO audit_events (id, actor_id, organization_id, action, target_type, target_id, metadata_json, created_at)
       SELECT ?, ?, ?, 'application.hired', 'application', ?, ?, ? WHERE EXISTS (SELECT 1 FROM application_events WHERE id = ?)`
    ).bind(nanoid(), user.id, application.organization_id, appId, JSON.stringify({ accepted_offer_id: accepted.id, version: application.version + 1 }), now, eventId),
  ])
  if ((results[0] as any)?.meta?.changes !== 1) return fail(c, 409, 'CONFLICT', 'Application changed; refresh and retry')
  return c.json({ data: { stage: 'hired', version: application.version + 1 } })
})

app.post('/:id/notes', async (c) => {
  const user = c.get('user')!
  const appId = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const text = typeof body.body === 'string' ? body.body.trim() : ''
  if (!text || text.length > 5000) return fail(c, 400, 'INVALID', 'Note body must be between 1 and 5000 characters')
  const access = await applicationAccess(c.env, appId, user.id)
  if (!access.application) return fail(c, 404, 'NOT_FOUND', 'Application not found')
  if (!access.membership || !RECRUITER_ROLES.includes(access.membership.role)) return fail(c, 403, 'FORBIDDEN', 'Not authorized')
  const now = Math.floor(Date.now() / 1000)
  const id = nanoid()
  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO employer_notes (id, application_id, author_membership_id, body, created_at, updated_at) VALUES (?,?,?,?,?,?)'
    ).bind(id, appId, access.membership.id, text, now, now),
    c.env.DB.prepare(
      `INSERT INTO audit_events (id, actor_id, organization_id, action, target_type, target_id, metadata_json, created_at)
       SELECT ?, ?, ?, 'application.note_added', 'application', ?, ?, ? WHERE EXISTS (SELECT 1 FROM employer_notes WHERE id = ?)`
    ).bind(nanoid(), user.id, access.application.organization_id, appId, JSON.stringify({ note_id: id }), now, id),
  ])
  return c.json({ data: { id } }, 201)
})

app.post('/:id/interviews', async (c) => {
  const user = c.get('user')!
  const appId = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const scheduledAt = Number(body.scheduled_at)
  const timezone = typeof body.timezone === 'string' ? body.timezone.trim() : ''
  const details = typeof body.details === 'string' ? body.details.trim().slice(0, 2000) : ''
  if (!Number.isInteger(scheduledAt) || scheduledAt <= Math.floor(Date.now() / 1000)) return fail(c, 400, 'INVALID', 'Choose a future interview time')
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }) } catch { return fail(c, 400, 'INVALID_TIMEZONE', 'Choose a valid IANA time zone') }
  const access = await applicationAccess(c.env, appId, user.id)
  if (!access.application) return fail(c, 404, 'NOT_FOUND', 'Application not found')
  if (!access.membership || !RECRUITER_ROLES.includes(access.membership.role)) return fail(c, 403, 'FORBIDDEN', 'Not authorized')
  if (!ACTIVE_STAGES.includes(access.application.stage) || access.application.stage === 'offer') return fail(c, 409, 'TERMINAL', 'Interviews can only be scheduled during active review')
  const now = Math.floor(Date.now() / 1000)
  const id = nanoid()
  const eventId = nanoid()
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO interviews (id, application_id, scheduled_at, timezone, status, details, created_at, updated_at)
       SELECT ?, ?, ?, ?, 'planned', ?, ?, ? FROM applications
       WHERE id = ? AND stage IN ('submitted','in_review','shortlisted','interview')`
    ).bind(id, appId, scheduledAt, timezone, details || null, now, now, appId),
    c.env.DB.prepare(
      `INSERT INTO application_events
       (id, application_id, actor_id, actor_type, event_type, candidate_visible, metadata_json, created_at)
       SELECT ?, ?, ?, 'employer', 'interview.scheduled', 1, ?, ?
       WHERE EXISTS (SELECT 1 FROM interviews WHERE id = ?)`
    ).bind(eventId, appId, user.id, JSON.stringify({ interview_id: id }), now, id),
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO notifications (id, user_id, event_key, type, payload_json, created_at)
       SELECT ?, ?, ?, 'interview.scheduled', ?, ? WHERE EXISTS (SELECT 1 FROM interviews WHERE id = ?)`
    ).bind(nanoid(), access.application.candidate_id, `interview-scheduled:${id}`, JSON.stringify({ application_id: appId, interview_id: id }), now, id),
    c.env.DB.prepare(
      `INSERT INTO outbox (id, event_id, event_type, payload_json, state, created_at)
       SELECT ?, ?, 'interview.scheduled', ?, 'pending', ? WHERE EXISTS (SELECT 1 FROM interviews WHERE id = ?)`
    ).bind(nanoid(), eventId, JSON.stringify({ application_id: appId, interview_id: id }), now, id),
    c.env.DB.prepare(
      `INSERT INTO audit_events (id, actor_id, organization_id, action, target_type, target_id, metadata_json, created_at)
       SELECT ?, ?, ?, 'interview.scheduled', 'interview', ?, ?, ? WHERE EXISTS (SELECT 1 FROM interviews WHERE id = ?)`
    ).bind(nanoid(), user.id, access.application.organization_id, id, JSON.stringify({ application_id: appId, scheduled_at: scheduledAt, timezone }), now, id),
  ])
  if ((results[0] as any)?.meta?.changes !== 1) return fail(c, 409, 'CONFLICT', 'Application changed; refresh and retry')
  return c.json({ data: { id, scheduled_at: scheduledAt, timezone, status: 'planned' } }, 201)
})

app.post('/:id/interviews/:interviewId/respond', async (c) => {
  const user = c.get('user')!
  const appId = c.req.param('id')
  const interviewId = c.req.param('interviewId')
  const body = await c.req.json().catch(() => ({}))
  const response = body.response
  if (!['accepted', 'declined'].includes(response)) return fail(c, 400, 'INVALID', 'response must be accepted or declined')
  const access = await applicationAccess(c.env, appId, user.id)
  if (!access.application) return fail(c, 404, 'NOT_FOUND', 'Application not found')
  if (!access.isCandidate) return fail(c, 403, 'FORBIDDEN', 'Only the candidate can respond to this interview')
  const interview = await c.env.DB.prepare(
    'SELECT id, status, scheduled_at FROM interviews WHERE id = ? AND application_id = ?'
  ).bind(interviewId, appId).first<Row>()
  if (!interview) return fail(c, 404, 'NOT_FOUND', 'Interview not found')
  if (interview.status !== 'planned') return fail(c, 409, 'CONFLICT', 'This interview is no longer awaiting a response')
  if (interview.scheduled_at && interview.scheduled_at <= Math.floor(Date.now() / 1000)) {
    return fail(c, 409, 'CONFLICT', 'This interview time has already passed')
  }
  const now = Math.floor(Date.now() / 1000)
  const eventId = nanoid()
  const status = response === 'accepted' ? 'confirmed' : 'declined'
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE interviews SET status = ?, updated_at = ? WHERE id = ? AND application_id = ? AND status = 'planned'"
    ).bind(status, now, interviewId, appId),
    c.env.DB.prepare(
      `INSERT INTO application_events
       (id, application_id, actor_id, actor_type, event_type, candidate_visible, metadata_json, created_at)
       SELECT ?, ?, ?, 'candidate', 'interview.responded', 1, ?, ? WHERE changes() = 1`
    ).bind(eventId, appId, user.id, JSON.stringify({ interview_id: interviewId, response }), now),
    c.env.DB.prepare(
      `INSERT INTO audit_events (id, actor_id, organization_id, action, target_type, target_id, metadata_json, created_at)
       SELECT ?, ?, ?, 'interview.responded', 'interview', ?, ?, ? WHERE EXISTS (SELECT 1 FROM application_events WHERE id = ?)`
    ).bind(nanoid(), user.id, access.application.organization_id, interviewId, JSON.stringify({ application_id: appId, response }), now, eventId),
    c.env.DB.prepare(
      `INSERT INTO outbox (id, event_id, event_type, payload_json, state, created_at)
       SELECT ?, ?, 'interview.responded', ?, 'pending', ? WHERE EXISTS (SELECT 1 FROM application_events WHERE id = ?)`
    ).bind(nanoid(), eventId, JSON.stringify({ application_id: appId, interview_id: interviewId, response }), now, eventId),
  ])
  if ((results[0] as any)?.meta?.changes !== 1) return fail(c, 409, 'CONFLICT', 'Interview changed; refresh and retry')
  return c.json({ data: { id: interviewId, status, response } })
})

app.post('/interviews/:interviewId/cancel', async (c) => {
  const user = c.get('user')!
  const interviewId = c.req.param('interviewId')
  const row = await c.env.DB.prepare(
    `SELECT i.*, j.organization_id, a.candidate_id FROM interviews i
     JOIN applications a ON a.id = i.application_id JOIN jobs j ON j.id = a.job_id WHERE i.id = ?`
  ).bind(interviewId).first<Row>()
  if (!row) return fail(c, 404, 'NOT_FOUND', 'Interview not found')
  const access = await applicationAccess(c.env, row.application_id, user.id)
  if (!access.membership || !RECRUITER_ROLES.includes(access.membership.role)) return fail(c, 403, 'FORBIDDEN', 'Not authorized')
  if (row.status !== 'planned') return fail(c, 409, 'CONFLICT', 'Only planned interviews can be cancelled')
  const now = Math.floor(Date.now() / 1000)
  const eventId = nanoid()
  const results = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE interviews SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'planned'").bind(now, interviewId),
    c.env.DB.prepare(
      `INSERT INTO application_events
       (id, application_id, actor_id, actor_type, event_type, candidate_visible, metadata_json, created_at)
       SELECT ?, ?, ?, 'employer', 'interview.cancelled', 1, ?, ? WHERE changes() = 1`
    ).bind(eventId, row.application_id, user.id, JSON.stringify({ interview_id: interviewId }), now),
    c.env.DB.prepare(
      `INSERT INTO audit_events (id, actor_id, organization_id, action, target_type, target_id, metadata_json, created_at)
       SELECT ?, ?, ?, 'interview.cancelled', 'interview', ?, ?, ? WHERE EXISTS (SELECT 1 FROM application_events WHERE id = ?)`
    ).bind(nanoid(), user.id, row.organization_id, interviewId, JSON.stringify({ application_id: row.application_id }), now, eventId),
    c.env.DB.prepare(
      `INSERT INTO outbox (id, event_id, event_type, payload_json, state, created_at)
       SELECT ?, ?, 'interview.cancelled', ?, 'pending', ? WHERE EXISTS (SELECT 1 FROM application_events WHERE id = ?)`
    ).bind(nanoid(), eventId, JSON.stringify({ application_id: row.application_id, interview_id: interviewId }), now, eventId),
  ])
  if ((results[0] as any)?.meta?.changes !== 1) return fail(c, 409, 'CONFLICT', 'Interview changed; refresh and retry')
  return c.json({ data: { id: interviewId, status: 'cancelled' } })
})

app.get('/:id/interviews/:interviewId/calendar.ics', async (c) => {
  const user = c.get('user')!
  const access = await applicationAccess(c.env, c.req.param('id'), user.id)
  if (!access.application) return fail(c, 404, 'NOT_FOUND', 'Application not found')
  if (!access.isCandidate && !access.membership) return fail(c, 403, 'FORBIDDEN', 'Not authorized')
  const row = await c.env.DB.prepare(
    `SELECT i.id, i.scheduled_at, i.timezone, i.status, i.details, j.title
     FROM interviews i JOIN applications a ON a.id = i.application_id JOIN jobs j ON j.id = a.job_id
     WHERE i.id = ? AND i.application_id = ?`
  ).bind(c.req.param('interviewId'), c.req.param('id')).first<Row>()
  if (!row || row.status !== 'planned') return fail(c, 404, 'NOT_FOUND', 'Calendar event not found')
  const date = new Date(row.scheduled_at * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const escapeIcs = (value: string) => value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/[,;]/g, '\\$&')
  const content = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Joblite//ATS Interview//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:${row.id}@joblite.online`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
    `DTSTART:${date}`, 'DURATION:PT30M', `SUMMARY:${escapeIcs(`Interview: ${row.title}`)}`,
    `DESCRIPTION:${escapeIcs(row.details || '')}`, `X-WR-TIMEZONE:${escapeIcs(row.timezone || 'UTC')}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n')
  return new Response(content, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="joblite-interview.ics"', 'Cache-Control': 'private, no-store' } })
})

app.post('/:id/offers', async (c) => {
  const user = c.get('user')!
  const appId = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const terms = safeJson(body.terms)
  if (!terms) return fail(c, 400, 'INVALID', 'Offer terms must be an object under 10 KB')
  const access = await applicationAccess(c.env, appId, user.id)
  if (!access.application) return fail(c, 404, 'NOT_FOUND', 'Application not found')
  if (!access.membership || !RECRUITER_ROLES.includes(access.membership.role)) return fail(c, 403, 'FORBIDDEN', 'Not authorized')
  if (!ACTIVE_STAGES.includes(access.application.stage) || ['rejected', 'closed', 'withdrawn', 'hired'].includes(access.application.stage)) {
    return fail(c, 409, 'TERMINAL', 'An offer cannot be drafted for a terminal application')
  }
  const now = Math.floor(Date.now() / 1000)
  const id = nanoid()
  const eventId = nanoid()
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO offers (id, application_id, version, terms_json, status, created_at, updated_at)
         SELECT ?, ?, COALESCE(MAX(version), 0) + 1, ?, 'draft', ?, ? FROM offers WHERE application_id = ?`
      ).bind(id, appId, terms, now, now, appId),
      c.env.DB.prepare(
        `INSERT INTO application_events
         (id, application_id, actor_id, actor_type, event_type, candidate_visible, metadata_json, created_at)
         SELECT ?, ?, ?, 'employer', 'offer.drafted', 0, ?, ? WHERE EXISTS (SELECT 1 FROM offers WHERE id = ?)`
      ).bind(eventId, appId, user.id, JSON.stringify({ offer_id: id }), now, id),
      c.env.DB.prepare(
        `INSERT INTO audit_events (id, actor_id, organization_id, action, target_type, target_id, metadata_json, created_at)
         SELECT ?, ?, ?, 'offer.drafted', 'offer', ?, ?, ? WHERE EXISTS (SELECT 1 FROM offers WHERE id = ?)`
      ).bind(nanoid(), user.id, access.application.organization_id, id, JSON.stringify({ application_id: appId }), now, id),
    ])
  } catch (error) {
    const raced = await c.env.DB.prepare('SELECT id FROM offers WHERE id = ?').bind(id).first()
    if (!raced) return fail(c, 409, 'CONFLICT', 'Could not create offer draft; refresh and retry')
    throw error
  }
  const created = await c.env.DB.prepare('SELECT version FROM offers WHERE id = ?').bind(id).first<Row>()
  return c.json({ data: { id, version: created?.version, status: 'draft' } }, 201)
})

app.patch('/offers/:offerId', async (c) => {
  const user = c.get('user')!
  const offerId = c.req.param('offerId')
  const body = await c.req.json().catch(() => ({}))
  const terms = safeJson(body.terms)
  if (!terms) return fail(c, 400, 'INVALID', 'Offer terms must be an object under 10 KB')
  const offer = await c.env.DB.prepare(
    `SELECT o.*, j.organization_id FROM offers o
     JOIN applications a ON a.id = o.application_id JOIN jobs j ON j.id = a.job_id WHERE o.id = ?`
  ).bind(offerId).first<Row>()
  if (!offer) return fail(c, 404, 'NOT_FOUND', 'Offer not found')
  const membership = await c.env.DB.prepare(
    'SELECT id, role FROM memberships WHERE organization_id = ? AND user_id = ?'
  ).bind(offer.organization_id, user.id).first<Row>()
  if (!membership || !RECRUITER_ROLES.includes(membership.role)) return fail(c, 403, 'FORBIDDEN', 'Not authorized')
  if (offer.status !== 'draft') return fail(c, 409, 'CONFLICT', 'Only draft offers can be edited')
  await c.env.DB.prepare("UPDATE offers SET terms_json = ?, updated_at = ? WHERE id = ? AND status = 'draft'")
    .bind(terms, Math.floor(Date.now() / 1000), offerId).run()
  return c.json({ data: { id: offerId, status: 'draft' } })
})

app.post('/offers/:offerId/issue', async (c) => {
  const user = c.get('user')!
  const offerId = c.req.param('offerId')
  const body = await c.req.json().catch(() => ({}))
  const offer = await c.env.DB.prepare(
    `SELECT o.*, a.id AS app_id, a.candidate_id, a.stage, a.version AS app_version, j.organization_id
     FROM offers o JOIN applications a ON a.id = o.application_id JOIN jobs j ON j.id = a.job_id WHERE o.id = ?`
  ).bind(offerId).first<Row>()
  if (!offer) return fail(c, 404, 'NOT_FOUND', 'Offer not found')
  const membership = await c.env.DB.prepare(
    'SELECT id, role FROM memberships WHERE organization_id = ? AND user_id = ?'
  ).bind(offer.organization_id, user.id).first<Row>()
  if (!membership || !RECRUITER_ROLES.includes(membership.role)) return fail(c, 403, 'FORBIDDEN', 'Not authorized')
  if (offer.status !== 'draft') return fail(c, 409, 'CONFLICT', 'Only a draft offer can be issued')
  if (!ACTIVE_STAGES.includes(offer.stage)) return fail(c, 409, 'TERMINAL', 'The application is no longer active')
  if (!Number.isInteger(body.expected_version) || body.expected_version !== offer.app_version) return fail(c, 409, 'CONFLICT', 'Application changed; refresh and retry')
  const expiresAt = body.expires_at == null ? null : Number(body.expires_at)
  const now = Math.floor(Date.now() / 1000)
  if (expiresAt !== null && (!Number.isInteger(expiresAt) || expiresAt <= now)) return fail(c, 400, 'INVALID', 'Offer expiry must be in the future')
  const eventId = nanoid()
  const newVersion = offer.app_version + 1
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE applications SET stage = 'offer', version = version + 1, updated_at = ? WHERE id = ? AND version = ? AND stage = ?"
    ).bind(now, offer.app_id, offer.app_version, offer.stage),
    c.env.DB.prepare(
      `UPDATE offers SET status = 'superseded', superseded_by = ?, updated_at = ?
       WHERE application_id = ? AND id != ? AND status = 'issued'
       AND EXISTS (SELECT 1 FROM applications WHERE id = ? AND version = ? AND stage = 'offer')
       AND EXISTS (SELECT 1 FROM offers WHERE id = ? AND status = 'draft')`
    ).bind(offerId, now, offer.app_id, offerId, offer.app_id, newVersion, offerId),
    c.env.DB.prepare(
      `UPDATE offers SET status = 'issued', issued_at = ?, expires_at = ?, issued_by = ?, updated_at = ?
       WHERE id = ? AND status = 'draft' AND EXISTS (SELECT 1 FROM applications WHERE id = ? AND version = ? AND stage = 'offer')`
    ).bind(now, expiresAt, user.id, now, offerId, offer.app_id, newVersion),
    c.env.DB.prepare(
      `INSERT INTO application_events
       (id, application_id, actor_id, actor_type, event_type, old_stage, new_stage, candidate_visible, metadata_json, created_at)
       SELECT ?, ?, ?, 'employer', 'offer.issued', NULL, NULL, 1, ?, ? WHERE changes() = 1`
    ).bind(eventId, offer.app_id, user.id, JSON.stringify({ offer_id: offerId, version: offer.version }), now),
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO notifications (id, user_id, event_key, type, payload_json, created_at)
       SELECT ?, ?, ?, 'offer.issued', ?, ? WHERE EXISTS (SELECT 1 FROM application_events WHERE id = ?)`
    ).bind(nanoid(), offer.candidate_id, `offer-issued:${offerId}`, JSON.stringify({ application_id: offer.app_id, offer_id: offerId }), now, eventId),
    c.env.DB.prepare(
      `INSERT INTO outbox (id, event_id, event_type, payload_json, state, created_at)
       SELECT ?, ?, 'offer.issued', ?, 'pending', ? WHERE EXISTS (SELECT 1 FROM application_events WHERE id = ?)`
    ).bind(nanoid(), eventId, JSON.stringify({ application_id: offer.app_id, offer_id: offerId }), now, eventId),
    c.env.DB.prepare(
      `INSERT INTO audit_events (id, actor_id, organization_id, action, target_type, target_id, metadata_json, created_at)
       SELECT ?, ?, ?, 'offer.issued', 'offer', ?, ?, ? WHERE EXISTS (SELECT 1 FROM application_events WHERE id = ?)`
    ).bind(nanoid(), user.id, offer.organization_id, offerId, JSON.stringify({ application_id: offer.app_id, version: offer.version }), now, eventId),
    c.env.DB.prepare(
      `INSERT INTO application_events
       (id, application_id, actor_id, actor_type, event_type, old_stage, new_stage, candidate_visible, metadata_json, created_at)
       SELECT ?, ?, ?, 'employer', 'application.stage_changed', ?, 'offer', 1, ?, ?
       WHERE EXISTS (SELECT 1 FROM application_events WHERE id = ?)`
    ).bind(nanoid(), offer.app_id, user.id, offer.stage, JSON.stringify({ version: newVersion, rule_version: 'ats-v1' }), now, eventId),
  ])
  if ((results[0] as any)?.meta?.changes !== 1 || (results[2] as any)?.meta?.changes !== 1) {
    return fail(c, 409, 'CONFLICT', 'Application or offer changed; refresh and retry')
  }
  return c.json({ data: { id: offerId, status: 'issued', issued_at: now, expires_at: expiresAt, application_version: newVersion } })
})

export const offers = new Hono<AppContext>()
offers.use('/*', async (c, next) => {
  await next()
  c.header('Cache-Control', 'private, no-store')
})
offers.post('/:id/respond', requireAuth, async (c) => {
  const user = c.get('user')!
  const offerId = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const response = body.response
  if (!['accepted', 'declined'].includes(response)) return fail(c, 400, 'INVALID', 'response must be accepted or declined')
  const offer = await c.env.DB.prepare(
    `SELECT o.*, a.candidate_id, j.organization_id FROM offers o
     JOIN applications a ON a.id = o.application_id JOIN jobs j ON j.id = a.job_id WHERE o.id = ?`
  ).bind(offerId).first<Row>()
  if (!offer) return fail(c, 404, 'NOT_FOUND', 'Offer not found')
  if (offer.candidate_id !== user.id) return fail(c, 403, 'FORBIDDEN', 'Only the candidate can respond to this offer')
  if (offer.status !== 'issued') return fail(c, 409, 'CONFLICT', 'This offer is no longer awaiting a response')
  const now = Math.floor(Date.now() / 1000)
  if (offer.expires_at && offer.expires_at <= now) {
    const eventId = nanoid()
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE offers SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'issued'").bind(now, offerId),
      c.env.DB.prepare(
        `INSERT INTO application_events
         (id, application_id, actor_id, actor_type, event_type, candidate_visible, metadata_json, created_at)
         SELECT ?, ?, NULL, 'system', 'offer.expired', 1, ?, ? WHERE changes() = 1`
      ).bind(eventId, offer.application_id, JSON.stringify({ offer_id: offerId }), now),
      c.env.DB.prepare(
        `INSERT INTO audit_events (id, actor_id, organization_id, action, target_type, target_id, metadata_json, created_at)
         SELECT ?, NULL, ?, 'offer.expired', 'offer', ?, ?, ? WHERE EXISTS (SELECT 1 FROM application_events WHERE id = ?)`
      ).bind(nanoid(), offer.organization_id, offerId, JSON.stringify({ application_id: offer.application_id }), now, eventId),
      c.env.DB.prepare(
        `INSERT INTO outbox (id, event_id, event_type, payload_json, state, created_at)
         SELECT ?, ?, 'offer.expired', ?, 'pending', ? WHERE EXISTS (SELECT 1 FROM application_events WHERE id = ?)`
      ).bind(nanoid(), eventId, JSON.stringify({ application_id: offer.application_id, offer_id: offerId }), now, eventId),
    ])
    return fail(c, 409, 'OFFER_EXPIRED', 'This offer has expired')
  }
  const eventId = nanoid()
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE offers SET response = ?, responded_at = ?, status = ?, updated_at = ? WHERE id = ? AND status = 'issued' AND (expires_at IS NULL OR expires_at > ?)"
    ).bind(response, now, response, now, offerId, now),
    c.env.DB.prepare(
      `INSERT INTO application_events
       (id, application_id, actor_id, actor_type, event_type, candidate_visible, metadata_json, created_at)
       SELECT ?, ?, ?, 'candidate', 'offer.responded', 1, ?, ? WHERE changes() = 1`
    ).bind(eventId, offer.application_id, user.id, JSON.stringify({ offer_id: offerId, response }), now),
    c.env.DB.prepare(
      `INSERT INTO audit_events (id, actor_id, organization_id, action, target_type, target_id, metadata_json, created_at)
       SELECT ?, ?, ?, 'offer.responded', 'offer', ?, ?, ? WHERE EXISTS (SELECT 1 FROM application_events WHERE id = ?)`
    ).bind(nanoid(), user.id, offer.organization_id, offerId, JSON.stringify({ response }), now, eventId),
    c.env.DB.prepare(
      `INSERT INTO outbox (id, event_id, event_type, payload_json, state, created_at)
       SELECT ?, ?, 'offer.responded', ?, 'pending', ? WHERE EXISTS (SELECT 1 FROM application_events WHERE id = ?)`
    ).bind(nanoid(), eventId, JSON.stringify({ application_id: offer.application_id, offer_id: offerId, response }), now, eventId),
  ])
  if ((results[0] as any)?.meta?.changes !== 1) return fail(c, 409, 'CONFLICT', 'Offer changed or expired; refresh and retry')
  return c.json({ data: { id: offerId, response, status: response, hired: false } })
})

app.post('/:id/reviewers', async (c) => {
  const user = c.get('user')!
  const appId = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const userId = typeof body.user_id === 'string' ? body.user_id : ''
  const access = await applicationAccess(c.env, appId, user.id)
  if (!access.application) return fail(c, 404, 'NOT_FOUND', 'Application not found')
  if (!access.membership || !RECRUITER_ROLES.includes(access.membership.role)) return fail(c, 403, 'FORBIDDEN', 'Not authorized')
  const reviewer = await c.env.DB.prepare(
    'SELECT id, role FROM memberships WHERE organization_id = ? AND user_id = ?'
  ).bind(access.application.organization_id, userId).first<Row>()
  if (!reviewer || !RECRUITER_ROLES.includes(reviewer.role)) return fail(c, 400, 'INVALID_REVIEWER', 'Reviewer must be a hiring member of this organization')
  const now = Math.floor(Date.now() / 1000)
  const id = nanoid()
  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT OR IGNORE INTO reviewer_assignments (id, application_id, membership_id, assigned_by, created_at) VALUES (?,?,?,?,?)'
    ).bind(id, appId, reviewer.id, user.id, now),
    c.env.DB.prepare(
      `INSERT INTO audit_events (id, actor_id, organization_id, action, target_type, target_id, metadata_json, created_at)
       SELECT ?, ?, ?, 'application.reviewer_assigned', 'application', ?, ?, ? WHERE changes() = 1`
    ).bind(nanoid(), user.id, access.application.organization_id, appId, JSON.stringify({ reviewer_membership_id: reviewer.id }), now),
  ])
  return c.json({ data: { id } }, 201)
})

app.post('/:id/scorecards', async (c) => {
  const user = c.get('user')!
  const appId = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const ratings = safeJson(body.ratings, 4000)
  const allowedRecommendations = ['strong_yes', 'yes', 'mixed', 'no', 'strong_no']
  const ratingValues = body.ratings && typeof body.ratings === 'object' && !Array.isArray(body.ratings)
    ? Object.entries(body.ratings as Record<string, unknown>) : []
  const allowedCriteria = new Set(['role_alignment', 'skills_evidence', 'experience_relevance', 'communication'])
  if (!ratings || !ratingValues.length || ratingValues.some(([key, value]) => !allowedCriteria.has(key) || !Number.isInteger(value) || Number(value) < 1 || Number(value) > 5) ||
      !allowedRecommendations.includes(body.recommendation)) {
    return fail(c, 400, 'INVALID', 'Use only evidence-based rating criteria (1–5) and a valid recommendation')
  }
  const access = await applicationAccess(c.env, appId, user.id)
  if (!access.application) return fail(c, 404, 'NOT_FOUND', 'Application not found')
  if (!access.membership) return fail(c, 403, 'FORBIDDEN', 'Not authorized')
  const assignment = await c.env.DB.prepare(
    'SELECT id FROM reviewer_assignments WHERE application_id = ? AND membership_id = ?'
  ).bind(appId, access.membership.id).first()
  if (!assignment) return fail(c, 403, 'REVIEWER_REQUIRED', 'Only an assigned reviewer can submit a scorecard')
  const now = Math.floor(Date.now() / 1000)
  const prior = await c.env.DB.prepare(
    'SELECT id FROM scorecards WHERE application_id = ? AND membership_id = ?'
  ).bind(appId, access.membership.id).first<Row>()
  const id = prior?.id || nanoid()
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO scorecards (id, application_id, membership_id, ratings_json, recommendation, summary, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(application_id, membership_id) DO UPDATE SET
         ratings_json = excluded.ratings_json, recommendation = excluded.recommendation, summary = excluded.summary, updated_at = excluded.updated_at`
    ).bind(id, appId, access.membership.id, ratings, body.recommendation, typeof body.summary === 'string' ? body.summary.trim().slice(0, 2000) : null, now, now),
    c.env.DB.prepare(
      `INSERT INTO audit_events (id, actor_id, organization_id, action, target_type, target_id, metadata_json, created_at)
       SELECT ?, ?, ?, 'application.scorecard_submitted', 'application', ?, ?, ? WHERE EXISTS (
         SELECT 1 FROM scorecards WHERE application_id = ? AND membership_id = ?
       )`
    ).bind(nanoid(), user.id, access.application.organization_id, appId, JSON.stringify({ reviewer_membership_id: access.membership.id }), now, appId, access.membership.id),
  ])
  return c.json({ data: { id, recommendation: body.recommendation, updated_at: now } })
})

export default app
