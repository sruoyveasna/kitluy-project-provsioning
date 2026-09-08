/**
 * What the DEVICE knows about its own cloud registration.
 *
 * Authority: KLD-2026-08-17-DEVICE-REGISTRATION-APPROVAL-001; plan v1.0.0 §3.3.
 *
 * ===========================================================================
 * WHY A THIRD STATE FILE
 * ===========================================================================
 * `bootstrap-state.json` answers "has enrolment succeeded"; `pairing-state.json`
 * answers "is this Hub assigned to a Store". Registration is a third axis and
 * not a point on either line: a board can be registered and unapproved, or
 * approved and unpaired, and a device that folded these together would either
 * re-register every thirty seconds or claim a trust it does not hold. That
 * collision already happened once between enrolment and pairing — see the header
 * of `pairing-state.ts` and the defect fixed in `70a339d`.
 *
 * ===========================================================================
 * THIS IS DISPLAY STATE. THE CLOUD IS THE TRUTH.
 * ===========================================================================
 * These names exist so a console can say something truthful between refreshes.
 * They are NOT a database enum and they authorize nothing. In particular
 * `APPROVED` here means "the cloud answered KNOWN_DEVICE_INSTALLATION_REGISTERED
 * for an approved board" — it does NOT mean the device holds an operational
 * certificate. Certificates are gated on BLK-005 and nothing here issues one, so
 * a screen that rendered "ready to serve terminals" off this file would be
 * lying.
 *
 * ===========================================================================
 * PENDING IS A HEALTHY STATE, NOT A FAILURE
 * ===========================================================================
 * Plan §3.3: "Pending approval is a healthy waiting condition, not a boot
 * failure." A generic image is SUPPOSED to reach `AWAITING_APPROVAL` and stop
 * there until a human at HET decides. The console must not render that as an
 * error, and the firstboot unit must not fail because of it — an appliance that
 * showed a red screen for its designed resting state would send every installer
 * looking for a fault that does not exist.
 */
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync, } from "node:fs";
import { dirname } from "node:path";
export const REGISTRATION_STATE_PATH = "/var/lib/kitluy/registration-state.json";
/** Same atomic discipline as the identity store: temp -> fsync -> rename -> fsync dir. */
export function writeRegistrationState(state, path = REGISTRATION_STATE_PATH) {
    const dir = dirname(path);
    mkdirSync(dir, { recursive: true, mode: 0o750 });
    const temp = `${path}.tmp`;
    // 0644, NOT 0640 — THE UNPRIVILEGED SHELL HAS TO READ THIS.
    //
    // The Device Shell renders this file and runs as `kitluy-terminal`
    // (kitluy-terminal-session.service), not as root. At 0640 root:root it is
    // unreadable to that user: `readObject` catches the EACCES, the view reads as
    // null, and `deriveScreen` falls back to NOT_REGISTERED — so an approved board
    // would sit on "waiting for approval" for ever while the cloud held it
    // approved. `/var/lib/kitluy` is 0751, so traversal already works; only the
    // file mode was in the way.
    //
    // This is display state by construction — the header above says so, and the
    // fields are a phase, a public asset tag and an operator sentence. No secret,
    // no credential, and never the presented pairing code. `bootstrap-state.json`
    // has been 0644 for exactly this reason since it was written.
    writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o644 });
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
 * An unreadable file reads as "not registered" rather than as an error, because
 * the recovery is identical — register again, which is idempotent by contract
 * §10 — and a device that refused to show its console over a corrupt display
 * file would be unusable for a reason unrelated to registration.
 */
export function readRegistrationState(path = REGISTRATION_STATE_PATH) {
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
 * Whether the recorded registration belongs to the key in front of us.
 *
 * A state file naming a DIFFERENT registration key is stale — the device
 * re-keyed, or a card was copied — and must not be rendered as this
 * installation's registration. Same discipline as `pairingBelongsTo()`.
 */
export function registrationBelongsTo(state, keyFingerprint) {
    if (state === null || keyFingerprint === undefined)
        return false;
    return state.keyFingerprint === keyFingerprint;
}
/**
 * One operator-facing line per phase.
 *
 * Kept beside the phases rather than in the console so the two cannot drift, and
 * worded for someone standing in a shop with no context: it says what is true,
 * and whether they should wait or act.
 */
export function registrationHeadline(phase) {
    switch (phase) {
        case "NOT_REGISTERED":
            return "NOT REGISTERED — this device has not yet contacted KitLuy.";
        case "REGISTERING":
            return "REGISTERING — contacting KitLuy.";
        case "AWAITING_APPROVAL":
            return "WAITING FOR HET APPROVAL — this device is visible to KitLuy but is not yet authorized for Store use. No action is needed here.";
        case "TRUST_REVIEW_REQUIRED":
            return "TRUST REVIEW REQUIRED — KitLuy must check this device by hand before it can continue. Contact HET support.";
        case "APPROVED":
            return "APPROVED — this device is authorized. It is not yet provisioned for Store use.";
        case "CONTAINED":
            return "STOPPED BY KITLUY — this device has been quarantined, retired or replaced and cannot be used. Contact HET support.";
        case "UNREACHABLE":
            return "NO CONNECTION — this device cannot reach KitLuy. Check the network; it will keep trying.";
    }
}
/**
 * Short status word for a KitLuy row on a console. The headline above carries
 * the explanation; this is the one-or-two-word state an operator reads first.
 *
 * Lives here, beside the phases, rather than in either console: the Store Hub
 * console and the Pi Terminal screen render the same registration state and
 * must never disagree on what to call it.
 */
export function registrationPhaseLabel(phase) {
    switch (phase) {
        case "NOT_REGISTERED":
            return "Not registered";
        case "REGISTERING":
            return "Registering";
        case "AWAITING_APPROVAL":
            return "Waiting for approval";
        case "TRUST_REVIEW_REQUIRED":
            return "Trust review required";
        case "APPROVED":
            return "Approved";
        case "CONTAINED":
            return "Stopped by KitLuy";
        case "UNREACHABLE":
            return "No connection";
    }
}
/**
 * THE ASSET TAG, DERIVED ONCE.
 *
 * The registration client sends `KL-` + the first twelve hex digits of the
 * registration key fingerprint as the device's asset tag, and that string is
 * what the Admin Portal lists. On the first terminal boot (2026-09-03) the
 * status screen showed only the opaque cloud id, so the person at the Pi and
 * the person at the portal had no common name for the board. Both now derive
 * the label here, from the fingerprint the state already persists.
 *
 * A LABEL, not an identity: it grants nothing and the server never renames a
 * board it already knows under a different tag (registration contract §9).
 */
export function assetTagFromFingerprint(fingerprint) {
    return `KL-${fingerprint.slice(0, 12).toUpperCase()}`;
}
//# sourceMappingURL=registration-state.js.map