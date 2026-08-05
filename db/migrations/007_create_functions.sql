-- data-model.md "Views & functions" — every domain write is a single hand-written PostgreSQL
-- function call (constitution Principle VI); this file is appended to sequentially, once per user
-- story (tasks.md: T035 fn_apply_endorsement (US1), then fn_record_payment (US2), then
-- fn_verify_policy_history (US3)) since they share this one file by design.
--
-- pgcrypto's digest() backs the hash chain (research.md "Hash-chain canonicalization"):
-- event_hash = encode(digest(canonical_payload || previous_hash, 'sha256'), 'hex').
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Fixed genesis constant used as `previous_hash` for a policy's first-ever event
-- (data-model.md: "a fixed genesis constant for a policy's first event"). Kept as its own tiny
-- SQL function (not duplicated as a literal in every write/verify function) so write-time and
-- verify-time code agree on the same constant by construction.
CREATE OR REPLACE FUNCTION fn_genesis_hash() RETURNS CHAR(64) AS $$
  SELECT repeat('0', 64)::CHAR(64);
$$ LANGUAGE sql IMMUTABLE;

-- Custom SQLSTATEs (5-char, non-colliding with any built-in Postgres class) that the application
-- layer's error-mapping code (packages/backend/src/db/repository.ts) matches on to translate a
-- raised exception into the correct contracts/rest-api.md HTTP response, instead of parsing
-- free-text RAISE messages:
--   BLB01 policy_not_found            -> 404
--   BLB02 policy_not_active           -> 422 { error: "policy_not_active" }
--   BLB03 effective_date_out_of_term  -> 422 { error: "effective_date_out_of_term" }
--   BLB04 idempotency_conflict        -> 409 { error: "idempotency_conflict" }
--   BLB05 currency_mismatch           -> 422 { error: "currency_mismatch" }
--   BLB06 invalid_amount              -> 422 { error: "invalid_amount" }
-- BLB01 and BLB04 are reused as-is by fn_record_payment below (same policy-not-found/idempotency-
-- conflict semantics as fn_apply_endorsement), rather than minted as distinct per-function codes.

-- T035 (US1): fn_apply_endorsement — validates the policy is active and effective_date is within
-- the policy term, computes the prorated premium delta with integer/BIGINT-only arithmetic
-- (constitution Principle VI — never numeric/float/real/double precision), writes one
-- policy_events row (hash-chained), one billing_documents row, one ledger_transactions row with
-- balanced ledger_entries (sign-aware: a positive delta debits Premium Receivable/credits Written
-- Premium, a negative delta reverses both), and updates the policy's premium — all inside this
-- function's own implicit transaction (Principle II atomicity "for free"). Idempotency is enforced
-- by re-checking policy_events before insert and relying on the UNIQUE (policy_id, operation_type,
-- idempotency_key) constraint (data-model.md, research.md "Idempotency enforcement") as the
-- race-safe backstop against concurrent duplicate submissions.
CREATE OR REPLACE FUNCTION fn_apply_endorsement(
  p_policy_id                 VARCHAR,
  p_idempotency_key           VARCHAR,
  p_effective_date            DATE,
  p_new_annual_premium_cents  BIGINT,
  p_reason                    TEXT
) RETURNS TABLE (
  policy_id                       VARCHAR,
  annual_premium_cents            BIGINT,
  billing_document_id             BIGINT,
  billing_document_type           VARCHAR,
  billing_document_amount_cents   BIGINT,
  billing_document_status         VARCHAR,
  idempotency_result              VARCHAR
) AS $$
DECLARE
  v_status                VARCHAR;
  v_term_start             DATE;
  v_term_end               DATE;
  v_old_premium_cents      BIGINT;
  v_term_days              BIGINT;
  v_remaining_days         BIGINT;
  v_numerator              BIGINT;
  v_delta_cents            BIGINT;
  v_canonical_payload      TEXT;
  v_previous_hash          CHAR(64);
  v_event_hash             CHAR(64);
  v_event_id               BIGINT;
  v_billing_document_id    BIGINT;
  v_ledger_transaction_id  BIGINT;
  v_existing_event_id      BIGINT;
  v_existing_payload       TEXT;
