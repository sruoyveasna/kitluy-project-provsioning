/**
 * The canonical Edge Operations API route registry.
 *
 * Source authority: KLD-2026-07-26-002 Group 1 (APPROVED, 2026-07-27).
 * `EDGE_ROUTES` is the SINGLE source of truth for approved Edge route literals
 * and their contract metadata. Nothing may re-declare an Edge route literal
 * elsewhere in the repository.
 *
 * Status ceiling (KL-DEC-001-T002): contract alignment only. Edge mutation
 * business workflows remain NOT INTEGRATION-VERIFIED and the Store Hub keeps
 * failing closed for mutations until its own implementation and tests land
 * (Hub persistence is WS-09).
 */
import { GENERIC_EDGE_ROUTES } from "./generic-routes.js";
import { LAUNDRY_EDGE_ROUTES } from "./laundry-routes.js";
import type { EdgeHttpMethod, EdgeRouteDefinition, RejectedRouteShape } from "./types.js";

/** Every approved Edge route: 9 generic + 13 Laundry = 22. */
export const EDGE_ROUTES: readonly EdgeRouteDefinition[] = [
  ...GENERIC_EDGE_ROUTES,
  ...LAUNDRY_EDGE_ROUTES,
];

/** Number of route decisions approved by KLD-2026-07-26-002 Group 1. */
export const APPROVED_EDGE_ROUTE_COUNT = 22;

/** The registry's unique key. One path template may carry several methods. */
export function edgeRouteKey(method: EdgeHttpMethod, path: string): string {
  return `${method} ${path}`;
}

export function findEdgeRoute(
  method: EdgeHttpMethod,
  path: string,
): EdgeRouteDefinition | undefined {
  return EDGE_ROUTES.find((route) => route.method === method && route.path === path);
}

export function findEdgeRouteById(id: string): EdgeRouteDefinition | undefined {
  return EDGE_ROUTES.find((route) => route.id === id);
}

/**
 * A route is a STAFF MUTATION when it mutates and requires a staff actor
 * session. T2 (customer display) must never be allowed on one — the customer
 * display has no independent operational, financial or custody authority
 * (Terminal Profile Contract §6.1; Edge Ops API §4.3).
 */
export function isStaffMutation(route: EdgeRouteDefinition): boolean {
  return route.kind === "mutation" && route.credentialClass === "device_and_staff";
}

/**
 * Route shapes rejected by KLD-2026-07-26-002 Group 1
 * (`REJECTED-BEFORE-IMPLEMENTATION`). No compatibility alias or deprecation
 * period exists because no affected mutation route, deployed client, SDK or
 * external caller was ever built. This list exists so contract tests can prove
 * the losing shapes are absent from every executable registry.
 */
