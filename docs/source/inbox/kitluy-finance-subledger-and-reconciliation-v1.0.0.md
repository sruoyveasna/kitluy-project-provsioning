# KitLuy Finance Subledger and Reconciliation Rules

**Filename:** `kitluy-finance-subledger-and-reconciliation-v1.0.0.md`

## 0. Document status and authority

- **Version:** v1.0.0
- **Date:** 2026-07-26
- **Owner:** HET / KitLuy Suite Project Owner
- **Status:** Canonical target contract; not implementation evidence
- **Primary phase:** Phase 1 — Laundry, with neutral rules designed for confirmed later reuse
- **Authority order:** current owner decisions and Project Instructions → applied migrations/verified code/tests/production evidence → this contract → current Rebuild and Business Bibles → approved handoffs → evidence-based analyses → competitor clone references → superseded planning.

> **Rebuild Test:** A qualified engineer must be able to implement and verify these rules from this document, the canonical schema, API/event contracts, migrations, permission matrix, test registry and deployment instructions without relying on undocumented knowledge.

## Purpose and scope

This document defines balanced postings, receivables/liabilities, source idempotency, reconciliation lifecycle, cash and provider settlement, period locking and export truth.

**Scope boundary:** Operational finance subledger, cash/provider reconciliation and accountant-ready exports. Statutory general ledger, tax filing and payroll are outside the initial boundary.

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

### KBR-FIN-001 — Operational subledger boundary

| Required field            | Canonical specification                                                                                                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-FIN-001                                                                                                                                                                         |
| Purpose                   | Maintain accountant-ready operational financial truth without claiming to be a statutory general ledger.                                                                            |
| Inputs                    | Finalized transactions; payments; refunds; fees; cash movements; inventory cost effects; liabilities.                                                                               |
| Preconditions             | Source documents authoritative and scoped; posting rules/version active.                                                                                                            |
| Calculation or transition | Post balanced operational entries by account/category and source document. Preserve source currency and references. Do not create statutory filings or replace accountant judgment. |
| Output                    | Subledger journal/entries, balances and exportable source trace.                                                                                                                    |
| Permissions               | Finance service posts; finance operators review/reconcile; policy changes privileged.                                                                                               |
| Audit event               | finance.entry_posted.                                                                                                                                                               |
| Offline behavior          | Hub may post approved local operational entries tied to local source events; cloud consolidates and reconciles.                                                                     |
| Error behavior            | Unbalanced or unmapped posting is rejected/quarantined; source transaction remains valid but finance completeness is flagged.                                                       |
| Compensating action       | Correct mapping and replay idempotently or post linked adjustment; never edit finalized source.                                                                                     |
| Canonical test vectors    | TV1: sale creates receivable/revenue entries balanced by amount. TV2: missing mapping → finance incomplete, not zero.                                                               |
| Owning service            | Finance Subledger Service                                                                                                                                                           |
| Consuming products        | POS/Hub, Partner Portal, Admin Finance, reports/exports                                                                                                                             |

### KBR-FIN-002 — Double-entry balance invariant

| Required field            | Canonical specification                                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-FIN-002                                                                                                    |
| Purpose                   | Ensure every posted operational journal balances within one currency.                                          |
| Inputs                    | Journal lines with debit/credit minor amounts and currency.                                                    |
| Preconditions             | At least two valid lines; accounts active; single-currency journal unless approved FX bridge.                  |
| Calculation or transition | Require sum(debits)=sum(credits) for each currency and journal. Zero-value or floating-point lines prohibited. |
| Output                    | POSTED journal or validation rejection.                                                                        |
| Permissions               | System posting rules; manual journal adjustments restricted and approved.                                      |
| Audit event               | finance.journal_posted/rejected.                                                                               |
| Offline behavior          | Hub enforces invariant before local commit.                                                                    |
| Error behavior            | Any imbalance fails atomically; never auto-plug to suspense without explicit governed rule.                    |
| Compensating action       | Create corrected journal or mapped suspense entry with reason/approval, linked to failed attempt.              |
| Canonical test vectors    | TV1: debit cash 10,000; credit revenue 10,000 → post. TV2: credit 9,999 → reject.                              |
| Owning service            | Finance Subledger Service                                                                                      |
| Consuming products        | Finance, payments, transactions, inventory costing, reports                                                    |

