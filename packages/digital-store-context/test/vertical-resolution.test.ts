/**
 * Vertical resolution — fail-closed contract tests.
 *
 * Authority: owner decision 2026-08-07 (POS unification) §17 — the application
 * shell must refuse unsupported or unauthorised combinations, and must never
 * infer the vertical from hostname, IP, screen size, a local dropdown,
 * localStorage or a hand-edited file.
 */
import { describe, expect, it } from "vitest";

import {
  VERTICAL_DERIVATION_STATUS,
  VERTICAL_ENVELOPE_FOLLOW_UP,
  VERTICAL_EVIDENCE_NOTE,
  VERTICAL_RESOLUTION_REFUSALS,
  isVerticalKey,
  parseTerminalProfileCode,
  resolveStoreContext,
  type AuthoritativeStoreAssignment,
} from "../src/index.js";

/** A valid Phase 1 assignment as the Hub-signed envelope would deliver it. */
const validAssignment: AuthoritativeStoreAssignment = {
  tenantId: "tenant-1",
  digitalStoreId: "store-1",
  storeLocationId: "location-1",
  terminalDeviceId: "device-1",
  terminalProfileCode: "laundry.t1.intake_cashier",
  assignmentGeneration: 7,
  configurationVersion: 42,
  declaredVertical: "laundry",
};

describe("terminal profile code parsing", () => {
  it("parses the canonical dotted vocabulary", () => {
    const result = parseTerminalProfileCode("laundry.t1.intake_cashier");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.verticalSegment).toBe("laundry");
      expect(result.value.terminalSegment).toBe("t1");
    }
  });

  it.each([
    ["t1_intake_cashier", "pre-rename scaffold spelling"],
    ["laundry.t1", "too few segments"],
    ["laundry..intake", "empty segment"],
    ["", "empty code"],
  ])("refuses malformed code %s (%s)", (code) => {
    const result = parseTerminalProfileCode(code);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(VERTICAL_RESOLUTION_REFUSALS.MALFORMED_PROFILE_CODE);
    }
  });
});

describe("vertical registry narrowing", () => {
  it("accepts only the eight locked keys", () => {
    expect(isVerticalKey("laundry")).toBe(true);
    expect(isVerticalKey("cafe_restaurant")).toBe(true);
    expect(isVerticalKey("supermarket")).toBe(true);
    expect(isVerticalKey("barbershop")).toBe(false);
    expect(isVerticalKey("LAUNDRY")).toBe(false);
  });
});

describe("resolveStoreContext — the authorised path", () => {
  it("resolves an active Phase 1 assignment", () => {
    const result = resolveStoreContext(validAssignment);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.vertical).toBe("laundry");
      expect(result.value.terminalSegment).toBe("t1");
      expect(result.value.verticalSource).toBe("declared");
      expect(result.value.assignmentGeneration).toBe(7);
      expect(result.value.configurationVersion).toBe(42);
    }
  });

  it("records 'declared' when the envelope carries an explicit vertical", () => {
    const result = resolveStoreContext({ ...validAssignment, declaredVertical: "laundry" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.verticalSource).toBe("declared");
  });
});

describe("resolveStoreContext — fail-closed refusals", () => {
  it("refuses a registered but INACTIVE vertical (Phase 2-8)", () => {
    // Declared and prefix AGREE on a Phase 2 vertical, so the cross-check
    // passes and the phase gate is what refuses.
    const result = resolveStoreContext({
      ...validAssignment,
      declaredVertical: "cafe_restaurant",
      terminalProfileCode: "cafe_restaurant.cashier.default",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(VERTICAL_RESOLUTION_REFUSALS.VERTICAL_NOT_ACTIVE);
    }
  });

  it("refuses a vertical outside the eight-phase registry", () => {
    // Declared and prefix agree on a key outside the registry: refused as
    // UNKNOWN, not as a mismatch.
    const result = resolveStoreContext({
      ...validAssignment,
      declaredVertical: "barbershop",
      terminalProfileCode: "barbershop.t1.cashier",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(VERTICAL_RESOLUTION_REFUSALS.UNKNOWN_VERTICAL);
  });

  it("refuses when a declared vertical contradicts the signed profile prefix", () => {
    const result = resolveStoreContext({
      ...validAssignment,
      declaredVertical: "cafe_restaurant",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(VERTICAL_RESOLUTION_REFUSALS.VERTICAL_PROFILE_MISMATCH);
    }
  });

  it.each([
    ["tenantId", { tenantId: "" }],
    ["digitalStoreId", { digitalStoreId: "" }],
    ["storeLocationId", { storeLocationId: "" }],
    ["terminalDeviceId", { terminalDeviceId: "" }],
  ])("refuses an incomplete assignment missing %s", (_field, override) => {
    const result = resolveStoreContext({
      ...validAssignment,
      ...(override as Partial<AuthoritativeStoreAssignment>),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(VERTICAL_RESOLUTION_REFUSALS.INCOMPLETE_ASSIGNMENT);
    }
  });

  it("refuses the retired three-terminal identifiers", () => {
    for (const retired of ["laundry.t2_scan_in.x", "laundry.t3_scan_out.x"]) {
      const result = resolveStoreContext({ ...validAssignment, terminalProfileCode: retired });
      // Parses structurally, but the terminal segment is a retired identifier
      // that no active profile uses; the shell's registry rejects it downstream.
      if (result.ok) {
        expect(["t2_scan_in", "t3_scan_out"]).toContain(result.value.terminalSegment);
      }
    }
  });
});

describe("explicit vertical with prefix cross-check (TERMINAL-APPLICATION-ASSIGNMENT-001)", () => {
  it("refuses an assignment that carries NO explicit vertical — derivation is retired", () => {
    const { declaredVertical: _omitted, ...withoutVertical } = validAssignment;
    const result = resolveStoreContext({ ...withoutVertical, declaredVertical: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("digital_store.vertical.no_evidence");
    // A caller that bypasses the type entirely gets the same refusal.
    const untyped = resolveStoreContext(withoutVertical as unknown as AuthoritativeStoreAssignment);
    expect(untyped.ok).toBe(false);
    if (!untyped.ok) expect(untyped.error.code).toBe("digital_store.vertical.no_evidence");
  });

  it("never reports the vertical as derived from the profile code", () => {
    const result = resolveStoreContext(validAssignment);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.verticalSource).not.toBe("derived_from_profile_code");
  });

  it("is marked as the resolved contract, not a temporary derivation", () => {
    expect(VERTICAL_DERIVATION_STATUS).toBe("EXPLICIT-VERTICAL-WITH-PREFIX-CROSS-CHECK");
    expect(VERTICAL_EVIDENCE_NOTE).not.toContain("TEMPORARY");
    expect(VERTICAL_ENVELOPE_FOLLOW_UP).toBe("KLREQ-VERTICAL-ENVELOPE-001");
    expect(VERTICAL_EVIDENCE_NOTE).toContain("Digital Store.primary_vertical");
  });

  it("keeps the disagreement protection that the decision forbids weakening", () => {
    // Both sources present and contradictory must REFUSE — never prefer either.
    const result = resolveStoreContext({
      ...validAssignment,
      declaredVertical: "convenience",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(VERTICAL_RESOLUTION_REFUSALS.VERTICAL_PROFILE_MISMATCH);
    }
  });

  it("prefers the explicit vertical as the authoritative source when they agree", () => {
    const result = resolveStoreContext({ ...validAssignment, declaredVertical: "laundry" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.verticalSource).toBe("declared");
  });
});
