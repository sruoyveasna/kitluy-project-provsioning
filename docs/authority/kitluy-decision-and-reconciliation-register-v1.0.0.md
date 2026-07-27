# KitLuy Decision and Reconciliation Register

**Filename:** `kitluy-decision-and-reconciliation-register-v1.0.0.md`  
**Version:** v1.0.0  
**Date:** 2026-07-26  
**Owner:** HET / KitLuy Suite Project Owner  
**Status:** CANONICAL DECISION AND CONFLICT REGISTER

## 1. Register rules

- Owner decisions are immutable historical records. A later decision supersedes; it does not erase.
- A decision establishes direction, not implementation.
- Every material conflict receives an `RC-*` entry.
- A reconciliation is closed only after all affected documents and implementation evidence are aligned.
- Unresolved values belong in the open-decisions register, not in this closed-decision table.

## 2. Owner decisions

| Decision ID        | Decision                                      | Authority status       | Binding result                                                                                                                                                           | Source                                                            | Scope                            | State  |
| ------------------ | --------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | -------------------------------- | ------ |
| KLD-2026-07-20-001 | Digital Store control plane                   | OWNER-LOCKED           | Partner Account -> Digital Store -> vertical/configuration -> channels -> optional Store Location and edge devices.                                                      | KitLuy Suite Project.txt                                          | All products                     | Active |
| KLD-2026-07-21-001 | Extended commerce architecture                | OWNER-LOCKED           | Digital Store/Store Location separation, relational transaction truth, governed APIs/events/jobs/channels and safe deployments.                                          | KitLuy Suite Project.txt                                          | Core, APIs, channels, deployment | Active |
| KLD-2026-07-21-002 | Laundry terminal architecture                 | OWNER-LOCKED           | T1 Cashier/Intake, T2 Customer Display, T3 Clean & Ready Scan-In, T4 Pickup Scan-Out.                                                                                    | kitluy-concept-design-1.txt; POS Desktop v4                       | Laundry POS/Hub                  | Active |
| KLD-2026-07-21-003 | Smartphone-simple provisioning                | OWNER-LOCKED           | Digital Store first, active Hub second, assigned terminals third; certificates, discovery, cached endpoints and manual IP only as fallback.                              | Device Management & Provisioning System.txt                       | Devices, Hub, Admin, Partner     | Active |
| KLD-2026-07-21-004 | Cloud, edge and release split                 | OWNER-LOCKED DIRECTION | React/PWA, React Native/Expo, Electron ARM64, Supabase authority, DigitalOcean compute/files/AI/releases, Hub offline authority and signed A/B releases.                 | Project Instruction Writing.txt                                   | Platform and infrastructure      | Active |
| KLD-2026-07-24-001 | Twelve master registry decisions              | OWNER-LOCKED           | Moderation, finance, APIs, extensions, card policy, pricing, reporting and Restaurant tabs decisions are binding.                                                        | kitluy-owner-decision-lock-12-capabilities-v1.0.md                | Multiple domains                 | Active |
| KLD-2026-07-25-001 | Storefront QR pre-intake and virtual queue    | OWNER-LOCKED           | Web/QR/Telegram pre-intake creates a draft and queue ticket; T1 verifies physical garments and creates the authoritative Booking.                                        | KitLuy Storefront v1.txt; Storefront v1.1                         | Storefront/T1/T2                 | Active |
| KLD-2026-07-25-002 | Admin scoped RBAC                             | OWNER-LOCKED           | Teams and role templates organize access; backend authorization uses explicit permission, resource scope, environment and approval policy with immutable audit.          | Infrastructure upgrade version.txt; Admin v3.1                    | Admin/security                   | Active |
| KLD-2026-07-25-003 | Progressive infrastructure scaling            | OWNER-LOCKED DIRECTION | Kubernetes-ready from day one; do not operate Kubernetes from day one. Start cost-efficiently and preserve container portability.                                        | Infrastructure upgrade version.txt; Infrastructure v1             | Infrastructure                   | Active |
| KLD-ROADMAP-001    | Eight-phase vertical roadmap                  | OWNER-LOCKED           | Laundry -> Restaurant -> eCommerce -> Convenience -> Pharmacy -> Department Store -> Grocery -> Supermarket.                                                             | Current KitLuy Project Instructions                               | Suite roadmap                    | Active |
| KLD-VERTICAL-001   | One primary vertical per Digital Store        | OWNER-LOCKED           | Different business types require separate Digital Stores under the same Tenant/Partner Account.                                                                          | Current KitLuy Project Instructions                               | Core identity/store model        | Active |
| KLD-CORE-001       | Shared Core with vertical deltas              | OWNER-LOCKED           | Reuse neutral Core; add only required vertical terminology, schema delta, workflows, interfaces, reports, hardware profile, defaults and rules.                          | Current KitLuy Project Instructions                               | Architecture                     | Active |
| KLD-EVIDENCE-001   | No planning-to-implementation promotion       | OWNER-LOCKED           | A capability is not IMPLEMENTED without repository, migration, test, deployment or production evidence.                                                                  | Current KitLuy Project Instructions; Master Feature Registry v0.2 | All products                     | Active |
| KLD-FIN-001        | Append-only authoritative records             | OWNER-LOCKED           | Finalized finance, payment, inventory and audit records remain append-only; corrections use governed compensating records.                                               | Current KitLuy Project Instructions                               | Finance/payments/inventory/audit | Active |
| KLD-REPORT-001     | Reporting cannot be commercially paywalled    | OWNER-LOCKED           | History, reporting, analytics, exports and data services cannot be restricted by plan tier; security/privacy/fair-use controls remain allowed.                           | KLD-2026-07-24-001 / KLMF-REP-010                                 | Reporting/commercial             | Active |
| KLD-PAY-001        | Offline card capture rejected                 | OWNER-LOCKED           | No offline card capture in the current roadmap.                                                                                                                          | KLD-2026-07-24-001 / KLMF-PAY-014                                 | Payments                         | Active |
| KLD-FIN-002        | Operational subledger, not full statutory ERP | OWNER-LOCKED           | KitLuy owns operational finance truth, liabilities, reconciliation and exports/connectors but is not initially a complete statutory general ledger.                      | KLD-2026-07-24-001 / KLMF-FIN-005                                 | Finance                          | Active |
| KLD-API-001        | Essential API access included                 | OWNER-LOCKED           | Essential first-party, Edge, Partner-data, export and basic connector APIs are included; advanced capacity/support may be monetized without throttling Store operations. | KLD-2026-07-24-001 / KLMF-INT-001                                 | APIs/commercial                  | Active |

