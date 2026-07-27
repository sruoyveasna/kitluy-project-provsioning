# KitLuy Contract Vocabulary — Owner Review Ballot

**Filename:** `kitluy-contract-vocabulary-owner-review-v1.0.0.md`
**Version:** v1.0.0
**Date:** 2026-07-26
**Decision under review:** KLD-2026-07-26-002 (**OWNER-APPROVED** 2026-07-27) —
[full analysis](../../../decisions/kitluy-contract-vocabulary-and-edge-api-owner-decision-v1.0.0.md)
**Status:** **DECIDED — all five groups OWNER-APPROVED 2026-07-27.**

| Field         | Value                |
| ------------- | -------------------- |
| Owner         | KitLuy Project Owner |
| Decision ID   | KLD-2026-07-26-002   |
| Decision date | 2026-07-27           |
| Task          | KL-DEC-001           |

| Group | Verdict                                                        |
| ----- | -------------------------------------------------------------- |
| 1     | APPROVED                                                       |
| 2     | APPROVED                                                       |
| 3     | APPROVED                                                       |
| 4     | APPROVED WITH REGEX CORRECTION                                 |
| 5     | APPROVED WITH ADDITIVE CODES AND PAYMENT_PENDING CLARIFICATION |

Every rejected name is REJECTED-BEFORE-IMPLEMENTATION — no aliases and no
deprecation paths, because no affected mutation route, event or client was
deployed. Approval is a decision record only: it is NOT implementation
evidence (KLD-EVIDENCE-001), and Hub mutation routes
(`services/kitluy-hub-agent/src/lan-api.ts`) remain fail-closed until the
corresponding implementation and tests pass under KL-DEC-001-T002/T006.

---

## ☑ Group 1 — `/edge/v1` routes — **APPROVED**

**Recommendation:** Generic Edge platform operations (sessions, approvals,
health, config, diagnostics, sync, files, printing, peripherals, shifts,
display sessions, device mgmt) at `/edge/v1/*` **without** vertical prefix;
Laundry commands under `/edge/v1/laundry/*`. Contested pairs resolve to:
`/sessions/open` (not `/sessions/login`); `/laundry/bookings/drafts` (not
`/bookings/drafts`); `/laundry/bookings/{id}/confirm-intake` (not
`…/finalize`); `/laundry/ready-sessions` + `/{id}/scans` (not
`/ready-scan/sessions` + `/items`); `/display-sessions` (not
`/displays/sessions`); `/laundry/pickup-sessions/{id}/complete` (not
`/pickup-scan/{id}/complete` or `…/release`).

**Alternatives:** (a) LAN API shape everywhere — no vertical prefix; blocks
clean Phase 2+ vertical namespaces. (b) Edge Ops API shape everywhere —
`login`/`finalize`/`release` verbs; contradicts owner vocabulary
(confirm-intake, complete) used in permissions, state machines and audit
events.

**Consequence of approval:** One OpenAPI source can be authored; Hub mutation
routes can be scaffolded against a single contract; KLREC-2026-07-26-001 (and
the API part of -002) closes. Both source specs get a documentation
remediation pass; losing routes never ship.

## ☑ Group 2 — Terminal-profile identifiers — **APPROVED**

**Recommendation:** Logical profile identifiers
`laundry.t1.intake_cashier`, `laundry.t2.customer_display`,
`laundry.t3.ready_scan_in`, `laundry.t4.pickup_scan_out`. Distinct from
device-profile codes (`laundry_front_counter`, … — unchanged), device
assignments, RBAC permissions and active-mode switching. Code keeps today's
`t1_intake_cashier` style until approval, then renames in one commit.

**Alternatives:** (a) Keep `t1_intake_cashier` (no vertical segment) —
collides when Restaurant adds its own T-profiles. (b) Use device-profile
codes as logical identifiers — conflates hardware with permissioned role;
breaks shared T3/T4 hardware.

**Consequence of approval:** KLREC-2026-07-26-009 closes; T1–T4 semantics
(KLD-2026-07-21-002) unchanged; `t2_scan_in`/`t3_scan_out` stay retired.

