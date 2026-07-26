# ADR-0003 — Zero-dependency service kernels for scaffolds

Date: 2026-07-26 · Status: Accepted (engineering default)

## Decision

Service skeletons use `node:http` with a pure, unit-tested request router
(health/ready/version + canonical error envelope) instead of adopting an HTTP
framework now. Framework selection (Fastify/Hono/etc.) is deferred to the
first service that implements business routes, so the choice is made against
real requirements (schema validation, OpenAPI integration, mTLS for edge).

## Consequences

No fake business behavior hides in framework boilerplate; the kernel already
satisfies the Kubernetes-readiness standard (infra spec §9.1). The framework
decision must be recorded as ADR-000X when taken.
