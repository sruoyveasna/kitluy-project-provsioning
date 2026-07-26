import { describe, expect, it } from "vitest";
import {
  BOOKING_LIFECYCLE_STATES,
  BOOKING_LIFECYCLE_TRANSITIONS,
  BookingLifecycleTransitionError,
  COMPENSATING_BRANCH_STATES,
  FinalizationBoundaryError,
  assertNotFinalized,
  canBookingTransition,
  isCompensatingBranch,
  isFinalized,
  transitionBooking,
  type BookingLifecycleState,
} from "../src/index.js";

describe("Booking lifecycle states (kitluy-transaction-and-booking-lifecycle-v1.0.0.md §4)", () => {
  it("declares exactly the states drawn in the canonical diagram, verbatim", () => {
    expect(BOOKING_LIFECYCLE_STATES).toEqual([
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
    ]);
  });

  it("every state has a transition-table row", () => {
    for (const state of BOOKING_LIFECYCLE_STATES) {
      expect(BOOKING_LIFECYCLE_TRANSITIONS[state]).toBeDefined();
    }
  });
});

describe("Booking lifecycle happy path (§4 main chain)", () => {
  it("DRAFT → CONFIRMED/FINALIZED → IN_PROGRESS → PARTIALLY_FULFILLED → FULFILLED/COMPLETED", () => {
    let s: BookingLifecycleState = "DRAFT";
    s = transitionBooking(s, "CONFIRMED/FINALIZED");
    s = transitionBooking(s, "IN_PROGRESS");
    s = transitionBooking(s, "PARTIALLY_FULFILLED");
    s = transitionBooking(s, "FULFILLED/COMPLETED");
    expect(s).toBe("FULFILLED/COMPLETED");
  });
});

describe("Booking lifecycle branches (§4)", () => {
  it("DRAFT → EXPIRED (abandoned draft, KBR-TXN-001 compensating action)", () => {
    expect(transitionBooking("DRAFT", "EXPIRED")).toBe("EXPIRED");
  });

  it("CONFIRMED/FINALIZED → CANCELLED (KBR-TXN-005)", () => {
    expect(transitionBooking("CONFIRMED/FINALIZED", "CANCELLED")).toBe("CANCELLED");
  });

  it("CONFIRMED/FINALIZED → VOIDED (KBR-TXN-006)", () => {
    expect(transitionBooking("CONFIRMED/FINALIZED", "VOIDED")).toBe("VOIDED");
  });

  it("IN_PROGRESS → ISSUE_HOLD", () => {
    expect(transitionBooking("IN_PROGRESS", "ISSUE_HOLD")).toBe("ISSUE_HOLD");
  });

  it("IN_PROGRESS → RETURN/REFUND (compensating branch)", () => {
    expect(transitionBooking("IN_PROGRESS", "RETURN/REFUND")).toBe("RETURN/REFUND");
  });

  it("marks CANCELLED, VOIDED and RETURN/REFUND as compensating-only branches", () => {
    expect(COMPENSATING_BRANCH_STATES).toEqual(["CANCELLED", "VOIDED", "RETURN/REFUND"]);
    expect(isCompensatingBranch("CANCELLED")).toBe(true);
    expect(isCompensatingBranch("VOIDED")).toBe(true);
    expect(isCompensatingBranch("RETURN/REFUND")).toBe(true);
    expect(isCompensatingBranch("IN_PROGRESS")).toBe(false);
    expect(isCompensatingBranch("FULFILLED/COMPLETED")).toBe(false);
  });
});

