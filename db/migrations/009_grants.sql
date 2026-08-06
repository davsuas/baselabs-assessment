-- Creates the least-privileged application database role and grants it exactly what
-- fn_apply_endorsement / fn_record_payment (007) and the read views (008) need — no more.
-- Structurally enforces Principle III's append-only guarantee: no UPDATE/DELETE on
-- policy_events, ledger_transactions, ledger_entries for this role, independent of application
-- code discipline.
--
-- This migration always runs as the admin/migration role (POSTGRES_USER — see db/migrate.ts),
-- never as app_user itself, so it can grant privileges app_user does not have.
--
-- The role's password is supplied via the APP_DB_PASSWORD environment variable and substituted by
-- db/migrate.ts's minimal env-var templating (see the APP_DB_PASSWORD token below) — the only
-- secret any migration in this project needs, never committed to the repo (Principle V; see
-- .env.example).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD '${APP_DB_PASSWORD}';
  ELSE
    ALTER ROLE app_user WITH LOGIN PASSWORD '${APP_DB_PASSWORD}';
  END IF;
END
$$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_user', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO app_user;

-- Table-level grants: least privilege per table, matching exactly what the write functions and
-- read views need (data-model.md). No INSERT on `policies` — nothing in this feature's scope
-- creates new policies at runtime, only seeds them via migration (010) as the admin role.
GRANT SELECT, UPDATE ON policies TO app_user;
GRANT SELECT, INSERT ON policy_events TO app_user;
GRANT SELECT, INSERT ON billing_documents TO app_user;
GRANT SELECT, INSERT ON payments TO app_user;
GRANT SELECT, INSERT ON ledger_transactions TO app_user;
GRANT SELECT, INSERT ON ledger_entries TO app_user;

-- Read views (008_create_views.sql) run *before* this file, so the `ALTER DEFAULT PRIVILEGES ...
-- GRANT SELECT ON TABLES` statement below (which only affects relations created after it runs)
-- does not retroactively cover them — grant SELECT on each explicitly here, now that the role
-- exists (see 008's "Grants note" comment for the full explanation, including why functions don't
-- need the same treatment).
GRANT SELECT ON v_policy_summary TO app_user;
GRANT SELECT ON v_policy_billing_documents TO app_user;
GRANT SELECT ON v_policy_payments TO app_user;
GRANT SELECT ON v_ledger_summary TO app_user;

-- BIGSERIAL id columns need nextval() privilege on their backing sequences for INSERT to work.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user;

-- Explicit belt-and-suspenders REVOKE (Principle III) — these privileges were never GRANTed above,
-- but this makes the append-only guarantee readable directly from this file rather than implied by
-- omission.
REVOKE UPDATE, DELETE ON policy_events, ledger_transactions, ledger_entries FROM app_user;

-- Functions (007_create_functions.sql) and views (008_create_views.sql) are added by later
-- migrations, run by this same admin role — these defaults mean app_user can use them
-- automatically without a further grants migration.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO app_user;
