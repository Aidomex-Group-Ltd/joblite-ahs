import type { Env } from '../types'
import { sendEmail } from './email'

/**
 * Outbox delivery handlers, keyed by event type.
 *
 * An event type with no handler is recorded as `no_handler` (never silently
 * dropped) and logged, so a missing delivery channel stays visible. Handlers run
 * only after the consumer has claimed the event, so they should treat a repeat
 * invocation as possible and keep side effects idempotent.
 */

export type OutboxMessage = {
  type?: unknown
  event_id?: unknown
  source_id?: unknown
  payload?: unknown
}

export type OutboxHandler = (env: Env, body: OutboxMessage) => Promise<void>

export const OUTBOX_HANDLERS: Partial<Record<string, OutboxHandler>> = {
  'interview.scheduled': sendInterviewInvitation,
}

type InterviewInvitationRow = {
  scheduled_at: number | null
  timezone: string | null
  status: string
  candidate_email: string
  job_title: string
  company: string | null
}

/**
 * Emails the candidate an interview invitation when an employer schedules one.
 *
 * The event id is passed as the provider idempotency key in addition to the
 * consumer's own claim, so even a retry after an ambiguous provider response
 * cannot produce a second invitation.
 */
async function sendInterviewInvitation(env: Env, body: OutboxMessage): Promise<void> {
  const payload = (body.payload && typeof body.payload === 'object' ? body.payload : {}) as Record<string, unknown>
  const applicationId = typeof payload.application_id === 'string' ? payload.application_id : ''
  const interviewId = typeof payload.interview_id === 'string' ? payload.interview_id : ''
  if (!applicationId || !interviewId) {
    // Nothing actionable; treat as handled so it is not retried forever.
    console.warn(JSON.stringify({ event: 'outbox_interview_payload_invalid' }))
    return
  }

  const row = await env.DB.prepare(
    `SELECT i.scheduled_at, i.timezone, i.status,
            u.email_normalized AS candidate_email,
            j.title AS job_title,
            COALESCE(o.name, j.company_name) AS company
       FROM interviews i
       JOIN applications a ON a.id = i.application_id
       JOIN users u ON u.id = a.candidate_id
       JOIN jobs j ON j.id = a.job_id
       LEFT JOIN organizations o ON o.id = j.organization_id
      WHERE i.id = ? AND i.application_id = ?`
  )
    .bind(interviewId, applicationId)
    .first<InterviewInvitationRow>()

  if (!row) {
    console.warn(JSON.stringify({ event: 'outbox_interview_not_found' }))
    return
  }
  if (row.status !== 'planned') {
    // Cancelled or already answered: there is no invitation to send.
    return
  }
  if (!row.scheduled_at || !row.candidate_email) {
    console.warn(JSON.stringify({ event: 'outbox_interview_not_deliverable' }))
    return
  }

  const company = row.company || 'the employer'
  const when = formatInterviewTime(row.scheduled_at, row.timezone || 'UTC')
  const origin = env.APP_URL || 'https://joblite.online'
  await sendEmail(env, {
    to: row.candidate_email,
    subject: `Interview invitation for ${row.job_title}`,
    text: [
      `You have an interview invitation for ${row.job_title} at ${company}.`,
      '',
      `When: ${when}`,
      '',
      `Open Joblite to view the details and accept or decline: ${origin}/applications/${applicationId}`,
      '',
      'If you did not expect this message, you can ignore it.',
    ].join('\n'),
    idempotencyKey: typeof body.event_id === 'string' ? body.event_id : undefined,
  })
}

function formatInterviewTime(scheduledAt: number, timezone: string): string {
  const date = new Date(scheduledAt * 1000)
  try {
    return `${new Intl.DateTimeFormat('en-GB', { timeZone: timezone, dateStyle: 'full', timeStyle: 'short' }).format(date)} (${timezone})`
  } catch {
    return `${date.toISOString()} (UTC)`
  }
}
