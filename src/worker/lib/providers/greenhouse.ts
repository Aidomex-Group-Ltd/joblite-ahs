import { isRecord, safeHttpUrl, sanitizeText } from '../validate'
import { fetchJson } from './http'
import {
  deriveCity,
  inferWorkplace,
  matchCountryCodes,
  toEpochSeconds,
  uniqueStrings,
} from './common'
import type { AdapterContext, ProviderAdapter } from './types'

function boardToken(context: AdapterContext): string {
  const token = typeof context.config.board_token === 'string' ? context.config.board_token.trim() : ''
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(token)) {
    throw new Error('Greenhouse source is missing a valid board_token')
  }
  return token
}

function endpoint(context: AdapterContext): string {
  if (context.source.feed_url) return context.source.feed_url
  return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken(context))}/jobs?content=true`
}

export const greenhouseAdapter: ProviderAdapter = {
  id: 'greenhouse',

  async fetchRecords(context) {
    boardToken(context)
    const payload = await fetchJson(endpoint(context), {
      timeoutMs: context.config.timeout_ms,
      maxRetries: context.config.max_retries,
      fetchImpl: context.fetchImpl,
      signal: context.signal,
    })
    if (!isRecord(payload) || !Array.isArray(payload.jobs)) {
      throw new Error('Greenhouse response did not contain a jobs array')
    }
    const maxRecords = Math.max(1, Math.min(Number(context.config.max_records) || 80, 300))
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
    const description = sanitizeText(record.content, 20_000)
    const url = safeHttpUrl(record.absolute_url)
    const rawId = record.id
    if (!title || !description || !url || rawId === undefined || rawId === null) return null
    const sourceJobId = String(rawId).trim().slice(0, 200)
    if (!sourceJobId) return null

    const location = isRecord(record.location) ? record.location : null
    const locationText = location ? sanitizeText(location.name, 200) || null : null
    const departmentNames = (Array.isArray(record.departments) ? record.departments : [])
      .map((department) => (isRecord(department) ? sanitizeText(department.name, 80) : ''))
      .filter(Boolean)
    const tags = uniqueStrings(departmentNames, 6)
    const worldwide = Boolean(locationText && /^worldwide$/i.test(locationText.trim()))

    return {
      sourceJobId,
      title,
      company: sanitizeText(context.config.company, 120) || sanitizeText(record.company_name, 120) || null,
      description,
      employmentType: null,
      workplaceArrangement: inferWorkplace(locationText),
      locationText: worldwide ? null : locationText,
      city: worldwide ? null : deriveCity(locationText),
      countryCodes: worldwide ? [] : matchCountryCodes(locationText, context.countryIndex),
      eligibilityMode: worldwide ? 'worldwide' : 'unknown',
      eligibilityEvidence: worldwide
        ? 'The employer job board states the location is worldwide'
        : locationText
          ? `Employer job board lists the location as: ${locationText}`
          : 'The employer job board did not state candidate eligibility',
      originalUrl: url,
      applicationUrl: url,
      // Greenhouse's list endpoint exposes updated_at, not first_published. Treating
      // an update as the original publication date would be misleading.
      publishedAt: toEpochSeconds(record.first_published),
      providerUpdatedAt: toEpochSeconds(record.updated_at),
      expiresAt: toEpochSeconds(record.application_deadline),
      salaryText: null,
      salary: null,
      tags,
      category: departmentNames[0] || null,
    }
  },
}
