# Migrations (authored, NOT applied — BLK-002)

Authored against the CONTRACT-APPROVED Supabase pack (schema v1.0.0, RLS
v1.0.0, migration plan v1.0.0; data dictionary v1.0.0 for exact names).
**Agents must not invent table names or RLS from planning prose.**

Authored groups: `0000` (controls), `0010` identity_and_tenant, `0020`
store_and_location, `0030` authz_and_audit, `0035` RLS helpers + policies for
0010–0030 (sequence per owner direction KLD-2026-07-26-003 row 5). Every file
is statically validated only (`pnpm db:validate`); **nothing has been applied
anywhere** — local execution is BLOCKED (BLK-002: Docker/Supabase CLI absent;
see `00_AI_HANDOFF/OPERATOR-INSTRUCTION-BLK-002.md`).

## Conventions

- Filename: `<YYYYMMDDHHMMSS>_<snake_case_name>.sql` (validated by
  `pnpm migrations:validate`).
- Additive/backward-compatible by default (infra spec §13.5).
- Destructive statements require an approved marker:
  `-- kitluy:destructive-approved:<decision-id>`.
- Placeholder migrations must start with `-- kitluy:PLACEHOLDER` and are never
  applied to production.
- **Never auto-apply production migrations** — not from app startup, not from
  ordinary CI (OWNER-LOCKED KL-INF-P1-037). Applied only by authorized human
  operators with four-eyes approval.

## Status registry

Applied-migration status lives in
[../../docs/data/migration-status-registry.md](../../docs/data/migration-status-registry.md).
