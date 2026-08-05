# WS-11-T004-P02B2B2B2A — ATOMIC CONTROLLED LOST-CODE RECOVERY — AI HANDOFF

| Field | Value |
| --- | --- |
| Date | 2026-08-05 |
| Package | WS-11-T004-P02B2B2B2A (atomic controlled lost-code recovery) |
| Status | **IMPLEMENTED-IN-DEV** |
| Start SHA | `895cdfe4c84b7ef9aeb5302043494eabfa0744ed` (feat(ws-11): harden ambiguous issuance reconciliation) |
| End SHA | recorded in `git log -1` after the package commit (one atomic commit on `main`) |
| Branch / ahead | `main`, ~100 ahead of origin; push URL `disabled://push-requires-owner-approval` — **nothing pushed** |
| Toolchain | **Node v22.23.0** (`C:\Users\Hello-Evo-PC\AppData\Local\kitluy-toolchain\node-v22.23.0-win-x64\node.exe`), pnpm 9.15.9 (corepack), engine-strict=true |
| Migration | `supabase/migrations/20260805170000_0169_atomic_terminal_code_recovery.sql` (additive; 0000–0168 untouched) |

## 1. Repository intake

- Tree at intake carried exactly two untracked files — the 0169 migration draft
  and the recovery integration test — produced by an interrupted earlier
  session of THIS SAME package (no other agent, no tracked-file drift,
  `git diff --check` clean). They were reviewed line-by-line against the
  package contract, completed (three test defects fixed, the WS11-N16 RLS
  boundary case added) and carried forward; nothing was discarded.
- **RECORDED PACKAGE-ID COLLISION (not silently resolved):** the repository
  already contains a handoff labeled `WS-11-T004-P02B2B2B2A` for
  *replacement cross-operation race hardening* (2026-08-05, no migration).
  The owner package contract names this lost-code-recovery package with the
  same ID. Repository lineage is unambiguous about the WORK — the 0168
  handoff's next-package pointer is "P02B2B2B2 controlled lost-code
  recovery", which this package delivers — so the collision is an identifier
  clash only. Both handoffs keep distinct slugs; successor packages should
  cite slugs, not bare IDs, until the owner renumbers.

## 2. Authority sources

- Package contract WS-11-T004-P02B2B2B2A (atomic controlled lost-code recovery).
- `kitluy-device-discovery-and-pairing-protocol-v1.0.0` §6.1.
- P01 capability audit; P02A schema (0162); P02B1 issuance (0163); P02B2A
  presentation/lockout (0164); P02B2B1 revocation (0165); P02B2B2A canonical
  expiration (0166); P02B2B2B1 replacement issuance + lineage (0167);
  P02B2B2B1 ambiguous issuance reconciliation (0168); P02B2B2B2A replacement
  race hardening (lock-order proof: assignment→code in every door).
- Sensitive-action determination inherited from the 0165 recorded decision:
  the KLD-2026-07-29/30 re-authentication and four-eyes requirements govern
  device-CREDENTIAL revocation, not a 15-minute provisioning code.

## 3. Recovery authorization decision (§6 questions, answered before design)

1. **No dedicated recovery permission.** None exists in the registry, no
   canonical authority requires one, and the package prefers reuse.
2. **Both existing exact scoped permissions are required**:
   `fleet.device_provisioning_code.issue` AND
   `fleet.device_provisioning_code.revoke`, evaluated against the DERIVED
   device and environment (never caller-supplied scope).
3. **Mandatory bounded reason** (the 0165 contract verbatim: non-blank,
   ≤500 chars, no control characters, no key material, no code-shaped token).
   **No re-authentication, no confirmation ceremony, no four-eyes** — per the
   0165 recorded decision; nothing was invented.
4. **The public issue/revoke doors are NOT nested.** Both are plpgsql doors
   that resolve the actor and permissions independently; nesting would run
   the recovery-key replay logic of 0163/0168 (wrong vocabulary for
   recovery) and could not share one lock acquisition cleanly. The recovery
   door therefore inlines the SAME canonical fragments those doors use
   (guarded UPDATE identical to 0165; successor INSERT identical to 0167;
   generator/digest/payload identical to 0163/0162), inside ONE transaction.
   Public signatures, owners and grants of all earlier doors are unchanged
   (asserted on apply).
5. **Lineage:** see §6 below — shared-correlation relational binding; no new
   column; documented and asserted.

## 4. Files changed (complete list)

1. `supabase/migrations/20260805170000_0169_atomic_terminal_code_recovery.sql` — new.
2. `services/kitluy-device-registry-service/test/provisioning-code-recovery.integration.test.ts` — new (12 tests).
3. `supabase/tests/rls-tests.sql` — WS11-N16 boundary case appended (3 PASS
   notices) + summary line extended. No existing case touched.
