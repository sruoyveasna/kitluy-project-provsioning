/**
 * Desired vs Actual — TERMINAL-APPLICATION-ASSIGNMENT-001 requirement 13.
 *
 * DESIRED is what the server derived for the seat (`TerminalSeatDesiredState`).
 * ACTUAL is only ever what the terminal REPORTED, through the Hub, in a
 * `TerminalRuntimeReport`. This module compares the two for the Partner Portal.
 *
 * THE RULE THAT MUST NOT BE WEAKENED: installation success is never inferred.
 *   - No report at all              -> every desired application is `unreported`.
 *   - A report that omits an app    -> that app is `missing`, not "probably fine".
 *   - A report of `failed`          -> `failed`, carrying the terminal's reason.
 *   - A report of `installed` but not `running` -> `installed_not_running`.
 * Only a report that names the application as `running` yields `in_sync`.
 *
 * A stale report (older assignment generation or configuration version than
 * the desired state) is compared but FLAGGED: the terminal is describing a
 * world the Partner has since changed, so its "running" cannot confirm the
 * newer desired state.
 *
 * Runtime reports are DATA from a device. Nothing here treats a report field as
 * an instruction, and an unknown application or surface in a report is
 * surfaced as `unexpected` rather than dropped — a Pi running something the
 * server never derived is exactly the condition the Partner must see.
 */
import type { KitluyErrorLike, Result } from "@kitluy/shared-types";
import { err, ok } from "@kitluy/shared-types";

import type { ApplicationIdentifier } from "./application-identifier.js";
import { parseApplicationIdentifier } from "./application-identifier.js";
import type { SurfaceIdentifier } from "./allowed-surfaces.js";
import { parseSurfaceIdentifier } from "./allowed-surfaces.js";
import type { TerminalSeatDesiredState } from "./terminal-seat.js";

export const APPLICATION_RUNTIME_STATES = ["not_installed", "installing", "installed", "running", "failed"] as const;
export type ApplicationRuntimeState = (typeof APPLICATION_RUNTIME_STATES)[number];

export interface ReportedApplication {
  readonly applicationId: string;
  readonly state: ApplicationRuntimeState;
  /** Installed/running version as the terminal sees it. Null when unknown. */
  readonly version: string | null;
  /** Terminal-supplied reason for `failed`. Data, not instruction. */
  readonly reason?: string;
}

/**
 * What a terminal reports about itself, delivered via the Hub.
 *
 * Nullable fields mean "this report did not say" — the device-signed
 * `DeviceRuntimeReport` (T1-STORE-OPERATIONS-001, group 0229) carries a
 * release product and a POS state but no application identifier, vertical or
 * surfaces. `adaptDeviceRuntimeReport` maps what it does say and leaves the
 * rest null; a null is compared as UNREPORTED, never as agreement.
 */
export interface TerminalRuntimeReport {
  readonly seatId: string;
  readonly terminalDeviceId: string;
  /** Null when the report does not carry a generation. */
  readonly assignmentGeneration: number | null;
  /** Null when the report does not carry a configuration version. */
  readonly configurationVersion: number | null;
  /** Null when the report does not state a vertical. */
  readonly primaryVertical: string | null;
  readonly applications: readonly ReportedApplication[];
  /** Null when the report does not enumerate surfaces at all. */
  readonly exposedSurfaces: readonly string[] | null;
  readonly observedAt: string;
}

/** The desired side of the comparison also names which generation it is. */
export interface DesiredStateReference {
  readonly desired: TerminalSeatDesiredState;
  readonly assignmentGeneration: number;
  readonly configurationVersion: number;
}

export const APPLICATION_COMPARISON_STATUSES = [
  "unreported",
  "missing",
  "installing",
  "installed_not_running",
  "failed",
  "in_sync",
  "unexpected",
] as const;
export type ApplicationComparisonStatus = (typeof APPLICATION_COMPARISON_STATUSES)[number];

export interface ApplicationComparison {
  readonly applicationId: string;
  readonly status: ApplicationComparisonStatus;
  readonly reportedVersion: string | null;
  readonly reason?: string;
}

export interface SurfaceComparison {
  readonly surfaceId: string;
  readonly status: "unreported" | "allowed_and_exposed" | "allowed_not_exposed" | "exposed_not_allowed";
}

export interface DesiredVsActual {
  readonly seatId: string;
  /** False when no report exists. Every application is then `unreported`. */
  readonly hasReport: boolean;
  /**
   * True when the report describes an older assignment generation or
   * configuration version than the desired state. The comparison is still
   * shown, but cannot confirm the current desired state.
   */
  readonly reportIsStale: boolean;
  readonly reportedAt: string | null;
  readonly applications: readonly ApplicationComparison[];
  readonly surfaces: readonly SurfaceComparison[];
}

