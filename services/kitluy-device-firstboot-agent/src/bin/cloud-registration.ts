/**
 * `kitluy-cloud-registration` — the device announces itself to KitLuy.
 *
 * Authority: KLD-2026-08-17-DEVICE-REGISTRATION-APPROVAL-001; plan v1.0.0 §3.
 *
 * ===========================================================================
 * WHY THIS IS A SEPARATE UNIT FROM enrollment-bootstrap
 * ===========================================================================
 * Factory enrolment presents a flash-time ticket to the fleet service and can
 * produce `enrolled`. Cloud registration presents NOTHING, reaches Supabase, and
 * cannot produce `enrolled` under any input — it produces an untrusted record a
 * human at HET must approve. They are different contracts to different services
 * with opposite trust outcomes, and plan §5.3 has the ticket path being retired
 * rather than extended.
 *
 * Running them as one unit would also mean one failure state for two unrelated
 * causes: a device with no ticket is doing exactly the right thing on this path
 * and exactly the wrong thing on the other.
 *
 * ===========================================================================
 * PENDING IS THE DESIGNED RESTING STATE, SO THIS UNIT KEEPS RUNNING
 * ===========================================================================
 * A generic image is SUPPOSED to reach "waiting for HET approval" and stay
 * there. This is a loop rather than a oneshot for two reasons: approval happens
 * later and the device must notice it without a reboot, and a Store network
 * often is not up when firstboot runs. Neither is an error, and neither may
 * make the unit fail — a red `systemctl status` for the intended state would
 * send every installer hunting a fault that does not exist.
 *
 * ===========================================================================
 * WHAT THIS UNIT WILL NOT DO
 * ===========================================================================
 * It does not create identity — that is firstboot's job, and a registration
 * agent that minted a key would race it. It does not fetch Store configuration,
 * catalog, staff or any operational credential: plan §3.4 forbids a device
 * receiving Store data before trust, and this unit has no code path that asks
 * for any.
 */
import { hostname } from "node:os";

import {
  createHttpRegistrationClient,
  fingerprintFromPem,
} from "../adapters/http-registration-client.js";
import { FileIdentityStore, DEFAULT_IDENTITY_DIR } from "../adapters/device-identity-store.js";
import { FileKeyProvider } from "../adapters/device-key-provider.js";
import { LinuxHardwareProbe } from "../adapters/linux-hardware-probe.js";
import { readImageEnv } from "../image-env.js";
import { loadOrCreateInstallation } from "../installation.js";
import {
  writeRegistrationState,
  type RegistrationPhase,
  type RegistrationState,
} from "../registration-state.js";

/** How often the device re-checks. Approval is a human action, not a fast one. */
const POLL_SECONDS = 60;

/**
 * The registration route, as a FULL url.
 *
 * Deliberately a separate key from `KITLUY_ENROLLMENT_BASE_URL`: that names the
 * fleet service, which does not serve this route. Overloading one variable would
 * send registration requests to a host that answers 404 for them, and the device
 * could not tell that from a genuine refusal.
 */
function readRegistrationUrl(etcRoot?: string): string | undefined {
  return readImageEnv("KITLUY_REGISTRATION_URL", etcRoot);
}

/**
 * The hardware profile KEY, never a UUID (contract §4).
 *
 * A key identifies a MODEL, so a generic image may carry one; a UUID would
 * differ per environment and would make the image environment-specific — which
 * is exactly the "generic image stays generic" property plan §5.2 protects.
 */
function readHardwareProfileKey(etcRoot?: string): string | undefined {
  return readImageEnv("KITLUY_HARDWARE_PROFILE_KEY", etcRoot);
}

function nowIso(): string {
  return new Date().toISOString();
}

function state(phase: RegistrationPhase, rest: Partial<RegistrationState> = {}): RegistrationState {
  return { phase, updatedAt: nowIso(), ...rest };
}

export interface RegistrationPassOptions {
  readonly identityDir?: string;
  readonly etcRoot?: string;
  readonly statePath?: string;
  readonly installationPath?: string;
  /** Injected by tests so no real socket is opened. */
  readonly fetchImpl?: typeof fetch;
}

/**
 * One registration attempt. Returns the state it wrote, so the loop and the
 * tests observe exactly the same thing.
 */
