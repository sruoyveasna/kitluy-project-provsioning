# KitLuy Contract Vocabulary and Edge API Owner Decision

**Filename:** `kitluy-contract-vocabulary-and-edge-api-owner-decision-v1.0.0.md`
**Decision ID:** KLD-2026-07-26-002 (proposal)
**Version:** v1.0.0
**Date:** 2026-07-26
**Task:** KL-DEC-001
**Status:** PROPOSED — every choice below is **STATUS: OWNER-APPROVAL-REQUIRED**
**Authority:** Master build plan G1 gate §5; canonical corpus (api-contracts, security, offline, data-contracts)
**Owner-review ballot:** [kitluy-contract-vocabulary-owner-review-v1.0.0.md](../source/processed/reconciliation/kitluy-contract-vocabulary-owner-review-v1.0.0.md)

> **Evidence discipline (KLD-EVIDENCE-001):** this document is a decision
> proposal, not implementation evidence. Nothing in it advances any feature
> status. Until the owner approves, all recommendations are non-binding and
> all affected code keeps its current, registered behavior.

## 0. Scope and conflicts resolved

This package proposes one owner decision covering five contract-vocabulary
groups and closes (upon approval) the following open conflicts in the
[decision-and-reconciliation register](../authority/kitluy-decision-and-reconciliation-register-v1.0.0.md):

| Group | Conflict IDs                                                     | Subject                                         |
| ----- | ---------------------------------------------------------------- | ----------------------------------------------- |
| 1     | KLREC-2026-07-26-001, KLREC-2026-07-26-002 (API-vocabulary part) | `/edge/v1` route-shape fork                     |
| 2     | KLREC-2026-07-26-009                                             | Terminal-profile identifiers                    |
| 3     | KLREC-2026-07-26-013, KLREC-2026-07-26-012 (vocabulary part)     | Permission grammar and authorization vocabulary |
| 4     | KLREC-2026-07-26-011                                             | Domain-event name versioning                    |
| 5     | KLREC-2026-07-26-010                                             | API error identifiers                           |

Non-goals: no application/domain widening, no production migrations, no new
business semantics, no pretended execution (BLK-002). The custody-concept
database naming drift in KLREC-2026-07-26-002 (cloud `kitluy_laundry.garments`
vs Hub-local `edge_laundry.garment`) is a schema-naming matter outside this
package; only its API-vocabulary consequence is settled here.

### 0.1 Sources analyzed

- [Store Hub LAN API v1.0.0](../source/offline/kitluy-storehub-lan-api-v1.0.0.md) ("LAN API")
- [Edge Operations API v1.0.0](../source/api-contracts/kitluy-edge-operations-api-v1.0.0.md) ("Edge Ops API")
- [Terminal Profile Contract T1–T4 v1.0.0](../source/offline/kitluy-terminal-profile-contract-t1-t4-v1.0.0.md)
- [Suite RBAC Permission Registry v1.0.0](../source/security/kitluy-suite-rbac-permission-registry-v1.0.0.md) (+ [CSV](../source/security/kitluy-suite-rbac-permission-registry-v1.0.0.csv), 107 keys)
- [API Scope Registry v1.0.0](../source/api-contracts/kitluy-api-scope-registry-v1.0.0.md)
- [Resource Scope Model v1.0.0](../source/security/kitluy-resource-scope-model-v1.0.0.md)
- [Domain Event Registry v1.0.0](../source/api-contracts/kitluy-domain-event-registry-v1.0.0.md)
- [API Error Code Registry v1.0.0](../source/api-contracts/kitluy-api-error-code-registry-v1.0.0.md)
- Repository packages: `packages/api-errors/src/index.ts`, `packages/event-contracts/src/index.ts`, `packages/rbac/src/index.ts`, `packages/resource-scope/src/index.ts`, `verticals/phase1-laundry/src/terminal-profiles.ts`, `services/kitluy-hub-agent/src/lan-api.ts`

### 0.2 Nothing is deployed — no aliases are required

`services/kitluy-hub-agent/src/lan-api.ts` implements only the three routes
both specs agree on (`GET /edge/v1/health`, `GET /edge/v1/identity`,
`GET /edge/v1/sync/status`) and returns a 405 with an explicit
KLREC-2026-07-26-001 citation for every non-GET request. No business route,
client, SDK or deployment exists for either contested route shape. Every
losing route below is therefore marked **REJECTED-BEFORE-IMPLEMENTATION**: it
never ships, needs no deprecation window, and gets **no alias** (aliases are
only for deployed callers, and there are none).

---

## Group 1 — `/edge/v1` route fork (KLREC-2026-07-26-001)

**STATUS: OWNER-APPROVAL-REQUIRED**

### 1.1 Recommended architectural boundary

One rule resolves the whole fork:

1. **Generic Edge platform operations** — capabilities every vertical's edge
   deployment needs (sessions, approvals, health, identity, config,
   diagnostics, sync, files, printing, peripherals, shifts/cash, display
   sessions, support, device management) — live at **`/edge/v1/*` without a
   vertical prefix**. They are Core (KLD-CORE-001) and will be reused verbatim
   by Restaurant and later verticals (KLD-ROADMAP-001).
2. **Laundry vertical commands** — Bookings, garment custody, Ready scan-in,
   pickup scan-out — live under **`/edge/v1/laundry/*`**. A vertical prefix
   keeps the shared namespace clean when Phase 2+ adds `/edge/v1/restaurant/*`
   and enforces KLD-VERTICAL-001 (one primary vertical per Digital Store) at
   the route level.

