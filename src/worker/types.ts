export type Env = {
  DB: D1Database
  MEDIA: R2Bucket
  ASSETS?: Fetcher
  OUTBOX_QUEUE: Queue
  INGEST_QUEUE: Queue
  ENVIRONMENT: string
  APP_URL: string
  SESSION_SECRET: string
  CSRF_SECRET: string
  /** Optional bearer token for the authenticated ingestion administration route. */
  INGEST_TOKEN?: string
  STREAM_ACCOUNT_ID?: string
  STREAM_API_TOKEN?: string
  EMAIL_API_KEY?: string
}

export type Variables = {
  user?: { id: string; email: string; verified_at?: number | null; display_name?: string | null }
  session?: any
}

export type AppContext = { Bindings: Env; Variables: Variables }
