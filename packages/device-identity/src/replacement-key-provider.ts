/**
 * Replacement-key custody — WS-11-T003 Step 4, Prompt 2C.
 *
 * Authority: KLD-2026-07-28-002 §4, §5; the owner renewal instruction of
 * 2026-07-29; migration group 0130 TASK D.
 *
 * ===========================================================================
 * WHAT "ACTIVATION" MEANS, AND WHY IT LIVES HERE
 * ===========================================================================
 * Migration 0130 TASK D established the rule this module exists to honour: a
 * credential row proves a credential was ISSUED. It proves nothing about
 * whether the private half is loaded and usable in the external provider, and
 * PostgreSQL has no way to observe that. So the provider — not the database —
 * is what activates a replacement private key, and the database only RECORDS
 * the provider's answer afterwards.
 *
 * That ordering is the whole point. A key that the database called `active`
 * because a row appeared would be a claim nobody verified.
 *
 * ===========================================================================
 * CUSTODY
 * ===========================================================================
 * Private halves live in the same module-private vault as every other key in
 * `dev-crypto.ts`. This module exposes generation, description, possession
 * proof and activation — and no method that returns key material. Not a
 * disabled one, none.
 *
 * ===========================================================================
 * IDEMPOTENCE IS ON THE RENEWAL ATTEMPT
 * ===========================================================================
 * Generation is keyed on (device, environment, purpose, renewalAttemptId,
 * keyGeneration). A retry that lost its response receives the SAME key rather
 * than minting a second one — which is exactly what group 0128's key-first
 * ordering could not provide, and why group 0130 moved the reservation first.
 * A DIFFERENT attempt asking for the same slot is refused, not served.
 */

import type { TrustEnvironment } from "./environments.js";
import { RequiredCryptographicValueError } from "./errors.js";
import {
  DEV_SIGNATURE_ALGORITHM,
  destroyVaultKey,
  generateVaultKey,
  vaultSign,
  type GeneratedKey,
} from "./dev-crypto.js";
import { createHash } from "node:crypto";
import type { DeviceKeyMetadata } from "./index.js";

/**
 * Provider-side key lifecycle. Deliberately NOT the same enum as
 * `kitluy_devices.device_key_state`: this is what the PROVIDER knows, and the
 * database's `credential_issued_pending_activation` is a database-side fact
 * about issuance that the provider has no opinion on.
 */
export type ProviderKeyLifecycle = "generated" | "active" | "abandoned" | "destroyed";

export type ReplacementKeyRefusalCode =
  | "PROVIDER_KEY_NOT_FOUND"
  | "PROVIDER_KEY_ATTEMPT_TAKEN"
  | "PROVIDER_KEY_WRONG_ATTEMPT"
  | "PROVIDER_KEY_WRONG_DEVICE"
  | "PROVIDER_KEY_WRONG_SCOPE"
  | "PROVIDER_KEY_WRONG_GENERATION"
  | "PROVIDER_KEY_FINGERPRINT_MISMATCH"
  | "PROVIDER_KEY_ABANDONED"
  | "PROVIDER_KEY_DESTROYED"
  | "PROVIDER_KEY_CREDENTIAL_NOT_ISSUED"
  | "PROVIDER_KEY_INCOMPLETE_METADATA";

/** Raised by the provider. Typed so a caller can branch without string matching. */
export class ReplacementKeyError extends Error {
  readonly code: ReplacementKeyRefusalCode;

  constructor(code: ReplacementKeyRefusalCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "ReplacementKeyError";
    this.code = code;
  }
}

/** The slot a replacement key belongs to. Every field is part of its identity. */
export interface ReplacementKeyScope {
  readonly deviceRecordId: string;
  readonly environment: TrustEnvironment;
  readonly purpose: string;
  readonly renewalAttemptId: string;
  /** The KEY generation, which is NOT the credential generation. */
  readonly keyGeneration: number;
}