export async function runRegistrationPass(
  options: RegistrationPassOptions = {},
): Promise<RegistrationState> {
  const registrationUrl = readRegistrationUrl(options.etcRoot);
  if (registrationUrl === undefined) {
    // Said plainly rather than as an error: an image built without a
    // registration origin is a build decision, and the rootfs is read-only so
    // nothing on the device can repair it. The operator needs to know a rebuild
    // is required, not that the network failed.
    return persist(
      state("NOT_REGISTERED", {
        detail: "no KITLUY_REGISTRATION_URL in image configuration; this image cannot register",
      }),
      options,
    );
  }

  const hardwareProfileKey = readHardwareProfileKey(options.etcRoot);
  if (hardwareProfileKey === undefined) {
    return persist(
      state("NOT_REGISTERED", {
        detail: "no KITLUY_HARDWARE_PROFILE_KEY in image configuration",
      }),
      options,
    );
  }

  // ONE directory for both. The identity record and the private key it refers to
  // live together; constructing the key provider with its own default while the
  // store was pointed elsewhere would make the agent sign with a key that does
  // not belong to the identity it just read — and on a device the two paths are
  // identical, so nothing would reveal it until someone moved one of them.
  const identityDir = options.identityDir ?? DEFAULT_IDENTITY_DIR;
  const store = new FileIdentityStore({ directory: identityDir });
  let identity;
  try {
    identity = await store.read();
  } catch {
    return persist(
      state("NOT_REGISTERED", {
        detail: "device identity is unreadable; firstboot must resolve it",
      }),
      options,
    );
  }
  if (identity === null || !identity.complete) {
    return persist(
      state("NOT_REGISTERED", {
        detail: "waiting for kitluy-firstboot.service to create an identity",
      }),
      options,
    );
  }

  const installation = loadOrCreateInstallation({
    ...(options.installationPath !== undefined ? { path: options.installationPath } : {}),
    ...(() => {
      const release = readImageEnv("KITLUY_IMAGE_VERSION", options.etcRoot);
      return release !== undefined ? { imageRelease: release } : {};
    })(),
  });

  const signals = await new LinuxHardwareProbe().collect();
  const client = createHttpRegistrationClient({
    registrationUrl,
    privateKeyHandle: identity.privateKeyHandle,
    signer: new FileKeyProvider({ directory: identityDir }),
    hardwareProfileKey,
    ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
  });

  const result = await client.register({
    publicKeyPem: identity.publicKeyPem,
    hostname: hostname(),
    hardwareSignals: signals,
    installationId: installation.installationId,
    ...(installation.imageRelease !== undefined
      ? { installationEvidence: { imageRelease: installation.imageRelease } }
      : {}),
  });

  // Recorded so a state file left behind by a re-keyed device cannot be read as
  // this installation's registration — the discipline `pairingBelongsTo()` and
  // `alreadyEnrolled()` both apply to their own state.
  const keyFingerprint = fingerprintFromPem(identity.publicKeyPem);

  switch (result.kind) {
    case "pending":
      return persist(
        state("AWAITING_APPROVAL", {
          deviceId: result.deviceId,
          installationId: result.installationId,
          keyFingerprint,
          detail: result.installationCreated
            ? "registered; this installation is new to KitLuy"
            : "already registered; waiting for a KitLuy decision",
        }),
        options,
      );
    case "known":
      return persist(
        state("APPROVED", {
          deviceId: result.deviceId,
          installationId: result.installationId,
          keyFingerprint,
          detail: "this board is approved; provisioning is a separate step",
        }),
        options,
      );
    case "trust_review": {
      // Containment reasons are a DIFFERENT operator situation from ambiguous
      // evidence: waiting resolves the second and never resolves the first.
      const contained = result.conflictReason.startsWith("KLUY-DEVICE-CONTAINED-");
      return persist(
        state(contained ? "CONTAINED" : "TRUST_REVIEW_REQUIRED", {
          ...(result.deviceId !== null ? { deviceId: result.deviceId } : {}),
          keyFingerprint,
          conflictReason: result.conflictReason,
          detail: result.conflictReason,
        }),
        options,
      );
    }
    case "refused":
      return persist(
        state(result.code === "REGISTRATION_UNREACHABLE" ? "UNREACHABLE" : "NOT_REGISTERED", {
          detail: result.retryable ? `${result.code} (will retry)` : result.code,
        }),
        options,
      );
  }
}

function persist(next: RegistrationState, options: RegistrationPassOptions): RegistrationState {
  if (options.statePath === undefined) {
    writeRegistrationState(next);
  } else {
    writeRegistrationState(next, options.statePath);
  }
  return next;
}

function report(current: RegistrationState): void {
  process.stdout.write(
    `event=kitluy.device.registration phase=${current.phase} device=${current.deviceId ?? ""} detail=${JSON.stringify(current.detail ?? "")}\n`,
  );
}

export async function main(): Promise<void> {
  for (;;) {
    let current: RegistrationState;
    try {
      current = await runRegistrationPass({});
    } catch (error) {
      // An unexpected fault must not kill the unit: the device would then never
      // notice its own approval, and the only recovery would be a reboot nobody
      // knows to perform.
      current = {
        phase: "NOT_REGISTERED",
        detail: error instanceof Error ? error.message : "unexpected registration fault",
        updatedAt: nowIso(),
      };
      writeRegistrationState(current);
    }
    report(current);
    // An approved board still polls: approval does not provision it, and the
    // next lifecycle step is owned by a different surface.
    await new Promise((resolve) => setTimeout(resolve, POLL_SECONDS * 1000));
  }
}

if (process.argv[1] !== undefined && process.argv[1].includes("cloud-registration")) {
  void main();
}
