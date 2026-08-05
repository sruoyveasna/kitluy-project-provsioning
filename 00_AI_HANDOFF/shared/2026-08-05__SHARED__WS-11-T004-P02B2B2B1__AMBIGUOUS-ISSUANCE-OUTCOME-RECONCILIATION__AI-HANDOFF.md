# WS-11-T004-P02B2B2B1 — ambiguous issuance-outcome reconciliation

| Field     | Value                                                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package   | WS-11-T004-P02B2B2B1 — prove and, only when repository evidence shows a gap, implement a safe non-secret reconciliation capability for an issuance or expired-code replacement request whose transaction may have committed but whose response was not received by the caller |
| Date      | 2026-08-05 · Asia/Phnom_Penh                                                                                                                      |
| Start SHA | `938de41` (`test(ws-11): harden terminal replacement races`)                                                                                       |
| Toolchain | **Node v22.23.0** (`C:\Users\Hello-Evo-PC\AppData\Local\kitluy-toolchain\node-v22.23.0-win-x64\node.exe`), pnpm 9.15.9, engine enforcement ACTIVE |
| Migration | **0168 — REQUIRED.** The audit classified the existing replay as PARTIAL; one narrow additive correction (scoped-permission replay gate + safe reconciliation fields) was applied |
| Status    | **IMPLEMENTED-IN-DEV**                                                                                                                             |
| Push      | not pushed; URL `disabled://push-requires-owner-approval`                                                                                          |

## 1. Repository intake

Branch `main`, start HEAD `938de41`, tree clean, 99 commits ahead of upstream,
push URL `disabled://push-requires-owner-approval`, `git diff --check` clean.
Cloud migrations through 0167 replayed as recorded (66 files); migration 0168
verified absent before the package and created by it. Hub migrations through
0030 (31 files). No unexplained changes, no competing agent on the
issuance/idempotency boundary. The package brief is preserved at
`00_AI_HANDOFF/WS-11-T004-P02B2B2B1__PACKAGE.txt` (intake copy, pre-existing).

## 2. Toolchain

The session default was Node v24.15.0 — the package forbids it. The recorded
standalone Node 22 toolchain was put on PATH for every command, with the npm
global shim directory (`supabase` CLI v2.101.0) and Docker Desktop
(`C:\Program Files\Docker\Docker\resources\bin`, engine 29.6.1) added for DB
commands: `node --version` = **v22.23.0**, `pnpm --version` = **9.15.9**,
`pnpm config get engine-strict` = **true**. No canonical evidence was produced
under Node 24.

## 3. Authority sources

Package contract WS-11-T004-P02B2B2B1 (attached brief); AGENTS.md / CLAUDE.md
/ KIMI.md / PROJECT_HOME.md / CONTRIBUTING.md / SECURITY.md;
`00_AI_HANDOFF/000_INDEX.md`, `000_CURRENT_STATE.md`, `000_ACTIVE_PHASE.md`,
`000_BLOCKERS.md`; all WS-11-T004 handoffs through P02B2B2B2A; migrations
0162 (schema/events), 0163 (issuance door), 0164 (presentation/lockout),
0165 (revocation — the repository-standard scoped-permission + safe-refusal
pattern), 0166 (canonical expiration), 0167 (replacement issuance and
lineage); the live database roles and RLS posture.

## 4. Exact files changed

- `supabase/migrations/20260805140000_0168_ambiguous_issuance_replay_reconciliation.sql` (new — the one narrow correction)
- `services/kitluy-device-registry-service/test/provisioning-code-issuance-reconciliation.integration.test.ts` (new — scenarios A–E, lineage keys, conflicting replay, hostile probes, raw-code/digest census)
- `00_AI_HANDOFF/shared/2026-08-05__SHARED__WS-11-T004-P02B2B2B1__AMBIGUOUS-ISSUANCE-OUTCOME-RECONCILIATION__AI-HANDOFF.md` (this record)
- `00_AI_HANDOFF/000_INDEX.md` (index line)

No earlier migration (0000–0167) touched, no Hub migration, no
provisioning-service runtime, no Store Hub runtime, no UI, no certificate or
pairing code, no package dependency, no production grant, no recovery worker,
no expiration job, no redemption, no PoP. P02B2B2B2, P02B2B2C, P02B3 and
P02C were not started.

## 5. Pre-edit replay-contract audit

The exact response of `issue_terminal_provisioning_code_v1(assignment_id,
idempotency_key, reason)` was inspected from the live 0163/0167 function
bodies for: initial issuance, identical replay, conflicting replay, old-key
replay after expiration and replacement, new replacement-key replay, replay
after revocation, replay after lockout, and replay after redemption.