4. `00_AI_HANDOFF/shared/2026-08-05__SHARED__WS-11-T004-P02B2B2B2A__ATOMIC-CONTROLLED-LOST-CODE-RECOVERY__AI-HANDOFF.md` — this file.
5. `00_AI_HANDOFF/000_INDEX.md` — one row.

## 5. The door

```text
kitluy_devices.recover_terminal_provisioning_code_v1(
  p_terminal_assignment_id uuid,
  p_original_idempotency_key text,
  p_recovery_idempotency_key text,
  p_reason text
) returns jsonb
```

- SECURITY DEFINER; owner `kitluy_activation_governor` (NOLOGIN); pinned
  `search_path = pg_catalog, kitluy_devices, kitluy_auth, kitluy_ops, extensions`.
- EXECUTE: **authenticated only**. public/anon/service_role/kitluy_worker_service
  revoked and asserted. No production service grant (P02C owns composition).
- One new internal bridge `provisioning_code_issue_held_v1()` (coarse "holds
  the issue permission at all" gate), owned by
  `kitluy_credential_approval_reader`, executable by EXACTLY the governor —
  the 0163/0165 bridge pattern. The schema CREATE grant used for the
  ownership move is revoked in the same migration.
- Inputs: assignment id, ORIGINAL issuance idempotency key, NEW recovery
  idempotency key, mandatory reason. The caller can never supply tenant,
  store, location, Hub, environment, profile, actor, state, predecessor id,
  raw code, digest, lineage or time — all derived from session + rows.
- Outputs (jsonb): `RECOVERED` (with the raw code, once), `ALREADY_RECOVERED`
  (identical replay; no raw code), `RECOVERY_ALREADY_COMPLETED` (different
  recovery key after success; successor named, no raw code, successor never
  revoked), `RECOVERY_REFUSED` with stable `refusal_code`s
  (`KLUY-PROVCODE-NO-ASSIGNMENT/-NO-ORIGINAL-KEY/-NO-RECOVERY-KEY/-NO-REASON/
  -REASON-TOO-LONG/-REASON-INVALID/-UNAUTHENTICATED/-PERMISSION-DENIED/
  -ASSIGNMENT-MISSING/-ASSIGNMENT-INACTIVE/-HUB-INACTIVE/-REQUEST-NOT-FOUND/
  -CONFLICTING-REQUEST/-SCOPE-INCONSISTENT/-ALREADY-EXPIRED/-ALREADY-REVOKED/
  -ALREADY-LOCKED/-ALREADY-REDEEMED/-CONFLICTING-REPLAY`).

### Lock order (the established assignment→code order; never reversed)

1. resolve authenticated actor (session bridge; never an argument);
2. coarse gates BEFORE any row read: `issue_held` AND `revoke_held` — an
   actor holding neither ingredient learns nothing about row existence;
3. recovery-key idempotency pre-check (row locked if found; disclosure only
   after BOTH exact scoped permission checks against the row's own derived
   device/environment — the 0168 disclosure pattern, doubled);
4. lock the terminal assignment (`for update`) — same-assignment recoveries
   serialize here;
5. re-run the recovery-key check under the lock (a same-key racer waits, then
   answers `ALREADY_RECOVERED`);
6. assignment liveness (`pending_trust`/`active`);
7. derive scope (tenant/store/location) from stored rows;
8. active-Hub gate (ADMIN-QA-014; projection presence at the derived scope —
   written only by successful activation) BEFORE any mutation;
9. exact scoped permission checks (issue AND revoke) against the derived
   device + environment (the environment gate IS this check);
10. locate and lock the original code by (assignment, original key); scope
    consistency re-verified under the lock; eligibility classified; then the
    atomic mutation.

### Atomicity contract (proven)

ONE transaction: guarded `UPDATE … SET state='revoked' … WHERE id=… AND
state='issued'` (identical to 0165, with the recovery key stored as
`revocation_idempotency_key` and the reason immutable), one REVOKED event,
fresh Crockford-8 generation (0163 generator: 8 × gen_random_bytes, 256=8·32
uniform), sha-256 digest + canonical payload binding (0162), successor INSERT
under the recovery key with `replaces_provisioning_code_id = NULL`, one
CREATED event, raw code returned from this transaction only. Any failure
anywhere rolls the WHOLE thing back: old code stays ISSUED, no event, no row,
no idempotency residue (proven by the HUB-INACTIVE, permission, contract and
terminal-state refusal tests — zero residue asserted after each).

### Recovery lineage decision (recorded)

Recovery is NOT expired-code replacement. The 0167 column
`replaces_provisioning_code_id` admits only an EXPIRED predecessor (trigger
rule `KLUY-PROVCODE-LINEAGE-NOT-EXPIRED`, asserted unchanged), and the
recovery predecessor finishes REVOKED — so that column stays NULL and its
rule is never overloaded. The authoritative binding is RELATIONAL, not
JSON-only: (a) one shared `correlation_id` on the successor row, the
predecessor's REVOKED event and the successor's CREATED event (append-only,
FORCE-RLS tables); (b) the recovery idempotency key stored on BOTH rows —
`revocation_idempotency_key` on the predecessor, `idempotency_key` (unique)
on the successor. The migration and WS11-N16 both assert that NO
`recover%`-named column exists, making the design choice durable. Event
`detail` carries the same ids as safe non-authoritative convenience copies.
One-successor-per-predecessor is enforced by the state machine: the
predecessor can leave ISSUED exactly once (guarded update under the row
lock), and a revoked predecessor answers `RECOVERY_ALREADY_COMPLETED`.

### Idempotency

- First success: one revocation, one fresh code, one REVOKED + one CREATED
  event, raw code once.
- Identical replay (same assignment + original key + reason + actor):
  `ALREADY_RECOVERED`, names both rows, no raw code, no event, no row, no
  timestamp change, no reason overwrite (row-count proven).
- Conflicting replay (same recovery key, different immutable input):
  `KLUY-PROVCODE-CONFLICTING-REPLAY`, nothing created.
- Different recovery key after success: `RECOVERY_ALREADY_COMPLETED`,
  successor stands ISSUED, never revoked, no third code.
- Original key after recovery: the 0168 issuance-door reconciliation answers
  the OLD row (`state='revoked'`, `recovery_required=false`, no raw code,
  no fabricated replacement lineage). The recovery key through the issuance
  door answers the NEW row (`ALREADY_ISSUED`, `state='issued'`, no raw code).

### Events

Exactly one REVOKED event on the old row (reason_code `LOST_CODE_RECOVERY`,
actor, authoritative time, recovery correlation, reason in detail — no raw
code, no digest) and one CREATED event on the new row (same correlation,
`recovers_provisioning_code_id` convenience copy in detail). No new event
TYPE was added (asserted: the 0162 event vocabulary has no RECOVERED type).
Replays and refusals append nothing.

## 6. Concurrency evidence (genuinely separate backends, shared start barrier)

- **Race A — identical calls** (same assignment/original key/recovery
  key/reason): backend PIDs **404 vs 405** (focused run) and **856 vs 857**
  (full-suite run). One `RECOVERED` with the raw code, one
  `ALREADY_RECOVERED` with none; old row REVOKED once; exactly one successor;
  one REVOKED + one CREATED event; **no uncontrolled SQLSTATE**.
- **Race B — different recovery keys** against one outstanding code: PIDs
  **405 vs 404** / **857 vs 856**. One winner `RECOVERED`; loser gets stable
  `RECOVERY_ALREADY_COMPLETED` naming the standing successor; no third code;
  no unique/check/FK escape.
- Broader cross-operation recovery races (vs expiration, presentation, Hub
  withdrawal, redemption) were **deliberately not run** — P02B2B2B2B scope.

## 7. Security / privacy evidence

- Cross-scope: an original key belonging to another assignment answers
  `CONFLICTING-REQUEST` only to an actor holding BOTH permissions for that
  row's own scope; a wrong-environment actor gets the safe
  `PERMISSION-DENIED` (no existence disclosure). Unauthenticated, no-grant,
  issue-only, revoke-only, wrong-environment: all refused with zero residue.
- Direct access: anon EXECUTE on the door → 42501; authenticated EXECUTE on
  both coarse bridges → 42501; authenticated SELECT on the codes table →
  42501; authenticated INSERT on the events table → 42501 (each probe in its
  own transaction — proven 42501, never 25P02).
- Raw-code census: every raw code the fixture ever received (issuance and
  recovery) matched against all event rows and reason codes — zero hits; the
  sha256(raw)=stored-digest equality proves the raw value is derivable
  nowhere else; no code-shaped column exists on either table (asserted in
  migration, WS11-N16 and the suite).
- Grant/membership census after the run: 0 borrowed memberships on postgres,
  0 login-capable members of the governor, 0 test-clock policy rows, 0
  suite-created temporary grants (3 rows remain that belong to the db:test
  assertion fixtures, sections 50–51 — pre-existing, not this package's).
- Production-grant posture: none added; service_role and worker denied and
  asserted; P02C untouched.

## 8. Verification (all commands under Node v22.23.0, pnpm 9.15.9; cloud and Hub work serialized; fresh reset before the canonical run)

| Command | Exit | Result | DB / role | State |
| --- | --- | --- | --- | --- |
| `node --version` / `pnpm --version` / `pnpm config get engine-strict` | 0 | v22.23.0 / 9.15.9 / true | — | — |
| `pnpm migrations:validate` | 0 | 68 files PASS | — | static |
| `pnpm db:reset` (0000→**0169**) | 0 | 68 applied; 0169 guard NOTICE emitted | local cloud, postgres | fresh |
| `pnpm db:seed` ×2 | 0 / 0 | second run inserts 0 rows (idempotent) | local cloud | fresh |
| `pnpm db:test` (single fresh run) | 0 | **218 PASS, 0 FAIL** (baseline 215 + 3 WS11-N16) | local cloud | fresh |
| `pnpm test:rls` | 0 | **120 PASS, 0 FAIL** (baseline 117 + 3 WS11-N16) | local cloud | fresh |
| recovery suite (vitest, one file) | 0 | **12/12 PASS, zero skips** (races A/B PIDs above) | local cloud, authenticated via door | fresh |
| registry full suite (`pnpm vitest run`, serial files) | 0 | **269/269 PASS, 24 files, zero skips** (baseline 257 + 12; lifecycle 30/30; residue census 14/14; capability census 9/9) | local cloud + Hub | fresh |
| `pnpm db:validate` | 0 | 68 files PASS | — | static |
| `pnpm secret:scan` | 0 | 1285 tracked files, no findings | — | static |
| `pnpm clock:check` | 0 | PASS — no prohibited clock access; 4/4 consumers | — | static |
| `pnpm hub:db:reset` + `hub:db:seed` + `hub:db:test` | 0 | 31 migrations (0000–0030), **35 PASS** (cloud reset removes `kitluy_hub_local`; rebuilt before the suites that need it) | local Hub | fresh |
| `pnpm verify` | 1 | **11 of 12 steps PASS** — lint, typecheck, unit, contract, offline, build, OpenAPI, migrations, secret, clock, docs all PASS; `format:check` FAILS on **830 pre-existing files** (the recorded CRLF/imported-docs artifact — proven identical at clean HEAD `895cdfe` by stashing this package's work and re-running; none of this package's files are flagged) | — | fresh |

Baseline comparison — **no regression**: db:test 215→218, test:rls 117→120,
registry 257/257→269/269 (23→24 files), Hub db:test 35→35, lifecycle 30→30,
residue census 14→14. Required new tests: zero skips.

Sequence note (repository evidence over prompt): the §22 ordering places the
focused suites before `db:test`, but the repository's harness plants the
`WS11-T001-HUB-PROBE` hardware profile and Hub fixtures INSIDE the db:test
assertion run, and `db:test` is single-shot per reset (its own residue
assertions fire on a re-run). The canonical order used here — reset → seed ×2
→ db:test → test:rls → focused suite → Hub rebuild → full registry suite —
is the order every prior P02B package used.

## 9. Unresolved risks (recorded for successors)

1. **ALREADY-REDEEMED refusal is not integration-proven**: the redeemed state
   is structurally unreachable until P02B3 builds redemption (no door creates
   it; direct mutation is denied to every identity — itself the intended
   posture). The refusal shares the exact state-guard branch proven for
   LOCKED/EXPIRED/REVOKED. The 0165 revocation package recorded the same
   evidence position.
2. **Cross-assignment same-recovery-key insert race**: two concurrent
   recoveries on DIFFERENT assignments reusing one recovery key serialize on
   nothing before the successor INSERT; the loser would surface the unique
   violation (23505) — atomically rolled back, old code untouched, but an
   uncontrolled SQLSTATE. Same-assignment races (the required core) are
   controlled. P02B2B2B2B scope.
3. **Package-ID collision** with the replacement-race-hardening handoff
   (§1) — owner renumbering recommended.
4. The shared fixture scope carries multiple Hub projections; the Hub
   derivation (`order by projected_at, device_id limit 1`) binds new codes to
   the OLDEST projection — identical to the 0163/0167 doors, so old and new
   codes stay consistent, but a multi-Hub scope remains a modeled-single-Hub
   assumption inherited from P02B1.

## 10. Rollback

`git revert <package commit>` (single atomic commit), then `pnpm db:reset`
(rebuilds 0000→0168) and `pnpm hub:db:reset` + `hub:db:seed`. The migration
is purely additive — no data migration, no changed earlier object — so no
compensating migration is needed in dev.

## 11. Next package

- Broader recovery race hardening: **not started**. No expiration worker, no
  redemption/PoP, no pairing, no HTTP routes, no Hub runtime change, no UI,
  no production grants. P02B3 and P02C: **not started**. WS-11-T004: **not
  complete**.
- Recommended next: **WS-11-T004-P02B2B2B2B — recovery race and replay
  hardening** (cross-operation races vs expiration/presentation/Hub
  withdrawal; the §9.2 cross-assignment key race; ambiguous recovery-response
  recovery).
