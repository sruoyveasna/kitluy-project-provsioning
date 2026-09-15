/**
 * Governed operational-credential RECOVERY for a re-flashed, already-known
 * device — and the dispatcher that decides which composition a certificate
 * request belongs to.
 *
 * Authority: KLD-2026-09-14-REFLASH-CREDENTIAL-RECOVERY-001; migration group
 * 0224; U1 hardware report 2026-09-12 §9b.
 *
 * ===========================================================================
 * THE CASE
 * ===========================================================================
 * A board that already holds an operational certificate is re-flashed. Its
 * private key went with the SD card. It registers again (group 0197 supersedes
 * its enrollment with the new identity key), is re-paired by an operator's code
 * (group 0218 leaves it `awaiting_trust`), and asks for a certificate over a new
 * operational key. First issuance refuses it for ever:
 *
 *     KLUY-KEY-GENERATION-TAKEN: generation 1 already holds a different key
 *
 * ===========================================================================
 * NOTHING HERE IS A NEW PIPELINE
 * ===========================================================================
 *   reserve_device_credential_recovery_v2   group 0226 — generation check, then
 *                                           group 0224's v1, the ONE new door
 *   register_generation_key_v2              group 0130 — key bound to the attempt
 *   runGovernedIssuance + binding           the shared prepare/sign/finalize,
 *                                           bound to the reservation exactly as
 *                                           the rotate-key renewal binds it
 *   mintAndRecordOperationalArtifact        the same X.509 path first issuance uses
 *   confirm_provider_key_activation_v1      group 0130 — activates the key and
 *                                           supersedes the lost one
 *
 * The device is its own key provider. It generated the key on the board and
 * proved possession of the private half in THIS request (`kitluy.csr.v1`), so
 * the activation confirmation records a fact the service has just observed,
 * and it is recorded only after the certificate the key is usable with exists.
 *
 * ===========================================================================
 * WHAT THIS DOES NOT DO
 * ===========================================================================
 * It never touches the permanent device record, the asset tag, an enrollment,
 * an assignment or any append-only row. It never removes anything. It does not
 * enable proactive key rotation (`renewal_policy.allow_key_rotation` stays as
 * it is). It does not revoke the incumbent credential: that key is superseded,
 * and the credential stays bounded by the existing three-day overlap cap.
 */
import { createHash } from "node:crypto";

import type pg from "pg";
import {
  bindReservationToPreparation,
  requestBytes,
  runGovernedIssuance,
  verifyRecoveryIdentityProof,
  type DeviceCertificateRequest,
  type SameKeyRenewalReservation,
  type TrustEnvironment,
} from "@kitluy/device-identity";

import { REGISTRY_ROLES, withServiceRole } from "./database.js";
import {
  DevPkiUnavailableError,
  assertDevelopmentOnly,
  readDevPkiChain,
  resolveDevPkiPaths,
} from "./dev-operational-pki.js";
import {
  OPERATIONAL_KEY_ALGORITHM,
  issueFirstOperationalCertificate,
  mintAndRecordOperationalArtifact,
  operationalKeyFingerprint,
  validateOperationalKey,
  verifyOperationalPossession,
  type FirstIssuanceRefusalCode,
  type FirstOperationalIssuanceOutcome,
  type FirstOperationalIssuanceRequest,
} from "./first-operational-issuance.js";
import { createIssuanceGateway } from "./issuance-gateway.js";
import { PersistentDevelopmentCertificateAuthority } from "./persistent-dev-ca.js";

export interface OperationalCertificateRequest extends FirstOperationalIssuanceRequest {
  /** The device identity key (Ed25519). Required only when recovering. */
  readonly identityPublicKeyPem?: string;
  /** Ed25519 signature over `recoveryIdentityProofBytes`. Never a key. */
  readonly identityProof?: Uint8Array;
}

export type OperationalCertificateRefusalCode =
  | FirstIssuanceRefusalCode
  | "OPCERT_ROUTE_UNAVAILABLE"
  | "OPCERT_RECOVERY_UNSUPPORTED_ROUTE"
  | "OPCERT_RECOVERY_IDENTITY_PROOF_REQUIRED"
  | "OPCERT_RECOVERY_IDENTITY_PROOF_FAILED"
  | "OPCERT_RECOVERY_REFUSED"
  | "OPCERT_RECOVERY_ACTIVATION_REFUSED";

export type OperationalCertificateOutcome =
  | (Extract<FirstOperationalIssuanceOutcome, { outcome: "ISSUED" | "REPLAYED" }> & {
      /** True when the credential is a recovery of an earlier generation. */
      readonly recovered?: boolean;
    })
  | {
      readonly outcome: "REFUSED";
      readonly refusalCode: OperationalCertificateRefusalCode;
      /** The governed refusal, verbatim. Never flattened. */
      readonly detail: string;
    };

