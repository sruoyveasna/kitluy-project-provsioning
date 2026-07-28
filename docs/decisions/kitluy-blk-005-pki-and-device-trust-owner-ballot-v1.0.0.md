# KitLuy BLK-005 — PKI, Device Trust and Signing-Key Custody Owner/Security Ballot

**Filename:** `kitluy-blk-005-pki-and-device-trust-owner-ballot-v1.0.0.md`
**Version:** v1.0.0
**Date:** 2026-07-28
**Owner:** HET / KitLuy Suite Project Owner (security decisions)
**Status:** **DECIDED — OWNER-APPROVED 2026-07-28 as `KLD-2026-07-28-002`.** All twelve items ruled. Decision record: `kitluy-blk-005-pki-and-device-trust-owner-decision-v1.0.0.md`. **BLK-005 decision values are RESOLVED; BLK-005 IMPLEMENTATION is PENDING.** Item 4 carries a hardware sub-gate (the TPM/secure-element SKU is not yet selected), and item 10 leaves KLRISK-DEVICE-002 open until the restricted-investigation state, station containment and runbook are implemented and independently tested.
**Blocks:** WS-11 steps 2 and 8; production device activation; WS-10 production signer; the whole of pilot and production device trust
**Evidence discipline:** approving this ballot resolves a DECISION blockage only. It is not implementation evidence (KLD-EVIDENCE-001). WS-11 cannot become `IMPLEMENTED-IN-DEV` until the approved design is implemented, tested and independently reviewed.

> Each item states a recommendation, what approval would bind, and the
> alternative, so a strike-and-choose is possible without reopening the
> analysis. Twelve items, in the owner's stated order.

---

## Why this ballot exists now

WS-11-T001 (Cycle 10) built everything that does **not** require a cryptographic
decision: manufacturing enrollment records, the immutable device identity, the
hardware-evidence inventory, the enrollment/quarantine/retirement/replacement
state machines, the abstract PKI/attestation/signing interfaces, and fail-closed
tests proving that unresolved cryptographic configuration cannot activate a
device.

Everything that **does** require a cryptographic decision is refused at a single
gate rather than guessed:

    kitluy_devices.pki_trust_configuration   -- created EMPTY, never seeded
    kitluy_devices.assert_pki_configuration_approved(environment)
      -> raises KLUY-DEVICE-PKI-UNCONFIGURED: [REQUIRED: ...] — BLK-005 is OPEN

Verified 2026-07-28: activation and certificate issuance fail closed in all
three environments, no device is `active`, and zero certificate rows exist.

**The gate cannot be opened by an agent.** The database refuses a configuration
whose `approved_by_decision_ref` is blank, a placeholder, or an unresolved
`[REQUIRED: ...]` marker. It has to name a real decision — this one.

---

## What is already structurally decided (not on this ballot)

These are enforced by database constraints in migration group 0120. They are
recorded here so the ballot does not accidentally reopen them:

| Already binding                                                                                      | Enforced by                                                   |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Device identity is an opaque uuid, never derived from MAC/serial/board values                        | `devices.id`, and no derivation path anywhere in the schema   |
| Hardware values are binding/tamper SIGNALS; a change quarantines and requires re-enrollment          | `record_hardware_observation_v1`, `device_trust_incidents`    |
| Device identity, configuration signing, release signing and transport signing are four separate keys | `pki_trust_configuration_key_separation_chk`                  |
| The offline root never doubles as the device-issuing or manufacturing CA                             | `pki_trust_configuration_ca_separation_chk`                   |
| A renewal or overlap window must fit inside the certificate lifetime                                 | `pki_trust_configuration_lifetime_chk`                        |
| Private keys are never copied from a damaged storage device                                          | `device_replacements_no_key_carryover_chk`                    |
| Enrollment records the device PUBLIC-key fingerprint only                                            | `manufacturing_enrollments`, which has no key-material column |

The ballot decides the **values**, not whether these rules hold.

---

## Recommended trust separation (owner-stated, 2026-07-28)