Consequences: the LAN API's unprefixed vertical routes (`/bookings/*`,
`/ready-scan/*`, `/pickup-scan/*`) lose their shape; the Edge Ops API's
prefixed vertical routes win their shape. For generic platform routes the
richer LAN API catalogue (files, print-jobs, peripherals, scales,
diagnostics, support sessions, approvals lifecycle) is adopted, with the
verb conflicts resolved pair-by-pair below.

### 1.2 Contested pair A — session opening

| Dimension        | LAN API `POST /sessions/open`                                                             | Edge Ops API `POST /sessions/login`                                 |
| ---------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Source           | LAN API §5                                                                                | Edge Ops API §9.1                                                   |
| Authority        | Canonical target contract (offline pack)                                                  | Canonical target contract (api-contracts pack) — neither supersedes |
| Actor            | Staff actor over device certificate                                                       | Staff actor over device certificate                                 |
| Terminal profile | Any assigned profile (`requested_profile`)                                                | Any assigned profile                                                |
| Aggregate        | Actor session (open/refresh/close lifecycle)                                              | Actor session (login/switch)                                        |
| State transition | none → open actor session                                                                 | none → open actor session                                           |
| Request          | `actor_reference`, `credential`, `requested_profile`, `terminal_client_sequence`          | Unspecified body; scope `edge.session.open`                         |
| Response         | Signed opaque token, session ID, permissions, profile, expiry, privacy-reset instructions | Success envelope                                                    |
| Idempotency      | `Idempotency-Key` required (all mutations)                                                | `Idempotency-Key` per contract §5.5                                 |
| Audit            | `terminal.profile_entered` + session audit                                                | §5.10 common audit fields                                           |
| Offline          | Local credential verifier; cached-credential validity bounded by projected staff policy   | Same (Hub is local authority)                                       |
| Compatibility    | Nothing deployed for either                                                               | Nothing deployed for either                                         |

**Recommended:** `POST /edge/v1/sessions/open` (with `POST /sessions/refresh`,
`POST /sessions/switch`, `POST /sessions/close`). "Open" names the resource
lifecycle symmetrically (open/refresh/close), matches the scope
`edge.session.open` that the Edge Ops API itself registers, and avoids the UI
word "login" in a machine contract. `POST /sessions/switch` (Edge Ops API) is
adopted into the lifecycle because the terminal-profile contract §10 requires
audited actor switching.
**REJECTED-BEFORE-IMPLEMENTATION:** `POST /edge/v1/sessions/login` (no alias;
evidence §0.2).

### 1.3 Contested pair B — Booking draft creation

| Dimension        | LAN API `POST /bookings/drafts`                                                      | Edge Ops API `POST /laundry/bookings/drafts`           |
| ---------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| Source           | LAN API §7                                                                           | Edge Ops API §9.2 and §3 (OpenAPI excerpt)             |
| Authority        | Canonical target contract                                                            | Canonical target contract                              |
| Actor            | T1 staff session                                                                     | T1 staff session                                       |
| Terminal profile | T1 only                                                                              | T1 only                                                |
| Aggregate        | Laundry Booking (draft)                                                              | Laundry Booking (draft)                                |
| State transition | none → DRAFT (T1 state machine §5.4 of terminal contract)                            | none → DRAFT                                           |
| Request          | `customer_id`, `business_date`, `language_code`, `pickup_method`, `due_at`, `source` | SuccessEnvelope-governed; scope `edge.bookings.create` |
| Response         | Committed envelope with `aggregate_version`, `hub_sequence`, `sync_state`            | SuccessEnvelope                                        |
| Idempotency      | Required key                                                                         | Required key                                           |
| Audit            | `laundry.booking_draft_created`                                                      | §5.10                                                  |
| Offline          | Continue while Hub up (offline matrix)                                               | Continue (§12.2)                                       |
| Compatibility    | Nothing deployed                                                                     | Nothing deployed                                       |

**Recommended:** `POST /edge/v1/laundry/bookings/drafts` and the full
draft-editing family under `/edge/v1/laundry/bookings/*` (lines, garments,
evidence, status-events, exceptions keep the LAN API's richer sub-resources,
re-homed under the prefix).
**REJECTED-BEFORE-IMPLEMENTATION:** unprefixed `/edge/v1/bookings/*` (no
alias; evidence §0.2).

### 1.4 Contested pair C — intake finalization verb

| Dimension        | LAN API `POST /bookings/{id}/confirm-intake`                                                           | Edge Ops API `POST /laundry/bookings/{id}/finalize`                                |
| ---------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Source           | LAN API §7/§7.3                                                                                        | Edge Ops API §9.2, §13.1                                                           |
| Authority        | Canonical target contract                                                                              | Canonical target contract                                                          |
| Actor            | T1 staff; permission `laundry.booking.confirm_intake`                                                  | T1 staff; scope `edge.bookings.finalize`                                           |
| Terminal profile | T1 only                                                                                                | T1 only                                                                            |
| Aggregate        | Laundry Booking                                                                                        | Laundry Booking                                                                    |
| State transition | REVIEW → INTAKE_CONFIRMED (terminal contract §5.4)                                                     | Draft → finalized (immutable snapshots)                                            |
| Request          | `expected_version`, `customer_confirmation`, `payment_policy`, `requested_deposit_minor`, `print`      | `actor_session_id`, `expected_draft_version`, `customer_confirmation` + `If-Match` |
| Response         | Booking, price snapshot, intake custody events, optional cash payment and print jobs durably committed | Accepted envelope, `sync_state: pending_cloud_sync`                                |
| Idempotency      | Required key; serializable finalization                                                                | Required key                                                                       |
| Audit            | `laundry.booking_intake_confirmed`, `laundry.custody_intake_recorded`                                  | §5.10                                                                              |
| Offline          | Continue while Hub up                                                                                  | Continue                                                                           |
| Compatibility    | Nothing deployed                                                                                       | Nothing deployed                                                                   |

