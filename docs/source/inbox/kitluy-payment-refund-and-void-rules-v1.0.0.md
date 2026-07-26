# KitLuy Payment, Refund and Void Rules

**Filename:** `kitluy-payment-refund-and-void-rules-v1.0.0.md`

## 0. Document status and authority

- **Version:** v1.0.0
- **Date:** 2026-07-26
- **Owner:** HET / KitLuy Suite Project Owner
- **Status:** Canonical target contract; not implementation evidence
- **Primary phase:** Phase 1 — Laundry, with neutral rules designed for confirmed later reuse
- **Authority order:** current owner decisions and Project Instructions → applied migrations/verified code/tests/production evidence → this contract → current Rebuild and Business Bibles → approved handoffs → evidence-based analyses → competitor clone references → superseded planning.

> **Rebuild Test:** A qualified engineer must be able to implement and verify these rules from this document, the canonical schema, API/event contracts, migrations, permission matrix, test registry and deployment instructions without relying on undocumented knowledge.

## Purpose and scope

This contract defines payment intents, cash, provider confirmation, deposits, refunds, voids, surcharge guardrails, offline-card prohibition and settlement reconciliation.

**Scope boundary:** Provider-independent payment orchestration for cash, KHQR and future approved tenders. KitLuy is not the merchant of record or payment facilitator.

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

### KBR-PAY-001 — Payment intent creation

| Required field            | Canonical specification                                                                                                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-PAY-001                                                                                                                                                                               |
| Purpose                   | Create a payment attempt without declaring money received.                                                                                                                                |
| Inputs                    | Transaction ID; amount/currency; tender type; provider/location configuration; idempotency key.                                                                                           |
| Preconditions             | Transaction payable; amount positive and within outstanding balance unless approved overpayment policy; tender enabled.                                                                   |
| Calculation or transition | Create payment intent in INITIATED/PENDING with immutable requested amount and provider/tender context.                                                                                   |
| Output                    | Payment intent ID, status and collection instructions such as KHQR payload.                                                                                                               |
| Permissions               | T1/T4 or authorized commerce channel; manual tender permissions enforced.                                                                                                                 |
| Audit event               | payment.intent_created.                                                                                                                                                                   |
| Offline behavior          | Cash intent may be completed locally. KHQR/provider intent may be generated from cached approved configuration only if provider policy permits; success still requires verified evidence. |
| Error behavior            | No provider/configuration means explicit unavailable; do not mark paid from UI redirect or screenshot.                                                                                    |
| Compensating action       | Expire/cancel intent; no ledger receipt until completion.                                                                                                                                 |
| Canonical test vectors    | TV1: $5.00 intent stores 500 USD minor. TV2: retry same key → same intent.                                                                                                                |
| Owning service            | Payment Orchestration Service                                                                                                                                                             |
| Consuming products        | T1/T2/T4, Storefront, Commerce API, Partner Portal read views                                                                                                                             |

### KBR-PAY-002 — Cash payment completion

| Required field            | Canonical specification                                                                                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-PAY-002                                                                                                                                                           |
| Purpose                   | Record cash tender and change under an open register/shift.                                                                                                           |
| Inputs                    | Intent; tendered amount; due amount; currency; register/shift; cashier.                                                                                               |
| Preconditions             | Open shift/register; cashier authorized; cash tender enabled; currency accepted.                                                                                      |
| Calculation or transition | Validate tendered >= due unless exact-cash policy says otherwise. Post payment receipt and cash drawer movement atomically; calculate change in same currency policy. |
| Output                    | COMPLETED cash payment, drawer movement, receipt and updated outstanding balance.                                                                                     |
| Permissions               | Cashier; manager approval for exceptional over/under payment.                                                                                                         |
| Audit event               | payment.cash_completed; cash_drawer.movement_posted.                                                                                                                  |
| Offline behavior          | Fully Hub-local and offline-capable.                                                                                                                                  |
| Error behavior            | Insufficient tender, closed shift, unsupported currency or duplicate completion is rejected.                                                                          |
| Compensating action       | Void/refund through compensating payment and drawer movement; never edit cash receipt.                                                                                |
| Canonical test vectors    | TV1: due 20,000 KHR, tender 50,000 → change 30,000. TV2: duplicate completion → one receipt.                                                                          |
| Owning service            | Payment and Cash Services on Hub                                                                                                                                      |
| Consuming products        | T1/T4, T2, Finance, shift close, reports                                                                                                                              |

