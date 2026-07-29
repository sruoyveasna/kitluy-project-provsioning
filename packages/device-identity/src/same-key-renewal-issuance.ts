/**
 * Same-key renewal issuance — WS-11-T003 Step 4, Prompt 2B-2.
 *
 * Authority: KLD-2026-07-28-002 §4, §5, §7, §12.6; the owner renewal
 * instruction of 2026-07-29; migration groups 0125, 0127, 0130, 0131, 0132.
 *
 * ===========================================================================
 * ONE ROUTE, NOT A SECOND ONE
 * ===========================================================================
 * Renewal issuance is the SAME governed pipeline as first issuance:
 *
 *     preflight + reservation   (Prompt 2B-1, reused verbatim)
 *       -> prepare              prepare_device_credential_issuance_v1
 *       -> sign                 the CA signs the reserved bytes
 *       -> record               record_device_credential_signature_v1
 *       -> finalize             finalize_device_credential_issuance_v1
 *       -> re-verify            the persisted credential, cryptographically
 *
 * The middle four steps are `runGovernedIssuance` from `issuance-adapter.ts`,
 * unchanged. Nothing here forks it. What this module adds is the RENEWAL
 * BINDING: the reservation the database froze must still describe reality at
 * the moment the database prepares, and that is checked BEFORE anything is
 * signed.
 *
 * ===========================================================================
 * WHO SIGNS WHAT — AND WHY IT IS NOT THE DEVICE KEY
 * ===========================================================================
 * A device credential is signed by the ISSUING INTERMEDIATE. It has to be:
 * `verifyCertificateChain` requires the device link's issuer to be the
 * intermediate and checks the signature under the intermediate's public key. A
 * credential signed by the device's own key would be self-asserted, would fail
 * that verification, and could not satisfy the post-finalization check this
 * module performs.
 *
 * The DEVICE key's job in a same-key renewal is different and is the thing that
 * makes it a *same-key* renewal at all: it proves, freshly, that the device
 * still holds the private half of the incumbent key. That proof is what this
 * module signs with the device key, over a domain-separated, renewal-bound
 * preimage, and it is verified with the real verifier before the database is
 * told anything about it.
 *
 * ===========================================================================
 * THE CALLER SUPPLIES NOTHING THAT DECIDES IDENTITY
 * ===========================================================================
 * Credential id, serial, generation, validity window, canonical TBS and its
 * digest all come from the database. So does the idempotency key — it is
 * DERIVED from the frozen renewal attempt id, because
 * `prepare_device_credential_issuance_v1` derives the credential id and serial
 * FROM that key. A caller able to choose it would be choosing the serial.
 *
 * There is no `signatureValid` input anywhere on this boundary.
 */

import { createHash } from "node:crypto";

import type { TrustEnvironment } from "./environments.js";
import {
  evaluateCertificateValidity,
  type CertificateRejectionCode,
} from "./certificate-validity.js";
import { isRestricted } from "./trusted-time.js";
import { verifyDetachedSignature, type DevelopmentCertificateAuthority } from "./dev-crypto.js";
import {
  runGovernedIssuance,
  type GovernedIssuanceGateway,
  type PreparedReservation,
} from "./issuance-adapter.js";
import {
  SAME_KEY_RENEWAL_MODE,
  buildChainFromStoredLinks,
  prepareSameKeyCredentialRenewal,
  type IncumbentCredentialRepository,
  type ProviderKeyRecord,
  type RenewalReservationGateway,
  type SameKeyRenewalPreflightInput,
  type SameKeyRenewalRefusalCode,
  type SameKeyRenewalReservation,
} from "./same-key-renewal-preflight.js";

/** Domain separator. Distinct from `kitluy.csr.v1` and `kitluy.renewal-pop.v1`. */
export const SAME_KEY_RENEWAL_POP_KIND = "kitluy.same-key-renewal-pop.v1" as const;

/**
 * Marker prefix for the binding refusals this module raises from inside the
 * gateway decorator. It travels through `runGovernedIssuance`'s refusal
 * `detail` verbatim and is mapped back to a typed code here.
 */
const BINDING_MARKER = "KLUY-RENEWAL-ISSUANCE-BINDING";

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

