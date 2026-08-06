/**
 * Minimal migration runner (research.md "Migrations" decision).
 *
 * Applies every not-yet-applied `.sql` file in `db/migrations/`, in filename order, each inside its
 * own transaction, tracking applied filenames in a `schema_migrations` table. No heavyweight
 * migration framework (constitution Technology & Architecture Constraints) — this is intentionally
 * ~80 lines, not a DSL.
 *
 * Usage: `npm run migrate` from the repo root (see root package.json).
 */
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { Client } from "pg";
import * as dotenv from "dotenv";

dotenv.config();

const MIGRATIONS_DIR = join(__dirname, "migrations");

function buildConnectionConfig() {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }
  return {
    host: process.env.POSTGRES_HOST ?? "localhost",
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database: process.env.POSTGRES_DB ?? "policy_billing_core",
    user: process.env.POSTGRES_USER ?? "postgres",
    password: process.env.POSTGRES_PASSWORD ?? "postgres",
  };
}

async function ensureMigrationsTable(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    VARCHAR PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function getAppliedFilenames(client: Client): Promise<Set<string>> {
  const result = await client.query<{ filename: string }>("SELECT filename FROM schema_migrations");
  return new Set(result.rows.map((row) => row.filename));
}

function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Minimal `${VAR_NAME}` token substitution against `process.env`, used only so the one secret a
 * migration ever needs (the app DB role's password, in `009_grants.sql`) can be supplied via
 * environment variable instead of committed to the repo (Principle V) without reaching for a
 * templating engine — every other migration file has zero substitution tokens and is plain SQL.
 */
function substituteEnvVars(sql: string): string {
  return sql.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, varName) => {
    const value = process.env[varName];
    if (value === undefined) {
      throw new Error(`migration references undefined environment variable: ${varName}`);
    }
    return value;
  });
}

async function applyMigration(client: Client, filename: string): Promise<void> {
  const rawSql = readFileSync(join(MIGRATIONS_DIR, filename), "utf-8");
  const sql = substituteEnvVars(rawSql);
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [filename]);
    await client.query("COMMIT");
    // eslint-disable-next-line no-console
    console.log(`applied: ${filename}`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw new Error(`migration failed: ${filename}: ${(err as Error).message}`, { cause: err });
  }
}

async function main(): Promise<void> {
  const client = new Client(buildConnectionConfig());
  await client.connect();

  try {
    await ensureMigrationsTable(client);
    const applied = await getAppliedFilenames(client);
    const allFiles = listMigrationFiles();
    const pending = allFiles.filter((filename) => !applied.has(filename));

    if (pending.length === 0) {
      // eslint-disable-next-line no-console
      console.log("no pending migrations");
      return;
    }

    for (const filename of pending) {
      await applyMigration(client, filename);
    }

    // eslint-disable-next-line no-console
    console.log(`applied ${pending.length} migration(s)`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
