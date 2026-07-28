# KitLuy PKI, Device Trust and Signing-Key Owner Decision

**Filename:** `kitluy-blk-005-pki-and-device-trust-owner-decision-v1.0.0.md`
**Decision ID:** `KLD-2026-07-28-002`
**Task:** `BLK-005`
**Decision date:** 2026-07-28
**Owner:** KitLuy Project Owner
**Status:** **OWNER-APPROVED**
**Applies to:** WS-10 signing, WS-11 device provisioning, Store Hub activation, configuration trust and release trust
**Source ballot:** `kitluy-blk-005-pki-and-device-trust-owner-ballot-v1.0.0.md`

> This document records the owner's ruling. Sections 1-15 are the DECISION.
> The "Implementation impact" notes at the end are the build agent's reading of
> what the ruling changes in the repository, and carry no authority of their own.

## Evidence boundary (owner-stated)

This decision approves the required trust architecture and policy values.
It does **not** prove that:

- a production CA exists;
- production keys are in an HSM;
- production Store Hubs have TPMs or RTCs;
- certificates have been issued;
- production activation works;
- production signing works;
- WS-11 is implemented or deployable.

All implementation, hardware, security-test and independent-review evidence
remains required.

---

## 1. PKI hierarchy and environment separation — **APPROVED**

Offline root CA with purpose- and environment-separated intermediates.

```text
KitLuy Offline Root CA
├── Manufacturing Enrollment Intermediate
├── Development Device Identity Intermediate
├── Pilot Device Identity Intermediate
└── Production Device Identity Intermediate
```

Separate key pairs and separate governed signer identities for:

```text
device identity certificates
configuration snapshots
software releases
WS-10 transport batches
manufacturing enrollment
emergency recovery artifacts
```

A key used for one purpose must not be reused for another. Development, pilot
and production trust chains remain isolated; a development or pilot certificate
must never authenticate to production. The root CA must not issue device
certificates directly.

## 2. Offline-root custody — **APPROVED**

Root CA is offline, used only during governed ceremonies.

```text
two-of-three custodian authorization
separate named custodians
separate physical storage locations
encrypted offline key material
documented key ceremony
recorded artifact checksums
witnessed issuance and rotation
tamper-evident storage
tested recovery procedure
immutable ceremony record
```

No single employee, service account or online system may use the root key
independently. The root key must not be stored in application environment
variables, CI/CD secrets, a Store Hub, a terminal, a developer workstation, or
the operational production database.

## 3. Intermediate and issuing-CA custody — **APPROVED**

Development issuing keys may use a software-backed development signer, provided
they are unmistakably marked non-production. Pilot and production issuing keys
must use an HSM, a managed key service with equivalent non-exportability, or an
approved offline signing appliance.

Production device issuance requires: named operator, approved request, reason,
four-eyes authorization, short-lived privileged session, immutable audit, and
certificate-to-request linkage. Production issuing keys must be non-exportable.
No application service may receive raw production CA private-key material.

## 4. Device private-key generation and hardware storage — **APPROVED WITH HARDWARE GATE**

Device identity private keys are generated **on the Store Hub device**, never
generated centrally and copied onto the Hub.

Production-certified hardware requires TPM 2.0 or an approved secure element,
non-exportable private key, hardware-backed signing, and internally enrolled
device public key plus hardware evidence.

A software-backed key provider is permitted **only** for local development,
automated tests and non-production simulation. Such devices are marked:

```text
hardware_trust_level = development_software
production_eligible = false
```

The production Bill of Materials must select and certify a specific TPM 2.0 or
secure-element SKU before pilot hardware is approved. Until that SKU is approved
and tested:

```text
pilot hardware certification — BLOCKED
production hardware certification — BLOCKED
```

**This SKU sub-gate does not block development of the provider interface,
lifecycle or test doubles.**

## 5. Device-certificate lifetime and renewal — **APPROVED**

