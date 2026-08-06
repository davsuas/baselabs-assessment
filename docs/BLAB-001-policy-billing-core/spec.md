# Feature Specification: Policy Billing & Ledger Core

**Feature Branch**: `BLAB-001-policy-billing-core`

**Created**: 2026-08-05

**Status**: Draft

**Input**: User description: "use the @docs/assessment.md" — build a focused slice of a homeowners-
insurance Policy Administration System (PAS): mid-term endorsements with prorated premium billing,
received-payment ingestion, a balanced double-entry ledger, append-only tamper-evident policy history,
and a minimal frontend for an operator to review and act on all of the above.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Apply a Mid-Term Endorsement and Generate Billing (Priority: P1)

An operator submits a mid-term change to an active policy's annual premium (an endorsement — e.g. a
discount was removed). The system calculates the prorated premium delta for the remaining term,
produces exactly one billing document for that adjustment, and records exactly one policy event
capturing what changed and why. If the same endorsement request arrives again (a retry from an
upstream system, or a double-click), the system does not bill or record it twice.

**Why this priority**: This is the financial core of the assessment — deterministic, auditable proration
is the single most evaluated capability, and every other view in the system (balance, ledger, timeline)
depends on this working correctly first.

**Independent Test**: Can be fully tested by submitting one endorsement request against a known policy
and verifying the resulting billing document amount matches the expected prorated delta to the cent,
independent of any payment or frontend work.

**Acceptance Scenarios**:

1. **Given** an active policy with a known annual premium and term dates, **When** an operator submits
   an endorsement with a new annual premium and an effective date inside the term, **Then** the system
   returns a billing document whose amount equals the deterministic prorated delta and a policy event
   recording the change.
2. **Given** an endorsement has already been applied with a specific idempotency key, **When** the exact
   same request (same key, same payload) is submitted again, **Then** the system returns the original
   result and creates no new billing document, policy event, or ledger effect.
3. **Given** an endorsement has already been applied with a specific idempotency key, **When** a request
   with the same key but different content (e.g. a different new premium) is submitted, **Then** the
   system rejects the request with a clear error and makes no changes.
4. **Given** a policy that is not active (e.g. cancelled or expired), **When** an operator submits an
   endorsement against it, **Then** the system rejects the request and creates no billing document,
   policy event, or ledger effect.
5. **Given** an active policy, **When** an operator submits an endorsement with an effective date outside
   the policy's term, **Then** the system rejects the request and creates no billing document, policy
   event, or ledger effect.

---

### User Story 2 - Record a Received Payment and Update the Balance (Priority: P2)

An operator (or an upstream system, via the same API) submits a record of a payment that was already
collected outside this system. The system validates the payment (in particular, that its currency
matches the policy's currency), applies it to the policy's open balance, and records the corresponding
ledger effect. Payments already recorded (duplicate delivery, a common failure mode of upstream
systems) are recognized and not double-applied.

**Why this priority**: Payment ingestion is the second half of financial correctness — without it, open
balance and ledger views are incomplete — but it is independently valuable and testable without
touching the endorsement flow, so it follows P1 rather than blocking on it.

**Independent Test**: Can be fully tested by submitting a payment record against a policy with a known
open balance and verifying the balance decreases by exactly the payment amount and a balanced ledger
entry is created, independent of endorsement or frontend work.

**Acceptance Scenarios**:

1. **Given** a policy with an open balance and a matching currency, **When** an operator submits a valid
   payment record, **Then** the system persists the payment, reduces the open balance by the payment
   amount, and posts a balanced ledger entry.
2. **Given** a payment has already been recorded with a specific idempotency key, **When** the exact same
   payment record is submitted again, **Then** the system returns the original result and applies no
   additional balance or ledger effect.
3. **Given** a policy with a fixed currency, **When** a payment is submitted in a different currency,
   **Then** the system rejects the payment, leaves the balance and ledger unchanged, and reports the
   currency mismatch.

---

### User Story 3 - Review Policy State, Ledger Balance, and History Integrity (Priority: P3)

An operator opens a policy and, without reading code or a database, understands: the policy's current
status and premium, its open balance, a timeline of what happened and when, proof that the ledger is
balanced, and whether the policy's event history is verifiably intact or has been tampered with — plus
a plain-English summary and suggested next action.

**Why this priority**: This is the visibility layer over Stories 1 and 2. It has no financial logic of its
own, so it is lower risk, but it is what makes the system usable and explainable to a non-technical
reviewer, which the assessment explicitly evaluates.

**Independent Test**: Can be fully tested by seeding a policy with a known history of endorsements and
payments (including the one rejected currency-mismatch case) and verifying the state view, ledger view,
and history-verification view each report accurate, human-readable results — independent of submitting
any new requests during the test.

**Acceptance Scenarios**:

1. **Given** a policy with prior endorsements and payments, **When** an operator requests the policy's
   state, **Then** the response shows current status, current annual premium, open balance, and a
   readable list of billing documents and payments.
2. **Given** a policy with prior financial activity, **When** an operator requests the policy's ledger,
   **Then** the response shows the transactions/entries and states plainly whether the books are
   balanced.
3. **Given** a policy with an intact event history, **When** an operator requests history verification,
   **Then** the response confirms the chain is valid and reports the event count.
4. **Given** a policy whose stored history has been altered after the fact (simulated tampering),
   **When** an operator requests history verification, **Then** the response reports the chain as
   invalid rather than silently passing.
5. **Given** a policy with an open balance greater than zero, **When** an operator views the policy
   summary, **Then** the summary includes a plain-English suggested next action (e.g. that payment is
   still due); **Given** an open balance of zero, **Then** the suggested action indicates no action is
   required.

### Edge Cases

- What happens when an endorsement or payment is submitted for a policy ID that does not exist?
  The request MUST be rejected with a clear not-found error and no side effects.
- What happens when an endorsement's new premium equals the current premium (a zero-delta
  endorsement)? The system MUST still record the event and MAY produce a zero-amount billing
  document, but MUST NOT treat a zero delta as an error.
