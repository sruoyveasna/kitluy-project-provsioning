# WS-11-T001 Execution Evidence — hardware enrollment and device identity records

**Task:** WS-11-T001 (Cycle 10)
**Date:** 2026-07-28
**Status claimed:** **WS-11 — SCAFFOLDED / IN PROGRESS.** Not `IMPLEMENTED-IN-DEV`.
**Blocker:** **BLK-005 OPEN.** Production activation BLOCKED. Production signer BLOCKED.

> Evidence discipline (KLD-EVIDENCE-001): every figure below was produced by a
> command that actually ran on 2026-07-28 against the LOCAL stack. Nothing here
> claims a capability that is gated on BLK-005.

---

## 1. Gates executed

| #   | Gate                   | Command                                      | Result                                                     |
| --- | ---------------------- | -------------------------------------------- | ---------------------------------------------------------- |
| 1   | Cloud migrations       | `pnpm db:reset` (from zero)                  | **PASS** — **13** migration groups, 0120 applied last      |
| 2   | Cloud seed             | `pnpm db:seed`                               | **PASS**                                                   |
| 3   | Cloud assertions + RLS | `pnpm db:test`                               | **PASS** — **140** `NOTICE:  PASS` (124 before + 16 new)   |
| 4   | Cloud RLS alone        | `pnpm test:rls`                              | **PASS** — **100** `NOTICE:  PASS` / **99** distinct cases |
| 5   | Hub migrations         | `pnpm hub:db:reset` (from zero)              | **PASS** — **27** migrations, unchanged by this task       |
| 6   | Hub assertions         | `pnpm hub:db:test`                           | **PASS** — **35**, unchanged by this task                  |
| 7   | Package tests          | `pnpm --filter @kitluy/device-identity test` | **PASS** — **24 passed**                                   |
| 8   | Repository verify      | `pnpm verify`                                | **PASS — 11/11**                                           |
| 9   | Documentation verify   | `pnpm docs:verify`                           | **PASS — 8/8**                                             |
| 10  | Secret scan            | `pnpm secret:scan`                           | **PASS** (1068 tracked files)                              |

Hub gates were run **separately** from the cloud gates, per the standing
instruction and KLRISK-HUB-006 (`pnpm db:reset` destroys `kitluy_hub_local`;
the Hub database was rebuilt from zero afterwards, not assumed intact).

### Counting metric, stated so it cannot drift again

`pnpm db:test` runs `assertions.sql` **and** `rls-tests.sql`, so its figure is
the sum of both. Measured at HEAD before this task: assertions 29 + RLS 95 =
**124**, matching the WS-10 evidence. After this task: assertions 40 + RLS 100 =
**140**.

**Correction to the WS-10 evidence (RV-005).** That row states "test:rls **94**
unchanged (the 95 carried in earlier rows is a miscount)". The runtime figure at
HEAD is **95** `NOTICE:  PASS`, measured directly by stashing this task's
changes and re-running. Both numbers were right under different metrics: there
are **94 distinct case ids** and **95 PASS notices**, because case `KLSEC-036`
emits two. Neither figure was a miscount; the metric was never stated. It is
stated here.

---

## 2. What was built

### Migration group 0120 — `kitluy_devices`

Eleven relations, all additive, LOCAL execution only, RLS ENABLE+FORCE with zero
anon policies and zero client write paths.

| Relation                       | Purpose                                                        |
| ------------------------------ | -------------------------------------------------------------- |
| `hardware_profiles`            | Certified hardware definition + the required-evidence contract |
| `devices`                      | The immutable `device_record_id`                               |
| `hardware_manifests`           | Sealed hardware-evidence inventory per enrollment              |
| `hardware_manifest_signals`    | Individual binding/tamper signals                              |
| `manufacturing_enrollments`    | Internal HET station enrollment; PUBLIC-key fingerprint only   |
| `device_hardware_observations` | Later evidence reports, compared to the sealed manifest        |
| `device_trust_incidents`       | Quarantine and clone defense                                   |
| `device_certificates`          | Certificate STATUS (no issuance)                               |
| `pki_trust_configuration`      | **The BLK-005 gate. Created EMPTY, never seeded.**             |
| `device_replacements`          | Authorized repair/NVMe/complete-device replacement             |
| `device_lifecycle_events`      | Append-only state-machine audit                                |

### `@kitluy/device-identity`

Identity model, hardware-evidence comparison, lifecycle matrix, the abstract
`PkiProvider` / `AttestationProvider` / `SigningProvider` interfaces, and
`UnconfiguredPkiProvider` — the fail-closed default that refuses every
cryptographic operation with `RequiredCryptographicValueError`.

---

## 3. The identity rule, and how it is enforced

The owner's instruction was explicit: **do not derive the primary identity by
hashing MAC address, storage serial and board identifiers together.**

