-- Seeds the sample policy from docs/assessment.md's policy.json, used throughout
-- contracts/rest-api.md's examples, quickstart.md's manual walkthrough, and the Postman
-- collection/environment (postman/environments/local.postman_environment.json: policyId=POL-1001).
--
-- ON CONFLICT DO NOTHING makes this migration safe to re-run against a database that already has
-- this row (defense in depth alongside db/migrate.ts's schema_migrations tracking).

INSERT INTO policies (
  policy_id, homeowner_id, status, term_start, term_end, annual_premium_cents, currency
) VALUES (
  'POL-1001', 'HOME-204', 'active', '2026-01-01', '2027-01-01', 120000, 'USD'
)
ON CONFLICT (policy_id) DO NOTHING;
