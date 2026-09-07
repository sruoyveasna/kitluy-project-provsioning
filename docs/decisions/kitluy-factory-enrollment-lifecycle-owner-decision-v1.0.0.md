# KitLuy Factory Enrollment Before Store Pairing — Owner Clarification and Lifecycle Rule v1.0.0

**Filename:** `kitluy-factory-enrollment-lifecycle-owner-decision-v1.0.0.md`
**Decision ID:** KLD-2026-09-03-FACTORY-ENROLLMENT-001
**Date:** 2026-09-03
**Owner:** HET / KitLuy Suite Project Owner
**Status:** OWNER-LOCKED
**Companion to:** `kitluy-terminal-transport-and-pairing-completion-owner-decision-v2.0.0.md` (KLD-2026-09-03-TERMINAL-PROVISIONING-001)
**Purpose:** Add an owner-locked lifecycle rule for both Store Hub and Pi Terminal: Factory Enrollment comes first, and it grants device recognition and provisioning eligibility only, never Store operational authority.

> Repository note (recorded, not part of the owner text): the owner supplied this clarification in the same session as v2.0.0, as an addition to the Pi Terminal provisioning assessment. It is recorded verbatim below with the flow arrows restored. The assessment's Section A2 records what the repository already enforces and where it deviates.

---

## 1. Factory Enrollment Comes First

Before a Store Hub or Pi Terminal can be paired to a Digital Store, the physical Raspberry Pi must first complete Factory Enrollment.

Factory Enrollment means:

- the device boots from a generic KitLuy image;
- the device establishes its unique hardware/device identity;
- it connects to KitLuy Cloud when online;
- it registers/enrolls itself with KitLuy;
- Admin Portal can see the physical device;
- Admin can identify which device it is;
- Admin can inspect the relevant hardware/image/device information;
- Admin explicitly approves its registration/enrollment.

After approval, the device becomes:

ENROLLMENT-APPROVED / PROVISIONING-ELIGIBLE

This does NOT mean the device is operational.

## 2. Factory Enrollment Does Not Grant Store Authority

An enrollment-approved Pi Terminal must NOT be allowed to perform POS or Store operations.

At the enrollment-approved stage it may still have:

```text
Store assigned              NO
Location assigned           NO
Store Hub assigned          NO
T1/T2/T3/T4 assigned        NO
Business application        NO
Terminal PIN                NO
Store operational authority NO
```

Therefore:

```text
FACTORY ENROLLED + ADMIN APPROVED
≠
POS READY
```

The enrolled device is only recognized by KitLuy and eligible to enter the Store provisioning/pairing process.

## 3. Same Principle for Store Hub

A Store Hub also follows:

```text
generic image
→ first boot
→ factory enrollment
→ Admin sees device
→ Admin approves registration
→ provisioning eligible
```

At this point the Hub still has NO Store operational authority.

Only after governed Store/Location pairing and required activation does it become a Store-serving Hub.

## 4. Pi Terminal Lifecycle

The intended Pi Terminal lifecycle is:

### PHASE A — FACTORY / DEVICE ENROLLMENT

```text
Generic Pi Terminal image
        ↓
Boot graphical KitLuy setup shell
        ↓
Network available
        ↓
Generate/load unique device identity
        ↓
Register with KitLuy Cloud
        ↓
Admin Portal sees device
        ↓
Admin approves enrollment
        ↓

STATUS:
ENROLLMENT APPROVED
PROVISIONING ELIGIBLE

POS OPERATION:
NOT ALLOWED
```

### PHASE B — STORE PAIRING / ASSIGNMENT

```text
Partner Portal
Provisioning → Terminals
        ↓
Partner selects logical Terminal/profile(s)
        ↓
Partner opens pairing session
        ↓
short-lived CODE/QR
        ↓
Pi Terminal GUI accepts CODE
        ↓
Pairing succeeds
        ↓
Terminal learns:
- Partner/Tenant
- Digital Store
- Location
- assigned Store Hub
- terminal assignment/profile(s)
- Store vertical
- required app
        ↓

STATUS:
STORE ASSIGNED

POS OPERATION:
STILL NOT YET ALLOWED
```

### PHASE C — TERMINAL ACTIVATION

```text
Terminal verifies/connects to assigned Store Hub
        ↓
required credential/config delivered
        ↓
correct signed business application installed
        ↓
4-digit Terminal PIN created
        ↓
PIN entered twice and confirmed
        ↓
activation/readiness checks succeed
        ↓

STATUS:
ACTIVE / OPERATIONAL

POS OPERATION:
ALLOWED
```

