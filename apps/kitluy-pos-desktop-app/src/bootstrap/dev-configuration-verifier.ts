/**
 * DEVELOPMENT-ONLY configuration signature verification — WS-12-T001.
 *
 * No production configuration signer exists (device-identity review
 * condition C4; the WS-10 production signer is BLK-005-blocked). This module
 * exists so development compositions and the acceptance suite can exercise
 * the REAL refuse-on-bad-signature path with real Ed25519 keys instead of a
 * stubbed boolean.
 *
 * The byte layout is quarantined under a `kitluy.dev.` domain separator: a
 * development signature can never satisfy a future production verifier, and
 * a production signature can never satisfy this one. When the Step-6 signer
 * lands, its canonicalizer supersedes this file for every non-development
 * environment; this one refuses them today.
 */

import { verifyDetachedSignature } from "@kitluy/device-identity";

import type { SignedTerminalConfiguration } from "./ports.js";
import type { ConfigurationSignatureVerifier } from "./machine.js";

export const DEV_TERMINAL_CONFIGURATION_KIND = "kitluy.dev.terminal-configuration.v1" as const;

/** Fixed field order, newline-joined — the house canonical-bytes discipline. */
export function devTerminalConfigurationBytes(s: SignedTerminalConfiguration): Uint8Array {
  return Buffer.from(
    [
      DEV_TERMINAL_CONFIGURATION_KIND,
      String(s.configurationVersion),
      String(s.schemaVersion),
      s.environment,
      s.tenantId,
      s.digitalStoreId,
      s.storeLocationId,
      s.deviceRecordId,
      String(s.assignmentGeneration),
      s.issuedAt,
      s.validUntil,
      s.payloadSha256,
      s.signerKeyId,
    ].join("\n"),
    "utf8",
  );
}

/**
 * A verifier bound to ONE development configuration-signing public key.
 * Anything but a development-environment snapshot is refused outright —
 * this trust anchor has no authority beyond development.
 */
export function developmentConfigurationVerifier(
  configurationSigningPublicKeyPem: string,
): ConfigurationSignatureVerifier {
  return (snapshot) => {
    if (snapshot.environment !== "development") return false;
    let signature: Buffer;
    try {
      signature = Buffer.from(snapshot.signatureBase64, "base64");
    } catch {
      return false;
    }
    if (signature.length === 0) return false;
    return verifyDetachedSignature(
      configurationSigningPublicKeyPem,
      devTerminalConfigurationBytes(snapshot),
      new Uint8Array(signature),
    );
  };
}
