import { nanoid } from 'nanoid'
import type { Env } from '../types'
import { isRecord } from './validate'
import { getAdapter } from './providers'
import {
  buildCountryIndex,
  canonicalUrlKey,
  type NormalizedJob,
  type CountryIndex,
  type CountryRow,
} from './providers/common'
import type { AdapterContext, ProviderAdapter, ProviderConfig, SourceRow } from './providers/types'

const DEFAULT_MIN_INTERVAL_SECONDS = 30 * 60
const OVERLAP_WINDOW_SECONDS = 30 * 60
const RETENTION_GRACE_SECONDS = 7 * 24 * 60 * 60
const STALE_AFTER_SECONDS = 2 * 60 * 60
const STALE_SOURCE_SECONDS = 7 * 24 * 60 * 60

export type SourceResult = {
  source_id: string
  name: string
  state: 'success' | 'failed' | 'skipped'
  inserted: number
  updated: number
  duplicates: number
  invalid: number
  records: number
  complete: boolean
  note?: string
  error?: string
}

export type IngestionSummary = {
  started_at: number
  finished_at: number
  sources_considered: number
  sources_run: number
  sources_skipped: number
  sources_failed: number
  jobs_inserted: number
  jobs_updated: number
  jobs_closed: number
  duplicates_linked: number
  results: SourceResult[]
}

type RunContext = {
  env: Env
  now: number
  countryIndex: CountryIndex
  validCountries: Set<string>
  skillCache: Map<string, string>
  adapters?: Record<string, ProviderAdapter>
}

function parseConfig(source: SourceRow): ProviderConfig {
  try {
    const parsed = JSON.parse(source.config_json || '{}')
    return isRecord(parsed) ? (parsed as ProviderConfig) : {}
  } catch {
    return {}
  }
}

function truncateError(message: string): string {
  return message.replace(/\s+/g, ' ').trim().slice(0, 500)
}

function resultFor(source: SourceRow, state: SourceResult['state']): SourceResult {
  return {
    source_id: source.id,
    name: source.name,
    state,
    inserted: 0,
    updated: 0,
    duplicates: 0,
    invalid: 0,
    records: 0,
    complete: false,
  }
}

async function loadGeography(env: Env): Promise<{ rows: CountryRow[]; index: CountryIndex; valid: Set<string> }> {
  const { results } = await env.DB.prepare('SELECT code, name FROM countries').all()
  const rows = (results as Array<Record<string, unknown>>)
    .filter((row): row is CountryRow => typeof row.code === 'string' && typeof row.name === 'string')
  return {
    rows,
    index: buildCountryIndex(rows),
    valid: new Set(rows.map((row) => row.code)),
  }
}

async function skillIdFor(context: RunContext, label: string): Promise<string> {
  const normalized = label.trim().toLowerCase()
  const cached = context.skillCache.get(normalized)
  if (cached) return cached
  const existing = await context.env.DB.prepare('SELECT id FROM skills WHERE label_normalized = ?')
    .bind(normalized)
    .first<{ id: string }>()
  if (existing) {
    context.skillCache.set(normalized, existing.id)
    return existing.id
  }
  const id = nanoid()
  await context.env.DB.prepare('INSERT OR IGNORE INTO skills (id, label_normalized) VALUES (?,?)')
    .bind(id, normalized)
    .run()
  const created = await context.env.DB.prepare('SELECT id FROM skills WHERE label_normalized = ?')
    .bind(normalized)
    .first<{ id: string }>()
  const resolved = created?.id || id
  context.skillCache.set(normalized, resolved)
  return resolved
}