/**
 * The device key, used ONLY to prove continued possession. There is no export
 * method and no way to obtain key material — the same discipline as
 * `DeviceKeyProvider`, narrowed to what this module needs.
 */
export interface IncumbentDeviceKeySigner {
  /** The public half, for verifying the proof this module just requested. */
  publicKeyPem(providerKeyReference: string): string | null;
  /** Signs WITHOUT surrendering the key. */
  proveIncumbentPossession(providerKeyReference: string, payload: Uint8Array): Uint8Array;
}

/**
 * Reads the credential and chain back OUT of PostgreSQL after finalization, so
 * the new credential is verified as PERSISTED rather than as constructed.
 */
export type PersistedCredentialReader = Pick<
  IncumbentCredentialRepository,
  "loadCredentialAtGeneration" | "loadCredentialChainLinks"
>;

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

export type SameKeyRenewalIssuanceRefusalCode =
  /** The preflight refused. Its own typed code travels in `preflightRefusalCode`. */
  | "RENEWAL_ISSUANCE_PREFLIGHT_REFUSED"
  | "RENEWAL_ISSUANCE_NO_TRUSTED_TIME"
  | "RENEWAL_ISSUANCE_RESERVATION_NOT_USABLE"
  | "RENEWAL_ISSUANCE_WRONG_MODE"
  | "RENEWAL_ISSUANCE_WRONG_DEVICE"
  | "RENEWAL_ISSUANCE_GENERATION_MISMATCH"
  | "RENEWAL_ISSUANCE_HEAD_MOVED"
  | "RENEWAL_ISSUANCE_ASSIGNMENT_MOVED"
  | "RENEWAL_ISSUANCE_FINGERPRINT_CHANGED"
  | "RENEWAL_ISSUANCE_PROVIDER_KEY_MISSING"
  | "RENEWAL_ISSUANCE_PROVIDER_KEY_NOT_ACTIVE"
  | "RENEWAL_ISSUANCE_PROVIDER_KEY_MISMATCH"
  | "RENEWAL_ISSUANCE_POSSESSION_PROOF_FAILED"
  | "RENEWAL_ISSUANCE_CANONICAL_TBS_DIVERGENCE"
  | "RENEWAL_ISSUANCE_SIGNING_FAILED"
  | "RENEWAL_ISSUANCE_SIGNATURE_SELF_VERIFICATION_FAILED"
  | "RENEWAL_ISSUANCE_SIGNATURE_NOT_PERSISTED"
  | "RENEWAL_ISSUANCE_FINALIZATION_FAILED"
  | "RENEWAL_ISSUANCE_REFUSED_BY_DATABASE"
  /** Finalization reported success and the persisted credential does NOT verify. */
  | "RENEWAL_ISSUANCE_POST_VERIFICATION_FAILED";

/** Adapter refusals, mapped without losing the underlying reason. */
const ADAPTER_REFUSAL_CODES: Readonly<Record<string, SameKeyRenewalIssuanceRefusalCode>> = {
  ISSUE_CANONICAL_TBS_DIVERGENCE: "RENEWAL_ISSUANCE_CANONICAL_TBS_DIVERGENCE",
  ISSUE_CANONICAL_TBS_HASH_DIVERGENCE: "RENEWAL_ISSUANCE_CANONICAL_TBS_DIVERGENCE",
  ISSUE_SIGNING_FAILED: "RENEWAL_ISSUANCE_SIGNING_FAILED",
  ISSUE_SIGNATURE_SELF_VERIFICATION_FAILED: "RENEWAL_ISSUANCE_SIGNATURE_SELF_VERIFICATION_FAILED",
  ISSUE_SIGNATURE_NOT_PERSISTED: "RENEWAL_ISSUANCE_SIGNATURE_NOT_PERSISTED",
  ISSUE_FINALIZATION_FAILED: "RENEWAL_ISSUANCE_FINALIZATION_FAILED",
  ISSUE_REFUSED_BY_DATABASE: "RENEWAL_ISSUANCE_REFUSED_BY_DATABASE",
};

