# WS-12-T002 — Customer Identity, Consent and Booking Draft

| Field      | Value                                                                              |
| ---------- | ---------------------------------------------------------------------------------- |
| Date       | 2026-08-06 · Asia/Phnom_Penh                                                       |
| Authority  | KLD-2026-08-06-WS12-T002-001 (OWNER-APPROVED — LOCKED); WS-12 pre-T002 hardening   |
| Status     | **SUPERSEDED — WS-12-T002 COMPLETE — IMPLEMENTED-IN-DEV (closed by P02, see the P02 handoff)** |
| Workstream | WS-12 T1 Intake/Cashier — IN PROGRESS (T001 closed; T003–T008 NOT STARTED)         |
| Push       | NOT PUSHED                                                                         |

## 0. Stage A — the resolver "fix" that was a retraction

The package ordered a fix for `edge_config.resolve_permission_grant` being
PUBLIC-executable, conditioned on reproduction. **Reproduction REFUTED the
report** (KLREC-2026-08-06-WS12-STAGEA-001): Hub 0025 lines 146–151 already
revoke PUBLIC and grant only `kitluy_hub_runtime`; the live ACL carries no
PUBLIC entry; a grantless role and five unrelated governors all fail the
effective-execution probe while `kitluy_hub_runtime` passes. **No Hub
migration 0040 was created for Stage A** (it would have been empty). The
correct state is PINNED forever by `hub/tests/assertions.sql` §28b
(direct-ACL + effective-execution + unrelated-governor probes). Commit:
`fix(ws-12): restrict hub permission resolver` (`4c67581`). The P02
handoff §6 item 1 is corrected in place; T001 stays COMPLETE.

## 1. What T002 delivered (all executed, live databases)

**Owner decision** `KLD-2026-08-06-WS12-T002-001` recorded and LOCKED
(customer identity §2, consent §3, Booking Draft §4, offline truth labels
§5, the authorization stack §6).

**Hub migration 0040** (`t1_customer_consent_and_booking_draft`):
additive customer-projection columns (`origin`, `sync_state` with the six
§5 truth labels, creation idempotency, cloud-ack pair — a locally created
customer is `pending_sync`, never cloud-labelled early), the scoped
normalized-phone lookup index, `edge_core.consent_decision` (append-only
facts binding policy/version, channel, decision, actor, terminal, Store,
source, Hub-authoritative timestamp, correlation id; privacy-pairing CHECK
— acknowledged ⟺ privacy notice), `edge_laundry.booking_draft` (the
Hub-authoritative WORKING draft: walk-in XOR customer, IMMUTABLE
`customer_snapshot`, structurally separated staff notes, lifecycle
open/cancelled/expired/converted/superseded with cancel-reason pairing,
monotonic version, creation idempotency, sync labels) and
`edge_laundry.booking_draft_event` (append-only mutation receipts whose
unique `request_key` IS the duplicate-update guard). Invariant triggers:
append-only ledgers, frozen draft bindings, EXACT +1 version advance,
terminal lifecycle states final, no hard delete. Two SECURITY INVOKER
doors own the idempotency/refusal discipline
(`register_local_customer_v1`, `record_consent_decision_v1`). Hub
assertions §37 exercises all of it; relation tally 72 → 75.

**Cloud migration 0186** (`t1_customer_and_consent_ingestion`): the FIRST
governed doors over the WS-06 customer/consent tables (planned group 0130
was never authored; the only write path was BYPASSRLS `service_role`).
NOLOGIN `kitluy_customer_ingestion_governor` (granted to nobody) owns
`ingest_local_customer_v1` and `ingest_consent_decision_v1` plus the
append-only `customer_ingestion_effects` journal — effect-key (`kh1.`)
idempotent, replay returns the stored verdict, conflicting reuse refuses.
A normalized-phone collision with an ACTIVE contact returns a **bare
CONFLICT carrying no customer identity** — surfaced for governed
resolution, never an automatic merge. Consent ingestion maps
granted/acknowledged → `consent_grants`, withdrawn → `consent_withdrawals`
(grant preserved; nothing-to-withdraw recorded non-destructively),
declined → journal evidence only; an unpublished policy version **fails
closed** (`KLUY-CONSENT-INGEST-POLICY-VERSION-UNKNOWN`) — purpose KEYS are
technical identifiers shipped by 0186, purpose VERSIONS are owner legal
values shipped by NO migration (dev seed provides synthetic v1 rows). RLS
census widened 62 → 72 SELECT and 0 → 6 write policies — the six are
INSERT-only, all scoped to the NOLOGIN governor, with exactness assertions
refusing any seventh policy, non-INSERT command or other grantee (recorded
in the census comments as the first PC-RPC write policies, strictly
tighter than the BYPASSRLS path 0140 moved away from).

