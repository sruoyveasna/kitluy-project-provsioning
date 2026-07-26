# KitLuy Pricing, Discount, Tax and Rounding Rules

**Filename:** `kitluy-pricing-discount-tax-and-rounding-rules-v1.0.0.md`

## 0. Document status and authority

- **Version:** v1.0.0
- **Date:** 2026-07-26
- **Owner:** HET / KitLuy Suite Project Owner
- **Status:** Canonical target contract; not implementation evidence
- **Primary phase:** Phase 1 — Laundry, with neutral rules designed for confirmed later reuse
- **Authority order:** current owner decisions and Project Instructions → applied migrations/verified code/tests/production evidence → this contract → current Rebuild and Business Bibles → approved handoffs → evidence-based analyses → competitor clone references → superseded planning.

> **Rebuild Test:** A qualified engineer must be able to implement and verify these rules from this document, the canonical schema, API/event contracts, migrations, permission matrix, test registry and deployment instructions without relying on undocumented knowledge.

## Purpose and scope

This document defines money representation, price precedence, Laundry calculations, discount stacking, tax snapshots, total order, cash rounding and configuration-version effects.

**Scope boundary:** Neutral pricing and money foundation with Phase 1 Laundry per-piece/per-weight adapter. Tax/legal values are configuration, not guessed constants.

## 1. Governing principles

1. Current owner decisions and the active KitLuy Project Instructions override older planning.
2. Applied migrations, verified code/tests, deployment records and production evidence override target-state prose for implementation truth.
3. A Partner Account owns one or more Digital Stores; each Digital Store has exactly one primary vertical. Physical Store Locations are optional offline-capable edge environments.
4. Finalized transaction, payment, inventory, finance and audit records are append-only. Corrections use linked compensating records; destructive edits are prohibited.
5. Authoritative business data uses relational tables. JSON is limited to optional metadata and transport envelopes.
6. Every write is tenant-, Digital-Store-, Location-, actor- and device-scoped; versioned, idempotent, retry-safe and auditable.
7. The Store Hub is the local operational authority after provisioning. WAN failure must not stop approved local operations.
8. External channels and connectors never own KitLuy customer, inventory, payment, finance or audit truth.
9. Sensitive financial, permission, compliance or safety actions require authorized human confirmation and, where policy requires, four-eyes approval.
10. Khmer and English, KHR and USD, Asia/Phnom_Penh, KHQR and intermittent connectivity are first-class requirements.
11. Missing, stale, partial, estimated or unreconciled data must be labeled; it must never be presented as authoritative current truth.
12. No capability is `IMPLEMENTED` without repository, applied migration, test, deployment and required pilot/production evidence.

## 2. Canonical data conventions

| Concern        | Canonical rule                                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| IDs            | UUID; offline-created aggregates use client-generated UUIDv7 when available.                                         |
| Idempotency    | Caller supplies a stable idempotency key. Replays return the original business result without duplicating effects.   |
| Money          | `amount_minor bigint` plus ISO-4217 currency code. KHR exponent is 0; USD exponent is 2. No floating-point money.    |
| Quantities     | `numeric(18,4)` plus unit-of-measure; weight and piece quantities are never silently interchanged.                   |
| Time           | Store UTC `timestamptz`; render in `Asia/Phnom_Penh`. Operational grouping uses explicit Location business date.     |
| Scope          | Every authoritative record resolves Tenant, Digital Store and, when physical, Store Location.                        |
| Truth envelope | Reads expose source, as-of time, completeness, sync freshness and reconciliation status.                             |
| Corrections    | Reverse or adjust with linked compensating entries; preserve the original.                                           |
| Audit          | Actor, role, device, source, reason, correlation ID, before/after references and approval evidence where applicable. |
| Offline        | Store Hub accepts only locally authorized operations and queues immutable outbox events for cloud synchronization.   |

## 3. Rule catalogue

### KBR-PRC-001 — Money representation and rounding boundary

| Required field            | Canonical specification                                                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-PRC-001                                                                                                                                               |
| Purpose                   | Make all prices and totals deterministic across clients and currencies.                                                                                   |
| Inputs                    | Amount; currency; currency exponent; operation; rounding policy/version.                                                                                  |
| Preconditions             | Currency supported; amount represented as integer minor units or high-precision intermediate where explicitly allowed.                                    |
| Calculation or transition | Never use binary float. Round only at defined boundary using governed HALF_EVEN unless tax/legal policy specifies otherwise. KHR minor exponent 0; USD 2. |
| Output                    | Integer minor-unit result and rounding trace/version.                                                                                                     |
| Permissions               | Pricing service; policy administration privileged.                                                                                                        |
| Audit event               | pricing.rounded.                                                                                                                                          |
| Offline behavior          | Hub caches signed currency/rounding policy and performs identical calculation.                                                                            |
| Error behavior            | Unsupported currency or ambiguous scale blocks calculation.                                                                                               |
| Compensating action       | Recalculate with corrected policy and issue linked adjustment for finalized document.                                                                     |
| Canonical test vectors    | TV1: USD 10.005 at boundary HALF_EVEN → $10.00 when even lower cent. TV2: KHR 1000.5 → governed integer result.                                           |
| Owning service            | Money and Pricing Core                                                                                                                                    |
| Consuming products        | All products, APIs, receipts, reports                                                                                                                     |

