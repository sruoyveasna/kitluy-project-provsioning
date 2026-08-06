/**
 * Actor permission keys required by Edge routes.
 *
 * Source authority:
 * - KLD-2026-07-26-002 Group 3 (APPROVED): the canonical permission grammar is
 *   `<domain>.<resource_or_capability>.<verb>` and the existing 107-key
 *   registry `docs/source/security/kitluy-suite-rbac-permission-registry-v1.0.0.csv`
 *   is the canonical baseline. Released keys are immutable; unknown or
 *   deprecated keys fail closed; production wildcards are prohibited.
 * - Scope registry §1/§3 and Group 3: permission, API scope, resource scope,
 *   environment scope, device/profile authorisation and approval policy are
 *   SEPARATE authorisation dimensions. No identifier may collapse them.
 *
 * This module deliberately does NOT depend on `@kitluy/rbac`: that package is
 * being changed concurrently under a different task, and the values below are
 * contract data quoted verbatim from the CSV registry, not an evaluation engine.
 * `test/edge-routes.test.ts` reads the CSV directly and fails if any key marked
 * `registered` is not actually present in it.
 */

/**
 * Permission keys quoted from the 107-key registry that Edge Group 1 routes
 * require. Each string must exist verbatim in the CSV registry.
 */
export const EDGE_REGISTERED_PERMISSIONS = [
  /** "Create authoritative Laundry Booking at T1/approved channel" — terminal_role:T1. */
  "laundry.bookings.create",
  /** "Override calculated price before finalization" — terminal_role:T1, A2_REAUTH_MUTATION. */
  "laundry.bookings.price_override",
  /** "Record T3 Clean & Ready custody scan-in" — terminal_role:T3. */
  "laundry.ready_scan_in",
  /** "Record T4 customer pickup and custody release" — terminal_role:T4. */
  "laundry.pickup_scan_out",
  /** "Complete Booking after payment/custody conditions" — terminal_role:T4. */
  "laundry.booking.complete",
  /** "Record cash tender at authorized T1/T4 workflow" — terminal_role:T1|T4. */
  "payments.capture.cash",
  /** "Create KHQR payment request through approved adapter" — terminal_role:T1|T4. */
  "payments.khqr.create",
  // Amendment 002 (KLD-2026-08-06-WS12-T001-EDGE-BOOTSTRAP-001 §4): Edge
  // terminal staff sessions and the T1 shell permission. Quoted from
  // docs/security/kitluy-suite-rbac-permission-registry-amendment-002-
  // t1-staff-sessions-v1.0.0.md (the imported v1.0.0 CSV is never edited).
  /** "Open a Hub-issued Edge terminal staff session". */
  "staff.sessions.open",
  /** "Read the state of an Edge terminal staff session". */
  "staff.sessions.read",
  /** "Extend an open Edge terminal staff session within governed policy". */
  "staff.sessions.refresh",
  /** "Close an Edge terminal staff session and clear profile state". */
  "staff.sessions.close",
  /** "Operate the T1 POS Cashier / Intake shell" — session membership alone never grants it. */
  "pos.t1.use",
  // Amendment 003 (KLD-2026-08-06-WS12-T002-001 §2/§3): T1 customer intake
  // and consent. Quoted from docs/security/kitluy-suite-rbac-permission-
  // registry-amendment-003-t1-customer-and-consent-v1.0.0.md. Booking-DRAFT
  // permissions are deliberately NOT new keys: draft read reuses
  // `laundry.bookings.read` and draft create/update/cancel reuse
  // `laundry.bookings.create` (the recorded command-registry precedent —
  // no synonymous duplicates, owner rule).
  /** "Search and read scoped customer records at an authorized terminal". */
  "customers.read",
  /** "Create a minimal unverified customer during T1 intake". */
  "customers.create",
  /** "Record an explicit customer consent decision with immutable evidence". */
  "customers.consent.record",
  /** "Read Laundry Booking and custody status" — registry row 94; gates draft reads. */
  "laundry.bookings.read",
] as const;

