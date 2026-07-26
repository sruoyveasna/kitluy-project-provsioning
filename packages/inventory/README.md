# @kitluy/inventory

Inventory movement contracts: ledger-based, append-only, no last-write-wins quantity overwrite

**Status:** SCAFFOLDED — boundary only, no implemented business behavior.

## Boundary

- Shared package: may be consumed by apps, services and verticals.
- Must NOT import application or service code.
- Neutral Core: must NOT contain Laundry-specific (or any vertical-specific) terminology.

## Authority

Implementation must follow the canonical specifications indexed in
`docs/authority/kitluy-source-of-truth-index-v1.0.0.md`. Unknown values remain
`[REQUIRED: ...]` — do not guess.