async function upsertJob(
  context: RunContext,
  source: SourceRow,
  job: NormalizedJob
): Promise<{ inserted: boolean; duplicate: boolean }> {
  const now = context.now
  const canonicalKey = canonicalUrlKey(job.applicationUrl) || canonicalUrlKey(job.originalUrl)
  const existingLink = await context.env.DB.prepare(
    'SELECT job_id FROM job_source_links WHERE source_id = ? AND source_job_id = ?'
  )
    .bind(source.id, job.sourceJobId)
    .first<{ job_id: string }>()

  let jobId: string | null = existingLink?.job_id || null
  let duplicate = false
  let inserted = false

  if (!jobId && canonicalKey) {
    const candidate = await context.env.DB.prepare(
      `SELECT id, origin FROM jobs
       WHERE canonical_key = ? AND origin = 'imported' AND status IN ('published','closed')
       ORDER BY created_at ASC LIMIT 1`
    )
      .bind(canonicalKey)
      .first<{ id: string; origin: string }>()
    if (candidate && candidate.origin === 'imported') {
      jobId = candidate.id
      duplicate = true
    }
  }

  const primary = jobId
    ? (await context.env.DB.prepare('SELECT source_id FROM jobs WHERE id = ?').bind(jobId).first<{ source_id: string | null }>())
        ?.source_id === source.id
    : true

  const statements: D1PreparedStatement[] = []
  const countryCodes = job.countryCodes.filter((code) => context.validCountries.has(code))

  if (!jobId) {
    jobId = nanoid()
    inserted = true
    const columns = [
      'id',
      'origin',
      'source_id',
      'source_job_id',
      'company_name',
      'title',
      'body',
      'employment_type',
      'workplace_arrangement',
      'application_method',
      'status',
      'published_at',
      'discovered_at',
      'checked_at',
      'expires_at',
      'canonical_url',
      'application_url',
      'location_text',
      'salary_text',
      'canonical_key',
      'last_seen_at',
      'last_fetched_at',
      'provider_updated_at',
      'version',
      'created_at',
      'updated_at',
    ]
    const values = [
      jobId,
      'imported',
      source.id,
      job.sourceJobId,
      job.company,
      job.title,
      job.description,
      job.employmentType,
      job.workplaceArrangement,
      'external',
      'published',
      job.publishedAt,
      now,
      now,
      job.expiresAt,
      job.originalUrl,
      job.applicationUrl,
      job.locationText,
      job.salaryText,
      canonicalKey,
      now,
      now,
      job.providerUpdatedAt,
      1,
      now,
      now,
    ]
    statements.push(
      context.env.DB.prepare(
        `INSERT INTO jobs (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(',')})`
      ).bind(...values)
    )
  } else if (primary) {
    statements.push(
      context.env.DB.prepare(
        `UPDATE jobs SET title = ?, body = ?, company_name = ?, employment_type = ?, workplace_arrangement = ?,
           published_at = COALESCE(?, published_at), expires_at = ?, canonical_url = ?, application_url = ?,
           location_text = ?, salary_text = ?, canonical_key = COALESCE(?, canonical_key),
           provider_updated_at = COALESCE(?, provider_updated_at), checked_at = ?, last_seen_at = ?,
           last_fetched_at = ?, status = 'published', updated_at = ?, version = version + 1
         WHERE id = ?`
      ).bind(
        job.title,
        job.description,
        job.company,
        job.employmentType,
        job.workplaceArrangement,
        job.publishedAt,
        job.expiresAt,
        job.originalUrl,
        job.applicationUrl,
        job.locationText,
        job.salaryText,
        canonicalKey,
        job.providerUpdatedAt,
        now,
        now,
        now,
        now,
        jobId
      )
    )
  } else {
    // Another approved source lists the same canonical vacancy. Keep one row,
    // preserve its primary source data, and record this provenance link.
    duplicate = true
    statements.push(
      context.env.DB.prepare(
        `UPDATE jobs SET last_seen_at = ?, last_fetched_at = ?, checked_at = ?,
           application_url = COALESCE(application_url, ?), status = 'published',
           expires_at = CASE WHEN expires_at IS NOT NULL AND expires_at < ? THEN NULL ELSE expires_at END
         WHERE id = ?`
      ).bind(now, now, now, job.applicationUrl, now, jobId)
    )
  }

  statements.push(
    context.env.DB.prepare(
      `INSERT INTO job_source_links (id, job_id, source_id, source_job_id, canonical_url, first_seen_at, last_seen_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(source_id, source_job_id) DO UPDATE SET
         job_id = excluded.job_id,
         canonical_url = excluded.canonical_url,
         last_seen_at = excluded.last_seen_at`
    ).bind(nanoid(), jobId, source.id, job.sourceJobId, job.applicationUrl, now, now)
  )

  statements.push(
    context.env.DB.prepare(
      `INSERT INTO job_eligibility (id, job_id, mode, evidence) VALUES (?,?,?,?)
       ON CONFLICT(job_id) DO UPDATE SET mode = excluded.mode, evidence = excluded.evidence`
    ).bind(nanoid(), jobId, job.eligibilityMode, job.eligibilityEvidence)
  )

  if (primary) {
    statements.push(context.env.DB.prepare('DELETE FROM job_locations WHERE job_id = ?').bind(jobId))
    for (const code of countryCodes) {
      statements.push(
        context.env.DB.prepare('INSERT INTO job_locations (id, job_id, country_code, city) VALUES (?,?,?,?)')
          .bind(nanoid(), jobId, code, job.city)
      )
    }
  }

  if (primary) {
    statements.push(context.env.DB.prepare('DELETE FROM job_skills WHERE job_id = ?').bind(jobId))
  }
  for (const tag of job.tags.slice(0, 12)) {
    const skillId = await skillIdFor(context, tag)
    statements.push(
      context.env.DB.prepare('INSERT OR IGNORE INTO job_skills (job_id, skill_id) VALUES (?,?)').bind(jobId, skillId)
    )
  }

  if (job.salary) {
    statements.push(
      context.env.DB.prepare(
        `INSERT INTO salary_ranges (job_id, min_minor, max_minor, currency, period) VALUES (?,?,?,?,?)
         ON CONFLICT(job_id) DO UPDATE SET min_minor = excluded.min_minor, max_minor = excluded.max_minor,
           currency = excluded.currency, period = excluded.period`
      ).bind(jobId, job.salary.minMinor, job.salary.maxMinor, job.salary.currency, job.salary.period)
    )
  } else if (primary) {
    statements.push(context.env.DB.prepare('DELETE FROM salary_ranges WHERE job_id = ?').bind(jobId))
  }

  await context.env.DB.batch(statements)
  return { inserted, duplicate }
}