export type OperationalCertificateRoute = "FIRST_ISSUANCE" | "RECOVERY" | "UNSUPPORTED";

const errorText = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

const refuse = (
  refusalCode: OperationalCertificateRefusalCode,
  detail: string,
): OperationalCertificateOutcome => ({ outcome: "REFUSED", refusalCode, detail });

/** Asks the database which door this request belongs to. Decides no eligibility. */
async function classifyRequest(
  pool: pg.Pool,
  deviceRecordId: string,
  environment: string,
  fingerprint: string,
): Promise<OperationalCertificateRoute> {
  return withServiceRole(pool, REGISTRY_ROLES.issuance, async (c) => {
    const { rows } = await c.query<{ route: OperationalCertificateRoute }>(
      `select kitluy_devices.classify_operational_certificate_request_v1(
                $1::uuid, $2::text, 'device_identity', $3::text) as route`,
      [deviceRecordId, environment, fingerprint],
    );
    return rows[0]?.route ?? "FIRST_ISSUANCE";
  });
}

/**
 * The route's single entry point.
 *
 * A request for a device that holds no credential, or the generation-1 key
 * retrying, is first issuance and goes through it UNCHANGED. A new key on a
 * device that already holds a credential is recovery, and recovery requires the
 * identity proof — refused here, before anything is reserved, when it is absent.
 */
export async function obtainOperationalCertificate(
  pool: pg.Pool,
  request: OperationalCertificateRequest,
  env: NodeJS.ProcessEnv = process.env,
): Promise<OperationalCertificateOutcome> {
  let fingerprint: string;
  try {
    fingerprint = operationalKeyFingerprint(request.operationalPublicKeyPem);
  } catch {
    // Unreadable key: first issuance owns that refusal (OPCERT_UNSUPPORTED_KEY).
    return issueFirstOperationalCertificate(pool, request, env);
  }

  let route: OperationalCertificateRoute;
  try {
    route = await classifyRequest(pool, request.deviceRecordId, request.environment, fingerprint);
  } catch (error) {
    return refuse(
      "OPCERT_ROUTE_UNAVAILABLE",
      errorText(error, "the certificate request could not be routed"),
    );
  }

  if (route === "FIRST_ISSUANCE") {
    return issueFirstOperationalCertificate(pool, request, env);
  }
  if (route === "UNSUPPORTED") {
    return refuse(
      "OPCERT_RECOVERY_UNSUPPORTED_ROUTE",
      "this key was registered by a proactive rotation, which no certificate route performs",
    );
  }
  if (request.identityPublicKeyPem === undefined || request.identityProof === undefined) {
    return refuse(
      "OPCERT_RECOVERY_IDENTITY_PROOF_REQUIRED",
      "this device already holds an operational credential; a new key is issued only as a governed " +
        "recovery, which requires a signature by the device identity key of its current enrollment",
    );
  }
  return recoverOperationalCertificate(
    pool,
    {
      ...request,
      identityPublicKeyPem: request.identityPublicKeyPem,
      identityProof: request.identityProof,
    },
    env,
  );
}

interface RecoveryReservationRow {
  readonly outcome: "RESERVED" | "REPLAYED_RESERVATION";
  readonly renewal_attempt_id: string;
  readonly next_credential_generation: number;
  readonly current_credential_generation: number;
  readonly current_credential_id: string;
  readonly current_public_key_fingerprint: string;
  readonly assignment_generation: number;
  readonly credential_head_version: number;
  readonly next_key_generation: number;
  readonly status: string;
}

/**
 * The recovery composition.
 *
 * Order matters and follows first issuance: every check that costs nothing
 * runs BEFORE the reservation, and the artifact is persisted BEFORE the key is
 * activated or success is reported.
 */
