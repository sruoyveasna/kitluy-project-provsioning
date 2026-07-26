/**
 * Classification map for the owner-supplied inbox corpus (KL-DOCS-001).
 * First matching rule wins. Fields: dir (classified subdirectory),
 * authority_class, document_role, product_or_domain, vertical.
 * canonical_status defaults to CANONICAL-CURRENT unless overridden.
 */
export const RULES = [
  // --- Master authority / control pack -> canonical/ ---
  [
    /^kitluy-suite-rebuild-bible-v4\.0\.0\.md$/,
    {
      dir: "canonical",
      authority_class: "MASTER-AUTHORITY",
      document_role: "MASTER-REBUILD-BIBLE",
      product_or_domain: "suite",
      conflicts_with:
        "docs/source/imported/kitluy-suite-rebuild-bible-v4.0.0.md (same name+version, different hash — verified content-identical (formatting-only variant); imported copy registered as DUPLICATE)",
    },
  ],
  [
    /^kitluy-suite-business-bible-v2\.0\.0\.md$/,
    {
      dir: "canonical",
      authority_class: "BUSINESS-AUTHORITY",
      document_role: "BUSINESS-BIBLE",
      product_or_domain: "suite",
      conflicts_with:
        "docs/source/imported/kitluy-suite-business-bible-v2.0.0.md (same name+version, different hash — verified content-identical (formatting-only variant); imported copy registered as DUPLICATE)",
    },
  ],
  [
    /^PROJECT_HOME\.md$/,
    {
      dir: "canonical",
      authority_class: "MASTER-AUTHORITY",
      document_role: "CANONICAL-ENTRY-POINT",
      product_or_domain: "suite",
      supersedes: "repo PROJECT_HOME.md bootstrap recreation (commit 4a79f66)",
    },
  ],
  [
    /^kitluy-(source-of-truth-index|authority-and-precedence|decision-and-reconciliation-register|open-decisions-and-required-values|implementation-status-and-evidence-register|superseded-document-register|glossary-and-naming-standard)-v1\.0\.0\.md$/,
    {
      dir: "canonical",
      authority_class: "MASTER-AUTHORITY",
      document_role: "SOURCE-OF-TRUTH-CONTROL-PACK",
      product_or_domain: "suite",
      supersedes: "bootstrap recreation in docs/authority/ (commit 4a79f66)",
    },
  ],

  // --- Governed APIs + registries + events family -> api-contracts/ ---
  [
    /^kitluy-(management|commerce-store|connector|edge-operations)-api-v1\.0\.0\.md$/,
    {
      dir: "api-contracts",
      authority_class: "CANONICAL-SHARED-CONTRACT",
      document_role: "GOVERNED-API-SPECIFICATION",
      product_or_domain: "api",
    },
  ],
  [
    /^kitluy-api-(error-code|scope|contract-test)-registry-v1\.0\.0\.md$/,
    {
      dir: "api-contracts",
      authority_class: "CANONICAL-SHARED-CONTRACT",
      document_role: "API-GOVERNANCE-REGISTRY",
      product_or_domain: "api",
    },
  ],
  [
    /^kitluy-api-version-and-deprecation-policy-v1\.0\.0\.md$/,
    {
      dir: "api-contracts",
      authority_class: "CANONICAL-SHARED-CONTRACT",
      document_role: "API-GOVERNANCE-POLICY",
      product_or_domain: "api",
    },
  ],
  [
    /^README\.md$/,
    {
      dir: "api-contracts",
      authority_class: "CANONICAL-SHARED-CONTRACT",
      document_role: "PACK-INDEX (Governed API Specification Pack)",
      product_or_domain: "api",
      notes:
        "NAMING COLLISION: security pack manifest.json declares a README.md of 890 bytes; the physical README.md (707 bytes) is the API pack index — the security pack README was lost when packs were flattened into one inbox.",
    },
  ],
  [
    /^kitluy-domain-event-registry-v1\.0\.0\.md$/,
    {
      dir: "api-contracts",
      authority_class: "CANONICAL-SHARED-CONTRACT",
      document_role: "DOMAIN-EVENT-REGISTRY",
      product_or_domain: "events",
    },
  ],
  [
    /^kitluy-durable-job-registry-v1\.0\.0\.md$/,
    {
      dir: "api-contracts",
      authority_class: "CANONICAL-SHARED-CONTRACT",
      document_role: "DURABLE-JOB-REGISTRY",
      product_or_domain: "events",
    },
  ],
  [
    /^kitluy-webhook-contract-registry-v1\.0\.0\.md$/,
    {
      dir: "api-contracts",
      authority_class: "CANONICAL-SHARED-CONTRACT",
      document_role: "WEBHOOK-CONTRACT-REGISTRY",
      product_or_domain: "events",
    },
  ],
  [
    /^kitluy-outbox-and-event-delivery-pattern-v1\.0\.0\.md$/,
    {
      dir: "api-contracts",
      authority_class: "CANONICAL-SHARED-CONTRACT",
      document_role: "EVENT-DELIVERY-PATTERN",
      product_or_domain: "events",
    },
  ],
  [
    /^kitluy-event-schema-compatibility-policy-v1\.0\.0\.md$/,
    {
      dir: "api-contracts",
      authority_class: "CANONICAL-SHARED-CONTRACT",
      document_role: "EVENT-COMPATIBILITY-POLICY",
      product_or_domain: "events",
    },
  ],
  [
    /^kitluy-replay-and-reconciliation-runbook-v1\.0\.0\.md$/,
    {
      dir: "api-contracts",
      authority_class: "CANONICAL-SHARED-CONTRACT",
      document_role: "REPLAY-RECONCILIATION-RUNBOOK",
      product_or_domain: "events",
    },
  ],

  // --- Supabase pack -> data-contracts/ ---
  [
    /^kitluy-suite-supabase-implementation-pack-v1\.0\.0\.sha256$/,
    {
      dir: "data-contracts",
      authority_class: "CANONICAL-SHARED-CONTRACT",
      document_role: "PACK-CHECKSUMS (Supabase implementation pack)",
      product_or_domain: "data",
      notes:
        "Declared hashes differ from physical files for most members (files regenerated after checksum creation) — see inventory pack_manifest_discrepancies.",
    },
  ],
  [
    /^kitluy-suite-supabase-.*-v1\.0\.0\.md$/,
    {
      dir: "data-contracts",
      authority_class: "CANONICAL-SHARED-CONTRACT",
      document_role: "SUPABASE-IMPLEMENTATION-PACK-MEMBER",
      product_or_domain: "data",
    },
  ],

  // --- Business rules -> business-rules/ ---
  [
    /^kitluy-laundry-state-machines-v1\.0\.0\.md$/,
    {
      dir: "business-rules",
      authority_class: "CANONICAL-SHARED-CONTRACT",
      document_role: "STATE-MACHINE-CONTRACT",
      product_or_domain: "business-rules",
      vertical: "laundry",
    },
  ],
  [
    /^kitluy-(core-business-rules|transaction-and-booking-lifecycle|payment-refund-and-void-rules|inventory-movement-and-cost-rules|finance-subledger-and-reconciliation|customer-identity-consent-and-privacy|pricing-discount-tax-and-rounding-rules|business-date-shift-and-close-rules|configuration-publication-and-rollback)-v1\.0\.0\.md$/,
    {
      dir: "business-rules",
      authority_class: "CANONICAL-SHARED-CONTRACT",
      document_role: "CANONICAL-BUSINESS-RULES",
      product_or_domain: "business-rules",
    },
  ],
  [
    /^README-kitluy-canonical-business-rules-v1\.0\.0\.md$/,
    {
      dir: "business-rules",
      authority_class: "CANONICAL-SHARED-CONTRACT",
      document_role: "PACK-INDEX (Canonical Business Rules Pack)",
      product_or_domain: "business-rules",
    },
  ],
  [
    /^kitluy-canonical-business-rules-v1\.0\.0-manifest\.json$/,
    {
      dir: "business-rules",
      authority_class: "CANONICAL-SHARED-CONTRACT",
      document_role: "PACK-CHECKSUMS (Canonical Business Rules Pack)",
      product_or_domain: "business-rules",
    },
  ],

  // --- Security pack -> security/ ---
  [
    /^kitluy-audit-event-registry-v1\.0\.0\.(md|csv)$/,
    {
      dir: "security",
      authority_class: "CANONICAL-SHARED-CONTRACT",
      document_role: "AUDIT-EVENT-REGISTRY",
      product_or_domain: "security",
    },
  ],
  [
    /^kitluy-suite-rbac-permission-registry-v1\.0\.0\.(md|csv)$/,
    {
      dir: "security",
      authority_class: "CANONICAL-SHARED-CONTRACT",
      document_role: "RBAC-PERMISSION-REGISTRY",
      product_or_domain: "security",
    },
  ],
  [
    /^kitluy-(device-certificate-and-trust-policy|resource-scope-model|secrets-and-key-management-policy|sensitive-action-and-four-eyes-policy|service-account-and-machine-identity-policy|support-access-and-consent-policy)-v1\.0\.0\.md$/,
    {
      dir: "security",
      authority_class: "CANONICAL-SHARED-CONTRACT",
      document_role: "SECURITY-POLICY",
      product_or_domain: "security",
    },
  ],
  [
    /^kitluy-(threat-model|security-test-plan)-phase1-v1\.0\.0\.md$/,
    {
      dir: "security",
      authority_class: "CANONICAL-SHARED-CONTRACT",
      document_role: "SECURITY-ASSESSMENT",
      product_or_domain: "security",
      vertical: "laundry",
    },
  ],
  [
    /^manifest\.json$/,
    {
      dir: "security",
      authority_class: "CANONICAL-SHARED-CONTRACT",
      document_role: "PACK-CHECKSUMS (Security pack)",
      product_or_domain: "security",
      notes:
        "Declared sizes differ from physical files; declares a README.md (890B) that was overwritten by the API pack index in the flattened inbox.",
    },
  ],

  // --- Store Hub / offline -> offline/ ---
  [
    /^kitluy-terminal-profile-contract-t1-t4-v1\.0\.0\.md$/,
    {
      dir: "offline",
      authority_class: "CANONICAL-SHARED-CONTRACT",
      document_role: "TERMINAL-PROFILE-CONTRACT",
      product_or_domain: "edge",
      vertical: "laundry",
    },
  ],
  [
    /^kitluy-(edge-sync-protocol|sync-conflict-resolution-policy|offline-idempotency-and-sequencing|storehub-lan-api|storehub-local-database-schema|storehub-file-cache-and-transfer-protocol|storehub-recovery-and-replacement-runbook|device-discovery-and-pairing-protocol|configuration-snapshot-contract)-v1\.0\.0\.md$/,
    {
      dir: "offline",
      authority_class: "CANONICAL-SHARED-CONTRACT",
      document_role: "STORE-HUB-OFFLINE-PROTOCOL",
      product_or_domain: "edge",
    },
  ],
  [
    /^kitluy-hardware-compatibility-matrix-phase1-v1\.0\.0\.md$/,
    {
      dir: "offline",
      authority_class: "CANONICAL-SHARED-CONTRACT",
      document_role: "HARDWARE-COMPATIBILITY-MATRIX",
      product_or_domain: "edge",
      vertical: "laundry",
    },
  ],

  // --- Shared services -> shared-services/ ---
  [
    /^kitluy-(ai-gateway|mcp-server|rag-indexer|connector-runtime|integration-hub|file-service|notification-service|reporting-and-export-service|device-release-and-update-service)-phase1-spec-v1\.0\.0\.md$/,
    {
      dir: "shared-services",
      authority_class: "CURRENT-PRODUCT-SPECIFICATION",
      document_role: "SHARED-SERVICE-SPECIFICATION",
      product_or_domain: "services",
    },
  ],

  // --- UI/UX pack -> ui-ux/ ---
  [
    /^KITLUY-UI-UX-BUILD-PACK-INDEX-v1\.0\.0\.md$/,
    {
      dir: "ui-ux",
      authority_class: "CANONICAL-SHARED-CONTRACT",
      document_role: "PACK-INDEX (UI/UX build pack)",
      product_or_domain: "ui-ux",
    },
  ],
  [
    /^kitluy-design-token-registry-v1\.0\.0\.json$/,
    {
      dir: "ui-ux",
      authority_class: "CANONICAL-SHARED-CONTRACT",
      document_role: "DESIGN-TOKEN-REGISTRY",
      product_or_domain: "ui-ux",
    },
  ],
  [
    /^kitluy-(accessibility-standard|design-system|component-inventory|date-time-money-formatting-standard|khmer-english-content-style-guide|localization-key-registry|responsive-layout-standard)-v1\.0\.0\.(md|json)$/,
    {
      dir: "ui-ux",
      authority_class: "CANONICAL-SHARED-CONTRACT",
      document_role: "UI-UX-STANDARD",
      product_or_domain: "ui-ux",
    },
  ],
  [
    /^kitluy-(restaurant-kds-client|restaurant-guest-display-order-and-pay|kiosk-self-checkout-client)-route-screen-inventory-v1\.0\.0\.md$/,
    {
      dir: "ui-ux",
      authority_class: "CURRENT-PRODUCT-SPECIFICATION",
      document_role: "ROUTE-SCREEN-INVENTORY (future client — registered, inactive)",
      product_or_domain: "ui-ux",
      vertical: "cafe_restaurant",
    },
  ],
  [
    /^kitluy-.*-route-screen-inventory-v1\.0\.0\.md$/,
    {
      dir: "ui-ux",
      authority_class: "CURRENT-PRODUCT-SPECIFICATION",
      document_role: "ROUTE-SCREEN-INVENTORY",
      product_or_domain: "ui-ux",
      vertical: "laundry",
    },
  ],
  [
    /^manifest copy\.json$/,
    {
      dir: "ui-ux",
      authority_class: "CANONICAL-SHARED-CONTRACT",
      document_role: "PACK-CHECKSUMS (UI/UX build pack)",
      product_or_domain: "ui-ux",
      notes:
        "Declared sizes/hashes differ from physical files (regenerated after manifest creation). Physical filename contains a space + ' copy' suffix.",
    },
  ],
];

