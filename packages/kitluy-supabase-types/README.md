# @kitluy/supabase-types

Governed owner package for generated Supabase/PostgreSQL `Database` types
(policy: `docs/source/data-contracts/kitluy-suite-supabase-generated-types-policy-v1.0.0.md`).

| File                                                         | Maintenance                                                                                                                                                                                         |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/database.generated.ts`                                  | **GENERATED — never hand-edit.** Written only by `pnpm db:types` from the LOCAL migrated development database (migrations 0000–0035; schemas kitluy_core, kitluy_auth, kitluy_admin, kitluy_audit). |
| `src/index.ts`, `package.json`, `tsconfig.json`, this README | Manually maintained wrapper. No runtime code, no credentials, no endpoints.                                                                                                                         |

## Generation

```bash
pnpm db:types
```

Requires a healthy local stack (Supabase CLI + Docker/Colima — currently
BLK-002). The command fails hard when the stack is absent; it writes to the
single canonical path above, formats with repository prettier rules, and must
be deterministic: two consecutive runs against the same database produce a
zero `cmp` diff.

## Provenance and drift

The current body was **owner-supplied from an external generation**
(commit `261ba60`) — it is not evidence that migrations were applied on this
machine. Once BLK-002 clears, regeerate locally and compare; CI drift
detection compares the committed file against regeneration. Any diff after a
migration change requires a reviewed commit updating both together.

## Review

Changes touching this package follow migration review: generated-body changes
are accepted only alongside their producing migrations and a regeneration
evidence record.
