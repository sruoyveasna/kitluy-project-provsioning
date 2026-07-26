# KitLuy Chain Portal — Wireframe Feature Enhancement Prompt
## Paste this into the **kitluy-chain-portal_UIUX** chatroom

---

## PURPOSE

This prompt lists **research-driven features (KF-###)** to add to the existing Chain Portal wireframe. All features below are **Phase 2** — the laundry POS is Phase 1 MVP. These are documented now so wireframe planning can begin.

**Applies to:** `kitluy-chain-portal` wireframe (currently v1.1.0, 2,011 lines, 36 routes, 13 groups)

---

## PHASE 2 — FEATURES TO ADD (10 features)

### Chain P1 (first chain release)

| ID | Feature | Priority | Source | Where in Chain Portal |
|---|---|---|---|---|
| KF-051 | Royalty rule template library | CRITICAL | R35 | New module: Royalties > Rule Templates. Configurable models: gross sales %, net sales %, minima, tiered, hybrid. |
| KF-055 | Self-serve branded loyalty kit | HIGH | R11 | Loyalty Studio > Program Builder. Card visuals, rule packs, campaign controls. Chain builds OWN branded program (NOT Rotanak). |
| KF-056 | B2B contract / invoicing for chain accounts | MEDIUM | R14 | New module: Chain B2B > Contracts, Billing Cycles, Account Controls. For chains serving hotels, uniforms, institutions. |
| KF-058 | HQ override / local override governance | MEDIUM | R11, R37 | Governance > Override Policies. LOCKED: No overrides allowed — HQ pricing + menu items immutable at store level. |

### Chain P1.5

| ID | Feature | Priority | Source | Where in Chain Portal |
|---|---|---|---|---|
| KF-052 | Territory polygon mapping + overlap alerts | HIGH | R36 | Territories > Map View. Simple polygons first (not rich scoring). Cannibalization protection alerts. |
| KF-057 | New-store location scoring + approval workflow | MEDIUM | R36 | Territories > Expansion. Territory intelligence feeds expansion approvals. |

### Chain P2

| ID | Feature | Priority | Source | Where in Chain Portal |
|---|---|---|---|---|
| KF-053 | Brand compliance audits with photo evidence | HIGH | R37 | Compliance > Audits. Evidence types: all four (photos, checklists, receipts, mystery-shopper). |
| KF-054 | Compliance scoring engine by pillar | HIGH | R37 | Compliance > Scores. Quantitative scoring for brand, process, merchandising, experience consistency. |
| KF-059 | Royalty dispute + settlement exception workflow | MEDIUM | R35 | Royalties > Disputes. Transparent review of adjustments and disputed bases. |

### Future

| ID | Feature | Priority | Source | Where in Chain Portal |
|---|---|---|---|---|
| KF-060 | Field audit mobile mode | LOW | R37 | Compliance > Mobile Audit. On-site audits executed on tablet/mobile. |

---

## LOCKED DECISIONS AFFECTING CHAIN PORTAL

| Decision | Answer |
|---|---|
| Territory intelligence | Simple polygons first; rich scoring added later |
| Compliance evidence types | All four: photos, checklists, receipts, mystery-shopper |
| Franchisee override flexibility | No overrides allowed. HQ pricing + menu items immutable at store level. |
| Chain B2B controls | First chain release (not deferred) |
| Chain loyalty | Own branded program (NOT Rotanak). Optional Rotanak partnership deal. |

---

## NEW DATABASE TABLES (Chain Portal relevant)

- `kitluy.chain.royalty_rules`
- `kitluy.chain.royalty_runs`
- `kitluy.chain.territory_polygons`
- `kitluy.chain.location_scores`
- `kitluy.chain.compliance_audits`
- `kitluy.chain.compliance_evidence`
- `kitluy.loyalty_chain.rule_versions`
- `kitluy.customers.chain_b2b_contracts`

## NEW EDGE FUNCTIONS (Chain Portal relevant)

- `kitluy-royalty-run-calc`
- `kitluy-territory-overlap-check`
- `kitluy-compliance-score`
- `kitluy-chain-loyalty-publish`
- `kitluy-location-score-calc`

---

## REMINDERS

- Chain loyalty = own branded (NOT Rotanak). Optional partnership deal.
- 1 store = 1 vertical, no mixing
- All monetary values: **KHR ៛ integer only**
- File naming: `xxxxx-wireframe-vX.Y.Z.jsx`
- Never rebuild from scratch — targeted `str_replace` edits only
