/**
 * `/usr/lib/kitluy/health-reporter` — the minimum fleet liveness runtime (§15).
 *
 * Before the device holds a server-issued `deviceRecordId` there is nobody to
 * report to, so it reports LOCALLY: it refreshes the bootstrap state file and
 * writes a journal line. It does not open a socket, and it does not create a
 * second telemetry architecture — when enrollment exists, this becomes the
 * caller of the canonical fleet health contract
 * (`device_fleet.health_projection_reported`), not a new one.
 *
 * The interval is deliberately conservative. The owner-ruled liveness
 * thresholds (OD-EDGE-LIVENESS-001) are ONLINE <= 90s, so a 60s beat keeps a
 * healthy device green with one missed beat of headroom, without turning
 * PostgreSQL into a telemetry firehose.
 */
import { SERVICE_VERSION } from "../version.js";
import { readBootstrapState, writeBootstrapState } from "../bootstrap-state.js";

/** One beat under the 90s ONLINE threshold, with headroom for one loss. */
export const BEAT_SECONDS = 60;

export interface HealthSummary {
  readonly deviceLabel?: string;
  readonly deviceRecordId?: string;
  readonly deviceClass: "terminal";
  readonly imageVersion?: string;
  readonly agentVersion: string;
  readonly assignmentState: "unassigned";
  readonly health: "bootstrapping" | "healthy" | "degraded";
  readonly observedAt: string;
}

export function buildHealthSummary(now: Date = new Date()): HealthSummary {
  const state = readBootstrapState();
  // Device class is NOT re-derived per beat beyond this constant: it is
  // server-held truth established at enrollment, and letting a device restate
  // its own class every minute is how a device redefines itself.
  const health: HealthSummary["health"] =
    state === null
      ? "degraded"
      : state.phase === "HALTED"
        ? "degraded"
        : state.identityReady && state.networkReady
          ? "healthy"
          : "bootstrapping";

  return {
    deviceClass: "terminal",
    agentVersion: SERVICE_VERSION,
    assignmentState: "unassigned",
    health,
    observedAt: now.toISOString(),
    ...(state?.deviceLabel === undefined ? {} : { deviceLabel: state.deviceLabel }),
    ...(state?.deviceRecordId === undefined ? {} : { deviceRecordId: state.deviceRecordId }),
    ...(state?.imageVersion === undefined ? {} : { imageVersion: state.imageVersion }),
  };
}

export async function main(): Promise<void> {
  for (;;) {
    const summary = buildHealthSummary();
    process.stdout.write(
      `event=kitluy.health.beat class=${summary.deviceClass} health=${summary.health} assignment=${summary.assignmentState} agent=${summary.agentVersion} image=${summary.imageVersion ?? "unknown"} device=${summary.deviceLabel ?? "unknown"}\n`,
    );
    const state = readBootstrapState();
    if (state !== null) writeBootstrapState({ ...state, updatedAt: summary.observedAt });
    await new Promise((r) => setTimeout(r, BEAT_SECONDS * 1000));
  }
}

if (process.argv[1] !== undefined && process.argv[1].includes("health-reporter")) void main();
