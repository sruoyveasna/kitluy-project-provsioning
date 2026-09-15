/**
 * The Store Hub obtains, verifies and adopts its operational TLS certificate.
 *
 * Authority: owner instruction 2026-08-28 Step 2; `kitluy.csr.v1`
 * (`packages/device-identity/src/certificate-issuance.ts`); findings C-1
 * (key binding), C-2 (server-authoritative validity) and C-3 (a failed first
 * issuance must not brick a Hub).
 *
 * ===========================================================================
 * THE SHAPE
 * ===========================================================================
 *     local key  ->  request state  ->  kitluy.csr.v1  ->  registry
 *                ->  device-side verification  ->  atomic adoption
 *
 * Everything irreversible happens as late as possible, and everything that must
 * survive a power cut is written before the thing that could lose it:
 *
 *   1. the key is generated ONCE and reused for ever;
 *   2. the request identity is persisted BEFORE the first network call, so a
 *      lost response can be replayed byte-identically;
 *   3. the certificate is verified locally BEFORE it is written anywhere;
 *   4. the manifest — the only record that says "usable" — is written LAST.
 *
 * ===========================================================================
 * WAN IS REQUIRED ONCE, AND NEVER AGAIN
 * ===========================================================================
 * First issuance genuinely needs the cloud: only the governed doors can allocate
 * a generation and sign a leaf. After adoption, this module answers from disk
 * and makes no network call at all — `ensureOperationalCertificate` returns
 * `already_adopted` before it looks at a transport. A Store Hub that needed the
 * WAN to start serving its own shop after it was provisioned would be a worse
 * appliance than the till it replaced.
 */
import { randomUUID, sign as cryptoSign } from "node:crypto";

import {
  ensureOperationalKey,
  withOperationalPrivateKey,
  OperationalKeyError,
  type OperationalKeyHandle,
} from "./operational-key.js";
import {
  operationalCsrBytes,
  OPERATIONAL_CSR_PURPOSE,
  type OperationalCsrFields,
} from "./operational-csr-bytes.js";
import {
  commitAdoption,
  currentPhase,
  readManifest,
  readRequestState,
  writeRequestState,
  OPERATIONAL_PATHS,
  type OperationalCredentialManifest,
  type OperationalCredentialPhase,
} from "./operational-credential-state.js";
import {
  verifyOperationalCertificate,
  type VerificationFailure,
} from "./operational-certificate-verification.js";
import {
  RecoveryIdentityError,
  type RecoveryIdentityProof,
  type RecoveryIdentitySigner,
} from "./operational-recovery-identity-bytes.js";

/** What the registry answered. Public material only. */
export interface IssuanceResponse {
  readonly outcome: "ISSUED" | "REPLAYED";
  readonly credentialId: string;
  readonly certificateGeneration: number;
  readonly serialNumber: string;
  readonly certificateSha256: string;
  readonly certificatePem: string;
  readonly chainPem: string;
  readonly publicKeyAlgorithm: string;
  readonly notBefore?: string;
  readonly notAfter?: string;
}

export interface IssuanceRefusal {
  readonly refusalCode: string;
  readonly detail: string;
  readonly retryable: boolean;
}

export type IssuanceCallResult =
  | { readonly kind: "issued"; readonly response: IssuanceResponse }
  | { readonly kind: "refused"; readonly refusal: IssuanceRefusal }
  | { readonly kind: "unreachable"; readonly detail: string };

/** The transport. Injected so the orchestration is testable without a network. */
export interface OperationalCertificateClient {
  request(input: {
    readonly csr: OperationalCsrFields;
    readonly operationalPublicKeyPem: string;
    readonly proofOfPossessionBase64: string;
    /** The device identity proof. The registry requires it for recovery only. */
    readonly identity?: RecoveryIdentityProof;
  }): Promise<IssuanceCallResult>;
}

