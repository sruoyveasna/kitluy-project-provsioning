# WS-11-T004-P02B2B2B1 — expired-code replacement issuance

| Field     | Value                                                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package   | WS-11-T004-P02B2B2B1 — CORE expired-code replacement issuance inside the governed issuance door                                                     |
| Date      | 2026-08-05 · Asia/Phnom_Penh                                                                                                                      |
| Start SHA | `2336b08`                                                                                                                                         |
| Toolchain | **Node v22.23.0** (`C:\Users\Hello-Evo-PC\AppData\Local\kitluy-toolchain\node-v22.23.0-win-x64\node.exe`), pnpm 9.15.9, engine enforcement ACTIVE |
| Migration | **0167** `20260805100000_0167_expired_terminal_code_replacement_issuance.sql` (additive; 0166 and earlier unchanged)                              |
| Status    | **IMPLEMENTED-IN-DEV**                                                                                                                            |
| Push      | not pushed; URL `disabled://push-requires-owner-approval`                                                                                         |

## 1. Repository intake

Branch `main`, start HEAD `2336b08` (`feat(ws-11): centralize terminal code
expiration`), tree clean, 97 commits ahead of upstream, push URL
`disabled://push-requires-owner-approval`, `git diff --check` clean. Cloud
migrations through 0166 replayed as recorded; next free migration was 0167.
Hub migrations through 0030. No unexplained changes, no competing replacement
work. The package brief itself was preserved at
`00_AI_HANDOFF/WS-11-T004-P02B2B2B1__PACKAGE.txt` (intake copy; the only
non-code tree addition beyond the allowed files).

## 2. Toolchain

The session default was Node v24.15.0 — the package forbids it. The recorded
standalone Node 22 toolchain (installed and SHA-256-verified by P02B2B2A) was
put on PATH for every command: `node --version` = **v22.23.0**,
`pnpm --version` = **9.15.9**, `pnpm config get engine-strict` = **true**; no
engine override was used anywhere. Docker
(`C:\Program Files\Docker\Docker\resources\bin`) and the Supabase CLI
(`C:\Users\Hello-Evo-PC\AppData\Roaming\npm\supabase.cmd`, v2.101.0) were
added to PATH explicitly for DB commands, as recorded by P02B2B2A.

## 3. Package authority

`WS-11-T004-P02B2B2B1` package contract (attached brief); AGENTS.md /
CLAUDE.md / KIMI.md / PROJECT_HOME.md / CONTRIBUTING.md / SECURITY.md;
`00_AI_HANDOFF/000_INDEX.md`, `000_CURRENT_STATE.md`, `000_ACTIVE_PHASE.md`,
`000_BLOCKERS.md`; all WS-11-T004 handoffs through P02B2B2A; migrations
0162–0166 (schema, issuance door, presentation/lockout, revocation, canonical
expiration); pairing protocol §6.1 as cited by those migrations.

## 4. Exact files changed

- `supabase/migrations/20260805100000_0167_expired_terminal_code_replacement_issuance.sql` (new)
- `supabase/tests/assertions.sql` (+ section 54; one exclusion-list repair in
  section 50, see §16)
- `supabase/tests/rls-tests.sql` (+ WS11-N15a/b)
- `services/kitluy-device-registry-service/test/provisioning-code-replacement.integration.test.ts` (new)
- `00_AI_HANDOFF/000_INDEX.md` (this record)
- `00_AI_HANDOFF/WS-11-T004-P02B2B2B1__PACKAGE.txt` (intake copy of the package brief)

No earlier migration, no Hub migration, no provisioning-service runtime, no
Store Hub runtime, no UI, no certificate/pairing code, no package dependency,
no production grant and no expiration worker was touched.

## 5. Issuance decision tree (now authoritative inside the one door)

Under one transaction and one assignment lock:

- **No outstanding code** → the 0163 initial-issuance path, unchanged
  (response byte-identical: no `replaces_provisioning_code_id` key).
