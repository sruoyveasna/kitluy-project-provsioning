/**
 * The install sequence: assignment -> verify -> fetch -> re-prove -> extract ->
 * stage -> activate -> restart -> health gate -> commit or roll back.
 *
 * ===========================================================================
 * THE ORDER IS THE CORRECTNESS ARGUMENT
 * ===========================================================================
 * Each step exists to make the next one safe, so the sequence below is not a
 * convenience — reordering any part of it breaks a property somebody asked for:
 *
 *   assignment BEFORE bytes        the transport is never the authority (req 1)
 *   signature BEFORE bytes         a bad manifest costs zero network
 *   acceptance BEFORE bytes        a wrong-device release costs zero network
 *   replay checks BEFORE bytes     a downgrade costs zero network (req 2)
 *   disk check BEFORE staging      a full disk never touches what is running
 *   digest re-proof BEFORE extract signature proves the producer, not the bytes
 *   safe extract BEFORE promote    a signature does not waive extraction safety
 *   journal intent BEFORE switch   a power cut is decidable afterwards (req 3)
 *   health gate BEFORE commit      an unproven release is never "installed"
 *
 * ===========================================================================
 * THE RUNNING RELEASE IS NEVER TOUCHED UNTIL THE NEW ONE IS PROVEN ON DISK
 * ===========================================================================
 * Everything up to `promoteStaged` happens beside the running release, in a
 * sibling `.incoming` directory. A refusal at any point before activation
 * leaves `current` exactly where it was, and the device keeps serving. That is
 * what acceptance test D checks from the outside.
 *
 * ===========================================================================
 * THE HEALTH GATE IS THE OWNER'S, UNCHANGED
 * ===========================================================================
 * 20-second probes, three consecutive successes, a five-minute window, ONE
 * automatic rollback (KLD-2026-08-06-WS11-T006-001 §6; owner ruling OD-U1-3 =
 * A). There is no development variant and no environment branch — the owner
 * ruled against one, and one code path is worth more than forty seconds.
 */
import { existsSync, readFileSync, statfsSync } from "node:fs";

import { extractTarGz, ArchiveRefusedError } from "./release-archive.js";
import { downloadAndVerify, type ArtifactSource } from "./release-artifact.js";
import {
  evaluateAssignment,
  withAcceptedSequence,
  type AssignmentSource,
} from "./release-assignment.js";
import {
  activate,
  beginStaging,
  commit,
  promoteStaged,
  pruneReleases,
  readJournal,
  recordRefusal,
  reconcile,
  rollback,
  writeJournal,
  type StorePaths,
} from "./release-store.js";
import {
  findReleaseAcceptanceRefusal,
  verifyReleaseManifestSignature,
  type ReleaseAcceptanceContext,
  type TrustedReleaseKey,
} from "./release-verify.js";
import { writeDurable } from "./durable-write.js";
import { join } from "node:path";

/** OWNER-LOCKED. Not configurable, and deliberately not environment-aware. */
export const HEALTH_PROBE_INTERVAL_MS = 20_000;
export const HEALTH_WINDOW_MS = 300_000;
export const HEALTH_REQUIRED_CONSECUTIVE = 3;

export interface HealthProbe {
  /** One observation. `healthy:false` carries why, for the journal. */
  probe(): Promise<{ readonly healthy: boolean; readonly detail: string }>;
}

export interface UnitControl {
  /** Restart the unit that runs the product. Throws on failure. */
  restart(): Promise<void>;
}

export interface InstallDependencies {
  readonly paths: StorePaths;
  readonly assignments: AssignmentSource;
  readonly artifacts: ArtifactSource;
  readonly trustedKeys: readonly TrustedReleaseKey[];
  /**
   * This device's OWN server record id, from `registration-state.json`. The
   * assignment signature binds it (group 0222); without it the device cannot
   * tell an assignment minted for itself from one minted for another board.
   */
  readonly deviceId: string;
  readonly acceptance: ReleaseAcceptanceContext;
  readonly unit: UnitControl;
  readonly health: HealthProbe;
  /** Injected so tests do not wait twenty seconds a probe. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  /** Free bytes on the store's filesystem. Injected for the disk-full test. */
  readonly availableBytes?: (path: string) => number;
}

