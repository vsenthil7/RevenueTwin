/**
 * Persistence layer (S13) — storage-agnostic repository contracts.
 *
 * The domain core never imports a database. It depends only on these interfaces, so the
 * same engine runs against in-memory (pilots/tests) or Postgres (production) with no change.
 *
 * Invariant: the audit store is APPEND-ONLY. Implementations must reject updates/deletes and
 * preserve the hash chain so `verifyChain` stays meaningful across process restarts.
 */
import type { AuditEntry } from '../core/audit.ts';
import type { LeakageCase, CaseStatus, TwinState } from '../core/model.ts';

export class PersistenceError extends Error {
  constructor(message: string) { super(message); this.name = 'PersistenceError'; }
}

/** Append-only audit storage. No update, no delete — by contract. */
export interface AuditStore {
  /** Append an entry. Implementations must reject a seq/prevHash that breaks the chain. */
  append(entry: AuditEntry): Promise<void>;
  /** All entries in seq order. */
  all(): Promise<AuditEntry[]>;
  /** Entries whose `at` falls within [from, to] inclusive. */
  exportPeriod(from: string, to: string): Promise<AuditEntry[]>;
  /** The last entry's hash, or the genesis hash when empty. Used to chain the next append. */
  headHash(): Promise<string>;
  /** Recompute and verify the whole chain. */
  verifyChain(): Promise<boolean>;
}

/** Case storage with status history and tenant scoping. */
export interface CaseStore {
  upsert(tenantId: string, c: LeakageCase): Promise<void>;
  get(tenantId: string, caseId: string): Promise<LeakageCase | null>;
  listByCustomer(tenantId: string, customerId: string): Promise<LeakageCase[]>;
  listByStatus(tenantId: string, status: CaseStatus): Promise<LeakageCase[]>;
  all(tenantId: string): Promise<LeakageCase[]>;
}

/** Twin timeline storage (current state + transition history). */
export interface TwinStore {
  setState(tenantId: string, customerId: string, state: TwinState, at: string): Promise<void>;
  getState(tenantId: string, customerId: string): Promise<TwinState | null>;
  history(tenantId: string, customerId: string): Promise<{ state: TwinState; at: string }[]>;
}

/** A unit of work — all three stores from one backend, with a transaction boundary. */
export interface UnitOfWork {
  readonly audit: AuditStore;
  readonly cases: CaseStore;
  readonly twins: TwinStore;
  /** Run fn inside a transaction; rollback on throw. In-memory impl is best-effort. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  /** Release resources (DB pool, etc). */
  close(): Promise<void>;
}

export const GENESIS_HASH = '0'.repeat(64);
