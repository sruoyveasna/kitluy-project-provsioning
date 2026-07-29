/**
 * Optional `rotate_key` renewal and provider activation — WS-11-T003 Step 4,
 * Prompt 2C.
 *
 * Authority: KLD-2026-07-28-002 §4, §5, §7, §12.6; the owner renewal
 * instruction of 2026-07-29; migration groups 0129, 0130 (TASK A and TASK D),
 * 0131, 0132.
 *
 * ===========================================================================
 * ROTATION IS OPTIONAL, AND IT IS NOT THE DEFAULT
 * ===========================================================================
 * Migration 0129 recorded the correction that makes this module *optional*:
 * §5.1 was a RECOMMENDATION, not a ruling, and `kitluy_devices.renewal_policy`
 * keeps `rotate_key` DISABLED pending
 * `[REQUIRED: renewal_key_rotation_owner_decision]`.
 *
 * Nothing in this file enables rotation. Asking for the mode does not authorize
 * it: the DATABASE refuses `rotate_key` unless the policy permits it, and the
 * policy cannot permit it without naming an owner decision — a CHECK
 * constraint, not a convention. This module being complete and tested is NOT
 * evidence that renewal should rotate.
 *
 * ===========================================================================
 * THE ORDER, AND WHY EVERY STEP IS WHERE IT IS
 * ===========================================================================
 *   preflight + reservation   verification is the SHARED route, not a weaker
 *                             one; the reservation comes BEFORE any key exists
 *     -> generate             idempotent on the renewal attempt, because that
 *                             is the only stable identifier that exists
 *     -> register             PUBLIC metadata only; the database learns a key
 *                             was generated, never that it is usable
 *     -> prove possession     the REPLACEMENT key signs a renewal-bound
 *                             challenge; a caller-supplied public key is not
 *                             evidence that a private half exists
 *     -> prepare/sign/final   the shared governed pipeline, unforked
 *     -> pending activation   TASK D: a credential row proves issuance, not
 *                             that the private half is loaded
 *     -> provider activates   the provider is what knows; PostgreSQL cannot
 *                             observe it
 *     -> confirm              the database RECORDS the provider's answer
 *
 * ===========================================================================
 * THE INCUMBENT SURVIVES UNTIL THE REPLACEMENT IS CONFIRMED
 * ===========================================================================
 * Nothing here abandons, supersedes or destroys the incumbent key. It stays
 * active through preparation and through the permitted overlap, because a
 * device that lost its working key before the replacement was confirmed usable
 * would be a device that cannot authenticate at all. Supersession is the
 * database's, inside `confirm_provider_key_activation_v1`, and only after the
 * replacement is active.
 */

import { createHash } from "node:crypto";

import { evaluateCertificateValidity } from "./certificate-validity.js";
import { isRestricted } from "./trusted-time.js";
import { publicKeyFingerprint, type DevelopmentCertificateAuthority } from "./dev-crypto.js";
import { runGovernedIssuance, type GovernedIssuanceGateway } from "./issuance-adapter.js";
import {
  replacementChallengeBytes,
  verifyReplacementKeyPop,
  type ReplacementKeyChallenge,
  type ReplacementPopRefusalCode,
} from "./replacement-key-pop.js";
import {
  ROTATE_KEY_RENEWAL_MODE,
  buildChainFromStoredLinks,
  prepareSameKeyCredentialRenewal,
  type IncumbentCredentialRepository,
  type RenewalReservationGateway,
  type SameKeyRenewalPreflightInput,
  type SameKeyRenewalRefusalCode,
  type SameKeyRenewalReservation,
} from "./same-key-renewal-preflight.js";
import { bindReservationToPreparation } from "./same-key-renewal-issuance.js";
import { ReplacementKeyError, type ReplacementKeyProvider } from "./replacement-key-provider.js";

/** How long a replacement-key possession proof is good for, against TRUSTED time. */
export const REPLACEMENT_POP_TTL_SECONDS = 300;

const BINDING_MARKER = "KLUY-RENEWAL-ISSUANCE-BINDING";

