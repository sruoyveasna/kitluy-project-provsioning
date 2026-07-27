/**
 * Edge Operations API scopes.
 *
 * Source authority:
 * - `docs/source/api-contracts/kitluy-api-scope-registry-v1.0.0.md` §2 (naming
 *   and lifecycle rules) and §5 (the canonical scope table). §5 is the ONLY
 *   place a scope counts as REGISTERED.
 * - `docs/source/api-contracts/kitluy-edge-operations-api-v1.0.0.md` §4.4
 *   (scope groups) and §9 (route catalogue) for names the surface contract
 *   references but §5 has not yet registered.
 * - KLD-2026-07-26-002 Group 1 authorises "additive registration of all missing
 *   generic Edge API scopes required by the approved route catalogue".
 *
 * Registry rules honoured here (§2):
 * - lowercase dot-separated keys;
 * - explicit verb/action, no `admin` or `full_access` scopes;
 * - read and write are separate scopes;
 * - additive keys never repurpose an existing key.
 *
 * A scope grants a TYPE OF ACTION only. It never implies a permission, a
 * resource scope, an environment scope, a device/profile authorisation, an
 * approval or RLS clearance (scope registry §1, §3; KLD-2026-07-26-002 Group 1:
 * "No API scope alone grants authority").
 */

/** Scopes already present in the canonical registry table (§5). */
export const REGISTERED_EDGE_SCOPES = [
  "edge.bookings.create",
  "edge.bookings.update_draft",
  "edge.bookings.finalize",
  "edge.payments.record",
  "edge.display.open",
  "edge.display.read",
  "edge.display.update",
  "edge.display.close",
  "edge.ready.open",
  "edge.ready.scan",
  "edge.ready.qa",
  "edge.ready.storage",
  "edge.ready.complete",
  "edge.pickup.open",
  "edge.pickup.verify_collector",
  "edge.pickup.scan",
  "edge.pickup.payment",
  "edge.pickup.release",
  "edge.sync.read",
  "edge.sync.push",
  "edge.sync.pull",
] as const;

/**
 * ADDITIVE scopes introduced by KL-DEC-001-T002 under the Group 1 additive
 * registration authority. Each one is required by an approved Group 1 route and
 * has no equivalent in scope-registry §5. They must be merged into §5 before the
 * Edge surface is released; until then they are marked `additive` on every route
 * that uses them.
 *
 * Minimal-additive discipline: no approval, shift, cash, diagnostics, support,
 * printing, peripheral, file or device-operation scope is introduced here,
 * because no Group 1 route needs one. Those remain future additive work.
 */
export const ADDITIVE_EDGE_SCOPES = [
  /** Open a Hub-issued terminal session. Named in Edge Ops API §9.1 (`/sessions/login`), absent from registry §5. */
  "edge.session.open",
  /** Rotate a short-lived Hub session token (Store Hub LAN API §`POST /sessions/refresh`). New key. */
  "edge.session.refresh",
  /** Switch the staff actor bound to an open session. Named in Edge Ops API §9.1, absent from registry §5. */
  "edge.session.switch",
  /** Close a session and clear profile state (Store Hub LAN API §`POST /sessions/close`). New key. */
  "edge.session.close",
  /** Record a customer-originated T2 action (language, receipt choice, confirmation). */
  "edge.display.customer_action",
  /** Record a Ready-session exception. Edge Ops API §9.4 has no exception scope. */
  "edge.ready.exception",
] as const;

export const EDGE_API_SCOPES = [...REGISTERED_EDGE_SCOPES, ...ADDITIVE_EDGE_SCOPES] as const;

export type EdgeApiScope = (typeof EDGE_API_SCOPES)[number];

/** Whether a scope is already in scope-registry §5 or introduced additively here. */
export type EdgeScopeStatus = "registered" | "additive";

export function edgeScopeStatus(scope: EdgeApiScope): EdgeScopeStatus {
  return (REGISTERED_EDGE_SCOPES as readonly string[]).includes(scope) ? "registered" : "additive";
}

/**
 * Scope-name reconciliation.
 *
 * The KL-DEC-001 Cycle-7 working instruction used a second, informal scope
 * grammar (`edge.ready.session.create`, `edge.pickup.collector_verify`, ...).
 * The canonical registry grammar wins (scope registry §2, §5). Nothing in the
 * repository ever used the informal names, so no alias layer exists — this table
 * is a documentation-only reconciliation, recorded so the difference is explicit
 * rather than silently resolved (CLAUDE.md hard rule 8).
 */
export interface ScopeReconciliationEntry {
  /** Name used in the KL-DEC-001 Cycle-7 working instruction. */
  readonly instructionName: string;
  /** Canonical name used by this registry. */
  readonly canonicalName: EdgeApiScope;
  readonly canonicalStatus: EdgeScopeStatus;
  readonly note: string;
}

