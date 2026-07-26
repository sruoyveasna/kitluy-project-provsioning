# KitLuy Store Hub Recovery and Replacement Runbook

**Filename:** `kitluy-storehub-recovery-and-replacement-runbook-v1.0.0.md`  
**Version:** v1.0.0  
**Date:** 2026-07-26  
**Status:** Canonical target runbook; not implementation evidence  
**Primary policy:** Replace the complete Store Hub first; repair the failed unit later at HET.

> **Objective:** Restore a Store Location without duplicating payments, receipts, notifications, inventory movements or garment-custody events, while preserving the closed HET-managed-device trust model.

## 1. Roles

| Role              | Responsibility                                                                  |
| ----------------- | ------------------------------------------------------------------------------- |
| Store manager     | Stop unsafe workflows, preserve physical evidence, confirm operational recovery |
| HET Support       | Triage, open incident, guide Store and coordinate replacement                   |
| Fleet operator    | Suspend/revoke devices, assign replacement, validate health                     |
| Security operator | Handle identity mismatch, clone suspicion, theft or key compromise              |
| Finance operator  | Review payment/cash reconciliation                                              |
| Edge engineer     | Database/checkpoint recovery and sync reconciliation                            |
| Approver          | Four-eyes approval for sensitive production recovery actions                    |

No Store employee is authorized to replace the NVMe, reimage the Hub, copy certificates or approve unknown Raspberry Pi hardware.

## 2. Recovery objectives

These are target objectives, not proven SLA evidence:

| Data/condition                                                         | Target                                                              |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Cloud-acknowledged data RPO                                            | 0; cloud copy already committed                                     |
| Unacknowledged data RPO with intact NVMe/checkpoint                    | 0 after successful extraction/restore                               |
| Unacknowledged data RPO with destroyed Hub and no secondary checkpoint | Since last successful cloud sync; unavoidable loss must be declared |
| Replacement on-site RTO                                                | 60 minutes target after replacement approval                        |
| Replacement delivery RTO                                               | `[REQUIRED: commercial hardware replacement SLA]`                   |
| Same-unit HET NVMe repair                                              | Not an in-Store recovery path                                       |

The system must never advertise an RPO or RTO better than available evidence.

## 3. Recovery assets required before go-live

- At least one pre-enrolled spare Hub per pilot region or agreed replacement SLA.
- Signed current and previous configuration snapshots.
- Current Hub/terminal release bundles.
- Cloud event and acknowledgement history.
- Encrypted Hub checkpoints and integrity records where configured.
- Device registry, certificate revocation and assignment capability.
- Hardware binding/profile export.
- Store recovery contact list and consent process.
- Printed/offline emergency checklist at the Store.

## 4. Incident classification

| Code          | Incident                                    | Initial action                                           |
| ------------- | ------------------------------------------- | -------------------------------------------------------- |
| `IR-WAN`      | Internet unavailable, Hub healthy           | Continue local operation; monitor backlog                |
| `IR-LAN`      | Terminal cannot reach Hub                   | Check switch/cabling/IP; do not create independent truth |
| `IR-POWER`    | Power loss/unstable power                   | Use UPS; controlled shutdown if runtime low              |
| `IR-HUB-SVC`  | Hub service stopped, OS/database reachable  | Restart bounded service and diagnose                     |
| `IR-DB`       | PostgreSQL corruption/read-only safety mode | Stop writes; checkpoint/restore decision                 |
| `IR-NVME`     | NVMe failed or identity changed             | Replace complete Hub; send unit to HET                   |
| `IR-BOARD`    | Pi board/secure element failed              | New KitLuy device identity required                      |
| `IR-SECURITY` | Clone, theft, cert/key mismatch             | Quarantine/revoke immediately                            |
| `IR-FILE`     | File cache/storage pressure                 | Preserve DB/outbox and unuploaded evidence first         |
| `IR-UPDATE`   | Failed release                              | A/B rollback                                             |

## 5. Immediate Store safety actions

1. Confirm whether Hub LAN API is reachable.
2. If Hub is healthy and only WAN is down, keep T1–T4 operating.
3. If Hub is unreachable, stop new Booking/payment/custody mutations unless an explicitly approved bounded terminal cache exists.
4. Preserve receipts, cash, garments, storage positions and customer handover evidence.
5. Do not power-cycle repeatedly after suspected NVMe corruption.
6. Photograph status indicators and record incident time.
7. Contact HET Support and provide asset number, Location and last successful action.
8. Do not open the enclosure or move storage to another Pi.

