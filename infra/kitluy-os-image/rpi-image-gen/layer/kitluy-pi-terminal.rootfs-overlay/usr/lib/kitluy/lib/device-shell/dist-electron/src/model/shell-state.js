/**
 * Which screen the Device Shell shows, derived purely from a snapshot of the
 * device's own state files.
 *
 * ===========================================================================
 * DISPLAY STATE. THE CLOUD IS THE TRUTH.
 * ===========================================================================
 * These phases are copied from the firstboot agent's `registration-state.ts` and
 * `pairing-state.ts`, which are themselves display state, not a database enum.
 * The shell renders the same registration state the Store Hub console renders and
 * must never disagree with it — so the phase unions and the label/headline
 * wording are mirrored here, and `test/drift.test.ts` imports the agent and
 * fails if the two ever diverge.
 *
 * Nothing here authorises anything. `APPROVED` means the cloud answered "known,
 * approved" for this board — NOT that it holds an operational certificate. There
 * is deliberately NO screen that offers a business app: a Pi reaches
 * `approved_unassigned`, takes a pairing code, and that is the end of what this
 * slice can do (owner decision v2.0.0 §5).
 */
/**
 * THE ASSET TAG, DERIVED ONCE — mirror of the agent's `assetTagFromFingerprint`.
 *
 * `KL-` + the first twelve hex digits of the registration key fingerprint. This
 * is the string the registration client sends and the Admin Portal lists, so the
 * person at the Pi and the person at the portal name the board the same way. A
 * label, not an identity: it authorises nothing.
 */
export function assetTagFromFingerprint(fingerprint) {
    return `KL-${fingerprint.slice(0, 12).toUpperCase()}`;
}
/** Mirror of the agent's `registrationBelongsTo`. */
export function registrationBelongsTo(registration, keyFingerprint) {
    if (registration === null || keyFingerprint === undefined)
        return false;
    return registration.keyFingerprint === keyFingerprint;
}
/** Mirror of `assignmentBelongsTo` in electron/terminal-assignment.ts. */
export function assignmentBelongsTo(assignment, deviceRecordId) {
    if (assignment === null || assignment === undefined || deviceRecordId === undefined)
        return false;
    return assignment.deviceRecordId === deviceRecordId;
}
/** Mirror of the agent's `pairingBelongsTo`. */
export function pairingBelongsTo(pairing, deviceRecordId) {
    if (pairing === null || deviceRecordId === undefined)
        return false;
    return pairing.deviceRecordId === deviceRecordId;
}
/**
 * The human-readable board label for the screen.
 *
 * Derived from the registration key fingerprint the state file persists — the
 * SAME `KL-` + 12-hex asset tag the registration client sent and the Admin
 * Portal lists, so the person at the Pi and the person at the portal name the
 * board identically (the fix made in Slice 1A's `bootstrap-ui`). Falls back to
 * the opaque cloud device id, then to nothing.
 *
 * The stale-card guard (`registrationBelongsTo` against the device's live
 * identity fingerprint) is deferred to the sealed-identity work in Phase 3,
 * where the shell can read that fingerprint without touching the private key;
 * the function is kept and exported here as the agreed mirror the drift test
 * checks.
 */
export function deviceLabelOf(snapshot) {
    const reg = snapshot.registration;
    if (reg === null)
        return null;
    if (reg.keyFingerprint !== undefined && reg.keyFingerprint.length >= 12) {
        return assetTagFromFingerprint(reg.keyFingerprint);
    }
    return reg.deviceId ?? null;
}
/**
 * Which screen to show, given a snapshot.
 *
 * `null` snapshot is the pre-IPC first paint → `booting`. Order of precedence:
 * a halted board is halted whatever else is true; an approved board that holds a
 * live pairing for ITSELF is `assigned`; an approved board otherwise takes a
 * code; everything else is a flavour of waiting. "No network" is a flag on the
 * waiting screen, not a screen of its own — a board with no link is still
 * waiting, it just also needs a cable.
 */
export function deriveScreen(snapshot) {
    if (snapshot === null)
        return { kind: "booting" };
    const phase = snapshot.registration?.phase ?? "NOT_REGISTERED";
    const deviceLabel = deviceLabelOf(snapshot);
    const noNetwork = !snapshot.network.hasRoute;
    switch (phase) {
        case "CONTAINED":
            return { kind: "halted", reason: "contained", deviceLabel };
        case "TRUST_REVIEW_REQUIRED":
            return { kind: "halted", reason: "trust_review", deviceLabel };
        case "APPROVED": {
            // TWO WAYS TO BE ASSIGNED, because two devices record it differently.
            //
            // A Store Hub's root console writes `pairing-state.json`; this terminal's
            // unprivileged shell writes its own `assignment.json`. Both mean the cloud
            // created an assignment for THIS board, and either is enough. Both are
            // checked against the device record id, so a card copied from another
            // board shows the keypad rather than someone else's Store.
            const paired = (snapshot.pairing?.phase === "PAIRED" &&
                pairingBelongsTo(snapshot.pairing, snapshot.deviceRecordId)) ||
                assignmentBelongsTo(snapshot.assignment, snapshot.deviceRecordId);
            return paired
                ? { kind: "assigned", deviceLabel }
                : { kind: "approved_unassigned", deviceLabel };
        }
        case "REGISTERING":
            return { kind: "waiting_for_approval", sub: "REGISTERING", deviceLabel, noNetwork };
        case "AWAITING_APPROVAL":
            return { kind: "waiting_for_approval", sub: "AWAITING_APPROVAL", deviceLabel, noNetwork };
        case "UNREACHABLE":
            return { kind: "waiting_for_approval", sub: "UNREACHABLE", deviceLabel, noNetwork: true };
        case "NOT_REGISTERED":
            return { kind: "waiting_for_approval", sub: "NOT_REGISTERED", deviceLabel, noNetwork };
    }
}
//# sourceMappingURL=shell-state.js.map