BEGIN
  -- Lock the policy row for the rest of this transaction: serializes concurrent endorsements
  -- against the same policy, which both the premium update and the hash-chain's "previous event"
  -- lookup below depend on being race-free.
  --
  -- Column references are fully qualified with the `policies` table name below because this
  -- function's RETURNS TABLE clause implicitly declares OUT variables named `policy_id` and
  -- `annual_premium_cents` — identical to two of this table's column names — and PL/pgSQL raises
  -- "column reference is ambiguous" for any unqualified reference to either name inside this
  -- function body.
  SELECT policies.status, policies.term_start, policies.term_end, policies.annual_premium_cents
    INTO v_status, v_term_start, v_term_end, v_old_premium_cents
    FROM policies
   WHERE policies.policy_id = p_policy_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'policy % not found', p_policy_id USING ERRCODE = 'BLB01';
  END IF;

  -- Canonical payload (research.md: fixed-order concatenation, never JSON, to avoid key-ordering
  -- ambiguity) — this exact string is both what gets hashed and what a replay's payload is
  -- compared against for idempotency.
  v_canonical_payload := p_policy_id || '|' || 'endorsement' || '|' || p_idempotency_key || '|' ||
                          p_effective_date::TEXT || '|' || p_new_annual_premium_cents::TEXT || '|' ||
                          COALESCE(p_reason, '');

  SELECT pe.id, pe.payload_canonical
    INTO v_existing_event_id, v_existing_payload
    FROM policy_events pe
   WHERE pe.policy_id = p_policy_id
     AND pe.operation_type = 'endorsement'
     AND pe.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing_payload = v_canonical_payload THEN
      -- Same key, same payload: return the original result verbatim, no new effects (FR-005).
      RETURN QUERY
        SELECT p.policy_id, p.annual_premium_cents,
               bd.id, bd.type, bd.amount_cents, bd.status,
               'duplicate_ignored'::VARCHAR
          FROM policies p
          JOIN billing_documents bd ON bd.policy_event_id = v_existing_event_id
         WHERE p.policy_id = p_policy_id;
      RETURN;
    ELSE
      -- Same key, different payload: fail clearly, never silently overwrite (FR-006).
      RAISE EXCEPTION 'idempotency_key % already used with a different payload for policy %',
        p_idempotency_key, p_policy_id USING ERRCODE = 'BLB04';
    END IF;
  END IF;

  -- Business-rule validation against the locked current DB state (data-model.md: this can only be
  -- checked safely here, not only at the zod/API boundary, to avoid a check-then-write race).
  IF v_status <> 'active' THEN
    RAISE EXCEPTION 'policy % is not active (status=%)', p_policy_id, v_status USING ERRCODE = 'BLB02';
  END IF;

  IF p_effective_date < v_term_start OR p_effective_date > v_term_end THEN
    RAISE EXCEPTION 'effective_date % is outside policy % term [%, %]',
      p_effective_date, p_policy_id, v_term_start, v_term_end USING ERRCODE = 'BLB03';
  END IF;

  -- Deterministic proration, integer/BIGINT arithmetic only (business-rules.txt, constitution
  -- Principle VI):
  --   term_days = term_end - term_start; remaining_days = term_end - effective_date
  --   delta_cents = round_half_away_from_0((new - old) * remaining_days / term_days)
  -- DATE - DATE already yields an integer day count in Postgres.
  v_term_days      := (v_term_end - v_term_start)::BIGINT;
  v_remaining_days := (v_term_end - p_effective_date)::BIGINT;
  v_numerator      := (p_new_annual_premium_cents - v_old_premium_cents) * v_remaining_days;

  -- round-half-away-from-zero via pure integer division (never numeric/float): for a non-negative
  -- numerator, floor((2*numerator + denominator) / (2*denominator)) rounds ties up; a negative
  -- numerator is rounded on its absolute value and the sign re-applied, giving symmetric
  -- (away-from-zero) rounding rather than banker's/truncating rounding.
  IF v_numerator >= 0 THEN
    v_delta_cents := (2 * v_numerator + v_term_days) / (2 * v_term_days);
  ELSE
    v_delta_cents := -1 * ((2 * (-v_numerator) + v_term_days) / (2 * v_term_days));
  END IF;

  -- Hash chain: previous_hash is the latest event's event_hash for this policy, or the genesis
  -- constant if this is the policy's first event ever (data-model.md, research.md).
  SELECT pe.event_hash INTO v_previous_hash
    FROM policy_events pe
   WHERE pe.policy_id = p_policy_id
   ORDER BY pe.id DESC
   LIMIT 1;

  IF v_previous_hash IS NULL THEN
    v_previous_hash := fn_genesis_hash();
  END IF;

  v_event_hash := encode(digest(v_canonical_payload || v_previous_hash, 'sha256'), 'hex');

  INSERT INTO policy_events (
    policy_id, operation_type, event_type, idempotency_key, payload_canonical, previous_hash, event_hash
  ) VALUES (
    p_policy_id, 'endorsement', 'endorsement.applied', p_idempotency_key, v_canonical_payload,
    v_previous_hash, v_event_hash
  ) RETURNING id INTO v_event_id;

  INSERT INTO billing_documents (policy_id, policy_event_id, type, amount_cents, status)
  VALUES (p_policy_id, v_event_id, 'endorsement_adjustment', v_delta_cents, 'posted')
  RETURNING id INTO v_billing_document_id;

  INSERT INTO ledger_transactions (policy_id, policy_event_id)
  VALUES (p_policy_id, v_event_id)
  RETURNING id INTO v_ledger_transaction_id;

  -- business-rules.txt: "Positive premium delta: DR Premium Receivable / CR Written Premium."
  -- A premium decrease is the same rule with direction reversed, same absolute amount — still two
  -- balanced entries. A zero delta posts no ledger entries at all (nothing owed changed), but the
  -- policy_event/billing_document/ledger_transaction are still recorded so the endorsement itself
  -- remains part of the auditable history.
  IF v_delta_cents > 0 THEN
    INSERT INTO ledger_entries (ledger_transaction_id, account, direction, amount_cents) VALUES
      (v_ledger_transaction_id, 'premium_receivable', 'debit',  v_delta_cents),
      (v_ledger_transaction_id, 'written_premium',    'credit', v_delta_cents);
  ELSIF v_delta_cents < 0 THEN
    INSERT INTO ledger_entries (ledger_transaction_id, account, direction, amount_cents) VALUES
      (v_ledger_transaction_id, 'written_premium',    'debit',  -v_delta_cents),
      (v_ledger_transaction_id, 'premium_receivable', 'credit', -v_delta_cents);
  END IF;

  UPDATE policies
     SET annual_premium_cents = p_new_annual_premium_cents,
         updated_at = now()
   WHERE policies.policy_id = p_policy_id;

  RETURN QUERY
    SELECT p_policy_id, p_new_annual_premium_cents, v_billing_document_id,
           'endorsement_adjustment'::VARCHAR, v_delta_cents, 'posted'::VARCHAR, 'applied'::VARCHAR;
