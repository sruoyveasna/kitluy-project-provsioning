# KitLuy Configuration Snapshot Contract

**Filename:** `kitluy-configuration-snapshot-contract-v1.0.0.md`  
**Version:** v1.0.0  
**Date:** 2026-07-26  
**Status:** Canonical target contract; not implementation evidence  
**Direction:** KitLuy Cloud → Store Hub → assigned terminals

> **Purpose:** Publish an approved, immutable and reversible Location configuration that the Store Hub can validate and activate atomically without requiring continuous cloud connectivity.

## 1. Authority

- KitLuy Cloud is the author of approved Digital Store and Store Location configuration.
- Store Hub is the authority on whether a package safely activated on the local hardware and software version.
- Terminals consume only the Hub's active snapshot.
- A local operational record retains the configuration snapshot/version under which it was created.
- Store staff cannot edit the signed snapshot locally.

## 2. Package format

File extension: `.kcfg`  
Container: deterministic `tar` compressed with Zstandard  
Maximum compressed size: 100 MiB in Phase 1  
Filename:

```text
kitluy-config-{location_id}-{snapshot_version}.tar.zst
```

Layout:

```text
manifest.json
checksums.sha256
signature.ed25519
sections/
  identity.json
  vertical.json
  catalog.json
  pricing.json
  staff-rbac.json
  terminals.json
  payments.json
  documents.json
  peripherals.json
  storage.json
  feature-flags.json
  policies.json
assets/
  receipt-templates/
  tag-templates/
  localization/
  peripheral-profiles/
```

V1 packages are complete snapshots, not JSON patches. A later delta format requires a new contract version.

## 3. Manifest

```json
{
  "contract": "kitluy.configuration-snapshot",
  "contract_version": "1.0",
  "package_id": "0198...",
  "snapshot_version": 84,
  "tenant_id": "0198...",
  "digital_store_id": "0198...",
  "location_id": "0198...",
  "vertical_code": "laundry",
  "created_at": "2026-07-26T08:30:00Z",
  "created_by": "0198...",
  "approved_by": "0198...",
  "approval_id": "0198...",
  "not_before": "2026-07-26T09:00:00Z",
  "activation_deadline": null,
  "expires_at": null,
  "minimum_hub_version": "1.0.0",
  "maximum_hub_version": null,
  "minimum_local_schema_version": 14,
  "required_capabilities": ["laundry-t1-t4-v1", "print-v1", "files-v1"],
  "previous_snapshot_version": 83,
  "rollback_allowed": true,
  "sections": [
    {
      "code": "catalog",
      "version": 32,
      "required": true,
      "path": "sections/catalog.json",
      "sha256": "64-hex",
      "schema_id": "kitluy.config.catalog.v1"
    }
  ],
  "package_sha256": "64-hex-over-normalized-content-list",
  "signing_key_id": "config-signing-2026-02",
  "signature_algorithm": "Ed25519"
}
```

The signature covers the RFC 8785 canonical manifest with the `package_sha256` populated and the signature file excluded.

## 4. Required sections

| Section         | Required | Contents                                                                     |
| --------------- | -------: | ---------------------------------------------------------------------------- |
| `identity`      |      Yes | Tenant, Digital Store, Location names/codes, timezone, languages, currencies |
| `vertical`      |      Yes | Laundry terminology, workflow version and allowed states                     |
| `catalog`       |      Yes | Services, add-ons, units, availability and versioned display names           |
| `pricing`       |      Yes | Price books, per-piece/per-weight rules, discounts, tax/rounding references  |
| `staff-rbac`    |      Yes | Local staff cache, role grants, offline validity and approval policies       |
| `terminals`     |      Yes | Device assignments and T1–T4 profile grants                                  |
| `payments`      |      Yes | Cash, KHQR and pickup balance policies; no secret private keys               |
| `documents`     |      Yes | Booking, receipt and tag templates, numbering profile and language assets    |
| `peripherals`   |      Yes | Certified hardware profiles and bindings                                     |
| `storage`       |      Yes | Rack/shelf/bin/conveyor positions and capacity rules                         |
| `feature-flags` |      Yes | Enabled features and entitlements for the Location                           |
| `policies`      |      Yes | Offline, retention, approval, privacy and degraded-mode rules                |

