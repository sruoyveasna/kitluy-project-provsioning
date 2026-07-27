# KitLuy Independent Review Record

## 0. Review identity

| Field            | Value                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task ID          | KL-DEC-001-T001..T006 (Cycle 7 Stage A — contract vocabulary and Edge API alignment)                                                                                                                                                                                                                                                                                                                                                           |
| Task title       | Record owner approval of KLD-2026-07-26-002 and align Edge routes/scopes, terminal profiles, RBAC, resource scopes, event contracts and API error identifiers to it                                                                                                                                                                                                                                                                            |
| Reviewer         | Independent review subagent (Cycle 7) — did NOT author any reviewed commit                                                                                                                                                                                                                                                                                                                                                                     |
| Review role      | independent review agent                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Reviewed commits | `463b50a` (governance), `a97a380` (errors), `83c86aa` (events), `0508cbb` (authz), `191edc6` (terminal profiles + migration 0100), `350aace` (edge route registry)                                                                                                                                                                                                                                                                             |
| Base commit      | `db0b07e` (main, end of Cycle 6)                                                                                                                                                                                                                                                                                                                                                                                                               |
| HEAD at review   | `350aace6715cc4530149f5ab7579eeae21794144`, clean tree                                                                                                                                                                                                                                                                                                                                                                                         |
| Branch/worktree  | `main`, `C:\dev\HET-KITLUY-PROJECT` (Windows Git Bash); local Supabase stack `kitluy-local` UP                                                                                                                                                                                                                                                                                                                                                 |
| Review date      | 2026-07-27                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Decision         | **APPROVED-WITH-CONDITIONS** — every gate re-executed by the reviewer PASSED (`verify` 11/11, `docs:verify` 8/8, `db:test` 121, `test:rls` 95, `db:types` empty diff, tree clean). All ten §15 propositions hold under the reviewer's own probes. No blocking finding. Three advisory findings (RV-001, RV-002, RV-003) and two observations carried forward; conditions in §9 are documentation/backlog items, none of which gate this merge. |

Content binding (re-review required if any of these change):

- `supabase/migrations/20260727120100_0100_terminal_profile_identifiers.sql` sha256 `3068d2878ad41f1bb38a5ea154e810c165042e40ec363de3d2a841bb9d2fff1f`
- `packages/edge-contracts/src/registry.ts` sha256 `8642a1b18928fbed74acc04793f826878075d0031be7411e85ec8d88d9bda4e9`
- `packages/api-errors/src/index.ts` sha256 `956d392c70f4d6a27b9f11a70af074a06620b6503cbe3e4c6a3471c116047d18`
- `packages/event-contracts/src/index.ts` sha256 `8dabdd03f41f407c3c9900d19f1ae1514fd33f4a442484b78f34a914dd5ccb3c`
- `packages/rbac/src/index.ts` sha256 `945739e42011e93aff9cf6f8398e9d6cbd317977504f34132e8a4a208a852d01`
- `packages/resource-scope/src/index.ts` sha256 `6e696b7942e714b17aeced5ccaa949fb4efe34b0b6489a280384feaf039ea798`
- `verticals/phase1-laundry/src/terminal-profiles.ts` sha256 `e44067147629b6c63a7a3979c555c99b617235ec4776780e163cd3c36ae245c4`
- `services/kitluy-hub-agent/src/lan-api.ts` sha256 `d8cbd8c7780630d0f3e023d5a3b55852b7c1eddff75bfc27788d742f283829a1`
- `docs/decisions/kitluy-contract-vocabulary-and-edge-api-owner-decision-v1.0.0.md` sha256 `5a2eeff81cbf2e317a3f84f544af831cf4d03edd856797ba1f2be83195ad1f08`

## 1. Independence check

The reviewer authored none of the six reviewed commits and wrote no source,
test, migration or governance file in this cycle. The single file written by
this review is this record.

Nothing was accepted on the authors' assertion. Every command in §6.1 was
re-executed by the reviewer and its ACTUAL exit status recorded. Every §15
proposition was tested with probes the reviewer designed and ran independently
(§6.3), built from the decision document rather than from the authors' test
expectations; the authors' suites were read afterwards only to check whether
they were weaker than the reviewer's, not to source the expectations. Where the
reviewer's probe disagreed with the implementation, the disagreement was chased
to its root cause before being classified (RV-001, and two probe false
positives explicitly recorded in §6.3 so the record is not overstated).

Route counts, permission-registry counts and segment-count claims were derived
by the reviewer from the primary artifacts (the decision markdown and the
canonical CSV), not copied from the authors' constants.

## 2. Materials reviewed

