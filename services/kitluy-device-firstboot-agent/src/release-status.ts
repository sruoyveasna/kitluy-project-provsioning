/**
 * What is actually running, and why (U1 requirement 4).
 *
 * ===========================================================================
 * THE FALLBACK MUST NEVER LOOK LIKE THE ASSIGNED RELEASE
 * ===========================================================================
 * The launcher prefers the release store and falls back to the Device Shell
 * baked into the image. That fallback is what makes a bad release survivable —
 * but it is also the most dangerous state to report badly, because the board
 * comes up, the screen looks right, and the version on it is NOT the one that
 * was published. Somebody then spends an afternoon wondering why their change
 * "did not do anything".
 *
 * So the owner required that the fallback be visible, and that the image copy is
 * never presented as though the assigned release were running.
 *
 * ===========================================================================
 * THE LAUNCHER IS THE ONLY HONEST WITNESS
 * ===========================================================================
 * This module does NOT infer the running source from the store. The store can
 * say what it believes; only the launcher knows what it actually `exec`d, and
 * the two can disagree — a release installed after the shell started, a store
 * mounted late, a payload removed underneath a running process.
 *
 * So `/usr/lib/kitluy/device-shell` writes `running-source.json` immediately
 * before `exec`, and this module reads it. Where they disagree, the disagreement
 * itself is reported (`STALE`) rather than resolved, because "the shell needs a
 * restart to pick up what is installed" is a real state and a useful one.
 *
 * It lives under `/var/lib/kitluy/terminal/` — the directory the Device Shell's
 * user already owns, beside `edge-status.json`, and readable by the shell that
 * renders it. Per-slot, which is right: it describes THIS boot.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  activeReleaseId,
  readJournal,
  releaseDir,
  type ReleaseJournal,
  type StorePaths,
} from "./release-store.js";
import { isFile } from "./durable-write.js";

export const RUNNING_SOURCE_PATH = "/var/lib/kitluy/terminal/running-source.json";

/** Written by the launcher, immediately before it execs. */
export interface RunningSourceRecord {
  /** RELEASE when the store was used; IMAGE_FALLBACK when the image copy was. */
  readonly source: "RELEASE" | "IMAGE_FALLBACK";
  /** The directory actually handed to Electron. */
  readonly app: string;
  readonly at: string;
}

export type RunningSource = "RELEASE" | "IMAGE_FALLBACK" | "UNKNOWN";

export interface ReleaseStatus {
  /** What the launcher actually started. UNKNOWN when it has not written yet. */
  readonly runningSource: RunningSource;
  /** The release the running process was started from, when it is a release. */
  readonly runningReleaseId: string | null;
  readonly runningVersion: string | null;
  /** What the store would hand a launcher started right now. */
  readonly installedReleaseId: string | null;
  readonly installedVersion: string | null;
  /** True when a restart would change what is running. */
  readonly stale: boolean;
  readonly lastUpdate: ReleaseJournal["lastResult"];
  /** Why the image copy is running, when it is. Null otherwise. */
  readonly fallbackReason: string | null;
  readonly phase: ReleaseJournal["phase"];
}

function readRunningSource(path: string): RunningSourceRecord | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<RunningSourceRecord>;
    if (parsed.source !== "RELEASE" && parsed.source !== "IMAGE_FALLBACK") return null;
    if (typeof parsed.app !== "string") return null;
    return { source: parsed.source, app: parsed.app, at: String(parsed.at ?? "") };
  } catch {
    return null;
  }
}

/** The version recorded in the release's own verified manifest, if readable. */
function versionOf(paths: StorePaths, releaseId: string | null): string | null {
  if (releaseId === null) return null;
  const manifestPath = join(releaseDir(paths, releaseId), "manifest.json");
  if (!isFile(manifestPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      manifest?: { version?: unknown };
    };
    return typeof parsed.manifest?.version === "string" ? parsed.manifest.version : null;
  } catch {
    return null;
  }
}

/**
 * Compose the one answer a person needs, from the launcher's witness and the
 * store's journal. Never throws — a status call that fails is a status call
 * nobody can use at the moment they most need it.
 */
export function describeReleaseStatus(
  paths: StorePaths,
  options: { readonly runningSourcePath?: string } = {},
): ReleaseStatus {
  const journal = readJournal(paths);
  const installedReleaseId = activeReleaseId(paths);
  const witness = readRunningSource(options.runningSourcePath ?? RUNNING_SOURCE_PATH);

  const runningSource: RunningSource = witness === null ? "UNKNOWN" : witness.source;

  // The release the RUNNING process came from, read back out of the path the
  // launcher recorded — not assumed to be whatever `current` points at now.
  let runningReleaseId: string | null = null;
  if (witness?.source === "RELEASE") {
    const match = /\/rel-([^/]+)\//u.exec(`${witness.app}/`);
    runningReleaseId = match?.[1] ?? installedReleaseId;
  }

  const stale =
    witness !== null &&
    ((witness.source === "IMAGE_FALLBACK" && installedReleaseId !== null) ||
      (witness.source === "RELEASE" && runningReleaseId !== installedReleaseId));

  let fallbackReason: string | null = null;
  if (runningSource === "IMAGE_FALLBACK") {
    if (installedReleaseId !== null) {
      fallbackReason =
        "a release is installed but the shell started before it; a restart picks it up";
    } else if (journal.lastResult?.outcome === "ROLLED_BACK") {
      fallbackReason = journal.lastResult.reason ?? "the last release was rolled back";
    } else if (journal.lastResult?.outcome === "INTERRUPTED") {
      fallbackReason = journal.lastResult.reason ?? "an install was interrupted";
    } else if (journal.lastResult?.outcome === "REFUSED") {
      fallbackReason = `the last release was refused: ${journal.lastResult.reason ?? "no reason recorded"}`;
    } else {
      fallbackReason = "no release has been installed on this device yet";
    }
  }

  return {
    runningSource,
    runningReleaseId,
    runningVersion: versionOf(paths, runningReleaseId),
    installedReleaseId,
    installedVersion: versionOf(paths, installedReleaseId) ?? journal.committedVersion,
    stale,
    lastUpdate: journal.lastResult,
    fallbackReason,
    phase: journal.phase,
  };
}

/**
 * One line for the journal, so `journalctl -u kitluy-update-agent` answers the
 * question without anybody reading JSON. Deliberately short and greppable.
 */
export function formatReleaseStatusLine(status: ReleaseStatus): string {
  const running =
    status.runningSource === "RELEASE"
      ? `RELEASE ${status.runningVersion ?? status.runningReleaseId ?? "unknown"}`
      : status.runningSource === "IMAGE_FALLBACK"
        ? "IMAGE FALLBACK"
        : "UNKNOWN";
  const parts = [
    `running=${running}`,
    `installed=${status.installedVersion ?? status.installedReleaseId ?? "none"}`,
    `phase=${status.phase}`,
  ];
  if (status.stale) parts.push("stale=yes(restart to apply)");
  if (status.fallbackReason !== null) parts.push(`why=${JSON.stringify(status.fallbackReason)}`);
  if (status.lastUpdate !== null) {
    parts.push(`last=${status.lastUpdate.outcome}`);
    if (status.lastUpdate.reason !== null) {
      parts.push(`reason=${JSON.stringify(status.lastUpdate.reason)}`);
    }
  }
  return parts.join(" ");
}