export const REJECTED_ROUTE_SHAPES: readonly RejectedRouteShape[] = [
  // --- Store Hub LAN API v1.0.0 fork: unversioned/unprefixed operational routes
  {
    shape: "/bookings/drafts",
    source: "Store Hub LAN API v1.0.0 §Booking surface",
    replacedBy: "/edge/v1/laundry/bookings/drafts",
    reason: "Missing the /edge/v1 namespace and the /laundry vertical segment.",
  },
  {
    shape: "/bookings/{id}/confirm-intake",
    source: "Store Hub LAN API v1.0.0 §Booking surface",
    replacedBy: "/edge/v1/laundry/bookings/{id}/confirm-intake",
    reason: "Missing the /edge/v1 namespace and the /laundry vertical segment.",
  },
  {
    shape: "/edge/v1/bookings/drafts",
    source: "Store Hub LAN API v1.0.0 §Booking surface (namespaced form)",
    replacedBy: "/edge/v1/laundry/bookings/drafts",
    reason: "Laundry operational command placed in the generic namespace.",
  },
  {
    shape: "/edge/v1/ready-scan/sessions",
    source: "Store Hub LAN API v1.0.0 §T3 surface",
    replacedBy: "/edge/v1/laundry/ready-sessions",
    reason: "ready-scan/sessions fork; resource is a Ready session, not a scan collection.",
  },
  {
    shape: "/edge/v1/ready-scan/{session_id}/items",
    source: "Store Hub LAN API v1.0.0 §T3 surface",
    replacedBy: "/edge/v1/laundry/ready-sessions/{id}/scans",
    reason: "ready-scan/items fork.",
  },
  {
    shape: "/edge/v1/ready-scan/{session_id}/qa",
    source: "Store Hub LAN API v1.0.0 §T3 surface",
    replacedBy: "/edge/v1/laundry/ready-sessions/{id}/qa",
    reason: "ready-scan fork.",
  },
  {
    shape: "/edge/v1/ready-scan/{session_id}/exceptions",
    source: "Store Hub LAN API v1.0.0 §T3 surface",
    replacedBy: "/edge/v1/laundry/ready-sessions/{id}/exceptions",
    reason: "ready-scan fork.",
  },
  {
    shape: "/edge/v1/ready-scan/{session_id}/storage",
    source: "Store Hub LAN API v1.0.0 §T3 surface",
    replacedBy: "/edge/v1/laundry/ready-sessions/{id}/storage",
    reason: "ready-scan fork.",
  },
  {
    shape: "/edge/v1/ready-scan/{session_id}/complete",
    source: "Store Hub LAN API v1.0.0 §T3 surface",
    replacedBy: "/edge/v1/laundry/ready-sessions/{id}/complete",
    reason: "ready-scan fork.",
  },
  {
    shape: "/edge/v1/pickup-scan/sessions",
    source: "Store Hub LAN API v1.0.0 §T4 surface",
    replacedBy: "/edge/v1/laundry/pickup-sessions",
    reason: "pickup-scan/sessions fork.",
  },
  {
    shape: "/edge/v1/pickup-scan/{session_id}/verify-collector",
    source: "Store Hub LAN API v1.0.0 §T4 surface",
    replacedBy: "/edge/v1/laundry/pickup-sessions/{id}/collector-verification",
    reason: "pickup-scan fork; verb-first sub-resource replaced by a noun resource.",
  },
  {
    shape: "/edge/v1/pickup-scan/{session_id}/items",
    source: "Store Hub LAN API v1.0.0 §T4 surface",
    replacedBy: "/edge/v1/laundry/pickup-sessions/{id}/scans",
    reason: "pickup-scan fork.",
  },
  {
    shape: "/edge/v1/pickup-scan/{session_id}/payment",
    source: "Store Hub LAN API v1.0.0 §T4 surface",
    replacedBy: "/edge/v1/laundry/pickup-sessions/{id}/payments",
    reason: "pickup-scan fork; singular payment replaced by an append-only collection.",
  },
  {
    shape: "/edge/v1/pickup-scan/{session_id}/complete",
    source: "Store Hub LAN API v1.0.0 §T4 surface",
    replacedBy: "/edge/v1/laundry/pickup-sessions/{id}/complete",
    reason: "pickup-scan fork.",
  },
  // --- POS Desktop / Edge Operations API v1.0.0 fork
  {
    shape: "/edge/v1/displays/sessions",
    source: "Edge Operations API v1.0.0 §9.3 / POS Desktop v4.0.0 §14.2",
    replacedBy: "/edge/v1/display-sessions",
    reason:
      "displays/sessions fork; the approved resource is a single display-sessions collection.",
  },
  {
    shape: "/edge/v1/displays/sessions/{id}",
    source: "Edge Operations API v1.0.0 §9.3",
    replacedBy: "/edge/v1/display-sessions/{id}",
    reason: "displays/sessions fork.",
  },
  {
    shape: "/edge/v1/displays/sessions/{id}/receipt-choice",
    source: "Edge Operations API v1.0.0 §9.3",
    replacedBy: "/edge/v1/display-sessions/{id}/customer-actions",
    reason:
      "Single-purpose receipt-choice route replaced by the broader customer-actions resource.",
  },
  {
    shape: "/edge/v1/displays/sessions/{id}/stream",
    source: "Edge Operations API v1.0.0 §9.3",
    replacedBy: "/edge/v1/display-sessions/{id}",
    reason: "GET/WS stream sub-resource replaced by a GET on the display session itself.",
  },
  {
    shape: "/edge/v1/laundry/bookings/drafts/{id}",
    source: "Edge Operations API v1.0.0 §9.2 (PATCH draft)",
    replacedBy: null,
    reason:
      "Not part of the Group 1 approved catalogue. A draft-update route requires a separate owner decision; it must not be inferred.",
  },
  {
    shape: "/edge/v1/laundry/bookings/{id}/finalize",
    source: "Edge Operations API v1.0.0 §9.2",
    replacedBy: "/edge/v1/laundry/bookings/{id}/confirm-intake",
    reason: "finalize verb replaced by the approved confirm-intake fact.",
  },
  {
    shape: "/edge/v1/laundry/pickup-sessions/{id}/release",
    source: "Edge Operations API v1.0.0 §9.5",
    replacedBy: "/edge/v1/laundry/pickup-sessions/{id}/complete",
    reason:
      "release sub-resource replaced by complete. The registered scope keeps the release verb (edge.pickup.release); route path and scope name are separate vocabularies.",
  },
  // --- Vertical-prefixed generic routes (rejected in principle by the Group 1 boundary)
  {
    shape: "/edge/v1/laundry/sessions/open",
    source: "Pre-decision drafting",
    replacedBy: "/edge/v1/sessions/open",
    reason: "Session management is a generic shared Edge operation, never vertical-prefixed.",
  },
  {
    shape: "/edge/v1/laundry/sessions/refresh",
    source: "Pre-decision drafting",
    replacedBy: "/edge/v1/sessions/refresh",
    reason: "Session management is a generic shared Edge operation, never vertical-prefixed.",
  },
  {
    shape: "/edge/v1/laundry/sessions/switch",
    source: "Pre-decision drafting",
    replacedBy: "/edge/v1/sessions/switch",
    reason: "Session management is a generic shared Edge operation, never vertical-prefixed.",
  },
  {
    shape: "/edge/v1/laundry/sessions/close",
    source: "Pre-decision drafting",
    replacedBy: "/edge/v1/sessions/close",
    reason: "Session management is a generic shared Edge operation, never vertical-prefixed.",
  },
  {
    shape: "/edge/v1/laundry/display-sessions",
    source: "Pre-decision drafting",
    replacedBy: "/edge/v1/display-sessions",
    reason: "The customer display is a generic Edge capability, never vertical-prefixed.",
  },
];
