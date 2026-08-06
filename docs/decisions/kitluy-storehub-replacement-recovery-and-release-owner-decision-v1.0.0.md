# KitLuy Store Hub Replacement, Recovery and Release — Owner Decision v1.0.0

**Filename:** `kitluy-storehub-replacement-recovery-and-release-owner-decision-v1.0.0.md`
**Decision ID:** KLD-2026-08-06-WS11-T006-001
**Date:** 2026-08-06
**Owner:** HET / KitLuy Suite Project Owner
**Status:** OWNER-APPROVED — LOCKED. Recorded verbatim from the WS-11-T006
master execution prompt; these decisions require no additional owner
confirmation.
**Resolves:** the replacement-identity, recovery-truth, backup-policy,
release-trust, installation-gate and configuration-publication values
WS-11-T006 P01–P04 implement.
**Does NOT resolve:** BLK-005 (production signing custody — Pilot/Stable
installation stays fail-closed), BLK-006 (production Hub↔cloud transport),
production backup-upload provider values.

---

## 1. Hub identity during replacement (LOCKED)

A Hub identity may NEVER be cloned.

**Same Raspberry Pi, replacement NVMe:** the Hub UUID may remain the same; a
NEW operational key and certificate are generated after restore; the prior
operational certificate is revoked; the prior private key is never restored
or copied; a governed terminal trust update and re-pairing are required;
previous pairing receipts are retained as immutable historical evidence.

**Replacement Raspberry Pi:** a NEW Hub UUID; a new operational key and
certificate; provisioning through the existing governed authority; an
explicit Store/Location assignment cutover; the old Hub identity revoked and
retired; terminals discover, verify and pair with the new Hub; the old Hub
identity is never silently transferred.

At most ONE Hub may be the active local operational authority for a
Location. A replacement Hub may be prepared before cutover but cannot become
active until the atomic cutover decision completes.

## 2. Replacement approval (LOCKED)

Replacement and cutover require: an authorized operator; explicit Tenant,
Store and Location scope; a recorded reason; reauthentication; independent
four-eyes approval; immutable audit evidence; an idempotency key; a
correlation ID. Emergency compromise containment may revoke the old Hub
before replacement is ready, but must not declare a new Hub active without
the normal cutover gate.

## 3. Recovery truth (LOCKED)

Authoritative business records come from: (1) the surviving Hub database
when intact; (2) otherwise the newest valid encrypted, integrity-verified
backup; (3) cloud projections only for reconciliation — never as automatic
replacement for missing local transaction truth. Cloud projections cannot
silently recreate authoritative offline transactions. Recovery preserves:
local transaction identifiers; outbox identifiers; command and effect keys;
append-only audit history; finalized payment, finance and inventory facts;
configuration versions; release state; pairing and activation history.

## 4. Backup policy (Phase 1 development defaults; configurable by signed policy)

Encrypted local snapshot every 15 minutes; mandatory snapshot before
configuration-schema migration, before release installation and before
replacement cutover; daily full verified backup at 02:00 Asia/Phnom_Penh;
retain 96 periodic snapshots and 30 daily full backups; upload
asynchronously when WAN is available; local operations never wait for
upload. Each backup carries: backup ID; Hub, Store and Location scope;
database schema version; configuration version; release version;
created-at; completed-at; SHA-256 digest; encryption metadata; manifest
version; status; verification result. Private operational keys are never
exported in plaintext or stored in backup database contents.

## 5. Release trust (LOCKED)

Manifest version **1**; artifact digest **SHA-256**; manifest signature
**Ed25519**. Channels: **Internal → Pilot → Stable**, promotion order fixed,
no skips. Development/Internal releases may use the approved development
signer; Pilot and Stable installation remain fail-closed under BLK-005 until
production signing custody and approval evidence exist. A release URL,
filename or channel label is never sufficient trust. Every Store Hub and
terminal independently verifies: manifest signature; artifact digest;
artifact size; product/application identity; target architecture; hardware
profile; environment; release channel; version; compatibility range;
database and configuration prerequisites; rollback artifact identity.

## 6. Installation and rollback (LOCKED development health gate)

A/B installation slots where supported. Health-verification window 5
minutes; probe interval 20 seconds; 3 consecutive successful probes
required; failure during the window triggers automatic rollback; only ONE
automatic rollback attempt; after rollback the state is
`failed_rolled_back`; further retry requires an authorized operator or a
newer signed release. A successful installation is not promoted to current
until the health gate passes. A failed migration, service startup, LAN API,
database, disk, signature or compatibility check prevents promotion. Queued
offline transactions survive installation and rollback.

## 7. Configuration publication (LOCKED)

Configuration snapshots remain separate from application releases.
Configuration is versioned, signed, scoped, additive or explicitly
migration-controlled, cached by the assigned Hub, applied idempotently, and
rollback-capable. A newer application release must not silently make an
incompatible configuration current.
