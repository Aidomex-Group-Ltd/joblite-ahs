import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import type { AppContext } from '../types'
import { requireAuth } from '../middleware/auth'
import { clampInt, sanitizeText, slugify } from '../lib/validate'

const app = new Hono<AppContext>()

app.use('/*', requireAuth)

async function unreadNotificationCount(c: any, userId: string): Promise<number> {
  const row = (await c.env.DB.prepare('SELECT COUNT(*) as total FROM notifications WHERE user_id = ? AND read_at IS NULL')
    .bind(userId)
    .first()) as { total: number } | null
  return row?.total ?? 0
}

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean)
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed.map(String).map((s) => s.trim()).filter(Boolean)
    } catch {
      return value.split(',').map((s) => s.trim()).filter(Boolean)
    }
  }
  return []
}

function formatOnboardingRow(row: any) {
  const isComplete = row.status === 'completed' || (row.completed_at && row.completed_at > 0 && row.status !== 'skipped')
  return {
    status: (row.status || (isComplete ? 'completed' : 'in_progress')) as 'in_progress' | 'completed' | 'skipped',
    current_step: Math.min(3, Math.max(1, Number(row.current_step || 1))),
    account_type: row.current_step === 1 && row.status === 'in_progress' && !row.desired_role ? null : row.account_type || null,
    country_code: row.country_code || null,
    city: row.city || null,
    desired_role: row.desired_role || null,
    skills: parseJsonArray(row.skills_json),
    work_preference: row.work_preference || null,
    employment_types: parseJsonArray(row.employment_types_json),
    experience_level: row.experience_level || null,
    organization_name: row.organization_name || null,
    organization_country: row.organization_country || null,
    organization_city: row.organization_city || null,
    organization_website: row.organization_website || null,
    expected_roles: row.expected_roles || null,
    employer_title: row.employer_title || null,
    job_alerts_enabled: Boolean(row.job_alerts_enabled),
    notification_channels: parseJsonArray(row.notification_channels_json).length ? parseJsonArray(row.notification_channels_json) : ['email'],
    alert_frequency: row.alert_frequency || 'daily',
    completed_at: row.completed_at && row.completed_at > 0 ? row.completed_at : null,
    created_at: row.created_at || Math.floor(Date.now() / 1000),
    updated_at: row.updated_at || Math.floor(Date.now() / 1000),
  }
}

app.get('/', async (c) => {
  const user = c.get('user')!
  const [profile, memberships, unread, onboardingRow] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM profiles WHERE user_id = ?').bind(user.id).first<any>(),
    c.env.DB.prepare(
      'SELECT m.organization_id, m.role, o.name as org_name, o.slug as org_slug, o.verification_state FROM memberships m JOIN organizations o ON o.id = m.organization_id WHERE m.user_id = ?'
    )
      .bind(user.id)
      .all(),
    unreadNotificationCount(c, user.id),
    c.env.DB.prepare('SELECT * FROM user_onboarding WHERE user_id = ?').bind(user.id).first<any>(),
  ])

  return c.json({
    data: {
      user: {
        id: user.id,
        email: user.email,
        display_name: user.display_name || profile?.handle || user.email.split('@')[0],
      },
      profile: profile || null,
      memberships: memberships.results,
      unread_notifications: unread,
      onboarding: onboardingRow ? formatOnboardingRow(onboardingRow) : null,
    },
  })
})

app.get('/summary', async (c) => {
  const user = c.get('user')!
  const [rows, saved, external] = await Promise.all([
    c.env.DB.prepare('SELECT stage, COUNT(*) as total FROM applications WHERE candidate_id = ? GROUP BY stage')
      .bind(user.id)
      .all(),
    c.env.DB.prepare('SELECT COUNT(*) as total FROM saved_jobs WHERE user_id = ?').bind(user.id).first() as Promise<{ total: number } | null>,
    c.env.DB.prepare('SELECT COUNT(*) as total FROM external_application_trackers WHERE user_id = ?')
      .bind(user.id)
      .first() as Promise<{ total: number } | null>,
  ])

  const byStage: Record<string, number> = {}
  let total = 0
  for (const row of rows.results as Array<{ stage: string; total: number }>) {
    byStage[row.stage] = row.total
    total += row.total
  }

  return c.json({
    data: {
      applications: {
        total,
        inReview: (byStage.in_review || 0) + (byStage.shortlisted || 0),
        interviews: byStage.interview || 0,
        offers: byStage.offer || 0,
        submitted: byStage.submitted || 0,
        by_stage: byStage,
      },
      saved: saved?.total ?? 0,
      external_tracked: external?.total ?? 0,
    },
  })
})

