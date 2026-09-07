/**
 * `/usr/lib/kitluy/health-reporter` — the minimum fleet liveness runtime (§15).
 *
 * Before the device holds a server-issued device id there is nobody to report
 * to, so it reports LOCALLY: it refreshes the bootstrap state file when one
 * exists and writes a journal line. It does not open a socket, and it does not
 * create a second telemetry architecture — when the device is paired, this
 * becomes the caller of the canonical fleet health contract
 * (`device_fleet.health_projection_reported`), not a new one.
 *
 * The interval is deliberately conservative. The owner-ruled liveness
 * thresholds (OD-EDGE-LIVENESS-001) are ONLINE <= 90s, so a 60s beat keeps a
 * healthy device green with one missed beat of headroom.
 *
 * ===========================================================================
 * THE DEVICE CLASS COMES FROM THE IMAGE, NOT FROM THIS FILE
 * ===========================================================================
 * This reported `deviceClass: "terminal"` as a constant, which was a lie on
 * every Store Hub that ran it. The class is baked into /etc/kitluy/image.env
 * by the builder (`IGconf_kitluy_device_class`) and read from there; a device
 * whose image did not state one reports `unknown` rather than guessing. It is
 * still not re-derived from anything the device could invent about itself.
 *
 * ===========================================================================
 * HEALTH WITHOUT bootstrap-state.json
 * ===========================================================================
 * The flash-time ticket agent, which wrote `bootstrap-state.json`, is retired
 * from the terminal image (KLD-2026-09-03-FACTORY-ENROLLMENT-001). With only
 * the old file consulted, every terminal built after that reported `degraded`
 * for ever. Cloud registration's `registration-state.json` is the live signal
 * now: a device that has reached KitLuy is healthy whether or not a human has
 * approved it yet, one that cannot reach KitLuy is still bootstrapping, and one
 * KitLuy has stopped is degraded.
 */
import { SERVICE_VERSION } from "../version.js";
import { readBootstrapState, writeBootstrapState } from "../bootstrap-state.js";
import { readImageEnv } from "../image-env.js";
import { readRegistrationState, type RegistrationPhase } from "../registration-state.js";

/** One beat under the 90s ONLINE threshold, with headroom for one loss. */
export const BEAT_SECONDS = 60;

export interface HealthSummary {
  readonly deviceLabel?: string;
  readonly deviceRecordId?: string;
  /** From /etc/kitluy/image.env; `unknown` when the image stated none. */
  readonly deviceClass: string;
  readonly imageVersion?: string;
  readonly agentVersion: string;
  readonly assignmentState: "unassigned";
  readonly registrationPhase?: RegistrationPhase;
  readonly health: "bootstrapping" | "healthy" | "degraded";
  readonly observedAt: string;
}

export interface HealthSummaryOptions {
  readonly etcRoot?: string;
  readonly bootstrapPath?: string;
  readonly registrationPath?: string;
  readonly now?: Date;
}

export function buildHealthSummary(options: HealthSummaryOptions = {}): HealthSummary {
  const now = options.now ?? new Date();
  const state =
    options.bootstrapPath === undefined
      ? readBootstrapState()
      : readBootstrapState(options.bootstrapPath);
  const registration =
    options.registrationPath === undefined
      ? readRegistrationState()
      : readRegistrationState(options.registrationPath);

  const health: HealthSummary["health"] =
    state !== null
      ? state.phase === "HALTED"
        ? "degraded"
        : state.identityReady && state.networkReady
          ? "healthy"
          : "bootstrapping"
      : registration === null
        ? "bootstrapping"
        : registration.phase === "CONTAINED"
          ? "degraded"
          : registration.phase === "UNREACHABLE" ||
              registration.phase === "NOT_REGISTERED" ||
              registration.phase === "REGISTERING"
            ? "bootstrapping"
            : "healthy";

  const deviceRecordId = state?.deviceRecordId ?? registration?.deviceId;
  const imageVersion = state?.imageVersion ?? readImageEnv("KITLUY_IMAGE_VERSION", options.etcRoot);

  return {
    deviceClass: readImageEnv("KITLUY_DEVICE_CLASS", options.etcRoot) ?? "unknown",
    agentVersion: SERVICE_VERSION,
    assignmentState: "unassigned",
    health,
    observedAt: now.toISOString(),
    ...(state?.deviceLabel === undefined ? {} : { deviceLabel: state.deviceLabel }),
    ...(deviceRecordId === undefined ? {} : { deviceRecordId }),
    ...(imageVersion === undefined ? {} : { imageVersion }),
    ...(registration === null ? {} : { registrationPhase: registration.phase }),
  };
}

export async function main(): Promise<void> {
  for (;;) {
    const summary = buildHealthSummary();
    process.stdout.write(
      `event=kitluy.health.beat class=${summary.deviceClass} health=${summary.health} assignment=${summary.assignmentState} registration=${summary.registrationPhase ?? "none"} agent=${summary.agentVersion} image=${summary.imageVersion ?? "unknown"} device=${summary.deviceRecordId ?? summary.deviceLabel ?? "unknown"}\n`,
    );
    const state = readBootstrapState();
    if (state !== null) writeBootstrapState({ ...state, updatedAt: summary.observedAt });
    await new Promise((r) => setTimeout(r, BEAT_SECONDS * 1000));
  }
}

if (process.argv[1] !== undefined && process.argv[1].includes("health-reporter")) void main();
