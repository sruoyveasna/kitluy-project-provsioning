/**
 * Signed per-terminal configuration DELIVERY — WS-12-T001-P02.
 *
 * Authority: KLD-2026-08-06-WS12-T001-EDGE-BOOTSTRAP-001 §3
 * (`GET /edge/v1/configuration/current`).
 *
 * WHY A DELIVERY SIGNATURE EXISTS. The configuration snapshot itself is
 * signed cloud→Hub with the development HMAC batch signer (symmetric): a
 * terminal can never verify that signature without holding the secret,
 * which would let it forge one. What a terminal CAN verify — with the Hub
 * operational public key it already trusts for discovery records, pairing
 * proofs and receipts — is the Hub's attestation that THIS snapshot, with
 * THIS payload digest, is currently active and bound to THIS terminal,
 * assignment generation and profile. The cloud manifest signature remains
 * the configuration authority (the Hub verified it before activation);
 * this contract signs DELIVERY, exactly as the Hub signs discovery.
 *
 * Same discipline as every domain here: fixed field order, domain
 * separator first, `toISOString()` instants, bindings checked before the
 * signature, expiry judged against the caller's Hub-anchored time. No
 * second canonicalizer may exist — the Hub signs and the terminal
 * verifies exactly these bytes.
 */

import type { TrustEnvironment } from "./environments.js";
import { verifyDetachedSignature } from "./dev-crypto.js";

/** Domain separator. Distinct from every other signing domain. */
export const TERMINAL_CONFIGURATION_DELIVERY_KIND =
  "kitluy.terminal-configuration-delivery.v1" as const;

export interface TerminalConfigurationDelivery {
  readonly snapshotId: string;
  readonly configurationVersion: number;
  readonly schemaVersion: number;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
  readonly environment: TrustEnvironment;
  readonly hubDeviceId: string;
  readonly terminalDeviceId: string;
  readonly assignmentGeneration: number;
  readonly terminalProfileCode: string;
  readonly minimumApplicationVersion: string;
  readonly maximumApplicationVersion: string | null;
  readonly issuedAt: Date;
  readonly effectiveAt: Date;
  readonly validUntil: Date;
  /** sha256 (hex) of the cloud-signed snapshot manifest — provenance. */
  readonly manifestSha256: string;
  /** sha256 (hex) of the delivered payload JSON the terminal will hash. */
  readonly payloadSha256: string;
  /** The CLOUD manifest signer's key id — provenance, not verification. */
  readonly signingKeyId: string;
  readonly correlationId: string;
}

/** The exact bytes the Hub operational key signs. Field order is FIXED. */
export function terminalConfigurationDeliveryBytes(d: TerminalConfigurationDelivery): Uint8Array {
  return Buffer.from(
    [
      TERMINAL_CONFIGURATION_DELIVERY_KIND,
      d.snapshotId,
      String(d.configurationVersion),
      String(d.schemaVersion),
      d.tenantId,
      d.digitalStoreId,
      d.storeLocationId,
      d.environment,
      d.hubDeviceId,
      d.terminalDeviceId,
      String(d.assignmentGeneration),
      d.terminalProfileCode,
      d.minimumApplicationVersion,
      d.maximumApplicationVersion === null ? "-" : d.maximumApplicationVersion,
      d.issuedAt.toISOString(),
      d.effectiveAt.toISOString(),
      d.validUntil.toISOString(),
      d.manifestSha256,
      d.payloadSha256,
      d.signingKeyId,
      d.correlationId,
    ].join("\n"),
    "utf8",
  );
}

export type ConfigurationDeliveryRefusalCode =
  | "DELIVERY_WRONG_SCOPE"
  | "DELIVERY_WRONG_ENVIRONMENT"
  | "DELIVERY_WRONG_HUB"
  | "DELIVERY_WRONG_TERMINAL"
  | "DELIVERY_WRONG_ASSIGNMENT"
  | "DELIVERY_WRONG_PROFILE"
  | "DELIVERY_PAYLOAD_MISMATCH"
  | "DELIVERY_SIGNATURE_INVALID";

/** What the TERMINAL requires the delivery to say. From its own verified
 * identity and pairing receipt — never from the delivery itself. */
export interface ConfigurationDeliveryExpectation {
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
  readonly environment: TrustEnvironment;
  readonly hubDeviceId: string;
  readonly terminalDeviceId: string;
  readonly assignmentGeneration: number;
  readonly terminalProfileCode: string;
}

export interface ConfigurationDeliveryVerdict {
  readonly verified: boolean;
  readonly refusalCode?: ConfigurationDeliveryRefusalCode;
  readonly detail?: string;
}

/**
 * Verifies a Hub-signed configuration delivery. Bindings first, payload
 * digest next, signature last. Window and version validity are judged
 * SEPARATELY by `evaluateConfigurationSnapshot` — this function answers
 * only "did MY Hub attest THIS delivery for ME".
 */
export function verifyTerminalConfigurationDelivery(
  delivery: TerminalConfigurationDelivery,
  signature: Uint8Array,
  hubOperationalPublicKeyPem: string,
  expectation: ConfigurationDeliveryExpectation,
  computedPayloadSha256: string,
  verifySignature: (
    pem: string,
    payload: Uint8Array,
    sig: Uint8Array,
  ) => boolean = verifyDetachedSignature,
): ConfigurationDeliveryVerdict {
  const refuse = (
    refusalCode: ConfigurationDeliveryRefusalCode,
    detail: string,
  ): ConfigurationDeliveryVerdict => ({ verified: false, refusalCode, detail });

  if (
    delivery.tenantId !== expectation.tenantId ||
    delivery.digitalStoreId !== expectation.digitalStoreId ||
    delivery.storeLocationId !== expectation.storeLocationId
  ) {
    return refuse("DELIVERY_WRONG_SCOPE", "the delivery names another Store scope");
  }
  if (delivery.environment !== expectation.environment) {
    return refuse("DELIVERY_WRONG_ENVIRONMENT", `the delivery is for ${delivery.environment}`);
  }
  if (delivery.hubDeviceId !== expectation.hubDeviceId) {
    return refuse("DELIVERY_WRONG_HUB", "the delivery names another Store Hub");
  }
  if (delivery.terminalDeviceId !== expectation.terminalDeviceId) {
    return refuse("DELIVERY_WRONG_TERMINAL", "the delivery is bound to another terminal");
  }
  if (delivery.assignmentGeneration !== expectation.assignmentGeneration) {
    return refuse(
      "DELIVERY_WRONG_ASSIGNMENT",
      `the delivery binds assignment generation ${delivery.assignmentGeneration}`,
    );
  }
  if (delivery.terminalProfileCode !== expectation.terminalProfileCode) {
    return refuse("DELIVERY_WRONG_PROFILE", "the delivery binds another terminal profile");
  }
  if (delivery.payloadSha256 !== computedPayloadSha256) {
    return refuse(
      "DELIVERY_PAYLOAD_MISMATCH",
      "the delivered payload does not hash to the attested digest",
    );
  }
  if (
    !verifySignature(
      hubOperationalPublicKeyPem,
      terminalConfigurationDeliveryBytes(delivery),
      signature,
    )
  ) {
    return refuse(
      "DELIVERY_SIGNATURE_INVALID",
      "the delivery signature does not verify under the Hub operational key",
    );
  }
  return { verified: true };
}
