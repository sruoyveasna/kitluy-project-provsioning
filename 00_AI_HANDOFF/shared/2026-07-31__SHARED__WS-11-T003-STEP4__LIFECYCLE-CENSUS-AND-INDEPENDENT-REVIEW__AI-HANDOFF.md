# WS-11-T003 Step 4 — lifecycle, residue census, and three independent reviews

| Field      | Value |
| ---------- | ----- |
| Task ID    | WS-11-T003 Step 4 — §3, §4–§9, §10, §11, §12 |
| Date       | 2026-07-31 · Asia/Phnom_Penh |
| Start SHA  | `af71bfe` |
| End SHA    | `36631e4` |
| Toolchain  | Node **v22.23.0**, pnpm **9.15.9** (project-external; repository pin UNCHANGED) |
| Migrations | cloud **none added** (0155–0158 unchanged); hub **0028** added, 0027 unchanged |
| Decision   | **WS-11-T003 Step 4 is NOT PROMOTED.** See §12. |

---

## FINAL STATUS

```text
WS-11-T003 Step 4 — NOT PROMOTED
KLRISK-DEVICE-003 — remains OPEN
```

Three fresh independent reviewers (A database/permissions/evidence, B Store
Hub/offline/signing, C lifecycle/composition/claim-honesty) each returned
**blocking** findings. Nine were fixed and re-verified in this session. **Six
blocking findings remain open** and are listed in §11 below. Under §12 of the
task, promotion requires no blocking findings, so the answer is no.

---

## §3 — the seeded re-authentication-evidence census question, resolved

The prior handoff recorded 7 surviving ACTIVE evidence rows belonging to seeded
actors and reasoned that they were harmless "because they are expected to
expire". The task explicitly refused that reasoning, and it was the wrong
question.

`residue-spendability-census.integration.test.ts` now asks whether anything left
behind can **authorise** something, and reports surviving history separately from
spendable residue. Every assertion encodes the predicate the database itself
applies. Critically, the file does **not** trust the `lifecycle_state` label: it
inserts an ACTIVE row whose window closed an hour ago, calls
`consume_reauthentication_evidence_v1` with it through the governed door, and
proves the refusal. That is what licenses treating expiry as unspendable.

Result after a full parallel run:

```text
[census surviving] evidence_total 17, consumed 8, revoked 9, authorizations 6
[census spendable]  spendable_evidence 0 · effective_temporary_grants 0
                    leaked_memberships 0 · test_clock_policy_rows 0
                    overdue_unresolved_authorizations 0 · legacy_reachable 0
                    job_governor_recorded_exception 1  (see KLRISK-DEVICE-011)
```

Nothing was deleted to reach that. Consumed evidence, revoked evidence and
executed authorizations remain: they are append-only history.

**A claim in this file was itself wrong and is corrected.** It said it "runs last
by filename convention". It does not — there is no `vitest.config.ts` in the
service or at the root, so Vitest's default sequencer orders by file SIZE and
`fileParallelism` runs it concurrently with the suites whose residue it
describes. Run early it passes vacuously; run alongside a live suite it fails
spuriously. Its two count checks are now bounds a concurrent suite cannot
legitimately exceed, and the false claim is replaced with what actually happens.
Making the ordering real needs a sequencer or a dedicated Vitest project and is
recorded as separate work.

---

## §4 — the production lifecycle

`production-lifecycle.integration.test.ts` drives ONE credential from issuance to
a terminal, decided, irreversible emergency revocation under a single correlation
id. Every stage that CHANGES something goes through `runtime.revocationRouter`.
The privileged connection provisions and asserts; it never revokes, approves,
consumes evidence or writes an authorization.

**28 stages, not the 30/31 the task specified.** That reduction is recorded here
rather than hidden — see the conflict entry in §11.

Observed: `executed=27/28` (stage 28 asserts on the set and does not record
itself, so 27 is the honest maximum).

What the run genuinely proves: authority-field rejection that does not spend
evidence (6); the emergency succeeding through the shipped route (7–8);
single-consumption bound to the authorization id (9); the bystander untouched
(10); a 64-hex database-derived digest and a scope of exactly one credential
(11–12); idempotent retry returning the SAME authorization with a row count (15);
the revoked serial reaching a real signed scoped snapshot that verifies under the
Hub's own verifier (18); four eyes refusing the first responder **by the
self-approval code while they hold the permission** (20); a distinct second human
approving, attributed, terminal, with a row count (21–23); the worker refusing to
overwrite a human verdict (24).

**The LAPSED branch is deliberately not re-proved here** — one authorization can
take only one branch, since the first verdict is terminal — and is proved on its
own authorization by `lapse-worker.integration.test.ts`.