export const RUNTIME_REPORT_REFUSALS = {
  WRONG_SEAT: "terminal_seat.report.wrong_seat",
  MALFORMED_APPLICATION: "terminal_seat.report.application_malformed",
  MALFORMED_SURFACE: "terminal_seat.report.surface_malformed",
  UNKNOWN_STATE: "terminal_seat.report.state_unknown",
  VERTICAL_MISMATCH: "terminal_seat.report.vertical_mismatch",
} as const;

export type RuntimeReportRefusalCode = (typeof RUNTIME_REPORT_REFUSALS)[keyof typeof RUNTIME_REPORT_REFUSALS];

const refuse = (code: RuntimeReportRefusalCode, message: string): KitluyErrorLike => ({ code, message });

const RUNTIME_STATE_SET: ReadonlySet<string> = new Set(APPLICATION_RUNTIME_STATES);

/**
 * Structural validation of an untrusted report BEFORE comparison. A report
 * for another seat, or naming a different vertical than the seat's, refuses
 * outright — comparing it would attribute one terminal's state to another.
 */
export function validateRuntimeReport(
  report: TerminalRuntimeReport,
  desired: TerminalSeatDesiredState,
): Result<TerminalRuntimeReport> {
  if (report.seatId !== desired.seatId) {
    return err(
      refuse(RUNTIME_REPORT_REFUSALS.WRONG_SEAT, `Report is for seat '${report.seatId}', not '${desired.seatId}'.`),
    );
  }
  if (report.primaryVertical !== null && report.primaryVertical !== desired.primaryVertical) {
    return err(
      refuse(
        RUNTIME_REPORT_REFUSALS.VERTICAL_MISMATCH,
        `Report claims vertical '${report.primaryVertical}' but the seat is '${desired.primaryVertical}'.`,
      ),
    );
  }
  for (const a of report.applications) {
    const parsed = parseApplicationIdentifier(a.applicationId);
    if (!parsed.ok) {
      return err(
        refuse(RUNTIME_REPORT_REFUSALS.MALFORMED_APPLICATION, `Reported application '${a.applicationId}' is malformed.`),
      );
    }
    if (!RUNTIME_STATE_SET.has(a.state)) {
      return err(refuse(RUNTIME_REPORT_REFUSALS.UNKNOWN_STATE, `Reported state '${String(a.state)}' is not known.`));
    }
  }
  for (const s of report.exposedSurfaces ?? []) {
    const parsed = parseSurfaceIdentifier(s);
    if (!parsed.ok) {
      return err(refuse(RUNTIME_REPORT_REFUSALS.MALFORMED_SURFACE, `Reported surface '${s}' is malformed.`));
    }
  }
  return ok(report);
}

const toComparisonStatus = (state: ApplicationRuntimeState): ApplicationComparisonStatus => {
  switch (state) {
    case "running":
      return "in_sync";
    case "installed":
      return "installed_not_running";
    case "installing":
      return "installing";
    case "failed":
      return "failed";
    case "not_installed":
      return "missing";
  }
};

/**
 * Compare. `report` may be null — that is the common state right after a seat
 * is defined and before any Pi has paired, and it must read as "unreported",
 * never as "installed".
 */
export function compareDesiredVsActual(
  reference: DesiredStateReference,
  report: TerminalRuntimeReport | null,
): Result<DesiredVsActual> {
  const { desired } = reference;

  if (report === null) {
    return ok({
      seatId: desired.seatId,
      hasReport: false,
      reportIsStale: false,
      reportedAt: null,
      applications: desired.desiredApplications.map((id) => ({
        applicationId: id,
        status: "unreported",
        reportedVersion: null,
      })),
      surfaces: desired.allowedSurfaces.map((id) => ({ surfaceId: id, status: "unreported" })),
    });
  }

  const valid = validateRuntimeReport(report, desired);
  if (!valid.ok) return valid;

  // A null generation/version cannot prove freshness, so it counts as stale:
  // the report may be describing an older world, and we say so.
  const reportIsStale =
    report.assignmentGeneration === null ||
    report.assignmentGeneration < reference.assignmentGeneration ||
    report.configurationVersion === null ||
    report.configurationVersion < reference.configurationVersion;

  const reported = new Map<string, ReportedApplication>(report.applications.map((a) => [a.applicationId, a]));
  const desiredSet = new Set<string>(desired.desiredApplications);

  const applications: ApplicationComparison[] = desired.desiredApplications.map((id: ApplicationIdentifier) => {
    const r = reported.get(id);
    if (r === undefined) return { applicationId: id, status: "missing", reportedVersion: null };
    const c: ApplicationComparison = { applicationId: id, status: toComparisonStatus(r.state), reportedVersion: r.version };
    return r.reason === undefined ? c : { ...c, reason: r.reason };
  });
  for (const r of report.applications) {
    if (!desiredSet.has(r.applicationId)) {
      applications.push({ applicationId: r.applicationId, status: "unexpected", reportedVersion: r.version });
    }
  }

  let surfaces: SurfaceComparison[];
  if (report.exposedSurfaces === null) {
    // The report did not enumerate surfaces. Every allowed surface is
    // UNREPORTED — not "not exposed", which would be a claim about the device.
    surfaces = desired.allowedSurfaces.map((id: SurfaceIdentifier) => ({ surfaceId: id, status: "unreported" }));
  } else {
    const exposed = new Set<string>(report.exposedSurfaces);
    const allowed = new Set<string>(desired.allowedSurfaces);
    surfaces = desired.allowedSurfaces.map((id: SurfaceIdentifier) => ({
      surfaceId: id,
      status: exposed.has(id) ? "allowed_and_exposed" : "allowed_not_exposed",
    }));
    for (const s of report.exposedSurfaces) {
      if (!allowed.has(s)) surfaces.push({ surfaceId: s, status: "exposed_not_allowed" });
    }
  }

  return ok({
    seatId: desired.seatId,
    hasReport: true,
    reportIsStale,
    reportedAt: report.observedAt,
    applications,
    surfaces,
  });
}

