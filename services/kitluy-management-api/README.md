# kitluy-management-api

Governed Management API — Admin, Chain and Partner back-office contracts and approved private integrations (RB v4 §10.1)

**Status:** runtime kernel (health/readiness/version, config validation,
graceful shutdown), the governed Admin READ routes, two Admin/Partner
mutations proven on hardware (Store Hub pairing-code issuance, device-enrollment
approval) and, since 2026-09-04, the Partner terminal provisioning routes
(group 0213) are BUILT and TESTED. The implementation status and evidence
register carries the evidence chain per route; this line is a description of
the code, not a register claim.

## Ownership

Platform / API governance

## Boundary

- Deploys on DigitalOcean (App Platform first; DOKS-ready — infra spec §9.1).
- Stateless; configured only via environment variables; no authoritative local
  filesystem state; horizontally safe; gracefully terminable.
- Consumes shared contracts from `packages/`; never imports application code.
- Never receives production database credentials it does not own; connectors
  never receive production-database credentials at all.

## Contracts

- `GET /health/live` — liveness (implemented).
- `GET /health/ready` — readiness (implemented).
- `GET /version` — service identity (implemented).
- `GET /management/v1/me` — the caller's canonical authority (implemented).
  No specific permission; the caller must be an ACTIVE Admin.
- `GET /management/v1/devices` — governed fleet read model (implemented).
  Requires `fleet.read`.
- `GET /management/v1/devices/:id` — one device, its provisioning readiness
  from the single database predicate (`evaluate_provisioning_eligibility_v1`,
  group 0214) and its assignment context in words (Store, Location, roles,
  seat). Requires `fleet.read`.
- `GET /management/v1/devices-pending` and
  `POST /management/v1/devices/:id/approve-enrollment` — the verify-and-approve
  queue and decision. Require `fleet.device_enrollment.approve`.
- `GET /management/v1/partner/stores` — the Partner's Stores and Locations,
  each with its vertical and its Store Hub readiness. Requires
  `fleet.hub_pairing_code.issue`.
- `POST /management/v1/hub-pairing-codes` and
  `GET /management/v1/hub-pairing-codes/:sessionId` — Store Hub pairing
  session issuance and status. Require `fleet.hub_pairing_code.issue`.
- **Pi Terminal provisioning (group 0213), all requiring
  `fleet.terminal_pairing_code.issue` and the Store:**
  `GET /management/v1/partner/stores/:storeId/terminals` (the named seats),
  `POST /management/v1/partner/terminals` (define a seat with a role set;
  name optional), `POST /management/v1/partner/terminals/:id/roles`,
  `POST /management/v1/terminal-pairing-sessions` (one code, shown once, no
  QR), `GET /management/v1/terminal-pairing-sessions/:id`,
  `POST /management/v1/terminal-pairing-sessions/:id/cancel`. A seat or
  session in another Partner's Store is reported as absent. Unknown fields
  are refused. The Tenant is never accepted from a request.
- Every route is declared in `openapi.yaml`.

## Authorization model

Two identities meet here and are never conflated:

| Identity           | Role                                                |
| ------------------ | --------------------------------------------------- |
| **Caller**         | the end user's Auth JWT. Decides WHAT is allowed.   |
| **Infrastructure** | the service's database credential. Decides nothing. |

`authorizeRequest` verifies the token with the auth server (failing CLOSED when
that server is unreachable), then evaluates `kitluy_auth.has_permission()` as
the `authenticated` role carrying the caller's subject, inside a rolled-back
transaction. RBAC is **not** reimplemented in TypeScript — the database is the
evaluator, so the API and the database cannot drift into disagreeing.

Owner decision **OD-ADMIN-FLEET-001**: `kitluy_devices` stays CLOSED to
browsers. No `SELECT TO authenticated` grant is added to any device relation;
this service is the only fleet read path.

Owner decision **OD-ADMIN-PROVISION-001**: HET-issued provisioning codes reuse
the canonical `fleet.device_provisioning_code.issue` permission (migration
0163); issuance through that chain is **not** implemented here. Partner-driven
terminal pairing is a different authority with its own key,
`fleet.terminal_pairing_code.issue` (migration 0213, granted to
`DIGITAL_STORE_STAFF`), because the 0163 door has no Store-scope conjunct and
must never be reachable by a Partner. Partner routes decide the permission and
the Store scope as two separate questions (`authorizePartnerRequest`), then
reach the governed door as `kitluy_terminal_issuance_service`, which holds no
table access.

## Configuration

Names only — values live outside git (see the root `.env.example`).

| Variable                              | Purpose                                     |
| ------------------------------------- | ------------------------------------------- |
| `PORT`, `KITLUY_ENV`                  | Kernel configuration.                       |
| `MANAGEMENT_API_DATABASE_URL`         | Trusted DSN (session-mode pooler).          |
| `MANAGEMENT_API_AUTH_URL`             | Auth base URL, origin only.                 |
| `MANAGEMENT_API_AUTH_PUBLISHABLE_KEY` | Publishable key. Privileged values refused. |
| `MANAGEMENT_API_ALLOWED_ORIGINS`      | Exact origin allowlist. Never `*`.          |

The composition root refuses to start on a missing value, a non-origin auth
URL, or a privileged credential in the publishable slot. Startup logs report
the auth host and database host only — never a key, never a password.

## Known gaps (recorded, not hidden)

- Readiness does not probe the database; `ready` is true from startup until
  shutdown.
- Cursor pagination is not implemented. `/devices` returns one capped page and
  reports `truncated` rather than implying the page is the whole fleet.
- The liveness threshold is an **unruled owner value**, so a device with a
  heartbeat reports `UNKNOWN` freshness. `ONLINE` is never invented.

## Evidence

Advancement beyond SCAFFOLDED requires the evidence chain in
`docs/authority/kitluy-implementation-status-and-evidence-register-v1.0.0.md`.
