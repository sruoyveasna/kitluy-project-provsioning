# KitLuy Source Document Manifest — v1.0.0

Complete manifest of the owner-supplied corpus (task KL-DOCS-001, ingested
2026-07-26T16:00:00+07:00). 102 sources. Source IDs are stable and never
reassigned. Originals: `docs/source/inbox/` (immutable). CSV/JSON forms of
this manifest are authoritative for tooling; this file is the human view.

**Missing expected input:** `Pasted text.txt` (the owner
documentation-program instruction) was NOT physically present at ingestion —
its special classification instruction could not be executed and is recorded
as an open item (see coverage matrix and reconciliation register).

## api-contracts/ (15)

| ID         | File                                                | Version | Authority class           | Role                                         | Status            |
| ---------- | --------------------------------------------------- | ------- | ------------------------- | -------------------------------------------- | ----------------- |
| KLSRC-0004 | README.md                                           |         | CANONICAL-SHARED-CONTRACT | PACK-INDEX (Governed API Specification Pack) | CANONICAL-CURRENT |
| KLSRC-0008 | kitluy-api-contract-test-registry-v1.0.0.md         | 1.0.0   | CANONICAL-SHARED-CONTRACT | API-GOVERNANCE-REGISTRY                      | CANONICAL-CURRENT |
| KLSRC-0009 | kitluy-api-error-code-registry-v1.0.0.md            | 1.0.0   | CANONICAL-SHARED-CONTRACT | API-GOVERNANCE-REGISTRY                      | CANONICAL-CURRENT |
| KLSRC-0010 | kitluy-api-scope-registry-v1.0.0.md                 | 1.0.0   | CANONICAL-SHARED-CONTRACT | API-GOVERNANCE-REGISTRY                      | CANONICAL-CURRENT |
| KLSRC-0011 | kitluy-api-version-and-deprecation-policy-v1.0.0.md | 1.0.0   | CANONICAL-SHARED-CONTRACT | API-GOVERNANCE-POLICY                        | CANONICAL-CURRENT |
| KLSRC-0019 | kitluy-commerce-store-api-v1.0.0.md                 | 1.0.0   | CANONICAL-SHARED-CONTRACT | GOVERNED-API-SPECIFICATION                   | CANONICAL-CURRENT |
| KLSRC-0023 | kitluy-connector-api-v1.0.0.md                      | 1.0.0   | CANONICAL-SHARED-CONTRACT | GOVERNED-API-SPECIFICATION                   | CANONICAL-CURRENT |
| KLSRC-0034 | kitluy-domain-event-registry-v1.0.0.md              | 1.0.0   | CANONICAL-SHARED-CONTRACT | DOMAIN-EVENT-REGISTRY                        | CANONICAL-CURRENT |
| KLSRC-0035 | kitluy-durable-job-registry-v1.0.0.md               | 1.0.0   | CANONICAL-SHARED-CONTRACT | DURABLE-JOB-REGISTRY                         | CANONICAL-CURRENT |
| KLSRC-0036 | kitluy-edge-operations-api-v1.0.0.md                | 1.0.0   | CANONICAL-SHARED-CONTRACT | GOVERNED-API-SPECIFICATION                   | CANONICAL-CURRENT |
| KLSRC-0038 | kitluy-event-schema-compatibility-policy-v1.0.0.md  | 1.0.0   | CANONICAL-SHARED-CONTRACT | EVENT-COMPATIBILITY-POLICY                   | CANONICAL-CURRENT |
| KLSRC-0050 | kitluy-management-api-v1.0.0.md                     | 1.0.0   | CANONICAL-SHARED-CONTRACT | GOVERNED-API-SPECIFICATION                   | CANONICAL-CURRENT |
| KLSRC-0055 | kitluy-outbox-and-event-delivery-pattern-v1.0.0.md  | 1.0.0   | CANONICAL-SHARED-CONTRACT | EVENT-DELIVERY-PATTERN                       | CANONICAL-CURRENT |
| KLSRC-0063 | kitluy-replay-and-reconciliation-runbook-v1.0.0.md  | 1.0.0   | CANONICAL-SHARED-CONTRACT | REPLAY-RECONCILIATION-RUNBOOK                | CANONICAL-CURRENT |
| KLSRC-0100 | kitluy-webhook-contract-registry-v1.0.0.md          | 1.0.0   | CANONICAL-SHARED-CONTRACT | WEBHOOK-CONTRACT-REGISTRY                    | CANONICAL-CURRENT |