`kitluy_devices.devices.id` is a server-generated opaque uuid. No column, no
function, no index and no code path in this task derives it from, or resolves it
by, any hardware value. Assertion **28a** proves it positively: it computes the
forbidden `sha256(mac || board)` construction and shows that no device row
carries it, while also showing the MAC **is** recorded as a binding signal.

`hardware_manifests.manifest_sha256` exists and is a digest over the signal set,
but it is a change-detection digest — computed server-side from stored rows so a
caller cannot assert a manifest it never presented — and nothing resolves a
device by it.

**A changed signal quarantines and requires governed re-enrollment.** Assertion
**28c** changes a board serial and shows: the device count does not increase, the
SAME `device_record_id` moves to `quarantined`, an open CRITICAL
`hardware_signal_mismatch` incident is raised, and the sealed manifest is
byte-identical afterwards.

### Duplicate detection is evidence, not a constraint failure

`hardware_manifest_signals` has a lookup INDEX, deliberately **not** a UNIQUE
constraint. A unique constraint would hard-reject the clone's insert, and a
clone that leaves no row leaves no evidence. Instead, enrollment detects the
duplicate, gives the second unit its **own** identity, quarantines it, and
records a CRITICAL `duplicate_hardware_signal` incident (assertion **28j**).

---

## 4. The BLK-005 gate, and proof that it fails closed

`assert_pki_configuration_approved(environment)` raises while
`pki_trust_configuration` holds no active row. `activate_device_v1` and
`issue_device_certificate_v1` call it **first** — before any state check — so the
refusal reason is always the missing cryptographic configuration rather than an
incidental state problem.

Assertion **28b** proves, across `development`, `pilot` and `production`:

- 6/6 refusals, every one `KLUY-DEVICE-PKI-UNCONFIGURED`;
- every message contains an explicit `[REQUIRED: ...]` marker **and** `BLK-005`;
- the device does not drift out of `enrolled`;
- **zero** certificate rows are created;
- the gate table is still empty afterwards.

### The gate cannot be faked open

Assertion **28i** proves five ways of opening it are refused: a blank or
placeholder `approved_by_decision_ref`, an unresolved `[REQUIRED: ...]` marker,
one signing key shared across configuration/release/transport, the offline root
acting as the device-issuing CA, and a renewal window longer than the certificate
lifetime. RLS case **WS11-N3** proves an authenticated client can neither read
nor insert the table. RLS case **WS11-N4** proves `activate_device_v1`,
`enroll_device_v1` and the gate function itself are not executable from a client
session — PUBLIC EXECUTE is revoked in 0120, applying the WS-10 migration-0020
lesson rather than repeating the finding.

The fleet view reports `BLOCKED_PKI_UNCONFIGURED` rather than
`AWAITING_ACTIVATION` while the gate is shut (assertion **28k**). A fleet view
that hides the blocker is how a blocked programme comes to look finished.

---

## 5. Replacement, in the owner's required order

`record_device_replacement_v1` records the sequence as **facts**, not as an
assumed procedure (assertion **28f**):

| Owner requirement                                    | How it is enforced                                                         |
| ---------------------------------------------------- | -------------------------------------------------------------------------- |
| old certificate revoked                              | active certificates set `revoked`; recorded in `prior_certificate_revoked` |
| old assignment generation invalidated                | `assignment_generation` set to 0; prior value recorded                     |
| replacement recorded by authorized internal operator | `authorized_by_operator_ref` NOT NULL                                      |
| new key pair generated                               | `reenroll_device_v1` REFUSES the prior public-key fingerprint              |
| new certificate issued                               | BLK-005 gated                                                              |
| new evidence captured                                | a new sealed manifest per re-enrollment                                    |
| reactivated through the normal approval flow         | returns to `enrolled`, never straight to `active`                          |

**Private keys must not be copied from the damaged storage device.**
`device_replacements_no_key_carryover_chk` pins `private_key_carried_over` to
`false` — a database constraint, not a convention. The assertion tries to set it
`true` and is refused. `reenroll_device_v1` refusing a repeated public-key
fingerprint is the same rule enforced from the other side: presenting the old key
again is the signature of a copied key rather than a new key pair.

A storage-module-only evidence change is recognised as the NVMe-replacement
signature **and still quarantines** (assertion **28d**) — trust policy §11's
"normal field operation does not permit unregistered NVMe replacement and silent
reactivation".

---

## 6. Defect found and fixed during this task

**The refusal record was rolled back by the refusal.** `activate_device_v1`
originally wrote an `ACTIVATION_ATTEMPTED` lifecycle event before hitting the
gate, so a blocked activation would leave evidence. Assertion 28b failed: raising
rolls back everything the function did, including that row. The evidence existed
only in the case where it was not needed.

