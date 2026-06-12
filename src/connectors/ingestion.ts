/**
 * Connector ingestion framework (S14).
 *
 * Lets RevenueTwin pull real data from external systems (CRM, billing, contracts, M365)
 * instead of fixtures. Each source implements `SourceConnector`; the `SyncEngine` drives
 * incremental pulls with cursors, normalizes raw records into the canonical model, and reports
 * health so the platform can degrade gracefully when a source is unavailable.
 *
 * Boundary: connectors only READ and NORMALIZE. They never compute money or write back —
 * that stays in the deterministic core and the action layer.
 */
import type { ConnectorCategory } from '../api/platform.ts';

export class ConnectorError extends Error {
  constructor(message: string) { super(message); this.name = 'ConnectorError'; }
}

/** A raw record as received from a source, before normalization. */
export interface RawRecord {
  readonly sourceId: string;
  readonly externalId: string;
  readonly kind: string; // source-specific type, e.g. 'opportunity', 'invoice'
  readonly updatedAt: string; // ISO; drives incremental cursors
  readonly data: Record<string, unknown>;
}

/** Result of one sync page from a source. */
export interface SyncPage {
  readonly records: RawRecord[];
  /** opaque cursor to resume after the last record; null when fully drained. */
  readonly nextCursor: string | null;
}

/** A pluggable source connector. Implementations wrap a real API (Salesforce, Stripe, …). */
export interface SourceConnector {
  readonly id: string;
  readonly category: ConnectorCategory;
  /** Health probe; the engine flips to degraded mode when this is not 'healthy'. */
  health(): Promise<'healthy' | 'degraded' | 'unavailable'>;
  /** Pull a page of records updated after `cursor` (null = from the beginning). */
  pull(cursor: string | null, limit: number): Promise<SyncPage>;
}

/** Persisted sync state per source, so incremental pulls resume where they stopped. */
export interface SyncCursor {
  sourceId: string;
  cursor: string | null;
  lastSyncAt: string | null;
  recordsIngested: number;
}

/** Stores sync cursors. Backed by persistence in production; in-memory by default. */
export class CursorStore {
  private cursors = new Map<string, SyncCursor>();

  get(sourceId: string): SyncCursor {
    return this.cursors.get(sourceId) ?? { sourceId, cursor: null, lastSyncAt: null, recordsIngested: 0 };
  }
  set(c: SyncCursor): void {
    this.cursors.set(c.sourceId, c);
  }
  all(): SyncCursor[] {
    return [...this.cursors.values()];
  }
}

export interface SyncResult {
  sourceId: string;
  pulled: number;
  pages: number;
  status: 'completed' | 'degraded' | 'skipped';
  cursor: string | null;
}

/**
 * Drives incremental ingestion. Pulls pages until drained or a page cap is hit, invoking
 * `onRecords` for each batch (normalization happens downstream). Resumes from the stored cursor.
 */
export class SyncEngine {
  constructor(
    private cursors: CursorStore,
    private clock: () => string = () => new Date().toISOString(),
  ) {}

  async sync(
    connector: SourceConnector,
    onRecords: (records: RawRecord[]) => Promise<void>,
    opts: { pageSize?: number; maxPages?: number } = {},
  ): Promise<SyncResult> {
    const pageSize = opts.pageSize ?? 100;
    const maxPages = opts.maxPages ?? 50;

    const health = await connector.health();
    if (health === 'unavailable') {
      return { sourceId: connector.id, pulled: 0, pages: 0, status: 'skipped', cursor: this.cursors.get(connector.id).cursor };
    }

    const state = this.cursors.get(connector.id);
    let cursor = state.cursor;
    let pulled = 0;
    let pages = 0;

    while (pages < maxPages) {
      const page = await connector.pull(cursor, pageSize);
      pages += 1;
      if (page.records.length > 0) {
        await onRecords(page.records);
        pulled += page.records.length;
      }
      cursor = page.nextCursor;
      if (cursor === null) break; // fully drained
    }

    this.cursors.set({
      sourceId: connector.id,
      cursor,
      lastSyncAt: this.clock(),
      recordsIngested: state.recordsIngested + pulled,
    });

    return {
      sourceId: connector.id,
      pulled,
      pages,
      status: health === 'degraded' ? 'degraded' : 'completed',
      cursor,
    };
  }
}
