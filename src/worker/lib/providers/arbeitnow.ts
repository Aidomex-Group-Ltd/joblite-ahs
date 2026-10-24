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

const ENDPOINT = 'https://www.arbeitnow.com/api/job-board-api'

function isWorldwide(value: string | null): boolean {
  if (!value) return false
  const text = value.trim().toLowerCase()
  return text === 'worldwide' || text === 'anywhere' || text === 'global'
}

export const arbeitnowAdapter: ProviderAdapter = {
  id: 'arbeitnow',

  async fetchRecords(context) {
    const maxRecords = Math.max(1, Math.min(Number(context.config.max_records) || 100, 300))
    const maxPages = Math.max(1, Math.min(Number(context.config.max_pages) || 2, 5))
    const collected: unknown[] = []
    let next: string | null = context.source.feed_url || ENDPOINT
    let pages = 0
    let complete = false
    let note: string | undefined

    while (next && pages < maxPages && collected.length < maxRecords) {
      let payload: unknown
      try {
        payload = await fetchJson(next, {
          timeoutMs: context.config.timeout_ms,
          maxRetries: context.config.max_retries,
          fetchImpl: context.fetchImpl,
          signal: context.signal,
        })
      } catch (error) {
        if (pages > 0) {
          note = `Stopped after page ${pages}: ${error instanceof Error ? error.message : 'page request failed'}`
          break
        }
        throw error
      }
      if (!isRecord(payload) || !Array.isArray(payload.data)) {
        throw new Error('Arbeitnow response did not contain a data array')
      }
      pages += 1
      collected.push(...payload.data)

      const links = isRecord(payload.links) ? payload.links : null
      const nextLink = links && typeof links.next === 'string' ? safeHttpUrl(links.next) : null
      if (!nextLink) {
        complete = true
        next = null
      } else if (pages >= maxPages || collected.length >= maxRecords) {
        note = `Capped at ${pages} page${pages === 1 ? '' : 's'} for this run`
        next = nextLink
        break
      } else {
        next = nextLink
      }
    }

    const records = collected.slice(0, maxRecords)
    if (records.length < collected.length) {
      complete = false
      note = note || `Capped at ${maxRecords} records for this run`
    }
    if (next && pages >= maxPages) complete = false
    return { records, complete, note }
  },

  normalize(record, context) {
    if (!isRecord(record)) return null
    const title = sanitizeText(record.title, 200)
    const description = sanitizeText(record.description, 20_000)
    const url = safeHttpUrl(record.url)
    if (!title || !description || !url) return null
    const rawId = record.slug ?? record.url
    if (typeof rawId !== 'string' || !rawId.trim()) return null
    const sourceJobId = rawId.trim().slice(0, 200)

    const locationText = sanitizeText(record.location, 200) || null
    const worldwide = isWorldwide(locationText)
    const jobTypes = Array.isArray(record.job_types) ? record.job_types : []
    const tags = uniqueStrings(Array.isArray(record.tags) ? record.tags : [], 12)
    const remote = record.remote === true || record.remote === 'true'

    return {
      sourceJobId,
      title,
      company: sanitizeText(record.company_name, 120) || null,
      description,
      employmentType: normalizeEmploymentType(jobTypes.find((value) => typeof value === 'string')),
      workplaceArrangement: remote ? 'remote' : /\bhybrid\b/i.test(locationText || '') ? 'hybrid' : 'onsite',
      locationText: worldwide ? null : locationText,
      city: worldwide ? null : deriveCity(locationText),
      countryCodes: worldwide ? [] : matchCountryCodes(locationText, context.countryIndex),
      eligibilityMode: worldwide ? 'worldwide' : 'unknown',
      eligibilityEvidence: worldwide
        ? 'Arbeitnow states the location is worldwide'
        : locationText
          ? `Arbeitnow lists the location as: ${locationText}`
          : 'Arbeitnow did not state candidate eligibility',
      originalUrl: url,
      applicationUrl: url,
      publishedAt: toEpochSeconds(record.created_at),
      providerUpdatedAt: null,
      expiresAt: null,
      salaryText: null,
      salary: null,
      tags,
      category: null,
    }
  },
}
