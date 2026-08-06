import { describe, expect, it } from "vitest";
import type { ResourceScope } from "@kitluy/resource-scope";
import {
  assertCanonicalPermissionKey,
  CANONICAL_PERMISSION_KEYS,
  hasPermission,
  isCanonicalPermissionKey,
  isValidPermissionKey,
  KNOWN_PERMISSION_KEYS,
  RETIRED_PERMISSION_KEYS,
  UnknownPermissionKeyError,
} from "../src/index.js";

const storeScope: ResourceScope = {
  level: "digital_store",
  resourceId: "ds-1",
  environment: "development",
};

describe("@kitluy/rbac", () => {
  it("validates permission key format", () => {
    for (const key of KNOWN_PERMISSION_KEYS) {
      expect(isValidPermissionKey(key)).toBe(true);
    }
    expect(isValidPermissionKey("Admin")).toBe(false);
    expect(isValidPermissionKey("admin")).toBe(false); // broad single-segment roles rejected
    expect(isValidPermissionKey("a..b")).toBe(false);
  });

  it("deny by default: no grants means no access", () => {
    expect(hasPermission([], "platform.jobs.retry", storeScope)).toBe(false);
  });

  it("grants are exact: permission and scope must both match", () => {
    const grants = [{ permission: "platform.jobs.retry", scope: storeScope }];
    expect(hasPermission(grants, "platform.jobs.retry", storeScope)).toBe(true);
    expect(
      hasPermission(grants, "platform.jobs.retry", { ...storeScope, environment: "production" }),
    ).toBe(false);
    expect(hasPermission(grants, "releases.promote_stable", storeScope)).toBe(false);
  });

  it("never wildcard-matches", () => {
    const grants = [{ permission: "platform.jobs.retry", scope: storeScope }];
    expect(hasPermission(grants, "platform.jobs", storeScope)).toBe(false);
    expect(hasPermission(grants, "platform", storeScope)).toBe(false);
  });

  // KLD-2026-07-26-002 Group 3 — approved seed-key mappings.

  it("registers all three canonical release permissions", () => {
    for (const key of [
      "releases.promote_internal",
      "releases.promote_pilot",
      "releases.promote_stable",
    ]) {
      expect(isValidPermissionKey(key)).toBe(true);
      expect(isCanonicalPermissionKey(key)).toBe(true);
      expect(CANONICAL_PERMISSION_KEYS).toContain(key);
    }
  });

  it("rejects the legacy releases.promote.stable form as unknown", () => {
    expect(isCanonicalPermissionKey("releases.promote.stable")).toBe(false);
    expect(CANONICAL_PERMISSION_KEYS).not.toContain("releases.promote.stable");
    expect(hasPermission([], "releases.promote.stable", storeScope)).toBe(false);
    expect(() => assertCanonicalPermissionKey("releases.promote.stable")).toThrow(
      UnknownPermissionKeyError,
    );
    expect(RETIRED_PERMISSION_KEYS["releases.promote.stable"]).toEqual(["releases.promote_stable"]);
  });

  it("rejects infrastructure.backup.restore and splits it by environment capability", () => {
    expect(isCanonicalPermissionKey("infrastructure.backup.restore")).toBe(false);
    expect(CANONICAL_PERMISSION_KEYS).not.toContain("infrastructure.backup.restore");
    expect(() => assertCanonicalPermissionKey("infrastructure.backup.restore")).toThrow(
      UnknownPermissionKeyError,
    );

    // Two distinct, separately-granted capabilities — never one key plus a flag.
    expect(isCanonicalPermissionKey("platform.backup.restore_test")).toBe(true);
    expect(isCanonicalPermissionKey("platform.backup.restore_production")).toBe(true);
    expect("platform.backup.restore_test").not.toBe("platform.backup.restore_production");
    expect(RETIRED_PERMISSION_KEYS["infrastructure.backup.restore"]).toEqual([
      "platform.backup.restore_production",
      "platform.backup.restore_test",
    ]);

    // Holding the production-restore capability still requires an independent
    // production environment grant: the dimensions do not collapse.
    const grants = [
      {
        permission: "platform.backup.restore_production",
        scope: { ...storeScope, level: "platform" as const, resourceId: "het" },
      },
    ];
    const platformDev = {
      level: "platform" as const,
      resourceId: "het",
      environment: "development" as const,
    };
    expect(hasPermission(grants, "platform.backup.restore_production", platformDev)).toBe(true);
    expect(
      hasPermission(grants, "platform.backup.restore_production", {
        ...platformDev,
        environment: "production",
      }),
    ).toBe(false);
    expect(hasPermission(grants, "platform.backup.restore_test", platformDev)).toBe(false);
  });

  it("moves certificate rotation to the devices domain", () => {
    expect(isCanonicalPermissionKey("devices.certificate.rotate")).toBe(true);
    expect(isCanonicalPermissionKey("security.certificates.rotate")).toBe(false);
    expect(CANONICAL_PERMISSION_KEYS).not.toContain("security.certificates.rotate");
    expect(hasPermission([], "security.certificates.rotate", storeScope)).toBe(false);
    expect(RETIRED_PERMISSION_KEYS["security.certificates.rotate"]).toEqual([
      "devices.certificate.rotate",
    ]);
  });

  it("keeps platform.jobs.retry unchanged", () => {
    expect(isCanonicalPermissionKey("platform.jobs.retry")).toBe(true);
  });

  // Tightened grammar (KLD-2026-07-26-002 Group 3).
  //
  // CONFLICT RECORDED (KL-DEC-001-T003): the decision states the grammar as
  // `<domain>.<resource_or_capability>.<verb>` yet also makes the 107-key
  // registry the canonical baseline — and 60 of those keys have exactly two
  // segments, including the three release keys the same decision names as
  // canonical. Rejecting every two-segment key would invalidate the baseline,
  // so the grammar admits 2-or-3 segments and registry membership is the
  // authoritative gate. Escalated for owner ruling; see src/index.ts.
  it("admits only 2-or-3 segment keys", () => {
    const segmentCounts = new Set(CANONICAL_PERMISSION_KEYS.map((k) => k.split(".").length));
    expect([...segmentCounts].sort()).toEqual([2, 3]);

    expect(isValidPermissionKey("releases.promote_stable")).toBe(true); // 2 segments, canonical
    expect(isValidPermissionKey("platform.jobs.retry")).toBe(true); // 3 segments, canonical

    // One segment: a broad role name, never a permission.
    expect(isValidPermissionKey("releases")).toBe(false);
    expect(isValidPermissionKey("owner")).toBe(false);

    // Four or more segments: the old `(\.[a-z][a-z0-9_]*)+` grammar accepted
    // these and let callers smuggle extra dimensions into the key.
    expect(isValidPermissionKey("releases.promote.stable.now")).toBe(false);
    expect(isValidPermissionKey("platform.backup.restore.production")).toBe(false);
    expect(isValidPermissionKey("a.b.c.d.e")).toBe(false);
  });

  // KLD-2026-07-26-002 Group 3 — permission key, API scope, resource scope,
  // environment scope, device/profile authorization and approval policy are
  // separate dimensions. No identifier may collapse them into one string.
  it("never embeds a resource ID in a permission key", () => {
    expect(isValidPermissionKey("laundry.bookings.b1e6c2f4-8a3d-4c9e-9f21-0d7a4b5c6e8f")).toBe(
      false,
    );
    expect(isValidPermissionKey("laundry.bookings.b1e6c2f48a3d4c9e9f210d7a4b5c6e8f")).toBe(false);
    expect(isValidPermissionKey("digital_stores.ds_10394.read")).toBe(false);
    expect(isValidPermissionKey("locations.4821.read")).toBe(false);
    for (const key of CANONICAL_PERMISSION_KEYS) {
      // The one admitted digit form is a terminal-profile ORDINAL segment
      // (`t1`..`t9` — Amendment 002's `pos.t1.use`), the same grammar as the
      // canonical terminal profiles. Everything else stays digit-free.
      const segments = key.split(".").filter((segment) => !/^t[1-9]$/.test(segment));
      expect(segments.join(".")).not.toMatch(/[0-9]/);
    }
  });

  it("never embeds an environment name in a permission key", () => {
    expect(isValidPermissionKey("platform.backup.production")).toBe(false);
    expect(isValidPermissionKey("releases.production.promote")).toBe(false);
    expect(isValidPermissionKey("production.backup.restore")).toBe(false);
    expect(isValidPermissionKey("platform.staging.deploy")).toBe(false);
    expect(isValidPermissionKey("platform.jobs.pilot")).toBe(false);

    // A capability verb that names a distinct capability is not an environment
    // segment: the actor still needs a separate production environment grant.
    expect(isValidPermissionKey("platform.backup.restore_production")).toBe(true);
  });

  it("rejects wildcards outright", () => {
    for (const key of ["*", "*.*", "platform.*", "platform.jobs.*", "*.jobs.retry"]) {
      expect(isValidPermissionKey(key)).toBe(false);
      expect(isCanonicalPermissionKey(key)).toBe(false);
    }
    const wildcardGrant = [{ permission: "*", scope: storeScope }];
    expect(hasPermission(wildcardGrant, "platform.jobs.retry", storeScope)).toBe(false);
    expect(hasPermission(wildcardGrant, "*", storeScope)).toBe(false);
  });

  it("fails closed on unknown keys even when a matching grant row exists", () => {
    const forged = [{ permission: "platform.superpowers.grant", scope: storeScope }];
    expect(hasPermission(forged, "platform.superpowers.grant", storeScope)).toBe(false);
    expect(hasPermission(forged, "platform.jobs.retry", storeScope)).toBe(false);
    expect(() => assertCanonicalPermissionKey("platform.superpowers.grant")).toThrow(
      UnknownPermissionKeyError,
    );
  });

  it("reproduces the canonical registry exactly", () => {
    // 107 v1.0.0 keys + 2 from Amendment 001 (device containment,
    // WS-11-T005-P02 owner package 2026-08-06) + 5 from Amendment 002
    // (T1 staff sessions, KLD-2026-08-06-WS12-T001-EDGE-BOOTSTRAP-001 §4).
    expect(CANONICAL_PERMISSION_KEYS).toHaveLength(114);
    expect(new Set(CANONICAL_PERMISSION_KEYS).size).toBe(114);
    expect(CANONICAL_PERMISSION_KEYS).toContain("device.containment.apply");
    expect(CANONICAL_PERMISSION_KEYS).toContain("device.containment.clear");
    expect(CANONICAL_PERMISSION_KEYS).toContain("staff.sessions.open");
    expect(CANONICAL_PERMISSION_KEYS).toContain("staff.sessions.read");
    expect(CANONICAL_PERMISSION_KEYS).toContain("staff.sessions.refresh");
    expect(CANONICAL_PERMISSION_KEYS).toContain("staff.sessions.close");
    expect(CANONICAL_PERMISSION_KEYS).toContain("pos.t1.use");
    expect(KNOWN_PERMISSION_KEYS).toBe(CANONICAL_PERMISSION_KEYS);
    for (const retired of Object.keys(RETIRED_PERMISSION_KEYS)) {
      expect(isCanonicalPermissionKey(retired)).toBe(false);
      for (const replacement of RETIRED_PERMISSION_KEYS[retired] ?? []) {
        expect(isCanonicalPermissionKey(replacement)).toBe(true);
      }
    }
  });
});