/** The binding failures this module detects between reservation and preparation. */
const BINDING_REFUSAL_CODES: ReadonlyArray<readonly [string, SameKeyRenewalIssuanceRefusalCode]> = [
  ["GENERATION_MISMATCH", "RENEWAL_ISSUANCE_GENERATION_MISMATCH"],
  ["HEAD_MOVED", "RENEWAL_ISSUANCE_HEAD_MOVED"],
  ["ASSIGNMENT_MOVED", "RENEWAL_ISSUANCE_ASSIGNMENT_MOVED"],
  ["FINGERPRINT_CHANGED", "RENEWAL_ISSUANCE_FINGERPRINT_CHANGED"],
  ["WRONG_DEVICE", "RENEWAL_ISSUANCE_WRONG_DEVICE"],
];

// ---------------------------------------------------------------------------
// Input and outcome
// ---------------------------------------------------------------------------

export interface SameKeyRenewalIssuanceInput extends SameKeyRenewalPreflightInput {
  /**
   * Who is performing the renewal, for the governed audit. Not an authority:
   * the database checks the executing identity itself.
   */
  readonly actorRef: string;
}

/**
 * What actually changed. Stated as four separate facts rather than one
 * "renewed" boolean, because the whole point of `reuse_current_key` is that two
 * of them did NOT move.
 */
export interface SameKeyRenewalEffect {
  readonly credentialId: string;
  readonly serialNumber: string;
  readonly previousCredentialGeneration: number;
  readonly credentialGeneration: number;
  readonly keyGeneration: number | null;
  readonly publicKeyFingerprint: string;
  readonly providerKeyReference: string;
  readonly notBefore?: string;
  readonly notAfter?: string;
  /** The credential generation advanced by exactly one. */
  readonly credentialGenerationAdvanced: true;
  /** The KEY generation did not move. */
  readonly keyGenerationUnchanged: true;
  /** No key was rotated. Stated, so a reader never has to infer it. */
  readonly keyRotated: false;
}

/**
 * The post-finalization verdict, from the REAL verifier run against the
 * credential as PERSISTED.
 *
 * There is still no caller-usable "verified" boolean for authentication. This
 * records that the orchestration itself re-verified what it wrote — a refusal
 * to report success on a credential that does not verify — and consumers at an
 * authentication boundary must run the verifier themselves.
 */
export interface PersistedCredentialCheck {
  readonly credentialKind: string;
  readonly evaluatedAtTrustedTime?: Date;
  readonly expiresAt?: Date;
  readonly consumersMustReVerifyAtAuthenticationBoundary: true;
}

export interface SameKeyRenewalIssuanceOutcome {
  readonly outcome: "RENEWED" | "REPLAYED" | "REFUSED";
  readonly reservation?: SameKeyRenewalReservation;
  readonly renewed?: SameKeyRenewalEffect;
  readonly persistedCredential?: PersistedCredentialCheck;
  readonly refusalCode?: SameKeyRenewalIssuanceRefusalCode;
  /** The preflight's own typed code, when the preflight is what refused. */
  readonly preflightRefusalCode?: SameKeyRenewalRefusalCode;
  /** The underlying reason, preserved verbatim. Never flattened. */
  readonly detail?: string;
  readonly requiresRecovery?: boolean;
  /** Set ONLY when a signature exists that no durable record accounts for. */
  readonly orphanSignature?: {
    readonly requestId: string;
    readonly serialNumber: string;
    readonly signatureSha256: string;
    readonly detail: string;
  };
  /** True when the signature is durable and finalization may be retried. */
  readonly recoverableFromRecordedSignature?: boolean;
}

// ---------------------------------------------------------------------------
// Derived identity
// ---------------------------------------------------------------------------

/**
 * The bytes the DEVICE key signs to prove it still holds the incumbent key.
 *
 * Bound to the renewal attempt, the incumbent, both generations, the
 * fingerprint, the assignment generation and the scope, so a proof cannot be
 * replayed onto another renewal, another device or another generation. Field
 * order is fixed here, not taken from object key order.
 */
export function samePossessionPreimage(reservation: SameKeyRenewalReservation): Uint8Array {
  return Buffer.from(
    [
      SAME_KEY_RENEWAL_POP_KIND,
      reservation.renewalAttemptId,
      reservation.deviceRecordId,
      reservation.currentCredentialId,
      String(reservation.currentCredentialGeneration),
      String(reservation.nextCredentialGeneration),
      reservation.currentPublicKeyFingerprint,
      String(reservation.assignmentGeneration),
      reservation.environment,
      reservation.purpose,
    ].join("\n"),
    "utf8",
  );
}

