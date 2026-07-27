# @kitluy/resource-scope

Resource scope model: platform, region, tenant, chain, digital store, store location, device group, device, connector, service, release cohort, support session, file object

**Status:** BUILT + TESTED — canonical scope taxonomy and exact-match helpers
(`test/resource-scope.test.ts`). Enforcement itself lives in API policy and
PostgreSQL RLS, never in frontend visibility.

## Contract

- `SCOPE_LEVELS` follows Resource Scope Model v1.0.0 §3 and the approved renames
  `tenant_or_partner -> tenant` and `individual_device -> device`
  (KLD-2026-07-26-002 Group 3). The retired spellings are permanently invalid.
- `HIERARCHICAL_SCOPE_LEVELS` is the containment spine (`chain` sits between
  `tenant` and `digital_store`). `NON_HIERARCHICAL_SCOPE_LEVELS` covers
  `connector`, `service`, `release_cohort`, `support_session`, `file_object`;
  their relative breadth rank is deterministic but is not containment.
- `sameScope` is exact match — no hierarchy expansion. Containment needs
  `resource_relationships` data and is resolved server-side.
- Fail-closed: `scopeBreadth` throws `UnknownScopeLevelError` on an unknown or
  retired level (it no longer returns `-1`, which would have sorted as broader
  than `platform`), and `sameScope` returns false when either level is unknown.

## Boundary

- Shared package: may be consumed by apps, services and verticals.
- Must NOT import application or service code.
- Neutral Core: must NOT contain Laundry-specific (or any vertical-specific) terminology.

## Authority

Implementation must follow the canonical specifications indexed in
`docs/authority/kitluy-source-of-truth-index-v1.0.0.md`. Unknown values remain
`[REQUIRED: ...]` — do not guess.
