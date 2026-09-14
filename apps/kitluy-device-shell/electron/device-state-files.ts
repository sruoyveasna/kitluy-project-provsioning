/**
 * Read-only readers for the device's own state, gathered into a `ShellSnapshot`.
 *
 * The shell runs UNPRIVILEGED and never reads a private key. It parses the same
 * display-state JSON the firstboot agent writes (`registration-state.json`,
 * `pairing-state.json`, `bootstrap-state.json`) plus sysfs link state and
 * `/proc/net/route`. An absent or unparsable file reads as the earliest/safest
 * value — exactly as the agent's own readers do — so a corrupt file can never
 * wedge the screen.
 *
 * READS everything under `/var/lib/kitluy`; WRITES only inside
 * `/var/lib/kitluy/terminal`, which is the kiosk user's own directory and the
 * only path `kitluy-terminal-session.service` grants it. The agent's files stay
 * root-owned and are read here, never written — see `terminal-assignment.ts` for
 * why the terminal records its seat separately from the Store Hub's console.
 *
 * Paths are parameterised (`roots`) so this is testable off-device against a
 * fixture tree, and the drift test pins these paths against the agent's exported
 * `*_STATE_PATH` constants.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readTerminalAssignment } from "./terminal-assignment.js";
import type {
  ReleaseView,
  AssignmentView,
  NetworkState,
  PairingPhase,
  PairingView,
  RegistrationPhase,
  RegistrationView,
  ShellSnapshot,
} from "../src/model/shell-state.js";

export interface DeviceRoots {
  /** Default `/var/lib/kitluy`. */
  readonly stateDir: string;
  /** Default `/sys/class/net`. */
  readonly netDir: string;
  /** Default `/proc/net/route`. */
  readonly routePath: string;
  /**
   * The slot-shared release store. Read-only from here: the shell renders what
   * the update runtime recorded and never writes to it.
   */
  readonly releaseStoreDir: string;
}

export const DEFAULT_ROOTS: DeviceRoots = {
  stateDir: "/var/lib/kitluy",
  netDir: "/sys/class/net",
  routePath: "/proc/net/route",
  releaseStoreDir: "/persistent/shared/kitluy/releases/device-shell",
};

const REGISTRATION_PHASES: readonly RegistrationPhase[] = [
  "NOT_REGISTERED",
  "REGISTERING",
  "AWAITING_APPROVAL",
  "TRUST_REVIEW_REQUIRED",
  "APPROVED",
  "CONTAINED",
  "UNREACHABLE",
];

const PAIRING_PHASES: readonly PairingPhase[] = [
  "UNPAIRED",
  "AWAITING_CODE",
  "SUBMITTING",
  "PAIRED",
  "LOCKED",
  "ALREADY_ASSIGNED",
];

