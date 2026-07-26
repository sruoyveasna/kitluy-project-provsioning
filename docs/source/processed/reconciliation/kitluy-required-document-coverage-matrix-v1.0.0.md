# KitLuy Required-Document Coverage Matrix — v1.0.0

Task KL-DOCS-001, 2026-07-26. The physical inbox corpus compared against the
owner-required documentation program. The program document itself
(`Pasted text.txt`) is **not physically present**; the required-family list
below comes from the KL-DOCS-001 owner instruction and RB v4 §13/Gate 1.
A document named inside any program text is not assumed to exist — every
PRESENT row below is validated against the filesystem by
`pnpm docs:coverage-check`.

Statuses: PRESENT-CURRENT · PRESENT-NEEDS-RECONCILIATION · PRESENT-SUPERSEDED
· PRESENT-PARTIAL · MISSING · DUPLICATE · CONFLICTED.

## Family 0 — Program authority

| Artifact                                                                                             | Family    | Status  | Path |
| ---------------------------------------------------------------------------------------------------- | --------- | ------- | ---- |
| Owner documentation program (Pasted text.txt → kitluy-ai-build-readiness-document-program-v1.0.0.md) | 0 Program | MISSING | —    |

## Family 1 — Master Rebuild and Business Bibles

| Artifact                              | Family   | Status          | Path                                                          |
| ------------------------------------- | -------- | --------------- | ------------------------------------------------------------- |
| kitluy-suite-rebuild-bible-v4.0.0.md  | 1 Bibles | PRESENT-CURRENT | `docs/source/canonical/kitluy-suite-rebuild-bible-v4.0.0.md`  |
| kitluy-suite-business-bible-v2.0.0.md | 1 Bibles | PRESENT-CURRENT | `docs/source/canonical/kitluy-suite-business-bible-v2.0.0.md` |
| Rebuild bible imported variant        | 1 Bibles | DUPLICATE       | `docs/source/imported/kitluy-suite-rebuild-bible-v4.0.0.md`   |
| Business bible imported variant       | 1 Bibles | DUPLICATE       | `docs/source/imported/kitluy-suite-business-bible-v2.0.0.md`  |

## Family 2 — Source-of-truth control pack

| Artifact                                                     | Family         | Status                       | Path                                                                                 |
| ------------------------------------------------------------ | -------------- | ---------------------------- | ------------------------------------------------------------------------------------ |
| PROJECT_HOME.md                                              | 2 Control pack | PRESENT-CURRENT              | `docs/source/canonical/PROJECT_HOME.md`                                              |
| kitluy-source-of-truth-index-v1.0.0.md                       | 2 Control pack | PRESENT-NEEDS-RECONCILIATION | `docs/source/canonical/kitluy-source-of-truth-index-v1.0.0.md`                       |
| kitluy-authority-and-precedence-v1.0.0.md                    | 2 Control pack | PRESENT-CURRENT              | `docs/source/canonical/kitluy-authority-and-precedence-v1.0.0.md`                    |
| kitluy-decision-and-reconciliation-register-v1.0.0.md        | 2 Control pack | PRESENT-CURRENT              | `docs/source/canonical/kitluy-decision-and-reconciliation-register-v1.0.0.md`        |
| kitluy-open-decisions-and-required-values-v1.0.0.md          | 2 Control pack | PRESENT-NEEDS-RECONCILIATION | `docs/source/canonical/kitluy-open-decisions-and-required-values-v1.0.0.md`          |
| kitluy-implementation-status-and-evidence-register-v1.0.0.md | 2 Control pack | PRESENT-NEEDS-RECONCILIATION | `docs/source/canonical/kitluy-implementation-status-and-evidence-register-v1.0.0.md` |
| kitluy-superseded-document-register-v1.0.0.md                | 2 Control pack | PRESENT-NEEDS-RECONCILIATION | `docs/source/canonical/kitluy-superseded-document-register-v1.0.0.md`                |
| kitluy-glossary-and-naming-standard-v1.0.0.md                | 2 Control pack | PRESENT-CURRENT              | `docs/source/canonical/kitluy-glossary-and-naming-standard-v1.0.0.md`                |

