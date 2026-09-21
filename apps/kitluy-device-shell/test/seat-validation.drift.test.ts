import { describe, expect, it } from "vitest";
import {
  APPLICATION_IDENTIFIER_PATTERN,
  SURFACE_IDENTIFIER_PATTERN,
  TERMINAL_PROFILE_CODE_PATTERN,
} from "@kitluy/terminal-seat-contracts";

import {
  APPLICATION_IDENTIFIER_SHAPE,
  SURFACE_IDENTIFIER_SHAPE,
  TERMINAL_PROFILE_CODE_SHAPE,
} from "../electron/seat-validation.js";

/**
 * The shell duplicates the identifier shapes on purpose (see seat-validation.ts
 * COUPLING NOTE). This test is the only thing holding the two copies together:
 * if the contracts package changes a pattern, this fails before a board ships.
 */
describe("seat-validation shapes are byte-identical to @kitluy/terminal-seat-contracts", () => {
  it("terminal profile code", () => {
    expect(TERMINAL_PROFILE_CODE_SHAPE.source).toBe(TERMINAL_PROFILE_CODE_PATTERN.source);
  });
  it("application identifier", () => {
    expect(APPLICATION_IDENTIFIER_SHAPE.source).toBe(APPLICATION_IDENTIFIER_PATTERN.source);
  });
  it("surface identifier", () => {
    expect(SURFACE_IDENTIFIER_SHAPE.source).toBe(SURFACE_IDENTIFIER_PATTERN.source);
  });
});
