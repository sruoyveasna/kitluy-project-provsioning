/**
 * The on-device release store: layout, durable journal, activation and
 * crash reconciliation (U1, owner ruling OD-U1-1 = A).
 *
 * ===========================================================================
 * WHERE THIS LIVES AND WHY IT IS NOT UNDER /var
 * ===========================================================================
 * The store is SLOT-SHARED, under `/persistent/shared/...`, declared through
 * `/etc/rpi-image-gen/slot-shared.d`. It must not live under `/var`, which the
 * A/B layout bind-mounts per slot from `/persistent/slots/system_{a,b}/var`:
 * a release store under `/var` would silently vanish the first time a system
 * slot switched, taking every installed application with it.
 *
 * That is the same reasoning `60-kitluy-ssh.conf` and `61-kitluy-wifi.conf`
 * already record for host keys and the shop's Wi-Fi, and it is why this module
 * hard-codes a `/persistent/shared` path rather than a `/var` one.
 *
 * ===========================================================================
 * THE IMAGE COPY IS THE FLOOR, AND NOTHING HERE CAN REMOVE IT
 * ===========================================================================
 * The launcher prefers the store and falls back to the Device Shell baked into
 * the read-only image. This module never writes to `/usr` and has no path that
 * could. So the worst outcome any bug here can produce is "the board runs the
 * shell it was flashed with" — visible (see `release-status.ts`), never silent,
 * and never a blank screen.
 *
 * ===========================================================================
 * THE JOURNAL IS THE ONLY SOURCE OF TRUTH ACROSS A POWER CUT
 * ===========================================================================
 * Every externally visible step is preceded by a durable journal write, so that
 * a device which loses power mid-install can decide what happened from the
 * journal alone rather than by inspecting a filesystem it cannot fully trust.
 * `reconcile()` is the only reader of that decision, and it has exactly one
 * defined outcome per state — see the table in its own comment.
 */
import { mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync } from "node:fs";
import { join } from "node:path";

import {
  fsyncDir,
  fsyncTree,
  isDirectory,
  isFile,
  renameDurable,
  swapSymlinkDurable,
  writeDurable,
} from "./durable-write.js";

/** The slot-shared root. Never `/var` — see the header. */
export const RELEASE_STORE_ROOT = "/persistent/shared/kitluy/releases";

/**
 * The ONE product U1 may install (owner ruling OD-U1-2 = C).
 *
 * The ruling classifies the graphical Device Shell payload as a governed
 * updatable application FOR U1 ONLY, and says in terms that it must not be used
 * to reclassify `terminal-edge`, firstboot identity, cloud registration, the
 * update agent or any other bootstrap/runtime component. This constant is that
 * fence in code: `assertProductPermitted` refuses every other product key, and a
 * test asserts the bootstrap set is refused by name.
 */
export const U1_PERMITTED_PRODUCT = "device-shell";

export class ProductNotPermittedError extends Error {
  constructor(readonly product: string) {
    super(
      `PRODUCT_NOT_PERMITTED: ${product} is not updatable in U1. Owner ruling OD-U1-2 = C classifies the Device Shell payload alone; the broader bootstrap/runtime boundary returns to the owner at U3.`,
    );
    this.name = "ProductNotPermittedError";
  }
}

export function assertProductPermitted(product: string): void {
  if (product !== U1_PERMITTED_PRODUCT) throw new ProductNotPermittedError(product);
}

export type InstallPhase =
  "IDLE" | "ACTIVATING" | "HEALTH_PENDING" | "COMMITTED" | "ROLLED_BACK" | "FAILED";

export interface InstallOutcome {
  readonly outcome: "INSTALLED" | "ROLLED_BACK" | "REFUSED" | "INTERRUPTED";
  readonly releaseId: string | null;
  readonly version: string | null;
  /** A refusal code, or a short sentence. Never a secret, never a stack trace. */
  readonly reason: string | null;
  readonly at: string;
}

export interface ReleaseJournal {
  readonly journalVersion: 1;
  readonly product: string;
  readonly phase: InstallPhase;
  /** The release being activated, while `phase` is ACTIVATING or HEALTH_PENDING. */
  readonly target: string | null;
  /** What to return to if the target fails. */
  readonly previous: string | null;
  /** The last release that passed its health gate. */
  readonly committed: string | null;
  readonly committedVersion: string | null;
  /**
   * Replay protection (U1 requirement 1). The highest
   * `kitluy_releases.device_installations.assignment_sequence` (cloud group
   * 0221) this device has ACCEPTED. A lower one is a replay and is refused.
   */
  readonly lastAssignmentSequence: number | null;
  /**
   * Releases this device has installed and moved past. A second, independent
   * line against replay that survives a stack restored from a backup — see
   * `release-assignment.ts` for why both checks exist.
   */
  readonly supersededReleaseIds: readonly string[];
  /**
   * Releases whose health gate failed and which were rolled back. Matching the
   * owner-locked rule in the Hub release agent, automatic retry of the SAME
   * release is blocked; an operator action or a newer assignment is required.
   */
  readonly failedRolledBackReleaseIds: readonly string[];
  readonly lastResult: InstallOutcome | null;
  readonly updatedAt: string;
}