Reconciliation notes: the index/registers were written against a pre-v4-bible
bundle (stale "missing" claims — KLREC-2026-07-26-005/-006) and lack the ~90
newly ingested pack documents. Working copies at `docs/authority/` carry the
reconciliation addenda; the evidence register baseline predates this
repository (KLREC-2026-07-26-008).

## Family 3 — Supabase implementation pack

| Artifact                                                                        | Family     | Status                       | Path                                                                                          |
| ------------------------------------------------------------------------------- | ---------- | ---------------------------- | --------------------------------------------------------------------------------------------- |
| kitluy-suite-supabase-schema-v1.0.0.md                                          | 3 Supabase | MISSING                      | —                                                                                             |
| kitluy-suite-supabase-rls-and-authorization-v1.0.0.md                           | 3 Supabase | MISSING                      | —                                                                                             |
| kitluy-suite-supabase-migration-plan-v1.0.0.md                                  | 3 Supabase | MISSING                      | —                                                                                             |
| kitluy-suite-supabase-data-dictionary-v1.0.0.md (21 schemas, table definitions) | 3 Supabase | PRESENT-CURRENT              | `docs/source/data-contracts/kitluy-suite-supabase-data-dictionary-v1.0.0.md`                  |
| kitluy-suite-supabase-enum-and-reference-data-registry-v1.0.0.md                | 3 Supabase | PRESENT-CURRENT              | `docs/source/data-contracts/kitluy-suite-supabase-enum-and-reference-data-registry-v1.0.0.md` |
| kitluy-suite-supabase-seed-and-test-fixture-plan-v1.0.0.md                      | 3 Supabase | PRESENT-CURRENT              | `docs/source/data-contracts/kitluy-suite-supabase-seed-and-test-fixture-plan-v1.0.0.md`       |
| kitluy-suite-supabase-functions-rpc-and-triggers-v1.0.0.md                      | 3 Supabase | PRESENT-CURRENT              | `docs/source/data-contracts/kitluy-suite-supabase-functions-rpc-and-triggers-v1.0.0.md`       |
| kitluy-suite-supabase-edge-functions-contract-v1.0.0.md                         | 3 Supabase | PRESENT-CURRENT              | `docs/source/data-contracts/kitluy-suite-supabase-edge-functions-contract-v1.0.0.md`          |
| kitluy-suite-supabase-realtime-publication-plan-v1.0.0.md                       | 3 Supabase | PRESENT-CURRENT              | `docs/source/data-contracts/kitluy-suite-supabase-realtime-publication-plan-v1.0.0.md`        |
| kitluy-suite-supabase-storage-metadata-contract-v1.0.0.md                       | 3 Supabase | PRESENT-CURRENT              | `docs/source/data-contracts/kitluy-suite-supabase-storage-metadata-contract-v1.0.0.md`        |
| kitluy-suite-supabase-backup-restore-and-pitr-v1.0.0.md                         | 3 Supabase | PRESENT-CURRENT              | `docs/source/data-contracts/kitluy-suite-supabase-backup-restore-and-pitr-v1.0.0.md`          |
| kitluy-suite-supabase-validation-and-database-qa-v1.0.0.md                      | 3 Supabase | PRESENT-CURRENT              | `docs/source/data-contracts/kitluy-suite-supabase-validation-and-database-qa-v1.0.0.md`       |
| kitluy-suite-supabase-generated-types-policy-v1.0.0.md                          | 3 Supabase | PRESENT-CURRENT              | `docs/source/data-contracts/kitluy-suite-supabase-generated-types-policy-v1.0.0.md`           |
| Pack checksums (.sha256; hashes stale vs regenerated members)                   | 3 Supabase | PRESENT-NEEDS-RECONCILIATION | `docs/source/data-contracts/kitluy-suite-supabase-implementation-pack-v1.0.0.sha256`          |