END;
$$ LANGUAGE plpgsql;

-- T046 (US2): fn_record_payment — validates the payment's currency matches the policy's currency
-- and that amount_cents is a positive integer (FR-008), writes one policy_events row
-- (hash-chained onto the same per-policy chain fn_apply_endorsement writes to — a policy's events
-- are one single chain regardless of operation_type), one payments row, and one ledger_transactions
-- row with balanced ledger_entries (payment received -> DR Cash / CR Premium Receivable, FR-010),
-- all inside this function's own implicit transaction (Principle II atomicity "for free"). Currency/
-- amount validation happens before any INSERT, so a rejected payment is atomically a no-op
-- (data-model.md: "a rejected request ... never reaches an INSERT"). Idempotency follows the exact
-- same pattern as fn_apply_endorsement: re-check policy_events before insert, with the UNIQUE
-- (policy_id, operation_type, idempotency_key) constraint as the race-safe backstop.
CREATE OR REPLACE FUNCTION fn_record_payment(
  p_policy_id             VARCHAR,
  p_idempotency_key       VARCHAR,
  p_external_payment_id   VARCHAR,
  p_amount_cents          BIGINT,
  p_currency              CHAR(3),
  p_received_at           TIMESTAMPTZ
) RETURNS TABLE (
  payment_id              BIGINT,
  external_payment_id     VARCHAR,
  policy_id                VARCHAR,
  amount_cents             BIGINT,
  status                   VARCHAR,
  idempotency_result       VARCHAR
) AS $$
DECLARE
  v_policy_currency        CHAR(3);
  v_canonical_payload      TEXT;
  v_previous_hash          CHAR(64);
  v_event_hash             CHAR(64);
  v_event_id               BIGINT;
  v_payment_id             BIGINT;
  v_ledger_transaction_id  BIGINT;
  v_existing_event_id      BIGINT;
  v_existing_payload       TEXT;
