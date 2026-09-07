/**
 * The persistent DEVELOPMENT signing authority for operational TLS credentials.
 *
 * Authority: owner Decision 3 (2026-08-24) — "Implement a persistent DEVELOPMENT
 * PKI provider … the signer must NOT generate a new CA identity merely because a
 * service instance restarted"; Decision 3A (X.509 is what Hub LAN mTLS needs);
 * KLD-2026-07-28-002 (BLK-005) — development certificate implementation
 * AUTHORIZED, pilot and production BLOCKED.
 *
 * ===========================================================================
 * WHY THE EXISTING PROVIDER COULD NOT BE MADE TO WORK
 * ===========================================================================
 * `DevelopmentCertificateAuthority` in `@kitluy/device-identity` calls
 * `generateKey()` for root and intermediate INSIDE ITS CONSTRUCTOR. There is no
 * load path, so every process — every test run, every service restart — mints a
 * brand new CA. The twenty-five `device_credentials` rows already in the
 * development database carry signatures no surviving key can verify.
 *
 * Its own header says it "IS NOT A PRODUCTION CA AND CANNOT BECOME ONE", and
 * that is correct and is not what this module changes. What this module adds is
 * PERSISTENCE, so that a certificate issued on Monday still verifies on Tuesday.
 *
 * ===========================================================================
 * TWO DIFFERENT CREDENTIALS, AND THIS ONE IS X.509
 * ===========================================================================
 * The canonical KitLuy credential is deliberately NOT X.509 —
 * `CREDENTIAL_IS_NOT_X509`, a canonical JSON to-be-signed structure with a
 * detached Ed25519 signature — and `device_credentials` remains the governed
 * issuance, generation and lifecycle authority. Nothing here replaces it.
 *
 * But `hub/edge/transport.ts` serves the Store LAN with `node:https`,
 * `requestCert` and `rejectUnauthorized` on TLS 1.3. That is X.509 mutual TLS,
 * and no amount of restating the canonical credential makes it usable as a TLS
 * certificate. So per Decision 3A the two models are reconciled rather than
 * merged: the lifecycle stays where it is, and this module mints the concrete
 * operational ARTIFACT that TLS can actually consume, linked back to the
 * credential generation it belongs to.
 *
 * ===========================================================================
 * ALGORITHM: RSA-2048, AND WHY THAT IS NOT AN INVENTED POLICY
 * ===========================================================================
 * `[REQUIRED: device_certificate_signature_algorithm]` is an OPEN owner value.
 * `dev-crypto.ts` faced the same gap and answered it by selecting Ed25519 as a
 * DEVELOPMENT TEST ALGORITHM under an explicit `DEV_ALGORITHM_IS_PROVISIONAL`
 * marker rather than pretending a policy existed. This module follows that
 * precedent, and selects differently for a reason:
 *
 *   * X.509 issuance needs a certificate encoder. `node:crypto` can PARSE X.509
 *     (`X509Certificate`) and cannot issue it, so a library is required.
 *   * `node-forge` is already catalog-pinned in `pnpm-workspace.yaml` and is
 *     already a production dependency of `apps/kitluy-pos-desktop-app`, so it is
 *     vetted here rather than newly introduced.
 *   * forge's `pki` signs with RSA. Its Ed25519 support does not extend to
 *     certificate signing.
 *   * `hub-agent`'s own edge-LAN transport suite already mints RSA-2048 X.509 for
 *     exactly this mTLS path, so RSA-2048 is the shape the transport is proven
 *     against.
 *
 * This is DEVELOPMENT ONLY and PROVISIONAL. It must not become the pilot or
 * production standard by having shipped; `DEV_TLS_ALGORITHM_IS_PROVISIONAL`
 * exists so a reader cannot miss that.
 *
 * ===========================================================================
 * KEY CUSTODY — THE RULES THIS MODULE INHERITS RATHER THAN REINVENTS
 * ===========================================================================
 * `snapshot-signer.ts` and `enrollment-time-signer.ts` already establish how
 * this repository holds a persistent development signing key, and the precedent
 * is on disk: `../../local-config/het-kitluy-project/dev-enrollment-time.key`,
 * mode 0600, outside the repository. The rules copied here unchanged:
 *
 *   1. Material lives OUTSIDE the repository and outside every device image.
 *   2. It is read at the moment of signing and dropped when the call returns —
 *      never a parameter, never a return value, never a log field.
 *   3. An error message names the FILE, never its contents. Underlying errors
 *      are SWALLOWED AND REPLACED rather than wrapped, because a PEM parse
 *      failure can carry key fragments in its message.
 *   4. No unsigned fallback. A deployment with no CA cannot issue, and that is
 *      the intended failure.
 *
 * Added here because a CA is not one key:
 *
 *   5. The directory and both private keys must be owner-only. A group- or
 *      world-readable CA key is refused rather than used, because the whole
 *      value of persistence is that this key outlives the process.
 *   6. `assertDevelopmentOnly` refuses any environment but `development`, so
 *      this signer cannot be pointed at pilot or production even by
 *      misconfiguration.
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Selected as a DEVELOPMENT algorithm against an open owner value. Not policy. */
export const DEV_TLS_ALGORITHM_IS_PROVISIONAL = true as const;
export const DEV_TLS_KEY_BITS = 2048 as const;

