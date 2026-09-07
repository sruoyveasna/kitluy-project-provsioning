/**
 * Transactional issuance adapter — WS-11-T003 Step 4.
 *
 * Authority: KLD-2026-07-28-002 §4, §5, §12.6; the owner's Step 4 instruction
 * and the 2026-07-28 cryptographic-verification-boundary ruling.
 *
 * ===========================================================================
 * WHY THIS IS THREE CALLS AND NOT ONE
 * ===========================================================================
 * The private-key operation cannot participate in a PostgreSQL transaction. A
 * single call would either hold a transaction open across signing, or lose the
 * signature when the final commit fails. So issuance is:
 *
 *     prepare   (transaction 1) — reserve identifiers, build the TBS, commit
 *     sign      (no transaction) — the CA signs exactly the reserved bytes
 *     record    (transaction 2) — make the signature DURABLE before success
 *     finalize  (transaction 3) — credential, chain, head and audit, atomically
 *
 * The middle step is what makes a crash recoverable: after it commits, the
 * original signature is on disk and recovery re-uses it rather than minting a
 * second one for the same request.
 *
 * ===========================================================================
 * CRYPTOGRAPHIC VERIFICATION BOUNDARY — OPTION B
 * ===========================================================================
 * PostgreSQL has NO Ed25519 verification primitive in this stack (probed:
 * pgcrypto offers PGP encryption only; pgsodium is available but not installed
 * and never reviewed). So THIS MODULE performs the cryptographic verification,
 * and therefore THIS MODULE IS INSIDE THE TRUSTED COMPUTING BASE
 * (KLRISK-DEVICE-003). That is a real limitation, recorded rather than papered
 * over by installing an unreviewed extension.
 *
 * What the database still enforces without trusting this module: the canonical
 * TBS is BUILT there and only echoed back here, hashes are recomputed there,
 * the state machine and head compare-and-swap are enforced there, and the
 * executing identity is checked there. This module cannot substitute a serial,
 * a generation, a credential id, a validity window or a device.
 */

import { createHash } from "node:crypto";

import {
  publicKeyFingerprint,
  tbsBytes,
  verifyDetachedSignature,
  type Certificate,
  type CertificateAuthorityProvider,
  type CertificateChain,
} from "./dev-crypto.js";
import type { HardwareTrustLevel } from "./index.js";

// ---------------------------------------------------------------------------
// The database boundary
// ---------------------------------------------------------------------------

/** What `prepare_device_credential_issuance_v1` returns. */
export interface PreparedReservation {
  readonly outcome: "RESERVED" | "REPLAYED_RESERVATION" | "ALREADY_ISSUED";
  readonly attemptId?: string;
  readonly requestId: string;
  readonly credentialId: string;
  readonly serialNumber: string;
  readonly certificateGeneration: number;
  readonly assignmentGeneration?: number;
  readonly issuerKeyId?: string;
  /** ISO-8601 with milliseconds, rendered by the database. */
  readonly notBefore?: string;
  readonly notAfter?: string;
  readonly canonicalTbs?: string;
  readonly canonicalTbsHash?: string;
  readonly headVersionSeen?: number;
  readonly alreadySigned?: boolean;
}

export interface PrepareInput {
  readonly requestId: string;
  readonly deviceRecordId: string;
  readonly environment: string;
  readonly purpose: string;
  readonly assignmentGeneration: number;
  readonly publicKeyPem: string;
  readonly publicKeyFingerprint: string;
  readonly idempotencyKey: string;
  readonly canonicalPayloadHash: string;
  readonly popAlgorithm: string;
  readonly popSignedPreimageHash: string;
  readonly popSignature: Uint8Array;
  /** OPTION B: this module's own verdict on the device's proof of possession. */
  readonly popServiceVerified: boolean;
  readonly issuerKeyId: string;
  readonly trustedTime: Date;
  readonly trustedTimeStatus: string;
  readonly actorRef: string;
}

export interface ChainLinkInput {
  readonly linkPosition: number;
  readonly role: "root" | "intermediate" | "device";
  readonly subjectFingerprint: string;
  readonly issuerKeyId: string;
  readonly canonicalTbs: string;
  readonly detachedSignatureB64: string;
}

export interface FinalizedCredential {
  readonly outcome: "ISSUED" | "ALREADY_ISSUED";
  readonly credentialId: string;
  readonly serialNumber: string;
  readonly certificateGeneration: number;
  readonly notBefore?: string;
  readonly notAfter?: string;
  readonly verificationBoundary?: string;
}

/**
 * The three governed functions. Implemented against the real database in
 * integration tests; injectable so the adapter's failure semantics can be
 * exercised without one.
 */
