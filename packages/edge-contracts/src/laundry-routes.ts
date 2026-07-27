/**
 * Laundry operational commands — `/edge/v1/laundry/*`.
 *
 * Source authority: KLD-2026-07-26-002 Group 1 (APPROVED) — 13 of the 22
 * approved route decisions.
 *
 * BOUNDARY NOTE (recorded, not silently resolved — CLAUDE.md hard rules 1 & 8):
 * CLAUDE.md hard rule 2 says Neutral Core (`packages/`) never contains Laundry
 * or other vertical terminology. Group 1 nevertheless places
 * `/edge/v1/laundry/*` INSIDE the Edge Operations API boundary, so the canonical
 * Edge route registry cannot be complete without it. The tension is resolved
 * structurally, not by exception:
 *   - vertical vocabulary is CONTRACT DATA (path literals, profile ids, event
 *     names), quarantined in this one module plus `terminal-profiles.ts`;
 *   - no Laundry business logic, state machine or type lives in this package;
 *   - this package has NO dependency, at build or runtime, on
 *     `verticals/phase1-laundry`.
 * The residual boundary question — whether the Laundry route table should
 * ultimately move to a vertical-owned Edge contract package — is OUT OF SCOPE
 * for KL-DEC-001-T002 and is reported for the reconciliation register.
 */
import {
  EDGE_ROUTE_LAUNDRY_BOOKING_CONFIRM_INTAKE,
  EDGE_ROUTE_LAUNDRY_BOOKING_DRAFTS,
  EDGE_ROUTE_LAUNDRY_PICKUP_SESSIONS,
  EDGE_ROUTE_LAUNDRY_PICKUP_SESSION_COLLECTOR_VERIFICATION,
  EDGE_ROUTE_LAUNDRY_PICKUP_SESSION_COMPLETE,
  EDGE_ROUTE_LAUNDRY_PICKUP_SESSION_PAYMENTS,
  EDGE_ROUTE_LAUNDRY_PICKUP_SESSION_SCANS,
  EDGE_ROUTE_LAUNDRY_READY_SESSIONS,
  EDGE_ROUTE_LAUNDRY_READY_SESSION_COMPLETE,
  EDGE_ROUTE_LAUNDRY_READY_SESSION_EXCEPTIONS,
  EDGE_ROUTE_LAUNDRY_READY_SESSION_QA,
  EDGE_ROUTE_LAUNDRY_READY_SESSION_SCANS,
  EDGE_ROUTE_LAUNDRY_READY_SESSION_STORAGE,
} from "./route-paths.js";
import {
  TERMINAL_PROFILE_T1_INTAKE_CASHIER,
  TERMINAL_PROFILE_T3_READY_SCAN_IN,
  TERMINAL_PROFILE_T4_PICKUP_SCAN_OUT,
} from "./terminal-profiles.js";
import type { EdgeRouteDefinition } from "./types.js";

const GROUP_1 = "KLD-2026-07-26-002 Group 1 (APPROVED)";

/**
 * T1 intake.
 *
 * `laundry.bookings.create` is the only registered T1 Booking-creation key
 * (RBAC registry: "Create authoritative Laundry Booking at T1/approved
 * channel", resource scope `store_location, terminal_role:T1`). The draft route
 * creates the local draft; confirm-intake is the finalisation that makes the
 * Booking authoritative and therefore carries the registered
 * `laundry_booking.created` domain event (EVT-LND-001).
 *
 * Price override is NOT a route-level approval: it is a payload condition that
 * additionally requires `laundry.bookings.price_override` (A2_REAUTH_MUTATION)
 * and is enforced by `@kitluy/approvals`, not by route metadata.
 */