**Recommended:** `POST /edge/v1/laundry/bookings/{id}/confirm-intake`.
"Confirm intake" is the owner's domain vocabulary everywhere outside this one
route: the terminal-profile permission matrix row "Confirm intake", the T1
state `INTAKE_CONFIRMED`, the LAN scope `laundry.booking.confirm_intake` and
the audit event `laundry.booking_intake_confirmed`. "Finalize" is generic and
collides with nothing else in the corpus.
**REJECTED-BEFORE-IMPLEMENTATION:** `POST /edge/v1/laundry/bookings/{id}/finalize`
(no alias; evidence §0.2).

### 1.5 Contested pair D — T3 Ready sessions

| Dimension | LAN API `POST /ready-scan/sessions` (+ `/ready-scan/{session_id}/items|qa|exceptions|storage|complete`) | Edge Ops API `POST /laundry/ready-sessions` (+ `/{id}/scans|qa|storage|complete`) |
| --- | --- | --- |
| Source | LAN API §10 | Edge Ops API §9.4 |
| Authority | Canonical target contract | Canonical target contract |
| Actor | T3 staff; `laundry.ready.*` scopes | T3 staff; `edge.ready.*` scopes |
| Terminal profile | T3 only | T3 only |
| Aggregate | Ready scan session over Booking/garment custody | Ready session over Booking/garment custody |
| State transition | SESSION_OPEN → … → READY_COMMITTED (terminal contract §7.5) | Same; "Posts Ready transition exactly once" |
| Request | Completion carries `expected_booking_version`, `expected_count`, `scanned_item_ids`, `qa_result`, `storage_assignments`, `blocking_exception_ids` | Scan/QA/storage/complete sub-commands |
| Response | Atomic commit of count, QA, storage, custody events and Ready transition | Same semantics |
| Idempotency | Required key | Required key |
| Audit | `laundry.ready_scan_started` … `laundry.booking_marked_ready` | §5.10 |
| Offline | Continue while Hub up | Continue |
| Compatibility | Nothing deployed | Nothing deployed |

**Recommended:** `POST /edge/v1/laundry/ready-sessions` with sub-routes
`/{id}/scans`, `/{id}/qa`, `/{id}/exceptions`, `/{id}/storage`,
`/{id}/complete`. The session is the resource; `ready-sessions` names it as a
noun under the vertical prefix; `scans` (not `items`) matches the scope
`edge.ready.scan` and the custody-evidence meaning of the sub-resource. The
LAN API's `/{id}/exceptions` sub-route is retained (the Edge Ops table omits
it but the terminal contract §7.2 requires exception recording).
**REJECTED-BEFORE-IMPLEMENTATION:** `/edge/v1/ready-scan/sessions` and the
`/ready-scan/{session_id}/items` shape (no alias; evidence §0.2).

### 1.6 Contested pair E — T2 display sessions

| Dimension        | LAN API `/display-sessions` family                                                                               | Edge Ops API `/displays/sessions` family                       |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Source           | LAN API §9                                                                                                       | Edge Ops API §9.3                                              |
| Authority        | Canonical target contract                                                                                        | Canonical target contract                                      |
| Actor            | T1 opens/updates/closes; assigned T2 reads and submits limited customer actions                                  | Same split; `edge.display.*` scopes                            |
| Terminal profile | T1 + paired/assigned T2                                                                                          | T1 + assigned T2                                               |
| Aggregate        | Display session (customer-safe projection, `display_sequence`)                                                   | Display session                                                |
| State transition | SESSION_BOUND → … → PRIVACY_RESET (terminal contract §6.4)                                                       | Same                                                           |
| Request          | `PATCH` with monotonic `display_sequence`; `/customer-actions` limited to language, receipt choice, confirmation | `PATCH` customer-safe state; `/receipt-choice`; `DELETE` close |
| Response         | Current customer-safe state only                                                                                 | Same                                                           |
| Idempotency      | Required key on mutations                                                                                        | Required key                                                   |
| Audit            | `display.session_bound` … `display.privacy_reset`                                                                | §5.10                                                          |
| Offline          | T1/T2 mirror continues over LAN; cleared when Hub down                                                           | Same                                                           |
| Compatibility    | Nothing deployed                                                                                                 | Nothing deployed                                               |

**Recommended:** `/edge/v1/display-sessions` (POST, PATCH `/{id}`, GET
`/{id}`, POST `/{id}/customer-actions`, POST `/{id}/close`) — **without** a
vertical prefix. A customer display is a generic Edge platform capability
(Restaurant T2-equivalents will reuse it); the flat `display-sessions`
collection names the real resource, whereas `/displays/sessions` nests under a
`displays` collection that does not exist as a resource. Closing stays an
explicit audited `POST /{id}/close` (privacy reset is a recorded action, not
a resource deletion), matching the append-only audit rule.
**REJECTED-BEFORE-IMPLEMENTATION:** `/edge/v1/displays/sessions` family,
including `DELETE` as the close verb (no alias; evidence §0.2).

### 1.7 Contested pair F — T4 pickup completion

