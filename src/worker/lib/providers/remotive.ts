import { isRecord, sanitizeText, safeHttpUrl } from '../validate'
import { fetchJson } from './http'
import {
  deriveCity,
  matchCountryCodes,
  normalizeEmploymentType,
  parseSalaryText,
  toEpochSeconds,
  uniqueStrings,
} from './common'
import type { AdapterContext, ProviderAdapter } from './types'

const ENDPOINT = 'https://remotive.com/api/remote-jobs?limit=200'

function feedUrl(context: AdapterContext): string {
  return context.source.feed_url || ENDPOINT
}

function isWorldwide(value: string | null): boolean {
  if (!value) return false
  const text = value.trim().toLowerCase()
  return text === 'worldwide' || text === 'anywhere' || text === 'global'
}

export const remotiveAdapter: ProviderAdapter = {
  id: 'remotive',

  async fetchRecords(context) {
    const payload = await fetchJson(feedUrl(context), {
      timeoutMs: context.config.timeout_ms,
      maxRetries: context.config.max_retries,
      fetchImpl: context.fetchImpl,
      signal: context.signal,
    })
    if (!isRecord(payload) || !Array.isArray(payload.jobs)) {
      throw new Error('Remotive response did not contain a jobs array')
    }
    const maxRecords = Math.max(1, Math.min(Number(context.config.max_records) || 150, 500))
    const complete = payload.jobs.length <= maxRecords
    return {
      records: payload.jobs.slice(0, maxRecords),
      complete,
      note: complete ? undefined : `Capped at ${maxRecords} records for this run`,
    }
  },

  normalize(record, context) {
    if (!isRecord(record)) return null
    const title = sanitizeText(record.title, 200)
    const description = sanitizeText(record.description, 20_000)
    const url = safeHttpUrl(record.url)
    if (!title || !description || !url) return null
    const rawId = record.id
    if (rawId === undefined || rawId === null) return null
    const sourceJobId = String(rawId).trim().slice(0, 200)
    if (!sourceJobId) return null

    const candidateLocation = sanitizeText(record.candidate_required_location, 200) || null
    const worldwide = isWorldwide(candidateLocation)
    const remote = true
    const { salary, salaryText } = parseSalaryText(record.salary)
    const tags = uniqueStrings(
      [...(Array.isArray(record.tags) ? record.tags : []), ...(typeof record.category === 'string' ? [record.category] : [])],
      12
    )

    return {
      sourceJobId,
      title,
      company: sanitizeText(record.company_name, 120) || null,
      description,
      employmentType: normalizeEmploymentType(record.job_type),
      workplaceArrangement: 'remote',
      locationText: worldwide ? null : candidateLocation,
      city: worldwide ? null : deriveCity(candidateLocation),
      countryCodes: worldwide ? [] : matchCountryCodes(candidateLocation, context.countryIndex),
      eligibilityMode: worldwide ? 'worldwide' : 'unknown',
      eligibilityEvidence: worldwide
        ? 'Remotive states the candidate location is worldwide'
        : candidateLocation
          ? `Remotive lists the candidate location as: ${candidateLocation}`
          : 'Remotive did not state candidate eligibility',
      originalUrl: url,
      applicationUrl: url,
      publishedAt: toEpochSeconds(record.publication_date),
      providerUpdatedAt: null,
      expiresAt: null,
      salaryText,
      salary,
      tags,
      category: sanitizeText(record.category, 80) || null,
    }
  },
}
