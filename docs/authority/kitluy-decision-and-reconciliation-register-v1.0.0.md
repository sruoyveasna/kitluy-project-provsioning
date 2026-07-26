# KitLuy Decision and Reconciliation Register — v1.0.0

Created at bootstrap (KL-BOOTSTRAP-001, 2026-07-26). Records (a) conflicts
between sources that must not be silently resolved, and (b) decisions made
during repository work. Owner-locked decisions from the bibles are indexed at
the bottom for traceability.

## A. Open conflicts (require owner/spec reconciliation)

### KLREC-2026-07-26-001 — `/edge/v1` route shapes diverge (OPEN, HIGH)

- **Sources:** Store Hub spec v1.0.0 §9.2 vs POS Desktop spec v4.0.0 §14.2 —
  both level-4 authority, same date, same version prefix, incompatible paths
  and resource models (e.g. `POST /edge/v1/bookings` + `/session/open` +
  `/ready-scan/sessions` vs `POST /edge/v1/laundry/bookings/drafts` +
  `/finalize` + `/sessions/login` + `/laundry/ready-sessions`).
- **Handling:** Neither shape adopted. The Edge Operations OpenAPI file and the
  Hub LAN kernel implement only the routes both specs agree on (health,
  identity, sync status); mutating LAN routes are blocked with an error that
  cites this entry.
- **Affected files:** `services/kitluy-edge-operations-api/openapi.yaml`,
  `services/kitluy-hub-agent/src/lan-api.ts`.
- **Resolution needed:** a versioned owner decision or a reconciled Edge
  Operations API v1 contract.

### KLREC-2026-07-26-002 — Hub vs POS local schema entity names (OPEN, MEDIUM)

- **Sources:** Hub spec §8.2 (`laundry_booking_lines`, `laundry_garments`,
  `custody_events`, `storage_positions`) vs POS spec §13.2 (`booking_lines`,
  `garments`/`booking_units`, `garment_scan_events`, `ready_storage_positions`).
  POS spec itself concedes "Exact names must be reconciled with live migrations."
- **Handling:** No local DDL authored. Resolved by the future canonical Hub
  local-schema migration pack.

### KLREC-2026-07-26-003 — Business-bible register inconsistency (OPEN, LOW)

- **Sources:** RB v4 App. A.3/§13.2 lists ecosystem-business-bible v1.0.0 as a
  current supporting bible, while BB v2.0.0 (same day) supersedes it.
- **Handling:** Per RB §13.2's own caveat, v1.0.0 is retained for
  non-conflicting detail only and registered as SUPERSEDED.

### KLREC-2026-07-26-004 — Master feature registry exists only as CSV (OPEN, MEDIUM)

- **Sources:** b2b-website and storehub specs cite
  `kitluy-master-feature-registry-v0.2.md`; only `...v0.2.csv` (441 rows)
  exists on this machine; `.json` also missing.
- **Handling:** CSV imported as the only surviving form. Regenerating .md/.json
  from the CSV is a candidate next task requiring owner confirmation that the
  CSV is complete.

## B. Bootstrap decisions (engineering, not owner-locked)

| ID             | Decision                                                                                                                                                                        | Where recorded                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| KLBOOT-DEC-001 | Engineering defaults for the blank repository (pnpm, Turborepo, strict TS, ESLint/Prettier, Vitest, Playwright-later, Supabase CLI, Terraform, GitHub Actions, OCI)             | [ADR-0001](../decisions/adr-0001-engineering-defaults.md)   |
| KLBOOT-DEC-002 | Application framework choices per product; React Native shells are typecheck-only pending full Expo generation                                                                  | [ADR-0002](../decisions/adr-0002-application-frameworks.md) |
| KLBOOT-DEC-003 | Zero-dependency node:http service kernels for scaffolds (framework choice deferred until first real service)                                                                    | [ADR-0003](../decisions/adr-0003-service-kernel.md)         |
| KLBOOT-DEC-004 | Electron binary download skipped repo-wide via pnpm.neverBuiltDependencies                                                                                                      | [ADR-0004](../decisions/adr-0004-electron-binary-skip.md)   |
| KLBOOT-DEC-005 | No Supabase DDL authored at bootstrap; migration linter + conventions only                                                                                                      | [ADR-0005](../decisions/adr-0005-no-invented-ddl.md)        |
| KLBOOT-DEC-006 | Missing governance files recreated as v1.0.0 in docs/authority with found-original-wins reconciliation rule                                                                     | Source-of-truth index                                       |
| KLBOOT-DEC-007 | Prior repo `KITLUY-SUITE-REPO (MAIN)` (Synology) NOT imported: it predates the July 24–26 canonical spec wave and embeds superseded models; treated as PRIOR-CODE evidence only | Manifest; this register                                     |

## C. Owner-locked decision index (for traceability; full text in RB v4)

KLV4-DEC-001 eight-phase roadmap · KLV4-DEC-002 one Digital Store/one primary
vertical · KLV4-DEC-003 Digital-Store-first · KLV4-DEC-004 Extended WooCommerce
baseline · KLV4-DEC-005 T1–T4 (2026-07-21) · KLV4-DEC-006 smartphone-simple
provisioning · KLV4-DEC-007 closed HET managed-device Store Hub ·
KLV4-DEC-008 Kubernetes-ready-not-first · KLV4-DEC-009 Admin v3.1
authorization · KLV4-DEC-010 B2B website canonical · KLV4-DEC-011 Storefront
pre-intake/queue · KLV4-DEC-012 Cambodia-first stack — plus
KLD-2026-07-24-001 (12 Master-Feature decisions: KLMF-CUS-002=B,
KLMF-FIN-005=B, KLMF-INT-001=B, KLMF-INT-002=B, KLMF-PAY-004=B,
KLMF-PAY-005=B, KLMF-PAY-011=B, KLMF-PAY-014=C rejected, KLMF-PAY-025=B,
KLMF-PRC-008=B, KLMF-REP-010=C no reporting paywall, KLMF-RES-004=B).
