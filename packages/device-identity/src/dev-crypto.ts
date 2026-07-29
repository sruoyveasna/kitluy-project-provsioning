/**
 * DEVELOPMENT-ONLY cryptographic provider — WS-11-T003 Step 4.
 *
 * Authority: KLD-2026-07-28-002 §1, §3, §4, §5, §7.
 *
 * ===========================================================================
 * THIS IS NOT A PRODUCTION CA AND CANNOT BECOME ONE
 * ===========================================================================
 * Every key here is generated in memory, at process start, with no custody
 * ceremony, no HSM and no offline root. Every artifact it produces is stamped
 * `environment: "development"` and `productionEligible: false`, and the
 * verifier refuses a development chain presented to a pilot or production
 * verifier.
 *
 * §4's SKU sub-gate is untouched: no device becomes production-eligible here.
 *
 * ---------------------------------------------------------------------------
 * ALGORITHM
 * ---------------------------------------------------------------------------
 * `[REQUIRED: device_certificate_signature_algorithm]`
 *
 * No algorithm is authoritative in this repository. Ed25519 is selected as a
 * DEVELOPMENT TEST ALGORITHM to exercise the lifecycle — it is in the Node
 * standard library, is deterministic to test, and needs no parameter choices
 * that would amount to inventing a policy. It must not silently become the
 * pilot or production standard; `DEV_ALGORITHM_IS_PROVISIONAL` exists so a
 * reader cannot miss that.
 *
 * ---------------------------------------------------------------------------
 * CERTIFICATE FORMAT
 * ---------------------------------------------------------------------------
 * These are NOT X.509. They are a canonical JSON to-be-signed structure with a
 * detached Ed25519 signature. Real X.509 is a pilot/production concern that
 * BLK-005 §14 leaves blocked, and hand-rolling a partial X.509 encoder would
 * produce something that looked standard while not being it.
 */

import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { createHash, randomUUID } from "node:crypto";

import {
  SIGNING_PURPOSES,
  TRUST_ENVIRONMENTS,
  type SigningPurpose,
  type TrustEnvironment,
} from "./environments.js";
import { RequiredCryptographicValueError } from "./errors.js";
import type { DeviceKeyMetadata, DeviceKeyProvider, DeviceRecordId } from "./index.js";
import type { HardwareTrustLevel } from "./index.js";

/** Loudly provisional. See the ALGORITHM note above. */
export const DEV_ALGORITHM_IS_PROVISIONAL = true as const;
export const DEV_SIGNATURE_ALGORITHM = "ed25519" as const;
export const DEV_REQUIRED_VALUE = "device_certificate_signature_algorithm" as const;

const sha256Hex = (data: Uint8Array | string): string =>
  createHash("sha256")
    .update(typeof data === "string" ? Buffer.from(data, "utf8") : data)
    .digest("hex");

/** Public-key fingerprint: SHA-256 over the DER SPKI encoding. */
export function publicKeyFingerprint(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  return sha256Hex(new Uint8Array(der));
}

// ---------------------------------------------------------------------------
// Key custody
// ---------------------------------------------------------------------------

/**
 * Holds private keys INSIDE the provider. Nothing on the service boundary can
 * reach them: the store is module-private state, every accessor returns public
 * material only, and there is no export method — not a disabled one, none.
 */
class PrivateKeyVault {
  readonly #keys = new Map<string, string>();

  store(handle: string, privateKeyPem: string): void {
    this.#keys.set(handle, privateKeyPem);
  }

  /** Signs WITHOUT surrendering the key. The only way the key is ever used. */
  signWith(handle: string, payload: Uint8Array): Uint8Array {
    const pem = this.#keys.get(handle);
    if (pem === undefined) {
      throw new RequiredCryptographicValueError(
        `a key registered under handle ${handle}`,
        "development",
      );
    }
    return new Uint8Array(sign(null, Buffer.from(payload), createPrivateKey(pem)));
  }

  has(handle: string): boolean {
    return this.#keys.has(handle);
  }
}

const vault = new PrivateKeyVault();

export interface GeneratedKey {
  readonly handle: string;
  readonly publicKeyPem: string;
  readonly fingerprint: string;
}