export interface GovernedIssuanceGateway {
  prepare(input: PrepareInput): Promise<PreparedReservation>;
  recordSignature(input: {
    readonly requestId: string;
    readonly canonicalTbsHash: string;
    readonly detachedSignature: Uint8Array;
    readonly serviceVerified: boolean;
    readonly actorRef: string;
  }): Promise<{ readonly outcome: string }>;
  finalize(input: {
    readonly requestId: string;
    readonly chainLinks: readonly ChainLinkInput[];
    readonly actorRef: string;
  }): Promise<FinalizedCredential>;
  recordOrphanSignature(input: {
    readonly requestId: string;
    readonly deviceRecordId: string;
    readonly serialNumber: string;
    readonly idempotencyKey: string;
    readonly signatureSha256: string;
    readonly detail: string;
  }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Outcome
// ---------------------------------------------------------------------------

export type AdapterRefusalCode =
  /** The two layers disagree about canonicalization. Nothing was signed. */
  | "ISSUE_CANONICAL_TBS_DIVERGENCE"
  /** The database's TBS hash does not match the TBS it sent. Nothing signed. */
  | "ISSUE_CANONICAL_TBS_HASH_DIVERGENCE"
  /** The CA threw. Nothing was signed; the reservation stays usable. */
  | "ISSUE_SIGNING_FAILED"
  /** The CA returned a signature that does not verify. NEVER recorded. */
  | "ISSUE_SIGNATURE_SELF_VERIFICATION_FAILED"
  /** Signed, but the signature did not become durable. Orphan. */
  | "ISSUE_SIGNATURE_NOT_PERSISTED"
  /** Signature IS durable; the final transaction failed. Recoverable. */
  | "ISSUE_FINALIZATION_FAILED"
  /** The database refused. Its typed code is carried through in `detail`. */
  | "ISSUE_REFUSED_BY_DATABASE";

export interface AdapterOutcome {
  readonly outcome: "ISSUED" | "REPLAYED" | "REFUSED";
  readonly credential?: FinalizedCredential;
  readonly certificate?: Certificate;
  readonly chain?: CertificateChain;
  readonly refusalCode?: AdapterRefusalCode;
  /** The database's own error text, preserved verbatim. Never flattened. */
  readonly detail?: string;
  /**
   * Set ONLY when a signature exists that no durable record accounts for.
   * Recorded, never silently retried: a retry would ask the CA to sign again
   * for the same request, and the operator needs to know a signature is loose.
   */
  readonly orphanSignature?: {
    readonly requestId: string;
    readonly serialNumber: string;
    readonly signatureSha256: string;
    readonly detail: string;
  };
  /**
   * True when the signature is durable and finalization may be retried with
   * the ORIGINAL signature. This is the difference between "recoverable" and
   * "orphaned", and the two must not be conflated.
   */
  readonly recoverableFromRecordedSignature?: boolean;
}

const sha256Hex = (value: Uint8Array | string): string =>
  createHash("sha256")
    .update(typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value))
    .digest("hex");

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

export interface PipelineInput extends PrepareInput {
  readonly hardwareTrustLevel: HardwareTrustLevel;
}

/**
 * Runs prepare -> sign -> record -> finalize.
 *
 * This is ALSO the recovery path. `prepare` is idempotent, so re-running after
 * a crash returns the same reservation; if the signature was already recorded,
 * signing is skipped entirely and the original signature is finalized.
 *
 * The adapter allocates NOTHING. Serial, generation, credential id, validity
 * window and canonical TBS all come from the database. There is no code path
 * here that creates a second request, serial, generation or credential id.
 */
export async function runGovernedIssuance(
  input: PipelineInput,
  gateway: GovernedIssuanceGateway,
  /**
   * WIDENED to the interface this function actually uses. The body touches only
   * `issueDeviceCertificate`, `rootCertificate` and `intermediateCertificate`,
   * which is exactly `CertificateAuthorityProvider`. The concrete type was a
   * narrower requirement than the code had, and it forced every caller to use
   * the EPHEMERAL development CA — the one that mints a new identity per
   * process and orphans everything it signed before. No behaviour changes here;
   * a persistent provider simply becomes expressible.
   */
  ca: CertificateAuthorityProvider,
): Promise<AdapterOutcome> {
  // -- 1. PREPARE ------------------------------------------------------------
  let reservation: PreparedReservation;
  try {
    reservation = await gateway.prepare(input);
  } catch (error) {
    // A database refusal keeps its exact code. It is not flattened into a
    // generic failure, because the caller needs to distinguish "stale
    // assignment" from "device quarantined" from "no trusted time".
    return {
      outcome: "REFUSED",
      refusalCode: "ISSUE_REFUSED_BY_DATABASE",
      detail: errorText(error),
    };
  }

  if (reservation.outcome === "ALREADY_ISSUED") {
    return {
      outcome: "REPLAYED",
      credential: {
        outcome: "ALREADY_ISSUED",
        credentialId: reservation.credentialId,
        serialNumber: reservation.serialNumber,
        certificateGeneration: reservation.certificateGeneration,
      },
    };
  }

  const canonicalTbs = reservation.canonicalTbs ?? "";
  const canonicalTbsHash = reservation.canonicalTbsHash ?? "";

  // -- 2. CROSS-LAYER CONFORMANCE, BEFORE ANY SIGNING -----------------------
  // The database's TBS is checked against its own hash first: if those two
  // disagree the transport mangled something, and signing would commit the
  // damage.
  if (sha256Hex(canonicalTbs) !== canonicalTbsHash) {
    return {
      outcome: "REFUSED",
      refusalCode: "ISSUE_CANONICAL_TBS_HASH_DIVERGENCE",
      detail: "the reserved TBS does not hash to the reserved hash",
    };
  }

  // Now rebuild the same TBS from the reserved values using THIS package's
  // canonicalization and require byte equality. If the two layers ever drift
  // apart, issuance stops here with nothing signed — rather than producing a
  // signature over bytes the database will not recognise. This is the
  // RV-TT-001 lesson: cross-layer divergence must be loud, not silent.
  const locallyBuilt = Buffer.from(
    tbsBytes({
      certificateId: reservation.credentialId,
      serialNumber: reservation.serialNumber,
      role: "device",
      purpose: "device_identity",
      environment: "development",
      subjectFingerprint: input.publicKeyFingerprint,
      subjectPublicKeyPem: input.publicKeyPem,
      issuerKeyId: reservation.issuerKeyId ?? input.issuerKeyId,
      deviceRecordId: input.deviceRecordId,
      certificateGeneration: reservation.certificateGeneration,
      hardwareTrustLevel: input.hardwareTrustLevel,
      productionEligible: false,
      notBefore: reservation.notBefore ?? "",
      notAfter: reservation.notAfter ?? "",
    }),
  ).toString("utf8");

  if (locallyBuilt !== canonicalTbs) {
    // NAME THE FIELD THAT DIVERGED.
    //
    // "the two layers disagree" is true and useless: the canonical form is a
    // newline-joined record, so the fields are positional and the first
    // mismatch identifies the culprit exactly. Without this a divergence is an
    // afternoon of guessing — which is how it was found the first time.
    //
    // Only the POSITION and LENGTHS are reported. The values themselves are a
    // public key, a fingerprint and timestamps, but this string reaches an
    // unauthenticated device, so it carries no content.
    const mine = locallyBuilt.split("\n");
    const theirs = canonicalTbs.split("\n");
    let where = "field counts differ";
    if (mine.length === theirs.length) {
      const i = mine.findIndex((line, n) => line !== theirs[n]);
      where =
        i === -1
          ? "no field differs (trailing bytes?)"
          : `field ${i + 1} of ${mine.length} (local ${mine[i]?.length ?? 0} chars, database ${theirs[i]?.length ?? 0})`;
    } else {
      where = `field count: local ${mine.length}, database ${theirs.length}`;
    }
    return {
      outcome: "REFUSED",
      refusalCode: "ISSUE_CANONICAL_TBS_DIVERGENCE",
      detail:
        "the database and the device-identity package disagree about canonical TBS bytes; " +
        `nothing was signed — ${where}`,
    };
  }

  // -- 3. SIGN, EXACTLY ONCE ------------------------------------------------
  // Skipped entirely on recovery: if the signature is already durable, asking
  // the CA again would be a second signing operation for one request.
  let certificate: Certificate | undefined;
  if (reservation.alreadySigned !== true) {
    try {
      certificate = ca.issueDeviceCertificate({
        deviceRecordId: input.deviceRecordId,
        subjectPublicKeyPem: input.publicKeyPem,
        subjectFingerprint: input.publicKeyFingerprint,
        hardwareTrustLevel: input.hardwareTrustLevel,
        certificateGeneration: reservation.certificateGeneration,
        notBefore: new Date(reservation.notBefore ?? ""),
        notAfter: new Date(reservation.notAfter ?? ""),
        serialNumber: reservation.serialNumber,
        certificateId: reservation.credentialId,
      });
    } catch (error) {
      // Nothing was signed. The reservation is intact and the SAME request can
      // be retried; it will replay onto the same attempt and the same TBS.
      return {
        outcome: "REFUSED",
        refusalCode: "ISSUE_SIGNING_FAILED",
        detail: errorText(error),
      };
    }

    // The CA is asked to sign the reserved bytes; prove it did. A CA that
    // rebuilt the TBS differently produces a signature over other bytes, and
    // that must never reach the database.
    const signedBytes = Buffer.from(tbsBytes(certificate.tbs)).toString("utf8");
    if (signedBytes !== canonicalTbs) {
      return {
        outcome: "REFUSED",
        refusalCode: "ISSUE_CANONICAL_TBS_DIVERGENCE",
        detail: "the CA signed bytes other than the reserved canonical TBS",
      };
    }

    // OPTION B in one line: this verification is the ONLY cryptographic check
    // in the whole pipeline, and it happens here because the database cannot
    // perform it. A signature that does not verify is never recorded.
    const verified = verifyDetachedSignature(
      ca.intermediateCertificate.tbs.subjectPublicKeyPem,
      Buffer.from(canonicalTbs, "utf8"),
      certificate.signature,
    );
    if (!verified) {
      return {
        outcome: "REFUSED",
        refusalCode: "ISSUE_SIGNATURE_SELF_VERIFICATION_FAILED",
        detail: "the CA returned a signature that does not verify under its own issuing key",
      };
    }

    // -- 4. MAKE IT DURABLE, BEFORE REPORTING ANY SUCCESS -------------------
    try {
      await gateway.recordSignature({
        requestId: input.requestId,
        canonicalTbsHash,
        detachedSignature: certificate.signature,
        serviceVerified: true,
        actorRef: input.actorRef,
      });
    } catch (error) {
      // A signature exists in the world that nothing on disk accounts for.
      // This is the orphan case, and it is REPORTED, never retried here.
      const signatureSha256 = sha256Hex(certificate.signature);
      const detail = errorText(error);
      try {
        await gateway.recordOrphanSignature({
          requestId: input.requestId,
          deviceRecordId: input.deviceRecordId,
          serialNumber: reservation.serialNumber,
          idempotencyKey: input.idempotencyKey,
          signatureSha256,
          detail,
        });
      } catch {
        // Recording the incident also failed. The outcome below still carries
        // it, so the caller can escalate rather than the fact being lost.
      }
      return {
        outcome: "REFUSED",
        refusalCode: "ISSUE_SIGNATURE_NOT_PERSISTED",
        detail,
        orphanSignature: {
          requestId: input.requestId,
          serialNumber: reservation.serialNumber,
          signatureSha256,
          detail,
        },
      };
    }
  }

  // -- 5. FINALIZE ----------------------------------------------------------
  // Only the CA links are sent. The DEVICE link is built by the database from
  // the reserved TBS and the recorded signature — which is precisely why the
  // signature had to become durable first, and is what makes the recovery path
  // below identical to the normal one.
  const links: readonly ChainLinkInput[] = [
    chainLink(0, "root", ca.rootCertificate),
    chainLink(1, "intermediate", ca.intermediateCertificate),
  ];

  try {
    const finalized = await gateway.finalize({
      requestId: input.requestId,
      chainLinks: links,
      actorRef: input.actorRef,
    });
    return {
      outcome: finalized.outcome === "ALREADY_ISSUED" ? "REPLAYED" : "ISSUED",
      credential: finalized,
      certificate,
      chain:
        certificate === undefined
          ? undefined
          : {
              root: ca.rootCertificate,
              intermediate: ca.intermediateCertificate,
              device: certificate,
            },
    };
  } catch (error) {
    // NOT an orphan. The signature is durable, so this is retryable with the
    // original signature — conflating the two would send an operator hunting
    // for a loose signature that is in fact safely on disk.
    return {
      outcome: "REFUSED",
      refusalCode: "ISSUE_FINALIZATION_FAILED",
      detail: errorText(error),
      recoverableFromRecordedSignature: true,
    };
  }
}

function chainLink(
  linkPosition: number,
  role: "root" | "intermediate" | "device",
  certificate: Certificate,
): ChainLinkInput {
  return {
    linkPosition,
    role,
    subjectFingerprint: certificate.tbs.subjectFingerprint,
    issuerKeyId: certificate.tbs.issuerKeyId,
    canonicalTbs: Buffer.from(tbsBytes(certificate.tbs)).toString("utf8"),
    detachedSignatureB64: Buffer.from(certificate.signature).toString("base64"),
  };
}

/** Re-exported so callers compute the fingerprint the same way issuance does. */
export { publicKeyFingerprint };
