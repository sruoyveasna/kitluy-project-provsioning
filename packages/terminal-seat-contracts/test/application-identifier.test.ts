import { describe, expect, it } from "vitest";

import {
  APPLICATION_REFUSALS,
  ApplicationRegistry,
  parseApplicationIdentifier,
  type ApplicationDescriptor,
  type ApplicationIdentifier,
} from "../src/index.js";

// Test-local descriptors use registry vertical KEYS only. No product
// vocabulary is asserted here — the contract, not the catalogue, is under test.
const phase1App: ApplicationDescriptor = {
  id: "laundry.pos" as ApplicationIdentifier,
  vertical: "laundry",
  displayName: "test phase-1 application",
  appliesToProfileCodes: ["laundry.t1.intake_cashier"],
  provenance: "TEST",
};
const phase2App: ApplicationDescriptor = {
  id: "cafe_restaurant.pos" as ApplicationIdentifier,
  vertical: "cafe_restaurant",
  displayName: "test phase-2 application",
  appliesToProfileCodes: [],
  provenance: "TEST",
};

describe("parseApplicationIdentifier", () => {
  it("accepts <vertical>.<application> with a registered vertical", () => {
    const r = parseApplicationIdentifier("laundry.pos");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ id: "laundry.pos", vertical: "laundry", application: "pos" });
  });

  it.each(["pos", "laundry.pos.extra", "Laundry.pos", "laundry.", ".pos", "laundry pos", ""])(
    "refuses malformed identifier %j",
    (v) => {
      const r = parseApplicationIdentifier(v);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe(APPLICATION_REFUSALS.MALFORMED_IDENTIFIER);
    },
  );

  it("refuses a vertical that is not one of the registry keys", () => {
    const r = parseApplicationIdentifier("retail.pos");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(APPLICATION_REFUSALS.UNKNOWN_VERTICAL);
  });
});

describe("ApplicationRegistry", () => {
  it("registers explicitly and looks up", () => {
    const reg = ApplicationRegistry.create([phase1App, phase2App]);
    expect(reg.ok).toBe(true);
    if (!reg.ok) return;
    expect(reg.value.registered()).toHaveLength(2);
    expect(reg.value.get("laundry.pos")?.vertical).toBe("laundry");
    expect(reg.value.get("nope.pos")).toBeUndefined();
  });

  it("refuses duplicate registration", () => {
    const reg = ApplicationRegistry.create([phase1App, phase1App]);
    expect(reg.ok).toBe(false);
    if (!reg.ok) expect(reg.error.code).toBe(APPLICATION_REFUSALS.DUPLICATE_REGISTRATION);
  });

  it("refuses a descriptor whose declared vertical disagrees with its identifier", () => {
    const reg = ApplicationRegistry.create([{ ...phase1App, vertical: "cafe_restaurant" }]);
    expect(reg.ok).toBe(false);
    if (!reg.ok) expect(reg.error.code).toBe(APPLICATION_REFUSALS.CROSS_VERTICAL);
  });

  it("require() refuses an unregistered application", () => {
    const reg = ApplicationRegistry.create([phase1App]);
    if (!reg.ok) throw new Error("setup");
    const r = reg.value.require("laundry.unregistered");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(APPLICATION_REFUSALS.UNKNOWN_APPLICATION);
  });

  it("requireAllForVertical REFUSES a phase-2 application in a phase-1 Store (requirement 6)", () => {
    const reg = ApplicationRegistry.create([phase1App, phase2App]);
    if (!reg.ok) throw new Error("setup");
    const r = reg.value.requireAllForVertical(["laundry.pos", "cafe_restaurant.pos"], "laundry");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe(APPLICATION_REFUSALS.CROSS_VERTICAL);
      expect(r.error.message).toContain("cannot be assigned in a 'laundry' Store");
    }
  });

  it("requireAllForVertical accepts only same-vertical applications", () => {
    const reg = ApplicationRegistry.create([phase1App, phase2App]);
    if (!reg.ok) throw new Error("setup");
    const r = reg.value.requireAllForVertical(["laundry.pos"], "laundry");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.map((d) => d.id)).toEqual(["laundry.pos"]);
  });
});