**Family verdict: PRESENT-PARTIAL** — the three highest-authority members
(each present file ranks them above itself) were not shipped. SQL migrations
(final deployed truth) do not exist yet anywhere.

## Family 4 — Four governed API specifications and registries

| Artifact                                             | Family | Status                       | Path                                                                            |
| ---------------------------------------------------- | ------ | ---------------------------- | ------------------------------------------------------------------------------- |
| kitluy-management-api-v1.0.0.md (/management/v1)     | 4 APIs | PRESENT-CURRENT              | `docs/source/api-contracts/kitluy-management-api-v1.0.0.md`                     |
| kitluy-commerce-store-api-v1.0.0.md (/commerce/v1)   | 4 APIs | PRESENT-CURRENT              | `docs/source/api-contracts/kitluy-commerce-store-api-v1.0.0.md`                 |
| kitluy-edge-operations-api-v1.0.0.md (/edge/v1)      | 4 APIs | CONFLICTED                   | `docs/source/api-contracts/kitluy-edge-operations-api-v1.0.0.md`                |
| kitluy-connector-api-v1.0.0.md (/connector/v1)       | 4 APIs | PRESENT-CURRENT              | `docs/source/api-contracts/kitluy-connector-api-v1.0.0.md`                      |
| kitluy-api-error-code-registry-v1.0.0.md (~51 codes) | 4 APIs | PRESENT-NEEDS-RECONCILIATION | `docs/source/api-contracts/kitluy-api-error-code-registry-v1.0.0.md`            |
| kitluy-api-scope-registry-v1.0.0.md                  | 4 APIs | PRESENT-NEEDS-RECONCILIATION | `docs/source/api-contracts/kitluy-api-scope-registry-v1.0.0.md`                 |
| kitluy-api-version-and-deprecation-policy-v1.0.0.md  | 4 APIs | PRESENT-CURRENT              | `docs/source/api-contracts/kitluy-api-version-and-deprecation-policy-v1.0.0.md` |
| kitluy-api-contract-test-registry-v1.0.0.md          | 4 APIs | PRESENT-CURRENT              | `docs/source/api-contracts/kitluy-api-contract-test-registry-v1.0.0.md`         |
| API pack index (README.md)                           | 4 APIs | PRESENT-NEEDS-RECONCILIATION | `docs/source/api-contracts/README.md`                                           |

Conflicts: KLREC-2026-07-26-001 (edge route fork vs LAN API), -010 (error-code
names vs POS spec §14.3), -012 (scope taxonomy vs RB v4 §8.5), -007 (README
collision).

## Family 5 — Event, job and webhook contracts

| Artifact                                                              | Family   | Status                       | Path                                                                           |
| --------------------------------------------------------------------- | -------- | ---------------------------- | ------------------------------------------------------------------------------ |
| kitluy-domain-event-registry-v1.0.0.md (16 events, unversioned names) | 5 Events | PRESENT-NEEDS-RECONCILIATION | `docs/source/api-contracts/kitluy-domain-event-registry-v1.0.0.md`             |
| kitluy-durable-job-registry-v1.0.0.md                                 | 5 Events | PRESENT-CURRENT              | `docs/source/api-contracts/kitluy-durable-job-registry-v1.0.0.md`              |
| kitluy-webhook-contract-registry-v1.0.0.md                            | 5 Events | PRESENT-CURRENT              | `docs/source/api-contracts/kitluy-webhook-contract-registry-v1.0.0.md`         |
| kitluy-outbox-and-event-delivery-pattern-v1.0.0.md                    | 5 Events | PRESENT-CURRENT              | `docs/source/api-contracts/kitluy-outbox-and-event-delivery-pattern-v1.0.0.md` |
| kitluy-event-schema-compatibility-policy-v1.0.0.md                    | 5 Events | PRESENT-CURRENT              | `docs/source/api-contracts/kitluy-event-schema-compatibility-policy-v1.0.0.md` |
| kitluy-replay-and-reconciliation-runbook-v1.0.0.md                    | 5 Events | PRESENT-CURRENT              | `docs/source/api-contracts/kitluy-replay-and-reconciliation-runbook-v1.0.0.md` |