**Identical replay (the reconciliation boundary) returned, before 0168:**
`outcome=ALREADY_ISSUED`, `provisioning_code_id`, `expires_at`,
`terminal_profile_key`, `store_hub_device_id`, `correlation_id`, `detail`
— and no raw code (correct). Measured against the package's minimum useful
reconciliation result, it **omitted**: the terminal-assignment ID, the
authoritative **state** (issued/expired/revoked/locked), `created_at`, the
predecessor (`replaces_provisioning_code_id`), an explicit
raw-code-unavailable flag, and an explicit recovery-required flag — the
detail prose was the only signal, not machine-checkable.

**Second proven gap — cross-scope disclosure.** The replay branch (0163 step
2 and the under-lock recheck) returned those row details **before any
permission check at all**: any `authenticated` actor who learned an
idempotency key and assignment id could confirm a committed request and read
its Hub, profile, expiry and correlation metadata across Tenant, Store and
Location boundaries. The 0165 revocation door refuses exactly this pattern
(coarse gate + scoped permission check, `KLUY-PROVCODE-PERMISSION-DENIED`),
so the issuance replay diverged from the repository-standard safe refusal.

**Classification: PARTIAL — ADDITIVE RESPONSE HARDENING REQUIRED.** The
replay locates the correct row (no new status door needed), but the response
omitted required safe fields and disclosed existence cross-scope. Migration
0168 was therefore created, narrowly, per package §8.

## 6. Migration 0168 correction

CREATE OR REPLACE of the ONE issuance door, preserving byte-identical
behavior everywhere except the two identical-replay branches: signature,
owner (`kitluy_activation_governor`, NOLOGIN), grants (`authenticated`
only), contract refusals, actor resolution, assignment lock and lock order,
active-Hub gate, step-5 permission gate, outstanding-code lock,
canonical-helper delegation, Crockford generation, digest contract, row
insert, CREATED event, both ISSUED responses, the OUTSTANDING result and the
CONFLICTING_REPLAY refusal are unchanged. The replay branches now:

1. **gate disclosure on the existing issuance permission** for the row's own
   derived device and environment (`provisioning_code_issue_permitted_v1` —
   no new permission, the 0165 scoped pattern); an actor holding the
   permission nowhere relevant receives the repository-standard safe refusal
   and cannot distinguish "committed" from "nonexistent";
2. return the **safe reconciliation fields only**: `terminal_assignment_id`,
   `state`, `created_at`, `replaces_provisioning_code_id`,
   `raw_code_available=false`, and `recovery_required` (true exactly while
   the committed row is still `issued` — the one case where explicit
   authorized recovery, owned by P02B2B2B2, is the only way forward). The
   outcome name `ALREADY_ISSUED` is unchanged; no raw code, digest, payload
   binding, key material or permission internals are added.

The on-apply guard re-asserts the signature, definer owner, grant boundary,
hardened-body markers, Hub gate, helper delegation, the no-competing-UPDATE
invariant, FORCE RLS, the no-direct-mutation-grant posture, the
no-raw-code-column census and the no-login-capable-governor-member census.

0167 and all earlier migrations remain byte-untouched; `migrations:validate`
and `db:validate` confirm 67 files.

## 7. Ambiguous-outcome scenarios (fresh post-reset run)

All scenarios ran against `127.0.0.1:54322/postgres`, each with its own
terminal/assignment, due time via the sanctioned test clock (committed
policy row + transaction-local `kitluy.test_clock_instant`, both removed in
afterAll), issuance/revocation as the real `authenticated` operator
(time-boxed `fleet.device_provisioning_code.issue`/`.revoke` fixture grants,
deleted in afterAll), evaluator/expiration-helper calls under the
`kitluy_test_harness` borrow (revoked in afterAll). Suite: **11/11 PASS,
zero skips**.

- **A — initial issuance response lost:** ISSUED (raw code discarded by the
  fixture); same-key retry → `ALREADY_ISSUED` naming the same row, state
  `issued`, `recovery_required=true`, `raw_code_available=false`, no `code`
  key, `expires_at` byte-identical (no extension). Residue: 1 row, 1 CREATED
  event.
- **B — replacement response lost:** predecessor ISSUED; replacement under a
  new key on the shifted clock ISSUED with lineage (response discarded);
  replacement-key retry → `ALREADY_ISSUED` naming the SUCCESSOR, state
  `issued`, `replaces`=predecessor. Residue: predecessor EXPIRED with 1
  EXPIRED + 1 CREATED event; successor ISSUED with exactly 1 CREATED event;
  2 rows, lineage unchanged.