- **Outstanding ISSUED, not due** → the unchanged stable `OUTSTANDING`
  result; nothing expired, nothing issued, no event appended.
- **Outstanding ISSUED, due** → the door delegates to
  `expire_terminal_provisioning_code_v1` (trigger source
  `ISSUANCE_REPLACEMENT`, trusted actor OPERATOR + actor ref); on `EXPIRED`
  (or defensively `ALREADY_EXPIRED` for exactly the row this call located and
  locked) exactly one replacement row is issued under this call's new
  idempotency key.
- **Helper answers anything else** (unreachable under the held assignment and
  row locks) → fail-closed `ISSUANCE_REFUSED` with the row's terminal
  classification; terminal states are never described as expired predecessors
  and never overwritten.

## 6. Replacement-lineage design

Migration 0162 had no relational replacement link, so 0167 adds the minimum:

- `replaces_provisioning_code_id uuid null references
  device_provisioning_codes(id)` — the replacement names its IMMEDIATE
  predecessor; the predecessor never points forward.
- `device_provisioning_codes_no_self_replacement_chk` — no self-reference.
- `device_provisioning_codes_one_successor_uidx` — partial unique index on
  the lineage column: ONE direct successor per predecessor; a second
  successor is a constraint refusal, not a race outcome.
- The 0162 integrity trigger is extended (CREATE OR REPLACE, owner preserved):
  on INSERT a non-null lineage requires the predecessor to be an EXPIRED row
  of the SAME Tenant, Store, Location, Hub, terminal, assignment, profile and
  environment (`KLUY-PROVCODE-LINEAGE-MISSING` / `-NOT-EXPIRED` /
  `-INCONSISTENT`); on UPDATE the lineage column joins the immutable set, so
  lineage is fixed at insertion for every identity including the definer
  owner. Authoritative lineage is relational; the CREATED event carries the
  predecessor id only as non-secret supplemental detail.

## 7. Canonical-expiration delegation

