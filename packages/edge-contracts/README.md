# @kitluy/edge-contracts

The canonical Edge Operations API route registry consumed by the Store Hub and
T1–T4 terminals.

**Status:** contract registry BUILT + TESTED (`test/edge-routes.test.ts`).
**Not** implementation evidence — no Edge mutation handler exists anywhere in the
repository, and this package implements none. Statuses advance only with evidence
recorded in
`docs/authority/kitluy-implementation-status-and-evidence-register-v1.0.0.md`.

## Authority

- `KLD-2026-07-26-002` (task `KL-DEC-001`, OWNER-APPROVED 2026-07-27) Group 1 —
  the 22 approved route decisions and the `/edge/v1` + `/edge/v1/laundry`
  boundary; Group 2 — logical terminal-profile identifiers; Group 3 — permission
  grammar and the 107-key RBAC baseline; Group 4 — domain-event naming.
- `docs/source/api-contracts/kitluy-edge-operations-api-v1.0.0.md`
- `docs/source/api-contracts/kitluy-api-scope-registry-v1.0.0.md` §2, §5
- `docs/source/offline/kitluy-storehub-lan-api-v1.0.0.md`
- `docs/source/security/kitluy-suite-rbac-permission-registry-v1.0.0.csv`

Resolves `KLREC-2026-07-26-001` (route-shape fork) at the contract layer.

## Boundary

- Shared package: may be consumed by apps, services and verticals.
- Must NOT import application or service code.
- Has NO dependency, at build or runtime, on `verticals/phase1-laundry`.
- Laundry vocabulary appears only as **contract data** (path literals, logical
  profile identifiers, event names), quarantined in `src/laundry-routes.ts` and
  `src/terminal-profiles.ts`. No Laundry business logic, state machine or type
  lives here. See the boundary note in `src/laundry-routes.ts`.

## Route table

`generic` = `/edge/v1/*`; `laundry` = `/edge/v1/laundry/*`.
Profiles: **T1** `laundry.t1.intake_cashier`, **T2** `laundry.t2.customer_display`,
**T3** `laundry.t3.ready_scan_in`, **T4** `laundry.t4.pickup_scan_out`.
`idem` = idempotency required, `ver` = expected aggregate version required,
`appr` = four-eyes approval required.

