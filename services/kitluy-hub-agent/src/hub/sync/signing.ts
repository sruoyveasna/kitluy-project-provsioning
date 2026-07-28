/**
 * WS-10-T002 — the Hub batch SIGNING SEAM.
 *
 * WHAT THIS FILE DOES NOT DO. It does not design a PKI. The root/CA design,
 * HSM/secure-element model and certificate windows are OWNER-REQUIRED values
 * tracked as **BLK-005** and are `[REQUIRED: ...]` until supplied — guessing
 * them would be inventing security architecture (repository rule 9). This file
 * defines the INTERFACE the transmission path signs through, plus a clearly
 * fenced development signer, so the rest of WS-10 can be built and tested
 * without pre-empting that decision.
 *
 * NO SECRET IS EMBEDDED HERE (repository rule 4). The development signer reads
 * its key from the environment, refuses to start without one, refuses a short
 * one, and refuses to run outside a local/development environment.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { SyncDeliveryError } from "./errors.js";

/** Environment variable holding the development batch-signing secret. */
export const DEV_BATCH_SIGNING_KEY_ENV = "KITLUY_HUB_DEV_BATCH_SIGNING_KEY";

/** Minimum development secret length. Not a policy value — a sanity floor. */
export const DEV_MIN_SIGNING_KEY_BYTES = 32;

/**
 * The production algorithm, key custody, rotation window and certificate chain
 * are owner/security decisions. Recorded verbatim so no reader mistakes the
 * development signer for the answer.
 */
export const PRODUCTION_BATCH_SIGNING_REQUIREMENT =
  "[REQUIRED: Hub batch signing key custody — algorithm, key storage (HSM/secure element), " +
  "certificate chain, rotation window and revocation propagation. Blocked on BLK-005 " +
  "(PKI root/CA design). No production signer may be implemented until these are supplied.]";

export interface BatchSignature {
  readonly algorithm: string;
  readonly keyId: string;
  /** Base64. Never a raw key, never a credential (repository rule 4). */
  readonly signature: string;
}

export interface HubBatchSigner {
  readonly keyId: string;
  readonly algorithm: string;
  /** Sign the canonical manifest bytes. */
  sign(manifest: string): BatchSignature;
}

export interface BatchSignatureVerifier {
  verify(manifest: string, signature: BatchSignature): boolean;
}

/**
 * DEVELOPMENT ONLY symmetric signer.
 *
 * A shared secret is NOT the production design: it cannot prove which Hub
 * signed, and every holder can forge. It exists so the transmission pipeline is
 * executable and testable end to end. `createProductionBatchSigner` refuses
 * outright rather than silently falling back to this.
 */
export class DevelopmentHmacBatchSigner implements HubBatchSigner, BatchSignatureVerifier {
  readonly algorithm = "hmac-sha256-development" as const;

  constructor(
    readonly keyId: string,
    private readonly secret: Buffer,
  ) {
    if (secret.length < DEV_MIN_SIGNING_KEY_BYTES) {
      throw new SyncDeliveryError(
        "EDGE_BATCH_SIGNATURE_MISSING",
        `The development batch signing key must be at least ${DEV_MIN_SIGNING_KEY_BYTES} bytes.`,
      );
    }
  }

  sign(manifest: string): BatchSignature {
    return {
      algorithm: this.algorithm,
      keyId: this.keyId,
      signature: createHmac("sha256", this.secret).update(manifest, "utf8").digest("base64"),
    };
  }

  verify(manifest: string, signature: BatchSignature): boolean {
    if (signature.algorithm !== this.algorithm || signature.keyId !== this.keyId) return false;
    const expected = Buffer.from(this.sign(manifest).signature, "base64");
    let presented: Buffer;
    try {
      presented = Buffer.from(signature.signature, "base64");
    } catch {
      return false;
    }
    if (expected.length !== presented.length) return false;
    return timingSafeEqual(expected, presented);
  }
}

/**
 * Build the development signer from the environment.
 *
 * Refuses when the environment is not local/development, so a development
 * signer can never be the thing signing real Store traffic.
 */
export function createDevelopmentBatchSigner(
  keyId: string,
  env: NodeJS.ProcessEnv = process.env,
): DevelopmentHmacBatchSigner {
  const environment = env.KITLUY_ENV ?? "local";
  if (environment !== "local" && environment !== "development") {
    throw new SyncDeliveryError(
      "EDGE_BATCH_SIGNATURE_MISSING",
      `The development batch signer refuses to run with KITLUY_ENV='${environment}'. ` +
        PRODUCTION_BATCH_SIGNING_REQUIREMENT,
    );
  }
  const raw = env[DEV_BATCH_SIGNING_KEY_ENV];
  if (!raw) {
    throw new SyncDeliveryError(
      "EDGE_BATCH_SIGNATURE_MISSING",
      `${DEV_BATCH_SIGNING_KEY_ENV} is not set. No default signing key exists — a hardcoded ` +
        "key would be a credential in source (repository rule 4).",
    );
  }
  return new DevelopmentHmacBatchSigner(keyId, Buffer.from(raw, "utf8"));
}

/**
 * There is no production signer, and pretending otherwise would be exactly the
 * kind of scaffolded-called-implemented claim the repository forbids
 * (rule 5).
 */
export function createProductionBatchSigner(): never {
  throw new SyncDeliveryError(
    "EDGE_BATCH_SIGNATURE_MISSING",
    `No production Hub batch signer is implemented. ${PRODUCTION_BATCH_SIGNING_REQUIREMENT}`,
  );
}