- `docs/decisions/kitluy-contract-vocabulary-and-edge-api-owner-decision-v1.0.0.md` (all five groups, read in full)
- `00_AI_HANDOFF/tasks/KL-DEC-001.md` and `KL-DEC-001-T001..T006.md` (acceptance criteria and prohibited scope)
- `docs/source/processed/reconciliation/kitluy-contract-vocabulary-owner-review-v1.0.0.md` (ballot)
- `docs/authority/kitluy-decision-and-reconciliation-register-v1.0.0.md` (C14–C25, KLREC-001/-002/-009..-013)
- `docs/authority/kitluy-open-decisions-and-required-values-v1.0.0.md` (KLREQ-015..019)
- `00_AI_HANDOFF/000_BLOCKERS.md` (BLK-003 state)
- `docs/source/security/kitluy-suite-rbac-permission-registry-v1.0.0.csv` (107-key baseline, parsed directly)
- Full source of `packages/edge-contracts`, `packages/api-errors`, `packages/event-contracts`, `packages/rbac`, `packages/resource-scope`, `verticals/phase1-laundry/src/terminal-profiles.ts`, `services/kitluy-hub-agent/src/lan-api.ts`
- `supabase/migrations/20260727120100_0100_terminal_profile_identifiers.sql` and the superseded group-0080 constraints
- `git diff db0b07e..350aace` (92 files, +5486/−842)
- Model template: `00_AI_HANDOFF/reviews/2026-07-27__WS-07-08-EXECUTION__REVIEW.md`

## 3. Scope and file ownership

The 92 changed files were checked against the six task records' `Files owned`
declarations. No out-of-scope file was modified.

| Change group                                                                                                                                                                 | Owning task | In declared scope?                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Decision doc, ballot, `000_*` state files, three `docs/authority/` registers                                                                                                 | T001        | Yes — verbatim in T001 `Files owned`                                                                                                          |
| New `packages/edge-contracts/**`; `services/kitluy-hub-agent/src/lan-api.ts`                                                                                                 | T002        | Yes; lan-api change is route constants + comments only (verified by diff)                                                                     |
| `verticals/phase1-laundry/src/terminal-profiles.ts`, `packages/rbac`, `packages/resource-scope`, migration 0100, seeds, SQL tests, `apps/kitluy-pos-desktop-app/src/App.tsx` | T003        | Yes — T003 owns "every exact repository reference to the four retired logical identifiers (TS, tests, docs, fixtures, SQL migrations, seeds)" |
| `packages/event-contracts/**`                                                                                                                                                | T004        | Yes                                                                                                                                           |
| `packages/api-errors/**` + ~25 `services/*/src/http.ts` `NOT_FOUND` → `RESOURCE_NOT_FOUND`                                                                                   | T005        | Yes — T005 owns "consumers referencing retired generic codes"                                                                                 |
| Test files across aligned packages; `docs/evidence/phase1/kl-dec-001/`                                                                                                       | T006        | Yes                                                                                                                                           |

Prohibited-scope checks, each verified rather than assumed:

- **No mutation route activated.** Reviewer searched the whole repository for an
  Edge mutation handler and found none; the Hub still serves only three reads
  (§6.3 P9). This is the single most important prohibition and it holds.
- **No duplicate route literals.** `services/kitluy-hub-agent/src/lan-api.ts`
  declares no `/edge/v1` literal of its own; all three come from
  `@kitluy/edge-contracts`.
- **Physical device profiles NOT renamed.** `laundry_front_counter`,
  `laundry_ready_pickup`, `laundry_t3_dedicated`, `laundry_t4_dedicated` remain
  unchanged in `HARDWARE_PROFILES` and are explicitly excluded by migration 0100's
  header.
- **`t2_scan_in` / `t3_scan_out` not reused.** Confirmed by literal sweep (§6.3)
  and by DB probe A3.
- **No runtime alias layer.** `RETIRED_ERROR_CODES`, `RETIRED_PERMISSION_KEYS`,
  `RETIRED_SCOPE_LEVELS` and `PRE_RENAME_TERMINAL_IDENTIFIERS` are all
  documentation/test data; none is consulted by any lookup (verified by probe —
  every retired identifier fails closed at runtime).
- **Applied migration not edited in place.** Group 0080 still carries the
  pre-rename spellings; 0100 is a forward-only paired migration.
- **No owner value guessed.** See §5.

## 4. Acceptance criteria vs the six task records

