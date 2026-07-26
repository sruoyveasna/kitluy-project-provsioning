# KitLuy Device Discovery and Pairing Protocol

**Filename:** `kitluy-device-discovery-and-pairing-protocol-v1.0.0.md`  
**Version:** v1.0.0  
**Date:** 2026-07-26  
**Status:** Canonical target protocol; not implementation evidence  
**Applies to:** Store Hub, T1–T4 terminals and approved local peripherals

> **Experience goal:** Add device → power on → connect to network → enter or scan code → KitLuy handles the rest.

## 1. Trust principle

Discovery answers **where** a device may be reached. Pairing and certificates determine **whether** it is trusted. An IP address, MAC address, mDNS name or provisioning code never creates trust by itself.

## 2. Prerequisites

### Store Hub

- Physically processed and factory-enrolled by HET.
- Valid manufacturing certificate and proof of hardware-backed private key.
- Status `provisioning_eligible`.
- Approved OS image and secure-boot state.
- One-time provisioning code bound to intended Digital Store/Location.

### Terminal

- HET-enrolled or approved managed terminal image.
- Terminal device record and assignment created in Partner/Admin control plane.
- Active Store Hub already provisioned for the Location.
- One-time terminal provisioning code bound to terminal device ID and assigned profiles.

## 3. Network ports

| Port | Protocol      | Direction                        | Purpose                               |
| ---: | ------------- | -------------------------------- | ------------------------------------- |
| 5353 | UDP multicast | LAN                              | mDNS discovery                        |
| 7443 | TCP TLS       | Terminal → Hub                   | Edge Operations API and WebSocket     |
|  123 | UDP outbound  | Hub/terminal                     | Approved NTP where permitted          |
|  443 | TCP outbound  | Hub/terminal during provisioning | KitLuy Cloud provisioning and updates |

No unauthenticated business API is exposed. Host firewall is default deny.

## 4. Hub mDNS advertisement

Service type:

```text
_kitluy-hub._tcp.local
```

Instance:

```text
KitLuy Hub {asset_number}
```

TXT record fields:

```text
proto=1
port=7443
hub_id_hash=<first-16-hex-of-sha256-hub-uuid>
location_id_hash=<first-16-hex-or-unassigned>
assignment_generation=7
api_version=1
pairing=closed|open-assigned-only
config_version=84
cert_fp8=<first-8-bytes-fingerprint>
```

No Tenant name, customer data, provisioning code, full certificate fingerprint or secret is advertised.

TTL: 120 seconds. Advertisement is disabled while Hub trust state is quarantined or revoked.

## 5. Connection priority

```text
1. Assigned Hub private IP from signed assignment
2. Assigned Hub hostname
3. Signed mDNS discovery on the Store LAN
4. Last successful trusted Hub IP
5. Latest trusted Hub endpoint reported through cloud
6. Manual IP recovery override
```

Every candidate endpoint must still pass certificate, Hub UUID, Tenant, Digital Store, Location and assignment-generation checks.

## 6. Store Hub provisioning flow

```text
Power on HET-enrolled Hub
→ select Khmer/English
→ connect to internet
→ enter/scan one-time provisioning code
→ send manufacturing certificate, manifest and nonce
→ cloud challenges hardware-backed key
→ compare HET registry identity and OS posture
→ authorized assignment approval
→ issue operational certificate
→ download signed configuration snapshot
→ run local database migrations and health tests
→ mark Hub active
```

### 6.1 Provisioning code

- 8 characters using unambiguous Crockford Base32.
- Valid for 15 minutes by default.
- Single-use.
- Bound to device ID, assignment intent and environment.
- Stored only as a salted hash.
- Five failed attempts lock the session and emit a security event.
- Does not bypass factory identity or cryptographic challenge.

## 7. Terminal provisioning flow

```text
Power on terminal image
→ select language
→ connect to Store LAN and internet
→ enter/scan terminal provisioning code
→ cloud validates terminal enrollment and assignment
→ terminal creates/proves non-exportable key
→ cloud issues terminal operational certificate
→ terminal receives assigned Hub identity and profile set
→ discover candidate Hub endpoints
→ verify Hub certificate and assignment
→ Hub verifies terminal certificate, device assignment and profile
→ establish pairing session
→ download profile-scoped configuration
→ test display and required peripherals
→ mark terminal active
```

The installer cannot choose T1–T4 roles. Role/profile assignment is cloud-authored and Hub-enforced.

## 8. Pairing handshake

### 8.1 Terminal → Hub hello

```json
{
  "protocol_version": "1.0",
  "terminal_device_id": "0198...",
  "terminal_installation_id": "0198...",
  "assignment_generation": 4,
  "tenant_id": "0198...",
  "digital_store_id": "0198...",
  "location_id": "0198...",
  "requested_profiles": ["laundry_t1", "laundry_t2"],
  "terminal_app_version": "4.0.0",
  "nonce": "base64"
}
```

The request is sent over mTLS using the terminal operational certificate.

### 8.2 Hub challenge

```json
{
  "pairing_session_id": "0198...",
  "hub_device_id": "0198...",
  "hub_assignment_generation": 7,
  "hub_certificate_fingerprint": "64-hex",
  "challenge": "base64",
  "active_config_version": 84,
  "expires_at": "timestamptz"
}
```

### 8.3 Terminal proof and Hub acceptance

Terminal signs the challenge with its non-exportable private key. Hub verifies:

- certificate chain and revocation state;
- terminal device and installation IDs;
- matching scope and assignment generation;
- requested profile subset;
- terminal application compatibility;
- provisioning/pairing session not expired or consumed.

Hub returns a pairing receipt signed by the Hub key.