/**
 * Adapter refusals, mapped WITHOUT losing which stage failed. Collapsing these
 * into one code would tell an operator that "issuance refused" when the actual
 * facts — nothing was signed, a signature is loose, or the credential is
 * durable and retryable — need completely different responses.
 */
const ISSUANCE_REFUSAL_CODES: Readonly<Record<string, RotateKeyRenewalRefusalCode>> = {
  ISSUE_CANONICAL_TBS_DIVERGENCE: "ROTATION_CANONICAL_TBS_DIVERGENCE",
  ISSUE_CANONICAL_TBS_HASH_DIVERGENCE: "ROTATION_CANONICAL_TBS_DIVERGENCE",
  ISSUE_SIGNING_FAILED: "ROTATION_ISSUANCE_REFUSED",
  ISSUE_SIGNATURE_SELF_VERIFICATION_FAILED: "ROTATION_SIGNATURE_SELF_VERIFICATION_FAILED",
  ISSUE_SIGNATURE_NOT_PERSISTED: "ROTATION_SIGNATURE_NOT_PERSISTED",
  ISSUE_FINALIZATION_FAILED: "ROTATION_FINALIZATION_FAILED",
  ISSUE_REFUSED_BY_DATABASE: "ROTATION_ISSUANCE_REFUSED",
};

// ---------------------------------------------------------------------------
// The governed rotation boundary
// ---------------------------------------------------------------------------

export interface RegisterReplacementKeyInput {
  readonly renewalAttemptId: string;
  readonly providerKeyReference: string;
  readonly publicKeyPem: string;
  readonly publicKeyFingerprint: string;
  readonly keyGeneration: number;
}

export interface RegisteredReplacementKey {
  readonly outcome: "REGISTERED" | "ALREADY_REGISTERED";
  readonly keyId: string;
  readonly state: string;
  readonly providerKeyReference: string;
}

/** What the database knows about the replacement key. PUBLIC metadata only. */
export interface ReplacementKeyRow {
  readonly keyId: string;
  readonly state: string;
  readonly keyGeneration: number | null;
  readonly generation: number;
  readonly publicKeyFingerprint: string;
  readonly providerKeyReference: string;
  readonly renewalAttemptId: string | null;
}

export interface ConfirmActivationInput {
  readonly renewalAttemptId: string;
  readonly credentialId: string;
  readonly deviceRecordId: string;
  readonly environment: string;
  readonly purpose: string;
  readonly credentialGeneration: number;
  readonly keyGeneration: number;
  readonly providerKeyReference: string;
  readonly publicKeyFingerprint: string;
  readonly actorRef: string;
}

export interface ActivationConfirmation {
  readonly outcome: "ACTIVATED" | "ALREADY_ACTIVE";
  readonly keyId: string;
}

/**
 * The governed rotation writes. Every one is a database function; nothing here
 * writes `device_generation_keys` or `device_renewal_reservations` directly.
 */
export interface RotationGateway {
  registerReplacementKey(input: RegisterReplacementKeyInput): Promise<RegisteredReplacementKey>;
  loadReplacementKey(renewalAttemptId: string): Promise<ReplacementKeyRow | null>;
  loadReservationStatus(renewalAttemptId: string): Promise<string | null>;
  confirmProviderKeyActivation(input: ConfirmActivationInput): Promise<ActivationConfirmation>;
}

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

export type RotateKeyRenewalRefusalCode =
  | "ROTATION_PREFLIGHT_REFUSED"
  | "ROTATION_NOT_PERMITTED"
  | "ROTATION_NO_TRUSTED_TIME"
  | "ROTATION_WRONG_MODE"
  | "ROTATION_NO_CURRENT_KEY_GENERATION"
  | "ROTATION_KEY_GENERATION_FAILED"
  | "ROTATION_REPLACEMENT_REUSES_INCUMBENT"
  | "ROTATION_REGISTRATION_REFUSED"
  | "ROTATION_REGISTRATION_DIVERGED"
  | "ROTATION_POSSESSION_PROOF_FAILED"
  | "ROTATION_ISSUANCE_REFUSED"
  | "ROTATION_CANONICAL_TBS_DIVERGENCE"
  | "ROTATION_SIGNATURE_SELF_VERIFICATION_FAILED"
  | "ROTATION_SIGNATURE_NOT_PERSISTED"
  | "ROTATION_FINALIZATION_FAILED"
  | "ROTATION_BINDING_REFUSED"
  | "ROTATION_PENDING_STATE_UNEXPECTED"
  | "ROTATION_PROVIDER_ACTIVATION_FAILED"
  | "ROTATION_ACTIVATION_CONFIRMATION_REFUSED"
  | "ROTATION_POST_VERIFICATION_FAILED";

