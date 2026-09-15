/**
 * The identity proof a RE-FLASHED device attaches to its operational
 * certificate request.
 *
 * Authority: KLD-2026-09-14-REFLASH-CREDENTIAL-RECOVERY-001; migration group
 * 0224 (`reserve_device_credential_recovery_v1`).
 *
 * ===========================================================================
 * WHY A SECOND SIGNATURE
 * ===========================================================================
 * `kitluy.csr.v1` proves possession of the NEW operational key, and nothing
 * else: any caller can generate a key and sign for it. First issuance is safe
 * anyway, because generation 1 can be spent exactly once. Recovery issues
 * generation N+1 to a device that already holds a credential, so possession of
 * a fresh key is not enough — the request must also come from the device.
 *
 * The device proves that with its Ed25519 DEVICE IDENTITY key, the one its
 * current enrollment recorded when the re-flashed board registered. The
 * signature is over THIS preimage, which binds:
 *
 *   - a domain separator, so the signature is useless as a pairing proof, a
 *     discovery record or a registration request, all of which the same key
 *     also signs;
 *   - the identity key's own fingerprint, so the proof names the key it claims
 *     to come from;
 *   - SHA-256 of the exact `kitluy.csr.v1` bytes, so the proof is bound to this
 *     request — its device, environment, operational key fingerprint, nonce,
 *     trusted timestamp and correlation id — and to no other.
 *
 * The service verifies the signature (OPTION B, as for every proof in this
 * repository); the database binds the verified fingerprint to the device's
 * current sealed enrollment.
 *
 * The device builds the same bytes in
 * `services/kitluy-device-firstboot-agent/src/operational-recovery-identity-bytes.ts`,
 * kept identical by that service's drift test.
 */
import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto";

import { publicKeyFingerprint } from "./dev-crypto.js";

/** Domain separator. The device copy MUST use the same literal. */
export const RECOVERY_IDENTITY_PROOF_KIND = "kitluy.opcert-recovery-identity.v1" as const;

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * The bytes the device identity key signs.
 *
 * Throws for a fingerprint that is not a lowercase SHA-256 hex digest: a
 * malformed fingerprint would still produce bytes, and a proof over them would
 * name no key at all.
 */
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

export type RecoveryIdentityVerdict =
  | { readonly verified: true; readonly identityPublicKeyFingerprint: string }
  | { readonly verified: false; readonly detail: string };

/**
 * Verify a recovery identity proof, from inside the trusted computing base.
 *
 * Ed25519 only: the device identity key is Ed25519 by construction
 * (`kitluy-firstboot.service`), and accepting another algorithm here would let
 * a key the enrollment never recorded the shape of stand in for it.
 */
export function verifyRecoveryIdentityProof(
  identityPublicKeyPem: string,
  csrBytes: Uint8Array,
  signature: Uint8Array,
): RecoveryIdentityVerdict {
  let fingerprint: string;
  try {
    const key = createPublicKey(identityPublicKeyPem);
    if (key.asymmetricKeyType !== "ed25519") {
      return {
        verified: false,
        detail: `the device identity key must be Ed25519; this key is ${key.asymmetricKeyType ?? "of an unknown type"}`,
      };
    }
    fingerprint = publicKeyFingerprint(identityPublicKeyPem);
  } catch {
    return {
      verified: false,
      detail: "the identity public key is not a readable PEM SubjectPublicKeyInfo",
    };
  }

  try {
    // Ed25519: one-shot, no digest argument.
    const ok = cryptoVerify(
      null,
      Buffer.from(recoveryIdentityProofBytes(fingerprint, csrBytes)),
      createPublicKey(identityPublicKeyPem),
      Buffer.from(signature),
    );
    return ok
      ? { verified: true, identityPublicKeyFingerprint: fingerprint }
      : {
          verified: false,
          detail:
            "the recovery identity signature does not verify under the presented identity key",
        };
  } catch {
    // A malformed signature is a failed proof, not an exception to propagate.
    return { verified: false, detail: "the recovery identity signature could not be verified" };
  }
}