| Task | Acceptance criterion (abridged)                                                                                                    | Reviewer verdict                                                                                                                                                             |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T001 | Decision Status = OWNER-APPROVED, date 2026-07-27, all five group verdicts                                                         | MET — Status line 9, date line 7, Groups 1–3 APPROVED, 4 APPROVED WITH CORRECTION, 5 APPROVED WITH ADDITIONS                                                                 |
| T001 | Ballot records G1–3 APPROVED, G4 APPROVED WITH REGEX CORRECTION, G5 APPROVED WITH ADDITIVE CODES AND PAYMENT_PENDING CLARIFICATION | MET — ballot verdict table matches the required wording exactly                                                                                                              |
| T001 | Registers updated; `docs:verify` 8/8                                                                                               | MET — reviewer re-ran `docs:verify`: 8/8 PASS                                                                                                                                |
| T001 | Only the seven authorized conflicts move; no BLK-003 closure at this task                                                          | MET — exactly KLREC-001/-009/-010/-011/-013 RESOLVED, -002 and -012 PARTIALLY RESOLVED with the schema-naming portion explicitly left OPEN to WS-09-T001. BLK-003 NOT closed |
| T002 | Every approved route resolves to exactly one canonical constant                                                                    | MET — reviewer parsed 22 routes from the decision doc and matched them set-for-set against `EDGE_ROUTES` (§6.3 P1)                                                           |
| T002 | No rejected route shape in any executable registry                                                                                 | MET — including a scan of 136 built `.js` files (§6.3 P2)                                                                                                                    |
| T002 | Every mutation declares API scope, permission, idempotency, expected-version where applicable; scope ↔ permission separate         | MET — 21/21 mutations (§6.3 P3, P4)                                                                                                                                          |
| T002 | NO activation of mutation handlers; no fabricated success; no placeholder handlers                                                 | MET — 297 verb×path combinations probed, all non-GET return 405 (§6.3 P9)                                                                                                    |
| T003 | Four canonical profiles valid; retired identifiers invalid; physical profiles distinct; T3≠T4 separation; unknown keys fail closed | MET — TypeScript probes and DB probe A3 (§6.3 P5, P8, ADV)                                                                                                                   |
| T003 | Approved RBAC mappings applied; additive scope types present                                                                       | MET — all three mappings and all four additive scope types verified (§6.3 ADV7, ADV9, ADV10)                                                                                 |
| T004 | Validator accepts canonical grammar, rejects `.v1`, leading digits, uppercase, three-segment; snake_case envelope                  | MET with one recorded limitation inherited from the owner-approved regex — see RV-001                                                                                        |
| T005 | Canonical names/statuses/retryability/message keys; four codes added; rejected codes absent; `PAYMENT_PENDING` non-terminal        | MET — all four additive codes carry the approved semantics; `PAYMENT_PENDING` proven non-terminal five ways (§6.3 P7)                                                        |
| T006 | Ten §15 propositions hold executably; Cycle-6 suites green; explicit independent verdict                                           | MET — §6.2 proposition table; 121/95 DB suites and all engine suites green; this record is the explicit verdict                                                              |
| T006 | BLK-003 closure record links decision, ballot, commits, tests, review, evidence                                                    | NOT YET — correctly so: BLK-003 remains APPROVED-PENDING-IMPLEMENTATION. See §9 and the closing statement                                                                    |

## 5. Technical review checklist

| #   | Check                                       | Result                                                                                                                                                                                                                                |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Authorization never weakened                | PASS — every change tightens. `scopeBreadth` now throws instead of returning `-1` (which sorted as broader than `platform`); permission grammar rejects 1-segment and 4+-segment keys; `hasPermission` re-validates each stored grant |
| 2   | Fail-closed on unknown input                | PASS — probed all four dimensions (permission, scope level, terminal profile, error code); every unknown/retired value is refused                                                                                                     |
| 3   | No invented owner value                     | PASS — zero deposit percentages, thresholds or provider values introduced. 25 `[REQUIRED:]` markers added, 2 removed (both benign table reformats; BLK-005 still carries its marker)                                                  |
| 4   | Conflicts recorded, not silently resolved   | PASS — C14–C25 all real; three numeric claims independently recomputed (§6.3)                                                                                                                                                         |
| 5   | Append-only semantics preserved             | PASS — migration 0100's trigger carve-out is bounded to one transaction, self-verifies the re-arm, and the reviewer confirmed rejection of an ordinary UPDATE afterwards (§6.3 PROBE-C/A2)                                            |
| 6   | Neutral Core / vertical boundary            | RECORDED CONFLICT, not a defect — `/edge/v1/laundry/*` in `packages/` is mandated by approved Group 1; quarantined as inert contract data with no runtime dependency on the vertical (C25/KLREQ-019)                                  |
| 7   | No floating-point money; no secrets         | PASS — no money handling touched; `secret:scan` passed over 948 tracked files                                                                                                                                                         |
| 8   | Source citations for spec-derived rules     | PASS — every registry entry, constraint and carve-out cites its authority (Group N, §-reference, or KLREC/KLREQ id)                                                                                                                   |
| 9   | Production migration safety (KL-INF-P1-037) | PASS — 0100 is marked LOCAL execution only; nothing auto-applies                                                                                                                                                                      |
| 10  | Status honesty                              | PASS — package headers state contract alignment only; the Hub file states plainly that contract approval is not implementation authorization                                                                                          |

## 6. Reviewer validation

### 6.1 Re-executed commands (ACTUAL results, LOCAL stack)

