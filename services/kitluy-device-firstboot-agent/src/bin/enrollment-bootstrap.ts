/**
 * `/usr/lib/kitluy/enrollment-agent` — the fleet enrollment bootstrap client.
 *
 * ===========================================================================
 * WHAT THIS DOES TODAY
 * ===========================================================================
 * The cloud endpoint now EXISTS (`/v1/device-enrollment/{challenges,redemptions}`,
 * KLD-2026-08-11-FRESH-DEVICE-ENROLLMENT-001), so this agent presents its
 * flash-time ticket, proves possession of the key firstboot generated, and
 * reports the fleet position it actually reached.
 *
 * The earlier version of this header said the endpoint did not exist and that
 * "the change here is to inject a real `EnrollmentClient`… Nothing in this file
 * needs rewriting". That prediction held: `runEnrollmentStep` and the
 * `EnrollmentClient` port are unchanged, and the transport arrived as an
 * injected adapter.
 *
 * It still does NOT:
 *   - claim enrollment succeeded when the server refused — a refusal is
 *     reported with its code, and the device stays UNENROLLED;
 *   - crash-loop against an unreachable backend, because a restart storm is
 *     indistinguishable from a real outage at 03:00 and buries the signal;
 *   - proceed without a ticket, an identity, a network route, or a configured
 *     endpoint. Each of those is a distinct, legible state.
 *
 * Enrollment produces ENROLLED_UNASSIGNED and nothing more. Store pairing is a
 * separate lifecycle stage with a separate credential (KLSRC-0162 §35).
 */
import { readFileSync } from "node:fs";

import { imageEnvPath, readImageEnv } from "../image-env.js";
import { SERVICE_VERSION } from "../version.js";
import {
  deviceLabelFromPublicKey,
  hasDefaultRoute,
  readBootstrapState,
  writeBootstrapState,
  type BootstrapPhase,
  type BootstrapState,
} from "../bootstrap-state.js";
import { DEFAULT_IDENTITY_DIR, FileIdentityStore } from "../adapters/device-identity-store.js";
import { FileKeyProvider } from "../adapters/device-key-provider.js";
import { createHttpEnrollmentClient } from "../adapters/http-enrollment-client.js";
import type { DeviceClass, EnrollmentClient } from "../enrollment.js";

/** Where an operator drops the one-time development enrollment ticket. */
export const TICKET_PATH = "/var/lib/kitluy/enrollment/ticket";

const POLL_SECONDS = 30;

export interface EnrollmentBootstrapResult {
  readonly phase: BootstrapPhase;
  readonly detail: string;
}

/**
 * One evaluation pass. Pure with respect to scheduling so every branch is
 * directly testable, exactly as `runEnrollmentStep` is.
 */
