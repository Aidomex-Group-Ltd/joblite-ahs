/**
 * Outbox dispatch settings shared by the cron pump (index.ts) and the
 * read-only administrative inspection route (routes/admin.ts).
 */

/** Maximum number of rows the pump claims per run. */
export const OUTBOX_BATCH_LIMIT = 20

/** Enqueue attempts before a row is parked as `failed` instead of retried. */
export const OUTBOX_MAX_ATTEMPTS = 5

/**
 * How long a `dispatching` claim is valid before the pump may re-claim it. This
 * recovers rows whose dispatch never completed, instead of leaving them stuck
 * forever, while still preventing two pumps from sending the same row at once.
 */
export const OUTBOX_LEASE_SECONDS = 120