- **C — initial request still in flight:** two pooled backends (recorded
  PIDs, distinct), same key, release barrier → one `ISSUED` (raw code, the
  creating transaction only) + one `ALREADY_ISSUED` (no code, full safe
  fields). No error/SQLSTATE on either racer. Residue: 1 row, 1 CREATED
  event.
- **D — replacement request still in flight:** overdue predecessor; two
  backends, same replacement key, barrier → creator `ISSUED` (raw code,
  lineage) + replay `ALREADY_ISSUED` naming the successor with lineage, no
  code. No error/SQLSTATE. Residue: 1 EXPIRED event, 2 CREATED events, 2
  rows, exactly one successor edge.
- **E1 — response lost, then REVOKED:** governed revocation
  (`REVOKED`); original-key retry → `ALREADY_ISSUED`, state `revoked`,
  `recovery_required=false`, no code; no duplicated CREATED or REVOKED
  event. Fresh issuance after revocation → `ISSUED` with NULL lineage; the
  old key still identifies the REVOKED historical row (never relabeled
  EXPIRED), the new key identifies the fresh row; 2 rows, no lineage edge.
- **E2 — response lost, then canonically EXPIRED** (0166 helper on the
  shifted clock, harness-only): retry → `ALREADY_ISSUED`, state `expired`,
  `recovery_required=false`; 1 CREATED + 1 EXPIRED event; still 1 row — the
  replay created no replacement.
- **E3 — response lost, then LOCKED** (five wrong presentations through the
  0164 evaluator, harness-only): retry → `ALREADY_ISSUED`, state `locked`,
  `recovery_required=false`; 1 CREATED, 5 FAILED_ATTEMPT, 1 LOCKED event;
  still 1 row.
- **Lineage keys:** after A EXPIRED → B ISSUED, A's key identifies A
  (expired, NULL lineage), B's key identifies B (issued, replaces=A); A's
  key never returns B and vice versa; replays appended zero events.
- **Conflicting assignment:** the scenario-A key replayed against a fresh
  assignment → `ISSUANCE_REFUSED / KLUY-PROVCODE-CONFLICTING-REPLAY`, no
  `provisioning_code_id` disclosed, 0 rows on the target assignment.

## 8. Hostile and privacy evidence

Real roles, live probes: unauthenticated (no actor context) →
`KLUY-PROVCODE-UNAUTHENTICATED`; authenticated holding the issuance
permission nowhere → the 0168 gate answers
`KLUY-PROVCODE-PERMISSION-DENIED` with **no** `provisioning_code_id` and no
`state` (cross-scope existence not leaked); `anon` → SQLSTATE 42501 (no
EXECUTE on the door); direct SELECT on the code and event tables as
`authenticated` → 42501 permission denied on both (stronger than RLS-zero —
no runtime read grant at all). Replay output census: no `code`,
`code_digest` or `payload_sha256` key in any `ALREADY_ISSUED` result. Event
census: every fixture raw code and every fixture digest was scanned against
the full text of every fixture event row — zero matches. The caller cannot
supply actor, scope, Hub, profile, state or clock: the door signature is
exactly `(uuid, text, text)` (asserted on apply by the 0168 guard). No
temporary grant, policy row or membership survives the suite (§10).

## 9. No recovery mutation in this package

No automatic revocation, no automatic replacement, no recovery idempotency
key, no TTL extension, no raw-code reconstruction, no delivered/received
marking, no expiration or recovery job. The recorded safe recommendation for
a committed code whose raw value was lost: reconcile the committed request →
require explicit authorized recovery → revoke the unusable outstanding code
→ issue a fresh code under a new idempotency key. That workflow belongs to
**WS-11-T004-P02B2B2B2** and was not started.

## 10. Privilege residue census (post-suite, live probes)

- login-capable members of the NOLOGIN definer authorities
  (`kitluy_activation_governor`, `kitluy_credential_approval_reader`,
  `kitluy_credential_issuer`): **0**;
- login-capable non-`postgres` members of `kitluy_test_harness`: **0**;
- `kitluy_auth.temporary_grants`: **3 rows — exactly the pre-existing
  section-50/51 fixture rows recorded at baseline** (the suite's own grants
  are deleted by subject and by RUN-scoped reason sweep in afterAll);
- `kitluy_ops.test_clock_policy`: **0 rows**.

Honest operational note: three earlier standalone debug runs of the new
suite left 6 fixture grant rows (afterAll sweeps ran, but the leaked rows
predated the RUN-scoped sweep hardening; root cause not definitively
isolated — possibly a failed-cleanup path in the interrupted iterations).
The rows were removed manually, the afterAll was hardened with the
RUN-scoped reason sweep, and the final verification runs (standalone and
full-suite) left **zero** residue, verified by the census above.