export async function evaluateBootstrap(options: {
  readonly identityDir?: string;
  readonly ticketPath?: string;
  readonly procRoot?: string;
  /** Root standing in for `/etc`, so image configuration is testable off-device. */
  readonly etcRoot?: string;
  /** Where this agent's own recorded state lives. Injectable for tests. */
  readonly statePath?: string;
  /** Overrides the configured endpoint. Tests inject; the device reads config. */
  readonly baseUrl?: string;
  /** Injected by tests so the transport is not exercised over a real socket. */
  readonly client?: EnrollmentClient;
}): Promise<{ result: EnrollmentBootstrapResult; state: BootstrapState }> {
  const store = new FileIdentityStore({ directory: options.identityDir ?? DEFAULT_IDENTITY_DIR });

  let identity = null;
  let identityError: string | undefined;
  try {
    identity = await store.read();
  } catch (error) {
    identityError = error instanceof Error ? error.message : "unreadable identity";
  }

  const networkReady = hasDefaultRoute(options.procRoot);
  const imageVersion = readImageVersion(options.etcRoot);
  const priorState =
    options.statePath === undefined ? readBootstrapState() : readBootstrapState(options.statePath);

  let phase: BootstrapPhase;
  let detail: string;
  let enrolledDeviceRecordId: string | undefined;

  if (identityError !== undefined) {
    // Identity is corrupt. Enrollment must not proceed and must not "repair"
    // it — that decision belongs to firstboot, which refuses on purpose.
    phase = "HALTED";
    detail = "device identity is unreadable; firstboot must resolve this before enrollment";
  } else if (identity === null || !identity.complete) {
    phase = "IDENTITY_INITIALIZING";
    detail = "waiting for kitluy-firstboot.service to establish a device identity";
  } else if (!networkReady) {
    phase = "NETWORK_WAIT";
    detail = "no default route; the device cannot reach the KitLuy fleet service";
  } else if (alreadyEnrolled(priorState, identity)) {
    // ENROLLMENT IS NOT REPEATABLE, AND THIS AGENT IS A LOOP.
    //
    // `runEnrollmentStep` was written to be re-entered, but nothing read back
    // what a previous pass had achieved, so every 30-second wake started from
    // nothing and presented a ticket the server had already consumed. On the
    // first real device this produced `ENROLLMENT_REDEMPTION_422` twice a
    // minute for ever, and — worse than the noise — the device reported itself
    // UNENROLLED while the fleet held it as `enrolled`. An operator screen
    // reading that state would have said "Not enrolled" about an enrolled
    // device indefinitely.
    //
    // The recorded result is trusted ONLY when it belongs to the identity in
    // front of us. `deviceLabel` derives from the public key, so a device that
    // re-keyed (firstboot `recreated`) no longer matches and correctly enrolls
    // again — a stale file cannot make a new identity believe it is enrolled.
    phase = "ENROLLED_UNASSIGNED";
    detail = "the device is enrolled in the KitLuy fleet and is not assigned to a Store";
    enrolledDeviceRecordId = priorState?.deviceRecordId;
  } else {
    // A card with NO ticket is the normal development case: an SD card copied
    // from a golden one carries none, by design (KLSRC-0162 §34 — the image is
    // secret-free, which is exactly what makes it copyable). The device tries
    // anyway and lets the SERVER decide: a development deployment with open
    // enrollment mints a ticket for it, and every other deployment refuses.
    //
    // Absent is not the same as MALFORMED. A ticket file that exists but cannot
    // be parsed is an operator error and still stops here, because silently
    // falling back to open enrollment would hide a mis-prepared card.
    const ticketFilePath = options.ticketPath ?? TICKET_PATH;
    const ticket = ticketPresent(ticketFilePath) ? readTicket(ticketFilePath) : "NO_TICKET";
    const baseUrl = options.baseUrl ?? readEnrollmentBaseUrl(options.etcRoot);

    if (ticket === null) {
      phase = "UNENROLLED";
      detail =
        "FLEET_ENROLLMENT_REQUIRED: the enrollment ticket file is malformed; expected reference and secret";
    } else if (baseUrl === undefined) {
      // A ticket with nowhere to send it. Saying ENROLLING would be a lie the
      // surface then shows an operator indefinitely.
      phase = "UNENROLLED";
      detail =
        "FLEET_ENROLLMENT_REQUIRED: an enrollment ticket is present but no enrollment endpoint is configured";
    } else {
      const client =
        options.client ??
        createHttpEnrollmentClient({
          baseUrl,
          privateKeyHandle: identity.privateKeyHandle,
          signer: new FileKeyProvider({ directory: options.identityDir ?? DEFAULT_IDENTITY_DIR }),
          // Empty when the card carries no ticket; the client then omits the
          // ticket fields rather than sending blanks.
          ticketReference: ticket === "NO_TICKET" ? "" : ticket.reference,
          ticketSecret: ticket === "NO_TICKET" ? "" : ticket.secret,
          environment: readEnvironment(options.etcRoot),
        });

      const outcome = await client.enroll({
        publicKeyPem: identity.publicKeyPem,
        deviceClass: readDeviceClass(options.etcRoot),
        hardwareSignals: { ...(identity.hardwareSignals ?? {}) },
      });

      if (outcome.kind === "enrolled" || outcome.kind === "already_enrolled") {
        phase = "ENROLLED_UNASSIGNED";
        detail = "the device is enrolled in the KitLuy fleet and is not assigned to a Store";
        enrolledDeviceRecordId = outcome.deviceRecordId;
      } else {
        // A refusal is reported as-is. The agent keeps its honest UNENROLLED
        // state rather than retrying in a tight loop, which on an unbuilt or
        // unreachable backend is indistinguishable from a real outage at 03:00.
        phase = "UNENROLLED";
        detail = `FLEET_ENROLLMENT_REFUSED: ${outcome.code}${outcome.retryable ? " (retryable)" : ""}`;
      }
    }
  }

  const state: BootstrapState = {
    phase,
    detail,
    identityReady: identity !== null && identity.complete,
    networkReady,
    agentVersion: SERVICE_VERSION,
    updatedAt: new Date().toISOString(),
    ...(imageVersion === undefined ? {} : { imageVersion }),
    ...(enrolledDeviceRecordId === undefined ? {} : { deviceRecordId: enrolledDeviceRecordId }),
    ...(identity === null ? {} : { deviceLabel: deviceLabelFromPublicKey(identity.publicKeyPem) }),
  };

  return { result: { phase, detail }, state };
}

/**
 * Whether a previously recorded enrollment still applies to the identity the
 * device is presenting now.
 *
 * All four conditions are required. A recorded phase alone is not enough: the
 * file could have been written by a previous identity, and enrolling is
 * something a SPECIFIC key pair did, not something the hardware did.
 */