---

## §10 — three independent reviews, and what they cost

All three reviewers found blocking defects **in my own work**. Reviewers A and C
converged independently on the same five lifecycle-test defects, which is why I
treated them as decisive rather than arguable.

### Fixed and re-verified this session

| # | Finding | Fix |
| - | ------- | --- |
| B1 | **The snapshot signature did not bind the list it signed.** `["A","B","C"]` and the same three joined by U+001F encoded to IDENTICAL bytes (reproduced: 125 bytes, same digest), so one genuine Ed25519 signature was valid for both with NO private key. An attacker on the delivery path joins the array, the signature still verifies, the Hub stores one entry matching no serial, and every credential that snapshot was first to revoke is silently un-revoked offline. | Encoding is now enforced injective on one shared field list. Signing RAISES `SeparatorInjectionError`; verification REFUSES with `SNAPSHOT_SEPARATOR_INJECTION` before any cryptography. Six regression tests keep the collision executable. |
| B6 | `verifySnapshotSignature` threw a TypeError on a missing envelope, in a function documented as failing closed on every path. | Returns `SIGNATURE_MISSING`. |
| A4/C1 | **The stage counter measured parsing.** `stage()` pushed during collection, so "stages=28" held even if every stage failed and even with the database down. | `passed(n)` at the end of each body; stage 28 asserts the exact set 1..27. |
| A2/C2 | **Stage 18 never asserted the serial was in the snapshot**, and took an arbitrary Hub via `limit 1` with no ORDER BY — a wrong-scope Hub yielded an empty snapshot that passed. It would still pass if the environment-wide leak were reintroduced. | Resolves the credential's OWN Hub, fails loudly if there is none, asserts the serial is present. |
| A8/C2 | **Stage 19 was mistitled** — its helper was documented as the scoped reader while running a raw environment-wide select touching no 0156 bridge. | Renamed `revokedSerialsFleetWide`; retitled to match what it executes. |
| A7/C7 | **Stage 20 did not test four eyes.** The responder held no post-approve grant, so deleting the self-approval rule left it green — hard rule 7 had no test. | The responder now holds BOTH grants deliberately; the stage asserts the refusal CODE. |
| A3/C5 | **Stage 27 asserted a tautology** (`count >= 0`) under the title "the run left NOTHING spendable behind". | An enumerated bound naming the three deliberately unspent rows (stages 15, 20, 23). |
| A5 | The census's false "runs last" claim. | Corrected; see §3. |
| — | **Two Hub gates my own group 0027 broke**, invisible because `hub:db:test` is not in `pnpm verify`: two functions left EXECUTE-able by PUBLIC, and a stale relation tally. | Additive hub migration **0028**; tally raised 57 → 60 with the three tables named. `hub:db:test` 35 PASS exit 0 (was exit 3). |

---

## §11 — BLOCKING findings that remain OPEN

These are why Step 4 is not promoted. Each is recorded with its reviewer.

1. **[A1] The cross-tenant snapshot path is still shipped, exported and
   granted.** `buildRevocationSnapshot` takes a scope as an ARGUMENT, then reads
   the environment-wide `revoked_certificate_serials_v1`, and binds the caller's
   scope into the digest. Group 0156 is purely additive: it never revokes the
   environment-wide readers from `kitluy_issuance_service` and never removes the
   old builder. A publisher calling it hands Tenant B's revoked serials to Tenant
   A's Hub with every integrity check green. Only the fact that its sole caller
   today is a test prevents the leak.
2. **[B2] Nothing calls the offline enforcement path.** `applySignedSnapshot`,
   `decideOffline` and `isCertificateRevokedOffline` have exactly one consumer in
   the repository: their own test. The module is not re-exported from
   `src/hub/index.ts` and no sync or delivery path calls it. The live device gate
   still reads the replicated credential table and never consults the snapshot. A
   Hub can now HOLD a snapshot; nothing makes it ACT on one. Under CLAUDE.md rule
   5 this cannot be recorded as offline containment being in force.
3. **[B3] Half the signed payload is inert.** `revokedDeviceRecordIds` is
   produced, signed, delivered and stored, and no function, query or caller ever
   reads it. A retired device is enforced against nowhere offline.
4. **[C4] The lapse worker has no production runtime.** Nothing constructs
   `createEmergencyLapseWorker` outside tests. The router enqueues a lapse job; in
   a deployed process no one ever claims it. RV-GW-002's exact shape survives one
   layer up, for the only mechanism that closes an unreviewed four-eyes
   obligation.
