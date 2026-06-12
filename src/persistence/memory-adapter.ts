/**
 * In-memory persistence adapter (S13).
 * For pilots, tests, and the offline demo. Enforces the same append-only audit contract and
 * tenant scoping as the Postgres adapter, so behaviour is identical across backends.
 */
import { createHash } from 'node:crypto';
import {
  type AuditStore, type CaseStore, type TwinStore, type UnitOfWork,
  PersistenceError, GENESIS_HASH,
} from './repository.ts';
import type { AuditEntry } from '../core/audit.ts';
import type { LeakageCase, CaseStatus, TwinState } from '../core/model.ts';

function recompute(e: Omit<AuditEntry, 'hash'>): string {
  const payload = JSON.stringify({
    seq: e.seq, at: e.at, actor: e.actor, event: e.event,
    subject: e.subject, detail: e.detail, prevHash: e.prevHash,
  });
  return createHash('sha256').update(payload).digest('hex');
}

class MemoryAuditStore implements AuditStore {
  private entries: AuditEntry[] = [];

  async append(entry: AuditEntry): Promise<void> {
    const expectedSeq = this.entries.length;
    if (entry.seq !== expectedSeq) {
      throw new PersistenceError(`Audit seq gap: expected ${expectedSeq}, got ${entry.seq}`);
    }
    const expectedPrev = expectedSeq === 0 ? GENESIS_HASH : this.entries[expectedSeq - 1]!.hash;
    if (entry.prevHash !== expectedPrev) {
      throw new PersistenceError(`Audit prevHash mismatch at seq ${entry.seq}`);
    }
    if (entry.hash !== recompute(entry)) {
      throw new PersistenceError(`Audit hash invalid at seq ${entry.seq}`);
    }
    this.entries.push(entry);
  }

  async all(): Promise<AuditEntry[]> {
    return [...this.entries];
  }

  async exportPeriod(from: string, to: string): Promise<AuditEntry[]> {
    const f = Date.parse(from), t = Date.parse(to);
    return this.entries.filter((e) => {
      const at = Date.parse(e.at);
      return at >= f && at <= t;
    });
  }

  async headHash(): Promise<string> {
    return this.entries.length === 0 ? GENESIS_HASH : this.entries[this.entries.length - 1]!.hash;
  }

  async verifyChain(): Promise<boolean> {
    let prev = GENESIS_HASH;
    for (const e of this.entries) {
      if (e.prevHash !== prev) return false;
      if (e.hash !== recompute(e)) return false;
      prev = e.hash;
    }
    return true;
  }

  snapshot(): AuditEntry[] { return [...this.entries]; }
  restore(s: AuditEntry[]): void { this.entries = [...s]; }
}

class MemoryCaseStore implements CaseStore {
  // tenant -> caseId -> case
  private byTenant = new Map<string, Map<string, LeakageCase>>();

  private tenant(t: string): Map<string, LeakageCase> {
    let m = this.byTenant.get(t);
    if (!m) { m = new Map(); this.byTenant.set(t, m); }
    return m;
  }

  async upsert(tenantId: string, c: LeakageCase): Promise<void> {
    this.tenant(tenantId).set(c.id, c);
  }
  async get(tenantId: string, caseId: string): Promise<LeakageCase | null> {
    return this.tenant(tenantId).get(caseId) ?? null;
  }
  async listByCustomer(tenantId: string, customerId: string): Promise<LeakageCase[]> {
    return [...this.tenant(tenantId).values()].filter((c) => c.customerId === customerId);
  }
  async listByStatus(tenantId: string, status: CaseStatus): Promise<LeakageCase[]> {
    return [...this.tenant(tenantId).values()].filter((c) => c.status === status);
  }
  async all(tenantId: string): Promise<LeakageCase[]> {
    return [...this.tenant(tenantId).values()];
  }

  snapshot(): Map<string, Map<string, LeakageCase>> {
    const copy = new Map<string, Map<string, LeakageCase>>();
    for (const [t, m] of this.byTenant) copy.set(t, new Map(m));
    return copy;
  }
  restore(s: Map<string, Map<string, LeakageCase>>): void {
    this.byTenant = new Map();
    for (const [t, m] of s) this.byTenant.set(t, new Map(m));
  }
}

class MemoryTwinStore implements TwinStore {
  private states = new Map<string, { state: TwinState; history: { state: TwinState; at: string }[] }>();

  private key(t: string, c: string): string { return `${t}::${c}`; }

  async setState(tenantId: string, customerId: string, state: TwinState, at: string): Promise<void> {
    const k = this.key(tenantId, customerId);
    const cur = this.states.get(k);
    if (cur) {
      cur.state = state;
      cur.history.push({ state, at });
    } else {
      this.states.set(k, { state, history: [{ state, at }] });
    }
  }
  async getState(tenantId: string, customerId: string): Promise<TwinState | null> {
    return this.states.get(this.key(tenantId, customerId))?.state ?? null;
  }
  async history(tenantId: string, customerId: string): Promise<{ state: TwinState; at: string }[]> {
    return [...(this.states.get(this.key(tenantId, customerId))?.history ?? [])];
  }

  snapshot() {
    const copy = new Map<string, { state: TwinState; history: { state: TwinState; at: string }[] }>();
    for (const [k, v] of this.states) copy.set(k, { state: v.state, history: [...v.history] });
    return copy;
  }
  restore(s: Map<string, { state: TwinState; history: { state: TwinState; at: string }[] }>): void {
    this.states = new Map();
    for (const [k, v] of s) this.states.set(k, { state: v.state, history: [...v.history] });
  }
}

export class MemoryUnitOfWork implements UnitOfWork {
  readonly audit = new MemoryAuditStore();
  readonly cases = new MemoryCaseStore();
  readonly twins = new MemoryTwinStore();

  /** Snapshot/rollback transaction: captures all three stores, restores them on throw. */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const a = this.audit.snapshot();
    const c = this.cases.snapshot();
    const t = this.twins.snapshot();
    try {
      return await fn();
    } catch (err) {
      this.audit.restore(a);
      this.cases.restore(c);
      this.twins.restore(t);
      throw err;
    }
  }

  async close(): Promise<void> { /* nothing to release */ }
}