### KBR-PRC-002 — Price resolution precedence

| Required field            | Canonical specification                                                                                                                                                                                           |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-PRC-002                                                                                                                                                                                                       |
| Purpose                   | Select one applicable sell price deterministically.                                                                                                                                                               |
| Inputs                    | Offer/service; Digital Store/Location; customer segment; channel; quantity/UOM; business time; price books; overrides.                                                                                            |
| Preconditions             | Offer active; compatible configuration acknowledged; context complete.                                                                                                                                            |
| Calculation or transition | Resolve in governed precedence: explicit authorized transaction override → applicable contracted/segment price → Location/channel price book → Digital Store base price. Reject ambiguous equal-priority matches. |
| Output                    | Resolved unit price with source, rule ID/version and effective interval.                                                                                                                                          |
| Permissions               | Read available to sales flows; override requires explicit permission/reason.                                                                                                                                      |
| Audit event               | pricing.resolved/override_applied.                                                                                                                                                                                |
| Offline behavior          | Hub resolves from last active acknowledged package. Stale but compatible price may be used with version trace; incompatible/expired policy blocks new confirmation.                                               |
| Error behavior            | No price or ambiguity blocks sale; never guess or use display cache without authority.                                                                                                                            |
| Compensating action       | Refresh package or manager-approved override; finalized price remains snapshot.                                                                                                                                   |
| Canonical test vectors    | TV1: Location price overrides Store base. TV2: two same-priority rules → error.                                                                                                                                   |
| Owning service            | Pricing Service                                                                                                                                                                                                   |
| Consuming products        | T1/T2, Storefront, Partner/Chain portals, APIs, connectors                                                                                                                                                        |

### KBR-PRC-003 — Laundry per-piece and per-weight calculation

| Required field            | Canonical specification                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rule ID                   | KBR-PRC-003                                                                                                                                                                          |
| Purpose                   | Calculate Phase 1 service charges using the correct measurement basis.                                                                                                               |
| Inputs                    | Service pricing mode; verified piece count or weight; unit price; minimum/step rules; add-ons.                                                                                       |
| Preconditions             | T1 verified measurement; service mode configured; UOM compatible.                                                                                                                    |
| Calculation or transition | PER_PIECE amount = pieces × unit price. PER_WEIGHT amount = billable weight under approved increment/minimum rule × price per unit. Add-ons calculate separately and remain visible. |
| Output                    | Line subtotal and calculation trace.                                                                                                                                                 |
| Permissions               | T1 confirms measurement; manager approves exceptional manual amount.                                                                                                                 |
| Audit event               | laundry_price.calculated.                                                                                                                                                            |
| Offline behavior          | Hub calculates locally using active package. Customer pre-intake estimates never finalize price.                                                                                     |
| Error behavior            | Missing verified measurement or incompatible UOM blocks finalization.                                                                                                                |
| Compensating action       | Correct measurement before finalization; after finalization post price adjustment/credit with approval.                                                                              |
| Canonical test vectors    | TV1: 3 shirts × 2,000 KHR = 6,000. TV2: 2.4kg at 3,000/kg = 7,200 before any approved increment rule.                                                                                |
| Owning service            | Laundry Pricing Adapter                                                                                                                                                              |
| Consuming products        | T1/T2, Storefront estimate, Partner Portal, receipts/reports                                                                                                                         |

### KBR-PRC-004 — Discount eligibility and stacking

