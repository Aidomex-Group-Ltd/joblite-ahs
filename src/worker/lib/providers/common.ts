import { safeHttpUrl, sanitizeText } from '../validate'

export type Salary = {
  minMinor: number | null
  maxMinor: number | null
  currency: string | null
  period: string | null
}

export type NormalizedJob = {
  sourceJobId: string
  title: string
  company: string | null
  description: string
  employmentType: string | null
  workplaceArrangement: 'remote' | 'hybrid' | 'onsite' | null
  locationText: string | null
  city: string | null
  countryCodes: string[]
  eligibilityMode: 'worldwide' | 'unknown'
  eligibilityEvidence: string | null
  originalUrl: string
  applicationUrl: string
  publishedAt: number | null
  providerUpdatedAt: number | null
  expiresAt: number | null
  salaryText: string | null
  salary: Salary | null
  tags: string[]
  category: string | null
}

export type CountryRow = { code: string; name: string }
export type CountryIndex = Map<string, string>

const COUNTRY_ALIASES: Record<string, string[]> = {
  US: ['usa', 'u.s.', 'u.s.a.', 'united states', 'united states of america', 'america'],
  GB: ['uk', 'u.k.', 'united kingdom', 'great britain', 'britain', 'england', 'scotland', 'wales', 'northern ireland'],
  AE: ['uae', 'u.a.e.', 'united arab emirates'],
  KR: ['south korea', 'korea, south', 'republic of korea'],
  KP: ['north korea', "korea, north"],
  CZ: ['czech republic', 'czechia'],
  RU: ['russian federation', 'russia'],
  TR: ['turkiye', 'türkiye'],
  CI: ["cote d'ivoire", "côte d'ivoire", 'ivory coast'],
  CD: ['democratic republic of the congo', 'dr congo', 'congo-kinshasa'],
  CG: ['republic of the congo', 'congo-brazzaville'],
  NL: ['holland', 'the netherlands'],
  VN: ['viet nam', 'vietnam'],
  LA: ['lao', 'laos'],
  SY: ['syrian arab republic'],
  TZ: ['tanzania'],
  BO: ['bolivia'],
  VE: ['venezuela'],
  IR: ['iran'],
  MK: ['north macedonia', 'macedonia'],
  SZ: ['eswatini', 'swaziland'],
  CV: ['cabo verde', 'cape verde'],
  MM: ['myanmar', 'burma'],
  TL: ['timor-leste', 'east timor'],
}

/** Builds a lowercase alias index from the ISO 3166-1 rows stored in D1. */
export function buildCountryIndex(rows: CountryRow[]): CountryIndex {
  const index: CountryIndex = new Map()
  for (const row of rows) {
    const code = String(row.code || '').toUpperCase()
    if (!/^[A-Z]{2}$/.test(code)) continue
    const names = [row.name, ...(COUNTRY_ALIASES[code] || [])]
    for (const name of names) {
      if (typeof name !== 'string') continue
      const normalized = name.trim().toLowerCase()
      if (normalized.length < 2) continue
      if (!index.has(normalized)) index.set(normalized, code)
    }
  }
  return index
}

const COUNTRY_STOP_WORDS = new Set(['remote', 'worldwide', 'anywhere', 'global', 'europe', 'asia', 'africa', 'americas', 'emea', 'apac'])

/**
 * Matches explicit country names/aliases in provider text. It deliberately does not
 * map regions or cities to countries, and it never treats "remote" as worldwide.
 */
export function matchCountryCodes(text: string | null | undefined, index: CountryIndex): string[] {
  if (!text) return []
  const haystack = ` ${text.toLowerCase().replace(/[()[\],/|]/g, ' ').replace(/\s+/g, ' ').trim()} `
  if (!haystack.trim()) return []
  const found = new Set<string>()
  const aliases = Array.from(index.entries()).sort((a, b) => b[0].length - a[0].length)
  for (const [alias, code] of aliases) {
    if (COUNTRY_STOP_WORDS.has(alias)) continue
    if (alias.length < 3 && !['uk'].includes(alias)) continue
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(haystack)) found.add(code)
  }
  return Array.from(found).sort()
}