## Family 6 — Business rules and state machines

| Artifact                                                 | Family  | Status          | Path                                                                                  |
| -------------------------------------------------------- | ------- | --------------- | ------------------------------------------------------------------------------------- |
| kitluy-core-business-rules-v1.0.0.md                     | 6 Rules | PRESENT-CURRENT | `docs/source/business-rules/kitluy-core-business-rules-v1.0.0.md`                     |
| kitluy-laundry-state-machines-v1.0.0.md                  | 6 Rules | PRESENT-CURRENT | `docs/source/business-rules/kitluy-laundry-state-machines-v1.0.0.md`                  |
| kitluy-transaction-and-booking-lifecycle-v1.0.0.md       | 6 Rules | PRESENT-CURRENT | `docs/source/business-rules/kitluy-transaction-and-booking-lifecycle-v1.0.0.md`       |
| kitluy-payment-refund-and-void-rules-v1.0.0.md           | 6 Rules | PRESENT-CURRENT | `docs/source/business-rules/kitluy-payment-refund-and-void-rules-v1.0.0.md`           |
| kitluy-inventory-movement-and-cost-rules-v1.0.0.md       | 6 Rules | PRESENT-CURRENT | `docs/source/business-rules/kitluy-inventory-movement-and-cost-rules-v1.0.0.md`       |
| kitluy-finance-subledger-and-reconciliation-v1.0.0.md    | 6 Rules | PRESENT-CURRENT | `docs/source/business-rules/kitluy-finance-subledger-and-reconciliation-v1.0.0.md`    |
| kitluy-customer-identity-consent-and-privacy-v1.0.0.md   | 6 Rules | PRESENT-CURRENT | `docs/source/business-rules/kitluy-customer-identity-consent-and-privacy-v1.0.0.md`   |
| kitluy-pricing-discount-tax-and-rounding-rules-v1.0.0.md | 6 Rules | PRESENT-CURRENT | `docs/source/business-rules/kitluy-pricing-discount-tax-and-rounding-rules-v1.0.0.md` |
| kitluy-business-date-shift-and-close-rules-v1.0.0.md     | 6 Rules | PRESENT-CURRENT | `docs/source/business-rules/kitluy-business-date-shift-and-close-rules-v1.0.0.md`     |
| kitluy-configuration-publication-and-rollback-v1.0.0.md  | 6 Rules | PRESENT-CURRENT | `docs/source/business-rules/kitluy-configuration-publication-and-rollback-v1.0.0.md`  |
| Business-rules pack index + checksums                    | 6 Rules | PRESENT-CURRENT | `docs/source/business-rules/README-kitluy-canonical-business-rules-v1.0.0.md`         |

## Family 7 — Security and authorization pack