| #   | Command                               | ACTUAL result                                                                                                                                                  | Verdict |
| --- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | `pnpm format:check`                   | "All matched files use Prettier code style!", exit 0                                                                                                           | PASS    |
| 2   | `pnpm lint`                           | exit 0 — 0 errors, 2 warnings (unused eslint-disable in `payments-persistence` / `phase1-laundry-persistence`, both PRE-EXISTING from Cycle 6, untouched here) | PASS    |
| 3   | `TURBO_FORCE=true pnpm typecheck`     | 87 successful, 87 total; 0 cached; exit 0                                                                                                                      | PASS    |
| 4   | `TURBO_FORCE=true pnpm test`          | 58 successful, 58 total; 0 cached; exit 0                                                                                                                      | PASS    |
| 5   | `TURBO_FORCE=true pnpm test:contract` | 20 successful, 20 total; 0 cached; exit 0                                                                                                                      | PASS    |
| 6   | `pnpm db:validate`                    | all static checks passed (17 migration files), incl. group-0100 marker/order/quotes/destructive-guard; exit 0                                                  | PASS    |
| 7   | `pnpm db:reset`                       | 17 migrations applied incl. 0100, which emitted its own NOTICE confirming 3 CHECK constraints re-created and trigger re-armed; exit 0                          | PASS    |
| 8   | `pnpm db:seed` (1st)                  | rows inserted; `PASS fixture finance posting: replayed=false`; exit 0                                                                                          | PASS    |
| 9   | `pnpm db:seed` (2nd)                  | every INSERT `0 0`; `replayed=true`; exit 0                                                                                                                    | PASS    |
| 10  | `pnpm db:seed` (3rd, full scan)       | 80 INSERT statements, **zero** with a non-zero row count; no UPDATE/DELETE rows; exit 0                                                                        | PASS    |
| 11  | `pnpm db:test`                        | **121** `NOTICE: PASS` assertions, 0 FAIL/ERROR; exit 0 — matches expected 121                                                                                 | PASS    |
| 12  | `pnpm test:rls`                       | **95** `NOTICE: PASS` assertions, 0 FAIL/ERROR; exit 0 — matches expected 95                                                                                   | PASS    |
| 13  | `pnpm db:types`                       | regenerated; `git diff --stat` and `git status --short` both **empty** — no drift                                                                              | PASS    |
| 14  | `pnpm docs:inbox-state`               | "inbox is empty — no un-ingested sources"; exit 0                                                                                                              | PASS    |
| 15  | `pnpm docs:verify`                    | **8/8 PASS**; exit 0                                                                                                                                           | PASS    |
| 16  | `TURBO_FORCE=true pnpm verify`        | **11/11 PASS** (format, lint, typecheck, unit, contract, offline harness, build, OpenAPI, migration validation, secret scan 948 files, docs links); exit 0     | PASS    |
| 17  | `git diff --check`                    | no output; exit 0                                                                                                                                              | PASS    |
| 18  | `git status --short`                  | empty — tree clean at `350aace`                                                                                                                                | PASS    |

Targeted package suites (all re-executed by the reviewer):

| Package                                        | ACTUAL                    | Verdict |
| ---------------------------------------------- | ------------------------- | ------- |
| `@kitluy/api-errors`                           | 18 tests passed           | PASS    |
| `@kitluy/event-contracts`                      | 59 tests passed           | PASS    |
| `@kitluy/rbac`                                 | 15 tests passed           | PASS    |
| `@kitluy/resource-scope`                       | 6 tests passed            | PASS    |
| `@kitluy/edge-contracts`                       | 45 tests passed           | PASS    |
| `@kitluy-verticals/phase1-laundry`             | 76 tests passed (3 files) | PASS    |
| `@kitluy-verticals/phase1-laundry-persistence` | 11 tests passed           | PASS    |
| `@kitluy-services/kitluy-hub-agent`            | 9 tests passed (2 files)  | PASS    |

No gate failed. Nothing in this table is reported from the authors' handoff.

### 6.2 The ten §15 propositions — independent verdicts

