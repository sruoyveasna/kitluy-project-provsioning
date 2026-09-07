/**
 * What a paired Pi Terminal knows about its own seat.
 *
 * ===========================================================================
 * WHY THIS FILE AND NOT pairing-state.json
 * ===========================================================================
 * The Store Hub records its pairing in `/var/lib/kitluy/pairing-state.json`,
 * written by a ROOT console (`kitluy-hub-pairing.service`). The Device Shell is
 * deliberately not that: it runs as `kitluy-terminal`, and `/var/lib/kitluy` is
 * root-owned 0751 — traversable, not writable. A shell that tried to write there
 * would fail at the last step of a pairing the operator had just completed.
 *
 * `/var/lib/kitluy/terminal` IS the shell's own directory: it is the
 * `kitluy-terminal` user's home (`sysusers.d/60-kitluy-terminal.conf`) and
 * `kitluy-terminal-session.service` already grants
 * `ReadWritePaths=/var/lib/kitluy/terminal`. `assignment.json` is the name the
 * image itself already uses for this — the terminal layer's clone-hygiene hook
 * deletes it from the golden image, and `image-contents.test.sh` fails the build
 * if a flashed card carries one. This writes the file those two already describe.
 *
 * ===========================================================================
 * DISPLAY STATE. THE CLOUD IS THE TRUTH.
 * ===========================================================================
 * Same rule as the agent's `pairing-state.ts`: this exists so the screen can
 * name the Store after a reboot without asking the network first. It authorises
 * nothing, and the server's answer wins on every refresh. In particular
 * `activated` is NOT implied by the presence of this file — pairing leaves a
 * terminal `pending_trust`, and a screen that read this as "ready to sell" would
 * be lying about a terminal that holds no operational certificate.
 *
 * The pairing CODE is never written here. It is a live shared secret, and its
 * only appearance anywhere in this app is the request body.
 */
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync, } from "node:fs";
import { dirname } from "node:path";
export const TERMINAL_ASSIGNMENT_PATH = "/var/lib/kitluy/terminal/assignment.json";
/** Same atomic discipline as the agent's state writers: temp -> fsync -> rename -> fsync dir. */
export function writeTerminalAssignment(assignment, path = TERMINAL_ASSIGNMENT_PATH) {
    const dir = dirname(path);
    mkdirSync(dir, { recursive: true, mode: 0o750 });
    const temp = `${path}.tmp-${process.pid}`;
    // 0600: unlike the agent's display state, this file has exactly one reader and
    // one writer — this app, as this user. Nothing else on the appliance needs it.
    writeFileSync(temp, `${JSON.stringify(assignment, null, 2)}\n`, { mode: 0o600 });
    const fd = openSync(temp, "r");
    try {
        fsyncSync(fd);
    }
    finally {
        closeSync(fd);
    }
    renameSync(temp, path);
    const dirFd = openSync(dir, "r");
    try {
        fsyncSync(dirFd);
    }
    finally {
        closeSync(dirFd);
    }
}
/**
 * Returns null when the file is absent, unreadable or unparseable.
 *
 * Treated as "not assigned" rather than as an error, for the same reason the
 * agent's readers do: the recovery is identical — present a code — and a
 * terminal that refused to show its keypad over a corrupt display file would be
 * unpairable for a reason that has nothing to do with pairing.
 */
export function readTerminalAssignment(path = TERMINAL_ASSIGNMENT_PATH) {
    try {
        const parsed = JSON.parse(readFileSync(path, "utf8"));
        if (parsed === null || typeof parsed !== "object")
            return null;
        const candidate = parsed;
        return typeof candidate.deviceRecordId === "string" &&
            typeof candidate.assignmentId === "string"
            ? parsed
            : null;
    }
    catch {
        return null;
    }
}
/**
 * Whether the recorded seat belongs to the board in front of us.
 *
 * Mirrors the agent's `pairingBelongsTo`. An assignment naming a DIFFERENT
 * device record is stale — the card was copied, or the board re-registered —
 * and must not be rendered as this terminal's Store.
 */
export function assignmentBelongsTo(assignment, deviceRecordId) {
    if (assignment === null || deviceRecordId === undefined)
        return false;
    return assignment.deviceRecordId === deviceRecordId;
}
//# sourceMappingURL=terminal-assignment.js.map