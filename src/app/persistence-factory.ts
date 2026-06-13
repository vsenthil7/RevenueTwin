/**
 * Persistence selection (S59).
 *
 * Production default is Postgres: when DATABASE_URL is set the app runs on the Postgres adapter;
 * in-memory is used only when explicitly requested (demo/test) or when no DATABASE_URL is present.
 *
 * The core stays dependency-free: the real 'pg' driver is reached ONLY through an injected
 * \`PgClientFactory\`. The default factory lazy-imports 'pg' so offline/test paths never load it.
 */
import { MemoryUnitOfWork } from '../persistence/memory-adapter.ts';
import { PostgresUnitOfWork, type PgClient } from '../persistence/postgres-adapter.ts';
import type { UnitOfWork } from '../persistence/repository.ts';

export type Backend = 'memory' | 'postgres';

/** Produces a PgClient for a connection string. Injected so the core needs no hard 'pg' dep. */
export type PgClientFactory = (connectionString: string) => PgClient;

export interface SelectOptions {
  /** Explicit override: 'memory' or 'postgres'. When omitted, inferred from databaseUrl. */
  backend?: Backend;
  /** Connection string (defaults to process.env.DATABASE_URL at the edge). */
  databaseUrl?: string;
  /** Tenant the UnitOfWork is scoped to. */
  tenantId: string;
  /** Force in-memory regardless of databaseUrl (e.g. demo/test). */
  forceMemory?: boolean;
  /** Injected client factory for postgres (required when backend resolves to postgres). */
  pgClientFactory?: PgClientFactory;
}

export interface SelectResult {
  uow: UnitOfWork;
  backend: Backend;
}

/** Decide which backend to use from explicit override + databaseUrl + forceMemory. */
export function resolveBackend(opts: { backend?: Backend; databaseUrl?: string; forceMemory?: boolean }): Backend {
  if (opts.forceMemory) return 'memory';
  if (opts.backend) return opts.backend;
  return opts.databaseUrl && opts.databaseUrl.length > 0 ? 'postgres' : 'memory';
}

/**
 * Build the UnitOfWork for the resolved backend. Postgres requires a databaseUrl AND a
 * pgClientFactory; otherwise it throws (fail fast rather than silently falling back to memory in
 * production).
 */
export function selectUnitOfWork(opts: SelectOptions): SelectResult {
  const backend = resolveBackend(opts);
  if (backend === 'memory') {
    return { uow: new MemoryUnitOfWork(), backend };
  }
  if (!opts.databaseUrl || opts.databaseUrl.length === 0) {
    throw new Error('Postgres backend selected but no databaseUrl provided');
  }
  if (!opts.pgClientFactory) {
    throw new Error('Postgres backend selected but no pgClientFactory injected');
  }
  const client = opts.pgClientFactory(opts.databaseUrl);
  return { uow: new PostgresUnitOfWork(client, opts.tenantId), backend };
}
