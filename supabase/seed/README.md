# Seed data conventions

- Development seeds are SYNTHETIC only — never real customer or production
  data (repository rule; see SECURITY.md).
- Seeds are locale-aware (Khmer + English) and currency-aware (KHR/USD).
- `dev-fixtures.sql` — idempotent DEMO/QA_FIXTURE personas for migration groups
  0010–0035 (13 cycle-instruction cases; fixed UUIDs; fictional Khmer/English
  data; production guard fails closed). Applied via `pnpm db:seed`
  (`scripts/database/db-exec.mjs`) — currently BLOCKED-NOT-EXECUTED (BLK-002).
- Reference/RBAC production seeds remain migration group 0150 (not authored
  here); dev fixtures never claim that group.