| Environment | Certificate lifetime |        Renewal begins | Maximum overlap |
| ----------- | -------------------: | --------------------: | --------------: |
| Development |              30 days | 10 days before expiry |          3 days |
| Pilot       |             180 days | 60 days before expiry |         14 days |
| Production  |             365 days | 90 days before expiry |         14 days |

1. Renewal creates a new key pair unless an approved hardware-backed rotation
   policy explicitly permits reuse.
2. The old certificate remains valid only within the approved overlap window.
3. Expired certificates fail closed.
4. A revoked certificate remains invalid even when its expiry has not passed.
5. Certificate renewal does not change `device_record_id`.
6. Assignment generation and certificate generation remain separately versioned.
7. A certificate cannot widen Tenant, Digital Store or Location scope.
8. Production certificates include the immutable device identity and
   environment, but must not encode mutable business assignments as permanent
   identity attributes.

## 6. Revocation and offline behavior — **APPROVED**

The cloud maintains the authoritative certificate and device-revocation
registry. Store Hubs receive **signed revocation snapshots** through the
governed configuration-publication channel.

Required local record: snapshot version, `issued_at`, `valid_until`, issuer,
payload checksum, signature, revoked certificate identifiers, revoked device
identifiers, revocation reason, effective time.

| Environment | Target refresh | Maximum snapshot age |
| ----------- | -------------: | -------------------: |
| Development |         7 days |              30 days |
| Pilot       |       24 hours |              14 days |
| Production  |       24 hours |              14 days |

When WAN is unavailable:

1. A locally known revocation is enforced immediately.
2. Existing Store operations may continue while the device certificate is valid
   and the signed revocation snapshot is within its maximum age.
3. When the snapshot exceeds its maximum age, the Hub enters **restricted
   offline trust mode**.
4. Restricted mode blocks: provisioning; new assignment activation; certificate
   issuance or renewal; support access; trust-policy changes; configuration
   signer changes; release promotion; security-sensitive administrative actions.
5. Existing locally authorized Laundry operations may continue according to the
   last valid signed configuration and assignment snapshot.
6. Restricted operation must be visibly reported and audited.
7. **No stale snapshot may be represented as current.**
8. Restoration of trust-changing operations requires a fresh valid snapshot.

## 7. Signing-key separation — **APPROVED**

Separate keys: device identity CA, configuration signing, software release
signing, WS-10 transport signing, manufacturing enrollment, emergency recovery.

Each has a separate key identifier, access policy, rotation schedule, audit
trail, revocation process and verification purpose.

**A verifier must reject an otherwise valid signature when the signing key is
not authorized for the artifact purpose.** Cross-purpose signing is prohibited.

## 8. Production signer custody — **APPROVED**

Production configuration, release and WS-10 signing require controlled signers
backed by an HSM or equivalent non-exportable managed-key service.

```text
A4_OWNER_SECURITY risk class
four-eyes approval
no self-approval
production re-authentication
mandatory reason
short-lived authorization
artifact checksum presented before approval
immutable signing audit
signer key ID recorded
signature verification after signing
rate and anomaly monitoring
emergency disable capability
```

Application services may request signatures through a narrow signing API. They
must not read, export or receive the private key.

The WS-10 production signer remains BLOCKED until: the selected signer backend
exists; key creation ceremony is evidenced; access controls are tested;
four-eyes workflow is tested; rotation and revocation are tested; independent
security review approves.

## 9. Manufacturing and enrollment evidence — **APPROVED**

Every internally enrolled Store Hub requires an immutable enrollment record
containing applicable: `device_record_id`; device class; manufacturer and part
references; KitLuy inventory or asset number; Raspberry Pi board serial;
network-interface identifiers; TPM endorsement-key fingerprint or secure-element
identity; device public-key fingerprint; NVMe manufacturer, model and serial;
bootloader and firmware versions; KitLuy OS image version; KitLuy OS image
checksum; secure-boot or measured-boot evidence where supported; manufacturing
batch; enrollment-station identity; enrollment-station certificate; operator
identity; enrollment time; evidence manifest checksum; photographic or
physical-inspection reference where required.