/** PUBLIC metadata only. There is no private-key field, by construction. */
export interface ReplacementKeyDescriptor {
  readonly providerKeyReference: string;
  readonly publicKeyPem: string;
  readonly publicKeyFingerprint: string;
  readonly keyGeneration: number;
  readonly renewalAttemptId: string;
  readonly deviceRecordId: string;
  readonly environment: string;
  readonly purpose: string;
  readonly state: ProviderKeyLifecycle;
  readonly metadata: DeviceKeyMetadata;
}

/**
 * What must be TRUE, according to the DATABASE, before the provider will
 * activate. The provider does not read the database; the caller passes what it
 * read, and the provider re-checks every binding against what it generated.
 */
export interface ActivationRequest extends ReplacementKeyScope {
  readonly providerKeyReference: string;
  readonly publicKeyFingerprint: string;
  /**
   * Whether the credential for this renewal is FINALIZED. Activation before
   * issuance is refused: there would be nothing for the key to be active for.
   */
  readonly credentialFinalized: boolean;
  readonly credentialId?: string;
}

/**
 * The ONLY two provider answers `confirm_key_destruction_v1` accepts.
 *
 * Deliberately does NOT include "not found". KLREQ-031: absence is not
 * evidence of destruction — a key the provider cannot find may be a key it
 * never held, a key behind a failed lookup, or a key in another region.
 */
export type ProviderDestructionResult = "DESTROYED" | "ALREADY_DESTROYED";

/** Every binding the provider re-checks before it erases anything. */
export interface ProviderDestructionRequest {
  readonly destructionRequestId: string;
  readonly providerKeyReference: string;
  readonly publicKeyFingerprint: string;
  readonly keyGeneration: number;
  readonly deviceRecordId: string;
  readonly environment: string;
  readonly purpose: string;
}

/**
 * Durable provider evidence. Contains NO key material and no provider secret —
 * a digest of the attestation and a reference by which the provider can be
 * asked again, which is what survives the key itself.
 */
export interface ProviderDestructionReceipt {
  readonly destructionRequestId: string;
  readonly providerKeyReference: string;
  readonly publicKeyFingerprint: string;
  readonly keyGeneration: number;
  readonly result: ProviderDestructionResult;
  /** SHA-256 of the provider attestation, hex. Never the attestation itself. */
  readonly receiptDigest: string;
  readonly responseReference: string;
  readonly requestedAt: Date;
  readonly completedAt: Date;
  /**
   * Development provider only. Recorded so no reader can mistake a simulated
   * erasure for hardware-backed erasure evidence (KLREQ-031, BLK-005 §4).
   */
  readonly attestationKind: "development_simulated" | "provider_attested";
}

/**
 * Raised when the provider CANNOT SAY whether the key was destroyed.
 *
 * Separate from `ReplacementKeyError` because the two demand opposite
 * responses: a refusal means "it was not destroyed, and the database must stay
 * non-destroyed"; an ambiguous outcome means "nobody knows yet, and the
 * database must stay non-destroyed AND a human must reconcile it". Collapsing
 * them is how a timeout becomes a success.
 */
export class ProviderDestructionAmbiguousError extends Error {
  readonly providerKeyReference: string;
  /** Redacted CLASS of failure. Never a provider payload. */
  readonly classification: "TIMEOUT" | "CONNECTION_FAILED" | "INDETERMINATE";

  constructor(
    providerKeyReference: string,
    classification: "TIMEOUT" | "CONNECTION_FAILED" | "INDETERMINATE",
    detail: string,
  ) {
    super(`PROVIDER_DESTRUCTION_AMBIGUOUS(${classification}): ${detail}`);
    this.name = "ProviderDestructionAmbiguousError";
    this.providerKeyReference = providerKeyReference;
    this.classification = classification;
  }
}

