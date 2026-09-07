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
export const DEFAULT_ROOTS = {
    stateDir: "/var/lib/kitluy",
    netDir: "/sys/class/net",
    routePath: "/proc/net/route",
};
const REGISTRATION_PHASES = [
    "NOT_REGISTERED",
    "REGISTERING",
    "AWAITING_APPROVAL",
    "TRUST_REVIEW_REQUIRED",
    "APPROVED",
    "CONTAINED",
    "UNREACHABLE",
];
const PAIRING_PHASES = [
    "UNPAIRED",
    "AWAITING_CODE",
    "SUBMITTING",
    "PAIRED",
    "LOCKED",
    "ALREADY_ASSIGNED",
];
function readObject(path) {
    try {
        const parsed = JSON.parse(readFileSync(path, "utf8"));
        return parsed !== null && typeof parsed === "object"
            ? parsed
            : null;
    }
    catch {
        return null;
    }
}
function str(raw, key) {
    const value = raw[key];
    return typeof value === "string" ? value : undefined;
}
export function readRegistration(stateDir = DEFAULT_ROOTS.stateDir) {
    const raw = readObject(join(stateDir, "registration-state.json"));
    if (raw === null)
        return null;
    const phase = raw.phase;
    if (typeof phase !== "string" || !REGISTRATION_PHASES.includes(phase)) {
        return null;
    }
    const deviceId = str(raw, "deviceId");
    const detail = str(raw, "detail");
    const keyFingerprint = str(raw, "keyFingerprint");
    return {
        phase: phase,
        ...(deviceId === undefined ? {} : { deviceId }),
        ...(detail === undefined ? {} : { detail }),
        ...(keyFingerprint === undefined ? {} : { keyFingerprint }),
    };
}
export function readPairing(stateDir = DEFAULT_ROOTS.stateDir) {
    const raw = readObject(join(stateDir, "pairing-state.json"));
    if (raw === null)
        return null;
    const phase = raw.phase;
    if (typeof phase !== "string" || !PAIRING_PHASES.includes(phase)) {
        return null;
    }
    const detail = str(raw, "detail");
    const deviceRecordId = str(raw, "deviceRecordId");
    return {
        phase: phase,
        ...(detail === undefined ? {} : { detail }),
        ...(deviceRecordId === undefined ? {} : { deviceRecordId }),
    };
}
/** The server record id the pairing belongs to, from bootstrap-state.json. */
export function readDeviceRecordId(stateDir = DEFAULT_ROOTS.stateDir) {
    const raw = readObject(join(stateDir, "bootstrap-state.json"));
    return raw === null ? undefined : str(raw, "deviceRecordId");
}
/**
 * Network readiness: a link exists if any real interface (not `lo`) reports
 * `operstate=up`; a route exists if `/proc/net/route` has a default entry
 * (destination `00000000`). Both fail safe to `false`.
 */
export function readNetwork(roots = DEFAULT_ROOTS) {
    let hasLink = false;
    try {
        for (const iface of readdirSync(roots.netDir)) {
            if (iface === "lo")
                continue;
            try {
                const state = readFileSync(join(roots.netDir, iface, "operstate"), "utf8").trim();
                if (state === "up") {
                    hasLink = true;
                    break;
                }
            }
            catch {
                /* interface without operstate — skip */
            }
        }
    }
    catch {
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
    }
    catch {
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
export function readAssignment(stateDir = DEFAULT_ROOTS.stateDir) {
    const raw = readTerminalAssignment(join(stateDir, "terminal", "assignment.json"));
    if (raw === null)
        return null;
    return {
        deviceRecordId: raw.deviceRecordId,
        activated: raw.activated === true,
        digitalStoreReference: raw.digitalStoreReference,
        storeLocationReference: raw.storeLocationReference,
        physicalTerminalLabel: raw.physicalTerminalLabel,
    };
}
export function readSnapshot(roots = DEFAULT_ROOTS) {
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
    };
}
//# sourceMappingURL=device-state-files.js.map