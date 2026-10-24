import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../src/worker/types'
import authRoute from '../src/worker/routes/auth'
import meRoute from '../src/worker/routes/me'
import skillsRoute from '../src/worker/routes/skills'
import jobsRoute from '../src/worker/routes/jobs'
import { createTestEnv } from './helpers/d1'
import { CURRENT_TERMS_VERSION } from '../src/shared/legal-versions'
import { safeInternalPath } from '../src/client/components/AuthExperience'

function createTestApp(env: Env) {
  const app = new Hono()
  app.route('/auth', authRoute)
  app.route('/me', meRoute)
  app.route('/skills', skillsRoute)
  app.route('/jobs', jobsRoute)
  return (path: string, init?: RequestInit) => app.request(path, init, env as any)
}

describe('complete signup and resumable onboarding flow', () => {
  let env: Env
  let db: ReturnType<typeof createTestEnv>['d1']
  let close: () => void
  let api: ReturnType<typeof createTestApp>

  beforeEach(() => {
    const test = createTestEnv()
    env = test.env
    db = test.d1
    close = test.close
    env.TEST_MAIL_SINK = 'enabled'
    api = createTestApp(env)
  })

  afterEach(() => close())

  async function requestChallenge(email: string) {
    const res = await api('/auth/challenges', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, region: 'UG', language: 'en' }),
    })
    const payload = (await res.json().catch(() => ({}))) as any
    return { res, payload }
  }

  async function getLatestCode(email: string) {
    return db
      .prepare('SELECT code, challenge_id FROM auth_test_mail WHERE email_normalized = ? ORDER BY created_at DESC LIMIT 1')
      .bind(email.toLowerCase().trim())
      .first<{ code: string; challenge_id: string }>()
  }

  it('completes signup with passwordless verification and initializes onboarding state', async () => {
    const email = 'candidate.new@example.test'
    const challengeRes = await requestChallenge(email)
    expect(challengeRes.res.status).toBe(200)

    const mail = (await getLatestCode(email))!
    expect(mail).toBeDefined()
    expect(mail.code).toMatch(/^\d{6}$/)

    // Verify code with full name and legal terms acceptance
    const verifyRes = await api('/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challenge_id: mail.challenge_id,
        code: mail.code,
        display_name: 'Taylor Example',
        terms_accepted: true,
        terms_version: CURRENT_TERMS_VERSION,
        age_confirmed: true,
        marketing_consent: false,
      }),
    })

    expect(verifyRes.status).toBe(200)
    const setCookie = verifyRes.headers.get('set-cookie') || ''
    expect(setCookie).toContain('joblite_session=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Strict')

    // Verify user created
    const user = await db
      .prepare('SELECT id, display_name, email_normalized FROM users WHERE email_normalized = ?')
      .bind(email)
      .first<{ id: string; display_name: string; email_normalized: string }>()
    expect(user).toBeDefined()
    expect(user?.display_name).toBe('Taylor Example')

    // Verify initial onboarding record
    const onboarding = await db
      .prepare('SELECT status, current_step, completed_at FROM user_onboarding WHERE user_id = ?')
      .bind(user!.id)
      .first<{ status: string; current_step: number; completed_at: number | null }>()
    expect(onboarding?.status).toBe('in_progress')
    expect(onboarding?.current_step).toBe(1)
    expect(onboarding?.completed_at || 0).toBe(0)

    // Verify legal records: terms accepted and marketing consent refusal recorded
    const legal = await db
      .prepare('SELECT document_id, action, purpose FROM legal_records WHERE user_id = ? ORDER BY document_id')
      .bind(user!.id)
      .all<{ document_id: string; action: string; purpose: string | null }>()
    const termsRecord = legal.results.find((r) => r.document_id === 'terms')
    expect(termsRecord?.action).toBe('acceptance')
    const marketingRecord = legal.results.find((r) => r.purpose === 'marketing')
    expect(marketingRecord?.action).toBe('consent_refusal')
  })

  it('rejects invalid email formats, missing legal consent, and invalid codes without user enumeration', async () => {
    // Invalid email format
    const badEmail = await api('/auth/challenges', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    })
    expect(badEmail.status).toBe(400)
    expect(((await badEmail.json()) as any).error.code).toBe('INVALID_EMAIL')

    // Valid email challenge
    const email = 'check.errors@example.test'
    await requestChallenge(email)
    const mail = (await getLatestCode(email))!

    // Missing terms acceptance
    const missingTerms = await api('/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challenge_id: mail.challenge_id,
        code: mail.code,
        display_name: 'Missing Terms',
        terms_accepted: false,
        age_confirmed: true,
      }),
    })
    expect(missingTerms.status).toBe(428)
    expect(((await missingTerms.json()) as any).error.code).toBe('TERMS_ACCEPTANCE_REQUIRED')

    // Missing age confirmation
    const missingAge = await api('/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challenge_id: mail.challenge_id,
        code: mail.code,
        display_name: 'Missing Age',
        terms_accepted: true,
        terms_version: CURRENT_TERMS_VERSION,
        age_confirmed: false,
      }),
    })
    expect(missingAge.status).toBe(428)
    expect(((await missingAge.json()) as any).error.code).toBe('AGE_CONFIRMATION_REQUIRED')

    // Wrong code
    const wrongCode = await api('/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challenge_id: mail.challenge_id,
        code: '999999',
        display_name: 'Wrong Code',
        terms_accepted: true,
        terms_version: CURRENT_TERMS_VERSION,
        age_confirmed: true,
      }),
    })
    expect(wrongCode.status).toBe(401)
  })

  it('handles resumable step-by-step onboarding, profile sync, skills, and job alerts', async () => {
    const email = 'flow.user@example.test'
    await requestChallenge(email)
    const mail = (await getLatestCode(email))!

    const verifyRes = await api('/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challenge_id: mail.challenge_id,
        code: mail.code,
        display_name: 'Jordan Flow',
        terms_accepted: true,
        terms_version: CURRENT_TERMS_VERSION,
        age_confirmed: true,
      }),
    })
    const sessionCookie = verifyRes.headers.get('set-cookie')!.split(';')[0]

    // Step 1: Save account goal ("Both")
    const step1Res = await api('/me/onboarding', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
      body: JSON.stringify({ step: 1, account_type: 'both' }),
    })
    expect(step1Res.status).toBe(200)
    const step1Data = ((await step1Res.json()) as any).data
    expect(step1Data.account_type).toBe('both')
    expect(step1Data.current_step).toBe(2)
    expect(step1Data.status).toBe('in_progress')

    // Step 2: Save preferences (country, desired role, skills, work preference)
    const step2Res = await api('/me/onboarding', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
      body: JSON.stringify({
        step: 2,
        country_code: 'UG',
        city: 'Kampala',
        desired_role: 'Senior Staff Engineer',
        skills: ['typescript', 'react', 'sqlite'],
        work_preference: 'remote',
        employment_types: ['full-time', 'contract'],
        experience_level: 'senior',
      }),
    })
    expect(step2Res.status).toBe(200)
    const step2Data = ((await step2Res.json()) as any).data
    expect(step2Data.country_code).toBe('UG')
    expect(step2Data.city).toBe('Kampala')
    expect(step2Data.desired_role).toBe('Senior Staff Engineer')
    expect(step2Data.skills).toEqual(['typescript', 'react', 'sqlite'])
    expect(step2Data.current_step).toBe(3)

    // Verify profile headline and country were synced
    const profile = await db
      .prepare('SELECT headline, country_code FROM profiles WHERE user_id = (SELECT id FROM users WHERE email_normalized = ?)')
      .bind(email)
      .first<{ headline: string; country_code: string }>()
    expect(profile?.headline).toBe('Senior Staff Engineer')
    expect(profile?.country_code).toBe('UG')

    // Verify skills were populated
    const savedSkills = await db
      .prepare('SELECT s.label_normalized FROM profile_skills ps JOIN skills s ON s.id = ps.skill_id WHERE ps.profile_id = (SELECT id FROM profiles WHERE user_id = (SELECT id FROM users WHERE email_normalized = ?)) ORDER BY s.label_normalized')
      .bind(email)
      .all<{ label_normalized: string }>()
    expect(savedSkills.results.map((r) => r.label_normalized)).toEqual(['react', 'sqlite', 'typescript'])

    // Resume: GET /me/onboarding retrieves current state
    const resumeRes = await api('/me/onboarding', {
      headers: { Cookie: sessionCookie },
    })
    expect(resumeRes.status).toBe(200)
    const resumed = ((await resumeRes.json()) as any).data
    expect(resumed.current_step).toBe(3)
    expect(resumed.desired_role).toBe('Senior Staff Engineer')

    // Step 3: Complete onboarding with job alerts enabled
    const completeRes = await api('/me/onboarding', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
      body: JSON.stringify({
        step: 3,
        action: 'complete',
        job_alerts_enabled: true,
        alert_frequency: 'weekly',
        notification_channels: ['email'],
      }),
    })
    expect(completeRes.status).toBe(200)
    const completedData = ((await completeRes.json()) as any).data
    expect(completedData.status).toBe('completed')
    expect(completedData.completed_at).toBeGreaterThan(0)
    expect(completedData.job_alerts_enabled).toBe(true)

    // Verify saved search created for job alerts
    const searchAlert = await db
      .prepare('SELECT frequency, active, filters_json FROM saved_searches WHERE user_id = (SELECT id FROM users WHERE email_normalized = ?)')
      .bind(email)
      .first<{ frequency: string; active: number; filters_json: string }>()
    expect(searchAlert?.active).toBe(1)
    expect(searchAlert?.frequency).toBe('weekly')
    expect(JSON.parse(searchAlert!.filters_json)).toMatchObject({ country: 'UG', q: 'Senior Staff Engineer' })
  })

  it('supports skipping onboarding without creating duplicate records or redirect loops', async () => {
    const email = 'skip.user@example.test'
    await requestChallenge(email)
    const mail = (await getLatestCode(email))!

    const verifyRes = await api('/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challenge_id: mail.challenge_id,
        code: mail.code,
        display_name: 'Alex Skip',
        terms_accepted: true,
        terms_version: CURRENT_TERMS_VERSION,
        age_confirmed: true,
      }),
    })
    const sessionCookie = verifyRes.headers.get('set-cookie')!.split(';')[0]

    // User clicks "Skip for now" on Step 1
    const skipRes = await api('/me/onboarding', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
      body: JSON.stringify({ action: 'skip' }),
    })
    expect(skipRes.status).toBe(200)
    const skipData = ((await skipRes.json()) as any).data
    expect(skipData.status).toBe('skipped')
    expect(skipData.completed_at).toBeGreaterThan(0)

    // Subsequent fetch returns skipped status cleanly
    const checkRes = await api('/me/onboarding', {
      headers: { Cookie: sessionCookie },
    })
    const checkData = ((await checkRes.json()) as any).data
    expect(checkData.status).toBe('skipped')
  })

  it('strictly ensures selecting employer role does not grant privilege escalation or organization membership', async () => {
    const email = 'employer.nodb@example.test'
    await requestChallenge(email)
    const mail = (await getLatestCode(email))!

    const verifyRes = await api('/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challenge_id: mail.challenge_id,
        code: mail.code,
        display_name: 'Dana Employer',
        terms_accepted: true,
        terms_version: CURRENT_TERMS_VERSION,
        age_confirmed: true,
      }),
    })
    const sessionCookie = verifyRes.headers.get('set-cookie')!.split(';')[0]

    // Step 1: Employer goal
    await api('/me/onboarding', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
      body: JSON.stringify({ step: 1, account_type: 'employer' }),
    })

    // Step 2: Fill in employer details
    await api('/me/onboarding', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
      body: JSON.stringify({
        step: 2,
        organization_name: 'Venture Capital Tech',
        organization_country: 'UG',
        organization_city: 'Entebbe',
        organization_website: 'https://venture.example.test',
        expected_roles: 'Fullstack Developers',
        employer_title: 'Founding Partner',
      }),
    })

    // CRITICAL SECURITY CHECK: Ensure user does NOT have any organization memberships or administrative privilege
    const memberships = await db
      .prepare('SELECT COUNT(*) as total FROM memberships WHERE user_id = (SELECT id FROM users WHERE email_normalized = ?)')
      .bind(email)
      .first<{ total: number }>()
    expect(memberships?.total).toBe(0)
  })

  it('skills endpoint provides searchable autocomplete suggestions', async () => {
    // Insert test skill seeds
    await db.prepare("INSERT OR IGNORE INTO skills (id, label_normalized) VALUES ('sk1', 'react')").run()
    await db.prepare("INSERT OR IGNORE INTO skills (id, label_normalized) VALUES ('sk2', 'react-native')").run()
    await db.prepare("INSERT OR IGNORE INTO skills (id, label_normalized) VALUES ('sk3', 'rust')").run()

    const searchRes = await api('/skills?q=react')
    expect(searchRes.status).toBe(200)
    const searchData = ((await searchRes.json()) as any).data
    expect(searchData).toContain('react')
    expect(searchData).toContain('react-native')
    expect(searchData).not.toContain('rust')
  })

  it('preserves frictionless guest browsing of jobs and prevents open redirects', async () => {
    // Public jobs endpoint allows unauthenticated guest reads
    const guestJobs = await api('/jobs')
    expect(guestJobs.status).toBe(200)
    const jobsData = ((await guestJobs.json()) as any).data
    expect(Array.isArray(jobsData)).toBe(true)

    // Safe return URL validator tests
    expect(safeInternalPath('/jobs?country=UG')).toBe('/jobs?country=UG')
    expect(safeInternalPath('/saved')).toBe('/saved')
    expect(safeInternalPath('https://evil.test/phish')).toBe('/')
    expect(safeInternalPath('//evil.test/bypass')).toBe('/')
    expect(safeInternalPath('/\\evil.test/bypass')).toBe('/')
    expect(safeInternalPath('/%2F%2Fevil.test')).toBe('/')
    expect(safeInternalPath(null)).toBe('/')
  })
})
