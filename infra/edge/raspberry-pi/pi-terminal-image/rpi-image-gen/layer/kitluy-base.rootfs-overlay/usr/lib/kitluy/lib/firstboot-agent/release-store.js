/**
 * The on-device release store: layout, durable journal, activation and
 * crash reconciliation (U1, owner ruling OD-U1-1 = A).
 *
 * ===========================================================================
 * WHERE THIS LIVES AND WHY IT IS NOT UNDER /var
 * ===========================================================================
 * The store is SLOT-SHARED, under `/persistent/shared/...` — directly on the
 * persistent partition, which is shared across A/B slots by construction (it is
 * NOT declared in `/etc/rpi-image-gen/slot-shared.d`; see the `releaseStore`
 * note in the image's runtime-manifest.json). It must not live under `/var`, which the
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
 * The POS (`kitluy-terminal`) has NO image copy — a business application is
 * never image content — so for that product "fall back to the image" means "no
 * POS": its launcher refuses to start, `kitluy-terminal-client.service` fails,
 * and its `OnFailure=` hands the display back to the image's Device Shell. The
 * floor is the same working screen, reached one unit over.
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
import { fsyncDir, fsyncTree, isDirectory, isFile, renameDurable, swapSymlinkDurable, writeDurable, } from "./durable-write.js";
/** The slot-shared root. Never `/var` — see the header. */
export const RELEASE_STORE_ROOT = "/persistent/shared/kitluy/releases";
/**
 * The Device Shell payload — the product U1 made updatable (owner ruling
 * OD-U1-2 = C).
 */
export const U1_PERMITTED_PRODUCT = "device-shell";
/**
 * The KitLuy POS business application for a Pi Terminal.
 *
 * `kitluy-terminal` is not a new name: it is the product key cloud group 0180
 * seeded release channels for ("the two Phase 1 products"). The image calls the
 * same thing component `terminal-client` and unit
 * `kitluy-terminal-client.service`; the release key is the governed one.
 *
 * Authority: KLD-2026-08-11-DEVICE-BOOTSTRAP-RUNTIME-001 (LOCKED) — full POS
 * business applications ARE governed release artifacts, never image content;
 * owner mission T1-STORE-OPERATIONS-001 (2026-09-17) §10 opens the second
 * product (the plan's "U2") for this application alone.
 */
export const TERMINAL_CLIENT_PRODUCT = "kitluy-terminal";
/**
 * EVERY product the release store may hold, and nothing else.
 *
 * Both entries are APPLICATIONS. OD-U1-2 says in terms that the release store
 * must not be used to reclassify `terminal-edge`, firstboot identity, cloud
 * registration, the update agent or any other bootstrap/runtime component, and
 * adding the POS does not touch that sentence: the POS was never bootstrap. This
 * list is that fence in code — `assertProductPermitted` refuses every other key,
 * and a test still refuses the bootstrap set by name.
 */
