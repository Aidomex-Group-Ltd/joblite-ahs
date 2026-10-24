import { isRecord, safeHttpUrl, sanitizeText } from '../validate'
import { fetchJson } from './http'
import {
  deriveCity,
  matchCountryCodes,
  normalizeEmploymentType,
  toEpochSeconds,
  uniqueStrings,
} from './common'
import type { AdapterContext, ProviderAdapter } from './types'

const ENDPOINT = 'https://remoteok.com/api'

function isWorldwide(value: string | null): boolean {
  if (!value) return false
  const text = value.trim().toLowerCase()
  return text === 'worldwide' || text === 'anywhere' || text === 'global'
}

function employmentFromTags(tags: string[]): string | null {
  const joined = tags.join(' ')
  return normalizeEmploymentType(joined)
}

export const remoteOkAdapter: ProviderAdapter = {
  id: 'remoteok',

  async fetchRecords(context) {
    const payload = await fetchJson(context.source.feed_url || ENDPOINT, {
      timeoutMs: context.config.timeout_ms,
      maxRetries: context.config.max_retries,
      fetchImpl: context.fetchImpl,
      signal: context.signal,
    })
    if (!Array.isArray(payload)) throw new Error('Remote OK response was not a JSON array')
    // The first element is the provider's legal notice, not a job.
    const candidates = payload.filter((record) => isRecord(record) && record.id !== undefined && record.position !== undefined)
    const maxRecords = Math.max(1, Math.min(Number(context.config.max_records) || 120, 500))
    const complete = candidates.length <= maxRecords
    return {
      records: candidates.slice(0, maxRecords),
      complete,
      note: complete ? undefined : `Capped at ${maxRecords} records for this run`,
    }
  },

  normalize(record, context) {
    if (!isRecord(record)) return null
    const title = sanitizeText(record.position, 200)
    const description = sanitizeText(record.description, 20_000)
    const url = safeHttpUrl(record.url)
    const applyUrl = safeHttpUrl(record.apply_url) || url
    if (!title || !description || !url || !applyUrl) return null
    const rawId = record.id
    if (rawId === undefined || rawId === null) return null
    const sourceJobId = String(rawId).trim().slice(0, 200)
    if (!sourceJobId) return null

    const tags = uniqueStrings(Array.isArray(record.tags) ? record.tags : [], 12)
    const locationText = sanitizeText(record.location, 200) || null
    const worldwide = isWorldwide(locationText)
    const salaryMin = typeof record.salary_min === 'number' && record.salary_min > 0 ? Math.round(record.salary_min * 100) : null
    const salaryMax = typeof record.salary_max === 'number' && record.salary_max > 0 ? Math.round(record.salary_max * 100) : null
    const salary = salaryMin !== null || salaryMax !== null
      ? { minMinor: salaryMin, maxMinor: salaryMax, currency: null, period: null }
      : null

    return {
      sourceJobId,
      title,
      company: sanitizeText(record.company, 120) || null,
      description,
      employmentType: employmentFromTags(tags),
      workplaceArrangement: 'remote',
      locationText: worldwide ? null : locationText,
      city: worldwide ? null : deriveCity(locationText),
      countryCodes: worldwide ? [] : matchCountryCodes(locationText, context.countryIndex),
      eligibilityMode: worldwide ? 'worldwide' : 'unknown',
      eligibilityEvidence: worldwide
        ? 'Remote OK states the location is worldwide'
        : locationText
          ? `Remote OK lists the location as: ${locationText}`
          : 'Remote OK did not state candidate eligibility',
      originalUrl: url,
      applicationUrl: applyUrl,
      publishedAt: toEpochSeconds(record.epoch ?? record.date),
      providerUpdatedAt: null,
      expiresAt: null,
      salaryText: null,
      salary,
      tags,
      category: null,
    }
  },
}
