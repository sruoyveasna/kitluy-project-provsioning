import { describe, expect, it } from "vitest";
import type { ResourceScope } from "@kitluy/resource-scope";
import { hasPermission, isValidPermissionKey, KNOWN_PERMISSION_KEYS } from "../src/index.js";

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
    expect(hasPermission(grants, "releases.promote.stable", storeScope)).toBe(false);
  });

  it("never wildcard-matches", () => {
    const grants = [{ permission: "platform.jobs.retry", scope: storeScope }];
    expect(hasPermission(grants, "platform.jobs", storeScope)).toBe(false);
    expect(hasPermission(grants, "platform", storeScope)).toBe(false);
  });
});
