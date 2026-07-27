/**
 * Generic shared Edge operations — `/edge/v1/*`.
 *
 * Source authority: KLD-2026-07-26-002 Group 1 (APPROVED) — 9 of the 22
 * approved route decisions. These routes carry NO vertical terminology in their
 * paths; the Laundry catalogue lives in `laundry-routes.ts`.
 *
 * Status ceiling (KL-DEC-001-T002): contract alignment only. No Edge mutation
 * business workflow is integration-verified, and nothing here authorises a
 * handler.
 */
import {
  PERMISSION_GAP_EDGE_DISPLAY_CUSTOMER_ACTION,
  PERMISSION_GAP_EDGE_DISPLAY_MANAGE,
  PERMISSION_GAP_EDGE_DISPLAY_READ,
  PERMISSION_GAP_EDGE_SESSION_CLOSE,
  PERMISSION_GAP_EDGE_SESSION_OPEN,
  PERMISSION_GAP_EDGE_SESSION_REFRESH,
  PERMISSION_GAP_EDGE_SESSION_SWITCH,
} from "./permissions.js";
import {
  EDGE_ROUTE_DISPLAY_SESSION,
  EDGE_ROUTE_DISPLAY_SESSIONS,
  EDGE_ROUTE_DISPLAY_SESSION_CLOSE,
  EDGE_ROUTE_DISPLAY_SESSION_CUSTOMER_ACTIONS,
  EDGE_ROUTE_SESSIONS_CLOSE,
  EDGE_ROUTE_SESSIONS_OPEN,
  EDGE_ROUTE_SESSIONS_REFRESH,
  EDGE_ROUTE_SESSIONS_SWITCH,
} from "./route-paths.js";
import {
  TERMINAL_PROFILE_T1_INTAKE_CASHIER,
  TERMINAL_PROFILE_T2_CUSTOMER_DISPLAY,
  TERMINAL_PROFILE_T3_READY_SCAN_IN,
  TERMINAL_PROFILE_T4_PICKUP_SCAN_OUT,
} from "./terminal-profiles.js";
import type { EdgeRouteDefinition } from "./types.js";

const GROUP_1 = "KLD-2026-07-26-002 Group 1 (APPROVED)";

/**
 * Session routes.
 *
 * `sessions/open`, `sessions/refresh` and `sessions/close` authenticate on the
 * device certificate / the session itself (Store Hub LAN API §"Session and
 * approval surface"), so their credential class is `device`; T2 needs them to
 * bring up a dedicated customer-display client. `sessions/switch` changes the
 * bound STAFF actor and is therefore `device_and_staff` and T2-prohibited —
 * T2 has no actor and no operational authority (Terminal Profile Contract §6.1).
 *
 * None of the four mutates a versioned business aggregate, so none carries an
 * expected-version requirement (Edge Ops API §5.6 requires it only where
 * lost-update risk exists). All four are idempotent-by-key mutations.
 */
