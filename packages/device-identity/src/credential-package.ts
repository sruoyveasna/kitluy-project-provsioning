/**
 * Terminal credential DELIVERY package — WS-11-T004-P04C1.
 *
 * Authority: the P04C owner package §15-§16 (credential delivery, Hub
 * projection and installation acknowledgment); pairing protocol §7 (receiving
 * a credential is a strictly EARLIER fact than being active); the OPTION B
 * ruling of group 0127 (Ed25519 verification lives in this package).
 *
 * ===========================================================================
 * WHAT THIS IS, AND THE FOUR FACTS IT REFUSES TO COLLAPSE
 * ===========================================================================
 * P04A already returns the issued PUBLIC credential to the terminal at
 * redemption. This module does not redeliver it and does not reissue it —
 * there is exactly one issuance authority (cloud group 0171 binding 0120/0123)
 * and adding a second would be a second source of truth. What was missing is
 * the governed shape of the material as it travels and as it is INSTALLED:
 *
 *   1. ISSUANCE          — cloud binds the credential (0171). Not here.
 *   2. TERMINAL RECEIPT   — the terminal verifies this package before it
 *                           installs anything. THIS MODULE.
 *   3. HUB PROJECTION     — the Hub is told, by signed delivery, that this
 *                           credential authorizes this terminal. The Hub
 *                           AUTHORS none of it (hub migration 0033).
 *   4. INSTALLATION ACK   — the terminal proves it installed THIS EXACT
 *                           credential, under its enrolled key
 *                           (`kitluy.activation-ack.v1`, group 0174 — REUSED,
 *                           not duplicated: that payload already binds
 *                           certificateId + serial + fingerprint + terminal +
 *                           assignment + Hub + environment).
 *
 * Activation (5) and pairing (6) are later still. Nothing here advances them.
 *
 * ===========================================================================
 * THE PRIVATE KEY IS NOT IN THIS FILE'S VOCABULARY
 * ===========================================================================
 * The terminal's private key is generated on the terminal and lives in its
 * OS-protected or hardware-backed store. It never enters a package, a
 * delivery, a JSON body or SQLite. {@link assertNoPrivateKeyMaterial} makes
 * that structural rather than documentary: any value reachable inside a
 * package that carries a private-key PEM header FAILS the package, so a
 * "helpful" future adapter that attached one cannot get it past this door.
 *
 * The repository's development credential is `kitluy.development-device-
 * credential.v1` (a canonical signed structure, deliberately NOT X.509 —
 * `CREDENTIAL_IS_NOT_X509`), so "certificate and chain" here means the
 * repository's {@link CertificateChain}: root -> intermediate -> device.
 */

import {
  publicKeyFingerprint,
  tbsBytes,
  verifyCertificateChain,
  verifyDetachedSignature,
  type Certificate,
  type CertificateChain,
} from "./dev-crypto.js";
import { DEVICE_CERTIFICATE_PURPOSE } from "./certificate-validity.js";
import type { TrustEnvironment } from "./environments.js";

/** Domain separator. Distinct from every other signed structure here. */
export const CREDENTIAL_PACKAGE_KIND = "kitluy.terminal-credential-package.v1" as const;

/** The only package version this verifier accepts. */
export const CREDENTIAL_PACKAGE_VERSION = "1" as const;

/**
 * The PUBLIC delivery package. Every field is public material or a reference —
 * there is deliberately no field a private key could occupy.
 */
export interface TerminalCredentialPackage {
  readonly packageVersion: string;
  /** The credential ROW id (cloud `device_certificates.id`). */
  readonly credentialId: string;
  readonly certificateSerial: string;
  /** SHA-256 of the subject public key. Never a key, never a secret. */
  readonly publicKeyFingerprint: string;
  readonly environment: TrustEnvironment;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly terminalDeviceId: string;
  readonly terminalAssignmentId: string;
  readonly terminalAssignmentGeneration: number;
  readonly terminalProfileKey: string;
  readonly storeHubDeviceId: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
  /** Public certificate plus its chain. Public halves only, by construction. */
  readonly chain: CertificateChain;
}

/** The package as it travels: signed by the issuing authority. */
export interface SignedTerminalCredentialPackage {
  readonly package: TerminalCredentialPackage;
  /** Fingerprint of the AUTHORITY key that signed the package metadata. */
  readonly authorityKeyFingerprint: string;
  readonly signature: Uint8Array;
}

