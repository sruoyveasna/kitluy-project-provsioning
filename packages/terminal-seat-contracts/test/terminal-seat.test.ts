import { describe, expect, it } from "vitest";

import {
  APPLICATION_REFUSALS,
  ApplicationRegistry,
  SurfaceRegistry,
  TERMINAL_SEAT_REFUSALS,
  deriveTerminalSeatDesiredState,
  requireApplicationsForVertical,
  requireProfilesForVertical,
  requireVerticalKey,
  type ApplicationIdentifier,
  type SurfaceIdentifier,
  type TerminalSeatDefinition,
} from "../src/index.js";

// Registry-key verticals and test profile codes. The four laundry profile
// identifiers are the owner-locked ones (KLD-2026-07-26-002 Group 2) and are
// used here exactly as declared — requirement 8.
const T1 = "laundry.t1.intake_cashier";
const T2 = "laundry.t2.customer_display";
const T3 = "laundry.t3.ready_scan_in";
const T4 = "laundry.t4.pickup_scan_out";

const registries = () => {
  const applications = ApplicationRegistry.create([
    {
      id: "laundry.pos" as ApplicationIdentifier,
      vertical: "laundry",
      displayName: "phase-1 application",
      appliesToProfileCodes: [T1, T2, T3, T4],
      provenance: "TEST",
    },
    {
      id: "cafe_restaurant.pos" as ApplicationIdentifier,
      vertical: "cafe_restaurant",
      displayName: "phase-2 placeholder — derives nothing",
      appliesToProfileCodes: [],
      provenance: "TEST",
    },
  ]);
  const surfaces = SurfaceRegistry.create([
    { id: "test.alpha" as SurfaceIdentifier, displayName: "alpha", provenance: "TEST" },
  ]);
  if (!applications.ok || !surfaces.ok) throw new Error("setup");
  return { applications: applications.value, surfaces: surfaces.value };
};

const seat = (over: Partial<TerminalSeatDefinition> = {}): TerminalSeatDefinition => ({
  seatId: "seat-1",
  tenantId: "tenant-1",
  digitalStoreId: "store-1",
  storeLocationId: "loc-1",
  label: "Front Counter 01",
  primaryVertical: "laundry",
  terminalProfileCodes: [T1, T2],
  allowedSurfaces: [],
  ...over,
});

describe("requireVerticalKey", () => {
  it("accepts a registry key and refuses anything else (requirement 12)", () => {
    expect(requireVerticalKey("laundry").ok).toBe(true);
    const r = requireVerticalKey("retail");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(TERMINAL_SEAT_REFUSALS.UNKNOWN_VERTICAL);
  });
});

describe("requireProfilesForVertical", () => {
  it("accepts the four locked laundry profiles for a laundry seat (requirement 8)", () => {
    const r = requireProfilesForVertical([T1, T2, T3, T4], "laundry");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([T1, T2, T3, T4]);
  });
  it("refuses an empty profile set", () => {
    const r = requireProfilesForVertical([], "laundry");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(TERMINAL_SEAT_REFUSALS.NO_PROFILES);
  });
  it("refuses a malformed profile code", () => {
    const r = requireProfilesForVertical(["laundry.intake"], "laundry");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(TERMINAL_SEAT_REFUSALS.MALFORMED_PROFILE_CODE);
  });
  it("refuses a profile from another vertical — the prefix cross-check never corrects the vertical", () => {
    const r = requireProfilesForVertical([T1, "cafe_restaurant.t1.register"], "laundry");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(TERMINAL_SEAT_REFUSALS.PROFILE_VERTICAL_MISMATCH);
  });
  it("refuses a duplicate profile", () => {
    const r = requireProfilesForVertical([T1, T1], "laundry");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(TERMINAL_SEAT_REFUSALS.DUPLICATE_PROFILE);
  });
});

describe("deriveTerminalSeatDesiredState", () => {
  it("derives the phase-1 application for a laundry seat from vertical + profiles (requirement 5)", () => {
    const r = deriveTerminalSeatDesiredState(seat(), registries());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.primaryVertical).toBe("laundry");
    expect(r.value.desiredApplications).toEqual(["laundry.pos"]);
    expect(r.value.derivation).toEqual([
      { applicationId: "laundry.pos", byProfileCodes: [T1, T2], provenance: "TEST" },
    ]);
    expect(r.value.terminalProfileCodes).toEqual([T1, T2]);
    expect(r.value.allowedSurfaces).toEqual([]);
  });

  it("is deterministic: the same seat derives byte-identical state", () => {
    const a = deriveTerminalSeatDesiredState(seat(), registries());
    const b = deriveTerminalSeatDesiredState(seat(), registries());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("carries the EXPLICIT vertical, not one read from the profile prefix", () => {
    // Profiles say laundry, but the Store says cafe_restaurant. The explicit
    // value wins the argument by REFUSING, never by being overwritten.
    const r = deriveTerminalSeatDesiredState(seat({ primaryVertical: "cafe_restaurant" }), registries());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(TERMINAL_SEAT_REFUSALS.PROFILE_VERTICAL_MISMATCH);
  });

  it("refuses an unknown vertical before looking at anything else", () => {
    const r = deriveTerminalSeatDesiredState(seat({ primaryVertical: "retail" }), registries());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(TERMINAL_SEAT_REFUSALS.UNKNOWN_VERTICAL);
  });

  it("refuses when no registered application applies — a seat that derives nothing is not installable", () => {
    // A phase-2 seat with a well-formed profile: the placeholder descriptor
    // declares no profiles, so nothing derives. Café behaviour is NOT invented.
    const r = deriveTerminalSeatDesiredState(
      seat({ primaryVertical: "cafe_restaurant", terminalProfileCodes: ["cafe_restaurant.t1.register"] }),
      registries(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(TERMINAL_SEAT_REFUSALS.NO_APPLICATION_FOR_SEAT);
  });

  it("validates allowed surfaces separately from application derivation (requirement 7)", () => {
    const ok = deriveTerminalSeatDesiredState(seat({ allowedSurfaces: ["test.alpha"] }), registries());
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value.allowedSurfaces).toEqual(["test.alpha"]);
      // Surfaces changed nothing about the derived application.
      expect(ok.value.desiredApplications).toEqual(["laundry.pos"]);
    }
    const bad = deriveTerminalSeatDesiredState(seat({ allowedSurfaces: ["test.unknown"] }), registries());
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("terminal_seat.surface.unknown");
  });

  it("refuses an incomplete seat", () => {
    const r = deriveTerminalSeatDesiredState(seat({ storeLocationId: "" }), registries());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(TERMINAL_SEAT_REFUSALS.INCOMPLETE_SEAT);
  });
});

describe("requireApplicationsForVertical — the received-list guard", () => {
  it("refuses a phase-2 application arriving for a laundry seat (requirement 6, end to end)", () => {
    const r = requireApplicationsForVertical(["cafe_restaurant.pos"], "laundry", registries().applications);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(APPLICATION_REFUSALS.CROSS_VERTICAL);
  });
  it("refuses an unknown application identifier", () => {
    const r = requireApplicationsForVertical(["laundry.something_else"], "laundry", registries().applications);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(APPLICATION_REFUSALS.UNKNOWN_APPLICATION);
  });
});
