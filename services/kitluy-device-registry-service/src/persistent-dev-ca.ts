/**
 * The persistent development CA, as a `CertificateAuthorityProvider`.
 *
 * Authority: owner decision 2026-08-25 — "the existing ephemeral
 * `DevelopmentCertificateAuthority` path must NOT become the canonical
 * first-issuance implementation"; KLD-2026-07-28-002 (BLK-005) — development
 * certificate implementation AUTHORIZED, pilot and production BLOCKED.
 *
 * ===========================================================================
 * WHAT THIS REPLACES, AND WHY THE INTERFACE ALREADY EXISTED
 * ===========================================================================
 * `DevelopmentCertificateAuthority` builds its root and intermediate inside its
 * CONSTRUCTOR, with fresh keys, a fresh `randomUUID()` certificate id and a
 * fresh `new Date()` window. Every process is therefore a different CA, and
 * every credential signed by a previous process is orphaned.
 *
 * `runGovernedIssuance` only ever touches three members of the CA it is given —
 * `issueDeviceCertificate`, `rootCertificate` and `intermediateCertificate` —
 * which is exactly `CertificateAuthorityProvider`, an interface the repository
 * already declares in `dev-crypto.ts`. So nothing new had to be designed: the
 * adapter's parameter type was simply narrower than its actual requirement.
 *
 * ===========================================================================
 * THE CERTIFICATES ARE LOADED, NOT REBUILT
 * ===========================================================================
 * Persisting the KEYS alone would not have been enough. A certificate id, a
 * serial and a validity window are all inside `tbsBytes`, so regenerating the
 * root certificate around a persisted key would still change its signature and
 * its identity. The bootstrap therefore writes both certificates once, and this
 * class returns them verbatim.
 *
 * ===========================================================================
 * KEY CUSTODY
 * ===========================================================================
 * The two Ed25519 private keys are read from the OS-protected directory at the
 * moment of signing and dropped when the call returns. They are never fields,
 * never returned, never logged, never placed in an error. The root key is read
 * by NOTHING here: the root signed the intermediate once, at bootstrap, and a
 * device certificate is signed by the INTERMEDIATE. Always.
 */
import { readFileSync } from "node:fs";
import { createPrivateKey, sign as edSign } from "node:crypto";

import {
  tbsBytes,
  type Certificate,
  type CertificateAuthorityProvider,
  type DeviceIssuanceInput,
  type TrustEnvironment,
} from "@kitluy/device-identity";

import {
  DEV_PKI_FILES,
  DevPkiUnavailableError,
  assertDevPkiDirectoryMode,
  assertPrivateKeyMode,
  resolveDevPkiPaths,
  type DevPkiPaths,
} from "./dev-operational-pki.js";

/** Shape of `dev-canonical-chain.json`, written once by the bootstrap. */
interface CanonicalChainFile {
  readonly kind: string;
  readonly environment: string;
  readonly productionEligible: boolean;
  readonly rootKeyId: string;
  readonly intermediateKeyId: string;
  readonly rootCertificate: { readonly tbs: Certificate["tbs"]; readonly signatureB64: string };
  readonly intermediateCertificate: {
    readonly tbs: Certificate["tbs"];
    readonly signatureB64: string;
  };
}

const CANONICAL_CHAIN_KIND = "kitluy.dev-canonical-chain.v1";

export class PersistentDevelopmentCertificateAuthority implements CertificateAuthorityProvider {
  readonly environment: TrustEnvironment = "development";
  readonly rootCertificate: Certificate;
  readonly intermediateCertificate: Certificate;
  readonly rootKeyId: string;
  readonly intermediateKeyId: string;

  /** Paths only. The key itself is read per signature and never retained. */
  readonly #intermediateKeyPath: string;
  readonly #directory: string;

  private constructor(chain: CanonicalChainFile, paths: DevPkiPaths) {
    this.rootCertificate = {
      tbs: chain.rootCertificate.tbs,
      signature: Buffer.from(chain.rootCertificate.signatureB64, "base64"),
    };
    this.intermediateCertificate = {
      tbs: chain.intermediateCertificate.tbs,
      signature: Buffer.from(chain.intermediateCertificate.signatureB64, "base64"),
    };
    this.rootKeyId = chain.rootKeyId;
    this.intermediateKeyId = chain.intermediateKeyId;
    this.#intermediateKeyPath = `${paths.directory}/${DEV_PKI_FILES.canonicalIntermediateKey}`;
    this.#directory = paths.directory;
  }

