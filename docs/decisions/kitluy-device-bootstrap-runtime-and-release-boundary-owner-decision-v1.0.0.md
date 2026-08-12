# KitLuy Device Bootstrap Runtime and Release Boundary — Owner Decision v1.0.0

**Filename:** `kitluy-device-bootstrap-runtime-and-release-boundary-owner-decision-v1.0.0.md`
**Decision ID:** KLD-2026-08-11-DEVICE-BOOTSTRAP-RUNTIME-001
**Supersedes marker:** the informally-cited "DEC-1 bootstrap-hybrid owner decision (2026-08-10)"
**Date:** 2026-08-11
**Owner:** HET / KitLuy Suite Project Owner
**Status:** OWNER-APPROVED — LOCKED. Recorded from the owner continuation
instruction of 2026-08-11 §3.
**Resolves:** DEC-1 in `00_AI_HANDOFF/edge-platform/28_PI_TERMINAL_MISSION_BLOCKERS.md`
— "May agent executables be baked into the OS image?"
**Does NOT resolve:** DEC-2 (fresh-device enrollment authentication), BLK-005
pilot/production custody, BLK-006, BLK-007.

---

## 0. Why this record exists

This decision was **already implemented** before it was recorded. Two source
files cite it as their authority:

- `services/kitluy-device-firstboot-agent/src/bin/firstboot-identity.ts:5`
- `services/kitluy-device-firstboot-agent/src/adapters/device-identity-store.ts:5`

both reading *"DEC-1 bootstrap-hybrid owner decision (2026-08-10)"*. No such
record existed in `docs/decisions/`, in the decision register, or in any
handoff. The 2026-08-11 device workflow audit found the citation and the
missing record.

**This document does not change the implemented architecture.** It records the
authority for what is already built, so the Rebuild Test holds.

---

## 1. The decision (LOCKED)

> The golden OS image contains the minimum trusted bootstrap runtime required
> to establish and manage a device before normal application releases are
> available. Full POS business applications are governed release artifacts.

This is the **bootstrap-hybrid** position — option C of the three recorded in
`28_PI_TERMINAL_MISSION_BLOCKERS.md` DEC-1.

## 2. What the golden image contains (LOCKED)

Baked, because none of it can be delivered by an updater that is itself not yet
present — the bootstrap-ordering problem:

| Component | Path in image |
| --- | --- |
| First-boot identity | `/usr/lib/kitluy/firstboot-identity` |
| Fleet enrollment bootstrap | `/usr/lib/kitluy/enrollment-agent` |
| Health / liveness bootstrap | `/usr/lib/kitluy/health-reporter` |
| Update / release bootstrap | `/usr/lib/kitluy/update-agent` |
| Terminal bootstrap surface | `/usr/lib/kitluy/terminal-bootstrap-ui` |
| Shared runtime library | `/usr/lib/kitluy/lib/firstboot-agent/**` |

Verified present in
`infra/kitluy-os-image/rpi-image-gen/layer/kitluy-base.rootfs-overlay/`, with
four systemd units: `kitluy-firstboot.service`, `kitluy-enrollment-agent.service`,
`kitluy-health-reporter.service`, `kitluy-update-agent.service`.

## 3. What the golden image does NOT contain (LOCKED)

Delivered instead by `services/kitluy-device-release-and-update-service` through
the governed A/B release path:

- The KitLuy POS Desktop application
- Any vertical business module (Laundry Phase 1 and every later vertical)
- Terminal session/business runtime beyond the bootstrap surface
- Any configuration payload carrying Tenant, Digital Store, Location, Store Hub,
  terminal profile or vertical

## 4. What this decision explicitly does not authorize

1. **No identity or secret in the image.** KLSRC-0162 §34 stands unchanged: no
   device private key, no device certificate, no Tenant/Store/Location value,
   no Supabase service-role key, no database password, no release-signing
   private key. The bootstrap runtime is *code*, not credentials.
2. **No promotion of the image to an application release.** The image remains an
   OS artifact. Bootstrap-agent changes ride an image rebuild; application
   changes must not.
3. **No pilot or stable promotion.** BLK-005 release signing stays fail-closed.

## 5. Supersession note

`infra/kitluy-os-image/rpi-image-gen/layer/kitluy-base.yaml:26-28` previously
recorded the opposite position — that "the agent code itself is delivered by the
governed release system, not baked here (mission §27: OS image is not an
application release)". **That position is superseded for the bootstrap set
only**, and remains correct for the application set. Section 3 above is the
boundary.

## 6. Authority references

| Reference | Role |
| --- | --- |
| Owner continuation instruction 2026-08-11 §3 | This decision's source authority |
| `28_PI_TERMINAL_MISSION_BLOCKERS.md` DEC-1 | The question, and the three options |
| KLSRC-0162 §34, §37 Milestone 1 | Zero-secret image rule; first-boot requirements the bootstrap set must satisfy |
| KLD-2026-07-28-002 (BLK-005) | Key custody and trust environments — unchanged |
| KLREC-2026-08-11-EDGE-001 | Recorded DEC-1 as open on documentary evidence; corrected by this record |
