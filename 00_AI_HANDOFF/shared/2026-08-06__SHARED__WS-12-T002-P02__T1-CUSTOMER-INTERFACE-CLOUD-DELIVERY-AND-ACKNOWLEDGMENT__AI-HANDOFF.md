# WS-12-T002-P02 — T1 Customer Interface, Cloud Delivery and Acknowledgment

| Field      | Value                                                                            |
| ---------- | -------------------------------------------------------------------------------- |
| Date       | 2026-08-06 · Asia/Phnom_Penh                                                     |
| Authority  | KLD-2026-08-06-WS12-T002-001 (LOCKED); WS-12-T002-P02 owner package              |
| Status     | **WS-12-T002 COMPLETE — IMPLEMENTED-IN-DEV**                                     |
| Workstream | WS-12 T1 Intake/Cashier — IN PROGRESS (T001+T002 closed; T003–T008 NOT STARTED) |
| Push       | NOT PUSHED                                                                       |

## 1. Event-delivery census (§8) — no T002 kind without a consumer

| Event (v1)                          | Effect key                       | Cloud door                                     | Consumer                 |
| ----------------------------------- | -------------------------------- | ---------------------------------------------- | ------------------------ |
| `customer.local_customer_created`   | `kh1.{local_customer_id}.1`      | `kitluy_core.ingest_local_customer_v1` (0186)  | `LocalCustomerIngestion` |
| `customer.consent_decision_recorded`| `kh1.{consent_decision_id}.1`    | `kitluy_core.ingest_consent_decision_v1` (0186)| `ConsentDecisionIngestion` |
| `laundry.booking_draft_recorded`    | `kh1.{booking_draft_event_id}.1` | `kitluy_laundry.ingest_booking_draft_event_v1` (0187) | `BookingDraftIngestion` |

Draft mutations now EMIT (P01 deliberately did not): every accepted
create/update/cancel becomes a durable fact in the SAME transaction, keyed
on its mutation RECEIPT id — one exactly-once fact per mutation. The census
is code (`T002_EVENT_CENSUS` in hub-agent `t1-intake.ts`). Producer:
`kitluy-hub-agent`; retry: pending until an acknowledgment applies;
data minimization: each consumer forwards exactly its door's fields.

## 2. Migrations

**Hub 0041** — the booking-draft guard replaced FORWARD (0040 never
edited): a SYNC-METADATA-ONLY update (`sync_state` + the ack pair, nothing
else) is allowed on ANY lifecycle without a version advance and without
touching `updated_at`; every 0040 business rule (frozen bindings, open-only
mutation, EXACT +1 version) retained and re-asserted in the migration
guard. Without this, a cancelled draft could never take its
acknowledgment.

**Cloud 0187** — the Booking-Draft PROJECTION: `kitluy_laundry.
booking_draft_projections` (one row per Hub draft, newest accepted
version, Hub instants stored verbatim) + append-only
`booking_draft_projection_events` history + the governed door under
NOLOGIN `kitluy_draft_projection_governor` (FORCE RLS, exact per-command
policies; Hub live-assignment + scope verified through `kitluy_devices`;
effect-key exactly-once; newest-version-wins; a LOWER version is history
only (`STALE_RECORDED`); a conflicting SAME-version delivery QUARANTINES
(`conflict_state = version_conflict`) choosing no side; read-only
continuity — never a Booking/price/payment/custody fact). Cross-governor
continuity read: the door resolves an already-ingested local customer to
its cloud id from the 0186 effects journal (read-only, never a merge).
RLS censuses updated with recorded reasoning: SELECT 72→75 (+2
kitluy_core scope reads + effects-journal read) and 17→19 (projection +
history reads in kitluy_laundry); writes 6→9 (projection INSERT + history
INSERT + exactly ONE UPDATE — the newest-version advance — with exactness
assertions refusing any tenth policy, DELETE/ALL, other tables or other
grantees).

## 3. T1 adapters, IPC boundary, interface and localization

- **Typed LAN adapters** (`electron/t1-intake-client.ts`): the eight T002
  routes over the SAME pinned TLS 1.3 mTLS client; the staff session id is
  a main-process header; each mutation mints its own Idempotency-Key;
  governed sentinels map to the closed `IntakeFailureKind` vocabulary —
  `unavailable`, `permission_denied`, `session_invalid`, `conflict`,
  `stale_version`, `not_found`, `invalid_input` are DISTINCT; no raw
  SQLSTATE exists end to end. No generic renderer-controlled HTTP client.