## business-rules/ (12)

| ID         | File                                                     | Version | Authority class           | Role                                           | Status            |
| ---------- | -------------------------------------------------------- | ------- | ------------------------- | ---------------------------------------------- | ----------------- |
| KLSRC-0003 | README-kitluy-canonical-business-rules-v1.0.0.md         | 1.0.0   | CANONICAL-SHARED-CONTRACT | PACK-INDEX (Canonical Business Rules Pack)     | CANONICAL-CURRENT |
| KLSRC-0016 | kitluy-business-date-shift-and-close-rules-v1.0.0.md     | 1.0.0   | CANONICAL-SHARED-CONTRACT | CANONICAL-BUSINESS-RULES                       | CANONICAL-CURRENT |
| KLSRC-0017 | kitluy-canonical-business-rules-v1.0.0-manifest.json     | 1.0.0   | CANONICAL-SHARED-CONTRACT | PACK-CHECKSUMS (Canonical Business Rules Pack) | CANONICAL-CURRENT |
| KLSRC-0021 | kitluy-configuration-publication-and-rollback-v1.0.0.md  | 1.0.0   | CANONICAL-SHARED-CONTRACT | CANONICAL-BUSINESS-RULES                       | CANONICAL-CURRENT |
| KLSRC-0025 | kitluy-core-business-rules-v1.0.0.md                     | 1.0.0   | CANONICAL-SHARED-CONTRACT | CANONICAL-BUSINESS-RULES                       | CANONICAL-CURRENT |
| KLSRC-0026 | kitluy-customer-identity-consent-and-privacy-v1.0.0.md   | 1.0.0   | CANONICAL-SHARED-CONTRACT | CANONICAL-BUSINESS-RULES                       | CANONICAL-CURRENT |
| KLSRC-0040 | kitluy-finance-subledger-and-reconciliation-v1.0.0.md    | 1.0.0   | CANONICAL-SHARED-CONTRACT | CANONICAL-BUSINESS-RULES                       | CANONICAL-CURRENT |
| KLSRC-0045 | kitluy-inventory-movement-and-cost-rules-v1.0.0.md       | 1.0.0   | CANONICAL-SHARED-CONTRACT | CANONICAL-BUSINESS-RULES                       | CANONICAL-CURRENT |
| KLSRC-0048 | kitluy-laundry-state-machines-v1.0.0.md                  | 1.0.0   | CANONICAL-SHARED-CONTRACT | STATE-MACHINE-CONTRACT                         | CANONICAL-CURRENT |
| KLSRC-0058 | kitluy-payment-refund-and-void-rules-v1.0.0.md           | 1.0.0   | CANONICAL-SHARED-CONTRACT | CANONICAL-BUSINESS-RULES                       | CANONICAL-CURRENT |
| KLSRC-0061 | kitluy-pricing-discount-tax-and-rounding-rules-v1.0.0.md | 1.0.0   | CANONICAL-SHARED-CONTRACT | CANONICAL-BUSINESS-RULES                       | CANONICAL-CURRENT |
| KLSRC-0099 | kitluy-transaction-and-booking-lifecycle-v1.0.0.md       | 1.0.0   | CANONICAL-SHARED-CONTRACT | CANONICAL-BUSINESS-RULES                       | CANONICAL-CURRENT |

## canonical/ (10)

