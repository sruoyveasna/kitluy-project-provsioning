# docs/source

## Owner-supplied corpus (KL-DOCS-001, 2026-07-26)

- `inbox/` — **transient drop zone** (owner instruction KLOI-2026-07-26-001).
  Owner drops new source files here; after ingestion the originals are
  deleted so the next drop contains only new files. `pnpm docs:inbox-state`
  fails while un-ingested files are present. The 102 sources of the
  2026-07-26 batch live on as hash-identical classified copies (below) and in
  git history (commit `758e6e5`).

  **Ingestion workflow for a new batch:** (1) drop files into `inbox/`;
  (2) create a NEW versioned inventory + extend the source manifest (never
  overwrite the frozen v1.0.0 records — new stable KLSRC IDs continue the
  sequence); (3) classify copies into the taxonomy; (4) reconcile conflicts
  in the decision register; (5) update the coverage matrix; (6) delete the
  ingested originals from `inbox/`; (7) `pnpm docs:verify`.

- `manifests/` — inventory + complete source manifest (csv/json/md) with
  stable KLSRC-#### IDs, plus the imported-copy collision registry.
- Classified immutable copies by taxonomy:
  `canonical/ api-contracts/ data-contracts/ business-rules/ security/
offline/ shared-services/ ui-ux/` (batch 1, 102 sources) plus
  `engineering/ qa/` (taxonomy extension for batch 2 — KLBOOT-DEC-010),
  `infrastructure/` (batch-2 ops pack) and `owner-instructions/` (batch-2
  AI Swarm Operating System pack, subdirectory preserved) — 58 batch-2
  sources, KLSRC-0103..0160, batch inventory v1.1.0.
  Still reserved/empty: `owner-decisions/ product-specs/ architecture/
feature-registry/ approved-handoffs/ research/ competitor-rebuilds/
superseded/ unclassified/`.
- `processed/reconciliation/` — coverage matrix, authority map, conflict
  report, supersession map, governance comparison.
- `processed/summaries/` — generated summaries (never classified as sources).

## Bootstrap-era imports (KL-BOOTSTRAP-001)

- [manifest.md](manifest.md) — bootstrap machine inventory (historical).
- `imported/` — read-only copies imported from ~/Downloads at bootstrap.
  The two bible copies here are DUPLICATE-FORMATTING-VARIANTs of the
  canonical inbox copies (see `manifests/kitluy-imported-copy-status-v1.0.0.json`).

Validation: `pnpm docs:verify` (inventory/hash/duplicates/classification/
authority/coverage/registry/links).