export async function recoverOperationalCertificate(
  pool: pg.Pool,
  request: OperationalCertificateRequest & {
    readonly identityPublicKeyPem: string;
    readonly identityProof: Uint8Array;
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<OperationalCertificateOutcome> {
  assertDevelopmentOnly(request.environment);

  // -- 0. THE KEY ------------------------------------------------------------
  const keyCheck = validateOperationalKey(request.operationalPublicKeyPem);
  if (!keyCheck.ok) {
    return refuse("OPCERT_UNSUPPORTED_KEY", keyCheck.detail);
  }
  const fingerprint = operationalKeyFingerprint(request.operationalPublicKeyPem);

  // -- 1. POSSESSION OF THE NEW KEY --------------------------------------------
  const csr: DeviceCertificateRequest = {
    requestId: request.requestId,
    deviceRecordId: request.deviceRecordId,
    environment: request.environment,
    devicePublicKeyPem: request.operationalPublicKeyPem,
    publicKeyFingerprint: fingerprint,
    hardwareTrustLevel: request.hardwareTrustLevel,
    assignmentGeneration: request.assignmentGeneration,
    requestedPurpose: "device_identity",
    requestedAt: request.requestedAt,
    nonce: request.nonce,
    correlationId: request.correlationId,
    proofOfPossession: request.proofOfPossession,
  };
  const preimage = requestBytes(csr);
  const possessionVerified = verifyOperationalPossession(
    request.operationalPublicKeyPem,
    preimage,
    request.proofOfPossession,
  );
  if (!possessionVerified) {
    return refuse(
      "OPCERT_POSSESSION_PROOF_FAILED",
      "the kitluy.csr.v1 signature does not verify under the presented operational public key",
    );
  }

  // -- 2. THE DEVICE IDENTITY, VERIFIED HERE ---------------------------------
  // The verdict is this module's. The database binds the verified fingerprint
  // to the device's CURRENT enrollment; a caller cannot assert either half.
  const identity = verifyRecoveryIdentityProof(
    request.identityPublicKeyPem,
    preimage,
    request.identityProof,
  );
  if (!identity.verified) {
    return refuse("OPCERT_RECOVERY_IDENTITY_PROOF_FAILED", identity.detail);
  }

  // -- 3. THE PERSISTENT CA, BEFORE ANYTHING IS RESERVED ----------------------
  const paths = resolveDevPkiPaths(env);
  if (paths === null) {
    return refuse("OPCERT_CA_UNAVAILABLE", "no development PKI directory is configured");
  }
  let canonicalCa: PersistentDevelopmentCertificateAuthority;
  let chain: { rootCertificatePem: string; intermediateCertificatePem: string };
  try {
    canonicalCa = PersistentDevelopmentCertificateAuthority.load(env);
    chain = readDevPkiChain(paths);
  } catch (error) {
    return refuse(
      "OPCERT_CA_UNAVAILABLE",
      error instanceof DevPkiUnavailableError ? error.message : "the development CA is unavailable",
    );
  }

  // -- 4. THE RECOVERY RESERVATION -------------------------------------------
  // Idempotent on the SIGNED request: a device that lost the response replays
  // its persisted request byte-identically and receives the same attempt.
  //
  // v2 (group 0226) is given the REQUEST's assignment generation and refuses a
  // mismatch as KLUY-RECOVERY-STALE-ASSIGNMENT before anything is written. v1
  // never saw it: on hardware (2026-09-15) a re-paired Hub asked at generation
  // 1, the reservation and the key were written, issuance then refused, and the
  // open reservation and spent key blocked every corrected request.
  const preimageHash = createHash("sha256").update(Buffer.from(preimage)).digest("hex");
  const reservationKey = createHash("sha256")
    .update(`kitluy.opcert-recovery.v1\n${preimageHash}`, "utf8")
    .digest("hex");
  let reserved: RecoveryReservationRow;
  try {
    reserved = await withServiceRole(pool, REGISTRY_ROLES.issuance, async (c) => {
      const { rows } = await c.query<{ r: RecoveryReservationRow }>(
        `select kitluy_devices.reserve_device_credential_recovery_v2(
                  $1::uuid, $2::text, 'device_identity', $3::text, $4::text, $5::boolean,
                  $6::timestamptz, $7::text, $8::text, $9::integer) as r`,
        [
          request.deviceRecordId,
          request.environment,
          reservationKey,
          identity.identityPublicKeyFingerprint,
          identity.verified,
          request.requestedAt,
          request.trustedTimeStatus,
          request.actorRef,
          request.assignmentGeneration,
        ],
      );
      const row = rows[0]?.r;
      if (row === undefined) throw new Error("the recovery reservation returned nothing");
      return row;
    });
  } catch (error) {
    return refuse(
      "OPCERT_RECOVERY_REFUSED",
      errorText(error, "the recovery reservation was refused"),
    );
  }

  // -- 5. THE DEVICE'S KEY, BOUND TO THE ATTEMPT -----------------------------
  // A completed attempt already holds its key; `register_generation_key_v2`
  // refuses a terminal reservation, so a replay of a finished recovery skips it.
  if (reserved.status !== "completed") {
    try {
      await withServiceRole(pool, REGISTRY_ROLES.issuance, async (c) => {
        await c.query(
          `select kitluy_devices.register_generation_key_v2(
                    $1::uuid, $2::text, $3::text, $4::text, $5::integer)`,
          [
            reserved.renewal_attempt_id,
            request.operationalKeyHandle,
            request.operationalPublicKeyPem,
            fingerprint,
            reserved.next_key_generation,
          ],
        );
      });
    } catch (error) {
      return refuse(
        "OPCERT_KEY_REGISTRATION_REFUSED",
        errorText(error, "the recovered key could not be registered"),
      );
    }
  }

  // -- 6. THE SHARED GOVERNED PIPELINE, BOUND TO THE RESERVATION -------------
  // The same binding the rotate-key renewal uses: preparation must see the head
  // version the reservation froze, allocate exactly the reserved generation,
  // and present the key registered for this attempt — or nothing is signed.
  const reservation: SameKeyRenewalReservation = {
    renewalAttemptId: reserved.renewal_attempt_id,
    renewalMode: "rotate_key",
    deviceRecordId: request.deviceRecordId,
    currentCredentialId: reserved.current_credential_id,
    currentCredentialGeneration: reserved.current_credential_generation,
    nextCredentialGeneration: reserved.next_credential_generation,
    credentialHeadVersion: Number(reserved.credential_head_version),
    assignmentGeneration: reserved.assignment_generation,
    environment: request.environment as TrustEnvironment,
    purpose: "device_identity",
    currentPublicKeyFingerprint: reserved.current_public_key_fingerprint,
    currentKeyGeneration: null,
    reservationStatus: reserved.status,
    replacementKeyReference: null,
  };
  const gateway = bindReservationToPreparation(
    createIssuanceGateway({ pool, issuerRole: REGISTRY_ROLES.issuance }),
    reservation,
    fingerprint,
  );
  const governed = await runGovernedIssuance(
    {
      requestId: request.requestId,
      deviceRecordId: request.deviceRecordId,
      environment: request.environment,
      purpose: "device_identity",
      assignmentGeneration: request.assignmentGeneration,
      publicKeyPem: request.operationalPublicKeyPem,
      publicKeyFingerprint: fingerprint,
      idempotencyKey: preimageHash,
      canonicalPayloadHash: preimageHash,
      popAlgorithm: OPERATIONAL_KEY_ALGORITHM,
      popSignedPreimageHash: preimageHash,
      popSignature: request.proofOfPossession,
      popServiceVerified: possessionVerified,
      issuerKeyId: canonicalCa.intermediateKeyId,
      trustedTime: request.requestedAt,
      trustedTimeStatus: request.trustedTimeStatus,
      actorRef: request.actorRef,
      hardwareTrustLevel: request.hardwareTrustLevel,
    },
    gateway,
    canonicalCa,
  );
  if (governed.outcome === "REFUSED") {
    return refuse(
      "OPCERT_GOVERNED_ISSUANCE_REFUSED",
      `${governed.refusalCode ?? "REFUSED"}: ${governed.detail ?? "the governed issuance was refused"}`,
    );
  }
  const credential = governed.credential;
  if (credential === undefined) {
    return refuse("OPCERT_GOVERNED_ISSUANCE_REFUSED", "issuance returned no credential");
  }
  if (credential.certificateGeneration !== reserved.next_credential_generation) {
    return refuse(
      "OPCERT_GOVERNED_ISSUANCE_REFUSED",
      `issuance produced generation ${credential.certificateGeneration}; the recovery reserved ${reserved.next_credential_generation}`,
    );
  }

  // -- 7. THE ARTIFACT, PERSISTED BEFORE THE KEY IS CALLED USABLE ------------
  const artifact = await mintAndRecordOperationalArtifact(pool, {
    credentialId: credential.credentialId,
    deviceRecordId: request.deviceRecordId,
    operationalPublicKeyPem: request.operationalPublicKeyPem,
    actorRef: request.actorRef,
    paths,
    chain,
    governedReplayed: governed.outcome === "REPLAYED",
  });
  if (artifact.outcome === "REFUSED") {
    // The credential exists and the key waits at pending activation. A retry
    // of this request replays every step above and resumes here.
    return artifact;
  }

  // -- 8. ACTIVATION, AND THE LOST KEY SUPERSEDED ----------------------------
  try {
    await withServiceRole(pool, REGISTRY_ROLES.issuance, async (c) => {
      await c.query(
        `select kitluy_devices.confirm_provider_key_activation_v1(
                  $1::uuid, $2::uuid, $3::uuid, $4::text, 'device_identity',
                  $5::integer, $6::integer, $7::text, $8::text, $9::text)`,
        [
          reserved.renewal_attempt_id,
          credential.credentialId,
          request.deviceRecordId,
          request.environment,
          reserved.next_credential_generation,
          reserved.next_key_generation,
          request.operationalKeyHandle,
          fingerprint,
          request.actorRef,
        ],
      );
    });
  } catch (error) {
    return refuse(
      "OPCERT_RECOVERY_ACTIVATION_REFUSED",
      errorText(error, "the recovered key could not be activated"),
    );
  }

  return { ...artifact, recovered: true };
}
