import { describe, expect, it } from "vitest";

import {
  RUNTIME_REPORT_REFUSALS,
  adaptDeviceRuntimeReport,
  compareDesiredVsActual,
  type ApplicationIdentifier,
  type DesiredStateReference,
  type SurfaceIdentifier,
  type TerminalRuntimeReport,
  type TerminalSeatDesiredState,
} from "../src/index.js";

const desired: TerminalSeatDesiredState = {
  seatId: "seat-1",
  tenantId: "t",
  digitalStoreId: "s",
  storeLocationId: "l",
  label: "Front Counter 01",
  primaryVertical: "laundry",
  terminalProfileCodes: ["laundry.t1.intake_cashier"],
  desiredApplications: ["laundry.pos" as ApplicationIdentifier],
  allowedSurfaces: ["test.alpha" as SurfaceIdentifier],
  derivation: [],
};
const reference: DesiredStateReference = { desired, assignmentGeneration: 3, configurationVersion: 7 };

const report = (over: Partial<TerminalRuntimeReport> = {}): TerminalRuntimeReport => ({
  seatId: "seat-1",
  terminalDeviceId: "dev-1",
  assignmentGeneration: 3,
  configurationVersion: 7,
  primaryVertical: "laundry",
  applications: [{ applicationId: "laundry.pos", state: "running", version: "1.2.3" }],
  exposedSurfaces: ["test.alpha"],
  observedAt: "2026-09-18T10:00:00.000Z",
  ...over,
});

