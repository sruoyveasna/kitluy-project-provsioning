# Generated artifacts

Generated database types (e.g. `supabase gen types typescript`) are governed by
`docs/source/data-contracts/kitluy-suite-supabase-generated-types-policy-v1.0.0.md`:
the owner package is `packages/kitluy-supabase-types/` and `pnpm db:types`
(`scripts/database/db-exec.mjs`) writes
`packages/kitluy-supabase-types/src/database.generated.ts` from the local
migrated database only. Generation is currently BLOCKED (BLK-002: Docker and
the Supabase CLI are absent) and reports BLOCKED-NOT-EXECUTED.

This directory holds any other generated CLI artifacts. Rules for all generated
code (repo-wide): documented source, reproducible, never manually edited,
clearly separated from authored sources.
