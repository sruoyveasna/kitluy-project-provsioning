import { describe, expect, it } from "vitest";
import { khr, usdCents } from "@kitluy/money";
import {
  assertProfileMayEmit,
  canReleaseCustody,
  canTransition,
  confirmKhqrPayment,
  emittingProfile,
  HARDWARE_PROFILES,
  LAUNDRY_TERMINAL_PROFILES,
  pricePerPieceLine,
  pricePerWeightLine,
  RETIRED_TERMINAL_IDENTIFIERS,
  T2TransitionError,
  T3_READY_EVENTS,
  T4_PICKUP_EVENTS,
  TERMINAL_CAPABILITIES,
  transition,
} from "../src/index.js";

describe("owner-locked T1-T4 terminal model (KLV4-DEC-005)", () => {
  it("defines exactly the four locked profiles", () => {
    expect(LAUNDRY_TERMINAL_PROFILES).toEqual([
      "t1_intake_cashier",
      "t2_customer_display",
      "t3_ready_scan_in",
      "t4_pickup_scan_out",
    ]);
  });

  it("rejects the superseded three-terminal identifiers", () => {
    for (const legacy of RETIRED_TERMINAL_IDENTIFIERS) {
      expect(LAUNDRY_TERMINAL_PROFILES as readonly string[]).not.toContain(legacy);
    }
  });

  it("T2 is customer-facing only and never a production terminal", () => {
    const t2 = TERMINAL_CAPABILITIES.t2_customer_display;
    expect(t2.customerFacingOnly).toBe(true);
    expect(t2.createsBookings).toBe(false);
    expect(t2.recordsReadyCustody).toBe(false);
    expect(t2.releasesCustody).toBe(false);
  });

  it("T4 is the only profile that may release custody; T3 never does", () => {
    expect(canReleaseCustody("t4_pickup_scan_out")).toBe(true);
    expect(canReleaseCustody("t3_ready_scan_in")).toBe(false);
    expect(canReleaseCustody("t1_intake_cashier")).toBe(false);
    expect(canReleaseCustody("t2_customer_display")).toBe(false);
  });

  it("T3/T4 may share hardware but stay separate modes", () => {
    expect(HARDWARE_PROFILES).toContain("laundry_ready_pickup");
    expect(HARDWARE_PROFILES).toContain("laundry_t3_dedicated");
    expect(HARDWARE_PROFILES).toContain("laundry_t4_dedicated");
  });
});

describe("custody events (Hub spec §10.3-10.4)", () => {
  it("registers the T3 and T4 event names verbatim", () => {
    expect(T3_READY_EVENTS).toContain("laundry_booking_marked_ready");
    expect(T4_PICKUP_EVENTS).toContain("laundry_handover_confirmed");
    expect(T3_READY_EVENTS).toHaveLength(6);
    expect(T4_PICKUP_EVENTS).toHaveLength(9);
  });

  it("only the owning profile may emit its custody events", () => {
    expect(emittingProfile("laundry_item_ready_scanned")).toBe("t3_ready_scan_in");
    expect(emittingProfile("laundry_item_scanned_out")).toBe("t4_pickup_scan_out");
    expect(() => assertProfileMayEmit("t3_ready_scan_in", "laundry_booking_picked_up")).toThrow(
      /only t4_pickup_scan_out/,
    );
    expect(() => assertProfileMayEmit("t2_customer_display", "laundry_item_ready_scanned")).toThrow(
      /only t3_ready_scan_in/,
    );
  });
});

describe("T2 display state machine (POS spec §6.2)", () => {
  it("follows the specified happy path", () => {
    let s = transition("IDLE", "SESSION_BOUND");
    s = transition(s, "INTAKE_MIRROR");
    s = transition(s, "REVIEW");
    s = transition(s, "PAYMENT_REQUESTED");
    s = transition(s, "KHQR_PENDING");
    s = transition(s, "PAYMENT_CONFIRMED");
    s = transition(s, "RECEIPT_CHOICE");
    s = transition(s, "PICKUP_REFERENCE");
    s = transition(s, "THANK_YOU");
    s = transition(s, "PRIVACY_RESET");
    expect(transition(s, "IDLE")).toBe("IDLE");
  });

  it("rejects illegal jumps", () => {
    expect(() => transition("IDLE", "PAYMENT_CONFIRMED")).toThrow(T2TransitionError);
    expect(() => transition("THANK_YOU", "REVIEW")).toThrow(T2TransitionError);
    expect(canTransition("PRIVACY_RESET", "SESSION_BOUND")).toBe(false);
  });

  it("failed payment may retry; every state can privacy-reset", () => {
    expect(canTransition("PAYMENT_FAILED_OR_EXPIRED", "PAYMENT_REQUESTED")).toBe(true);
    expect(canTransition("KHQR_PENDING", "PRIVACY_RESET")).toBe(true);
    expect(canTransition("REVIEW", "PRIVACY_RESET")).toBe(true);
  });

  it("KHQR confirmation requires verified provider evidence (POS spec §5.10)", () => {
    expect(() => confirmKhqrPayment("KHQR_PENDING", false)).toThrow(/provider evidence/);
    expect(confirmKhqrPayment("KHQR_PENDING", true)).toBe("PAYMENT_CONFIRMED");
    expect(() => confirmKhqrPayment("IDLE", true)).toThrow(T2TransitionError);
  });
});

describe("Laundry pricing lines (per-piece / per-weight)", () => {
  it("per-piece totals use the immutable snapshot", () => {
    const total = pricePerPieceLine({
      kind: "per_piece",
      serviceCode: "wash_press_shirt",
      unitPriceSnapshot: khr(4000),
      pieceCount: 3,
    });
    expect(total.minorUnits).toBe(12000n);
  });

  it("per-weight totals require an explicit rounding rule", () => {
    const line = {
      kind: "per_weight",
      serviceCode: "wash_by_kg",
      pricePerKgSnapshot: usdCents(199), // $1.99/kg
      weightGrams: 2500,
    } as const;
    // 199 * 2500 / 1000 = 497.5 cents
    expect(pricePerWeightLine(line, "round_half_up_minor_unit").minorUnits).toBe(498n);
    expect(pricePerWeightLine(line, "round_up_minor_unit").minorUnits).toBe(498n);
    const exact = { ...line, weightGrams: 2000 };
    expect(pricePerWeightLine(exact, "round_up_minor_unit").minorUnits).toBe(398n);
  });

  it("rejects invalid quantities and weights", () => {
    expect(() =>
      pricePerPieceLine({
        kind: "per_piece",
        serviceCode: "s",
        unitPriceSnapshot: khr(1000),
        pieceCount: 0,
      }),
    ).toThrow(/positive integer/);
    expect(() =>
      pricePerWeightLine(
        {
          kind: "per_weight",
          serviceCode: "s",
          pricePerKgSnapshot: khr(6000),
          weightGrams: 2.5 as unknown as number,
        },
        "round_half_up_minor_unit",
      ),
    ).toThrow(/positive integer/);
  });
});
