/**
 * The terminal's copy of the discovery contract must equal the authoritative one.
 *
 * Same reason as `hub-claim-drift.test.ts`: this agent ships inside the golden
 * image with zero runtime dependencies, so it carries its own constants, and a
 * duplicated contract is exactly the thing that drifts silently. A terminal
 * looking for `_kitluy-edge._tcp.local` on a Hub that advertises something else,
 * or refusing port 7443 because its copy says 8443, would fail only in a shop.
 *
 * Test-only import: nothing here reaches the image.
 */
import {
  EDGE_DISCOVERY_CLOCK_SKEW_SECONDS as authoritativeSkew,
  EDGE_DISCOVERY_KIND as authoritativeKind,
  EDGE_DISCOVERY_SERVICE_TYPE as authoritativeServiceType,
  EDGE_DISCOVERY_VALIDITY_SECONDS as authoritativeValidity,
  EDGE_LAN_PORT as authoritativePort,
} from "@kitluy/device-identity";
import { describe, expect, it } from "vitest";

import {
  EDGE_DISCOVERY_CLOCK_SKEW_SECONDS,
  EDGE_DISCOVERY_KIND,
  EDGE_DISCOVERY_SERVICE_TYPE,
  EDGE_DISCOVERY_VALIDITY_SECONDS,
  EDGE_LAN_PORT,
} from "../src/edge-discovery-record.js";

describe("the terminal's discovery contract does not drift from the package", () => {
  it("uses the same domain separator", () => {
    expect(EDGE_DISCOVERY_KIND).toBe(authoritativeKind);
  });

  it("tolerates the same clock skew on issuedAt", () => {
    expect(EDGE_DISCOVERY_CLOCK_SKEW_SECONDS).toBe(authoritativeSkew);
  });

  it("looks for the same mDNS service type", () => {
    expect(EDGE_DISCOVERY_SERVICE_TYPE).toBe(authoritativeServiceType);
  });

  it("expects the same LAN port", () => {
    expect(EDGE_LAN_PORT).toBe(authoritativePort);
  });

  it("expects the same record validity window", () => {
    expect(EDGE_DISCOVERY_VALIDITY_SECONDS).toBe(authoritativeValidity);
  });
});