## 3. Reconciliation register

| Reconciliation ID | Conflict                                                       | Resolution state | Canonical resolution / safe behavior                                                                                         | Winning authority                         | Affected artifacts                                          | Closure state                                   |
| ----------------- | -------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------- |
| RC-001            | Suite v3 T1/T2/T3 vs current T1-T4                             | RESOLVED         | Use T1-T4. T2 is CDS; T3 Ready Scan-In; T4 Pickup Scan-Out.                                                                  | Owner lock and POS Desktop v4             | Suite v3, Business v1, Partner PWA v1.1, old concept tables | Open until all replacement bibles are published |
| RC-002            | Physical-Store-first vs Digital-Store-first                    | RESOLVED         | Create Digital Store first; Store Location and hardware are optional later provisioning.                                     | Digital Store owner decision              | Pre-July bibles and onboarding copy                         | Open documentation remediation                  |
| RC-003            | Store used for both digital and physical entity                | RESOLVED         | Use Digital Store and Store Location explicitly; avoid unqualified Store in authoritative contracts.                         | Current Project Instructions and glossary | All schemas/docs/UI                                         | Monitor                                         |
| RC-004            | Seller vs Partner                                              | RESOLVED         | Partner is canonical business term. Seller is migration/history only.                                                        | Current owner naming rule                 | Legacy files/fields                                         | Monitor                                         |
| RC-005            | T2 CDS vs Restaurant KDS or production display                 | RESOLVED         | T2 is Laundry Customer Display. Restaurant KDS and any Laundry production display are separate clients.                      | T1-T4 lock and product classifications    | POS/KDS/product inventory                                   | Monitor                                         |
| RC-006            | Manual IP as normal provisioning vs automatic discovery        | RESOLVED         | Automatic secure pairing/discovery is normal. Cached Hub endpoint and manual IP are fallback only.                           | Provisioning owner lock                   | Older setup instructions                                    | Open documentation remediation                  |
| RC-007            | Master Feature Registry interpreted as implementation evidence | RESOLVED         | Registry is planning/normalization and traceability only.                                                                    | Registry v0.2 status and evidence rule    | All implementation reporting                                | Monitor                                         |
| RC-008            | Competitor clone schemas/routes treated as KitLuy contracts    | RESOLVED         | Clone material is design reference only until explicitly adopted into KitLuy authority.                                      | Source authority standard                 | All clone/research docs                                     | Monitor                                         |
| RC-009            | Deployed schema conflicts with target specification            | PROCESS-LOCKED   | Record target/actual divergence; preserve production data; obtain owner/technical approval; migrate or revise specification. | Authority standard                        | Any product/environment                                     | Case-by-case                                    |
| RC-010            | Reporting/history/export paywall recommendations               | RESOLVED         | Commercial paywall is prohibited; only security/privacy/fair-use/abuse controls may restrict access.                         | KLMF-REP-010 owner choice C               | Pricing, entitlements, reports                              | Monitor                                         |
| RC-011            | AI or agent auto-applies production migrations                 | REJECTED         | AI may draft/review but never auto-apply production migrations.                                                              | Current bibles and safety rule            | All environments                                            | Monitor                                         |
| RC-012            | Frontend visibility used as authorization                      | REJECTED         | API enforcement and Supabase RLS are mandatory; frontend controls are UX only.                                               | Admin v3.1 owner direction                | All privileged products                                     | Monitor                                         |