const T1_BOOKING_ROUTES: readonly EdgeRouteDefinition[] = [
  {
    id: "laundry-booking-draft-create",
    method: "POST",
    path: EDGE_ROUTE_LAUNDRY_BOOKING_DRAFTS,
    family: "laundry",
    kind: "mutation",
    scope: "edge.bookings.create",
    scopeStatus: "registered",
    riskClass: "A1_STANDARD_MUTATION",
    credentialClass: "device_and_staff",
    permission: "laundry.bookings.create",
    permissionStatus: "registered",
    conditionalPermissions: ["laundry.bookings.price_override"],
    allowedTerminalProfiles: [TERMINAL_PROFILE_T1_INTAKE_CASHIER],
    idempotencyRequired: true,
    mutatesExistingAggregate: false,
    expectedVersionRequired: false,
    approvalRequired: false,
    auditEvent: "laundry_booking.draft_created",
    auditEventStatus: "proposed",
    authority: GROUP_1,
  },
  {
    id: "laundry-booking-confirm-intake",
    method: "POST",
    path: EDGE_ROUTE_LAUNDRY_BOOKING_CONFIRM_INTAKE,
    family: "laundry",
    kind: "mutation",
    scope: "edge.bookings.finalize",
    scopeStatus: "registered",
    riskClass: "A1_STANDARD_MUTATION",
    credentialClass: "device_and_staff",
    permission: "laundry.bookings.create",
    permissionStatus: "registered",
    conditionalPermissions: [],
    allowedTerminalProfiles: [TERMINAL_PROFILE_T1_INTAKE_CASHIER],
    idempotencyRequired: true,
    mutatesExistingAggregate: true,
    expectedVersionRequired: true,
    approvalRequired: false,
    auditEvent: "laundry_booking.created",
    auditEventStatus: "registered",
    authority: GROUP_1,
  },
];

/**
 * T3 Clean & Ready scan-in.
 *
 * `laundry.ready_scan_in` is the only registered T3 key (resource scope
 * `store_location, terminal_role:T3`). Every step of the Ready session is
 * therefore gated on it; a finer split needs new registered keys.
 * Each sub-resource route appends to an existing Ready-session aggregate, so
 * all of them require an expected version (Edge Ops API §5.6).
 */
