import { isRecord, safeHttpUrl, sanitizeText } from '../validate'
import { fetchJson } from './http'
import {
  deriveCity,
  inferWorkplace,
  matchCountryCodes,
  structuredSalaryFromRange,
  toEpochSeconds,
  uniqueStrings,
} from './common'
import type { AdapterContext, ProviderAdapter } from './types'

function boardToken(context: AdapterContext): string {
  const token = typeof context.config.board_token === 'string' ? context.config.board_token.trim() : ''
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(token)) {
    throw new Error('Lever source is missing a valid board_token')
  }
  return token
}

function endpoint(context: AdapterContext): string {
  if (context.source.feed_url) return context.source.feed_url
  return `https://api.lever.co/v0/postings/${encodeURIComponent(boardToken(context))}?mode=json`
}

export const leverAdapter: ProviderAdapter = {
  id: 'lever',

  async fetchRecords(context) {
    boardToken(context)
    const payload = await fetchJson(endpoint(context), {
      timeoutMs: context.config.timeout_ms,
      maxRetries: context.config.max_retries,
      fetchImpl: context.fetchImpl,
      signal: context.signal,
    })
    if (!Array.isArray(payload)) throw new Error('Lever response was not a JSON array')
    const maxRecords = Math.max(1, Math.min(Number(context.config.max_records) || 80, 300))
    const complete = payload.length <= maxRecords
    return {
      records: payload.slice(0, maxRecords),
      complete,
      note: complete ? undefined : `Capped at ${maxRecords} records for this run`,
    }
  },

  normalize(record, context) {
    if (!isRecord(record)) return null
    const title = sanitizeText(record.text, 200)
    const categories = isRecord(record.categories) ? record.categories : null
    const descriptionSource =
      typeof record.descriptionPlain === 'string' && record.descriptionPlain.trim()
        ? record.descriptionPlain
        : record.description
    const description = sanitizeText(descriptionSource, 20_000)
    const hostedUrl = safeHttpUrl(record.hostedUrl)
    const applyUrl = safeHttpUrl(record.applyUrl) || hostedUrl
    const rawId = record.id
    if (!title || !description || !hostedUrl || !applyUrl || rawId === undefined || rawId === null) return null
    const sourceJobId = String(rawId).trim().slice(0, 200)
    if (!sourceJobId) return null

    const allLocations = categories && Array.isArray(categories.allLocations)
      ? categories.allLocations.filter((value): value is string => typeof value === 'string')
      : []
    const primaryLocation = categories && typeof categories.location === 'string' ? categories.location : null
    const locationText = sanitizeText(primaryLocation || allLocations.join('; '), 240) || null
    const worldwide = Boolean(locationText && /^worldwide$/i.test(locationText.trim()))
    const team = categories && typeof categories.department === 'string'
      ? categories.department
      : categories && typeof categories.team === 'string'
        ? categories.team
        : null
    const tags = uniqueStrings(allLocations.length > 1 ? allLocations : [], 6)
    const salary = structuredSalaryFromRange(record.salaryRange)

    return {
      sourceJobId,
      title,
      company: sanitizeText(context.config.company, 120) || null,
      description,
      employmentType: categories && typeof categories.commitment === 'string'
        ? sanitizeText(categories.commitment, 60).toLowerCase()
        : null,
      workplaceArrangement: inferWorkplace(locationText, undefined, record.workplaceType),
      locationText: worldwide ? null : locationText,
      city: worldwide ? null : deriveCity(locationText),
      countryCodes: worldwide ? [] : matchCountryCodes(locationText, context.countryIndex),
      eligibilityMode: worldwide ? 'worldwide' : 'unknown',
      eligibilityEvidence: worldwide
        ? 'The employer job board states the location is worldwide'
        : locationText
          ? `Employer job board lists the location as: ${locationText}`
          : 'The employer job board did not state candidate eligibility',
      originalUrl: hostedUrl,
      applicationUrl: applyUrl,
      publishedAt: toEpochSeconds(record.createdAt),
      providerUpdatedAt: null,
      expiresAt: null,
      salaryText: null,
      salary,
      tags,
      category: team ? sanitizeText(team, 80) : null,
    }
  },
}
