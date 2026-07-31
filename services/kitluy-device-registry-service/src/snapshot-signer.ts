/**
 * The CLOUD-SIDE snapshot signer.
 *
 * Authority: KLD-2026-07-31-HUB-SNAPSHOT-SIGNING-001 (owner-locked); repository
 * rule 4 (no credentials in code, config, logs or docs — `.env.example` holds
 * names only); WS-11-T003 Step 4 final offline completion §2.
 *
 * ===========================================================================
 * HOW THE PRIVATE KEY IS HANDLED, AND HOW IT IS NOT
 * ===========================================================================
 * The key is read from the process environment, by NAME, at the moment of
 * signing, and is dropped when the call returns. It is never:
 *
 *   * a parameter or a return value — `SnapshotSigningKeyReference` carries an
 *     env-var NAME and a key identity, never material;
 *   * logged — the only fields this module logs are `keyId` and `keyVersion`;
 *   * placed in an error — a failure names the VARIABLE, never its contents,
 *     because a "malformed key: -----BEGIN..." message is a key disclosure with
 *     an apology attached;
 *   * written to the database, to Git, or to a Hub. A Hub holds public halves.
 *
 * ===========================================================================
 * AN UNAVAILABLE SIGNER STOPS PUBLICATION
 * ===========================================================================
 * {@link createUnavailableSnapshotSigner} is the default, and it throws. There is
 * no unsigned fallback anywhere in this file: the owner policy forbids one, and an
 * unsigned snapshot a Hub accepted would be an unsigned snapshot an attacker could
 * also mint. A deployment without a key reference cannot publish, which is the
 * intended failure.
 */
import { createHash } from "node:crypto";

import { ConfigError, type Env } from "@kitluy/shared-config";
import {
  SNAPSHOT_SIGNATURE_ALGORITHM,
  signCanonicalBytesWithPem,
  type SnapshotSignatureEnvelope,
  type SnapshotSigner,
  type SnapshotSigningKeyReference,
} from "@kitluy/device-identity";

/**
 * The environment variable naming the signing key reference.
 *
 * Two variables, deliberately: one names the SECRET's variable, the other the key
 * identity. Splitting them means a key rotation changes an id and a version
 * without anything having to move the secret, and it keeps the secret's name out
 * of the snapshot metadata.
 */
export const SNAPSHOT_SIGNING_KEY_ENV = "DEVICE_SNAPSHOT_SIGNING_KEY_ENV" as const;
export const SNAPSHOT_SIGNING_KEY_ID = "DEVICE_SNAPSHOT_SIGNING_KEY_ID" as const;
export const SNAPSHOT_SIGNING_KEY_VERSION = "DEVICE_SNAPSHOT_SIGNING_KEY_VERSION" as const;

export class SnapshotSignerUnavailableError extends Error {
  constructor(detail: string) {
    super(`the snapshot signer is unavailable: ${detail}`);
    this.name = "SnapshotSignerUnavailableError";
  }
}

/**
 * Resolves the key REFERENCE from the environment. Reads no secret.
 *
 * Returns null rather than throwing so a composition root can decide whether an
 * absent signer is a startup refusal or a capability this instance simply lacks.
 */
export function resolveSigningKeyReference(
  env: Env = process.env,
): SnapshotSigningKeyReference | null {
  const secretEnvVar = env[SNAPSHOT_SIGNING_KEY_ENV]?.trim() ?? "";
  const keyId = env[SNAPSHOT_SIGNING_KEY_ID]?.trim() ?? "";
  const rawVersion = env[SNAPSHOT_SIGNING_KEY_VERSION]?.trim() ?? "";
  if (secretEnvVar === "" || keyId === "") return null;

  const keyVersion = Number(rawVersion);
  if (!Number.isInteger(keyVersion) || keyVersion < 1) {
    // A version that is absent or nonsense is a MISCONFIGURATION, not a default.
    // Silently signing as version 1 would let a rotated key masquerade as its
    // predecessor and keep verifying against the wrong public half.
    throw new ConfigError(
      SNAPSHOT_SIGNING_KEY_VERSION,
      `${SNAPSHOT_SIGNING_KEY_VERSION} must be a positive integer naming the key version.`,
    );
  }
  return { secretEnvVar, keyId, keyVersion };
}

/** The shipped default. Refuses, so nothing can publish unsigned. */
export function createUnavailableSnapshotSigner(reason: string): SnapshotSigner {
  return {
    signCanonicalSnapshot(): Promise<SnapshotSignatureEnvelope> {
      return Promise.reject(new SnapshotSignerUnavailableError(reason));
    },
  };
}

export interface SnapshotSigningAudit {
  /** Called once per signature. Receives NO key material, by construction. */
  record(event: {
    readonly keyId: string;
    readonly keyVersion: number;
    readonly algorithm: string;
    readonly canonicalDigest: string;
    readonly correlationId: string;
  }): void;
}

/**
 * The production Ed25519 signer.
 *
 * `env` is captured rather than read from `process.env` at call time so a test can
 * supply an ephemeral key without touching the real process environment — and so
 * the set of variables this signer can ever read is fixed when it is built.
 */
export function createEd25519SnapshotSigner(options: {
  readonly env?: Env;
  readonly audit?: SnapshotSigningAudit;
  readonly correlationId?: () => string;
}): SnapshotSigner {
  const env = options.env ?? process.env;
  return {
    signCanonicalSnapshot(
      canonicalBytes: Uint8Array,
      keyReference: SnapshotSigningKeyReference,
    ): Promise<SnapshotSignatureEnvelope> {
      const pem = env[keyReference.secretEnvVar];
      if (pem === undefined || pem.trim() === "") {
        // Names the VARIABLE, never its contents.
        return Promise.reject(
          new SnapshotSignerUnavailableError(
            `environment variable ${keyReference.secretEnvVar} holds no signing key`,
          ),
        );
      }

      let signature: string;
      try {
        signature = signCanonicalBytesWithPem(canonicalBytes, pem);
      } catch {
        // The underlying error can carry PEM fragments in its message. It is
        // swallowed and replaced, not wrapped.
        return Promise.reject(
          new SnapshotSignerUnavailableError(
            `the key in ${keyReference.secretEnvVar} could not produce an ${SNAPSHOT_SIGNATURE_ALGORITHM} signature`,
          ),
        );
      }

      const envelope: SnapshotSignatureEnvelope = {
        keyId: keyReference.keyId,
        keyVersion: keyReference.keyVersion,
        algorithm: SNAPSHOT_SIGNATURE_ALGORITHM,
        signature,
      };

      options.audit?.record({
        keyId: envelope.keyId,
        keyVersion: envelope.keyVersion,
        algorithm: envelope.algorithm,
        // The DIGEST of what was signed — not the bytes, and not the key. Enough
        // to correlate a signature with the snapshot it covers without carrying
        // either the payload or anything secret into the audit trail.
        canonicalDigest: createHash("sha256").update(canonicalBytes).digest("hex"),
        correlationId: options.correlationId?.() ?? "",
      });

      return Promise.resolve(envelope);
    },
  };
}
