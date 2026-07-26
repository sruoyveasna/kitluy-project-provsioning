# Migrations (empty at bootstrap — deliberately)

No production DDL exists because the authoritative Supabase schema pack
(schema v1.0.0, RLS v1.0.0, migration plan v1.0.0 — RB v4 §13.3) has not been
authored. **Agents must not invent table names or RLS from planning prose.**

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