The issuance function owns no due-time calculation, no EXPIRED mutation and
no EXPIRED event. It calls the 0166 helper under the locks it already holds
(assignment first, code second — the helper's own order, re-entrant). The
migration guard and section 54 assert non-vacuously that the door's body
references the helper AND contains no `update
kitluy_devices.device_provisioning_codes` (no competing expiration
mutation). The helper's signature, owner and harness-only grant boundary are
asserted unchanged.

## 8. Active-Hub revalidation

The Hub, scope and environment are derived fresh from the CURRENT activation
projection at every call — replacement included. The projection is written
only by a successful activation, so a revoked, replaced or inactive Hub
refuses replacement with the same `KLUY-PROVCODE-HUB-INACTIVE` refusal as
initial issuance; the predecessor's historical Hub binding is never
consulted. The permission check runs BEFORE any expiration work, so a caller
without `fleet.device_provisioning_code.issue` cannot expire someone else's
code (proven in T8). BLK-005 posture inherited: development activation
governed by the recorded decision; pilot/production remain fail-closed.

## 9. Replacement-code contract

Proven in section 54 (T1): new UUID; new eight-character Crockford code (no
I/L/O/U); new digest = sha256(raw replacement code); new payload using the
unchanged canonical binding (`ws11-t004.code.v1` + scope/Hub/device/
assignment/profile/environment/expiry, recomputed and compared in-test); new
idempotency key; new created_at; expires_at exactly 15 minutes after
created_at; state ISSUED; failed_attempt_count 0; no terminal timestamps;
fresh correlation id; scope/Hub/profile/environment exactly equal to the
predecessor's (derived from the CURRENT assignment and projection). Nothing
is copied from the predecessor (digest, raw code, expiry, attempts, terminal
timestamps, reasons, correlation). The raw code is returned exactly once from
the creating call and is persisted nowhere (schema has no raw-capable column;
no event detail contains the raw code or any digest — asserted).

## 10. Idempotency behavior

- New replacement key, initial success → predecessor expired canonically, one
  replacement row, one CREATED event, raw code returned once (T1).
- Identical replay of the replacement key → `ALREADY_ISSUED` with the
  replacement identity, NO `code` key, no additional row, no additional
  EXPIRED or CREATED event (T2).
- Replay of the predecessor's old key → `ALREADY_ISSUED` naming the
  PREDECESSOR row (the canonical historical result); no replacement work (T3).
- A different key while the replacement remains outstanding (not due) →
  `OUTSTANDING`, no third row (T4).
- Same replacement key against a different assignment →
  `KLUY-PROVCODE-CONFLICTING-REPLAY`, zero loser residue (T5).

## 11. Event behavior

A successful replacement leaves exactly: one EXPIRED event on the predecessor
(produced ONLY by the canonical helper; `reason_code = TTL_ELAPSED`, actor
OPERATOR + operator ref, `detail.trigger_source = ISSUANCE_REPLACEMENT`,
derived scope) and one CREATED event on the replacement (existing 0163
contract; `detail.replaces_provisioning_code_id` as supplemental
provenance). No duplicate `REPLACEMENT_CREATED` event type was invented. No
event contains raw code, digest, candidate digest, key material or tokens
(asserted by scanning event detail against all four values).

## 12. Core concurrency evidence

`provisioning-code-replacement.integration.test.ts` — **2/2 PASS, zero
skips**, on genuinely separate pooled backends (barrier-synchronized;
recorded PIDs: race A racer1=**449**, racer2=**450**; race B racer1=**450**,
racer2=**449**), each race with its own terminal/assignment/predecessor, due
time via the sanctioned test clock (committed policy row + transaction-local
override, both removed in afterAll):

- **Race A — two different new keys:** outcomes exactly `{ISSUED,
  OUTSTANDING}`; no uncontrolled unique-constraint error from either racer;
  predecessor EXPIRED with `replaces_provisioning_code_id` NULL; exactly one
  successor ISSUED pointing at the predecessor; one EXPIRED event; one
  predecessor CREATED + one replacement CREATED event; the loser received no
  code.
- **Race B — the same new key twice:** outcomes exactly `{ISSUED,
  ALREADY_ISSUED}`; the creating call returned the raw code, the replay
  returned the replacement identity with no code; exactly two rows
  (predecessor EXPIRED + one replacement ISSUED carrying the key and the
  lineage); one EXPIRED event; one CREATED event.

Broader revocation/Hub-state/recovery replacement races deliberately NOT
started — they belong to P02B2B2B2.

## 13. Privilege evidence

Migration-0167 guard + WS11-N15a/b + section-54 census: the door stays
authenticated-only (PUBLIC/anon/service_role/worker refused); the helper
stays harness-only; the evaluator and revocation boundaries stand; no runtime
identity holds INSERT/UPDATE/DELETE on the code or event tables;
`authenticated` holds no column privilege on the lineage column and a live
direct-UPDATE probe is refused with `insufficient_privilege`; FORCE RLS holds
on both tables; no login-capable role is a member of any NOLOGIN authority;
no raw-code-capable column exists. P02C still owns final production
composition grants — none were added.

## 14. Exact commands and results

All under Node v22.23.0, engine-strict ACTIVE, role `postgres` against the
local stack (`127.0.0.1:54322`, cloud `postgres` DB / `kitluy_hub_local`),
every run FRESH after `db:reset`:

| Command                                              | Exit | Result                                                            |
| ---------------------------------------------------- | ---- | ---------------------------------------------------------------- |
| `pnpm migrations:validate`                           | 0    | 66 files                                                         |
| `pnpm db:reset` (0000→0167)                          | 0    | 66 files; 0167 guard NOTICE present                              |
| `pnpm db:seed` ×2                                    | 0    | idempotent                                                       |
| `pnpm db:test`                                       | 0    | **215 PASS** (98 assertions + 117 RLS), 0 FAIL, 0 SKIP           |
| `pnpm test:rls`                                      | 0    | **117 PASS** (incl. WS11-N15a/b)                                 |
| replacement race suite (vitest, one file)            | 0    | **2/2** separate backends, recorded PIDs 449/450, zero skips     |
| registry service full suite (`npx vitest run`)       | 0    | **235/235** (21 files; lifecycle 30/30, census 14/14), zero skips |
| `pnpm db:validate`                                   | 0    | 66 files                                                         |
| `pnpm secret:scan`                                   | 0    | 1275 tracked files                                               |
| `pnpm clock:check`                                   | 0    | PASS                                                             |
| membership + privilege census (one-off probe)        | 0    | zero residue (see below)                                         |
| `pnpm hub:db:reset` + `hub:db:seed` + `hub:db:test`  | 0    | 31 migrations, **35 PASS**                                       |

Census detail: login-capable members of NOLOGIN authorities 0; borrowed
governor/reader/harness memberships on postgres 0; `test_clock_policy` rows
0; raw-code-capable columns 0; direct mutation grants
(authenticated/service_role/worker) all false. `temporary_grants` holds 3
rows — pre-existing section-50/51 fixtures committed by the 0163/0164 test
sections on every run (present at baseline), not this package's residue.

## 15. Baseline comparison

db:test 212 → **215** (+1 assertion section 54, +2 RLS N15a/b); test:rls 115
→ **117**; registry 233/233 → **235/235** (+2 race tests); lifecycle 30/30;
census 14/14; Hub db:test 35/35. No baseline regressed. Required package
tests have **zero skips**.

## 16. Risks and unresolved values

- **Section-50 exclusion-list repair (recorded honestly):** the 0163-era
  raw-code column scan in `assertions.sql` excluded only `code_digest`; the
  new relational lineage identifier `replaces_provisioning_code_id` matches
  the scan's name pattern without being code material. The exclusion list was
  extended with a comment, mirroring the 0165/0166 guard exclusions. Test
  file edit only; no migration was modified.
- **Fixture-token collision found and fixed in-package:** section 54's first
  claim-token offset range collided with section-52/50 literals
  (`7b…`/`7f…`); offsets moved to `v_i+180`/`v_i+200`, verified collision-free
  against the live claim table.
- **JWT-claims carryover fixed in-package:** the stranger-operator probe (T8)
  left the transaction-local claims GUC naming the stranger; the T9–T12 role
  switches now re-assert the operator claims first (the defect would have
  refused those fixtures as the wrong actor).
- `docs:verify` classification gate fails identically on clean HEAD on this
  Windows checkout (pre-existing; unchanged by this package).

## 17. Rollback instructions

`git revert` this package's commit; migration 0167 has only ever been applied
to the local dev database — a `db:reset` rebuilds without it. Rollback of the
database alone: replay 0000→0166 (0167 is purely additive: one nullable
column, one check, one index, two CREATE OR REPLACE bodies; reverting the
file set restores the 0163 door and 0162 trigger bodies on the next replay).

## 18. Final package status

**IMPLEMENTED-IN-DEV.**

Not marked: replacement race hardening complete, expiration worker complete,
P02B3 complete, P02C complete, WS-11-T004 complete, pilot ready, production
ready.

## 19. P02B2B2B2 prerequisites

Satisfied: replacement issuance live inside the one governed door (0167),
canonical expiration helper (0166), revocation (0165), presentation/lockout
(0164), issuance (0163), schema (0162); next free migration **0168**.
Recommended next package: **WS-11-T004-P02B2B2B2 — replacement race and
recovery hardening** (broader revocation/Hub-state/recovery races around
replacement, explicitly out of scope here). No expiration worker was added;
P02B3 and P02C were not started.