| ID         | File                                                         | Version | Authority class    | Role                         | Status            |
| ---------- | ------------------------------------------------------------ | ------- | ------------------ | ---------------------------- | ----------------- |
| KLSRC-0002 | PROJECT_HOME.md                                              |         | MASTER-AUTHORITY   | CANONICAL-ENTRY-POINT        | CANONICAL-CURRENT |
| KLSRC-0014 | kitluy-authority-and-precedence-v1.0.0.md                    | 1.0.0   | MASTER-AUTHORITY   | SOURCE-OF-TRUTH-CONTROL-PACK | CANONICAL-CURRENT |
| KLSRC-0028 | kitluy-decision-and-reconciliation-register-v1.0.0.md        | 1.0.0   | MASTER-AUTHORITY   | SOURCE-OF-TRUTH-CONTROL-PACK | CANONICAL-CURRENT |
| KLSRC-0041 | kitluy-glossary-and-naming-standard-v1.0.0.md                | 1.0.0   | MASTER-AUTHORITY   | SOURCE-OF-TRUTH-CONTROL-PACK | CANONICAL-CURRENT |
| KLSRC-0043 | kitluy-implementation-status-and-evidence-register-v1.0.0.md | 1.0.0   | MASTER-AUTHORITY   | SOURCE-OF-TRUTH-CONTROL-PACK | CANONICAL-CURRENT |
| KLSRC-0054 | kitluy-open-decisions-and-required-values-v1.0.0.md          | 1.0.0   | MASTER-AUTHORITY   | SOURCE-OF-TRUTH-CONTROL-PACK | CANONICAL-CURRENT |
| KLSRC-0073 | kitluy-source-of-truth-index-v1.0.0.md                       | 1.0.0   | MASTER-AUTHORITY   | SOURCE-OF-TRUTH-CONTROL-PACK | CANONICAL-CURRENT |
| KLSRC-0079 | kitluy-suite-business-bible-v2.0.0.md                        | 2.0.0   | BUSINESS-AUTHORITY | BUSINESS-BIBLE               | CANONICAL-CURRENT |
| KLSRC-0082 | kitluy-suite-rebuild-bible-v4.0.0.md                         | 4.0.0   | MASTER-AUTHORITY   | MASTER-REBUILD-BIBLE         | CANONICAL-CURRENT |
| KLSRC-0094 | kitluy-superseded-document-register-v1.0.0.md                | 1.0.0   | MASTER-AUTHORITY   | SOURCE-OF-TRUTH-CONTROL-PACK | CANONICAL-CURRENT |

## data-contracts/ (11)

| ID         | File                                                             | Version | Authority class           | Role                                          | Status            |
| ---------- | ---------------------------------------------------------------- | ------- | ------------------------- | --------------------------------------------- | ----------------- |
| KLSRC-0083 | kitluy-suite-supabase-backup-restore-and-pitr-v1.0.0.md          | 1.0.0   | CANONICAL-SHARED-CONTRACT | SUPABASE-IMPLEMENTATION-PACK-MEMBER           | CANONICAL-CURRENT |
| KLSRC-0084 | kitluy-suite-supabase-data-dictionary-v1.0.0.md                  | 1.0.0   | CANONICAL-SHARED-CONTRACT | SUPABASE-IMPLEMENTATION-PACK-MEMBER           | CANONICAL-CURRENT |
| KLSRC-0085 | kitluy-suite-supabase-edge-functions-contract-v1.0.0.md          | 1.0.0   | CANONICAL-SHARED-CONTRACT | SUPABASE-IMPLEMENTATION-PACK-MEMBER           | CANONICAL-CURRENT |
| KLSRC-0086 | kitluy-suite-supabase-enum-and-reference-data-registry-v1.0.0.md | 1.0.0   | CANONICAL-SHARED-CONTRACT | SUPABASE-IMPLEMENTATION-PACK-MEMBER           | CANONICAL-CURRENT |
| KLSRC-0087 | kitluy-suite-supabase-functions-rpc-and-triggers-v1.0.0.md       | 1.0.0   | CANONICAL-SHARED-CONTRACT | SUPABASE-IMPLEMENTATION-PACK-MEMBER           | CANONICAL-CURRENT |
| KLSRC-0088 | kitluy-suite-supabase-generated-types-policy-v1.0.0.md           | 1.0.0   | CANONICAL-SHARED-CONTRACT | SUPABASE-IMPLEMENTATION-PACK-MEMBER           | CANONICAL-CURRENT |
| KLSRC-0089 | kitluy-suite-supabase-implementation-pack-v1.0.0.sha256          | 1.0.0   | CANONICAL-SHARED-CONTRACT | PACK-CHECKSUMS (Supabase implementation pack) | CANONICAL-CURRENT |
| KLSRC-0090 | kitluy-suite-supabase-realtime-publication-plan-v1.0.0.md        | 1.0.0   | CANONICAL-SHARED-CONTRACT | SUPABASE-IMPLEMENTATION-PACK-MEMBER           | CANONICAL-CURRENT |
| KLSRC-0091 | kitluy-suite-supabase-seed-and-test-fixture-plan-v1.0.0.md       | 1.0.0   | CANONICAL-SHARED-CONTRACT | SUPABASE-IMPLEMENTATION-PACK-MEMBER           | CANONICAL-CURRENT |
| KLSRC-0092 | kitluy-suite-supabase-storage-metadata-contract-v1.0.0.md        | 1.0.0   | CANONICAL-SHARED-CONTRACT | SUPABASE-IMPLEMENTATION-PACK-MEMBER           | CANONICAL-CURRENT |
| KLSRC-0093 | kitluy-suite-supabase-validation-and-database-qa-v1.0.0.md       | 1.0.0   | CANONICAL-SHARED-CONTRACT | SUPABASE-IMPLEMENTATION-PACK-MEMBER           | CANONICAL-CURRENT |