async function closeExpired(context: RunContext, sourceId: string): Promise<number> {
  const now = context.now
  const cutoff = now - RETENTION_GRACE_SECONDS
  const { results } = await context.env.DB.prepare(
    `SELECT id FROM jobs
     WHERE origin = 'imported' AND status = 'published' AND source_id = ?
       AND NOT EXISTS (
         SELECT 1 FROM job_source_links l2
         WHERE l2.job_id = jobs.id AND l2.last_seen_at >= ?
       )`
  )
    .bind(sourceId, cutoff)
    .all()

  let closed = 0
  for (const row of results as Array<{ id: string }>) {
    const result = await context.env.DB.prepare(
      "UPDATE jobs SET status = 'closed', updated_at = ? WHERE id = ? AND status = 'published'"
    )
      .bind(now, row.id)
      .run()
    closed += result.meta?.changes || 0
  }

  const explicitlyExpired = await context.env.DB.prepare(
    "UPDATE jobs SET status = 'closed', updated_at = ? WHERE source_id = ? AND origin = 'imported' AND status = 'published' AND expires_at IS NOT NULL AND expires_at < ?"
  )
    .bind(now, sourceId, now)
    .run()
  return closed + (explicitlyExpired.meta?.changes || 0)
}

async function ingestSource(
  context: RunContext,
  source: SourceRow,
  options: { ignoreInterval?: boolean } = {}
): Promise<SourceResult> {
  const result = resultFor(source, 'success')
  const now = context.now
  const config = parseConfig(source)
  const interval = Math.max(
    60,
    Math.min(Number(config.min_interval_seconds) || DEFAULT_MIN_INTERVAL_SECONDS, 7 * 24 * 60 * 60)
  )

  const lastAttempt = Number(source.last_attempt_at || source.last_success_at || 0)
  if (!options.ignoreInterval && lastAttempt && now - lastAttempt < interval) {
    result.state = 'skipped'
    result.note = `Provider refresh interval has not elapsed (${Math.round(interval / 60)} minutes)`
    return result
  }

  const running = await context.env.DB.prepare(
    "SELECT id FROM source_runs WHERE source_id = ? AND state = 'running' AND started_at > ?"
  )
    .bind(source.id, now - OVERLAP_WINDOW_SECONDS)
    .first()
  if (running) {
    result.state = 'skipped'
    result.note = 'A previous run is still marked running'
    return result
  }

  const adapter = (config.adapter && context.adapters?.[String(config.adapter)]) || getAdapter(config.adapter)
  if (!adapter) {
    result.state = 'failed'
    result.error = `No approved adapter is configured for this source (${String(config.adapter || 'missing')})`
    await recordFailure(context, source, result, now)
    return result
  }

  const runId = nanoid()
  await context.env.DB.prepare(
    "INSERT INTO source_runs (id, source_id, state, started_at) VALUES (?,?,?,?)"
  )
    .bind(runId, source.id, 'running', now)
    .run()

  try {
    const adapterContext: AdapterContext = {
      source,
      config,
      countryIndex: context.countryIndex,
    }
    const fetched = await adapter.fetchRecords(adapterContext)
    result.records = fetched.records.length
    result.complete = fetched.complete
    result.note = fetched.note

    const seenExternal = new Set<string>()
    const seenCanonical = new Set<string>()
    for (const record of fetched.records) {
      const normalized = adapter.normalize(record, adapterContext)
      if (!normalized) {
        result.invalid += 1
        continue
      }
      if (seenExternal.has(normalized.sourceJobId)) continue
      seenExternal.add(normalized.sourceJobId)
      const canonical = canonicalUrlKey(normalized.applicationUrl) || canonicalUrlKey(normalized.originalUrl)
      if (canonical && seenCanonical.has(canonical)) continue
      if (canonical) seenCanonical.add(canonical)

      const outcome = await upsertJob(context, source, normalized)
      if (outcome.inserted) result.inserted += 1
      else result.updated += 1
      if (outcome.duplicate) result.duplicates += 1
    }

    if (result.records > 0 && result.inserted + result.updated === 0) {
      throw new Error(`Provider returned ${result.records} record(s) but none could be normalized safely`)
    }

    const closed = fetched.complete ? await closeExpired(context, source.id) : 0
    const finishedAt = Math.floor(Date.now() / 1000)
    await context.env.DB.prepare(
      `UPDATE source_runs SET state = 'success', finished_at = ?, counts_json = ?, checkpoint_json = ?,
         errors_json = NULL WHERE id = ?`
    )
      .bind(
        finishedAt,
        JSON.stringify({
          inserted: result.inserted,
          updated: result.updated,
          duplicates: result.duplicates,
          invalid: result.invalid,
          records: result.records,
          complete: result.complete,
          closed,
          note: result.note || null,
        }),
        JSON.stringify({ complete: result.complete, note: result.note || null }),
        runId
      )
      .run()

    await context.env.DB.prepare(
      `UPDATE sources SET last_attempt_at = ?, last_success_at = ?, last_error = NULL, last_error_at = NULL,
         updated_at = ? WHERE id = ?`
    )
      .bind(now, finishedAt, finishedAt, source.id)
      .run()

    await enqueueRunEvent(context.env, source.id, result, null, now)
    return result
  } catch (caught) {
    result.state = 'failed'
    result.error = truncateError(caught instanceof Error ? caught.message : 'Unknown provider error')
    await recordFailure(context, source, result, now, runId)
    return result
  }
}