## 9. Pairing receipt

```json
{
  "pairing_id": "0198...",
  "hub_device_id": "0198...",
  "terminal_device_id": "0198...",
  "tenant_id": "0198...",
  "digital_store_id": "0198...",
  "location_id": "0198...",
  "profiles": ["laundry_t1", "laundry_t2"],
  "assignment_generation": 4,
  "issued_at": "timestamptz",
  "valid_until": null,
  "hub_api": "https://kitluy-hub-HET000123.local:7443/edge/v1",
  "hub_certificate_fingerprint": "64-hex",
  "signature": "base64"
}
```

The terminal stores the receipt, assigned endpoint list and Hub fingerprint in encrypted application storage.

## 10. Pairing state machine

```text
unprovisioned
→ cloud_authorized
→ certificate_issued
→ hub_discovered
→ hub_verified
→ profile_received
→ peripheral_validation
→ active
```

Exceptional states:

```text
expired
assignment_mismatch
certificate_rejected
quarantined
revoked
maintenance_required
```

## 11. Reconnection after pairing

Normal reconnection does not require a provisioning code. Terminal:

1. selects endpoint by connection priority;
2. validates Hub certificate/fingerprint and assignment;
3. presents terminal certificate;
4. validates pairing receipt and active profile assignment;
5. opens an actor session.

If Hub IP changes but certificate and assignment remain valid, connection may continue and the cached endpoint is updated.

## 12. Manual IP fallback

Manual IP entry is available only in recovery UI.

- Requires installer/support permission or a physical recovery code generated for the assigned device.
- Does not suppress certificate validation.
- Is stored as a lower-priority endpoint.
- Creates an audit event.
- Expires after a successful signed discovery/assignment refresh unless policy preserves it.

## 13. Device replacement and re-pairing

### Terminal replacement

- Old terminal assignment is ended/revoked.
- New HET-enrolled terminal receives a new device and installation identity.
- Profiles are reassigned explicitly.
- Historical events remain attributed to old device.

### Hub replacement

- Failed Hub credential is suspended/revoked.
- Replacement Hub is assigned to the same Location with a new assignment generation.
- Cloud publishes new Hub identity to assigned terminals.
- Terminals reject the old Hub after receiving the signed assignment update.
- Re-pairing preserves terminal identities but creates a new pairing receipt.

## 14. Peripheral discovery

Peripherals are not trusted as Hub/terminal identities. Discovery adapters may identify:

- USB VID/PID and serial;
- network printer IP, MAC and service;
- serial port and device descriptor;
- scale protocol response;
- display EDID;
- UPS USB HID identity.

A discovered peripheral becomes usable only after it matches an approved hardware profile and an authorized binding is activated through configuration.

## 15. Rogue-device protections

- Unknown Pi with copied image cannot receive an operational certificate.
- Cloned NVMe on another board fails hardware-key and manifest verification.
- Rogue Hub mDNS advertisement fails certificate and assignment checks.
- Terminal certificate from another Location fails scope validation.
- Provisioning code captured from screen cannot bypass device binding.
- Replayed pairing receipt fails assignment generation or certificate validation.
- MAC spoofing has no trust effect.

## 16. Offline behavior

- Initial provisioning requires internet.
- After successful pairing, WAN failure does not prevent Hub-terminal LAN operation.
- Terminal uses cached signed pairing receipt, certificate and last valid trust snapshot.
- Expired or revoked certificate policy may block new sessions even when LAN is healthy.
- mDNS failure does not stop operation when an assigned endpoint remains reachable.

## 17. Audit events

```text
device.discovery_observed
device.provisioning_code_issued
device.provisioning_attempted
device.provisioned
device.provisioning_denied
device.pairing_started
device.paired
device.pairing_failed
device.manual_endpoint_used
device.assignment_changed
device.revoked
device.replaced
peripheral.discovered
peripheral.binding_validated
```

## 18. Error codes

| Code                        | Meaning                                   |
| --------------------------- | ----------------------------------------- |
| `PAIR_CODE_INVALID`         | Unknown/incorrect code                    |
| `PAIR_CODE_EXPIRED`         | Code expired                              |
| `PAIR_CODE_CONSUMED`        | Code already used                         |
| `PAIR_DEVICE_NOT_ELIGIBLE`  | Device not HET-enrolled/eligible          |
| `PAIR_HARDWARE_MISMATCH`    | Manifest or hardware key mismatch         |
| `PAIR_ASSIGNMENT_MISMATCH`  | Tenant/Store/Location/profile mismatch    |
| `PAIR_CERT_INVALID`         | Certificate invalid/revoked               |
| `PAIR_HUB_NOT_ACTIVE`       | Terminal cannot pair before Hub active    |
| `PAIR_PROFILE_FORBIDDEN`    | Requested profile not assigned            |
| `PAIR_VERSION_INCOMPATIBLE` | Client/Hub protocol mismatch              |
| `PAIR_CHALLENGE_FAILED`     | Cryptographic proof invalid               |
| `PAIR_PERIPHERAL_REQUIRED`  | Required pilot hardware validation failed |

## 19. Acceptance tests

1. Unknown Pi with copied KitLuy image cannot provision.
2. Cloned NVMe on different board enters quarantine.
3. Pairing code cannot be reused.
4. Terminal assigned to Location A cannot pair with Hub B.
5. Rogue mDNS record never passes certificate validation.
6. Hub IP change reconnects without re-provisioning.
7. Manual IP still requires full trust verification and is audited.
8. WAN loss after pairing preserves T1–T4 LAN operation.
9. Profile change requires signed cloud assignment and config activation.
10. Revoked old Hub is rejected after replacement assignment reaches terminals.