export interface StorePaths {
  readonly product: string;
  readonly productRoot: string;
  readonly current: string;
  readonly previous: string;
  readonly journal: string;
}

export function storePaths(product: string, root: string = RELEASE_STORE_ROOT): StorePaths {
  assertProductPermitted(product);
  const productRoot = join(root, product);
  return {
    product,
    productRoot,
    current: join(productRoot, "current"),
    previous: join(productRoot, "previous"),
    journal: join(productRoot, "journal.json"),
  };
}

/** `rel-<releaseId>` — the unpacked release directory. */
export function releaseDir(paths: StorePaths, releaseId: string): string {
  return join(paths.productRoot, `rel-${releaseId}`);
}

/**
 * `rel-<releaseId>.incoming` — a SIBLING, so promotion is a rename within one
 * directory and therefore atomic. An interrupted unpack leaves a directory the
 * launcher can never select (it looks only at `current/payload/package.json`)
 * and that `reconcile` removes on sight.
 */
export function incomingDir(paths: StorePaths, releaseId: string): string {
  return `${releaseDir(paths, releaseId)}.incoming`;
}

export function emptyJournal(product: string): ReleaseJournal {
  return {
    journalVersion: 1,
    product,
    phase: "IDLE",
    target: null,
    previous: null,
    committed: null,
    committedVersion: null,
    lastAssignmentSequence: null,
    supersededReleaseIds: [],
    failedRolledBackReleaseIds: [],
    lastResult: null,
    updatedAt: new Date(0).toISOString(),
  };
}

/**
 * Read the journal. An absent, unreadable or unparseable journal reads as the
 * empty journal rather than throwing: the device must still boot, still run the
 * image copy, and still be able to start over.
 */
export function readJournal(paths: StorePaths): ReleaseJournal {
  try {
    const parsed = JSON.parse(readFileSync(paths.journal, "utf8")) as Partial<ReleaseJournal>;
    if (parsed.journalVersion !== 1 || parsed.product !== paths.product) {
      return emptyJournal(paths.product);
    }
    const base = emptyJournal(paths.product);
    return {
      ...base,
      ...parsed,
      journalVersion: 1,
      product: paths.product,
      supersededReleaseIds: parsed.supersededReleaseIds ?? [],
      failedRolledBackReleaseIds: parsed.failedRolledBackReleaseIds ?? [],
    };
  } catch {
    return emptyJournal(paths.product);
  }
}

/** Durable journal write: the intent is on the platter before the act. */
export function writeJournal(paths: StorePaths, journal: ReleaseJournal): ReleaseJournal {
  const next: ReleaseJournal = { ...journal, updatedAt: new Date().toISOString() };
  mkdirSync(paths.productRoot, { recursive: true, mode: 0o755 });
  writeDurable(paths.journal, `${JSON.stringify(next, null, 2)}\n`, 0o644);
  return next;
}

/** The release id a symlink points at, or null when absent or dangling. */
export function resolveLink(linkPath: string): string | null {
  try {
    const target = readlinkSync(linkPath);
    const base = target.split("/").pop() ?? "";
    return base.startsWith("rel-") ? base.slice("rel-".length) : null;
  } catch {
    return null;
  }
}

/**
 * A release directory is USABLE only when its payload carries a package.json.
 *
 * The launcher applies exactly this test (`-f …/payload/package.json`) before
 * preferring the store, so the two agree by construction. A half-unpacked
 * directory fails it, which is the point.
 */
export function isUsableRelease(paths: StorePaths, releaseId: string | null): boolean {
  if (releaseId === null) return false;
  return isFile(join(releaseDir(paths, releaseId), "payload", "package.json"));
}

export function ensureStore(paths: StorePaths): void {
  mkdirSync(paths.productRoot, { recursive: true, mode: 0o755 });
  fsyncDir(paths.productRoot);
}

/** Stage: a fresh, empty `.incoming` directory for the extractor to fill. */
export function beginStaging(paths: StorePaths, releaseId: string): string {
  ensureStore(paths);
  const incoming = incomingDir(paths, releaseId);
  rmSync(incoming, { recursive: true, force: true });
  mkdirSync(join(incoming, "payload"), { recursive: true, mode: 0o755 });
  return incoming;
}