| Required field            | Canonical specification                                                                                                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-PRC-004                                                                                                                                                                                               |
| Purpose                   | Apply only authorized discounts and make combinability explicit.                                                                                                                                          |
| Inputs                    | Discount rules; customer/segment; code; schedule; lines; channel; prior discounts; actor.                                                                                                                 |
| Preconditions             | Rule active, in scope, unexpired, usage/eligibility valid.                                                                                                                                                |
| Calculation or transition | Evaluate deterministic priority and combinability graph. Apply discounts to eligible bases only. Total discount cannot exceed eligible amount. Manual discount is a separate rule with permission/reason. |
| Output                    | Discount allocations by line/order and attribution to rule/version.                                                                                                                                       |
| Permissions               | Automatic service or authorized staff; manual/large discount approval by threshold.                                                                                                                       |
| Audit event               | discount.applied/rejected/overridden.                                                                                                                                                                     |
| Offline behavior          | Hub caches active discount package and usage counters needed locally. Cross-channel global usage may require online validation; offline policy must be explicit.                                          |
| Error behavior            | Invalid code/eligibility/combinability rejects without leaking private rule details.                                                                                                                      |
| Compensating action       | Remove before finalization; after finalization use adjustment/refund, preserving original discount snapshot.                                                                                              |
| Canonical test vectors    | TV1: 10% line discount on 10,000 → 1,000. TV2: two non-stackable discounts → higher/priority one only.                                                                                                    |
| Owning service            | Promotion and Pricing Service                                                                                                                                                                             |
| Consuming products        | POS, Storefront, Partner Portal, Finance, reports                                                                                                                                                         |

### KBR-PRC-005 — Tax determination and snapshot

| Required field            | Canonical specification                                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-PRC-005                                                                                                                                                                     |
| Purpose                   | Calculate tax only from approved jurisdiction/Store policy and preserve the applied basis.                                                                                      |
| Inputs                    | Location/jurisdiction; tax class/rate; inclusive/exclusive mode; taxable base; exemptions; effective time.                                                                      |
| Preconditions             | Approved tax configuration and legal/accounting owner decision exists for the Store.                                                                                            |
| Calculation or transition | Resolve applicable tax rule; calculate at specified line/document boundary and rounding policy; snapshot rate, jurisdiction, class, inclusive mode and exemption evidence.      |
| Output                    | Tax amounts and immutable tax snapshot.                                                                                                                                         |
| Permissions               | Pricing/tax service; configuration changes privileged; exemptions require evidence/permission.                                                                                  |
| Audit event               | tax.calculated/exemption_applied.                                                                                                                                               |
| Offline behavior          | Hub uses signed active tax package. If missing/incompatible, new taxable transaction confirmation fails closed unless approved zero-tax jurisdiction policy explicitly applies. |
| Error behavior            | Do not assume Cambodia VAT/rate from generic knowledge. Unknown configuration is not zero tax.                                                                                  |
| Compensating action       | Correct draft; finalized correction uses credit/debit adjustment and revised tax evidence.                                                                                      |
| Canonical test vectors    | TV1: configured 10% exclusive on 10,000 → 1,000. TV2: no approved tax config → block, not 0.                                                                                    |
| Owning service            | Tax Policy and Pricing Service                                                                                                                                                  |
| Consuming products        | POS, Storefront, Partner Portal, Finance, receipts/exports                                                                                                                      |

### KBR-PRC-006 — Document total calculation order

| Required field            | Canonical specification                                                                                                                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-PRC-006                                                                                                                                                                                                 |
| Purpose                   | Produce the same total on every surface.                                                                                                                                                                    |
| Inputs                    | Line base amounts; line discounts; order discounts; taxable base; tax; service charges/fees; rounding.                                                                                                      |
| Preconditions             | All components use same currency and approved policies.                                                                                                                                                     |
| Calculation or transition | Canonical order: line base → line discount allocations → order-level discount allocation → taxable base → tax → approved charges/fees → rounding adjustment. Sum line/component minor units to grand total. |
| Output                    | Subtotal, discount, tax, charges, rounding and grand total with trace.                                                                                                                                      |
| Permissions               | Pricing service; manual rounding adjustment prohibited except governed cash-rounding policy.                                                                                                                |
| Audit event               | transaction.total_calculated.                                                                                                                                                                               |
| Offline behavior          | Hub and cloud run same versioned calculation library/contract.                                                                                                                                              |
| Error behavior            | Cross-currency, missing policy or non-deterministic allocation blocks confirmation.                                                                                                                         |
| Compensating action       | Reprice draft; finalized change via adjustment document.                                                                                                                                                    |
| Canonical test vectors    | TV1: base 10,000; discount 1,000; tax 10% exclusive → total 9,900.                                                                                                                                          |
| Owning service            | Pricing and Transaction Service                                                                                                                                                                             |
| Consuming products        | T1/T2, Storefront, APIs, receipts, Finance                                                                                                                                                                  |

### KBR-PRC-007 — Cash rounding versus accounting total

