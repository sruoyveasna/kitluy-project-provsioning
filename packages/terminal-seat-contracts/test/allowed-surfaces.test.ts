import { describe, expect, it } from "vitest";

import { SURFACE_REFUSALS, SurfaceRegistry, parseSurfaceIdentifier, type SurfaceIdentifier } from "../src/index.js";

// Test-local surfaces. The PRODUCT vocabulary is an owner decision and is
// deliberately not asserted anywhere in this package.
const registry = () =>
  SurfaceRegistry.create([
    { id: "test.alpha" as SurfaceIdentifier, displayName: "alpha", provenance: "TEST" },
    { id: "test.beta" as SurfaceIdentifier, displayName: "beta", provenance: "TEST" },
  ]);

describe("parseSurfaceIdentifier", () => {
  it("accepts dotted lowercase identifiers", () => {
    expect(parseSurfaceIdentifier("settings.network").ok).toBe(true);
    expect(parseSurfaceIdentifier("a.b.c").ok).toBe(true);
  });
  it.each(["settings", "Settings.network", "settings..network", "settings.", ""])("refuses %j", (v) => {
    const r = parseSurfaceIdentifier(v);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(SURFACE_REFUSALS.MALFORMED_IDENTIFIER);
  });
});

describe("SurfaceRegistry", () => {
  it("empty() registers nothing — the honest state before the owner defines surfaces", () => {
    const e = SurfaceRegistry.empty();
    expect(e.registered()).toHaveLength(0);
    expect(e.requireAll([]).ok).toBe(true);
    const r = e.requireAll(["settings.network"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(SURFACE_REFUSALS.UNKNOWN_SURFACE);
  });

  it("refuses duplicate registration", () => {
    const r = SurfaceRegistry.create([
      { id: "test.alpha" as SurfaceIdentifier, displayName: "a", provenance: "TEST" },
      { id: "test.alpha" as SurfaceIdentifier, displayName: "a again", provenance: "TEST" },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(SURFACE_REFUSALS.DUPLICATE_REGISTRATION);
  });

  it("requireAll accepts registered surfaces in the given order", () => {
    const reg = registry();
    if (!reg.ok) throw new Error("setup");
    const r = reg.value.requireAll(["test.beta", "test.alpha"]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(["test.beta", "test.alpha"]);
  });

  it("requireAll REFUSES an unknown surface (requirement 12)", () => {
    const reg = registry();
    if (!reg.ok) throw new Error("setup");
    const r = reg.value.requireAll(["test.alpha", "test.gamma"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(SURFACE_REFUSALS.UNKNOWN_SURFACE);
  });

  it("requireAll refuses a duplicate in the submitted set rather than collapsing it", () => {
    const reg = registry();
    if (!reg.ok) throw new Error("setup");
    const r = reg.value.requireAll(["test.alpha", "test.alpha"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(SURFACE_REFUSALS.DUPLICATE_IN_SET);
  });
});