```text
Offline root CA
├── Internal manufacturing intermediate
├── Production device-identity intermediate
├── Pilot device-identity intermediate
└── Development device-identity intermediate

Separate keys:
- device identity
- configuration signing
- software release signing
- WS-10 transport signing
```

One certificate or signing key is never reused across these purposes.

---

## ☐ Item 1 — PKI hierarchy and environment separation

**Recommendation:** adopt the owner-stated hierarchy above verbatim: one offline
root, one internal manufacturing intermediate, and **three separate**
device-identity intermediates (production, pilot, development).

Binds: a development device can never present a certificate that a production
Hub or the cloud Edge API accepts; a pilot programme cannot silently become
production by reusing a certificate; compromise of the development intermediate
is contained to development. `kitluy_devices.pki_trust_configuration` carries one
active row per environment, and the environment is part of every certificate's
identity.

Alternative: a single device-identity intermediate with environment encoded only
as a certificate claim. Cheaper to operate, but it makes environment separation a
policy check rather than a cryptographic boundary, and one compromised
intermediate then reaches production.

**Required value if approved:** `[REQUIRED: root and intermediate CA naming, key algorithm and key size per tier]`

---

## ☐ Item 2 — Offline-root custody

**Recommendation:** the root private key is generated and stored offline, never
on a network-attached host, with a documented dual-control ceremony for every
use (root usage is limited to signing intermediates and CRLs for intermediates).

Binds: root ceremonies are scheduled events with named participants and a
written record, not an operational task. Intermediate issuance becomes a
planned activity, which is why intermediate lifetimes (item 5) matter.

Alternative: an HSM-resident online root with hardware access control. Faster to
operate; a larger blast radius and a continuously reachable root.

**Required values if approved:** `[REQUIRED: root key custody medium (HSM model / offline media), physical storage location, dual-control participant roles, ceremony record location]`

---

## ☐ Item 3 — Intermediate and device-issuing CA ownership

**Recommendation:** HET owns and operates every intermediate. The device-issuing
CA runs as a service identity with no interactive login, and issuance is only
reachable through the provisioning service — never from an operator workstation
and never from the Admin Portal.

Binds: the security invariant already in the trust policy — "No browser, POS
client, Storefront, connector, or ordinary operator receives ... CA private
keys". Certificate issuance becomes an audited service action, so every issued
certificate has a request record and an actor.

Alternative: a managed/third-party CA for device identity. Removes custody
burden; introduces an external dependency in the offline-first path and a
third-party in the device trust root.

**Required values if approved:** `[REQUIRED: intermediate CA hosting model, service-identity name, issuance authorization path, four-eyes requirement for issuance]`

---

## ☐ Item 4 — Device private-key generation and hardware-backed storage

**Recommendation:** the device generates its own key pair **on the device**, in
non-exportable storage where the hardware supports it. `software` key storage is
permitted **only** in development and is recorded as an explicit weakness on
every affected enrollment.

Binds: what is already implemented — `manufacturing_enrollments.key_storage_class`
records where the key lives, and `issue_device_certificate_v1` refuses to issue
when the enrollment's storage class does not meet the environment's requirement.
Approving this item sets `required_key_storage_class` per environment.

This item is **blocked in turn** on the reference-hardware decision: Raspberry Pi
boards do not all carry a TPM or secure element, and a decision to require one
is a bill-of-materials decision, not only a security decision.

Alternative: software keys with full-disk encryption in pilot and production.
Materially weaker — a copied NVMe image then carries a usable private key, which
is precisely the clone case the trust policy §8 exists to defend against.

**Required values if approved:** `[REQUIRED: TPM/secure-element reference hardware decision and part number]`, `[REQUIRED: required_key_storage_class per environment]`, `[REQUIRED: secure boot and disk encryption implementation profile]`

---

## ☐ Item 5 — Device certificate lifetime, renewal and overlap windows

**Recommendation:** decide three numbers per environment — lifetime, renewal
window and overlap window — with the renewal window comfortably longer than the
longest expected offline period, so a Store that is offline for a normal outage
never lands in restricted mode.