| Dimension        | LAN API `POST /pickup-scan/{session_id}/complete`                                                                 | Edge Ops API `POST /laundry/pickup-sessions/{id}/release`           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Source           | LAN API §11/§11.1                                                                                                 | Edge Ops API §9.5                                                   |
| Authority        | Canonical target contract                                                                                         | Canonical target contract                                           |
| Actor            | T4 staff; `laundry.pickup.complete`                                                                               | T4 staff; `edge.pickup.release`                                     |
| Terminal profile | T4 only (T3 cannot complete pickup — contract test §20.6)                                                         | T4 only                                                             |
| Aggregate        | Pickup session → Booking + garment custody                                                                        | Same                                                                |
| State transition | PAYMENT_GATE → HANDOVER_REVIEW → RELEASE_COMMITTED → COMPLETE (terminal contract §8.5)                            | "Final custody release and completion"                              |
| Request          | `expected_booking_version`, `collector_verification`, `scanned_item_ids`, `payment_gate`, `exception_approval_id` | Sub-commands: collector-verification, scans, payments, then release |
| Response         | Blocks when payment, count, collector, storage or custody invariants unsatisfied                                  | Same gate semantics                                                 |
| Idempotency      | Required key                                                                                                      | Required key                                                        |
| Audit            | `laundry.custody_released`, `laundry.booking_picked_up`, `laundry.storage_position_cleared`                       | §5.10                                                               |
| Offline          | Continue if payment/identity policy satisfied locally                                                             | Same                                                                |
| Compatibility    | Nothing deployed                                                                                                  | Nothing deployed                                                    |

**Recommended:** `POST /edge/v1/laundry/pickup-sessions/{id}/complete`, with
the session family `POST /laundry/pickup-sessions`,
`/{id}/collector-verification`, `/{id}/scans`, `/{id}/payments`. "Complete"
is the owner vocabulary: permission-registry key `laundry.booking.complete`,
terminal-contract capability "Complete Booking pickup", LAN scope
`laundry.pickup.complete`. Custody release is one atomic effect _inside_
completion (terminal contract §8.2 step 10: release custody, clear storage
and complete Booking atomically), not a separate finalizer route.
**REJECTED-BEFORE-IMPLEMENTATION:** `/edge/v1/pickup-scan/*` shape and the
`release` finalizer verb (no alias; evidence §0.2).

### 1.8 Resulting route map (normative once approved)

| Concern                                 | Route family                                                              | Shape source                                  |
| --------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------- |
| Health / identity / config              | `GET /edge/v1/health`, `/identity`, `/config/status`                      | Both specs (already implemented read-only)    |
| Provisioning claim (cloud gateway only) | `POST /edge/v1/provision/claim`                                           | Edge Ops API §9.1                             |
| Sessions                                | `POST /edge/v1/sessions/open                                              | refresh                                       | switch | close` | Merged (§1.2) |
| Approvals                               | `POST /edge/v1/approvals/request`, `POST /edge/v1/approvals/{id}/approve` | LAN API §5                                    |
| Customers                               | `/edge/v1/customers*` incl. `/{id}/consents`                              | LAN API §6 (unprefixed: shared Core identity) |
| Display sessions                        | `/edge/v1/display-sessions*`                                              | Merged (§1.6)                                 |
| Payments on Bookings                    | `/edge/v1/laundry/bookings/{id}/payments/*`, `/edge/v1/payments/{id}*`    | LAN API §8 re-homed under boundary rule       |
| Laundry Bookings                        | `/edge/v1/laundry/bookings*` incl. `/{id}/confirm-intake`                 | Merged (§1.3–1.4)                             |
| T3 Ready                                | `/edge/v1/laundry/ready-sessions*`                                        | Merged (§1.5)                                 |
| T4 Pickup                               | `/edge/v1/laundry/pickup-sessions*` incl. `/{id}/complete`                | Merged (§1.7)                                 |
| Shifts and cash                         | `/edge/v1/shifts*`                                                        | Edge Ops API §9.6                             |
| Printing / peripherals / scales         | `/edge/v1/print-jobs*`, `/peripherals*`, `/scales*`                       | LAN API §12                                   |
| Files                                   | `/edge/v1/files*`                                                         | LAN API §13                                   |
| Sync / status / diagnostics / support   | `/edge/v1/sync*`, `/status*`, `/diagnostics*`, `/support-sessions*`       | LAN API §14 + Edge Ops sync push/pull §9.6    |
| Event stream                            | `wss …/edge/v1/events`                                                    | LAN API §15                                   |

The custody-concept API vocabulary (KLREC-2026-07-26-002) follows this map:
API-visible nouns are `garments`, `scans`, `storage`, `custody` exactly as
they appear in the winning routes; database-layer naming is reconciled in a
separate schema task.

---

## Group 2 — Terminal-profile identifiers (KLREC-2026-07-26-009)

**STATUS: OWNER-APPROVAL-REQUIRED**

### 2.1 Five distinct concepts, five distinct vocabularies

The conflict exists because four documents each name a _different_ concept and
the identifiers were assumed interchangeable. They are not:

| Concept                                 | What it is                                                                             | Canonical vocabulary (recommended)                                                                                   | Where defined                                       |
| --------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **Logical terminal-profile identifier** | The permissioned workflow role a session runs as                                       | `laundry.t1.intake_cashier`, `laundry.t2.customer_display`, `laundry.t3.ready_scan_in`, `laundry.t4.pickup_scan_out` | This decision (extends POS Desktop spec v4 §13.5)   |
| **Physical terminal / device profile**  | What hardware bundle a device is                                                       | `laundry_front_counter`, `laundry_ready_pickup`, `laundry_t1_dedicated` … `laundry_t4_dedicated`                     | Terminal-profile contract §2 (unchanged)            |
| **Device assignment**                   | Cloud-signed binding device → Tenant/Digital Store/Location + allowed logical profiles | Signed configuration snapshot record                                                                                 | Terminal-profile contract §2; RBAC `devices.assign` |
| **User permission**                     | What the actor may do inside a profile                                                 | RBAC registry keys (`laundry.bookings.create`, `laundry.ready_scan_in`, …)                                           | RBAC permission registry (Group 3)                  |
| **Active mode**                         | Which allowed logical profile a shared T3/T4 terminal is currently in                  | Session state + `terminal.profile_entered` audit; never an identifier change                                         | Terminal-profile contract §9                        |

