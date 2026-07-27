/**
 * @kitluy/edge-contracts — the canonical Edge Operations API route registry
 * consumed by the Store Hub and T1–T4 terminals.
 *
 * STATUS: contract registry BUILT + TESTED (`test/edge-routes.test.ts`).
 * NO Edge mutation handler exists anywhere in the repository, and this package
 * implements none. Publishing a route here is contract alignment, never
 * implementation evidence — statuses advance only with evidence recorded in
 * `docs/authority/kitluy-implementation-status-and-evidence-register-v1.0.0.md`.
 *
 * Authority: KLD-2026-07-26-002 (KL-DEC-001, OWNER-APPROVED 2026-07-27);
 * `docs/source/api-contracts/kitluy-edge-operations-api-v1.0.0.md`;
 * `docs/source/api-contracts/kitluy-api-scope-registry-v1.0.0.md`;
 * `docs/source/offline/kitluy-storehub-lan-api-v1.0.0.md`;
 * `docs/source/security/kitluy-suite-rbac-permission-registry-v1.0.0.csv`.
 *
 * Resolves conflict KLREC-2026-07-26-001 (route-shape fork) at the CONTRACT
 * layer only; see README.md for the reconciliation tables.
 */
export const PACKAGE_NAME = "@kitluy/edge-contracts" as const;

export * from "./audit-events.js";
export * from "./generic-routes.js";
export * from "./laundry-routes.js";
export * from "./permissions.js";
export * from "./registry.js";
export * from "./route-paths.js";
export * from "./scopes.js";
export * from "./terminal-profiles.js";
export * from "./types.js";