| #   | Proposition                                                                                            | Reviewer verdict and evidence                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Every approved route resolves to exactly one canonical constant                                        | HOLDS — reviewer parsed the Group 1 fenced block from the decision markdown, counted **22**, and matched the sorted set against `EDGE_ROUTES` (22 entries, 9 generic + 13 laundry, no duplicate key or id)                            |
| 2   | No rejected route shape in any executable registry                                                     | HOLDS — 26 rejected shapes, none an approved path, none resolvable via `findEdgeRoute` under any verb; 136 built `.js` files scanned for 8 fork segments with no route declaration found                                              |
| 3   | Every mutation route maps to an API scope                                                              | HOLDS — 21/21 mutations carry a scope in `EDGE_API_SCOPES` with a correct `registered`/`additive` status; all 21 require idempotency                                                                                                  |
| 4   | Every API scope maps to a permission requirement, or fails closed with an explicit `[REQUIRED]` marker | HOLDS — 13 routes carry a key verbatim in the 107-key CSV; **9** carry an explicit `[REQUIRED: …]` marker. **Zero fabricated keys.** A marker can never authorize (probed)                                                            |
| 5   | Terminal-profile restrictions explicit; T2 never on a staff mutation                                   | HOLDS — every route has a non-empty allow-list drawn only from the four canonical ids; T2 absent from all staff mutations (`kind=mutation` ∧ `credentialClass=device_and_staff`); T3∉pickup, T4∉ready                                 |
| 6   | Event names follow the grammar; validator rejects the bad forms                                        | HOLDS WITH ONE RECORDED LIMITATION — rejects 3-segment `.v1`, leading digits, uppercase, 1-segment, 3-segment, hyphen, whitespace, empty. Accepts the degenerate 2-segment `x.v1` because the owner-approved regex admits it (RV-001) |
| 7   | Error codes match the canonical registry; retired names unknown at runtime                             | HOLDS — all 12 retired identifiers return `false` from `isKnownErrorCode` while remaining documented; no `EDGE_*` code registered; generic `CONFLICT` absent                                                                          |
| 8   | Unknown permissions, scopes, profiles and errors FAIL CLOSED                                           | HOLDS — all four dimensions probed independently; notably `scopeBreadth` throws rather than returning `-1`, so an unknown level can no longer outrank `platform`                                                                      |
| 9   | No mutation route reports success without an authoritative commit                                      | HOLDS — 11 verbs × 27 paths = 297 combinations; every non-GET returns **405** with a real error envelope; GET on a mutation route 404s; exactly the 3 infrastructure reads return 200; no handler exists anywhere                     |
| 10  | All Cycle-6 suites remain green                                                                        | HOLDS — `db:test` 121, `test:rls` 95, all engine suites green, `verify` 11/11                                                                                                                                                         |

### 6.3 Adversarial probes designed and executed by the reviewer

TypeScript/runtime probes were run against the **built `dist/` output**, not
`src/`, so what ships is what was tested. 63 assertions in probe 1, 8 in probe 2.

**Retired-identifier resolution (all must fail closed):**

- Retired error codes (`UNAUTHENTICATED`, `PERMISSION_DENIED`, `ACTOR_PERMISSION_DENIED`, `NOT_FOUND`, `BOOKING_VERSION_CONFLICT`, `IDEMPOTENCY_KEY_REUSED`, `DUPLICATE_IDEMPOTENCY_KEY`, `SERVICE_UNAVAILABLE`, `PAYMENT_PROVIDER_UNAVAILABLE`, `STALE_DATA`, `CONFLICT`, `INTERNAL`) — **all 12 unknown at runtime**; the retired map is documentation-only and is not consulted by any lookup.
- Retired permission keys (`releases.promote.stable`, `infrastructure.backup.restore`, `security.certificates.rotate`) plus `*`, `admin`, `laundry.*`, uppercase and empty — **all rejected**, and `assertCanonicalPermissionKey` throws for each.
- Retired scope levels (`tenant_or_partner`, `individual_device`) plus unknown/uppercase/empty — **all rejected**.
- Pre-rename and retired terminal profiles (`t1_intake_cashier`, `t2_customer_display`, `t3_ready_scan_in`, `t4_pickup_scan_out`, `t2_scan_in`, `t3_scan_out`), physical profile codes and uppercase forms — **all rejected** by `isLaundryTerminalProfile`.
- `.v1` event names — 3-segment forms rejected; see RV-001 for the 2-segment edge case.

**`scopeBreadth` / `sameScope` fail-open attempts:**

- `scopeBreadth('nonsense')` **throws** `UnknownScopeLevelError` rather than returning `-1`. The reviewer specifically tested whether an unknown level can compare as broader than `platform`: it cannot, because no value is returned at all. This is a genuine hardening over the prior `-1` behavior, which would have silently outranked every real scope.
- `sameScope` returns **false** for two _identical_ unknown levels (`tenant_or_partner`↔`tenant_or_partner`, `nonsense`↔`nonsense`), so a value smuggled past the type system from JSON cannot match itself. Positive control confirmed `tenant`↔`tenant` still matches, and environment mismatch still denies.

**Forged-grant attempts against `hasPermission`:**

- Grant row carrying a retired key, asked with that retired key → **denied**.
- Forged wildcard grant `*`, asked as `*` and asked for a real key → **denied both ways**.
- Grant row carrying a bogus key while the _requested_ key is canonical → **denied** (each stored grant is re-validated, not just the request).
- Grant row carrying an unknown _scope level_ with an otherwise canonical key → **denied**.
- Positive control: exact canonical key at the exact scope → granted; same key at a different `resourceId` → denied.
- `[REQUIRED: …]` markers: not canonical, do not pass the grammar, and cannot self-authorize.

**`PAYMENT_PENDING` cannot be read as paid:** HTTP 202; `isTerminal` false; `isPendingOutcome` true; `assertNotPaid` throws `PaymentNotAuthoritativeError`; `isAuthoritativePaymentSuccess` returns the literal type `false`, so no caller can narrow a registry outcome into a paid state. The reviewer swept **every exported function** with `PAYMENT_PENDING`: the only ones returning `true` are `isKnownErrorCode`, `isRetryable` and `isPendingOutcome`, none of which means "paid". `PAYMENT_PENDING` is the only non-terminal code in the registry.

