/**
 * Hash routing. Total (never throws on user-controlled input), and the Store id
 * survives a round trip. No route has a field that could carry a code.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_ROUTE, parseRoute, routeHref, storeRoute } from "../src/routing.js";

describe("parseRoute is total", () => {
  it("lands home on nothing", () => {
    expect(parseRoute("")).toEqual(DEFAULT_ROUTE);
    expect(parseRoute("#/")).toEqual(DEFAULT_ROUTE);
    expect(parseRoute("#")).toEqual(DEFAULT_ROUTE);
  });

  it("parses the two Store tabs", () => {
    expect(parseRoute("#/stores/abc/hub")).toEqual({ kind: "hub", storeId: "abc" });
    expect(parseRoute("#/stores/abc/terminals?x=1")).toEqual({ kind: "terminals", storeId: "abc" });
  });

  it("never throws, and reports anything else as unknown", () => {
    for (const hash of [
      "#//",
      "#/stores",
      "#/stores/a",
      "#/stores/a/b/c",
      "#/%",
      "#/stores/%zz/hub",
      "#/stores//hub",
    ]) {
      const route = parseRoute(hash);
      expect(["unknown", "home", "hub"]).toContain(route.kind);
    }
    expect(parseRoute("#/stores/a/b/c")).toEqual({ kind: "unknown", path: "/stores/a/b/c" });
    expect(parseRoute("#/stores/%zz/hub")).toEqual({ kind: "hub", storeId: "%zz" });
  });

  it("round-trips a Store id with awkward characters", () => {
    const route = storeRoute("terminals", "a b/c");
    expect(parseRoute(routeHref(route))).toEqual(route);
  });
});