export type InstallResult =
  | { readonly outcome: "INSTALLED"; readonly releaseId: string; readonly version: string }
  | { readonly outcome: "ROLLED_BACK"; readonly releaseId: string; readonly reason: string }
  | { readonly outcome: "NOTHING_TO_DO"; readonly detail: string }
  | { readonly outcome: "REFUSED"; readonly code: string; readonly detail: string };

function defaultAvailableBytes(path: string): number {
  const stat = statfsSync(path);
  return Number(stat.bavail) * Number(stat.bsize);
}

/**
 * One pass. Called on a poll; safe to call at any time, including immediately
 * after a power cut — `reconcile` runs first and every branch below resumes
 * from durable state rather than from anything held in this process.
 */
export async function runInstallPass(deps: InstallDependencies): Promise<InstallResult> {
  const { paths } = deps;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? (() => Date.now());
  const availableBytes = deps.availableBytes ?? defaultAvailableBytes;

  // ---- 0. Reconcile first, always. A HEALTH_PENDING left by a power cut is
  // ---- resumed here rather than being overwritten by a new assignment.
  const reconciled = reconcile(paths);
  if (reconciled.action === "RESUME_HEALTH_GATE") {
    const target = reconciled.journal.target;
    if (target !== null) {
      return runHealthGate(
        deps,
        target,
        reconciled.journal.committedVersion ?? "unknown",
        sleep,
        now,
      );
    }
  }

  // ---- 1. Assignment: the authority, before any byte.
  let assignment;
  try {
    assignment = await deps.assignments.fetchAssignment();
  } catch (error) {
    return {
      outcome: "REFUSED",
      code: "ASSIGNMENT_SOURCE_UNAVAILABLE",
      detail: String((error as Error).message ?? error),
    };
  }

  const verdict = evaluateAssignment(readJournal(paths), assignment, {
    deviceId: deps.deviceId,
    trustedKeys: deps.trustedKeys,
  });
  if (verdict.kind === "NOTHING_ASSIGNED") {
    return { outcome: "NOTHING_TO_DO", detail: "no release is assigned to this device" };
  }
  if (verdict.kind === "ALREADY_CURRENT") {
    return { outcome: "NOTHING_TO_DO", detail: `rel-${verdict.releaseId} is already running` };
  }
  if (verdict.kind === "REFUSED") {
    recordRefusal(paths, assignment?.releaseId ?? null, `${verdict.code}: ${verdict.detail}`);
    return { outcome: "REFUSED", code: verdict.code, detail: verdict.detail };
  }

  const { manifest, envelope, releaseId, assignmentSequence } = verdict.assignment;

  // ---- 2. Signature: the producer, before any byte.
  const verified = verifyReleaseManifestSignature(manifest, envelope, deps.trustedKeys);
  if (!verified.verified) {
    recordRefusal(paths, releaseId, verified.failure);
    return {
      outcome: "REFUSED",
      code: verified.failure,
      detail: "the release manifest signature did not verify",
    };
  }

  // ---- 3. Acceptance: is this release for THIS device, before any byte.
  const acceptanceRefusal = findReleaseAcceptanceRefusal(manifest, deps.acceptance);
  if (acceptanceRefusal !== null) {
    recordRefusal(paths, releaseId, acceptanceRefusal);
    return {
      outcome: "REFUSED",
      code: acceptanceRefusal,
      detail: "this release is not for this device",
    };
  }

  // The assignment is accepted from here on: record its generation so an older
  // one replayed later is refused even if the install below fails.
  writeJournal(paths, withAcceptedSequence(readJournal(paths), assignmentSequence));

  // ---- 4. Disk, before anything is staged. Two times the artifact: the
  // ---- compressed download plus its unpacked payload, as the Hub agent
  // ---- already requires.
  let free: number;
  try {
    free = availableBytes(paths.productRoot);
  } catch {
    free = Number.POSITIVE_INFINITY; // an unmeasurable filesystem is not a refusal
  }
  if (free < manifest.artifactSizeBytes * 2) {
    recordRefusal(paths, releaseId, "INSUFFICIENT_DISK");
    return {
      outcome: "REFUSED",
      code: "INSUFFICIENT_DISK",
      detail: `${String(free)} bytes free, ${String(manifest.artifactSizeBytes * 2)} required`,
    };
  }

  // ---- 5. Bytes, and the re-proof over what actually arrived.
  const artifact = await downloadAndVerify(deps.artifacts, manifest);
  if (!artifact.ok) {
    recordRefusal(paths, releaseId, `${artifact.refusal}: ${artifact.detail}`);
    return { outcome: "REFUSED", code: artifact.refusal, detail: artifact.detail };
  }

  // ---- 6. Safe extraction, beside the running release. A valid signature does
  // ---- not waive this (owner requirement 2).
  const incoming = beginStaging(paths, releaseId);
  try {
    extractTarGz(artifact.bytes, join(incoming, "payload"));
  } catch (error) {
    const refusal =
      error instanceof ArchiveRefusedError ? error.refusal : "ARCHIVE_EXTRACTION_FAILED";
    recordRefusal(paths, releaseId, `${refusal}: ${String((error as Error).message ?? error)}`);
    return { outcome: "REFUSED", code: refusal, detail: String((error as Error).message ?? error) };
  }

  // The manifest that admitted this release travels WITH it, so a later reader
  // can say what was verified without asking anything over a network.
  writeDurable(
    join(incoming, "manifest.json"),
    `${JSON.stringify({ manifest, envelope, verifiedBy: verified.keyId, keyVersion: verified.keyVersion }, null, 2)}\n`,
    0o644,
  );

  // ---- 7. Preflight, before the payload can become current.
  const preflight = preflightPayload(incoming);
  if (preflight !== null) {
    recordRefusal(paths, releaseId, preflight);
    return { outcome: "REFUSED", code: preflight, detail: "the unpacked payload is not runnable" };
  }

  // ---- 8. Promote and activate: durable intent, then the durable switch.
  promoteStaged(paths, releaseId);
  activate(paths, releaseId);

  // ---- 9. Restart, then the owner-locked gate.
  try {
    await deps.unit.restart();
  } catch (error) {
    const journal = rollback(
      paths,
      releaseId,
      `the unit would not restart: ${String((error as Error).message ?? error)}`,
    );
    return {
      outcome: "ROLLED_BACK",
      releaseId,
      reason: journal.lastResult?.reason ?? "restart failed",
    };
  }

  return runHealthGate(deps, releaseId, manifest.version, sleep, now);
}