Binds: `certificate_lifetime_days`, `renewal_window_days`, `overlap_window_days`.
The database already refuses windows that do not fit inside the lifetime. Short
lifetimes reduce the value of a stolen key; they also increase the chance a
poorly-connected Cambodian Store hits expiry during an outage, so this is a real
trade-off, not a "shorter is better" choice.

Alternative: long device lifetimes (multi-year) with aggressive revocation.
Shifts the whole burden onto item 6, which is the item most likely to fail
offline.

**Required values if approved:** `[REQUIRED: certificate lifetime, renewal window and overlap window per environment]`, `[REQUIRED: intermediate CA lifetimes]`

---

## ☐ Item 6 — Revocation mechanism and offline revocation behavior

**Recommendation:** a signed, versioned, short-lived revocation list distributed
inside the existing signed configuration/trust-bundle channel — not OCSP. The
Store Hub is designed to keep operating through internet failure, and an
online-only revocation check either fails open (unacceptable) or takes the
Store down (also unacceptable).

Binds: revocation is a data distribution problem on the WS-10 path, with an
explicit staleness bound. A Hub that has not received a fresh revocation list
within the bound enters a defined restricted mode rather than assuming
everything is still valid.

**This is the item that most needs an owner ruling on business risk**, because
it decides what a Store does when it cannot reach the cloud and a device may
have been revoked. The trust policy already refuses to guess: "Offline devices
that exceed grace/expiry enter restricted mode according to `[REQUIRED: offline
certificate grace policy]`; they do not silently gain perpetual trust."

Alternative: OCSP with a hard-fail online requirement. Cryptographically
cleaner; incompatible with the offline-first product promise.

**Required values if approved:** `[REQUIRED: revocation distribution mechanism]`, `[REQUIRED: revocation list freshness bound and offline grace policy]`, `[REQUIRED: restricted-mode capability set — what a Store can still do]`

---

## ☐ Item 7 — Configuration-signing and release-signing key separation

**Recommendation:** four separate keys, per the owner's stated separation:
device identity, configuration signing, software release signing, WS-10
transport signing. Already enforced structurally; this item confirms it and
assigns custody per key.

Binds: a compromised configuration signer cannot ship software; a compromised
release signer cannot rewrite permissions or pricing configuration; neither can
impersonate a device or forge a sync batch.

Alternative: one platform signing key with usage constraints in the certificate.
Simpler custody; one compromise reaches every trust path at once.

**Required values if approved:** `[REQUIRED: custody model per signing key]`, `[REQUIRED: which keys are HSM-resident]`

---

## ☐ Item 8 — Production signer custody and four-eyes access

**Recommendation:** production signing keys are HSM-resident and require
four-eyes authorization for every use, through `@kitluy/approvals`, consistent
with KL-INF-P1-037's treatment of production migrations as human-operated
under four-eyes.

Binds: **this is the item WS-10 is waiting on.** WS-10 implements signed
Hub-to-cloud transmission and signed configuration publication, and deliberately
did not invent a production batch signer. Until this item is ruled, WS-10 has no
production signer and its production status stays blocked regardless of how
complete its development implementation is.

Alternative: an automated production signer with audit logging and no human in
the loop. Necessary if signing volume is high; signing volume here is low
(configuration publications and batch envelopes), so the automation argument is
weak.

**Required values if approved:** `[REQUIRED: production signer custody medium]`, `[REQUIRED: four-eyes approver roles for signing]`, `[REQUIRED: emergency signing procedure and its approval path]`

---

## ☐ Item 9 — Manufacturing identity and hardware-evidence requirements

**Recommendation:** confirm the evidence set that a manufacturing enrollment must
capture per hardware profile, and confirm that a manufacturing certificate is
issued at enrollment from the manufacturing intermediate.

Binds: `hardware_profiles.required_signal_types` — already implemented and
enforced, so an enrollment that does not present the profile's required evidence
is refused. This item decides the CONTENT of that list per profile: which of
`mac_address`, `board_serial`, `soc_serial`, `tpm_ek_public`,
`secure_element_id`, `storage_serial`, `storage_model`, `boot_measurement`,
`os_image_digest` are mandatory.

Alternative: a minimal evidence set (serial only). Faster manufacturing;
materially weaker clone and tamper detection, since clone defense is exactly the
comparison of these signals.

