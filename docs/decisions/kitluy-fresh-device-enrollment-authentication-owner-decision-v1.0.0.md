# KitLuy Fresh-Device Enrollment Authentication — Owner Decision v1.0.0

**Filename:** `kitluy-fresh-device-enrollment-authentication-owner-decision-v1.0.0.md`
**Decision ID:** KLD-2026-08-11-FRESH-DEVICE-ENROLLMENT-001
**Date:** 2026-08-11
**Owner:** HET / KitLuy Suite Project Owner
**Status:** OWNER-APPROVED — LOCKED. Selected from a four-option package on
2026-08-11.
**Resolves:** DEC-2 in `00_AI_HANDOFF/edge-platform/28_PI_TERMINAL_MISSION_BLOCKERS.md`
— "What authenticates a factory-fresh Pi to a self-enrollment endpoint?"
**Does NOT resolve:** BLK-005 pilot/production key custody and hardware
certification; `KITLUY_SECURE_ELEMENT_MODEL`; BLK-006; BLK-007.

---

## 1. The decision (LOCKED)

> A fresh KitLuy device authenticates its first fleet enrollment with a
> **per-device, single-use manufacturing enrollment ticket written at flash
> time**, presented together with proof of possession of the key pair the
> device generated for itself at first boot.

The golden image stays **generic and secret-free**. The flashing step — not the
image — is what makes a particular physical unit eligible to become a trusted
KitLuy fleet device.

## 2. The distinction this decision turns on

KLSRC-0162 §34 forbids baking identity into a shared image. That rules out any
design where the image itself is the credential. This decision therefore
separates two things that a naive design conflates:

| | Carried by | Shared across devices? |
| --- | --- | --- |
| **Golden image** | The `.img` artifact | Yes — identical for every unit |
| **Per-device provisioning material** | Written at flash time to the data partition | No — unique, single-use |

A copied `.img` gives an arbitrary Raspberry Pi the ability to *contact* the
enrollment service. It does not give it a ticket, so it cannot *become* a
trusted fleet device. That is the boundary §8 of the owner instruction requires.

## 3. Why this option, over the three alternatives

| Option | Verdict |
| --- | --- |
| Manufacturing-station enrollment | Secure, but every unit must pass a station; does not scale, and recovery requires the unit to return |
| **Flash-time ticket (SELECTED)** | Same security boundary, but the flashing step *is* the station; scales; recovery is a reissued ticket |
| Pi 5 hardware root of trust | Strongest, and the eventual target — but blocked on `KITLUY_SECURE_ELEMENT_MODEL` (production BOM) and a `required_key_storage_class` move from `software` to `secure_element` |
| Open enrollment + quarantine | Rejected for anything beyond local development: anyone knowing the URL can create fleet records |

**This decision does not close the door on hardware root of trust.** The ticket
mechanism binds to whatever key the device presents; when a secure element is
selected, `required_key_storage_class` tightens and the same ticket flow carries
a hardware-backed key instead of a software one. Option C is a later narrowing,
not a replacement.

## 4. Non-negotiable properties this decision preserves

Restating the owner instruction §5 so an implementation cannot drift:

- No Supabase service-role key on the device.
- No database password on the device.
- No shared permanent manufacturing private key in the golden image — the image
  carries **no** signing key; the ticket is verified server-side.
- No copied device private key in the golden image.
- No Tenant / Digital Store / Location / Store Hub / terminal profile / vertical
  in the golden image.
- The device generates its own key pair; the private key never leaves it.
- The server verifies proof of possession before trusting a public key.
- Enrollment is auditable, and duplicate/replay enrollment is controlled.
- Revoked and quarantined devices fail closed.
- **Factory enrollment grants no Store business authority whatsoever.**

## 5. Ticket properties (LOCKED)

The ticket must be:

- **per-device** — one ticket authorizes exactly one physical unit;
- **single-use** — redemption is atomic and a second attempt is refused;
- **expiring** — an unredeemed ticket lapses;
- **opaque** — it carries no Tenant, Store, Location or business scope;
- **device-class scoped** — a terminal ticket cannot enroll a Store Hub;
- **environment scoped** — a development ticket cannot enroll into pilot;
- **revocable** — a ticket lost before use can be killed;
- **auditable** — issuance, redemption, refusal and revocation are recorded;
- **secret-free at rest server-side** — the server stores a digest, never the
  ticket secret, in the same way `device_provisioning_codes` stores a digest.

## 6. What successful factory enrollment produces (LOCKED)

Exactly this, and nothing more:

```text
device_class      = terminal | store_hub
lifecycle_state   = enrolled
active assignment = none
```

Admin presentation: `ONLINE / ENROLLED / UNASSIGNED`.

It creates **no** Tenant assignment, Digital Store assignment, Location
assignment, Store Hub relationship, terminal profile or business vertical.
Those belong to Store pairing, which is a separate stage and a separate
credential scope (KLSRC-0162 §35).

## 7. Development versus production

The **mechanism is identical**; only ticket custody differs.

| | Development | Production |
| --- | --- | --- |
| Ticket issued by | A governed issuance call, by an authorized operator | The KitLuy flashing tool, under manufacturing custody |
| Ticket delivered to device | Placed at `/var/lib/kitluy/enrollment/ticket` | Written to the data partition by the flashing tool |
| Environment scope | `development` | `pilot` / `production` — still gated by BLK-005 |

This is deliberate: development exercises the real code path, so the production
path is not first executed on the day it matters. Development tickets are
environment-scoped and cannot enroll a device into pilot or production.

## 8. Reuse constraint

This decision creates **no parallel PKI or device system**. It binds to the
existing canonical model:

| Existing asset | Location |
| --- | --- |
| `manufacturing_enrollment_key_reference`, `manufacturing_ca_reference` | `kitluy_devices.pki_trust_configuration` (`0120:454+`) |
| `kitluy_devices.enroll_device_v1` | `0122:752` — remains THE enrollment door |
| `manufacturing_enrollments`, `enrollment_sequence`, `state='sealed'` | `0120:308` |
| `device_generation_keys` (public key only) | `0128:86` |
| `quarantined` lifecycle state | `0120` `device_lifecycle_state` |
| Device-side ticket slot `TICKET_PATH` | `enrollment-bootstrap.ts:41` |
| PoP conventions | `kitluy.provisioning-pop.v1`, `provisioning-routes.ts` |

`enroll_device_v1`'s `p_enrollment_station_id` and `p_enrollment_operator_ref`
are satisfied **by the ticket**, not by a caller assertion: the ticket records
which station issued it and under whose authority, and redemption passes those
recorded values through. The canonical door is reused unchanged.

## 9. Authority references

| Reference | Role |
| --- | --- |
| Owner continuation instruction 2026-08-11 §4–§8 | Source authority; option selected from the presented package |
| KLSRC-0162 §4, §34, §35 | Automatic enrollment; zero-secret image; enrollment ≠ pairing |
| KLD-2026-07-28-002 (BLK-005) | Key custody, trust environments, storage class |
| KLD-2026-08-11-DEVICE-BOOTSTRAP-RUNTIME-001 | The bootstrap runtime that presents the ticket |
| KLREC-2026-08-11-EDGE-001 | Recorded DEC-2 as open and narrowed to B/C/D; closed by this record |