app.patch('/profile', async (c) => {
  const user = c.get('user')!
  const body = await c.req.json().catch(() => ({}))

  if (typeof body.display_name === 'string' && body.display_name.trim()) {
    await c.env.DB.prepare('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?')
      .bind(sanitizeText(body.display_name, 80), Math.floor(Date.now() / 1000), user.id)
      .run()
  }

  let profile = await c.env.DB.prepare('SELECT * FROM profiles WHERE user_id = ?').bind(user.id).first<any>()
  if (!profile) {
    const requestedHandle = typeof body.handle === 'string' && body.handle ? body.handle : null
    const base = slugify(requestedHandle || user.email.split('@')[0] || 'member', 24) || 'member'
    let handle = base
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const existing = await c.env.DB.prepare('SELECT id FROM profiles WHERE handle = ?').bind(handle).first()
      if (!existing) break
      handle = `${base}-${nanoid(4).toLowerCase()}`
    }

    const profileId = nanoid()
    await c.env.DB.prepare(
      'INSERT INTO profiles (id, user_id, handle, headline, bio, country_code, visibility, availability) VALUES (?,?,?,?,?,?,?,?)'
    )
      .bind(
        profileId,
        user.id,
        handle,
        sanitizeText(body.headline, 120) || null,
        sanitizeText(body.bio, 2000) || null,
        typeof body.country_code === 'string' && body.country_code ? body.country_code.toUpperCase() : null,
        ['public', 'private', 'recruiter_only'].includes(body.visibility) ? body.visibility : 'public',
        sanitizeText(body.availability, 80) || null
      )
      .run()
    profile = await c.env.DB.prepare('SELECT * FROM profiles WHERE id = ?').bind(profileId).first()
    return c.json({ data: profile }, 201)
  }

  const updates: string[] = []
  const values: unknown[] = []
  const allowed = ['headline', 'bio', 'availability'] as const
  for (const key of allowed) {
    if (body[key] !== undefined) {
      updates.push(`${key} = ?`)
      values.push(sanitizeText(body[key], key === 'bio' ? 2000 : 160) || null)
    }
  }
  if (body.country_code !== undefined) {
    const code = typeof body.country_code === 'string' && body.country_code ? body.country_code.toUpperCase() : null
    if (code) {
      const country = await c.env.DB.prepare('SELECT code FROM countries WHERE code = ?').bind(code).first()
      if (!country) return c.json({ error: { code: 'INVALID_COUNTRY', message: 'Unknown country code' } }, 400)
    }
    updates.push('country_code = ?')
    values.push(code)
  }
  if (body.visibility !== undefined) {
    if (!['public', 'private', 'recruiter_only'].includes(body.visibility)) {
      return c.json({ error: { code: 'INVALID_VISIBILITY', message: 'Unsupported profile visibility' } }, 400)
    }
    updates.push('visibility = ?')
    values.push(body.visibility)
  }
  if (updates.length === 0) return c.json({ data: profile })

  updates.push('updated_at = ?')
  values.push(Math.floor(Date.now() / 1000), user.id)
  await c.env.DB.prepare(`UPDATE profiles SET ${updates.join(', ')} WHERE user_id = ?`).bind(...values).run()
  profile = await c.env.DB.prepare('SELECT * FROM profiles WHERE user_id = ?').bind(user.id).first()
  return c.json({ data: profile })
})

app.get('/onboarding', async (c) => {
  const user = c.get('user')!
  let row = await c.env.DB.prepare('SELECT * FROM user_onboarding WHERE user_id = ?').bind(user.id).first<any>()
  if (!row) {
    const now = Math.floor(Date.now() / 1000)
    await c.env.DB.prepare(
      `INSERT INTO user_onboarding (user_id, status, current_step, account_type, completed_at, created_at, updated_at)
       VALUES (?, 'in_progress', 1, 'candidate', 0, ?, ?)`
    ).bind(user.id, now, now).run()
    row = await c.env.DB.prepare('SELECT * FROM user_onboarding WHERE user_id = ?').bind(user.id).first<any>()
  }
  return c.json({ data: formatOnboardingRow(row) })
})