**Migration 0100 against an already-seeded database** (the scenario a fresh
`db reset` structurally cannot exercise). All inside one rolled-back transaction
on the local stack:

- The reviewer reconstructed a genuine pre-0100 database: dropped the canonical constraints, rewrote the seeded custody rows back to the old spellings, and restored the original group-0080 CHECK constraints verbatim. Setup confirmed **2 rows carrying old `terminal_role` values**.
- **PROBE-B (naive order):** with the old constraints still present, the UPDATE-first order **failed** with `violates check constraint "garment_scan_events_t3_only_check"`. The author's stated fault is **real**, not hypothetical.
- **PROBE-A (shipped order):** drop → update → re-add migrated that same already-seeded database **cleanly**: 0 stale rows, trigger re-armed, 3 CHECK constraints present. The fix is genuine.
- **PROBE-C / A2 (append-only re-arm):** an ordinary `UPDATE` on `garment_scan_events` is rejected with `KLUY-AUTH-APPEND-ONLY: UPDATE rejected …` both after the real migration and after the replayed one; `pg_trigger.tgenabled = 'O'`.
- **PROBE-A3:** all six retired/pre-rename/T2 `terminal_role` values are **rejected on INSERT** by the re-created constraints — including `laundry.t2.customer_display`, correctly absent from the storable set because T2 owns no custody vocabulary.
- The transaction was rolled back; the reviewer re-verified the database returned to canonical values, `tgenabled='O'` and 3 constraints.

**Repository-wide literal sweep** for the four pre-rename identifiers and the two
retired three-terminal identifiers across `.ts/.tsx/.js/.mjs/.cjs/.sql/.json`.
Every surviving occurrence is one of: the intentional `PRE_RENAME_TERMINAL_IDENTIFIERS`
/ `RETIRED_TERMINAL_IDENTIFIERS` rejection lists, a negative test assertion, a
doc comment, the committed group-0080 migration (correctly not edited in place),
or the `where terminal_role = '<old>'` predicates in migration 0100 that perform
the rename. **No executable code path accepts an old identifier.**

**Governance-claim recomputation** (the reviewer recomputed each numeric claim
from primary sources rather than trusting the register):

- C19 "60 of 107 keys have two segments": parsed the canonical CSV — 107 total, **60 two-segment, 47 three-segment**. CONFIRMED, including that all three release keys the decision itself names canonical are two-segment.
- C22 "nine routes have no registry permission": **exactly 9** (`sessions-open/refresh/switch/close`, `display-sessions-open/update/read/customer-actions/close`). CONFIRMED.
- C24 "17 proposed, 5 registered audit events": **17 / 5**. CONFIRMED.
- C17 "`PRINT_FAILED` 502 in code vs 503 in registry": base commit had 502, now 503. CONFIRMED.
- C21 "`store_edge` missing from `KITLUY_ENVIRONMENTS`": confirmed absent; correctly recorded and NOT fixed, since `packages/shared-types` is outside this task's allowed paths.
- C16 "LAN API spec still specifies `EDGE_*`": 22 occurrences remain in the spec; documentation amendment correctly recorded as owed.

**Two probe false positives, recorded for honesty:** (a) the reviewer's built-output
scan flagged `/receipt-choice` in `dist/scopes.js`; inspection showed it inside a
prose `note` field that explicitly labels that shape REJECTED — inert data, not a
route declaration. (b) A probe asserted that no exported function returns `true`
for `PAYMENT_PENDING`; `isKnownErrorCode` correctly does, since it _is_ a known
code. Neither is a defect; both are reviewer probe over-strictness.

## 7. Findings

