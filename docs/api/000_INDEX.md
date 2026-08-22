# API governance documentation family

Four governed surfaces — never collapsed (RB v4 §10.1):

| Surface             | OpenAPI source                                                                                                   | Status                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Management API      | [../../services/kitluy-management-api/openapi.yaml](../../services/kitluy-management-api/openapi.yaml)           | SCAFFOLDED skeleton + contract tests                        |
| Commerce Store API  | [../../services/kitluy-commerce-store-api/openapi.yaml](../../services/kitluy-commerce-store-api/openapi.yaml)   | SCAFFOLDED (Phase 1: storefront subset only)                |
| Edge Operations API | [../../services/kitluy-edge-operations-api/openapi.yaml](../../services/kitluy-edge-operations-api/openapi.yaml) | SCAFFOLDED; business routes BLOCKED by KLREC-2026-07-26-001 |
| Connector API       | [../../services/kitluy-connector-api/openapi.yaml](../../services/kitluy-connector-api/openapi.yaml)             | SCAFFOLDED                                                  |

## Edge Function contracts

Not API surfaces, and deliberately listed apart so the four above stay four
(RB v4 §10.1). `supabase/functions/README.md` requires a contract entry here
before any function is implemented.

| Function              | Contract                                                                           | Status                                                    |
| --------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `device-registration` | [device-registration-edge-function-v1.md](device-registration-edge-function-v1.md) | IMPLEMENTED-IN-DEV; probed locally, NOT deployed to cloud |

Shared registries: error codes → `@kitluy/api-errors` (BUILT + TESTED) ·
scope registry → `@kitluy/resource-scope` + docs/security ·
version/deprecation policy → per-file `x-kitluy-governance` (window REQUIRED) ·
contract-test registry → `pnpm test:contract` + `pnpm contracts:validate`.