BEGIN
  -- Lock the policy row for the rest of this transaction, same rationale as fn_apply_endorsement:
  -- serializes concurrent mutations against the same policy so the hash-chain's "previous event"
  -- lookup below is race-free. Column references are fully qualified with `policies.` for the same
  -- ambiguous-column reason documented in fn_apply_endorsement (this function's RETURNS TABLE also
  -- declares an OUT variable named `policy_id`).
  SELECT policies.currency INTO v_policy_currency
    FROM policies
   WHERE policies.policy_id = p_policy_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'policy % not found', p_policy_id USING ERRCODE = 'BLB01';
  END IF;

  -- Canonical payload (research.md: fixed-order concatenation, never JSON) — this exact string is
  -- both what gets hashed and what a replay's payload is compared against for idempotency.
  v_canonical_payload := p_policy_id || '|' || 'payment' || '|' || p_idempotency_key || '|' ||
                          p_external_payment_id || '|' || p_amount_cents::TEXT || '|' ||
                          p_currency || '|' || p_received_at::TEXT;

  SELECT pe.id, pe.payload_canonical
    INTO v_existing_event_id, v_existing_payload
    FROM policy_events pe
   WHERE pe.policy_id = p_policy_id
     AND pe.operation_type = 'payment'
     AND pe.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing_payload = v_canonical_payload THEN
      -- Same key, same payload: return the original result verbatim, no new effects (FR-009).
      RETURN QUERY
        SELECT p.id, p.external_payment_id, p.policy_id, p.amount_cents,
               'applied'::VARCHAR, 'duplicate_ignored'::VARCHAR
          FROM payments p
         WHERE p.policy_event_id = v_existing_event_id;
      RETURN;
    ELSE
      -- Same key, different payload: fail clearly, never silently overwrite (FR-009/FR-006 parity).
      RAISE EXCEPTION 'idempotency_key % already used with a different payload for policy %',
        p_idempotency_key, p_policy_id USING ERRCODE = 'BLB04';
    END IF;
  END IF;

  -- Business-rule validation against the locked current DB state (data-model.md: this can only be
  -- checked safely here, not only at the zod/API boundary, to avoid a check-then-write race).
  -- Wrong-currency and non-positive-amount payments are rejected atomically, before any INSERT
  -- (FR-008, constitution "Currency mismatch on a payment fails the whole request atomically").
  IF p_currency <> v_policy_currency THEN
    RAISE EXCEPTION 'payment currency % does not match policy % currency %',
      p_currency, p_policy_id, v_policy_currency USING ERRCODE = 'BLB05';
  END IF;

  IF p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'payment amount_cents % must be a positive integer', p_amount_cents
      USING ERRCODE = 'BLB06';
  END IF;

  -- Hash chain: previous_hash is the latest event's event_hash for this policy (regardless of
  -- operation_type — a policy has exactly one event chain, shared by endorsements and payments), or
  -- the genesis constant if this is the policy's first event ever.
  SELECT pe.event_hash INTO v_previous_hash
    FROM policy_events pe
   WHERE pe.policy_id = p_policy_id
   ORDER BY pe.id DESC
   LIMIT 1;

  IF v_previous_hash IS NULL THEN
    v_previous_hash := fn_genesis_hash();
  END IF;

  v_event_hash := encode(digest(v_canonical_payload || v_previous_hash, 'sha256'), 'hex');

  INSERT INTO policy_events (
    policy_id, operation_type, event_type, idempotency_key, payload_canonical, previous_hash, event_hash
  ) VALUES (
    p_policy_id, 'payment', 'payment.applied', p_idempotency_key, v_canonical_payload,
    v_previous_hash, v_event_hash
  ) RETURNING id INTO v_event_id;

  INSERT INTO payments (
    policy_id, policy_event_id, external_payment_id, idempotency_key, amount_cents, currency, received_at
  ) VALUES (
    p_policy_id, v_event_id, p_external_payment_id, p_idempotency_key, p_amount_cents, p_currency, p_received_at
  ) RETURNING id INTO v_payment_id;

  INSERT INTO ledger_transactions (policy_id, policy_event_id)
  VALUES (p_policy_id, v_event_id)
  RETURNING id INTO v_ledger_transaction_id;

  -- business-rules.txt: "Payment received: DR Cash / CR Premium Receivable." Amount is already
  -- validated positive above, so this always posts exactly two balanced entries.
  INSERT INTO ledger_entries (ledger_transaction_id, account, direction, amount_cents) VALUES
    (v_ledger_transaction_id, 'cash',                'debit',  p_amount_cents),
    (v_ledger_transaction_id, 'premium_receivable',   'credit', p_amount_cents);

  RETURN QUERY
    SELECT v_payment_id, p_external_payment_id, p_policy_id, p_amount_cents,
           'applied'::VARCHAR, 'applied'::VARCHAR;
