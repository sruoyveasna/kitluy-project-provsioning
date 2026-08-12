/**
 * `/usr/lib/kitluy/enrollment-agent` — the fleet enrollment bootstrap client.
 *
 * ===========================================================================
 * WHAT THIS DOES TODAY
 * ===========================================================================
 * The cloud endpoint now EXISTS (`/v1/device-enrollment/{challenges,redemptions}`,
 * KLD-2026-08-11-FRESH-DEVICE-ENROLLMENT-001), so this agent presents its
 * flash-time ticket, proves possession of the key firstboot generated, and
 * reports the fleet position it actually reached.
 *
 * The earlier version of this header said the endpoint did not exist and that
 * "the change here is to inject a real `EnrollmentClient`… Nothing in this file
 * needs rewriting". That prediction held: `runEnrollmentStep` and the
 * `EnrollmentClient` port are unchanged, and the transport arrived as an
 * injected adapter.
 *
 * It still does NOT:
 *   - claim enrollment succeeded when the server refused — a refusal is
 *     reported with its code, and the device stays UNENROLLED;
 *   - crash-loop against an unreachable backend, because a restart storm is
 *     indistinguishable from a real outage at 03:00 and buries the signal;
 *   - proceed without a ticket, an identity, a network route, or a configured
 *     endpoint. Each of those is a distinct, legible state.
 *
 * Enrollment produces ENROLLED_UNASSIGNED and nothing more. Store pairing is a
 * separate lifecycle stage with a separate credential (KLSRC-0162 §35).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SERVICE_VERSION } from "../version.js";
import { deviceLabelFromPublicKey, hasDefaultRoute, writeBootstrapState, } from "../bootstrap-state.js";
import { DEFAULT_IDENTITY_DIR, FileIdentityStore } from "../adapters/device-identity-store.js";
import { FileKeyProvider } from "../adapters/device-key-provider.js";
import { createHttpEnrollmentClient } from "../adapters/http-enrollment-client.js";
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
    const imageVersion = readImageVersion(options.etcRoot);
    let phase;
    let detail;
    let enrolledDeviceRecordId;
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
        const ticket = readTicket(options.ticketPath ?? TICKET_PATH);
        const baseUrl = options.baseUrl ?? readEnrollmentBaseUrl(options.etcRoot);
        if (ticket === null) {
            phase = "UNENROLLED";
            detail =
                "FLEET_ENROLLMENT_REQUIRED: the enrollment ticket file is malformed; expected reference and secret";
        }
        else if (baseUrl === undefined) {
            // A ticket with nowhere to send it. Saying ENROLLING would be a lie the
            // surface then shows an operator indefinitely.
            phase = "UNENROLLED";
            detail =
                "FLEET_ENROLLMENT_REQUIRED: an enrollment ticket is present but no enrollment endpoint is configured";
        }
        else {
            const client = options.client ??
                createHttpEnrollmentClient({
                    baseUrl,
                    privateKeyHandle: identity.privateKeyHandle,
                    signer: new FileKeyProvider({ directory: options.identityDir ?? DEFAULT_IDENTITY_DIR }),
                    ticketReference: ticket.reference,
                    ticketSecret: ticket.secret,
                    environment: readEnvironment(options.etcRoot),
                });
            const outcome = await client.enroll({
                publicKeyPem: identity.publicKeyPem,
                deviceClass: readDeviceClass(options.etcRoot),
                hardwareSignals: { ...(identity.hardwareSignals ?? {}) },
            });
            if (outcome.kind === "enrolled" || outcome.kind === "already_enrolled") {
                phase = "ENROLLED_UNASSIGNED";
                detail = "the device is enrolled in the KitLuy fleet and is not assigned to a Store";
                enrolledDeviceRecordId = outcome.deviceRecordId;
            }
            else {
                // A refusal is reported as-is. The agent keeps its honest UNENROLLED
                // state rather than retrying in a tight loop, which on an unbuilt or
                // unreachable backend is indistinguishable from a real outage at 03:00.
                phase = "UNENROLLED";
                detail = `FLEET_ENROLLMENT_REFUSED: ${outcome.code}${outcome.retryable ? " (retryable)" : ""}`;
            }
        }
    }
    const state = {
        phase,
        detail,
        identityReady: identity !== null && identity.complete,
        networkReady,
        agentVersion: SERVICE_VERSION,
        updatedAt: new Date().toISOString(),
        ...(imageVersion === undefined ? {} : { imageVersion }),
        ...(enrolledDeviceRecordId === undefined ? {} : { deviceRecordId: enrolledDeviceRecordId }),
        ...(identity === null ? {} : { deviceLabel: deviceLabelFromPublicKey(identity.publicKeyPem) }),
    };
    return { result: { phase, detail }, state };
}
/**
 * The flashed ticket file: `reference` and `secret`, one per line as
 * `key=value`. The SECRET is never logged and never written anywhere else —
 * `http-enrollment-client` hashes it before transmission.
 */
