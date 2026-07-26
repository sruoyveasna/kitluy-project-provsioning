import { describe, expect, it } from "vitest";
import {
  activeVerticals,
  FUTURE_CLIENT_FLAGS,
  isVerticalActive,
  PHASE_GATES,
} from "../src/index.js";

describe("@kitluy/feature-flags phase gates", () => {
  it("only Phase 1 Laundry is active", () => {
    expect(activeVerticals()).toEqual(["laundry"]);
    expect(isVerticalActive("laundry")).toBe(true);
    expect(isVerticalActive("cafe_restaurant")).toBe(false);
    expect(isVerticalActive("supermarket")).toBe(false);
  });

  it("all eight phases are registered", () => {
    expect(Object.keys(PHASE_GATES)).toHaveLength(8);
  });

  it("future clients are registered but default OFF", () => {
    expect(FUTURE_CLIENT_FLAGS).toHaveLength(3);
    for (const flag of FUTURE_CLIENT_FLAGS) {
      expect(flag.defaultValue).toBe(false);
    }
  });
});