5. **[B4] `kitluy_sync_worker` can INSERT a fabricated `active` snapshot**,
   bypassing verification entirely. The migration comment claims withholding
   UPDATE prevents promotion; INSERT alone defeats that. Latent only because
   nothing connects as that role today.
6. **[C8] The post-approval REFUSE branch has zero executable coverage
   anywhere**, along with its mandatory escalation, and the late-APPROVE → LAPSED
   branch. Recovery, replacement and destruction after revocation are likewise
   uncovered.

### Recorded, non-blocking, not fixed

- **[A6]** Migration 0158 lists `pg_catalog` last in a superuser-owned SECURITY
  DEFINER, so `kitluy_ops` shadows built-in operators. No escalation today
  (the only login-capable member is already superuser), but it moved the wrong
  way and should be reordered.
- **[A13]** Borrow hand-backs in 0155/0156/0157 are not exception-safe.
- **[A10]** `credential_verification_state_v1` gives the worker a narrow
  revocation read that the §2.5 name-pattern sweep does not see; the census's
  claim that "nothing the worker does reads the revocation set" is inaccurate.
- **[A12/C]** `src/index.ts:11-17` still states the opposite of what shipped.
- **[C10]** The status route authorizes nobody.
- **[C6]** The SHIPPED authenticator is `refuseAllRequests`, so on a deployed
  instance every governed route returns 503. Disclosed in code and recorded as
  BLK-005 item 8 / BLK-006, but the lifecycle's phrase "the shipped surface, with
  its authentication" overclaims: authentication is the one component replaced.
- **KLRISK-DEVICE-011** — migration group 0135 borrows `kitluy_job_governor` and
  never hands it back. The additive repair (0159) was written and **reverted**:
  `supabase/tests/assertions.sql` relies on that membership, so revoking it makes
  `db:test` fail with "permission denied for table durable_jobs". Repairing it
  needs assertions.sql to borrow the role transactionally in the same change. The
  census asserts the exception at its current width so it cannot grow unnoticed.

---

## Canonical verification (Node 22.23.0, from a clean reset)

| Step | Exit | Result |
| ---- | ---- | ------ |
| `db:reset` (0000→0158 from zero) | 0 | — |
| `db:seed` | 0 | — |
| `db:test` | 0 | **196 PASS** |
| `test:rls` | 0 | **104 PASS** |
| `hub:db:reset` / `hub:db:seed` | 0 | applies 0000→**0028** |
| `hub:db:test` | 0 | **35 PASS** (was exit 3 before this session) |
| `@kitluy/device-identity` | 0 | 33 files |
| device-registry-service | 0 | **14 files**, incl. lifecycle 27/28 and the census |
| kitluy-hub-agent | 0 | 22 files passed / 1 skipped, incl. **offline 12/12** |
| `migrations:validate` `db:validate` `secret:scan` `lint` `typecheck` | 0 | — |
| `pnpm verify` (parallel) | 1 | **12 of 13** — only `Format check` |

**Not hidden:**

- `format:check` reports **805 files** — the pre-existing repository-wide CRLF
  condition. My own lifecycle file was genuinely mis-formatted and was fixed;
  `revocation-trust.ts` was checked and had ZERO non-line-ending changes.
  Reformatting 805 unrelated files to turn a gate green is exactly the misleading
  result this task forbids, so it was not done.
- `docs:verify` `check-classified` on imported documents — unchanged.
- The hub-agent suite's previously recorded 8 baseline failures did not recur;
  the suite is green with `kitluy_hub_local` up. Note that the offline suite had
  been **skipping** silently whenever that database was down, which is why this
  run recreated it before claiming anything about offline enforcement.

## Constraints honoured

Push URL remains `disabled://push-requires-owner-approval`; nothing pushed. No
prior migration edited — hub 0028 is additive and 0027 keeps its ledger checksum.
No production migration applied. No pgsodium. No claim that PostgreSQL verifies
Ed25519. No private key in Git, database, docs, logs or Hub. Repository toolchain
pin unchanged. WS-11-T004…T008 not started. Nothing promoted.

## Recommended next

1. **[B2] and [C4] first** — wire offline enforcement into the Hub gate and give
   the lapse worker a production runtime. Until then the two mechanisms that make
   revocation matter when the internet is down, and that close an unreviewed
   obligation, exist but never run.
2. **[A1]** remove or scope-restrict `buildRevocationSnapshot` and revoke the
   environment-wide readers from `kitluy_issuance_service`.
3. **[B3]** make `revokedDeviceRecordIds` enforced, or stop signing it.
4. **[C8]** cover the REFUSE branch and its escalation.
5. Then re-review and re-decide promotion.
