import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import applications, { offers } from '../src/worker/routes/applications'
import organizations from '../src/worker/routes/organizations'
import jobs from '../src/worker/routes/jobs'
import media from '../src/worker/routes/media'
import type { Env } from '../src/worker/types'
import { createTestEnv } from './helpers/d1'

const now = Math.floor(Date.now() / 1000)

async function tokenHash(token: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token))
  return Array.from(new Uint8Array(signature)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

describe('ATS workflows', () => {
  let env: Env
  let close: () => void
  let request: (path: string, userId: string, init?: RequestInit) => Promise<Response>
  const users = { candidate: 'ats-candidate', recruiter: 'ats-recruiter', outsider: 'ats-outsider', viewer: 'ats-viewer' }
  const tokens: Record<string, string> = {}

  beforeEach(async () => {
    const test = createTestEnv()
    env = test.env
    close = test.close
    for (const [key, id] of Object.entries(users)) {
      await env.DB.prepare('INSERT INTO users (id, email_normalized, display_name) VALUES (?,?,?)')
        .bind(id, `${key}@ats.test`, key)
        .run()
      const token = `${id}-session`
      tokens[id] = token
      await env.DB.prepare('INSERT INTO sessions (id, token_hash, user_id, expires_at) VALUES (?,?,?,?)')
        .bind(`${id}-session-row`, await tokenHash(token, env.SESSION_SECRET), id, now + 3600)
        .run()
    }
    await env.DB.prepare('INSERT INTO organizations (id, slug, name) VALUES (?,?,?)')
      .bind('ats-org', 'ats-org', 'ATS Organization').run()
    await env.DB.prepare('INSERT INTO organizations (id, slug, name) VALUES (?,?,?)')
      .bind('other-org', 'other-org', 'Other Organization').run()
    await env.DB.prepare('INSERT INTO memberships (id, organization_id, user_id, role) VALUES (?,?,?,?)')
      .bind('recruiter-membership', 'ats-org', users.recruiter, 'recruiter').run()
    await env.DB.prepare('INSERT INTO memberships (id, organization_id, user_id, role) VALUES (?,?,?,?)')
      .bind('viewer-membership', 'ats-org', users.viewer, 'viewer').run()
    await env.DB.prepare('INSERT INTO memberships (id, organization_id, user_id, role) VALUES (?,?,?,?)')
      .bind('outsider-membership', 'other-org', users.outsider, 'admin').run()
    await env.DB.prepare(
      `INSERT INTO jobs (id, origin, organization_id, title, body, application_method, status, version, created_at, updated_at)
       VALUES ('ats-job', 'native', 'ats-org', 'ATS Engineer', 'A job description for testing ATS features.', 'native', 'published', 1, ?, ?)`
    ).bind(now, now).run()

    const router = new Hono()
    router.route('/api/v1/applications', applications)
    router.route('/api/v1/offers', offers)
    router.route('/api/v1/organizations', organizations)
    router.route('/api/v1/jobs', jobs)
    router.route('/api/v1/media', media)
    request = async (path, userId, init = {}) => await router.request(path, {
      ...init,
      headers: {
        ...(tokens[userId] ? { Cookie: `joblite_session=${tokens[userId]}` } : {}),
        ...(init.headers || {}),
      },
    }, env as any)
  })

  afterEach(() => close())

  it('keeps ATS records private while public discovery stays available to guests', async () => {
    await createApplication('guest-private-app')
    expect((await request('/api/v1/applications/guest-private-app', '')).status).toBe(401)
    expect((await request('/api/v1/organizations/ats-org/overview', '')).status).toBe(401)
    expect((await request('/api/v1/organizations/ats-org/applications', '')).status).toBe(401)
    expect((await request('/api/v1/jobs?limit=1', '')).status).toBe(200)
  })

  async function createApplication(id: string, options: { cvMediaId?: string } = {}) {
    await env.DB.prepare(
      `INSERT INTO applications (id, candidate_id, job_id, stage, version, submitted_at, updated_at)
       VALUES (?, ?, 'ats-job', 'submitted', 1, ?, ?)`
    ).bind(id, users.candidate, now, now).run()
    await env.DB.prepare(
      `INSERT INTO application_snapshots (id, application_id, profile_json, job_json, cv_media_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      `${id}-snapshot`, id, JSON.stringify({ headline: 'Candidate headline' }),
      JSON.stringify({ title: 'ATS Engineer' }), options.cvMediaId ?? null, now
    ).run()
  }

  it('isolates organization applications and never serializes private notes to candidates', async () => {
    await createApplication('private-app')
    const noteResponse = await request('/api/v1/applications/private-app/notes', users.recruiter, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: 'Internal compensation discussion' }),
    })
    expect(noteResponse.status).toBe(201)

    const candidateDetail = await (await request('/api/v1/applications/private-app', users.candidate)).json() as any
    expect(candidateDetail.data.notes).toEqual([])
    expect(JSON.stringify(candidateDetail.data)).not.toContain('Internal compensation discussion')
    expect(candidateDetail.data.events.every((event: any) => !Object.hasOwn(event, 'metadata_json'))).toBe(true)

    const recruiterDetail = await (await request('/api/v1/applications/private-app', users.recruiter)).json() as any
    expect(recruiterDetail.data.notes[0].body).toBe('Internal compensation discussion')
    expect((await request('/api/v1/applications/private-app', users.outsider)).status).toBe(403)
    expect((await request('/api/v1/applications/private-app/notes', users.candidate, { method: 'POST', body: JSON.stringify({ body: 'No' }) })).status).toBe(403)
  })

  it('enforces valid, confirmed, reasoned, optimistic stage transitions and keeps snapshots immutable', async () => {
    await createApplication('stage-app')
    const invalid = await request('/api/v1/applications/stage-app/transitions', users.recruiter, {
      method: 'POST', body: JSON.stringify({ to: 'hired', expected_version: 1, confirmed: true }),
    })
    expect(invalid.status).toBe(400)
    const moved = await request('/api/v1/applications/stage-app/transitions', users.recruiter, {
      method: 'POST', body: JSON.stringify({ to: 'in_review', expected_version: 1 }),
    })
    expect(moved.status).toBe(200)
    const stale = await request('/api/v1/applications/stage-app/transitions', users.recruiter, {
      method: 'POST', body: JSON.stringify({ to: 'shortlisted', expected_version: 1 }),
    })
    expect(stale.status).toBe(409)
    const rejection = await request('/api/v1/applications/stage-app/transitions', users.recruiter, {
      method: 'POST', body: JSON.stringify({ to: 'rejected', expected_version: 2, confirmed: true }),
    })
    expect(rejection.status).toBe(400)
    const snapshotBefore = await env.DB.prepare('SELECT profile_json FROM application_snapshots WHERE application_id = ?')
      .bind('stage-app').first<any>()
    await expect(env.DB.prepare('UPDATE application_snapshots SET profile_json = ? WHERE application_id = ?')
      .bind('{}', 'stage-app').run()).rejects.toThrow(/immutable/)
    const snapshotAfter = await env.DB.prepare('SELECT profile_json FROM application_snapshots WHERE application_id = ?')
      .bind('stage-app').first<any>()
    expect(snapshotAfter.profile_json).toBe(snapshotBefore.profile_json)
  })

  it('serializes concurrent stage updates so only one versioned transition is recorded', async () => {
    await createApplication('race-app')
    const responses = await Promise.all([
      request('/api/v1/applications/race-app/transitions', users.recruiter, {
        method: 'POST', body: JSON.stringify({ to: 'in_review', expected_version: 1 }),
      }),
      request('/api/v1/applications/race-app/transitions', users.recruiter, {
        method: 'POST', body: JSON.stringify({ to: 'shortlisted', expected_version: 1 }),
      }),
    ])
    expect(responses.map((response) => response.status).sort((a, b) => a - b)).toEqual([200, 409])
    const application = await env.DB.prepare('SELECT stage, version FROM applications WHERE id = ?')
      .bind('race-app').first<any>()
    expect(application.version).toBe(2)
    expect(['in_review', 'shortlisted']).toContain(application.stage)
    const events = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM application_events WHERE application_id = ? AND event_type = 'application.stage_changed'"
    ).bind('race-app').first<any>()
    expect(events.total).toBe(1)
  })

  it('allows candidate withdrawal but does not permit terminal applications to reopen', async () => {
    await createApplication('withdraw-app')
    const unconfirmed = await request('/api/v1/applications/withdraw-app/withdraw', users.candidate, {
      method: 'POST', body: JSON.stringify({ expected_version: 1 }),
    })
    expect(unconfirmed.status).toBe(400)
    const response = await request('/api/v1/applications/withdraw-app/withdraw', users.candidate, {
      method: 'POST', body: JSON.stringify({ expected_version: 1, confirmed: true }),
    })
    expect(response.status).toBe(200)
    expect((await response.json() as any).data).toMatchObject({ stage: 'withdrawn', version: 2 })
    const reopen = await request('/api/v1/applications/withdraw-app/transitions', users.recruiter, {
      method: 'POST', body: JSON.stringify({ to: 'interview', expected_version: 2 }),
    })
    expect(reopen.status).toBe(400)
    expect((await request('/api/v1/applications/withdraw-app/withdraw', users.candidate, {
      method: 'POST', body: JSON.stringify({ expected_version: 2 }),
    })).status).toBe(409)
  })

  it('filters employer applications and refuses vacancy closure while applicants remain active', async () => {
    await createApplication('close-app')
    const filtered = await request('/api/v1/organizations/ats-org/applications?stage=submitted&limit=1&offset=0', users.recruiter)
    const listing = await filtered.json() as any
    expect(listing.data.map((row: any) => row.id)).toEqual(['close-app'])
    expect(listing.meta).toMatchObject({ total: 1, limit: 1, offset: 0, has_more: false })

    const blocked = await request('/api/v1/jobs/ats-job/status', users.recruiter, {
      method: 'PATCH', body: JSON.stringify({ status: 'closed', expected_version: 1 }),
    })
    expect(blocked.status).toBe(409)
    await request('/api/v1/applications/close-app/withdraw', users.candidate, {
      method: 'POST', body: JSON.stringify({ expected_version: 1, confirmed: true }),
    })
    const closed = await request('/api/v1/jobs/ats-job/status', users.recruiter, {
      method: 'PATCH', body: JSON.stringify({ status: 'closed', expected_version: 1 }),
    })
    expect((await closed.json() as any).data).toMatchObject({ status: 'closed', version: 2 })
  })

  it('schedules timezone-qualified interviews and returns a private calendar invite', async () => {
    await createApplication('interview-app')
    const scheduledAt = Math.floor(Date.now() / 1000) + 3600
    const scheduled = await request('/api/v1/applications/interview-app/interviews', users.recruiter, {
      method: 'POST',
      body: JSON.stringify({ scheduled_at: scheduledAt, timezone: 'America/New_York', details: 'Video interview' }),
    })
    expect(scheduled.status).toBe(201)
    const interview = (await scheduled.json() as any).data
    const candidateDetail = await (await request('/api/v1/applications/interview-app', users.candidate)).json() as any
    expect(candidateDetail.data.interviews[0]).toMatchObject({ scheduled_at: scheduledAt, timezone: 'America/New_York' })
    const calendar = await request(`/api/v1/applications/interview-app/interviews/${interview.id}/calendar.ics`, users.candidate)
    expect(calendar.headers.get('content-type')).toContain('text/calendar')
    expect(await calendar.text()).toContain('DTSTART:')
  })

  it('keeps offer response separate from explicit hire and requires an accepted offer', async () => {
    await createApplication('offer-app')
    const earlyHire = await request('/api/v1/applications/offer-app/hire', users.recruiter, {
      method: 'POST', body: JSON.stringify({ expected_version: 1, confirmed: true }),
    })
    expect(earlyHire.status).toBe(409)
    const draft = await request('/api/v1/applications/offer-app/offers', users.recruiter, {
      method: 'POST', body: JSON.stringify({ terms: { summary: 'Full-time role' } }),
    })
    expect(draft.status).toBe(201)
    const offerId = (await draft.json() as any).data.id
    const issued = await request(`/api/v1/applications/offers/${offerId}/issue`, users.recruiter, {
      method: 'POST', body: JSON.stringify({ expected_version: 1 }),
    })
    expect(issued.status).toBe(200)
    const candidateView = await (await request('/api/v1/applications/offer-app', users.candidate)).json() as any
    expect(candidateView.data.offers[0].status).toBe('issued')
    expect(candidateView.data.events.filter((event: any) => event.new_stage === 'offer')).toHaveLength(1)
    expect(candidateView.data.events.find((event: any) => event.event_type === 'offer.issued').new_stage).toBeNull()
    const accepted = await request(`/api/v1/offers/${offerId}/respond`, users.candidate, {
      method: 'POST', body: JSON.stringify({ response: 'accepted' }),
    })
    expect((await accepted.json() as any).data).toMatchObject({ status: 'accepted', hired: false })
    const viewerHire = await request('/api/v1/applications/offer-app/hire', users.viewer, {
      method: 'POST', body: JSON.stringify({ expected_version: 2, confirmed: true }),
    })
    expect(viewerHire.status).toBe(403)
    const hired = await request('/api/v1/applications/offer-app/hire', users.recruiter, {
      method: 'POST', body: JSON.stringify({ expected_version: 2, confirmed: true }),
    })
    expect((await hired.json() as any).data).toMatchObject({ stage: 'hired', version: 3 })
  })

  it('withdraws open offers on offer-stage backtracking and prevents backtracking after acceptance', async () => {
    await createApplication('offer-backtrack')
    const firstDraft = await request('/api/v1/applications/offer-backtrack/offers', users.recruiter, {
      method: 'POST', body: JSON.stringify({ terms: { summary: 'First offer' } }),
    })
    const firstOfferId = (await firstDraft.json() as any).data.id
    expect((await request(`/api/v1/applications/offers/${firstOfferId}/issue`, users.recruiter, {
      method: 'POST', body: JSON.stringify({ expected_version: 1 }),
    })).status).toBe(200)

    const backtracked = await request('/api/v1/applications/offer-backtrack/transitions', users.recruiter, {
      method: 'POST', body: JSON.stringify({ to: 'in_review', expected_version: 2, reason: 'Reconsidering the application' }),
    })
    expect(backtracked.status).toBe(200)
    expect((await env.DB.prepare('SELECT status FROM offers WHERE id = ?').bind(firstOfferId).first<any>()).status)
      .toBe('withdrawn')
    expect((await request(`/api/v1/offers/${firstOfferId}/respond`, users.candidate, {
      method: 'POST', body: JSON.stringify({ response: 'accepted' }),
    })).status).toBe(409)

    const secondDraft = await request('/api/v1/applications/offer-backtrack/offers', users.recruiter, {
      method: 'POST', body: JSON.stringify({ terms: { summary: 'Revised offer' } }),
    })
    const secondOfferId = (await secondDraft.json() as any).data.id
    expect((await request(`/api/v1/applications/offers/${secondOfferId}/issue`, users.recruiter, {
      method: 'POST', body: JSON.stringify({ expected_version: 3 }),
    })).status).toBe(200)
    expect((await request(`/api/v1/offers/${secondOfferId}/respond`, users.candidate, {
      method: 'POST', body: JSON.stringify({ response: 'accepted' }),
    })).status).toBe(200)

    const acceptedOfferBacktrack = await request('/api/v1/applications/offer-backtrack/transitions', users.recruiter, {
      method: 'POST', body: JSON.stringify({ to: 'in_review', expected_version: 4, reason: 'Reconsidering the application' }),
    })
    expect(acceptedOfferBacktrack.status).toBe(409)
    expect((await acceptedOfferBacktrack.json() as any).error.code).toBe('ACCEPTED_OFFER')
    expect((await env.DB.prepare('SELECT stage FROM applications WHERE id = ?')
      .bind('offer-backtrack').first<any>()).stage).toBe('offer')
  })

  it('applies bulk actions per item and reports partial failures without aborting authorized items', async () => {
    await createApplication('bulk-a')
    await env.DB.prepare(
      `INSERT INTO applications (id, candidate_id, job_id, stage, version, submitted_at, updated_at)
       VALUES ('bulk-b', ?, 'ats-job', 'submitted', 1, ?, ?)`
    ).bind(users.outsider, now, now).run()
    await env.DB.prepare(
      `INSERT INTO jobs (id, origin, organization_id, title, body, application_method, status, version, created_at, updated_at)
       VALUES ('other-job', 'native', 'other-org', 'Other Role', 'Another description for isolation testing.', 'native', 'published', 1, ?, ?)`
    ).bind(now, now).run()
    await env.DB.prepare(
      `INSERT INTO applications (id, candidate_id, job_id, stage, version, submitted_at, updated_at)
       VALUES ('other-app', ?, 'other-job', 'submitted', 1, ?, ?)`
    ).bind(users.candidate, now, now).run()

    const denied = await request('/api/v1/applications/bulk', users.viewer, {
      method: 'POST',
      body: JSON.stringify({ organization_id: 'ats-org', action: 'stage', to: 'in_review', items: [{ id: 'bulk-a', expected_version: 1 }] }),
    })
    expect(denied.status).toBe(403)

    const unconfirmed = await request('/api/v1/applications/bulk', users.recruiter, {
      method: 'POST',
      body: JSON.stringify({ organization_id: 'ats-org', action: 'reject', confirmed: false, reason: 'Not a fit', items: [{ id: 'bulk-a', expected_version: 1 }] }),
    })
    expect(unconfirmed.status).toBe(400)

    const outcome = await request('/api/v1/applications/bulk', users.recruiter, {
      method: 'POST',
      body: JSON.stringify({
        organization_id: 'ats-org', action: 'stage', to: 'in_review',
        items: [
          { id: 'bulk-a', expected_version: 1 },
          { id: 'bulk-b', expected_version: 99 },
          { id: 'missing-app', expected_version: 1 },
          { id: 'bulk-a', expected_version: 1 },
          { id: 'other-app', expected_version: 1 },
        ],
      }),
    })
    const bulk = await outcome.json() as any
    expect(outcome.status).toBe(200)
    expect(bulk.data.succeeded.map((item: any) => item.id)).toEqual(['bulk-a'])
    expect(bulk.data.failed.map((item: any) => item.code)).toEqual(['CONFLICT', 'NOT_FOUND', 'DUPLICATE_ITEM', 'FORBIDDEN'])
    expect(bulk.data).toMatchObject({ requested: 5, succeeded_count: 1, failed_count: 4 })
    expect((await env.DB.prepare("SELECT stage, version FROM applications WHERE id = 'bulk-a'").first<any>())).toMatchObject({ stage: 'in_review', version: 2 })
    expect((await env.DB.prepare("SELECT stage, version FROM applications WHERE id = 'bulk-b'").first<any>())).toMatchObject({ stage: 'submitted', version: 1 })
    expect((await env.DB.prepare("SELECT stage FROM applications WHERE id = 'other-app'").first<any>())).toMatchObject({ stage: 'submitted' })

    const rejected = await request('/api/v1/applications/bulk', users.recruiter, {
      method: 'POST',
      body: JSON.stringify({ organization_id: 'ats-org', action: 'reject', confirmed: true, reason: 'Skills mismatch', items: [{ id: 'bulk-b', expected_version: 1 }] }),
    })
    expect((await rejected.json() as any).data.succeeded_count).toBe(1)
    const audit = await env.DB.prepare("SELECT metadata_json FROM audit_events WHERE action = 'applications.bulk_action' ORDER BY created_at DESC").first<any>()
    expect(audit.metadata_json).toContain('bulk-b')
  })

  it('exports authorized application rows without private notes or spreadsheet formulas', async () => {
    await createApplication('export-app')
    await env.DB.prepare('UPDATE users SET display_name = ? WHERE id = ?').bind('=cmd|calc', users.candidate).run()
    await request('/api/v1/applications/export-app/notes', users.recruiter, {
      method: 'POST', body: JSON.stringify({ body: 'Confidential salary expectation' }),
    })

    const exported = await request('/api/v1/organizations/ats-org/applications/export.csv', users.recruiter)
    expect(exported.status).toBe(200)
    expect(exported.headers.get('content-type')).toContain('text/csv')
    expect(exported.headers.get('cache-control')).toContain('no-store')
    const body = await exported.text()
    expect(body.split('\r\n')[0]).toContain('application_id')
    expect(body).toContain("'=cmd|calc")
    expect(body).not.toContain('Confidential salary expectation')
    expect(body).not.toContain('summary')
    expect((await env.DB.prepare("SELECT COUNT(*) AS total FROM audit_events WHERE action = 'applications.exported'").first<any>()).total).toBe(1)

    expect((await request('/api/v1/organizations/ats-org/applications/export.csv', users.viewer)).status).toBe(403)
    expect((await request('/api/v1/organizations/ats-org/applications/export.csv', users.outsider)).status).toBe(403)
  })

  it('derives reporting metrics from persisted events and refuses unauthorized report access', async () => {
    const day = 86400
    const submitted = now - 10 * day
    await env.DB.prepare(
      `INSERT INTO applications (id, candidate_id, job_id, stage, version, submitted_at, updated_at)
       VALUES ('report-hired', ?, 'ats-job', 'hired', 6, ?, ?)`
    ).bind(users.candidate, submitted, now - 2 * day).run()
    await env.DB.prepare(
      `INSERT INTO applications (id, candidate_id, job_id, stage, version, submitted_at, updated_at)
       VALUES ('report-withdrawn', ?, 'ats-job', 'withdrawn', 2, ?, ?)`
    ).bind(users.outsider, submitted, now - day).run()
    const events: Array<[string, string, string, string | null, number]> = [
      ['report-hired-e1', 'report-hired', 'application.stage_changed', 'in_review', now - 8 * day],
      ['report-hired-e2', 'report-hired', 'application.stage_changed', 'offer', now - 3 * day],
      ['report-hired-e3', 'report-hired', 'application.hired', 'hired', now - 2 * day],
      ['report-withdrawn-e1', 'report-withdrawn', 'application.withdrawn', null, now - day],
    ]
    for (const [id, applicationId, eventType, stage, createdAt] of events) {
      await env.DB.prepare(
        `INSERT INTO application_events (id, application_id, actor_id, actor_type, event_type, old_stage, new_stage, candidate_visible, metadata_json, created_at)
         VALUES (?, ?, NULL, 'system', ?, NULL, ?, 1, '{}', ?)`
      ).bind(id, applicationId, eventType, stage, createdAt).run()
    }

    const from = new Date((now - 30 * day) * 1000).toISOString().slice(0, 10)
    const to = new Date(now * 1000).toISOString().slice(0, 10)
    const response = await request(`/api/v1/organizations/ats-org/reports?from=${from}&to=${to}`, users.recruiter)
    expect(response.status).toBe(200)
    const report = (await response.json() as any).data
    expect(report.totals).toMatchObject({ applications: 2, hired: 1, withdrawn: 1 })
    expect(report.time_to_hire_days.samples).toBe(1)
    expect(report.time_to_hire_days.median).toBeCloseTo(8, 5)
    const screening = report.stages.find((row: any) => row.stage === 'in_review')
    expect(screening).toMatchObject({ current: 0, reached: 1 })
    expect(screening.median_days).toBeCloseTo(5, 5)
    expect(report.definitions.time_to_hire).toContain('application.hired')

    expect((await request(`/api/v1/organizations/ats-org/reports?from=${from}&to=${to}`, users.viewer)).status).toBe(403)
    expect((await request(`/api/v1/organizations/ats-org/reports?from=${from}&to=${to}`, users.outsider)).status).toBe(403)
    expect((await request(`/api/v1/organizations/ats-org/reports?from=${to}&to=${from}`, users.recruiter)).status).toBe(400)
  })

  it('handles repeat stages, missing or out-of-order history, and UTC date filters', async () => {
    const submitted = now - 10 * 86400
    for (const [id, candidateId, stage, timestamp] of [
      ['report-repeat', users.candidate, 'hired', submitted],
      ['report-no-history', users.outsider, 'hired', submitted],
      ['report-outside-window', users.viewer, 'withdrawn', now - 100 * 86400],
    ]) {
      await env.DB.prepare(
        `INSERT INTO applications (id, candidate_id, job_id, stage, version, submitted_at, updated_at)
         VALUES (?, ?, 'ats-job', ?, 1, ?, ?)`
      ).bind(id, candidateId, stage, timestamp, now).run()
    }
    const events: Array<[string, string, string, string | null, number]> = [
      ['repeat-e0', 'report-repeat', 'application.stage_changed', 'shortlisted', submitted - 1],
      ['repeat-e1', 'report-repeat', 'application.stage_changed', 'in_review', submitted + 2 * 86400],
      ['repeat-e2', 'report-repeat', 'application.stage_changed', 'offer', submitted + 4 * 86400],
      ['repeat-e3', 'report-repeat', 'application.stage_changed', 'in_review', submitted + 5 * 86400],
      ['repeat-e4', 'report-repeat', 'application.hired', 'hired', submitted + 9 * 86400],
      ['repeat-e5', 'report-repeat', 'application.hired', 'hired', submitted + 9 * 86400],
    ]
    for (const [id, applicationId, eventType, stage, createdAt] of events) {
      await env.DB.prepare(
        `INSERT INTO application_events (id, application_id, actor_id, actor_type, event_type, old_stage, new_stage, candidate_visible, metadata_json, created_at)
         VALUES (?, ?, NULL, 'system', ?, NULL, ?, 1, '{}', ?)`
      ).bind(id, applicationId, eventType, stage, createdAt).run()
    }

    const from = new Date((now - 30 * 86400) * 1000).toISOString().slice(0, 10)
    const to = new Date(now * 1000).toISOString().slice(0, 10)
    const report = (await (await request(
      `/api/v1/organizations/ats-org/reports?from=${from}&to=${to}`, users.recruiter
    )).json() as any).data
    expect(report.totals).toMatchObject({
      applications: 2,
      hired: 2,
      without_history: 1,
      missing_hire_timestamp: 1,
      out_of_order_events: 1,
    })
    expect(report.time_to_hire_days).toMatchObject({ samples: 1, median: 9 })
    expect(report.conversion.offered_to_hired).toBe(1)
    expect(report.stages.find((row: any) => row.stage === 'shortlisted').reached).toBe(0)
    expect(report.stages.find((row: any) => row.stage === 'in_review')).toMatchObject({
      samples: 2,
      average_days: 3,
      median_days: 3,
    })
  })

  it('lets only the candidate accept or decline an interview invitation', async () => {
    await createApplication('interview-response-app')
    const scheduledAt = Math.floor(Date.now() / 1000) + 7200
    const scheduled = await request('/api/v1/applications/interview-response-app/interviews', users.recruiter, {
      method: 'POST', body: JSON.stringify({ scheduled_at: scheduledAt, timezone: 'UTC', details: 'Panel' }),
    })
    const interviewId = (await scheduled.json() as any).data.id
    const employerAttempt = await request(`/api/v1/applications/interview-response-app/interviews/${interviewId}/respond`, users.recruiter, {
      method: 'POST', body: JSON.stringify({ response: 'accepted' }),
    })
    expect(employerAttempt.status).toBe(403)
    const accepted = await request(`/api/v1/applications/interview-response-app/interviews/${interviewId}/respond`, users.candidate, {
      method: 'POST', body: JSON.stringify({ response: 'accepted' }),
    })
    expect((await accepted.json() as any).data).toMatchObject({ status: 'confirmed', response: 'accepted' })
    const duplicate = await request(`/api/v1/applications/interview-response-app/interviews/${interviewId}/respond`, users.candidate, {
      method: 'POST', body: JSON.stringify({ response: 'declined' }),
    })
    expect(duplicate.status).toBe(409)
    const detail = await (await request('/api/v1/applications/interview-response-app', users.candidate)).json() as any
    expect(detail.data.interviews[0].status).toBe('confirmed')
  })

  it('serves the submitted CV only to its owner and the receiving organization', async () => {
    const cvId = 'cv-submitted'
    await env.DB.prepare(
      `INSERT INTO media (id, owner_id, object_key, purpose, type, size, state, mime_type, created_at, updated_at)
       VALUES (?, ?, 'uploads/cv.pdf', 'cv', 'document', 4, 'ready', 'application/pdf', ?, ?)`
    ).bind(cvId, users.candidate, now, now).run()
    await createApplication('cv-app', { cvMediaId: cvId })
    const deletedObjects: string[] = []
    ;(env as any).MEDIA = {
      get: async () => ({ body: new Uint8Array([1, 2, 3, 4]), size: 4 }),
      put: async () => undefined,
      head: async () => ({ size: 4, httpMetadata: { contentType: 'application/pdf' } }),
      delete: async (key: string) => { deletedObjects.push(key) },
    }

    expect((await request(`/api/v1/media/${cvId}/content`, users.recruiter)).status).toBe(200)
    expect((await request(`/api/v1/media/${cvId}/content`, users.candidate)).status).toBe(200)
    expect((await request(`/api/v1/media/${cvId}/content`, users.outsider)).status).toBe(404)
    expect((await request(`/api/v1/media/${cvId}/content`, users.viewer)).status).toBe(200)

    // Replacing the profile CV must not rewrite the submitted snapshot evidence.
    const replacementId = 'cv-replacement'
    await env.DB.prepare(
      `INSERT INTO media (id, owner_id, object_key, purpose, type, size, state, mime_type, created_at, updated_at)
       VALUES (?, ?, 'uploads/cv-2.pdf', 'cv', 'document', 4, 'ready', 'application/pdf', ?, ?)`
    ).bind(replacementId, users.candidate, now, now).run()
    await env.DB.prepare('UPDATE profiles SET cv_media_id = ? WHERE user_id = ?').bind(replacementId, users.candidate).run()
    const snapshot = await env.DB.prepare('SELECT cv_media_id FROM application_snapshots WHERE application_id = ?').bind('cv-app').first<any>()
    expect(snapshot.cv_media_id).toBe(cvId)
    expect((await request(`/api/v1/media/${cvId}/content`, users.recruiter)).status).toBe(200)
    const deletion = await request(`/api/v1/media/${cvId}`, users.candidate, { method: 'DELETE' })
    expect(deletion.status).toBe(409)
    expect(deletedObjects).toEqual([])
  })

  it('completes the full application, interview, offer and explicit hire workflow', async () => {
    const applied = await request('/api/v1/applications', users.candidate, {
      method: 'POST', body: JSON.stringify({ job_id: 'ats-job' }),
    })
    expect(applied.status).toBe(201)
    const applicationId = (await applied.json() as any).data.id

    let version = 1
    for (const stage of ['in_review', 'shortlisted', 'interview']) {
      const moved = await request(`/api/v1/applications/${applicationId}/transitions`, users.recruiter, {
        method: 'POST', body: JSON.stringify({ to: stage, expected_version: version }),
      })
      expect(moved.status).toBe(200)
      version = (await moved.json() as any).data.version
    }

    const scheduled = await request(`/api/v1/applications/${applicationId}/interviews`, users.recruiter, {
      method: 'POST',
      body: JSON.stringify({ scheduled_at: Math.floor(Date.now() / 1000) + 3600, timezone: 'Europe/London', details: 'Video call' }),
    })
    expect(scheduled.status).toBe(201)
    const interviewId = (await scheduled.json() as any).data.id
    expect((await request(`/api/v1/applications/${applicationId}/interviews/${interviewId}/respond`, users.candidate, {
      method: 'POST', body: JSON.stringify({ response: 'accepted' }),
    })).status).toBe(200)

    await request(`/api/v1/applications/${applicationId}/notes`, users.recruiter, {
      method: 'POST', body: JSON.stringify({ body: 'Panel agreed this candidate is strong' }),
    })
    const draft = await request(`/api/v1/applications/${applicationId}/offers`, users.recruiter, {
      method: 'POST', body: JSON.stringify({ terms: { summary: 'Base salary and start date' } }),
    })
    const offerId = (await draft.json() as any).data.id
    const staleIssue = await request(`/api/v1/applications/offers/${offerId}/issue`, users.recruiter, {
      method: 'POST', body: JSON.stringify({ expected_version: version - 1 }),
    })
    expect(staleIssue.status).toBe(409)
    const issued = await request(`/api/v1/applications/offers/${offerId}/issue`, users.recruiter, {
      method: 'POST', body: JSON.stringify({ expected_version: version }),
    })
    expect(issued.status).toBe(200)
    version = (await issued.json() as any).data.application_version

    const candidateOffer = await (await request(`/api/v1/applications/${applicationId}`, users.candidate)).json() as any
    expect(candidateOffer.data.stage).toBe('offer')
    expect(candidateOffer.data.notes).toEqual([])
    expect(candidateOffer.data.scorecards).toEqual([])
    expect(JSON.stringify(candidateOffer.data)).not.toContain('Panel agreed this candidate is strong')

    expect((await request(`/api/v1/applications/${applicationId}/hire`, users.recruiter, {
      method: 'POST', body: JSON.stringify({ expected_version: version, confirmed: true }),
    })).status).toBe(409)

    expect((await request(`/api/v1/offers/${offerId}/respond`, users.candidate, {
      method: 'POST', body: JSON.stringify({ response: 'accepted' }),
    })).status).toBe(200)
    const afterAccept = await (await request(`/api/v1/applications/${applicationId}`, users.candidate)).json() as any
    expect(afterAccept.data.stage).toBe('offer')

    const hired = await request(`/api/v1/applications/${applicationId}/hire`, users.recruiter, {
      method: 'POST', body: JSON.stringify({ expected_version: version, confirmed: true }),
    })
    expect(hired.status).toBe(200)
    const final = await (await request(`/api/v1/applications/${applicationId}`, users.candidate)).json() as any
    expect(final.data.stage).toBe('hired')
    expect(final.data.events.some((event: any) => event.new_stage === 'hired')).toBe(true)
    expect((await request(`/api/v1/applications/${applicationId}/transitions`, users.candidate, {
      method: 'POST', body: JSON.stringify({ to: 'in_review', expected_version: version + 1 }),
    })).status).toBe(403)
  })

  it('treats a repeated application submission as idempotent instead of creating duplicates', async () => {
    const responses = await Promise.all([
      request('/api/v1/applications', users.candidate, {
        method: 'POST', body: JSON.stringify({ job_id: 'ats-job' }),
      }),
      request('/api/v1/applications', users.candidate, {
        method: 'POST', body: JSON.stringify({ job_id: 'ats-job' }),
      }),
    ])
    expect(responses.map((response) => response.status).sort((a, b) => a - b)).toEqual([200, 201])
    const firstId = (await responses[0].json() as any).data.id
    expect((await responses[1].json() as any).data.id).toBe(firstId)
    const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM applications WHERE candidate_id = ? AND job_id = 'ats-job'").bind(users.candidate).first<any>()
    expect(count.total).toBe(1)
    const snapshots = await env.DB.prepare('SELECT COUNT(*) AS total FROM application_snapshots WHERE application_id = ?').bind(firstId).first<any>()
    expect(snapshots.total).toBe(1)
  })

  it('persists submitted answers in the immutable snapshot and requires each configured response', async () => {
    const invalidJob = await request('/api/v1/jobs', users.recruiter, {
      method: 'POST',
      body: JSON.stringify({
        organization_id: 'ats-org',
        title: 'Support Engineer',
        body: 'Help customers use the Joblite platform and hiring tools.',
        workplace_arrangement: 'everywhere',
      }),
    })
    expect(invalidJob.status).toBe(400)

    const created = await request('/api/v1/jobs', users.recruiter, {
      method: 'POST',
      body: JSON.stringify({
        organization_id: 'ats-org',
        title: 'Support Engineer',
        body: 'Help customers use the Joblite platform and hiring tools.',
        application_questions: ['What interests you about this role?'],
      }),
    })
    expect(created.status).toBe(201)
    const jobId = (await created.json() as any).data.id
    expect((await request(`/api/v1/jobs/${jobId}/status`, users.recruiter, {
      method: 'PATCH', body: JSON.stringify({ status: 'published', expected_version: 1 }),
    })).status).toBe(200)

    const missing = await request('/api/v1/applications', users.candidate, {
      method: 'POST', body: JSON.stringify({ job_id: jobId, answers: [] }),
    })
    expect(missing.status).toBe(400)
    const submitted = await request('/api/v1/applications', users.candidate, {
      method: 'POST',
      body: JSON.stringify({
        job_id: jobId,
        answers: [{ question: 'What interests you about this role?', answer: 'I value clear, candidate-first workflows.' }],
      }),
    })
    expect(submitted.status).toBe(201)
    const applicationId = (await submitted.json() as any).data.id
    const candidate = await (await request(`/api/v1/applications/${applicationId}`, users.candidate)).json() as any
    expect(JSON.parse(candidate.data.snapshot.answers_json)).toEqual([
      { question: 'What interests you about this role?', answer: 'I value clear, candidate-first workflows.' },
    ])
    expect((await request(`/api/v1/applications/${applicationId}`, users.outsider)).status).toBe(403)
    await expect(env.DB.prepare('UPDATE application_snapshots SET answers_json = ? WHERE application_id = ?')
      .bind('[]', applicationId).run()).rejects.toThrow(/immutable/)
    const retry = await request('/api/v1/applications', users.candidate, {
      method: 'POST', body: JSON.stringify({ job_id: jobId }),
    })
    expect((await retry.json() as any).data.id).toBe(applicationId)
  })

  it('optimistically edits, closes, and archives only authorized native jobs', async () => {
    const edited = await request('/api/v1/jobs/ats-job', users.recruiter, {
      method: 'PATCH',
      body: JSON.stringify({ expected_version: 1, title: 'Updated ATS Engineer', application_questions: ['Why this role?'] }),
    })
    expect(edited.status).toBe(200)
    expect((await edited.json() as any).data.version).toBe(2)
    expect((await request('/api/v1/jobs/ats-job', users.recruiter, {
      method: 'PATCH', body: JSON.stringify({ expected_version: 1, title: 'Stale update' }),
    })).status).toBe(409)
    expect((await request('/api/v1/jobs/ats-job', users.viewer, {
      method: 'PATCH', body: JSON.stringify({ expected_version: 2, title: 'Unauthorized update' }),
    })).status).toBe(403)

    expect((await request('/api/v1/jobs/ats-job/status', users.recruiter, {
      method: 'PATCH', body: JSON.stringify({ status: 'closed', expected_version: 2 }),
    })).status).toBe(200)
    const archived = await request('/api/v1/jobs/ats-job/archive', users.recruiter, {
      method: 'POST', body: JSON.stringify({ expected_version: 3, reason: 'Role has been filled' }),
    })
    expect((await archived.json() as any).data).toMatchObject({ version: 4 })
    expect((await request('/api/v1/jobs/ats-job/status', users.recruiter, {
      method: 'PATCH', body: JSON.stringify({ status: 'published', expected_version: 4, reopen_confirmed: true, reason: 'Reopen' }),
    })).status).toBe(409)
    expect((await request('/api/v1/jobs/ats-job/archive', users.outsider, {
      method: 'POST', body: JSON.stringify({ expected_version: 4, reason: 'Unauthorized' }),
    })).status).toBe(403)
  })

  it('reports persisted active jobs, applications, screening, interviews, and offers', async () => {
    await createApplication('overview-review')
    const screening = await request('/api/v1/applications/overview-review/transitions', users.recruiter, {
      method: 'POST', body: JSON.stringify({ to: 'in_review', expected_version: 1 }),
    })
    expect(screening.status).toBe(200)
    const secondCandidate = users.outsider
    await env.DB.prepare(
      `INSERT INTO applications (id, candidate_id, job_id, stage, version, submitted_at, updated_at)
       VALUES ('overview-offer', ?, 'ats-job', 'submitted', 1, ?, ?)`
    ).bind(secondCandidate, now, now).run()
    await env.DB.prepare(
      `INSERT INTO application_snapshots (id, application_id, profile_json, job_json, created_at)
       VALUES ('overview-offer-snapshot', 'overview-offer', '{}', '{}', ?)`
    ).bind(now).run()
    await request('/api/v1/applications/overview-review/interviews', users.recruiter, {
      method: 'POST', body: JSON.stringify({ scheduled_at: now + 3600, timezone: 'UTC', details: 'Panel' }),
    })
    const draft = await request('/api/v1/applications/overview-offer/offers', users.recruiter, {
      method: 'POST', body: JSON.stringify({ terms: { summary: 'Employment terms' } }),
    })
    const offerId = (await draft.json() as any).data.id
    const issued = await request(`/api/v1/applications/offers/${offerId}/issue`, users.recruiter, {
      method: 'POST', body: JSON.stringify({ expected_version: 1 }),
    })
    expect(issued.status).toBe(200)

    const overview = await (await request('/api/v1/organizations/ats-org/overview', users.recruiter)).json() as any
    expect(overview.data.jobs.active).toBe(1)
    expect(overview.data.applications).toEqual({ total: 2, in_review: 1 })
    expect(overview.data.upcoming_interviews).toBe(1)
    expect(overview.data.offers).toEqual({ total: 1, issued: 1 })
  })

  it('allows scorecards only from assigned reviewers in the application organization', async () => {
    await createApplication('reviewer-app')
    const unauthorized = await request('/api/v1/applications/reviewer-app/scorecards', users.viewer, {
      method: 'POST',
      body: JSON.stringify({ ratings: { role_alignment: 4 }, recommendation: 'yes', summary: 'Strong evidence' }),
    })
    expect(unauthorized.status).toBe(403)

    const assigned = await request('/api/v1/applications/reviewer-app/reviewers', users.recruiter, {
      method: 'POST', body: JSON.stringify({ user_id: users.viewer }),
    })
    expect(assigned.status).toBe(400)
    const crossOrg = await request('/api/v1/applications/reviewer-app/reviewers', users.recruiter, {
      method: 'POST', body: JSON.stringify({ user_id: users.outsider }),
    })
    expect(crossOrg.status).toBe(400)

    await env.DB.prepare('INSERT INTO memberships (id, organization_id, user_id, role) VALUES (?,?,?,?)')
      .bind('second-recruiter-membership', 'ats-org', 'ats-outsider', 'recruiter').run()
    const validAssignment = await request('/api/v1/applications/reviewer-app/reviewers', users.recruiter, {
      method: 'POST', body: JSON.stringify({ user_id: users.outsider }),
    })
    expect(validAssignment.status).toBe(201)
    const scorecard = await request('/api/v1/applications/reviewer-app/scorecards', users.outsider, {
      method: 'POST',
      body: JSON.stringify({ ratings: { role_alignment: 4, skills_evidence: 5 }, recommendation: 'yes', summary: 'Evidence from submitted experience.' }),
    })
    expect(scorecard.status).toBe(200)
    const candidate = await (await request('/api/v1/applications/reviewer-app', users.candidate)).json() as any
    expect(candidate.data.scorecards).toEqual([])
  })
})