**Required values if approved:** `[REQUIRED: required evidence set per hardware profile]`, `[REQUIRED: approved manufacturing station identities and operator authorization]`

---

## ☐ Item 10 — NVMe, Pi, and complete-device replacement policies

**Recommendation:** adopt the owner-stated replacement order as policy, which is
already implemented as the recorded fact sequence in
`kitluy_devices.device_replacements`:

```text
old certificate revoked
old assignment generation invalidated
replacement recorded by authorized internal operator
new key pair generated
new certificate issued
new evidence captured
device reactivated through the normal approval flow
```

Binds: private keys are never copied from the damaged storage device — pinned
`false` by a check constraint, not by convention. A storage-module-only evidence
change is recognised as the NVMe-replacement signature and still quarantines
until an authorized operator records the replacement.

Open question for the owner: whether field NVMe replacement is permitted at all,
or whether the trust policy's preference for "replacement with an HET-managed
spare Hub" is the only supported path in Cambodia given repair logistics.

**Required values if approved:** `[REQUIRED: whether field NVMe replacement is permitted, and by whom]`, `[REQUIRED: RMA authorization roles]`, `[REQUIRED: spare-Hub inventory policy per region]`

---

## ☐ Item 11 — Clock bootstrap and certificate-validation behavior when offline

**Recommendation (owner-specified 2026-07-28): approve ALL THREE, not a choice
between them.**

```text
hardware RTC
+ authenticated network time when available
+ persisted monotonic trusted-time floor
```

### Required behavior, to be bound by this decision

1. The Hub **never moves trusted time backwards.**
2. Certificate validation uses the **maximum** of RTC time, authenticated time
   and the persisted floor.
3. A new device **without sufficiently trustworthy time cannot activate
   offline.**
4. Loss of WAN **after** activation may continue only within an approved signed
   offline-validity policy.
5. Clock rollback or RTC tampering moves the Hub into a **restricted safety
   state.**
6. Emergency time override requires **reason, approval and immutable audit.**

Point 2 is the load-bearing one: taking the maximum means an attacker must
defeat every source at once to move time backwards, and a single failed source
degrades availability rather than trust.

Point 3 has a cost worth stating plainly: a Hub that arrives at a Store with no
WAN and a dead RTC battery **cannot be commissioned on site**. That is the
correct trade — a device that cannot tell the time cannot check whether its
certificate is valid — but it is an operational constraint on Cambodian field
deployment, not only a security property.

**Original framing, retained:** decide how a Store Hub establishes trusted time
before it can validate a certificate, and what it does when it cannot.

Binds: this is a genuine bootstrap problem and it is currently unaddressed
anywhere in the repository. Certificate validity is a time window; a Raspberry Pi
without a battery-backed RTC boots with an untrusted clock; NTP is an
unauthenticated network service and may be unreachable during exactly the
outage that matters. A Hub that trusts a wrong clock can accept an expired
certificate or reject a valid one.

Recommended shape: a battery-backed RTC in the hardware profile, plus a
monotonic "never go backwards" floor persisted locally, plus signed time in the
configuration/trust bundle. If none of those is available, the Hub enters the
same restricted mode as item 6 rather than guessing.

Alternative: trust the system clock and accept the risk. Cheapest; makes
certificate expiry advisory rather than enforced.

Alternative: trust the system clock and accept the risk. Cheapest; makes
certificate expiry advisory rather than enforced, which means revocation and
lifetime (items 5 and 6) become advisory too.

**Required values if approved:** `[REQUIRED: RTC part and battery life in the hardware profile]`, `[REQUIRED: authenticated time source and its trust anchor]`, `[REQUIRED: monotonic floor persistence location and tamper protection]`, `[REQUIRED: maximum offline validity window]`, `[REQUIRED: restricted safety-state capability set]`, `[REQUIRED: emergency time-override approval roles]`

---

## ☐ Item 12 — Emergency recovery, compromise and CA-rotation procedures

**Recommendation:** a written procedure per compromise class, decided before it
is needed: device key compromise, device-issuing intermediate compromise,
manufacturing intermediate compromise, root compromise, and signing-key
compromise.

