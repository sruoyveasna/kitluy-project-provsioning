# Supabase device schema inventory

**Date:** 2026-08-07
**Source:** live inspection of a database built by applying all 86 canonical
migrations to an empty PostgreSQL 15 instance (see `05_CLOUD_SUPABASE_PLAN.md`
for the run record). Every count below is queried, not read from a document.

---

## 1. Coverage against the mission's requested capabilities

The mission (§10–§17) lists the cloud capabilities the edge platform needs.
Each already exists:

| Mission requirement               | Canonical implementation                                                                                                                                       | Status  |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| §10 Device identity               | `devices`, `hardware_profiles`, `hardware_manifests`, `hardware_manifest_signals`, `hardware_observations`                                                     | present |
| §10 Trust state                   | `trust_policy`, `device_trust_incidents`, `pki_trust_configuration`                                                                                            | present |
| §11 Enrollment                    | `manufacturing_enrollments`, `enrollment_stations`, `device_claims`, `device_claim_events`                                                                     | present |
| §11 Enrollment tokens             | `device_provisioning_codes`, `device_provisioning_code_events`, `device_provisioning_pop_challenges`                                                           | present |
| §11 Certificate issuance metadata | `device_certificates`, `device_credentials`, `device_credential_requests`, `device_credential_heads`, `device_credential_chain_links`                          | present |
| §12 Fleet status / heartbeat      | `device_health_reports`, `device_health_projections`, `device_fleet_status` (view), `fleet_health_read` (view), `fleet_health_policy`                          | present |
| §13 Store Hub assignment          | `device_assignments`, `device_assignment_projections`, `hub_replacement_operations`, `hub_replacement_events`                                                  | present |
| §14 Terminal assignment           | `device_terminal_assignments`, `device_terminal_activation_challenges`, `device_terminal_provisioning_activations`, `terminal_pairing_receipts`                | present |
| §15 Configuration publication     | `kitluy_config.configuration_versions`, `configuration_publications`, `configuration_targets`, `configuration_acknowledgements`                                | present |
| §16 Release management            | `kitluy_releases.release_channels`, `release_artifacts`, `rollout_campaigns`, `device_installations`, `release_events`                                         | present |
| §17 Audit                         | `device_lifecycle_events`, `device_credential_lifecycle_events`, `device_containment_events`, `support_access_events`, `release_events`, `device_claim_events` | present |

**Totals:** `kitluy_devices` 66 relations (64 tables + `device_fleet_status` and
`fleet_health_read` views) · `kitluy_releases` 5 · `kitluy_config` 4.

---

## 2. The canonical registries — do not invent alternatives

The mission warned against inventing enum values. These exist and are
authoritative. New code must mirror them.

**`device_class`** — covers the mission's §3 requirement exactly:

    store_hub, terminal, manufacturing_station, peripheral

**`device_lifecycle_state`**:

    manufactured, enrolled, awaiting_trust, quarantined,
    restricted_investigation, active, suspended, retired, replaced

**`assignment_state`**: `pending_trust, active, superseded, revoked`
**`provisioning_code_state`**: `issued, redeemed, locked, expired, revoked`
**`claim_state`**: `issued, redeemed, expired, revoked`
**`credential_state`**: `issued, revoked, superseded, expired`
**`hardware_trust_level`**: `development_software, tpm_2_0, secure_element`
**`trusted_time_status`**: `uninitialized, trusted, restricted_rtc_failure, restricted_clock_rollback, restricted_forward_jump, restricted_no_trusted_source`

27 enum types exist in `kitluy_devices` in total.

### 2.1 `ENROLLED_UNASSIGNED` is not a state — and must not become one

The mission's §2 lifecycle sketch names `ENROLLED_UNASSIGNED`. **No such enum
value exists and none was added.** The canonical model expresses that condition
as `lifecycle_state = 'enrolled'` **with no active row in `device_assignments`**.

This is the correct model and adding the value would be actively harmful: a
device's assignment status would then live in two places that could disagree.
`services/kitluy-device-firstboot-agent` implements the condition the canonical
way and carries a test asserting it (`enrollment.test.ts`, "a factory-fresh
device enrolls and becomes 'enrolled' with no assignment").

### 2.2 `enrolled -> active` does not exist

Migration group `0121` **removed** that transition. `active` is reachable only
from `awaiting_trust`, which is reachable only through an accepted claim and a
bound assignment. The firstboot agent therefore moves an assigned device to
`awaiting_trust`, never to `active`, and a test pins it.

### 2.3 Enrollment is a manufacturing act, not a network call

The mission's §25 first-boot sketch implies a device creates its own enrollment
by calling the cloud. The canonical model does not work that way: enrollment is
a **governed manufacturing-time record** (`manufacturing_enrollments`, sealed,
created at an `enrollment_station`). A device proves possession of the already
sealed key; it does not mint its own enrollment.

Recorded as a specification-vs-implementation divergence, resolved in favour of
the canonical model. See `06_DEVICE_AND_ENROLLMENT_MODEL.md` §3.

---

## 3. Private-key handling

`kitluy_devices` stores public keys, fingerprints, certificate metadata and
key **state** (`device_key_state`, `device_generation_keys`, `device_key_holds`,
`device_key_destruction_*`). It stores **no private key material**. The mission's
§30 prohibition is already satisfied by the existing schema, and the new
firstboot agent preserves it structurally — `IdentityRecord` has no
private-key field, so a caller cannot transmit one by accident.

---

## 4. Gaps found

| Gap                                                                                                                                         | Severity     | Disposition                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------- |
| No cloud target carries this schema                                                                                                         | **blocking** | `05_CLOUD_SUPABASE_PLAN.md`                                                                    |
| `KLREQ-VERTICAL-ENVELOPE-001` — configuration envelope has no explicit vertical field; vertical is derived from the terminal-profile prefix | recorded     | pre-existing, owned by the task that owns the signed envelope contract; **not** addressed here |
| `production_eligible` has no path to `true`                                                                                                 | by design    | BLK-005 §4 hardware SKU gate                                                                   |
| Readiness probe in `kitluy-device-registry-service` does not probe the database                                                             | recorded     | pre-existing, documented in that service's `main.ts`                                           |

**No schema gap was found that required a new migration.** No migration was
written by this mission, and the migration count is unchanged at 86.