// ---------------------------------------------------------------------------
// Input and outcome
// ---------------------------------------------------------------------------

export interface RotateKeyRenewalInput extends Omit<SameKeyRenewalPreflightInput, "renewalMode"> {
  readonly actorRef: string;
}

/**
 * What a rotation changed — stated as separate facts, because the difference
 * from a same-key renewal is precisely which of them moved.
 */
export interface RotateKeyRenewalEffect {
  readonly credentialId: string;
  readonly serialNumber: string;
  readonly previousCredentialGeneration: number;
  readonly credentialGeneration: number;
  readonly previousKeyGeneration: number;
  readonly keyGeneration: number;
  readonly incumbentPublicKeyFingerprint: string;
  readonly replacementPublicKeyFingerprint: string;
  readonly incumbentProviderKeyReference: string;
  readonly replacementProviderKeyReference: string;
  readonly notBefore?: string;
  readonly notAfter?: string;
  readonly credentialGenerationAdvanced: true;
  /** The KEY generation moved too. That is what makes this a rotation. */
  readonly keyGenerationAdvanced: true;
  readonly keyRotated: true;
}

/**
 * The three independent conditions §10 requires, reported separately.
 *
 * A credential is operationally usable only when ALL THREE hold. Reporting one
 * boolean would let a caller treat "issued" as "usable", which is the exact
 * confusion migration 0130 TASK D exists to prevent.
 */
export interface OperationalReadiness {
  readonly credentialCryptographicallyValid: boolean;
  readonly replacementKeyActiveInProvider: boolean;
  readonly databaseActivationConfirmed: boolean;
  readonly operationallyReady: boolean;
  readonly consumersMustReVerifyAtAuthenticationBoundary: true;
}

export interface RotateKeyRenewalOutcome {
  readonly outcome: "ROTATED" | "REFUSED";
  readonly reservation?: SameKeyRenewalReservation;
  readonly rotated?: RotateKeyRenewalEffect;
  readonly readiness?: OperationalReadiness;
  readonly refusalCode?: RotateKeyRenewalRefusalCode;
  readonly preflightRefusalCode?: SameKeyRenewalRefusalCode;
  readonly popRefusalCode?: ReplacementPopRefusalCode;
  /** The underlying reason, preserved verbatim. Never flattened. */
  readonly detail?: string;
  /**
   * Set when a CREDENTIAL EXISTS but the rotation did not finish. The credential
   * is real and on disk; the replacement key is not usable yet. Saying nothing
   * here would send an operator looking for a credential that is already there.
   */
  readonly credentialIssuedButNotActivated?: {
    readonly credentialId: string;
    readonly credentialGeneration: number;
    readonly replacementKeyState: string;
    readonly reservationStatus: string;
  };
}

// ---------------------------------------------------------------------------
// Derived identity
// ---------------------------------------------------------------------------

/**
 * The proof-of-possession challenge, derived ENTIRELY from the frozen
 * reservation and the registered key.
 *
 * The nonce is derived rather than random so a retry rebuilds the identical
 * challenge — the proof is then idempotent like everything else in this
 * pipeline — while remaining unguessable to anyone without the attempt id.
 */
export function buildReplacementChallenge(
  reservation: SameKeyRenewalReservation,
  replacementFingerprint: string,
  issuedAt: Date,
  ttlSeconds: number = REPLACEMENT_POP_TTL_SECONDS,
): ReplacementKeyChallenge {
  return {
    renewalAttemptId: reservation.renewalAttemptId,
    deviceRecordId: reservation.deviceRecordId,
    currentCredentialId: reservation.currentCredentialId,
    currentGeneration: reservation.currentCredentialGeneration,
    nextGeneration: reservation.nextCredentialGeneration,
    replacementPublicKeyFingerprint: replacementFingerprint,
    assignmentGeneration: reservation.assignmentGeneration,
    nonce: createHash("sha256")
      .update(
        Buffer.from(
          `kitluy.rotation-nonce.v1\n${reservation.renewalAttemptId}\n${replacementFingerprint}`,
          "utf8",
        ),
      )
      .digest("hex"),
    issuedAt,
    expiresAt: new Date(issuedAt.getTime() + ttlSeconds * 1000),
    environment: reservation.environment,
    purpose: reservation.purpose,
  };
}