END;
$$ LANGUAGE plpgsql;

-- T057 (US3): fn_verify_policy_history — recomputes a policy's hash chain in event order (id ASC,
-- i.e. insertion order) rather than trusting the stored `event_hash`/`previous_hash` values
-- (constitution Principle III: "expose a verification path that recomputes and reports chain
-- validity rather than trusting stored flags"). Uses the exact same digest call
-- (`encode(digest(payload || previous_hash, 'sha256'), 'hex')`) as fn_apply_endorsement/
-- fn_record_payment so write-time and verify-time hashing can never diverge (never reimplemented in
-- TypeScript, per this file's own design note above). A read-only function, no writes/locks beyond
-- the implicit row-share locks of the SELECT itself.
--
-- Reports the *first* broken event only (data-model.md, contracts/rest-api.md): once a mismatch is
-- found, subsequent events stop being checked (their pass/fail status would be meaningless once the
-- chain has already diverged from what was recomputed) but are still counted towards event_count so
-- the response accurately reflects how many events exist in total.
CREATE OR REPLACE FUNCTION fn_verify_policy_history(
  p_policy_id  VARCHAR
) RETURNS TABLE (
  policy_id               VARCHAR,
  valid                    BOOLEAN,
  event_count              BIGINT,
  first_broken_event_id    BIGINT
) AS $$
DECLARE
  v_expected_previous_hash  CHAR(64);
  v_computed_hash            CHAR(64);
  v_event                    RECORD;
  v_event_count              BIGINT := 0;
  v_first_broken_event_id    BIGINT := NULL;
  v_valid                    BOOLEAN := TRUE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM policies p WHERE p.policy_id = p_policy_id) THEN
    RAISE EXCEPTION 'policy % not found', p_policy_id USING ERRCODE = 'BLB01';
  END IF;

  v_expected_previous_hash := fn_genesis_hash();

  FOR v_event IN
    SELECT pe.id, pe.payload_canonical, pe.previous_hash, pe.event_hash
      FROM policy_events pe
     WHERE pe.policy_id = p_policy_id
     ORDER BY pe.id ASC
  LOOP
    v_event_count := v_event_count + 1;

    IF v_valid THEN
      v_computed_hash := encode(
        digest(v_event.payload_canonical || v_expected_previous_hash, 'sha256'), 'hex'
      );

      IF v_event.previous_hash <> v_expected_previous_hash OR v_event.event_hash <> v_computed_hash THEN
        v_valid := FALSE;
        v_first_broken_event_id := v_event.id;
      END IF;

      -- Chain continues from this event's own stored hash (not the recomputed one) so a single
      -- corrupted row is pinpointed precisely rather than treated as the start of a cascade — later
      -- events are only checked while v_valid remains true, so this only matters for computing
      -- v_computed_hash on the very next iteration, which never runs once v_valid flips to false.
      v_expected_previous_hash := v_event.event_hash;
    END IF;
  END LOOP;

  RETURN QUERY SELECT p_policy_id, v_valid, v_event_count, v_first_broken_event_id;
END;
$$ LANGUAGE plpgsql;