app.put('/onboarding', async (c) => {
  const user = c.get('user')!
  const body = await c.req.json().catch(() => ({}))
  const now = Math.floor(Date.now() / 1000)

  let existing = await c.env.DB.prepare('SELECT * FROM user_onboarding WHERE user_id = ?').bind(user.id).first<any>()
  if (!existing) {
    await c.env.DB.prepare(
      `INSERT INTO user_onboarding (user_id, status, current_step, account_type, completed_at, created_at, updated_at)
       VALUES (?, 'in_progress', 1, 'candidate', 0, ?, ?)`
    ).bind(user.id, now, now).run()
    existing = await c.env.DB.prepare('SELECT * FROM user_onboarding WHERE user_id = ?').bind(user.id).first<any>()
  }

  const action = typeof body.action === 'string' ? body.action : 'save'
  const step = clampInt(body.step, 1, 3, Number(existing.current_step) || 1)

  if (action === 'skip') {
    await c.env.DB.prepare(
      `UPDATE user_onboarding SET status = 'skipped', completed_at = ?, updated_at = ? WHERE user_id = ?`
    ).bind(now, now, user.id).run()
    const updated = await c.env.DB.prepare('SELECT * FROM user_onboarding WHERE user_id = ?').bind(user.id).first<any>()
    return c.json({ data: formatOnboardingRow(updated) })
  }

  const updates: string[] = ['updated_at = ?']
  const values: unknown[] = [now]

  // Step 1: Goal / Account Type
  if (body.account_type !== undefined) {
    if (!['candidate', 'employer', 'both'].includes(String(body.account_type))) {
      return c.json({ error: { code: 'INVALID_ACCOUNT_TYPE', message: 'Choose whether you are looking for work, hiring, or both.' } }, 400)
    }
    updates.push('account_type = ?')
    values.push(body.account_type)
  }

  // Step 2: Preferences
  if (body.country_code !== undefined) {
    const code = typeof body.country_code === 'string' ? body.country_code.toUpperCase().trim() : ''
    if (code) {
      const country = await c.env.DB.prepare('SELECT code FROM countries WHERE code = ?').bind(code).first()
      if (!country) return c.json({ error: { code: 'INVALID_COUNTRY', message: 'Unknown country code' } }, 400)
      updates.push('country_code = ?')
      values.push(code)
      // Mirror country to profile
      await c.env.DB.prepare('UPDATE profiles SET country_code = ?, updated_at = ? WHERE user_id = ?')
        .bind(code, now, user.id).run()
    } else {
      updates.push('country_code = NULL')
    }
  }

  if (body.city !== undefined) {
    const city = sanitizeText(body.city, 80) || null
    updates.push('city = ?')
    values.push(city)
  }

  if (body.desired_role !== undefined) {
    const role = sanitizeText(body.desired_role, 120) || null
    updates.push('desired_role = ?')
    values.push(role)
    if (role) {
      await c.env.DB.prepare('UPDATE profiles SET headline = ?, updated_at = ? WHERE user_id = ?')
        .bind(role, now, user.id).run()
    }
  }

  if (body.work_preference !== undefined) {
    const pref = ['remote', 'hybrid', 'on-site', 'any'].includes(body.work_preference) ? body.work_preference : null
    updates.push('work_preference = ?')
    values.push(pref)
  }

  if (body.experience_level !== undefined) {
    const level = ['student', 'entry', 'mid', 'senior', 'executive', 'career_change', 'not_sure'].includes(body.experience_level) ? body.experience_level : null
    updates.push('experience_level = ?')
    values.push(level)
  }

  if (Array.isArray(body.skills)) {
    const cleanSkills = body.skills
      .map((s: unknown) => sanitizeText(s, 40).toLowerCase().trim())
      .filter((s: string) => s.length >= 2)
      .slice(0, 20)
    updates.push('skills_json = ?')
    values.push(JSON.stringify(cleanSkills))

    // Associate skills with profile
    const profile = await c.env.DB.prepare('SELECT id FROM profiles WHERE user_id = ?').bind(user.id).first<{ id: string }>()
    if (profile?.id) {
      for (const skillLabel of cleanSkills) {
        const skillId = nanoid()
        await c.env.DB.prepare('INSERT OR IGNORE INTO skills (id, label_normalized) VALUES (?,?)')
          .bind(skillId, skillLabel).run()
        const skill = await c.env.DB.prepare('SELECT id FROM skills WHERE label_normalized = ?').bind(skillLabel).first<{ id: string }>()
        if (skill?.id) {
          await c.env.DB.prepare('INSERT OR IGNORE INTO profile_skills (profile_id, skill_id) VALUES (?,?)')
            .bind(profile.id, skill.id).run()
        }
      }
    }
  }

  if (Array.isArray(body.employment_types)) {
    const validTypes = ['full-time', 'part-time', 'contract', 'internship', 'temporary']
    const cleanTypes = body.employment_types.filter((t: unknown) => typeof t === 'string' && validTypes.includes(t))
    updates.push('employment_types_json = ?')
    values.push(JSON.stringify(cleanTypes))
  }

  // Hiring user preferences (no membership or admin privilege is granted per requirements)
  if (body.organization_name !== undefined) {
    const orgName = sanitizeText(body.organization_name, 120) || null
    updates.push('organization_name = ?')
    values.push(orgName)
  }
  if (body.organization_country !== undefined) {
    const orgCountry = typeof body.organization_country === 'string' ? body.organization_country.toUpperCase().trim() : null
    updates.push('organization_country = ?')
    values.push(orgCountry)
  }
  if (body.organization_city !== undefined) {
    const orgCity = sanitizeText(body.organization_city, 80) || null
    updates.push('organization_city = ?')
    values.push(orgCity)
  }
  if (body.organization_website !== undefined) {
    const orgWeb = sanitizeText(body.organization_website, 200) || null
    updates.push('organization_website = ?')
    values.push(orgWeb)
  }
  if (body.expected_roles !== undefined) {
    const expRoles = sanitizeText(body.expected_roles, 200) || null
    updates.push('expected_roles = ?')
    values.push(expRoles)
  }
  if (body.employer_title !== undefined) {
    const empTitle = sanitizeText(body.employer_title, 100) || null
    updates.push('employer_title = ?')
    values.push(empTitle)
  }

  // Step 3: Job alerts
  if (body.job_alerts_enabled !== undefined) {
    const alertsEnabled = Boolean(body.job_alerts_enabled)
    updates.push('job_alerts_enabled = ?')
    values.push(alertsEnabled ? 1 : 0)

    const frequency = ['daily', 'weekly', 'instant'].includes(body.alert_frequency) ? body.alert_frequency : 'daily'
    updates.push('alert_frequency = ?')
    values.push(frequency)

    const channels = Array.isArray(body.notification_channels)
      ? body.notification_channels.filter((c: unknown) => c === 'email')
      : ['email']
    updates.push('notification_channels_json = ?')
    values.push(JSON.stringify(channels))

    if (alertsEnabled) {
      const filters = {
        country: body.country_code || existing.country_code || undefined,
        q: body.desired_role || existing.desired_role || undefined,
        arrangement: (body.work_preference || existing.work_preference) !== 'any' ? (body.work_preference || existing.work_preference) : undefined,
      }
      await c.env.DB.prepare(
        `INSERT INTO saved_searches (id, user_id, filters_json, frequency, active, created_at)
         VALUES (?, ?, ?, ?, 1, ?)`
      ).bind(nanoid(), user.id, JSON.stringify(filters), frequency, now).run()
    } else {
      await c.env.DB.prepare('UPDATE saved_searches SET active = 0 WHERE user_id = ?').bind(user.id).run()
    }
  }

  // Handle step progression and completion
  let nextStep = step
  if (step === 1 && (body.account_type || existing.account_type)) nextStep = 2
  else if (step === 2) nextStep = 3

  if (action === 'complete' || (step === 3 && body.job_alerts_enabled !== undefined)) {
    updates.push("status = 'completed'")
    updates.push('completed_at = ?')
    values.push(now)
    updates.push('current_step = 3')
  } else {
    updates.push('current_step = ?')
    values.push(Math.max(Number(existing.current_step) || 1, nextStep))
  }

  values.push(user.id)
  await c.env.DB.prepare(`UPDATE user_onboarding SET ${updates.join(', ')} WHERE user_id = ?`).bind(...values).run()

  const updated = await c.env.DB.prepare('SELECT * FROM user_onboarding WHERE user_id = ?').bind(user.id).first<any>()
  return c.json({ data: formatOnboardingRow(updated) })
})