export interface ReplacementKeyProvider {
  generateReplacementKey(scope: ReplacementKeyScope): Promise<ReplacementKeyDescriptor>;
  describeReplacementKey(renewalAttemptId: string): ReplacementKeyDescriptor | null;
  proveReplacementPossession(providerKeyReference: string, payload: Uint8Array): Uint8Array;
  activateReplacementKey(request: ActivationRequest): Promise<ReplacementKeyDescriptor>;
  abandonReplacementKey(renewalAttemptId: string, reason: string): ReplacementKeyDescriptor;
  /**
   * KLD-2026-07-29-DEVICE-KEY-DESTRUCTION-001. Erases the private half and
   * returns EVIDENCE that it did.
   *
   * The return type is a receipt, not `void` and not a boolean, because
   * KLREQ-031 forbids the database confirming a destruction it has no evidence
   * for. A provider that cannot say what it destroyed has not proved it
   * destroyed anything.
   */
  destroyProviderKey(request: ProviderDestructionRequest): Promise<ProviderDestructionReceipt>;
}

interface StoredReplacementKey {
  readonly key: GeneratedKey;
  readonly scope: ReplacementKeyScope;
  state: ProviderKeyLifecycle;
  activatedAt: Date | null;
  abandonReason: string | null;
  /**
   * KLREQ-031: the receipt SURVIVES the key. It is kept here after the private
   * half is gone so a later `ALREADY_DESTROYED` can return the evidence the
   * first destruction produced rather than a fresh assertion.
   */
  destructionReceipt: ProviderDestructionReceipt | null;
}

/**
 * DEVELOPMENT-ONLY replacement-key custody.
 *
 * Software-backed and therefore never production-eligible, exactly like
 * `DevelopmentDeviceKeyProvider`. A hardware provider implements the same
 * interface; nothing above this line depends on which one is wired.
 */
export class DevelopmentReplacementKeyProvider implements ReplacementKeyProvider {
  /** Keyed on the renewal attempt — the only stable identifier that exists. */
  readonly #byAttempt = new Map<string, StoredReplacementKey>();
  /** Reverse index so a provider reference resolves without scanning. */
  readonly #byReference = new Map<string, string>();

  #generations = 0;
  #activations = 0;
  #destructions = 0;

  /** Counters, so a test can prove generation happened exactly once. */
  get generationCount(): number {
    return this.#generations;
  }
  get activationCount(): number {
    return this.#activations;
  }
  /** So a test can prove the provider was called exactly once per destruction. */
  get destructionCount(): number {
    return this.#destructions;
  }

  /**
   * Generates the replacement key, or returns the one this attempt already has.
   *
   * IDEMPOTENT ON THE ATTEMPT. A retry that lost its response gets the same
   * key, the same reference and the same fingerprint. A DIFFERENT attempt, or
   * the same attempt under a different device, scope or key generation, is
   * REFUSED — serving it would hand one renewal's private key to another.
   */
  async generateReplacementKey(scope: ReplacementKeyScope): Promise<ReplacementKeyDescriptor> {
    if (scope.environment !== "development") {
      throw new RequiredCryptographicValueError(
        "a hardware-backed key provider for this environment; the development provider is non-production",
        scope.environment,
      );
    }
    if (
      scope.renewalAttemptId.trim() === "" ||
      scope.deviceRecordId.trim() === "" ||
      scope.purpose.trim() === "" ||
      !Number.isInteger(scope.keyGeneration) ||
      scope.keyGeneration < 1
    ) {
      throw new ReplacementKeyError(
        "PROVIDER_KEY_INCOMPLETE_METADATA",
        "a replacement key needs a device, an environment, a purpose, a renewal attempt and a key generation",
      );
    }

    const existing = this.#byAttempt.get(scope.renewalAttemptId);
    if (existing !== undefined) {
      assertSameSlot(existing.scope, scope);
      return this.#describe(existing);
    }

    const key = generateVaultKey(`dev-replacement:${scope.deviceRecordId}:${scope.keyGeneration}`);
    this.#generations += 1;
    const stored: StoredReplacementKey = {
      key,
      scope,
      // §5: a freshly generated key is `generated` and nothing else. It becomes
      // usable only after a credential exists AND the provider activates it.
      state: "generated",
      activatedAt: null,
      abandonReason: null,
      destructionReceipt: null,
    };
    this.#byAttempt.set(scope.renewalAttemptId, stored);
    this.#byReference.set(key.handle, scope.renewalAttemptId);
    return this.#describe(stored);
  }