| Artifact                                                                   | Family     | Status                       | Path                                                                                |
| -------------------------------------------------------------------------- | ---------- | ---------------------------- | ----------------------------------------------------------------------------------- |
| kitluy-suite-rbac-permission-registry-v1.0.0.md (+.csv, 107 keys)          | 7 Security | PRESENT-NEEDS-RECONCILIATION | `docs/source/security/kitluy-suite-rbac-permission-registry-v1.0.0.md`              |
| kitluy-resource-scope-model-v1.0.0.md                                      | 7 Security | PRESENT-NEEDS-RECONCILIATION | `docs/source/security/kitluy-resource-scope-model-v1.0.0.md`                        |
| kitluy-sensitive-action-and-four-eyes-policy-v1.0.0.md (A0-A4)             | 7 Security | PRESENT-CURRENT              | `docs/source/security/kitluy-sensitive-action-and-four-eyes-policy-v1.0.0.md`       |
| kitluy-audit-event-registry-v1.0.0.md (+.csv)                              | 7 Security | PRESENT-CURRENT              | `docs/source/security/kitluy-audit-event-registry-v1.0.0.md`                        |
| kitluy-service-account-and-machine-identity-policy-v1.0.0.md               | 7 Security | PRESENT-CURRENT              | `docs/source/security/kitluy-service-account-and-machine-identity-policy-v1.0.0.md` |
| kitluy-device-certificate-and-trust-policy-v1.0.0.md                       | 7 Security | PRESENT-CURRENT              | `docs/source/security/kitluy-device-certificate-and-trust-policy-v1.0.0.md`         |
| kitluy-support-access-and-consent-policy-v1.0.0.md                         | 7 Security | PRESENT-CURRENT              | `docs/source/security/kitluy-support-access-and-consent-policy-v1.0.0.md`           |
| kitluy-secrets-and-key-management-policy-v1.0.0.md                         | 7 Security | PRESENT-CURRENT              | `docs/source/security/kitluy-secrets-and-key-management-policy-v1.0.0.md`           |
| kitluy-threat-model-phase1-v1.0.0.md                                       | 7 Security | PRESENT-CURRENT              | `docs/source/security/kitluy-threat-model-phase1-v1.0.0.md`                         |
| kitluy-security-test-plan-phase1-v1.0.0.md                                 | 7 Security | PRESENT-CURRENT              | `docs/source/security/kitluy-security-test-plan-phase1-v1.0.0.md`                   |
| Security pack checksums (manifest.json; declared README lost to collision) | 7 Security | PRESENT-NEEDS-RECONCILIATION | `docs/source/security/manifest.json`                                                |
| kitluy-store-hub-managed-device-security-lock-and-build-spec-v1.0.0.md     | 7 Security | MISSING                      | —                                                                                   |

## Family 8 — Store Hub and offline protocol pack

| Artifact                                                            | Family    | Status                       | Path                                                                             |
| ------------------------------------------------------------------- | --------- | ---------------------------- | -------------------------------------------------------------------------------- |
| kitluy-storehub-lan-api-v1.0.0.md                                   | 8 Offline | CONFLICTED                   | `docs/source/offline/kitluy-storehub-lan-api-v1.0.0.md`                          |
| kitluy-storehub-local-database-schema-v1.0.0.md (10 edge_* schemas) | 8 Offline | PRESENT-NEEDS-RECONCILIATION | `docs/source/offline/kitluy-storehub-local-database-schema-v1.0.0.md`            |
| kitluy-edge-sync-protocol-v1.0.0.md                                 | 8 Offline | PRESENT-CURRENT              | `docs/source/offline/kitluy-edge-sync-protocol-v1.0.0.md`                        |
| kitluy-sync-conflict-resolution-policy-v1.0.0.md                    | 8 Offline | PRESENT-CURRENT              | `docs/source/offline/kitluy-sync-conflict-resolution-policy-v1.0.0.md`           |
| kitluy-offline-idempotency-and-sequencing-v1.0.0.md                 | 8 Offline | PRESENT-CURRENT              | `docs/source/offline/kitluy-offline-idempotency-and-sequencing-v1.0.0.md`        |
| kitluy-configuration-snapshot-contract-v1.0.0.md                    | 8 Offline | PRESENT-CURRENT              | `docs/source/offline/kitluy-configuration-snapshot-contract-v1.0.0.md`           |
| kitluy-device-discovery-and-pairing-protocol-v1.0.0.md              | 8 Offline | PRESENT-CURRENT              | `docs/source/offline/kitluy-device-discovery-and-pairing-protocol-v1.0.0.md`     |
| kitluy-storehub-file-cache-and-transfer-protocol-v1.0.0.md          | 8 Offline | PRESENT-CURRENT              | `docs/source/offline/kitluy-storehub-file-cache-and-transfer-protocol-v1.0.0.md` |
| kitluy-storehub-recovery-and-replacement-runbook-v1.0.0.md          | 8 Offline | PRESENT-CURRENT              | `docs/source/offline/kitluy-storehub-recovery-and-replacement-runbook-v1.0.0.md` |
| kitluy-terminal-profile-contract-t1-t4-v1.0.0.md                    | 8 Offline | PRESENT-NEEDS-RECONCILIATION | `docs/source/offline/kitluy-terminal-profile-contract-t1-t4-v1.0.0.md`           |
| kitluy-hardware-compatibility-matrix-phase1-v1.0.0.md               | 8 Offline | PRESENT-CURRENT              | `docs/source/offline/kitluy-hardware-compatibility-matrix-phase1-v1.0.0.md`      |

