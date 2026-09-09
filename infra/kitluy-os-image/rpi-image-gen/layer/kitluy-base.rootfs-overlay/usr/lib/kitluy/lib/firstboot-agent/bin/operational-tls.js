/**
 * `kitluy-operational-tls` — the Hub obtains its operational TLS identity.
 *
 * Authority: owner instruction 2026-08-28 Step 2 and 2026-08-29 Step 3;
 * `kitluy.csr.v1`; findings C-1, C-2, C-3.
 *
 * ===========================================================================
 * WHERE THIS SITS IN THE FIRSTBOOT SEQUENCE, AND WHY
 * ===========================================================================
 * The lifecycle is six DISTINCT facts and this unit consumes the first four:
 *
 *     registration -> HET approval -> Store pairing -> trusted time
 *       -> CERTIFICATE (this unit) -> activation
 *
 * They are not collapsed and this unit does not attempt any of them. It refuses
 * to run until pairing has actually produced a `deviceRecordId`, because a
 * certificate is a statement about a device that belongs to a Store, and asking
 * for one before that is asking the governed doors a question they will
 * correctly refuse — `KLUY-KEY-NO-ASSIGNMENT` (group 0208, finding H-1).
 *
 * Trusted time is likewise NOT established here. It is the control plane's to
 * decide (group 0198 removed the caller's ability to name it at all), and this
 * unit only carries the value the governed bridge already produced.
 *
 * ===========================================================================
 * A LOOP, NOT A ONESHOT, AND NEVER A BOOT FAILURE
 * ===========================================================================
 * Like cloud registration, waiting is a HEALTHY state here: a Hub that has not
 * been paired yet is doing exactly the right thing, and the Store network is
 * frequently not up when firstboot runs. Neither may make the unit fail — a red
 * `systemctl status` for a designed resting state sends every installer hunting
 * a fault that does not exist.
 *
 * ===========================================================================
 * ONCE ADOPTED, THIS UNIT MAKES NO NETWORK CALL AT ALL
 * ===========================================================================
 * `ensureOperationalCertificate` answers `already_adopted` from disk before it
 * looks at a transport. That is what lets a provisioned Hub boot with the WAN
 * unplugged, and it is checked here again before the loop starts so the unit
 * exits immediately rather than idling.
 */
import { readFileSync } from "node:fs";
import { createHttpOperationalCertificateClient } from "../adapters/http-operational-certificate-client.js";
import { readImageEnv } from "../image-env.js";
import { readPairedIdentity } from "../paired-identity.js";
import { currentPhase, readManifest, OPERATIONAL_PATHS, } from "../operational-credential-state.js";
import { ensureOperationalCertificate } from "../operational-tls-client.js";
/** How long to wait between attempts while a prerequisite is missing. */
const IDLE_SECONDS = 30;
/** Where the pinned DEVELOPMENT root's digest is published in the image. */
const ROOT_PIN_PATH = "/etc/kitluy/development-root.sha256";
const log = (message) => {
    // eslint-disable-next-line no-console -- this unit's output IS its operator UI
    console.log(`[operational-tls] ${message}`);
};
function readRootPin() {
    try {
        const value = readFileSync(ROOT_PIN_PATH, "utf8").trim().toLowerCase();
        return /^[0-9a-f]{64}$/.test(value) ? value : null;
    }
    catch {
        return null;
    }
}
/**
 * The FLEET SERVICE origin — the host that serves `/v1/operational-certificate`.
 *
 * `KITLUY_ENROLLMENT_BASE_URL`, and deliberately NOT `KITLUY_REGISTRATION_URL`.
 * The image layer documents the two as different services and says why:
 * registration is a FULL url on the cloud registration route, while this route
 * lives on the device-registry service beside `/v1/device-enrollment` and
 * `/v1/hub-pairing` — see `adapters/http-operational-certificate-client.ts`,
 * whose named counterpart is
 * `kitluy-device-registry-service/src/operational-certificate-routes.ts`, and
 * `bin/hub-pairing-ui.ts`, which reaches `/v1/hub-pairing` from this same key.
 *
 * The original read `KITLUY_REGISTRATION_URL` and appended the certificate path
 * to it, which POSTs to `<registration-route>/v1/operational-certificate` — a
 * 404 on a host that does not serve this route, and indistinguishable to the
 * device from a genuine refusal. No test caught it because nothing in this file
 * was exported or took an `etcRoot`, so the image.env -> client composition was
 * never executed off-device.
 *
 * `etcRoot` exists so image configuration is testable off-device, exactly as
 * `image-env.ts` intends.
 */