  describeReplacementKey(renewalAttemptId: string): ReplacementKeyDescriptor | null {
    const stored = this.#byAttempt.get(renewalAttemptId);
    return stored === undefined ? null : this.#describe(stored);
  }

  /**
   * Signs a proof-of-possession challenge with the replacement private key.
   *
   * An abandoned or destroyed key refuses BEFORE signing. It may hold a
   * perfectly valid private half — that is precisely why the state has to be
   * checked rather than the signature relied upon.
   */
  proveReplacementPossession(providerKeyReference: string, payload: Uint8Array): Uint8Array {
    const stored = this.#resolve(providerKeyReference);
    if (stored.state === "abandoned") {
      throw new ReplacementKeyError(
        "PROVIDER_KEY_ABANDONED",
        `key ${providerKeyReference} was abandoned (${stored.abandonReason ?? "no reason recorded"})`,
      );
    }
    if (stored.state === "destroyed") {
      throw new ReplacementKeyError(
        "PROVIDER_KEY_DESTROYED",
        `key ${providerKeyReference} was destroyed`,
      );
    }
    return vaultSign(stored.key.handle, payload);
  }

  /**
   * Loads the private half and reports the key operational.
   *
   * IDEMPOTENT for an identical request. Every binding is re-checked against
   * what the provider itself generated, never against what the caller asserts
   * about it — a caller that could describe a key into activation would make
   * this step ceremony.
   */
  async activateReplacementKey(request: ActivationRequest): Promise<ReplacementKeyDescriptor> {
    const stored = this.#byAttempt.get(request.renewalAttemptId);
    if (stored === undefined) {
      throw new ReplacementKeyError(
        "PROVIDER_KEY_NOT_FOUND",
        `no replacement key was generated for renewal attempt ${request.renewalAttemptId}`,
      );
    }
    if (stored.state === "abandoned") {
      throw new ReplacementKeyError(
        "PROVIDER_KEY_ABANDONED",
        "an abandoned key is never activated; it lost its renewal",
      );
    }
    if (stored.state === "destroyed") {
      throw new ReplacementKeyError(
        "PROVIDER_KEY_DESTROYED",
        "a destroyed key cannot be activated",
      );
    }

    assertSameSlot(stored.scope, request);
    if (stored.key.handle !== request.providerKeyReference) {
      throw new ReplacementKeyError(
        "PROVIDER_KEY_WRONG_ATTEMPT",
        "the provider key reference is not the one generated for this renewal attempt",
      );
    }
    if (stored.key.fingerprint !== request.publicKeyFingerprint) {
      throw new ReplacementKeyError(
        "PROVIDER_KEY_FINGERPRINT_MISMATCH",
        "the fingerprint is not the one the provider generated",
      );
    }
    // ACTIVATION FOLLOWS ISSUANCE. Before a credential is finalized there is
    // nothing for this key to be active FOR, and activating early would make
    // the pending state group 0130 TASK D introduced meaningless.
    if (request.credentialFinalized !== true) {
      throw new ReplacementKeyError(
        "PROVIDER_KEY_CREDENTIAL_NOT_ISSUED",
        "activation follows credential finalization; no finalized credential was reported",
      );
    }

    if (stored.state === "active") {
      return this.#describe(stored);
    }
    stored.state = "active";
    stored.activatedAt = new Date();
    this.#activations += 1;
    return this.#describe(stored);
  }

