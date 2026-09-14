/**
 * Composition: the wiring that turns the update agent's parts into a runtime.
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS, AND WHAT ITS ABSENCE COST
 * ===========================================================================
 * Phase 3 built the install sequence (`release-install.ts`) and left a comment
 * saying "the install pass is composed by the caller in the image". That caller
 * was never written. The agent's `main()` loop called `reportOnce()` and nothing
 * else, so a correctly built image would boot, register, pair, report `ready`
 * every five minutes — and never install anything.
 *
 * Every unit test passed, because they all call `runInstallPass` directly. The
 * 31-step chain check passed, because it drives the sources directly too. The
 * engine was tested and the ignition was not, and nothing in between said so.
 *
 * That is why this module is separate and exported: the composition is now a
 * thing that can be asserted about, not a side effect of an entrypoint.
 *
 * ===========================================================================
 * EVERYTHING COMES FROM THE DEVICE'S OWN STATE
 * ===========================================================================
 * Nothing here is configured by the release source. The acceptance context is
 * read from `/etc/kitluy/image.env`, which the builder baked and the read-only
 * rootfs protects; the device id and asset tag come from the device's own
 * registration state. A transport that could influence either would be deciding
 * what the device installs, which is the thing groups 0222/0223 exist to stop.
 */
import { execFileSync } from "node:child_process";

import { readImageEnv } from "./image-env.js";
import { createHttpReleaseSource } from "./adapters/http-release-source.js";
import { readRegistrationState } from "./registration-state.js";
import { loadReleaseTrustRegistry } from "./release-trust.js";
import { storePaths, U1_PERMITTED_PRODUCT } from "./release-store.js";
import type { HealthProbe, InstallDependencies, UnitControl } from "./release-install.js";
import type { ReleaseAcceptanceContext } from "./release-verify.js";

/** The unit that runs the one product U1 may update. */
export const DEVICE_SHELL_UNIT = "kitluy-device-shell.service";

export type CompositionRefusal =
  | "NO_TRUST_ANCHOR"
  | "NO_RELEASE_SOURCE"
  | "NOT_REGISTERED"
  | "NO_DEVICE_IDENTITY"
  | "IMAGE_STATES_NO_ENVIRONMENT"
  | "IMAGE_STATES_NO_HARDWARE_PROFILE";

export type Composition =
  | { readonly ok: true; readonly deps: InstallDependencies }
  | { readonly ok: false; readonly refusal: CompositionRefusal; readonly detail: string };

/**
 * Run a command and return its trimmed output, or null if it failed.
 *
 * `execFileSync`, never a shell: nothing here interpolates a value into a
 * command line, so there is no string for a crafted unit name to escape from.
 */
function run(command: string, args: readonly string[]): string | null {
  try {
    return execFileSync(command, [...args], { encoding: "utf8", timeout: 20_000 }).trim();
  } catch {
    return null;
  }
}

/**
 * Restart the unit the release replaced.
 *
 * The agent runs as root but with an EMPTY CapabilityBoundingSet. Talking to
 * systemd over its private socket is authorised by uid, not by capability, so
 * this works — but it is exactly the kind of thing that behaves differently on
 * a board than on a workstation, so a failure is REPORTED rather than swallowed:
 * `runInstallPass` treats a restart failure as a rollback, which is the safe
 * reading (the new release is on disk and unproven).
 */
export function createUnitControl(unit = DEVICE_SHELL_UNIT): UnitControl {
  return {
    restart(): Promise<void> {
      const out = run("systemctl", ["restart", unit]);
      if (out === null) {
        return Promise.reject(new Error(`systemctl restart ${unit} failed`));
      }
      return Promise.resolve();
    },
  };
}

/**
 * The health probe: is the unit active?
 *
 * Owner ruling 2026-09-11 — the gate observes `systemctl is-active`. It catches
 * the case acceptance test B is built around (a Shell that exits immediately
 * leaves the unit `failed` or `activating`, never `active`) at the cost of no
 * change to the Device Shell.
 *
 * Its honest limit, recorded rather than hidden: a Shell that starts and paints
 * nothing would pass this probe. Closing that needs a liveness marker from the
 * Shell itself, which the owner deliberately deferred.
 */
export function createUnitHealthProbe(unit = DEVICE_SHELL_UNIT): HealthProbe {
  return {
    probe(): Promise<{ healthy: boolean; detail: string }> {
      // `is-active` exits non-zero for every state but `active`, so the output
      // is read rather than the exit code — "failed" and "activating" are
      // different faults and the journal should say which.
      const state = run("systemctl", ["is-active", unit]) ?? "unknown";
      return Promise.resolve(
        state === "active"
          ? { healthy: true, detail: "active" }
          : { healthy: false, detail: `${unit} is ${state}` },
      );
    },
  };
}

