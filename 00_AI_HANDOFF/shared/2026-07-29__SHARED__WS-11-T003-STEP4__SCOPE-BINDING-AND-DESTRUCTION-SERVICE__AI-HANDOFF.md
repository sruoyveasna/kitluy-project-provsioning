# WS-11-T003 Step 4 — scope binding (0141/0142) and the provider-key destruction service

| Field | Value |
| --- | --- |
| Date | 2026-07-29 |
| Area | shared (device identity) |
| Prompt | WS-11-T003 Step 4 — issuance/renewal/revocation/recovery/destruction completion |
| Authority | KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 Rulings 1-4 (KLREQ-033); KLD-2026-07-29-DEVICE-KEY-DESTRUCTION-001 (KLREQ-031); KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001 (KLREQ-032) |
| Starting HEAD | `9ff77fa` |
| Commits added | `932dcf2`, `9c0c288`, `c7366f5`, `cb8dbb6`, `7f8ff99`, `d79f3c3`, `e2aed5b`, `371beea` |
| Migrations added | 0141 `revocation_scope_binding`, 0142 `scope_bound_revocation` |
| Status | **PARTIAL — NOT PROMOTED.** See "What is NOT done". |

## What was built

### Migration 0141 — the binding (Ruling 1)

`revocation_recorded_scopes` existed since 0138 but only *cited* an approval.
Nothing tied the bytes of the scope row to the bytes the approvers approved, so
a scope row could name approval X while describing a set the approvers of X
never saw.

0141 adds the canonical form (identifiers **deduplicated and sorted**, fixed
field order, `\N` for NULL, per-list cardinality emitted beside each list), the
SHA-256 scope digest, and the approval payload hash that binds the digest
together with reason, environment, tenant, digital store, store location,
subject type, identifier count, requester and decision version.

Both values are **computed by a BEFORE INSERT trigger**, never accepted from the
caller — a caller that could supply a digest could supply one that does not
describe the row it sits on. Group 0138's append-only trigger then makes them
immutable.

`revocation_scope_consumptions` is a table, not a flag, because the scope table
is append-only. UNIQUE on `incident_scope_id`, on `approval_request_id` and on
`revocation_id`, because each is a different replay.

### Migration 0142 — the call site

0141 built a verifier nobody invoked, which is a function rather than a control.
0142 is the only path by which a recorded-scope reason may revoke, and it makes
three checks, each failing closed:

1. the approval cryptographically commits to this exact scope;
2. the credential being revoked is a **MEMBER** of that scope — a genuine,
   correctly bound, unconsumed scope naming devices A and B is still not
   authority over device C, and without this check it would have been;
3. the scope is consumed in the **same transaction**, RAISING rather than
   returning if consumption loses a race, so the revocation rolls back with it.

Group 0139's `revoke_device_credential_v1` is **called, not reimplemented** — its
four-eyes gate, append-only evidence, recovery case and one-way trigger all
still apply.

### The provider-key destruction service (`src/key-destruction.ts`)

KLREQ-031 was answered and 0137 built the database side; nothing called it.
`evaluateKeyDestruction` returned `authorized = false` unconditionally and the
provider had a `destroyed` state it could never reach.

The part that cannot be delegated to PostgreSQL is the **ORDER**, because the
database cannot observe a provider call and so cannot tell a destruction from a
timeout. The service does that one step in the only safe order: the database
clears the attempt (`EXECUTION_CLEARED` is the *only* answer that reaches the
provider), the provider is asked and must produce a receipt, the receipt is
re-checked against the bindings that were approved, and only then may the
database confirm.

Everything else leaves the database **non-destroyed**: timeout, connection
failure, indeterminate answer, outright refusal, exhausted retry budget, and a
receipt naming a different reference, fingerprint or generation.

The development provider now really erases — the vault drops the private half
and signing REFUSES afterwards, which is what the test asserts rather than a
flag. The receipt outlives the key, carries public bindings only, and a repeat
destruction returns the FIRST receipt because KLREQ-031 accepts
`ALREADY_DESTROYED` only with matching prior evidence. It is recorded as
`development_simulated` so no reader mistakes it for hardware-backed erasure.

## Two things that changed direction, recorded rather than smoothed over

**RC-015 (new).** Ruling 1 requires verifying a binding to `payload_hash`;
Ruling 2's reader was deliberately built unable to read it, and 0140 asserted
exactly that. Both rulings are the same owner decision and must both hold.
Options refused: re-introducing `service_role`'s global BYPASSRLS (undoes
Ruling 2 to satisfy Ruling 1) and a fourth RLS policy (Ruling 2 authorizes
exactly three). Taken: **one column-level SELECT grant** on rows the reader can
already see, no new policy, census still 61, `reason` still unreadable. The 0140
assertion was **amended, not deleted** — it still refuses `reason`, now
positively requires the hash, and pins the reader to exactly nine
`approval_requests` column grants so the widening cannot drift unnoticed.