export function toEpochSeconds(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value)
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value)
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric > 10_000_000_000 ? Math.floor(numeric / 1000) : Math.floor(numeric)
    }
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000)
  }
  return null
}

const EMPLOYMENT_TYPES: Array<[RegExp, string]> = [
  [/full[\s_-]?time/i, 'full-time'],
  [/part[\s_-]?time/i, 'part-time'],
  [/contract|contractor/i, 'contract'],
  [/freelance/i, 'freelance'],
  [/intern(ship)?/i, 'internship'],
  [/temporary|temp\b/i, 'temporary'],
  [/working student/i, 'working student'],
  [/graduate/i, 'graduate'],
]

export function normalizeEmploymentType(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const cleaned = sanitizeText(value, 60)
  if (!cleaned) return null
  for (const [pattern, label] of EMPLOYMENT_TYPES) {
    if (pattern.test(cleaned)) return label
  }
  return cleaned.toLowerCase()
}

export function inferWorkplace(text: string | null | undefined, explicitRemote?: unknown, explicitType?: unknown): 'remote' | 'hybrid' | 'onsite' | null {
  const type = typeof explicitType === 'string' ? explicitType.toLowerCase().replace(/[_\s]/g, '-') : ''
  if (type === 'remote') return 'remote'
  if (type === 'hybrid') return 'hybrid'
  if (type === 'on-site' || type === 'onsite' || type === 'in-office') return 'onsite'
  if (explicitRemote === true || explicitRemote === 'true' || explicitRemote === 1) return 'remote'
  if (explicitRemote === false || explicitRemote === 'false' || explicitRemote === 0) {
    return /\bhybrid\b/i.test(text || '') ? 'hybrid' : 'onsite'
  }
  if (/\bhybrid\b/i.test(text || '')) return 'hybrid'
  if (/\bremote\b/i.test(text || '')) return 'remote'
  if (/\bon[\s-]?site\b/i.test(text || '')) return 'onsite'
  return null
}

const CURRENCY_TOKENS: Array<[RegExp, string]> = [
  [/\bUSD\b/i, 'USD'],
  [/\bEUR\b/i, 'EUR'],
  [/\bGBP\b/i, 'GBP'],
  [/\bCAD\b/i, 'CAD'],
  [/\bAUD\b/i, 'AUD'],
  [/\bCHF\b/i, 'CHF'],
  [/\bNZD\b/i, 'NZD'],
  [/\bJPY\b/i, 'JPY'],
  [/\bINR\b/i, 'INR'],
  [/\bSGD\b/i, 'SGD'],
  [/€/, 'EUR'],
  [/£/, 'GBP'],
  [/\$/, 'USD'],
]

function detectCurrency(text: string): string | null {
  for (const [pattern, code] of CURRENCY_TOKENS) {
    if (pattern.test(text)) return code
  }
  return null
}

function detectPeriod(text: string): string | null {
  if (/(?:\/\s*h(?:ou)?r|per\s+hour|hourly)/i.test(text)) return 'hour'
  if (/(?:\/\s*mo(?:nth)?|per\s+month|monthly)/i.test(text)) return 'month'
  if (/(?:\/\s*y(?:ea)?r|per\s+(?:year|annum)|annual(?:ly)?)/i.test(text)) return 'year'
  if (/(?:\/\s*week|per\s+week|weekly)/i.test(text)) return 'week'
  if (/(?:\/\s*day|per\s+day|daily)/i.test(text)) return 'day'
  return null
}

function parseAmount(raw: string, suffix: string | undefined): number | null {
  const cleaned = raw.replace(/,/g, '').replace(/\s/g, '')
  const value = Number.parseFloat(cleaned)
  if (!Number.isFinite(value) || value <= 0) return null
  const multiplier = suffix?.toLowerCase() === 'k' ? 1_000 : suffix?.toLowerCase() === 'm' ? 1_000_000 : 1
  return Math.round(value * multiplier)
}

