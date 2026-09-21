import { describe, expect, it } from "vitest";
import {
  ApplicationRegistry,
  SurfaceRegistry,
  deriveTerminalSeatDesiredState,
} from "@kitluy/terminal-seat-contracts";

import { LAUNDRY_APPLICATIONS, LAUNDRY_POS_APPLICATION, LAUNDRY_TERMINAL_PROFILES } from "../src/index.js";

describe("Laundry application declaration", () => {
  it("declares exactly one application, laundry.pos, for the laundry vertical", () => {
    expect(LAUNDRY_APPLICATIONS).toHaveLength(1);
    expect(LAUNDRY_POS_APPLICATION.id).toBe("laundry.pos");
    expect(LAUNDRY_POS_APPLICATION.vertical).toBe("laundry");
  });

  it("applies to all four owner-locked profiles and nothing else (requirement 8)", () => {
    expect([...LAUNDRY_POS_APPLICATION.appliesToProfileCodes]).toEqual([
      "laundry.t1.intake_cashier",
      "laundry.t2.customer_display",
      "laundry.t3.ready_scan_in",
      "laundry.t4.pickup_scan_out",
    ]);
    expect(LAUNDRY_POS_APPLICATION.appliesToProfileCodes).toEqual(LAUNDRY_TERMINAL_PROFILES);
  });

  it("registers cleanly and derives laundry.pos for a laundry seat with any locked profile", () => {
    const applications = ApplicationRegistry.create(LAUNDRY_APPLICATIONS);
    expect(applications.ok).toBe(true);
    if (!applications.ok) return;
    for (const profile of LAUNDRY_TERMINAL_PROFILES) {
      const r = deriveTerminalSeatDesiredState(
        {
          seatId: "seat",
          tenantId: "t",
          digitalStoreId: "s",
          storeLocationId: "l",
          label: "x",
          primaryVertical: "laundry",
          terminalProfileCodes: [profile],
          allowedSurfaces: [],
        },
        { applications: applications.value, surfaces: SurfaceRegistry.empty() },
      );
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.desiredApplications).toEqual(["laundry.pos"]);
    }
  });

  it("never derives laundry.pos for a seat whose Store is not laundry", () => {
    const applications = ApplicationRegistry.create(LAUNDRY_APPLICATIONS);
    if (!applications.ok) throw new Error("setup");
    const r = deriveTerminalSeatDesiredState(
      {
        seatId: "seat",
        tenantId: "t",
        digitalStoreId: "s",
        storeLocationId: "l",
        label: "x",
        primaryVertical: "cafe_restaurant",
        terminalProfileCodes: ["laundry.t1.intake_cashier"],
        allowedSurfaces: [],
      },
      { applications: applications.value, surfaces: SurfaceRegistry.empty() },
    );
    expect(r.ok).toBe(false);
  });
});
