# Owner source-of-truth corpus ingestion — AI Handoff

| Field           | Value                                            |
| --------------- | ------------------------------------------------ |
| Task ID         | KL-DOCS-001                                      |
| Task title      | Ingest owner-supplied source-of-truth corpus     |
| Date / timezone | 2026-07-26 · Asia/Phnom_Penh                     |
| Repository root | /Users/vongvichetpa/Documents/HET-KITLUY-PROJECT |
| Agent           | Claude Code (Claude Fable 5)                     |

## Physical files discovered

**102 source files** in `docs/source/inbox/` (5.2 MB; system artifacts
`.DS_Store`/`.gitkeep` recorded as excluded). Full inventory with SHA-256,
sizes, types and declared metadata:
`docs/source/manifests/kitluy-inbox-inventory-v1.0.0.{csv,json,md}`.

**`Pasted text.txt` was NOT physically present.** The special authority
instruction for it (classify as OWNER-INSTRUCTION, rename to
kitluy-ai-build-readiness-document-program-v1.0.0.md) could not be executed;
recorded as MISSING in the coverage matrix, as KLREQ-007 in the open-decisions
addendum, and in the source manifest's `missing_expected_inputs`.

## Sources classified

All 102 sources classified with stable IDs KLSRC-0001..0102 into 8 taxonomy
directories: canonical/ (10), api-contracts/ (15), data-contracts/ (11),
business-rules/ (12), security/ (13), offline/ (11), shared-services/ (9),
ui-ux/ (21). Zero UNCLASSIFIED. Every classified copy is hash-verified against
its immutable inbox original (`pnpm docs:classify:check`). Manifest:
`docs/source/manifests/kitluy-source-document-manifest-v1.0.0.{csv,json,md}`.

## Exact duplicates / naming collisions

- Exact duplicate hashes inside the inbox: **0**.
- Cross-location same-name/same-version collisions: the two bibles exist in
  both `imported/` and the inbox with different hashes — **verified
  content-identical** (formatting-only); imported copies registered as
  DUPLICATE-FORMATTING-VARIANT (`kitluy-imported-copy-status-v1.0.0.json`).
- Pack-flattening damage: 61 declared-vs-physical size/hash discrepancies in
  the three in-corpus pack manifests; the security pack's declared README.md
  (890 B) was overwritten by the API pack index (707 B) — KLREC-2026-07-26-007.

## Current canonical / superseded / conflicted

- **Canonical:** the inbox copies (now `docs/source/canonical/` etc.) per the
  authority map (`docs/source/processed/reconciliation/kitluy-source-authority-map-v1.0.0.md`).
- **Superseded:** per the owner register (SUP-001..016) + machine-found rows
  addendum; bootstrap governance recreations superseded by owner originals.
- **Conflicted:** edge-operations-api vs storehub-lan-api (`/edge/v1` fork,
  KLREC-2026-07-26-001 — still OPEN inside the new corpus); plus
  needs-reconciliation items KLREC-2026-07-26-002/-005/-006/-009..013
  (custody naming drift, stale "bibles missing" claims, missing indexed
  decision-lock file, terminal-profile identifiers, error-code names,
  event-name format, scope taxonomy, permission-key delimiter). Full report:
  `kitluy-source-conflict-report-v1.0.0.md`. **No owner-locked invariant is
  contradicted by any ingested document.**

## Missing required artifacts (coverage matrix)

Owner documentation-program instruction (Pasted text.txt) ·
kitluy-suite-supabase-schema-v1.0.0.md · kitluy-suite-supabase-rls-and-authorization-v1.0.0.md ·
kitluy-suite-supabase-migration-plan-v1.0.0.md · SQL migrations ·
kitluy-master-feature-registry-v0.2.md/.json ·
kitluy-owner-decision-lock-12-capabilities-v1.0.md ·
kitluy-store-hub-managed-device-security-lock-and-build-spec-v1.0.0.md.
Matrix: `kitluy-required-document-coverage-matrix-v1.0.0.md` (88 PRESENT rows
filesystem-validated).

