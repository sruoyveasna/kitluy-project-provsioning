# KitLuy Authority and Precedence Standard

**Filename:** `kitluy-authority-and-precedence-v1.0.0.md`  
**Version:** v1.0.0  
**Date:** 2026-07-26  
**Owner:** HET / KitLuy Suite Project Owner  
**Status:** CANONICAL GOVERNANCE STANDARD

## 1. Core rule

Do not silently reconcile conflicts. Identify the conflict, classify the type of truth involved, preserve evidence, record a reconciliation entry and obtain the required approval.

## 2. Precedence order

Apply this order unless a narrower current owner decision explicitly says otherwise:

1. **Current project-owner decisions and active KitLuy Project Instructions.**
2. **Applied migrations, verified repository code/tests, signed release records, deployment evidence and production/pilot evidence** for the factual state of the named environment.
3. **Current approved KitLuy Suite Rebuild and Business Bibles.**
4. **Current approved product, vertical and infrastructure specifications** within their scope.
5. **This source-of-truth control pack** for navigation, terminology, evidence status and conflict process.
6. **Owner-reviewed master feature registry and approved implementation handoffs** for planning and traceability only.
7. **Evidence-based competitor analyses and classifications.**
8. **Competitor rebuild/clone documents as design references only.**
9. **Superseded planning and legacy documents.**

The control pack cannot promote a planning idea into product truth. It records and applies authority that exists elsewhere.

## 3. Two kinds of truth

### 3.1 Intended product truth

Defines what KitLuy should become: owner decisions, current instructions, master bibles and current specifications.

### 3.2 Implemented environment truth

Defines what currently exists in a named environment: applied migrations, verified code, tests, deployment records, telemetry and pilot/production evidence.

If these disagree, neither is silently discarded. Record a **target/actual divergence**. The deployed state remains factual; the owner-approved target remains directional. Remediation requires a migration, rollback, specification change or owner decision.

## 4. Conflict resolution rules

### 4.1 Scope beats generality

A current product-specific specification wins over a general older bible for that product, but only inside its declared scope.

### 4.2 Explicit supersession beats implied recency

A file is not superseded merely because another file has a later date. Supersession must be explicit in the source, this control pack or an owner decision.

### 4.3 Approved decision beats planning recommendation

`OWNER-LOCKED` always beats `APPROVED TARGET`, `PROPOSED`, competitor classification and clone design.

### 4.4 Verified evidence beats documentation for implementation claims

A specification may say a migration should exist. Only the applied migration and validation evidence prove it exists in an environment.

### 4.5 Safer rule governs until ambiguity is resolved

For finance, payment, permissions, privacy, compliance, device trust, migration, deletion and safety actions, use fail-closed behavior and authorized human confirmation.

### 4.6 No invented required values

An unresolved `[REQUIRED: ...]` value remains unresolved. An agent may propose options but cannot insert a production value without evidence or owner approval.

## 5. Binding conflict examples

| Conflict                                                                       | Winning authority                  | Required treatment                                           |
| ------------------------------------------------------------------------------ | ---------------------------------- | ------------------------------------------------------------ |
| Suite v3 describes T1/T2/T3; July owner lock and POS v4 describe T1-T4         | Owner lock / current Phase 1 spec  | Use T1-T4; record and remove active old mappings             |
| Older file starts with physical Store; current model starts with Digital Store | Current owner decision             | Use Digital Store first and optional Store Location          |
| Legacy file uses Seller                                                        | Current naming standard            | Use Partner; retain Seller only in migration/history context |
| Registry says capability is owner-locked                                       | Owner decision, not registry alone | Preserve direction but do not claim implementation           |
| Clone bible defines a table or API                                             | KitLuy schema/API authority        | Treat clone design as nonbinding hypothesis                  |
| UI hides an action but API permits it                                          | Backend authorization requirement  | UI is not security; enforce API and RLS                      |
| Browser redirect says payment succeeded but verified callback is absent        | Payment truth rule                 | Do not finalize payment success                              |
| Cloud portal is stale while Hub has newer local state                          | Freshness/source rule              | Label cloud data stale; never present it as live truth       |

## 6. Reconciliation workflow

1. Assign a reconciliation ID.
2. Identify the exact conflicting statements and source locations.
3. Classify the conflict: direction, terminology, schema, implementation, business, security, commercial or evidence.
4. Apply the precedence order.
5. Record the provisional safe behavior.
6. Identify every affected file, migration, API, test, UI and runbook.
7. Obtain owner or authorized technical approval.
8. Update the winner and explicitly mark the loser as superseded or retained.
9. Add implementation evidence when the change is built and verified.
10. Close the reconciliation entry only after documentation and implementation no longer diverge.

## 7. Authority limitations

- Product owners cannot override applied schema facts without an approved migration.
- Engineers cannot override owner-locked product direction by committing code.
- AI agents cannot auto-apply production migrations, approve sensitive actions, invent credentials or close evidence gaps.
- Competitor research cannot override KitLuy identity, vertical sequence, Store Hub authority, T1-T4 or Cambodia-first requirements.
- A database name retained for compatibility does not automatically become canonical business terminology.

## 8. Required citation style inside KitLuy documents

For each material claim, reference the exact filename, version and section or evidence identifier. For implementation claims, also include environment, commit/release, migration/test/deployment identifier and verification date.

Recommended form:

```text
Source: <filename> v<version> §<section>
Evidence: <environment> / <commit-or-release> / <migration-or-test-id> / <verified-date>
```

---

## Repository addendum — KL-DOCS-001 (not part of the owner original)

Owner original (immutable): `docs/source/canonical/kitluy-authority-and-precedence-v1.0.0.md`.
The bootstrap recreation of this file (git commit `4a79f66`) is replaced by the
owner original per the found-original-wins rule (KLBOOT-DEC-006). The
bootstrap-era status vocabulary is superseded by the owner implementation
status model in `kitluy-implementation-status-and-evidence-register-v1.0.0.md`.
Approved handoffs live in `00_AI_HANDOFF/`.