- What happens when a payment amount is zero or negative? The request MUST be rejected as invalid.
- What happens when two different, non-duplicate payments are submitted for the same policy in
  immediate succession? Both MUST be applied, each with its own balanced ledger entry, with no
  interference between them.
- What happens when an idempotency key is reused across two different operation types (e.g. one used
  for both an endorsement and a payment)? Idempotency keys MUST be scoped so this does not cause a
  cross-type collision.
- What happens when history verification is requested for a policy with zero events? It MUST report
  the chain as valid with an event count of zero, not as an error.
- What happens when a request omits its caller credential, or carries an invalid one? It MUST be
  rejected before touching policy, billing, payment, or ledger logic, with no side effects.
- What happens when a single caller exceeds the request-rate threshold? Further requests from that
  caller MUST be rejected until the threshold resets, without affecting other callers.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST accept endorsement requests carrying, at minimum, a new annual premium, an
  effective date, and an idempotency key, scoped to a specific policy.
- **FR-002**: System MUST validate that the target policy is active and that the endorsement's effective
  date falls within the policy's term before applying any effect; otherwise it MUST reject the request
  with no side effects.
- **FR-003**: System MUST calculate the prorated premium delta deterministically to the cent, based on
  the remaining days in the term from the effective date, using a fixed, documented rounding rule.
- **FR-004**: System MUST create exactly one billing document and exactly one policy event per accepted
  endorsement, and MUST update the policy's current annual premium to the new value.
- **FR-005**: System MUST treat an endorsement request whose idempotency key matches a prior request
  with an identical payload as a no-op, returning the original result and creating no new billing
  document, policy event, or ledger effect.
- **FR-006**: System MUST reject an endorsement request whose idempotency key matches a prior request
  but whose payload differs, with a clear error and no side effects.
- **FR-007**: System MUST accept payment records carrying, at minimum, an amount, a currency, a
  received timestamp, and an idempotency key (or equivalent external payment identifier), scoped to a
  specific policy.
- **FR-008**: System MUST validate that a payment's currency matches the target policy's currency and
  that its amount is a positive integer number of cents; otherwise it MUST reject the request with no
  side effects.
- **FR-009**: System MUST treat a payment record whose idempotency key (or external payment ID)
  matches a prior successful submission as a duplicate, returning the original result and applying no
  additional balance or ledger effect, whether or not the resubmitted payload is byte-identical.
- **FR-010**: System MUST reduce the policy's open balance by the payment amount and post a balanced
  ledger entry for every accepted payment.
- **FR-011**: System MUST execute every financial mutation (endorsement acceptance, payment
  acceptance) as a single atomic unit of work: either all resulting writes (domain record, billing/
  balance update, ledger entries) succeed together, or none of them persist.
- **FR-012**: System MUST post balanced double-entry ledger effects for every accepted financial
  mutation, such that total debits equal total credits for that mutation.
- **FR-013**: System MUST record policy events as append-only: once written, an event's content MUST
  never be edited or deleted; corrections MUST be represented as new, subsequent events.
- **FR-014**: System MUST compute each policy event's hash from a canonical representation of its own
  payload plus the previous event's hash, forming a verifiable chain.
- **FR-015**: System MUST provide a way to verify a policy's event-history chain on demand, recomputing
  hashes rather than trusting a stored flag, and reporting whether the chain is valid along with the
  event count.
- **FR-016**: System MUST provide a way to retrieve a policy's current state: identifier, status, current
  annual premium, currency, term dates, open balance, and its associated billing documents and
  payments.
- **FR-017**: System MUST provide a way to retrieve a policy's ledger transactions/entries (or an
  equivalent summary) that makes it possible to confirm the books are balanced.
- **FR-018**: System MUST express every monetary value — in storage, in calculations, and in API
  responses — as an integer number of cents; no monetary value may be represented or computed as a
  floating-point number at any point.