function alreadyEnrolled(
  priorState: BootstrapState | null,
  identity: { readonly publicKeyPem: string; readonly complete: boolean } | null,
): boolean {
  if (priorState === null || identity === null || !identity.complete) return false;

  // PHASES THAT DENY ENROLMENT — a deny list, not an allow list of one.
  //
  // This used to read `phase !== "ENROLLED_UNASSIGNED" -> false`, which is
  // fragile in a specific way: ANY new phase written into this file would flip
  // enrolment back to "never happened", and the agent would re-present its
  // consumed ticket every thirty seconds for ever (`ENROLLMENT_REDEMPTION_422`,
  // the defect fixed in `70a339d`). Adding a pairing phase would have re-armed
  // it, which is why pairing keeps its own file (`pairing-state.ts`).
  //
  // But the phase is not merely decorative either: a recorded `UNENROLLED` is an
  // EXPLICIT statement that the last pass did not achieve enrolment, and it must
  // outweigh a stray `deviceRecordId` sitting next to it. That case is asserted
  // by name in `enrollment-idempotency.test.ts` ("dev-should-be-ignored").
  //
  // A deny list satisfies both: an explicit denial is honoured, an unrecognised
  // or future phase cannot silently erase real evidence of enrolment.
  if (priorState.phase === "UNENROLLED" || priorState.phase === "ENROLLING") return false;
  if (priorState.phase === "HALTED") return false;

  // What enrolment actually IS: a server-issued record id belonging to the
  // identity in front of us. `deviceLabel` derives from the public key, so a
  // re-keyed device (firstboot `recreated`) no longer matches and correctly
  // enrols again — a stale file cannot make a new identity believe it is
  // enrolled.
  if (priorState.deviceRecordId === undefined) return false;
  return priorState.deviceLabel === deviceLabelFromPublicKey(identity.publicKeyPem);
}

/**
 * The flashed ticket file: `reference` and `secret`, one per line as
 * `key=value`. The SECRET is never logged and never written anywhere else —
 * `http-enrollment-client` hashes it before transmission.
 */
function readTicket(path: string): { reference: string; secret: string } | null {
  try {
    const text = readFileSync(path, "utf8");
    const reference = /^\s*reference\s*=\s*(.+)$/m.exec(text)?.[1]?.trim();
    const secret = /^\s*secret\s*=\s*(.+)$/m.exec(text)?.[1]?.trim();
    if (reference === undefined || secret === undefined) return null;
    if (reference.length === 0 || secret.length === 0) return null;
    return { reference, secret };
  } catch {
    return null;
  }
}

/**
 * THE FILE THE IMAGE ACTUALLY SHIPS.
 *
 * `build-image.sh` calls this "the only build-time value injection" and writes
 * every non-secret device fact here; `config/image.conf` documents
 * `KITLUY_ENROLLMENT_BASE_URL` as "the device-registry-service base URL the
 * firstboot agent talks to".
 *
 * An earlier version of this module read `KITLUY_FLEET_BASE_URL` from
 * `/etc/kitluy/fleet.env` — a variable nothing writes, in a file no build
 * produces. The endpoint was therefore ALWAYS unresolved on a real device, and
 * the agent reported "no enrollment endpoint is configured" no matter how the
 * image was built. The names are reconciled here, on the reader, because the
 * image side is the one with the build-time override plumbed through it.
 */
/**
 * Re-exported so the historical name keeps working. The reader itself now lives
 * in `image-env.ts`, because the Hub pairing CLI needs the SAME parser and two
 * copies would eventually disagree about where the fleet service is.
 */
export const IMAGE_ENV_PATH = imageEnvPath();

/** Where the fleet service lives. Config, never a compiled-in default. */
function readEnrollmentBaseUrl(etcRoot?: string): string | undefined {
  return readImageEnv("KITLUY_ENROLLMENT_BASE_URL", etcRoot);
}

function readEnvironment(etcRoot?: string): string {
  return readImageEnv("KITLUY_ENVIRONMENT", etcRoot) ?? "development";
}

/**
 * Which device this image is. Read from image config rather than inferred:
 * a Store Hub that guessed it was a terminal would enrol into the wrong class
 * and the error would surface much later, during Store pairing.
 */
function readDeviceClass(etcRoot?: string): DeviceClass {
  return readImageEnv("KITLUY_DEVICE_CLASS", etcRoot) === "store_hub" ? "store_hub" : "terminal";
}

function ticketPresent(path: string): boolean {
  try {
    return readFileSync(path, "utf8").trim().length > 0;
  } catch {
    return false;
  }
}

function readImageVersion(etcRoot?: string): string | undefined {
  return readImageEnv("KITLUY_IMAGE_VERSION", etcRoot);
}

function report(state: BootstrapState): void {
  process.stdout.write(
    `event=kitluy.enrollment.bootstrap phase=${state.phase} identity=${state.identityReady} network=${state.networkReady} detail=${JSON.stringify(state.detail ?? "")}\n`,
  );
}

export async function main(): Promise<void> {
  // A long-running unit rather than a oneshot, so the surface tracks network
  // and ticket changes without an operator restarting anything.
  for (;;) {
    const { state } = await evaluateBootstrap({});
    writeBootstrapState(state);
    report(state);
    await new Promise((resolve) => setTimeout(resolve, POLL_SECONDS * 1000));
  }
}

if (process.argv[1] !== undefined && process.argv[1].includes("enrollment-bootstrap")) {
  void main();
}
