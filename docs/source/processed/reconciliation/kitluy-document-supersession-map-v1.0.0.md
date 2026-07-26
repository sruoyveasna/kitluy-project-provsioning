# KitLuy Document Supersession Map — v1.0.0

Task KL-DOCS-001, 2026-07-26. Direction: `A → B` means A is superseded/replaced
by B. Machine-relevant statuses live in the source manifest
(`docs/source/manifests/kitluy-source-document-manifest-v1.0.0.*`).

## 1. Owner-supplied canonical copies vs bootstrap recreations

The eight governance documents recreated at bootstrap (commit `4a79f66`) under
the found-original-wins rule are replaced by the owner-supplied originals:

| Bootstrap recreation (git-preserved at `4a79f66`)                                       | Replaced by (owner-supplied)                                   |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| PROJECT_HOME.md (bootstrap version)                                                     | docs/source/canonical/PROJECT_HOME.md → repo root (reconciled) |
| docs/authority/kitluy-source-of-truth-index-v1.0.0.md (bootstrap)                       | inbox kitluy-source-of-truth-index-v1.0.0.md                   |
| docs/authority/kitluy-authority-and-precedence-v1.0.0.md (bootstrap)                    | inbox same name                                                |
| docs/authority/kitluy-decision-and-reconciliation-register-v1.0.0.md (bootstrap)        | inbox same name                                                |
| docs/authority/kitluy-open-decisions-and-required-values-v1.0.0.md (bootstrap)          | inbox same name                                                |
| docs/authority/kitluy-implementation-status-and-evidence-register-v1.0.0.md (bootstrap) | inbox same name                                                |
| docs/authority/kitluy-superseded-document-register-v1.0.0.md (bootstrap)                | inbox same name                                                |
| docs/authority/kitluy-glossary-and-naming-standard-v1.0.0.md (bootstrap)                | inbox same name                                                |

Replacement mode per file is recorded in
[kitluy-provisional-governance-comparison-v1.0.0.md](kitluy-provisional-governance-comparison-v1.0.0.md);
bootstrap-only content worth keeping is registered there as proposals, never
silently merged.

## 2. Same-name/same-version duplicate variants (no supersession)

| Copy                                                       | Status                                                                                                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| docs/source/imported/kitluy-suite-rebuild-bible-v4.0.0.md  | DUPLICATE-FORMATTING-VARIANT of docs/source/canonical/kitluy-suite-rebuild-bible-v4.0.0.md (content-identical; table formatting only) |
| docs/source/imported/kitluy-suite-business-bible-v2.0.0.md | DUPLICATE-FORMATTING-VARIANT of docs/source/canonical/kitluy-suite-business-bible-v2.0.0.md (content-identical)                       |

Registered in `docs/source/manifests/kitluy-imported-copy-status-v1.0.0.json`
(the collision-resolution registry consumed by `pnpm docs:duplicates`).

## 3. Pre-existing supersession chains (unchanged from bootstrap register)

- kitluy-suite-rebuild-bible v1.0.0/v1.1.0/v3.0.0 → v4.0.0
- kitluy-suite-ecosystem-business-bible v1.0.0 → business bible v2.0.0
- kitluy-admin-pwa-portal-phase1-spec v3.0.0 → v3.1.0
- Product rebuild-bibles → Phase 1 product specs (per family)
- "Seller"-era documents → Partner-era documents
- Three-terminal model artifacts → owner-locked T1–T4 artifacts

## 4. Newly satisfied bootstrap blockers (supersession of "missing" status)

| Bootstrap gap                          | Now satisfied by                                                                                                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KLREQ-003 (Laundry state machines)     | docs/source/business-rules/kitluy-laundry-state-machines-v1.0.0.md + kitluy-transaction-and-booking-lifecycle-v1.0.0.md                                              |
| KLREQ-002 (Edge route contract)        | docs/source/offline/kitluy-storehub-lan-api-v1.0.0.md + docs/source/api-contracts/kitluy-edge-operations-api-v1.0.0.md (reconciliation verdict: see conflict report) |
| KLREQ-004 (Hub local schema naming)    | docs/source/offline/kitluy-storehub-local-database-schema-v1.0.0.md (verdict: see conflict report)                                                                   |
| Missing security/RBAC/audit registries | docs/source/security/ pack (11 documents)                                                                                                                            |
| Missing event/job/webhook registries   | docs/source/api-contracts/ events family (6 documents)                                                                                                               |
| Missing UI/UX pack                     | docs/source/ui-ux/ (21 documents)                                                                                                                                    |

## 5. Still missing (nothing to supersede)

- `Pasted text.txt` / kitluy-ai-build-readiness-document-program-v1.0.0.md —
  owner documentation-program instruction: **not physically present**.
- kitluy-suite-supabase-canonical-schema / rls-and-authorization /
  migration-plan (v1.0.0) — required by RB v4 §13.3; not in the Supabase pack.
- kitluy-master-feature-registry-v0.2.md / .json (CSV exists from bootstrap
  imports only).
- kitluy-store-hub-managed-device-security-lock-and-build-spec-v1.0.0.md.
