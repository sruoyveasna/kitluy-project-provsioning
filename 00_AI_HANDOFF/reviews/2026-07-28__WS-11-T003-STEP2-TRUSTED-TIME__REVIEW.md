# Independent Security Review — WS-11-T003 Step 2, Trusted Time

**Date:** 2026-07-28
**Scope:** `git diff daecadd..HEAD` — commits `a7aed3a`, `91c39f0`, `ea9675b`, `32b7900`, `5a3b4bc`
**Reviewed against:** KLD-2026-07-28-002 §5, §6, §7, §12; the owner's trusted-time
instruction (2026-07-28); the owner's consumer-sequence instruction (2026-07-28)

> **Verdict is at the end. Do not infer approval from green tests** — every
> finding below was produced by running an attack, not by reading code and
> forming an opinion. Two attacks succeeded.

---

## 1. Method

Every probe below was EXECUTED. Where a probe is destructive (removing a file,
forging a state object) the repository was restored immediately and the baseline
re-confirmed.

Probes ran in three layers: the gate itself, the database, and TypeScript. The
gate was attacked FIRST, on the reasoning that a gate which can be fooled makes
every downstream result worthless.

---

## 2. Gate integrity — `pnpm clock:check --require-complete`

The owner required proof that the gate is not satisfied by filenames or
comments. Three attacks:

| Probe | Attack                                                                                                           | Result                                                    |
| ----- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| RV-A1 | Delete `src/revocation-snapshot.ts`                                                                              | `INCOMPLETE — 3/4`, **exit 1** under `--require-complete` |
| RV-A2 | Delete `test/certificate-renewal.test.ts`                                                                        | `INCOMPLETE — 3/4`                                        |
| RV-A3 | Replace `configuration-validity.ts` with a correctly-NAMED stub that returns `true` and never takes trusted time | `INCOMPLETE — 3/4`                                        |

**RV-A3 is the one that mattered.** The stub had the right path, the right
exported function name and no clock call, so a filename-only or clock-only gate
would have passed it. The gate caught it because it also requires the
`TrustedTime` symbol to appear in the implementation.

Baseline restored and re-confirmed: `COMPLETE — 4/4`.

### RV-A4 / RV-A5 — the gate WAS foolable (owner-directed re-probe)

The owner required proof that the gate tests real DEPENDENCY INJECTION, not
file presence or exported names. The three probes above did not establish
that, and the original review recorded it only as condition C3. Re-probed:

| Field                          | RV-A4                                                                                                                                                                                                                                                       | RV-A5                                                                                                                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Severity**                   | MEDIUM                                                                                                                                                                                                                                                      | MEDIUM                                                                                                                                                                                     |
| **Attack**                     | Strip the TrustedTime dependency entirely from `certificate-validity.ts` — no type import, no guard, `trustedInstant` returns the raw date — leaving the filename, exports and the word `TrustedTime` in the header comment                                 | Keep the imports and types; remove only the code that READS `.status`                                                                                                                      |
| **Actual result (before fix)** | `COMPLETE — 4/4`, exit 0. **Gate fooled.**                                                                                                                                                                                                                  | `COMPLETE — 4/4`, exit 0. **Gate fooled.**                                                                                                                                                 |
| **Expected**                   | `INCOMPLETE`, exit 1                                                                                                                                                                                                                                        | `INCOMPLETE`, exit 1                                                                                                                                                                       |
| **Root cause**                 | The check was `source.includes("TrustedTime")` over RAW source, so a comment satisfied it                                                                                                                                                                   | After stripping comments, the replacement check searched for `trustedInstant(` / `isRestricted(` — which the function DEFINITION matches, so a consumer could define a guard and ignore it |
| **Requirement**                | Owner instruction 2026-07-28: removing TrustedTime while leaving filenames intact must make the gate fail                                                                                                                                                   |
| **Blocking**                   | YES for the gate's own credibility — every other gate result depends on it                                                                                                                                                                                  |
| **Remediation**                | Comments are stripped before any check; the gate now requires the trusted-time IMPORT, the `TrustedTimeEvaluation` TYPE, and a read of `.status` off the evaluation. Reading the status is the one signal a file that dropped the dependency cannot produce |
| **Retest**                     | RV-A4 -> `INCOMPLETE — 3/4`, exit 1, `never reads .status off a trusted-time evaluation`. RV-A5 -> same. Baseline restored `COMPLETE — 4/4`, exit 0                                                                                                         |

**Condition C3 is CLOSED by this fix.** The gate no longer rests on a textual
symbol search. It remains true that a file could read `.status` and then
ignore the result; the cross-consumer test is the behavioural counterpart and
the two controls stay complementary.