Hardware signals are binding and tamper evidence. **They are not the primary
device identity.** The primary identity remains the opaque KitLuy
`device_record_id`.

## 10. Duplicate-evidence and KLRISK-DEVICE-002 policy — **APPROVED WITH CONTROLLED CONTAINMENT**

A newly enrolled identity duplicating existing hardware evidence is quarantined
immediately. The incumbent **must not** be automatically moved from active
operation into full quarantine solely because a duplicate enrollment was
submitted.

```text
new identity:        quarantined
incumbent identity:  restricted_investigation
```

The incumbent may be fully quarantined immediately only when one of these is
true:

```text
cryptographic evidence indicates private-key compromise
the active device presents the duplicate identity
the enrollment station is already revoked or compromised
an A3/A4 authorized operator approves containment
```

1. A critical trust incident is created atomically.
2. The enrollment station and named operator are recorded.
3. Repeated duplicate submissions from the same station automatically quarantine
   that station.
4. Trust-changing operations on the incumbent are blocked during investigation.
5. Existing store operations may continue only under the restricted-investigation
   policy.
6. Resolution requires physical evidence inspection.
7. Resolution requires a signed disposition and immutable audit.
8. A false-positive disposition must not delete the incident.
9. A confirmed clone must revoke the cloned credentials and trigger key rotation
   or replacement.
10. No identity is silently merged into another.

Required runbook classifications: device cloning; refurbished hardware; approved
board replacement; approved NVMe replacement; data-entry or enrollment error;
malicious enrollment; enrollment-station compromise.

**KLRISK-DEVICE-002 remains OPEN until the restricted-investigation state,
station containment and runbook are implemented and independently tested.**

## 11. Replacement policy — **APPROVED**

### NVMe replacement

The same `device_record_id` may be retained **only** when: Pi board identity
matches; TPM or secure-element identity matches; repair is opened by an
authorized internal operator; physical inspection passes; replacement is
recorded.

```text
old device certificate revoked
old assignment generation invalidated
old storage evidence retained
new NVMe evidence recorded
new device key pair generated
new device certificate issued
new assignment generation issued
normal activation flow completed
```

Private keys must not be copied from the damaged or previous NVMe.

### Pi board or TPM replacement

Creates a **new `device_record_id`**. The old device is retired and revoked.
Business assignment may be transferred only through the governed claim and
activation flow.

### Complete-unit replacement

Always receives a new identity, key pair, certificate and assignment generation.
The old unit remains retained in the audit and asset history.

## 12. Trusted time — **APPROVED**

Production Store Hub hardware requires **all three**:

```text
hardware RTC
authenticated network time when available
persisted rollback-resistant trusted-time floor
```

Trusted time is the **maximum valid value** of: RTC time; authenticated network
time; persisted trusted-time floor; signed cloud time token.

1. Trusted time must never move backwards.
2. The trusted-time floor advances only after validation.
3. A clock value more than **five minutes** behind the trusted floor is treated
   as rollback or tampering.
4. An RTC value materially ahead of authenticated time requires investigation
   and must not blindly advance the floor.
5. A new device without trustworthy RTC time, authenticated time or a valid
   signed time token cannot activate offline.
6. Certificate validity, revocation-snapshot validity and signed-configuration
   validity use trusted time.
7. Loss of WAN after activation does not invalidate the existing trusted floor.
8. RTC failure or rollback moves the Hub into restricted trust mode.
9. Emergency time correction requires: authorized operator; reason; A3/A4
   approval; old and new values; evidence source; immutable audit.
10. A Store Hub arriving with no WAN and an invalid or untrusted RTC cannot be
    commissioned until trustworthy time is established.

The production hardware BOM must include an RTC and a documented
battery-maintenance procedure.

## 13. Emergency compromise and CA rotation — **APPROVED**

Response categories: single device-key compromise; enrollment-station
compromise; issuing intermediate compromise; configuration signer compromise;
release signer compromise; WS-10 transport signer compromise; root CA
compromise.