/**
 * A payload that cannot possibly run must not become `current`.
 *
 * Deliberately cheap and structural — does the entry point the package names
 * actually exist? The real proof is the health gate after the restart; this
 * only catches the case where the answer is knowable without disturbing
 * anything that is currently serving.
 */
function preflightPayload(incoming: string): string | null {
  const packageJson = join(incoming, "payload", "package.json");
  if (!existsSync(packageJson)) return "PAYLOAD_NO_PACKAGE_JSON";
  try {
    const parsed = JSON.parse(readFileSync(packageJson, "utf8")) as { main?: unknown };
    if (typeof parsed.main !== "string" || parsed.main === "") return "PAYLOAD_NO_MAIN";
    if (!existsSync(join(incoming, "payload", parsed.main))) return "PAYLOAD_MAIN_MISSING";
  } catch {
    return "PAYLOAD_PACKAGE_JSON_UNPARSEABLE";
  }
  return null;
}

/**
 * The gate. Three consecutive healthy probes inside the window promote; the
 * window expiring takes the ONE automatic rollback and lands terminal.
 */
async function runHealthGate(
  deps: InstallDependencies,
  releaseId: string,
  version: string,
  sleep: (ms: number) => Promise<void>,
  now: () => number,
): Promise<InstallResult> {
  const started = now();
  let consecutive = 0;
  let reason = "the health window expired before three consecutive successes";

  while (now() - started < HEALTH_WINDOW_MS) {
    const observation = await deps.health.probe();
    if (observation.healthy) {
      consecutive += 1;
      if (consecutive >= HEALTH_REQUIRED_CONSECUTIVE) {
        commit(deps.paths, releaseId, version);
        pruneReleases(deps.paths);
        return { outcome: "INSTALLED", releaseId, version };
      }
    } else {
      consecutive = 0;
      reason = observation.detail;
    }
    await sleep(HEALTH_PROBE_INTERVAL_MS);
  }

  rollback(deps.paths, releaseId, reason);
  try {
    await deps.unit.restart();
  } catch {
    // The rollback already re-pointed `current`; a failed restart here means the
    // previous release starts on the next boot instead of immediately. The
    // journal records the rollback either way, and the launcher still resolves
    // a valid shell.
  }
  return { outcome: "ROLLED_BACK", releaseId, reason };
}