| ID     | Severity    | Blocking | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Status                               |
| ------ | ----------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| RV-001 | ADVISORY    | **No**   | The owner-approved event-name regex `^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$` accepts a degenerate two-segment name whose second segment is a bare version token (`digital_store_created.v1`, `payment.v2`), because such a name is structurally identical to a valid `<context>.<fact>` pair. The reviewer found this independently before reading the authors' tests. **This is a defect in the owner's approved regex, not in the implementation**: `EVENT_NAME_PATTERN.source` is asserted byte-for-byte equal to the approved pattern, and the authors recorded the limitation as conflict C18 plus a documenting test rather than silently tightening an owner-approved artifact — which is the behavior CLAUDE.md hard rule 8 requires. No event name in the repository uses that shape; registry membership is the effective gate. | OPEN — owner amendment recommended   |
| RV-002 | ADVISORY    | **No**   | `services/kitluy-hub-agent/src/lan-api.ts` returns transport status **405** carrying error code `VALIDATION_FAILED`, whose canonical registry row is HTTP 422 / `retryable: false` / "the request must change before it can succeed". For an unimplemented-route condition that client guidance is misleading — the request is well-formed; the route simply does not exist yet. **Pre-existing, not introduced by this cycle** (the base commit already used `VALIDATION_FAILED`; only the message string changed). No canonical `NOT_IMPLEMENTED` / `ROUTE_NOT_AVAILABLE` code exists in the registry, so the authors had no better registered option. The fail-closed behavior itself is correct and was verified across 297 verb×path combinations.                                                                               | OPEN — registry addition recommended |
| RV-003 | ADVISORY    | **No**   | 9 of the 22 approved routes (41% of the Edge surface — all generic session and display-session routes) carry `[REQUIRED: …]` permission markers and therefore cannot be authorized at all until the owner registers those keys under `rbac.permission_registry_manage`. This is the **correct** fail-closed outcome and is properly escalated as C22/KLREQ-015; it is recorded here because it is a hard gating dependency for WS-12..15, not because it is a defect.                                                                                                                                                                                                                                                                                                                                                                 | OPEN — tracked as KLREQ-015          |
| RV-004 | OBSERVATION | No       | 17 of 22 route audit-event names are `proposed`, absent from the Domain Event Registry (C24/KLREQ-016). They must be registered before any release publishes them. Correctly marked in the registry data.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | OPEN — tracked as KLREQ-016          |
| RV-005 | OBSERVATION | No       | `pnpm lint` emits 2 warnings for unused `eslint-disable` directives in `packages/payments-persistence/test/integration.test.ts` and `verticals/phase1-laundry-persistence/test/integration.test.ts`. **Pre-existing from Cycle 6**; neither file was touched by this cycle; lint exits 0.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | OPEN — cosmetic backlog              |

**No blocking findings.** Specifically, the reviewer found: no failing gate, no
weakened authorization or fail-closed behavior (every change tightened), no
invented owner value, no silently resolved conflict, and no activated mutation
route.

## 8. Decision rationale

The verdict is **APPROVED-WITH-CONDITIONS**.

Every gate the reviewer re-executed passed with the exact expected numbers —
121 database assertions, 95 RLS assertions, `verify` 11/11, `docs:verify` 8/8,
a byte-identical `db:types` regeneration, and a clean tree. Seed idempotency was
proven three times over, the third run confirming 80 INSERT statements changing
zero rows.

All ten §15 propositions hold under probes the reviewer designed from the
decision document rather than from the authors' expectations. The two most
security-relevant propositions were attacked hardest and held: **no mutation
route is activated anywhere** (297 verb×path combinations all fail closed with a
real error envelope, no handler exists in the repository, and even case-variant
verbs like `get` are refused), and **every unknown or retired identifier fails
closed across all four dimensions**. The `scopeBreadth` change from returning
`-1` to throwing is a material security improvement, because `-1` would have
sorted as broader than `platform` under any naive comparison.

The migration-0100 claim was the single item most deserving of scepticism,
because a fresh `db reset` runs it against an empty table and can never exercise
the ordering fault. The reviewer therefore reconstructed a genuine pre-rename
database holding old-value custody rows and tested both orders. The naive
UPDATE-first order genuinely fails; the shipped drop→update→re-add order
genuinely succeeds; and the append-only trigger is genuinely re-armed afterwards.
The claim is true and was earned, not asserted.

Governance honesty is the strongest aspect of this cycle. Twelve conflicts
(C14–C25) were recorded rather than resolved, and the reviewer independently
recomputed every numeric claim in them from primary sources — all confirmed.
Where the decision and the canonical registry genuinely contradict each other
(C19: the grammar says three segments, but 60 of the 107 canonical keys have
two), the authors implemented the permissive-but-tightened option, made registry
membership the authoritative gate, and escalated for an owner ruling instead of
quietly invalidating 56% of the baseline. Nine routes that had no registry
permission key were left failing closed with explicit `[REQUIRED:]` markers
rather than being given fabricated keys — this is exactly hard rule 9, and it was
the most tempting place in the whole cycle to invent a value. Only the seven
conflicts the decision authorized were moved, with the two partial ones correctly
scoped so the cloud-vs-Hub custody schema-naming portion stays open to WS-09-T001.

RV-001 deserves a note on why it is advisory rather than blocking. The reviewer
found the `.v1` blind spot independently and initially treated it as a candidate
defect. Root-causing it showed the implementation reproduces the owner-approved
regex byte-for-byte and that the gap lives in the owner's decision text. The
authors' response — record it as C18, add a documenting test, and rely on
registry membership — is precisely what hard rule 8 demands. Silently tightening
an owner-approved regex would have been the actual violation. The correct
remedy is an owner amendment, not a code change under this task.

Conditions attach only because the cycle leaves genuine documentation and
registration debt (RV-002 through RV-004), none of which affects the
correctness, safety or reversibility of what is being merged.

## 9. Merge conditions

None of the following blocks this merge; all are carried forward.