A profile identifier is _not_ authorization (assignment + permission +
approval decide), _not_ hardware (device profiles enumerate hardware), and
_not_ a mode switch (mode switching is an audited session event on one
device assignment).

### 2.2 Recommended identifier grammar

`<vertical>.<profile_code>.<workflow_role>` — lowercase, dot-separated:

| Recommended                   | Scaffolded today (`verticals/phase1-laundry/src/terminal-profiles.ts`) | Terminal contract v1.0.0 usage                      |
| ----------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------- |
| `laundry.t1.intake_cashier`   | `t1_intake_cashier`                                                    | `laundry_t1` (header example), device profiles only |
| `laundry.t2.customer_display` | `t2_customer_display`                                                  | —                                                   |
| `laundry.t3.ready_scan_in`    | `t3_ready_scan_in`                                                     | —                                                   |
| `laundry.t4.pickup_scan_out`  | `t4_pickup_scan_out`                                                   | —                                                   |

Rationale: the vertical segment makes the identifier collision-free when
Restaurant introduces its own T-profiles (KLD-ROADMAP-001), aligns the
grammar with the dot-separated permission/scope grammar of Group 3, and keeps
the owner-locked T1–T4 semantics (KLD-2026-07-21-002, RC-001) byte-for-byte
in the last segment. The retired identifiers `t2_scan_in` / `t3_scan_out`
remain permanently retired and are never reused.

### 2.3 Compatibility map (code keeps current identifiers until approval)

- `verticals/phase1-laundry/src/terminal-profiles.ts` keeps
  `t1_intake_cashier` … `t4_pickup_scan_out` **unchanged** until this decision
  is approved. Nothing is deployed, so the rename is a one-shot mechanical
  mapping `tN_x` → `laundry.tN.x` in one commit after approval, with no
  runtime alias.
- The LAN API header example `X-Kitluy-Profile: laundry_t1` becomes
  `X-Kitluy-Profile: laundry.t1.intake_cashier` in the same documentation
  change set.
- Device-profile codes (`laundry_front_counter`, …) are a different concept
  and are **not** renamed.
- The scope-model notation `terminal_role:T1` (resource-scope model §9)
  remains shorthand for "session bound to logical profile whose profile_code
  is t1"; the authoritative value is the full identifier.

---

## Group 3 — Permission grammar (KLREC-2026-07-26-013, -012 vocabulary)

**STATUS: OWNER-APPROVAL-REQUIRED**

### 3.1 One grammar

Recommended: **dot-separated lowercase `snake_case` segments**, form
`<domain>.<resource_or_capability>.<verb>` (or the established shorter
action-oriented form), exactly as the RBAC permission registry §2 defines.
The **registry's 107 keys are the canonical baseline set**. Rules retained
verbatim: released keys are immutable; unknown/deprecated keys fail closed;
wildcards prohibited in production; every key maps to exactly one primary
audit event. **No resource UUIDs, tenant IDs or environment names ever appear
inside a permission key name** — resource and environment are separate
dimensions of the grant (resource-scope model §5), never part of the name.

### 3.2 `releases.promote.stable` vs `releases.promote_stable`

Recommended winner: **`releases.promote_stable`** (with siblings
`releases.promote_internal`, `releases.promote_pilot`). Both the RBAC
permission registry and the API scope registry independently use
`promote_stable`; the segmented `releases.promote.stable` exists only in the
infrastructure spec §16.5 seed list mirrored by `@kitluy/rbac`. The
underscore form also keeps "promote-to-channel" as one capability per
channel, which is what the A2/A3/A3 approval ladder attaches to.
`releases.promote.stable` is REJECTED-BEFORE-IMPLEMENTATION as a key name
(seed constant only; no grant, role, token or deployment references it).

### 3.3 Six authorization concepts that must never share a vocabulary

| Concept                                      | Grammar / registry                                 | Example                                                | Authority                     |
| -------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------ | ----------------------------- |
| **Permission key**                           | `<domain>.<resource>.<verb>`, 107-key registry     | `laundry.bookings.create`                              | RBAC permission registry      |
| **API scope** (token capability per surface) | Lowercase dot-separated, surface-prefixed for Edge | `edge.bookings.create`                                 | API scope registry            |
| **Resource scope** (where a grant applies)   | Scope-type key + resource ID                       | `store_location:<uuid>`                                | Resource scope model §3       |
| **Environment scope**                        | Fixed enum, independent dimension                  | `store_edge`, `pilot`, `production`                    | Resource scope model §4       |
| **Device capability / profile grant**        | Logical profile identifiers + device-profile codes | `laundry.t1.intake_cashier` on `laundry_front_counter` | Group 2; terminal contract §3 |
| **Approval policy**                          | Risk classes                                       | `A0_READ` … `A4_OWNER_SECURITY`                        | RBAC registry §3              |

A scope is not a permission (a token scope never bypasses the permission
grant); a permission is not a resource scope (the same key is granted at
different scopes); none of them encode environment; and the terminal profile
is a device/session dimension evaluated _in addition to_ all of the above
(Edge Ops API §4.3).

### 3.4 Compatibility map for repository seed keys (`@kitluy/rbac`)