| Method  | Path                                                           | Family  | Kind     | Scope                             | Permission                                               | Profiles | idem | ver | appr | Audit event                                   |
| ------- | -------------------------------------------------------------- | ------- | -------- | --------------------------------- | -------------------------------------------------------- | -------- | ---- | --- | ---- | --------------------------------------------- |
| `POST`  | `/edge/v1/sessions/open`                                       | generic | mutation | `edge.session.open` ➕            | `[REQUIRED]` gap 1                                       | T1–T4    | yes  | no  | no   | `edge_session.opened` ⚠                       |
| `POST`  | `/edge/v1/sessions/refresh`                                    | generic | mutation | `edge.session.refresh` ➕         | `[REQUIRED]` gap 2                                       | T1–T4    | yes  | no  | no   | `edge_session.refreshed` ⚠                    |
| `POST`  | `/edge/v1/sessions/switch`                                     | generic | mutation | `edge.session.switch` ➕          | `[REQUIRED]` gap 3                                       | T1,T3,T4 | yes  | no  | no   | `edge_session.actor_switched` ⚠               |
| `POST`  | `/edge/v1/sessions/close`                                      | generic | mutation | `edge.session.close` ➕           | `[REQUIRED]` gap 4                                       | T1–T4    | yes  | no  | no   | `edge_session.closed` ⚠                       |
| `POST`  | `/edge/v1/display-sessions`                                    | generic | mutation | `edge.display.open`               | `[REQUIRED]` gap 5                                       | T1       | yes  | no  | no   | `display_session.opened` ⚠                    |
| `PATCH` | `/edge/v1/display-sessions/{id}`                               | generic | mutation | `edge.display.update`             | `[REQUIRED]` gap 5                                       | T1       | yes  | yes | no   | `display_session.updated` ⚠                   |
| `GET`   | `/edge/v1/display-sessions/{id}`                               | generic | read     | `edge.display.read`               | `[REQUIRED]` gap 6                                       | T2       | no   | no  | no   | `display_session.read` ⚠                      |
| `POST`  | `/edge/v1/display-sessions/{id}/customer-actions`              | generic | mutation | `edge.display.customer_action` ➕ | `[REQUIRED]` gap 7                                       | T2       | yes  | yes | no   | `display_session.customer_action_recorded` ⚠  |
| `POST`  | `/edge/v1/display-sessions/{id}/close`                         | generic | mutation | `edge.display.close`              | `[REQUIRED]` gap 5                                       | T1       | yes  | yes | no   | `display_session.closed` ⚠                    |
| `POST`  | `/edge/v1/laundry/bookings/drafts`                             | laundry | mutation | `edge.bookings.create`            | `laundry.bookings.create`                                | T1       | yes  | no  | no   | `laundry_booking.draft_created` ⚠             |
| `POST`  | `/edge/v1/laundry/bookings/{id}/confirm-intake`                | laundry | mutation | `edge.bookings.finalize`          | `laundry.bookings.create`                                | T1       | yes  | yes | no   | `laundry_booking.created`                     |
| `POST`  | `/edge/v1/laundry/ready-sessions`                              | laundry | mutation | `edge.ready.open`                 | `laundry.ready_scan_in`                                  | T3       | yes  | no  | no   | `laundry_ready_session.opened` ⚠              |
| `POST`  | `/edge/v1/laundry/ready-sessions/{id}/scans`                   | laundry | mutation | `edge.ready.scan`                 | `laundry.ready_scan_in`                                  | T3       | yes  | yes | no   | `garment.custody_scanned_in`                  |
| `POST`  | `/edge/v1/laundry/ready-sessions/{id}/qa`                      | laundry | mutation | `edge.ready.qa`                   | `laundry.ready_scan_in`                                  | T3       | yes  | yes | no   | `laundry_ready_session.qa_recorded` ⚠         |
| `POST`  | `/edge/v1/laundry/ready-sessions/{id}/exceptions`              | laundry | mutation | `edge.ready.exception` ➕         | `laundry.ready_scan_in`                                  | T3       | yes  | yes | no   | `laundry_ready_session.exception_recorded` ⚠  |
| `POST`  | `/edge/v1/laundry/ready-sessions/{id}/storage`                 | laundry | mutation | `edge.ready.storage`              | `laundry.ready_scan_in`                                  | T3       | yes  | yes | no   | `laundry_ready_session.storage_assigned` ⚠    |
| `POST`  | `/edge/v1/laundry/ready-sessions/{id}/complete`                | laundry | mutation | `edge.ready.complete`             | `laundry.ready_scan_in`                                  | T3       | yes  | yes | no   | `laundry_booking.ready`                       |
| `POST`  | `/edge/v1/laundry/pickup-sessions`                             | laundry | mutation | `edge.pickup.open`                | `laundry.pickup_scan_out`                                | T4       | yes  | no  | no   | `laundry_pickup_session.opened` ⚠             |
| `POST`  | `/edge/v1/laundry/pickup-sessions/{id}/collector-verification` | laundry | mutation | `edge.pickup.verify_collector`    | `laundry.pickup_scan_out`                                | T4       | yes  | yes | no   | `laundry_pickup_session.collector_verified` ⚠ |
| `POST`  | `/edge/v1/laundry/pickup-sessions/{id}/scans`                  | laundry | mutation | `edge.pickup.scan`                | `laundry.pickup_scan_out`                                | T4       | yes  | yes | no   | `garment.custody_scanned_out`                 |
| `POST`  | `/edge/v1/laundry/pickup-sessions/{id}/payments`               | laundry | mutation | `edge.pickup.payment`             | `payments.capture.cash` (+ `payments.khqr.create`)       | T4       | yes  | yes | no   | `payment.recorded`                            |
| `POST`  | `/edge/v1/laundry/pickup-sessions/{id}/complete`               | laundry | mutation | `edge.pickup.release`             | `laundry.booking.complete` (+ `laundry.pickup_scan_out`) | T4       | yes  | yes | no   | `laundry_booking.completed` ⚠                 |