const T3_READY_ROUTES: readonly EdgeRouteDefinition[] = [
  {
    id: "laundry-ready-session-open",
    method: "POST",
    path: EDGE_ROUTE_LAUNDRY_READY_SESSIONS,
    family: "laundry",
    kind: "mutation",
    scope: "edge.ready.open",
    scopeStatus: "registered",
    riskClass: "A1_STANDARD_MUTATION",
    credentialClass: "device_and_staff",
    permission: "laundry.ready_scan_in",
    permissionStatus: "registered",
    conditionalPermissions: [],
    allowedTerminalProfiles: [TERMINAL_PROFILE_T3_READY_SCAN_IN],
    idempotencyRequired: true,
    mutatesExistingAggregate: false,
    expectedVersionRequired: false,
    approvalRequired: false,
    auditEvent: "laundry_ready_session.opened",
    auditEventStatus: "proposed",
    authority: GROUP_1,
  },
  {
    id: "laundry-ready-session-scan",
    method: "POST",
    path: EDGE_ROUTE_LAUNDRY_READY_SESSION_SCANS,
    family: "laundry",
    kind: "mutation",
    scope: "edge.ready.scan",
    scopeStatus: "registered",
    riskClass: "A1_STANDARD_MUTATION",
    credentialClass: "device_and_staff",
    permission: "laundry.ready_scan_in",
    permissionStatus: "registered",
    conditionalPermissions: [],
    allowedTerminalProfiles: [TERMINAL_PROFILE_T3_READY_SCAN_IN],
    idempotencyRequired: true,
    mutatesExistingAggregate: true,
    expectedVersionRequired: true,
    approvalRequired: false,
    auditEvent: "garment.custody_scanned_in",
    auditEventStatus: "registered",
    authority: GROUP_1,
  },
  {
    id: "laundry-ready-session-qa",
    method: "POST",
    path: EDGE_ROUTE_LAUNDRY_READY_SESSION_QA,
    family: "laundry",
    kind: "mutation",
    scope: "edge.ready.qa",
    scopeStatus: "registered",
    riskClass: "A1_STANDARD_MUTATION",
    credentialClass: "device_and_staff",
    permission: "laundry.ready_scan_in",
    permissionStatus: "registered",
    conditionalPermissions: [],
    allowedTerminalProfiles: [TERMINAL_PROFILE_T3_READY_SCAN_IN],
    idempotencyRequired: true,
    mutatesExistingAggregate: true,
    expectedVersionRequired: true,
    approvalRequired: false,
    auditEvent: "laundry_ready_session.qa_recorded",
    auditEventStatus: "proposed",
    authority: GROUP_1,
  },
  {
    id: "laundry-ready-session-exception",
    method: "POST",
    path: EDGE_ROUTE_LAUNDRY_READY_SESSION_EXCEPTIONS,
    family: "laundry",
    kind: "mutation",
    scope: "edge.ready.exception",
    scopeStatus: "additive",
    riskClass: "A1_STANDARD_MUTATION",
    credentialClass: "device_and_staff",
    permission: "laundry.ready_scan_in",
    permissionStatus: "registered",
    conditionalPermissions: [],
    allowedTerminalProfiles: [TERMINAL_PROFILE_T3_READY_SCAN_IN],
    idempotencyRequired: true,
    mutatesExistingAggregate: true,
    expectedVersionRequired: true,
    approvalRequired: false,
    auditEvent: "laundry_ready_session.exception_recorded",
    auditEventStatus: "proposed",
    authority: GROUP_1,
  },
  {
    id: "laundry-ready-session-storage",
    method: "POST",
    path: EDGE_ROUTE_LAUNDRY_READY_SESSION_STORAGE,
    family: "laundry",
    kind: "mutation",
    scope: "edge.ready.storage",
    scopeStatus: "registered",
    riskClass: "A1_STANDARD_MUTATION",
    credentialClass: "device_and_staff",
    permission: "laundry.ready_scan_in",
    permissionStatus: "registered",
    conditionalPermissions: [],
    allowedTerminalProfiles: [TERMINAL_PROFILE_T3_READY_SCAN_IN],
    idempotencyRequired: true,
    mutatesExistingAggregate: true,
    expectedVersionRequired: true,
    approvalRequired: false,
    auditEvent: "laundry_ready_session.storage_assigned",
    auditEventStatus: "proposed",
    authority: GROUP_1,
  },
  {
    id: "laundry-ready-session-complete",
    method: "POST",
    path: EDGE_ROUTE_LAUNDRY_READY_SESSION_COMPLETE,
    family: "laundry",
    kind: "mutation",
    scope: "edge.ready.complete",
    scopeStatus: "registered",
    riskClass: "A1_STANDARD_MUTATION",
    credentialClass: "device_and_staff",
    permission: "laundry.ready_scan_in",
    permissionStatus: "registered",
    conditionalPermissions: [],
    allowedTerminalProfiles: [TERMINAL_PROFILE_T3_READY_SCAN_IN],
    idempotencyRequired: true,
    mutatesExistingAggregate: true,
    expectedVersionRequired: true,
    approvalRequired: false,
    auditEvent: "laundry_booking.ready",
    auditEventStatus: "registered",
    authority: GROUP_1,
  },
];

/**
 * T4 customer pickup scan-out.
 *
 * Every `edge.pickup.*` scope is `A2_REAUTH_MUTATION` in scope-registry §5:
 * fresh re-authentication / manager confirmation is required in addition to the
 * standard mutation controls. That is a re-auth obligation, NOT four-eyes
 * approval — no Group 1 route is `A3_FOUR_EYES`, so `approvalRequired` is false
 * throughout and the A2 obligation is carried by `riskClass`.
 *
 * The payments route accepts the allowed remaining balance. Cash is the primary
 * registered permission; the KHQR branch additionally requires
 * `payments.khqr.create`. Neither branch may mark a Booking paid without
 * authoritative confirmation (KLD-2026-07-26-002 Group 5, `PAYMENT_PENDING`).
 */
