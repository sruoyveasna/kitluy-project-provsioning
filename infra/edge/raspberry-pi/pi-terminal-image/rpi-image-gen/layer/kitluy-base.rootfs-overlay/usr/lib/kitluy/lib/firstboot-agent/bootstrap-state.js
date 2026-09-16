/**
 * The device bootstrap state model (owner continuation §12).
 *
 * ===========================================================================
 * THIS IS RUNTIME STATE, NOT DATABASE TRUTH
 * ===========================================================================
 * These names describe what the DEVICE currently knows about itself so the
 * bootstrap surface can say something truthful. They are deliberately NOT a
 * database enum: `ENROLLED_UNASSIGNED` is useful UI wording and a terrible
 * column, because the database already models it as `enrolled` WITHOUT an
 * active assignment. Adding it as stored truth would put the device and the
 * fleet into permanent disagreement — the same reasoning `enrollment.ts`
 * records for `DeviceLifecycleState`.
 *
 * The canonical lifecycle states live in `enrollment.ts` and mirror
 * `kitluy_devices.device_lifecycle_state`. Where a value here overlaps one of
 * those, the SERVER's answer wins on every refresh.
 */
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
export const BOOTSTRAP_STATE_PATH = "/var/lib/kitluy/bootstrap-state.json";
/** Same atomic discipline as the identity store: temp -> fsync -> rename -> fsync dir. */
export function writeBootstrapState(state, path = BOOTSTRAP_STATE_PATH) {
    const dir = dirname(path);
    mkdirSync(dir, { recursive: true, mode: 0o750 });
    const temp = `${path}.tmp-${process.pid}`;
    writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o644 });
    syncPath(temp);
    renameSync(temp, path);
    syncPath(dir);
}
export function readBootstrapState(path = BOOTSTRAP_STATE_PATH) {
    try {
        const parsed = JSON.parse(readFileSync(path, "utf8"));
        return typeof parsed?.phase === "string" ? parsed : null;
    }
    catch {
        // A missing or unreadable state file is not an error: the surface renders
        // "unknown", which is the truth, rather than refusing to start.
        return null;
    }
}
function syncPath(path) {
    const fd = openSync(path, "r");
    try {
        fsyncSync(fd);
    }
    finally {
        closeSync(fd);
    }
}
/**
 * Network readiness is deliberately a ROUTE check, not a ping to a KitLuy
 * service. "Can this device reach anything" and "is the KitLuy backend up" are
 * different questions, and conflating them makes an unbuilt backend look like a
 * broken network to whoever is standing in front of the terminal.
 */
export function hasDefaultRoute(procRoot = "/proc") {
    try {
        const routes = readFileSync(`${procRoot}/net/route`, "utf8").split("\n").slice(1);
        return routes.some((line) => {
            const cols = line.split(/\s+/);
            return cols.length > 2 && cols[1] === "00000000" && cols[0] !== "";
        });
    }
    catch {
        return false;
    }
}
/** A stable, non-secret 8-character label derived from the public key. */
export function deviceLabelFromPublicKey(publicKeyPem) {
    // Not a cryptographic identifier and not used for authorization — purely a
    // human-readable handle so an operator and an admin screen can agree they are
    // looking at the same device.
    let hash = 0;
    for (let i = 0; i < publicKeyPem.length; i += 1) {
        hash = (hash * 31 + publicKeyPem.charCodeAt(i)) >>> 0;
    }
    return `KL-${hash.toString(16).toUpperCase().padStart(8, "0")}`;
}
//# sourceMappingURL=bootstrap-state.js.map