export interface EnsureCertificateDeps {
  readonly client: OperationalCertificateClient;
  readonly deviceRecordId: string;
  readonly environment: string;
  readonly hardwareTrustLevel: string;
  readonly assignmentGeneration: number;
  /** From the governed trusted-time bridge. NEVER a host clock. */
  readonly trustedTime: Date;
  /** SHA-256 of the pinned DEVELOPMENT root certificate. */
  readonly expectedRootSha256: string;
  readonly paths?: typeof OPERATIONAL_PATHS;
  /** Injected only so tests can make identifiers deterministic. */
  readonly newId?: () => string;
  /**
   * Signs the recovery identity proof with the device identity key. A board
   * that was re-flashed already holds a credential in the cloud, and the
   * registry issues it a new one only against this proof (group 0224). Absent,
   * first issuance still works and a recovery is refused with a typed code.
   */
  readonly identitySigner?: RecoveryIdentitySigner;
  /**
   * Told when a saved request was made at a different assignment generation and
   * was replaced (see step 2). Logging only.
   */
  readonly onStaleRequestReplaced?: (change: {
    readonly fromGeneration: number;
    readonly toGeneration: number;
    readonly staleRequestId: string;
  }) => void;
}

export type EnsureCertificateOutcome =
  | { readonly kind: "already_adopted"; readonly manifest: OperationalCredentialManifest }
  | {
      readonly kind: "adopted";
      readonly manifest: OperationalCredentialManifest;
      readonly replayed: boolean;
    }
  | {
      readonly kind: "refused";
      readonly refusal: IssuanceRefusal;
      readonly phase: OperationalCredentialPhase;
    }
  | {
      readonly kind: "unreachable";
      readonly detail: string;
      readonly phase: OperationalCredentialPhase;
    }
  | {
      readonly kind: "verification_failed";
      readonly failures: readonly VerificationFailure[];
      readonly phase: OperationalCredentialPhase;
    }
  | {
      readonly kind: "blocked";
      readonly detail: string;
      readonly phase: OperationalCredentialPhase;
    };

/**
 * Bring the Hub to ADOPTED, or say precisely why it could not.
 *
 * Never throws for an expected condition. A firstboot unit that crashed because
 * the WAN was down would turn a waiting state into a boot failure, and pending
 * is a healthy resting state here exactly as it is for registration.
 */