/** Generates a key pair and retains the private half inside the vault. */
function generateKey(handlePrefix: string): GeneratedKey {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const handle = `${handlePrefix}:${randomUUID()}`;
  vault.store(handle, privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  return { handle, publicKeyPem, fingerprint: publicKeyFingerprint(publicKeyPem) };
}

// ---------------------------------------------------------------------------
// Certificates
// ---------------------------------------------------------------------------

export type CertificateRole = "root" | "intermediate" | "device";

/** The signed portion. Every field that scopes the certificate is inside it. */
export interface TbsCertificate {
  readonly certificateId: string;
  readonly serialNumber: string;
  readonly role: CertificateRole;
  readonly purpose: SigningPurpose;
  readonly environment: TrustEnvironment;
  readonly subjectFingerprint: string;
  readonly subjectPublicKeyPem: string;
  readonly issuerKeyId: string;
  readonly deviceRecordId: string | null;
  readonly certificateGeneration: number | null;
  readonly hardwareTrustLevel: HardwareTrustLevel | null;
  readonly productionEligible: false;
  readonly notBefore: string;
  readonly notAfter: string;
}

export interface Certificate {
  readonly tbs: TbsCertificate;
  readonly signature: Uint8Array;
}

/**
 * Canonical bytes. Field order is FIXED here rather than taken from key order,
 * so a re-serialized certificate cannot verify differently from the original.
 */
export function tbsBytes(tbs: TbsCertificate): Uint8Array {
  return Buffer.from(
    [
      "kitluy.cert.v1",
      tbs.certificateId,
      tbs.serialNumber,
      tbs.role,
      tbs.purpose,
      tbs.environment,
      tbs.subjectFingerprint,
      tbs.subjectPublicKeyPem.trim(),
      tbs.issuerKeyId,
      tbs.deviceRecordId ?? "-",
      tbs.certificateGeneration === null ? "-" : String(tbs.certificateGeneration),
      tbs.hardwareTrustLevel ?? "-",
      String(tbs.productionEligible),
      tbs.notBefore,
      tbs.notAfter,
    ].join("\n"),
    "utf8",
  );
}

/** Field counts either side of the PEM in {@link tbsBytes}. Fixed, not guessed. */
const TBS_FIELDS_BEFORE_PEM = 7;
const TBS_FIELDS_AFTER_PEM = 7;

/**
 * Rebuilds a {@link TbsCertificate} from its canonical bytes.
 *
 * Needed because a credential loaded from STORAGE arrives as the canonical
 * string, and the chain has to be verified from what was actually stored rather
 * than from a CA that happens to still be in memory.
 *
 * The subject PEM is the only field that itself contains newlines, and it sits
 * at a FIXED position — seven fields before it, seven after. So the split is
 * positional: the first seven lines, the last seven lines, and everything
 * between them is the PEM. Locating it by content (`-----BEGIN`) would happily
 * accept a structure whose other fields had been re-ordered.
 *
 * The parsed structure is RE-SERIALIZED and compared byte for byte before it is
 * returned. Anything that does not round-trip is refused rather than repaired:
 * a stored credential must be exactly the bytes that were signed, and a
 * "helpful" reconstruction would verify a signature over something else.
 *
 * Returns null on any malformed input. It never throws, so a corrupt row
 * becomes a typed refusal at the caller instead of an exception mid-chain.
 */
export function tbsFromCanonicalBytes(canonical: string): TbsCertificate | null {
  const lines = canonical.split("\n");
  if (lines.length < TBS_FIELDS_BEFORE_PEM + 1 + TBS_FIELDS_AFTER_PEM) return null;

  const head = lines.slice(0, TBS_FIELDS_BEFORE_PEM);
  const tail = lines.slice(lines.length - TBS_FIELDS_AFTER_PEM);
  const subjectPublicKeyPem = lines
    .slice(TBS_FIELDS_BEFORE_PEM, lines.length - TBS_FIELDS_AFTER_PEM)
    .join("\n");

  if (head[0] !== "kitluy.cert.v1") return null;

  const role = head[3];
  const purpose = head[4];
  const environment = head[5];
  if (role !== "root" && role !== "intermediate" && role !== "device") return null;
  if (!SIGNING_PURPOSES.includes(purpose as SigningPurpose)) return null;
  if (!TRUST_ENVIRONMENTS.includes(environment as TrustEnvironment)) return null;

  // §4 admits no other value from a development CA, and the field is typed
  // `false`. A canonical form claiming otherwise is not parsed into a structure
  // the type system would then vouch for.
  if (tail[4] !== "false") return null;

  const generationRaw = tail[2];
  let certificateGeneration: number | null = null;
  if (generationRaw !== "-") {
    const parsed = Number(generationRaw);
    if (!Number.isInteger(parsed)) return null;
    certificateGeneration = parsed;
  }

  const hardwareTrustLevelRaw = tail[3];
  if (
    hardwareTrustLevelRaw !== "-" &&
    hardwareTrustLevelRaw !== "development_software" &&
    hardwareTrustLevelRaw !== "tpm_2_0" &&
    hardwareTrustLevelRaw !== "secure_element"
  ) {
    return null;
  }

  const tbs: TbsCertificate = {
    certificateId: head[1] ?? "",
    serialNumber: head[2] ?? "",
    role,
    purpose: purpose as SigningPurpose,
    environment: environment as TrustEnvironment,
    subjectFingerprint: head[6] ?? "",
    subjectPublicKeyPem,
    issuerKeyId: tail[0] ?? "",
    deviceRecordId: tail[1] === "-" ? null : (tail[1] ?? ""),
    certificateGeneration,
    hardwareTrustLevel: hardwareTrustLevelRaw === "-" ? null : hardwareTrustLevelRaw,
    productionEligible: false,
    notBefore: tail[5] ?? "",
    notAfter: tail[6] ?? "",
  };

  // The round trip is the whole guarantee. Without it a field containing a
  // newline anywhere else would silently shift every later field by one.
  if (Buffer.from(tbsBytes(tbs)).toString("utf8") !== canonical) return null;

  return tbs;
}

function verifyAgainst(publicKeyPem: string, payload: Uint8Array, signature: Uint8Array): boolean {
  try {
    return verify(
      null,
      Buffer.from(payload),
      createPublicKey(publicKeyPem),
      Buffer.from(signature),
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// The development hierarchy
// ---------------------------------------------------------------------------

export interface CertificateAuthorityProvider {
  readonly environment: TrustEnvironment;
  readonly rootCertificate: Certificate;
  readonly intermediateCertificate: Certificate;
  issueDeviceCertificate(input: DeviceIssuanceInput): Certificate;
}

export interface DeviceIssuanceInput {
  readonly deviceRecordId: string;
  readonly subjectPublicKeyPem: string;
  readonly subjectFingerprint: string;
  readonly hardwareTrustLevel: HardwareTrustLevel;
  readonly certificateGeneration: number;
  /** Trusted time. Never a host clock. */
  readonly notBefore: Date;
  readonly notAfter: Date;
  readonly serialNumber: string;
  readonly certificateId: string;
}

/**
 * Development root -> development device-identity intermediate -> device.
 *
 * The root signs ONLY the intermediate. There is no method on this class that
 * lets the root sign a device certificate — the restriction is structural, not
 * a runtime check that could be bypassed.
 */
export class DevelopmentCertificateAuthority implements CertificateAuthorityProvider {
  readonly environment: TrustEnvironment = "development";
  readonly rootCertificate: Certificate;
  readonly intermediateCertificate: Certificate;

  readonly #rootKey: GeneratedKey;
  readonly #intermediateKey: GeneratedKey;

  constructor(private readonly validity: { notBefore: Date; notAfter: Date }) {
    this.#rootKey = generateKey("dev-root");
    this.#intermediateKey = generateKey("dev-intermediate");

    // Self-signed root. Purpose device_identity; §7 keeps it off every other
    // purpose, and nothing here can sign for another one.
    this.rootCertificate = this.#sign(this.#rootKey.handle, {
      certificateId: randomUUID(),
      serialNumber: `DEV-ROOT-${randomUUID()}`,
      role: "root",
      purpose: "device_identity",
      environment: "development",
      subjectFingerprint: this.#rootKey.fingerprint,
      subjectPublicKeyPem: this.#rootKey.publicKeyPem,
      issuerKeyId: this.#rootKey.fingerprint,
      deviceRecordId: null,
      certificateGeneration: null,
      hardwareTrustLevel: null,
      productionEligible: false,
      notBefore: validity.notBefore.toISOString(),
      notAfter: validity.notAfter.toISOString(),
    });

    this.intermediateCertificate = this.#sign(this.#rootKey.handle, {
      certificateId: randomUUID(),
      serialNumber: `DEV-ICA-${randomUUID()}`,
      role: "intermediate",
      purpose: "device_identity",
      environment: "development",
      subjectFingerprint: this.#intermediateKey.fingerprint,
      subjectPublicKeyPem: this.#intermediateKey.publicKeyPem,
      issuerKeyId: this.#rootKey.fingerprint,
      deviceRecordId: null,
      certificateGeneration: null,
      hardwareTrustLevel: null,
      productionEligible: false,
      notBefore: validity.notBefore.toISOString(),
      notAfter: validity.notAfter.toISOString(),
    });
  }

  get intermediateKeyId(): string {
    return this.#intermediateKey.fingerprint;
  }

  get rootKeyId(): string {
    return this.#rootKey.fingerprint;
  }

  #sign(handle: string, tbs: TbsCertificate): Certificate {
    return { tbs, signature: vault.signWith(handle, tbsBytes(tbs)) };
  }

  /** Device certificates are signed by the INTERMEDIATE. Always. */
  issueDeviceCertificate(input: DeviceIssuanceInput): Certificate {
    return this.#sign(this.#intermediateKey.handle, {
      certificateId: input.certificateId,
      serialNumber: input.serialNumber,
      role: "device",
      purpose: "device_identity",
      environment: "development",
      subjectFingerprint: input.subjectFingerprint,
      subjectPublicKeyPem: input.subjectPublicKeyPem,
      issuerKeyId: this.#intermediateKey.fingerprint,
      deviceRecordId: input.deviceRecordId,
      certificateGeneration: input.certificateGeneration,
      hardwareTrustLevel: input.hardwareTrustLevel,
      // §4: never production-eligible from a development CA. Typed `false`, so
      // it cannot be set true without a type error.
      productionEligible: false,
      notBefore: input.notBefore.toISOString(),
      notAfter: input.notAfter.toISOString(),
    });
  }
}