Binds: intermediate rotation must be possible without re-manufacturing the
fleet, which means devices must be able to receive a new trust bundle through a
path that does not depend on the compromised intermediate. That is a design
constraint on items 1 and 6, not a runbook detail — which is why it is on this
ballot rather than deferred to operations.

Alternative: decide the procedure when an incident happens. Every hour spent
designing rotation during an incident is an hour of Stores unable to operate.

**Required values if approved:** `[REQUIRED: compromise response procedure per class]`, `[REQUIRED: CA rotation mechanism and its trust path]`, `[REQUIRED: incident authority and decision roles]`

---

---

## What the decision must BIND (owner-specified 2026-07-28)

Approving this ballot is not a direction of travel. The decision has to bind
these twelve implementation values, because each one is something the code
currently refuses to guess:

| #   | Value the decision must bind                                                                              | Ballot item |
| --- | --------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | PKI hierarchy: offline root plus SEPARATE development, pilot, production and manufacturing intermediates  | 1           |
| 2   | Root custody: offline, dual-control access, documented ceremony and recovery shares                       | 2           |
| 3   | Device keys generated ON-DEVICE; private keys non-exportable where supported                              | 4           |
| 4   | Hardware custody: the required TPM or secure-element model, chosen BEFORE the production BOM is certified | 4           |
| 5   | Certificate windows: device lifetime, renewal threshold, overlap and maximum offline validity             | 5           |
| 6   | Revocation: cloud registry, signed revocation snapshots and offline behavior                              | 6           |
| 7   | Signer separation: independent device-identity, configuration, release and WS-10 transport keys           | 7           |
| 8   | Production signer custody: HSM or equivalent controlled signer with four-eyes authorization               | 8           |
| 9   | Manufacturing evidence: required board, storage, key and enrollment-station evidence                      | 9           |
| 10  | Replacement policy: Pi replacement, NVMe replacement and complete-unit replacement                        | 10          |
| 11  | Trusted time: RTC requirement, authenticated time bootstrap and rollback-resistant time floor             | 11          |
| 12  | Compromise response: emergency revocation, CA rotation, recovery and forced reprovisioning                | 12          |

Value 4 is the one with a lead time attached: it is a **bill-of-materials**
decision, so it has to be settled before hardware is ordered, not before
software is written.

Value 9 gains weight from **KLRISK-DEVICE-002**: enrollment-station evidence is
what would let the duplicate-evidence denial-of-service path be attributed to a
station and contained, and four of that risk's seven recommended controls depend
on this ballot.

## Status while this ballot is open

```text
certificate issuance   — BLOCKED
production activation  — BLOCKED
production signer      — BLOCKED
WS-11 promotion        — BLOCKED
```

Verified in the database, not asserted in prose: `pki_trust_configuration` is
empty, activation refuses in all three environments, zero devices are `active`,
zero certificates exist, and no offline assignment projection has ever been
written.

## Dependency notes for the owner

- **Item 4 is a bill-of-materials decision** as much as a security one. It cannot
  be ruled without deciding the reference hardware, and it gates item 5's
  usefulness (long lifetimes are less dangerous with non-exportable keys).
- **Items 6 and 11 are the two items that decide what a Cambodian Store does
  during an internet outage.** They are the commercial risk items on this ballot,
  not the cryptographic ones.
- **Item 8 is what WS-10 is waiting on.** Ruling it unblocks the WS-10 production
  signer; leaving it open keeps WS-10 development-only regardless of its
  implementation quality.
- Items 1, 2, 3, 7 can be ruled independently of the rest and would unblock the
  development-environment device trust chain on its own.

## Cycle-10 progress against this gate

```text
WS-11        — SCAFFOLDED / IN PROGRESS (T002 of 8 complete)
BLK-005      — OPEN; this ballot awaits owner/security decision
```

T001 and T002 may be, and were, completed and committed with evidence. **T003
(certificate issuance, signer custody, production activation) does not begin
until this ballot is approved.** WS-11 cannot become `IMPLEMENTED-IN-DEV` until
the approved cryptographic design is implemented and independently tested.
