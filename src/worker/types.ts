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
  RESEND_API_KEY?: string
  EMAIL_FROM?: string
  DEEPSEEK_API_KEY?: string
  DEEPSEEK_MODEL_ID?: string
  AUTH_RESEND_COOLDOWN_SECONDS?: string
  TEST_MAIL_SINK?: string
}

export type Variables = {
  user?: { id: string; email: string; verified_at?: number | null; display_name?: string | null }
  session?: any
  requestId?: string
  authChallengePhase?: string
}

export type AppContext = { Bindings: Env; Variables: Variables }