This is the same shape as WS-10's `verifySnapshot`, where a throw erased the
rejection it was reporting. Fixed by splitting responsibilities:
`activate_device_v1` raises and writes nothing; `record_activation_refusal_v1` is
called by the caller's exception handler in a **new** transaction, and also opens
one `activation_blocked` incident so the blocker is visible on the device.

`activation_blocked` is excluded from the open-incident check in
`activate_device_v1` — counting it would mean that resolving BLK-005 left every
device permanently un-activatable by the evidence of having been blocked — and it
is cleared automatically by a successful activation.

Found by a test that was written to fail if the evidence were absent. It was.

---

## 7. Deviations from the DD relation dictionary, recorded rather than silent

`kitluy_devices` is already named in DD v1.0.0 (schema ownership registry), so
creating the schema needs no dictionary amendment. The RELATIONS deviate:

| ID  | Deviation                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | `hardware_manifest_signals` is in neither the DD nor trust policy §13. A manifest whose signals are not individually queryable cannot be compared field by field, which is the whole tamper mechanism.                                                                                                                                                                                   |
| D2  | `device_hardware_observations` is new. §13's `device_attestations` is a different concept (boot/secure-element proof) and is deliberately NOT created — attestation is blocked on BLK-005 item 4.                                                                                                                                                                                        |
| D3  | `pki_trust_configuration` is in neither list. §13's `trust_bundle_versions` is distribution, not approval. The gate needs a relation whose emptiness is the refusal.                                                                                                                                                                                                                     |
| D4  | `device_replacements` is new; the DD's `rma_cases` (reason/status/replacement_device_id) cannot record the owner's required precondition ORDER. `rma_cases` is NOT created.                                                                                                                                                                                                              |
| D5  | `device_lifecycle_events` is new — append-only audit of the state machine.                                                                                                                                                                                                                                                                                                               |
| D6  | NOT created, deliberately: `device_assignments`, `device_capabilities`, `provisioning_sessions`, `device_actions`, `peripheral_tests`, `rma_cases` (DD); `certificate_revocations`, `device_attestations`, `trust_bundle_versions` (§13). They belong to T002+ and creating them empty would imply capability that does not exist (repository rule 5, the same reasoning as WS-10's D3). |

`kitluy_devices` owes a DD relation-dictionary amendment for D1-D5 before WS-11
closes.

---

## 8. Material limitations

These are the reasons WS-11 is **not** `IMPLEMENTED-IN-DEV`:

- **No CA, no certificate issuance, no key generation, no revocation
  distribution, no signer, no production activation.** All blocked on BLK-005.
  `UnconfiguredPkiProvider` refuses every operation, and it is the DEFAULT so
  that "no provider wired" and "design not approved" fail identically.
- **`issue_device_certificate_v1` records a status; it does not issue anything.**
  Even after BLK-005 is ruled, the actual issuance mechanism is unbuilt.
- **No Hub claim, no activation flow, no assignment model, no terminal
  assignment, no provisioning session, no fleet health telemetry.** T002 onward.
- **No production caller.** Every function in 0120 is reachable only from the
  test harness. This is the mechanism and its guarantees, not a running
  provisioning service — the same limitation WS-10 carries (RV-004).
- **`assignment_generation` is a column, not a lifecycle.** Issuance and
  revocation are T002; nothing in 0120 increments it.
- **The `activation_blocked` incident depends on the caller.** If a caller
  swallows the refusal and never calls `record_activation_refusal_v1`, no
  evidence is written. The database cannot make a caller report its own failure.
- **No independent review of this task yet.** T008.

## 9. New gap recorded: clock bootstrap (G12)

Certificate validity is a time window. A Raspberry Pi without a battery-backed
RTC boots with an untrusted clock, and NTP is unauthenticated and may be
unreachable during exactly the outage that matters. Nothing in the repository or
the trust policy addresses how a Hub establishes trusted time before validating a
certificate, or what it does when it cannot.

This is not a runbook detail — it decides whether certificate expiry is enforced
or advisory, and it constrains the hardware profile. Recorded as **BLK-005 ballot
item 11** rather than guessed.

---

## 10. Artifacts

| Artifact                                                                     | Kind                            |
| ---------------------------------------------------------------------------- | ------------------------------- |
| `supabase/migrations/20260728120120_0120_device_enrollment_and_identity.sql` | migration (additive)            |
| `supabase/tests/assertions.sql` section 28 (28a-28k)                         | 11 assertion sections           |
| `supabase/tests/rls-tests.sql` WS11-N1..N4, WS11-P1                          | 5 RLS cases                     |
| `packages/device-identity/src/index.ts`                                      | identity model + interfaces     |
| `packages/device-identity/test/device-identity.test.ts`                      | 24 tests                        |
| `docs/decisions/kitluy-blk-005-pki-and-device-trust-owner-ballot-v1.0.0.md`  | owner/security ballot, 12 items |
