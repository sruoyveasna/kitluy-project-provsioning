# Hardware activation evidence — Store Hub first ACTIVE

**Fill this in DURING the run, not from memory afterwards.** An evidence record
written from recollection is a summary, not evidence.

**Status of this copy: TEMPLATE — NOT EXECUTED.**

---

## Rules for this document

- **NO private keys.** Record the operational key's FINGERPRINT only.
- **NO bearer tokens, passwords, DSNs or service-role secrets.**
- Where a value is unknown, write `NOT OBSERVED` — never a plausible guess.
- Where a step was not run, write `NOT EXECUTED` — never leave it blank.
- A field you cannot fill honestly is itself a finding.

---

## 1. Provenance

| Field                                         | Value                                              |
| --------------------------------------------- | -------------------------------------------------- |
| Image artifact path                           |                                                    |
| Image SHA-256                                 |                                                    |
| Image build timestamp                         |                                                    |
| Builder version                               |                                                    |
| Git HEAD at build                             |                                                    |
| Working tree dirty at build?                  |                                                    |
| Hosted development migration head at run time |                                                    |
| Local schema head expected by the client      | `0212`                                             |
| Runbook version                               | `kitluy-store-hub-first-activation-runbook-v1.0.0` |

## 2. Board and identity

| Field                           | Value             |
| ------------------------------- | ----------------- |
| Board asset tag                 | `KL-6CBB3BC0D49B` |
| Device record id                |                   |
| Installation id                 |                   |
| Installation generation         |                   |
| machine-id (first 8 chars only) |                   |
| Boot timestamp (device)         |                   |

## 3. Lifecycle — SIX DISTINCT FACTS

Record each separately. Do not collapse them: a device can be registered and
unapproved, or approved and unpaired, and a record that merges them cannot be
audited.

| Step                 | Result | Timestamp | Notes |
| -------------------- | ------ | --------- | ----- |
| Registration         |        |           |       |
| HET approval         |        |           |       |
| Store pairing        |        |           |       |
| Trusted time         |        |           |       |
| Certificate issuance |        |           |       |
| Activation           |        |           |       |

| Field               | Value |
| ------------------- | ----- |
| Digital Store       |       |
| Store Location      |       |
| Trusted-time status |       |
| Trusted-time source |       |

## 4. Operational TLS credential

| Field                                         | Value |
| --------------------------------------------- | ----- |
| Operational key fingerprint (SHA-256 of SPKI) |       |
| Key generated on device? (yes/no)             |       |
| Key file mode                                 |       |
| Directory mode                                |       |
| Credential id                                 |       |
| Credential generation                         |       |
| Certificate serial (`DEV-…`)                  |       |
| Certificate X.509 serial (hex)                |       |
| Certificate SHA-256                           |       |
| notBefore                                     |       |
| notAfter                                      |       |
| All 17 local checks passed?                   |       |
| Adoption timestamp                            |       |

> The private key stays on the Pi. If this section contains a `BEGIN PRIVATE KEY`
> block, the run has failed its own safety rules and the key must be treated as
> compromised.

## 5. Hosted authority verification

Read-only, after activation.

| Check                                | Expected | Observed |
| ------------------------------------ | -------- | -------- |
| governed credentials for this device | 1        |          |
| live generation keys                 | 1        |          |
| active operational certificates      | 1        |          |
| Store/Location assignment correct    | yes      |          |
| trusted-time evidence present        | yes      |          |
| lifecycle state                      | `active` |          |

## 6. Reboot with WAN

| Check                   | Expected | Observed |
| ----------------------- | -------- | -------- |
| Hub returns to `active` | yes      |          |
| same key reused         | yes      |          |
| same certificate reused | yes      |          |
| new generation created  | **no**   |          |

## 7. WAN-OFFLINE reboot — the shop property

| Check                                  | Expected | Observed |
| -------------------------------------- | -------- | -------- |
| Hub boots with no WAN                  | yes      |          |
| operational identity loads locally     | yes      |          |
| certificate-issuance network call made | **none** |          |
| new generation created                 | **no**   |          |
| cloud reachable during the test        | no       |          |
| credentials unchanged afterwards       | yes      |          |

Evidence of "no network call" (log excerpt, `already adopted` line, or packet
capture):

```

```

## 8. Failures and retries

| #   | Step | Symptom | Refusal code | Action taken | Outcome |
| --- | ---- | ------- | ------------ | ------------ | ------- |

A run with zero failures recorded and no explanation of why is less credible
than one that records them.

## 9. Sign-off

| Role                                | Name | Date |
| ----------------------------------- | ---- | ---- |
| Operator                            |      |      |
| Reviewer (must not be the operator) |      |      |

## 10. Status claimed

Tick only what the evidence above supports.

- [ ] `BUILT` — the image exists and its gates passed
- [ ] `TESTED` — software suites green
- [ ] `IMPLEMENTED-IN-DEV` — proven in development, no hardware
- [ ] `HARDWARE_E2E` — **a real Pi executed this and reached ACTIVE**

`HARDWARE_E2E` requires sections 2 through 7 to be complete with observed
values. Anything less is not that claim.
