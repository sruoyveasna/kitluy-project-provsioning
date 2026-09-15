/**
 * "Is this device paired, and to which fleet record?" — for BOTH device classes.
 *
 * ===========================================================================
 * WHY TWO SOURCES
 * ===========================================================================
 * A Store Hub pairs at its console: `bin/hub-pairing-ui.ts` writes the canonical
 * `/var/lib/kitluy/pairing-state.json`.
 *
 * A Pi Terminal pairs on its GRAPHICAL shell, which runs as `kitluy-terminal`
 * with `ReadWritePaths=/var/lib/kitluy/terminal` and therefore CANNOT write that
 * file — the sandbox is deliberate and is not widened for this. It writes
 * `/var/lib/kitluy/terminal/assignment.json` instead, which already carries the
 * two facts a certificate request needs: the device record id and the assignment
 * generation.
 *
 * So the certificate agent must read whichever its device class actually wrote.
 * Without this a Terminal packaged with `operational-tls` would sit at
 * "waiting: not paired yet" for ever, having paired perfectly well — the same
 * shape of bug as `readDeviceRecordId` reading a retired bootstrap file, found
 * on hardware the same day.
 *
 * ===========================================================================
 * THE HUB'S FILE WINS
 * ===========================================================================
 * Checked first, so a Store Hub's behaviour is byte-for-byte what it was. The
 * terminal file is consulted only when the canonical one says nothing.
 */
import { readPairingState } from "./pairing-state.js";
import { readFileSync } from "node:fs";
/** Where the Device Shell writes a terminal's seat. Mirrors TERMINAL_ASSIGNMENT_PATH. */
export const TERMINAL_ASSIGNMENT_PATH = "/var/lib/kitluy/terminal/assignment.json";
function statedGeneration(value) {
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}
function readTerminalAssignment(path) {
    let raw;
    try {
        raw = JSON.parse(readFileSync(path, "utf8"));
    }
    catch {
        // Absent on a Hub, and on a Terminal that has not paired. Both ordinary.
        return null;
    }
    if (typeof raw !== "object" || raw === null)
        return null;
    const deviceRecordId = raw.deviceRecordId;
    if (typeof deviceRecordId !== "string" || deviceRecordId === "")
        return null;
    const generation = statedGeneration(raw.assignmentGeneration);
    return {
        deviceRecordId,
        assignmentGeneration: generation ?? 1,
        assignmentGenerationSource: generation === undefined ? "assumed-legacy-default" : "stated",
        source: "terminal-assignment",
    };
}
/**
 * The paired identity, or null when this device has not paired.
 *
 * `activated` on the terminal file is deliberately NOT consulted: a device asks
 * for a certificate in order to BECOME activated, so requiring activation first
 * would be circular. Activation is the server's decision and it makes it after
 * the certificate exists.
 */
export function readPairedIdentity(options = {}) {
    const hub = options.pairingStatePath === undefined
        ? readPairingState()
        : readPairingState(options.pairingStatePath);
    if (hub !== null && hub.phase === "PAIRED" && hub.deviceRecordId !== undefined) {
        // The generation the cloud stated at pairing (group 0226). A file written
        // before that has none, and 1 — what this agent always used for a Hub — is
        // kept for it, but marked as assumed so it is visible in the log. The
        // hard-coded 1 is what refused a re-paired Hub at generation 3 on hardware.
        const generation = statedGeneration(hub.assignmentGeneration);
        return {
            deviceRecordId: hub.deviceRecordId,
            assignmentGeneration: generation ?? 1,
            assignmentGenerationSource: generation === undefined ? "assumed-legacy-default" : "stated",
            source: "hub-pairing-state",
        };
    }
    return readTerminalAssignment(options.terminalAssignmentPath ?? TERMINAL_ASSIGNMENT_PATH);
}
//# sourceMappingURL=paired-identity.js.map