/**
 * What the Hub knows about its own OPERATIONAL TLS credential, and how it
 * survives a power cut.
 *
 * Authority: owner instruction 2026-08-28 Step 2; finding C-3 (a failed first
 * issuance must not brick a Hub); group 0205 (governed recovery).
 *
 * ===========================================================================
 * WHY THE REQUEST STATE IS WRITTEN BEFORE THE REQUEST IS SENT
 * ===========================================================================
 * The governed issuance is idempotent on the IDEMPOTENCY KEY, which is derived
 * from the signed `kitluy.csr.v1` preimage. Replaying therefore means sending
 * the SAME `requestId`, `nonce`, `correlationId`, `requestedAt` and key —
 * anything else is a different request, and a different request against a spent
 * generation is refused.
 *
 * So the request identity is persisted BEFORE the first network call. The
 * sequence that must survive is:
 *
 *     Hub sends the request -> cloud issues -> the response is lost ->
 *     Hub reboots -> Hub replays the SAME request -> same credential,
 *     same certificate, NO second generation consumed.
 *
 * A Hub that generated a fresh `requestId` after a reboot would ask for a second
 * identity, and generation 1 is spent exactly once.
 *
 * ===========================================================================
 * THE MANIFEST IS COMMITTED LAST
 * ===========================================================================
 * Certificate and chain are separate files, so there is a window in which one
 * exists and the other does not. `ADOPTED` is recorded in the manifest, and the
 * manifest is written after both — so a crash anywhere in that window leaves a
 * state that is NOT adopted, and the next boot re-verifies from files it can
 * re-fetch. The reverse order would let a crash produce a Hub that believes it
 * holds a credential it cannot present.
 */
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync, } from "node:fs";
import { dirname, join } from "node:path";
export const OPERATIONAL_DIR = "/var/lib/kitluy/operational";
export const OPERATIONAL_PATHS = {
    directory: OPERATIONAL_DIR,
    /** The private key. Never read by anything in this module. */
    privateKey: join(OPERATIONAL_DIR, "operational-tls.key.pem"),
    requestState: join(OPERATIONAL_DIR, "issuance-request.json"),
    certificate: join(OPERATIONAL_DIR, "operational-tls.crt.pem"),
    chain: join(OPERATIONAL_DIR, "operational-tls.chain.pem"),
    /** Written LAST. Its presence with phase ADOPTED is the only "yes". */
    manifest: join(OPERATIONAL_DIR, "operational-credential.json"),
};
const DIR_MODE = 0o700;
const FILE_MODE = 0o640;
/** temp -> fsync -> rename -> fsync(dir). The store convention, unchanged. */
function writeAtomic(path, contents, mode = FILE_MODE) {
    const dir = dirname(path);
    mkdirSync(dir, { recursive: true, mode: DIR_MODE });
    const temp = `${path}.tmp`;
    writeFileSync(temp, contents, { mode });
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
export function writeRequestState(state, paths = OPERATIONAL_PATHS) {
    writeAtomic(paths.requestState, `${JSON.stringify(state, null, 2)}\n`);
}
/**
 * Returns null when absent or unreadable.
 *
 * Unreadable reads as "no request yet", which is safe HERE and only here: a
 * fresh request is a new identity attempt, and the governed door refuses a
 * second one against a spent generation rather than issuing it. That refusal is
 * recoverable through group 0205; a fabricated request state would not be.
 */
export function readRequestState(paths = OPERATIONAL_PATHS) {
    try {
        const parsed = JSON.parse(readFileSync(paths.requestState, "utf8"));
        if (parsed === null || typeof parsed !== "object")
            return null;
        const candidate = parsed;
        // Every field that enters the signature must be present, or replaying would
        // produce DIFFERENT bytes and therefore a different request.
        const required = [
            "requestId",
            "deviceRecordId",
            "environment",
            "publicKeyFingerprint",
            "hardwareTrustLevel",
            "requestedPurpose",
            "requestedAt",
            "nonce",
            "correlationId",
        ];
        for (const field of required) {
            if (typeof candidate[field] !== "string" || candidate[field] === "")
                return null;
        }
        if (typeof candidate.assignmentGeneration !== "number")
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
export function readManifest(paths = OPERATIONAL_PATHS) {
    try {
        const parsed = JSON.parse(readFileSync(paths.manifest, "utf8"));
        if (parsed === null || typeof parsed !== "object")
            return null;
        const candidate = parsed;
        if (candidate.phase !== "ADOPTED")
            return null;
        if (typeof candidate.credentialId !== "string" || candidate.credentialId === "")
            return null;
        if (typeof candidate.certificateSha256 !== "string")
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
/**
 * Commit an adoption: certificate, then chain, then the manifest.
 *
 * ORDER IS THE POINT. Each write is individually atomic, but three writes are
 * not atomic together, so the ONLY ordering that is safe under a power cut is
 * the one where the record that says "usable" lands last. A crash between any
 * two of these leaves a Hub that is not adopted, which is recoverable; the
 * reverse order leaves a Hub that believes it holds a certificate it cannot
 * present, which is not.
 */
export function commitAdoption(input, paths = OPERATIONAL_PATHS) {
    writeAtomic(paths.certificate, input.certificatePem.endsWith("\n") ? input.certificatePem : `${input.certificatePem}\n`);
    writeAtomic(paths.chain, input.chainPem.endsWith("\n") ? input.chainPem : `${input.chainPem}\n`);
    writeAtomic(paths.manifest, `${JSON.stringify(input.manifest, null, 2)}\n`);
}
/**
 * What phase is this Hub actually in, judged from the disk alone.
 *
 * Deliberately conservative: it reports ADOPTED only when the manifest says so
 * AND both the certificate and the chain are present. A manifest without its
 * files is the shape a restored-from-backup or half-copied card produces, and it
 * must not read as a usable credential.
 */
export function currentPhase(paths = OPERATIONAL_PATHS) {
    const manifest = readManifest(paths);
    if (manifest !== null &&
        existsSync(paths.certificate) &&
        existsSync(paths.chain) &&
        existsSync(paths.privateKey)) {
        return "ADOPTED";
    }
    if (readRequestState(paths) !== null)
        return "REQUEST_READY";
    if (existsSync(paths.privateKey))
        return "KEY_READY";
    return "ABSENT";
}
//# sourceMappingURL=operational-credential-state.js.map