const T4_PICKUP_ROUTES: readonly EdgeRouteDefinition[] = [
  {
    id: "laundry-pickup-session-open",
    method: "POST",
    path: EDGE_ROUTE_LAUNDRY_PICKUP_SESSIONS,
    family: "laundry",
    kind: "mutation",
    scope: "edge.pickup.open",
    scopeStatus: "registered",
    riskClass: "A2_REAUTH_MUTATION",
    credentialClass: "device_and_staff",
    permission: "laundry.pickup_scan_out",
    permissionStatus: "registered",
    conditionalPermissions: [],
    allowedTerminalProfiles: [TERMINAL_PROFILE_T4_PICKUP_SCAN_OUT],
    idempotencyRequired: true,
    mutatesExistingAggregate: false,
    expectedVersionRequired: false,
    approvalRequired: false,
    auditEvent: "laundry_pickup_session.opened",
    auditEventStatus: "proposed",
    authority: GROUP_1,
  },
  {
    id: "laundry-pickup-session-verify-collector",
    method: "POST",
    path: EDGE_ROUTE_LAUNDRY_PICKUP_SESSION_COLLECTOR_VERIFICATION,
    family: "laundry",
    kind: "mutation",
    scope: "edge.pickup.verify_collector",
    scopeStatus: "registered",
    riskClass: "A2_REAUTH_MUTATION",
    credentialClass: "device_and_staff",
    permission: "laundry.pickup_scan_out",
    permissionStatus: "registered",
    conditionalPermissions: [],
    allowedTerminalProfiles: [TERMINAL_PROFILE_T4_PICKUP_SCAN_OUT],
    idempotencyRequired: true,
    mutatesExistingAggregate: true,
    expectedVersionRequired: true,
    approvalRequired: false,
    auditEvent: "laundry_pickup_session.collector_verified",
    auditEventStatus: "proposed",
    authority: GROUP_1,
  },
  {
    id: "laundry-pickup-session-scan",
    method: "POST",
    path: EDGE_ROUTE_LAUNDRY_PICKUP_SESSION_SCANS,
    family: "laundry",
    kind: "mutation",
    scope: "edge.pickup.scan",
    scopeStatus: "registered",
    riskClass: "A2_REAUTH_MUTATION",
    credentialClass: "device_and_staff",
    permission: "laundry.pickup_scan_out",
    permissionStatus: "registered",
    conditionalPermissions: [],
    allowedTerminalProfiles: [TERMINAL_PROFILE_T4_PICKUP_SCAN_OUT],
    idempotencyRequired: true,
    mutatesExistingAggregate: true,
    expectedVersionRequired: true,
    approvalRequired: false,
    auditEvent: "garment.custody_scanned_out",
    auditEventStatus: "registered",
    authority: GROUP_1,
  },
  {
    id: "laundry-pickup-session-payment",
    method: "POST",
    path: EDGE_ROUTE_LAUNDRY_PICKUP_SESSION_PAYMENTS,
    family: "laundry",
    kind: "mutation",
    scope: "edge.pickup.payment",
    scopeStatus: "registered",
    riskClass: "A2_REAUTH_MUTATION",
    credentialClass: "device_and_staff",
    permission: "payments.capture.cash",
    permissionStatus: "registered",
    conditionalPermissions: ["payments.khqr.create"],
    allowedTerminalProfiles: [TERMINAL_PROFILE_T4_PICKUP_SCAN_OUT],
    idempotencyRequired: true,
    mutatesExistingAggregate: true,
    expectedVersionRequired: true,
    approvalRequired: false,
    auditEvent: "payment.recorded",
    auditEventStatus: "registered",
    authority: GROUP_1,
  },
  {
    id: "laundry-pickup-session-complete",
    method: "POST",
    path: EDGE_ROUTE_LAUNDRY_PICKUP_SESSION_COMPLETE,
    family: "laundry",
    kind: "mutation",
    scope: "edge.pickup.release",
    scopeStatus: "registered",
    riskClass: "A2_REAUTH_MUTATION",
    credentialClass: "device_and_staff",
    permission: "laundry.booking.complete",
    permissionStatus: "registered",
    conditionalPermissions: ["laundry.pickup_scan_out"],
    allowedTerminalProfiles: [TERMINAL_PROFILE_T4_PICKUP_SCAN_OUT],
    idempotencyRequired: true,
    mutatesExistingAggregate: true,
    expectedVersionRequired: true,
    approvalRequired: false,
    auditEvent: "laundry_booking.completed",
    auditEventStatus: "proposed",
    authority: GROUP_1,
  },
];

/** All 13 approved Laundry Edge routes. */
export const LAUNDRY_EDGE_ROUTES: readonly EdgeRouteDefinition[] = [
  ...T1_BOOKING_ROUTES,
  ...T3_READY_ROUTES,
  ...T4_PICKUP_ROUTES,
];
