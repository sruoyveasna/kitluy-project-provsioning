# KitLuy Superseded Document Register

**Filename:** `kitluy-superseded-document-register-v1.0.0.md`  
**Version:** v1.0.0  
**Date:** 2026-07-26  
**Owner:** HET / KitLuy Suite Project Owner  
**Status:** CANONICAL SUPERSESSION AND LEGACY CONTROL

## 1. Purpose

This register prevents obsolete T1-T3, physical-Store-first, Seller, manual-provisioning and evidence assumptions from returning through old documents, copied prompts, generated code or migrations.

Superseded does not mean delete. Historical files remain available for traceability, but prohibited concepts must not be used as active requirements.

## 2. Supersession register

| ID      | Superseded source/pattern                                               | Superseded scope                                                                | Replacement authority                                           | Prohibited revival                                                           | Current treatment                                             |
| ------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------- |
| SUP-001 | kitluy-suite-rebuild-bible-v3.0.0.md                                    | T1/T2/T3 terminal model and physical-first/old Store language                   | T1-T4 owner lock; Digital Store owner decision; future Suite v4 | Do not use T2 Scan-In, T3 Scan-Out or final handover at T1                   | Partially superseded; retain unaffected architecture until v4 |
| SUP-002 | kitluy-suite-ecosystem-business-bible-v1.0.0.md                         | Three-terminal flow, old roadmap and physical-first business narrative          | Current Project Instructions; future Business Bible v2          | Do not use old terminal/business flow or outdated roadmap                    | Partially superseded; retain unaffected business material     |
| SUP-003 | kitluy-admin-pwa-portal-rebuild-bible-v2.0.0.md                         | Phase 1 Admin scope and authorization depth where changed                       | kitluy-admin-pwa-portal-phase1-spec-v3.1.0.md                   | Do not revive broad admin role-only security or old provisioning terms       | Retained historical baseline                                  |
| SUP-004 | kitluy-chain-portal-rebuild-bible-v2.0.0.md                             | Phase 1 hierarchy, T1-T4 awareness, route ownership and freshness where changed | kitluy-chain-portal-phase1-spec-v3.0.0.md                       | Do not use physical-Store-only or old terminal-health semantics              | Retained historical baseline                                  |
| SUP-005 | kitluy-partner-pwa-portal-rebuild-bible-v1.1.0.md                       | Phase 1 Partner Portal hierarchy, provisioning and old T2/T3 workflow           | kitluy-partner-portal-phase1-spec-v2.0.0.md                     | Do not use T2 Scan-In/T3 Scan-Out, manual setup or Store-only-physical model | Retained historical baseline                                  |
| SUP-006 | kitluy-partner-app-rebuild-bible-v1.1.0.md                              | Phase 1 Digital Store/Location context and current product scope where changed  | kitluy-partner-app-phase1-spec-v2.0.0.md                        | Do not restore old hierarchy/routes or infer broad implementation            | Retained historical baseline                                  |
| SUP-007 | kitluy-concept-design-1.txt                                             | Earlier evolution tables using T1/T2/T3                                         | Explicit T1-T4 locked section in same file and current POS spec | Use only locked/current sections; old evolution tables are historical        | Mixed document; section-level supersession                    |
| SUP-008 | Any document using Seller as current product term                       | Seller naming                                                                   | Partner naming standard                                         | Seller allowed only for legacy field migration or historical quotation       | Global terminology supersession                               |
| SUP-009 | Any document treating Store as only a physical location                 | Physical Store entity model                                                     | Tenant/Partner Account -> Digital Store -> Store Location       | Use full canonical entity names                                              | Global conceptual supersession                                |
| SUP-010 | Any normal-flow manual IP/role-selection provisioning instructions      | Manual technical onboarding                                                     | Smartphone-simple Hub-first provisioning                        | Manual IP is fallback only; assigned roles come from control plane           | Global workflow supersession                                  |
| SUP-011 | Any document identifying T2 as Scan-In or KDS                           | T2 role                                                                         | T2 Customer Display Screen                                      | Production/KDS clients must be separately named and scoped                   | Global terminal supersession                                  |
| SUP-012 | Any document identifying T3 as Pickup Scan-Out                          | T3 role                                                                         | T3 Clean & Ready Scan-In; T4 Pickup Scan-Out                    | T3 cannot release customer custody                                           | Global terminal supersession                                  |
| SUP-013 | Planning registry/backlog status used as implemented status             | Evidence classification                                                         | Implementation Status and Evidence Register                     | Do not translate APPROVED TARGET/OWNER-LOCKED into implemented               | Global evidence correction                                    |
| SUP-014 | Competitor clone codename/product boundary used as KitLuy product truth | Clone architecture                                                              | Current KitLuy product inventory and specifications             | Clone tables/routes/services remain references only                          | Global source-authority correction                            |
| SUP-015 | Reporting/history/export commercial gating proposals                    | Commercial entitlement model                                                    | KLMF-REP-010 owner decision C                                   | Do not implement tier-based reporting/history/export paywalls                | Owner-locked commercial supersession                          |
| SUP-016 | Offline card capture proposals                                          | Payment risk model                                                              | KLMF-PAY-014 owner decision                                     | Do not implement or display unverified offline card success                  | Owner-locked rejection                                        |

