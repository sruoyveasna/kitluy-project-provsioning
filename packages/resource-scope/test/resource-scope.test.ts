import { describe, expect, it } from "vitest";
import {
  assertScopeLevel,
  HIERARCHICAL_SCOPE_LEVELS,
  isHierarchicalScopeLevel,
  isScopeLevel,
  NON_HIERARCHICAL_SCOPE_LEVELS,
  RETIRED_SCOPE_LEVELS,
  SCOPE_LEVELS,
  sameScope,
  scopeBreadth,
  UnknownScopeLevelError,
  type ResourceScope,
  type ScopeLevel,
} from "../src/index.js";

const storeScope: ResourceScope = {
  level: "digital_store",
  resourceId: "ds-1",
  environment: "development",
};

describe("@kitluy/resource-scope", () => {
  it("exposes the canonical scope-level list in breadth order", () => {
    expect(SCOPE_LEVELS).toEqual([
      "platform",
      "region",
      "tenant",
      "chain",
      "digital_store",
      "store_location",
      "device_group",
      "device",
      "connector",
      "service",
      "release_cohort",
      "support_session",
      "file_object",
    ]);
    expect(new Set(SCOPE_LEVELS).size).toBe(SCOPE_LEVELS.length);
    expect(SCOPE_LEVELS).toEqual([...HIERARCHICAL_SCOPE_LEVELS, ...NON_HIERARCHICAL_SCOPE_LEVELS]);
  });

  // KLD-2026-07-26-002 Group 3 — approved renames.
  it("applies the tenant and device renames and retires the old spellings", () => {
    expect(isScopeLevel("tenant")).toBe(true);
    expect(isScopeLevel("device")).toBe(true);

    expect(isScopeLevel("tenant_or_partner")).toBe(false);
    expect(isScopeLevel("individual_device")).toBe(false);
    expect(SCOPE_LEVELS).not.toContain("tenant_or_partner");
    expect(SCOPE_LEVELS).not.toContain("individual_device");

    expect(RETIRED_SCOPE_LEVELS).toEqual({
      tenant_or_partner: "tenant",
      individual_device: "device",
    });
    for (const [retired, replacement] of Object.entries(RETIRED_SCOPE_LEVELS)) {
      expect(isScopeLevel(retired)).toBe(false);
      expect(isScopeLevel(replacement)).toBe(true);
      expect(() => assertScopeLevel(retired)).toThrow(UnknownScopeLevelError);
    }
  });

  it("registers the four additive scope types", () => {
    for (const level of ["chain", "file_object", "support_session", "release_cohort"]) {
      expect(isScopeLevel(level)).toBe(true);
      expect(SCOPE_LEVELS).toContain(level);
    }
    // `chain` joins the hierarchical spine between tenant and digital store;
    // the other three are narrow, non-hierarchical resource kinds.
    expect(isHierarchicalScopeLevel("chain")).toBe(true);
    expect(isHierarchicalScopeLevel("file_object")).toBe(false);
    expect(isHierarchicalScopeLevel("support_session")).toBe(false);
    expect(isHierarchicalScopeLevel("release_cohort")).toBe(false);
  });

  it("orders scope breadth from platform outward with chain inside the tenant", () => {
    expect(scopeBreadth("platform")).toBe(0);
    for (let i = 1; i < SCOPE_LEVELS.length; i += 1) {
      const previous = SCOPE_LEVELS[i - 1] as ScopeLevel;
      const current = SCOPE_LEVELS[i] as ScopeLevel;
      expect(scopeBreadth(previous)).toBeLessThan(scopeBreadth(current));
    }
    expect(scopeBreadth("tenant")).toBeLessThan(scopeBreadth("chain"));
    expect(scopeBreadth("chain")).toBeLessThan(scopeBreadth("digital_store"));
    expect(scopeBreadth("digital_store")).toBeLessThan(scopeBreadth("store_location"));
    expect(scopeBreadth("device_group")).toBeLessThan(scopeBreadth("device"));
    expect(scopeBreadth("device")).toBeLessThan(scopeBreadth("file_object"));
  });

  it("matches scopes exactly and never expands the hierarchy", () => {
    expect(sameScope(storeScope, storeScope)).toBe(true);
    expect(sameScope(storeScope, { ...storeScope })).toBe(true);

    // Broader level does not cover a narrower one — containment needs
    // resource_relationships data and is resolved server-side.
    const platformScope: ResourceScope = {
      level: "platform",
      resourceId: "het",
      environment: "development",
    };
    expect(sameScope(platformScope, storeScope)).toBe(false);
    expect(sameScope(storeScope, platformScope)).toBe(false);

    // Same level, different resource.
    expect(sameScope(storeScope, { ...storeScope, resourceId: "ds-2" })).toBe(false);
    // Same resource, different level.
    expect(sameScope(storeScope, { ...storeScope, level: "store_location" })).toBe(false);
    // Same resource and level, different environment — environment is its own
    // independent grant dimension (RB v4 §8.6).
    expect(sameScope(storeScope, { ...storeScope, environment: "production" })).toBe(false);
    expect(sameScope({ ...storeScope, level: "tenant" }, { ...storeScope, level: "chain" })).toBe(
      false,
    );
  });

  it("fails closed on unknown scope levels", () => {
    expect(isScopeLevel("")).toBe(false);
    expect(isScopeLevel("*")).toBe(false);
    expect(isScopeLevel("everything")).toBe(false);
    expect(isScopeLevel("Platform")).toBe(false);

    // scopeBreadth throws rather than returning -1: a sentinel below zero would
    // sort as BROADER than `platform` in any naive numeric comparison.
    expect(() => scopeBreadth("everything" as ScopeLevel)).toThrow(UnknownScopeLevelError);
    expect(() => scopeBreadth("tenant_or_partner" as ScopeLevel)).toThrow(UnknownScopeLevelError);
    expect(() => scopeBreadth("individual_device" as ScopeLevel)).toThrow(/Retired/);
    expect(() => scopeBreadth("*" as ScopeLevel)).toThrow(UnknownScopeLevelError);

    // Two identical unknown levels must still not match.
    const forged = { ...storeScope, level: "everything" as ScopeLevel };
    expect(sameScope(forged, forged)).toBe(false);
    expect(sameScope(forged, { ...forged })).toBe(false);
    expect(sameScope({ ...storeScope, level: "tenant_or_partner" as ScopeLevel }, storeScope)).toBe(
      false,
    );
  });
});
