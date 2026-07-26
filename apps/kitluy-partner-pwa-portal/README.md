# kitluy-partner-pwa-portal

Partner PWA Portal.

**Status:** SCAFFOLDED — buildable branded shell with locale toggle (Khmer
first), structural signed-out/authenticated route separation, error boundary,
fail-closed data surfaces. **No business functionality is implemented.**

## Boundary

Full web/PWA back office for a Partner operating one active Digital Store context: configuration, tables, finance, reports, staff, Integration Hub (partner-portal spec v2.0.0, Proposed).

Source specification: kitluy-partner-portal-phase1-spec-v2.0.0.md (imported under `docs/source/imported/`).

## Rules

- Operational portal: fails closed when authoritative data contracts do not
  exist. No synthetic operational values.
- Consumes shared contracts and the shared design system; never imports
  another application's internals.
- Authorization is backend + RLS truth; UI hiding is never authorization.