- **FR-019**: System MUST allow an operator, through a minimal frontend, to view a policy's current
  state and a timeline of its events, billing documents, payments, and ledger summary.
- **FR-020**: System MUST allow an operator, through a minimal frontend, to submit an endorsement and
  see either the resulting outcome or a readable validation error.
- **FR-021**: System MUST allow an operator, through a minimal frontend, to submit a received-payment
  record (amount, currency, and identifying metadata only — no card numbers or bank credentials) and
  see either the resulting outcome or a readable validation error.
- **FR-022**: Frontend MUST visibly distinguish at least four states for any submission or data fetch:
  loading, success, validation error, and server error.
- **FR-023**: System MUST produce, for a policy, a plain-English summary and a suggested next action
  derived from its current open balance and history-verification status.
- **FR-024**: System MUST reject any request to any endpoint that does not carry a valid caller
  credential, before that request reaches policy, billing, payment, or ledger logic.
- **FR-025**: System MUST protect every endpoint against excessive request volume from a single caller,
  rejecting requests once a reasonable threshold is exceeded rather than allowing unbounded retries to
  degrade the service.

### Key Entities *(include if feature involves data)*

- **Policy**: The insured contract under management — identifier, homeowner reference, status, term
  start/end dates, current annual premium (integer cents), currency. Its current premium and status
  change only as a result of accepted endorsements.
- **Policy Event**: An append-only, hash-chained record of something that happened to a policy
  (e.g. an endorsement being requested/applied). Carries its type, canonical payload, the previous
  event's hash, and its own computed hash — the audit trail's backbone.
- **Billing Document**: A billable adjustment produced by an endorsement (e.g. the prorated premium
  delta) — carries type, amount (integer cents), and status. One per accepted endorsement.
- **Payment**: A record of money already collected outside this system, ingested via the API — carries
  amount (integer cents), currency, received timestamp, an idempotency/external identifier, and its
  applied/rejected outcome.
- **Ledger Transaction**: A balanced group of debit and credit ledger entries produced by a single
  financial mutation (an endorsement or a payment) — the unit that must always sum to zero net effect.
- **Ledger Entry**: A single debit or credit line within a ledger transaction, referencing an account
  (e.g. Premium Receivable, Written Premium, Cash) and an amount (integer cents).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator can submit a mid-term endorsement and receive the correct prorated billing
  amount, accurate to the cent, in the same response — with zero discrepancy against manual
  calculation across a documented set of test scenarios.
- **SC-002**: Resubmitting an identical endorsement request any number of times never results in more
  than one billing document or policy event for that endorsement.
- **SC-003**: Resubmitting an identical (or duplicate-identified) payment any number of times never
  results in more than one balance reduction or ledger entry for that payment.
- **SC-004**: 100% of payments submitted in a currency other than the policy's currency are rejected
  with zero effect on balance or ledger.
- **SC-005**: 100% of ledger transactions returned to an operator have exactly equal total debits and
  total credits.
- **SC-006**: An operator can determine, from a single screen and without external tools, whether a
  policy's event history is verified-intact or has been tampered with, with no ambiguous states.
- **SC-007**: An operator with no prior context on a specific policy can determine its status, open
  balance, and suggested next action within 30 seconds of opening its view.
- **SC-008**: No financial mutation ever leaves the system in a partially-written state when it fails —
  a failed endorsement or payment submission results in zero new billing documents, policy events,
  payments, or ledger entries.

## Assumptions

- Each policy has a single fixed currency for its lifetime; multi-currency policies are out of scope.
- Idempotency keys are scoped per operation type (endorsements vs. payments) and per policy, so the
  same key value used for two different operation types does not collide.
- Only one endorsement is processed at a time per request; concurrent conflicting endorsement
  submissions for the same policy are handled by the same idempotency and atomicity rules, not by a
  separate locking/queueing mechanism.
- "Operator" is a single trusted internal user role; no multi-role permission model or self-service
  policyholder access is in scope, consistent with the assessment's "no full authentication/
  authorization system" exclusion.
- The sample data and business rules embedded in `docs/assessment.md` (`policy.json`, `events.json`,
  `business-rules.txt`, including the two named ledger account pairs — Premium Receivable/Written
  Premium and Cash/Premium Receivable) are treated as authoritative seed/fixture data and rule source,
  not merely illustrative examples.
- "Server error" in FR-022 covers any failure not attributable to caller input (validation errors are
  reported separately as a distinct state).
- A single static caller credential (issued out-of-band, e.g. via local configuration) satisfies FR-024
  for this project's single-trusted-operator, local-only scope; a full user-directory-backed protocol
  (OAuth2 or similar) was considered and rejected as itself being the kind of full authentication/
  authorization system the assessment explicitly places out of scope.
- The rejection response for an unauthenticated or rate-limited request (FR-024, FR-025) is treated by
  the frontend as the "server error" state (FR-022) rather than a fifth distinct UI state, since the
  minimal frontend always presents a valid credential itself under normal operation.