app.get('/applications', async (c) => {
  const user = c.get('user')!
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.stage, a.version, a.submitted_at, a.updated_at, j.id as job_id, j.title, j.origin,
       COALESCE(o.name, j.company_name) as org_name, o.slug as org_slug
     FROM applications a
     JOIN jobs j ON j.id = a.job_id
     LEFT JOIN organizations o ON o.id = j.organization_id
     WHERE a.candidate_id = ? ORDER BY a.submitted_at DESC`
  )
    .bind(user.id)
    .all()
  return c.json({ data: results })
})

app.get('/external-applications', async (c) => {
  const user = c.get('user')!
  const { results } = await c.env.DB.prepare(
    `SELECT t.job_id, t.self_reported_status as status, t.marked_at, j.title,
       COALESCE(o.name, j.company_name) as org_name, s.name as source_name
     FROM external_application_trackers t
     JOIN jobs j ON j.id = t.job_id
     LEFT JOIN organizations o ON o.id = j.organization_id
     LEFT JOIN sources s ON s.id = j.source_id
     WHERE t.user_id = ? ORDER BY t.marked_at DESC`
  ).bind(user.id).all()
  return c.json({ data: results })
})

app.get('/privacy-requests', async (c) => {
  const user = c.get('user')!
  const { results } = await c.env.DB.prepare(
    'SELECT id, request_type, details, status, region, language, created_at, updated_at, resolution_note FROM privacy_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 100'
  ).bind(user.id).all()
  c.header('Cache-Control', 'private, no-store')
  return c.json({ data: results })
})

app.post('/privacy-requests', async (c) => {
  const user = c.get('user')!
  const body = await c.req.json().catch(() => ({}))
  const requestType = body.request_type
  if (!['access','correction','deletion','export','objection','withdraw_consent'].includes(requestType)) {
    return c.json({ error: { code: 'INVALID_REQUEST', message: 'Choose a supported privacy request.' } }, 400)
  }
  const details = typeof body.details === 'string' ? sanitizeText(body.details, 1000) || null : null
  const region = typeof body.region === 'string' && ['UG','EEA','UK','other','unknown'].includes(body.region) ? body.region : 'unknown'
  const language = typeof body.language === 'string' && /^[a-z]{2}(-[A-Z]{2})?$/.test(body.language) ? body.language : 'en'
  const id = nanoid()
  const now = Math.floor(Date.now() / 1000)
  await c.env.DB.prepare(
    'INSERT INTO privacy_requests (id, user_id, request_type, details, status, region, language, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)'
  ).bind(id, user.id, requestType, details, 'received', region, language, now, now).run()
  c.header('Cache-Control', 'private, no-store')
  return c.json({ data: { id, request_type: requestType, details, status: 'received', region, language, created_at: now, updated_at: now, resolution_note: null } }, 201)
})

app.get('/export', async (c) => {
  const user = c.get('user')!
  const [profile, posts, comments, applications, savedJobs, legalRecords, privacyRequests] = await Promise.all([
    c.env.DB.prepare('SELECT handle, headline, bio, country_code, visibility, availability, created_at, updated_at FROM profiles WHERE user_id = ?').bind(user.id).first(),
    c.env.DB.prepare("SELECT id, job_id, body, visibility, state, created_at, updated_at FROM posts WHERE author_id = ? AND state != 'deleted' ORDER BY created_at").bind(user.id).all(),
    c.env.DB.prepare('SELECT id, post_id, body, state, created_at FROM comments WHERE author_id = ? ORDER BY created_at').bind(user.id).all(),
    c.env.DB.prepare('SELECT id, job_id, stage, version, submitted_at, updated_at FROM applications WHERE candidate_id = ? ORDER BY submitted_at').bind(user.id).all(),
    c.env.DB.prepare('SELECT job_id, created_at FROM saved_jobs WHERE user_id = ? ORDER BY created_at').bind(user.id).all(),
    c.env.DB.prepare('SELECT document_id, document_version, action, purpose, region, language, created_at FROM legal_records WHERE user_id = ? ORDER BY created_at').bind(user.id).all(),
    c.env.DB.prepare('SELECT id, request_type, status, created_at, updated_at FROM privacy_requests WHERE user_id = ? ORDER BY created_at').bind(user.id).all(),
  ])
  c.header('Cache-Control', 'private, no-store')
  c.header('Content-Disposition', 'attachment; filename="joblite-account-export.json"')
  return c.json({ data: { exported_at: new Date().toISOString(), account: { email: user.email, display_name: user.display_name }, profile: profile || null, posts: posts.results, comments: comments.results, applications: applications.results, saved_jobs: savedJobs.results, legal_records: legalRecords.results, privacy_requests: privacyRequests.results } })
})

app.post('/privacy-consent/withdraw', async (c) => {
  const user = c.get('user')!
  const body = await c.req.json().catch(() => ({}))
  const purpose = typeof body.purpose === 'string' && ['optional_analytics','optional_marketing','optional_tracking'].includes(body.purpose) ? body.purpose : 'optional_tracking'
  const now = Math.floor(Date.now() / 1000)
  await c.env.DB.prepare(
    `INSERT INTO legal_records (id, user_id, document_id, document_version, action, purpose, region, language, created_at)
     VALUES (?,?,'privacy-choices','v1-2026-10-24','withdrawal',?,?,?,?)`
  ).bind(nanoid(), user.id, purpose, typeof body.region === 'string' ? body.region : 'unknown', typeof body.language === 'string' ? body.language : 'en', now).run()
  c.header('Cache-Control', 'private, no-store')
  return c.json({ data: { withdrawn: true, purpose, created_at: now } })
})

app.get('/saved', async (c) => {
  const user = c.get('user')!
  const { results } = await c.env.DB.prepare(
    `SELECT j.id, j.title, j.origin, j.application_method, j.workplace_arrangement, j.employment_type,
       j.published_at, j.canonical_url, j.company_name, COALESCE(o.name, j.company_name) as org_name,
       o.slug as org_slug, s.created_at as saved_at, sal.currency, sal.min_minor, sal.max_minor, sal.period
     FROM saved_jobs s
     JOIN jobs j ON j.id = s.job_id
     LEFT JOIN organizations o ON o.id = j.organization_id
     LEFT JOIN salary_ranges sal ON sal.job_id = j.id
     WHERE s.user_id = ? AND j.status = 'published'
     ORDER BY s.created_at DESC`
  )
    .bind(user.id)
    .all()
  return c.json({ data: results })
})

app.get('/notifications', async (c) => {
  const user = c.get('user')!
  const limit = clampInt(c.req.query('limit'), 1, 100, 30)
  const offset = clampInt(c.req.query('offset'), 0, 100000, 0)
  const [{ results }, unread] = await Promise.all([
    c.env.DB.prepare(
      'SELECT id, type, payload_json, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
    )
      .bind(user.id, limit, offset)
      .all(),
    unreadNotificationCount(c, user.id),
  ])
  return c.json({
    data: (results as Array<Record<string, any>>).map((row) => {
      let payload: Record<string, unknown> = {}
      try {
        payload = JSON.parse(row.payload_json || '{}')
      } catch {
        payload = {}
      }
      return { id: row.id, type: row.type, payload, read_at: row.read_at, created_at: row.created_at }
    }),
    meta: { unread_count: unread, limit, offset },
  })
})

app.patch('/notifications/:id', async (c) => {
  const user = c.get('user')!
  const id = c.req.param('id')
  const notification = await c.env.DB.prepare('SELECT id FROM notifications WHERE id = ? AND user_id = ?')
    .bind(id, user.id)
    .first()
  if (!notification) return c.json({ error: { code: 'NOT_FOUND', message: 'Notification not found' } }, 404)
  await c.env.DB.prepare('UPDATE notifications SET read_at = ? WHERE id = ?').bind(Math.floor(Date.now() / 1000), id).run()
  return c.json({ data: { id, read: true, unread_count: await unreadNotificationCount(c, user.id) } })
})

app.patch('/notifications', async (c) => {
  const user = c.get('user')!
  await c.env.DB.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL')
    .bind(Math.floor(Date.now() / 1000), user.id)
    .run()
  return c.json({ data: { read: true, unread_count: 0 } })
})

app.put('/external-applications/:jobId', async (c) => {
  const user = c.get('user')!
  const jobId = c.req.param('jobId')
  const job = await c.env.DB.prepare("SELECT id, origin FROM jobs WHERE id = ? AND status = 'published'").bind(jobId).first<any>()
  if (!job) return c.json({ error: { code: 'NOT_FOUND', message: 'Job not found' } }, 404)
  if (job.origin === 'native') {
    return c.json({ error: { code: 'INVALID', message: 'Native jobs are tracked automatically when you apply inside Joblite' } }, 400)
  }

  const statuses = ['applied', 'interviewing', 'offer', 'rejected', 'withdrawn']
  const body = await c.req.json().catch(() => ({}))
  const status = statuses.includes(body.status) ? body.status : 'applied'
  const now = Math.floor(Date.now() / 1000)
  await c.env.DB.prepare(
    `INSERT INTO external_application_trackers (id, user_id, job_id, self_reported_status, marked_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(user_id, job_id) DO UPDATE SET self_reported_status = excluded.self_reported_status, marked_at = excluded.marked_at`
  )
    .bind(nanoid(), user.id, jobId, status, now)
    .run()
  return c.json({ data: { job_id: jobId, status, marked_at: now } })
})

export default app