**Ownership split.** The verifier was first owned by the approval reader, which
could not read its own scope table (`permission denied for table
revocation_recorded_scopes`, caught by a live probe, not by inspection). It is
now split: the **governor** verifies (its table, its policy) and asks the
**reader** for one hash and nothing else. Ruling 2's "only this identity touches
`kitluy_auth`" is intact and the reader gains nothing in `kitluy_devices`.

**RC-014 closed.** 0139 fixed it; 0140 proves it by driving a real
approve-before-execute revocation to completion. Re-verified on a clean reset.

## Executable evidence

Clean `db:reset` → `db:seed` → `db:test` → `test:rls`, all exit 0:

| Gate | Result |
| --- | --- |
| `pnpm db:test` | exit 0, **191** `NOTICE: PASS` (baseline 189; +1 SECTION 44, +1 SECTION 45) |
| `pnpm test:rls` | exit 0, **104** PASS |
| `@kitluy/device-identity` | exit 0, 28 files, **739** tests, **0 skipped**, live DB up (baseline 628; +32 destruction, +79 worker jobs) |
| `typecheck` | exit 0 |

Nine-step live probe of the binding chain (rolled back), all passing:
caller-computed hash **equals** trigger-computed hash; a bound scope verifies;
cross-environment, foreign-approval and hash-mismatch each fail closed;
consumption is single use; a spent scope stops verifying; the scope is
immutable. The probe also confirmed the boundary by being *refused* — `postgres`
cannot execute the verifier, only the governor can.

## What is NOT done — do not read this handoff as completion

- **Live destruction integration tests are ABSENT.** Retention windows, holds,
  four eyes, approval expiry and the attempt budget are enforced in group 0137
  and are exercised only by unit tests against stubs. Those prove the SERVICE's
  ordering; they do not prove the DATABASE's policy.
- **True two-connection concurrency evidence is ABSENT.** This has one concrete
  consequence, recorded in SECTION 45's own header: group 0142's
  RAISE-rather-than-return rollback is **UNPROVEN**. Single-threaded, the
  verifier refuses a spent scope long before consumption is attempted, so the
  branch is unreachable without a real race. The atomicity claim rests on
  PostgreSQL's transaction semantics and on reading the code — not on evidence.
- **No independent hostile review has completed.** Three review attempts died on
  API stalls. What exists instead is one reviewing agent's incidental finding
  (the `KeyHoldType` enum defect, fixed in `371beea`) and the mutation checks the
  assertion sections ran on themselves. That is not a review.
- **`lapse_emergency_revocation_post_approvals_v1` still has no caller.** The
  lapse DISCOVERY exists in `revocation-and-destruction-jobs.ts`, but nothing
  schedules it, so a PENDING post-approval still stays PENDING for ever.
- **The four job kinds have no database adapter.** Their ports are typed only;
  nothing is scheduled in a running system.
- **`KeyHoldType` has no live conformance guard.** The values were transcribed
  from `pg_enum` by hand; nothing fails if the enum changes again.

## What IS now done that this handoff previously listed as missing

- SECTION 44 (`ws11-revocation-scope-binding`, 1004 lines) and SECTION 45
  (`ws11-scope-bound-revocation`, 648 lines) are the permanent gate for groups
  0141 and 0142. Both were mutation-checked rather than assumed.
- The four worker job kinds exist, reuse the durable runtime rather than
  duplicating it, and refuse to forge an approval. 79 tests.

## Risk status — unchanged

- **KLRISK-DEVICE-003 — OPEN.** Untouched. PostgreSQL still does not verify
  Ed25519; the device-identity package is still the only cryptographic verifier
  and remains inside the trusted computing base. No pgsodium was installed.
- **KLRISK-DEVICE-007 — OPEN, reduced but NOT closed.** The governed revocation
  exists, has a service layer, and now has a scope binding and a call site. Its
  closure gate additionally requires live integration evidence, concurrency
  evidence and an independent review — none of which exist yet.

## Limitations that must survive any future summary

- The development credential format is **not X.509**.
- Ed25519 is a **development selection**, provisional.
- **PostgreSQL does not verify Ed25519 signatures.**
- The **production signer is not implemented**.
- Provider durability across processes is **not proven**; the development
  provider is in-process.
- Hardware-backed key erasure and TPM/secure-element certification are **not
  proven** (BLK-005 §4).
- Pilot and production readiness are **not implied**.

## Environment deviations recorded

- **Node v24.14.1**; the repository ACTIVE-BASELINE pin is **22.23.0** (`.nvmrc`).
  No Node 22 and no version manager exist on this machine, so gates were run
  individually with the engine-strict override. The aggregate `pnpm verify` is
  therefore **not baseline-authoritative**.
- The working copy is a **fresh clone** (single `clone:` reflog entry). Earlier
  session notes describing 59 held local commits and a disabled push URL
  describe a *different* working copy and do not apply here; HEAD matched
  `origin/main` exactly at session start.
- `supabase/config.toml` was **temporarily** edited to move the local DB port
  54322 → 55432 and inbucket 54324 → 55434, because two unrelated Supabase
  stacks (`hsa_eco`, `sroulapp-backend`) already hold the repository's configured
  ports. The owner's other stacks were **not** stopped. This edit is reverted
  before the session ends and must never be committed.
