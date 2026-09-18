/**
 * The profile a multi-profile seat pairs into (2026-09-18): the first real
 * T1 + T2 counter seat listed T2 first, the terminal paired into T2, and the
 * Store Hub refused the POS as PROFILE_NOT_T1. The terminal now presents its
 * lowest-numbered profile; the rule reads the `tN` segment only.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { orderProfilesForPairing, readSeat } from "../src/bin/terminal-edge.js";

describe("the profile a seat pairs into", () => {
  it("puts the lowest-numbered profile first, keeping the Partner's order among equals", () => {
    expect(
      orderProfilesForPairing(["laundry.t2.customer_display", "laundry.t1.intake_cashier"]),
    ).toEqual(["laundry.t1.intake_cashier", "laundry.t2.customer_display"]);
    expect(
      orderProfilesForPairing([
        "laundry.t4.pickup_scan_out",
        "laundry.t3.ready_scan_in",
        "laundry.t1.intake_cashier",
        "laundry.t2.customer_display",
      ]),
    ).toEqual([
      "laundry.t1.intake_cashier",
      "laundry.t2.customer_display",
      "laundry.t3.ready_scan_in",
      "laundry.t4.pickup_scan_out",
    ]);
    // No vertical vocabulary: any vertical's numbering works the same way.
    expect(orderProfilesForPairing(["cafe.t12.kds", "cafe.t2.floor"])).toEqual([
      "cafe.t2.floor",
      "cafe.t12.kds",
    ]);
    expect(orderProfilesForPairing([])).toEqual([]);
  });

  it("reads a seat file the way the cloud writes it, T2-first included", () => {
    const dir = mkdtempSync(join(tmpdir(), "kitluy-seat-"));
    const path = join(dir, "assignment.json");
    writeFileSync(
      path,
      JSON.stringify({
        digitalStoreReference: "00000000-0000-4000-8000-000000000015",
        storeLocationReference: "00000000-0000-4000-8000-000000000018",
        terminalProfileKeys: ["laundry.t2.customer_display", "laundry.t1.intake_cashier", 7, "bad"],
      }),
    );
    const seat = readSeat(path);
    expect(seat.profileCodes).toEqual(["laundry.t1.intake_cashier", "laundry.t2.customer_display"]);
    expect(seat.digitalStoreId).toBe("00000000-0000-4000-8000-000000000015");
  });
});