// ---------------------------------------------------------------------------
// Adapter from the device-signed DeviceRuntimeReport (T1-STORE-OPERATIONS-001)
// ---------------------------------------------------------------------------

/**
 * The slice of `DeviceRuntimeReportV2.application` this adapter reads.
 * Structural on purpose: mirrors `@kitluy/device-identity`'s
 * `RuntimeApplication` without importing it, so Neutral Core does not gain a
 * runtime dependency for a type. A drift test in the composing service must
 * pin the two shapes together.
 */
export interface RuntimeApplicationEvidence {
  readonly product: string;
  readonly installedVersion: string | null;
  readonly journalPhase: "IDLE" | "ACTIVATING" | "HEALTH_PENDING" | "COMMITTED" | "ROLLED_BACK" | "FAILED";
  readonly lastOutcome: "INSTALLED" | "ROLLED_BACK" | "REFUSED" | "INTERRUPTED" | null;
  readonly lastReason: string | null;
  readonly runningReleaseId: string | null;
  readonly unitActive: boolean;
}

export interface DeviceRuntimeReportEvidence {
  readonly application: RuntimeApplicationEvidence | null;
  readonly pos: { readonly configurationVersion: number | null; readonly observedAt: string } | null;
}

/**
 * The declared link between a release PRODUCT and an APPLICATION identifier.
 * A vertical package declares it (the product `kitluy-terminal` carries the
 * Phase 1 application); Neutral Core never assumes product == application.
 */
export interface ProductApplicationBinding {
  readonly product: string;
  readonly applicationId: ApplicationIdentifier;
}

const stateFromEvidence = (a: RuntimeApplicationEvidence): ReportedApplication["state"] => {
  if (a.runningReleaseId !== null && a.unitActive) return "running";
  if (a.journalPhase === "ACTIVATING" || a.journalPhase === "HEALTH_PENDING") return "installing";
  if (a.journalPhase === "FAILED" || a.journalPhase === "ROLLED_BACK") return "failed";
  if (a.lastOutcome === "REFUSED" || a.lastOutcome === "INTERRUPTED" || a.lastOutcome === "ROLLED_BACK") return "failed";
  if (a.journalPhase === "COMMITTED" && a.lastOutcome === "INSTALLED") return "installed";
  return "not_installed";
};

/**
 * Map a device runtime report onto the seat vocabulary.
 *
 * Only what the report actually says is mapped. The report names a release
 * product, so the application it evidences is the one BOUND to that product
 * by the vertical's declaration; a report for a product with no binding
 * yields no application evidence (-> `missing`), never a guessed one.
 * Vertical, generation and surfaces are not in this report and stay null.
 */
export function adaptDeviceRuntimeReport(
  report: DeviceRuntimeReportEvidence,
  seat: { readonly seatId: string; readonly terminalDeviceId: string },
  bindings: readonly ProductApplicationBinding[],
  observedAt: string,
): TerminalRuntimeReport {
  const applications: ReportedApplication[] = [];
  const a = report.application;
  if (a !== null) {
    const binding = bindings.find((b) => b.product === a.product);
    if (binding !== undefined) {
      const state = stateFromEvidence(a);
      const entry: ReportedApplication = { applicationId: binding.applicationId, state, version: a.installedVersion };
      applications.push(state === "failed" && a.lastReason !== null ? { ...entry, reason: a.lastReason } : entry);
    }
  }
  return {
    seatId: seat.seatId,
    terminalDeviceId: seat.terminalDeviceId,
    assignmentGeneration: null,
    configurationVersion: report.pos?.configurationVersion ?? null,
    primaryVertical: null,
    applications,
    exposedSurfaces: null,
    observedAt: report.pos?.observedAt ?? observedAt,
  };
}