/**
 * Parses only explicitly supplied salary text. Structured salary is stored when a
 * currency token and at least one amount are present; otherwise the original text
 * remains available for display without inventing a currency or period.
 */
export function parseSalaryText(value: unknown): { salary: Salary | null; salaryText: string | null } {
  if (typeof value !== 'string') return { salary: null, salaryText: null }
  const cleaned = sanitizeText(value, 200)
  if (!cleaned) return { salary: null, salaryText: null }

  const text = cleaned.replace(/[–—−]/g, '-')
  const currency = detectCurrency(text)
  const period = detectPeriod(text)
  const matches = Array.from(text.matchAll(/(\d[\d,.]*)\s*([kKmM])?/g))
  const amounts = matches
    .map((match) => parseAmount(match[1], match[2]))
    .filter((amount): amount is number => amount !== null)

  if (!currency || amounts.length === 0) return { salary: null, salaryText: cleaned }
  const min = amounts[0]
  const max = amounts.length > 1 ? amounts[1] : null
  if (min !== null && max !== null && max < min) {
    return { salary: { minMinor: max * 100, maxMinor: min * 100, currency, period }, salaryText: cleaned }
  }
  return { salary: { minMinor: min * 100, maxMinor: max !== null ? max * 100 : null, currency, period }, salaryText: cleaned }
}

export function structuredSalaryFromRange(value: unknown): Salary | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const currency = typeof record.currency === 'string' ? record.currency.toUpperCase().slice(0, 3) : null
  if (!currency) return null
  const min = typeof record.min === 'number' ? record.min : typeof record.min_compensation === 'number' ? record.min_compensation : null
  const max = typeof record.max === 'number' ? record.max : typeof record.max_compensation === 'number' ? record.max_compensation : null
  if (min === null && max === null) return null
  const interval = typeof record.interval === 'string' ? record.interval.toLowerCase() : null
  const period = interval && ['hour', 'day', 'week', 'month', 'year'].includes(interval) ? interval : null
  return {
    minMinor: min !== null ? Math.round(min * 100) : null,
    maxMinor: max !== null ? Math.round(max * 100) : null,
    currency,
    period,
  }
}

export function uniqueStrings(values: unknown[], max = 12): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (typeof value !== 'string') continue
    const cleaned = sanitizeText(value, 40).replace(/\s+/g, ' ').trim()
    if (!cleaned) continue
    const key = cleaned.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(cleaned)
    if (result.length >= max) break
  }
  return result
}

const TRACKING_PARAMS = new Set(['fbclid', 'gclid', 'mc_cid', 'mc_eid', 'ref', 'referrer', 'source', 'gh_src', 'lever-source'])

/** Stable key used only for conservative, exact-URL cross-source duplicate detection. */
export function canonicalUrlKey(value: string | null | undefined): string | null {
  const safe = safeHttpUrl(value)
  if (!safe) return null
  try {
    const url = new URL(safe)
    let host = url.hostname.toLowerCase().replace(/^www\./, '')
    if (host === 'job-boards.greenhouse.io') host = 'boards.greenhouse.io'
    let path = url.pathname.replace(/\/+$/, '')
    if (!path) path = '/'
    const params = Array.from(url.searchParams.entries())
      .filter(([key]) => !key.toLowerCase().startsWith('utm_') && !TRACKING_PARAMS.has(key.toLowerCase()))
      .sort(([a], [b]) => a.localeCompare(b))
    const query = params.length ? `?${new URLSearchParams(params).toString()}` : ''
    return `${host}${path}${query}`
  } catch {
    return null
  }
}

export function isSafeExternal(value: string | null | undefined): string | null {
  return safeHttpUrl(value)
}

export function pickString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

export function pickRecord(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = record[key]
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

export function pickArray(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key]
  return Array.isArray(value) ? value : []
}

export function deriveCity(locationText: string | null): string | null {
  if (!locationText) return null
  const first = locationText.split(/[,|•·]/)[0]?.trim()
  if (!first || first.length > 80) return null
  if (/^(remote|worldwide|anywhere|global|hybrid|on-?site)$/i.test(first)) return null
  return first || null
}
