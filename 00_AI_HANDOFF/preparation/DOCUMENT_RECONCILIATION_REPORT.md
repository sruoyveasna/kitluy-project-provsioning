# Document Reconciliation Report

**Filename:** `DOCUMENT_RECONCILIATION_REPORT.md`
**Version:** v1.0.0
**Date:** 2026-08-07
**Owner:** HET / KitLuy Suite Project Owner
**Status:** CURRENT — **contains unresolved items requiring owner decision**
**Authority:** REFERENCE (records conflicts; resolves none by fiat)
**Scope:** Conflicts surfaced by the workspace preparation mission
**Source documents:** Drive manifest, `docs/authority/` pack, `PROJECT_HOME.md`, repository inspection
**Supersedes:** none
**Superseded by:** none
**Implementation evidence status:** N/A

## 1. Principle

**No material conflict was silently resolved.** Where the precedence ladder in
`kitluy-authority-and-precedence-v1.0.0.md` settles a conflict, the outcome is
recorded. Where it does not, the item is marked **UNRESOLVED** and escalated —
not decided.

Raw evidence (`exported-drive-docs/kitluy/`, `docs/source/` classified copies)
was **never edited** to make a contradiction disappear.

## 2. Resolved by precedence

### KLDRV-RES-001 — Drive bibles vs repository bibles

|                |                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Conflict**   | Drive holds rebuild bible up to `v3.0.0` and business bible `v1.0.0`; the repository holds `v4.0.0` and `v2.0.0` |
| **Resolution** | **Repository wins.** Higher version, and `PROJECT_HOME.md` names v4.0.0/v2.0.0 as the intended master authority  |
| **Action**     | All Drive bible copies classified `SUPERSEDED` in the manifest                                                   |
| **Guard**      | Drive v3.0.0 and earlier must **never** restore the obsolete T1–T3 model or physical-Store-first onboarding      |
| **Status**     | RESOLVED                                                                                                         |

### KLDRV-RES-002 — `PROJECT_HOME.md` "bibles NOT PRESENT" claim

|                |                                                                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Conflict**   | `PROJECT_HOME.md` §2 states both master bibles are "NOT PRESENT in the supplied source bundle"                                     |
| **Reality**    | Both are physically present at `docs/source/canonical/`                                                                            |
| **Resolution** | Claim is **stale**. Already corrected in the PROJECT_HOME Repository Operations Addendum (**KLREC-2026-07-26-005**)                |
| **Action**     | No edit. Owner text is never silently rewritten; the addendum carries the correction. Re-stated in `LOCAL_DOCUMENTATION_MAP.md` §6 |
| **Status**     | RESOLVED — pre-existing resolution confirmed still accurate                                                                        |

### KLDRV-RES-003 — Governance directory name

|                |                                                                                                                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Conflict**   | Mission brief specifies `docs/00-governance/`; the repository uses `docs/authority/`                                                                                               |
| **Resolution** | **`docs/authority/` wins.** It already held all eight required documents and is referenced by `PROJECT_HOME.md`, `CLAUDE.md`, `AGENTS.md` and the `pnpm docs:authority-check` gate |
| **Rationale**  | Creating a parallel directory would produce **duplicate canonical documents** — explicitly prohibited by the mission itself                                                        |
| **Status**     | RESOLVED                                                                                                                                                                           |

## 3. UNRESOLVED — owner decision required

### KLDRV-CONF-001 — Order/Service/Service Item vs T1 Booking vocabulary

|                                       |                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sources**                           | `KLDRV-0001` (Drive, **OWNER-LOCKED**, 2026-07-18) vs `PROJECT_HOME.md` §3.6 + monorepo T1 contracts                                                                                                                                                                                                                                  |
| **Conflict**                          | `KLDRV-0001` mandates **Order → Service → Service Item** as canonical product terminology (`pos.orders`, `pos.order_items`, `laundry.garments`, `catalog.services`). The monorepo's owner-locked T1 model is built on **Laundry Booking** (`kitluy-t1-*-owner-decision-v1.0.0.md`, WS-12 migrations)                                  |
| **Why precedence does not settle it** | **Both are owner authority at the same level.** `KLDRV-0001` is scoped to the _legacy_ `kitluy-laundry-pos-desk-app`; the T1 Booking model is scoped to the _monorepo_. Whether `KLDRV-0001` is superseded by later monorepo decisions, or remains authoritative for the legacy repository only, is **not stated in either document** |
| **Risk if guessed**                   | Wrong vocabulary propagated into schema, API contracts and events — expensive to reverse after migrations                                                                                                                                                                                                                             |
| **Escalation**                        | Owner must state whether `KLDRV-0001` (a) applies only to the legacy repository, (b) is superseded by the monorepo T1 decisions, or (c) must be reconciled into a single vocabulary                                                                                                                                                   |
| **Status**                            | **UNRESOLVED — blocks any POS-desktop consolidation work**                                                                                                                                                                                                                                                                            |

