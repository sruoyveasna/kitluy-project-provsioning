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