### KBR-FIN-003 — Receivable and liability derivation

| Required field            | Canonical specification                                                                                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-FIN-003                                                                                                                                                                              |
| Purpose                   | Track what customers owe and what KitLuy/Partner owes without mutable totals.                                                                                                            |
| Inputs                    | Transaction obligations; payments; deposits; refunds; stored liabilities; adjustments.                                                                                                   |
| Preconditions             | Entries posted and allocation links valid.                                                                                                                                               |
| Calculation or transition | Derive receivable/liability balances from subledger entries and allocations at cutoff. Deposits remain customer liabilities or applied payments according to approved accounting policy. |
| Output                    | Truth-labeled balances and ageing/status projections.                                                                                                                                    |
| Permissions               | Finance reads; operational staff see scoped outstanding amount only.                                                                                                                     |
| Audit event               | finance.balance_projected.                                                                                                                                                               |
| Offline behavior          | Hub derives local outstanding for pickup decisions. Cloud ageing is freshness-labeled.                                                                                                   |
| Error behavior            | Unallocated payment or negative unexplained balance creates exception.                                                                                                                   |
| Compensating action       | Allocate/reclassify with linked entries; refund/collect as governed.                                                                                                                     |
| Canonical test vectors    | TV1: invoice 30,000, deposit 10,000 → receivable 20,000. TV2: unapplied 5,000 → exception/unapplied balance.                                                                             |
| Owning service            | Finance Subledger and Allocation Service                                                                                                                                                 |
| Consuming products        | T1/T4, Partner Portal/App, reports, customer statements                                                                                                                                  |

### KBR-FIN-004 — Source-to-subledger idempotency

| Required field            | Canonical specification                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-FIN-004                                                                                                                                       |
| Purpose                   | Guarantee one financial posting per authoritative source effect.                                                                                  |
| Inputs                    | Source event/document ID; posting rule/version; idempotency key; source hash.                                                                     |
| Preconditions             | Source finalized; event trusted; posting rule compatible.                                                                                         |
| Calculation or transition | Atomically record source-posting identity and journal. Replay returns existing journal; changed source hash conflicts and triggers investigation. |
| Output                    | Stable journal reference and posting status.                                                                                                      |
| Permissions               | Finance service only; operator may retry but not alter source identity.                                                                           |
| Audit event               | finance.source_posted/replayed/conflict.                                                                                                          |
| Offline behavior          | Hub and cloud maintain distinct authority/source IDs and synchronize without duplicate posting.                                                   |
| Error behavior            | Ambiguous status resolved by source lookup; no new key.                                                                                           |
| Compensating action       | Reverse duplicate defect through linked journal and incident; repair idempotency registry.                                                        |
| Canonical test vectors    | TV1: payment event delivered 3 times → one journal. TV2: same source ID changed amount → conflict.                                                |
| Owning service            | Finance Posting Service                                                                                                                           |
| Consuming products        | Event workers, Hub sync, payments, transactions, inventory                                                                                        |

### KBR-FIN-005 — Reconciliation run lifecycle

