/**
 * Canonical Booking (transaction) lifecycle state machine.
 *
 * Source authority: `docs/source/business-rules/`
 * `kitluy-transaction-and-booking-lifecycle-v1.0.0.md` §4 "Canonical
 * lifecycle" (owner-canonical, SPECIFIED). State names are EXACTLY as drawn
 * there — including the combined `CONFIRMED/FINALIZED` and
 * `FULFILLED/COMPLETED` labels and the compensating `RETURN/REFUND` branch:
 *
 * ```text
 * DRAFT -> CONFIRMED/FINALIZED -> IN_PROGRESS -> PARTIALLY_FULFILLED -> FULFILLED/COMPLETED
 *    |             |                    |
 *    +-> EXPIRED   +-> CANCELLED        +-> ISSUE_HOLD
 *                  +-> VOIDED           +-> RETURN/REFUND (compensating)
 * ```
 *
 * "`Booking` is the Laundry-facing term; the neutral authoritative aggregate
 * remains compatible with `transaction` contracts." (§4)
 */

/** Lifecycle states verbatim from the §4 diagram. */
export const BOOKING_LIFECYCLE_STATES = [
  "DRAFT",
  "CONFIRMED/FINALIZED",
  "IN_PROGRESS",
  "PARTIALLY_FULFILLED",
  "FULFILLED/COMPLETED",
  "EXPIRED",
  "CANCELLED",
  "VOIDED",
  "ISSUE_HOLD",
  "RETURN/REFUND",
] as const;
export type BookingLifecycleState = (typeof BOOKING_LIFECYCLE_STATES)[number];

/**
 * Transition table — ONLY the edges drawn in the §4 diagram:
 * - DRAFT → CONFIRMED/FINALIZED (KBR-TXN-003) and DRAFT → EXPIRED
 *   (KBR-TXN-001 compensating action: "Expire or abandon draft").
 * - CONFIRMED/FINALIZED → IN_PROGRESS, → CANCELLED (KBR-TXN-005),
 *   → VOIDED (KBR-TXN-006).
 * - IN_PROGRESS → PARTIALLY_FULFILLED (KBR-TXN-007), → ISSUE_HOLD,
 *   → RETURN/REFUND (compensating branch, §4).
 * - PARTIALLY_FULFILLED → FULFILLED/COMPLETED (KBR-TXN-007: "Completion
 *   occurs only when all required units are fulfilled, cancelled or
 *   otherwise closed under policy").
 *
 * The doc draws no outgoing edges for EXPIRED, CANCELLED, VOIDED, ISSUE_HOLD,
 * RETURN/REFUND or FULFILLED/COMPLETED, so none are encoded (no invention).
 */
export const BOOKING_LIFECYCLE_TRANSITIONS: Readonly<
  Record<BookingLifecycleState, readonly BookingLifecycleState[]>
> = {
  DRAFT: ["CONFIRMED/FINALIZED", "EXPIRED"],
  "CONFIRMED/FINALIZED": ["IN_PROGRESS", "CANCELLED", "VOIDED"],
  IN_PROGRESS: ["PARTIALLY_FULFILLED", "ISSUE_HOLD", "RETURN/REFUND"],
  PARTIALLY_FULFILLED: ["FULFILLED/COMPLETED"],
  "FULFILLED/COMPLETED": [],
  EXPIRED: [],
  CANCELLED: [],
  VOIDED: [],
  ISSUE_HOLD: [],
  "RETURN/REFUND": [],
};

export class BookingLifecycleTransitionError extends Error {
  constructor(from: BookingLifecycleState, to: BookingLifecycleState) {
    super(
      `Illegal Booking lifecycle transition ${from} → ${to} ` +
        `(kitluy-transaction-and-booking-lifecycle-v1.0.0.md §4).`,
    );
    this.name = "BookingLifecycleTransitionError";
  }
}

export function canBookingTransition(
  from: BookingLifecycleState,
  to: BookingLifecycleState,
): boolean {
  return BOOKING_LIFECYCLE_TRANSITIONS[from].includes(to);
}

/**
 * Validate and apply a lifecycle edge. Post-finalization edges (everything
 * after CONFIRMED/FINALIZED) represent states DERIVED from append-only
 * events/obligations — never direct row edits: "Finalization is the
 * immutability boundary. Status labels after finalization are derived from
 * append-only events and obligations." (§4)
 */
export function transitionBooking(
  from: BookingLifecycleState,
  to: BookingLifecycleState,
): BookingLifecycleState {
  if (!canBookingTransition(from, to)) throw new BookingLifecycleTransitionError(from, to);
  return to;
}

/**
 * Finalization = immutability boundary (§4; KBR-TXN-003: "Atomically set
 * CONFIRMED/FINALIZED boundary ... freeze protected facts"). Only DRAFT is
 * pre-finalization mutable (KBR-TXN-001: "mutable commercial workspace");
 * EXPIRED is an abandoned draft that never crossed the boundary.
 */
export function isFinalized(state: BookingLifecycleState): boolean {
  return state !== "DRAFT" && state !== "EXPIRED";
}

export class FinalizationBoundaryError extends Error {
  constructor(state: BookingLifecycleState) {
    super(
      `Booking in state ${state} is past the finalization boundary; ` +
        `direct mutation is prohibited — post-finalization corrections must be ` +
        `linked compensating records (kitluy-transaction-and-booking-lifecycle-` +
        `v1.0.0.md §1 principle 4, §4, KBR-TXN-003 "never reopen protected ` +
        `facts for editing").`,
    );
    this.name = "FinalizationBoundaryError";
  }
}

/**
 * Guard for direct (non-compensating) mutations. Throws once the Booking is
 * finalized: "Finalized transaction, payment, inventory, finance and audit
 * records are append-only. Corrections use linked compensating records;
 * destructive edits are prohibited." (§1 principle 4)
 */
export function assertNotFinalized(state: BookingLifecycleState): void {
  if (isFinalized(state)) throw new FinalizationBoundaryError(state);
}

/**
 * Branch states entered only through governed compensating records, never by
 * editing the original: CANCELLED via a cancellation record (KBR-TXN-005:
 * "Original transaction remains immutable"), VOIDED via a full compensating
 * transaction (KBR-TXN-006), RETURN/REFUND drawn "(compensating)" in §4.
 */
export const COMPENSATING_BRANCH_STATES = ["CANCELLED", "VOIDED", "RETURN/REFUND"] as const;
export type CompensatingBranchState = (typeof COMPENSATING_BRANCH_STATES)[number];

export function isCompensatingBranch(state: BookingLifecycleState): boolean {
  return (COMPENSATING_BRANCH_STATES as readonly BookingLifecycleState[]).includes(state);
}