## offline/ (11)

| ID         | File                                                       | Version | Authority class           | Role                          | Status            |
| ---------- | ---------------------------------------------------------- | ------- | ------------------------- | ----------------------------- | ----------------- |
| KLSRC-0022 | kitluy-configuration-snapshot-contract-v1.0.0.md           | 1.0.0   | CANONICAL-SHARED-CONTRACT | STORE-HUB-OFFLINE-PROTOCOL    | CANONICAL-CURRENT |
| KLSRC-0032 | kitluy-device-discovery-and-pairing-protocol-v1.0.0.md     | 1.0.0   | CANONICAL-SHARED-CONTRACT | STORE-HUB-OFFLINE-PROTOCOL    | CANONICAL-CURRENT |
| KLSRC-0037 | kitluy-edge-sync-protocol-v1.0.0.md                        | 1.0.0   | CANONICAL-SHARED-CONTRACT | STORE-HUB-OFFLINE-PROTOCOL    | CANONICAL-CURRENT |
| KLSRC-0042 | kitluy-hardware-compatibility-matrix-phase1-v1.0.0.md      | 1.0.0   | CANONICAL-SHARED-CONTRACT | HARDWARE-COMPATIBILITY-MATRIX | CANONICAL-CURRENT |
| KLSRC-0053 | kitluy-offline-idempotency-and-sequencing-v1.0.0.md        | 1.0.0   | CANONICAL-SHARED-CONTRACT | STORE-HUB-OFFLINE-PROTOCOL    | CANONICAL-CURRENT |
| KLSRC-0075 | kitluy-storehub-file-cache-and-transfer-protocol-v1.0.0.md | 1.0.0   | CANONICAL-SHARED-CONTRACT | STORE-HUB-OFFLINE-PROTOCOL    | CANONICAL-CURRENT |
| KLSRC-0076 | kitluy-storehub-lan-api-v1.0.0.md                          | 1.0.0   | CANONICAL-SHARED-CONTRACT | STORE-HUB-OFFLINE-PROTOCOL    | CANONICAL-CURRENT |
| KLSRC-0077 | kitluy-storehub-local-database-schema-v1.0.0.md            | 1.0.0   | CANONICAL-SHARED-CONTRACT | STORE-HUB-OFFLINE-PROTOCOL    | CANONICAL-CURRENT |
| KLSRC-0078 | kitluy-storehub-recovery-and-replacement-runbook-v1.0.0.md | 1.0.0   | CANONICAL-SHARED-CONTRACT | STORE-HUB-OFFLINE-PROTOCOL    | CANONICAL-CURRENT |
| KLSRC-0096 | kitluy-sync-conflict-resolution-policy-v1.0.0.md           | 1.0.0   | CANONICAL-SHARED-CONTRACT | STORE-HUB-OFFLINE-PROTOCOL    | CANONICAL-CURRENT |
| KLSRC-0097 | kitluy-terminal-profile-contract-t1-t4-v1.0.0.md           | 1.0.0   | CANONICAL-SHARED-CONTRACT | TERMINAL-PROFILE-CONTRACT     | CANONICAL-CURRENT |