## 4. New decision template

```markdown
### KLD-YYYY-MM-DD-NNN — <decision title>

- Authority: Project Owner / authorized owner
- Effective date: YYYY-MM-DD
- Status: OWNER-LOCKED | SUPERSEDED
- Decision:
- Binding rules:
- Scope:
- Alternatives rejected:
- Required documentation changes:
- Required implementation/migration changes:
- Evidence note: this decision is not implementation evidence
- Supersedes:
- Superseded by:
```

## 5. New reconciliation template

```markdown
### RC-NNN — <conflict title>

- Status: OPEN | PROVISIONAL | RESOLVED | VERIFIED | CLOSED
- Conflict type: direction | terminology | schema | implementation | security | commercial | evidence
- Source A:
- Source B:
- Exact conflict:
- Precedence result:
- Safe interim behavior:
- Owner/approver:
- Affected documents:
- Affected code/migrations/APIs/tests:
- Closure evidence:
```

---

## Repository addendum — KL-DOCS-001 (not part of the owner original)

Owner original (immutable): `docs/source/canonical/kitluy-decision-and-reconciliation-register-v1.0.0.md`
(owner decisions KLD-* and reconciliations RC-001..012). This addendum
registers repository-discovered conflicts and engineering decisions. IDs are
stable; several are cited by live code and must not be renamed.

### Open conflicts (repository register, KLREC series)

