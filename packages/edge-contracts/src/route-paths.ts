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

// ---------------------------------------------------------------------------
// T1 runtime bootstrap reads
//
// OWNER-APPROVED by KLD-2026-08-06-WS12-T001-EDGE-BOOTSTRAP-001 (LOCKED).
// Like the infrastructure reads above, these are held OUTSIDE `EDGE_ROUTES`
// so the KLD-2026-07-26-002 Group 1 approved-route count stays exact: they
// are device-credential-gated runtime reads with NO staff actor dimension
// (a terminal has no actor before its staff session opens), so the
// `EdgeRouteDefinition.permission` field does not apply to them. Their API
// scopes are registered additively in `scopes.ts`
// (`edge.runtime.time_read`, `edge.runtime.eligibility_read`,
// `edge.configuration.read`).
// ---------------------------------------------------------------------------

export const EDGE_ROUTE_RUNTIME_AUTHORITY_TIME = "/edge/v1/runtime/authority-time";
export const EDGE_ROUTE_RUNTIME_ELIGIBILITY = "/edge/v1/runtime/eligibility";
export const EDGE_ROUTE_CONFIGURATION_CURRENT = "/edge/v1/configuration/current";

/** The owner-approved T1 bootstrap read routes (bootstrap decision §1–§3). */
export const EDGE_RUNTIME_BOOTSTRAP_READ_PATHS = [
  EDGE_ROUTE_RUNTIME_AUTHORITY_TIME,
  EDGE_ROUTE_RUNTIME_ELIGIBILITY,
  EDGE_ROUTE_CONFIGURATION_CURRENT,
] as const;

// ---------------------------------------------------------------------------
// T1 customer intake and Booking Draft routes
//
// OWNER-APPROVED by KLD-2026-08-06-WS12-T002-001 (LOCKED). Held OUTSIDE
// `EDGE_ROUTES` (the bootstrap-read precedent) so the Group 1 approved-route
// count stays exact. Repository-conventional shapes: customers are NEUTRAL
// CORE, so the customer surface lives in the generic namespace (Edge Ops API
// §9.2 names `edge.customers.search`/`.create`); the Booking Draft is
// LAUNDRY, so its routes live under the existing approved draft resource
// `/edge/v1/laundry/bookings/drafts` — the generic `/edge/v1/booking-drafts`
// placement would repeat the exact namespace violation the Group 1 rejected-
// shape list records. The PATCH draft shape, rejected in Group 1 as
// "requires a separate owner decision", is SUPERSEDED by the T002 decision
// (§4.1 approves create/read/edit/cancel of an OPEN draft); the rejected-
// shape entry carries the supersession note.
//
// Draft-route permissions reuse `laundry.bookings.read` (read) and
// `laundry.bookings.create` (create/update/cancel — the recorded
// command-registry precedent); customer routes carry the Amendment 003 keys.
// ---------------------------------------------------------------------------

export const EDGE_ROUTE_CUSTOMERS_SEARCH = "/edge/v1/customers/search";
export const EDGE_ROUTE_CUSTOMERS_CREATE = "/edge/v1/customers";
export const EDGE_ROUTE_CUSTOMER_READ_TEMPLATE = "/edge/v1/customers/{customerId}";
export const EDGE_ROUTE_CUSTOMER_CONSENT_TEMPLATE =
  "/edge/v1/customers/{customerId}/consent-decisions";
export const EDGE_ROUTE_BOOKING_DRAFT_CREATE = "/edge/v1/laundry/bookings/drafts";
export const EDGE_ROUTE_BOOKING_DRAFT_READ_TEMPLATE = "/edge/v1/laundry/bookings/drafts/{draftId}";
export const EDGE_ROUTE_BOOKING_DRAFT_UPDATE_TEMPLATE =
  "/edge/v1/laundry/bookings/drafts/{draftId}";
export const EDGE_ROUTE_BOOKING_DRAFT_CANCEL_TEMPLATE =
  "/edge/v1/laundry/bookings/drafts/{draftId}/cancel";

/** The owner-approved T002 intake surface (T002 decision §5/§6). */
export const EDGE_T002_INTAKE_ROUTES = [
  { method: "GET", path: EDGE_ROUTE_CUSTOMERS_SEARCH, permission: "customers.read" },
  { method: "GET", path: EDGE_ROUTE_CUSTOMER_READ_TEMPLATE, permission: "customers.read" },
  { method: "POST", path: EDGE_ROUTE_CUSTOMERS_CREATE, permission: "customers.create" },
  {
    method: "POST",
    path: EDGE_ROUTE_CUSTOMER_CONSENT_TEMPLATE,
    permission: "customers.consent.record",
  },
  {
    method: "GET",
    path: EDGE_ROUTE_BOOKING_DRAFT_READ_TEMPLATE,
    permission: "laundry.bookings.read",
  },
  { method: "POST", path: EDGE_ROUTE_BOOKING_DRAFT_CREATE, permission: "laundry.bookings.create" },
  {
    method: "PATCH",
    path: EDGE_ROUTE_BOOKING_DRAFT_UPDATE_TEMPLATE,
    permission: "laundry.bookings.create",
  },
  {
    method: "POST",
    path: EDGE_ROUTE_BOOKING_DRAFT_CANCEL_TEMPLATE,
    permission: "laundry.bookings.create",
  },
] as const;
