/**
 * The recovery identity proof, as the DEVICE builds and signs it.
 *
 * Authority: KLD-2026-09-14-REFLASH-CREDENTIAL-RECOVERY-001; migration group
 * 0224.
 *
 * ===========================================================================
 * WHAT IT IS FOR
 * ===========================================================================
 * A re-flashed board already holds an operational credential in the cloud, and
 * its private key went with the old SD card. The registry issues it a new
 * generation only as a governed RECOVERY, and recovery needs proof that the
 * request comes from THIS board: a signature by its Ed25519 device identity key
 * — the key its current enrollment recorded when the re-flashed board
 * registered — over this preimage.
 *
 * Attaching it to every certificate request is harmless: first issuance ignores
 * it, and it names nothing the request does not already carry.
 *
 * ===========================================================================
 * WHY THIS IS A SECOND COPY, AND WHY THAT IS SAFE
 * ===========================================================================
 * The authoritative definition is `recoveryIdentityProofBytes()` in
 * `packages/device-identity/src/operational-recovery-identity.ts`, and the
 * registry verifies with it. The firstboot agent ships inside the golden image
 * with zero runtime dependencies (see `operational-csr-bytes.ts`), so it cannot
 * import that package. `test/operational-recovery-identity-drift.test.ts`
 * builds the same input through BOTH implementations and fails if a single
 * byte differs.
 */
import { createHash, createPrivateKey, createPublicKey, sign as cryptoSign } from "node:crypto";
import { readFileSync } from "node:fs";

/** Domain separator. MUST equal the literal in `packages/device-identity`. */
export const RECOVERY_IDENTITY_PROOF_KIND = "kitluy.opcert-recovery-identity.v1" as const;

/**
 * Where `kitluy-firstboot.service` keeps the device identity key. The same path
 * `edge-pairing.ts` signs pairing proofs with; a test keeps the two equal.
 */
export const DEVICE_IDENTITY_PRIVATE_KEY_PATH = "/var/lib/kitluy/identity/device-identity.key.pem";

const HEX64 = /^[0-9a-f]{64}$/;

export function recoveryIdentityProofBytes(
  identityPublicKeyFingerprint: string,
  csrBytes: Uint8Array,
): Uint8Array {
  if (!HEX64.test(identityPublicKeyFingerprint)) {
    throw new Error(
      "KLUY-RECOVERY-IDENTITY-MALFORMED: the identity key fingerprint must be a lowercase sha-256 hex digest",
    );
  }
  const csrDigest = createHash("sha256").update(Buffer.from(csrBytes)).digest("hex");
  return new Uint8Array(
    Buffer.from(
      `${RECOVERY_IDENTITY_PROOF_KIND}\n${identityPublicKeyFingerprint}\n${csrDigest}`,
      "utf8",
    ),
  );
}

/** Public material only: the identity public key and a signature. */
export interface RecoveryIdentityProof {
  readonly identityPublicKeyPem: string;
  readonly identityProofBase64: string;
}

export type RecoveryIdentitySigner = (csrBytes: Uint8Array) => RecoveryIdentityProof;

export class RecoveryIdentityError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "RecoveryIdentityError";
  }
}

/**
 * Sign with the identity key on disk, read at the moment of signing.
 *
 * The private key never leaves this function, and a failure never quotes the
 * file: a PEM parse error can carry key fragments in its message.
 */
export function fileRecoveryIdentitySigner(
  keyPath: string = DEVICE_IDENTITY_PRIVATE_KEY_PATH,
): RecoveryIdentitySigner {
  return (csrBytes) => {
    let privateKey: ReturnType<typeof createPrivateKey>;
    try {
      privateKey = createPrivateKey(readFileSync(keyPath, "utf8"));
    } catch {
      throw new RecoveryIdentityError(
        `the device identity key at ${keyPath} could not be read (detail withheld)`,
      );
    }
    if (privateKey.asymmetricKeyType !== "ed25519") {
      throw new RecoveryIdentityError("the device identity key is not Ed25519");
    }
    const publicKey = createPublicKey(privateKey);
    const identityPublicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    // SHA-256 over the DER SPKI — the fingerprint the enrollment recorded.
    const fingerprint = createHash("sha256")
      .update(publicKey.export({ type: "spki", format: "der" }))
      .digest("hex");
    const signature = cryptoSign(
      null,
      Buffer.from(recoveryIdentityProofBytes(fingerprint, csrBytes)),
      privateKey,
    );
    return { identityPublicKeyPem, identityProofBase64: signature.toString("base64") };
  };
}
