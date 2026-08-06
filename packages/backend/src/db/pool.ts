/**
 * The application's single `pg` connection pool. Connects as the least-privileged `app_user`
 * database role (created/granted by `db/migrations/009_grants.sql`) — never the admin/migration
 * role — so the append-only guarantee on `policy_events`/`ledger_transactions`/`ledger_entries`
 * (constitution Principle III) holds structurally even if application code tried to violate it.
 *
 * This module is the only place `packages/backend/src` constructs a `pg` client/pool; every other
 * module goes through `db/repository.ts` (Principle VI — no ad-hoc SQL in application code).
 */
import { Pool, type PoolConfig } from "pg";

function buildPoolConfig(): PoolConfig {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }
  return {
    host: process.env.POSTGRES_HOST ?? "localhost",
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database: process.env.POSTGRES_DB ?? "policy_billing_core",
    user: process.env.APP_DB_USER ?? "app_user",
    password: process.env.APP_DB_PASSWORD ?? "",
    max: Number(process.env.PG_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
  };
}

export const pool = new Pool(buildPoolConfig());

/** Graceful shutdown hook for server.ts and Jest teardown. */
export async function closePool(): Promise<void> {
  await pool.end();
}