## Provisional files replaced (Phase E)

All eight: PROJECT_HOME.md + the seven docs/authority documents — replaced
with owner originals plus clearly marked repository addenda (bootstrap
versions preserved at commit `4a79f66`; per-file actions and preserved
content in `kitluy-provisional-governance-comparison-v1.0.0.md`). The 2.2 MB
open-decisions register is kept as one immutable copy with a working pointer
(KLBOOT-DEC-008). PROJECT_HOME owner-text link paths mechanically repaired
with an explicit note; no wording changed.

## Implementation statuses changed

- Canonical model adopted: PROPOSED → OWNER-LOCKED → SPECIFIED →
  CONTRACT-APPROVED → SCAFFOLDED → IMPLEMENTED-IN-DEV → INTEGRATION-VERIFIED →
  PILOT-READY → PILOT-PROVEN → PRODUCTION → DEPRECATED.
- Bootstrap BUILT/TESTED rows re-registered as **SCAFFOLDED with E-REPO/E-TEST
  evidence** (KLREC-2026-07-26-008) — 21 evidence rows, machine-validated by
  `pnpm docs:registry-check`. **No feature was advanced.**
- Documentation statuses raised to SPECIFIED (no evidence needed at that
  level) for the ingested packs; Laundry state machines moved
  REQUIRED VALUE → SPECIFIED (KLREQ-003 satisfied). Supabase pack recorded
  SPECIFIED-PARTIAL.

## Commands executed (actual results)

- `pnpm docs:verify` — **PASS (all 8 gates)**: inventory regeneration clean,
  hashes (102), duplicates/canonical collisions, classification + original
  links, authority-index completeness, coverage matrix vs filesystem
  (88 rows), status-register evidence (21 rows), internal links (159 files).
- `pnpm verify` — **PASS (all 11 gates)** after ingestion (format, lint,
  typecheck, unit/contract/offline tests, build, OpenAPI, migrations, secret
  scan, links).
- New commands registered: docs:inventory, docs:hash, docs:duplicates,
  docs:classify, docs:classify:check, docs:authority-check,
  docs:coverage-check, docs:registry-check, docs:links, docs:verify.

## Git commits (not pushed — no remote authorized)

1. `21076c5` docs(source): inventory owner-supplied inbox corpus
2. `758e6e5` docs(source): classify and register KitLuy sources
3. docs(authority): reconcile provisional governance documents
4. test(docs): add corpus authority and completeness validation
5. (this handoff) docs(handoff): record KL-DOCS-001 ingestion handoff

## Remaining decisions (owner)

1. Supply or point to the documentation-program instruction (KLREQ-007).
2. Supply the three missing Supabase pack members (KLREQ-001).
3. Reconcile the `/edge/v1` fork (KLREC-2026-07-26-001) and the
   contract/code drifts (-009..-013).
4. Approve the six proposals in the governance comparison (index updates,
   open-value rescan, evidence-baseline correction, checksum re-issue).

## Is kitluy-suite-rebuild-bible-v4.0.0.md ready to author?

**It does not need authoring — it already exists and is canonical.**
The physical file (docs/source/canonical/kitluy-suite-rebuild-bible-v4.0.0.md,
v4.0.0 · 2026-07-26 · OWNER-DIRECTED CANONICAL MASTER AUTHORITY) was verified
content-identical to the bootstrap import; every owner decision ID
(KLV4-DEC-001..012, KLD-2026-07-24-001) is present. The owner control pack's
claim that it was missing is stale (KLREC-2026-07-26-005). The next authoring
priority is therefore the **missing Supabase trio** (schema, RLS,
migration plan — KLREQ-001): every present pack member ranks them above
itself, they gate CONTRACT-APPROVED for the data layer, and their required
sources (data dictionary, enum registry, state machines, business rules,
RLS-relevant security pack) are all now present — **ready to author** once
the owner confirms the `/edge/v1` and naming reconciliations that touch
table/route vocabulary.
