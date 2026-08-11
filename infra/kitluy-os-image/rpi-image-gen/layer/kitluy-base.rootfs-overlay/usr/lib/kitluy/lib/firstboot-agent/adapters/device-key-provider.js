/**
 * Production `KeyProvider` — the device's Ed25519 identity key.
 *
 * Authority: KLD-2026-08-05-TERMINAL-TRANSPORT-001 locks `ed25519` as the
 *   device signature algorithm; @kitluy/device-identity THE IDENTITY RULE;
 *   BLK-005 (key custody and secure-element model) remains OPEN.
 *
 * ===========================================================================
 * WHAT THIS IS AND IS NOT
 * ===========================================================================
 * This is the DEVELOPMENT key backend: a file-backed private key on the
 * encrypted data partition, owner-readable only. It is deliberately shaped so
 * a secure-element backend can replace it without touching any caller —
 * `privateKeyHandle` is an OPAQUE reference, and every caller already treats it
 * as one. When BLK-005 rules the secure-element model, only this file changes.
 *
 * It is NOT a production custody solution and must not be described as one.
 *
 * ===========================================================================
 * THE PRIVATE KEY HAS NO PATH OUT
 * ===========================================================================
 * `generateKeyPair` returns the PUBLIC key PEM and a HANDLE. The private key
 * is written to disk and never returned, never logged, and never placed in an
 * error message — `StoredIdentity` has no field it could occupy, and neither
 * does `IdentityRecord`. `verifyKeyUsable` proves possession by SIGNING, which
 * requires no read-out of the material.
 */
import { generateKeyPairSync, sign, verify, createPrivateKey, createPublicKey } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_IDENTITY_DIR } from "./device-identity-store.js";
const DIR_MODE = 0o700;
const KEY_MODE = 0o600;
export const PRIVATE_KEY_FILE_NAME = "device-identity.key.pem";
/** Locked by KLD-2026-08-05-TERMINAL-TRANSPORT-001. Not a parameter. */
export const KEY_ALGORITHM = "ed25519";
export class FileKeyProvider {
    #directory;
    constructor(options = {}) {
        this.#directory = options.directory ?? DEFAULT_IDENTITY_DIR;
    }
    #keyPath() {
        return join(this.#directory, PRIVATE_KEY_FILE_NAME);
    }
    async generateKeyPair() {
        const { publicKey, privateKey } = generateKeyPairSync(KEY_ALGORITHM);
        const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
        const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
        mkdirSync(this.#directory, { recursive: true, mode: DIR_MODE });
        const path = this.#keyPath();
        // Mode is passed at creation AND re-applied: an existing file's mode is
        // not changed by writeFileSync's mode option, and a key that was ever
        // group-readable must not stay that way after a re-key.
        writeFileSync(path, privateKeyPem, { mode: KEY_MODE });
        chmodSync(path, KEY_MODE);
        // The handle is the path. It is opaque BY CONTRACT — no caller parses it,
        // and a secure-element backend would return a slot reference instead.
        return { publicKeyPem, privateKeyHandle: path };
    }
    /**
     * Usability is proven by a real sign/verify round trip, not by `existsSync`.
     *
     * A file that exists but is truncated, wrong-algorithm, or was restored from
     * another device's backup would pass an existence check and then fail at the
     * first enrollment attempt — after the fleet had already been told this
     * device is healthy. Signing is the only check that means what it says.
     */
    async verifyKeyUsable(privateKeyHandle) {
        try {
            const pem = readFileSync(privateKeyHandle, "utf8");
            const privateKey = createPrivateKey(pem);
            if (privateKey.asymmetricKeyType !== KEY_ALGORITHM)
                return false;
            const probe = Buffer.from("kitluy.firstboot.key-usability-probe.v1");
            const signature = sign(null, probe, privateKey);
            return verify(null, probe, createPublicKey(privateKey), signature);
        }
        catch {
            // Missing, unreadable, malformed or wrong-algorithm all mean the same
            // thing to the caller: re-key. The reason is deliberately not surfaced
            // here, because it would end up in a log line next to a key path.
            return false;
        }
    }
}
//# sourceMappingURL=device-key-provider.js.map