| ID | Conflict | State |
| --- | --- | --- |
| KLREC-2026-07-26-001 | `/edge/v1` route-shape fork. UPDATED by KL-DOCS-001: now between `docs/source/offline/kitluy-storehub-lan-api-v1.0.0.md` (`/sessions/open`, `/bookings/{id}/confirm-intake`, `/ready-scan/sessions`, `/pickup-scan/...`) and `docs/source/api-contracts/kitluy-edge-operations-api-v1.0.0.md` (`/sessions/login`, `/laundry/bookings/{id}/finalize`, `/laundry/ready-sessions`, `/laundry/pickup-sessions/{id}/release`). Same namespace, incompatible paths/verbs; neither supersedes the other. Cited by `services/kitluy-hub-agent/src/lan-api.ts` (mutating routes blocked). | **RESOLVED 2026-07-27** by owner decision KLD-2026-07-26-002 (KL-DEC-001, all five groups OWNER-APPROVED). Implementation tracked by KL-DEC-001-T002..T006; approval alone is not implementation evidence (KLD-EVIDENCE-001) |
| KLREC-2026-07-26-002 | Custody-concept naming drift, UPDATED: four styles across layers — cloud `kitluy_laundry.garments`/`garment_scan_events`/`ready_storage_positions` (data dictionary), Hub-local `edge_laundry.garment`/`custody_event`/`storage_position` (storehub local DB schema), plus the two API vocabularies. | **RESOLVED 2026-07-27 (Cycle 8)** — the API-vocabulary portion was settled by KLD-2026-07-26-002 (Group 1); the SCHEMA-NAMING portion is now settled by the WS-09-T001 record `docs/data/kitluy-storehub-local-schema-reconciliation-v1.0.0.md`: each layer keeps its own convention (cloud plural, Hub-local singular — systematic across all 38 Hub relations), with an explicit binding mapping table. Storage/schema mapping only; no business, event or API vocabulary changed |
| KLREC-2026-07-26-003 | BB v1 register inconsistency (bootstrap) | OPEN (low) |
| KLREC-2026-07-26-004 | Master feature registry exists only as CSV | OPEN |
| KLREC-2026-07-26-005 | Owner control pack claims RB v4.0.0 / BB v2.0.0 are "Missing from package" (PROJECT_HOME §2, SOT-010/011, SUP-001/002, OD-001/002) — both are physically present and canonical since KL-DOCS-001 ingestion. | RESOLVED-BY-EVIDENCE; owner index row update proposed |
| KLREC-2026-07-26-006 | SOT-027 indexes `kitluy-owner-decision-lock-12-capabilities-v1.0.md` as an active file; file not found machine-wide (content preserved in RB v4 §11.2). | OPEN — owner to supply file or amend index |
| KLREC-2026-07-26-007 | Pack-flattening collision: the security pack's declared `README.md` (890 B) was overwritten by the API pack index (707 B) when packs were merged into one inbox; 61 declared-vs-physical size/hash mismatches show the in-corpus pack manifests predate a regeneration of their members. | RECORDED — originals preserved; manifests marked non-authoritative for hashes |
| KLREC-2026-07-26-008 | Status-model migration: bootstrap statuses BUILT/TESTED have no slot in the owner 11-status model; repo evidence rows are re-registered as SCAFFOLDED with linked E-REPO/E-TEST evidence (unit-tested foundations exceed bare scaffolding but do not meet IMPLEMENTED-IN-DEV gates: no applied dev migrations, no reproducible dev deployment). No feature was advanced. | RESOLVED — mapping recorded in the implementation-status register addendum |
| KLREC-2026-07-26-009 | Terminal-profile identifiers: POS Desktop spec v4.0.0 §13.5 specifies `t1_intake_cashier`/`t2_customer_display`/`t3_ready_scan_in`/`t4_pickup_scan_out` (implemented in `verticals/phase1-laundry`); `kitluy-terminal-profile-contract-t1-t4-v1.0.0.md` uses device-profile codes `laundry_front_counter`/`laundry_ready_pickup`/`laundry_t1..t4` and does not restate the logical identifiers. | **RESOLVED 2026-07-27** by owner decision KLD-2026-07-26-002 (KL-DEC-001, all five groups OWNER-APPROVED). Implementation tracked by KL-DEC-001-T002..T006; approval alone is not implementation evidence (KLD-EVIDENCE-001) |
| KLREC-2026-07-26-010 | Error-code naming: POS spec §14.3 codes `BOOKING_VERSION_CONFLICT`/`DUPLICATE_IDEMPOTENCY_KEY` (implemented in `@kitluy/api-errors`) vs API error registry v1.0.0 `RESOURCE_VERSION_CONFLICT`/`IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST` (~51 codes). | **RESOLVED 2026-07-27** by owner decision KLD-2026-07-26-002 (KL-DEC-001, all five groups OWNER-APPROVED). Implementation tracked by KL-DEC-001-T002..T006; approval alone is not implementation evidence (KLD-EVIDENCE-001) |
| KLREC-2026-07-26-011 | Event-name format: repo `@kitluy/event-contracts` enforces `<domain>.<event>.v<major>` (POS spec §15.2); domain-event registry v1.0.0 canonicalizes unversioned `<context>.<fact>` with envelope schema_version and demotes `.v1` names to compatibility aliases. | **RESOLVED 2026-07-27** by owner decision KLD-2026-07-26-002 (KL-DEC-001, all five groups OWNER-APPROVED). Implementation tracked by KL-DEC-001-T002..T006; approval alone is not implementation evidence (KLD-EVIDENCE-001) |
| KLREC-2026-07-26-012 | Scope taxonomy drift: RB v4 §8.5 `tenant_or_partner`/`individual_device` (implemented in `@kitluy/resource-scope`) vs resource-scope model v1.0.0 `tenant`/`device` (+ new `chain`, `file_object`, `support_session`, `release_cohort`). | **PARTIALLY RESOLVED 2026-07-27** — the scope-taxonomy vocabulary portion is settled by KLD-2026-07-26-002 (Group 3: `tenant_or_partner` -> `tenant`, `individual_device` -> `device`, plus additive `chain`/`file_object`/`support_session`/`release_cohort`). Implementation tracked by KL-DEC-001-T003 |
| KLREC-2026-07-26-013 | Permission-key drift: `releases.promote.stable` (infra spec §16.5, `@kitluy/rbac` seed) vs `releases.promote_stable` (RBAC permission registry v1.0.0, 107 keys). | **RESOLVED 2026-07-27** by owner decision KLD-2026-07-26-002 (KL-DEC-001, all five groups OWNER-APPROVED). Implementation tracked by KL-DEC-001-T002..T006; approval alone is not implementation evidence (KLD-EVIDENCE-001) |

### Owner direction KLD-2026-07-26-003 — Close G1, begin executable data foundation (recorded verbatim intent, 2026-07-26)

| # | Direction | Register effect |
| --- | --- | --- |
| 1 | Schema/RLS/migration-plan trio remain CONTRACT-APPROVED (not execution proof) | Confirms cycle-2 statuses |
| 2 | Current repo toolchain = ACTIVE-BASELINE; engineering-pack versions = TARGET-APPROVED (inactive until a coordinated compatibility task passes all gates; no independent upgrades) | RESOLVES KLREQ-009 decision; KL-ENG-001 remains the coordinated task; BLK-004 → DIRECTION-RECORDED |
| 3 | Consolidate the two security test plans into ONE governing Phase 1 security test system; both identifier namespaces preserved as immutable source aliases; explicit mappings; no delete/renumber/reinterpret | RESOLVES KLREQ-011 decision; work item SEC-CONS-001 |
| 4 | Additive finance-subledger data-dictionary amendment APPROVED (relational, append-only, KHR/USD integer minor units, full context+balancing+idempotency invariants; independent schema AND finance review; no invention of accounting/tax/rounding/statutory policy) | Work item FIN-DD-001; closes the DD gap found in WS-02-T001 review |
| 5 | Local DB execution proceeds only AFTER repository-pinned Docker+Supabase tools are available; then groups: controls → identity/tenant → store/location → authz/audit → functions/RLS helpers → policies → seeds → types → assertions → RLS tests; never production | BLK-002 remains the gate; sequence recorded |
| 6 | IMPLEMENTED-IN-DEV requires: applied dev migrations + assertions + RLS pos/neg execution + generated types + migration-safety review + authorization review + linked evidence | Evidence-gate restated |
| 7 | No authoritative T1-T4/Hub/Booking/payment persistence before WS-02/03/04 executable foundations pass; WS-07/08 stay SCAFFOLDED until DB-backed integration evidence | Dependency rule recorded |