| Required field            | Canonical specification                                                                                                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-FIN-005                                                                                                                                                                                   |
| Purpose                   | Make reconciliation completion explicit, reviewable and reopenable.                                                                                                                           |
| Inputs                    | Scope; period/business date; source sets; cutoff; preparer/reviewer; completeness criteria.                                                                                                   |
| Preconditions             | Period defined; required sources identified; prior run state permits action.                                                                                                                  |
| Calculation or transition | Transition NOT_STARTED→PREPARING→EXCEPTIONS_FOUND or READY_FOR_REVIEW→COMPLETED. Reopen only with reason. Completion requires configured source completeness and approved exception handling. |
| Output                    | Run status, matched totals, exceptions, reviewer evidence and reconciliation snapshot.                                                                                                        |
| Permissions               | Finance preparer/reviewer; completion/reopen separated where required.                                                                                                                        |
| Audit event               | reconciliation.started/exceptions_found/completed/reopened.                                                                                                                                   |
| Offline behavior          | Local shift reconciliation may run on Hub; provider/bank/cloud reconciliation requires online sources. Cloud cannot label Hub period complete before required sync.                           |
| Error behavior            | Missing source, stale sync or unresolved blocking exception prevents completion.                                                                                                              |
| Compensating action       | Import missing source, correct mapping, post adjustment and rerun/reopen.                                                                                                                     |
| Canonical test vectors    | TV1: all sources match → completed. TV2: Hub unsynced → blocked/partial. TV3: completed run changed → reopen with reason.                                                                     |
| Owning service            | Finance Reconciliation Service                                                                                                                                                                |
| Consuming products        | Partner Portal, Admin Finance, shift close, reports/exports                                                                                                                                   |

### KBR-FIN-006 — Cash drawer reconciliation

| Required field            | Canonical specification                                                                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-FIN-006                                                                                                                                                            |
| Purpose                   | Compare expected cash from ledger to physical count without overwriting either.                                                                                        |
| Inputs                    | Opening float; cash payments/refunds; paid-in/out; drops; expected cash; physical count; count policy.                                                                 |
| Preconditions             | Register/shift closing; all local cash movements posted; authorized counter.                                                                                           |
| Calculation or transition | Expected = opening + cash receipts - cash refunds + paid-ins - paid-outs - drops. Variance = counted - expected. Preserve blind count and reveal policy as configured. |
| Output                    | Cash reconciliation, variance, approval task and close eligibility.                                                                                                    |
| Permissions               | Cashier counts; manager approves variance above threshold.                                                                                                             |
| Audit event               | cash_reconciliation.counted/variance_approved.                                                                                                                         |
| Offline behavior          | Runs Hub-local offline. Cloud receives completed close package later.                                                                                                  |
| Error behavior            | Missing movements or unapproved variance blocks close or creates governed provisional close if policy allows.                                                          |
| Compensating action       | Post missing movement/correction with reason and reopen close; never change physical-count evidence.                                                                   |
| Canonical test vectors    | TV1: opening 100, receipts 500, refunds 50, drop 200 → expected 350. Count 345 → variance -5.                                                                          |
| Owning service            | Cash and Finance Reconciliation Service                                                                                                                                |
| Consuming products        | POS, Partner Portal, Admin oversight, reports                                                                                                                          |

### KBR-FIN-007 — Provider settlement reconciliation

| Required field            | Canonical specification                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rule ID                   | KBR-FIN-007                                                                                                                                                  |
| Purpose                   | Reconcile gross customer payment truth to acquirer/bank net settlement.                                                                                      |
| Inputs                    | Provider payments/refunds/disputes; settlement batch; fees; bank receipt; cutoff.                                                                            |
| Preconditions             | Verified provider source and import checksum; payment IDs available.                                                                                         |
| Calculation or transition | Match records, calculate expected net, link fees and bank settlement, classify differences. Customer payment remains complete even if settlement is pending. |
| Output                    | Settlement reconciliation and exception categories.                                                                                                          |
| Permissions               | Finance operator/reviewer.                                                                                                                                   |
| Audit event               | settlement.reconciled/exception_created.                                                                                                                     |
| Offline behavior          | Cloud-only; Hub exposes payment events but not settlement completion.                                                                                        |
| Error behavior            | Incomplete batch remains pending; never infer settlement from customer payment success.                                                                      |
| Compensating action       | Correct provider mapping/import, post fee/adjustment, pursue provider and reopen run.                                                                        |
| Canonical test vectors    | TV1: gross 100, refunds 10, fees 3, bank 87 → match. TV2: bank 86 → exception 1.                                                                             |
| Owning service            | Finance Reconciliation Service                                                                                                                               |
| Consuming products        | Admin/Partner Finance, providers, reports                                                                                                                    |

### KBR-FIN-008 — Period lock and correction

