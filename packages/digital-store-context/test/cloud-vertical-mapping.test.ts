/**
 * The ONE canonical cloud-vertical mapping
 * (PRIMARY-VERTICAL-CLOUD-TO-HUB-FEEDER-001 requirement 2).
 *
 * The table lives in `@kitluy/shared-types`, beside the `VERTICAL_PHASES`
 * registry it must track; it is exercised here because shared-types is a
 * types-only package with no test runner of its own ("exercised by consuming
 * package tests"), and because this package is the Digital Store's
 * control-plane context — whose primary vertical is exactly what is mapped.
 *
 * Two governed vocabularies, one conversion:
 *   cloud  `kitluy_core.digital_stores.primary_vertical_code`  -> `LAUNDRY`
 *   edge   `VerticalKey` / hub migration 0044                  -> `laundry`
 */
import {
  VERTICAL_CLOUD_CODES,
  VERTICAL_CLOUD_CODE_COVERS_REGISTRY,
  VERTICAL_PHASES,
  cloudCodeForVerticalKey,
  isVerticalKey,
  verticalKeyFromCloudCode,
} from "@kitluy/shared-types";
import { describe, expect, it } from "vitest";

import { isVerticalKey as contextIsVerticalKey } from "../src/index.js";

describe("the cloud vertical vocabulary maps onto the locked registry", () => {
  it("names every locked vertical exactly once, and nothing else", () => {
    // The guard that makes a ninth vertical a DECISION rather than an
    // accident: adding a phase to VERTICAL_PHASES without giving it a cloud
    // code fails here, not in production on a Store Hub.
    expect(VERTICAL_CLOUD_CODE_COVERS_REGISTRY).toBe(true);
    expect(Object.keys(VERTICAL_CLOUD_CODES).sort()).toEqual(
      VERTICAL_PHASES.map((p) => p.key).sort(),
    );
  });

  it("maps Phase 1 Laundry: LAUNDRY -> laundry", () => {
    expect(verticalKeyFromCloudCode("LAUNDRY")).toBe("laundry");
    expect(cloudCodeForVerticalKey("laundry")).toBe("LAUNDRY");
  });

  it("round-trips every registry key through its cloud code", () => {
    for (const phase of VERTICAL_PHASES) {
      const cloud = cloudCodeForVerticalKey(phase.key);
      expect(verticalKeyFromCloudCode(cloud)).toBe(phase.key);
      expect(isVerticalKey(phase.key)).toBe(true);
    }
  });

  it("is an explicit table, not a case transform", () => {
    // Each of these would pass through a `.toLowerCase()` boundary. A future
    // cloud code whose registry key is not simply its lower case would be
    // silently invented; an unregistered one would be minted outright.
    for (const rejected of [
      "laundry",
      "Laundry",
      "LaUnDrY",
      " LAUNDRY",
      "LAUNDRY ",
      "LAUNDRY_V2",
      "BAKERY",
      "",
    ]) {
      expect(verticalKeyFromCloudCode(rejected)).toBeNull();
    }
  });

  it("fails closed — callers get null, never a default", () => {
    // Laundry is the only ACTIVE phase, which is precisely why an unknown
    // value must not resolve to it.
    expect(verticalKeyFromCloudCode("UNKNOWN_VERTICAL")).toBeNull();
    expect(verticalKeyFromCloudCode("CAFE_RESTAURANT")).toBe("cafe_restaurant");
    expect(verticalKeyFromCloudCode("CAFE_RESTAURANT")).not.toBe("laundry");
  });

  it("agrees with this package's own registry narrowing — one registry, not two", () => {
    for (const phase of VERTICAL_PHASES) {
      expect(contextIsVerticalKey(phase.key)).toBe(isVerticalKey(phase.key));
    }
    expect(contextIsVerticalKey("bakery")).toBe(false);
    expect(isVerticalKey("bakery")).toBe(false);
  });
});