async function enqueueRunEvent(env: Env, sourceId: string, result: SourceResult, error: string | null, now: number) {
  try {
    await env.DB.prepare(
      "INSERT INTO outbox (id, event_id, event_type, payload_json, state, created_at) VALUES (?,?,?,?,'pending',?)"
    )
      .bind(
        nanoid(),
        nanoid(),
        'source.run_completed',
        JSON.stringify({
          source_id: sourceId,
          inserted: result.inserted,
          updated: result.updated,
          records: result.records,
          complete: result.complete,
          error,
        }),
        now
      )
      .run()
  } catch {
    // A failed audit/outbox write must not discard successfully ingested jobs.
  }
}

async function recordFailure(context: RunContext, source: SourceRow, result: SourceResult, now: number, runId?: string) {
  const finishedAt = Math.floor(Date.now() / 1000)
  if (runId) {
    await context.env.DB.prepare(
      "UPDATE source_runs SET state = 'failed', finished_at = ?, counts_json = ?, errors_json = ? WHERE id = ?"
    )
      .bind(
        finishedAt,
        JSON.stringify({ inserted: result.inserted, updated: result.updated, records: result.records }),
        JSON.stringify([result.error || 'Unknown provider error']),
        runId
      )
      .run()
  } else {
    await context.env.DB.prepare(
      "INSERT INTO source_runs (id, source_id, state, counts_json, errors_json, started_at, finished_at) VALUES (?,?,?,?,?,?,?)"
    )
      .bind(
        nanoid(),
        source.id,
        'failed',
        JSON.stringify({ inserted: 0, updated: 0, records: 0 }),
        JSON.stringify([result.error || 'Unknown provider error']),
        now,
        finishedAt
      )
      .run()
  }

  await context.env.DB.prepare(
    'UPDATE sources SET last_attempt_at = ?, last_error = ?, last_error_at = ?, updated_at = ? WHERE id = ?'
  )
    .bind(now, truncateError(result.error || 'Unknown provider error'), now, finishedAt, source.id)
    .run()

  await enqueueRunEvent(context.env, source.id, result, result.error || 'Unknown provider error', now)
}

