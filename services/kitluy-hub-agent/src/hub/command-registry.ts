/**
 * The Hub command catalogue: what each command requires on EVERY authorisation
 * dimension, and whether it is ACTIVE at all.
 *
 * Authority:
 *   - `@kitluy/edge-contracts` EDGE_ROUTES is the SINGLE source of truth for
 *     approved route metadata (KLD-2026-07-26-002 Group 1). Where a command is
 *     the Hub-side execution of an approved route, its permission, API scope,
 *     risk class, allowed profiles, expected-version and approval obligations
 *     are READ FROM the registry — never restated here.
 *   - KLD-2026-07-26-002 Group 3: permission key, API scope, resource scope,
 *     environment scope, device/profile authorisation and approval policy are
 *     SEPARATE dimensions and are never collapsed.
 *   - KLREQ-015 (amendment §4): nine approved Edge routes still have no
 *     canonical permission key. Those commands are registered here as INACTIVE
 *     and fail closed carrying their `[REQUIRED: ...]` marker. No permission key
 *     is invented, and no validation is relaxed to make one of them pass.
 */
import {
  EDGE_ROUTES,
  findEdgeRouteById,
  isRequiredPermissionMarker,
  type EdgeRiskClass,
  type EdgeRouteDefinition,
} from "@kitluy/edge-contracts";
import { isCanonicalPermissionKey } from "@kitluy/rbac";
import type { LaundryTerminalProfile } from "@kitluy-verticals/phase1-laundry";
import { HubCommandError } from "./errors.js";

/** Aggregate families the Hub command layer versions and locks. */
export type HubAggregateType = "booking" | "payment" | "ready_session" | "pickup_session";

export interface HubCommandDefinition {
  /** Stable command type; also the value stored in `command_result.command_type`. */
  readonly commandType: string;
  readonly aggregateType: HubAggregateType;
  /** Approved Edge route id, when one exists; `null` when the Hub command has none. */
  readonly routeId: string | null;
  /** Normalised route TEMPLATE for the canonical request hash (offline §3). */
  readonly routeTemplate: string;
  readonly method: "POST" | "PATCH";
  readonly riskClass: EdgeRiskClass;
  /** Registered RBAC key, or a `[REQUIRED: ...]` marker when none exists. */
  readonly permission: string;
  readonly conditionalPermissions: readonly string[];
  readonly allowedProfiles: readonly LaundryTerminalProfile[];
  readonly expectedVersionRequired: boolean;
  /** Four-eyes evidence is mandatory (`@kitluy/approvals` A3_FOUR_EYES). */
  readonly approvalRequired: boolean;
  /** Canonical `<bounded_context>.<past_tense_fact>` audit/domain event name. */
  readonly auditEvent: string;
  /** ACTIVE commands may execute; INACTIVE commands always fail closed. */
  readonly active: boolean;
  readonly inactiveReason?: string;
}

const T1 = "laundry.t1.intake_cashier" as const;
const T4 = "laundry.t4.pickup_scan_out" as const;

function requireRoute(routeId: string): EdgeRouteDefinition {
  const route = findEdgeRouteById(routeId);
  if (!route) {
    throw new Error(`Edge route '${routeId}' is not in the canonical registry.`);
  }
  return route;
}

/**
 * Build a command definition FROM the canonical route so the two can never
 * drift. A route whose permission is still a `[REQUIRED: ...]` marker produces
 * an INACTIVE command (KLREQ-015).
 */
function fromRoute(
  commandType: string,
  routeId: string,
  aggregateType: HubAggregateType,
): HubCommandDefinition {
  const route = requireRoute(routeId);
  const unregistered = isRequiredPermissionMarker(route.permission);
  return {
    commandType,
    aggregateType,
    routeId,
    routeTemplate: route.path,
    method: route.method === "PATCH" ? "PATCH" : "POST",
    riskClass: route.riskClass,
    permission: route.permission,
    conditionalPermissions: route.conditionalPermissions,
    allowedProfiles: route.allowedTerminalProfiles as readonly LaundryTerminalProfile[],
    expectedVersionRequired: route.expectedVersionRequired,
    approvalRequired: route.approvalRequired,
    auditEvent: route.auditEvent,
    active: !unregistered,
    ...(unregistered
      ? {
          inactiveReason: `KLREQ-015: the approved route ${routeId} carries no canonical permission key — ${route.permission}`,
        }
      : {}),
  };
}

