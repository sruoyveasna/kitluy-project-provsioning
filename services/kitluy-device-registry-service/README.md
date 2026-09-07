# kitluy-device-registry-service

Device registry — HET-enrolled device identity, hardware manifests, certificate records (Hub spec Appendix A)

**Status:** the runtime kernel and the pre-credential device surfaces below are
BUILT and TESTED; Store Hub pairing is proven on hardware. Statuses per
capability live in the implementation status and evidence register.

## Ownership

Fleet and hardware operations

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
- `POST /v1/hub-pairing` — a Store Hub presents a Partner-issued pairing code;
  one transaction, two governed doors (group 0194), then a separate trust
  advance.
- `POST /v1/terminal-pairing` — a Pi Terminal presents a Partner-issued
  pairing code for a named seat (group 0213). The body names only
  `deviceRecordId` and `code`; the response carries the owner's §7 context
  (tenant, Store, Location, Store Hub, seat, roles, vertical, environment) from
  server rows, `storeAssignment: pending_trust`, and whether the separate trust
  advance activated the device. A wrong code and a malformed code are the same
  answer; five failed presentations lock the session.
- `/v1/terminal-provisioning/*` — the HET-issued provisioning-code chain
  (challenge, verify, redeem; groups 0162–0174).
- `/v1/device-enrollment/*` and the governed `/v1/*` routes — see the source.

## Evidence

Advancement beyond SCAFFOLDED requires the evidence chain in
`docs/authority/kitluy-implementation-status-and-evidence-register-v1.0.0.md`.