export async function ensureOperationalCertificate(
  deps: EnsureCertificateDeps,
): Promise<EnsureCertificateOutcome> {
  const paths = deps.paths ?? OPERATIONAL_PATHS;
  const newId = deps.newId ?? randomUUID;

  // --- 0. ALREADY DONE? ------------------------------------------------------
  // Checked before anything else, and it is what makes a provisioned Hub boot
  // without a WAN. No network call happens below this line on a normal boot.
  const existing = readManifest(paths);
  if (existing !== null && currentPhase(paths) === "ADOPTED") {
    return { kind: "already_adopted", manifest: existing };
  }

  // --- 1. THE KEY, ONCE ------------------------------------------------------
  let key: OperationalKeyHandle;
  try {
    key = ensureOperationalKey(paths.privateKey);
  } catch (error) {
    // A corrupt or partially written key is deliberately NOT replaced. See
    // `operational-key.ts`: silently re-keying turns one bad write into an
    // identity change the governed doors would refuse for an unrelated-looking
    // reason.
    return {
      kind: "blocked",
      detail:
        error instanceof OperationalKeyError ? error.message : "the operational key is unusable",
      phase: currentPhase(paths),
    };
  }

  // --- 2. THE REQUEST IDENTITY, PERSISTED BEFORE IT IS USED ------------------
  //
  // The governed issuance is idempotent on the idempotency key, which is derived
  // from the signed preimage. Replaying therefore means sending the SAME fields,
  // so they are written to disk before the first network call and reused for
  // ever afterwards.
  let requestState = readRequestState(paths);

  if (requestState !== null && requestState.publicKeyFingerprint !== key.publicKeyFingerprint) {
    // The stored request belongs to a different key. Reusing it would sign new
    // bytes under an old identity and be refused; discarding it silently would
    // spend a second generation. Refuse and say so.
    return {
      kind: "blocked",
      detail:
        "the stored issuance request was made for a different operational key; " +
        "recover through the governed abandon path rather than requesting again",
      phase: currentPhase(paths),
    };
  }

  // A SAVED REQUEST FOR A GENERATION THIS DEVICE NO LONGER HOLDS.
  //
  // The request is persisted before the first call and replayed for ever, which
  // is right for a lost response and wrong after a re-pair: every replay carries
  // the old generation and the cloud refuses it as KLUY-CRED-STALE-ASSIGNMENT,
  // for ever. That is what a re-paired Store Hub did on hardware (2026-09-15).
  //
  // Nothing was adopted (checked in step 0), so the request is rebuilt: the SAME
  // key — the cloud refuses a stale generation before it registers a key (group
  // 0226), so the key is not spent — with a NEW request id, nonce and time, and
  // persisted before the call exactly as a first request is. The stale request
  // is overwritten and can never be sent again.
  if (requestState !== null && requestState.assignmentGeneration !== deps.assignmentGeneration) {
    deps.onStaleRequestReplaced?.({
      fromGeneration: requestState.assignmentGeneration,
      toGeneration: deps.assignmentGeneration,
      staleRequestId: requestState.requestId,
    });
    requestState = null;
  }

  if (requestState === null) {
    const now = new Date();
    requestState = {
      phase: "REQUEST_READY",
      requestId: newId(),
      deviceRecordId: deps.deviceRecordId,
      environment: deps.environment,
      publicKeyFingerprint: key.publicKeyFingerprint,
      hardwareTrustLevel: deps.hardwareTrustLevel,
      assignmentGeneration: deps.assignmentGeneration,
      requestedPurpose: OPERATIONAL_CSR_PURPOSE,
      // TRUSTED time, not the host clock. It enters the signature, so it must be
      // the value the server will also consider legitimate.
      requestedAt: deps.trustedTime.toISOString(),
      nonce: newId(),
      correlationId: newId(),
      createdAt: now.toISOString(),
    };
    // BEFORE the network call. This single ordering is what makes a lost
    // response recoverable.
    writeRequestState(requestState, paths);
  }

  // --- 3. kitluy.csr.v1, SIGNED LOCALLY -------------------------------------
  const csr: OperationalCsrFields = {
    requestId: requestState.requestId,
    deviceRecordId: requestState.deviceRecordId,
    environment: requestState.environment,
    publicKeyFingerprint: requestState.publicKeyFingerprint,
    hardwareTrustLevel: requestState.hardwareTrustLevel,
    assignmentGeneration: requestState.assignmentGeneration,
    requestedPurpose: requestState.requestedPurpose,
    requestedAt: requestState.requestedAt,
    nonce: requestState.nonce,
    correlationId: requestState.correlationId,
  };

  const preimage = Buffer.from(operationalCsrBytes(csr));
  let proofOfPossessionBase64: string;
  try {
    proofOfPossessionBase64 = withOperationalPrivateKey(
      (privateKey) => cryptoSign("sha256", preimage, privateKey).toString("base64"),
      paths.privateKey,
    );
  } catch (error) {
    return {
      kind: "blocked",
      detail:
        error instanceof OperationalKeyError ? error.message : "the request could not be signed",
      phase: currentPhase(paths),
    };
  }

  // --- 3b. THE DEVICE IDENTITY PROOF, OVER THE SAME BYTES ------------------
  // Deterministic for the persisted request: Ed25519 signatures are, so a
  // replay after a lost response carries the identical proof.
  let identity: RecoveryIdentityProof | undefined;
  if (deps.identitySigner !== undefined) {
    try {
      identity = deps.identitySigner(preimage);
    } catch (error) {
      return {
        kind: "blocked",
        detail:
          error instanceof RecoveryIdentityError
            ? error.message
            : "the recovery identity proof could not be signed",
        phase: currentPhase(paths),
      };
    }
  }

  // --- 4. ASK ----------------------------------------------------------------
  const call = await deps.client.request({
    csr,
    operationalPublicKeyPem: key.publicKeyPem,
    proofOfPossessionBase64,
    ...(identity === undefined ? {} : { identity }),
  });
  if (call.kind === "unreachable") {
    // The request state survives, so the next boot replays this exact request.
    return { kind: "unreachable", detail: call.detail, phase: currentPhase(paths) };
  }
  if (call.kind === "refused") {
    return { kind: "refused", refusal: call.refusal, phase: currentPhase(paths) };
  }
  const response = call.response;

  // --- 5. VERIFY EVERYTHING, LOCALLY, BEFORE ADOPTING ANYTHING --------------
  //
  // "The server returned 200" is a statement about a transport. This is the
  // Hub's permanent identity, and it is checked against the key the Hub holds
  // and the root it was built to trust.
  const verification = verifyOperationalCertificate({
    certificatePem: response.certificatePem,
    chainPem: response.chainPem,
    localPublicKeyPem: key.publicKeyPem,
    expectedRootSha256: deps.expectedRootSha256,
    expectedPublicKeyFingerprint: key.publicKeyFingerprint,
    // The governed serial, mapped canonically. Compared as an integer inside.
    expectedX509Serial: x509SerialForCredentialSerial(response.serialNumber),
    expectedCredentialGeneration: response.certificateGeneration,
    expectedAssignmentGeneration: requestState.assignmentGeneration,
    deviceRecordId: requestState.deviceRecordId,
    environment: requestState.environment,
    trustedTime: deps.trustedTime,
    expectedAlgorithm: response.publicKeyAlgorithm,
  });

  if (!verification.ok) {
    // NOTHING is written. The request state stays, so a later boot can retry
    // against a server that has been fixed, and the Hub has consumed nothing it
    // cannot recover from.
    return {
      kind: "verification_failed",
      failures: verification.failures,
      phase: currentPhase(paths),
    };
  }

  // The digest the server reported must be the digest of what it actually sent.
  if (verification.certificateSha256 !== response.certificateSha256.toLowerCase()) {
    return {
      kind: "verification_failed",
      failures: [
        {
          check: "LEAF_PARSES",
          detail: "the certificate digest does not match the one the registry reported",
        },
      ],
      phase: currentPhase(paths),
    };
  }

  // --- 6. ADOPT, MANIFEST LAST ----------------------------------------------
  const manifest: OperationalCredentialManifest = {
    phase: "ADOPTED",
    deviceRecordId: requestState.deviceRecordId,
    environment: requestState.environment,
    credentialId: response.credentialId,
    certificateGeneration: response.certificateGeneration,
    certificateSerial: response.serialNumber,
    certificateX509Serial: verification.x509Serial,
    certificateSha256: verification.certificateSha256,
    publicKeyFingerprint: key.publicKeyFingerprint,
    publicKeyAlgorithm: response.publicKeyAlgorithm,
    notBefore: response.notBefore ?? "",
    notAfter: response.notAfter ?? "",
    requestId: requestState.requestId,
    adoptedAt: deps.trustedTime.toISOString(),
  };
  commitAdoption(
    { certificatePem: response.certificatePem, chainPem: response.chainPem, manifest },
    paths,
  );

  return { kind: "adopted", manifest, replayed: response.outcome === "REPLAYED" };
}

