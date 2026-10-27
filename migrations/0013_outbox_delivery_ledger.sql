-- Durable delivery bookkeeping for the outbox pattern.
--
-- The dispatch pump previously claimed a row by flipping state to 'dispatching'
-- and could only ever re-select state 'pending'. A row whose claim was never
-- completed (isolate eviction, failed final write) was therefore stuck forever.
-- `claimed_at` records the claim time so the pump can re-claim a stale lease.
-- `last_error` records only a failure label, never payload or recipient details.
ALTER TABLE outbox ADD COLUMN claimed_at INTEGER;
ALTER TABLE outbox ADD COLUMN last_error TEXT;
CREATE INDEX IF NOT EXISTS idx_outbox_dispatching ON outbox(state, claimed_at);

-- Records idempotent consumer processing so a redelivered message cannot repeat
-- a side effect. `outcome` distinguishes a handled event from one that has no
-- delivery channel yet, which keeps a missing channel visible instead of silent.
CREATE TABLE IF NOT EXISTS outbox_deliveries (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('handled', 'no_handler')),
  attempts INTEGER NOT NULL DEFAULT 1,
  processed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outbox_deliveries_processed ON outbox_deliveries(processed_at);