export const PERMITTED_PRODUCTS = [
    U1_PERMITTED_PRODUCT,
    TERMINAL_CLIENT_PRODUCT,
];
export function isPermittedProduct(product) {
    return PERMITTED_PRODUCTS.includes(product);
}
export class ProductNotPermittedError extends Error {
    product;
    constructor(product) {
        super(`PRODUCT_NOT_PERMITTED: ${product} is not an updatable product. The release store holds the Device Shell payload (OD-U1-2 = C) and the POS application ${TERMINAL_CLIENT_PRODUCT} (KLD-2026-08-11-DEVICE-BOOTSTRAP-RUNTIME-001); the bootstrap/runtime set stays image-only until the owner rules otherwise.`);
        this.product = product;
        this.name = "ProductNotPermittedError";
    }
}
export function assertProductPermitted(product) {
    if (!isPermittedProduct(product))
        throw new ProductNotPermittedError(product);
}
export function storePaths(product, root = RELEASE_STORE_ROOT) {
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
export function releaseDir(paths, releaseId) {
    return join(paths.productRoot, `rel-${releaseId}`);
}
/**
 * `rel-<releaseId>.incoming` — a SIBLING, so promotion is a rename within one
 * directory and therefore atomic. An interrupted unpack leaves a directory the
 * launcher can never select (it looks only at `current/payload/package.json`)
 * and that `reconcile` removes on sight.
 */
export function incomingDir(paths, releaseId) {
    return `${releaseDir(paths, releaseId)}.incoming`;
}
export function emptyJournal(product) {
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
export function readJournal(paths) {
    try {
        const parsed = JSON.parse(readFileSync(paths.journal, "utf8"));
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
    }
    catch {
        return emptyJournal(paths.product);
    }
}
/** Durable journal write: the intent is on the platter before the act. */
export function writeJournal(paths, journal) {
    const next = { ...journal, updatedAt: new Date().toISOString() };
    mkdirSync(paths.productRoot, { recursive: true, mode: 0o755 });
    writeDurable(paths.journal, `${JSON.stringify(next, null, 2)}\n`, 0o644);
    return next;
}
/** The release id a symlink points at, or null when absent or dangling. */
export function resolveLink(linkPath) {
    try {
        const target = readlinkSync(linkPath);
        const base = target.split("/").pop() ?? "";
        return base.startsWith("rel-") ? base.slice("rel-".length) : null;
    }
    catch {
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
export function isUsableRelease(paths, releaseId) {
    if (releaseId === null)
        return false;
    return isFile(join(releaseDir(paths, releaseId), "payload", "package.json"));
}
export function ensureStore(paths) {
    mkdirSync(paths.productRoot, { recursive: true, mode: 0o755 });
    fsyncDir(paths.productRoot);
}
/** Stage: a fresh, empty `.incoming` directory for the extractor to fill. */
export function beginStaging(paths, releaseId) {
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
export function promoteStaged(paths, releaseId) {
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
export function activate(paths, releaseId) {
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
export function commit(paths, releaseId, version) {
    const before = readJournal(paths);
    const superseded = before.committed !== null && before.committed !== releaseId
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
export function rollback(paths, failedReleaseId, reason) {
    const before = readJournal(paths);
    const previous = before.previous;
    const restored = isUsableRelease(paths, previous) ? previous : null;
    if (restored !== null)
        swapSymlinkDurable(paths.current, `rel-${restored}`);
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
export function recordRefusal(paths, releaseId, reason) {
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
export function reconcile(paths) {
    const journal = readJournal(paths);
    // Interrupted unpacks can only be garbage: a successful staging renames the
    // directory away, so anything still named `.incoming` lost its race.
    try {
        for (const entry of readdirSync(paths.productRoot)) {
            if (entry.endsWith(".incoming")) {
                rmSync(join(paths.productRoot, entry), { recursive: true, force: true });
            }
        }
    }
    catch {
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
                        reason: "the active release was unusable after a restart; the previous one was restored",
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
export function activeReleaseId(paths) {
    const current = resolveLink(paths.current);
    return isUsableRelease(paths, current) ? current : null;
}
/** Housekeeping: keep `current`, `previous`, and drop the rest. */
export function pruneReleases(paths) {
    const keep = new Set([resolveLink(paths.current), resolveLink(paths.previous)].filter((id) => id !== null));
    const removed = [];
    try {
        for (const entry of readdirSync(paths.productRoot)) {
            if (!entry.startsWith("rel-"))
                continue;
            const id = entry.slice("rel-".length);
            if (keep.has(id))
                continue;
            if (!isDirectory(join(paths.productRoot, entry)))
                continue;
            rmSync(join(paths.productRoot, entry), { recursive: true, force: true });
            removed.push(id);
        }
        if (removed.length > 0)
            fsyncDir(paths.productRoot);
    }
    catch {
        // Nothing to prune.
    }
    return removed;
}
//# sourceMappingURL=release-store.js.map