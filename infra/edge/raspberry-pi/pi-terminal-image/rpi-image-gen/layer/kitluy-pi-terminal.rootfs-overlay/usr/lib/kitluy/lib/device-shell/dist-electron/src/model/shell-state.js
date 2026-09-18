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
 * The one line the screen shows about software. Deliberately short — it sits
 * under the device label, not in place of the state the shell exists to render.
 *
 * Returns null when there is nothing worth saying: a board that has never had a
 * release and is running the image it was flashed with is the normal case and
 * does not need a caption.
 */
export function releaseCaption(snapshot) {
    const release = snapshot.release ?? null;
    if (release === null)
        return null;
    if (release.source === "IMAGE_FALLBACK") {
        // A device with a release installed but the image copy running is the case
        // that must never look normal.
        if (release.installedVersion !== null || release.stale) {
            return {
                text: `Image software · ${release.installedVersion ?? "an update"} is installed and starts on restart`,
                tone: "attention",
            };
        }
        if (release.lastOutcome === "ROLLED_BACK" || release.lastOutcome === "REFUSED") {
            return {
                text: `Image software · last update ${release.lastOutcome.toLowerCase().replace("_", " ")}`,
                tone: "attention",
            };
        }
        return null; // never updated, running what it was flashed with
    }
    if (release.source === "RELEASE") {
        // A release IS running but not the one that is installed. The version of
        // the running one is not recorded — only the committed one is — so this
        // says what is true rather than guessing a number. Found by a test that
        // expected a caption here and got none, which is the silent case this
        // whole function exists to prevent.
        if (release.runningVersion === null) {
            return {
                text: `Older release running · ${release.installedVersion ?? "a newer version"} starts on restart`,
                tone: "attention",
            };
        }
        if (release.stale) {
            return {
                text: `${release.runningVersion} · ${release.installedVersion ?? "a newer version"} starts on restart`,
                tone: "attention",
            };
        }
        return { text: release.runningVersion, tone: "normal" };
    }
    return null;
}
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
    // A halted board is halted whatever else is true — including before its PIN.
    if (phase === "CONTAINED")
        return { kind: "halted", reason: "contained", deviceLabel };
    if (phase === "TRUST_REVIEW_REQUIRED") {
        return { kind: "halted", reason: "trust_review", deviceLabel };
    }
    // FIRST BOOT: the device PIN comes before registration, approval and pairing
    // (owner decision 2026-09-18). An image whose agent publishes no posture reads
    // as `absent` too — the agent and the shell ship together.
    if ((snapshot.devicePin?.state ?? "absent") === "absent") {
        return { kind: "pin_setup", deviceLabel };
    }
    switch (phase) {
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
            if (!paired)
                return { kind: "approved_unassigned", deviceLabel };
            // Paired: the application is on its way. The shell shows the install
            // (it is stopped the moment the POS unit takes the seat, so this is what
            // a person sees between the code and the counter).
            const app = snapshot.application ?? null;
            if (app !== null && app.phase !== "COMMITTED") {
                return {
                    kind: "installing",
                    deviceLabel,
                    phase: app.phase,
                    failed: app.phase === "ROLLED_BACK" || app.phase === "FAILED",
                };
            }
            return { kind: "assigned", deviceLabel };
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
export function pairingMessageKey(status) {
    switch (status) {
        case "PAIRED":
            return "pairingPaired";
        case "CODE_REFUSED":
        case "CODE_MALFORMED":
            return "pairingRefused";
        case "LOCKED":
            return "pairingLocked";
        case "ALREADY_ASSIGNED":
            return "pairingAlreadyAssigned";
        case "NO_DEVICE_RECORD":
            return "pairingNotRegistered";
        case "PAIRING_UNREACHABLE":
            return "pairingUnreachable";
        // The build genuinely has no transport — an image packaged without the
        // agent's pairing client. Distinct from every refusal above, because the
        // answer is "reflash", not "try again".
        case "PAIRING_TRANSPORT_UNAVAILABLE":
            return "pairingNotAvailable";
        default:
            // Anything the registry adds later reads as a plain failure rather than
            // as success. Failing closed matters more here than covering every code.
            return "pairingFailed";
    }
}
//# sourceMappingURL=shell-state.js.map