  /**
   * Marks a losing renewal's key abandoned.
   *
   * Terminal for issuance: `proveReplacementPossession` and
   * `activateReplacementKey` both refuse afterwards. Deliberately NOT a delete
   * — the reference stays resolvable so a later question about it gets an
   * answer rather than "unknown key".
   */
  abandonReplacementKey(renewalAttemptId: string, reason: string): ReplacementKeyDescriptor {
    const stored = this.#byAttempt.get(renewalAttemptId);
    if (stored === undefined) {
      throw new ReplacementKeyError(
        "PROVIDER_KEY_NOT_FOUND",
        `no replacement key for renewal attempt ${renewalAttemptId}`,
      );
    }
    if (stored.state === "active") {
      throw new ReplacementKeyError(
        "PROVIDER_KEY_WRONG_ATTEMPT",
        "an active key is not abandoned by a loser's cleanup path; that would abandon the winner",
      );
    }
    if (stored.state !== "destroyed") {
      stored.state = "abandoned";
      stored.abandonReason = reason;
    }
    return this.#describe(stored);
  }

  /**
   * Erases the private half and returns a receipt.
   *
   * IDEMPOTENT, and the idempotent answer is a DIFFERENT one: a key already
   * destroyed returns `ALREADY_DESTROYED` with the receipt it was destroyed
   * under the first time, not a fresh `DESTROYED`. KLREQ-031 accepts
   * `ALREADY_DESTROYED` only "with matching prior evidence", so the prior
   * evidence is what is returned.
   *
   * Every binding is re-checked against what the provider itself holds. A
   * changed reference, fingerprint or generation REFUSES — those are the three
   * ways a destruction request could name a key other than the one that was
   * approved, and erasing the wrong private key is not recoverable.
   */
  async destroyProviderKey(
    request: ProviderDestructionRequest,
  ): Promise<ProviderDestructionReceipt> {
    const stored = this.#resolve(request.providerKeyReference);

    if (stored.key.fingerprint !== request.publicKeyFingerprint) {
      throw new ReplacementKeyError(
        "PROVIDER_KEY_FINGERPRINT_MISMATCH",
        "the fingerprint presented for destruction is not the one the provider holds",
      );
    }
    if (stored.scope.keyGeneration !== request.keyGeneration) {
      throw new ReplacementKeyError(
        "PROVIDER_KEY_WRONG_GENERATION",
        `this key is key generation ${stored.scope.keyGeneration}, not ${request.keyGeneration}`,
      );
    }
    if (stored.scope.deviceRecordId !== request.deviceRecordId) {
      throw new ReplacementKeyError(
        "PROVIDER_KEY_WRONG_DEVICE",
        "the key presented for destruction belongs to another device",
      );
    }
    if (stored.scope.environment !== request.environment) {
      throw new ReplacementKeyError(
        "PROVIDER_KEY_WRONG_SCOPE",
        "the key presented for destruction belongs to another environment",
      );
    }

    if (stored.state === "destroyed") {
      const prior = stored.destructionReceipt;
      if (prior === null) {
        // Destroyed with no receipt is not evidence of anything. Refusing here
        // keeps the database non-destroyed rather than confirming on a memory.
        throw new ProviderDestructionAmbiguousError(
          request.providerKeyReference,
          "INDETERMINATE",
          "the key is marked destroyed but the provider holds no receipt for it",
        );
      }
      return {
        ...prior,
        result: "ALREADY_DESTROYED",
        destructionRequestId: request.destructionRequestId,
      };
    }

    const requestedAt = new Date();
    // DEVELOPMENT ONLY: the vault drops the private half. This is a software
    // erasure and is recorded as one — it is NOT hardware-backed erasure and no
    // reader may treat it as such (KLREQ-031; BLK-005 §4 keeps TPM/secure-element
    // certification BLOCKED).
    destroyVaultKey(stored.key.handle);
    stored.state = "destroyed";
    const completedAt = new Date();

    const receipt: ProviderDestructionReceipt = {
      destructionRequestId: request.destructionRequestId,
      providerKeyReference: stored.key.handle,
      publicKeyFingerprint: stored.key.fingerprint,
      keyGeneration: stored.scope.keyGeneration,
      result: "DESTROYED",
      // A digest over the PUBLIC bindings and the instant. No private material
      // is an input, so the receipt can never leak the key it attests to.
      receiptDigest: developmentReceiptDigest(
        stored.key.handle,
        stored.key.fingerprint,
        stored.scope.keyGeneration,
        completedAt,
      ),
      responseReference: `dev-destruction:${request.destructionRequestId}`,
      requestedAt,
      completedAt,
      attestationKind: "development_simulated",
    };
    stored.destructionReceipt = receipt;
    this.#destructions += 1;
    return receipt;
  }

