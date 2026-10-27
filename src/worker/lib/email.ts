import type { Env } from '../types'

/**
 * Shared outbound email sender used by background deliveries (outbox handlers).
 *
 * The passwordless sign-in route still has its own delivery path with sign-in
 * specific diagnostics; consolidating the two is a follow-up. This module exists
 * so a background handler can send without that route's request-scoped concerns.
 */

export class EmailConfigurationError extends Error {
  /** Redacted label safe to persist for operator diagnosis. */
  readonly failureLabel = 'email_configuration_error'

  constructor() {
    super('email delivery is not configured')
    this.name = 'EmailConfigurationError'
  }
}

export type EmailFailureKind =
  | 'provider_auth'
  | 'provider_rejected'
  | 'provider_rate_limited'
  | 'provider_unavailable'
  | 'timeout'
  | 'network'

export class EmailSendError extends Error {
  /** Redacted label safe to persist for operator diagnosis. */
  readonly failureLabel: string

  constructor(readonly kind: EmailFailureKind, readonly providerStatus?: number) {
    super('email send failed')
    this.name = 'EmailSendError'
    this.failureLabel = `email_send_${kind}`
  }
}

export type OutboundEmail = {
  to: string
  subject: string
  text: string
  /** Stable key for the logical send. Providers dedupe repeated sends with it. */
  idempotencyKey?: string
}

export async function sendEmail(env: Env, message: OutboundEmail): Promise<{ providerMessageId: string | null }> {
  const apiKey = env.EMAIL_API_KEY || env.RESEND_API_KEY
  if (!apiKey || !env.EMAIL_FROM) throw new EmailConfigurationError()

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    let response: Response
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...(message.idempotencyKey ? { 'Idempotency-Key': message.idempotencyKey } : {}),
        },
        body: JSON.stringify({
          from: env.EMAIL_FROM,
          to: [message.to],
          subject: message.subject,
          text: message.text,
        }),
        signal: controller.signal,
      })
    } catch (error) {
      throw new EmailSendError(
        controller.signal.aborted || (error instanceof Error && error.name === 'AbortError') ? 'timeout' : 'network'
      )
    }

    if (!response.ok) {
      const kind: EmailFailureKind = response.status === 401 || response.status === 403
        ? 'provider_auth'
        : response.status === 429
          ? 'provider_rate_limited'
          : response.status >= 500
            ? 'provider_unavailable'
            : 'provider_rejected'
      // Consume the body so the connection closes cleanly; never surface it.
      await response.text().catch(() => undefined)
      throw new EmailSendError(kind, response.status)
    }

    const parsed = await response.json().catch(() => null) as { id?: unknown } | null
    return { providerMessageId: typeof parsed?.id === 'string' ? parsed.id : null }
  } finally {
    clearTimeout(timeout)
  }
}
