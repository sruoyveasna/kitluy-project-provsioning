# KitLuy Pilot Evidence Template

| Field | Value |
|---|---|
| Filename | `kitluy-pilot-evidence-template-v1.0.0.md` |
| Version | `v1.0.0` |
| Date | `2026-07-26` |
| Owner | HET / KitLuy Suite Project Owner |
| Phase | Phase 1 - Laundry |
| Status | Fillable evidence template; blank until a controlled pilot is executed |
| Timezone | `Asia/Phnom_Penh` |
| Languages | Khmer and English |
| Currencies | KHR and USD |

> Evidence discipline: this document defines required verification. It is not proof that any capability is implemented, tested, deployed, pilot-proven, or production-ready.


## 1. Pilot identity

| Field | Value |
|---|---|
| Pilot evidence ID | `[REQUIRED]` |
| Tenant / Partner | `[REQUIRED]` |
| Digital Store / vertical | `[REQUIRED]` / Laundry |
| Location | `[REQUIRED]` |
| Pilot dates and business dates | `[REQUIRED]` |
| Approved scope and exclusions | `[REQUIRED]` |
| Build SHAs / release versions | `[REQUIRED]` |
| Migration/config snapshot versions | `[REQUIRED]` |
| Store Hub / terminal identities | `[REQUIRED]` |
| Hardware certification references | `[REQUIRED]` |
| Pilot owner / Store contact / support lead | `[REQUIRED]` |
| Entry approval | `[REQUIRED]` |

## 2. G0-G4 entry evidence

| Gate | Evidence link/checksum | Approver | Date | Open conditions |
|---|---|---|---|---|
| G0 |  |  |  |  |
| G1 |  |  |  |  |
| G2 |  |  |  |  |
| G3 |  |  |  |  |
| G4 |  |  |  |  |

## 3. Pilot objectives and success criteria

List measurable operational, technical, support, financial, training and customer-experience objectives. Include explicit abort criteria and rollback authority. Do not use vague terms such as "works well".

## 4. Pre-go-live checklist

- [ ] Partner, Digital Store, Laundry vertical and Location authority verified.
- [ ] Active certified Store Hub and assigned T1-T4 profiles.
- [ ] Configuration snapshot acknowledged and compatible.
- [ ] Users, roles, permissions, PIN/session and support consent tested.
- [ ] Service catalog, pricing, deposit/payment policy and documents approved.
- [ ] Cash/KHQR sandbox or approved live provider verification completed.
- [ ] Receipt/tag printers, scanners, scales and T2 privacy tested.
- [ ] Offline Booking, T3, T4, print, file and reconnect tests passed.
- [ ] Monitoring, alerts, backup, rollback, replacement and support paths tested.
- [ ] Training and Khmer/English operating materials delivered.
- [ ] Test data separated from real pilot records.

## 5. Daily operating evidence

For each business day record opening checks, transaction/Booking counts by state, deposits/payments by currency/tender, T3/T4 custody counts, issues/rewash/damage, sync backlog and freshness, file/notification status, device/peripheral health, incidents, support actions, close/reconciliation result, and evidence links.

## 6. Required scripted journeys

| Journey | Result | Test run/evidence | Defect/notes |
|---|---|---|---|
| Create per-piece Booking, deposit and print |  |  |  |
| Create per-weight Booking |  |  |  |
| KHQR or approved payment flow |  |  |  |
| Record issue/evidence |  |  |  |
| T3 Ready scan and storage |  |  |  |
| T4 pickup and balance |  |  |  |
| WAN outage and reconnect |  |  |  |
| Provider outage |  |  |  |
| Support consent session |  |  |  |
| Release/config rollback rehearsal |  |  |  |
| Backup/restore or replacement rehearsal |  |  |  |
| Business-day close and reconciliation |  |  |  |

## 7. Metrics

| Metric | Target | Actual | Source/as-of | Result |
|---|---:|---:|---|---|
| Store operating uptime | `[REQUIRED]` |  |  |  |
| T1 Booking latency | `[REQUIRED]` |  |  |  |
| T3/T4 scan success | `[REQUIRED]` |  |  |  |
| Sync backlog age | `[REQUIRED]` |  |  |  |
| Payment/reconciliation exceptions | `[REQUIRED]` |  |  |  |
| Print/scan/scale failure rate | `[REQUIRED]` |  |  |  |
| Support response/recovery | `[REQUIRED]` |  |  |  |
| Critical/High defects | 0 open at exit |  |  |  |

## 8. Incident and defect log

Record time, severity, impact, affected Bookings/payments/devices, detection source, containment, recovery, root cause, fix, regression test, evidence, and whether abort criteria were reached.

## 9. Finance and custody reconciliation

Attach validator outputs for Booking totals, tenders, deposits, balances, refunds, settlement state, cash count, T3 Ready count, storage occupancy, T4 release count, unresolved exceptions, duplicate-effect checks and audit completeness. Explain every variance; never force a match by deleting or editing finalized records.

## 10. Security, privacy and access review

Confirm Tenant/Location isolation, revoked access, support consent, secret redaction, file access, device certificates, release signatures, audit completeness, data retention and any privacy incident.

## 11. Training and support evidence

List trainees, roles, languages, materials, competency checks, support contacts, incidents, escalations, remote sessions, replacement/spare actions and lessons learned.

## 12. Exit assessment

| Decision dimension | Pass/Fail | Evidence | Approver/comment |
|---|---|---|---|
| Product and Laundry workflow |  |  |  |
| Offline and Store Hub |  |  |  |
| Payments and reconciliation |  |  |  |
| Security and isolation |  |  |  |
| Hardware and releases |  |  |  |
| Monitoring, recovery and support |  |  |  |
| Documentation and Rebuild readiness |  |  |  |

## 13. G5 decision

- Decision: `[APPROVE / APPROVE WITH CONDITIONS / EXTEND PILOT / REJECT]`
- Conditions and owners: `[REQUIRED]`
- Rebuild Test reference: `[REQUIRED]`
- Bibles/status register updated: `[REQUIRED]`
- Owner approval and date: `[REQUIRED]`