  #resolve(providerKeyReference: string): StoredReplacementKey {
    const attemptId = this.#byReference.get(providerKeyReference);
    const stored = attemptId === undefined ? undefined : this.#byAttempt.get(attemptId);
    if (stored === undefined) {
      throw new ReplacementKeyError(
        "PROVIDER_KEY_NOT_FOUND",
        `the provider holds no key under reference ${providerKeyReference}`,
      );
    }
    return stored;
  }

  #describe(stored: StoredReplacementKey): ReplacementKeyDescriptor {
    return {
      providerKeyReference: stored.key.handle,
      publicKeyPem: stored.key.publicKeyPem,
      publicKeyFingerprint: stored.key.fingerprint,
      keyGeneration: stored.scope.keyGeneration,
      renewalAttemptId: stored.scope.renewalAttemptId,
      deviceRecordId: stored.scope.deviceRecordId,
      environment: stored.scope.environment,
      purpose: stored.scope.purpose,
      state: stored.state,
      metadata: {
        publicKeyFingerprint: stored.key.fingerprint,
        algorithm: DEV_SIGNATURE_ALGORITHM,
        // §4: software-backed, therefore never production-eligible.
        hardwareTrustLevel: "development_software",
        exportable: false,
        generatedOnDevice: true,
      },
    };
  }
}

/**
 * The development attestation digest.
 *
 * Inputs are PUBLIC ONLY — the provider reference, the public-key fingerprint,
 * the key generation and the completion instant. No private material is an
 * input, so the receipt cannot leak the key it attests to, and a receipt that
 * survives the key (which KLREQ-031 requires) is safe to keep for ever.
 */
function developmentReceiptDigest(
  providerKeyReference: string,
  publicKeyFingerprint: string,
  keyGeneration: number,
  completedAt: Date,
): string {
  return createHash("sha256")
    .update(
      [
        "kitluy.device.key.destruction.receipt.v1",
        providerKeyReference,
        publicKeyFingerprint,
        String(keyGeneration),
        completedAt.toISOString(),
      ].join("\n"),
      "utf8",
    )
    .digest("hex");
}

/**
 * Every field of the slot must match. Checked one at a time so the refusal says
 * WHICH binding failed — "wrong key" would leave an operator guessing between a
 * replay, a misrouted device and an off-by-one generation.
 */
function assertSameSlot(held: ReplacementKeyScope, presented: ReplacementKeyScope): void {
  if (held.renewalAttemptId !== presented.renewalAttemptId) {
    throw new ReplacementKeyError(
      "PROVIDER_KEY_WRONG_ATTEMPT",
      "this key belongs to another renewal attempt",
    );
  }
  if (held.deviceRecordId !== presented.deviceRecordId) {
    throw new ReplacementKeyError(
      "PROVIDER_KEY_WRONG_DEVICE",
      "this key was generated for another device",
    );
  }
  if (held.environment !== presented.environment || held.purpose !== presented.purpose) {
    throw new ReplacementKeyError(
      "PROVIDER_KEY_WRONG_SCOPE",
      "this key was generated for another environment or purpose",
    );
  }
  if (held.keyGeneration !== presented.keyGeneration) {
    throw new ReplacementKeyError(
      "PROVIDER_KEY_WRONG_GENERATION",
      `this key is key generation ${held.keyGeneration}, not ${presented.keyGeneration}`,
    );
  }
}
