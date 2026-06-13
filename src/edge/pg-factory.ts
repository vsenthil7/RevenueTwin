/**
 * Production Postgres edge wiring.
 *
 * This is the ONLY place that imports the real `pg` driver. The core (src/) stays dependency-
 * free and reaches Postgres exclusively through the injected `PgClientFactory` seam (S59). The
 * import is dynamic so offline/test/in-memory paths never load `pg`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { PgClient } from '../persistence/postgres-adapter.ts';
import type { PgClientFactory } from '../app/persistence-factory.ts';

interface PgPoolLike {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
  end(): Promise<void>;
}

/**
 * Build a PgClientFactory backed by a real `pg.Pool`. Returns the factory plus the live pool so
 * the caller can run the schema and close the pool on shutdown.
 */
export async function createPgEdge(): Promise<{ factory: PgClientFactory; pool: PgPoolLike }> {
  // Dynamic import keeps `pg` out of every non-postgres code path.
  const pg = await import('pg');
  const Pool = (pg as { default?: { Pool: new (cfg: { connectionString: string }) => PgPoolLike }; Pool?: new (cfg: { connectionString: string }) => PgPoolLike }).Pool
    ?? (pg as { default: { Pool: new (cfg: { connectionString: string }) => PgPoolLike } }).default.Pool;

  let pool: PgPoolLike | null = null;
  const factory: PgClientFactory = (connectionString: string): PgClient => {
    pool = new Pool({ connectionString });
    return { query: (text, params) => pool!.query(text, params) as Promise<{ rows: any[]; rowCount: number | null }> };
  };
  // Materialize the pool now so we can return it for schema + shutdown.
  const url = process.env.DATABASE_URL ?? '';
  factory(url);
  return { factory, pool: pool as unknown as PgPoolLike };
}

/**
 * Apply src/persistence/schema.sql (idempotent: IF NOT EXISTS) and ensure the tenant row exists.
 * The schema creates the tenant table but every other table FKs to it, so the tenant row must be
 * present before any tenant-scoped write. Upsert is idempotent across restarts.
 */
export async function runSchema(pool: PgPoolLike, tenantId: string, tenantName?: string): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const schemaPath = resolve(here, '../persistence/schema.sql');
  const sql = readFileSync(schemaPath, 'utf8');
  await pool.query(sql);
  await pool.query(
    'INSERT INTO tenant (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
    [tenantId, tenantName ?? tenantId],
  );
}
