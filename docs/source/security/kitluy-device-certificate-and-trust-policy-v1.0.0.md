# KitLuy Device Certificate and Trust Policy

**Filename:** `kitluy-device-certificate-and-trust-policy-v1.0.0.md`  
**Version:** v1.0.0  
**Date:** 2026-07-26  
**Owner:** HET / KitLuy Suite Project Owner  
**Status:** Canonical target contract; not implementation evidence  
**Primary phase:** Phase 1 — Laundry, designed as a shared cross-vertical foundation  
**Locales / currencies / timezone:** Khmer and English; KHR and USD; `Asia/Phnom_Penh`

> **Implementation truth:** This document specifies required behavior. It does not prove that repositories, migrations, tests, deployments, certificates, key stores, or production controls exist. `IMPLEMENTED` requires verified evidence.

## Authority and source baseline

Authority order:

1. Current owner decisions and active KitLuy Project Instructions.
2. Applied migrations, verified code/tests, deployment records, and production evidence.
3. This security and authorization pack.
4. Current KitLuy Rebuild and Business Bibles and approved product specifications.
5. Approved handoffs and registries.
6. Evidence-based competitor analyses and classifications.
7. Competitor clone documents and superseded planning.

Primary source baseline:

- `kitluy-admin-pwa-portal-phase1-spec-v3.1.0.md` — explicit permissions, scopes, environments, A0–A4 approvals, service-identity isolation, access review, support consent, audit, and three-layer enforcement.
- `kitluy-storehub-phase1-spec-v1.0.0.md` — managed-device trust, manufacturing and operational certificates, secure boot, cloned-device defenses, Hub-first provisioning, replacement and recovery.
- `kitluy-ecosystem-infrastructure-phase1-spec-v1.0.0.md` — Supabase/DigitalOcean responsibility split, secret classes, PKI custody, CI/CD, cloud/edge boundaries, and progressive infrastructure controls.
- Current KitLuy Project Instructions — Digital Store authority, Store Hub offline operation, append-only finance/payment/inventory/audit truth, human confirmation for sensitive actions, and no connector direct database access.

## Shared invariants

- Role names organize grants; they are never authoritative by themselves.
- Every privileged request resolves an explicit permission, target resource, resource scope, environment, identity type, validity window, and policy version.
- Missing context fails closed.
- Frontend visibility is not a security boundary. API/worker authorization and Supabase RLS/database rules are mandatory.
- Sensitive finance, permission, compliance, safety, release, migration, device, and production actions require authorized human confirmation according to policy.
- Finalized audit records are append-only; corrections create new events.
- Service accounts and device identities cannot inherit human team membership or interactive login rights.
- No browser, POS client, Storefront, connector, or ordinary operator receives Supabase service-role credentials, CA private keys, release signing keys, or other platform root secrets.
- Store Hub and T1–T4 remain operational offline after provisioning; offline continuity does not weaken identity, permission, custody, payment, or audit requirements.

## 1. Purpose

This policy defines how HET-managed Store Hubs and terminals become trusted, remain trusted, rotate identity, recover, and are revoked. IP address, hostname, MAC address, serial number, or possession of a copied OS image is never sufficient trust.

## 2. Trust model

```text
HET Root / Offline Root CA
  -> Manufacturing / Enrollment Intermediate
      -> Manufacturing device certificate
  -> Operational Device Intermediate(s) by environment
      -> Store Hub operational certificate
      -> Terminal operational certificate
  -> Release Signing Intermediate (separate purpose)
```

CA and release-signing purposes remain separated. Root keys are offline/non-exportable or HSM-protected where approved.

## 3. Device identity layers

| Layer                  | Purpose                               | Examples                                                                                                                    |
| ---------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Hardware registry      | Proves HET recorded the physical unit | asset ID, Pi serial/board identity, TPM/secure element ID where available, network interfaces, NVMe identity, model/profile |
| Manufacturing identity | Proves enrollment by HET station      | manufacturing certificate, manifest hash, enrollment batch, station/operator                                                |
| Software trust         | Proves approved boot/runtime          | secure boot state, signed image, OS/Hub version, measured/verified components where supported                               |
| Operational identity   | Binds device to KitLuy scope          | device UUID, Tenant, Digital Store, Location, role/profile, environment certificate                                         |
| Assignment             | Defines current purpose               | Hub, T1, T2, T3, T4, shared T3/T4 hardware modes, peripherals                                                               |
| Runtime posture        | Detects compromise/degradation        | heartbeat, cert state, software/config compatibility, clock, duplicate identity, health                                     |

Hardware values are signals, not a single secret. Changing repairable parts follows approved RMA/re-enrollment; it does not silently clone or permanently brick the business record.

## 4. Manufacturing enrollment

Only an approved HET manufacturing/repair station may:

1. verify physical asset and hardware manifest;
2. install approved KitLuy OS/image;
3. establish secure boot and disk-encryption state where supported;
4. generate private key on device in non-exportable storage where supported;
5. issue manufacturing certificate;
6. register manifest and certificate serial;
7. seal enrollment evidence and operator/station audit.

Raw device private keys are never copied into the Admin Portal or backed up as files.

## 5. Provisioning

Canonical sequence:

