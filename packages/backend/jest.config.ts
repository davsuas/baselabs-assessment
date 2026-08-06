import type { Config } from "jest";

/**
 * Backend Jest configuration (T024). Per tasks.md's note on what "unit test" means here: most of
 * the required coverage (proration, idempotency, ledger-balance, hash-chain) runs these specs
 * against a real Postgres instance (the Docker Compose `db` service with migrations applied, via
 * `tests/helpers/db.ts`) rather than mocking `pg` — this is still the Jest/unit layer per the
 * constitution's Testing Strategy, distinct from Postman's black-box role.
 */
const config: Config = {
  testEnvironment: "node",
  rootDir: ".",
  testMatch: ["<rootDir>/tests/**/*.test.ts"],
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.jest.json" }],
  },
  setupFiles: ["<rootDir>/tests/setupEnv.ts"],
  clearMocks: true,
  verbose: true,
  // Story test suites (T017) truncate shared domain tables between tests; running suites/tests in
  // parallel against the same database would race. `npm test` runs `jest --runInBand`.
};

export default config;