## security/ (13)

| ID         | File                                                         | Version | Authority class           | Role                           | Status            |
| ---------- | ------------------------------------------------------------ | ------- | ------------------------- | ------------------------------ | ----------------- |
| KLSRC-0012 | kitluy-audit-event-registry-v1.0.0.csv                       | 1.0.0   | CANONICAL-SHARED-CONTRACT | AUDIT-EVENT-REGISTRY           | CANONICAL-CURRENT |
| KLSRC-0013 | kitluy-audit-event-registry-v1.0.0.md                        | 1.0.0   | CANONICAL-SHARED-CONTRACT | AUDIT-EVENT-REGISTRY           | CANONICAL-CURRENT |
| KLSRC-0031 | kitluy-device-certificate-and-trust-policy-v1.0.0.md         | 1.0.0   | CANONICAL-SHARED-CONTRACT | SECURITY-POLICY                | CANONICAL-CURRENT |
| KLSRC-0065 | kitluy-resource-scope-model-v1.0.0.md                        | 1.0.0   | CANONICAL-SHARED-CONTRACT | SECURITY-POLICY                | CANONICAL-CURRENT |
| KLSRC-0069 | kitluy-secrets-and-key-management-policy-v1.0.0.md           | 1.0.0   | CANONICAL-SHARED-CONTRACT | SECURITY-POLICY                | CANONICAL-CURRENT |
| KLSRC-0070 | kitluy-security-test-plan-phase1-v1.0.0.md                   | 1.0.0   | CANONICAL-SHARED-CONTRACT | SECURITY-ASSESSMENT            | CANONICAL-CURRENT |
| KLSRC-0071 | kitluy-sensitive-action-and-four-eyes-policy-v1.0.0.md       | 1.0.0   | CANONICAL-SHARED-CONTRACT | SECURITY-POLICY                | CANONICAL-CURRENT |
| KLSRC-0072 | kitluy-service-account-and-machine-identity-policy-v1.0.0.md | 1.0.0   | CANONICAL-SHARED-CONTRACT | SECURITY-POLICY                | CANONICAL-CURRENT |
| KLSRC-0080 | kitluy-suite-rbac-permission-registry-v1.0.0.csv             | 1.0.0   | CANONICAL-SHARED-CONTRACT | RBAC-PERMISSION-REGISTRY       | CANONICAL-CURRENT |
| KLSRC-0081 | kitluy-suite-rbac-permission-registry-v1.0.0.md              | 1.0.0   | CANONICAL-SHARED-CONTRACT | RBAC-PERMISSION-REGISTRY       | CANONICAL-CURRENT |
| KLSRC-0095 | kitluy-support-access-and-consent-policy-v1.0.0.md           | 1.0.0   | CANONICAL-SHARED-CONTRACT | SECURITY-POLICY                | CANONICAL-CURRENT |
| KLSRC-0098 | kitluy-threat-model-phase1-v1.0.0.md                         | 1.0.0   | CANONICAL-SHARED-CONTRACT | SECURITY-ASSESSMENT            | CANONICAL-CURRENT |
| KLSRC-0102 | manifest.json                                                |         | CANONICAL-SHARED-CONTRACT | PACK-CHECKSUMS (Security pack) | CANONICAL-CURRENT |

## shared-services/ (9)