/**
 * Promote `.incoming` to its final name — step 2 and 3 of the activation
 * sequence. `fsyncTree` first, so the directory entry can never become durable
 * ahead of the file contents it names: that combination is how a power cut
 * produces a release that exists, passes a name check, and is empty.
 */
export function promoteStaged(paths: StorePaths, releaseId: string): void {
  const incoming = incomingDir(paths, releaseId);
  const final = releaseDir(paths, releaseId);
  fsyncTree(incoming);
  rmSync(final, { recursive: true, force: true });
  renameDurable(incoming, final);
}

/**
 * Activate a staged release — steps 4 to 7 of the sequence.
 *
 *   4. journal ACTIVATING (target, previous)   <- durable intent
 *   5. symlink current.tmp -> rel-<id>          ; fsync dir
 *   6. rename current.tmp -> current            ; fsync dir   <- durable switch
 *   7. journal HEALTH_PENDING
 *
 * The caller restarts the unit and runs the health gate after this returns.
 */
export function activate(paths: StorePaths, releaseId: string): ReleaseJournal {
  const before = readJournal(paths);
  const previous = resolveLink(paths.current) ?? before.committed;
  writeJournal(paths, { ...before, phase: "ACTIVATING", target: releaseId, previous });

  if (previous !== null && previous !== releaseId && isUsableRelease(paths, previous)) {
    swapSymlinkDurable(paths.previous, `rel-${previous}`);
  }
  swapSymlinkDurable(paths.current, `rel-${releaseId}`);

  return writeJournal(paths, {
    ...before,
    phase: "HEALTH_PENDING",
    target: releaseId,
    previous,
  });
}

/** The health gate passed: the target becomes committed. */
export function commit(paths: StorePaths, releaseId: string, version: string): ReleaseJournal {
  const before = readJournal(paths);
  const superseded =
    before.committed !== null && before.committed !== releaseId
      ? [...new Set([...before.supersededReleaseIds, before.committed])]
      : before.supersededReleaseIds;
  return writeJournal(paths, {
    ...before,
    phase: "COMMITTED",
    target: null,
    committed: releaseId,
    committedVersion: version,
    supersededReleaseIds: superseded,
    lastResult: {
      outcome: "INSTALLED",
      releaseId,
      version,
      reason: null,
      at: new Date().toISOString(),
    },
  });
}

/**
 * The health gate failed: return to `previous`.
 *
 * This is RECOVERY, not an install (U1 requirement 2). It fetches nothing,
 * queries no assignment source and makes no version choice — it re-points the
 * symlink at a release already on disk, which was signature- and digest-verified
 * when it was installed. The failed release is recorded so automatic retry of
 * the SAME release is refused afterwards.
 *
 * When there is no usable previous release, `current` is REMOVED rather than
 * left pointing at something broken: the launcher then falls back to the image
 * copy, which is a working screen.
 */
export function rollback(
  paths: StorePaths,
  failedReleaseId: string,
  reason: string,
): ReleaseJournal {
  const before = readJournal(paths);
  const previous = before.previous;
  const restored = isUsableRelease(paths, previous) ? previous : null;

  if (restored !== null) swapSymlinkDurable(paths.current, `rel-${restored}`);
  else {
    rmSync(paths.current, { force: true });
    fsyncDir(paths.productRoot);
  }

  return writeJournal(paths, {
    ...before,
    phase: "ROLLED_BACK",
    target: null,
    committed: restored,
    committedVersion: restored === null ? null : before.committedVersion,
    failedRolledBackReleaseIds: [
      ...new Set([...before.failedRolledBackReleaseIds, failedReleaseId]),
    ],
    lastResult: {
      outcome: "ROLLED_BACK",
      releaseId: failedReleaseId,
      version: null,
      reason,
      at: new Date().toISOString(),
    },
  });
}

/** Record a refusal without touching anything that is running. */
export function recordRefusal(
  paths: StorePaths,
  releaseId: string | null,
  reason: string,
): ReleaseJournal {
  const before = readJournal(paths);
  return writeJournal(paths, {
    ...before,
    lastResult: {
      outcome: "REFUSED",
      releaseId,
      version: null,
      reason,
      at: new Date().toISOString(),
    },
  });
}

export interface ReconcileResult {
  readonly action:
    | "NOTHING_TO_DO"
    | "DISCARDED_INTERRUPTED_ACTIVATION"
    | "ADOPTED_SWITCHED_RELEASE"
    | "RESUME_HEALTH_GATE"
    | "RESTORED_PREVIOUS"
    | "FELL_BACK_TO_IMAGE";
  readonly journal: ReleaseJournal;
  readonly detail: string;
}

