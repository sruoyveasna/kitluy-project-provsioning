/**
 * Edge Operations API route-contract types.
 *
 * Source authority: KLD-2026-07-26-002 Group 1 (APPROVED) fixes the canonical
 * route boundary (`/edge/v1/*` generic, `/edge/v1/laundry/*` vertical) and the
 * 22 approved route decisions. `docs/source/api-contracts/kitluy-edge-operations-api-v1.0.0.md`
 * §4–§5 supplies the per-route protocol obligations modelled below.
 *
 * This package is a CONTRACT registry. It contains no handlers, no persistence
 * and no business behaviour, and it must never be read as authorisation to
 * activate a route (decision §Implementation authorization item 9: fail-closed
 * blocks are removed only after the corresponding implementation and tests pass).
 */
import type { AuditEventStatus } from "./audit-events.js";
import type { EdgePermission, PermissionRegistryStatus } from "./permissions.js";
import type { EdgeApiScope, EdgeScopeStatus } from "./scopes.js";
import type { TerminalProfileId } from "./terminal-profiles.js";

/** Generic shared Edge operations vs Laundry-specific operational commands. */
export type EdgeRouteFamily = "generic" | "laundry";

/** Read routes never mutate; mutation routes always carry idempotency. */
export type EdgeRouteKind = "read" | "mutation";

export type EdgeHttpMethod = "GET" | "POST" | "PATCH";

/**
 * Credential class required at the transport/identity layer, quoted from the
 * scope registry §5 "Credential classes" column. `device` means an assigned
 * terminal certificate plus Hub session; `device_and_staff` additionally
 * requires an active staff actor session (Edge Ops API §4.1–§4.2).
 *
 * A route is a STAFF MUTATION when `kind === "mutation"` and
 * `credentialClass === "device_and_staff"`. T2 (customer display) must never
 * appear in `allowedTerminalProfiles` of a staff mutation.
 */
export type EdgeCredentialClass = "device" | "device_and_staff";

/** Risk class from scope registry §4, carried per route from its scope row. */
export type EdgeRiskClass =
  "A0_READ" | "A1_STANDARD_MUTATION" | "A2_REAUTH_MUTATION" | "A3_FOUR_EYES" | "A4_OWNER_SECURITY";

/** One canonical Edge route. `${method} ${path}` is the registry's unique key. */
export interface EdgeRouteDefinition {
  /** Stable registry identifier; never derived from the path at runtime. */
  readonly id: string;
  readonly method: EdgeHttpMethod;
  /** The canonical path template literal approved by KLD-2026-07-26-002 Group 1. */
  readonly path: string;
  readonly family: EdgeRouteFamily;
  readonly kind: EdgeRouteKind;

  /** API scope — a type of action only; never an authority grant. */
  readonly scope: EdgeApiScope;
  readonly scopeStatus: EdgeScopeStatus;
  readonly riskClass: EdgeRiskClass;
  readonly credentialClass: EdgeCredentialClass;

  /**
   * Actor permission key — a SEPARATE dimension from `scope`. Either a key from
   * the 107-key RBAC baseline or an explicit `[REQUIRED: ...]` gap marker.
   */
  readonly permission: EdgePermission;
  readonly permissionStatus: PermissionRegistryStatus;
  /** Additional permissions required only for specific payload branches. */
  readonly conditionalPermissions: readonly EdgePermission[];

  /**
   * Logical terminal profiles allowed to call the route. Always non-empty:
   * deny-by-default, an empty list would read as "unrestricted".
   */
  readonly allowedTerminalProfiles: readonly TerminalProfileId[];

  /** Edge Ops API §5.5 — required for every retryable mutation. */
  readonly idempotencyRequired: boolean;
  /** True when the route changes an already-existing versioned business aggregate. */
  readonly mutatesExistingAggregate: boolean;
  /** Edge Ops API §5.6 — `If-Match`/expected version where lost-update risk exists. */
  readonly expectedVersionRequired: boolean;
  /** Four-eyes approval (`@kitluy/approvals`) required unconditionally. */
  readonly approvalRequired: boolean;

  /** Canonical `<bounded_context>.<past_tense_fact>` name; never suffixed `.v1`. */
  readonly auditEvent: string;
  readonly auditEventStatus: AuditEventStatus;

  /** Where the approved shape comes from, for traceability. */
  readonly authority: string;
}

/** A pre-decision route shape rejected by KLD-2026-07-26-002 Group 1. */
export interface RejectedRouteShape {
  readonly shape: string;
  /** Spec that proposed the losing shape. */
  readonly source: string;
  /** The canonical approved replacement, or `null` when the route was dropped. */
  readonly replacedBy: string | null;
  readonly reason: string;
}