| ID         | File                                                           | Version | Authority class               | Role                         | Status            |
| ---------- | -------------------------------------------------------------- | ------- | ----------------------------- | ---------------------------- | ----------------- |
| KLSRC-0007 | kitluy-ai-gateway-phase1-spec-v1.0.0.md                        | 1.0.0   | CURRENT-PRODUCT-SPECIFICATION | SHARED-SERVICE-SPECIFICATION | CANONICAL-CURRENT |
| KLSRC-0024 | kitluy-connector-runtime-phase1-spec-v1.0.0.md                 | 1.0.0   | CURRENT-PRODUCT-SPECIFICATION | SHARED-SERVICE-SPECIFICATION | CANONICAL-CURRENT |
| KLSRC-0033 | kitluy-device-release-and-update-service-phase1-spec-v1.0.0.md | 1.0.0   | CURRENT-PRODUCT-SPECIFICATION | SHARED-SERVICE-SPECIFICATION | CANONICAL-CURRENT |
| KLSRC-0039 | kitluy-file-service-phase1-spec-v1.0.0.md                      | 1.0.0   | CURRENT-PRODUCT-SPECIFICATION | SHARED-SERVICE-SPECIFICATION | CANONICAL-CURRENT |
| KLSRC-0044 | kitluy-integration-hub-phase1-spec-v1.0.0.md                   | 1.0.0   | CURRENT-PRODUCT-SPECIFICATION | SHARED-SERVICE-SPECIFICATION | CANONICAL-CURRENT |
| KLSRC-0051 | kitluy-mcp-server-phase1-spec-v1.0.0.md                        | 1.0.0   | CURRENT-PRODUCT-SPECIFICATION | SHARED-SERVICE-SPECIFICATION | CANONICAL-CURRENT |
| KLSRC-0052 | kitluy-notification-service-phase1-spec-v1.0.0.md              | 1.0.0   | CURRENT-PRODUCT-SPECIFICATION | SHARED-SERVICE-SPECIFICATION | CANONICAL-CURRENT |
| KLSRC-0062 | kitluy-rag-indexer-phase1-spec-v1.0.0.md                       | 1.0.0   | CURRENT-PRODUCT-SPECIFICATION | SHARED-SERVICE-SPECIFICATION | CANONICAL-CURRENT |
| KLSRC-0064 | kitluy-reporting-and-export-service-phase1-spec-v1.0.0.md      | 1.0.0   | CURRENT-PRODUCT-SPECIFICATION | SHARED-SERVICE-SPECIFICATION | CANONICAL-CURRENT |

## ui-ux/ (21)

