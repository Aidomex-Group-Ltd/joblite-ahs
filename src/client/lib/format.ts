export type Salary = {
  min_minor?: number | null
  max_minor?: number | null
  currency?: string | null
  period?: string | null
}

const PERIODS: Record<string, string> = {
  year: 'year',
  annually: 'year',
  annual: 'year',
  month: 'month',
  monthly: 'month',
  week: 'week',
  weekly: 'week',
  day: 'day',
  daily: 'day',
  hour: 'hour',
  hourly: 'hour',
}

function withCommas(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

/**
 * Formats stored minor units without inventing a currency or period. A verbatim
 * provider salary string is preferred when one was supplied.
 */
export function formatSalary(salary: Salary | null | undefined, salaryText?: string | null): string | undefined {
  if (salaryText && salaryText.trim()) return salaryText.trim()
  if (!salary || (salary.min_minor == null && salary.max_minor == null)) return undefined
  const currency = (salary.currency || '').trim()
  const min = salary.min_minor != null ? salary.min_minor / 100 : null
  const max = salary.max_minor != null ? salary.max_minor / 100 : null
  const period = salary.period ? PERIODS[salary.period.toLowerCase()] : undefined

  let amount: string
  if (min != null && max != null && min !== max) amount = `${withCommas(min)}–${withCommas(max)}`
  else amount = withCommas((min ?? max) as number)

  const prefix = currency ? `${currency} ` : ''
  const suffix = period ? ` / ${period}` : ''
  const currencyNote = currency ? '' : ' (currency not stated)'
  return `${prefix}${amount}${suffix}${currencyNote}`
}

/** Distinguishes provider publication time from Joblite's first-seen time. */
export function publicationLabel(publishedAt?: number | null, discoveredAt?: number | null): string {
  if (publishedAt) return formatRelativeTime(publishedAt)
  if (discoveredAt) return `Added ${formatRelativeTime(discoveredAt)}`
  return ''
}

export function formatRelativeTime(timestampSeconds?: number | null, now = Date.now()): string {
  if (!timestampSeconds) return ''
  const diff = Math.floor(now / 1000) - timestampSeconds
  if (diff < 0) return new Date(timestampSeconds * 1000).toLocaleDateString()
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
  return new Date(timestampSeconds * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatDate(timestampSeconds?: number | null): string {
  if (!timestampSeconds) return 'Unknown'
  return new Date(timestampSeconds * 1000).toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatDateTime(timestampSeconds?: number | null): string {
  if (!timestampSeconds) return 'Unknown'
  return new Date(timestampSeconds * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function summarize(text: string | null | undefined, maxLength = 220): string {
  if (!text) return ''
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= maxLength) return clean
  return `${clean.slice(0, maxLength).trimEnd()}…`
}

export function formatLocation(
  locations: Array<{ city?: string | null; country_code?: string | null }> | undefined,
  arrangement?: string | null,
  locationText?: string | null
): string {
  const explicit = locationText?.trim()
  if (explicit) {
    if (arrangement === 'remote' && !/\bremote\b/i.test(explicit)) return `Remote · ${explicit}`
    return explicit
  }
  const first = locations?.find((location) => location.city || location.country_code)
  const place = first ? [first.city, first.country_code].filter(Boolean).join(', ') : ''
  if (place) return arrangement === 'remote' ? `Remote · ${place}` : place
  if (arrangement === 'remote') return 'Remote'
  if (arrangement === 'hybrid') return 'Hybrid'
  if (arrangement === 'onsite') return 'On-site'
  return 'Location not specified'
}

export function initials(name: string | null | undefined): string {
  const cleaned = (name || '').trim()
  if (!cleaned) return 'J'
  const parts = cleaned.split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

/** Only plain http(s) URLs are ever used as navigation targets. */
export function safeExternalUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

export function publicJobUrl(jobId: string): string {
  return `${window.location.origin}/jobs/${encodeURIComponent(jobId)}`
}

export function publicPostUrl(postId: string): string {
  return `${window.location.origin}/posts/${encodeURIComponent(postId)}`
}

export function stageLabel(stage: string): string {
  const labels: Record<string, string> = {
    submitted: 'Applied',
    in_review: 'Screening',
    shortlisted: 'Shortlisted',
    interview: 'Interview',
    offer: 'Offer received',
    hired: 'Hired',
    rejected: 'Rejected',
    withdrawn: 'Withdrawn',
    closed: 'Closed',
  }
  return labels[stage] || stage.replace(/_/g, ' ')
}