**Device-key compromise:** revoke certificate; quarantine device; invalidate
assignment generation; publish revocation snapshot; generate new key pair;
require physical or approved recovery; reprovision and reactivate.

**Intermediate compromise:** stop issuance; disable affected signer; invoke
offline-root ceremony; issue replacement intermediate; publish emergency trust
update; revoke affected certificates; reissue affected device certificates;
force affected-device trust refresh.

**Purpose signer compromise:** rotate only the affected purpose key where
containment permits. Do not rotate unrelated signer families without cause.

**Root compromise:** global trust-anchor replacement; all intermediate
replacement; all device trust refresh; all signer reissuance; forced
reprovisioning where required; incident command; owner and security
authorization.

Emergency controls and runbooks must be tested before production launch.

## 14. BLK-005 status effect

```text
BLK-005 decision values:              RESOLVED
BLK-005 implementation:               PENDING
WS-11-T003:                           AUTHORIZED TO BEGIN
WS-11:                                SCAFFOLDED / IN PROGRESS
development certificate implementation: AUTHORIZED
pilot activation:                     BLOCKED pending hardware and signer evidence
production activation:                BLOCKED pending implementation and security evidence
WS-10 production signer:              BLOCKED pending signer implementation and evidence
```

BLK-005 is **not** fully closed until: the PKI hierarchy is implemented;
development trust works; production signer custody is implemented;
TPM/secure-element hardware is selected and tested; trusted-time controls are
implemented and tested; revocation and offline behavior are tested; replacement
and compromise procedures are tested; independent security review approves;
evidence is linked.

## 15. Next authorized work

WS-11-T003 may implement: development root and intermediate test hierarchy;
certificate-request contracts; device on-board key generation interface;
software-backed development provider; hardware-backed provider interface;
certificate issuance lifecycle; renewal lifecycle; revocation snapshots;
trusted-time service; restricted trust modes; configuration and signer
verification interfaces; production providers that fail closed until configured.

**It must not claim production readiness.**

---

# Implementation impact (build-agent reading, no authority of its own)

The ruling **changes behavior already implemented in T001 and T002**. These are
corrections owed by T003, not new features:

| §    | What changes                                                                                                                | Current state                                                              |
| ---- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 10   | The incumbent goes to **`restricted_investigation`**, not full quarantine. T002 quarantines both identities unconditionally | **CONTRADICTS T002.** Must be corrected additively                         |
| 10   | Repeated duplicates from one station quarantine **the station**                                                             | Not implemented; `enrollment_station_id` is recorded so the signal exists  |
| 11   | NVMe replacement retains `device_record_id` only when **board AND TPM identity match**                                      | T001 retains the identity for any storage-module-only change               |
| 11   | Pi board or TPM replacement creates a **NEW** `device_record_id`                                                            | Not implemented                                                            |
| 4    | `hardware_trust_level` and `production_eligible` columns                                                                    | Not implemented                                                            |
| 5    | Certificate windows are now KNOWN VALUES, so `pki_trust_configuration` can be populated **for development**                 | Table deliberately empty; the gate opens for development only              |
| 6    | Signed revocation snapshots, freshness bounds, restricted offline trust mode                                                | Not implemented                                                            |
| 7    | A verifier must reject a valid signature used for the **wrong purpose**                                                     | `SigningProvider` takes a purpose argument; no verifier enforces it yet    |
| 12   | Trusted-time service, five-minute rollback threshold, monotonic floor                                                       | Not implemented; G12 was the recorded gap                                  |
| 1, 7 | Two NEW signing purposes: `manufacturing_enrollment` and `emergency_recovery`                                               | `SIGNING_PURPOSES` currently has four; the DB check constraint covers four |

Two constraints in migration 0120 are **narrower than the ruling** and must be
widened additively: `pki_trust_configuration_key_separation_chk` covers four
purposes, not six; and the table has no column for the manufacturing or
emergency-recovery key references.

The §4 SKU sub-gate means `production_eligible` must default to **false** and
have no path to true until a certified SKU exists — the same fail-closed shape
as the BLK-005 gate itself.
