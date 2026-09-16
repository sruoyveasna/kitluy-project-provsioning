/**
 * Pushes a fresh `ShellSnapshot` to a callback whenever the device's state
 * changes: a 2-second poll (network link/route change without a file write) plus
 * an `fs.watch` on the state directory (the agent writes files atomically via
 * rename, which `fs.watch` reports). Identical consecutive snapshots are
 * suppressed so the renderer only re-renders on a real change.
 */
import { watch } from "node:fs";
import { DEFAULT_ROOTS, readSnapshot } from "./device-state-files.js";
const POLL_MS = 2000;
export function startSnapshotFeed(onSnapshot, roots = DEFAULT_ROOTS) {
    let last = "";
    const emit = () => {
        const snapshot = readSnapshot(roots);
        const serialized = JSON.stringify(snapshot);
        if (serialized === last)
            return;
        last = serialized;
        onSnapshot(snapshot);
    };
    emit();
    const timer = setInterval(emit, POLL_MS);
    let watcher = null;
    try {
        watcher = watch(roots.stateDir, { persistent: false }, () => emit());
    }
    catch {
        // The directory may not exist yet on a fresh boot; the poll still covers it.
    }
    return () => {
        clearInterval(timer);
        watcher?.close();
    };
}
//# sourceMappingURL=snapshot.js.map