## 3. Mandatory legacy scan patterns

Before approving a build or document, search for and review at least:

```text
T1/T2/T3
T1-T3
T2 Scan In
T2 Scan-In
T3 Scan Out
T3 Scan-Out
shared T2/T3 terminal
Seller Portal
Seller App
physical Store first
Store is a physical location
manual IP setup
manual terminal role selection
reporting add-on
sales history add-on
offline card capture
```

A match is not automatically wrong when it appears in a supersession note, migration comment or historical quotation. Active requirements and behavior must use the current model.

## 4. Archival rules

- Preserve original filename, version, date and checksum.
- Add a visible superseded banner when the file remains in the active repository.
- Link to the replacement authority and this register.
- Do not edit historical evidence to make it appear current.
- Do not use superseded files as agent entry points.
- Remove superseded files from active prompt bundles after their retained information is consolidated.

## 5. Superseded banner template

```markdown
> SUPERSEDED / RETAINED FOR TRACEABILITY
> Do not use this file as current authority.
> Replacement: <filename and version>
> Superseded scopes: <list>
> Register entry: <SUP-ID>
```

---

## Repository addendum — KL-DOCS-001 (not part of the owner original)

Owner original (immutable): `docs/source/canonical/kitluy-superseded-document-register-v1.0.0.md`.

### Machine-found superseded files (bootstrap inventory, retained as SUP rows)

| Superseded file (found on this machine) | Superseded by |
| --- | --- |
| kitluy-suite-rebuild-bible-v3.0.0.md / -md-v1.1.0.md / -md-v1.0.0.md | kitluy-suite-rebuild-bible-v4.0.0.md |
| kitluy-suite-ecosystem-business-bible-v1.0.0.md; kitluy-suite-ecosystem-handbook-md-v1.0.0.md | kitluy-suite-business-bible-v2.0.0.md |
| kitluy-admin-pwa-portal-phase1-spec-v3.0.0.md | v3.1.0 |
| Product rebuild-bibles (admin v2.0.0/v1.0.0, chain v2.0.0/md-v1.0.0, partner-app v1.1.0, partner-pwa v1.1.0, seller-portal md-v1.0.0) | current Phase 1 product specs |
| kitluy-*-feature-enhancement-prompt.md (6 files, Jun 2026) | current Phase 1 specs |
| March–June 2026 docx handbooks/bibles/wireframes (Organized/ folders) | current bibles + specs |

### Additional notes

- Retired terminal identifiers `t2_scan_in` / `t3_scan_out` are permanently
  retired (POS spec §13.5) and covered by SUP pattern rules.
- SUP-001/SUP-002 staleness: the replacements they await (Rebuild Bible v4.0.0,
  Business Bible v2.0.0) now physically exist (`docs/source/canonical/`) —
  recorded as reconciliation entry KLREC-2026-07-26-005.
- Bootstrap recreations of the 8 governance documents (commit `4a79f66`) are
  superseded by the owner originals ingested in KL-DOCS-001.