## 6. Remote triage decision tree

```text
Can terminals reach Hub health endpoint?
├─ Yes
│  ├─ Database writable? → continue/repair service
│  ├─ WAN only failed? → offline operation
│  └─ Disk critical? → apply file-cache pressure procedure
└─ No
   ├─ Hub powered and Ethernet link active? → LAN/network triage
   ├─ Hub boots to known-good slot? → service recovery
   ├─ NVMe/secure-boot/identity error? → replace Hub
   └─ Unknown/clone/security indication? → quarantine and replace
```

## 7. Standard complete-Hub replacement

### 7.1 Prepare

1. Open incident and record affected Hub asset/device/assignment IDs.
2. Determine last cloud-acknowledged Hub sequence and last heartbeat.
3. Determine whether an encrypted checkpoint or intact NVMe is available.
4. Suspend the failed Hub operational credential. Use revoke immediately for theft or compromise.
5. Select a pre-enrolled replacement Hub in `provisioning_eligible` state.
6. Obtain required recovery approval and Store confirmation.

### 7.2 Assign replacement

1. Create a new Hub assignment generation for the same Tenant, Digital Store and Location.
2. Bind replacement device ID and issue a new operational certificate.
3. Publish the replacement Hub identity and endpoint to assigned terminals.
4. Keep the old assignment historical and ended/suspended; never reuse its certificate.

### 7.3 Restore baseline

1. Boot replacement Hub from approved HET image.
2. Verify board, installation, secure boot, storage encryption and certificate.
3. Apply local migrations to the approved version.
4. Download and verify the latest approved configuration snapshot.
5. Restore synchronized cloud projections required for operation.
6. Restore encrypted local checkpoint when available and authorized.
7. Preserve original event IDs, idempotency keys and historical assignment generation.

### 7.4 Reconcile

1. Handshake with Edge Sync Gateway using new assignment generation.
2. Request known cloud event/ack ranges for the failed Hub.
3. Mark restored events already present in cloud as acknowledged.
4. Replay missing original events unchanged.
5. Pull cloud messages published since the checkpoint.
6. Compare open Bookings, payments, shifts, storage assignments and files.
7. Create conflicts for differences; never silently discard local evidence.

### 7.5 Reconnect terminals

1. Terminals receive signed replacement Hub assignment or use cloud endpoint fallback.
2. Each terminal verifies replacement Hub certificate, UUID, scope and generation.
3. Create new pairing receipt if required.
4. Open staff sessions and validate assigned T1–T4 profiles.
5. Test T2 privacy reset and current-session binding.

### 7.6 Validate peripherals

- Receipt printer test.
- Tag printer test.
- Scanner test with non-live code.
- Scale zero/tare/stable reading test.
- Cash drawer authorized test.
- Optional customer display and UPS status.

### 7.7 Operational smoke test

Use training or controlled pilot data first:

1. Create a test Booking.
2. Add per-piece and/or per-weight line.
3. Record a zero-value/test payment path or approved controlled cash test.
4. Print test receipt and tag.
5. T3 scan and storage assignment.
6. T4 retrieval and completion.
7. Verify event sync and cloud freshness.
8. Remove/void test data using approved test controls.

### 7.8 Resume

Store manager and HET operator jointly confirm:

- active configuration/version;
- no unresolved S1 conflict;
- open Booking and storage list reconciled;
- payment/cash review complete or explicitly pending;
- outbox progressing;
- required peripherals healthy;
- old Hub no longer trusted.

Record `hub.recovery_completed` audit event and close/monitor incident.

## 8. NVMe failure procedure

### Store action

- Treat as complete Hub failure.
- Do not remove or replace NVMe.
- Use replacement-Hub procedure.
- Seal and return failed unit to HET.

### HET repair action

1. Verify original Pi board, root key and secure-element identity.
2. Record failed NVMe serial and retire installation record.
3. Image/inspect failed storage in a controlled forensic environment if authorized.
4. Install approved replacement NVMe.
5. Create a new installation ID and storage-key generation.
6. Install signed KitLuy OS and verify image hash.
7. Verify original hardware-backed device key.
8. Rotate installation-bound credentials as required.
9. Run clone resistance, disk, thermal, database and A/B update tests.
10. Return repaired unit to spare inventory, not directly to operation without re-eligibility approval.

The permanent device ID may remain only when the original board and root hardware key remain intact.

## 9. Board or root-key replacement

