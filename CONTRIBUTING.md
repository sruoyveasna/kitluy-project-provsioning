# Contributing to KitLuy Suite

## Before you start

1. Read [PROJECT_HOME.md](PROJECT_HOME.md) — the single entry point.
2. Read the authority order in `docs/authority/kitluy-authority-and-precedence-v1.0.0.md`.
3. Check `docs/authority/kitluy-implementation-status-and-evidence-register-v1.0.0.md`
   before claiming anything is implemented.

## Workflow

- Node version: see `.nvmrc`. Package manager: pnpm (version pinned in `package.json`).
- Install: `pnpm install`
- Validate before pushing: `pnpm verify`
- Small, logically grouped commits. No secrets, ever (`pnpm secret:scan`).

## Rules that are not negotiable

- Never label scaffolded code as implemented. Statuses live in the evidence register.
- Never auto-apply production migrations. Never commit credentials.
- Applications must not import another application's internals; shared packages
  must not import application code; neutral Core must not contain Laundry terms.
- Financial, custody, inventory-movement and audit records are append-only;
  corrections are compensating records.
- POS terminals never write normal Store operations directly to Supabase —
  everything goes through the Store Hub (`services/kitluy-hub-agent`).
- Conflicts between sources are recorded in
  `docs/authority/kitluy-decision-and-reconciliation-register-v1.0.0.md`, never
  silently resolved.

## Handoffs

Every significant AI or human working session ends with a handoff note in
`00_AI_HANDOFF/` and an update to `00_AI_HANDOFF/000_INDEX.md`.
