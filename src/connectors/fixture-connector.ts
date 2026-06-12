/**
 * Fixture connector (S14).
 * A real implementation of `SourceConnector` backed by an in-memory record set. Used for
 * pilots, the offline demo, and tests. Production connectors (Salesforce, Stripe, DocuSign,
 * M365 Graph) implement the same interface over their respective APIs.
 *
 * Supports cursor-based pagination (cursor = index into the sorted record set) and a settable
 * health state so degraded/unavailable paths can be exercised.
 */
import type { SourceConnector, SyncPage, RawRecord } from './ingestion.ts';
import type { ConnectorCategory } from '../api/platform.ts';

export class FixtureConnector implements SourceConnector {
  private records: RawRecord[];
  private healthState: 'healthy' | 'degraded' | 'unavailable' = 'healthy';

  constructor(
    public readonly id: string,
    public readonly category: ConnectorCategory,
    records: RawRecord[] = [],
  ) {
    // sort by updatedAt asc so cursors are stable/incremental
    this.records = [...records].sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
  }

  setHealth(state: 'healthy' | 'degraded' | 'unavailable'): void {
    this.healthState = state;
  }

  async health(): Promise<'healthy' | 'degraded' | 'unavailable'> {
    return this.healthState;
  }

  async pull(cursor: string | null, limit: number): Promise<SyncPage> {
    const start = cursor === null ? 0 : Number(cursor);
    if (!Number.isInteger(start) || start < 0) {
      throw new Error(`Invalid cursor: ${cursor}`);
    }
    const slice = this.records.slice(start, start + limit);
    const nextIndex = start + slice.length;
    const drained = nextIndex >= this.records.length;
    return {
      records: slice,
      nextCursor: drained ? null : String(nextIndex),
    };
  }
}