/**
 * Hub-internal command with no approved Edge route.
 *
 * RECORDED (amendment §4 discipline): KLD-2026-07-26-002 Group 1 REJECTED
 * `/edge/v1/laundry/bookings/drafts/{id}` — "A draft-update route requires a
 * separate owner decision; it must not be inferred". The Hub command layer
 * therefore executes draft shaping WITHOUT exposing any route: `lan-api.ts`
 * still fails closed for every mutating verb, so no surface reaches these
 * commands until an owner decision approves one. The permission stays the
 * registered `laundry.bookings.create` that the APPROVED draft-create route
 * already binds to the pre-finalization draft workspace — no new key.
 */
function hubInternal(
  commandType: string,
  aggregateType: HubAggregateType,
  input: {
    readonly routeTemplate: string;
    readonly permission: string;
    readonly conditionalPermissions?: readonly string[];
    readonly allowedProfiles: readonly LaundryTerminalProfile[];
    readonly riskClass: EdgeRiskClass;
    readonly expectedVersionRequired: boolean;
    readonly approvalRequired: boolean;
    readonly auditEvent: string;
    readonly active?: boolean;
    readonly inactiveReason?: string;
  },
): HubCommandDefinition {
  const unregistered = isRequiredPermissionMarker(input.permission);
  const active = (input.active ?? true) && !unregistered;
  return {
    commandType,
    aggregateType,
    routeId: null,
    routeTemplate: input.routeTemplate,
    method: "POST",
    riskClass: input.riskClass,
    permission: input.permission,
    conditionalPermissions: input.conditionalPermissions ?? [],
    allowedProfiles: input.allowedProfiles,
    expectedVersionRequired: input.expectedVersionRequired,
    approvalRequired: input.approvalRequired,
    auditEvent: input.auditEvent,
    active,
    ...(active
      ? {}
      : {
          inactiveReason:
            input.inactiveReason ?? `KLREQ-015: no canonical permission key — ${input.permission}`,
        }),
  };
}

/**
 * `[REQUIRED]` marker for the payment-provider callback path. There is no
 * ACTOR-facing route or RBAC key for it because no human performs it: it is
 * applied by the Hub payment service from authoritative provider evidence. The
 * terminal command ledger cannot hold it either —
 * `edge_sync.command_result.terminal_device_id` is NOT NULL and references
 * `edge_identity.terminal_device`, so the ledger is terminal-command-only by
 * contract. Provider callbacks therefore run the SERVICE pipeline
 * (hub/commands/payment-commands.ts) with their own deduplication, and this
 * entry exists so the gap is visible in the catalogue rather than implicit.
 */
export const PERMISSION_GAP_HUB_PROVIDER_CALLBACK =
  "[REQUIRED: RBAC permission key for applying an authoritative payment-provider callback on the Store Hub — absent from kitluy-suite-rbac-permission-registry-v1.0.0.csv; the Hub applies it as a service, not as an actor]";

