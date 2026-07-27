# @kitluy/rbac

Role-based access control: explicit permission keys, role templates, permission evaluation

**Status:** BUILT + TESTED — canonical permission registry and deny-by-default
evaluation contract (`test/rbac.test.ts`). Enforcement itself lives in API
policy and PostgreSQL RLS, never in frontend visibility.

## Contract

- `CANONICAL_PERMISSION_KEYS` reproduces the 107-key Suite RBAC Permission
  Registry v1.0.0 verbatim, in registry order. Released keys are immutable.
- `isValidPermissionKey` is structural grammar only; `isCanonicalPermissionKey`
  is the authoritative gate. Unknown, retired and deprecated keys fail closed
  and wildcards are rejected outright (KLD-2026-07-26-002 Group 3).
- `RETIRED_PERMISSION_KEYS` documents the approved seed-key mappings. There is
  no runtime alias layer — no affected key was ever deployed.
- Permission key, API scope, resource scope, environment scope, device/profile
  authorization and approval policy are six separate dimensions. A permission
  key carries no resource ID and no environment name.

## Boundary

- Shared package: may be consumed by apps, services and verticals.
- Must NOT import application or service code.
- Neutral Core: must NOT contain Laundry-specific (or any vertical-specific) terminology.

## Authority

Implementation must follow the canonical specifications indexed in
`docs/authority/kitluy-source-of-truth-index-v1.0.0.md`. Unknown values remain
`[REQUIRED: ...]` — do not guess.
