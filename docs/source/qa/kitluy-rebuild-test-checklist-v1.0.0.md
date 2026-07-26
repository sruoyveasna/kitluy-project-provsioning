# KitLuy Rebuild Test Checklist

| Field      | Value                                                |
| ---------- | ---------------------------------------------------- |
| Filename   | `kitluy-rebuild-test-checklist-v1.0.0.md`            |
| Version    | `v1.0.0`                                             |
| Date       | `2026-07-26`                                         |
| Owner      | HET / KitLuy Suite Project Owner                     |
| Phase      | Phase 1 - Laundry                                    |
| Status     | Canonical G5 checklist; not a completed Rebuild Test |
| Timezone   | `Asia/Phnom_Penh`                                    |
| Languages  | Khmer and English                                    |
| Currencies | KHR and USD                                          |

> Evidence discipline: this document defines required verification. It is not proof that any capability is implemented, tested, deployed, pilot-proven, or production-ready.

## 1. Test objective

One qualified engineer with no prior KitLuy build context must reconstruct and operate Phase 1 from approved documentation, repositories, migrations, contracts and deployment instructions. Private oral knowledge, hidden scripts, undocumented credentials, and original-team intervention are not allowed.

## 2. Independence rules

- Tester is not an author of the target implementation.
- Assistance is limited to documented support channels and known incident procedures.
- Every ambiguity, missing value and undocumented workaround is recorded.
- Owner-only secrets may be supplied through the approved secret process, but their names, location and installation procedure must be documented.
- A successful result requires operation, recovery and evidence generation, not only deployment.

## 3. G0 - authority and source control

- [ ] Open `PROJECT_HOME.md` and identify current canonical documents.
- [ ] Verify authority/precedence, decision register, open required values and superseded register.
- [ ] Confirm eight-phase roadmap, Phase 1 Laundry scope, Digital Store-first model, one Store/one vertical, T1-T4 and Store Hub authority.
- [ ] Confirm no competitor clone document is treated as product truth.
- [ ] Confirm implementation status is evidence-backed.

## 4. G1 - contracts and design

- [ ] Locate schema/data dictionary, enums/reference data, migrations, functions/RPC/triggers and RLS contracts.
- [ ] Locate Management, Commerce Store, Edge Operations and Connector API contracts.
- [ ] Locate event, job, webhook, outbox, replay and compatibility contracts.
- [ ] Locate business rules/state machines for Booking, payment/refund/void, inventory, finance, customer/privacy, pricing and business date.
- [ ] Locate permissions, scopes, sensitive actions, audit, device trust, support access, secrets and threat model.
- [ ] Locate Store Hub local schema, LAN API, sync/conflict/idempotency/config/discovery/file/recovery contracts.
- [ ] Locate UI/UX route inventories, localization, accessibility and state definitions.
- [ ] Locate monitoring, backup, recovery, release, rollback and support runbooks.

## 5. G2 - clean build

- [ ] Clone the approved repository and verify commit/tag/signature.
- [ ] Install exact Node.js, pnpm, TypeScript and other tool versions from the engineering standards pack.
- [ ] Run dependency integrity and secret scans.
- [ ] Build all Phase 1 apps, services and shared packages from clean state.
- [ ] Provision isolated development infrastructure from IaC.
- [ ] Apply migrations in documented order and verify checksums.
- [ ] Re-run migrations/seeds idempotently where designed.
- [ ] Create canonical Tenant A/B and Laundry fixtures.
- [ ] Run unit, component and contract tests; capture machine-readable evidence.
- [ ] Produce signed/checksummed ARM64 Hub and terminal artifacts as applicable.

## 6. G3 - integrated operation

- [ ] Create Partner and Laundry Digital Store.
- [ ] Configure services, pricing, staff, payments and rules.
- [ ] Provision and activate certified Store Hub.
- [ ] Assign and pair T1, T2, T3 and T4 profiles.
- [ ] Validate printers, scanners, scale, display and network.
- [ ] Run Storefront pre-intake/queue flow.
- [ ] Create per-piece and per-weight T1 Bookings.
- [ ] Record cash deposit and KHQR sandbox payment.
- [ ] Print receipt and garment tags.
- [ ] Record issue/photo and complete production state changes.
- [ ] Run T3 Ready scan/storage and T4 pickup/balance/completion.
- [ ] Verify Partner, Chain, Admin and Partner App freshness/read models.
- [ ] Run RLS cross-Tenant negatives.
- [ ] Run offline full cycle, reconnect and reconciliation.
- [ ] Run duplicate callback/request/event/job/replay tests.
- [ ] Run payment/refund/reconciliation vectors.
- [ ] Run performance, security and recovery packs.

## 7. G4 - operations and recovery

- [ ] Deploy monitoring dashboards and test alerts.
- [ ] Verify logs/traces/audit contain correlation IDs and no secrets.
- [ ] Run backup restore into isolated environment and smoke test.
- [ ] Run configuration rollback.
- [ ] Run signed release Internal -> Pilot and failed A/B rollback.
- [ ] Replace a failed Hub/NVMe through the approved recovery procedure.
- [ ] Exercise support consent, diagnostics, expiry and audit.
- [ ] Verify training, spares, escalation, incident and go-live runbooks.
- [ ] Verify certified hardware references and limitations.

## 8. G5 - pilot and documentation closure

- [ ] Execute controlled pilot day with opening, normal flows, representative failures, close and reconciliation.
- [ ] Complete the pilot evidence template and evidence index.
- [ ] Verify every capability labeled IMPLEMENTED links to repository, migration, test, deployment and pilot/production evidence as applicable.
- [ ] Update Rebuild and Business Bibles, source-of-truth index, decision register, test registry and status register.
- [ ] Record every missing/ambiguous step and required document correction.
- [ ] Independent approvers review the result.

## 9. Scoring

| Result               | Meaning                                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| PASS                 | All mandatory items pass; no undocumented blocker or Critical/High gap; pilot and operation proven.                         |
| PASS WITH CONDITIONS | Only non-blocking documented gaps remain with owner, due date and no truth/security/recovery risk.                          |
| FAIL                 | Any mandatory reconstruction, migration, authorization, offline, finance, recovery, hardware, pilot or evidence item fails. |

Time-to-rebuild is recorded for planning but does not excuse missing documentation. A workaround discovered during the test must be documented and retested before final PASS.

## 10. Final record

| Field                      | Value        |
| -------------------------- | ------------ |
| Rebuild Test ID            | `[REQUIRED]` |
| Tester and qualification   | `[REQUIRED]` |
| Start/end                  | `[REQUIRED]` |
| Repository/tag/build       | `[REQUIRED]` |
| Infrastructure environment | `[REQUIRED]` |
| Result                     | `[REQUIRED]` |
| Blockers/deviations        | `[REQUIRED]` |
| Evidence index/checksum    | `[REQUIRED]` |
| Corrective actions         | `[REQUIRED]` |
| Approvers/date             | `[REQUIRED]` |