export function readOperationalBaseUrl(etcRoot) {
    return readImageEnv("KITLUY_ENROLLMENT_BASE_URL", etcRoot);
}
async function once() {
    const phase = currentPhase();
    if (phase === "ADOPTED") {
        const manifest = readManifest();
        log(`already adopted: credential ${manifest?.credentialId ?? "?"} generation ` +
            `${String(manifest?.certificateGeneration ?? "?")} — no network call`);
        return "done";
    }
    // --- prerequisites, in lifecycle order -----------------------------------
    const baseUrl = readOperationalBaseUrl();
    if (baseUrl === undefined || baseUrl === "") {
        log("waiting: no KITLUY_ENROLLMENT_BASE_URL in /etc/kitluy/image.env");
        return "waiting";
    }
    const environment = readImageEnv("KITLUY_ENVIRONMENT") ?? "development";
    if (environment !== "development") {
        // BLK-005. A Hub must not attempt to obtain a pilot or production identity
        // even if an image were misconfigured to point at one.
        log(`blocked: environment "${environment}" is not development (BLK-005)`);
        return "blocked";
    }
    // BOTH device classes. A Hub pairs at its console and writes the canonical
    // pairing state; a Terminal pairs on its graphical shell, which is sandboxed
    // to /var/lib/kitluy/terminal and writes its seat there instead. Reading only
    // the Hub's file left a perfectly paired Terminal waiting for ever.
    const pairing = readPairedIdentity();
    if (pairing === null) {
        // Pairing is a DIFFERENT fact from registration and approval. Waiting here
        // is correct and is the designed resting state for an unpaired device.
        log("waiting: not paired yet");
        return "waiting";
    }
    log(`paired according to ${pairing.source}`);
    const rootPin = readRootPin();
    if (rootPin === null) {
        // Without the pin the device cannot tell OUR development root from a
        // perfectly self-consistent chain of somebody else's. Refusing is the only
        // safe answer; adopting unpinned would defeat the whole verification.
        log(`blocked: no development root pin at ${ROOT_PIN_PATH}`);
        return "blocked";
    }
    // From the paired identity, not an environment variable: a Terminal's seat
    // states its own generation, and requesting against the wrong one is refused
    // by `activate_device_v1` as KLUY-DEVICE-GENERATION-STALE. The env var still
    // wins where it is set, so an operator can still override for a Hub.
    const assignmentGeneration = Number(process.env.KITLUY_ASSIGNMENT_GENERATION ?? String(pairing.assignmentGeneration));
    const trustedTime = new Date();
    const outcome = await ensureOperationalCertificate({
        client: createHttpOperationalCertificateClient({ baseUrl }),
        deviceRecordId: pairing.deviceRecordId,
        environment,
        // TRUST LEVEL, NOT DEVICE CLASS. They are different vocabularies and this
        // line used to conflate them.
        //
        // `KITLUY_DEVICE_CLASS` is `store_hub` or `terminal` — WHAT the device is.
        // `hardware_trust_level` is an enum of HOW the key is protected:
        // development_software | tpm_2_0 | secure_element. `store_hub` is not a
        // member, so the database rejected it, the column went NULL, and
        // `concat_ws` in build_canonical_device_tbs_v1 SILENTLY DROPS a NULL
        // argument — 16 canonical fields where this package emits 17 (it writes
        // "-"). The bytes could never match, so ISSUE_CANONICAL_TBS_DIVERGENCE
        // fired on every attempt and nothing was ever signed.
        //
        // The `??` fallback never helped: the key is always present in image.env,
        // so the wrong value always won.
        //
        // A Store Hub built from this image holds its operational key in software
        // (see hub-storage-provision and BLK-005) — `development_software` is the
        // honest answer. When TPM or secure-element storage lands, this must read a
        // probed hardware fact, never an image constant.
        hardwareTrustLevel: "development_software",
        assignmentGeneration,
        trustedTime,
        expectedRootSha256: rootPin,
        paths: OPERATIONAL_PATHS,
    });
    switch (outcome.kind) {
        case "already_adopted":
            log("already adopted");
            return "done";
        case "adopted":
            // Only the FINGERPRINT and public identifiers are ever printed. The key
            // itself never leaves /var/lib/kitluy/operational.
            log(`ADOPTED: credential ${outcome.manifest.credentialId} generation ` +
                `${String(outcome.manifest.certificateGeneration)} serial ` +
                `${outcome.manifest.certificateSerial}` +
                (outcome.replayed ? " (replayed a previous request)" : ""));
            return "done";
        case "unreachable":
            log(`waiting: ${outcome.detail}`);
            return "waiting";
        case "refused":
            // The typed refusal code, verbatim. A retryable one is a waiting state; a
            // decision about the request is not, and repeating it would just repeat
            // the refusal.
            log(`refused: ${outcome.refusal.refusalCode} — ${outcome.refusal.detail}`);
            return outcome.refusal.retryable ? "waiting" : "blocked";
        case "verification_failed":
            // Nothing was written. This is a server or a network that produced a
            // certificate this Hub will not adopt, and it is loud on purpose.
            for (const failure of outcome.failures) {
                log(`REFUSED TO ADOPT: ${failure.check} — ${failure.detail}`);
            }
            return "blocked";
        case "blocked":
            log(`blocked: ${outcome.detail}`);
            return "blocked";
    }
}
async function main() {
    for (;;) {
        let result;
        try {
            result = await once();
        }
        catch (error) {
            // Never crash the unit. An unexpected fault is a waiting state, because
            // the alternative is a Hub that stops trying until someone reboots it.
            log(`waiting after an unexpected fault: ${error instanceof Error ? error.name : "unknown"}`);
            result = "waiting";
        }
        if (result === "done")
            return;
        await new Promise((resolve) => setTimeout(resolve, IDLE_SECONDS * 1000));
    }
}
// SELF-EXECUTION GUARD, and it is load-bearing at BUILD time.
//
// The packaging script imports every packaged module to prove it loads. A bare
// top-level `await main()` would therefore start this unit's polling loop inside
// the image build and hang it for ever. The same guard every other entrypoint
// uses: `node -e` leaves argv[1] undefined, so loading is not booting.
if (process.argv[1] !== undefined && process.argv[1].includes("operational-tls")) {
    void main();
}
//# sourceMappingURL=operational-tls.js.map