const SESSION_ROUTES: readonly EdgeRouteDefinition[] = [
  {
    id: "sessions-open",
    method: "POST",
    path: EDGE_ROUTE_SESSIONS_OPEN,
    family: "generic",
    kind: "mutation",
    scope: "edge.session.open",
    scopeStatus: "additive",
    riskClass: "A1_STANDARD_MUTATION",
    credentialClass: "device",
    permission: PERMISSION_GAP_EDGE_SESSION_OPEN,
    permissionStatus: "required",
    conditionalPermissions: [],
    allowedTerminalProfiles: [
      TERMINAL_PROFILE_T1_INTAKE_CASHIER,
      TERMINAL_PROFILE_T2_CUSTOMER_DISPLAY,
      TERMINAL_PROFILE_T3_READY_SCAN_IN,
      TERMINAL_PROFILE_T4_PICKUP_SCAN_OUT,
    ],
    idempotencyRequired: true,
    mutatesExistingAggregate: false,
    expectedVersionRequired: false,
    approvalRequired: false,
    auditEvent: "edge_session.opened",
    auditEventStatus: "proposed",
    authority: GROUP_1,
  },
  {
    id: "sessions-refresh",
    method: "POST",
    path: EDGE_ROUTE_SESSIONS_REFRESH,
    family: "generic",
    kind: "mutation",
    scope: "edge.session.refresh",
    scopeStatus: "additive",
    riskClass: "A1_STANDARD_MUTATION",
    credentialClass: "device",
    permission: PERMISSION_GAP_EDGE_SESSION_REFRESH,
    permissionStatus: "required",
    conditionalPermissions: [],
    allowedTerminalProfiles: [
      TERMINAL_PROFILE_T1_INTAKE_CASHIER,
      TERMINAL_PROFILE_T2_CUSTOMER_DISPLAY,
      TERMINAL_PROFILE_T3_READY_SCAN_IN,
      TERMINAL_PROFILE_T4_PICKUP_SCAN_OUT,
    ],
    idempotencyRequired: true,
    mutatesExistingAggregate: false,
    expectedVersionRequired: false,
    approvalRequired: false,
    auditEvent: "edge_session.refreshed",
    auditEventStatus: "proposed",
    authority: GROUP_1,
  },
  {
    id: "sessions-switch",
    method: "POST",
    path: EDGE_ROUTE_SESSIONS_SWITCH,
    family: "generic",
    kind: "mutation",
    scope: "edge.session.switch",
    scopeStatus: "additive",
    riskClass: "A1_STANDARD_MUTATION",
    credentialClass: "device_and_staff",
    permission: PERMISSION_GAP_EDGE_SESSION_SWITCH,
    permissionStatus: "required",
    conditionalPermissions: [],
    allowedTerminalProfiles: [
      TERMINAL_PROFILE_T1_INTAKE_CASHIER,
      TERMINAL_PROFILE_T3_READY_SCAN_IN,
      TERMINAL_PROFILE_T4_PICKUP_SCAN_OUT,
    ],
    idempotencyRequired: true,
    mutatesExistingAggregate: false,
    expectedVersionRequired: false,
    approvalRequired: false,
    auditEvent: "edge_session.actor_switched",
    auditEventStatus: "proposed",
    authority: GROUP_1,
  },
  {
    id: "sessions-close",
    method: "POST",
    path: EDGE_ROUTE_SESSIONS_CLOSE,
    family: "generic",
    kind: "mutation",
    scope: "edge.session.close",
    scopeStatus: "additive",
    riskClass: "A1_STANDARD_MUTATION",
    credentialClass: "device",
    permission: PERMISSION_GAP_EDGE_SESSION_CLOSE,
    permissionStatus: "required",
    conditionalPermissions: [],
    allowedTerminalProfiles: [
      TERMINAL_PROFILE_T1_INTAKE_CASHIER,
      TERMINAL_PROFILE_T2_CUSTOMER_DISPLAY,
      TERMINAL_PROFILE_T3_READY_SCAN_IN,
      TERMINAL_PROFILE_T4_PICKUP_SCAN_OUT,
    ],
    idempotencyRequired: true,
    mutatesExistingAggregate: false,
    expectedVersionRequired: false,
    approvalRequired: false,
    auditEvent: "edge_session.closed",
    auditEventStatus: "proposed",
    authority: GROUP_1,
  },
];

/**
 * Customer-display (T2) session routes.
 *
 * Credential class is `device` for the whole group (scope registry §5 lists
 * `edge.display.*` as `device`). T1 owns open/update/close; the assigned T2
 * device owns read and customer-actions (Store Hub LAN API §"Customer display
 * surface"). None of these routes is a staff mutation, which is why T2 may
 * appear in the allow-list without breaching the T2 prohibition — a customer
 * action is consent evidence, not staff authority (Terminal Profile Contract
 * §6.1: T2 has no independent operational, financial or custody authority).
 */
