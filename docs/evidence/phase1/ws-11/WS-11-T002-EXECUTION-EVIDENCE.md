# WS-11-T002 Execution Evidence — Hub claim, scope resolution and assignment

**Task:** WS-11-T002 (Cycle 10)
**Date:** 2026-07-28
**Status claimed:** **WS-11 — SCAFFOLDED / IN PROGRESS.** Not `IMPLEMENTED-IN-DEV`.
**Blocker:** **BLK-005 OPEN.** Production activation BLOCKED. Production signer BLOCKED.

> Every figure below was produced by a command that actually ran on 2026-07-28
> against the LOCAL stack.

---

## 1. Gates executed

| #   | Gate                   | Command                                      | Result                                       |
| --- | ---------------------- | -------------------------------------------- | -------------------------------------------- |
| 1   | Cloud migrations       | `pnpm db:reset` (from zero)                  | **PASS** — 0121 applied last                 |
| 2   | Cloud assertions + RLS | `pnpm db:test`                               | **PASS** — **149** `NOTICE:  PASS` (140 + 9) |
| 3   | Cloud RLS alone        | `pnpm test:rls`                              | **PASS** — **104** (100 + 4)                 |
| 4   | Hub migrations         | `pnpm hub:db:reset` (run SEPARATELY)         | **PASS** — 27, unchanged                     |
| 5   | Hub assertions         | `pnpm hub:db:test`                           | **PASS** — **35**, unchanged                 |
| 6   | Package tests          | `pnpm --filter @kitluy/device-identity test` | **PASS** — **29 passed** (24 + 5)            |
| 7   | Repository verify      | `pnpm verify`                                | **PASS — 11/11**                             |
| 8   | Documentation verify   | `pnpm docs:verify`                           | **PASS — 8/8**                               |

Metric, per the convention fixed in T001: every figure counts `NOTICE:  PASS`
lines; `db:test` runs `assertions.sql` **and** `rls-tests.sql`, so it is their
sum (assertions 45 + RLS 104 = 149).

---

## 2. The two residual controls the owner required first

### KLRISK-DEVICE-001 — closed structurally, not by convention

The refusal record was caller-enforced: a defective or malicious caller could
invoke `activate_device_v1`, take the refusal, and simply never call
`record_activation_refusal_v1`.

Closed by inversion. `attempt_activate_device_v1` writes the refusal or the
activation result, commits it with the caller's transaction, and **returns a
typed outcome** instead of raising:

```
activation_outcome := (outcome, device_id, lifecycle_state,
                       refusal_code, refusal_message, evidence_event_id)
```

The raising form is then revoked:

```sql
revoke all on function kitluy_devices.activate_device_v1(uuid, text, text)
  from public, service_role;
```

**There is no longer a path that produces a refusal without producing its
evidence.** Assertion 29e proves the revocation holds by querying
`has_function_privilege` for both `public` and `service_role`, and proves
`attempt_activate_device_v1` is granted. Assertion 29d proves the evidence
exists after a single call to the attempt path and nothing else.

The eventual pattern the owner specified is what was implemented — not
recorded and deferred.

### Duplicate evidence blocks activation, and both identities are held

Three additions:

- `colliding_evidence_device_ids(device_id)` — non-retired devices sharing
  **non-storage** evidence, comparing CURRENT enrollments only so a repaired
  device never collides with its own superseded manifest.
- `activate_device_v1` refuses on any collision. Keeping duplicate evidence as
  rows is only sound if neither identity can activate.
- Enrollment now quarantines **BOTH** identities, not just the newcomer
  (`quarantine_evidence_collisions_v1`). Which unit is the clone is not knowable
  from the evidence.

Claim creation and claim redemption refuse a colliding device too — claiming a
suspected clone is not a useful thing to allow. Assertion 28j proves both units
are quarantined, both report the collision, and **neither can be claimed**.