function readObject(path: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function str(raw: Record<string, unknown>, key: string): string | undefined {
  const value = raw[key];
  return typeof value === "string" ? value : undefined;
}

export function readRegistration(stateDir = DEFAULT_ROOTS.stateDir): RegistrationView | null {
  const raw = readObject(join(stateDir, "registration-state.json"));
  if (raw === null) return null;
  const phase = raw.phase;
  if (typeof phase !== "string" || !REGISTRATION_PHASES.includes(phase as RegistrationPhase)) {
    return null;
  }
  const deviceId = str(raw, "deviceId");
  const detail = str(raw, "detail");
  const keyFingerprint = str(raw, "keyFingerprint");
  return {
    phase: phase as RegistrationPhase,
    ...(deviceId === undefined ? {} : { deviceId }),
    ...(detail === undefined ? {} : { detail }),
    ...(keyFingerprint === undefined ? {} : { keyFingerprint }),
  };
}

export function readPairing(stateDir = DEFAULT_ROOTS.stateDir): PairingView | null {
  const raw = readObject(join(stateDir, "pairing-state.json"));
  if (raw === null) return null;
  const phase = raw.phase;
  if (typeof phase !== "string" || !PAIRING_PHASES.includes(phase as PairingPhase)) {
    return null;
  }
  const detail = str(raw, "detail");
  const deviceRecordId = str(raw, "deviceRecordId");
  return {
    phase: phase as PairingPhase,
    ...(detail === undefined ? {} : { detail }),
    ...(deviceRecordId === undefined ? {} : { deviceRecordId }),
  };
}

/**
 * The server record id the pairing belongs to.
 *
 * ===========================================================================
 * TWO SOURCES, AND THE SECOND IS THE LIVE ONE
 * ===========================================================================
 * This read ONLY `bootstrap-state.json`, written by the flash-time ticket agent
 * that KLD-2026-09-03-FACTORY-ENROLLMENT-001 RETIRED from the terminal image. On
 * every terminal built since, the file is absent, so this returned undefined and
 * `submitPairingCode` refused with NO_DEVICE_RECORD before touching the network
 * — a pairing code that could never work, on a board that had registered
 * perfectly well. Observed on hardware 2026-09-09; the pairing session showed
 * zero attempts, because none was ever made.
 *
 * `health-reporter.ts` already hit this exact trap and already documents the
 * answer: cloud registration's `registration-state.json` is the live signal now.
 * The key is `deviceId` there and `deviceRecordId` in the retired file — the two
 * names are why a single lookup could not simply be repointed.
 *
 * Bootstrap is still read FIRST so a board that somehow carries both keeps its
 * existing behaviour; the fallback only fires where the old file is gone.
 */
export function readDeviceRecordId(stateDir = DEFAULT_ROOTS.stateDir): string | undefined {
  const bootstrap = readObject(join(stateDir, "bootstrap-state.json"));
  const fromBootstrap = bootstrap === null ? undefined : str(bootstrap, "deviceRecordId");
  if (fromBootstrap !== undefined) return fromBootstrap;

  const registration = readObject(join(stateDir, "registration-state.json"));
  return registration === null ? undefined : str(registration, "deviceId");
}

/**
 * Network readiness: a link exists if any real interface (not `lo`) reports
 * `operstate=up`; a route exists if `/proc/net/route` has a default entry
 * (destination `00000000`). Both fail safe to `false`.
 */
export function readNetwork(roots: DeviceRoots = DEFAULT_ROOTS): NetworkState {
  let hasLink = false;
  try {
    for (const iface of readdirSync(roots.netDir)) {
      if (iface === "lo") continue;
      try {
        const state = readFileSync(join(roots.netDir, iface, "operstate"), "utf8").trim();
        if (state === "up") {
          hasLink = true;
          break;
        }
      } catch {
        /* interface without operstate — skip */
      }
    }
  } catch {
    /* no netDir — hasLink stays false */
  }

  let hasRoute = false;
  try {
    const table = readFileSync(roots.routePath, "utf8").split("\n").slice(1);
    for (const line of table) {
      const fields = line.split(/\s+/);
      // fields[1] is the destination in little-endian hex; "00000000" = default.
      if (fields[1] === "00000000") {
        hasRoute = true;
        break;
      }
    }
  } catch {
    /* no route file — hasRoute stays false */
  }

  return { hasLink, hasRoute };
}

/**
 * The terminal's own seat, from the kiosk user's directory.
 *
 * Parameterised on `stateDir` like the others so the fixture tree can carry one;
 * on a device this resolves to `/var/lib/kitluy/terminal/assignment.json`.
 */
export function readAssignment(stateDir = DEFAULT_ROOTS.stateDir): AssignmentView | null {
  const raw = readTerminalAssignment(join(stateDir, "terminal", "assignment.json"));
  if (raw === null) return null;
  return {
    deviceRecordId: raw.deviceRecordId,
    activated: raw.activated === true,
    digitalStoreReference: raw.digitalStoreReference,
    storeLocationReference: raw.storeLocationReference,
    physicalTerminalLabel: raw.physicalTerminalLabel,
  };
}

/**
 * What is actually running, for the screen (U1 requirement 4).
 *
 * TWO SOURCES, AND THE LAUNCHER IS THE ONE THAT KNOWS. `running-source.json` is
 * written by `/usr/lib/kitluy/device-shell` immediately before it execs, so it
 * is the only honest witness to what this process was started from; the journal
 * says what is INSTALLED, which can differ. Reporting the journal alone would
 * show the assigned version on a board that is actually running the image copy
 * — the exact confusion the owner asked to be made impossible.
 */
export function readRelease(roots: DeviceRoots = DEFAULT_ROOTS): ReleaseView | null {
  const witness = readJsonOrNull(join(roots.stateDir, "terminal", "running-source.json"));
  const journal = readJsonOrNull(join(roots.releaseStoreDir, "journal.json"));
  if (witness === null && journal === null) return null;

  const rawSource = typeof witness?.["source"] === "string" ? witness["source"] : "";
  const source: ReleaseView["source"] =
    rawSource === "RELEASE" || rawSource === "IMAGE_FALLBACK" ? rawSource : "UNKNOWN";

  const installedVersion =
    typeof journal?.["committedVersion"] === "string" ? journal["committedVersion"] : null;
  const committed = typeof journal?.["committed"] === "string" ? journal["committed"] : null;

  // The running version is only claimed when the launcher says a release ran.
  // For the image copy it stays null on purpose: there is no release version to
  // report, and borrowing the installed one would be the lie.
  const app = typeof witness?.["app"] === "string" ? witness["app"] : "";
  const runningIsCommitted = committed !== null && app.includes(`rel-${committed}`);
  const runningVersion = source === "RELEASE" && runningIsCommitted ? installedVersion : null;

  const stale =
    (source === "IMAGE_FALLBACK" && committed !== null) ||
    (source === "RELEASE" && committed !== null && !runningIsCommitted);

  const lastResult = journal?.["lastResult"] as Record<string, unknown> | null | undefined;
  const lastOutcome =
    typeof lastResult?.["outcome"] === "string"
      ? (lastResult["outcome"] as ReleaseView["lastOutcome"])
      : null;
  const lastReason = typeof lastResult?.["reason"] === "string" ? lastResult["reason"] : null;

  let fallbackReason: string | null = null;
  if (source === "IMAGE_FALLBACK") {
    fallbackReason =
      committed !== null
        ? "a release is installed; it starts on the next restart"
        : (lastReason ?? "no release has been installed on this device");
  }

  return {
    source,
    runningVersion,
    installedVersion,
    stale,
    fallbackReason,
    lastOutcome,
    lastReason,
  };
}

/** Never throws: an unreadable or malformed file reads as absent. */
function readJsonOrNull(path: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function readSnapshot(roots: DeviceRoots = DEFAULT_ROOTS): ShellSnapshot {
  const registration = readRegistration(roots.stateDir);
  const deviceRecordId = readDeviceRecordId(roots.stateDir);
  return {
    registration,
    pairing: readPairing(roots.stateDir),
    assignment: readAssignment(roots.stateDir),
    network: readNetwork(roots),
    ...(registration?.keyFingerprint === undefined
      ? {}
      : { keyFingerprint: registration.keyFingerprint }),
    ...(deviceRecordId === undefined ? {} : { deviceRecordId }),
    release: readRelease(roots),
  };
}