const DEFINITIONS: readonly HubCommandDefinition[] = [
  // ---------------------------------------------------------------- Booking
  fromRoute("laundry.booking.create_draft", "laundry-booking-draft-create", "booking"),
  hubInternal("laundry.booking.update_draft", "booking", {
    routeTemplate: "/edge/v1/laundry/bookings/drafts/{id}",
    permission: "laundry.bookings.create",
    conditionalPermissions: ["laundry.bookings.price_override"],
    allowedProfiles: [T1],
    riskClass: "A1_STANDARD_MUTATION",
    expectedVersionRequired: true,
    approvalRequired: false,
    auditEvent: "laundry_booking.draft_updated",
  }),
  hubInternal("laundry.booking.add_line", "booking", {
    routeTemplate: "/edge/v1/laundry/bookings/drafts/{id}/lines",
    permission: "laundry.bookings.create",
    conditionalPermissions: ["laundry.bookings.price_override"],
    allowedProfiles: [T1],
    riskClass: "A1_STANDARD_MUTATION",
    expectedVersionRequired: true,
    approvalRequired: false,
    auditEvent: "laundry_booking.draft_line_added",
  }),
  hubInternal("laundry.booking.register_garment", "booking", {
    routeTemplate: "/edge/v1/laundry/bookings/drafts/{id}/garments",
    permission: "laundry.bookings.create",
    allowedProfiles: [T1],
    riskClass: "A1_STANDARD_MUTATION",
    expectedVersionRequired: true,
    approvalRequired: false,
    auditEvent: "laundry_booking.garment_registered",
  }),
  hubInternal("laundry.booking.assign_tag", "booking", {
    routeTemplate: "/edge/v1/laundry/bookings/drafts/{id}/tags",
    permission: "laundry.bookings.create",
    allowedProfiles: [T1],
    riskClass: "A1_STANDARD_MUTATION",
    expectedVersionRequired: true,
    approvalRequired: false,
    auditEvent: "laundry_booking.tag_assigned",
  }),
  hubInternal("laundry.booking.assign_container", "booking", {
    routeTemplate: "/edge/v1/laundry/bookings/drafts/{id}/containers",
    permission: "laundry.bookings.create",
    allowedProfiles: [T1],
    riskClass: "A1_STANDARD_MUTATION",
    expectedVersionRequired: true,
    approvalRequired: false,
    auditEvent: "laundry_booking.container_assigned",
  }),
  fromRoute("laundry.booking.confirm_intake", "laundry-booking-confirm-intake", "booking"),
  // T1-REAL-OPERATIONS-001 slice 2 (KLD-2026-09-19-T1-REAL-OPERATIONS-001
  // decision 1): the SAME approved route, served with `{id}` = the WS-12-T002
  // Booking Draft. One command converts the draft, prices and writes the
  // lines, records the cash tender, issues the receipt record and queues its
  // print. Route metadata (permission, profiles, risk class, audit event) is
  // read from the registry exactly as for confirm_intake — nothing restated.
  fromRoute("laundry.booking.confirm_from_draft", "laundry-booking-confirm-intake", "booking"),

  // ------------------------------------------------------------ Ready (T3)
  fromRoute("laundry.ready.open_session", "laundry-ready-session-open", "ready_session"),
  fromRoute("laundry.ready.record_scan", "laundry-ready-session-scan", "ready_session"),
  fromRoute("laundry.ready.record_qa", "laundry-ready-session-qa", "ready_session"),
  fromRoute("laundry.ready.record_exception", "laundry-ready-session-exception", "ready_session"),
  fromRoute("laundry.ready.assign_storage", "laundry-ready-session-storage", "ready_session"),
  fromRoute("laundry.ready.complete", "laundry-ready-session-complete", "ready_session"),

  // ----------------------------------------------------------- Pickup (T4)
  fromRoute("laundry.pickup.open_session", "laundry-pickup-session-open", "pickup_session"),
  fromRoute(
    "laundry.pickup.verify_collector",
    "laundry-pickup-session-verify-collector",
    "pickup_session",
  ),
  fromRoute("laundry.pickup.record_scan", "laundry-pickup-session-scan", "pickup_session"),
  fromRoute("laundry.pickup.record_payment", "laundry-pickup-session-payment", "pickup_session"),
  fromRoute("laundry.pickup.complete", "laundry-pickup-session-complete", "pickup_session"),

  // ------------------------------------------------------------- Payments
  // Cash is authoritative at the drawer: the drawer movement IS the evidence,
  // so a cash payment is recorded CONFIRMED (KBR-PAY-002).
  hubInternal("payments.record_cash_payment", "payment", {
    routeTemplate: "/edge/v1/laundry/bookings/{id}/payments",
    permission: "payments.capture.cash",
    allowedProfiles: [T1, T4],
    riskClass: "A1_STANDARD_MUTATION",
    expectedVersionRequired: true,
    approvalRequired: false,
    auditEvent: "payment.recorded",
  }),
  // KLD-2026-07-26-002 Group 5: PAYMENT_PENDING is NON-TERMINAL (HTTP 202).
  // Pending is NOT paid, and no KHQR confirmation is ever fabricated.
  hubInternal("payments.create_pending_payment", "payment", {
    routeTemplate: "/edge/v1/laundry/bookings/{id}/payments",
    permission: "payments.khqr.create",
    allowedProfiles: [T1, T4],
    riskClass: "A1_STANDARD_MUTATION",
    expectedVersionRequired: true,
    approvalRequired: false,
    auditEvent: "payment.recorded",
  }),
  // KBR-PAY-005: refund authorisation is separated and recorded. Thresholds are
  // an OPEN owner decision (PAY-OD-002) and are NOT invented, so the Hub takes
  // the strictest reading and requires four-eyes evidence for EVERY refund.
  hubInternal("payments.request_refund", "payment", {
    routeTemplate: "/edge/v1/laundry/bookings/{id}/refunds",
    permission: "payments.refund.request",
    allowedProfiles: [T1, T4],
    riskClass: "A3_FOUR_EYES",
    expectedVersionRequired: true,
    approvalRequired: true,
    auditEvent: "payment.refund_requested",
  }),
  hubInternal("payments.request_void", "payment", {
    routeTemplate: "/edge/v1/laundry/bookings/{id}/voids",
    permission: "payments.void.request",
    allowedProfiles: [T1, T4],
    riskClass: "A3_FOUR_EYES",
    expectedVersionRequired: true,
    approvalRequired: true,
    auditEvent: "payment.void_requested",
  }),
  // Registered so the gap is VISIBLE. Always fails closed as a terminal command.
  hubInternal("payments.apply_provider_callback", "payment", {
    routeTemplate: "/edge/v1/payments/{id}/provider-callbacks",
    permission: PERMISSION_GAP_HUB_PROVIDER_CALLBACK,
    allowedProfiles: [T1, T4],
    riskClass: "A1_STANDARD_MUTATION",
    expectedVersionRequired: false,
    approvalRequired: false,
    auditEvent: "payment.recorded",
  }),
];