➕ ADDITIVE scope (see below). ⚠ audit event name conforms to the Group 4 grammar
but is **not yet in the Domain Event Registry** and must be registered before
release.

`approvalRequired` is `false` on all 22 routes: no Group 1 route is
`A3_FOUR_EYES`. The five `edge.pickup.*` routes are `A2_REAUTH_MUTATION` — fresh
re-authentication / manager confirmation — which is carried by `riskClass`, not
by `approvalRequired`. Conditional approvals (price override, custody exception)
attach to payload conditions and are enforced by `@kitluy/approvals`.

## Scope reconciliation

The KL-DEC-001 Cycle-7 working instruction used an informal scope grammar. The
canonical registry grammar wins (scope registry §2, §5). No repository code ever
used the informal names, so no alias layer exists; this is a documentation-only
reconciliation. Machine-readable form: `SCOPE_NAME_RECONCILIATION`.

| Instruction name               | Canonical registry name        | Status       |
| ------------------------------ | ------------------------------ | ------------ |
| `edge.ready.session.create`    | `edge.ready.open`              | registered   |
| `edge.ready.session.scan`      | `edge.ready.scan`              | registered   |
| `edge.ready.session.qa`        | `edge.ready.qa`                | registered   |
| `edge.ready.session.storage`   | `edge.ready.storage`           | registered   |
| `edge.ready.session.complete`  | `edge.ready.complete`          | registered   |
| `edge.ready.session.exception` | `edge.ready.exception`         | **ADDITIVE** |
| `edge.pickup.session.create`   | `edge.pickup.open`             | registered   |
| `edge.pickup.collector_verify` | `edge.pickup.verify_collector` | registered   |
| `edge.pickup.session.scan`     | `edge.pickup.scan`             | registered   |
| `edge.pickup.session.payment`  | `edge.pickup.payment`          | registered   |
| `edge.pickup.session.complete` | `edge.pickup.release`          | registered   |
| `edge.session.create`          | `edge.session.open`            | **ADDITIVE** |
| `edge.session.refresh`         | `edge.session.refresh`         | **ADDITIVE** |
| `edge.session.switch`          | `edge.session.switch`          | **ADDITIVE** |
| `edge.session.close`           | `edge.session.close`           | **ADDITIVE** |
| `edge.display.session.create`  | `edge.display.open`            | registered   |
| `edge.display.session.update`  | `edge.display.update`          | registered   |
| `edge.display.session.read`    | `edge.display.read`            | registered   |
| `edge.display.session.close`   | `edge.display.close`           | registered   |
| `edge.display.receipt_choice`  | `edge.display.customer_action` | **ADDITIVE** |
| `edge.bookings.draft_create`   | `edge.bookings.create`         | registered   |
| `edge.bookings.confirm_intake` | `edge.bookings.finalize`       | registered   |

Note: the approved pickup completion route is `.../complete` while the
registered scope keeps the release verb (`edge.pickup.release`). Route path and
scope name are separate vocabularies and are not forced to match.

## ADDITIVE scopes

Introduced under the Group 1 authority to "additive registration of all missing
generic Edge API scopes required by the approved route catalogue". They follow
scope-registry §2 grammar, repurpose no existing key, and **must be merged into
scope-registry §5 before the Edge surface is released**.

