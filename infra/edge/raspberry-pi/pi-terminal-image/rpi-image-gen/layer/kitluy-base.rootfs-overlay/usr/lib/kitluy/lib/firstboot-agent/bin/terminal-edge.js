/**
 * `kitluy-terminal-edge.service` — the Pi Terminal's link to its Store Hub.
 *
 * Runs for the life of the board, one attempt every {@link IDLE_SECONDS}, and
 * writes `/var/lib/kitluy/terminal/edge-status.json` every time. It never
 * exits on a bad outcome: a Hub that is off, unreachable or does not yet hold
 * this terminal are all ordinary states of a shop, and a service that quit on
 * them would need a human to restart it before the shop could trade.
 *
 * Why a separate root service and not the Device Shell: the Shell runs as
 * `kitluy-terminal` with an EMPTY CapabilityBoundingSet and
 * `ReadWritePaths=/var/lib/kitluy/terminal`, so it cannot read the operational
 * private key in /var/lib/kitluy/operational (0700 root) and must not be able
 * to. This service holds the key and publishes only a status file the Shell can
 * read — the same split as `kitluy-device-config.service`.
 */
import { readFileSync } from "node:fs";
import { readImageEnv } from "../image-env.js";
import { runEdgeAttempt } from "../edge-session.js";
import { startEdgeBridge, } from "../edge-bridge.js";
import { TERMINAL_ASSIGNMENT_PATH } from "../paired-identity.js";
import { readRegistrationState } from "../registration-state.js";
const IDLE_SECONDS = 30;
const log = (message) => {
    console.log(`[terminal-edge] ${message}`);
};
/**
 * What this terminal can state about its own Store.
 *
 * The seat file records `digitalStoreReference` and `storeLocationReference`
 * and no tenant; when those happen to be UUIDs they are the scope, and when
 * they are not the discovery check says so and skips rather than guessing.
 */
export function readSeat(path = TERMINAL_ASSIGNMENT_PATH) {
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    // The Hub's own shape check for a profile, mirrored so a malformed key is
    // dropped here rather than sent and refused as REQUEST_INVALID.
    const PROFILE = /^[a-z0-9_]+\.t[1-9][0-9]*\.[a-z0-9_]+$/;
    try {
        const parsed = JSON.parse(readFileSync(path, "utf8"));
        const store = parsed.digitalStoreReference;
        const location = parsed.storeLocationReference;
        const keys = Array.isArray(parsed.terminalProfileKeys) ? parsed.terminalProfileKeys : [];
        return {
            ...(typeof store === "string" && UUID.test(store) ? { digitalStoreId: store } : {}),
            ...(typeof location === "string" && UUID.test(location) ? { storeLocationId: location } : {}),
            profileCodes: keys.filter((k) => typeof k === "string" && PROFILE.test(k)),
        };
    }
    catch {
        return { profileCodes: [] };
    }
}
/** Public facts about this board for the POS, read fresh on every status call. */
export function readTerminalFacts(assignmentPath = TERMINAL_ASSIGNMENT_PATH, registrationStatePath) {
    const seat = readSeat(assignmentPath);
    let generation = null;
    try {
        const parsed = JSON.parse(readFileSync(assignmentPath, "utf8"));
        if (typeof parsed.assignmentGeneration === "number")
            generation = parsed.assignmentGeneration;
    }
    catch {
        // No seat yet.
    }
    return {
        deviceId: readRegistrationState(registrationStatePath)?.deviceId ?? null,
        assignmentGeneration: generation,
        profileCodes: seat.profileCodes,
    };
}
let lastLine = "";
function report(status) {
    // One line per CHANGE, not per attempt: at one attempt every 30 seconds a
    // per-attempt log buries every other message on the device within a day.
    const line = `${status.phase}: ${status.detail}`;
    if (line !== lastLine) {
        lastLine = line;
        log(line);
    }
    return status;
}
async function main() {
    const environment = readImageEnv("KITLUY_ENVIRONMENT") ?? "development";
    log(`starting; environment '${environment}'`);
    // The bridge shares this process's view of the Hub: what the last attempt
    // verified and pinned, and nothing an earlier attempt knew that this one
    // could not confirm.
    let pinned = null;
    let latest = null;
    try {
        await startEdgeBridge({
            environment,
            pinnedEndpoint: () => pinned,
            latestStatus: () => latest,
            terminalFacts: () => readTerminalFacts(),
            log,
        });
    }
    catch (error) {
        // The link to the Hub is still worth running without the bridge: the
        // Device Shell reads the status file, and the POS reports the bridge down.
        log(`bridge could not start: ${error instanceof Error ? error.message : "unknown"}`);
    }
    for (;;) {
        try {
            const seat = readSeat();
            latest = report(await runEdgeAttempt({
                onPinnedEndpoint: (endpoint) => {
                    pinned = endpoint;
                },
                environment,
                expectation: {
                    ...(seat.digitalStoreId === undefined ? {} : { digitalStoreId: seat.digitalStoreId }),
                    ...(seat.storeLocationId === undefined
                        ? {}
                        : { storeLocationId: seat.storeLocationId }),
                },
                profileCodes: seat.profileCodes,
            }));
        }
        catch (error) {
            // A fault here is a bug, not a shop state; report it and keep the loop.
            log(`attempt faulted: ${error instanceof Error ? error.name : "unknown"}`);
        }
        await new Promise((resolve) => setTimeout(resolve, IDLE_SECONDS * 1000));
    }
}
// SELF-EXECUTION GUARD, and it is load-bearing at BUILD time.
//
// `package-bootstrap-runtime.sh` imports every packaged module to prove it
// loads. A bare top-level `void main()` therefore started THIS unit's polling
// loop inside the image build and hung it — twelve minutes before it was
// noticed, on 2026-09-10. An environment-variable guard does not help: the
// verifier sets no variables. The same guard every other entrypoint uses:
// `node -e` leaves argv[1] undefined, so loading is not booting.
if (process.argv[1] !== undefined && process.argv[1].includes("terminal-edge")) {
    void main();
}
//# sourceMappingURL=terminal-edge.js.map