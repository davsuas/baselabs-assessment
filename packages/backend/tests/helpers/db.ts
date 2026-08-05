/**
 * Test-only database helpers.
 *
 * Two separate connections, deliberately:
 *  - `pool` (re-exported from `src/db/pool.ts`) connects as `app_user`, the same
 *    least-privileged role the running application uses — tests exercise the real functions/
 *    views through this pool exactly as the API does.
 *  - `adminPool` connects as the admin/migration role (`POSTGRES_USER`). It exists only for test
 *    setup/teardown that `app_user` is structurally not allowed to do (e.g. `TRUNCATE` on
 *    append-only tables, or directly corrupting a `policy_events` row to simulate tampering for
 *    the history-chain test — see quickstart.md §7 and plan.md's documented note). No application
 *    code path may use `adminPool`; it is a Jest-only escape hatch.
 */
import { Pool } from "pg";
import { pool } from "../../src/db/pool";

export { pool };

function buildAdminPoolConfig() {
  if (process.env.ADMIN_DATABASE_URL) {
    return { connectionString: process.env.ADMIN_DATABASE_URL };
  }
  return {
    host: process.env.POSTGRES_HOST ?? "localhost",
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database: process.env.POSTGRES_DB ?? "policy_billing_core",
    user: process.env.POSTGRES_USER ?? "postgres",
    password: process.env.POSTGRES_PASSWORD ?? "postgres",
  };
}

export const adminPool = new Pool(buildAdminPoolConfig());

/** The seed policy from docs/assessment.md's policy.json (db/migrations/010_seed_data.sql). */
export const SEED_POLICY = {
  policy_id: "POL-1001",
  homeowner_id: "HOME-204",
  status: "active",
  term_start: "2026-01-01",
  term_end: "2027-01-01",
  annual_premium_cents: 120000,
  currency: "USD",
} as const;

/**
 * Truncates every domain table that a test could have written to (child tables first, for FK
 * order) and resets the seeded POL-1001 policy back to its original state. Does NOT truncate
 * `policies` itself — the seed row is inserted once by migration 010 and not idempotently
 * re-seedable mid-test-run, so tests needing additional policy fixtures should use
 * `upsertTestPolicy` with a distinct `policy_id` instead.
 *
 * Call from a `beforeEach` in every test file that touches the database (per-test isolation).
 */
export async function truncateDomainTables(): Promise<void> {
  await adminPool.query(`
    TRUNCATE TABLE ledger_entries, ledger_transactions, payments, billing_documents, policy_events
    RESTART IDENTITY CASCADE
  `);
  await adminPool.query(
    `UPDATE policies
        SET annual_premium_cents = $1, status = $2, updated_at = now()
      WHERE policy_id = $3`,
    [SEED_POLICY.annual_premium_cents, SEED_POLICY.status, SEED_POLICY.policy_id],
  );
}

export interface TestPolicyFixture {
  policy_id: string;
  homeowner_id: string;
  status: "active" | "cancelled" | "expired";
  term_start: string;
  term_end: string;
  annual_premium_cents: number;
  currency: string;
}

/** Inserts (or updates in place) a policy fixture beyond the default seeded POL-1001. */
export async function upsertTestPolicy(fixture: TestPolicyFixture): Promise<void> {
  await adminPool.query(
    `INSERT INTO policies
       (policy_id, homeowner_id, status, term_start, term_end, annual_premium_cents, currency)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (policy_id) DO UPDATE SET
       homeowner_id = EXCLUDED.homeowner_id,
       status = EXCLUDED.status,
       term_start = EXCLUDED.term_start,
       term_end = EXCLUDED.term_end,
       annual_premium_cents = EXCLUDED.annual_premium_cents,
       currency = EXCLUDED.currency,
       updated_at = now()`,
    [
      fixture.policy_id,
      fixture.homeowner_id,
      fixture.status,
      fixture.term_start,
      fixture.term_end,
      fixture.annual_premium_cents,
      fixture.currency,
    ],
  );
}

/** Closes both pools — call from a suite-level `afterAll` so Jest can exit cleanly. */
export async function closeTestPools(): Promise<void> {
  await pool.end();
  await adminPool.end();
}