NOT decided by this direction: KL-DEC-001 five-group ballot (KLD-2026-07-26-002) — still OWNER-APPROVAL-REQUIRED; Hub mutations stay blocked. **SUPERSEDED 2026-07-27: the ballot was decided — see the Cycle-7 owner decision below.**

### Owner decision KLD-2026-07-26-002 — contract vocabulary and Edge API (OWNER-APPROVED 2026-07-27)

| Field         | Value                                                                                                                                                                            |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decision ID   | KLD-2026-07-26-002                                                                                                                                                               |
| Task          | KL-DEC-001                                                                                                                                                                       |
| Status        | **OWNER-APPROVED** (decision **ACTIVE**)                                                                                                                                         |
| Decision date | 2026-07-27                                                                                                                                                                       |
| Owner         | KitLuy Project Owner                                                                                                                                                             |
| Record        | `docs/decisions/kitluy-contract-vocabulary-and-edge-api-owner-decision-v1.0.0.md`; ballot `docs/source/processed/reconciliation/kitluy-contract-vocabulary-owner-review-v1.0.0.md` |

Group verdicts: 1 APPROVED (`/edge/v1/*` generic, `/edge/v1/laundry/*` vertical);
2 APPROVED (logical profiles `laundry.t{1..4}.*`; physical device-profile codes
unchanged; `t2_scan_in`/`t3_scan_out` never reusable); 3 APPROVED (grammar
`<domain>.<resource_or_capability>.<verb>`; 107-key registry canonical; approved
release/backup/certificate mappings; `tenant_or_partner`->`tenant`,
`individual_device`->`device`; additive `chain`/`file_object`/`support_session`/
`release_cohort`); 4 APPROVED WITH REGEX CORRECTION (`^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$`;
versions only in `schema_version`); 5 APPROVED WITH ADDITIVE CODES AND
`PAYMENT_PENDING` CLARIFICATION (adds `INTERNAL_ERROR`, `SCALE_UNSTABLE`,
`GARMENT_COUNT_MISMATCH`, `HUB_READ_ONLY`; `PAYMENT_PENDING` is HTTP 202
non-terminal and never a paid state).

Losing forms are REJECTED-BEFORE-IMPLEMENTATION with no aliases or deprecation
paths, because no affected mutation route, event or client was deployed.
Approval removes the decision blockage only — it is NOT implementation evidence
(KLD-EVIDENCE-001). BLK-003 moves to APPROVED-PENDING-IMPLEMENTATION and closes
only on linked implementation evidence and an approving independent review.

### Batch-2 conflicts (KL-DOCS-002, 2026-07-26)

