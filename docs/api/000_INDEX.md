# API governance documentation family

Four governed surfaces — never collapsed (RB v4 §10.1):

| Surface             | OpenAPI source                                                                                                   | Status                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Management API      | [../../services/kitluy-management-api/openapi.yaml](../../services/kitluy-management-api/openapi.yaml)           | SCAFFOLDED skeleton + contract tests                        |
| Commerce Store API  | [../../services/kitluy-commerce-store-api/openapi.yaml](../../services/kitluy-commerce-store-api/openapi.yaml)   | SCAFFOLDED (Phase 1: storefront subset only)                |
| Edge Operations API | [../../services/kitluy-edge-operations-api/openapi.yaml](../../services/kitluy-edge-operations-api/openapi.yaml) | SCAFFOLDED; business routes BLOCKED by KLREC-2026-07-26-001 |
| Connector API       | [../../services/kitluy-connector-api/openapi.yaml](../../services/kitluy-connector-api/openapi.yaml)             | SCAFFOLDED                                                  |

Shared registries: error codes → `@kitluy/api-errors` (BUILT + TESTED) ·
scope registry → `@kitluy/resource-scope` + docs/security ·
version/deprecation policy → per-file `x-kitluy-governance` (window REQUIRED) ·
contract-test registry → `pnpm test:contract` + `pnpm contracts:validate`.
