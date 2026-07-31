# WS-11-T003 Step 4 — runtime invocation and pinned-toolchain verification

| Field           | Value                                                                                   |
| --------------- | --------------------------------------------------------------------------------------- |
| Task ID         | WS-11-T003 Step 4 — final completion §2/§3/§8/§10                                        |
| Date / timezone | 2026-07-31 · Asia/Phnom_Penh                                                             |
| Repository root | C:/Users/Hello-Evo-PC/Desktop/HET-KITLUY-PROJECT                                          |
| Start SHA       | `1f0769a` (40 ahead, clean)                                                              |
| End SHA         | `399da77` (43 ahead, clean)                                                              |
| Status          | **PARTIAL — Step 4 NOT promoted.** §2, §3 and §8 done; §4, §5-offline, §6, §7 NOT done; §9 not re-run |

## What closed

### §2 — runtime invocation (RV-GW-001 closed at the process level)

Both prior reviewers found the same gap independently: `main.ts` resolved a
service and invoked no method, `http.ts` served only health and version. Four
routes now exist and `main.ts` serves them through `handleRequest`:

```
POST /v1/device-credentials/revocations                              normal
POST /v1/device-credentials/emergency-revocations                    human
POST /v1/device-credentials/emergency-revocations/:id/post-approval  human
GET  /v1/device-credentials/emergency-revocations/:id                status
```

A body carries WHAT to do and never WHO is asking. Nine actor/authority field
names are REFUSED rather than ignored. The subject comes from a
`RequestAuthenticator` and goes onto the database session.

**The shipped authenticator refuses everything** (`refuseAllRequests`). Verifying
a token here needs the issuer key and algorithm; accepting a verified subject
needs the edge mutual-auth design. Both are [REQUIRED] owner values (BLK-005 item
8 / BLK-006). Trusting an `x-user-id` header would be the caller-supplied actor
truth this gate forbids and would rebuild RC-021 at the HTTP layer. Tests inject
their own authenticator explicitly.

End-to-end proof: **"REVOKES through the HTTP route and the credential is dead in
the database"** — a real four-eyes approval bound to the digest the database
derived, entered through `handleRequest`, row returns `state = 'revoked'`, and
`requestedBy` is the AUTHENTICATED subject rather than a body field.

### §3 — lapse scheduling and worker execution (RV-GW-002 closed)

A complete `DurableJobGateway` over the group 0135 RPCs existed only as a TEST
FIXTURE. Promoted to `packages/job-contracts/src/pg-durable-job-gateway.ts` (`pg`
imported for types only, so the package gains no runtime dependency), plus a
pooled variant that opens its own transaction as `kitluy_worker_service` per call.

Six live tests run the whole chain with production components:

| Property                                   | Evidence                                                            |
| ------------------------------------------ | ------------------------------------------------------------------- |
| payload carries ONE field                  | `Object.keys(payload) === ["authorizationId"]`                      |
| deterministic dedupe, no second obligation  | second schedule returns `EXISTING`; one job row                     |
| worker claims and the governed lapse writes | verdict `LAPSED`, `actor_user_id` NULL, `reauth_evidence_id` NULL, `late` true |
| immutable attempt evidence                  | `lapse_governed_emergency_post_approval_v1`, `terminal_success`     |
| duplicate delivery idempotent               | `ALREADY_DECIDED`, one verdict row                                  |
| cannot lapse early                          | `NOT_DUE`, zero verdict rows                                        |

### §8 — the pinned toolchain

Node **22.23.0** installed project-external at
`C:/Users/Hello-Evo-PC/.local/toolchain/node-v22.23.0-win-x64` (owner-approved).
The system Node was NOT replaced and **the repository pin was NOT changed**.

```
node --version   v22.23.0
pnpm --version   9.15.9
which node       /c/Users/Hello-Evo-PC/.local/toolchain/node-v22.23.0-win-x64/node
which pnpm       /c/Users/Hello-Evo-PC/.local/toolchain/node-v22.23.0-win-x64/pnpm
```

This satisfies `engines: >=22.12.0 <23` and `packageManager: pnpm@9.15.9`, so
**no `engine_strict` override is used anywhere**. `pnpm verify` and
`pnpm docs:verify` are AUTHORITATIVE for the first time — both previously failed
because nested `pnpm` children re-read `engine-strict=true` or could not find
`pnpm` on PATH.

## Canonical verification (§10) — fresh, serial, Node 22.23.0

