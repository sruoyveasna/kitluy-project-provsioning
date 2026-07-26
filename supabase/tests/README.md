# RLS test harness (BLOCKED)

RLS tests verify that every tenant-scoped table denies cross-tenant access by
default. Blocked on: (1) Supabase CLI installation, (2) the canonical RLS and
authorization pack (RB v4 §13.3 — missing). `pnpm test:rls` reports this
honestly with a non-zero exit.

Planned harness: pgTAP or SQL-based assertions executed against the local
Supabase stack, one spec file per schema domain, negative tests first
(cross-tenant read/write must fail).