## Family 9 — Shared-service specifications

| Artifact                                                       | Family     | Status          | Path                                                                                         |
| -------------------------------------------------------------- | ---------- | --------------- | -------------------------------------------------------------------------------------------- |
| kitluy-file-service-phase1-spec-v1.0.0.md                      | 9 Services | PRESENT-CURRENT | `docs/source/shared-services/kitluy-file-service-phase1-spec-v1.0.0.md`                      |
| kitluy-notification-service-phase1-spec-v1.0.0.md              | 9 Services | PRESENT-CURRENT | `docs/source/shared-services/kitluy-notification-service-phase1-spec-v1.0.0.md`              |
| kitluy-integration-hub-phase1-spec-v1.0.0.md                   | 9 Services | PRESENT-CURRENT | `docs/source/shared-services/kitluy-integration-hub-phase1-spec-v1.0.0.md`                   |
| kitluy-connector-runtime-phase1-spec-v1.0.0.md                 | 9 Services | PRESENT-CURRENT | `docs/source/shared-services/kitluy-connector-runtime-phase1-spec-v1.0.0.md`                 |
| kitluy-ai-gateway-phase1-spec-v1.0.0.md                        | 9 Services | PRESENT-CURRENT | `docs/source/shared-services/kitluy-ai-gateway-phase1-spec-v1.0.0.md`                        |
| kitluy-mcp-server-phase1-spec-v1.0.0.md                        | 9 Services | PRESENT-CURRENT | `docs/source/shared-services/kitluy-mcp-server-phase1-spec-v1.0.0.md`                        |
| kitluy-rag-indexer-phase1-spec-v1.0.0.md                       | 9 Services | PRESENT-CURRENT | `docs/source/shared-services/kitluy-rag-indexer-phase1-spec-v1.0.0.md`                       |
| kitluy-reporting-and-export-service-phase1-spec-v1.0.0.md      | 9 Services | PRESENT-CURRENT | `docs/source/shared-services/kitluy-reporting-and-export-service-phase1-spec-v1.0.0.md`      |
| kitluy-device-release-and-update-service-phase1-spec-v1.0.0.md | 9 Services | PRESENT-CURRENT | `docs/source/shared-services/kitluy-device-release-and-update-service-phase1-spec-v1.0.0.md` |

## Family 10 — UI/UX build pack