### KBR-PAY-003 — KHQR/provider-confirmed success

| Required field            | Canonical specification                                                                                                                                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-PAY-003                                                                                                                                                                                                                            |
| Purpose                   | Make verified provider/acquirer evidence the authority for remote payment success.                                                                                                                                                     |
| Inputs                    | Provider event/poll response; provider transaction ID; signature; amount/currency; merchant; intent.                                                                                                                                   |
| Preconditions             | Signature/transport verified; merchant/config match; event not processed; intent exists.                                                                                                                                               |
| Calculation or transition | Persist gateway event, deduplicate provider ID, match amount/currency/merchant and atomically transition intent to COMPLETED with payment/subledger posting. Browser return or customer screenshot is non-authoritative evidence only. |
| Output                    | Completed payment or mismatch/quarantine record.                                                                                                                                                                                       |
| Permissions               | Service credential; staff may request status but cannot force provider success.                                                                                                                                                        |
| Audit event               | gateway_event.received/verified/rejected; payment.completed.                                                                                                                                                                           |
| Offline behavior          | During WAN loss, payment stays PENDING unless an approved provider-offline verification method exists. Store operation may use another tender; later duplicate payment becomes overpayment exception.                                  |
| Error behavior            | Mismatch or invalid signature is quarantined and alert raised; transaction remains unpaid/pending.                                                                                                                                     |
| Compensating action       | Refund duplicate/overpayment after reconciliation; correct mapping and replay verified event idempotently.                                                                                                                             |
| Canonical test vectors    | TV1: valid KHQR webhook matches 10,000 KHR → complete. TV2: browser redirect only → still pending. TV3: duplicate webhook → one payment.                                                                                               |
| Owning service            | Payment Gateway Adapter and Payment Service                                                                                                                                                                                            |
| Consuming products        | T1/T2/T4, Storefront, Finance, Notification, reports                                                                                                                                                                                   |

### KBR-PAY-004 — Deposit and outstanding balance

| Required field            | Canonical specification                                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rule ID                   | KBR-PAY-004                                                                                                                                                                    |
| Purpose                   | Support partial payment without conflating deposit with full settlement.                                                                                                       |
| Inputs                    | Transaction total; completed payments; refunds; credits; deposit policy.                                                                                                       |
| Preconditions             | Transaction confirmed; tender valid; deposit amount allowed.                                                                                                                   |
| Calculation or transition | Outstanding = finalized total - completed payment allocations + posted refund/reversal effects, using same-currency ledger. State derives UNPAID/PARTIALLY_PAID/PAID/OVERPAID. |
| Output                    | Payment allocation, outstanding balance and derived payment state.                                                                                                             |
| Permissions               | Cashier or commerce channel; manual allocation correction restricted.                                                                                                          |
| Audit event               | payment.allocated; transaction.payment_state_changed.                                                                                                                          |
| Offline behavior          | Hub computes from local authoritative payment ledger. Cloud views show reconciliation/freshness.                                                                               |
| Error behavior            | Cross-currency allocation without approved FX policy is rejected. Negative unexplained balance becomes exception.                                                              |
| Compensating action       | Reallocate with linked correction; refund overpayment through governed rule.                                                                                                   |
| Canonical test vectors    | TV1: total 30,000 KHR, deposit 10,000 → outstanding 20,000/PARTIAL.                                                                                                            |
| Owning service            | Payment Allocation Service                                                                                                                                                     |
| Consuming products        | T1/T2/T4, Partner Portal/App, Storefront status, Finance                                                                                                                       |

### KBR-PAY-005 — Refund authorization and posting

