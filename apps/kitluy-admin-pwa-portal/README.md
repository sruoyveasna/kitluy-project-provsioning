# kitluy-admin-pwa-portal

Admin PWA Portal.

**Status:** SCAFFOLDED — buildable branded shell with locale toggle (Khmer
first), structural signed-out/authenticated route separation, error boundary,
fail-closed data surfaces. **No business functionality is implemented.**

## Boundary

HET-internal privileged control plane. Never exposed as a Partner, Chain, Store staff or customer application; never reachable through public Partner signup (RB v4 §8.1).

Source specification: kitluy-admin-pwa-portal-phase1-spec-v3.1.0.md (imported under `docs/source/imported/`).

## Rules

- Operational portal: fails closed when authoritative data contracts do not
  exist. No synthetic operational values.
- Consumes shared contracts and the shared design system; never imports
  another application's internals.
- Authorization is backend + RLS truth; UI hiding is never authorization.
