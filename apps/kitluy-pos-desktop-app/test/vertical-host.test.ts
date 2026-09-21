/**
 * Vertical host — the ONE POS Desktop shell resolves its experience from
 * authoritative Store Hub configuration.
 *
 * Authority: owner decision 2026-08-07 (POS unification) §2, §3, §7, §17, §18.
 *
 * These tests pin the two properties the owner decision is most concerned with:
 *   1. the same installed application becomes the correct terminal purely from
 *      authoritative assignment;
 *   2. Phase 2 café/restaurant can never load as Phase 1.
 */
import type { AuthoritativeStoreAssignment } from "@kitluy/digital-store-context";
import { describe, expect, it } from "vitest";

import {
  CAFE_RESTAURANT_MODULE,
  LAUNDRY_MODULE,
  REGISTERED_VERTICAL_MODULES,
  VERTICAL_HOST_REFUSALS,
  VerticalRegistry,
  type VerticalModule,
} from "../src/vertical/index.js";

const registry = new VerticalRegistry(REGISTERED_VERTICAL_MODULES);

const assignment = (over: Partial<AuthoritativeStoreAssignment> = {}) =>
  ({
    tenantId: "tenant-1",
    digitalStoreId: "store-1",
    storeLocationId: "location-1",
    terminalDeviceId: "device-1",
    terminalProfileCode: "laundry.t1.intake_cashier",
    assignmentGeneration: 3,
    configurationVersion: 11,
    declaredVertical: "laundry",
    ...over,
  }) satisfies AuthoritativeStoreAssignment;

describe("registry composition", () => {
  it("registers Laundry ACTIVE and Café REGISTERED_INACTIVE", () => {
    expect(LAUNDRY_MODULE.state).toBe("ACTIVE_PHASE1");
    expect(CAFE_RESTAURANT_MODULE.state).toBe("REGISTERED_INACTIVE_PHASE2");
    expect(registry.registered()).toHaveLength(2);
  });

  it("rejects duplicate registration of a vertical", () => {
    expect(() => new VerticalRegistry([LAUNDRY_MODULE, LAUNDRY_MODULE])).toThrow(/Duplicate/);
  });

  it("declares all four owner-locked Laundry terminal profiles", () => {
    expect(LAUNDRY_MODULE.terminals.map((t) => t.terminalSegment)).toEqual([
      "t1",
      "t2",
      "t3",
      "t4",
    ]);
    for (const terminal of LAUNDRY_MODULE.terminals) {
      expect(terminal.terminalProfileCode.startsWith("laundry.")).toBe(true);
    }
  });

  it("every module records source provenance", () => {
    for (const module of registry.registered()) {
      expect(module.provenance.length).toBeGreaterThan(0);
    }
  });
});

describe("the same shell becomes the correct terminal", () => {
  it.each([
    ["laundry.t1.intake_cashier", "t1", "POS Cashier / Intake"],
    ["laundry.t2.customer_display", "t2", "Customer Display Screen"],
    ["laundry.t3.ready_scan_in", "t3", "Clean & Ready Scan-In"],
    ["laundry.t4.pickup_scan_out", "t4", "Customer Pickup Scan-Out"],
  ])("profile %s loads the %s experience", (code, segment, displayName) => {
    const result = registry.resolve(assignment({ terminalProfileCode: code }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.module.key).toBe("laundry");
      expect(result.value.terminal.terminalSegment).toBe(segment);
      expect(result.value.terminal.displayName).toBe(displayName);
      expect(result.value.context.digitalStoreId).toBe("store-1");
    }
  });
});

describe("Phase 2 can never load as Phase 1", () => {
  it("refuses a café assignment — the phase gate blocks it first", () => {
    const result = registry.resolve(
      // Declared and prefix agree on Phase 2; the phase gate is what refuses.
      assignment({ declaredVertical: "cafe_restaurant", terminalProfileCode: "cafe_restaurant.cashier.default" }),
    );
    expect(result.ok).toBe(false);
    // The phase gate refuses before the host is consulted.
    if (!result.ok) expect(result.error.code).toBe("digital_store.vertical.not_active");
  });

  it("refuses an inactive module even if a phase gate were to let it through", () => {
    // Defence in depth: a registry containing only the inactive café module,
    // reached with a vertical the gate considers active, must still refuse.
    const misconfigured: VerticalModule = { ...CAFE_RESTAURANT_MODULE, key: "laundry" };
    const result = new VerticalRegistry([misconfigured]).resolve(assignment());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(VERTICAL_HOST_REFUSALS.MODULE_NOT_ACTIVE);
  });
});

describe("fail-closed refusals", () => {
  it("refuses when no module is registered for the resolved vertical", () => {
    const result = new VerticalRegistry([CAFE_RESTAURANT_MODULE]).resolve(assignment());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(VERTICAL_HOST_REFUSALS.NO_MODULE_REGISTERED);
  });

  it("refuses an unknown terminal profile within an active vertical", () => {
    const result = registry.resolve(
      assignment({ terminalProfileCode: "laundry.t9.does_not_exist" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(VERTICAL_HOST_REFUSALS.NO_TERMINAL_EXPERIENCE);
  });

  it("refuses the retired three-terminal identifiers", () => {
    for (const retired of ["laundry.t2_scan_in.x", "laundry.t3_scan_out.x"]) {
      const result = registry.resolve(assignment({ terminalProfileCode: retired }));
      expect(result.ok).toBe(false);
    }
  });

  it("refuses an incomplete assignment", () => {
    const result = registry.resolve(assignment({ digitalStoreId: "" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("digital_store.assignment.incomplete");
  });
});