| Required field            | Canonical specification                                                                                                                                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-PAY-005                                                                                                                                                                                                    |
| Purpose                   | Return money through a linked compensating payment, never by changing the original receipt.                                                                                                                    |
| Inputs                    | Original payment/allocations; refundable amount; reason/evidence; destination; actor; approval; provider status.                                                                                               |
| Preconditions             | Original completed and not fully refunded; amount within remaining refundable; policy/approval satisfied.                                                                                                      |
| Calculation or transition | Create refund request, preview financial/transaction impact, approve, execute tender/provider refund idempotently, then post refund ledger record. State is pending until execution evidence is authoritative. |
| Output                    | Refund record/status, updated net paid/outstanding and reconciliation linkage.                                                                                                                                 |
| Permissions               | Refund request/approve/execute permissions separated as policy requires.                                                                                                                                       |
| Audit event               | refund.requested/approved/executed/failed.                                                                                                                                                                     |
| Offline behavior          | Cash refund may be local under open shift policy. Provider refund queues until online. Offline card capture is not supported.                                                                                  |
| Error behavior            | Provider timeout remains UNKNOWN/PENDING and must be queried with same key; never retry with new identity.                                                                                                     |
| Compensating action       | If financial posting succeeded but provider failed, mark exception and reconcile; reverse erroneous refund only via new compensating charge/payment where lawful.                                              |
| Canonical test vectors    | TV1: refund 5,000 of 20,000 KHR → remaining refundable 15,000. TV2: refund 25,000 → reject.                                                                                                                    |
| Owning service            | Refund Service and Finance Subledger                                                                                                                                                                           |
| Consuming products        | Partner Portal, T1/T4, Admin oversight, providers, reports                                                                                                                                                     |

### KBR-PAY-006 — Payment void/reversal

| Required field            | Canonical specification                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Rule ID                   | KBR-PAY-006                                                                                                                                |
| Purpose                   | Reverse an unsettled or erroneous payment according to tender/provider lifecycle.                                                          |
| Inputs                    | Payment; settlement state; reason; actor; approval; provider command.                                                                      |
| Preconditions             | Payment eligible for void; not already reversed/refunded beyond allowed amount.                                                            |
| Calculation or transition | Prefer provider void before settlement. Record reversal as linked entry and update derived payment state only after authoritative outcome. |
| Output                    | VOIDED/REVERSED payment and ledger compensation, or pending exception.                                                                     |
| Permissions               | Manager/finance permission; cashier threshold policy may allow limited same-shift void.                                                    |
| Audit event               | payment.void_requested/completed/failed.                                                                                                   |
| Offline behavior          | Cash void posts opposite drawer movement locally. Provider void waits for connectivity.                                                    |
| Error behavior            | Unknown provider outcome blocks duplicate action and reconciliation completion.                                                            |
| Compensating action       | Query provider; if settled, convert to refund workflow rather than mutating void result.                                                   |
| Canonical test vectors    | TV1: same-shift cash error → reversal movement. TV2: settled KHQR/card void request → refund path.                                         |
| Owning service            | Payment Service                                                                                                                            |
| Consuming products        | POS, Partner Portal, Finance, reconciliation                                                                                               |

### KBR-PAY-007 — No card surcharge at Cambodia launch

| Required field            | Canonical specification                                                                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rule ID                   | KBR-PAY-007                                                                                                                                                                                            |
| Purpose                   | Prevent unauthorized card surcharge logic from entering initial launch.                                                                                                                                |
| Inputs                    | Tender; base amount; fee configuration; country/provider policy version.                                                                                                                               |
| Preconditions             | Cambodia launch policy active.                                                                                                                                                                         |
| Calculation or transition | For card tender, surcharge amount is always zero unless a future approved country/provider policy explicitly activates it. Processing cost may be recorded internally but not added to customer total. |
| Output                    | Customer total without card surcharge; policy audit.                                                                                                                                                   |
| Permissions               | Only platform governance can change policy after legal/provider approval.                                                                                                                              |
| Audit event               | payment_surcharge.policy_evaluated/changed.                                                                                                                                                            |
| Offline behavior          | Hub caches signed policy; absent/expired policy defaults to surcharge disabled.                                                                                                                        |
| Error behavior            | Any client-supplied surcharge is rejected and security alert raised.                                                                                                                                   |
| Compensating action       | Refund unauthorized surcharge and post finance correction if defect occurred.                                                                                                                          |
| Canonical test vectors    | TV1: base $10 card → customer due $10. TV2: payload adds $0.30 → reject.                                                                                                                               |
| Owning service            | Payment Policy Service                                                                                                                                                                                 |
| Consuming products        | POS, Storefront, Pricing, Finance, Admin                                                                                                                                                               |

