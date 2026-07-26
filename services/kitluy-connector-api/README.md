# kitluy-connector-api

Governed Connector API — marketplaces, delivery, social and certified external systems; connectors never receive production-database credentials (RB v4 §10.1, §3.5)

**Status:** SCAFFOLDED — runtime kernel (health/readiness/version, config
validation, graceful shutdown) is BUILT and TESTED; no business behavior exists.

## Ownership

Integration platform

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
- Business input/output contracts: placeholders pending the canonical
  specification pack — see `docs/services/` and the source-of-truth index.

## Evidence

Advancement beyond SCAFFOLDED requires the evidence chain in
`docs/authority/kitluy-implementation-status-and-evidence-register-v1.0.0.md`.