**An honest note on process.** The original review reported "gate integrity:
HOLDS" on the strength of three probes, one of which (RV-A3) replaced a whole
file. That was too weak a test for the claim, and the owner's narrower probe
broke it twice. The verdict below is re-issued on the retested gate.

**Gate integrity: HOLDS.** No finding.

Residual, recorded not fixed: the symbol check is textual. A file could import
`TrustedTime` and then ignore it. What actually prevents that is the
cross-consumer test, which drives all four from one evaluator — a consumer that
ignored its input would fail there. The two controls are complementary and
neither alone is sufficient; that is stated so a future reader does not treat
the gate as proof of correct wiring.

---

## 3. Database layer

| Probe | Attack                                                               | Result                                                            |
| ----- | -------------------------------------------------------------------- | ----------------------------------------------------------------- |
| RV-B1 | `assert_trusted_time_v1` on a device whose status is `uninitialized` | **REFUSED** `KLUY-DEVICE-TIME-UNTRUSTED`                          |
| RV-B2 | Direct `UPDATE` moving `trusted_time_floor` backwards 10 days        | **REFUSED** `KLUY-DEVICE-TIME-ROLLBACK` (trigger, not convention) |
| RV-B3 | `emergency_time_correction_v1` with a fabricated approval uuid       | **REFUSED** `KLUY-DEVICE-TIME-CORRECTION-UNAPPROVED`              |
| RV-B4 | `service_role` calling the RAISING `activate_device_v1`              | **DENIED** `insufficient_privilege`                               |

Additionally verified from the committed assertion suite (section 30e), which
drives real `kitluy_auth` approval rows rather than a parallel concept:
an A2 risk class, an approval naming another device, a fully-approved BACKWARDS
correction and a SECOND use of a consumed approval are each refused with their
own code, and a REFUSED correction never consumes its approval.

**Database-owner vs application-role, stated explicitly.** RV-B2 and RV-B4 were
run as the database owner and as `service_role` respectively. The floor trigger
binds the owner too. The `activate_device_v1` revocation binds application roles
only — a superuser can still `GRANT` it back. That is the KLRISK-HUB-003 trust
boundary and is not a new finding; it is recorded so the guarantee is not
overstated as covering a database superuser.

**Database layer: HOLDS.** No finding.

---

## 4. TypeScript layer — TWO ATTACKS SUCCEEDED

### RV-TT-001 — `uninitialized` trusted-time evaluations were accepted as trusted

| Field                    | Value                                                                                                                                                                                                                                                                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Finding ID**           | RV-TT-001                                                                                                                                                                                                                                                                                                                                 |
| **Severity**             | HIGH                                                                                                                                                                                                                                                                                                                                      |
| **Attack performed**     | Constructed a `TrustedTimeEvaluation` with `status: "uninitialized"` carrying a non-null `trustedTime`, and passed it to `evaluateCertificateValidity`                                                                                                                                                                                    |
| **Actual result**        | `valid: true`. The certificate was accepted on a device that has NEVER established trusted time                                                                                                                                                                                                                                           |
| **Expected result**      | Refusal with `CERT_NO_TRUSTED_TIME`                                                                                                                                                                                                                                                                                                       |
| **Root cause**           | `trustedInstant()` returned a time whenever `!isRestricted(status)`. `uninitialized` is not restricted, so it fell through the gap between "restricted" and "trusted"                                                                                                                                                                     |
| **Affected requirement** | KLD-2026-07-28-002 §12.5 — a device without trustworthy time cannot activate offline; §12.6 — validity uses trusted time                                                                                                                                                                                                                  |
| **Cross-layer**          | **The SQL layer already refused this** (RV-B1). SQL and TypeScript disagreed — the C34/C35/C36 failure shape that WS-10 was bitten by                                                                                                                                                                                                     |
| **Reachability**         | `evaluateTrustedTime` never emits `uninitialized`, so no current code path reaches it. BUT `device_trusted_time.status` DEFAULTS to `uninitialized`, so any caller building an evaluation from stored state — a Hub agent rendering fleet status on boot, for instance — would hit it. Reachable by integration, not by the current tests |
| **Blocking**             | **YES.** A fail-open on the single question the whole module exists to answer                                                                                                                                                                                                                                                             |
| **Remediation**          | `trustedInstant()` now returns a time ONLY when `status === "trusted"`. Every other status, including `uninitialized`, yields null and every consumer reports `*_NO_TRUSTED_TIME`                                                                                                                                                         |
| **Retest evidence**      | Same forged evaluation: `CERT with uninitialized status -> false CERT_NO_TRUSTED_TIME`. Permanent regression added in `cross-consumer.test.ts` covering all four consumers, plus a conformance test asserting SQL and TypeScript agree. 168 tests pass                                                                                    |

### RV-TT-002 — the self-reported `restricted` flag is not authoritative (NOT a defect)