### KBR-PAY-008 — No offline card capture

| Required field            | Canonical specification                                                                                                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-PAY-008                                                                                                                                                                                     |
| Purpose                   | Prohibit storing or accepting unverified offline card authorization in the current roadmap.                                                                                                     |
| Inputs                    | Tender type; network state; provider capability; card-present request.                                                                                                                          |
| Preconditions             | Policy active; no owner-approved risk/legal/provider exception.                                                                                                                                 |
| Calculation or transition | When provider verification unavailable, card payment cannot complete. Offer approved alternatives such as cash or KHQR only when they can be verified. Never store PAN or raw card credentials. |
| Output                    | Explicit unavailable result; no payment ledger effect.                                                                                                                                          |
| Permissions               | No role can override this launch guardrail.                                                                                                                                                     |
| Audit event               | payment.offline_card_blocked.                                                                                                                                                                   |
| Offline behavior          | Applies at Hub and clients.                                                                                                                                                                     |
| Error behavior            | Fail closed; do not create completed or pending-capture card payment.                                                                                                                           |
| Compensating action       | None. Customer selects another tender or retries online.                                                                                                                                        |
| Canonical test vectors    | TV1: WAN down, card selected → blocked. TV2: cached token without online auth → not completed.                                                                                                  |
| Owning service            | Payment Security Policy                                                                                                                                                                         |
| Consuming products        | POS, Storefront, Partner Portal, Admin and support                                                                                                                                              |

### KBR-PAY-009 — Settlement and fee reconciliation

| Required field            | Canonical specification                                                                                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-PAY-009                                                                                                                                                           |
| Purpose                   | Separate customer payment truth from provider settlement and processing fee truth.                                                                                    |
| Inputs                    | Completed provider payments; settlement batches; bank/acquirer reports; fees; refunds; disputes.                                                                      |
| Preconditions             | Provider data imported and source/checksum known; period scoped.                                                                                                      |
| Calculation or transition | Match provider transactions to payment IDs, aggregate gross/refunds/fees/net and compare with settlement. Create explicit unmatched/amount/date/duplicate exceptions. |
| Output                    | Reconciliation run, matched links, fee postings and exception queue.                                                                                                  |
| Permissions               | Finance operator; completion/reopen permission controlled.                                                                                                            |
| Audit event               | payment_reconciliation.started/completed/reopened; settlement.exception_created.                                                                                      |
| Offline behavior          | Provider settlement reconciliation is cloud/online. Hub shows payment truth but cannot claim provider settlement completion.                                          |
| Error behavior            | Incomplete provider data prevents completion or is explicitly completed-with-approved-exceptions under policy.                                                        |
| Compensating action       | Correct mappings, replay imports, post fee/correction entries and reopen run with reason.                                                                             |
| Canonical test vectors    | TV1: gross 100, refund 10, fee 2 → expected net 88. TV2: bank 87 → exception 1.                                                                                       |
| Owning service            | Finance Reconciliation Service                                                                                                                                        |
| Consuming products        | Partner Portal, Admin Finance, reports, exports                                                                                                                       |

## 4. Payment lifecycle

```text
INITIATED -> PENDING -> COMPLETED
     |          |          |
     +-> EXPIRED/FAILED     +-> PARTIALLY_REFUNDED -> REFUNDED
                            +-> VOIDED/REVERSED
                            +-> DISPUTED/RECONCILIATION_EXCEPTION
```

A user-interface success screen is not payment authority. Cash completion requires an open local cash context; remote payment completion requires verified provider evidence.

## Open required values

These values are intentionally not guessed. They must be resolved through the governed decision register before production activation.

| ID           | Required value                                                                             |
| ------------ | ------------------------------------------------------------------------------------------ |
| `PAY-OD-001` | Approved KHQR/acquirer contracts, signatures, settlement fields and sandbox/live controls. |
| `PAY-OD-002` | Refund/void approval thresholds by role, tender and transaction state.                     |
| `PAY-OD-003` | Cash overpayment, underpayment and change policy by currency.                              |
| `PAY-OD-004` | Future card/provider legal and PCI responsibility matrix.                                  |

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
