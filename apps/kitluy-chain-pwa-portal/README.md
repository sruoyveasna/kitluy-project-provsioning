# kitluy-chain-pwa-portal

Chain PWA Portal.

**Status:** SCAFFOLDED — buildable branded shell with locale toggle (Khmer
first), structural signed-out/authenticated route separation, error boundary,
fail-closed data surfaces. **No business functionality is implemented.**

## Boundary

Multi-store governance for chain, brand, regional, franchise, finance and compliance users. Not a POS and not a second operational ledger (chain spec v3.0.0).

Source specification: kitluy-chain-portal-phase1-spec-v3.0.0.md (imported under `docs/source/imported/`).

## Rules

- Operational portal: fails closed when authoritative data contracts do not
  exist. No synthetic operational values.
- Consumes shared contracts and the shared design system; never imports
  another application's internals.
- Authorization is backend + RLS truth; UI hiding is never authorization.