export type CredentialPackageRejectionCode =
  | "PACKAGE_VERSION_UNSUPPORTED"
  | "PACKAGE_PRIVATE_MATERIAL_PRESENT"
  | "PACKAGE_AUTHORITY_UNKNOWN"
  | "PACKAGE_AUTHORITY_INVALID"
  | "PACKAGE_CHAIN_INVALID"
  | "PACKAGE_CERTIFICATE_MISMATCH"
  | "PACKAGE_FINGERPRINT_MISMATCH"
  | "PACKAGE_TERMINAL_MISMATCH"
  | "PACKAGE_ASSIGNMENT_MISMATCH"
  | "PACKAGE_SCOPE_MISMATCH"
  | "PACKAGE_ENVIRONMENT_MISMATCH"
  | "PACKAGE_WINDOW_INVALID";

export interface CredentialPackageVerdict {
  readonly verified: boolean;
  readonly rejectionCode?: CredentialPackageRejectionCode;
  readonly detail?: string;
  /** Present only on success — what the terminal may then acknowledge. */
  readonly installable?: InstallableCredential;
}

/**
 * What a VERIFIED package authorizes the terminal to install. Deliberately
 * narrower than the package: these are the exact fields the installation
 * acknowledgment (`kitluy.activation-ack.v1`) binds, so the terminal cannot
 * acknowledge one credential and install another.
 */
export interface InstallableCredential {
  readonly credentialId: string;
  readonly certificateSerial: string;
  readonly certificateFingerprint: string;
  readonly environment: TrustEnvironment;
  readonly terminalDeviceId: string;
  readonly terminalAssignmentId: string;
  readonly terminalProfileKey: string;
  readonly storeHubDeviceId: string;
}

/** What the TERMINAL already knows about itself, from its own governed state. */
export interface CredentialPackageExpectation {
  readonly terminalDeviceId: string;
  readonly terminalAssignmentId: string;
  readonly terminalAssignmentGeneration: number;
  readonly terminalProfileKey: string;
  readonly storeHubDeviceId: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
  readonly environment: TrustEnvironment;
  /** The terminal's OWN enrolled/generated public key fingerprint. */
  readonly subjectKeyFingerprint: string;
  /** Anchor set. A pilot verifier simply does not carry the dev root. */
  readonly trustedRootFingerprints: readonly string[];
  /** Authority keys this terminal accepts, by fingerprint. */
  readonly trustedAuthorityKeys: ReadonlyMap<string, string>;
}

const PRIVATE_PEM_MARKER = /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/;

/**
 * Structural refusal of private material anywhere inside a delivered value.
 *
 * Walks the whole value rather than checking known fields: the risk is a field
 * nobody thought of, not the ones that are already public by name. Cycles are
 * tracked so a self-referential payload cannot hang the terminal.
 */
