# Security documentation family

| Required document                           | Status                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| RBAC permission registry                    | Seed keys BUILT+TESTED (`@kitluy/rbac`); full registry PLANNED           |
| Resource-scope model                        | BUILT (`@kitluy/resource-scope`, RB v4 §8.5)                             |
| Sensitive-action and four-eyes policy       | Classes A0–A4 BUILT+TESTED (`@kitluy/approvals`); TTL/quorum REQUIRED    |
| Audit-event registry                        | Envelope + Hub security events BUILT+TESTED (`@kitluy/audit`)            |
| Service-account and machine-identity policy | PLANNED (infra spec §16.9)                                               |
| Device-certificate and trust policy         | Interfaces SCAFFOLDED (hub-agent); CA/HSM REQUIRED                       |
| Support-access and consent policy           | SPECIFIED (BB v2 §9); doc PLANNED                                        |
| Secrets and key-management policy           | Baseline in SECURITY.md; provider policy REQUIRED                        |
| Phase 1 threat model                        | PLANNED — next security task; negative-test list seeded from RB v4 §16.2 |
| Phase 1 security test plan                  | PLANNED (tests/security/)                                                |