/** Derived from the frozen attempt, so the caller cannot steer the serial. */
export function rotationIdempotencyKey(reservation: SameKeyRenewalReservation): string {
  return createHash("sha256")
    .update(
      Buffer.from(
        [
          "kitluy.rotate-key-renewal.v1",
          reservation.renewalAttemptId,
          String(reservation.nextCredentialGeneration),
        ].join("\n"),
        "utf8",
      ),
    )
    .digest("hex");
}

export function rotationRequestId(reservation: SameKeyRenewalReservation): string {
  return `rot-${reservation.renewalAttemptId}`;
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const sha256Hex = (value: Uint8Array | string): string =>
  createHash("sha256")
    .update(typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value))
    .digest("hex");

// ---------------------------------------------------------------------------
// The orchestration
// ---------------------------------------------------------------------------

/**
 * Runs a complete `rotate_key` renewal, ending with the replacement key active
 * in the provider AND confirmed in the database.
 *
 * Every identifier below is either frozen by the database or derived from one
 * that is. Nothing here mints an id.
 */
export async function completeRotateKeyCredentialRenewal(
  input: RotateKeyRenewalInput,
  repository: IncumbentCredentialRepository,
  reservationGateway: RenewalReservationGateway,
  rotationGateway: RotationGateway,
  issuanceGateway: GovernedIssuanceGateway,
  ca: DevelopmentCertificateAuthority,
  provider: ReplacementKeyProvider,
): Promise<RotateKeyRenewalOutcome> {
  const refuse = (
    refusalCode: RotateKeyRenewalRefusalCode,
    detail: string,
    extra: Partial<RotateKeyRenewalOutcome> = {},
  ): RotateKeyRenewalOutcome => ({ outcome: "REFUSED", refusalCode, detail, ...extra });

  // -- 1. THE SHARED PREFLIGHT, ASKING FOR ROTATION -------------------------
  // Same incumbent loading, same trusted-time evaluation, same REAL chain
  // verification. Rotation does not get a weaker route; it gets the same one
  // with a different mode, and the database decides whether that mode is
  // permitted at all.
  const preflight = await prepareSameKeyCredentialRenewal(
    { ...input, renewalMode: ROTATE_KEY_RENEWAL_MODE },
    repository,
    reservationGateway,
  );
  if (preflight.outcome === "REFUSED" || preflight.reservation === undefined) {
    const detail = preflight.detail ?? "the rotation preflight refused";
    // A policy refusal is its own answer, not a generic failure: "rotation is
    // disabled pending an owner decision" is actionable, "preflight refused" is
    // not.
    const notPermitted =
      detail.includes("KLUY-RENEWAL-ROTATION-NOT-PERMITTED") ||
      detail.includes("KLUY-RENEWAL-NO-POLICY");
    return {
      outcome: "REFUSED",
      refusalCode: notPermitted ? "ROTATION_NOT_PERMITTED" : "ROTATION_PREFLIGHT_REFUSED",
      preflightRefusalCode: preflight.refusalCode,
      detail,
    };
  }
  const reservation = preflight.reservation;

  if (reservation.renewalMode !== ROTATE_KEY_RENEWAL_MODE) {
    return refuse(
      "ROTATION_WRONG_MODE",
      `the database froze mode ${reservation.renewalMode}; this orchestration only issues ${ROTATE_KEY_RENEWAL_MODE}`,
      { reservation },
    );
  }
  if (isRestricted(input.trustedTime.status) || input.trustedTime.trustedTime === null) {
    return refuse(
      "ROTATION_NO_TRUSTED_TIME",
      `no trusted time is established (status ${input.trustedTime.status})`,
      { reservation },
    );
  }
  const trustedNow = input.trustedTime.trustedTime;

  // The KEY generation is not the CREDENTIAL generation, and this is the one
  // place a rotation has to know the difference.
  if (reservation.currentKeyGeneration === null) {
    return refuse(
      "ROTATION_NO_CURRENT_KEY_GENERATION",
      "the incumbent provider key records no key generation; rotation cannot decide what the next one is",
      { reservation },
    );
  }
  const previousKeyGeneration = reservation.currentKeyGeneration;
  const nextKeyGeneration = previousKeyGeneration + 1;

  // The INCUMBENT key, re-read. §11: it must remain available through the
  // overlap, so a rotation that found it already gone would be rotating away
  // from nothing — and the reference is needed to report what was replaced.
  const incumbentKey = await repository.loadCurrentProviderKey({
    deviceRecordId: reservation.deviceRecordId,
    environment: reservation.environment,
    purpose: reservation.purpose,
  });
  if (incumbentKey === null || incumbentKey.state !== "active") {
    return refuse(
      "ROTATION_NO_CURRENT_KEY_GENERATION",
      `the incumbent provider key is ${incumbentKey?.state ?? "absent"}; rotation replaces an ACTIVE key`,
      { reservation },
    );
  }

  // -- 2. GENERATE, AFTER THE RESERVATION AND NOT BEFORE --------------------
  let replacement;
  try {
    replacement = await provider.generateReplacementKey({
      deviceRecordId: reservation.deviceRecordId,
      environment: reservation.environment,
      purpose: reservation.purpose,
      renewalAttemptId: reservation.renewalAttemptId,
      keyGeneration: nextKeyGeneration,
    });
  } catch (error) {
    return refuse("ROTATION_KEY_GENERATION_FAILED", errorText(error), { reservation });
  }

  // A "rotation" that produced the incumbent key would be a same-key renewal
  // wearing the wrong name. Refused here as well as in the database.
  if (replacement.publicKeyFingerprint === reservation.currentPublicKeyFingerprint) {
    return refuse(
      "ROTATION_REPLACEMENT_REUSES_INCUMBENT",
      "the provider returned the incumbent key as a replacement",
      { reservation },
    );
  }
  // The provider's own metadata must agree with the key it just handed over.
  if (publicKeyFingerprint(replacement.publicKeyPem) !== replacement.publicKeyFingerprint) {
    return refuse(
      "ROTATION_KEY_GENERATION_FAILED",
      "the provider's declared fingerprint does not match the public key it returned",
      { reservation },
    );
  }

  // -- 3. REGISTER PUBLIC METADATA -----------------------------------------
  // The database learns that a key EXISTS. It learns nothing about whether the
  // private half is loaded, which is why the row lands in `generated`.
  let registered: RegisteredReplacementKey;
  try {
    registered = await rotationGateway.registerReplacementKey({
      renewalAttemptId: reservation.renewalAttemptId,
      providerKeyReference: replacement.providerKeyReference,
      publicKeyPem: replacement.publicKeyPem,
      publicKeyFingerprint: replacement.publicKeyFingerprint,
      keyGeneration: nextKeyGeneration,
    });
  } catch (error) {
    return refuse("ROTATION_REGISTRATION_REFUSED", errorText(error), { reservation });
  }

  // The registration OUTCOME and the stored ROW must agree. A gateway that
  // reported success while the row says something else is the divergence this
  // whole step exists to catch.
  if (registered.providerKeyReference !== replacement.providerKeyReference) {
    return refuse(
      "ROTATION_REGISTRATION_DIVERGED",
      `registration returned provider key ${registered.providerKeyReference}, not the one generated`,
      { reservation },
    );
  }

  const registeredRow = await rotationGateway.loadReplacementKey(reservation.renewalAttemptId);
  if (registeredRow === null) {
    return refuse(
      "ROTATION_REGISTRATION_DIVERGED",
      "registration reported success and the database holds no replacement key for this attempt",
      { reservation },
    );
  }
  if (
    registeredRow.publicKeyFingerprint !== replacement.publicKeyFingerprint ||
    registeredRow.providerKeyReference !== replacement.providerKeyReference ||
    (registeredRow.keyGeneration ?? registeredRow.generation) !== nextKeyGeneration
  ) {
    // A retry that reached an EARLIER key for this attempt lands here. The
    // provider and the database disagree about which key this renewal owns, and
    // proceeding would sign a credential for one of them at random.
    return refuse(
      "ROTATION_REGISTRATION_DIVERGED",
      `the registered key (${registeredRow.publicKeyFingerprint}, ${registeredRow.providerKeyReference}, key generation ${registeredRow.keyGeneration ?? registeredRow.generation}) is not the key the provider generated for this attempt`,
      { reservation },
    );
  }

  // -- 4. PROOF OF POSSESSION, BY THE REPLACEMENT KEY -----------------------
  // A registered public key is a claim. This is the evidence: the private half
  // signs a challenge bound to this renewal, this device, this incumbent, both
  // generations and this fingerprint — so no proof from anywhere else fits.
  const challenge = buildReplacementChallenge(
    reservation,
    replacement.publicKeyFingerprint,
    trustedNow,
  );
  let popSignature: Uint8Array;
  try {
    popSignature = provider.proveReplacementPossession(
      replacement.providerKeyReference,
      // The exact bytes the verifier will check. Built once, used twice.
      replacementChallengeBytes(challenge),
    );
  } catch (error) {
    const code = error instanceof ReplacementKeyError ? error.code : undefined;
    return refuse(
      "ROTATION_POSSESSION_PROOF_FAILED",
      `${code ?? "provider refused"}: ${errorText(error)}`,
      { reservation },
    );
  }

  const popVerdict = verifyReplacementKeyPop(
    challenge,
    popSignature,
    replacement.publicKeyPem,
    {
      renewalAttemptId: reservation.renewalAttemptId,
      deviceRecordId: reservation.deviceRecordId,
      currentCredentialId: reservation.currentCredentialId,
      currentGeneration: reservation.currentCredentialGeneration,
      nextGeneration: reservation.nextCredentialGeneration,
      assignmentGeneration: reservation.assignmentGeneration,
      environment: reservation.environment,
      purpose: reservation.purpose,
      // From the DATABASE row, not from the provider's own claim about itself.
      providerKeyFingerprint: registeredRow.publicKeyFingerprint,
      providerKeyState: registeredRow.state,
    },
    input.trustedTime,
    publicKeyFingerprint,
  );
  if (!popVerdict.verified) {
    return refuse(
      "ROTATION_POSSESSION_PROOF_FAILED",
      `${popVerdict.refusalCode}: ${popVerdict.detail ?? "the replacement key did not prove possession"}`,
      { reservation, popRefusalCode: popVerdict.refusalCode },
    );
  }

  // -- 5. THE SHARED GOVERNED PIPELINE --------------------------------------
  // Same prepare/sign/record/finalize as first issuance and as same-key
  // renewal. The binding decorator expects the REPLACEMENT fingerprint here:
  // presenting the incumbent would mean the rotation did not rotate.
  const adapter = await runGovernedIssuance(
    {
      requestId: rotationRequestId(reservation),
      deviceRecordId: reservation.deviceRecordId,
      environment: input.environment,
      purpose: input.purpose,
      assignmentGeneration: reservation.assignmentGeneration,
      publicKeyPem: replacement.publicKeyPem,
      publicKeyFingerprint: replacement.publicKeyFingerprint,
      idempotencyKey: rotationIdempotencyKey(reservation),
      canonicalPayloadHash: popVerdict.challengeHash ?? sha256Hex(challenge.nonce),
      popAlgorithm: "ed25519",
      popSignedPreimageHash: sha256Hex(replacementChallengeBytes(challenge)),
      popSignature,
      // OPTION B: THIS module computed the verdict above with the real
      // verifier. It is an attestation from inside the trusted computing base
      // (KLRISK-DEVICE-003), never something a caller handed in.
      popServiceVerified: popVerdict.verified,
      issuerKeyId: ca.intermediateKeyId,
      trustedTime: trustedNow,
      trustedTimeStatus: input.trustedTime.status,
      actorRef: input.actorRef,
      hardwareTrustLevel: "development_software",
    },
    bindReservationToPreparation(issuanceGateway, reservation, replacement.publicKeyFingerprint),
    ca,
  );

  if (adapter.outcome === "REFUSED") {
    const detail = adapter.detail ?? "the governed issuance pipeline refused";
    return refuse(
      detail.includes(BINDING_MARKER)
        ? "ROTATION_BINDING_REFUSED"
        : (ISSUANCE_REFUSAL_CODES[adapter.refusalCode ?? ""] ?? "ROTATION_ISSUANCE_REFUSED"),
      `${adapter.refusalCode ?? "ISSUE_REFUSED"}: ${detail}`,
      { reservation },
    );
  }
  const credential = adapter.credential;
  if (credential === undefined) {
    return refuse(
      "ROTATION_ISSUANCE_REFUSED",
      "the pipeline reported success without a credential",
      { reservation },
    );
  }

  // -- 6. PENDING ACTIVATION — THE STATE THAT MUST EXIST --------------------
  // TASK D. If the key were `active` here, a credential row would have been
  // taken as evidence about the external provider, which is the claim
  // PostgreSQL cannot make.
  const pendingKey = await rotationGateway.loadReplacementKey(reservation.renewalAttemptId);
  const pendingStatus = await rotationGateway.loadReservationStatus(reservation.renewalAttemptId);
  if (pendingKey === null || pendingKey.state !== "credential_issued_pending_activation") {
    return refuse(
      "ROTATION_PENDING_STATE_UNEXPECTED",
      `after finalization the replacement key is ${pendingKey?.state ?? "absent"}; it must be credential_issued_pending_activation`,
      {
        reservation,
        credentialIssuedButNotActivated: {
          credentialId: credential.credentialId,
          credentialGeneration: credential.certificateGeneration,
          replacementKeyState: pendingKey?.state ?? "absent",
          reservationStatus: pendingStatus ?? "unknown",
        },
      },
    );
  }

  // -- 7. THE PROVIDER ACTIVATES ------------------------------------------
  // The only step that can honestly answer "is the private half usable".
  try {
    await provider.activateReplacementKey({
      deviceRecordId: reservation.deviceRecordId,
      environment: reservation.environment,
      purpose: reservation.purpose,
      renewalAttemptId: reservation.renewalAttemptId,
      keyGeneration: nextKeyGeneration,
      providerKeyReference: replacement.providerKeyReference,
      publicKeyFingerprint: replacement.publicKeyFingerprint,
      credentialFinalized: true,
      credentialId: credential.credentialId,
    });
  } catch (error) {
    const code = error instanceof ReplacementKeyError ? error.code : undefined;
    return refuse(
      "ROTATION_PROVIDER_ACTIVATION_FAILED",
      `${code ?? "provider refused"}: ${errorText(error)}`,
      {
        reservation,
        credentialIssuedButNotActivated: {
          credentialId: credential.credentialId,
          credentialGeneration: credential.certificateGeneration,
          replacementKeyState: pendingKey.state,
          reservationStatus: pendingStatus ?? "unknown",
        },
      },
    );
  }

  // -- 8. THE DATABASE RECORDS THE PROVIDER'S ANSWER -----------------------
  let confirmation: ActivationConfirmation;
  try {
    confirmation = await rotationGateway.confirmProviderKeyActivation({
      renewalAttemptId: reservation.renewalAttemptId,
      credentialId: credential.credentialId,
      deviceRecordId: reservation.deviceRecordId,
      environment: reservation.environment,
      purpose: reservation.purpose,
      credentialGeneration: credential.certificateGeneration,
      keyGeneration: nextKeyGeneration,
      providerKeyReference: replacement.providerKeyReference,
      publicKeyFingerprint: replacement.publicKeyFingerprint,
      actorRef: input.actorRef,
    });
  } catch (error) {
    return refuse("ROTATION_ACTIVATION_CONFIRMATION_REFUSED", errorText(error), {
      reservation,
      credentialIssuedButNotActivated: {
        credentialId: credential.credentialId,
        credentialGeneration: credential.certificateGeneration,
        replacementKeyState: pendingKey.state,
        reservationStatus: pendingStatus ?? "unknown",
      },
    });
  }

  // -- 9. RE-VERIFY WHAT WAS PERSISTED -------------------------------------
  const scope = {
    deviceRecordId: input.deviceRecordId,
    environment: input.environment,
    purpose: input.purpose,
  };
  const persisted = await repository.loadCredentialAtGeneration(
    scope,
    credential.certificateGeneration,
  );
  if (persisted === null) {
    return refuse(
      "ROTATION_POST_VERIFICATION_FAILED",
      `no credential was persisted at generation ${credential.certificateGeneration}`,
      { reservation },
    );
  }
  if (persisted.publicKeyFingerprint !== replacement.publicKeyFingerprint) {
    return refuse(
      "ROTATION_POST_VERIFICATION_FAILED",
      "the persisted credential does not attest to the replacement key",
      { reservation },
    );
  }
  const chain = buildChainFromStoredLinks(
    await repository.loadCredentialChainLinks(persisted.credentialId),
  );
  if (chain === null) {
    return refuse(
      "ROTATION_POST_VERIFICATION_FAILED",
      "the persisted credential has no complete, parseable chain",
      { reservation },
    );
  }
  const validity = evaluateCertificateValidity({
    chain,
    trustedTime: input.trustedTime,
    environment: input.environment,
    deviceRecordId: input.deviceRecordId,
    // The device now holds the REPLACEMENT key. A credential attesting to the
    // superseded one would be vouching for a key that is on its way out.
    currentKeyFingerprint: replacement.publicKeyFingerprint,
    currentCertificateGeneration: reservation.nextCredentialGeneration,
    revocations: {
      isCertificateRevoked: (serial) =>
        persisted.state === "revoked" && serial === persisted.serialNumber,
      isDeviceRevoked: () => false,
    },
    trustedRootFingerprints: input.trustedRootFingerprints,
  });
  if (!validity.valid) {
    return refuse(
      "ROTATION_POST_VERIFICATION_FAILED",
      `${validity.rejectionCode}: ${validity.detail ?? "the persisted credential did not verify"}`,
      {
        reservation,
        credentialIssuedButNotActivated: {
          credentialId: credential.credentialId,
          credentialGeneration: credential.certificateGeneration,
          replacementKeyState: "active",
          reservationStatus:
            (await rotationGateway.loadReservationStatus(reservation.renewalAttemptId)) ??
            "unknown",
        },
      },
    );
  }

  const activeKey = await rotationGateway.loadReplacementKey(reservation.renewalAttemptId);
  const finalStatus = await rotationGateway.loadReservationStatus(reservation.renewalAttemptId);
  const providerState = provider.describeReplacementKey(reservation.renewalAttemptId)?.state;

  return {
    outcome: "ROTATED",
    reservation,
    readiness: {
      credentialCryptographicallyValid: true,
      replacementKeyActiveInProvider: providerState === "active",
      databaseActivationConfirmed:
        (confirmation.outcome === "ACTIVATED" || confirmation.outcome === "ALREADY_ACTIVE") &&
        activeKey?.state === "active",
      // ALL THREE, or the credential is not usable. Written as a conjunction so
      // a future edit has to delete a term rather than quietly widen a boolean.
      operationallyReady:
        providerState === "active" && activeKey?.state === "active" && finalStatus === "completed",
      consumersMustReVerifyAtAuthenticationBoundary: true,
    },
    rotated: {
      credentialId: credential.credentialId,
      serialNumber: credential.serialNumber,
      previousCredentialGeneration: reservation.currentCredentialGeneration,
      credentialGeneration: credential.certificateGeneration,
      previousKeyGeneration,
      keyGeneration: nextKeyGeneration,
      incumbentPublicKeyFingerprint: reservation.currentPublicKeyFingerprint,
      replacementPublicKeyFingerprint: replacement.publicKeyFingerprint,
      incumbentProviderKeyReference: incumbentKey.providerKeyReference,
      replacementProviderKeyReference: replacement.providerKeyReference,
      notBefore: credential.notBefore,
      notAfter: credential.notAfter,
      credentialGenerationAdvanced: true,
      keyGenerationAdvanced: true,
      keyRotated: true,
    },
  };
}