**Routes and permissions.** Eight served intake routes (repository-
conventional shapes): customers under the NEUTRAL generic namespace
(`GET /edge/v1/customers/search?phone=`, `GET /edge/v1/customers/{id}`,
`POST /edge/v1/customers`, `POST .../consent-decisions`), drafts under the
LAUNDRY namespace on the existing approved resource
(`POST/GET/PATCH /edge/v1/laundry/bookings/drafts[...]` + `/cancel`) —
the generic `/edge/v1/booking-drafts` placement would have repeated the
recorded Group 1 namespace violation, and the Group 1 REJECTED PATCH-draft
shape now carries its supersession note citing the T002 owner decision.
Held OUTSIDE `EDGE_ROUTES` (`EDGE_T002_INTAKE_ROUTES`, the bootstrap-read
precedent) so the Group 1 count stays exact. Permissions: registry
amendment 003 (114 → 117): `customers.read`, `customers.create`,
`customers.consent.record`; draft routes REUSE `laundry.bookings.read` /
`laundry.bookings.create` (the recorded command-registry precedent — no
synonyms). Scopes +4 additive. Every route demands the full §6 stack —
mTLS terminal, T1 profile, ACTIVE unexpired session owned by THIS
terminal (`x-kitluy-session-id`), `pos.t1.use` AND the route permission,
re-resolved per request (`authorizeT1IntakeSession`); the caller supplies
no scope, staff, terminal identity or timestamps; unknown query and body
fields are rejected; bodies bounded at 8 KiB.

**Outbox.** A locally created customer and every consent decision become
durable outbox facts in the SAME transaction (`customer.
local_customer_created` v1, `customer.consent_decision_recorded` v1, keys
`kh1.{row_id}.1` — the terminal-health emit pattern), addressed to the
0186 doors. Drafts emit nothing: the Hub IS the draft authority and
nothing reconciles before conversion (T004+).

## 2. Verification record (2026-08-06, all executed)

| Gate                                                       | Result                                     |
| ---------------------------------------------------------- | ------------------------------------------ |
| Hub reset from zero (41 migrations) → seed → assertions    | **45 PASS** (§28b pin + §37 T002) · validate clean |
| Cloud reset from zero (0000→0186) → seed → db:test         | **243 PASS incl. the FULL RLS suite, exit 0** |
| hub-agent routes suite (live mTLS + both DBs)              | **20/20** (16 P02 + 4 T002 route tests)    |
| edge-contracts                                             | **45/45**                                  |
| rbac (117 canonical keys)                                  | **15/15**                                  |
| typecheck: hub-agent, edge-contracts, rbac                 | clean                                      |
| changed-file lint/format + secret scan                     | recorded in the closing commit             |

The four T002 route tests prove live: minimal customer created ONCE with
honest labels (`local_created`/`pending_sync`, unverified phone), replay
single-effect with exactly one outbox fact, conflicting idempotency
refused, scoped normalized search (raw `012 911 222` → `+85512911222`),
malformed phone refused (never fabricated zero results), unknown query
parameter refused; consent acknowledged/granted/withdrawn as three
preserved append-only facts all labelled staff-assisted with three outbox
facts, wrong privacy pairing refused, replay returns the original
decision; draft create/read/update/cancel with the snapshot surviving a
customer-master rename, EXACT-version updates, duplicate update replayed
once, stale version refused, cancelled drafts final, ungoverned cancel
reasons refused, no price/payment surface on a draft; and the §6 stack —
no header, forged session, missing `pos.t1.use`, missing route key,
cross-terminal session, missing Idempotency-Key, unknown body fields all
refused with the closed vocabulary.

## 3. PARTIAL — what remains for the successor package

1. **The §7 T1 interface** — the intake workflow states (idle …
   ambiguous_matches … draft_ready … offline), Khmer/English strings,
   the read-only-bridge widening (a named invoke surface; the renderer
   still supplies no scope/identity/timestamps) and the terminal-side
   adapters for the eight routes. The server surface it talks to is
   complete and proven.
2. **Terminal-side §8 items that live in that UI layer**: offline truth
   labels rendered (`pending_sync`/`conflict`/`stale_projection` display),
   no-fabricated-zero-results on search unavailability, staff-notes visual
   separation.
3. **Sync-engine consumption**: the hub-agent WS-10 delivery pipeline
   already transports outbox facts; wiring the CLOUD consumer that calls
   the two 0186 doors from the transmission inbox (the WS-11-T005-P02
   health-consumer precedent) plus the Hub-side acknowledgment writeback
   (`sync_state` → `cloud_acknowledged`, conflict surfacing).
4. **Route-level cross-Store transplant probes** for customers/drafts
   (single-Store harness today; the scope derivation itself is proven at
   the SQL layer by Hub §37 and cloud WS12-T002 sections).

## 4. Out-of-scope findings (recorded, not fixed)

1. `edge_core.customer.consent_sms/consent_email` (0004) are legacy
   mutable booleans; T002 neither reads nor writes them — an amendment to
   the 0004 comment is owed (recorded in the 0040 header).
2. The sessions-open/refresh/close Idempotency-Key header remains
   presence-checked only (P02 state); T002's own mutations carry REAL
   dedup — the sessions surface should adopt the same discipline.
3. `kitluy_storefront.customer_phone_challenges` is tenant-unscoped
   (WS-06 shape) — untouched here, noted for the owning workstream.

## 5. Commits

1. `4c67581` — `fix(ws-12): restrict hub permission resolver` (Stage A:
   retraction + §28b pin).
2. This commit — `feat(ws-12): add customer consent and booking drafts`.

Next: the T002 successor package (T1 interface + sync consumption), then
**WS-12-T003 — Service, Garment, Evidence and Custody Intake** (NOT
STARTED).