  /**
   * Load from the configured directory, or refuse.
   *
   * There is deliberately no fallback that mints a CA when none is found. That
   * fallback is exactly the defect this class exists to remove: a signer that
   * quietly invents an identity is indistinguishable, to every certificate it
   * already signed, from an attacker substituting one.
   */
  static load(env: NodeJS.ProcessEnv = process.env): PersistentDevelopmentCertificateAuthority {
    const paths = resolveDevPkiPaths(env);
    if (paths === null) {
      throw new DevPkiUnavailableError(
        "no development PKI directory is configured; run scripts/pki/bootstrap-dev-pki.mjs and set KITLUY_DEV_PKI_DIR",
      );
    }
    const chainPath = `${paths.directory}/${DEV_PKI_FILES.canonicalChain}`;
    let parsed: CanonicalChainFile;
    try {
      parsed = JSON.parse(readFileSync(chainPath, "utf8")) as CanonicalChainFile;
    } catch {
      // Names the file, never its contents.
      throw new DevPkiUnavailableError(`${chainPath} is missing or is not readable JSON`);
    }
    if (parsed.kind !== CANONICAL_CHAIN_KIND) {
      throw new DevPkiUnavailableError(
        `${chainPath} is not a ${CANONICAL_CHAIN_KIND} document`,
      );
    }
    if (parsed.environment !== "development" || parsed.productionEligible !== false) {
      // BLK-005: a development signer must announce itself as one, and must not
      // be loadable as anything else.
      throw new DevPkiUnavailableError(
        `${chainPath} does not declare a non-production development chain`,
      );
    }
    // Refuse a key anyone but its owner can read, and a directory anyone but its
    // owner can write, before either is ever used (M-3). The directory matters
    // independently: a writable directory lets a key file be REPLACED without
    // anyone needing to write to the original.
    assertDevPkiDirectoryMode(paths.directory);
    assertPrivateKeyMode(`${paths.directory}/${DEV_PKI_FILES.canonicalIntermediateKey}`);
    return new PersistentDevelopmentCertificateAuthority(parsed, paths);
  }

  /**
   * Device certificates are signed by the INTERMEDIATE. Always.
   *
   * Mirrors `DevelopmentCertificateAuthority.issueDeviceCertificate` field for
   * field — the adapter rebuilds these bytes and refuses on any difference
   * (`ISSUE_CANONICAL_TBS_DIVERGENCE`), so a divergence here fails loudly rather
   * than producing a signature over bytes the database will not recognise.
   *
   * `productionEligible` is typed `false`, so it cannot be set true without a
   * type error.
   */
  issueDeviceCertificate(input: DeviceIssuanceInput): Certificate {
    const tbs: Certificate["tbs"] = {
      certificateId: input.certificateId,
      serialNumber: input.serialNumber,
      role: "device",
      purpose: "device_identity",
      environment: "development",
      subjectFingerprint: input.subjectFingerprint,
      subjectPublicKeyPem: input.subjectPublicKeyPem,
      issuerKeyId: this.intermediateKeyId,
      deviceRecordId: input.deviceRecordId,
      certificateGeneration: input.certificateGeneration,
      hardwareTrustLevel: input.hardwareTrustLevel,
      productionEligible: false,
      notBefore: input.notBefore.toISOString(),
      notAfter: input.notAfter.toISOString(),
    };
    return { tbs, signature: this.#signWithIntermediate(tbsBytes(tbs)) };
  }

  /** Read, sign, drop. The key is a local `const` and leaves no other trace. */
  #signWithIntermediate(payload: Uint8Array): Uint8Array {
    assertDevPkiDirectoryMode(this.#directory);
    assertPrivateKeyMode(this.#intermediateKeyPath);
    let pem: string;
    try {
      pem = readFileSync(this.#intermediateKeyPath, "utf8");
    } catch {
      throw new DevPkiUnavailableError(`${this.#intermediateKeyPath} is missing or unreadable`);
    }
    try {
      return edSign(null, Buffer.from(payload), createPrivateKey(pem));
    } catch {
      // SWALLOWED AND REPLACED, never wrapped: a PEM parse failure can carry key
      // fragments in its message, and a wrapped error carries them into a log.
      throw new DevPkiUnavailableError(
        `the key in ${this.#intermediateKeyPath} could not produce an ed25519 signature; the underlying reason is withheld because it can contain key material`,
      );
    }
  }
}
