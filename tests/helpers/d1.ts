import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import type { Env } from '../../src/worker/types'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => SqliteDatabase
}

type SqliteStatement = {
  all: (...params: unknown[]) => Array<Record<string, unknown>>
  get: (...params: unknown[]) => Record<string, unknown> | undefined
  run: (...params: unknown[]) => { changes: number | bigint; lastInsertRowid: number | bigint }
}

type SqliteDatabase = {
  exec: (sql: string) => void
  prepare: (sql: string) => SqliteStatement
  close: () => void
}

class BoundStatement {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly sql: string,
    private readonly params: unknown[] = [],
    private readonly shouldFailRun: () => boolean = () => false
  ) {}

  bind(...params: unknown[]): BoundStatement {
    return new BoundStatement(this.db, this.sql, params, this.shouldFailRun)
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    try {
      const row = this.db.prepare(this.sql).get(...this.params)
      return (row as T | undefined) ?? null
    } catch {
      return null
    }
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: true; meta: Record<string, unknown> }> {
    const results = this.db.prepare(this.sql).all(...this.params) as T[]
    return { results, success: true, meta: {} }
  }

  async run(): Promise<{ results: unknown[]; success: true; meta: { changes: number; last_row_id: number } }> {
    if (this.shouldFailRun()) throw new Error('injected D1 write failure')
    const result = this.db.prepare(this.sql).run(...this.params)
    return {
      results: [],
      success: true,
      meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) },
    }
  }
}

export class TestD1 {
  readonly db: SqliteDatabase
  failNextRunMatching: string | null = null

  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA foreign_keys = ON')
  }

  prepare(sql: string): BoundStatement {
    return new BoundStatement(this.db, sql, [], () => {
      if (!this.failNextRunMatching || !sql.includes(this.failNextRunMatching)) return false
      this.failNextRunMatching = null
      return true
    })
  }

  async batch(statements: BoundStatement[]): Promise<unknown[]> {
    this.db.exec('BEGIN')
    try {
      const results: unknown[] = []
      for (const statement of statements) results.push(await statement.run())
      this.db.exec('COMMIT')
      return results
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql)
  }

  close(): void {
    this.db.close()
  }
}

/** Applies the real project migrations, in order, to a fresh in-memory database. */
export function applyMigrations(d1: TestD1): void {
  const directory = resolve(process.cwd(), 'migrations')
  const files = readdirSync(directory)
    .filter((file) => file.endsWith('.sql'))
    .sort()
  for (const file of files) {
    d1.db.exec(readFileSync(resolve(directory, file), 'utf8'))
  }
}

export function createTestEnv(): { env: Env; d1: TestD1; close: () => void } {
  const d1 = new TestD1()
  applyMigrations(d1)
  const env = {
    DB: d1 as unknown as D1Database,
    MEDIA: {} as R2Bucket,
    OUTBOX_QUEUE: { send: async () => undefined } as unknown as Queue,
    INGEST_QUEUE: { send: async () => undefined } as unknown as Queue,
    ENVIRONMENT: 'test',
    APP_URL: 'https://joblite.test',
    SESSION_SECRET: 'test-session-secret',
    CSRF_SECRET: 'test-csrf-secret',
    INGEST_TOKEN: 'test-ingest-token',
  } as Env
  return { env, d1, close: () => d1.close() }
}

export async function insertSource(
  env: Env,
  source: { id: string; name?: string; adapter?: string; feed_url?: string; config?: Record<string, unknown>; enabled?: number }
): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  await env.DB.prepare(
    `INSERT INTO sources (id, name, kind, base_url, permission_state, enabled, config_json, feed_url, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      source.id,
      source.name || source.id,
      'api',
      'https://example.com',
      'import_allowed',
      source.enabled ?? 1,
      JSON.stringify({ adapter: source.adapter || 'fixture', min_interval_seconds: 0, ...(source.config || {}) }),
      source.feed_url || 'https://example.com/feed.json',
      now,
      now
    )
    .run()
}

export async function insertJob(
  env: Env,
  job: {
    id: string
    title?: string
    body?: string
    company?: string | null
    sourceId?: string | null
    sourceJobId?: string | null
    origin?: 'native' | 'imported'
    status?: string
    publishedAt?: number | null
    discoveredAt?: number | null
    workplace?: string | null
    locationText?: string | null
    applicationUrl?: string | null
    canonicalUrl?: string | null
  }
): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  await env.DB.prepare(
    `INSERT INTO jobs (id, origin, source_id, source_job_id, company_name, title, body, workplace_arrangement,
       application_method, status, published_at, discovered_at, checked_at, last_seen_at, canonical_url,
       application_url, location_text, canonical_key, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      job.id,
      job.origin || 'imported',
      job.sourceId ?? null,
      job.sourceJobId ?? null,
      job.company ?? 'Example Co',
      job.title || 'Example Job',
      job.body || 'A real job description for testing.',
      job.workplace ?? 'remote',
      job.origin === 'native' ? 'native' : 'external',
      job.status || 'published',
      job.publishedAt ?? now,
      job.discoveredAt ?? now,
      now,
      now,
      job.canonicalUrl ?? job.applicationUrl ?? null,
      job.applicationUrl ?? job.canonicalUrl ?? null,
      job.locationText ?? null,
      null,
      now,
      now
    )
    .run()
}