/** Names the directory holding the development CA material. */
export const DEV_PKI_DIR_ENV = "KITLUY_DEV_PKI_DIR" as const;

/** File names inside that directory. Certificates are public; keys are not. */
export const DEV_PKI_FILES = {
  // X.509, for Hub LAN mutual TLS.
  rootCertificate: "dev-root-ca.crt.pem",
  rootKey: "dev-root-ca.key.pem",
  intermediateCertificate: "dev-device-issuing-ca.crt.pem",
  intermediateKey: "dev-device-issuing-ca.key.pem",
  // The CANONICAL KitLuy credential chain — Ed25519 over canonical JSON,
  // deliberately NOT X.509. `runGovernedIssuance` signs with this one.
  canonicalRootKey: "dev-canonical-root.key.pem",
  canonicalIntermediateKey: "dev-canonical-intermediate.key.pem",
  canonicalChain: "dev-canonical-chain.json",
} as const;

/**
 * Raised when the development CA cannot be used. Carries a reason an operator
 * can act on and never any key material.
 */
export class DevPkiUnavailableError extends Error {
  constructor(reason: string) {
    super(`KLUY-DEV-PKI-UNAVAILABLE: ${reason}`);
    this.name = "DevPkiUnavailableError";
  }
}

export interface DevPkiPaths {
  readonly directory: string;
  readonly rootCertificate: string;
  readonly rootKey: string;
  readonly intermediateCertificate: string;
  readonly intermediateKey: string;
}

/**
 * Resolve where the CA material lives. Returns null when unconfigured, so a
 * caller can report "not configured" distinctly from "configured and broken" —
 * the two need completely different operator actions.
 */
export function resolveDevPkiPaths(env: NodeJS.ProcessEnv = process.env): DevPkiPaths | null {
  const directory = env[DEV_PKI_DIR_ENV]?.trim() ?? "";
  if (directory === "") return null;
  return {
    directory,
    rootCertificate: join(directory, DEV_PKI_FILES.rootCertificate),
    rootKey: join(directory, DEV_PKI_FILES.rootKey),
    intermediateCertificate: join(directory, DEV_PKI_FILES.intermediateCertificate),
    intermediateKey: join(directory, DEV_PKI_FILES.intermediateKey),
  };
}

/**
 * Refuse a CA key that anyone but its owner can read.
 *
 * Checked rather than assumed: the material is created by a bootstrap script,
 * copied between machines by people, and restored from backups. Any of those can
 * widen a mode, and a CA key whose confidentiality has lapsed is worse than one
 * that never existed, because certificates already trust it.
 */
export function assertPrivateKeyMode(path: string): void {
  let mode: number;
  try {
    mode = statSync(path).mode & 0o777;
  } catch {
    // Names the file, never its contents.
    throw new DevPkiUnavailableError(`${path} is not readable`);
  }
  if ((mode & 0o077) !== 0) {
    throw new DevPkiUnavailableError(
      `${path} is mode ${mode.toString(8)}; a development CA key must be owner-only (0600)`,
    );
  }
}