### KLDRV-CONF-002 — "Seller Portal" prohibited terminology

|                   |                                                                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Source**        | `KLDRV-0025` — `kitluy-seller-portal-rebuild-bible-md-v1.0.0.md` (Drive, 2 copies)                                                            |
| **Conflict**      | Uses **"Seller Portal"**. Canonical name is **KitLuy Partner Portal** (workspace `CLAUDE.md`, glossary, `PROJECT_HOME.md`)                    |
| **Resolution**    | Terminology conflict is **settled** — "Partner" is canonical, and the document is classified `SUPERSEDED` with a naming alert in the manifest |
| **Residual risk** | The document remains retrievable on Drive. Any future ingestion must not reintroduce "Seller"                                                 |
| **Status**        | Terminology RESOLVED; **flagged permanently** as a prohibited-naming source                                                                   |

### KLDRV-CONF-003 — POS desktop repository overlap

|                  |                                                                                                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sources**      | `kitluy-laundry-pos-desk-app` and `kitluy-suite-pos-desk-app`                                                                                                         |
| **Conflict**     | Both are Electron POS desktop applications mapping to the same monorepo target `apps/kitluy-pos-desktop-app/`. Neither document nor registry states which is the base |
| **Complication** | Divergent toolchains — React 18.3.1/Vite 6/TS 5.6 vs React 19.2.6/Vite 8/TS 6.0; monorepo catalog pins React 18.3.1/Vite 6/TS 5.7                                     |
| **Escalation**   | Owner must name the base application before any consolidation                                                                                                         |
| **Status**       | **UNRESOLVED — blocks POS consolidation**                                                                                                                             |

### KLDRV-CONF-004 — Supabase migration lineage

|                |                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Sources**    | `kitluy-suite-supabase` (**21 migrations**) vs monorepo `supabase/` (**87 migrations**)                          |
| **Conflict**   | Two migration sets. Whether the 21 are ancestors, a parallel lineage, or superseded is **not recorded anywhere** |
| **Risk**       | Merging without analysis risks schema divergence or data loss                                                    |
| **Constraint** | **Never auto-apply production migrations** — OWNER-LOCKED `KL-INF-P1-037`                                        |
| **Escalation** | Requires per-environment applied-migration comparison and explicit owner approval                                |
| **Status**     | **UNRESOLVED — highest-risk migration item**                                                                     |

## 4. Pre-existing unresolved items (carried forward, not re-adjudicated)

From `PROJECT_HOME.md` and `kitluy-open-decisions-and-required-values-v1.0.0.md`:

| ID                            | Item                                                                                                                               | Status |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **KLREQ-001**                 | Supabase documentation pack incomplete — schema, RLS/authorization and migration-plan documents missing                            | Open   |
| **KLREC-2026-07-26-001**      | `/edge/v1` route fork between Store Hub LAN API and Edge Operations API — **Hub business routes blocked**                          | Open   |
| **KLREQ-007**                 | Owner documentation-program instruction (`Pasted text.txt`) never physically supplied                                              | Open   |
| **KLREC-2026-07-26-009..013** | Contract/code drifts: terminal-profile identifiers, error-code names, event-name format, scope taxonomy, permission-key delimiters | Open   |

This mission **did not attempt to resolve any of these** — they require owner
input, not analysis.

## 5. Supersession recorded

| Superseded                                                                                        | Superseded by                                                 | Class                          |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------ |
| Drive rebuild bibles v1.0.0, v1.0.1, v1.0.2, v2.0.0, v3.0.0                                       | `docs/source/canonical/kitluy-suite-rebuild-bible-v4.0.0.md`  | SUPERSEDED                     |
| Drive business bibles v1.0.0 (all copies)                                                         | `docs/source/canonical/kitluy-suite-business-bible-v2.0.0.md` | SUPERSEDED                     |
| Drive product rebuild bibles (admin v2.0.0, chain v2.0.0, partner-pwa v1.1.0, partner-app v1.1.0) | Monorepo product documentation                                | SUPERSEDED                     |
| `kitluy-seller-portal-rebuild-bible-md-v1.0.0.md`                                                 | Partner Portal documentation                                  | SUPERSEDED + prohibited naming |

Formal register: `docs/authority/kitluy-superseded-document-register-v1.0.0.md`.

## 6. What must happen next

1. **Owner decides KLDRV-CONF-001** — vocabulary. Blocks POS work.
2. **Owner decides KLDRV-CONF-003** — POS base application.
3. **Owner authorizes KLDRV-CONF-004 analysis** — migration lineage comparison.
4. Record all three in
   `docs/authority/kitluy-decision-and-reconciliation-register-v1.0.0.md`.
5. Continue KLREQ-001 / KLREQ-007 / KLREC-2026-07-26-001 as previously tracked.

**No agent may proceed past a conflict above by choosing a side.**

---

**See also:** `GOOGLE_DRIVE_INGESTION_REPORT.md`,
`docs/authority/LEGACY_REPOSITORY_TO_MONOREPO_MAP.md`.
