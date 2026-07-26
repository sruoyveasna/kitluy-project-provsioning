# RLS test harness (authored; execution BLOCKED by BLK-002)

Harness files (SQL, executed via `pnpm db:test` → `scripts/database/db-exec.mjs`):

- `assertions.sql` — structural assertions for migration groups 0010–0035
  (schemas/tables/PKs/FKs, RLS enabled+forced, append-only tables without
  UPDATE/DELETE policies, four-eyes guards, policy counts, no PUBLIC grants,
  definer functions with locked `search_path`).
- `rls-tests.sql` — negative + positive RLS behavior cases labeled with their
  RLS-0NN / KLSEC-0NN ids, using the test-pack section 6 harness pattern
  (transaction-scoped `set_config('request.jwt.claims', …)` + `SET LOCAL ROLE`,
  rollback per case). Requires `supabase/seed/dev-fixtures.sql` first.

Execution requires the local Supabase stack (Supabase CLI + Docker + psql),
which is absent (BLK-002 — see `00_AI_HANDOFF/OPERATOR-INSTRUCTION-BLK-002.md`).
`pnpm test:rls` and `pnpm db:test` report this honestly with exit 3; no
execution result is claimed until these files actually run. Never test
production RLS with destructive probes.
