# KitLuy Source Authority Map — v1.0.0

Task KL-DOCS-001, 2026-07-26. Where every current source sits in the
precedence order (authoritative field values live in
`docs/source/manifests/kitluy-source-document-manifest-v1.0.0.*`).

## Precedence, applied to the physical corpus

**Level 1 — Explicit current owner instructions and versioned owner decisions**

- KL-DOCS-001 task instruction (this ingestion program; conveyed in-session —
  its referenced physical carrier `Pasted text.txt` was not present).
- Owner decisions: KLD-2026-07-20-001..KLD-API-001 (owner decision register),
  KLV4-DEC-001..012 + KLD-2026-07-24-001 (RB v4 Part 11).
- `kitluy-owner-decision-lock-12-capabilities-v1.0.md` — indexed but
  physically MISSING (KLREC-2026-07-26-006).

**Level 2 — Applied migrations, verified code/tests, production evidence**

- This repository's tested foundations (evidence register addendum; `pnpm
verify` 2026-07-26). No migrations or production evidence exist anywhere.

**Level 3 — Current master authority / source-of-truth documents**

- `docs/source/canonical/kitluy-suite-rebuild-bible-v4.0.0.md` (MASTER-AUTHORITY)
- `docs/source/canonical/kitluy-suite-business-bible-v2.0.0.md` (BUSINESS-AUTHORITY)
- Control pack (8 docs, MASTER-AUTHORITY) — working copies with reconciliation
  addenda at `docs/authority/` + repo root PROJECT_HOME.md.

**Level 4 — Current approved shared contracts and product specifications**

- `api-contracts/` (4 governed APIs + 4 registries + events family — 15 docs)
- `data-contracts/` (Supabase pack, 11 items — PARTIAL, 3 members missing)
- `business-rules/` (12 items incl. Laundry state machines)
- `security/` (13 items incl. RBAC registry 107 keys)
- `offline/` (11 items incl. Store Hub LAN API and local DB schema)
- `shared-services/` (9 Phase 1 service specs)
- `ui-ux/` (21 items incl. provisional design tokens)
- The ten Phase 1 product specs from bootstrap imports
  (`docs/source/imported/kitluy-*-phase1-spec-*.md`) remain current at this
  level per the owner SOT index.

**Level 5 — Master Feature Registry and approved handoffs**

- `docs/source/imported/kitluy-master-feature-registry-v0.2.csv` (441 rows;
  .md/.json forms missing).
- `00_AI_HANDOFF/` (KL-BOOTSTRAP-001, KL-DOCS-001).

**Level 6 — Evidence-based competitor research**

- `docs/source/imported/KITLUY.R&D_*.md` + docx family (not re-ingested).

**Level 7 — Competitor rebuild/clone designs** — Loyverse/Toast/Lightspeed/
WooCommerce/Shopify rebuild bibles (Downloads; design references only).

**Level 8 — Superseded planning** — per the superseded register (SUP-001..016
pattern rules + machine-found rows).

## Working-copy rule

`docs/authority/` files = owner original text + clearly marked
"Repository addendum — KL-DOCS-001" sections. The pristine originals live in
`docs/source/canonical/` (hash-locked by `pnpm docs:hash` +
`docs:classify:check`). Owner text is never silently edited; corrections ride
in addenda with KLREC references.