## ☑ Group 3 — Permission grammar — **APPROVED**

**Recommendation:** One grammar: dot-separated lowercase `snake_case`
segments, `<domain>.<resource_or_capability>.<verb>`; the RBAC registry's
**107 keys are the baseline**; `releases.promote_stable` wins over
`releases.promote.stable`; no resource UUIDs or environments in key names.
Permission key, API scope, resource scope, environment scope, device
capability and approval policy remain six separate vocabularies. Repo seed
keys map: `releases.promote.stable` → `releases.promote_stable`;
`infrastructure.backup.restore` → `platform.backup.restore_production` /
`restore_test`; `security.certificates.rotate` →
`devices.certificate.rotate`; `platform.jobs.retry` unchanged. Scope
taxonomy: resource-scope model wins (`tenant`, `device`, + `chain`,
`file_object`, `support_session`, `release_cohort`).

**Alternatives:** (a) Adopt infra-spec §16.5 seed names — overrides the
registry both security registries already agree on. (b) Dual grammar — two
immutable vocabularies for the same grants; permanent drift.

**Consequence of approval:** KLREC-2026-07-26-013 (and -012 vocabulary)
closes; `@kitluy/rbac` and `@kitluy/resource-scope` re-seed in one commit.

## ☑ Group 4 — Event versioning — **APPROVED WITH REGEX CORRECTION**

**Recommendation:** Stable semantic names `<context>.<fact>` (e.g.
`laundry_booking.created`, `payment.recorded`) with the schema revision only
in the envelope's `schema_version` integer — the domain event registry's
model. Name-embedded `.v1` forms (`laundry.booking_created.v1`) become
documentation-only compatibility aliases. `@kitluy/event-contracts`' validator
(currently requires `.v<major>`) is retargeted on approval. No new business
semantics; the 15 registered events are untouched.

**Alternatives:** (a) Keep `.v<major>` names (POS §15.2) — every schema
revision renames the event, breaking stable consumer subscriptions. (b) Both
forms live — permanent double bookkeeping for zero published events.

**Consequence of approval:** KLREC-2026-07-26-011 closes; one validator
change + tests; sync/outbox contracts reference stable names.

## ☑ Group 5 — Error identifiers — **APPROVED WITH ADDITIVE CODES AND PAYMENT_PENDING CLARIFICATION**

**Recommendation:** The API error code registry (50 codes) is canonical for
all production errors. POS-spec names in `@kitluy/api-errors` map onto it:
`BOOKING_VERSION_CONFLICT` → `RESOURCE_VERSION_CONFLICT`;
`DUPLICATE_IDEMPOTENCY_KEY` →
`IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST`; `UNAUTHENTICATED` →
`AUTHENTICATION_REQUIRED`; `PERMISSION_DENIED`/`ACTOR_PERMISSION_DENIED` →
`SCOPE_PERMISSION_DENIED`; generic `CONFLICT` retires;
`COLLECTOR_VERIFICATION_REQUIRED`/`BALANCE_PAYMENT_REQUIRED` fold into
`PICKUP_RELEASE_BLOCKED` details. Registry HTTP/retryability values win.
Three gaps need registration (separate sub-approval): `INTERNAL_ERROR`,
`SCALE_UNSTABLE`, `GARMENT_COUNT_MISMATCH` (+ Hub read-only state).

**Alternatives:** (a) POS §14.3 names canonical — Edge diverges from the
other three surfaces sharing the registry. (b) Keep both — same condition,
two immutable codes, forever.

**Consequence of approval:** KLREC-2026-07-26-010 closes; `@kitluy/api-errors`
re-seeds from the registry in one commit; localization keys
(`api.error.<code>`, Khmer/English) and operator actions come with it.

---

**On full approval:** record KLD-2026-07-26-002 in the
[decision register](../../../authority/kitluy-decision-and-reconciliation-register-v1.0.0.md),
move KLREC-2026-07-26-001/-002(API part)/-009/-010/-011/-012(vocabulary)/-013
to RESOLVED, then unblock Hub mutation-route scaffolding. Until then all code
identifiers stay as scaffolded and Hub mutations stay blocked.
