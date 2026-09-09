/**
 * The Store Hub's OPERATIONAL TLS private key: generated here, and never
 * anywhere else.
 *
 * Authority: owner instruction 2026-08-28 Step 2; KLD-2026-07-28-002 (BLK-005) —
 * development certificate implementation AUTHORIZED, pilot and production
 * BLOCKED; `DEV_TLS_ALGORITHM_IS_PROVISIONAL`.
 *
 * ===========================================================================
 * THE ONE RULE
 * ===========================================================================
 * The private key is generated on the Hub and never leaves it. Not into
 * PostgreSQL, not into a request body, not into a log line, not into an error
 * message, not into a handoff file, and not into the golden image. Only the
 * PUBLIC half and a fingerprint ever travel.
 *
 * That is not a policy statement bolted on afterwards — it is why the whole
 * proof-of-possession contract exists. A certificate is a statement about a key,
 * and if the control plane held the key it would be certifying itself.
 *
 * ===========================================================================
 * GENERATE ONCE. REUSE. NEVER SILENTLY REPLACE.
 * ===========================================================================
 * A Hub that generated a new key on every boot would burn its one generation-1
 * slot on the first attempt and then be permanently unissuable — that is exactly
 * the brick finding C-3 was about. So:
 *
 *   a valid key exists      -> REUSE it
 *   no key exists           -> generate exactly one
 *   a malformed key exists  -> FAIL CLOSED
 *   a partial write exists  -> FAIL CLOSED, and say which file to look at
 *
 * "Malformed means regenerate" would be the convenient rule and it is the
 * dangerous one: a device that replaces its own identity whenever it cannot read
 * it turns one bad write into a silent identity change, and the governed doors
 * would then refuse it for a reason that looks nothing like the cause.
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, createHash, } from "node:crypto";
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, } from "node:fs";
import { dirname } from "node:path";
/** The DEVELOPMENT operational TLS profile. Provisional; see BLK-005. */
export const OPERATIONAL_KEY_TYPE = "rsa";
export const OPERATIONAL_KEY_BITS = 2048;
export const OPERATIONAL_KEY_ALGORITHM = "rsa-2048";
export const OPERATIONAL_KEY_PATH = "/var/lib/kitluy/operational/operational-tls.key.pem";
const DIR_MODE = 0o700;
const KEY_MODE = 0o600;
/**
 * Raised when the key cannot be used. Names the FILE, never its contents — a
 * PEM parse failure can carry key fragments in its message, so underlying errors
 * are swallowed and replaced rather than wrapped.
 */
export class OperationalKeyError extends Error {
    constructor(reason) {
        super(`KLUY-OPKEY: ${reason}`);
        this.name = "OperationalKeyError";
    }
}
/** SHA-256 over the DER SPKI. Identical to the server's `operationalKeyFingerprint`. */
export function operationalKeyFingerprint(publicKeyPem) {
    const der = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
    return createHash("sha256").update(new Uint8Array(der)).digest("hex");
}
/** Refuse a key file anyone but its owner can read. */
function assertKeyMode(path) {
    let mode;
    try {
        mode = statSync(path).mode & 0o777;
    }
    catch {
        throw new OperationalKeyError(`${path} is not readable`);
    }
    if ((mode & 0o077) !== 0) {
        throw new OperationalKeyError(`${path} is mode ${mode.toString(8)}; the operational key must be owner-only (0600)`);
    }
}
/** Parse a stored key, or refuse. Never regenerates over a bad one. */
function loadExisting(path) {
    assertKeyMode(path);
    let pem;
    try {
        pem = readFileSync(path, "utf8");
    }
    catch {
        throw new OperationalKeyError(`${path} exists but could not be read`);
    }
    if (!pem.includes("PRIVATE KEY")) {
        // A partial write lands here: the file exists, has the right mode, and is
        // not a key. Refusing is the whole point — see the header.
        throw new OperationalKeyError(`${path} is not a PEM private key; it may be a partial write. ` +
            "Refusing to replace an operational identity that cannot be read.");
    }
    let key;
    try {
        key = createPrivateKey(pem);
    }
    catch {
        throw new OperationalKeyError(`${path} could not be parsed as a private key; the underlying reason is withheld ` +
            "because it can contain key material. Refusing to replace it.");
    }
    if (key.asymmetricKeyType !== OPERATIONAL_KEY_TYPE) {
        throw new OperationalKeyError(`${path} holds a ${key.asymmetricKeyType ?? "unknown"} key; this profile requires ` +
            `${OPERATIONAL_KEY_ALGORITHM}. Refusing to replace it.`);
    }
    const bits = key.asymmetricKeyDetails?.modulusLength;
    if (bits !== OPERATIONAL_KEY_BITS) {
        throw new OperationalKeyError(`${path} holds an RSA-${bits ?? "unknown"} key; this profile requires ` +
            `${OPERATIONAL_KEY_ALGORITHM}. Refusing to replace it.`);
    }
    return {
        key,
        publicKeyPem: createPublicKey(key).export({ type: "spki", format: "pem" }).toString(),
    };
}
/**
 * Return the Hub's operational key, generating it exactly once.
 *
 * Atomic creation: the key is written to a temporary file, fsynced, and renamed
 * into place, with the directory fsynced after. A power loss therefore leaves
 * either no key or a whole one — never a truncated PEM that a later boot would
 * have to guess about.
 */
export function ensureOperationalKey(path = OPERATIONAL_KEY_PATH) {
    if (existsSync(path)) {
        const { publicKeyPem } = loadExisting(path);
        return {
            publicKeyPem,
            publicKeyFingerprint: operationalKeyFingerprint(publicKeyPem),
            generated: false,
            path,
        };
    }
    const dir = dirname(path);
    mkdirSync(dir, { recursive: true, mode: DIR_MODE });
    const { publicKey, privateKey } = generateKeyPairSync(OPERATIONAL_KEY_TYPE, {
        modulusLength: OPERATIONAL_KEY_BITS,
    });
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const temp = `${path}.tmp`;
    try {
        // Mode is set at creation AND enforced afterwards: `writeFileSync`'s mode is
        // subject to the process umask, and a key that was ever group-readable has
        // already leaked.
        writeFileSync(temp, privateKeyPem, { mode: KEY_MODE, flag: "wx" });
        chmodSync(temp, KEY_MODE);
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
    catch (error) {
        // Leave nothing half-written behind.
        try {
            if (existsSync(temp))
                unlinkSync(temp);
        }
        catch {
            /* the refusal below is the useful signal */
        }
        if (error instanceof OperationalKeyError)
            throw error;
        throw new OperationalKeyError(`could not create ${path}; the underlying reason is withheld because it can ` +
            "contain key material");
    }
    return {
        publicKeyPem,
        publicKeyFingerprint: operationalKeyFingerprint(publicKeyPem),
        generated: true,
        path,
    };
}
/**
 * Run `use` with the operational PRIVATE key, and drop it on return.
 *
 * The key is a local `const` and is never returned, logged, or placed in an
 * error. Callers pass it straight to a signing call — the same custody shape
 * `withIssuingCaKey` uses on the server side.
 */
export function withOperationalPrivateKey(use, path = OPERATIONAL_KEY_PATH) {
    const { key } = loadExisting(path);
    try {
        return use(key);
    }
    catch (error) {
        if (error instanceof OperationalKeyError)
            throw error;
        throw new OperationalKeyError("the operational key could not complete the requested operation; the underlying " +
            "reason is withheld because it can contain key material");
    }
}
//# sourceMappingURL=operational-key.js.map