| Repo seed key (infra spec §16.5) | Canonical registry key (recommended)                                                         | Note                                                   |
| -------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `platform.jobs.retry`            | `platform.jobs.retry`                                                                        | Exact match — keep.                                    |
| `releases.promote.stable`        | `releases.promote_stable`                                                                    | Rename on approval (§3.2).                             |
| `infrastructure.backup.restore`  | `platform.backup.restore_production` (prod/DR) and `platform.backup.restore_test` (non-prod) | Registry splits by environment risk; seed key retires. |
| `security.certificates.rotate`   | `devices.certificate.rotate`                                                                 | Registry homes certificate rotation under `devices.*`. |

Code keeps the current seed constants until approval; the rename is a
one-commit mechanical change (nothing deployed, no alias).

The scope-_taxonomy_ drift of KLREC-2026-07-26-012 (`tenant_or_partner` /
`individual_device` in `@kitluy/resource-scope` vs `tenant` / `device` + new
`chain`, `file_object`, `support_session`, `release_cohort` in the resource
scope model) is vocabulary-resolved the same way: the **resource scope model
v1.0.0 taxonomy is recommended canonical**; the repo enum maps
`tenant_or_partner` → `tenant`, `individual_device` → `device`, and adds the
four new types on approval.

---

## Group 4 — Domain-event versioning (KLREC-2026-07-26-011)

**STATUS: OWNER-APPROVAL-REQUIRED**

### 4.1 Recommended model

Adopt the **domain event registry v1.0.0 model**: event names are **stable
semantic facts** in the form `<bounded_context>.<past_tense_fact>` (pattern
`^[a-z0-9_]+\.[a-z0-9_]+$`, e.g. `payment.recorded`,
`laundry_booking.created`), and the schema revision is carried **only in the
envelope's `schema_version` integer** — never encoded in the name.
Name-embedded versions (`laundry.booking_created.v1`,
`digital_store_created.v1`, POS spec §15.2 style) are **demoted to
compatibility aliases**, exactly as registry §1.1 already states. Because no
event has ever been published by any deployed producer, the aliases exist
only as a documented mapping table for spec readers — no runtime alias
resolution is built.

This is a naming/versioning decision only: **no new business semantics** —
the 15 registered events (EVT-CORE-001 … EVT-INT-001), their producers,
consumers, retention classes and ordering rules are untouched.

### 4.2 Mapping `@kitluy/event-contracts` to the target

Current validator (`packages/event-contracts/src/index.ts`):
`EVENT_NAME_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.v\d+$/` — it
_requires_ the `.v<major>` suffix and would **reject every canonical registry
name**. Target on approval:

| Element               | Today (`@kitluy/event-contracts`)                             | Target                                                                                                                  |
| --------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Name pattern          | `<domain>.<event>.v<major>` (POS spec §15.2)                  | `<context>.<fact>` — `^[a-z0-9_]+\.[a-z0-9_]+$`                                                                         |
| Version carrier       | Name suffix `.v1` + `schemaVersion` string field (duplicated) | Envelope `schema_version` integer ≥ 1 only                                                                              |
| Envelope              | RB v4 §10.3 camelCase envelope (`eventId`, `eventType`, …)    | Registry §2 envelope v1 (snake_case wire form: `event_id`, `event_name`, `payload_sha256`, `source`, `actor`, `replay`) |
| Registry immutability | Per-name registration, versions immutable                     | Unchanged rule; new `schema_version` values register against the same stable name                                       |
| Example               | `laundry.booking_created.v1`                                  | `laundry_booking.created` (+ `schema_version: 1`)                                                                       |

Alias table (documentation-only; nothing published):
`digital_store_created.v1` → `digital_store.created`;
`laundry.booking_created.v1` → `laundry_booking.created`;
`laundry.booking.ready` (LAN API §15 example) → `laundry_booking.ready`;
POS-spec `.v1` names for custody/payment map to `garment.custody_scanned_in`,
`garment.custody_scanned_out`, `payment.recorded`, `payment.refunded`.
Code keeps the current validator until approval (nothing consumes it in a
deployed path); the change is one commit plus its unit tests.

---

## Group 5 — Error identifiers (KLREC-2026-07-26-010)

**STATUS: OWNER-APPROVAL-REQUIRED**

### 5.1 Recommended canonical source

The **API error code registry v1.0.0** (50 registered codes across the four
surfaces — the "~51" in the conflict record counts the same table) is
recommended canonical for every production error code. Per registry rules:
uppercase `SNAKE_CASE`; HTTP status is transport classification only;
machine behavior follows code + `retryable`; every code carries a
localization key `message_key` (`api.error.<lowercase_code>`, Khmer and
English), a safe `operator_action`, and appears in append-only audit with the
request/correlation IDs (Edge Ops API §5.10). Retryability semantics: LAN
API §17 (same idempotency key ⇒ safe replay) governs offline behavior — a
retryable Edge error during WAN outage queues durably at the Hub and never
fabricates success.

The POS Desktop spec §14.3 names (implemented in `@kitluy/api-errors`) and
the LAN API §18 `EDGE_*` catalogue are mapped onto the registry below;
divergent names are REJECTED-BEFORE-IMPLEMENTATION as production codes
(nothing deployed emits them — evidence §0.2).

### 5.2 Reconciliation table — `@kitluy/api-errors` → canonical registry

Columns: stable canonical code, domain, condition, HTTP (canonical), retryable,
offline behavior, localization key (`message_key`), operator detail, audit.

