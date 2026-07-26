# CI/CD and platform policy checks (infra spec §6.3)

Reject: public databases; mutable `latest` tags in production; missing health
checks; secrets in repo; cross-environment credential reuse; direct connector
DB credentials; auto-migrations on startup. Enforced progressively in
.github/workflows as services gain deployability.