describe("Booking lifecycle denied transitions (only drawn edges are legal)", () => {
  it("rejects skipping the finalization boundary from DRAFT", () => {
    expect(() => transitionBooking("DRAFT", "IN_PROGRESS")).toThrow(
      BookingLifecycleTransitionError,
    );
    expect(() => transitionBooking("DRAFT", "FULFILLED/COMPLETED")).toThrow(
      BookingLifecycleTransitionError,
    );
  });

  it("rejects cancellation/void of an unfinalized DRAFT (drafts expire instead)", () => {
    expect(() => transitionBooking("DRAFT", "CANCELLED")).toThrow(BookingLifecycleTransitionError);
    expect(() => transitionBooking("DRAFT", "VOIDED")).toThrow(BookingLifecycleTransitionError);
  });

  it("rejects expiry after finalization", () => {
    expect(canBookingTransition("CONFIRMED/FINALIZED", "EXPIRED")).toBe(false);
    expect(() => transitionBooking("IN_PROGRESS", "EXPIRED")).toThrow(
      BookingLifecycleTransitionError,
    );
  });

  it("rejects skipping PARTIALLY_FULFILLED (only drawn chain edges exist)", () => {
    expect(canBookingTransition("IN_PROGRESS", "FULFILLED/COMPLETED")).toBe(false);
  });

  it("rejects undrawn branches from PARTIALLY_FULFILLED", () => {
    expect(canBookingTransition("PARTIALLY_FULFILLED", "ISSUE_HOLD")).toBe(false);
    expect(canBookingTransition("PARTIALLY_FULFILLED", "CANCELLED")).toBe(false);
    expect(canBookingTransition("PARTIALLY_FULFILLED", "RETURN/REFUND")).toBe(false);
  });

  it("rejects every backward transition", () => {
    expect(() => transitionBooking("CONFIRMED/FINALIZED", "DRAFT")).toThrow(
      BookingLifecycleTransitionError,
    );
    expect(() => transitionBooking("IN_PROGRESS", "CONFIRMED/FINALIZED")).toThrow(
      BookingLifecycleTransitionError,
    );
    expect(() => transitionBooking("PARTIALLY_FULFILLED", "IN_PROGRESS")).toThrow(
      BookingLifecycleTransitionError,
    );
    expect(() => transitionBooking("FULFILLED/COMPLETED", "PARTIALLY_FULFILLED")).toThrow(
      BookingLifecycleTransitionError,
    );
  });

  it("terminal/branch states have no drawn outgoing edges", () => {
    for (const terminal of [
      "FULFILLED/COMPLETED",
      "EXPIRED",
      "CANCELLED",
      "VOIDED",
      "ISSUE_HOLD",
      "RETURN/REFUND",
    ] as const) {
      expect(BOOKING_LIFECYCLE_TRANSITIONS[terminal]).toEqual([]);
      for (const to of BOOKING_LIFECYCLE_STATES) {
        expect(canBookingTransition(terminal, to)).toBe(false);
      }
    }
  });

  it("error message cites the canonical lifecycle contract", () => {
    expect(() => transitionBooking("DRAFT", "IN_PROGRESS")).toThrow(
      /kitluy-transaction-and-booking-lifecycle-v1\.0\.0\.md §4/,
    );
  });
});

describe("finalization immutability boundary (§4; KBR-TXN-003)", () => {
  it("only DRAFT and EXPIRED are pre-finalization", () => {
    expect(isFinalized("DRAFT")).toBe(false);
    expect(isFinalized("EXPIRED")).toBe(false);
    for (const state of [
      "CONFIRMED/FINALIZED",
      "IN_PROGRESS",
      "PARTIALLY_FULFILLED",
      "FULFILLED/COMPLETED",
      "CANCELLED",
      "VOIDED",
      "ISSUE_HOLD",
      "RETURN/REFUND",
    ] as const) {
      expect(isFinalized(state)).toBe(true);
    }
  });

  it("permits direct edits before finalization", () => {
    expect(() => assertNotFinalized("DRAFT")).not.toThrow();
    expect(() => assertNotFinalized("EXPIRED")).not.toThrow();
  });

  it("blocks direct mutation of every finalized state", () => {
    for (const state of BOOKING_LIFECYCLE_STATES.filter((s) => isFinalized(s))) {
      expect(() => assertNotFinalized(state)).toThrow(FinalizationBoundaryError);
    }
  });

  it("directs post-finalization corrections to compensating records", () => {
    expect(() => assertNotFinalized("CONFIRMED/FINALIZED")).toThrow(/compensating records/);
    expect(() => assertNotFinalized("FULFILLED/COMPLETED")).toThrow(/never reopen protected facts/);
  });
});