export const SCOPE_NAME_RECONCILIATION: readonly ScopeReconciliationEntry[] = [
  {
    instructionName: "edge.ready.session.create",
    canonicalName: "edge.ready.open",
    canonicalStatus: "registered",
    note: "Registry §5 already registers edge.ready.open for 'Open T3 session'.",
  },
  {
    instructionName: "edge.ready.session.scan",
    canonicalName: "edge.ready.scan",
    canonicalStatus: "registered",
    note: "Registry §5 registers edge.ready.scan for 'Scan Ready items'.",
  },
  {
    instructionName: "edge.ready.session.qa",
    canonicalName: "edge.ready.qa",
    canonicalStatus: "registered",
    note: "Registry §5 registers edge.ready.qa for 'Record QA'.",
  },
  {
    instructionName: "edge.ready.session.storage",
    canonicalName: "edge.ready.storage",
    canonicalStatus: "registered",
    note: "Registry §5 registers edge.ready.storage for 'Assign storage'.",
  },
  {
    instructionName: "edge.ready.session.complete",
    canonicalName: "edge.ready.complete",
    canonicalStatus: "registered",
    note: "Registry §5 registers edge.ready.complete for 'Complete Ready transition'.",
  },
  {
    instructionName: "edge.ready.session.exception",
    canonicalName: "edge.ready.exception",
    canonicalStatus: "additive",
    note: "No exception scope exists in registry §5 or Edge Ops API §9.4. ADDITIVE.",
  },
  {
    instructionName: "edge.pickup.session.create",
    canonicalName: "edge.pickup.open",
    canonicalStatus: "registered",
    note: "Registry §5 registers edge.pickup.open for 'Open T4 session'.",
  },
  {
    instructionName: "edge.pickup.collector_verify",
    canonicalName: "edge.pickup.verify_collector",
    canonicalStatus: "registered",
    note: "Registry §5 registers edge.pickup.verify_collector; verb order differs only.",
  },
  {
    instructionName: "edge.pickup.session.scan",
    canonicalName: "edge.pickup.scan",
    canonicalStatus: "registered",
    note: "Registry §5 registers edge.pickup.scan.",
  },
  {
    instructionName: "edge.pickup.session.payment",
    canonicalName: "edge.pickup.payment",
    canonicalStatus: "registered",
    note: "Registry §5 registers edge.pickup.payment for 'Collect allowed balance'.",
  },
  {
    instructionName: "edge.pickup.session.complete",
    canonicalName: "edge.pickup.release",
    canonicalStatus: "registered",
    note: "Registry §5 registers edge.pickup.release ('Release custody'); the APPROVED route path is /complete while the registered scope keeps the release verb. Route path and scope name are separate vocabularies and are not forced to match.",
  },
  {
    instructionName: "edge.session.create",
    canonicalName: "edge.session.open",
    canonicalStatus: "additive",
    note: "Edge Ops API §9.1 names edge.session.open; registry §5 does not list it. ADDITIVE.",
  },
  {
    instructionName: "edge.session.refresh",
    canonicalName: "edge.session.refresh",
    canonicalStatus: "additive",
    note: "Not named in any canonical registry. ADDITIVE, grammar-conformant.",
  },
  {
    instructionName: "edge.session.switch",
    canonicalName: "edge.session.switch",
    canonicalStatus: "additive",
    note: "Edge Ops API §9.1 names edge.session.switch; registry §5 does not list it. ADDITIVE.",
  },
  {
    instructionName: "edge.session.close",
    canonicalName: "edge.session.close",
    canonicalStatus: "additive",
    note: "Not named in any canonical registry. ADDITIVE, grammar-conformant.",
  },
  {
    instructionName: "edge.display.session.create",
    canonicalName: "edge.display.open",
    canonicalStatus: "registered",
    note: "Registry §5 registers edge.display.open for 'Open T2 session'.",
  },
  {
    instructionName: "edge.display.session.update",
    canonicalName: "edge.display.update",
    canonicalStatus: "registered",
    note: "Registry §5 registers edge.display.update for 'Update T2 state'.",
  },
  {
    instructionName: "edge.display.session.read",
    canonicalName: "edge.display.read",
    canonicalStatus: "registered",
    note: "Registry §5 registers edge.display.read for 'Read T2 stream'.",
  },
  {
    instructionName: "edge.display.session.close",
    canonicalName: "edge.display.close",
    canonicalStatus: "registered",
    note: "Registry §5 registers edge.display.close for 'Close T2 session'.",
  },
  {
    instructionName: "edge.display.receipt_choice",
    canonicalName: "edge.display.customer_action",
    canonicalStatus: "additive",
    note: "Edge Ops API §9.3 named edge.display.receipt_choice for the REJECTED route /displays/sessions/{id}/receipt-choice. The APPROVED route /display-sessions/{id}/customer-actions is broader (language, receipt choice, confirmation), so an ADDITIVE scope is registered instead of widening the meaning of a named scope (registry §2: scope meaning is immutable, deprecation creates a new key).",
  },
  {
    instructionName: "edge.bookings.draft_create",
    canonicalName: "edge.bookings.create",
    canonicalStatus: "registered",
    note: "Registry §5 registers edge.bookings.create for 'Create local Booking'.",
  },
  {
    instructionName: "edge.bookings.confirm_intake",
    canonicalName: "edge.bookings.finalize",
    canonicalStatus: "registered",
    note: "Registry §5 registers edge.bookings.finalize for 'Finalize Booking'; confirm-intake IS the finalisation step of the approved route catalogue.",
  },
];