- **IPC boundary** (`electron/intake-ipc.ts` + widened `preload.cts`):
  exactly eight named channels; every payload re-validated in the MAIN
  process by PURE exported validators (unknown fields refuse; no
  route/URL/method/scope/actor/timestamp/verification field exists;
  `staffAssisted` can only WIDEN to true — a renderer cannot launder a
  decision into customer-self). Handlers fail closed (`unavailable`)
  until a completed bootstrap supplies live operations.
- **Intake machine** (`src/intake/machine.ts`): the CLOSED fifteen-state
  §6 vocabulary with the truth rules structural — ambiguity is explicit
  and nothing auto-selects; an unavailable search is `offline`, never
  `no_match`; `pending_sync` is its own state; a stale edit is `conflict`;
  reopen-by-draft-id restores from the Hub (renderer memory is not
  recovery state).
- **Localization** (`src/intake/strings.ts`): governed km-KH/en-US keys
  for every §7 item; the artifact is «ព្រាងការកក់បោកគក់ / Laundry Booking
  Draft»; a test asserts no confirmed-Booking/payment/price wording in any
  string.

## 4. Delivery and acknowledgment (§10)

Hub side (`t1-intake-sync.ts`): `listPendingT002Facts` (hub_sequence
order), `deliveryPayloadOf` (the envelope's public payload only) and
`applyT002Acknowledgment` — the ONLY writer of T002 delivery truth. An
acknowledgment must BIND its fact (event id + effect key + aggregate id)
or it refuses; the outbox walks the LEGAL delivery-state path
(pending → in_flight with a real lease + attempt count → acknowledged
with `cloud_ack_id` + `acknowledged_at`, the 0009 no-fabricated-ack
contract); domain writeback touches SYNC METADATA ONLY — customer
`pending_sync`→`cloud_acknowledged` (+ resolved cloud id) or `conflict`
on a phone-collision verdict; draft acks ride the 0041 carve-out (any
lifecycle, no version advance, `updated_at` untouched); consent facts are
append-only and their outbox ack IS their delivery truth. Fail-closed
results (`POLICY_VERSION_UNKNOWN`, `INTERNAL_ERROR`) leave the fact
PENDING for retry; redelivery returns `DUPLICATE_IGNORED` with one cloud
effect. The authenticated Hub→cloud TRANSPORT remains the recorded
BLK-006 gap (exactly as pairing receipts and health reports) — consumers
are directly-callable classes in `kitluy-device-registry-service`
(`t002-intake-ingestion.ts`), the health-ingestion pattern.

## 5. §12 end-to-end proof (executed, all real)

One live chain in `t1-startup.e2e.integration.test.ts` (real Hub DB
through 0041, real cloud DB through 0187, real TLS 1.3 mTLS server, real
adapters + machine, real staff session + Amendment-003 grants, real
outbox, real doors): search (`no_match`) → minimal customer
(`pending_sync`, unverified phone) → privacy acknowledgement + SMS grant →
draft create → edit (v2) → reopen by Hub draft id (snapshot intact) →
five outbox facts → cloud ingestion (APPLIED / ACKNOWLEDGED / APPLIED /
PROJECTED ×2) → authenticated acks → Hub reconciliation: outbox
`acknowledged`, customer `cloud_acknowledged` with its cloud id, draft
`cloud_acknowledged` at version 2 and **still lifecycle `open` — a draft
remains a draft**; cloud projection v2/open/no-conflict; exactly 2
consent grants; duplicate redelivery of the first fact →
`DUPLICATE_IGNORED`. The offline §11 posture: local commits never touch
the cloud (structurally — no cloud port exists in a T1 route), facts are
durable rows that survive restarts by DB durability (proven across the
test's phase gap), and `pending_sync` display is machine-tested.

## 6. Focused totals (2026-08-06, closeout figures in the commit)

Unit: intake machine + strings + IPC validators **10/10** · app suite
(incl. the extended e2e) green · hub-agent full green (with the census
updates) · Hub reset-from-zero 42 migrations + assertions · cloud
reset-from-zero through 0187 + updated censuses · registry-service
typecheck clean. Exact counts recorded in the closing commit message.

## 7. Recorded notes

1. No dedicated cloud assertion SECTION for 0187 was added: the door's
   behavior is proven by its self-verification guard plus the live §12
   chain; a §-section remains debt for T008-style review.
2. `INTAKE_SYNC_STATES`/`stale_projection` display exists as a string key;
   the projection-staleness UI signal wires when the customer-projection
   REFRESH path (cloud→Hub inbox) lands — a T003+ concern with the
   cloud→Hub direction.
3. The §5 renderer VIEW (React component over the machine) is minimal
   debt: the machine, strings, bridge and validators are the tested
   surface; `App.tsx` wiring of the intake panel follows the T007
   integration task with the rest of the T1 workflow UI.

Next: **WS-12-T003 — Service, Garment, Evidence and Custody Intake**
(NOT STARTED).