/**
 * The idempotency key, DERIVED from the frozen reservation.
 *
 * `prepare_device_credential_issuance_v1` derives the credential id and the
 * serial from this value, so a caller able to supply it would be choosing the
 * serial. Deriving it from the renewal attempt id makes retry idempotent by
 * construction and takes the choice away from the caller entirely.
 */
export function renewalIdempotencyKey(reservation: SameKeyRenewalReservation): string {
  return createHash("sha256")
    .update(
      Buffer.from(
        [
          "kitluy.same-key-renewal.v1",
          reservation.renewalAttemptId,
          String(reservation.nextCredentialGeneration),
        ].join("\n"),
        "utf8",
      ),
    )
    .digest("hex");
}

export function renewalRequestId(reservation: SameKeyRenewalReservation): string {
  return `rnw-${reservation.renewalAttemptId}`;
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

// ---------------------------------------------------------------------------
// The orchestration
// ---------------------------------------------------------------------------

/**
 * Runs a complete same-key renewal: preflight, reservation, prepare, sign,
 * record, finalize, then re-verify what was persisted.
 *
 * The reservation is CONSUMED, not re-derived. Every identifier the database
 * froze is carried forward and re-checked against what the database prepares —
 * and any disagreement refuses BEFORE the CA is asked to sign, because a
 * signature over the wrong generation is a credential nobody asked for.
 */
export async function completeSameKeyCredentialRenewal(
  input: SameKeyRenewalIssuanceInput,
  repository: IncumbentCredentialRepository,
  reservationGateway: RenewalReservationGateway,
  issuanceGateway: GovernedIssuanceGateway,
  ca: DevelopmentCertificateAuthority,
  signer: IncumbentDeviceKeySigner,
): Promise<SameKeyRenewalIssuanceOutcome> {
  const refuse = (
    refusalCode: SameKeyRenewalIssuanceRefusalCode,
    detail: string,
    extra: Partial<SameKeyRenewalIssuanceOutcome> = {},
  ): SameKeyRenewalIssuanceOutcome => ({ outcome: "REFUSED", refusalCode, detail, ...extra });

  // -- 1. PREFLIGHT + RESERVATION, reused verbatim --------------------------
  const preflight = await prepareSameKeyCredentialRenewal(input, repository, reservationGateway);
  if (preflight.outcome === "REFUSED" || preflight.reservation === undefined) {
    return {
      outcome: "REFUSED",
      refusalCode: "RENEWAL_ISSUANCE_PREFLIGHT_REFUSED",
      preflightRefusalCode: preflight.refusalCode,
      detail: preflight.detail,
      requiresRecovery: preflight.requiresRecovery,
    };
  }
  const reservation = preflight.reservation;

  // Trusted time was already established by the preflight; this is the value
  // the governed preparation is given, and it is the SAME instant.
  if (isRestricted(input.trustedTime.status) || input.trustedTime.trustedTime === null) {
    return refuse(
      "RENEWAL_ISSUANCE_NO_TRUSTED_TIME",
      `no trusted time is established (status ${input.trustedTime.status})`,
      { reservation },
    );
  }
  const trustedNow = input.trustedTime.trustedTime;

  // -- 2. THE RESERVATION MUST STILL BE USABLE ------------------------------
  if (reservation.deviceRecordId !== input.deviceRecordId) {
    return refuse("RENEWAL_ISSUANCE_WRONG_DEVICE", "the reservation belongs to another device", {
      reservation,
    });
  }
  if (reservation.renewalMode !== SAME_KEY_RENEWAL_MODE) {
    return refuse(
      "RENEWAL_ISSUANCE_WRONG_MODE",
      `the reservation is ${reservation.renewalMode}; this orchestration issues ${SAME_KEY_RENEWAL_MODE} only`,
      { reservation },
    );
  }
  if (TERMINAL_RESERVATION_STATUSES.has(reservation.reservationStatus)) {
    return refuse(
      "RENEWAL_ISSUANCE_RESERVATION_NOT_USABLE",
      `reservation ${reservation.renewalAttemptId} is ${reservation.reservationStatus} and cannot issue`,
      { reservation },
    );
  }
  if (reservation.nextCredentialGeneration !== reservation.currentCredentialGeneration + 1) {
    return refuse(
      "RENEWAL_ISSUANCE_GENERATION_MISMATCH",
      `the reservation targets generation ${reservation.nextCredentialGeneration} from ${reservation.currentCredentialGeneration}`,
      { reservation },
    );
  }

  const scope = {
    deviceRecordId: input.deviceRecordId,
    environment: input.environment,
    purpose: input.purpose,
  };

  // -- 3. THE INCUMBENT KEY, RE-PROVEN --------------------------------------
  // The preflight already checked all of this. It is checked AGAIN here for the
  // same reason the database revalidates at finalization: preparation is not a
  // licence, and time passed.
  const incumbent = await repository.loadCredentialAtGeneration(
    scope,
    reservation.currentCredentialGeneration,
  );
  if (incumbent === null) {
    return refuse(
      "RENEWAL_ISSUANCE_GENERATION_MISMATCH",
      `the incumbent credential at generation ${reservation.currentCredentialGeneration} is gone`,
      { reservation },
    );
  }
  if (incumbent.publicKeyFingerprint !== reservation.currentPublicKeyFingerprint) {
    return refuse(
      "RENEWAL_ISSUANCE_FINGERPRINT_CHANGED",
      "the incumbent credential no longer attests to the reserved key",
      { reservation },
    );
  }

  const providerKey = await repository.loadCurrentProviderKey(scope);
  const keyRefusal = refuseUnusableProviderKey(providerKey, reservation, scope);
  if (keyRefusal !== null) return { ...keyRefusal, reservation };
  const key = providerKey as ProviderKeyRecord;

  // -- 4. PROOF THAT THE DEVICE STILL HOLDS THE INCUMBENT PRIVATE KEY -------
  // This is what makes it a SAME-KEY renewal rather than an assertion that the
  // key is unchanged. Verified with the real verifier; the caller supplies no
  // verdict, and a failure stops here with nothing prepared.
  const devicePublicKeyPem = signer.publicKeyPem(key.providerKeyReference);
  if (devicePublicKeyPem === null) {
    return refuse(
      "RENEWAL_ISSUANCE_PROVIDER_KEY_MISSING",
      `the provider holds no key under reference ${key.providerKeyReference}`,
      { reservation },
    );
  }
  const possessionPreimage = samePossessionPreimage(reservation);
  let possessionSignature: Uint8Array;
  try {
    possessionSignature = signer.proveIncumbentPossession(
      key.providerKeyReference,
      possessionPreimage,
    );
  } catch (error) {
    return refuse("RENEWAL_ISSUANCE_POSSESSION_PROOF_FAILED", errorText(error), { reservation });
  }
  const possessionVerified = verifyDetachedSignature(
    devicePublicKeyPem,
    possessionPreimage,
    possessionSignature,
  );
  if (!possessionVerified) {
    return refuse(
      "RENEWAL_ISSUANCE_POSSESSION_PROOF_FAILED",
      "the device did not prove possession of the incumbent private key",
      { reservation },
    );
  }

  // -- 5. PREPARE -> SIGN -> RECORD -> FINALIZE -----------------------------
  // The shared governed pipeline, unforked. The gateway is DECORATED so the
  // renewal binding is checked between the database's preparation and the CA
  // being asked to sign: a throw there means nothing was ever signed.
  const requestId = renewalRequestId(reservation);
  const idempotencyKey = renewalIdempotencyKey(reservation);

  const adapter = await runGovernedIssuance(
    {
      requestId,
      deviceRecordId: input.deviceRecordId,
      environment: input.environment,
      purpose: input.purpose,
      // FROZEN by the reservation, not read fresh: a reassignment between
      // reservation and preparation must refuse, not silently re-target.
      assignmentGeneration: reservation.assignmentGeneration,
      publicKeyPem: devicePublicKeyPem,
      publicKeyFingerprint: reservation.currentPublicKeyFingerprint,
      idempotencyKey,
      canonicalPayloadHash: sha256Hex(possessionPreimage),
      popAlgorithm: "ed25519",
      popSignedPreimageHash: sha256Hex(possessionPreimage),
      popSignature: possessionSignature,
      // OPTION B: THIS module computed the verdict above with the real
      // verifier. It is an attestation from inside the trusted computing base
      // (KLRISK-DEVICE-003), never something a caller handed in.
      popServiceVerified: possessionVerified,
      issuerKeyId: ca.intermediateKeyId,
      trustedTime: trustedNow,
      trustedTimeStatus: input.trustedTime.status,
      actorRef: input.actorRef,
      hardwareTrustLevel: incumbent.hardwareTrustLevel,
    },
    bindReservationToPreparation(issuanceGateway, reservation),
    ca,
  );

  if (adapter.outcome === "REFUSED") {
    const detail = adapter.detail ?? "the governed issuance pipeline refused";
    const binding = detail.includes(BINDING_MARKER)
      ? BINDING_REFUSAL_CODES.find(([marker]) => detail.includes(marker))?.[1]
      : undefined;
    return refuse(
      binding ??
        ADAPTER_REFUSAL_CODES[adapter.refusalCode ?? ""] ??
        "RENEWAL_ISSUANCE_REFUSED_BY_DATABASE",
      detail,
      {
        reservation,
        orphanSignature: adapter.orphanSignature,
        recoverableFromRecordedSignature: adapter.recoverableFromRecordedSignature,
      },
    );
  }

  const credential = adapter.credential;
  if (credential === undefined) {
    return refuse(
      "RENEWAL_ISSUANCE_FINALIZATION_FAILED",
      "the pipeline reported success without a credential",
      { reservation },
    );
  }

  // -- 6. RE-VERIFY WHAT WAS PERSISTED --------------------------------------
  // Finalization succeeding is a statement about BOOKKEEPING. It is not
  // evidence that the credential now on disk verifies, so the credential is
  // loaded back out of PostgreSQL and put through the real verifier.
  const check = await verifyPersistedCredential(
    repository,
    scope,
    input,
    reservation,
    credential.certificateGeneration,
  );
  if (check.refusal !== null) {
    return refuse("RENEWAL_ISSUANCE_POST_VERIFICATION_FAILED", check.refusal, {
      reservation,
      // The credential IS on disk. Reporting otherwise would send an operator
      // hunting for something that exists.
      recoverableFromRecordedSignature: true,
    });
  }

  return {
    outcome: adapter.outcome === "REPLAYED" ? "REPLAYED" : "RENEWED",
    reservation,
    persistedCredential: check.verified,
    renewed: {
      credentialId: credential.credentialId,
      serialNumber: credential.serialNumber,
      previousCredentialGeneration: reservation.currentCredentialGeneration,
      credentialGeneration: credential.certificateGeneration,
      // The KEY generation is the one thing a same-key renewal does not move.
      keyGeneration: reservation.currentKeyGeneration,
      publicKeyFingerprint: reservation.currentPublicKeyFingerprint,
      providerKeyReference: key.providerKeyReference,
      notBefore: credential.notBefore,
      notAfter: credential.notAfter,
      credentialGenerationAdvanced: true,
      keyGenerationUnchanged: true,
      keyRotated: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Statuses from which no issuance can proceed.
 *
 * `completed` is deliberately ABSENT. A completed reservation means this exact
 * renewal already finished, and the correct answer to a retry of it is the
 * credential it produced — not a refusal. Preparation is keyed on a request id
 * derived from the frozen attempt, so a retry replays onto ALREADY_ISSUED and
 * cannot mint anything. Refusing here instead would make the safe, expected
 * case — a caller that lost its response — look like an error.
 */
const TERMINAL_RESERVATION_STATUSES = new Set(["refused", "abandoned"]);

const sha256Hex = (value: Uint8Array | string): string =>
  createHash("sha256")
    .update(typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value))
    .digest("hex");

/**
 * Wraps the governed gateway so the reservation is compared against what the
 * database actually prepared — BEFORE the CA is asked for a signature.
 *
 * A throw here surfaces as a refusal from `runGovernedIssuance` with nothing
 * signed, which is the only safe place to discover that the head moved: a
 * signature over a generation the reservation did not reserve would otherwise
 * be finalized and advance the head for it.
 */
export function bindReservationToPreparation(
  gateway: GovernedIssuanceGateway,
  reservation: SameKeyRenewalReservation,
  /**
   * The fingerprint preparation must present. The incumbent under
   * `reuse_current_key`; the REPLACEMENT under `rotate_key`, where presenting
   * the incumbent would mean the rotation silently did not rotate.
   */
  expectedPublicKeyFingerprint: string = reservation.currentPublicKeyFingerprint,
): GovernedIssuanceGateway {
  return {
    ...gateway,
    async prepare(prepareInput): Promise<PreparedReservation> {
      const prepared = await gateway.prepare(prepareInput);

      // A replay that already issued carries only identifiers; the generation
      // is still checked, because a replay onto ANOTHER generation would be the
      // same failure arriving later.
      if (prepared.outcome === "ALREADY_ISSUED") {
        if (prepared.certificateGeneration !== reservation.nextCredentialGeneration) {
          throw new Error(
            `${BINDING_MARKER}-GENERATION_MISMATCH: the already-issued credential is generation ${prepared.certificateGeneration}, the reservation froze ${reservation.nextCredentialGeneration}`,
          );
        }
        return prepared;
      }

      // HEAD VERSION FIRST. A moved head shows up as BOTH a version change and
      // a generation change — preparation derives the generation from the head
      // it just locked — and "the head moved" is the cause, while "the
      // generation differs" is only its symptom.
      if (
        prepared.headVersionSeen !== undefined &&
        prepared.headVersionSeen !== reservation.credentialHeadVersion
      ) {
        throw new Error(
          `${BINDING_MARKER}-HEAD_MOVED: preparation saw head version ${prepared.headVersionSeen}, the reservation froze ${reservation.credentialHeadVersion}`,
        );
      }
      if (prepared.certificateGeneration !== reservation.nextCredentialGeneration) {
        throw new Error(
          `${BINDING_MARKER}-GENERATION_MISMATCH: the database prepared generation ${prepared.certificateGeneration}, the reservation froze ${reservation.nextCredentialGeneration}`,
        );
      }
      if (
        prepared.assignmentGeneration !== undefined &&
        prepared.assignmentGeneration !== reservation.assignmentGeneration
      ) {
        throw new Error(
          `${BINDING_MARKER}-ASSIGNMENT_MOVED: preparation carries assignment generation ${prepared.assignmentGeneration}, the reservation froze ${reservation.assignmentGeneration}`,
        );
      }
      if (prepareInput.publicKeyFingerprint !== expectedPublicKeyFingerprint) {
        throw new Error(
          `${BINDING_MARKER}-FINGERPRINT_CHANGED: preparation presents a key other than the one this renewal reserved`,
        );
      }
      if (prepareInput.deviceRecordId !== reservation.deviceRecordId) {
        throw new Error(`${BINDING_MARKER}-WRONG_DEVICE: preparation names another device`);
      }
      return prepared;
    },
  };
}

function refuseUnusableProviderKey(
  providerKey: ProviderKeyRecord | null,
  reservation: SameKeyRenewalReservation,
  scope: { deviceRecordId: string; environment: string; purpose: string },
): SameKeyRenewalIssuanceOutcome | null {
  const refuse = (
    refusalCode: SameKeyRenewalIssuanceRefusalCode,
    detail: string,
  ): SameKeyRenewalIssuanceOutcome => ({ outcome: "REFUSED", refusalCode, detail });

  if (providerKey === null) {
    return refuse(
      "RENEWAL_ISSUANCE_PROVIDER_KEY_MISSING",
      "no provider key is registered; reuse_current_key has nothing to reuse",
    );
  }
  if (
    providerKey.deviceRecordId !== scope.deviceRecordId ||
    providerKey.environment !== scope.environment ||
    providerKey.purpose !== scope.purpose
  ) {
    return refuse(
      "RENEWAL_ISSUANCE_PROVIDER_KEY_MISMATCH",
      "the provider key belongs to another device, environment or purpose",
    );
  }
  // `active` only. A `generated`, `credential_issued_pending_activation`,
  // `superseded`, `abandoned` or `destroyed` key is not the key this device is
  // operating with, whatever else is true of it.
  if (providerKey.state !== "active") {
    return refuse(
      "RENEWAL_ISSUANCE_PROVIDER_KEY_NOT_ACTIVE",
      `the provider key is ${providerKey.state}; only an active key may be reused`,
    );
  }
  if (providerKey.publicKeyFingerprint !== reservation.currentPublicKeyFingerprint) {
    return refuse(
      "RENEWAL_ISSUANCE_PROVIDER_KEY_MISMATCH",
      "the active provider key is not the key the reservation froze",
    );
  }
  const reservedKeyGeneration = reservation.currentKeyGeneration;
  const actualKeyGeneration = providerKey.keyGeneration ?? providerKey.generation;
  if (reservedKeyGeneration !== null && actualKeyGeneration !== reservedKeyGeneration) {
    return refuse(
      "RENEWAL_ISSUANCE_PROVIDER_KEY_MISMATCH",
      `the provider key is key generation ${actualKeyGeneration}, the reservation froze ${reservedKeyGeneration}`,
    );
  }
  return null;
}

/**
 * Loads the new credential and its chain back out of PostgreSQL and runs the
 * REAL verifier over them.
 *
 * Deliberately re-reads rather than verifying the in-memory certificate: what
 * matters is whether the bytes that were PERSISTED verify. A one-byte mutation
 * on disk must be caught here even though the row still says `issued`.
 */
async function verifyPersistedCredential(
  repository: PersistedCredentialReader,
  scope: { deviceRecordId: string; environment: TrustEnvironment; purpose: string },
  input: SameKeyRenewalIssuanceInput,
  reservation: SameKeyRenewalReservation,
  generation: number,
): Promise<{ readonly verified?: PersistedCredentialCheck; readonly refusal: string | null }> {
  const persisted = await repository.loadCredentialAtGeneration(scope, generation);
  if (persisted === null) {
    return { refusal: `no credential was persisted at generation ${generation}` };
  }
  if (persisted.certificateGeneration !== reservation.nextCredentialGeneration) {
    return {
      refusal: `the persisted credential is generation ${persisted.certificateGeneration}, the reservation froze ${reservation.nextCredentialGeneration}`,
    };
  }
  if (persisted.publicKeyFingerprint !== reservation.currentPublicKeyFingerprint) {
    return { refusal: "the persisted credential attests to a key other than the incumbent" };
  }
  if (persisted.assignmentGeneration !== reservation.assignmentGeneration) {
    return {
      refusal: `the persisted credential carries assignment generation ${persisted.assignmentGeneration}, the reservation froze ${reservation.assignmentGeneration}`,
    };
  }

  const links = await repository.loadCredentialChainLinks(persisted.credentialId);
  const chain = buildChainFromStoredLinks(links);
  if (chain === null) {
    return { refusal: "the persisted credential has no complete, parseable chain" };
  }

  const validity = evaluateCertificateValidity({
    chain,
    trustedTime: input.trustedTime,
    environment: input.environment,
    deviceRecordId: input.deviceRecordId,
    currentKeyFingerprint: reservation.currentPublicKeyFingerprint,
    currentCertificateGeneration: reservation.nextCredentialGeneration,
    // The credential was issued moments ago. Revocation is still consulted
    // rather than assumed: `just issued` is not `not revoked`.
    revocations: {
      isCertificateRevoked: (serial) =>
        persisted.state === "revoked" && serial === persisted.serialNumber,
      isDeviceRevoked: () => false,
    },
    trustedRootFingerprints: input.trustedRootFingerprints,
  });

  if (!validity.valid) {
    const code: CertificateRejectionCode = validity.rejectionCode ?? "CERT_CHAIN_INVALID";
    return {
      refusal: `${code}: ${validity.detail ?? "the persisted credential did not verify"}`,
    };
  }

  return {
    refusal: null,
    verified: {
      credentialKind: validity.credentialKind,
      evaluatedAtTrustedTime: validity.evaluatedAt,
      expiresAt: validity.expiresAt,
      consumersMustReVerifyAtAuthenticationBoundary: true,
    },
  };
}