const BY_TYPE = new Map(DEFINITIONS.map((d) => [d.commandType, d]));

/**
 * The nine approved Edge routes whose permission key is still missing
 * (KLREQ-015). Registered as INACTIVE commands so the fence is EXECUTABLE:
 * calling one fails closed with `EDGE_PERMISSION_KEY_UNREGISTERED` and the
 * `[REQUIRED: ...]` marker text.
 */
export const INACTIVE_ROUTE_COMMANDS: readonly HubCommandDefinition[] = EDGE_ROUTES.filter(
  (route) => isRequiredPermissionMarker(route.permission),
).map((route) => fromRoute(`edge.${route.id.replace(/-/g, "_")}`, route.id, "booking"));

for (const definition of INACTIVE_ROUTE_COMMANDS) {
  BY_TYPE.set(definition.commandType, definition);
}

export const HUB_COMMANDS: readonly HubCommandDefinition[] = [
  ...DEFINITIONS,
  ...INACTIVE_ROUTE_COMMANDS,
];

export function findHubCommand(commandType: string): HubCommandDefinition | undefined {
  return BY_TYPE.get(commandType);
}

/**
 * Resolve a command, failing closed on an unknown type and on any command whose
 * permission key is not in the canonical 107-key registry (KLD-2026-07-26-002
 * Group 3: "Unknown or deprecated keys fail closed").
 */
export function requireActiveHubCommand(commandType: string): HubCommandDefinition {
  const definition = BY_TYPE.get(commandType);
  if (!definition) {
    throw new HubCommandError("EDGE_COMMAND_UNKNOWN", `unknown command type '${commandType}'.`, {
      commandType,
    });
  }
  if (!definition.active) {
    throw new HubCommandError(
      "EDGE_PERMISSION_KEY_UNREGISTERED",
      definition.inactiveReason ??
        `command '${commandType}' is INACTIVE and fails closed until an owner decision registers its permission key.`,
      { commandType, permission: definition.permission },
    );
  }
  if (!isCanonicalPermissionKey(definition.permission)) {
    throw new HubCommandError(
      "EDGE_PERMISSION_KEY_UNREGISTERED",
      `command '${commandType}' declares permission '${definition.permission}', which is not in the canonical RBAC registry.`,
      { commandType, permission: definition.permission },
    );
  }
  return definition;
}