| Scope                          | Why it is needed                                       | Prior mention                                                                           |
| ------------------------------ | ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `edge.session.open`            | `POST /edge/v1/sessions/open`                          | Edge Ops API §9.1 (as `/sessions/login`)                                                |
| `edge.session.refresh`         | `POST /edge/v1/sessions/refresh`                       | none — new key                                                                          |
| `edge.session.switch`          | `POST /edge/v1/sessions/switch`                        | Edge Ops API §9.1                                                                       |
| `edge.session.close`           | `POST /edge/v1/sessions/close`                         | none — new key                                                                          |
| `edge.display.customer_action` | `POST /edge/v1/display-sessions/{id}/customer-actions` | Edge Ops API §9.3 named the narrower `edge.display.receipt_choice` for a REJECTED route |
| `edge.ready.exception`         | `POST /edge/v1/laundry/ready-sessions/{id}/exceptions` | none — Edge Ops API §9.4 has no exception scope                                         |

Minimal-additive discipline: **no** approval, shift, cash, diagnostics, support,
printing, peripheral, file or device-operation scope is introduced, because no
Group 1 route requires one. Group 1 authorises them; they remain future work.

`edge.health.read` and `edge.identity.read` (Edge Ops API §9.1) are also absent
from scope-registry §5, but their routes are outside the Group 1 catalogue and
are not modelled as registry entries here.

## Permission gaps (`[REQUIRED: ...]`)

Seven capabilities have **no key in the 107-key RBAC registry**. Group 3 makes
released keys immutable and requires `rbac.permission_registry_manage`
(`A4_OWNER_SECURITY`, "Required + impact assessment") to register a new one —
authority this task does not hold. Each is therefore recorded as an explicit
`[REQUIRED: ...]` marker (CLAUDE.md hard rule 9), never guessed, and the route
fails closed.

1. Open a Hub-issued Edge terminal session (`POST /edge/v1/sessions/open`).
   `identity.sessions.revoke` is Management-surface revocation, not Edge issuance.
2. Rotate a short-lived Edge session token (`POST /edge/v1/sessions/refresh`).
3. Switch the staff actor on an open session (`POST /edge/v1/sessions/switch`).
4. Close an Edge session and clear profile state (`POST /edge/v1/sessions/close`).
5. Open / update / close a T2 customer-display session from T1 (3 routes).
6. Read own customer-safe display state as the assigned T2 device.
7. Record a customer-originated T2 action as consent evidence.

The remaining 13 routes reuse registered keys verbatim:
`laundry.bookings.create`, `laundry.bookings.price_override` (conditional),
`laundry.ready_scan_in`, `laundry.pickup_scan_out`, `laundry.booking.complete`,
`payments.capture.cash`, `payments.khqr.create` (conditional).

## Audit-event reconciliation

The RBAC registry CSV `primary_audit_event` column and the Domain Event Registry
use different bounded-context tokens for the same facts. Both satisfy the Group 4
regex, so the grammar does not disambiguate them. This registry uses the Domain
Event Registry / Group 4 vocabulary because Group 4 names those forms explicitly
and an owner decision outranks a supporting registry. Machine-readable form:
`AUDIT_EVENT_RECONCILIATION`. **Recorded, not silently resolved** (CLAUDE.md
hard rule 8).

| RBAC `primary_audit_event`   | Canonical event name          |
| ---------------------------- | ----------------------------- |
| `laundry.booking_created`    | `laundry_booking.created`     |
| `garment.ready_scanned_in`   | `garment.custody_scanned_in`  |
| `garment.pickup_scanned_out` | `garment.custody_scanned_out` |
| `payment.cash_recorded`      | `payment.recorded`            |
| `laundry.booking_completed`  | `laundry_booking.completed` ⚠ |

## Rejected route shapes

`REJECTED_ROUTE_SHAPES` enumerates every `REJECTED-BEFORE-IMPLEMENTATION` shape
(Store Hub LAN `ready-scan`/`pickup-scan`/unprefixed forks, POS/Edge Ops
`displays/sessions`, `finalize`, `release`, `receipt-choice`, and
vertical-prefixed generic routes). No compatibility alias or deprecation period
exists because no affected mutation route, deployed client, SDK or external
caller was ever built. The contract tests assert their absence.