/**
 * The canonical credential-serial -> X.509-serial mapping, device side.
 *
 * A local copy for the same reason `operational-csr-bytes.ts` is: the image
 * ships no `node_modules`. Kept honest by `test/operational-serial-drift.test.ts`
 * against `x509SerialForCredential` in the registry service.
 *
 * Minimal positive DER INTEGER — strip leading zero bytes, then add exactly one
 * 0x00 only when the leading byte would otherwise make the value negative. That
 * rule is finding R2-1: prefixing unconditionally produced certificates OpenSSL
 * refused to parse, roughly one serial in 256.
 */
export function x509SerialForCredentialSerial(credentialSerial: string): string {
  if (!/^DEV-[0-9A-Fa-f]{16}$/.test(credentialSerial)) {
    // The device only ever receives `DEV-` serials. Anything else is not a
    // serial this path issued, and guessing at it is what finding N-1 was about.
    throw new Error(`KLUY-SERIAL-UNSUPPORTED: "${credentialSerial}" is not a DEV- serial`);
  }
  let bytes = credentialSerial.slice(4).toLowerCase();
  while (bytes.length > 2 && bytes.startsWith("00")) {
    bytes = bytes.slice(2);
  }
  if (Number.parseInt(bytes.slice(0, 2), 16) >= 0x80) {
    bytes = `00${bytes}`;
  }
  return bytes;
}
