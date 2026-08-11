/**
 * `/usr/lib/kitluy/enrollment-agent` — the fleet enrollment bootstrap client.
 *
 * ===========================================================================
 * WHAT THIS DOES TODAY, STATED HONESTLY (§11)
 * ===========================================================================
 * The cloud factory-enrollment endpoint DOES NOT EXIST YET. There is no
 * `/v1/device-enrollment` route, and `enroll_device_v1` requires a
 * manufacturing station id and a human operator reference that a field Pi does
 * not have (recorded in 26_PI_TERMINAL_RUNTIME_SOURCE_MAP.md §4).
 *
 * So this agent does the only honest thing: it establishes what it CAN
 * establish — that identity exists, that the network is up, that no enrollment
 * ticket has been supplied — writes that state where the bootstrap surface can
 * read it, and reports `FLEET_ENROLLMENT_REQUIRED`.
 *
 * It does NOT:
 *   - claim enrollment succeeded;
 *   - invent a transport (the `EnrollmentClient` port stays uninjected);
 *   - crash-loop against an absent backend, because a restart storm on an
 *     unbuilt endpoint is indistinguishable from a real outage at 03:00 and
 *     buries the signal that matters.
 *
 * When the endpoint exists, the change here is to inject a real
 * `EnrollmentClient` and drive `runEnrollmentStep` — the state machine is
 * already built and tested. Nothing in this file needs rewriting for that.
 */
import { readFileSync } from "node:fs";
import { SERVICE_VERSION } from "../version.js";
import { deviceLabelFromPublicKey, hasDefaultRoute, writeBootstrapState, } from "../bootstrap-state.js";
import { DEFAULT_IDENTITY_DIR, FileIdentityStore } from "../adapters/device-identity-store.js";
/** Where an operator drops the one-time development enrollment ticket. */
export const TICKET_PATH = "/var/lib/kitluy/enrollment/ticket";
const POLL_SECONDS = 30;
/**
 * One evaluation pass. Pure with respect to scheduling so every branch is
 * directly testable, exactly as `runEnrollmentStep` is.
 */
export async function evaluateBootstrap(options) {
    const store = new FileIdentityStore({ directory: options.identityDir ?? DEFAULT_IDENTITY_DIR });
    let identity = null;
    let identityError;
    try {
        identity = await store.read();
    }
    catch (error) {
        identityError = error instanceof Error ? error.message : "unreadable identity";
    }
    const networkReady = hasDefaultRoute(options.procRoot);
    const imageVersion = readImageVersion();
    let phase;
    let detail;
    if (identityError !== undefined) {
        // Identity is corrupt. Enrollment must not proceed and must not "repair"
        // it — that decision belongs to firstboot, which refuses on purpose.
        phase = "HALTED";
        detail = "device identity is unreadable; firstboot must resolve this before enrollment";
    }
    else if (identity === null || !identity.complete) {
        phase = "IDENTITY_INITIALIZING";
        detail = "waiting for kitluy-firstboot.service to establish a device identity";
    }
    else if (!networkReady) {
        phase = "NETWORK_WAIT";
        detail = "no default route; the device cannot reach the KitLuy fleet service";
    }
    else if (!ticketPresent(options.ticketPath ?? TICKET_PATH)) {
        phase = "UNENROLLED";
        detail = "FLEET_ENROLLMENT_REQUIRED: supply a one-time development enrollment ticket";
    }
    else {
        // A ticket exists but there is nowhere to send it. Saying ENROLLING here
        // would be a lie the surface then shows an operator indefinitely.
        phase = "UNENROLLED";
        detail =
            "FLEET_ENROLLMENT_REQUIRED: an enrollment ticket is present but the cloud enrollment endpoint is not yet deployed";
    }
    const state = {
        phase,
        detail,
        identityReady: identity !== null && identity.complete,
        networkReady,
        agentVersion: SERVICE_VERSION,
        updatedAt: new Date().toISOString(),
        ...(imageVersion === undefined ? {} : { imageVersion }),
        ...(identity === null
            ? {}
            : { deviceLabel: deviceLabelFromPublicKey(identity.publicKeyPem) }),
    };
    return { result: { phase, detail }, state };
}
function ticketPresent(path) {
    try {
        return readFileSync(path, "utf8").trim().length > 0;
    }
    catch {
        return false;
    }
}
function readImageVersion() {
    try {
        const env = readFileSync("/etc/kitluy/image.env", "utf8");
        return /^KITLUY_IMAGE_VERSION=(.+)$/m.exec(env)?.[1]?.trim();
    }
    catch {
        return undefined;
    }
}
function report(state) {
    process.stdout.write(`event=kitluy.enrollment.bootstrap phase=${state.phase} identity=${state.identityReady} network=${state.networkReady} detail=${JSON.stringify(state.detail ?? "")}\n`);
}
export async function main() {
    // A long-running unit rather than a oneshot, so the surface tracks network
    // and ticket changes without an operator restarting anything.
    for (;;) {
        const { state } = await evaluateBootstrap({});
        writeBootstrapState(state);
        report(state);
        await new Promise((resolve) => setTimeout(resolve, POLL_SECONDS * 1000));
    }
}
if (process.argv[1] !== undefined && process.argv[1].includes("enrollment-bootstrap")) {
    void main();
}
//# sourceMappingURL=enrollment-bootstrap.js.map