A new board or root secure element is a new KitLuy device:

- new device UUID and asset enrollment;
- new manufacturing and operational certificates;
- new installation identity;
- old credentials revoked;
- old device marked replaced/retired;
- audit linkage from old to new preserved.

Never transplant a private key, certificate or device identity to a new board.

## 10. Intact NVMe from failed board

The NVMe may contain recoverable encrypted data, but it must not be inserted into an operating replacement Pi at the Store.

At HET:

1. verify chain of custody;
2. attach through a controlled recovery station;
3. use authorized recovery/wrapping keys and approvals;
4. export a signed encrypted checkpoint or event bundle;
5. verify hashes and event chains;
6. import through the replacement-Hub recovery procedure;
7. wipe/retire the old media according to policy.

## 11. Database corruption

1. Put Hub in maintenance/read-only mode.
2. Capture diagnostics and PostgreSQL logs.
3. Verify disk/SMART, filesystem and memory health.
4. Do not run destructive repair against the only copy.
5. Copy encrypted database/WAL evidence when possible.
6. Select latest verified checkpoint.
7. Restore to a recovery environment or replacement Hub.
8. Reconcile event and acknowledgement ranges.
9. Run integrity SQL and application smoke tests.
10. Resume only after approval.

## 12. A/B software rollback

```text
candidate slot unhealthy
→ watchdog marks boot failed
→ switch to previous slot
→ verify local schema compatibility
→ start Hub services
→ retain failed-slot diagnostics
→ emit release.rolled_back
```

If a migration is not backward compatible with the previous slot, release promotion was invalid and recovery requires the documented migration rollback/forward repair plan.

## 13. WAN-only outage

No Hub replacement is needed.

- Continue permitted local operations.
- Show cloud-sync freshness.
- Keep cash operations and print queues local.
- KHQR/provider behavior follows payment policy; never invent success.
- Monitor outbox age, file queue and disk watermarks.
- On reconnect, sync oldest events first and reconcile payment/provider states.

## 14. LAN/network failure

1. Confirm Hub power and Ethernet link.
2. Check router/switch, operational VLAN and DHCP reservation.
3. Try assigned IP, hostname, mDNS, last trusted IP and cloud-reported endpoint in order.
4. Use manual IP recovery only with authorization.
5. Continue only after certificate/assignment verification.
6. Do not connect terminals directly to cloud as a replacement operational authority.

## 15. Payment and cash reconciliation after recovery

Review:

- last open/closed shift;
- cash payments and movements after last cloud ack;
- pending KHQR requests and provider confirmations;
- receipts issued locally;
- refunds/voids in progress;
- T4 releases linked to payment state.

Differences create finance conflicts or compensating entries. Do not edit confirmed payment history.

## 16. Custody and storage reconciliation

Produce three lists:

1. Local active storage assignments.
2. Cloud last-known storage assignments.
3. Physical rack/shelf scan/count.

Resolve each mismatch with a reason-coded custody/storage correction event. A Booking is not marked complete merely because cloud status says complete if physical garments remain stored.

## 17. File reconciliation

- Recovered unuploaded assets keep original asset IDs and hashes.
- Cloud-available assets can be redownloaded.
- Metadata/object checksum mismatch enters conflict/quarantine.
- Missing garment evidence is disclosed; do not mark it uploaded.
- Support bundles expire according to consent.

## 18. Security incident variant

For stolen, cloned or tampered Hub:

1. revoke operational/manufacturing credentials as applicable;
2. block future provisioning and sync;
3. rotate Location secrets and terminal pairing receipts;
4. review support sessions and outbound connections;
5. preserve audit/security evidence;
6. provision replacement as a new assignment generation;
7. conduct breach assessment before closing incident.

## 19. Recovery evidence package

```text
incident ID
failed and replacement device IDs
assignment generations
credential actions
checkpoint ID/hash
restored event range
cloud reconciliation result
open conflict list
payment/cash sign-off
custody/storage sign-off
peripheral test results
sync freshness evidence
operator and approver identities
resume time
```

## 20. Acceptance drills

- Quarterly replacement-Hub drill during pilot/production.
- Restore from checkpoint with intentional duplicate cloud acknowledgements.
- NVMe clone to unknown Pi must fail.
- Failed release must roll back.
- WAN outage with 10,000 queued events must reconcile.
- Physical rack scan must catch a planted storage mismatch.
- Lost Hub must be revoked and terminals must reject it after assignment update.
