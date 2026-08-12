# Remote migration and RLS evidence

**Date:** 2026-08-07
**Remote migration count: 0. Remote RLS: NOT VERIFIABLE.**

Both follow from `14_CANONICAL_CLOUD_SUPABASE_DEPLOYMENT.md` §3 — nothing was
deployed, so there is nothing remote to evidence. This document records what
_was_ proven locally, so the next session can compare rather than re-derive.

---

## 1. Remote state

| Measure            | Local (validated) | Remote `het-kitluy-dev` |
| ------------------ | ----------------- | ----------------------- |
| Applied migrations | 86                | **0**                   |
| `kitluy_*` schemas | 15                | 0                       |
| Tables             | 183               | 0                       |
| RLS policies       | 258               | 0                       |
| PostgreSQL         | 15                | 17.6                    |

Remote parity is therefore **0 / 86**, by design and not by failure — the
deployment was stopped deliberately rather than attempted and abandoned partway.
A partial apply would have left the project in a state matching no lineage.

---

## 2. Local RLS evidence (PostgreSQL 15)

`supabase/tests/rls-tests.sql` ran to completion, **exit 0**, on a database
built from zero by all 86 migrations.

Coverage per the suite's closing summary: 14 + 9 baseline; Cycle-5 WS5 7−/7+ and
WS6 10−/9+; Cycle-6 WS7 13−/6+ and WS8 13−/6+; Cycle-10 `kitluy_devices` T001
4−/1+ and T002 3−/1+; WS-11-T004 provisioning-code, issuance, presentation,
revocation, expiration, replacement, recovery, PoP, redemption, composition and
activation boundary cases; WS-11-T005 fleet/support/containment; WS-11-T006
replacement and release boundary cases.

RLS enablement measured directly:

    kitluy_* tables with RLS enabled ....... 181 / 183
    kitluy_devices tables with RLS enabled .. 64 / 64
    kitluy_* RLS policies ................... 258

The two without RLS are `kitluy_ops.migration_journal` and
`kitluy_ops.test_clock_policy` — internal operational tables holding no
business, tenant or device data.

## 3. The §12 authorization matrix — status

The mission requires these proven **before** connecting the agent to the cloud:

| §12 requirement                                     | Local status                                               | Remote status |
| --------------------------------------------------- | ---------------------------------------------------------- | ------------- |
| unassigned device cannot access Store business data | covered by existing device RLS cases                       | not verified  |
| Partner A cannot access Partner B devices           | covered by tenant-isolation cases                          | not verified  |
| device cannot self-assign to a Store                | enforced server-side; provisioning routes derive all scope | not verified  |
| terminal cannot self-select profile                 | enforced; agent has no code path to choose one             | not verified  |
| revoked identity refused                            | covered by revocation boundary cases                       | not verified  |
| Store staff cannot manage the global fleet          | covered by permission-key cases                            | not verified  |
| privileged provisioning requires the backend path   | pre-credential routes refuse sessions/keys                 | not verified  |
| audit records protected                             | append-only triggers present                               | not verified  |

Every row is **locally covered and remotely unverified**. None may be described
as proven against the cloud until the chain deploys.

## 4. Functions and RPC

Local: **255** functions across `kitluy_*` schemas. Supabase Edge Functions:
**0** — `supabase/functions/` holds only a README, unchanged. Governed contracts
are SQL functions plus Node services, which is the existing architecture and was
not altered.

Remote: none, nothing deployed.

## 5. What to run once the blocker clears

1. `node scripts/database/migration-manifest.mjs --check` — chain identity intact.
2. `supabase link --project-ref gkfcxxtryqmjnhujlkdr`.
3. `supabase migration list` — confirm the remote ledger is still empty.
4. `supabase db push` — never `db reset` against a cloud project.
5. Re-run the counts in §1 against the remote and require exact parity with the
   local column, **on the same PostgreSQL major**.
6. Re-run `supabase/tests/rls-tests.sql` against the remote.
7. Only then work through the §12 matrix, row by row, against the cloud.