// --- Batch 3 (2026-07-26, KL-BUILD-000 ingestion) ---------------------------
export const BATCH3_RULES = [
  [/^kitluy-phase1-laundry-master-build-plan-v1\.0\.0\.md$/, { dir: "owner-instructions", authority_class: "OWNER-INSTRUCTION", document_role: "PHASE1-MASTER-BUILD-PLAN (WS-00..WS-26 execution program)", product_or_domain: "execution", vertical: "laundry" }],
];

// --- Batch 2 (2026-07-26, KL-DOCS-002) -------------------------------------
export const BATCH2_RULES = [
  // AI Swarm Operating System pack -> owner-instructions/ (subpaths preserved)
  [
    /^kitluy-ai-swarm-operating-system-v1\.0\.0\//,
    {
      dir: "owner-instructions",
      authority_class: "OWNER-INSTRUCTION",
      document_role: "AI-SWARM-OPERATING-SYSTEM",
      product_or_domain: "agent-operations",
      notes:
        "Adoption for this repository (replacing repo-root CLAUDE.md / handoff templates) is a registered proposal, not applied silently — KLREC-2026-07-26-015.",
    },
  ],

  // Engineering standards pack -> engineering/ (taxonomy extension, KLBOOT-DEC-010)
  [
    /^pack-manifest\.json$/,
    {
      dir: "engineering",
      authority_class: "OWNER-INSTRUCTION",
      document_role: "PACK-INDEX (Engineering Standards Pack; selected toolchain versions)",
      product_or_domain: "engineering",
      notes:
        "selected_versions conflict with repo toolchain pins (ADR-0001/0002) — KLREC-2026-07-26-014; upgrade is a registered engineering task, not applied during ingestion.",
    },
  ],
  [
    /^(CODEOWNERS|CONTRIBUTING\.md|SECURITY\.md)$/,
    {
      dir: "engineering",
      authority_class: "OWNER-INSTRUCTION",
      document_role: "REPOSITORY-GOVERNANCE-FILE",
      product_or_domain: "engineering",
      notes:
        "Owner-supplied replacement candidate for the repo-root file of the same name; reconciliation recorded before adoption.",
    },
  ],
  [
    /^kitluy-(branching-commit-and-pull-request-policy|code-review-checklist|coding-standards-typescript-react|database-coding-standard|definition-of-done|dependency-and-supply-chain-policy|error-handling-and-logging-standard|monorepo-blueprint|package-boundary-and-dependency-rules|testing-standard)-v1\.0\.0\.md$/,
    {
      dir: "engineering",
      authority_class: "CANONICAL-SHARED-CONTRACT",
      document_role: "ENGINEERING-STANDARD",
      product_or_domain: "engineering",
    },
  ],

  // QA / testing pack -> qa/ (taxonomy extension, KLBOOT-DEC-010)
  [
    /^kitluy-test-case-registry-phase1-v1\.0\.0\.csv$/,
    {
      dir: "qa",
      authority_class: "CANONICAL-SHARED-CONTRACT",
      document_role: "TEST-CASE-REGISTRY (525 cases, SPECIFIED_NOT_EXECUTED)",
      product_or_domain: "qa",
      vertical: "laundry",
    },
  ],
  [
    /^kitluy-payment-and-reconciliation-test-vectors-v1\.0\.0\.json$/,
    {
      dir: "qa",
      authority_class: "CANONICAL-SHARED-CONTRACT",
      document_role: "TEST-VECTORS (payments/reconciliation)",
      product_or_domain: "qa",
    },
  ],
  [
    /^kitluy-(phase1-master-test-plan|contract-test-matrix|cross-product-e2e-matrix-phase1|offline-and-reconnect-test-pack|rls-and-tenant-isolation-test-pack|security-test-plan|performance-and-capacity-test-plan|hardware-certification-test-plan|rebuild-test-checklist|pilot-evidence-template)-v1\.0\.0\.md$/,
    {
      dir: "qa",
      authority_class: "CANONICAL-SHARED-CONTRACT",
      document_role: "QA-TEST-CONTRACT",
      product_or_domain: "qa",
    },
  ],

  // Infrastructure / operations pack -> infrastructure/
  [
    /^PACKAGE_MANIFEST\.txt$/,
    {
      dir: "infrastructure",
      authority_class: "CURRENT-INFRASTRUCTURE-SPECIFICATION",
      document_role: "PACK-INDEX (Infrastructure/Operations Pack)",
      product_or_domain: "infrastructure",
    },
  ],
  [
    /^kitluy-(backup-and-disaster-recovery|ci-cd-pipeline|database-deployment-runbook|deployment-topology-phase1|domain-dns-and-tls-plan|environment-matrix|incident-response-runbook|infrastructure-as-code-plan|observability-and-alert-registry|phase1-go-live-checklist|phase1-pilot-runbook|release-channel-and-promotion-policy|rollback-and-emergency-change-runbook|secrets-inventory)-v1\.0\.0\.md$/,
    {
      dir: "infrastructure",
      authority_class: "CURRENT-INFRASTRUCTURE-SPECIFICATION",
      document_role: "INFRASTRUCTURE-OPERATIONS-CONTRACT",
      product_or_domain: "infrastructure",
    },
  ],
];

export function classify(name) {
  for (const [re, fields] of [...BATCH3_RULES, ...BATCH2_RULES, ...RULES]) {
    if (re.test(name)) return fields;
  }
  return {
    dir: "unclassified",
    authority_class: "UNCLASSIFIED",
    document_role: "UNCLASSIFIED",
    product_or_domain: "",
  };
}