/** The acceptance context, entirely from the image the builder produced. */
export function acceptanceFromImage(etcRoot?: string): ReleaseAcceptanceContext | null {
  const environment = readImageEnv("KITLUY_ENVIRONMENT", etcRoot);
  const hardwareProfile = readImageEnv("KITLUY_HARDWARE_PROFILE_KEY", etcRoot);
  if (environment === undefined || hardwareProfile === undefined) return null;
  const channel = readImageEnv("KITLUY_RELEASE_CHANNEL", etcRoot) ?? "internal";
  const schema = Number.parseInt(readImageEnv("KITLUY_IMAGE_SCHEMA_VERSION", etcRoot) ?? "1", 10);
  return {
    productKey: U1_PERMITTED_PRODUCT,
    architecture: "arm64",
    hardwareProfile,
    environment,
    eligibleChannels: [channel],
    schemaVersion: Number.isFinite(schema) ? schema : 1,
    // U1 delivers no configuration prerequisite; a release declaring one is
    // refused by the acceptance gate rather than guessed at here.
    configurationVersion: 0,
  };
}

export interface CompositionOptions {
  readonly baseUrl: string;
  readonly etcRoot?: string;
  readonly trustDir?: string;
  readonly storeRoot?: string;
  readonly registrationStatePath?: string;
  readonly unit?: string;
}

/**
 * Assemble everything the install pass needs, or say precisely what is missing.
 *
 * Refusals are named so a board that is not updating explains itself in one
 * journal line — "NOT_REGISTERED" and "NO_TRUST_ANCHOR" are different problems
 * with different fixes, and a single "not ready" would hide which.
 */
export function composeInstallDependencies(options: CompositionOptions): Composition {
  const environmentValue = readImageEnv("KITLUY_ENVIRONMENT", options.etcRoot);
  if (environmentValue === undefined) {
    return {
      ok: false,
      refusal: "IMAGE_STATES_NO_ENVIRONMENT",
      detail: "the image states no environment, so no trust anchor can be accepted",
    };
  }

  const registry = loadReleaseTrustRegistry({
    trustDir: options.trustDir,
    environment: environmentValue,
  });
  if (registry.keys.length === 0) {
    return {
      ok: false,
      refusal: "NO_TRUST_ANCHOR",
      detail:
        registry.rejected.length === 0
          ? "no release trust anchor"
          : `every trust record refused: ${registry.rejected.map((r) => `${r.file}:${r.refusal}`).join(",")}`,
    };
  }

  const registration = readRegistrationState(options.registrationStatePath);
  if (registration === null) {
    return { ok: false, refusal: "NOT_REGISTERED", detail: "no registration state on this device" };
  }
  const deviceId = registration.deviceId;
  const fingerprint = registration.keyFingerprint;
  if (deviceId === undefined || fingerprint === undefined) {
    return {
      ok: false,
      refusal: "NO_DEVICE_IDENTITY",
      detail: "registration state carries no device id or key fingerprint yet",
    };
  }

  const acceptance = acceptanceFromImage(options.etcRoot);
  if (acceptance === null) {
    return {
      ok: false,
      refusal: "IMAGE_STATES_NO_HARDWARE_PROFILE",
      detail: "the image states no hardware profile key",
    };
  }

  // The device names ITSELF to the source, by the identifier the CLOUD issued
  // it — never by one derived locally.
  //
  // This used to pass `assetTagFromFingerprint(fingerprint)`. The intent was
  // right — a transport must not be able to talk the device into asking about
  // somebody else's board, and local state cannot be chosen by a transport —
  // but the DERIVATION was wrong: the authoritative name lives in the cloud.
  //
  // Registration contract §9 says the server never renames a board it already
  // knows. After a re-flash the board presents a NEW key, the cloud keeps the
  // ORIGINAL tag, and the two stop agreeing:
  //
  //   device derived  KL-6F4E86A71516   (from the new key)
  //   cloud holds     KL-1CB3577C26A7   (kept, per §9)
  //   GET /release/v1/assignment?device=KL-6F4E86A71516 -> 404
  //   -> "no release is assigned to this device", on every poll, for ever
  //
  // Observed on hardware 2026-09-14. A re-flashed device is precisely the
  // device an OTA system exists to serve, so this was never an edge case.
  //
  // `deviceId` is written by the cloud into the registration state and is what
  // the cloud keys on. It is local state exactly as the fingerprint was, so
  // the property that mattered is unchanged.
  const source = createHttpReleaseSource({
    baseUrl: options.baseUrl,
    deviceRef: deviceId,
  });

  return {
    ok: true,
    deps: {
      paths: storePaths(U1_PERMITTED_PRODUCT, options.storeRoot),
      assignments: source,
      artifacts: source,
      trustedKeys: registry.keys,
      deviceId,
      acceptance,
      unit: createUnitControl(options.unit),
      health: createUnitHealthProbe(options.unit),
    },
  };
}
