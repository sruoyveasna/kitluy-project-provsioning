/**
 * Projection map between the CANONICAL Laundry engines and the Hub-local
 * `edge_laundry.booking.status` column.
 *
 * The engines in `@kitluy-verticals/phase1-laundry` are the ONLY transition
 * decision authority (KBR-LND-003/004/005, KBR-TXN-003). Nothing here decides a
 * transition; this module only translates an engine state into the Hub
 * projection value and back, so a loaded Booking can be handed to the engine as
 * its own state.
 *
 * RECORDED CONFLICT (report, do not silently resolve — CLAUDE.md hard rule 8).
 * `edge_laundry.booking.status` carries no CHECK constraint and the canonical
 * schema document names no value list. The only evidence is
 * `hub/seed/dev-fixtures.sql`, which uses `draft`, `intake_confirmed` and
 * `ready`, and whose second `status_event` goes `intake_confirmed -> ready`
 * directly. That edge is RECEIVED -> READY, which the canonical production
 * machine refuses (`canProductionTransition('RECEIVED','READY') === false`,
 * KBR-LND-003 forward-only chain; READY additionally requires the guarded
 * `markReady`). The command layer therefore:
 *   - adopts the three fixture values verbatim,
 *   - adds the remaining canonical production stages in the same lowercase
 *     snake_case style so the full chain is representable, and
 *   - REFUSES the fixture's direct edge, because the engine refuses it.
 * The Hub has no approved Edge route and no canonical permission key for the
 * plant stages (`washing`/`drying`/`pressing`), so no command exposes them —
 * that gap is reported, not stubbed.
 */
import {
  PRODUCTION_STATES,
  type BookingLifecycleState,
  type ProductionState,
} from "@kitluy-verticals/phase1-laundry";
import { HubCommandError } from "./errors.js";

/** Hub-local projection values for `edge_laundry.booking.status`. */
export const HUB_BOOKING_STATUSES = [
  "draft",
  "intake_confirmed",
  "washing",
  "drying",
  "pressing",
  "qa_packaging",
  "ready",
  "picked_up",
  "expired",
  "cancelled",
  "voided",
  "issue_hold",
  "return_refund",
] as const;
export type HubBookingStatus = (typeof HUB_BOOKING_STATUSES)[number];

/**
 * Production state -> Hub projection. `intake_confirmed` is the fixture's
 * spelling for RECEIVED and `ready` for READY; the rest follow the same rule.
 */
const PRODUCTION_TO_STATUS: Readonly<Record<ProductionState, HubBookingStatus>> = {
  RECEIVED: "intake_confirmed",
  WASHING: "washing",
  DRYING: "drying",
  PRESSING: "pressing",
  QA_PACKAGING: "qa_packaging",
  READY: "ready",
  PICKED_UP: "picked_up",
};

const STATUS_TO_PRODUCTION: Readonly<Partial<Record<HubBookingStatus, ProductionState>>> =
  Object.fromEntries(
    PRODUCTION_STATES.map((state) => [PRODUCTION_TO_STATUS[state], state]),
  ) as Readonly<Partial<Record<HubBookingStatus, ProductionState>>>;

/** Lifecycle state -> Hub projection, for the states the Hub projects. */
const LIFECYCLE_TO_STATUS: Readonly<Partial<Record<BookingLifecycleState, HubBookingStatus>>> = {
  DRAFT: "draft",
  "CONFIRMED/FINALIZED": "intake_confirmed",
  EXPIRED: "expired",
  CANCELLED: "cancelled",
  VOIDED: "voided",
  ISSUE_HOLD: "issue_hold",
  "RETURN/REFUND": "return_refund",
};

export function statusForProductionState(state: ProductionState): HubBookingStatus {
  return PRODUCTION_TO_STATUS[state];
}

export function statusForLifecycleState(state: BookingLifecycleState): HubBookingStatus {
  const status = LIFECYCLE_TO_STATUS[state];
  if (status === undefined) {
    throw new HubCommandError(
      "EDGE_INVALID_TRANSITION",
      `Booking lifecycle state ${state} has no Hub-local projection value.`,
      { lifecycleState: state },
    );
  }
  return status;
}

/**
 * Reconstruct the engine's PRODUCTION state from the stored projection so the
 * engine can decide the next edge. A status that is not a production state
 * (a draft or a compensating branch) has no production state and the caller
 * must refuse rather than assume one.
 */
export function productionStateForStatus(status: string): ProductionState {
  const state = STATUS_TO_PRODUCTION[status as HubBookingStatus];
  if (state === undefined) {
    throw new HubCommandError(
      "EDGE_INVALID_TRANSITION",
      `Booking status '${status}' is not a canonical production state; the production engine cannot decide from it.`,
      { status },
    );
  }
  return state;
}

/** Reconstruct the engine's LIFECYCLE state from the stored projection. */
export function lifecycleStateForStatus(status: string): BookingLifecycleState {
  if (status === "draft") return "DRAFT";
  for (const [lifecycle, projected] of Object.entries(LIFECYCLE_TO_STATUS)) {
    if (projected === status && lifecycle !== "CONFIRMED/FINALIZED" && lifecycle !== "DRAFT") {
      return lifecycle as BookingLifecycleState;
    }
  }
  // Every production stage is past the finalization boundary (KBR-TXN-003).
  if (STATUS_TO_PRODUCTION[status as HubBookingStatus] !== undefined) {
    return "CONFIRMED/FINALIZED";
  }
  throw new HubCommandError(
    "EDGE_INVALID_TRANSITION",
    `Booking status '${status}' has no canonical lifecycle state.`,
    { status },
  );
}

export function isHubBookingStatus(value: string): value is HubBookingStatus {
  return (HUB_BOOKING_STATUSES as readonly string[]).includes(value);
}

/** Custody states used by `garment.current_custody_state` / `bag.…` (fixture vocabulary). */
export const HUB_CUSTODY_STATES = [
  "in_processing",
  "in_ready_storage",
  "released_to_customer",
] as const;
export type HubCustodyState = (typeof HUB_CUSTODY_STATES)[number];