Database target `postgresql://…@127.0.0.1:54322/postgres`; roles exercised
`kitluy_issuance_service`, `kitluy_worker_service`, `authenticated`,
`kitluy_credential_issuer` (borrowed and returned), `postgres` (fixtures).

| Step                              | Exit | Result                                  |
| --------------------------------- | ---- | --------------------------------------- |
| `db:reset` (0000→0155 from zero)  | 0    | 0155's three notices fired              |
| `db:seed`                         | 0    | —                                       |
| `db:test`                         | 0    | **196 PASS, 0 FAIL**                    |
| `test:rls`                        | 0    | **104 PASS, 0 FAIL**                    |
| `@kitluy/device-identity` vitest  | 0    | **780 passed / 33 files**               |
| device-registry-service vitest    | 0    | **89 passed / 6 files**                 |
| `typecheck`                       | 0    | —                                       |
| `lint`                            | 0    | 0 errors                                |
| `secret:scan`                     | 0    | clean                                   |
| `clock:check --require-complete`  | 0    | COMPLETE                                |
| `migrations:validate`             | 0    | 54 files                                |
| `pnpm verify`                     | 1    | **12 of 13 steps PASS**                 |
| `pnpm docs:verify`                | 1    | **7 of 8 individually**                 |
| `db:validate`                     | 1    | 3 pre-existing static false positives   |
| `format:check`                    | 1    | 801 files — pre-existing CRLF artifact  |

Pre-existing conditions, none introduced here:

- **format:check** — `core.autocrlf=true` with no `.gitattributes` against
  Prettier `endOfLine: "lf"`. Reports 801 files, essentially all untouched.
- **db:validate** — 3 `schemas-in-dictionary` false positives in groups 0127,
  0131, 0152. Group 0155 PASSES.
- **docs:verify** — `check-classified` fails on 12 imported source documents;
  confirmed pre-existing last session by stashing and re-running.

## Two defects this session's verification caught, both mine

1. **Three of my suites committed the borrowed `kitluy_credential_issuer`
   membership**, leaving a login-capable role a standing member of the NOLOGIN
   owner of every governed door — the same escalation class migration 0155 had to
   fix, reintroduced in test code. The device-identity concurrency suite's own
   borrow guard is what caught it. All four sites now hand back after `reset
   role`, membership-checked and tolerant of a parallel peer having already
   returned it; `pg_has_role` is asserted false after a full run.
2. **An overdue fixture in `development`** was swept by the sibling suite's
   environment-wide sweeper. The authorization is now scoped to a per-run
   environment; the job stays in `development` because the queue validates it.

Both passed standalone and failed only under `pnpm verify`, which runs package
tests in parallel against one database.

## NOT done — why Step 4 is still not promoted

| Gate                                     | State                                                                                     |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| §4 scoped SIGNED Hub snapshots           | **NOT DONE.** No signer exists (BLK-005 item 8); the builder emits `signatureValid:false` and `evaluateRevocationSnapshot` refuses it, so offline containment is NOT in force. Payload is still environment-wide rather than Tenant/Store/Location-scoped — the owner's isolation ruling is UNIMPLEMENTED. |
| §4 Hub persistence / atomic apply         | **NOT DONE.** No Hub table, no last-known-good, no restart survival.                       |
| §5 offline verification consumes snapshot | **NOT DONE.** Follows from the above.                                                      |
| §6 three concurrency cases                | **NOT DONE.** Real clock expiry while parked, incident-scope mutation, replay conflict.     |
| §7 full production lifecycle              | **NOT DONE.**                                                                              |
| §9 fresh re-review                        | **NOT RUN** against this session's commits.                                                |

Also outstanding from the prior review round and unchanged: snapshot scope sits
outside the object a signature would cover; monotonic snapshot versioning is
vacuous with no ledger; nothing type-enforces scope verification before use;
`credential_verification_state_v1` returns more fields than its comment claims;
the lapse door is granted to `kitluy_issuance_service` as well as the worker.

## FINAL STATUS

```text
WS-11-T003 Step 4 — NOT PROMOTED
```

Per §11, missing offline enforcement and unsigned snapshots are incomplete
implementation, not environment conditions. §2, §3 and §8 are closed; §4–§7 and
§9 are not.

## Recommended next

1. §4 end to end: Tenant/Store/Location-scoped payload, a signer (or an explicit
   owner decision to ship refused-until-Step-6), Hub table + atomic apply +
   last-known-good + restart, and the twelve required offline tests.
2. §6 three concurrency cases on separate connections with recorded PIDs.
3. §7 lifecycle through the production composition.
4. §9 two fresh reviewers over the whole changeset.
