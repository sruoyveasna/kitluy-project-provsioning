# KitLuy Pi Terminal Credential Model — the Terminal PIN and the Device Credential — Owner Decision v1.0.0

**Filename:** `kitluy-terminal-pin-device-credential-owner-decision-v1.0.0.md`
**Decision ID:** KLD-2026-09-17-TERMINAL-PIN-DEVICE-CREDENTIAL-001
**Date:** 2026-09-17
**Owner:** HET / KitLuy Suite Project Owner
**Status:** OWNER-DECIDED — recorded verbatim from the owner's answers to the
four questions put in mission TERMINAL-PIN-AND-REAL-POS-AUTH-001 §7 (2026-09-17).
**Amends:** `KLD-2026-09-03-TERMINAL-PROVISIONING-001` §11 and §15 (the
"Terminal PIN → staff login" two-layer flow). §10, §12, §13, §14 and §20 of that
decision stand unchanged.
**Supersedes (for the physical Pi Terminal only):** the per-employee "Staff PIN
login" of `kitluy-pos-desktop-app-phase1-spec-v4.0.0` §4.1/§4.3 and the "POS
PIN rules" of `kitluy-partner-portal-phase1-spec-v2.0.0` §12.2 as the credential
that opens a T1 session on a Pi Terminal. Those remain target specifications
for a human-attributed staff layer above the Terminal PIN (see §5).
**Does NOT resolve:** BLK-006 (the cloud→Hub projection), the KLREQ-025 field
list, D1/S42, consent policy values, or any pilot/production claim.

---

## 1. The conflict that was put to the owner

Three sources described three credential models for the person at a Pi
Terminal:

| Source                                                                           | Model                                                                                                |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| KLD-2026-09-03-TERMINAL-PROVISIONING-001 §10–§15 (OWNER-LOCKED)                  | ONE 4-digit Terminal PIN per device (physical access control), THEN a separate staff login           |
| POS desktop spec v4 §4.1/§4.3; Partner Portal spec v2 §12.2; cloud schema v1 §81 | a personal 4–6 digit PIN per employee, managed by the Partner, cached on the Hub                     |
| Standalone `kitluy-laundry-pos-desk-app` (reference)                             | Supabase email + password per staff member, then a personal 4-digit PIN checked server-side (bcrypt) |
| Built (handoff 48)                                                               | Staff ID (UUID) + 4–128-character passcode, scrypt on the Hub, no lockout; no way onto a real Hub    |

The owner's clarification of 2026-09-17 ("PHYSICAL PI TERMINAL → device
identity → device credential → trusted Store Hub relationship, THEN STAFF → uses
PIN on the trusted Terminal → Hub validates → staff session → POS operation";
"Do not add an email/password login screen to the Pi POS") fits none of them
exactly. The four questions and the answers, verbatim:

1. **Which PIN model?** — _"One shared Terminal PIN only"_.
2. **How does a staff member say who they are on the PIN screen?** — _"PIN alone"_.
3. **How do staff (and their first PIN) reach the real Store Hub for this development milestone?** — _"Just pin no logout login use the device as credentials"_.
4. **Which lockout policy?** — _"5 failures, 15-minute lock"_.

## 2. The decided model (LOCKED by these answers)

```text
PHYSICAL PI TERMINAL
  device identity (Ed25519) → enrollment → assignment
  → operational key → operational certificate → mutual TLS → Store Hub
  → pairing receipt → runtime eligibility                 = DEVICE CREDENTIAL

        AND

TERMINAL PIN (one per device, 4 digits, created twice after the application installs)
  → verified by the Store Hub (Argon2id verifier; never stored raw)
  → Hub-side attempt counting: 5 failures within 15 minutes lock it for 15 minutes
  → unlock = a T1 session whose ACTOR IS THE TERMINAL DEVICE      = HUMAN CREDENTIAL

Both are required for a Store operation. Neither replaces the other.
```