export type EdgeRegisteredPermission = (typeof EDGE_REGISTERED_PERMISSIONS)[number];

/**
 * Marker prefix for a permission key the 107-key registry does not define.
 *
 * CLAUDE.md hard rule 9: unknown owner/security values stay `[REQUIRED: ...]`
 * and are never guessed. KLD-2026-07-26-002 Group 3 makes released keys
 * immutable and requires `rbac.permission_registry_manage` (A4_OWNER_SECURITY,
 * "Required + impact assessment") to register a new one — which this task does
 * not hold. A route carrying a `[REQUIRED: ...]` permission therefore declares a
 * known gap and FAILS CLOSED; it must never be treated as authorised.
 */
export const PERMISSION_REQUIRED_MARKER_PREFIX = "[REQUIRED:";

export function isRequiredPermissionMarker(value: string): boolean {
  return value.startsWith(PERMISSION_REQUIRED_MARKER_PREFIX) && value.endsWith("]");
}

/**
 * Known permission gaps, one entry per distinct missing capability. Reported to
 * the owner for registration under `rbac.permission_registry_manage`.
 *
 * RESOLVED 2026-08-06 (KLD-2026-08-06-WS12-T001-EDGE-BOOTSTRAP-001 §4 /
 * Amendment 002): the four former `PERMISSION_GAP_EDGE_SESSION_*` markers.
 * Their capabilities are now the registered keys `staff.sessions.open`,
 * `staff.sessions.refresh`, `staff.sessions.close` (and `staff.sessions.open`
 * + conditional `staff.sessions.close` for `sessions-switch` — recorded
 * interpretation, amendment §2), plus `staff.sessions.read` and `pos.t1.use`.
 */
export const PERMISSION_GAP_EDGE_DISPLAY_MANAGE =
  "[REQUIRED: RBAC permission key for opening, updating and closing a T2 customer-display session from T1 — absent from kitluy-suite-rbac-permission-registry-v1.0.0.csv]";

export const PERMISSION_GAP_EDGE_DISPLAY_READ =
  "[REQUIRED: RBAC permission key for an assigned T2 device to read its own customer-safe display state — absent from kitluy-suite-rbac-permission-registry-v1.0.0.csv]";

export const PERMISSION_GAP_EDGE_DISPLAY_CUSTOMER_ACTION =
  "[REQUIRED: RBAC permission key for recording a customer-originated T2 action (language, receipt choice, confirmation) as consent evidence — absent from kitluy-suite-rbac-permission-registry-v1.0.0.csv]";

/** All declared gaps, for reporting and for the completeness test. */
export const EDGE_PERMISSION_GAPS = [
  PERMISSION_GAP_EDGE_DISPLAY_MANAGE,
  PERMISSION_GAP_EDGE_DISPLAY_READ,
  PERMISSION_GAP_EDGE_DISPLAY_CUSTOMER_ACTION,
] as const;

export type EdgePermissionGap = (typeof EDGE_PERMISSION_GAPS)[number];

/** A route's permission is either a registered key or an explicit gap marker. */
export type EdgePermission = EdgeRegisteredPermission | EdgePermissionGap;

/** Whether the permission is registered in the 107-key baseline or still missing. */
export type PermissionRegistryStatus = "registered" | "required";

export function permissionRegistryStatus(permission: string): PermissionRegistryStatus {
  return isRequiredPermissionMarker(permission) ? "required" : "registered";
}

/**
 * Grammar for a registered permission key (Group 3:
 * `<domain>.<resource_or_capability>.<verb>`, lowercase dot-separated). Two
 * segments are accepted because the canonical baseline itself contains
 * two-segment capability keys such as `laundry.ready_scan_in`.
 */
export const PERMISSION_KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
