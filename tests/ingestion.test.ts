import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Env } from '../src/worker/types'
import { runIngestion } from '../src/worker/lib/ingestion'
import type { NormalizedJob } from '../src/worker/lib/providers/common'
import type { ProviderAdapter } from '../src/worker/lib/providers/types'
import { createTestEnv, insertSource } from './helpers/d1'

function makeJob(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    sourceJobId: 'job-1',
    title: 'Senior Engineer',
    company: 'Example Co',
    description: 'Build useful tools with a global team.',
    employmentType: 'full-time',
    workplaceArrangement: 'remote',
    locationText: 'Worldwide',
    city: null,
    countryCodes: [],
    eligibilityMode: 'worldwide',
    eligibilityEvidence: 'Fixture states worldwide',
    originalUrl: 'https://example.com/jobs/1',
    applicationUrl: 'https://example.com/jobs/1',
    publishedAt: 1_792_000_000,
    providerUpdatedAt: null,
    expiresAt: null,
    salaryText: '$100k',
    salary: { minMinor: 10_000_000, maxMinor: null, currency: 'USD', period: null },
    tags: ['React', 'TypeScript'],
    category: null,
    ...overrides,
  }
}

function fixtureAdapter(
  records: NormalizedJob[],
  options: { complete?: boolean; fail?: string; malformed?: boolean } = {}
): ProviderAdapter {
  return {
    id: 'fixture',
    async fetchRecords() {
      if (options.fail) throw new Error(options.fail)
      return { records, complete: options.complete ?? true }
    },
    normalize(record) {
      if (options.malformed) return null
      return record as NormalizedJob
    },
  }
}