| Artifact                                                                                                                          | Family   | Status                       | Path                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------- | --------------------------------------------------------------------------------- |
| KITLUY-UI-UX-BUILD-PACK-INDEX-v1.0.0.md                                                                                           | 10 UI/UX | PRESENT-CURRENT              | `docs/source/ui-ux/KITLUY-UI-UX-BUILD-PACK-INDEX-v1.0.0.md`                       |
| kitluy-design-system-v1.0.0.md + kitluy-design-token-registry-v1.0.0.json (provisional brand values)                              | 10 UI/UX | PRESENT-CURRENT              | `docs/source/ui-ux/kitluy-design-system-v1.0.0.md`                                |
| kitluy-component-inventory-v1.0.0.md                                                                                              | 10 UI/UX | PRESENT-CURRENT              | `docs/source/ui-ux/kitluy-component-inventory-v1.0.0.md`                          |
| kitluy-accessibility-standard-v1.0.0.md                                                                                           | 10 UI/UX | PRESENT-CURRENT              | `docs/source/ui-ux/kitluy-accessibility-standard-v1.0.0.md`                       |
| kitluy-responsive-layout-standard-v1.0.0.md                                                                                       | 10 UI/UX | PRESENT-CURRENT              | `docs/source/ui-ux/kitluy-responsive-layout-standard-v1.0.0.md`                   |
| kitluy-khmer-english-content-style-guide-v1.0.0.md                                                                                | 10 UI/UX | PRESENT-CURRENT              | `docs/source/ui-ux/kitluy-khmer-english-content-style-guide-v1.0.0.md`            |
| kitluy-localization-key-registry-v1.0.0.md                                                                                        | 10 UI/UX | PRESENT-CURRENT              | `docs/source/ui-ux/kitluy-localization-key-registry-v1.0.0.md`                    |
| kitluy-date-time-money-formatting-standard-v1.0.0.md                                                                              | 10 UI/UX | PRESENT-CURRENT              | `docs/source/ui-ux/kitluy-date-time-money-formatting-standard-v1.0.0.md`          |
| Route/screen inventories: b2b-website, admin, chain, partner portal, partner app, pos desktop, pos mobile, storefront (8 Phase 1) | 10 UI/UX | PRESENT-CURRENT              | `docs/source/ui-ux/kitluy-b2b-website-route-screen-inventory-v1.0.0.md`           |
| Route/screen inventories: restaurant KDS, guest display, kiosk (phase-gated)                                                      | 10 UI/UX | PRESENT-CURRENT              | `docs/source/ui-ux/kitluy-restaurant-kds-client-route-screen-inventory-v1.0.0.md` |
| UI/UX pack checksums (manifest copy.json; stale hashes)                                                                           | 10 UI/UX | PRESENT-NEEDS-RECONCILIATION | `docs/source/ui-ux/manifest copy.json`                                            |

## Other program-referenced artifacts

| Artifact                                           | Family    | Status          | Path                                                           |
| -------------------------------------------------- | --------- | --------------- | -------------------------------------------------------------- |
| kitluy-master-feature-registry-v0.2.csv            | Registry  | PRESENT-CURRENT | `docs/source/imported/kitluy-master-feature-registry-v0.2.csv` |
| kitluy-master-feature-registry-v0.2.md             | Registry  | MISSING         | —                                                              |
| kitluy-master-feature-registry-v0.2.json           | Registry  | MISSING         | —                                                              |
| kitluy-owner-decision-lock-12-capabilities-v1.0.md | Decisions | MISSING         | —                                                              |
| SQL migrations (final deployed database truth)     | Data      | MISSING         | —                                                              |

## Batch 2 (KL-DOCS-002, 2026-07-26) — additional pack families

### Family 11 — Engineering standards pack

| Artifact                                                                                                                                                                             | Family         | Status                       | Path                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | ---------------------------- | -------------------------------------------------------------------------------- |
| pack-manifest.json (selected toolchain versions)                                                                                                                                     | 11 Engineering | PRESENT-NEEDS-RECONCILIATION | `docs/source/engineering/pack-manifest.json`                                     |
| CODEOWNERS / CONTRIBUTING.md / SECURITY.md (root-file replacement candidates)                                                                                                        | 11 Engineering | PRESENT-NEEDS-RECONCILIATION | `docs/source/engineering/CODEOWNERS`                                             |
| kitluy-monorepo-blueprint-v1.0.0.md                                                                                                                                                  | 11 Engineering | CONFLICTED                   | `docs/source/engineering/kitluy-monorepo-blueprint-v1.0.0.md`                    |
| kitluy-coding-standards-typescript-react-v1.0.0.md                                                                                                                                   | 11 Engineering | PRESENT-NEEDS-RECONCILIATION | `docs/source/engineering/kitluy-coding-standards-typescript-react-v1.0.0.md`     |
| kitluy-package-boundary-and-dependency-rules-v1.0.0.md                                                                                                                               | 11 Engineering | PRESENT-NEEDS-RECONCILIATION | `docs/source/engineering/kitluy-package-boundary-and-dependency-rules-v1.0.0.md` |
| Branching/PR policy, code review checklist, database coding standard, definition of done, dependency/supply-chain policy, error-handling/logging standard, testing standard (7 docs) | 11 Engineering | PRESENT-CURRENT              | `docs/source/engineering/kitluy-testing-standard-v1.0.0.md`                      |