| Field                | Value                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Finding ID**       | RV-TT-002                                                                                                                                                          |
| **Severity**         | INFORMATIONAL                                                                                                                                                      |
| **Attack performed** | Forged an evaluation with `status: "restricted_clock_rollback"` but `restricted: false`                                                                            |
| **Actual result**    | **REFUSED** `CONFIG_RESTRICTED_TRUST_MODE` — consumers key off `status`, not the flag                                                                              |
| **Expected result**  | Refusal                                                                                                                                                            |
| **Blocking**         | No. Behaviour is correct                                                                                                                                           |
| **Recorded because** | The `restricted` boolean is redundant with `status` and is derivable from it. Carrying both invites a future caller to trust the wrong one. **Condition C1** below |

---

## 5. Consumer behaviour verified

Confirmed by executing the committed suites and reading each implementation in
full:

- **Revocation precedence over expiry** — a revoked AND lapsed certificate
  reports `CERT_REVOKED`. Reporting "expired" would understate the event.
- **Renewal at exactly ten days** — eligible. Inclusive boundary, deliberate.
- **Overlap > 3 days** — `RENEWAL_OVERLAP_EXCEEDED`, and it is checked BEFORE
  the window so a device past the limit is not told it is merely too early.
- **Stale but correctly signed revocation snapshot** — not accepted as current,
  enters restricted mode, and **still enforces its known revocations**. Verified
  the asymmetry is deliberate and that an INVALID-signature snapshot gets
  `enforceKnownRevocations: false`.
- **Configuration rollback to an unverified version** — refused
  `ROLLBACK_TARGET_UNVERIFIED`; state object is returned by identity, so a
  refusal cannot partially apply.
- **Wrong-purpose signer** — refused in all three signature-bearing consumers,
  including a signer whose signature verifies correctly.
- **Cross-environment artifact** — refused in all four.
- **Restricted mode affecting only some consumers** — attacked via the
  cross-consumer suite: rollback, forward jump and RTC failure each restrict ALL
  four, and recovery restores them together.

---

## 6. Conditions attached

| ID  | Condition                                                                                                                                                                                                                                                                                                                                                                               | Owed by  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| C1  | Remove the redundant `restricted` boolean from `TrustedTimeEvaluation`, or make it a derived accessor. Two sources of truth for one fact is how RV-TT-001 happened in the first place                                                                                                                                                                                                   | Step 4   |
| C2  | The database `emergency_time_correction_v1` does not enforce the A3/A4 risk class in the same expression as the TypeScript validator — it delegates to `evaluate_time_correction_approval_v1`, which does. Verified equivalent, but the conformance test currently asserts the DB _lacks_ the code string. Tighten that assertion to compare BEHAVIOUR once a SQL-driven harness exists | T007     |
| C3  | The clock gate's `TrustedTime` symbol check is textual. Keep the cross-consumer test as the behavioural counterpart and never treat the gate alone as proof of wiring                                                                                                                                                                                                                   | standing |
| C4  | No signature verification is real anywhere in this change set. Every `signatureValid` is an INPUT supplied by the caller, and `signature_verified` is false on every trust-policy row. This is correct while the signer does not exist, and must be revisited when step 6 lands                                                                                                         | Step 6   |

---

## 7. What this review does NOT cover

- **No production or pilot path was reviewed** — none exists. Both remain
  BLOCKED and the review makes no statement about them.
- **No real cryptography** was exercised. The token verifier was driven with a
  deterministic preimage-equality scheme, which proves the verifier checks the
  signature over the correct preimage and nothing about algorithm strength.
- **No concurrent database sessions.** Parallel floor advancement was verified
  in TypeScript against an in-memory store; the SQL `for update` path was read,
  not raced. Owed to T007.
- **No hardware.** No RTC, no TPM, no secure element exists to test against.

---

## Verdict

```text
APPROVED-WITH-CONDITIONS
```

One HIGH, blocking finding (RV-TT-001) was found by attack, fixed, and retested
with a permanent regression plus a cross-layer conformance assertion. The gate
resisted all three integrity attacks including a correctly-named stub. The
database layer resisted every probe.

Conditions C1–C4 are carried forward and are not blocking for Step 2, because
none of them is a fail-open in the reviewed behaviour: C1 and C3 are
defence-in-depth, C2 is an assertion-quality issue over verified-equivalent
behaviour, and C4 is a correctly-recorded absence rather than a defect.

**This verdict authorizes recording `WS-11-T003 Step 2 — IMPLEMENTED-IN-DEV`
and nothing else.** WS-11 overall stays SCAFFOLDED / IN PROGRESS; pilot
activation, production activation, production signer and TPM/secure-element
certification all remain BLOCKED.