/**
 * Reconcile the journal against the filesystem. The FIRST thing the update
 * runtime does on every start, including after a power cut.
 *
 * One defined outcome per state, and the invariant that acceptance test C
 * exists to prove: at every instant, the board resolves a valid Device Shell —
 * the target, the previous one, or the image's own. There is no interleaving
 * that yields a blank screen.
 *
 *   phase          filesystem                  -> action
 *   IDLE/COMMITTED current usable              -> nothing
 *   ACTIVATING     current still on previous   -> discard; keep previous
 *   ACTIVATING     current on target           -> adopt; run the gate
 *   HEALTH_PENDING current on target           -> re-run the gate from zero
 *   any            current dangling/unusable   -> restore previous, else fall
 *                                                 back to the image copy
 */
export function reconcile(paths: StorePaths): ReconcileResult {
  const journal = readJournal(paths);

  // Interrupted unpacks can only be garbage: a successful staging renames the
  // directory away, so anything still named `.incoming` lost its race.
  try {
    for (const entry of readdirSync(paths.productRoot)) {
      if (entry.endsWith(".incoming")) {
        rmSync(join(paths.productRoot, entry), { recursive: true, force: true });
      }
    }
  } catch {
    // No store yet. Nothing staged, nothing to clean.
  }

  const current = resolveLink(paths.current);
  const currentUsable = isUsableRelease(paths, current);

  if (!currentUsable && current !== null) {
    const previous = journal.previous ?? journal.committed;
    if (isUsableRelease(paths, previous) && previous !== null) {
      swapSymlinkDurable(paths.current, `rel-${previous}`);
      return {
        action: "RESTORED_PREVIOUS",
        journal: writeJournal(paths, {
          ...journal,
          phase: "ROLLED_BACK",
          target: null,
          committed: previous,
          lastResult: {
            outcome: "INTERRUPTED",
            releaseId: journal.target,
            version: null,
            reason:
              "the active release was unusable after a restart; the previous one was restored",
            at: new Date().toISOString(),
          },
        }),
        detail: `restored rel-${previous}`,
      };
    }
    rmSync(paths.current, { force: true });
    fsyncDir(paths.productRoot);
    return {
      action: "FELL_BACK_TO_IMAGE",
      journal: writeJournal(paths, {
        ...journal,
        phase: "FAILED",
        target: null,
        committed: null,
        lastResult: {
          outcome: "INTERRUPTED",
          releaseId: journal.target,
          version: null,
          reason: "no usable release remained; the image-baked Device Shell is running",
          at: new Date().toISOString(),
        },
      }),
      detail: "current removed; the launcher falls back to the image copy",
    };
  }

  if (journal.phase === "ACTIVATING") {
    if (current === journal.target && currentUsable) {
      return {
        action: "ADOPTED_SWITCHED_RELEASE",
        journal: writeJournal(paths, { ...journal, phase: "HEALTH_PENDING" }),
        detail: `the switch to rel-${String(journal.target)} landed; the gate had not started`,
      };
    }
    return {
      action: "DISCARDED_INTERRUPTED_ACTIVATION",
      journal: writeJournal(paths, {
        ...journal,
        phase: "IDLE",
        target: null,
        lastResult: {
          outcome: "INTERRUPTED",
          releaseId: journal.target,
          version: null,
          reason: "power was lost before the release was switched in; nothing changed",
          at: new Date().toISOString(),
        },
      }),
      detail: "the running release was never replaced",
    };
  }

  if (journal.phase === "HEALTH_PENDING") {
    return {
      action: "RESUME_HEALTH_GATE",
      journal,
      detail: `the gate for rel-${String(journal.target)} did not finish; it re-runs from zero`,
    };
  }

  return {
    action: "NOTHING_TO_DO",
    journal,
    detail: current === null ? "image copy" : `rel-${current}`,
  };
}

/** Directory of the release the store would run, or null for the image copy. */
export function activeReleaseId(paths: StorePaths): string | null {
  const current = resolveLink(paths.current);
  return isUsableRelease(paths, current) ? current : null;
}

/** Housekeeping: keep `current`, `previous`, and drop the rest. */
export function pruneReleases(paths: StorePaths): readonly string[] {
  const keep = new Set(
    [resolveLink(paths.current), resolveLink(paths.previous)].filter(
      (id): id is string => id !== null,
    ),
  );
  const removed: string[] = [];
  try {
    for (const entry of readdirSync(paths.productRoot)) {
      if (!entry.startsWith("rel-")) continue;
      const id = entry.slice("rel-".length);
      if (keep.has(id)) continue;
      if (!isDirectory(join(paths.productRoot, entry))) continue;
      rmSync(join(paths.productRoot, entry), { recursive: true, force: true });
      removed.push(id);
    }
    if (removed.length > 0) fsyncDir(paths.productRoot);
  } catch {
    // Nothing to prune.
  }
  return removed;
}