**Residual risk, recorded not hidden:** an actor with access to an approved
enrollment station can now quarantine a live device by enrolling a unit that
presents its evidence. This is the cost of not trusting the incumbent by
default. Enrollment is a station-authorized internal operation, and trust policy
§8 step 2 ("preserve Store offline operation when safe on the previously trusted
Hub") is the runbook mitigation that is still owed.

---

## 3. The activation boundary, enforced as a state machine

```
claim accepted -> identity and scope bound -> assignment created
  -> device remains awaiting_trust
    -> BLK-005 configuration required -> certificate issuance -> activation
```

`awaiting_trust` is a new lifecycle state, and **`enrolled -> active` was
removed from the transition matrix**. A device now reaches `active` only through
`awaiting_trust`, which means only through an accepted claim and a bound
assignment. The chain is a state-machine property, not a convention a caller
could route around.

The TypeScript matrix in `@kitluy/device-identity` was updated in the same
change and has a test asserting `enrolled -> active` is **false** — the WS-10
C34/C35/C36 lesson, where SQL and TypeScript disagreed and the gates stayed
green because the wrong answer had been written into both.

---

## 4. What was built (migration group 0121)

| Relation                        | Purpose                                                   |
| ------------------------------- | --------------------------------------------------------- |
| `device_claims`                 | Short-lived single-use claim; token SHA-256 only          |
| `device_assignments`            | Tenant/Store/Location binding with a monotonic generation |
| `device_terminal_assignments`   | T1-T4 profile under a specific generation                 |
| `device_assignment_projections` | Offline projection of the last ACTIVATED assignment       |
| `device_claim_events`           | Append-only claim/assignment audit, including REFUSED     |

Design points worth stating:

- **The claim token is never stored.** Only its SHA-256 is, so a database read
  cannot produce a usable claim.
- **`payload_sha256` binds the token to its device and scope.** A captured token
  cannot be replayed against a different Tenant, Store or Location.
- **`kitluy_devices` stays vertical-neutral.** Terminal profiles are validated
  structurally as `<vertical>.t<n>.<role>` rather than enumerating Laundry
  values into a neutral Fleet schema (repository rule 2). The owner-locked T1-T4
  shape is still enforced.
- **`store_location_id` is denormalised onto terminal assignments** and
  trigger-checked against the assignment, so "terminal assigned to the wrong
  Location" is a constraint, not a check somebody has to remember.
- **Revocation withdraws the offline projection.** A revoked assignment that
  still projects is a revocation that did not happen.

---

## 5. The seventeen adversarial cases

All executed, all refused, each with its own code.

| Case                                | Refusal                                                      |
| ----------------------------------- | ------------------------------------------------------------ |
| reused claim token                  | `KLUY-DEVICE-CLAIM-REUSED`                                   |
| expired claim token                 | `KLUY-DEVICE-CLAIM-EXPIRED`                                  |
| claim token with altered payload    | `KLUY-DEVICE-CLAIM-PAYLOAD-ALTERED`                          |
| cross-Tenant claim                  | `KLUY-DEVICE-SCOPE-CROSS-TENANT`                             |
| cross-Store claim                   | `KLUY-DEVICE-SCOPE-CROSS-STORE`                              |
| cross-Location claim                | `KLUY-DEVICE-SCOPE-CROSS-TENANT` (location hop — see note)   |
| already-claimed device              | `KLUY-DEVICE-ALREADY-CLAIMED`                                |
| quarantined device                  | `KLUY-DEVICE-QUARANTINED`                                    |
| retired device                      | `KLUY-DEVICE-TERMINAL`                                       |
| duplicate hardware evidence         | `KLUY-DEVICE-EVIDENCE-COLLISION`                             |
| stale assignment generation         | `KLUY-DEVICE-GENERATION-STALE`                               |
| revoked assignment generation       | `KLUY-DEVICE-GENERATION-REVOKED`                             |
| terminal assigned to wrong Location | `KLUY-DEVICE-TERMINAL-WRONG-LOCATION`                        |
| concurrent claims for one device    | partial unique index on `(device_id) where state = 'issued'` |
| claim committed but response lost   | **recovers** — see below                                     |
| retry after response loss           | **recovers** — see below                                     |
| attempted activation, BLK-005 open  | `KLUY-DEVICE-PKI-UNCONFIGURED`                               |
| Hub ownership transfer              | `KLUY-DEVICE-OWNERSHIP-TRANSFER`                             |

### Reuse versus recovery

These are the same wire event seen from two sides, and conflating them would
either punish an honest Hub for a lost response or let a clone in. The rule:
**the SAME device re-presenting the SAME token recovers the SAME assignment;
a DIFFERENT device presenting it is reuse and is refused.** Assertion 29b proves
both halves, including that the retry creates no second assignment and is
recorded as `CLAIM_REDEMPTION_REPLAYED`.

### A correction to the cross-Location case

In this data model a Location belongs to exactly one Digital Store, so
"cross-Store" and "cross-Location" meet the **same broken hop** when the
Location is under a sibling store. The distinct location-hop failure is a
Location owned by another Tenant, which is what is tested. Recorded plainly
rather than manufacturing a third error code for one hop.

**A test defect was found and fixed here, not a code defect.** The first version
used fixture `loc02` as the "cross-Location" case; `loc02` belongs to the same
store as `loc01`, so the scope was valid and the assertion was wrong. The code
was right.

### Case 17, in full

A device that is enrolled, claimed, scope-bound, assigned, terminal-assigned,
with no open incidents and no evidence collision — as ready as it can possibly
be — is refused with `KLUY-DEVICE-PKI-UNCONFIGURED`, and:

- **no certificate row** is created;
- the device **stays `awaiting_trust`**;
- the assignment **stays `pending_trust`** with its scope unchanged;
- **no offline projection** is written;
- **no terminal assignment** goes live;
- the refusal **is** durably recorded, by the activation path itself.

---

## 6. Defects found and fixed during this task

1. **Expiry was evaluated against transaction-start time.** The check used
   `now()`, which in PostgreSQL is the transaction start, so a transaction that
   opened before a claim expired would redeem it after expiry and never notice.
   Fixed to `clock_timestamp()`. Found because the test slept past the TTL
   inside one transaction and the redemption succeeded.
2. **Generation reuse after revocation.** `redeem_device_claim_v1` computed the
   next generation as `device.assignment_generation + 1`. A revoked device
   carries generation 0, so a re-claim would have re-issued generation 1 — a
   number that already existed, meaning a stale Hub presenting the old
   generation would have been accepted as current. Fixed to follow the highest
   generation ever issued; asserted by the re-claim producing generation 3.
3. **The fleet view lost its service grant.** The view is DROPped and re-CREATEd
   (its column order changed), which silently discards grants. Caught by the RLS
   control case failing with `permission denied for view`. Re-granted explicitly.

---

## 7. Material limitations

- **No activation is possible.** BLK-005. Everything above stops at
  `awaiting_trust`, by design and by state machine.
- **`device_assignment_projections` is necessarily empty** — it is written only
  by a successful activation. Its emptiness is asserted rather than assumed.
- **No production caller.** Every function in 0121 is reachable only from the
  test harness. This is the mechanism and its guarantees, not a running
  provisioning service.
- **Concurrency is proven by constraint, not by racing.** The partial unique
  index makes a second outstanding claim impossible; the assertion exercises it
  sequentially. A true concurrent-session test is owed to T007.
- **Claim tokens are generated outside the database.** Nothing here generates or
  transports a token; the caller does, and no such caller exists yet.
- **Enrollment-station DoS is now possible** (§2 residual risk) and is mitigated
  only by a runbook that does not exist yet.
- **No independent review yet.** T008.

---

## 8. Artifacts

| Artifact                                                                  | Kind                               |
| ------------------------------------------------------------------------- | ---------------------------------- |
| `supabase/migrations/20260728130121_0121_device_claim_and_assignment.sql` | migration (additive)               |
| `supabase/tests/assertions.sql` section 29 (29a-29e)                      | 5 assertion sections               |
| `supabase/tests/rls-tests.sql` WS11-N5..N7, WS11-P2                       | 4 RLS cases                        |
| `packages/device-identity/src/index.ts`                                   | lifecycle + claim/assignment types |
| `packages/device-identity/test/device-identity.test.ts`                   | 29 tests (5 new)                   |