## 5. GUI Behavior Before Pairing

The Pi Terminal GUI must reflect this lifecycle clearly.

Example after Factory Enrollment and Admin approval but before Store pairing:

```text
KITLUY TERMINAL

Device ID        KL-TM-XXXXXXXX
Enrollment       Approved ✓

This Terminal has not yet been assigned to a Store.

Enter Pairing Code

[ _ _ _ _ _ _ ]

[ Continue ]
```

There must be no way for the user to enter the POS/business application from this state.

The device may expose only the minimum capabilities required for:

- networking;
- enrollment;
- registration status;
- pairing;
- diagnostics/recovery permitted by policy.

## 6. Security Rule

Factory Enrollment grants:

```text
DEVICE RECOGNITION
+
PROVISIONING ELIGIBILITY
```

Factory Enrollment must NOT grant:

```text
Store data access
Store API access
POS operation
business transaction authority
Store configuration authority
T1/T2/T3/T4 role authority
```

Those require governed pairing/assignment and activation.

A stolen or unused device that is enrollment-approved but never paired must not be usable as an operational POS Terminal.

## 7. Admin Portal Implication

Admin Portal must be able to distinguish at least conceptually:

```text
NEW / UNAPPROVED DEVICE
        ↓
ENROLLMENT APPROVED
        ↓
PAIRED / ASSIGNED
        ↓
ACTIVE / OPERATIONAL
```

Do not collapse these states into one generic "registered" state if that would allow Store authority too early.

Admin must be able to see whether the device is:

- merely enrolled;
- approved for provisioning;
- assigned to a Store;
- operational.

## 8. Partner Portal Implication

Partner Portal must only allow pairing with a device that is eligible under the approved enrollment rules.

Partner pairing does not replace Admin approval.

Partner Portal controls the Store assignment.

Admin controls device enrollment/trust eligibility.

Conceptually:

```text
ADMIN:
"Yes, this is a legitimate KitLuy device."

PARTNER:
"Assign this legitimate device to this Store and these Terminal roles."

SYSTEM:
"All activation requirements passed; it may now operate."
```

## 9. Update the Analysis

When performing the Pi Terminal provisioning research/architecture assessment, include Factory Enrollment as the first required stage.

Assess what already exists for:

- device manufacturing/factory identity;
- first-boot enrollment;
- Admin registration approval;
- enrollment status;
- provisioning eligibility;
- denial of Store operation before pairing;
- transition from enrollment-approved to pairing;
- Store Hub equivalent lifecycle;
- Pi Terminal equivalent lifecycle.

Identify any current implementation that accidentally grants operational access merely because a device is enrolled/approved.

Treat that as a security defect.

## 10. Owner-Locked Principle

Lock this principle:

> "Factory Enrollment makes the physical Raspberry Pi known and approved by KitLuy and eligible for provisioning only. It does not grant Store operational authority. Store Hub or Pi Terminal operational authority begins only after successful governed pairing, assignment, required credential/configuration delivery, and applicable activation steps."

Preserve this rule in all future provisioning architecture.

---

## Repository mapping (recorded by the assessment of 2026-09-03; not owner text)

| Owner state                                 | Cloud lifecycle state (`kitluy_devices.device_lifecycle_state`) | Reached by                                                                                                       |
| ------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| NEW / UNAPPROVED                            | `manufactured` (registration answers `PENDING_APPROVAL`)        | `register_device_v1` (group 0197)                                                                                |
| ENROLLMENT APPROVED / PROVISIONING ELIGIBLE | `enrolled`                                                      | `approve_device_enrollment_v1` (group 0197): reason, verification evidence, actor, four-eyes outside development |
| PAIRED / ASSIGNED                           | `awaiting_trust`                                                | claim/assignment doors (group 0121); Hub pairing session consumption (group 0194) requires `enrolled`            |
| ACTIVE / OPERATIONAL                        | `active`                                                        | `attempt_activate_device_v1` (group 0121); `enrolled → active` was removed in group 0121                         |

Deviations recorded for correction: the Pi Terminal image tree still shipped the ticket-based self-enrollment path that lands a device in `enrolled` with no Admin decision (development open enrollment, KLD-2026-08-12-DEV-OPEN-ENROLLMENT-001); three definitions of "provisioning eligible" disagree (group 0188 function, the management API presentation gate, the pairing doors); the Admin Portal has no label for the assigned state. See the decision register entries of 2026-09-03.