| ID | Conflict | State |
| --- | --- | --- |
| KLREC-2026-07-26-014 | Toolchain divergence: engineering-standards pack `selected_versions` (Node 24.18.0, pnpm 11.4.0, TypeScript 6.0.3, React 19.2.7, RN 0.86.0, Expo 57.0.8, Electron 43.2.0, Supabase CLI 2.109.1, PostgreSQL 17.10, Terraform =1.15.5, root `tool-versions.json` required) conflicts with EVERY repo pin (.nvmrc 22.23.0, pnpm@9.15.9, TS ~5.7.2, React 18.3.1, Next 14.2.35, RN 0.76.6, Electron ^33; ADR-0001/0002 pre-declare that higher-authority choices win once recorded). | OPEN — coordinated toolchain-upgrade task proposed (KL-ENG-001); not applied during ingestion |
| KLREC-2026-07-26-015 | AI Swarm Operating System pack ships root-file replacements (AGENTS.md, CLAUDE.md, KIMI.md, PROJECT_HOME.md, CONTRIBUTING.md, SECURITY.md, 00_AI_HANDOFF templates/state files) that would displace the repo's root governance and handoff system; the two handoff systems are structurally incompatible (different directories, naming, 14-state lifecycle, index format); pack state files self-declare "UNVERIFIED — the target repository was not inspected". Philosophically aligned; nothing in the pack asserts owner-approved displacement. | OPEN — adoption is a registered proposal requiring an owner decision; pack classified under owner-instructions/, not installed |
| KLREC-2026-07-26-016 | Monorepo blueprint v1.0.0 vs actual repository tree: `tooling/` vs `scripts/`; `packages/vertical-laundry` vs `verticals/phase1-laundry..phase8`; blueprint forbids Phase 1 future-client workspaces (repo has registered-inactive `future-clients/`); 21-package vocabulary vs repo's 40; portal names without `-pwa-`; no Turborepo; pack CODEOWNERS references nonexistent paths and handle `@vongvichetpa` vs repo placeholder. | OPEN — structural reconciliation or blueprint revision required before adoption |
| KLREC-2026-07-26-017 | Two co-dated "canonical" security test plans: batch-1 `kitluy-security-test-plan-phase1-v1.0.0.md` (~90 namespaced SEC-*-* IDs, deeper) vs batch-2 `kitluy-security-test-plan-v1.0.0.md` (36 flat SEC-### IDs + rules of engagement). Neither references the other; test-case registry uses a third namespace (KLT-SEC-*). | OPEN — owner must pick/merge one canonical plan |
| KLREC-2026-07-26-018 | `kitluy-testing-and-evidence-system-v1.0.0` is cited as source_document for 41 of 524 registry test cases (all canonical-shared KLT-* rows) but does not physically exist anywhere. | OPEN — supply the document or re-source the 41 rows (KLREQ-008) |
| KLREC-2026-07-26-019 | TypeScript base-config conflicts: coding standard requires `skipLibCheck: false`, `moduleResolution: Bundler`, target ES2023, `exactOptionalPropertyTypes`/`useUnknownInCatchVariables`/`noPropertyAccessFromIndexSignature`; repo base uses skipLibCheck true, NodeNext, ES2022 without those three flags. | OPEN — fold into KL-ENG-001 toolchain task |
| KLREC-2026-07-26-020 | Minor drifts: IaC plan env layout omits a `pilot` Terraform root (repo has one); swarm evidence vocabulary (PLANNED..PRODUCTION_VERIFIED / DRAFT..RELEASED) differs from the adopted owner 11-status model; pack CONTRIBUTING command matrix (`pnpm db:lint` etc.) does not match repo scripts. | OPEN — reconcile on adoption |

Batch-2 non-findings (verified): secrets inventory contains references only, zero
secret values; domain/DNS plan is all `[REQUIRED]` placeholders; environment
matrix exactly matches `KITLUY_ENVIRONMENTS`; CI/CD doc reinforces
KL-INF-P1-037 (no auto-applied production migrations); no batch-2 document
contradicts any owner-locked invariant.

### Cycle-5 reconciliation (WS-05/06, 2026-07-27)

Conflicts C1–C10 recorded in
`docs/source/processed/reconciliation/kitluy-ws05-ws06-entity-reconciliation-v1.0.0.md`
(none silently resolved). Highest-impact: **C2 — ten cycle-mandated entities
absent from the data dictionary** → DD **Amendment-002 REQUIRED** (KLREQ-012,
owner review path as Amendment-001); C4 missing customer-data RBAC key
(PC-TENANT interim, registry amendment proposed); C8 kitluy_notifications
partial schema (remainder group 0100).

### Cycle-6 reconciliation (WS-07/08, 2026-07-27)

Recorded, not silently resolved (register rule; higher-authority decision
preserved in each cell):

| ID  | Conflict / deviation                                                                                                                                                                                                                                                                                                                     | Disposition                                                                                                                                                                                                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C11 | Enum-registry `laundry_booking_status` (14 values incl. `IN_PRODUCTION`, `QA`, `PICKUP_IN_PROGRESS`, `COMPLETED`) conflicts with the owner-canonical state machines: KBR-TXN §4 lifecycle (10 states incl. `CONFIRMED/FINALIZED`) + KBR-LND §4 production chain (7 states incl. `QA_PACKAGING`, `PICKED_UP`), which the tested engines implement | Persistence encodes the owner-canonical §4 vocabularies (migrations 0075/0080; engines are the canonical implementation per Cycle-6 §6). The enum-registry set is NOT encoded and NOT deleted — owner decision owed on the registry row; compatibility mapping required if both survive                                                                            |
| C12 | Cycle-6 relations/columns mandated by the cycle instruction but absent from DD v1.0.0: `kitluy_laundry.booking_production_state` (projection), `kitluy_payments.payment_status_history` (append-only history); additive columns (orders `version`/`payment_state`/`required_deposit_minor`/intake verification, order_lines `weight_rounding_rule`, garments `unit_kind`/`container_id`, tenders `applied_minor`/`change_due_minor`); weight stored as integer grams (engine contract) vs DD `numeric(18,4)` quantity convention; DD has no payment-allocations relation (tender→order binding + `applied_minor` is the implemented allocation form) | Implemented-and-tested schema is the implementation truth (C1/C2 precedent); DD Amendment-003 REQUIRED (KLREQ-013). All differences are omission-class except the weight representation (convention conflict — engine integer grams preserved; DD convention row unchanged) and `laundry_booking_status` (see C11)                                                 |
| C13 | RBAC 107-key registry has no neutral transaction-read key and no finance-read key for the new `kitluy_orders`/`kitluy_finance` SELECT policies                                                                                                                                                                                             | Interim strictest scopes encoded in group 0095 (store-scope-only / tenant-scope-only, C4 precedent); registry amendment proposed (KLREQ-014)                                                                                                                                                                                                                     |

DD Amendment-002 (KLREQ-012, conflict C2) authored 2026-07-27 in
decision-ready form at
`docs/data/kitluy-suite-supabase-data-dictionary-amendment-002-customer-identity-and-consent-v1.0.0.md`
— PROPOSED, pending independent schema review and owner approval; C1–C10
records preserved unchanged. KL-DEC-001 (KLD-2026-07-26-002 ballot) remains
OWNER-APPROVAL-REQUIRED — no Edge/Hub route shapes, public event names, public
error vocabulary or terminal-profile renames were finalized this cycle; custody
event names stay internal (KLREC-2026-07-26-011 fence) and outbox publication
stays unimplemented.

> Cycle-7 update (2026-07-27): the KL-DEC-001 fence described above was lifted
> by owner decision KLD-2026-07-26-002 (OWNER-APPROVED). The Cycle-6 statement
> is preserved verbatim as the record of what was true at Cycle-6 close.

### Cycle-7 reconciliation (KL-DEC-001 contract alignment, 2026-07-27)

Discovered during implementation of the approved decision. Recorded, not
silently resolved. In every case the owner decision KLD-2026-07-26-002
outranks the contract-family document per the authority order, so the decision
was implemented and a documentation amendment is owed.

| ID  | Conflict / deviation                                                                                                                                                                                                                                       | Disposition                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C14 | Domain Event Registry v1.0.0 §2 JSON Schema defines three flat required envelope fields `aggregate_type` / `aggregate_id` / `aggregate_version`; owner decision Group 4 lists a single `aggregate` field                                                     | Decision implemented as a nested `aggregate: { type, id, version }` in `@kitluy/event-contracts` (authority order: owner decision > contract family). **Registry amendment owed** to match       |
| C15 | Domain Event Registry §2 event-name pattern `^[a-z0-9_]+\.[a-z0-9_]+$` admits names beginning with a digit; the approved corrected pattern `^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$` requires a leading letter                                                   | Decision (stricter) implemented. **Registry amendment owed**                                                                                                                                    |
| C16 | Store Hub LAN API v1.0.0 §error table still specifies the `EDGE_*` error-identifier convention (e.g. `EDGE_HUB_READ_ONLY`, `EDGE_SCALE_UNSTABLE`, `EDGE_INTERNAL`), which Group 5 rejects for production identifiers                                        | Code carries no `EDGE_*` identifier and a regression test forbids the prefix. **Documentation amendment owed** to the LAN API spec                                                              |
| C17 | `@kitluy/api-errors` diverged from the canonical API Error Code Registry beyond the Group-5 mapping list (e.g. `PRINT_FAILED` 502 in code vs 503 in the registry)                                                                                            | Package realigned to the canonical registry during KL-DEC-001-T005; every remaining divergence enumerated in the task evidence                                                                   |
| C18 | Approved event-name grammar cannot structurally reject a two-segment legacy alias such as `digital_store_created.v1` — it is indistinguishable from a valid `<context>.<fact>` pair                                                                          | Accepted limitation of the approved pattern; such aliases are excluded by the registry as documentation-only mappings, not by the validator. Documented in code and in a documenting test        |
| C19 | **OWNER RULING REQUIRED.** Group 3 states the permission grammar as `<domain>.<resource_or_capability>.<verb>` (three segments) AND states the 107-key registry is the canonical baseline — but **60 of the 107 canonical keys have exactly two segments**, including the three release keys the decision itself names canonical (`releases.promote_internal`/`_pilot`/`_stable`), plus `rbac.read`, `laundry.ready_scan_in`, `webhooks.replay`. Enforcing three segments would invalidate 56% of the baseline | NOT silently resolved. Implemented as: grammar admits **2-or-3** segments (still a real tightening — 1-segment, 4+-segment, uppercase, hyphen and wildcard forms are now rejected) and **registry membership is the authoritative fail-closed gate**. Either the grammar sentence or 60 registry rows must move — owner decision owed |
| C20 | Embedding the full 107-key registry in `packages/rbac` brings six vertical-namespaced key STRINGS (`laundry.bookings.*`, `laundry.ready_scan_in`, `laundry.pickup_scan_out`, `laundry.booking.complete`) into neutral Core, which CLAUDE.md hard rule 2 restricts | Followed the existing precedent for canonical contract identifiers (key strings only, no Laundry behavior, block marked inline). Owner decision owed on whether vertical rows should instead be contributed by the owning vertical package at registration time |
| C21 | Resource Scope Model §4 lists `store_edge` as an environment, but `KITLUY_ENVIRONMENTS` in `packages/shared-types` is `local, development, staging, pilot, production, disaster_recovery` (has `local`, lacks `store_edge`). The RBAC environment-segment denylist derives from that list, so a `store_edge` segment would not be rejected | Recorded, NOT fixed (outside the task's allowed paths). Requires a `packages/shared-types` change under a separate governed task                                                                 |
| C22 | **OWNER ACTION REQUIRED.** Nine approved Group-1 routes have NO actor-permission key in the 107-key RBAC registry: Edge session open/refresh/switch/close (4), T2 display-session open/update/close from T1 (3), T2 reading its own customer-safe state (1), and recording a customer-originated T2 action as consent evidence (1). `identity.sessions.revoke` is Management-surface revocation, not Edge issuance | Routes carry explicit `[REQUIRED: …]` markers and FAIL CLOSED; no key invented. Registering them needs `rbac.permission_registry_manage` (A4_OWNER_SECURITY, impact assessment) — tracked as **KLREQ-015** |
| C23 | Audit-event vocabulary conflict: the RBAC registry CSV `primary_audit_event` column and the Domain Event Registry use different bounded-context tokens for identical facts — `laundry.booking_created` vs `laundry_booking.created`; `garment.ready_scanned_in` vs `garment.custody_scanned_in`; `garment.pickup_scanned_out` vs `garment.custody_scanned_out`; `payment.cash_recorded` vs `payment.recorded`. Both satisfy the approved Group-4 regex, so the grammar does not disambiguate | Domain Event Registry / Group 4 vocabulary implemented (owner decision outranks a supporting registry); divergence exported machine-readably as `AUDIT_EVENT_RECONCILIATION`. **RBAC CSV amendment owed**                                                    |
| C24 | 17 of the 22 Edge route audit-event names are `proposed`, not present in the Domain Event Registry (e.g. `edge_session.opened`, `display_session.*`, `laundry_ready_session.*`, `laundry_pickup_session.*`, `laundry_booking.completed`). Only 5 are `registered`                                                                    | Marked `proposed` in the registry data and must be registered in the Domain Event Registry before any release — tracked as **KLREQ-016**                                                        |
| C25 | Neutral-Core boundary tension: CLAUDE.md hard rule 2 states `packages/` carries no vertical terminology, but approved Group 1 places `/edge/v1/laundry/*` inside the Edge boundary                                                                                                                                                   | Laundry vocabulary quarantined as inert CONTRACT DATA in `packages/edge-contracts/src/laundry-routes.ts` + `terminal-profiles.ts`, with no build or runtime dependency on the vertical. Owner decision owed on whether the Laundry table should move to a vertical-owned Edge package |

### Engineering decisions (bootstrap + this task)

KLBOOT-DEC-001..007 (see ADR-0001..0005 in `docs/decisions/`) remain in force.
New: **KLBOOT-DEC-010** — taxonomy extension for batch 2: classified dirs `engineering/` and `qa/` added to the Phase B taxonomy (packs had no matching family); recorded here rather than silently inventing structure. **KLBOOT-DEC-008** — owner governance originals adopted at
`docs/authority/` with clearly-marked repository addenda; the 2.2 MB
open-decisions register is kept as a single immutable copy with a working
pointer file (this avoids a third full copy while preserving hash integrity).
**KLBOOT-DEC-009** — imported bible copies registered as
DUPLICATE-FORMATTING-VARIANT after content-identity verification.

### Owner instructions received in-session

| ID | Instruction | Date |
| --- | --- | --- |
| KLOI-2026-07-26-001 | The `docs/source/inbox/` directory is a transient drop zone: after a batch is ingested (inventoried, hashed, classified with hash-verified copies), the originals are deleted from the inbox so future drops contain only new files. Provenance is preserved via the source manifest (SHA-256 + original_path), git history, and the immutable classified copies, which become the surviving originals. Enforced by `pnpm docs:inbox-state`. | 2026-07-26 |

### Owner-locked decision traceability (preserved from bootstrap)

KLV4-DEC-001..012 and KLD-2026-07-24-001 (12 KLMF capability decisions) are
defined in RB v4 Parts 11; the owner register above adds KLD-2026-07-20-001 ..
KLD-API-001. Full text lives in the bibles; none may be altered here.
