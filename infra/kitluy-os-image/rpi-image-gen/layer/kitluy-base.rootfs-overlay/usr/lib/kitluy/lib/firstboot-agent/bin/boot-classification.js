/**
 * `kitluy-boot-classification` — classify this boot and record the one sentence
 * the consoles show.
 *
 * Authority: owner task BOOT-RECOVERY-CLASSIFICATION-001 slice F.
 *
 * Reads the card's claims, the board's own hardware signals and (on a Store
 * Hub) whether the data volume opened; asks the registry; falls back to the
 * same contract on the board when the registry cannot answer; writes
 * `/var/lib/kitluy/boot-classification.json`. It changes nothing else: it
 * pairs nothing, requests no certificate, unlocks no storage. Those remain the
 * jobs of the agents that already do them.
 *
 * It polls, like `cloud-registration`: the answer changes while the board is
 * up (an administrator releases the device, a quarantine is lifted, the
 * network returns), and the screen must change with it without a reboot.
 */
import { LinuxHardwareProbe } from "../adapters/linux-hardware-probe.js";
import { bootSignalsFrom, classifyThisBoot, createHttpBootClassificationCall, readBootClassificationState, readHubStoragePosture, readMediaClaims, registrationOutcomeFor, writeBootClassificationState, } from "../boot-classification.js";
import { readImageEnv } from "../image-env.js";
import { readNetworkStatus } from "../network.js";
import { readRegistrationState } from "../registration-state.js";
const POLL_SECONDS = 60;
let lastLogLine = "";
function log(message) {
    process.stdout.write(`[kitluy-boot-classification] ${message}\n`);
}
/** One classification pass. Returns non-zero only when the image cannot be classified at all. */
export async function runBootClassificationPass() {
    const media = readMediaClaims();
    if (media === null) {
        log("refused: /etc/kitluy/image.env does not state a supported device class and environment");
        return 2;
    }
    const hardware = await new LinuxHardwareProbe().collect();
    const baseUrl = readImageEnv("KITLUY_ENROLLMENT_BASE_URL");
    const registration = registrationOutcomeFor(readRegistrationState()?.phase);
    const result = await classifyThisBoot({
        media,
        signals: bootSignalsFrom(hardware),
        ...(registration === undefined ? {} : { registration }),
        ...(media.imageDeviceClass === "store_hub" ? { storage: readHubStoragePosture() } : {}),
        networkUp: readNetworkStatus().hasLink,
        ...(baseUrl === undefined || baseUrl === ""
            ? {}
            : { call: createHttpBootClassificationCall({ baseUrl }) }),
        previous: readBootClassificationState(),
        now: new Date(),
    });
    writeBootClassificationState(result.state);
    // Logged only when it changes, so a healthy board does not fill the journal.
    if (result.logLine !== lastLogLine) {
        log(result.logLine);
        lastLogLine = result.logLine;
    }
    return 0;
}
export async function main() {
    for (;;) {
        try {
            if ((await runBootClassificationPass()) !== 0) {
                // An image that does not state its class cannot become classifiable by
                // waiting; exit non-zero so the unit shows failed instead of spinning.
                process.exitCode = 2;
                return;
            }
        }
        catch (error) {
            // A fault must not kill the unit: the screen would then freeze on its last
            // answer while the device's real state moved on.
            log(`pass failed: ${error instanceof Error ? error.message : "unexpected fault"}`);
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_SECONDS * 1000));
    }
}
// Loading is not booting: `package-bootstrap-runtime.sh` imports every packaged
// module under `node -e`, which leaves argv[1] undefined.
if (process.argv[1] !== undefined && process.argv[1].includes("boot-classification")) {
    void main();
}
//# sourceMappingURL=boot-classification.js.map