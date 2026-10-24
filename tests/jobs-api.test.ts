import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../src/worker/types'
import jobsRoute from '../src/worker/routes/jobs'
import { createTestEnv, insertJob, insertSource } from './helpers/d1'

function api(env: Env) {
  const app = new Hono()
  app.route('/api/v1/jobs', jobsRoute)
  return (path: string) => app.request(path, undefined, env as any)
}

describe('jobs API', () => {
  let env: Env
  let close: () => void

  beforeEach(async () => {
    const test = createTestEnv()
    env = test.env
    close = test.close
    await insertSource(env, { id: 'src_api', name: 'API source' })
    await insertJob(env, {
      id: 'job-a',
      title: 'Senior React Engineer',
      body: 'Build web applications.',
      company: 'Alpha',
      sourceId: 'src_api',
      sourceJobId: 'a-1',
      publishedAt: 1_792_000_300,
      workplace: 'remote',
      applicationUrl: 'https://example.com/jobs/a',
      locationText: 'Germany',
    })
    await insertJob(env, {
      id: 'job-b',
      title: 'Backend Engineer',
      body: 'Build APIs.',
      company: 'Beta',
      publishedAt: 1_792_000_200,
      workplace: 'hybrid',
      applicationUrl: 'https://example.com/jobs/b',
      locationText: 'Canada',
    })
    await insertJob(env, {
      id: 'job-c',
      title: 'Designer',
      body: 'Design products.',
      company: 'Gamma',
      publishedAt: 1_792_000_100,
      workplace: 'onsite',
      applicationUrl: 'https://example.com/jobs/c',
      locationText: 'France',
    })
    const now = Math.floor(Date.now() / 1000)
    await env.DB.prepare('INSERT INTO job_locations (id, job_id, country_code, city) VALUES (?,?,?,?)')
      .bind('loc-a', 'job-a', 'DE', 'Berlin')
      .run()
    await env.DB.prepare('INSERT INTO skills (id, label_normalized) VALUES (?,?)').bind('skill-react', 'react').run()
    await env.DB.prepare('INSERT INTO job_skills (job_id, skill_id) VALUES (?,?)').bind('job-a', 'skill-react').run()
    await env.DB.prepare('UPDATE jobs SET checked_at = ?').bind(now).run()
  })

  afterEach(() => close())

  it('paginates with a stable publication order and exposes catalog metadata', async () => {
    const response = await api(env)('/api/v1/jobs?limit=1&offset=1')
    expect(response.status).toBe(200)
    const payload = await response.json() as any
    expect(payload.data).toHaveLength(1)
    expect(payload.data[0].id).toBe('job-b')
    expect(payload.meta.total).toBe(3)
    expect(payload.meta.catalog_total).toBe(3)
    expect(payload.meta.has_more).toBe(true)
    expect(payload.meta.next_offset).toBe(2)
    expect(payload.meta.last_updated_at).toBeNull()
  })

  it('filters by country, remote status, source and skills', async () => {
    const byCountry = await (await api(env)('/api/v1/jobs?country=DE')).json() as any
    expect(byCountry.data.map((job: any) => job.id)).toEqual(['job-a'])

    const byRemote = await (await api(env)('/api/v1/jobs?remote=1')).json() as any
    expect(byRemote.data.map((job: any) => job.id)).toEqual(['job-a'])

    const bySource = await (await api(env)('/api/v1/jobs?source=src_api')).json() as any
    expect(bySource.data.map((job: any) => job.id)).toEqual(['job-a'])

    const bySkill = await (await api(env)('/api/v1/jobs?q=react')).json() as any
    expect(bySkill.data.map((job: any) => job.id)).toEqual(['job-a'])

    const byCompany = await (await api(env)('/api/v1/jobs?q=gamma')).json() as any
    expect(byCompany.data.map((job: any) => job.id)).toEqual(['job-c'])
  })

  it('returns an error response instead of a misleading empty feed when the database fails', async () => {
    const failingEnv = {
      ...env,
      DB: { prepare: () => { throw new Error('database down') } },
    } as unknown as Env
    const response = await api(failingEnv)('/api/v1/jobs?limit=10')
    expect(response.status).toBe(503)
    const payload = await response.json() as any
    expect(payload.error.code).toBe('FEED_UNAVAILABLE')
  })
})