| Required field            | Canonical specification                                                                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rule ID                   | KBR-PRC-007                                                                                                                                                                                                  |
| Purpose                   | Separate optional physical cash settlement rounding from transaction/accounting price.                                                                                                                       |
| Inputs                    | Grand total; tender currency; cash rounding increment/policy; tender type.                                                                                                                                   |
| Preconditions             | Approved cash-rounding policy exists; cash tender selected.                                                                                                                                                  |
| Calculation or transition | Keep accounting grand total unchanged. Calculate cash amount and rounding difference only for cash settlement, post rounding difference to explicit finance account. Non-cash tenders use exact grand total. |
| Output                    | Accounting total, cash payable, rounding delta and ledger effect.                                                                                                                                            |
| Permissions               | System policy; no cashier arbitrary rounding.                                                                                                                                                                |
| Audit event               | cash_rounding.applied.                                                                                                                                                                                       |
| Offline behavior          | Hub calculates offline from signed policy.                                                                                                                                                                   |
| Error behavior            | Absent policy means no cash rounding. Unsupported increment rejects.                                                                                                                                         |
| Compensating action       | Reverse rounding entry with payment reversal/refund.                                                                                                                                                         |
| Canonical test vectors    | TV1: policy nearest 100 KHR, total 10,049 → cash 10,000, delta -49. TV2: KHQR pays exact 10,049.                                                                                                             |
| Owning service            | Money and Cash Service                                                                                                                                                                                       |
| Consuming products        | T1/T2/T4, Finance, receipts                                                                                                                                                                                  |

### KBR-PRC-008 — Price/configuration change effect

| Required field            | Canonical specification                                                                                                                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-PRC-008                                                                                                                                                                                                 |
| Purpose                   | Ensure new price, discount or tax versions affect only eligible future confirmations.                                                                                                                       |
| Inputs                    | Published configuration version; effective time; open drafts; finalized transactions; Hub acknowledgements.                                                                                                 |
| Preconditions             | Publication validated and approved; compatibility and activation policy satisfied.                                                                                                                          |
| Calculation or transition | Activate version for new resolutions at effective time/acknowledged targets. Existing finalized documents keep snapshots. Open drafts are revalidated and require reconfirmation if material values change. |
| Output                    | Active version, impacted-draft flags and acknowledgements.                                                                                                                                                  |
| Permissions               | Authorized pricing/config publisher; approval per policy.                                                                                                                                                   |
| Audit event               | pricing.version_activated; draft.reprice_required.                                                                                                                                                          |
| Offline behavior          | Hub activates only validated package and retains prior version for rollback.                                                                                                                                |
| Error behavior            | Partial acknowledgement is visible; unacknowledged Location stays on prior version and cannot be presented as updated.                                                                                      |
| Compensating action       | Rollback activates prior compatible version for future sales; it never rewrites transactions created under newer version.                                                                                   |
| Canonical test vectors    | TV1: price rises after Booking finalized → Booking unchanged. TV2: open draft repriced → customer reconfirmation required.                                                                                  |
| Owning service            | Configuration Publication and Pricing Services                                                                                                                                                              |
| Consuming products        | Partner/Chain/Admin portals, Hub, POS, Storefront, reports                                                                                                                                                  |

## 4. Canonical total formula

```text
line_base = verified_quantity × resolved_unit_price
net_line = line_base - allocated_line_discount - allocated_order_discount
taxable_base = governed tax basis derived from net_line and inclusivity policy
grand_total = SUM(net_line) + SUM(tax) + approved_charges + rounding_adjustment
```

No source document supplied an approved universal Cambodia tax rate or tax-inclusivity policy. Those values remain governed configuration and owner/legal decisions.

## Open required values

These values are intentionally not guessed. They must be resolved through the governed decision register before production activation.

| ID           | Required value                                                                              |
| ------------ | ------------------------------------------------------------------------------------------- |
| `PRC-OD-001` | Approved Cambodia tax/VAT classes, rates, inclusivity, exemptions and invoice requirements. |
| `PRC-OD-002` | Laundry billable-weight increment/minimum rules by service.                                 |
| `PRC-OD-003` | Manual discount/price override thresholds and approval policy.                              |
| `PRC-OD-004` | Cash rounding increment and accounting treatment by currency.                               |
| `PRC-OD-005` | USD/KHR mixed-tender and exchange-rate policy; no conversion is implied by this document.   |

## Verification and completion gate

- Every rule has schema, API/event, permission, audit, offline, error and compensating-action coverage.
- Canonical test vectors are represented in automated unit, contract, integration and Store-Hub reconnect tests.
- Cross-Tenant, cross-Digital-Store and cross-Location isolation tests pass.
- Duplicate delivery, stale configuration, partial sync and replay tests produce no duplicate business effect.
- Reconciliation proves subledgers and operational totals from authoritative entries.
- Documentation, migrations, seeds, monitoring, rollback, support and pilot evidence pass the applicable phase gate.
- No planning-only capability is labeled implemented.

## Version history

| Version | Date       | Change                                                      |
| ------- | ---------- | ----------------------------------------------------------- |
| v1.0.0  | 2026-07-26 | Initial canonical business-rule and state-machine contract. |
