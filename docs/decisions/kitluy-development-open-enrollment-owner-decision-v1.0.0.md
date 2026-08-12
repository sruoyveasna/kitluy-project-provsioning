# KitLuy Development Open Enrollment — Owner Decision v1.0.0

**Filename:** `kitluy-development-open-enrollment-owner-decision-v1.0.0.md`
**Decision ID:** KLD-2026-08-12-DEV-OPEN-ENROLLMENT-001
**Date:** 2026-08-12
**Owner:** HET / KitLuy Suite Project Owner
**Status:** OWNER-APPROVED — DEVELOPMENT ONLY
**Amends:** `KLD-2026-08-11-FRESH-DEVICE-ENROLLMENT-001` (DEC-2) — adds the
Option D development path alongside the selected Option B, and does not replace
it.
**Does NOT resolve:** BLK-005, BLK-006, BLK-007, hardware certification.

---

## 1. The decision (owner, stated 2026-08-12)

> In development I want to flash one SD card, copy that card as many times as I
> like, put each copy in a Raspberry Pi, and have every Pi come online in the
> cloud by itself. No per-device preparation step.

This is **Option D** of the four-option package presented on 2026-08-11
("open enrollment with server-side quarantine"), which that record classified as
_"fastest to build for development… acceptable for dev only, and must never
reach Pilot."_ The owner selected Option B at that time and has now asked for
Option D **for development**, having seen Option B working and found the
per-card step is not what is wanted while building.

The owner's stated words are recorded verbatim above rather than paraphrased,
because the previous record captured a selection from a menu and this one
captures an intent.

## 2. What is unchanged

**Option B remains the pilot and production mechanism.** The flash-time ticket,
`pnpm device:prepare`, and every §5 ticket property stay in the codebase and
stay the path for real Stores. This decision does not delete them, does not
weaken them, and does not authorize their removal.

## 3. The mechanism (and why almost nothing is lost)

Open enrollment is implemented **in the service, not in the database.** No
migration changes. No governed door is altered. No role grant is widened. No RLS
policy is relaxed.

When development open enrollment is enabled, a device that presents **no ticket**
causes the SERVICE to mint one for it and immediately redeem it, through the same
governed doors a station would call. The automatic issuance is the "front desk"
running unattended.

The consequence is that the §5 ticket properties **still hold** for every device:

| §5 property                     | Still true under open enrollment?                                |
| ------------------------------- | ---------------------------------------------------------------- |
| per-device                      | Yes — one ticket is minted per enrolling device                  |
| single-use                      | Yes — the same door, the same atomic redemption                  |
| expiring                        | Yes                                                              |
| opaque (no business scope)      | Yes                                                              |
| device-class scoped             | Yes — via the configured hardware profile                        |
| environment scoped              | Yes — development only, refused elsewhere                        |
| revocable                       | Yes                                                              |
| auditable                       | **Yes — issuance and redemption are recorded exactly as before** |
| secret-free at rest server-side | Yes — the door still stores a digest                             |

**What changes is only WHO MAY ASK.** Previously: a holder of a prepared card.
Now, in development: anyone who can reach the endpoint.

## 4. The accepted risk, stated plainly

Anything that can reach the development enrollment endpoint can create a device
record in the development fleet. That is the whole of the risk, and it is
accepted for development because the endpoint is not public, the data is
development data, and the alternative slows the owner's own build loop.

## 5. Non-negotiable guards (LOCKED)

1. **Development only.** Enabling it in any environment other than
   `development` is REFUSED at startup, not merely discouraged.
2. **Explicit opt-in.** It is OFF unless a deployment sets it on. A deployment
   that says nothing gets Option B.
3. **Announced.** A service running with it enabled says so in its startup log,
   so no one can mistake an open deployment for a governed one.
4. **The image stays secret-free.** KLSRC-0162 §34 is untouched: an SD card
   carries no key, no certificate and no ticket, which is precisely why it can
   be copied freely.
5. **Pilot and production are unaffected** and continue to require a prepared
   card. BLK-005 continues to gate them independently.

## 6. What this does NOT authorize

- Enabling open enrollment in pilot or production.
- Removing the ticket mechanism or `pnpm device:prepare`.
- Weakening duplicate-evidence containment, station registration, proof of
  possession, or any lifecycle rule. A device still proves it owns its key.
- Any change to what enrollment PRODUCES: DEC-2 §6 still stands —
  `enrolled`, no assignment, no Tenant, no Store, no vertical.

## 7. Authority references

| Reference                                              | Role                                                     |
| ------------------------------------------------------ | -------------------------------------------------------- |
| Owner instruction 2026-08-12 (this session)            | Source authority                                         |
| KLD-2026-08-11-FRESH-DEVICE-ENROLLMENT-001 §3 Option D | The option now selected for development                  |
| KLD-2026-08-11-FRESH-DEVICE-ENROLLMENT-001 §5, §6      | Ticket properties and enrollment outcome, both preserved |
| KLSRC-0162 §4, §34                                     | Automatic enrollment on boot; zero-secret image          |