| Repo code (POS §14.3)                                  | Canonical code                                                              | Domain      | Condition                            | HTTP | Retryable         | Offline behavior                                  | Localization key                                          | Operator detail / audit                                                 |
| ------------------------------------------------------ | --------------------------------------------------------------------------- | ----------- | ------------------------------------ | ---: | ----------------- | ------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------- |
| `UNAUTHENTICATED`                                      | `AUTHENTICATION_REQUIRED`                                                   | ALL         | No valid credential                  |  401 | No                | Re-open local session via Hub verifier            | `api.error.authentication_required`                       | Authenticate with allowed credential class; audited auth denial         |
| `PERMISSION_DENIED`                                    | `SCOPE_PERMISSION_DENIED`                                                   | ALL         | Scope/permission absent              |  403 | No                | Fail closed; no offline widening                  | `api.error.scope_permission_denied`                       | Request authorized access; audited denial                               |
| `ACTOR_PERMISSION_DENIED`                              | `SCOPE_PERMISSION_DENIED`                                                   | ALL         | Actor lacks permission               |  403 | No                | Same                                              | same                                                      | Merged — actor vs token distinction goes in `details`, not the code     |
| `NOT_FOUND`                                            | `RESOURCE_NOT_FOUND`                                                        | ALL         | Absent or not visible                |  404 | No                | Local read model authoritative                    | `api.error.resource_not_found`                            | Verify reference and scope                                              |
| `VALIDATION_FAILED`                                    | `VALIDATION_FAILED`                                                         | ALL         | Schema/business validation           |  422 | No                | Correct locally                                   | `api.error.validation_failed`                             | Exact match — keep                                                      |
| `CONFLICT` (generic)                                   | _(retire — no canonical generic)_                                           | —           | —                                    |    — | —                 | —                                                 | —                                                         | Replace per call site with the specific registered conflict code        |
| `BOOKING_VERSION_CONFLICT`                             | `RESOURCE_VERSION_CONFLICT`                                                 | ALL         | Expected version/ETag mismatch       |  409 | No                | Refresh aggregate from Hub; never blind-retry     | `api.error.resource_version_conflict`                     | Refresh and reconcile; audited conflict                                 |
| `IDEMPOTENCY_KEY_REUSED` / `DUPLICATE_IDEMPOTENCY_KEY` | `IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST`                             | ALL         | Key reused with different payload    |  409 | No                | New key = new intent, never automatic             | `api.error.idempotency_key_reused_with_different_request` | Generate new key only for new operation                                 |
| `RATE_LIMITED`                                         | `RATE_LIMITED`                                                              | ALL         | Limit exceeded                       |  429 | Yes               | Honor Retry-After; bounded backpressure           | `api.error.rate_limited`                                  | Exact match — keep                                                      |
| `SERVICE_UNAVAILABLE`                                  | `DEPENDENCY_UNAVAILABLE`                                                    | ALL         | Internal dependency down             |  503 | Yes               | Queue durably at Hub                              | `api.error.dependency_unavailable`                        | Retry with backoff or queue                                             |
| `PAYMENT_PROVIDER_UNAVAILABLE`                         | `DEPENDENCY_UNAVAILABLE`                                                    | EDG         | Provider unreachable                 |  503 | Yes               | Never fabricate confirmation (KLD-PAY-001 family) | same                                                      | Provider identified in `details`                                        |
| `STALE_DATA`                                           | `STALE_OPERATIONAL_DATA`                                                    | MGT/COM     | Truth too stale                      |  409 | No (canonical)    | Wait for sync or use Edge workflow                | `api.error.stale_operational_data`                        | Repo marks retryable=true — canonical false wins                        |
| `INTERNAL`                                             | _(registry gap — registration required)_                                    | ALL         | Unexpected failure, no success claim |  500 | Yes with same key | Same-key replay returns original outcome          | proposed `api.error.internal_error`                       | Propose `INTERNAL_ERROR`; OWNER-APPROVAL-REQUIRED                       |
| `DEVICE_NOT_ASSIGNED`                                  | `DEVICE_NOT_ASSIGNED`                                                       | EDG         | No active assignment                 |  403 | No                | Complete provisioning                             | `api.error.device_not_assigned`                           | Exact match — keep                                                      |
| `PROFILE_NOT_ALLOWED`                                  | `PROFILE_NOT_ALLOWED`                                                       | EDG         | Profile cannot perform action        |  403 | No                | Switch to authorized profile                      | `api.error.profile_not_allowed`                           | Exact match — keep                                                      |
| `HUB_UNREACHABLE`                                      | `HUB_UNREACHABLE`                                                           | EDG         | Hub unreachable                      |  503 | Yes               | Discovery/cache/fallback; block mutations         | `api.error.hub_unreachable`                               | Exact match — keep                                                      |
| `CONFIG_VERSION_INCOMPATIBLE`                          | `CONFIG_VERSION_INCOMPATIBLE`                                               | EDG         | Snapshot incompatible                |  409 | No                | Install compatible signed config                  | `api.error.config_version_incompatible`                   | Exact match — keep                                                      |
| `PAYMENT_PENDING`                                      | `PAYMENT_PENDING`                                                           | COM/EDG/CON | Outcome not authoritative            |  202 | Yes               | Keep visibly pending; never mark paid             | `api.error.payment_pending`                               | Repo HTTP 409 — canonical 202 wins                                      |
| `PRINT_FAILED`                                         | `PRINT_FAILED`                                                              | EDG         | Print job failed                     |  503 | Yes               | Job stays queued; retry same job ID               | `api.error.print_failed`                                  | Repo HTTP 502 — canonical 503 wins                                      |
| `STORAGE_POSITION_OCCUPIED`                            | `STORAGE_POSITION_OCCUPIED`                                                 | EDG         | Position unavailable                 |  409 | No (canonical)    | Select validated position                         | `api.error.storage_position_occupied`                     | Canonical retryability wins (retry after operator action = new attempt) |
| `PICKUP_RELEASE_BLOCKED`                               | `PICKUP_RELEASE_BLOCKED`                                                    | EDG         | Release prerequisites incomplete     |  409 | No                | Resolve verification/scans/balance                | `api.error.pickup_release_blocked`                        | Exact match — keep                                                      |
| `COLLECTOR_VERIFICATION_REQUIRED`                      | `PICKUP_RELEASE_BLOCKED` + `details.reason=collector_verification_required` | EDG         | Collector not verified               |  409 | No                | Verify per policy                                 | same                                                      | Folded into the release gate code                                       |
| `BALANCE_PAYMENT_REQUIRED`                             | `PICKUP_RELEASE_BLOCKED` + `details.reason=balance_due`                     | EDG         | Payment gate unmet                   |  409 | No                | Collect at T1/T4 per policy                       | same                                                      | Repo HTTP 402 retired with the fold                                     |
| `SCALE_UNSTABLE`                                       | _(registry gap — registration required)_                                    | EDG         | No stable reading                    |  422 | Yes               | Wait or reasoned manual fallback                  | proposed `api.error.scale_unstable`                       | LAN API `EDGE_SCALE_UNSTABLE` evidence; OWNER-APPROVAL-REQUIRED         |
| `GARMENT_COUNT_MISMATCH`                               | _(registry gap — registration required)_                                    | EDG         | Expected vs scanned count differs    |  409 | No                | Record exception; block Ready/complete            | proposed `api.error.garment_count_mismatch`               | OWNER-APPROVAL-REQUIRED                                                 |

