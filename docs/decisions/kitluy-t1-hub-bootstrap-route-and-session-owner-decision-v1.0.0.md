# KitLuy T1 Hub Bootstrap Routes and Session Authorization — Owner Decision v1.0.0

**Filename:** `kitluy-t1-hub-bootstrap-route-and-session-owner-decision-v1.0.0.md`
**Decision ID:** KLD-2026-08-06-WS12-T001-EDGE-BOOTSTRAP-001
**Date:** 2026-08-06
**Owner:** HET / KitLuy Suite Project Owner
**Status:** OWNER-APPROVED — LOCKED. Recorded verbatim from the
WS-12-T001-P02 owner package instruction of 2026-08-06.
**Resolves:** the WS-12-T001 PARTIAL condition (no approved `/edge/v1`
route served terminal eligibility, Hub time or configuration delivery, and
the four sessions permission keys were `[REQUIRED:]` gaps).
**Does NOT resolve:** BLK-005 (pilot/production key custody and hardware
certification stay fail-closed), BLK-006, BLK-007, or any pilot/production
claim.

---

## 1. Authoritative Hub time (LOCKED)

Route: `GET /edge/v1/runtime/authority-time`

- Served inside the existing TLS 1.3 mutual-authentication boundary; a
  current eligible terminal credential is required.
- Authority time comes from the Hub DATABASE transaction. Node, Electron
  and terminal operating-system wall clocks are diagnostic only.
- Response fields: protocol version; authority timestamp; authority source
  `hub_database`; response ID; generated-at; maximum local monotonic-cache
  age; correlation ID.
- Maximum terminal monotonic-cache age: **30 seconds**.
- NO wall-clock fallback when the authority-time value is unavailable.
- NO lower-bound grace is introduced anywhere by this decision.
- `NOT_YET_VALID` remains retryable and non-consuming
  (KLD-2026-08-06-WS11-CLOCK-001 unchanged).
- The terminal may advance a cached authority timestamp ONLY by monotonic
  elapsed time — never by the operating-system wall clock.

## 2. Runtime eligibility (LOCKED)

Route: `GET /edge/v1/runtime/eligibility`

- All scope derives from the authenticated terminal credential and Hub
  relational authority. The request accepts NO scope, assignment, profile
  or credential override.
- Returns the current effective: Tenant; Digital Store; Location;
  environment; Hub; terminal; assignment ID and generation; terminal
  profile; credential ID and generation; credential eligibility;
  activation eligibility; pairing eligibility; containment state; Hub
  replacement/recovery state; required configuration version; authority
  timestamp; correlation ID.
- Fails closed for: wrong Hub; inactive Hub; retired Hub; restored
  quarantine; stale assignment generation; revoked or superseded
  credential; missing pairing; non-T1 profile; containment that prohibits
  T1 operation.

## 3. Current configuration (LOCKED)

Route: `GET /edge/v1/configuration/current`

- Returns the exact signed configuration envelope currently eligible for
  the AUTHENTICATED terminal, binding: snapshot ID and version; Tenant,
  Store and Location; environment; terminal and assignment generation;
  profile; compatible application versions; issued-at and effective-at;
  signer and public-key identifier; digest; signature; rollback reference;
  correlation ID.
- The terminal INDEPENDENTLY verifies signature, scope, compatibility and
  monotonic version before use or caching.
- A stale but previously valid local snapshot may be used only under the
  existing explicit `offline_ready` truth label.

## 4. Staff-session permissions (LOCKED)

Registered permission identifiers (no synonymous duplicates permitted):

- `staff.sessions.open`
- `staff.sessions.read`
- `staff.sessions.refresh`
- `staff.sessions.close`
- `pos.t1.use` (the T1 shell permission)

The existing four `/edge/v1/sessions/*` routes map to the corresponding
session permission. Opening or restoring a session does NOT authorize T1
by itself — the effective staff session must ALSO include `pos.t1.use`.
Backend authorization, Hub policy and local relational authority remain
mandatory; renderer visibility is not authorization.

## 5. Discovery (LOCKED)

The production LAN discovery adapter uses `_kitluy-edge._tcp.local`, must
consume the existing SIGNED Hub discovery document, and follows the locked
endpoint order:

1. assigned private IP;
2. assigned hostname;
3. signed mDNS discovery;
4. last verified endpoint;
5. cloud-reported verified endpoint;
6. manual recovery IP.

An mDNS response, hostname or IP address is NOT trust. Every candidate
still verifies: the signed discovery record; the exact Hub UUID; the Hub
certificate fingerprint; Tenant, Store and Location; environment; and the
TLS server identity.

## 6. Protected identity writer (LOCKED)

Terminal identity is written only after successful governed provisioning.
The writer: runs in the Electron main process; receives a
server-authoritative provisioning result; validates required fields and
fingerprints; writes atomically; seals through the existing OS
protected-storage adapter; fsyncs before replacing the prior file where
supported; preserves the prior valid file if the new write fails; never
accepts renderer-supplied scope or profile changes; never persists a
private key in the identity JSON; and emits an immutable local
installation acknowledgment. Pilot and production key custody remain
fail-closed under BLK-005.

## 7. Boundaries restated

- Eligibility and configuration reads require a valid paired terminal but
  NOT an already-open staff session; the authority-time route may be used
  before a staff session; the sessions routes require the registered
  staff-session permissions.
- No new staff identity model, no second configuration authority, no
  duplicated pairing/eligibility state, no terminal database credentials,
  no terminal-to-Supabase path, no caller timestamp as authority, no
  private keys or full certificates in logs, no fake routes for tests.