describe('job ingestion', () => {
  let env: Env
  let close: () => void

  beforeEach(() => {
    const test = createTestEnv()
    env = test.env
    close = test.close
  })

  afterEach(() => close())

  it('imports idempotently without duplicating jobs or links', async () => {
    await insertSource(env, { id: 'src_a', adapter: 'fixture' })
    const jobs = [makeJob(), makeJob({ sourceJobId: 'job-2', applicationUrl: 'https://example.com/jobs/2' })]
    const adapters = { fixture: fixtureAdapter(jobs) }

    const first = await runIngestion(env, { sourceIds: ['src_a'], ignoreInterval: true, adapters })
    expect(first.jobs_inserted).toBe(2)
    expect(first.sources_failed).toBe(0)

    const second = await runIngestion(env, { sourceIds: ['src_a'], ignoreInterval: true, adapters })
    expect(second.jobs_inserted).toBe(0)
    expect(second.jobs_updated).toBe(2)

    const count = await env.DB.prepare('SELECT COUNT(*) as total FROM jobs').first<{ total: number }>()
    const links = await env.DB.prepare('SELECT COUNT(*) as total FROM job_source_links').first<{ total: number }>()
    expect(count?.total).toBe(2)
    expect(links?.total).toBe(2)
  })

  it('collapses an exact canonical URL from two providers into one job with two provenance links', async () => {
    await insertSource(env, { id: 'src_a', adapter: 'fixture_a' })
    await insertSource(env, { id: 'src_b', adapter: 'fixture_b' })
    const adapters = {
      fixture_a: fixtureAdapter([makeJob({ sourceJobId: 'a-1', title: 'Engineer from A' })]),
      fixture_b: fixtureAdapter([
        makeJob({ sourceJobId: 'b-1', title: 'Engineer from B', applicationUrl: 'https://example.com/jobs/1?utm_source=b' }),
      ]),
    }

    const summary = await runIngestion(env, { sourceIds: ['src_a', 'src_b'], ignoreInterval: true, adapters })
    expect(summary.jobs_inserted).toBe(1)
    expect(summary.duplicates_linked).toBe(1)

    const count = await env.DB.prepare('SELECT COUNT(*) as total FROM jobs').first<{ total: number }>()
    const links = await env.DB.prepare('SELECT COUNT(*) as total FROM job_source_links').first<{ total: number }>()
    const title = await env.DB.prepare('SELECT title FROM jobs LIMIT 1').first<{ title: string }>()
    expect(count?.total).toBe(1)
    expect(links?.total).toBe(2)
    expect(title?.title).toBe('Engineer from A')
  })

  it('keeps existing jobs when one provider fails, and only expires after a complete run plus grace', async () => {
    await insertSource(env, { id: 'src_ok', adapter: 'ok' })
    await insertSource(env, { id: 'src_bad', adapter: 'bad' })
    const okAdapter = fixtureAdapter([makeJob()])
    const failingAdapter = fixtureAdapter([], { fail: 'Provider responded with HTTP 503', complete: false })

    const seeded = await runIngestion(env, { sourceIds: ['src_ok'], ignoreInterval: true, adapters: { ok: okAdapter } })
    expect(seeded.jobs_inserted).toBe(1)

    const failure = await runIngestion(env, {
      sourceIds: ['src_bad'],
      ignoreInterval: true,
      adapters: { bad: failingAdapter },
    })
    expect(failure.sources_failed).toBe(1)

    const stillPublished = await env.DB.prepare("SELECT status FROM jobs LIMIT 1").first<{ status: string }>()
    expect(stillPublished?.status).toBe('published')
    const badSource = await env.DB.prepare('SELECT last_error FROM sources WHERE id = ?').bind('src_bad').first<{ last_error: string | null }>()
    expect(badSource?.last_error).toContain('503')

    // Make the link older than the seven-day grace window without deleting the job.
    const old = Math.floor(Date.now() / 1000) - 8 * 24 * 60 * 60
    await env.DB.prepare('UPDATE job_source_links SET last_seen_at = ? WHERE source_id = ?').bind(old, 'src_ok').run()
    await env.DB.prepare('UPDATE jobs SET last_seen_at = ?').bind(old).run()

    // An incomplete feed must not mass-expire jobs.
    await runIngestion(env, {
      sourceIds: ['src_ok'],
      ignoreInterval: true,
      adapters: { ok: fixtureAdapter([], { complete: false }) },
    })
    const afterIncomplete = await env.DB.prepare("SELECT status FROM jobs LIMIT 1").first<{ status: string }>()
    expect(afterIncomplete?.status).toBe('published')

    // A complete reconciliation with the job absent closes it after the grace period.
    await runIngestion(env, {
      sourceIds: ['src_ok'],
      ignoreInterval: true,
      adapters: { ok: fixtureAdapter([], { complete: true }) },
    })
    const afterComplete = await env.DB.prepare("SELECT status FROM jobs LIMIT 1").first<{ status: string }>()
    expect(afterComplete?.status).toBe('closed')
  })

  it('records malformed provider data as a failure instead of publishing partial garbage', async () => {
    await insertSource(env, { id: 'src_bad_shape', adapter: 'malformed' })
    const summary = await runIngestion(env, {
      sourceIds: ['src_bad_shape'],
      ignoreInterval: true,
      adapters: { malformed: fixtureAdapter([makeJob()], { malformed: true }) },
    })
    expect(summary.sources_failed).toBe(1)
    expect(summary.results[0]?.error).toContain('none could be normalized')
    const count = await env.DB.prepare('SELECT COUNT(*) as total FROM jobs').first<{ total: number }>()
    expect(count?.total).toBe(0)
  })

  it('respects provider refresh intervals', async () => {
    await insertSource(env, { id: 'src_interval', adapter: 'fixture', config: { min_interval_seconds: 3600 } })
    const adapters = { fixture: fixtureAdapter([makeJob()]) }
    await runIngestion(env, { sourceIds: ['src_interval'], ignoreInterval: true, adapters })
    const skipped = await runIngestion(env, { sourceIds: ['src_interval'], adapters })
    expect(skipped.sources_skipped).toBe(1)
    expect(skipped.results[0]?.note).toContain('interval')
  })
})
