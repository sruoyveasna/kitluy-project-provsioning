# KitLuy Hardware Certification Test Plan

| Field | Value |
|---|---|
| Filename | `kitluy-hardware-certification-test-plan-v1.0.0.md` |
| Version | `v1.0.0` |
| Date | `2026-07-26` |
| Owner | HET / KitLuy Suite Project Owner |
| Phase | Phase 1 - Laundry |
| Status | Canonical testing and evidence specification; not execution evidence |
| Timezone | `Asia/Phnom_Penh` |
| Languages | Khmer and English |
| Currencies | KHR and USD |

> Evidence discipline: this document defines required verification. It is not proof that any capability is implemented, tested, deployed, pilot-proven, or production-ready.


## 1. Purpose

Certify the exact hardware and firmware combinations used by the Phase 1 Store Hub and T1-T4 profiles. A product name alone is not certification; the record binds model, revision, memory, storage, power supply, OS image, kernel, firmware, drivers, cables, peripherals, build and test date.

## 2. Certification levels

| Level | Meaning | Allowed use |
|---|---|---|
| Candidate | Lab evaluation only | No pilot/customer deployment |
| Pilot certified | Passed full lab plan and controlled pilot entry | Named pilot Stores only |
| Stable certified | Passed pilot evidence, soak, recovery and support readiness | Approved commercial rollout |
| Conditional | Approved with explicit limitation/workaround | Only within documented constraint |
| Revoked | Security, reliability or supply-chain issue | No new deployment; replacement plan required |

## 3. Required equipment classes

- Raspberry Pi 5 Store Hub and terminal profiles listed in the canonical hardware compatibility matrix.
- Approved NVMe, enclosure/hat, power supply, cooling and network components.
- Receipt and tag printers, barcode/QR scanners, scales, T2 displays, optional cash drawer and approved adapters.
- Representative LAN router/switch/Wi-Fi environment and power-failure equipment.

Exact certified models are governed by `kitluy-hardware-compatibility-matrix-phase1-v1.0.0.md`; this test plan must not invent certification status.

## 4. Lab record

Record serial/part/revision, firmware, OS image hash, device certificate identity, release channel/build, peripheral VID/PID or network identity, cables/adapters, ambient temperature, network/power profile, test operator, evidence links, defects and final disposition.

## 5. Mandatory cases

| ID | Scenario | Pass condition |
|---|---|---|
| HW-001 | Store Hub cold boot and service health | All required services healthy; correct device identity; no Store data before authorization |
| HW-002 | Store Hub 24/72-hour soak | No thermal throttling or resource leak beyond approved limit |
| HW-003 | Abrupt power loss during idle | Clean recovery and health checks |
| HW-004 | Abrupt power loss during Booking write | Committed effect survives; uncommitted effect absent |
| HW-005 | NVMe removal/failure | Failure detected; replacement-first recovery procedure works |
| HW-006 | Cloned NVMe in another Pi | Identity mismatch rejected |
| HW-007 | Thermal stress | Temperature/clock/health telemetry and safe degradation |
| HW-008 | LAN link loss and recovery | Hub remains locally authoritative; clients reconnect safely |
| HW-009 | Internet loss | T1-T4 operation continues over LAN |
| HW-010 | T1/T2 display pairing | Customer-safe projection; no staff-only data |
| HW-011 | T3/T4 shared physical device mode isolation | Distinct permissions, UI state and audit |
| HW-012 | Receipt printer normal job | Correct content, encoding, cut and cash-drawer behavior if approved |
| HW-013 | Receipt printer disconnect/reconnect | Job retained and controlled retry |
| HW-014 | Tag printer batch and reprint | Correct tag mapping; explicit audited reprint |
| HW-015 | Barcode/QR scanner supported symbologies | Accurate reads; malformed/duplicate handling |
| HW-016 | Scale stable/unstable/zero/tare | Only stable approved reading accepted |
| HW-017 | Customer display privacy reset | Previous customer data cleared at workflow boundary |
| HW-018 | USB/peripheral hot unplug | Safe error; no application crash or data corruption |
| HW-019 | Signed ARM64 release install | Signature/hash and compatibility pass |
| HW-020 | Failed candidate health check | A/B rollback to prior slot |
| HW-021 | Terminal provision through active Hub | Correct assignment and certificate |
| HW-022 | Terminal provisioning before Hub active | Blocked |
| HW-023 | Unsupported model/firmware | Clearly unsupported; cannot pass certification |
| HW-024 | Replacement Hub restore | Identity, config, pending work and operational smoke pass |
| HW-025 | Physical tamper evidence inspection | Tamper condition follows approved quarantine/repair procedure |


## 6. Certification decision

A model passes only when all P0/P1 cases pass, no unresolved Critical/High defect remains, support has diagnostics and replacement procedures, signed release/rollback works, and evidence is reproducible. A firmware, driver, board revision, storage model or power design change triggers impact-based recertification.

## 7. Pilot and field feedback

Pilot records include uptime, thermal/storage health, print/scan/scale error rates, support incidents, replacement time, update success, offline duration, user feedback and any certification limitation. Stable certification requires pilot evidence, not lab evidence alone.