const DISPLAY_SESSION_ROUTES: readonly EdgeRouteDefinition[] = [
  {
    id: "display-sessions-open",
    method: "POST",
    path: EDGE_ROUTE_DISPLAY_SESSIONS,
    family: "generic",
    kind: "mutation",
    scope: "edge.display.open",
    scopeStatus: "registered",
    riskClass: "A1_STANDARD_MUTATION",
    credentialClass: "device",
    permission: PERMISSION_GAP_EDGE_DISPLAY_MANAGE,
    permissionStatus: "required",
    conditionalPermissions: [],
    allowedTerminalProfiles: [TERMINAL_PROFILE_T1_INTAKE_CASHIER],
    idempotencyRequired: true,
    mutatesExistingAggregate: false,
    expectedVersionRequired: false,
    approvalRequired: false,
    auditEvent: "display_session.opened",
    auditEventStatus: "proposed",
    authority: GROUP_1,
  },
  {
    id: "display-sessions-update",
    method: "PATCH",
    path: EDGE_ROUTE_DISPLAY_SESSION,
    family: "generic",
    kind: "mutation",
    scope: "edge.display.update",
    scopeStatus: "registered",
    riskClass: "A1_STANDARD_MUTATION",
    credentialClass: "device",
    permission: PERMISSION_GAP_EDGE_DISPLAY_MANAGE,
    permissionStatus: "required",
    conditionalPermissions: [],
    allowedTerminalProfiles: [TERMINAL_PROFILE_T1_INTAKE_CASHIER],
    idempotencyRequired: true,
    mutatesExistingAggregate: true,
    expectedVersionRequired: true,
    approvalRequired: false,
    auditEvent: "display_session.updated",
    auditEventStatus: "proposed",
    authority: GROUP_1,
  },
  {
    id: "display-sessions-read",
    method: "GET",
    path: EDGE_ROUTE_DISPLAY_SESSION,
    family: "generic",
    kind: "read",
    scope: "edge.display.read",
    scopeStatus: "registered",
    riskClass: "A0_READ",
    credentialClass: "device",
    permission: PERMISSION_GAP_EDGE_DISPLAY_READ,
    permissionStatus: "required",
    conditionalPermissions: [],
    allowedTerminalProfiles: [TERMINAL_PROFILE_T2_CUSTOMER_DISPLAY],
    idempotencyRequired: false,
    mutatesExistingAggregate: false,
    expectedVersionRequired: false,
    approvalRequired: false,
    auditEvent: "display_session.read",
    auditEventStatus: "proposed",
    authority: GROUP_1,
  },
  {
    id: "display-sessions-customer-actions",
    method: "POST",
    path: EDGE_ROUTE_DISPLAY_SESSION_CUSTOMER_ACTIONS,
    family: "generic",
    kind: "mutation",
    scope: "edge.display.customer_action",
    scopeStatus: "additive",
    riskClass: "A1_STANDARD_MUTATION",
    credentialClass: "device",
    permission: PERMISSION_GAP_EDGE_DISPLAY_CUSTOMER_ACTION,
    permissionStatus: "required",
    conditionalPermissions: [],
    allowedTerminalProfiles: [TERMINAL_PROFILE_T2_CUSTOMER_DISPLAY],
    idempotencyRequired: true,
    mutatesExistingAggregate: true,
    expectedVersionRequired: true,
    approvalRequired: false,
    auditEvent: "display_session.customer_action_recorded",
    auditEventStatus: "proposed",
    authority: GROUP_1,
  },
  {
    id: "display-sessions-close",
    method: "POST",
    path: EDGE_ROUTE_DISPLAY_SESSION_CLOSE,
    family: "generic",
    kind: "mutation",
    scope: "edge.display.close",
    scopeStatus: "registered",
    riskClass: "A1_STANDARD_MUTATION",
    credentialClass: "device",
    permission: PERMISSION_GAP_EDGE_DISPLAY_MANAGE,
    permissionStatus: "required",
    conditionalPermissions: [],
    allowedTerminalProfiles: [TERMINAL_PROFILE_T1_INTAKE_CASHIER],
    idempotencyRequired: true,
    mutatesExistingAggregate: true,
    expectedVersionRequired: true,
    approvalRequired: false,
    auditEvent: "display_session.closed",
    auditEventStatus: "proposed",
    authority: GROUP_1,
  },
];

/** All 9 approved generic Edge routes. */
export const GENERIC_EDGE_ROUTES: readonly EdgeRouteDefinition[] = [
  ...SESSION_ROUTES,
  ...DISPLAY_SESSION_ROUTES,
];
