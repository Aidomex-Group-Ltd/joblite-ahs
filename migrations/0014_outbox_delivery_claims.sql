-- Extend the outbox delivery ledger so a handler can reserve an event before its
-- side effect. Without a claim, a crash between "sent" and "recorded" could send
-- the same email twice; without a terminal `failed` outcome, an event that keeps
-- failing would retry forever instead of becoming visible to an operator.
--
-- SQLite cannot alter a CHECK constraint in place, so the table is rebuilt. The
-- rebuild is additive and forward/backward compatible: the previously deployed
-- consumer only writes `handled`/`no_handler`, both still allowed, and the new
-- columns are nullable.
CREATE TABLE outbox_deliveries_v2 (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('sending', 'retrying', 'handled', 'no_handler', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 1,
  last_error TEXT,
  claimed_at INTEGER,
  processed_at INTEGER NOT NULL
);
INSERT INTO outbox_deliveries_v2 (event_id, event_type, outcome, attempts, processed_at)
  SELECT event_id, event_type, outcome, attempts, processed_at FROM outbox_deliveries;
DROP TABLE outbox_deliveries;
ALTER TABLE outbox_deliveries_v2 RENAME TO outbox_deliveries;
CREATE INDEX IF NOT EXISTS idx_outbox_deliveries_processed ON outbox_deliveries(processed_at);
CREATE INDEX IF NOT EXISTS idx_outbox_deliveries_outcome ON outbox_deliveries(outcome);