/**
 * Runs every due approved source independently. A failure in one provider never
 * prevents another provider from updating, and never expires jobs from the failed one.
 */
export async function runIngestion(
  env: Env,
  options: {
    limit?: number
    sourceIds?: string[]
    ignoreInterval?: boolean
    /** Test seam for adapter fixtures; production always uses the approved registry. */
    adapters?: Record<string, ProviderAdapter>
  } = {}
): Promise<IngestionSummary> {
  const startedAt = Math.floor(Date.now() / 1000)
  const geography = await loadGeography(env)
  const context: RunContext = {
    env,
    now: startedAt,
    countryIndex: geography.index,
    validCountries: geography.valid,
    skillCache: new Map(),
    adapters: options.adapters,
  }

  const limit = Math.max(1, Math.min(options.limit ?? 10, 20))
  const sourceIds = (options.sourceIds || []).filter((id) => typeof id === 'string').slice(0, 20)
  let rows: SourceRow[]
  if (sourceIds.length > 0) {
    const placeholders = sourceIds.map(() => '?').join(',')
    const { results } = await env.DB.prepare(
      `SELECT id, name, kind, base_url, permission_state, enabled, config_json, feed_url, attribution_text,
         last_attempt_at, last_success_at, last_error
       FROM sources WHERE permission_state = 'import_allowed' AND enabled = 1 AND id IN (${placeholders})`
    )
      .bind(...sourceIds)
      .all()
    rows = results as SourceRow[]
  } else {
    const { results } = await env.DB.prepare(
      `SELECT id, name, kind, base_url, permission_state, enabled, config_json, feed_url, attribution_text,
         last_attempt_at, last_success_at, last_error
       FROM sources WHERE permission_state = 'import_allowed' AND enabled = 1
       ORDER BY last_attempt_at IS NOT NULL, last_attempt_at ASC LIMIT ?`
    )
      .bind(limit)
      .all()
    rows = results as SourceRow[]
  }

  const summary: IngestionSummary = {
    started_at: startedAt,
    finished_at: startedAt,
    sources_considered: rows.length,
    sources_run: 0,
    sources_skipped: 0,
    sources_failed: 0,
    jobs_inserted: 0,
    jobs_updated: 0,
    jobs_closed: 0,
    duplicates_linked: 0,
    results: [],
  }

  for (const source of rows) {
    let result: SourceResult
    try {
      result = await ingestSource(context, source, { ignoreInterval: options.ignoreInterval })
    } catch (caught) {
      result = resultFor(source, 'failed')
      result.error = truncateError(caught instanceof Error ? caught.message : 'Unknown ingestion error')
      await recordFailure(context, source, result, startedAt)
    }
    summary.results.push(result)
    if (result.state === 'skipped') summary.sources_skipped += 1
    else if (result.state === 'failed') summary.sources_failed += 1
    else summary.sources_run += 1
    summary.jobs_inserted += result.inserted
    summary.jobs_updated += result.updated
    summary.duplicates_linked += result.duplicates
  }

  summary.finished_at = Math.floor(Date.now() / 1000)
  return summary
}

