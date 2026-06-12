/**
 * Postgres persistence adapter (S13).
 *
 * Designed for production: tenant-scoped rows, append-only audit enforced at the application
 * boundary AND (via schema.sql) by a row-level revoke + trigger in the database.
 *
 * To stay dependency-free in the core, this adapter depends on a minimal injected client
 * (`PgClient`) rather than importing `pg` directly. Wire it to a real `pg.Pool` at the edge:
 *
 *   import { Pool } from 'pg';
 *   const pool = new Pool({ connectionString: process.env.DATABASE_URL });
 *   const uow = new PostgresUnitOfWork({ query: (t, p) => pool.query(t, p) });
 *
 * This keeps the engine testable with a fake client and free of a hard driver dependency.
 */
import { createHash } from 'node:crypto';
import {
  type AuditStore, type CaseStore, type TwinStore, type UnitOfWork,
  PersistenceError, GENESIS_HASH,
} from './repository.ts';
import type { AuditEntry } from '../core/audit.ts';
import type { LeakageCase, CaseStatus, TwinState } from '../core/model.ts';

/** Minimal client surface, satisfied by `pg.Pool`/`pg.Client` and by test fakes. */
export interface PgClient {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

function recompute(e: Omit<AuditEntry, 'hash'>): string {
  const payload = JSON.stringify({
    seq: e.seq, at: e.at, actor: e.actor, event: e.event,
    subject: e.subject, detail: e.detail, prevHash: e.prevHash,
  });
  return createHash('sha256').update(payload).digest('hex');
}

class PgAuditStore implements AuditStore {
  constructor(private c: PgClient, private tenantId: string) {}

  async append(entry: AuditEntry): Promise<void> {
    if (entry.hash !== recompute(entry)) {
      throw new PersistenceError(`Audit hash invalid at seq ${entry.seq}`);
    }
    const head = await this.headHash();
    if (entry.prevHash !== head) {
      throw new PersistenceError(`Audit prevHash mismatch at seq ${entry.seq}`);
    }
    await this.c.query(
      `INSERT INTO audit_log (tenant_id, seq, at, actor, event, subject, detail, prev_hash, hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [this.tenantId, entry.seq, entry.at, entry.actor, entry.event, entry.subject,
       JSON.stringify(entry.detail), entry.prevHash, entry.hash],
    );
  }

  private rowToEntry(r: any): AuditEntry {
    return {
      seq: Number(r.seq), at: r.at, actor: r.actor, event: r.event, subject: r.subject,
      detail: typeof r.detail === 'string' ? JSON.parse(r.detail) : r.detail,
      prevHash: r.prev_hash, hash: r.hash,
    };
  }

  async all(): Promise<AuditEntry[]> {
    const { rows } = await this.c.query(
      `SELECT * FROM audit_log WHERE tenant_id=$1 ORDER BY seq ASC`, [this.tenantId]);
    return rows.map((r) => this.rowToEntry(r));
  }

  async exportPeriod(from: string, to: string): Promise<AuditEntry[]> {
    const { rows } = await this.c.query(
      `SELECT * FROM audit_log WHERE tenant_id=$1 AND at >= $2 AND at <= $3 ORDER BY seq ASC`,
      [this.tenantId, from, to]);
    return rows.map((r) => this.rowToEntry(r));
  }

  async headHash(): Promise<string> {
    const { rows } = await this.c.query(
      `SELECT hash FROM audit_log WHERE tenant_id=$1 ORDER BY seq DESC LIMIT 1`, [this.tenantId]);
    return rows.length === 0 ? GENESIS_HASH : rows[0].hash;
  }

  async verifyChain(): Promise<boolean> {
    const entries = await this.all();
    let prev = GENESIS_HASH;
    for (const e of entries) {
      if (e.prevHash !== prev) return false;
      if (e.hash !== recompute(e)) return false;
      prev = e.hash;
    }
    return true;
  }
}

class PgCaseStore implements CaseStore {
  constructor(private c: PgClient) {}

  async upsert(tenantId: string, k: LeakageCase): Promise<void> {
    await this.c.query(
      `INSERT INTO leakage_case (tenant_id, id, customer_id, status, detected_via_workiq, created_at, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (tenant_id, id) DO UPDATE SET
         status=EXCLUDED.status, payload=EXCLUDED.payload`,
      [tenantId, k.id, k.customerId, k.status, k.detectedViaWorkIQ, k.createdAt, JSON.stringify(k)],
    );
  }

  private toCase(r: any): LeakageCase {
    return typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload;
  }

  async get(tenantId: string, caseId: string): Promise<LeakageCase | null> {
    const { rows } = await this.c.query(
      `SELECT payload FROM leakage_case WHERE tenant_id=$1 AND id=$2`, [tenantId, caseId]);
    return rows.length === 0 ? null : this.toCase(rows[0]);
  }
  async listByCustomer(tenantId: string, customerId: string): Promise<LeakageCase[]> {
    const { rows } = await this.c.query(
      `SELECT payload FROM leakage_case WHERE tenant_id=$1 AND customer_id=$2`, [tenantId, customerId]);
    return rows.map((r) => this.toCase(r));
  }
  async listByStatus(tenantId: string, status: CaseStatus): Promise<LeakageCase[]> {
    const { rows } = await this.c.query(
      `SELECT payload FROM leakage_case WHERE tenant_id=$1 AND status=$2`, [tenantId, status]);
    return rows.map((r) => this.toCase(r));
  }
  async all(tenantId: string): Promise<LeakageCase[]> {
    const { rows } = await this.c.query(
      `SELECT payload FROM leakage_case WHERE tenant_id=$1`, [tenantId]);
    return rows.map((r) => this.toCase(r));
  }
}

class PgTwinStore implements TwinStore {
  constructor(private c: PgClient) {}

  async setState(tenantId: string, customerId: string, state: TwinState, at: string): Promise<void> {
    await this.c.query(
      `INSERT INTO twin_state (tenant_id, customer_id, state, at) VALUES ($1,$2,$3,$4)`,
      [tenantId, customerId, state, at]);
  }
  async getState(tenantId: string, customerId: string): Promise<TwinState | null> {
    const { rows } = await this.c.query(
      `SELECT state FROM twin_state WHERE tenant_id=$1 AND customer_id=$2 ORDER BY at DESC, id DESC LIMIT 1`,
      [tenantId, customerId]);
    return rows.length === 0 ? null : (rows[0].state as TwinState);
  }
  async history(tenantId: string, customerId: string): Promise<{ state: TwinState; at: string }[]> {
    const { rows } = await this.c.query(
      `SELECT state, at FROM twin_state WHERE tenant_id=$1 AND customer_id=$2 ORDER BY at ASC, id ASC`,
      [tenantId, customerId]);
    return rows.map((r) => ({ state: r.state as TwinState, at: r.at }));
  }
}

export class PostgresUnitOfWork implements UnitOfWork {
  readonly audit: AuditStore;
  readonly cases: CaseStore;
  readonly twins: TwinStore;

  constructor(private client: PgClient, tenantId: string) {
    this.audit = new PgAuditStore(client, tenantId);
    this.cases = new PgCaseStore(client);
    this.twins = new PgTwinStore(client);
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    await this.client.query('BEGIN');
    try {
      const result = await fn();
      await this.client.query('COMMIT');
      return result;
    } catch (err) {
      await this.client.query('ROLLBACK');
      throw err;
    }
  }

  async close(): Promise<void> { /* pool lifecycle owned by caller */ }
}