1. **BLK-003 stays open.** It remains `APPROVED-PENDING-IMPLEMENTATION` and must
   not be marked closed on the strength of this cycle alone — see the closing
   statement below for the reviewer's position on eligibility.
2. **RV-001** — recommend an owner amendment tightening the Group 4 grammar to
   reject a trailing `^v\d+$` segment, closing C18 at the grammar level rather
   than relying on registry membership. Until then, do not treat the validator
   as sufficient to reject legacy aliases.
3. **RV-002** — recommend registering a canonical `NOT_IMPLEMENTED` /
   `ROUTE_NOT_AVAILABLE` code (or selecting an apter registered code) for the
   Hub's mutation block, so client retry guidance stops reading as "fix your
   request". Track alongside the C16 LAN-API documentation amendment.
4. **RV-003 / KLREQ-015** — the nine missing Edge permission keys require owner
   registration under `rbac.permission_registry_manage` (A4_OWNER_SECURITY, with
   impact assessment) **before** any of those nine routes can be implemented in
   WS-12..15. Implementing them against `[REQUIRED:]` markers is prohibited.
5. **RV-004 / KLREQ-016** — the 17 `proposed` audit-event names must be
   registered in the Domain Event Registry before any release publishes them.
6. **KLREQ-017 (C19)** — owner ruling owed on the permission-grammar segment
   count; either the grammar sentence or 60 registry rows must move.
7. **KLREQ-018** — documentation amendments owed to the Domain Event Registry
   (C14/C15), Store Hub LAN API error table (C16) and RBAC CSV audit-event
   vocabulary (C23); code currently outranks these documents by authority order.
8. **KLREQ-019 (C20/C25)** — owner ruling owed on the neutral-Core boundary for
   vertical contract data in `packages/`.
9. **C21** — `store_edge` is missing from `KITLUY_ENVIRONMENTS`, so the RBAC
   environment-segment denylist would not reject a `store_edge` segment.
   Correctly deferred to a separate governed task touching
   `packages/shared-types`.
10. **KL-INF-P1-037 stands.** Migration 0100 is local-only; production
    application remains human-operated and four-eyes approved. Nothing in this
    cycle may auto-apply it.
11. Evidence-register promotion for the aligned packages should link this review
    record; status ceiling remains contract alignment IMPLEMENTED-IN-DEV, with
    Edge mutation business workflows NOT INTEGRATION-VERIFIED.

## 10. Reviewer truth statement

I personally executed, on the local stack at `C:\dev\HET-KITLUY-PROJECT` against
commit `350aace` with a clean tree, every command in §6.1 and recorded its
ACTUAL output: `format:check`, `lint`, `typecheck` (87/87), `test` (58/58),
`test:contract` (20/20), `db:validate`, `db:reset`, `db:seed` three times,
`db:test` (**121** PASS), `test:rls` (**95** PASS), `db:types` (empty diff),
`docs:inbox-state`, `docs:verify` (**8/8**), `verify` (**11/11**),
`git diff --check` and `git status --short`, plus all eight targeted package
suites. Every number in this record is one I observed, not one I was told.

I wrote and executed my own probes — 63 assertions against the built `dist/`
output for the contract layer, 8 for the Hub and built-output scan, and a
multi-stage SQL probe against the live local database. The SQL probe ran inside
a single transaction that I rolled back, and I re-queried the database
afterwards to confirm it returned to its canonical state (2 rows with dotted
identifiers, `tgenabled='O'`, 3 CHECK constraints). I created no persistent probe
data. I derived the 22-route count, the 107-key count, the 60/47 segment split,
the 9 permission gaps and the 17/5 audit-event split from the primary artifacts
myself.

I did not author any reviewed commit. The only file I wrote is this record.

I claim only what I ran. I did **not** verify: production behavior, any deployed
environment, Edge mutation business workflows (none exist), Hub persistence
(WS-09, not built), integration or pilot readiness, or the correctness of the
owner's business decisions themselves — only that the repository faithfully
implements the decision as written and fails closed where it does not.

**On BLK-003 eligibility:** the decision document's §Status effect lists seven
closure preconditions. On my own execution, six are satisfied — canonical
identifiers are aligned, the contract amendments are committed, unit and contract
tests pass, Hub mutation routes fail closed for every non-GET verb, RLS and
device/profile enforcement remain intact (121/95 unchanged, migration 0100
preserves every constraint and re-arms the append-only trigger), and this record
is the explicit independent approval. The seventh — linked evidence registered in
the evidence register — is the authors' remaining step. **BLK-003 is therefore
ELIGIBLE for closure once, and only once, the evidence-register entry linking the
decision, ballot, the six commits, test output, this review and
`docs/evidence/phase1/kl-dec-001/` is recorded.** It must not be closed before
that entry exists, and closure covers the DECISION blockage only: Edge mutation
business workflows remain NOT INTEGRATION-VERIFIED and the Hub keeps failing
closed until WS-09/WS-12..15 land with their own tests and review.