A package missing a required section is rejected before staging.

## 5. Secret boundary

Snapshots may contain public identifiers and encrypted references, but must not contain:

- Supabase service-role keys;
- payment-provider private credentials in plaintext;
- device private keys;
- raw staff PINs;
- support credentials;
- object-storage master credentials.

Secrets are provisioned through a separate encrypted device-secret envelope bound to Hub device ID, installation generation and secure-element public key. The snapshot stores only `secret_reference_id` and required generation.

## 6. Section schemas

### 6.1 Identity

```json
{
  "tenant_id": "uuid",
  "digital_store_id": "uuid",
  "location_id": "uuid",
  "location_code": "PP001",
  "display_name": { "km": "...", "en": "..." },
  "timezone": "Asia/Phnom_Penh",
  "default_language": "km",
  "supported_languages": ["km", "en"],
  "currencies": [
    { "code": "KHR", "exponent": 0, "is_default": true },
    { "code": "USD", "exponent": 2, "is_default": false }
  ]
}
```

### 6.2 Terminal assignment

```json
{
  "terminal_device_id": "uuid",
  "terminal_name": "Front Counter 1",
  "profiles": ["laundry_t1", "laundry_t2"],
  "paired_display_device_id": "uuid|null",
  "required_peripherals": ["receipt_printer", "tag_printer", "scanner", "scale"],
  "effective_from": "timestamptz",
  "effective_until": null,
  "assignment_generation": 4
}
```

### 6.3 Payment policy

```json
{
  "cash_enabled": true,
  "khqr_enabled": true,
  "offline_card_capture_enabled": false,
  "pickup_payment_profiles": ["laundry_t1", "laundry_t4"],
  "khqr_release_requires_confirmed_state": true,
  "allowed_tender_combinations": ["cash", "khqr"],
  "provider_reference_id": "paycfg_0198..."
}
```

### 6.4 Offline policy

```json
{
  "maximum_staff_credential_age_hours": 72,
  "maximum_config_age_days": 30,
  "warn_config_age_days": 7,
  "block_security_sensitive_actions_when_trust_age_hours_exceeds": 72,
  "cash_allowed_during_wan_outage": true,
  "khqr_request_behavior_during_wan_outage": "disabled_or_pending_by_provider_policy",
  "notification_behavior": "queue_without_delivery_claim"
}
```

The values above are the v1 default profile and may be overridden only by a signed approved policy.

## 7. Version rules

- `snapshot_version` is strictly increasing per Location.
- Section versions may advance independently but are frozen inside the snapshot.
- Snapshot 84 must name its expected predecessor 83 unless it is a full recovery/bootstrap package.
- A Hub rejects a lower version as a normal upgrade; rollback uses an explicit rollback action and audit event.
- Same version with different package hash is a critical integrity incident.
- A package for another Tenant, Digital Store or Location is rejected.

## 8. Download protocol

1. Sync inbox announces `configuration_snapshot_available`.
2. Hub requests a short-lived signed download URL from Configuration Service.
3. Hub downloads to an inactive staging directory.
4. Hub validates TLS, manifest signature, package hash, every file hash and scope.
5. Hub records snapshot as `verified`.
6. Failed validation quarantines the package and emits a security event.

Partial download state may resume by byte range, but no partial package can be staged.

## 9. Compatibility validation

Before staging, Hub verifies:

- Hub semantic version range;
- local database schema version;
- required capability flags;
- vertical code;
- terminal application minimum versions;
- peripheral driver/profile availability;
- document-template renderer version;
- payment adapter compatibility;
- sufficient disk space;
- activation deadline and trusted clock.

An incompatible package is acknowledged as rejected with exact error codes and remains available for operator review.

## 10. Staging validators

Validators must run without changing active state:

1. JSON Schema validation for all sections.
2. Referential integrity across catalog, pricing, terminals and peripherals.
3. No duplicate location/business codes.
4. Price and currency exponent validation.
5. T1–T4 assignment rules.
6. No T2 mutation permissions.
7. Required printer templates map to a certified printer profile.
8. Storage-position uniqueness and capacity.
9. Staff grants do not exceed the cloud permission registry.
10. Feature flags satisfy entitlements and dependency rules.
11. All localization keys required for Khmer and English exist.
12. No forbidden secret class appears in the package.

