# docs/source

## Owner-supplied corpus (KL-DOCS-001, 2026-07-26)

- `inbox/` — original owner-supplied files, **immutable** (102 sources; never
  edit, never move).
- `manifests/` — inventory + complete source manifest (csv/json/md) with
  stable KLSRC-#### IDs, plus the imported-copy collision registry.
- Classified immutable copies by taxonomy:
  `canonical/ api-contracts/ data-contracts/ business-rules/ security/
offline/ shared-services/ ui-ux/` (populated) and
  `owner-instructions/ owner-decisions/ product-specs/ architecture/
infrastructure/ feature-registry/ approved-handoffs/ research/
competitor-rebuilds/ superseded/ unclassified/` (reserved, empty).
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
