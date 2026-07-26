# Kubernetes (DISABLED at Phase 1 — Kubernetes-READY, not Kubernetes-run)

OWNER-LOCKED: "Build KitLuy Kubernetes-ready from day one, but do not operate
Kubernetes from day one" (KLV4-DEC-008). Every service already satisfies the
readiness standard (infra spec §9.1): container image, /health/live +
/health/ready, graceful shutdown, env-var config, stateless.

Helm/manifest skeletons are added here — kept disabled — when the first DOKS
trigger review starts (§9.3 triggers; §18.6 economic gate). Nothing in this
directory may be applied to a cluster during Phase 1.