- **No staff login on a Pi Terminal.** No email, no password, no staff ID, no
  passcode, no staff picker. The `/edge/v1/sessions/*` staff routes are not
  reachable from the board (removed from the edge bridge's closed route list).
- **No logout.** The terminal LOCKS (its PIN session closes) and UNLOCKS (a new
  PIN session). There is no person to sign out.
- **The Terminal PIN is the terminal's own.** Attempt counts and lock state are
  therefore shown to the person at the counter ("4 attempts left", "locked
  until …"); there is no employee whose existence a message could reveal.
- **What a PIN session may do:** the T1 intake surface only —
  `pos.t1.use`, `customers.read`, `customers.create`,
  `customers.consent.record`, `laundry.bookings.read`,
  `laundry.bookings.create` — and only while the terminal's own T1 profile
  grant from the ACTIVE snapshot is current and no blocking containment is in
  effect, re-read on every request. Financial, custody, refund, override and
  other sensitive actions are NOT in it (§5).

## 3. PIN lifecycle

| Step   | Where                                                                                 | Rule                                                                                                                                                |
| ------ | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setup  | `POST /edge/v1/terminal-pin/setup` (mTLS + runtime eligibility first)                 | Only while no PIN is set (first setup, or after a reset). Entered twice; a mismatch is refused. The verifier is committed and the terminal unlocks. |
| Unlock | `POST /edge/v1/terminal-pin/unlock`                                                   | One counted attempt under the terminal-row lock. Success opens the T1 session (8 h, provisional) and supersedes any older open PIN session.         |
| Lock   | `POST /edge/v1/terminal-pin/lock`                                                     | Closes the named PIN session. The terminal returns to the PIN screen.                                                                               |
| Change | `POST /edge/v1/terminal-pin/change`                                                   | The current PIN (a counted attempt), then the new one twice. The session stays.                                                                     |
| Reset  | `hub-agent reset-terminal-pin --terminal --operator --reason` (development Hubs only) | Clears the verifier, closes open PIN sessions, records operator and reason in the immutable audit journal; the terminal asks for a new PIN twice.   |
| Status | `GET /edge/v1/terminal-pin/status`                                                    | Public posture only: state, version, set-at, locked-until, attempts before lock; whether the named session is open. Never a PIN, never a verifier.  |

The governed PARTNER reset (§14 of KLD-2026-09-03: a Partner Portal action
delivered to the Hub) needs the cloud→Hub delivery (BLK-006) and is not built;
the development command is the reset until then, and refuses on any Hub whose
environment is not `development`.

## 4. Storage, attempts, persistence

- **Verifier:** Argon2id PHC string, fresh 16-byte salt, m = 19456 KiB, t = 2,
  p = 1, 32-byte hash (`hash-wasm` 4.12.0, WebAssembly, no native addon).
  §12 of KLD-2026-09-03 names Argon2id and no parameters: these are
  PROVISIONAL development values, `[REQUIRED: owner-approved Argon2id cost
profile]`.
- **Attempts:** counted in `edge_identity.terminal_pin` on the Hub, inside the
  verification transaction, under `select … for update` on the terminal row. A
  reboot or a GUI restart resets nothing (§13). Failures within the 15-minute
  window count; the 5th locks for 15 minutes; a correct PIN resets the count.
- **Survives:** reboot, POS release update, A/B OS slot switch (the record lives
  on the Store Hub, not on the terminal).
- **Fresh SD recovery and hardware replacement:** NOT decided by any document
  (KLD-2026-09-03 says nothing about the PIN across reflash or replacement).
  As built, the record is keyed by the Hub's `terminal_device.id`; a re-flashed
  board that recovers the SAME terminal device row keeps its PIN, a replaced
  device row starts at setup. `[REQUIRED: owner ruling on the PIN across
reflash and hardware replacement]`.
- **Removal:** no role may delete a `terminal_pin` row (trigger); a reset
  clears the verifier and keeps the row and its history.
- **Session length:** 8 hours (Store Hub LAN API v1.0.0 default), PROVISIONAL;
  no idle lock in this slice. `[REQUIRED: owner session policy]`.

## 5. What stays separate, and why

- KLD-2026-09-03 §11's rule that "Financial, custody, refund, override, and
  other sensitive business actions must still be attributable to the
  authorized human actor" STANDS. The PIN session carries the T1 intake
  surface only. When those actions are built, they need a human-attributed
  layer above the Terminal PIN (the per-employee staff model of the POS and
  Partner Portal specs, delivered through BLK-006). That layer is not a login
  screen on the Pi; its form is a later owner decision.
- KLREQ-025 STANDS: the Hub still authors no grant. A PIN session's authority is
  the terminal's own T1 profile grant from the cloud-authored active snapshot,
  not an actor grant.
- The existing staff-session routes (`/edge/v1/sessions/*`) and
  `edge_identity.staff_cache` STAY on the Hub for the WS-12-T001 workstation
  composition and for the future staff layer; they are simply not reachable
  from a Pi Terminal.

## 6. Evidence

- Hub migration `hub/migrations/0043_terminal_pin.sql`; cloud group 0230
  (`device-runtime-report.v2` carrying the Hub's PIN answer).
- Store Hub: `services/kitluy-hub-agent/src/hub/edge/terminal-pin.ts`,
  routes in `routes.ts`, PIN-session authorization in `runtime-bootstrap.ts`.
- Terminal: bridge route list, terminal-edge PIN status read, runtime report v2.
- POS: `electron/pi-runtime.ts`, `electron/pin-ipc.ts`,
  `electron/terminal-pin-client.ts`, `src/pin-screen.tsx`.
- Partner Portal: `pinSet` and `active` (Operational) rungs from the report.
- Handoff `00_AI_HANDOFF/edge-platform/49_TERMINAL_PIN_AND_REAL_POS_AUTH.md`.