/**
 * Refuse a CA DIRECTORY that anyone but its owner can write.
 *
 * M-3. `assertPrivateKeyMode` guards the key files; it says nothing about the
 * directory holding them. A group- or world-writable directory lets someone
 * REPLACE a key file without ever needing to write to the original — the mode
 * bits on the file are irrelevant if the name can be re-pointed at different
 * bytes. Checked at load and at every signature, alongside the key itself.
 */
export function assertDevPkiDirectoryMode(directory: string): void {
  let mode: number;
  try {
    mode = statSync(directory).mode & 0o777;
  } catch {
    throw new DevPkiUnavailableError(`${directory} is not readable`);
  }
  // Write by group or other is the dangerous bit; read is not, because the
  // certificates in here are public and the keys carry their own 0600 check.
  if ((mode & 0o022) !== 0) {
    throw new DevPkiUnavailableError(
      `${directory} is mode ${mode.toString(8)}; a development CA directory must not be group- or world-writable`,
    );
  }
}

/** Pilot and production are BLOCKED under BLK-005 and cannot be reached from here. */
export function assertDevelopmentOnly(environment: string): void {
  if (environment !== "development") {
    throw new DevPkiUnavailableError(
      `environment "${environment}" cannot be served by the development CA; pilot and production remain blocked under BLK-005`,
    );
  }
}

/** The two public certificates, which are not secret and may be returned. */
export interface DevPkiChain {
  readonly rootCertificatePem: string;
  readonly intermediateCertificatePem: string;
}

/**
 * Read the PUBLIC half of the chain.
 *
 * Certificates are not secrets — a device needs the chain to verify what it is
 * given — so unlike the keys these are returned to callers.
 */
export function readDevPkiChain(paths: DevPkiPaths): DevPkiChain {
  const read = (path: string): string => {
    let pem: string;
    try {
      pem = readFileSync(path, "utf8");
    } catch {
      throw new DevPkiUnavailableError(`${path} is missing or unreadable`);
    }
    if (!pem.includes("BEGIN CERTIFICATE")) {
      throw new DevPkiUnavailableError(`${path} does not contain a PEM certificate`);
    }
    return pem;
  };
  return {
    rootCertificatePem: read(paths.rootCertificate),
    intermediateCertificatePem: read(paths.intermediateCertificate),
  };
}

/**
 * Run `use` with the issuing CA's private key, and drop it on return.
 *
 * The key is a local `const` inside this function and is never returned, logged
 * or placed in an error. `use` receives it as an argument and must not retain
 * it — every caller in this module passes it straight to a signing call.
 *
 * The ROOT key is deliberately not exposed by any function here. The root signs
 * the intermediate ONCE, at bootstrap, and never again — the same structural
 * restriction `DevelopmentCertificateAuthority` documents, kept structural.
 */
export function withIssuingCaKey<T>(paths: DevPkiPaths, use: (privateKeyPem: string) => T): T {
  assertDevPkiDirectoryMode(paths.directory);
  assertPrivateKeyMode(paths.intermediateKey);
  let pem: string;
  try {
    pem = readFileSync(paths.intermediateKey, "utf8");
  } catch {
    throw new DevPkiUnavailableError(`${paths.intermediateKey} is missing or unreadable`);
  }
  if (!pem.includes("PRIVATE KEY")) {
    throw new DevPkiUnavailableError(`${paths.intermediateKey} does not contain a PEM private key`);
  }
  try {
    return use(pem);
  } catch (error) {
    // SWALLOWED AND REPLACED, not wrapped: a forge or OpenSSL parse failure can
    // carry PEM fragments in its message, and a wrapped error would carry them
    // into a log line.
    throw new DevPkiUnavailableError(
      `the key in ${paths.intermediateKey} could not sign; the underlying reason is withheld because it can contain key material` +
        (error instanceof Error && error.name === "DevPkiUnavailableError" ? ` (${error.message})` : ""),
    );
  }
}