## 11. Atomic activation

```text
downloaded
→ verified
→ staged in database transaction
→ run pre-activation validators
→ acquire configuration activation lock
→ write sections and new projections
→ switch active_snapshot_id atomically
→ reload dependent services
→ run health checks
→ active
```

The activation transaction either completes or exposes the previous snapshot unchanged.

### 11.1 Health checks

- local API healthy;
- PostgreSQL writable;
- actor login using test fixture succeeds;
- T1/T2 session projection validates;
- T3 and T4 profile permissions compile;
- printer/scale binding configuration parses;
- payment adapter configuration loads without using live money;
- event/outbox insert test succeeds and is rolled back;
- terminal clients can fetch the new version.

## 12. Terminal distribution

Terminals do not receive the entire package by default. Hub exposes a signed, profile-scoped projection containing only:

- Location display identity;
- assigned profile and permissions;
- UI/localization assets;
- required catalog/pricing view;
- peripheral bindings;
- policy values needed for the profile.

T2 receives a display-only projection. Terminals verify the Hub signature and version before use.

## 13. Rollback

Rollback triggers:

- activation health check failure;
- critical runtime error threshold after activation;
- operator-approved emergency rollback;
- cloud revocation of a faulty snapshot.

Process:

```text
lock activation
→ preserve failed snapshot and diagnostics
→ atomically reactivate previous known-good snapshot
→ restart/reload dependent services
→ health check
→ emit configuration.rolled_back event
→ notify cloud
```

Historical Bookings remain associated with the snapshot under which they were created.

## 14. Emergency revocation

A signed `configuration_revocation` message can mark a snapshot unsafe. The Hub:

1. verifies signature and scope;
2. stops new actions dependent on the revoked section;
3. rolls back if a compatible known-good snapshot exists;
4. otherwise enters scoped degraded mode;
5. preserves unrelated Store operations where safe;
6. emits security and operational events.

## 15. Freshness and expiry

- UI shows active version and published time.
- At warning age, the Hub and terminals show “configuration update delayed.”
- At maximum age, ordinary Laundry operation may continue if policy permits.
- Security/trust or payment configuration can have a shorter fail-closed expiry.
- Cloud portals show the last activated version and acknowledgement time, not merely the latest published version.

## 16. Audit events

```text
configuration.download_started
configuration.download_completed
configuration.verification_failed
configuration.staged
configuration.activated
configuration.activation_failed
configuration.rolled_back
configuration.revoked
configuration.terminal_projection_served
```

Every event includes package ID, snapshot version, hashes, actor/device, previous version and result.

## 17. Error codes

| Code                           | Meaning                                    |
| ------------------------------ | ------------------------------------------ |
| `CFG_SIGNATURE_INVALID`        | Signature cannot be verified               |
| `CFG_HASH_MISMATCH`            | Package or section checksum mismatch       |
| `CFG_SCOPE_MISMATCH`           | Wrong Tenant/Store/Location                |
| `CFG_VERSION_REGRESSION`       | Lower version without rollback authority   |
| `CFG_VERSION_HASH_COLLISION`   | Same version, different hash               |
| `CFG_SCHEMA_UNSUPPORTED`       | Section schema unsupported                 |
| `CFG_HUB_VERSION_INCOMPATIBLE` | Hub version outside range                  |
| `CFG_DEPENDENCY_MISSING`       | Required capability/driver/template absent |
| `CFG_VALIDATION_FAILED`        | Business validator rejected package        |
| `CFG_ACTIVATION_HEALTH_FAILED` | Post-switch health check failed            |
| `CFG_NO_ROLLBACK_TARGET`       | No valid previous package                  |

## 18. Acceptance tests

1. Corrupt one byte; package is rejected.
2. Replay same version/hash; no duplicate activation.
3. Same version/different hash triggers security incident.
4. Package for another Location is rejected.
5. Missing required Khmer key blocks activation.
6. T2 mutation permission in snapshot blocks activation.
7. Power loss during activation leaves old or new complete snapshot, never partial state.
8. Failed health check automatically restores previous known-good snapshot.
9. WAN failure after activation does not affect use of active snapshot.
10. Terminal receives only its profile-scoped projection.
