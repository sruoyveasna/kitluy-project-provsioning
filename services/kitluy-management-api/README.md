# kitluy-management-api

Governed Management API — Admin, Chain and Partner back-office contracts and approved private integrations (RB v4 §10.1)

**Status:** runtime kernel (health/readiness/version, config validation,
graceful shutdown) and the three governed Admin READ routes below are BUILT and
TESTED, including against the real development cloud project. No mutation
route exists. The entry in the implementation status and evidence register has
**not** been advanced yet — that requires the recorded evidence chain, and this
line is a description of the code, not a register claim.

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
- `GET /management/v1/devices/:id` — one device plus DERIVED provisioning
  readiness (implemented). Requires `fleet.read`.
- Remaining business contracts: placeholders pending the canonical
  specification pack — see `docs/services/` and the source-of-truth index.

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

Owner decision **OD-ADMIN-PROVISION-001**: provisioning reuses the existing
canonical `fleet.device_provisioning_code.issue` permission (migration 0163).
No second provisioning key exists. Issuance itself is **not** implemented here.

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