### Family 12 — QA and testing pack

| Artifact                                                                                                                                                                                                                                           | Family | Status          | Path                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------- | --------------------------------------------------------------------------- |
| kitluy-phase1-master-test-plan-v1.0.0.md (G0-G5 gates, 524-case baseline)                                                                                                                                                                          | 12 QA  | PRESENT-CURRENT | `docs/source/qa/kitluy-phase1-master-test-plan-v1.0.0.md`                   |
| kitluy-test-case-registry-phase1-v1.0.0.csv (524 cases, all SPECIFIED_NOT_EXECUTED)                                                                                                                                                                | 12 QA  | PRESENT-CURRENT | `docs/source/qa/kitluy-test-case-registry-phase1-v1.0.0.csv`                |
| kitluy-payment-and-reconciliation-test-vectors-v1.0.0.json (26 vectors, integer minor units)                                                                                                                                                       | 12 QA  | PRESENT-CURRENT | `docs/source/qa/kitluy-payment-and-reconciliation-test-vectors-v1.0.0.json` |
| kitluy-contract-test-matrix / cross-product-e2e-matrix (28 journeys) / offline-and-reconnect (30) / rls-and-tenant-isolation (30) / performance-and-capacity (18) / hardware-certification (25) / rebuild-test-checklist / pilot-evidence-template | 12 QA  | PRESENT-CURRENT | `docs/source/qa/kitluy-contract-test-matrix-v1.0.0.md`                      |
| kitluy-security-test-plan-v1.0.0.md (36 cases; vs batch-1 phase1 plan)                                                                                                                                                                             | 12 QA  | CONFLICTED      | `docs/source/qa/kitluy-security-test-plan-v1.0.0.md`                        |
| kitluy-testing-and-evidence-system-v1.0.0 (source of 41 registry rows)                                                                                                                                                                             | 12 QA  | MISSING         | —                                                                           |

### Family 13 — Infrastructure and operations pack

| Artifact                                                                                                                                                                                                                                                                                                                                                                                                                                 | Family | Status          | Path                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------- | ------------------------------------------------------------ |
| PACKAGE_MANIFEST.txt (pack index)                                                                                                                                                                                                                                                                                                                                                                                                        | 13 Ops | PRESENT-CURRENT | `docs/source/infrastructure/PACKAGE_MANIFEST.txt`            |
| backup-and-disaster-recovery / ci-cd-pipeline / database-deployment-runbook / deployment-topology / domain-dns-and-tls-plan / environment-matrix / incident-response-runbook / infrastructure-as-code-plan / observability-and-alert-registry / phase1-go-live-checklist / phase1-pilot-runbook / release-channel-and-promotion-policy / rollback-and-emergency-change-runbook / secrets-inventory (references-only, verified no values) | 13 Ops | PRESENT-CURRENT | `docs/source/infrastructure/kitluy-ci-cd-pipeline-v1.0.0.md` |

### Family 14 — AI Swarm Operating System pack

| Artifact                                                                                                                                                            | Family   | Status                       | Path                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------- | --------------------------------------------------------------------------------------------------- |
| AGENTS.md (parent contract) + CLAUDE.md + KIMI.md + PROJECT_HOME.md + CONTRIBUTING.md + SECURITY.md + AI_SWARM_PACK_MANIFEST.md (all self-declared hashes verified) | 14 Swarm | PRESENT-NEEDS-RECONCILIATION | `docs/source/owner-instructions/kitluy-ai-swarm-operating-system-v1.0.0/AGENTS.md`                  |
| 00_AI_HANDOFF templates + state files (state self-declared UNVERIFIED against a live checkout)                                                                      | 14 Swarm | PRESENT-NEEDS-RECONCILIATION | `docs/source/owner-instructions/kitluy-ai-swarm-operating-system-v1.0.0/00_AI_HANDOFF/000_INDEX.md` |
