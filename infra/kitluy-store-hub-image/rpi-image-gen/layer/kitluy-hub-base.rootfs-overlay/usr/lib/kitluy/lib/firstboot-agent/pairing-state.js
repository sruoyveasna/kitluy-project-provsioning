/**
 * What the DEVICE knows about its own Store pairing.
 *
 * ===========================================================================
 * WHY THIS IS A SECOND FILE AND NOT A PHASE IN bootstrap-state.json
 * ===========================================================================
 * `alreadyEnrolled()` in `bin/enrollment-bootstrap.ts` decides whether the
 * enrolment agent has already succeeded. Until this file existed, the only place
 * to record "pairing is in progress" was `bootstrap-state.json`'s single `phase`
 * — and writing any phase other than `ENROLLED_UNASSIGNED` there makes that
 * predicate answer false, so the agent re-presents a ticket the server already
 * consumed, every thirty seconds, for ever.
 *
 * That is not hypothetical: it is the defect fixed in `70a339d`, which produced
 * `ENROLLMENT_REDEMPTION_422` twice a minute on the first real device and made it
 * report itself UNENROLLED while the fleet held it as `enrolled`.
 *
 * Enrolment and pairing are also two different axes, not two points on one line.
 * A device is enrolled or not; separately, it is assigned to a Store or not.
 * Modelling them as one ordered phase is what made the collision possible.
 *
 * So enrolment keeps sole ownership of `bootstrap-state.json`, whose phase stays
 * `ENROLLED_UNASSIGNED` until the SERVER says otherwise, and pairing gets this.
 *
 * ===========================================================================
 * THIS IS DISPLAY STATE. THE SERVER IS THE TRUTH.
 * ===========================================================================
 * Exactly as `bootstrap-state.ts` records for its own values: these names exist
 * so a console can say something truthful between refreshes. They are NOT a
 * database enum and they never authorize anything. `kitluy_devices.device_assignments`
 * is the authority on whether a Hub is assigned, and it wins on every refresh.
 *
 * In particular `PAIRED` here means "the cloud told us it created an assignment",
 * which is `pending_trust` — NOT active. Activation is certificate-backed and
 * gated on BLK-005, and a device that rendered "ready" off this file would be
 * lying about a Hub that cannot yet serve a terminal.
 */
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
export const PAIRING_STATE_PATH = "/var/lib/kitluy/pairing-state.json";
/** Same atomic discipline as the identity store: temp -> fsync -> rename -> fsync dir. */
export function writePairingState(state, path = PAIRING_STATE_PATH) {
    const dir = dirname(path);
    mkdirSync(dir, { recursive: true, mode: 0o750 });
    const temp = `${path}.tmp`;
    writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o640 });
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
 * Returns null when the file is absent or unparseable.
 *
 * An unreadable pairing file is treated as "not paired" rather than as an error,
 * because the recovery is identical — present a code — and a Hub that refused to
 * show its prompt over a corrupt display file would be unpairable for a reason
 * that has nothing to do with pairing.
 */
export function readPairingState(path = PAIRING_STATE_PATH) {
    try {
        const parsed = JSON.parse(readFileSync(path, "utf8"));
        if (parsed === null || typeof parsed !== "object")
            return null;
        const candidate = parsed;
        return typeof candidate.phase === "string" ? parsed : null;
    }
    catch {
        return null;
    }
}
/**
 * Whether the recorded pairing belongs to the device in front of us.
 *
 * A pairing file naming a DIFFERENT device record is stale — the card was copied,
 * or the device re-keyed and re-enrolled — and must not be rendered as this
 * device's Store. Same reasoning as `alreadyEnrolled()`.
 */
export function pairingBelongsTo(state, deviceRecordId) {
    if (state === null || deviceRecordId === undefined)
        return false;
    return state.deviceRecordId === deviceRecordId;
}
//# sourceMappingURL=pairing-state.js.map