## 11. Exact commands and results

All under Node v22.23.0, engine-strict ACTIVE, role `postgres` /
`authenticated` fixtures against the local stack, every DB run FRESH after
`db:reset`:

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm db:reset` (0000→0168) | 0 | 67 files; 0168 guard NOTICE present |
| `pnpm db:seed` ×2 | 0 | idempotent (`INSERT 0 1`, `INSERT 0 0`) |
| `pnpm db:test` (single fresh run) | 0 | **215 PASS** (98 assertions + 117 RLS), 0 FAIL |
| `pnpm test:rls` | 0 | **117 PASS**, 0 FAIL |
| reconciliation suite (vitest, one file) | 0 | **11/11 PASS, zero skips** (scenarios §7) |
| registry service full suite (`npx vitest run`, serial) | 0 | **257/257 PASS, zero skips** (23 files; baseline 246 + 11 new) |
| `pnpm migrations:validate` | 0 | 67 files |
| `pnpm db:validate` | 0 | 67 files, all static checks |
| `pnpm secret:scan` | 0 | 1282 tracked files |
| `pnpm clock:check` | 0 | PASS |
| membership + privilege census (live probes) | 0 | zero residue (§10) |
| `pnpm hub:db:reset` + `hub:db:seed` + `hub:db:test` | 0 | 31 migrations, **35 PASS** (required: the cloud reset had removed `kitluy_hub_local`) |

Honest operational notes: (a) `db:test` is single-run-per-reset — a second
run on the same database fails on accumulated ACTIVE fixture devices
(pre-existing property, recorded by P02B2B2B2A; the 215-PASS count above is
from the fresh single run); (b) the first full registry run after the cloud
reset skipped the lifecycle/census files because the Hub database was gone —
rebuilding the Hub DB (above) restored them; (c) one full-suite run at
11:44 reported a single non-reproduced failure (256+1); the immediately
following two full serial runs passed 257/257 and the final canonical run
passed 257/257 with zero residue — recorded here for reviewer visibility
rather than silently dropped.

## 12. Baseline comparison

db:test **215** (= baseline 215); test:rls **117** (= 117); registry
**257/257** (baseline 246/246 + 11 new reconciliation tests); lifecycle
**30/30**; census **14/14**; Hub db:test **35/35**. No baseline regressed.
Required package tests have **zero skips**.

## 13. Expired replacement versus revoked reissue (required distinction)

Proven distinct, executable: an expired predecessor's original key identifies
the EXPIRED predecessor and the replacement key identifies the successor
with `replaces_provisioning_code_id` set (B, lineage keys); a revoked
historical row's key identifies it as REVOKED, a fresh post-revocation
issuance carries NULL lineage, and the revoked row is never relabeled EXPIRED
(E1). Reissue after lockout: the 0167 fail-closed branch answers
`KLUY-PROVCODE-ALREADY-LOCKED` with no mutation; the locked historical key
reconciles as state `locked` (E3). Redeemed historical code: redemption is
out of scope for this package's fixtures (no governed redemption path exists
yet — P02B3); no reprovisioning semantics were invented.

## 14. Rollback instructions

`git revert` this package's commit, then `pnpm db:reset` — the database
rebuilds identically at 0167 without migration 0168 (0168 is additive
CREATE OR REPLACE; reverting the file removes it from the apply sequence).
No data migration or destructive change exists to undo.

## 15. Final package status

**IMPLEMENTED-IN-DEV.**

Not marked: explicit lost-code recovery complete, expiration workers
complete, P02B3 complete, P02C complete, WS-11-T004 complete, pilot ready,
production ready.

## 16. Prerequisites for P02B2B2B2

Satisfied: ambiguous-outcome reconciliation proven for initial issuance and
expired-code replacement (scenarios A–E on separate backends with recorded
distinct PIDs); the replay boundary is the reconciliation surface — scoped
-permission-gated, safe fields only, no raw code or digest; historical-key
semantics (expired predecessor vs revoked history vs locked) proven
distinct; cross-scope existence not leaked; reconciliation performs no
mutation and appends no event; zero regressions against every baseline.
Explicit lost-code recovery was not started; no expiration worker was added;
P02B3 and P02C were not started. Recommended next package:
**WS-11-T004-P02B2B2B2 — controlled lost-code recovery** (revoke the
unusable outstanding code + issue a fresh code under a new idempotency key,
behind explicit authorized confirmation).