export function assertNoPrivateKeyMaterial(value: unknown, path = "package"): void {
  const seen = new Set<object>();
  const walk = (node: unknown, at: string): void => {
    if (typeof node === "string") {
      if (PRIVATE_PEM_MARKER.test(node)) {
        throw new Error(
          `KLUY-CREDENTIAL-PACKAGE-PRIVATE-MATERIAL: private key material found at ${at}. ` +
            "A terminal private key never enters a credential package, a delivery, JSON or SQLite " +
            "(P04C §16).",
        );
      }
      return;
    }
    if (node === null || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${at}[${index}]`));
      return;
    }
    for (const [key, item] of Object.entries(node)) walk(item, `${at}.${key}`);
  };
  walk(value, path);
}

/**
 * The exact bytes the issuing authority signs.
 *
 * Field order is FIXED here rather than taken from object key order, so a
 * re-serialized package cannot verify differently from the original — the same
 * discipline as `tbsBytes` and `activationAckBytes`. The device certificate is
 * bound by its CANONICAL BYTES, not by a hash of a JSON rendering, so the
 * signature covers the very structure the chain verifier will check.
 */
export function credentialPackageBytes(pkg: TerminalCredentialPackage): Uint8Array {
  return Buffer.from(
    [
      CREDENTIAL_PACKAGE_KIND,
      pkg.packageVersion,
      pkg.credentialId,
      pkg.certificateSerial,
      pkg.publicKeyFingerprint,
      pkg.environment,
      pkg.issuedAt,
      pkg.expiresAt,
      pkg.terminalDeviceId,
      pkg.terminalAssignmentId,
      String(pkg.terminalAssignmentGeneration),
      pkg.terminalProfileKey,
      pkg.storeHubDeviceId,
      pkg.tenantId,
      pkg.digitalStoreId,
      pkg.storeLocationId,
      certificateDigestField(pkg.chain.root),
      certificateDigestField(pkg.chain.intermediate),
      certificateDigestField(pkg.chain.device),
    ].join("\n"),
    "utf8",
  );
}

/**
 * One certificate rendered for the package signature: its canonical TBS bytes
 * plus its signature, base64. Newlines inside the PEM are escaped so a
 * certificate can never inject a field boundary into the package payload.
 */
function certificateDigestField(certificate: Certificate): string {
  const canonical = Buffer.from(tbsBytes(certificate.tbs)).toString("base64");
  const signature = Buffer.from(certificate.signature).toString("base64");
  return `${canonical}.${signature}`;
}

/**
 * Verify a delivered package BEFORE the terminal installs anything.
 *
 * ORDER IS THE CONTRACT:
 *   1. version — an unknown package shape is never partially interpreted;
 *   2. private material — refused before any other work, so a package that
 *      should not exist never gets the dignity of a signature check;
 *   3. authority signature — an unsigned or wrongly-signed package authorizes
 *      nothing, whatever its contents claim;
 *   4. certificate chain to the terminal's OWN anchor set;
 *   5. the device certificate is the one the package describes;
 *   6. the subject key is THIS terminal's key — a package for another
 *      terminal's key is refused even when everything else matches;
 *   7. terminal / assignment / scope / environment;
 *   8. the validity window, judged against the CALLER's trusted instant.
 *
 * `at` is a TRUSTED instant supplied by the caller (device trusted time —
 * never a raw host clock, and never the Hub's clock: those are separate
 * authorities by design).
 */
export function verifyCredentialPackage(
  signed: SignedTerminalCredentialPackage,
  expectation: CredentialPackageExpectation,
  at: Date,
): CredentialPackageVerdict {
  const reject = (
    rejectionCode: CredentialPackageRejectionCode,
    detail: string,
  ): CredentialPackageVerdict => ({ verified: false, rejectionCode, detail });

  const pkg = signed.package;

  if (pkg.packageVersion !== CREDENTIAL_PACKAGE_VERSION) {
    return reject(
      "PACKAGE_VERSION_UNSUPPORTED",
      `package version '${pkg.packageVersion}' is not ${CREDENTIAL_PACKAGE_VERSION}`,
    );
  }

  try {
    assertNoPrivateKeyMaterial(signed);
  } catch (error) {
    return reject(
      "PACKAGE_PRIVATE_MATERIAL_PRESENT",
      error instanceof Error ? error.message : "private material present",
    );
  }

  const authorityPublicKeyPem = expectation.trustedAuthorityKeys.get(
    signed.authorityKeyFingerprint,
  );
  if (authorityPublicKeyPem === undefined) {
    return reject(
      "PACKAGE_AUTHORITY_UNKNOWN",
      "the signing authority is not in this terminal's trusted authority set",
    );
  }
  if (
    !verifyDetachedSignature(authorityPublicKeyPem, credentialPackageBytes(pkg), signed.signature)
  ) {
    return reject("PACKAGE_AUTHORITY_INVALID", "the authority signature does not verify");
  }

  const chain = verifyCertificateChain(pkg.chain, {
    environment: expectation.environment,
    purpose: DEVICE_CERTIFICATE_PURPOSE,
    trustedRootFingerprints: expectation.trustedRootFingerprints,
  });
  if (!chain.valid) {
    return reject("PACKAGE_CHAIN_INVALID", chain.detail ?? chain.rejectionCode ?? "chain invalid");
  }

  const device = pkg.chain.device.tbs;
  if (device.certificateId !== pkg.credentialId || device.serialNumber !== pkg.certificateSerial) {
    return reject(
      "PACKAGE_CERTIFICATE_MISMATCH",
      "the delivered certificate is not the credential the package describes",
    );
  }
  // The fingerprint is RECOMPUTED from the delivered public key. Trusting the
  // package's own claim would let a correct-looking package install a key the
  // acknowledgment then attests to under the wrong fingerprint.
  const computed = publicKeyFingerprint(device.subjectPublicKeyPem);
  if (computed !== pkg.publicKeyFingerprint || computed !== device.subjectFingerprint) {
    return reject(
      "PACKAGE_FINGERPRINT_MISMATCH",
      "the declared fingerprint is not the fingerprint of the delivered public key",
    );
  }
  if (computed !== expectation.subjectKeyFingerprint) {
    return reject(
      "PACKAGE_TERMINAL_MISMATCH",
      "the credential was issued over another terminal's key",
    );
  }
  if (pkg.terminalDeviceId !== expectation.terminalDeviceId) {
    return reject("PACKAGE_TERMINAL_MISMATCH", "the package names another terminal");
  }
  if (
    pkg.terminalAssignmentId !== expectation.terminalAssignmentId ||
    pkg.terminalAssignmentGeneration !== expectation.terminalAssignmentGeneration ||
    pkg.terminalProfileKey !== expectation.terminalProfileKey
  ) {
    return reject(
      "PACKAGE_ASSIGNMENT_MISMATCH",
      "the package names another assignment, generation or T1-T4 profile",
    );
  }
  if (
    pkg.tenantId !== expectation.tenantId ||
    pkg.digitalStoreId !== expectation.digitalStoreId ||
    pkg.storeLocationId !== expectation.storeLocationId ||
    pkg.storeHubDeviceId !== expectation.storeHubDeviceId
  ) {
    return reject("PACKAGE_SCOPE_MISMATCH", "the package names another Store scope or Hub");
  }
  if (
    pkg.environment !== expectation.environment ||
    device.environment !== expectation.environment
  ) {
    return reject("PACKAGE_ENVIRONMENT_MISMATCH", "the package names another environment");
  }

  const issued = Date.parse(pkg.issuedAt);
  const expires = Date.parse(pkg.expiresAt);
  if (Number.isNaN(issued) || Number.isNaN(expires) || expires <= issued) {
    return reject("PACKAGE_WINDOW_INVALID", "the declared validity window is not a window");
  }
  if (device.notBefore !== pkg.issuedAt || device.notAfter !== pkg.expiresAt) {
    return reject(
      "PACKAGE_WINDOW_INVALID",
      "the package window is not the certificate's own window",
    );
  }
  const now = at.getTime();
  if (now < issued || now >= expires) {
    return reject("PACKAGE_WINDOW_INVALID", "the credential is outside its validity window");
  }

  return {
    verified: true,
    installable: {
      credentialId: pkg.credentialId,
      certificateSerial: pkg.certificateSerial,
      certificateFingerprint: computed,
      environment: pkg.environment,
      terminalDeviceId: pkg.terminalDeviceId,
      terminalAssignmentId: pkg.terminalAssignmentId,
      terminalProfileKey: pkg.terminalProfileKey,
      storeHubDeviceId: pkg.storeHubDeviceId,
    },
  };
}

/**
 * The facts a Hub credential PROJECTION asserts.
 *
 * Deliberately the package's public metadata WITHOUT the chain: the Hub
 * authorizes against credential identity, status and scope, and holding a
 * device certificate would invite the Hub to start verifying (and therefore
 * deciding) credential validity itself. It does not — the cloud decides, the
 * Hub projects (hub migration 0033).
 */
export interface CredentialProjectionFacts {
  readonly credentialId: string;
  readonly certificateSerial: string;
  readonly publicKeyFingerprint: string;
  readonly issuer: string;
  readonly credentialType: string;
  readonly status: string;
  readonly rotationGeneration: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly environment: TrustEnvironment;
  readonly terminalDeviceId: string;
  readonly terminalAssignmentGeneration: number;
  readonly terminalProfileKey: string;
  readonly storeHubDeviceId: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
}

/**
 * Derive the projection facts from a VERIFIED package.
 *
 * Taking them from the verified package rather than from a hand-built object is
 * the point: the Hub is told exactly what the terminal was told, so the two can
 * never diverge into two credential truths.
 */
export function projectionFactsFromPackage(
  pkg: TerminalCredentialPackage,
  issuedFacts: {
    readonly issuer: string;
    readonly credentialType: string;
    readonly status: string;
    readonly rotationGeneration: number;
  },
): CredentialProjectionFacts {
  return {
    credentialId: pkg.credentialId,
    certificateSerial: pkg.certificateSerial,
    publicKeyFingerprint: pkg.publicKeyFingerprint,
    issuer: issuedFacts.issuer,
    credentialType: issuedFacts.credentialType,
    status: issuedFacts.status,
    rotationGeneration: issuedFacts.rotationGeneration,
    issuedAt: pkg.issuedAt,
    expiresAt: pkg.expiresAt,
    environment: pkg.environment,
    terminalDeviceId: pkg.terminalDeviceId,
    terminalAssignmentGeneration: pkg.terminalAssignmentGeneration,
    terminalProfileKey: pkg.terminalProfileKey,
    storeHubDeviceId: pkg.storeHubDeviceId,
    tenantId: pkg.tenantId,
    digitalStoreId: pkg.digitalStoreId,
    storeLocationId: pkg.storeLocationId,
  };
}