// ---------------------------------------------------------------------------
// Chain verification
// ---------------------------------------------------------------------------

export type ChainRejectionCode =
  | "CHAIN_ROOT_NOT_TRUSTED"
  | "CHAIN_ROOT_NOT_SELF_SIGNED"
  | "CHAIN_INTERMEDIATE_NOT_SIGNED_BY_ROOT"
  | "CHAIN_DEVICE_NOT_SIGNED_BY_INTERMEDIATE"
  | "CHAIN_ROOT_ISSUED_DEVICE_DIRECTLY"
  | "CHAIN_ROLE_MISMATCH"
  | "CHAIN_ENVIRONMENT_MISMATCH"
  | "CHAIN_PURPOSE_MISMATCH";

export interface ChainVerdict {
  readonly valid: boolean;
  readonly rejectionCode?: ChainRejectionCode;
  readonly detail?: string;
}

export interface CertificateChain {
  readonly root: Certificate;
  readonly intermediate: Certificate;
  readonly device: Certificate;
}

/**
 * Verifies root -> intermediate -> device with REAL signature checks.
 *
 * `trustedRootFingerprints` is the verifier's anchor set. A pilot or production
 * verifier simply does not carry the development root, which is what makes a
 * development chain unusable there — enforced by anchor membership rather than
 * by a policy flag somebody could flip.
 */
