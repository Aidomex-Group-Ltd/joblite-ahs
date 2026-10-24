import type { CountryIndex, NormalizedJob } from './common'

export type SourceRow = {
  id: string
  name: string
  kind: string
  base_url?: string | null
  permission_state?: string | null
  enabled?: number | null
  config_json?: string | null
  feed_url?: string | null
  attribution_text?: string | null
  last_attempt_at?: number | null
  last_success_at?: number | null
  last_error?: string | null
  last_error_at?: number | null
}

export type ProviderConfig = {
  adapter?: string
  board_token?: string
  company?: string
  min_interval_seconds?: number
  max_records?: number
  max_pages?: number
  timeout_ms?: number
  max_retries?: number
  [key: string]: unknown
}

export type AdapterContext = {
  source: SourceRow
  config: ProviderConfig
  countryIndex: CountryIndex
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}

export type FetchRecordsResult = {
  records: unknown[]
  /** False when a provider page limit or an incomplete page was reached. */
  complete: boolean
  note?: string
}

export type ProviderAdapter = {
  id: string
  fetchRecords: (context: AdapterContext) => Promise<FetchRecordsResult>
  normalize: (record: unknown, context: AdapterContext) => NormalizedJob | null
}