```text
Digital Store exists
 -> Store Location exists
 -> HET-registered Store Hub selected
 -> short-lived provisioning code/QR created
 -> Hub authenticates with manufacturing identity
 -> server verifies hardware manifest, image, non-duplicate state, assignment, and code
 -> operational key generated/confirmed
 -> operational certificate issued for exact Tenant/Digital Store/Location/environment
 -> initial configuration and trust bundle synchronized
 -> Hub health validation passes
 -> Hub becomes Active
 -> terminals are provisioned through the Active Hub
```

Terminals receive assigned T1–T4 profiles; the installer cannot change role by editing local files.

## 6. Certificate contents and constraints

Operational certificate/SAN/claims identify at minimum:

- device UUID;
- identity class Hub/terminal/manufacturing station;
- environment;
- Tenant, Digital Store, Location assignment reference or authorized binding token;
- allowed Edge API client purpose;
- certificate serial, issuer, validity;
- hardware-manifest reference/hash;
- key-usage restrictions.

Do not encode unnecessary customer or personal data.

## 7. Authentication and channel security

- Cloud Edge Operations API uses mutual TLS or equivalent certificate-bound authentication.
- Hub-to-terminal LAN channels use certificate-backed pairing and short-lived sessions.
- TLS validation is strict; no global certificate bypass.
- Manual IP is recovery routing only, not identity.
- Discovery responses are untrusted hints until certificate and assignment verification completes.
- Certificate status/revocation is checked according to online/offline policy.
- Offline local trust uses cached signed trust bundle with expiry and revocation handling.

## 8. Clone and duplicate defense

Signals include:

- same operational certificate used by multiple active endpoints;
- manufacturing certificate/manifest mismatch;
- unexpected hardware-manifest change;
- key possession from incompatible device posture;
- simultaneous Location claims;
- replayed provisioning code/session;
- copied disk/image without valid non-exportable key;
- altered secure-boot or signed-image state;
- sequence/heartbeat anomalies.

Response:

1. quarantine new or conflicting session;
2. preserve Store offline operation when safe on the previously trusted Hub;
3. alert security/fleet owner;
4. record `device.clone_detected`;
5. require investigation and A3/A4 identity decision;
6. revoke compromised certificate and issue replacement only through approved recovery.

## 9. Rotation

- Routine operational certificate rotation: automated under approved policy and device health.
- Emergency rotation: compromise, owner change, CA event, or material repair.
- Overlap window is minimal and old certificate is revoked after confirmation.
- Offline devices that exceed grace/expiry enter restricted mode according to `[REQUIRED: offline certificate grace policy]`; they do not silently gain perpetual trust.

## 10. Revocation

Triggers:

- lost/stolen device;
- clone/duplicate suspicion;
- private-key or CA compromise;
- unauthorized repair/change;
- decommission;
- transfer to another Location without approved reassignment;
- unsupported/unsafe software state;
- Partner/Location closure under policy.

Revocation closes cloud sessions, invalidates queued privileged actions, blocks re-provision, and distributes revocation to relevant Hubs/terminals. Historical audit and asset records remain.

## 11. Repair, NVMe failure, and replacement

- Normal field operation does not permit unregistered NVMe replacement and silent reactivation.
- Preferred recovery is replacement with an HET-managed spare Hub.
- HET repair may replace NVMe, reinstall KitLuy OS, generate new key, update hardware manifest, revoke old operational identity, and re-enroll under RMA case.
- Restored operational data comes from approved backup/sync sources, never from copying old private keys.
- Replacement requires no duplicate active Hub identity and passes full T1–T4/peripheral/offline/reconnect validation.

## 12. Release and configuration trust

- Hub and terminals install only signed artifacts with verified checksum, platform, compatibility, and channel authorization.
- Store Hub downloads once and distributes over LAN.
- A/B installation and rollback preserve last known good state.
- Configuration publications are immutable, checksummed, versioned, signed/verified, and scope-bound.

## 13. Data model

Required relational tables:

- `devices`
- `hardware_manifests`
- `manufacturing_enrollments`
- `device_certificates`
- `certificate_revocations`
- `device_assignments`
- `provisioning_sessions`
- `device_attestations`
- `device_trust_incidents`
- `device_actions`
- `rma_cases`
- `trust_bundle_versions`

## 14. Tests

- Unregistered hardware cannot provision.
- Copied OS/NVMe without valid device key cannot claim identity.
- Replayed/expired/wrong-Location provisioning code fails.
- Duplicate certificate use is detected/quarantined.
- MAC/IP/hostname change alone cannot establish or destroy identity.
- Hardware-manifest mismatch follows repair policy, not silent acceptance.
- Revoked device cannot reconnect through cloud or Hub trust paths.
- Terminal cannot change T1–T4 role locally.
- Expired trust bundle follows restricted/offline policy.
- Unsigned/checksum-mismatched release/configuration is rejected.
- Replacement Hub restores operation without duplicate active identity.

## Appendix A — Open values

- `[REQUIRED: root/intermediate CA topology and custody]`
- `[REQUIRED: TPM/secure-element reference hardware decision]`
- `[REQUIRED: certificate lifetimes, rotation, CRL/OCSP, and offline grace]`
- `[REQUIRED: secure boot and disk encryption implementation profile]`
- `[REQUIRED: clone-detection thresholds and quarantine runbook]`