export function verifyCertificateChain(
  chain: CertificateChain,
  expectations: {
    environment: TrustEnvironment;
    purpose: SigningPurpose;
    trustedRootFingerprints: readonly string[];
  },
): ChainVerdict {
  const reject = (rejectionCode: ChainRejectionCode, detail: string): ChainVerdict => ({
    valid: false,
    rejectionCode,
    detail,
  });

  const { root, intermediate, device } = chain;

  if (
    root.tbs.role !== "root" ||
    intermediate.tbs.role !== "intermediate" ||
    device.tbs.role !== "device"
  ) {
    return reject("CHAIN_ROLE_MISMATCH", "certificate roles are not root/intermediate/device");
  }

  if (!expectations.trustedRootFingerprints.includes(root.tbs.subjectFingerprint)) {
    return reject(
      "CHAIN_ROOT_NOT_TRUSTED",
      "the presented root is not in this verifier's trust anchor set",
    );
  }

  for (const cert of [root, intermediate, device]) {
    if (cert.tbs.environment !== expectations.environment) {
      return reject(
        "CHAIN_ENVIRONMENT_MISMATCH",
        `a ${cert.tbs.role} certificate is for ${cert.tbs.environment}, verifier is ${expectations.environment}`,
      );
    }
    if (cert.tbs.purpose !== expectations.purpose) {
      return reject(
        "CHAIN_PURPOSE_MISMATCH",
        `a ${cert.tbs.role} certificate is for ${cert.tbs.purpose}, expected ${expectations.purpose}`,
      );
    }
  }

  // §1: the root must not issue device certificates directly.
  if (device.tbs.issuerKeyId === root.tbs.subjectFingerprint) {
    return reject(
      "CHAIN_ROOT_ISSUED_DEVICE_DIRECTLY",
      "the root issued a device certificate; the root signs only the intermediate",
    );
  }

  if (!verifyAgainst(root.tbs.subjectPublicKeyPem, tbsBytes(root.tbs), root.signature)) {
    return reject("CHAIN_ROOT_NOT_SELF_SIGNED", "root self-signature does not verify");
  }
  if (
    intermediate.tbs.issuerKeyId !== root.tbs.subjectFingerprint ||
    !verifyAgainst(root.tbs.subjectPublicKeyPem, tbsBytes(intermediate.tbs), intermediate.signature)
  ) {
    return reject(
      "CHAIN_INTERMEDIATE_NOT_SIGNED_BY_ROOT",
      "the intermediate is not signed by the presented root",
    );
  }
  if (
    device.tbs.issuerKeyId !== intermediate.tbs.subjectFingerprint ||
    !verifyAgainst(intermediate.tbs.subjectPublicKeyPem, tbsBytes(device.tbs), device.signature)
  ) {
    return reject(
      "CHAIN_DEVICE_NOT_SIGNED_BY_INTERMEDIATE",
      "the device certificate is not signed by the presented intermediate",
    );
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Device key provider
// ---------------------------------------------------------------------------

/**
 * Generates device keys and proves possession WITHOUT ever surrendering the
 * private half. `describeDeviceKey` and `generateDeviceKey` return public
 * metadata only, and there is no method that returns key material.
 */
export class DevelopmentDeviceKeyProvider implements DeviceKeyProvider {
  readonly #handles = new Map<string, GeneratedKey>();

  async generateDeviceKey(
    deviceRecordId: DeviceRecordId,
    environment: TrustEnvironment,
  ): Promise<DeviceKeyMetadata> {
    if (environment !== "development") {
      throw new RequiredCryptographicValueError(
        "a hardware-backed key provider for this environment; the development provider is non-production",
        environment,
      );
    }
    const key = generateKey(`dev-device:${deviceRecordId}`);
    this.#handles.set(deviceRecordId, key);
    return this.#describe(key);
  }

  async describeDeviceKey(deviceRecordId: DeviceRecordId): Promise<DeviceKeyMetadata> {
    const key = this.#handles.get(deviceRecordId);
    if (key === undefined) {
      throw new RequiredCryptographicValueError(
        `an on-device key for ${deviceRecordId}`,
        "development",
      );
    }
    return this.#describe(key);
  }

  publicKeyPem(deviceRecordId: string): string | null {
    return this.#handles.get(deviceRecordId)?.publicKeyPem ?? null;
  }

  /** Proof of possession: signs a challenge with the device private key. */
  provePossession(deviceRecordId: string, payload: Uint8Array): Uint8Array {
    const key = this.#handles.get(deviceRecordId);
    if (key === undefined) {
      throw new RequiredCryptographicValueError(
        `an on-device key for ${deviceRecordId}`,
        "development",
      );
    }
    return vault.signWith(key.handle, payload);
  }

  #describe(key: GeneratedKey): DeviceKeyMetadata {
    return {
      publicKeyFingerprint: key.fingerprint,
      algorithm: DEV_SIGNATURE_ALGORITHM,
      // §4: software-backed, therefore never production-eligible.
      hardwareTrustLevel: "development_software",
      exportable: false,
      generatedOnDevice: true,
    };
  }
}

export function verifyDetachedSignature(
  publicKeyPem: string,
  payload: Uint8Array,
  signature: Uint8Array,
): boolean {
  return verifyAgainst(publicKeyPem, payload, signature);
}

// ---------------------------------------------------------------------------
// Vault access for other custody modules
// ---------------------------------------------------------------------------
// The vault itself stays module-private. These two functions are the ONLY way
// another module in this package reaches it, and neither can yield key
// material: one returns public metadata, the other returns a signature. Adding
// a third that returned a private half would have to be written deliberately,
// which is the point of routing custody through here rather than exporting the
// vault.

/** Generates a key pair inside the vault and returns PUBLIC metadata only. */
export function generateVaultKey(handlePrefix: string): GeneratedKey {
  return generateKey(handlePrefix);
}

/** Signs with a vault-held key WITHOUT surrendering it. */
export function vaultSign(handle: string, payload: Uint8Array): Uint8Array {
  return vault.signWith(handle, payload);
}