function readTicket(path) {
    try {
        const text = readFileSync(path, "utf8");
        const reference = /^\s*reference\s*=\s*(.+)$/m.exec(text)?.[1]?.trim();
        const secret = /^\s*secret\s*=\s*(.+)$/m.exec(text)?.[1]?.trim();
        if (reference === undefined || secret === undefined)
            return null;
        if (reference.length === 0 || secret.length === 0)
            return null;
        return { reference, secret };
    }
    catch {
        return null;
    }
}
/**
 * THE FILE THE IMAGE ACTUALLY SHIPS.
 *
 * `build-image.sh` calls this "the only build-time value injection" and writes
 * every non-secret device fact here; `config/image.conf` documents
 * `KITLUY_ENROLLMENT_BASE_URL` as "the device-registry-service base URL the
 * firstboot agent talks to".
 *
 * An earlier version of this module read `KITLUY_FLEET_BASE_URL` from
 * `/etc/kitluy/fleet.env` — a variable nothing writes, in a file no build
 * produces. The endpoint was therefore ALWAYS unresolved on a real device, and
 * the agent reported "no enrollment endpoint is configured" no matter how the
 * image was built. The names are reconciled here, on the reader, because the
 * image side is the one with the build-time override plumbed through it.
 */
export const IMAGE_ENV_PATH = "/etc/kitluy/image.env";
function imageEnvPath(etcRoot) {
    return etcRoot === undefined ? IMAGE_ENV_PATH : join(etcRoot, "kitluy", "image.env");
}
/**
 * One key from the generated image environment.
 *
 * An EMPTY value is `undefined`, not "": the build writes
 * `KITLUY_ENROLLMENT_BASE_URL=` when no environment supplied one, and an empty
 * string is the absence of an endpoint rather than an endpoint whose address is
 * nothing. Comment lines are skipped — the generated file starts with two.
 */
function readImageEnv(key, etcRoot) {
    let text;
    try {
        text = readFileSync(imageEnvPath(etcRoot), "utf8");
    }
    catch {
        return undefined;
    }
    for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("#"))
            continue;
        const separator = trimmed.indexOf("=");
        if (separator === -1 || trimmed.slice(0, separator) !== key)
            continue;
        const value = trimmed.slice(separator + 1).trim();
        return value.length === 0 ? undefined : value;
    }
    return undefined;
}
/** Where the fleet service lives. Config, never a compiled-in default. */
function readEnrollmentBaseUrl(etcRoot) {
    return readImageEnv("KITLUY_ENROLLMENT_BASE_URL", etcRoot);
}
function readEnvironment(etcRoot) {
    return readImageEnv("KITLUY_ENVIRONMENT", etcRoot) ?? "development";
}
/**
 * Which device this image is. Read from image config rather than inferred:
 * a Store Hub that guessed it was a terminal would enrol into the wrong class
 * and the error would surface much later, during Store pairing.
 */
function readDeviceClass(etcRoot) {
    return readImageEnv("KITLUY_DEVICE_CLASS", etcRoot) === "store_hub" ? "store_hub" : "terminal";
}
function ticketPresent(path) {
    try {
        return readFileSync(path, "utf8").trim().length > 0;
    }
    catch {
        return false;
    }
}
function readImageVersion(etcRoot) {
    return readImageEnv("KITLUY_IMAGE_VERSION", etcRoot);
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