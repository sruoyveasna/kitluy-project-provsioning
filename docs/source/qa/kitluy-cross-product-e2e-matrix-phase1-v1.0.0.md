# KitLuy Cross-Product E2E Matrix - Phase 1

| Field | Value |
|---|---|
| Filename | `kitluy-cross-product-e2e-matrix-phase1-v1.0.0.md` |
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

These journeys verify business effects across products, not isolated screens. Every journey must assert authorization, audit, source/freshness truth, idempotency, offline behavior, finance/custody invariants, observability, and recovery where applicable.

## 2. Matrix

| ID | Journey | Participating products/services | Core execution | Required invariant | Gate |
|---|---|---|---|---|---|
| E2E-001 | Public lead to verified Partner | B2B Website -> Auth -> Admin onboarding -> Partner Portal | Create lead, register, verify phone, approve business, create Partner context | One identity, one scoped Partner, complete audit, correct portal routing | G3/G4 |
| E2E-002 | Create Laundry Digital Store | Partner Portal -> Core -> Admin visibility | Select Laundry vertical, configure identity, service catalog and policies | Exactly one primary vertical; neutral Core plus Laundry delta; readiness is truthful | G3 |
| E2E-003 | Publish configuration to Store Hub | Partner Portal -> Configuration Service -> Hub -> T1-T4 | Publish signed snapshot and receive per-Location acknowledgement | Atomic activation, prior version retained, no partial config | G3 |
| E2E-004 | Provision managed Store Hub | Admin -> Device Trust -> Hub -> Cloud sync | Enroll approved hardware, one-time code, certificate, initial snapshot | Unknown/cloned hardware denied; correct Location active | G3/G4 |
| E2E-005 | Provision T1-T4 profiles | Partner/Admin -> Hub -> Terminals | Assign profile, pair through active Hub, validate peripherals | No self-selected role; T2 CDS, T3 Ready, T4 Pickup permissions enforced | G3/G4 |
| E2E-006 | Storefront pre-intake and virtual queue | Storefront/Telegram -> Commerce Store API -> Hub/T1 | Create draft, queue ticket, verify at T1 | Draft never becomes authoritative Booking until T1 verification | G3 |
| E2E-007 | T1 per-piece Booking and cash deposit | T1 -> Hub -> Payment/Finance -> Print | Verify customer/items, calculate, take deposit, print receipt/tags | Booking and tender atomic; balance correct; one receipt/tag job | G3 |
| E2E-008 | T1 per-weight Booking | Scale -> T1 -> Hub -> Pricing | Capture stable weight and price version | Unstable reading rejected; exact weight/price evidence retained | G3/G4 |
| E2E-009 | KHQR successful payment | T1 -> Adapter -> Provider sandbox -> Webhook -> Finance | Create QR, receive signed callback, reconcile | Pending not paid; callback success creates one tender; duplicate callback harmless | G3 |
| E2E-010 | Production issue and evidence | POS Mobile/T1/T3 -> Hub -> File Service -> Partner surfaces | Record damage/rewash issue and photo while offline then reconnect | Issue persists locally; file uploads once; no compensation promise | G3 |
| E2E-011 | T3 Ready scan-in | T3 -> Hub -> Notification Service | Verify count/quality, package, assign storage, mark Ready | Unresolved mismatch blocks Ready; custody and storage are append-only | G3 |
| E2E-012 | Ready notification provider outage | Hub -> Notification Service -> Provider | Queue notification while provider fails | Booking stays Ready; delivery truth says queued/failed; retry evidence exists | G3/G4 |
| E2E-013 | T4 pickup with balance due | T4 -> Hub -> Payment -> Finance | Verify collector, retrieve garments, collect approved balance, release | Only T4 completes; payment and custody release reconcile | G3 |
| E2E-014 | Wrong customer/tag at T4 | T4 -> Hub | Scan mismatched tag/customer | Pickup blocked; no custody release; security/audit event recorded | G3 |
| E2E-015 | Complete Laundry cycle offline | T1/T2/T3/T4 -> Hub | Run Booking through pickup with WAN unavailable | LAN operations continue, cloud remains pending, one effect after reconnect | G3/G4 |
| E2E-016 | Long-backlog reconnect | Hub -> Sync services -> Cloud read models | Reconnect after extended outage | Bounded sync, foreground priority, no duplicate effect, explicit reconciliation | G3 |
| E2E-017 | Partner/Chain/Admin freshness truth | Cloud read models -> portals/apps | Observe partial sync and stale Location | Each surface shows source/as-of/completeness; never false live/zero | G3 |
| E2E-018 | Cross-tenant attack chain | All APIs and portals -> Supabase RLS | Use Tenant A credentials with Tenant B IDs | No data, count, identifier or mutation leakage at every layer | G3 |
| E2E-019 | Refund request and approval | Partner Portal -> Approval -> Payment/Finance | Request refund, independent approval, provider action | Original records retained; compensating entries and audit reconcile | G3 |
| E2E-020 | Configuration rollback | Partner/Admin -> Configuration Service -> Hub | Rollback to prior published version | New superseding version activates; finalized transactions unchanged | G3/G4 |
| E2E-021 | Signed release staged rollout | Release Service -> Hub -> terminals | Internal to Pilot, health gate, Stable promotion | Unsigned/tampered blocked; failed candidate rolls back A/B | G4 |
| E2E-022 | Hub replacement after NVMe failure | Admin/Support -> replacement Hub -> restore/sync | Revoke failed device, provision replacement, restore operational state | No duplicate active identity; Store returns to service with evidence | G4 |
| E2E-023 | Consent-based support session | Partner -> Admin support -> audited actions | Grant scoped consent, perform diagnostic, expire session | Banner/scope/expiry/audit enforced; no access after expiry | G3/G4 |
| E2E-024 | Report export under commercial-plan variation | Partner/Chain -> Reporting -> File Service | Export authorized report | Reporting/history not commercially paywalled; scope, masking and expiry pass | G3 |
| E2E-025 | AI summary with stale/partial sources | Partner/Chain -> AI Gateway/RAG | Request operational summary during partial sync | Sources and freshness disclosed; AI cannot execute sensitive action | G3 |
| E2E-026 | Backup restore and smoke cycle | Infrastructure -> restored environment -> apps/Hub simulation | Restore database/files/config and run critical smoke | RPO/RTO evidence captured; ledgers/audit intact; smoke passes | G4 |
| E2E-027 | Business-day close and reconciliation | T1/Partner Portal -> Finance/Reporting | Close controlled pilot day | Cash/KHQR/deposit/balance totals reconcile or exceptions remain explicit | G3/G5 |
| E2E-028 | Pilot go-live abort | Monitoring/Support -> release/config rollback | Inject material failure during pilot | Abort criteria triggers, new work is safely stopped/rerouted, rollback succeeds | G4/G5 |


## 3. Execution rules

- Each flow uses a fresh trace ID and records every related request, event, job, audit and ledger identifier.
- The final assertion is against authoritative data, not only UI state.
- Negative variants are mandatory: wrong role, wrong scope, duplicate submission, dependency timeout, stale data and retry.
- Offline flows verify Hub-local truth before reconnect and cloud truth after reconciliation.
- Financial and custody flows verify append-only history and balanced projections.
- A partial flow is Failed or Blocked, never Passed.

## 4. Minimum evidence bundle

Scenario script/version, fixture manifest, builds and migrations, device and network state, logs/traces, screenshots/video where useful, database/audit/ledger validators, reconciliation result, defects, and approver sign-off.