LAN API §18 `EDGE_*` codes map the same way (`EDGE_BOOKING_VERSION_CONFLICT`
→ `RESOURCE_VERSION_CONFLICT`, `EDGE_IDEMPOTENCY_PAYLOAD_MISMATCH` →
`IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST`, `EDGE_SCOPE_MISMATCH` →
`RESOURCE_SCOPE_MISMATCH`, `EDGE_PROFILE_FORBIDDEN` → `PROFILE_NOT_ALLOWED`,
`EDGE_APPROVAL_REQUIRED` → `APPROVAL_REQUIRED`, `EDGE_STORAGE_OCCUPIED` →
`STORAGE_POSITION_OCCUPIED`, `EDGE_RATE_LIMITED` → `RATE_LIMITED`,
`EDGE_HUB_READ_ONLY` → registration-required gap alongside `INTERNAL`). The
`EDGE_`-prefix style itself is rejected: the registry reserves `EDG_`,
`DEVICE_`, `PROFILE_`, `HUB_`, `SYNC_`, `BOOKING_`, `PAYMENT_`, `PRINT_`,
`READY_`, `PICKUP_` for Edge-surface-specific codes (Edge Ops API §10).

Where repo HTTP status or retryability disagrees with the registry, the
**registry value wins**; the repo value is listed above so the alignment
commit is mechanical. `@kitluy/api-errors` keeps its current codes until
approval (nothing deployed emits them); after approval the package is
re-seeded from the registry in one commit with tests, with **no alias
constants** for the rejected names.

---

## 6. Decision state and standing blocks

| Group | Subject                                                         | State                       |
| ----- | --------------------------------------------------------------- | --------------------------- |
| 1     | `/edge/v1` boundary and six contested pairs                     | **OWNER-APPROVAL-REQUIRED** |
| 2     | `laundry.tN.<role>` profile identifiers                         | **OWNER-APPROVAL-REQUIRED** |
| 3     | Permission grammar, 107-key baseline, `releases.promote_stable` | **OWNER-APPROVAL-REQUIRED** |
| 4     | Stable event names + envelope `schema_version`                  | **OWNER-APPROVAL-REQUIRED** |
| 5     | Error registry canonical + POS-name mapping                     | **OWNER-APPROVAL-REQUIRED** |

Until every group is approved:

- **Hub mutation routes remain blocked.** `services/kitluy-hub-agent/src/lan-api.ts`
  continues to reject every non-GET `/edge/v1` request with its explicit
  KLREC-2026-07-26-001 message and serves only `/edge/v1/health`,
  `/edge/v1/identity` and `/edge/v1/sync/status`. No business route is
  scaffolded against an unreconciled contract.
- All repository identifiers (terminal profiles, RBAC seed keys, event-name
  validator, error codes) stay exactly as scaffolded today.
- No registry document is edited; this proposal supersedes nothing until
  recorded as an owner decision in the
  [decision-and-reconciliation register](../authority/kitluy-decision-and-reconciliation-register-v1.0.0.md).

**Approval path:** the owner approves per-group on the
[owner-review ballot](../source/processed/reconciliation/kitluy-contract-vocabulary-owner-review-v1.0.0.md);
each approved group is then recorded as part of KLD-2026-07-26-002 in the
register using the §4 template, and the corresponding KLREC conflicts move to
RESOLVED with this document as closure evidence. Status ceiling this cycle:
documents CONTRACT-APPROVED after independent review; migration/code changes
remain SCAFFOLDED (BLK-002: no PostgreSQL execution is claimed).

## Post-review disclosure (KL-DEC-001 review RV-001, 2026-07-26)

The recommended generic Edge routes reference scopes (e.g. `edge.session.open`,
shift and approval scopes) that are **absent from the current API scope
registry** (`kitluy-api-scope-registry-v1.0.0.md`). Approving Group 1
therefore also authorizes registering those scope entries as an additive
registry amendment. A third permission-key variant `release.promote.stable`
exists in the device-release spec (RV-002) and is covered by the Group 3
normalization.
