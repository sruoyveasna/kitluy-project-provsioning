# kitluy-hub-agent — Store Hub

HET-managed local edge appliance and **local operational authority** for one
Store Location (Store Hub spec v1.0.0; OWNER-LOCKED KLV4-DEC-007).

**Status:** SCAFFOLDED boundary. BUILT + TESTED inside it: transactional-outbox
local database adapter (in-memory simulation), offline/reconnect sync harness
with idempotent replay (`pnpm test:offline`), LAN API kernel (health, identity,
sync status). Everything else is pending canonical packs.

## Non-negotiable rules (owner-locked)

- After provisioning, the Hub owns local transaction writes and T1–T4
  orchestration. POS terminals never write normal Store operations directly to
  Supabase.
- Every local mutation persists its outbox event in the same local database
  transaction (Hub §11.2) — the adapter interface makes this structural.
- Payment, inventory, finance, custody and audit history never use generic
  last-write-wins (see `@kitluy/sync-protocol` CONFLICT_POLICIES).
- Internet failure must not stop approved local operations.
- Target: Raspberry Pi 5, Linux ARM64, local PostgreSQL, systemd packaging.
  Local PostgreSQL adapter is an interface here; the production adapter is a
  next-milestone task.

## Known contract conflict

Hub spec §9.2 and POS Desktop spec §14.2 define different `/edge/v1` route
shapes. Recorded as **KLREC-2026-07-26-001** in the reconciliation register;
mutating LAN routes are blocked until the owner reconciles the contract.

## Development

```bash
HUB_LAN_PORT=8787 pnpm --filter @kitluy-services/kitluy-hub-agent exec node dist/main.js
```

Runs the simulated Hub (in-memory, localhost only). Not production behavior.