| ID         | File                                                                           | Version | Authority class               | Role                                             | Status            |
| ---------- | ------------------------------------------------------------------------------ | ------- | ----------------------------- | ------------------------------------------------ | ----------------- |
| KLSRC-0001 | KITLUY-UI-UX-BUILD-PACK-INDEX-v1.0.0.md                                        | 1.0.0   | CANONICAL-SHARED-CONTRACT     | PACK-INDEX (UI/UX build pack)                    | CANONICAL-CURRENT |
| KLSRC-0005 | kitluy-accessibility-standard-v1.0.0.md                                        | 1.0.0   | CANONICAL-SHARED-CONTRACT     | UI-UX-STANDARD                                   | CANONICAL-CURRENT |
| KLSRC-0006 | kitluy-admin-pwa-portal-route-screen-inventory-v1.0.0.md                       | 1.0.0   | CURRENT-PRODUCT-SPECIFICATION | ROUTE-SCREEN-INVENTORY                           | CANONICAL-CURRENT |
| KLSRC-0015 | kitluy-b2b-website-route-screen-inventory-v1.0.0.md                            | 1.0.0   | CURRENT-PRODUCT-SPECIFICATION | ROUTE-SCREEN-INVENTORY                           | CANONICAL-CURRENT |
| KLSRC-0018 | kitluy-chain-pwa-portal-route-screen-inventory-v1.0.0.md                       | 1.0.0   | CURRENT-PRODUCT-SPECIFICATION | ROUTE-SCREEN-INVENTORY                           | CANONICAL-CURRENT |
| KLSRC-0020 | kitluy-component-inventory-v1.0.0.md                                           | 1.0.0   | CANONICAL-SHARED-CONTRACT     | UI-UX-STANDARD                                   | CANONICAL-CURRENT |
| KLSRC-0027 | kitluy-date-time-money-formatting-standard-v1.0.0.md                           | 1.0.0   | CANONICAL-SHARED-CONTRACT     | UI-UX-STANDARD                                   | CANONICAL-CURRENT |
| KLSRC-0029 | kitluy-design-system-v1.0.0.md                                                 | 1.0.0   | CANONICAL-SHARED-CONTRACT     | UI-UX-STANDARD                                   | CANONICAL-CURRENT |
| KLSRC-0030 | kitluy-design-token-registry-v1.0.0.json                                       | 1.0.0   | CANONICAL-SHARED-CONTRACT     | DESIGN-TOKEN-REGISTRY                            | CANONICAL-CURRENT |
| KLSRC-0046 | kitluy-khmer-english-content-style-guide-v1.0.0.md                             | 1.0.0   | CANONICAL-SHARED-CONTRACT     | UI-UX-STANDARD                                   | CANONICAL-CURRENT |
| KLSRC-0047 | kitluy-kiosk-self-checkout-client-route-screen-inventory-v1.0.0.md             | 1.0.0   | CURRENT-PRODUCT-SPECIFICATION | ROUTE-SCREEN-INVENTORY (future client — register | CANONICAL-CURRENT |
| KLSRC-0049 | kitluy-localization-key-registry-v1.0.0.md                                     | 1.0.0   | CANONICAL-SHARED-CONTRACT     | UI-UX-STANDARD                                   | CANONICAL-CURRENT |
| KLSRC-0056 | kitluy-partner-app-route-screen-inventory-v1.0.0.md                            | 1.0.0   | CURRENT-PRODUCT-SPECIFICATION | ROUTE-SCREEN-INVENTORY                           | CANONICAL-CURRENT |
| KLSRC-0057 | kitluy-partner-pwa-portal-route-screen-inventory-v1.0.0.md                     | 1.0.0   | CURRENT-PRODUCT-SPECIFICATION | ROUTE-SCREEN-INVENTORY                           | CANONICAL-CURRENT |
| KLSRC-0059 | kitluy-pos-desktop-app-route-screen-inventory-v1.0.0.md                        | 1.0.0   | CURRENT-PRODUCT-SPECIFICATION | ROUTE-SCREEN-INVENTORY                           | CANONICAL-CURRENT |
| KLSRC-0060 | kitluy-pos-mobile-app-route-screen-inventory-v1.0.0.md                         | 1.0.0   | CURRENT-PRODUCT-SPECIFICATION | ROUTE-SCREEN-INVENTORY                           | CANONICAL-CURRENT |
| KLSRC-0066 | kitluy-responsive-layout-standard-v1.0.0.md                                    | 1.0.0   | CANONICAL-SHARED-CONTRACT     | UI-UX-STANDARD                                   | CANONICAL-CURRENT |
| KLSRC-0067 | kitluy-restaurant-guest-display-order-and-pay-route-screen-inventory-v1.0.0.md | 1.0.0   | CURRENT-PRODUCT-SPECIFICATION | ROUTE-SCREEN-INVENTORY (future client — register | CANONICAL-CURRENT |
| KLSRC-0068 | kitluy-restaurant-kds-client-route-screen-inventory-v1.0.0.md                  | 1.0.0   | CURRENT-PRODUCT-SPECIFICATION | ROUTE-SCREEN-INVENTORY (future client — register | CANONICAL-CURRENT |
| KLSRC-0074 | kitluy-storefront-route-screen-inventory-v1.0.0.md                             | 1.0.0   | CURRENT-PRODUCT-SPECIFICATION | ROUTE-SCREEN-INVENTORY                           | CANONICAL-CURRENT |
| KLSRC-0101 | manifest copy.json                                                             |         | CANONICAL-SHARED-CONTRACT     | PACK-CHECKSUMS (UI/UX build pack)                | CANONICAL-CURRENT |

## Inbox lifecycle note (KLOI-2026-07-26-001)

After this ingestion the inbox originals were **deleted on owner instruction**
so the inbox works as a transient drop zone (new drops contain only new
files). Provenance is preserved three ways per source: the recorded SHA-256
above, git history (originals committed at `758e6e5`), and the hash-identical
classified copy — which is now the surviving original and stays immutable.
`original_path` values are historical inbox locations.