describe("compareDesiredVsActual", () => {
  it("with NO report, every desired application is 'unreported' — never installed (requirement 13)", () => {
    const r = compareDesiredVsActual(reference, null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.hasReport).toBe(false);
    expect(r.value.applications).toEqual([{ applicationId: "laundry.pos", status: "unreported", reportedVersion: null }]);
    expect(r.value.surfaces).toEqual([{ surfaceId: "test.alpha", status: "unreported" }]);
  });

  it("only a 'running' report yields in_sync", () => {
    const r = compareDesiredVsActual(reference, report());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.applications[0]).toEqual({ applicationId: "laundry.pos", status: "in_sync", reportedVersion: "1.2.3" });
  });

  it.each([
    ["installed", "installed_not_running"],
    ["installing", "installing"],
    ["not_installed", "missing"],
    ["failed", "failed"],
  ] as const)("maps reported state %s to %s", (state, status) => {
    const r = compareDesiredVsActual(reference, report({ applications: [{ applicationId: "laundry.pos", state, version: null, reason: "x" }] }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.applications[0]?.status).toBe(status);
  });

  it("an application omitted from the report is 'missing', not assumed fine", () => {
    const r = compareDesiredVsActual(reference, report({ applications: [] }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.applications[0]?.status).toBe("missing");
  });

  it("an application the server never derived is surfaced as 'unexpected', not dropped", () => {
    const r = compareDesiredVsActual(
      reference,
      report({ applications: [{ applicationId: "laundry.pos", state: "running", version: "1" }, { applicationId: "laundry.extra", state: "running", version: "9" }] }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.applications.find((a) => a.applicationId === "laundry.extra")?.status).toBe("unexpected");
  });

  it("flags a report from an older generation as stale but still compares it", () => {
    const r = compareDesiredVsActual(reference, report({ assignmentGeneration: 2 }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.reportIsStale).toBe(true);
      expect(r.value.applications[0]?.status).toBe("in_sync");
    }
  });

  it("surfaces: allowed-but-not-exposed and exposed-but-not-allowed are both visible", () => {
    const r = compareDesiredVsActual(reference, report({ exposedSurfaces: ["test.other"] }));
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(r.value.surfaces).toEqual([
        { surfaceId: "test.alpha", status: "allowed_not_exposed" },
        { surfaceId: "test.other", status: "exposed_not_allowed" },
      ]);
  });

  it("REFUSES a report for another seat", () => {
    const r = compareDesiredVsActual(reference, report({ seatId: "seat-2" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(RUNTIME_REPORT_REFUSALS.WRONG_SEAT);
  });

  it("REFUSES a report claiming a different vertical than the seat", () => {
    const r = compareDesiredVsActual(reference, report({ primaryVertical: "cafe_restaurant" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(RUNTIME_REPORT_REFUSALS.VERTICAL_MISMATCH);
  });

  it("REFUSES a malformed application id or unknown state in a report", () => {
    const a = compareDesiredVsActual(reference, report({ applications: [{ applicationId: "pos", state: "running", version: null }] }));
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.error.code).toBe(RUNTIME_REPORT_REFUSALS.MALFORMED_APPLICATION);
    const b = compareDesiredVsActual(reference, report({ applications: [{ applicationId: "laundry.pos", state: "exploded" as never, version: null }] }));
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.error.code).toBe(RUNTIME_REPORT_REFUSALS.UNKNOWN_STATE);
  });
});

describe("adaptDeviceRuntimeReport — reading the device-signed report as seat evidence", () => {
  const bindings = [{ product: "kitluy-terminal", applicationId: "laundry.pos" as ApplicationIdentifier }];
  const seat = { seatId: "seat-1", terminalDeviceId: "dev-1" };
  const evidence = (over: Partial<import("../src/index.js").RuntimeApplicationEvidence> = {}) => ({
    application: {
      product: "kitluy-terminal",
      installedVersion: "1.0.0",
      journalPhase: "COMMITTED" as const,
      lastOutcome: "INSTALLED" as const,
      lastReason: null,
      runningReleaseId: "rel-1",
      unitActive: true,
      ...over,
    },
    pos: { configurationVersion: 7, observedAt: "2026-09-18T11:00:00.000Z" },
  });

  it("maps a running, active unit to 'running' for the BOUND application", () => {
    const r = adaptDeviceRuntimeReport(evidence(), seat, bindings, "x");
    expect(r.applications).toEqual([{ applicationId: "laundry.pos", state: "running", version: "1.0.0" }]);
    expect(r.configurationVersion).toBe(7);
    expect(r.observedAt).toBe("2026-09-18T11:00:00.000Z");
  });

  it("leaves vertical, generation and surfaces NULL — the report does not say them", () => {
    const r = adaptDeviceRuntimeReport(evidence(), seat, bindings, "x");
    expect(r.primaryVertical).toBeNull();
    expect(r.assignmentGeneration).toBeNull();
    expect(r.exposedSurfaces).toBeNull();
  });

  it.each([
    [{ journalPhase: "ACTIVATING" as const, runningReleaseId: null, unitActive: false }, "installing"],
    [{ journalPhase: "FAILED" as const, runningReleaseId: null, unitActive: false, lastReason: "boom" }, "failed"],
    [{ lastOutcome: "REFUSED" as const, runningReleaseId: null, unitActive: false }, "failed"],
    [{ runningReleaseId: null, unitActive: false }, "installed"],
    [{ journalPhase: "IDLE" as const, lastOutcome: null, runningReleaseId: null, unitActive: false, installedVersion: null }, "not_installed"],
  ])("maps evidence %j to %s", (over, state) => {
    const r = adaptDeviceRuntimeReport(evidence(over), seat, bindings, "x");
    expect(r.applications[0]?.state).toBe(state);
  });

  it("carries the terminal's failure reason, as data", () => {
    const r = adaptDeviceRuntimeReport(evidence({ journalPhase: "FAILED", runningReleaseId: null, unitActive: false, lastReason: "health check failed" }), seat, bindings, "x");
    expect(r.applications[0]?.reason).toBe("health check failed");
  });

  it("yields NO application evidence for a product with no declared binding — never a guess", () => {
    const r = adaptDeviceRuntimeReport(evidence({ product: "kitluy-something-else" }), seat, bindings, "x");
    expect(r.applications).toEqual([]);
  });

  it("with application: null the seat's app compares as 'missing', and unreported surfaces stay 'unreported'", () => {
    const adapted = adaptDeviceRuntimeReport({ application: null, pos: null }, seat, bindings, "2026-09-18T12:00:00.000Z");
    const c = compareDesiredVsActual(reference, adapted);
    expect(c.ok).toBe(true);
    if (c.ok) {
      expect(c.value.applications[0]?.status).toBe("missing");
      expect(c.value.surfaces).toEqual([{ surfaceId: "test.alpha", status: "unreported" }]);
      // Unknown generation/version cannot prove freshness.
      expect(c.value.reportIsStale).toBe(true);
    }
  });
});
