/**
 * Canonical Edge route path literals.
 *
 * Source authority: KLD-2026-07-26-002 Group 1 (APPROVED, 2026-07-27). The
 * literals below are quoted verbatim from the approved route decisions. They
 * are the SINGLE definition of these strings in the repository — every consumer
 * (Store Hub LAN kernel, terminals, contract tests) imports from here so that
 * "no duplicate route literals across packages" holds.
 *
 * Path-template variables use the `{id}` form used by the decision document.
 */

/** Canonical route namespace (Edge Ops API §2). */
export const EDGE_V1_BASE_PATH = "/edge/v1";

/** Vertical sub-namespace for Laundry operational commands. */
export const EDGE_V1_LAUNDRY_BASE_PATH = "/edge/v1/laundry";

// ---------------------------------------------------------------------------
// Generic shared Edge operations — /edge/v1/*
// ---------------------------------------------------------------------------

export const EDGE_ROUTE_SESSIONS_OPEN = "/edge/v1/sessions/open";
export const EDGE_ROUTE_SESSIONS_REFRESH = "/edge/v1/sessions/refresh";
export const EDGE_ROUTE_SESSIONS_SWITCH = "/edge/v1/sessions/switch";
export const EDGE_ROUTE_SESSIONS_CLOSE = "/edge/v1/sessions/close";

export const EDGE_ROUTE_DISPLAY_SESSIONS = "/edge/v1/display-sessions";
export const EDGE_ROUTE_DISPLAY_SESSION = "/edge/v1/display-sessions/{id}";
export const EDGE_ROUTE_DISPLAY_SESSION_CUSTOMER_ACTIONS =
  "/edge/v1/display-sessions/{id}/customer-actions";
export const EDGE_ROUTE_DISPLAY_SESSION_CLOSE = "/edge/v1/display-sessions/{id}/close";

// ---------------------------------------------------------------------------
// Laundry operational commands — /edge/v1/laundry/*
// ---------------------------------------------------------------------------

export const EDGE_ROUTE_LAUNDRY_BOOKING_DRAFTS = "/edge/v1/laundry/bookings/drafts";
export const EDGE_ROUTE_LAUNDRY_BOOKING_CONFIRM_INTAKE =
  "/edge/v1/laundry/bookings/{id}/confirm-intake";

export const EDGE_ROUTE_LAUNDRY_READY_SESSIONS = "/edge/v1/laundry/ready-sessions";
export const EDGE_ROUTE_LAUNDRY_READY_SESSION_SCANS = "/edge/v1/laundry/ready-sessions/{id}/scans";
export const EDGE_ROUTE_LAUNDRY_READY_SESSION_QA = "/edge/v1/laundry/ready-sessions/{id}/qa";
export const EDGE_ROUTE_LAUNDRY_READY_SESSION_EXCEPTIONS =
  "/edge/v1/laundry/ready-sessions/{id}/exceptions";
export const EDGE_ROUTE_LAUNDRY_READY_SESSION_STORAGE =
  "/edge/v1/laundry/ready-sessions/{id}/storage";
export const EDGE_ROUTE_LAUNDRY_READY_SESSION_COMPLETE =
  "/edge/v1/laundry/ready-sessions/{id}/complete";

export const EDGE_ROUTE_LAUNDRY_PICKUP_SESSIONS = "/edge/v1/laundry/pickup-sessions";
export const EDGE_ROUTE_LAUNDRY_PICKUP_SESSION_COLLECTOR_VERIFICATION =
  "/edge/v1/laundry/pickup-sessions/{id}/collector-verification";
export const EDGE_ROUTE_LAUNDRY_PICKUP_SESSION_SCANS =
  "/edge/v1/laundry/pickup-sessions/{id}/scans";
export const EDGE_ROUTE_LAUNDRY_PICKUP_SESSION_PAYMENTS =
  "/edge/v1/laundry/pickup-sessions/{id}/payments";
export const EDGE_ROUTE_LAUNDRY_PICKUP_SESSION_COMPLETE =
  "/edge/v1/laundry/pickup-sessions/{id}/complete";

// ---------------------------------------------------------------------------
// Hub infrastructure reads
//
// These three routes are NOT part of the KLD-2026-07-26-002 Group 1 approved
// business-route catalogue: Group 1 decided the disputed mutation shapes, and
// the Store Hub LAN API v1.0.0 §"Unauthenticated/identity surface" and Edge Ops
// API §9.1/§9.6 already agree on these read shapes. They are exported here so
// the Hub LAN kernel has one source for the literals, and they are held OUTSIDE
// `EDGE_ROUTES` so the approved-route count stays exact.
//
// Scopes (Edge Ops API §9.1/§9.6): `edge.health.read`, `edge.identity.read`,
// `edge.sync.read`. Only `edge.sync.read` is in scope-registry §5; the other two
// are named by the surface contract and still need additive registration.
// ---------------------------------------------------------------------------

export const EDGE_ROUTE_HEALTH = "/edge/v1/health";
export const EDGE_ROUTE_IDENTITY = "/edge/v1/identity";
export const EDGE_ROUTE_SYNC_STATUS = "/edge/v1/sync/status";

/** The Hub infrastructure read routes, in the order the LAN kernel serves them. */
export const EDGE_INFRASTRUCTURE_READ_PATHS = [
  EDGE_ROUTE_HEALTH,
  EDGE_ROUTE_IDENTITY,
  EDGE_ROUTE_SYNC_STATUS,
] as const;
