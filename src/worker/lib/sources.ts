/**
 * Compatibility entry point for scheduled and queue code.
 *
 * The real implementation lives in ./ingestion.ts and supports the verified provider
 * adapters (Remotive, Remote OK, Arbeitnow, Greenhouse job boards and Lever postings).
 */
export {
  runIngestion as refreshSources,
  runSourceIngestion as refreshSource,
  flagStaleSources,
  getSyncStatus,
} from './ingestion'
export type { IngestionSummary, SourceResult, SyncStatus } from './ingestion'
