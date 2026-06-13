/**
 * Tamper-evident audit chain (S49 — Block R foundation).
 *
 * Every state change in the product appends here. Entries are linked by a SHA-256 hash chain:
 * each entry's `hash` covers its content AND the previous entry's hash, so altering any past
 * entry breaks verification of every entry after it. The chain is the evidence backbone for the
 * SOX controls and the board/audit evidence pack.
 *
 * `AuditLog` is the in-process chaining/verification engine; durable storage is a separate
 * `AuditStore` (persistence layer) that enforces the same append-only contract. They agree
 * because both recompute the hash identically.
 */
import { createHash } from 'node:crypto';

/** The genesis previous-hash that seeds the chain (64 zeros). */
export const GENESIS_HASH = '0'.repeat(64);

/** One immutable audit record. `detail` is arbitrary structured context. */
export interface AuditEntry {
  /** Zero-based position in the chain. */
  readonly seq: number;
  /** ISO timestamp the entry was recorded. */
  readonly at: string;
  /** Who/what performed the action (user id or agent name). */
  readonly actor: string;
  /** The event name, e.g. 'case.created', 'case.approve'. */
  readonly event: string;
  /** The subject the event acted on (case id, customer id, …). */
  readonly subject: string;
  /** Structured detail payload. */
  readonly detail: Record<string, unknown>;
  /** Hash of the previous entry (GENESIS_HASH for seq 0). */
  readonly prevHash: string;
  /** SHA-256 over the canonical content + prevHash. */
  readonly hash: string;
}

/** Recompute the canonical hash of an entry's content (excluding its own `hash`). */
export function hashEntry(e: Omit<AuditEntry, 'hash'>): string {
  const payload = JSON.stringify({
    seq: e.seq,
    at: e.at,
    actor: e.actor,
    event: e.event,
    subject: e.subject,
    detail: e.detail,
    prevHash: e.prevHash,
  });
  return createHash('sha256').update(payload).digest('hex');
}

export class AuditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuditError';
  }
}

/**
 * In-process append-only hash chain. Injectable `clock` keeps timestamps deterministic in tests.
 */
export class AuditLog {
  private entries: AuditEntry[] = [];

  constructor(private clock: () => string = () => new Date().toISOString()) {}

  /** Append a new event; returns the sealed entry (with seq, at, prevHash, hash filled in). */
  append(actor: string, event: string, subject: string, detail: Record<string, unknown>): AuditEntry {
    const seq = this.entries.length;
    const prevHash = seq === 0 ? GENESIS_HASH : this.entries[seq - 1]!.hash;
    const base: Omit<AuditEntry, 'hash'> = {
      seq,
      at: this.clock(),
      actor,
      event,
      subject,
      detail,
      prevHash,
    };
    const entry: AuditEntry = { ...base, hash: hashEntry(base) };
    this.entries.push(entry);
    return entry;
  }

  /**
   * Rehydrate the in-process chain from previously-sealed, persisted entries (e.g. on restart with
   * a durable backend). Entries must be in seq order and form a valid chain; throws otherwise so a
   * corrupt or out-of-order load fails fast rather than silently continuing a broken chain.
   * Only valid on an empty chain.
   */
  rehydrate(entries: readonly AuditEntry[]): void {
    if (this.entries.length !== 0) throw new Error('rehydrate is only valid on an empty AuditLog');
    let prev = GENESIS_HASH;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]!;
      if (e.seq !== i) throw new Error('rehydrate: non-monotonic seq at index ' + i);
      if (e.prevHash !== prev) throw new Error('rehydrate: prevHash break at seq ' + e.seq);
      const recomputed = hashEntry({ seq: e.seq, at: e.at, actor: e.actor, event: e.event, subject: e.subject, detail: e.detail, prevHash: e.prevHash });
      if (recomputed !== e.hash) throw new Error('rehydrate: hash mismatch at seq ' + e.seq);
      prev = e.hash;
    }
    this.entries = [...entries];
  }

  /** All entries in chain order (defensive copy). */
  all(): AuditEntry[] {
    return [...this.entries];
  }

  /** The current head hash (GENESIS_HASH when empty). */
  headHash(): string {
    return this.entries.length === 0 ? GENESIS_HASH : this.entries[this.entries.length - 1]!.hash;
  }

  /** Number of entries. */
  get length(): number {
    return this.entries.length;
  }

  /**
   * Verify the whole chain: seq monotonic, prevHash links intact, each hash recomputes. Returns
   * false on the first break.
   */
  verifyChain(): boolean {
    let prev = GENESIS_HASH;
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i]!;
      if (e.seq !== i) return false;
      if (e.prevHash !== prev) return false;
      if (e.hash !== hashEntry(e)) return false;
      prev = e.hash;
    }
    return true;
  }
}