| Required field            | Canonical specification                                                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-FIN-008                                                                                                                                          |
| Purpose                   | Protect reviewed periods while allowing governed later corrections.                                                                                  |
| Inputs                    | Business date/period; reconciliation status; correction source; actor/approval.                                                                      |
| Preconditions             | Period completed/locked; correction is necessary and documented.                                                                                     |
| Calculation or transition | Do not edit locked entries. Post correction in current/open adjustment period with original-period reference, or reopen under policy and full audit. |
| Output                    | Correction journal and restated operational report metadata.                                                                                         |
| Permissions               | Finance reviewer/authorized approver.                                                                                                                |
| Audit event               | finance.period_locked/reopened/correction_posted.                                                                                                    |
| Offline behavior          | Hub respects locally closed business dates; late sync is classified and reconciled, not silently inserted into closed totals without trace.          |
| Error behavior            | Unauthorized backdate rejected. Late events create exception queue.                                                                                  |
| Compensating action       | Reopen with approval or post current-period prior-period adjustment.                                                                                 |
| Canonical test vectors    | TV1: late payment for closed date → late-event exception + linked posting.                                                                           |
| Owning service            | Finance Governance Service                                                                                                                           |
| Consuming products        | Finance, shift close, reports, exports, audit                                                                                                        |

### KBR-FIN-009 — Accountant-ready export and report truth

| Required field            | Canonical specification                                                                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rule ID                   | KBR-FIN-009                                                                                                                                                                                                                          |
| Purpose                   | Provide complete traceable data without commercially paywalling essential reporting/export.                                                                                                                                          |
| Inputs                    | Scope/period; journals; sources; reconciliation; freshness; masking and locale settings.                                                                                                                                             |
| Preconditions             | Actor authorized; requested data retained; export job configured.                                                                                                                                                                    |
| Calculation or transition | Generate immutable/checksummed export with source IDs, currency, dates, reconciliation status and truth envelope. Essential Partner-owned reporting/history/export remains accessible subject to security/privacy/fair-use controls. |
| Output                    | Download artifact, manifest/checksum, audit record and expiry.                                                                                                                                                                       |
| Permissions               | Finance/report export permission; sensitive fields masked by role.                                                                                                                                                                   |
| Audit event               | finance.export_generated/downloaded.                                                                                                                                                                                                 |
| Offline behavior          | Cloud export requires synchronized data. Hub may produce local operational close package; it is labeled local/unconsolidated until cloud reconciliation.                                                                             |
| Error behavior            | Incomplete data produces explicit partial export only when requested/allowed; never silently omit.                                                                                                                                   |
| Compensating action       | Regenerate after sync/correction; preserve prior export manifest for audit.                                                                                                                                                          |
| Canonical test vectors    | TV1: export reconciled month → complete. TV2: missing Location sync → partial warning and manifest.                                                                                                                                  |
| Owning service            | Finance Reporting and File Services                                                                                                                                                                                                  |
| Consuming products        | Partner/Chain/Admin portals, accountants, support with consent                                                                                                                                                                       |

## 4. Operational subledger model

KitLuy owns authoritative operational finance records, liabilities, reconciliation and accountant-ready exports/connectors. It does **not** initially claim to be a full statutory ERP, tax filing system, payroll system or replacement for licensed accounting judgment.

Every report total must be reproducible from source documents and balanced subledger entries. Materialized report tables are rebuildable projections.

## Open required values

These values are intentionally not guessed. They must be resolved through the governed decision register before production activation.

| ID           | Required value                                                           |
| ------------ | ------------------------------------------------------------------------ |
| `FIN-OD-001` | Canonical chart-of-accounts/reference categories for Phase 1.            |
| `FIN-OD-002` | Reconciliation completeness criteria during delayed Hub synchronization. |
| `FIN-OD-003` | Cash variance thresholds, blind-count and provisional-close policy.      |
| `FIN-OD-004` | Operational period lock/reopen approval matrix and retention.            |
| `FIN-OD-005` | Approved accounting treatment of deposits by jurisdiction/contract.      |

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
