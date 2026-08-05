# WS-11-T004-P02C1 — PROVISIONING COMPOSER EFFECTIVE-PRIVILEGE HARDENING — AI HANDOFF

| Field          | Value                                                                                                                 |
| -------------- | --------------------------------------------------------------------------------------------------------------------- |
| Date           | 2026-08-05                                                                                                            |
| Package        | WS-11-T004-P02C1 (provisioning composer effective-privilege hardening)                                                |
| Status         | **IMPLEMENTED-IN-DEV — PRIVILEGE BOUNDARY CORRECTED**                                                                 |
| Start SHA      | `61beb431ddf9fee5c44f99eaead80c7627d8d620` (feat(ws-11): add controlled provisioning composition)                     |
| End SHA        | recorded by `git log -1` after the package commit                                                                     |
| Branch / ahead | `main`, ~106 ahead at intake; push `disabled://push-requires-owner-approval` — **nothing pushed**                     |
| Toolchain      | **Node v22.23.0**, pnpm 9.15.9 (corepack), engine-strict=true                                                         |
| PostgreSQL     | **15.8** (measured, `show server_version`)                                                                            |
| Migration      | `supabase/migrations/20260806000000_0173_provisioning_composer_noinherit_gateway.sql` (additive; 0000–0172 untouched) |

## 1. The review was right — the defect was real

P02C claimed the composer capability was entered per transaction with
`SET LOCAL ROLE`. **The database did not enforce that claim.** Measured on
this repository, before any change:

| Function                                              | Direct ACL for `service_role` | **Effective** privilege | **Real call as `service_role`, no SET ROLE**           |
| ----------------------------------------------------- | ----------------------------- | ----------------------- | ------------------------------------------------------ |
| `evaluate_terminal_provisioning_code_v1`              | false                         | **true**                | **EXECUTED** → `PRESENTATION_REFUSED` (business logic) |
| `issue_terminal_provisioning_pop_challenge_v1`        | false                         | **true**                | **EXECUTED** → `POP_CHALLENGE_REFUSED`                 |
| `read_terminal_provisioning_pop_challenge_context_v1` | false                         | **true**                | **EXECUTED** → `CONTEXT_REFUSED`                       |
| `record_terminal_provisioning_pop_verification_v1`    | false                         | **true**                | **EXECUTED** → `POP_VERIFICATION_REFUSED`              |
| `redeem_terminal_provisioning_code_v1`                | false                         | **true**                | **EXECUTED** → `REDEMPTION_REFUSED`                    |

Every call reached business logic — these are governed refusals for
nonexistent ids, **not** privilege errors. The probe confirmed
`current_user = service_role` at the moment of each call.