export async function runSourceIngestion(
  env: Env,
  sourceId: string,
  options: { ignoreInterval?: boolean } = {}
): Promise<SourceResult | null> {
  const summary = await runIngestion(env, { sourceIds: [sourceId], ignoreInterval: options.ignoreInterval })
  return summary.results[0] || null
}

export async function flagStaleSources(env: Env): Promise<void> {
  const cutoff = Math.floor(Date.now() / 1000) - STALE_SOURCE_SECONDS
  await env.DB.prepare(
    `UPDATE sources SET last_error = COALESCE(last_error, 'No successful refresh in the last 7 days'),
       last_error_at = COALESCE(last_error_at, ?)
     WHERE permission_state = 'import_allowed' AND enabled = 1
       AND (last_success_at IS NULL OR last_success_at < ?)`
  )
    .bind(Math.floor(Date.now() / 1000), cutoff)
    .run()
}

export type SyncStatus = {
  configured_sources: number
  last_success_at: number | null
  last_attempt_at: number | null
  stale: boolean
  stale_after_seconds: number
  errors: Array<{ source_id: string; source_name: string; message: string; at: number | null }>
}

/** Aggregated, non-sensitive freshness information for the public feed. */
export async function getSyncStatus(env: Env): Promise<SyncStatus> {
  const { results } = await env.DB.prepare(
    `SELECT id, name, last_attempt_at, last_success_at, last_error, last_error_at
     FROM sources WHERE permission_state = 'import_allowed' AND enabled = 1`
  ).all()
  const rows = results as Array<Record<string, any>>
  let lastSuccess: number | null = null
  let lastAttempt: number | null = null
  const errors: SyncStatus['errors'] = []
  for (const row of rows) {
    if (typeof row.last_success_at === 'number' && (lastSuccess === null || row.last_success_at > lastSuccess)) {
      lastSuccess = row.last_success_at
    }
    if (typeof row.last_attempt_at === 'number' && (lastAttempt === null || row.last_attempt_at > lastAttempt)) {
      lastAttempt = row.last_attempt_at
    }
    if (row.last_error) {
      errors.push({
        source_id: row.id,
        source_name: row.name,
        message: String(row.last_error).slice(0, 300),
        at: typeof row.last_error_at === 'number' ? row.last_error_at : null,
      })
    }
  }
  const now = Math.floor(Date.now() / 1000)
  return {
    configured_sources: rows.length,
    last_success_at: lastSuccess,
    last_attempt_at: lastAttempt,
    stale: lastSuccess === null || now - lastSuccess > STALE_AFTER_SECONDS,
    stale_after_seconds: STALE_AFTER_SECONDS,
    errors: errors.slice(0, 6),
  }
}
