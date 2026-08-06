# KitLuy T1 Customer, Consent and Booking Draft — Owner Decision v1.0.0

**Decision ID:** `KLD-2026-08-06-WS12-T002-001`
**Status:** `OWNER-APPROVED — LOCKED`
**Date:** 2026-08-06 · Asia/Phnom_Penh
**Authority chain:** KLD-2026-08-06-WS12-TASKS-001 (WS-12 task register) →
this decision (WS-12-T002 owner package). T1 remains a composition surface
— this decision creates NO new customer master, NO new consent ledger and
NO new authoritative Laundry Booking model. The WS-06 cloud customer and
consent authority remains the identity truth; the Store Hub is the
Store-local authority for the WORKING draft only.

## 1. Scope fence

In scope: customer search, customer selection, minimal customer creation,
contact-verification state, consent capture and withdrawal with immutable
evidence, the mutable Laundry Booking Draft, Hub-local offline operation,
asynchronous cloud reconciliation, and the T1 UI workflow for these.

Out of scope (T003–T005 and later): services, garments, evidence, pricing,
due time, payment, receipt, tag issuance, and the conversion of a draft to
an authoritative Laundry Booking. A Booking Draft is NOT a confirmed
Laundry Booking, NOT a price commitment, NOT a capacity commitment, NOT a
payment obligation and NOT an inventory or custody event. Customer merge,
destructive deduplication and cross-Store identity linking are outside
T002.

## 2. Customer identity (LOCKED)

1. Phone is the primary Phase 1 Laundry LOOKUP input — not the universal
   customer primary key. The customer ID remains the authoritative
   identity.
2. Supported Cambodian numbers are normalized to E.164; the raw entered
   value is preserved for evidence and display. Default country code:
   `+855`.
3. Name, phone display text or Telegram username alone must NEVER trigger
   an automatic merge.
4. Exact normalized-phone matches may be returned ONLY within the
   authenticated Tenant and Digital Store scope. No route may expose
   whether a customer exists in another Tenant or Store.
5. Multiple eligible matches produce an EXPLICIT ambiguous-result state;
   T1 must not select one silently.
6. T1 may create a MINIMAL UNVERIFIED customer when the workflow permits.
7. Phone VERIFICATION state is separate from phone PRESENCE. Staff cannot
   fabricate customer self-verification.

## 3. Consent (LOCKED)

Categories, kept distinct: privacy-notice acknowledgement ·
operational/transactional communication · SMS marketing · Telegram
marketing · email marketing (where an email exists).

1. No optional marketing consent is preselected.
2. Privacy acknowledgement is NOT equivalent to marketing consent; one
   purpose cannot authorize another.
3. Consent is scoped to the correct Tenant/Digital Store and purpose.
4. Consent evidence binds: policy/version, channel, decision, actor,
   terminal, Store, source, timestamp and correlation ID.
5. Withdrawal creates a NEW append-only fact; withdrawal does not erase
   prior evidence.
6. Retry returns the original business effect (idempotent).
7. Assisted consent is labelled staff-assisted; staff cannot fabricate
   customer self-verification.

## 4. Booking Draft (LOCKED)

The Store Hub is the Store-local authority for the working draft.

Required fields: offline-capable draft ID · Tenant, Digital Store,
Location and environment · T1 terminal and staff session · selected
customer ID or explicit walk-in state · IMMUTABLE customer/contact
snapshot for the draft · preferred language · intake source · customer
notes · internal staff notes (kept separate) · lifecycle · version ·
created-at/updated-at from Hub-authoritative time · idempotency and
correlation references · sync state and cloud acknowledgment where
applicable.

Lifecycle: `open` · `cancelled` · `expired` · `converted` · `superseded`.

1. T002 may create, read, edit and cancel an `open` draft.
2. T002 must NOT implement conversion to an authoritative Laundry
   Booking; later tasks perform conversion through an atomic governed
   composition.
3. The original customer/contact snapshot must not silently change when
   the customer master is edited later.
4. Draft version advances monotonically; a stale update is refused or
   reconciled explicitly, never silently merged.

## 5. Offline truth labels (LOCKED)

`local_authoritative` · `cloud_acknowledged` · `pending_sync` ·
`stale_projection` · `conflict` · `unavailable`.

While WAN is unavailable: scoped customer search over the valid local
projection continues; a minimal customer may be created under the offline
policy; consent evidence is captured locally; drafts are created and
edited; committed local facts enter the durable outbox; cloud
acknowledgment is NOT required for continued draft work. A locally created
customer is never labelled cloud-confirmed before acknowledgment. On
reconnect: original local identifiers preserved; idempotent retry; ONE
cloud business effect; a newer authoritative fact is never overwritten;
identity conflicts surface for governed resolution; normalized-phone
collisions produce `conflict`, never an automatic merge.

## 6. Authorization (LOCKED)

Every T002 route requires: current mTLS terminal identity · eligible T1
profile · active staff session · `pos.t1.use` · its route-specific
permission · current assignment generation · exact Tenant, Store, Location
and environment · containment and Hub lifecycle eligibility. The caller
supplies NO authoritative scope, staff identity, terminal identity,
timestamps or draft ownership. Unknown query and body fields are rejected;
request and response sizes are bounded.