**Root cause:** `service_role` has `rolinherit = true`, and **PostgreSQL 15
has no per-membership `INHERIT` option** (that arrived in PG16), so
inheritance is governed by the member's attribute alone. `GRANT
kitluy_provisioning_service TO service_role` therefore handed `service_role`
all five capabilities permanently and implicitly.

**Why P02C's assertions missed it:** they were converted to direct-ACL checks,
which answer "was a grant written here?" — never "can this identity execute?".
The review's objection is exactly correct: direct-ACL absence is not evidence
of least privilege. Both checks are now required everywhere.

## 2. The correction (migration 0173)

A **NOINHERIT NOLOGIN hinge** between the service identity and the capability:

```text
service_role --member--> kitluy_provisioning_gateway (NOINHERIT) --member--> kitluy_provisioning_service
```

PostgreSQL stops the automatic-privilege walk at a role that does not inherit,
so the capabilities are no longer carried implicitly; membership stays
transitive, so `SET ROLE` still reaches the composer. Measured after the fix:

| Property                                                     | Before   | After                                                      |
| ------------------------------------------------------------ | -------- | ---------------------------------------------------------- |
| `has_function_privilege('service_role', …)` (all five)       | true     | **false**                                                  |
| Real call as `service_role`, no entry                        | EXECUTED | **DENIED 42501**                                           |
| Real call after `SET LOCAL ROLE kitluy_provisioning_service` | EXECUTED | **EXECUTED**, `current_user = kitluy_provisioning_service` |
| `pg_has_role(service_role, composer, 'MEMBER')`              | true     | **true** (entry still possible)                            |
| `pg_has_role(service_role, composer, 'USAGE')`               | true     | **false** (no inheritance)                                 |

**Why this shape.** The two alternatives were rejected with reasons, not
preference: `ALTER ROLE service_role NOINHERIT` changes a Supabase-owned role
attribute and would reach every unrelated membership `service_role` holds
(explicitly out of bounds per the package); a dedicated NOINHERIT **login**
role requires a credential, which is an owner value that must never enter this
repository. The gateway needs neither.

## 3. Tests A–E (executable, effective privilege — not catalog reading)

- **A — `service_role` without entry:** for all five capabilities, effective
  privilege is `false` and the real call raises **42501**; the probe asserts
  `current_user = 'service_role'` so it cannot pass vacuously; zero residue.
- **B — explicit entry:** `current_user` becomes the composer while
  `session_user` remains the connecting identity; all five execute into
  business logic; direct table SELECT is still **42501**.
- **C — capability dies with the transaction:** after **both** COMMIT and
  ROLLBACK the composer is no longer active, and an unentered call on the
  **same pooled connection** is denied — connection reuse retains nothing.
- **D — mid-transaction withdrawal:** after a successful capability call,
  switching back denies the next call immediately.
- **E — unrelated services:** `kitluy_issuance_service` and
  `kitluy_worker_service` are not members, hold no effective privilege, and
  are denied 42501 on real calls; no member of either composition role holds
  `admin_option`, so neither can be re-delegated.

## 4. Recorded finding — OUT OF SCOPE, needs an owner decision

`kitluy_issuance_service` (0127) and `kitluy_worker_service` (0135) are
granted to `service_role` in exactly the same way and therefore share the
same inherited-privilege property: `service_role` carries their capabilities
without entering them. **This package did not change them** — their consumers
were not audited here and the blast radius is outside WS-11-T004. The same
gateway shape would fix them. This is recorded, not silently left: it is a
pre-existing repository-wide machine-identity property that P02C inherited
rather than invented, and it deserves its own package.

## 5. Composition regression

Scenarios A–F remain green with the composer entered explicitly (the suite no
longer borrows composer membership for `postgres` — it exercises the real
entry path, since a superuser may `SET ROLE` without membership). Full
development flow, governed lockout, forged-proof refusal, ambiguous replay,
mid-flight Hub withdrawal and the BLK-005 pilot/production refusal all pass
unchanged. **12/12** in that suite (7 original + 5 identity tests), zero
skips.

## 6. Verification (Node v22.23.0; fresh reset; cloud and Hub serialized)

| Command                                    | Exit | Result                                                                            |
| ------------------------------------------ | ---- | --------------------------------------------------------------------------------- |
| `pnpm migrations:validate` / `db:validate` | 0/0  | 72 files                                                                          |
| `pnpm db:reset` (0000→**0173**) + seed ×2  | 0    | 72 applied; 0173 guard NOTICE; idempotent                                         |
| `pnpm db:test`                             | 0    | **227 PASS, 0 FAIL** (baseline 227)                                               |
| `pnpm test:rls`                            | 0    | **129 PASS, 0 FAIL** (baseline 129; WS11-N19 now asserts effective privilege too) |
| composition suite                          | 0    | **12/12, zero skips** (7 + Tests A–E)                                             |
| `pnpm hub:db:reset` + seed + test          | 0    | **35 PASS**                                                                       |
| registry full suite (serial)               | 0    | **325/325, 29 files, zero skips** (baseline 320 + 5)                              |
| device-identity                            | 0    | **803/803**                                                                       |
| `pnpm secret:scan` / `clock:check`         | 0/0  | 1305 files clean / PASS                                                           |
| targeted `prettier` on changed files       | 0    | clean                                                                             |
| `pnpm verify`                              | 1    | **11 of 12** — only the recorded pre-existing ~830-file `format:check` artifact   |

No baseline regressed: db:test 227→227, rls 129→129, registry 320→325,
device-identity 803→803, Hub 35→35, composition 7→12, lifecycle 30→30,
census 14→14. Residue census: 0 suite grants, 0 clock rows, 0 borrowed
memberships, 0 fault triggers.

## 7. Format condition

Every changed package file passes targeted prettier. The full failure is the
pre-existing ~830-file artifact, unchanged from starting HEAD; `pnpm verify`
is reported as 11 of 12, not as passing.

## 8. Security posture after the correction

Composer: NOLOGIN, not superuser, no createrole/createdb, no bypassrls,
member of nothing, exactly five capabilities, zero table privileges. Gateway:
NOLOGIN, NOINHERIT, holds no function grant of its own, held only by
`service_role`, non-delegable. `anon`, `authenticated`,
`kitluy_issuance_service`, `kitluy_worker_service`: no effective privilege on
any capability. BLK-005 unchanged — pilot and production still fail closed
inside `assert_pki_configuration_approved`.

## 9. Rollback

`git revert <package commit>`, then `pnpm db:reset` (0000→0172) and Hub
rebuild. Note that reverting **restores the inherited-privilege gap** — the
revert is safe for the schema but reopens the boundary this package closed.

## 10. P03A readiness

The effective composer boundary is **proven and corrected**, so the blocker
this package existed to resolve is cleared and P03A may proceed. The
terminal-to-service transport identity remains an explicit **owner-value
dependency** (P02C Boundary B3) and must not be silently invented; it gates
the versioned route contract, not activation-state work. **WS-11-T004 remains
incomplete** — the P02C final census is unchanged by this package.
