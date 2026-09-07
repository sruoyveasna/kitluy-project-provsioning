/**
 * The first governed operational certificate a Store Hub ever receives.
 *
 * Authority: owner decision 2026-08-25 (Steps 2–8) — reuse `kitluy.csr.v1`,
 * reuse `register_generation_key_v1`, let the server allocate generation, use
 * the persistent development CA, persist the exact artifact;
 * KLD-2026-07-28-002 (BLK-005) — development only.
 *
 * ===========================================================================
 * NOTHING HERE IS A NEW PROTOCOL
 * ===========================================================================
 * Every part of this already existed and had never been joined up:
 *
 *   kitluy.csr.v1                      `certificate-issuance.ts` — the CSR-equivalent
 *                                      preimage, and the only PoP kind that does
 *                                      not presume a credential already exists
 *   register_generation_key_v1         admits a device-generated key at any
 *                                      generation, state `generated`, no
 *                                      renewal attempt required
 *   prepare_…_issuance_v1              allocates generation 1 explicitly when the
 *                                      device has no credential head yet
 *   runGovernedIssuance                prepare -> sign -> record -> finalize
 *   record_operational_certificate_v1  group 0202, the artifact door
 *
 * The renewal compositions (`same-key-…`, `rotate-key-…`) already do exactly
 * this shape for generation N+1. This is the same shape at generation 1.
 *
 * ===========================================================================
 * TWO CREDENTIALS OVER ONE KEY
 * ===========================================================================
 * The device generates ONE operational key pair and keeps the private half. Two
 * different credentials are then issued over its public half:
 *
 *   canonical KitLuy credential   Ed25519 detached signature over canonical JSON.
 *                                 `device_credentials`. The lifecycle authority.
 *   operational X.509 leaf        what `node:https` mutual TLS can actually
 *                                 consume. `device_certificates`, via 0202.
 *
 * They are linked by `credential_id` and must agree on generation, serial,
 * validity window and public-key fingerprint — group 0201's activation predicate
 * checks precisely that, so a mismatch cannot activate a device.
 *
 * ===========================================================================
 * WHY THE OPERATIONAL KEY IS RSA-2048
 * ===========================================================================
 * Forced by the X.509 half, not chosen for its own sake. `node:crypto` can parse
 * X.509 and cannot issue it, so issuance uses `node-forge`, whose `pki` signs
 * RSA; its Ed25519 support does not extend to certificate signing. The Hub's LAN
 * transport suite already mints RSA-2048 for this exact mTLS path.
 *
 * A consequence worth stating: `verifyDetachedSignature` in
 * `@kitluy/device-identity` is Ed25519-only (`verify(null, …)`), so PoP over an
 * RSA key needs an RSA-aware verifier. That is `verifyOperationalPossession`
 * below — the same discipline, one algorithm wider, and still performed HERE
 * rather than trusted from the caller.
 *
 * `[REQUIRED: device_certificate_signature_algorithm]` remains OPEN. This is
 * `DEV_TLS_ALGORITHM_IS_PROVISIONAL` and must not be read as a production
 * decision; the algorithm is recorded per row in `public_key_algorithm` so a
 * later reader cannot mistake one for the other.
 */
import {
  createHash,
  createPublicKey,
  verify as cryptoVerify,
  X509Certificate,
} from "node:crypto";
import { createRequire } from "node:module";

import type pg from "pg";
import {
  requestBytes,
  runGovernedIssuance,
  type DeviceCertificateRequest,
  type HardwareTrustLevel,
} from "@kitluy/device-identity";

import { createIssuanceGateway } from "./issuance-gateway.js";
import {
  DEV_TLS_ALGORITHM_IS_PROVISIONAL,
  DEV_TLS_KEY_BITS,
  DevPkiUnavailableError,
  assertDevelopmentOnly,
  readDevPkiChain,
  resolveDevPkiPaths,
  withIssuingCaKey,
} from "./dev-operational-pki.js";
import { PersistentDevelopmentCertificateAuthority } from "./persistent-dev-ca.js";
import { REGISTRY_ROLES, withServiceRole } from "./database.js";

const require = createRequire(import.meta.url);
/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- node-forge ships no types we depend on here */
const forge: any = require("node-forge");

/** Recorded per row so a development algorithm cannot be read as a policy. */
export const OPERATIONAL_KEY_ALGORITHM = "rsa-2048" as const;
export { DEV_TLS_ALGORITHM_IS_PROVISIONAL };

/** SHA-256 over the DER SPKI — the repository's one fingerprint spelling. */
export function operationalKeyFingerprint(publicKeyPem: string): string {
  return createHash("sha256")
    .update(createPublicKey(publicKeyPem).export({ type: "spki", format: "der" }))
    .digest("hex");
}

/**
 * The key algorithm and size a development operational certificate requires.
 *
 * C-3: checked from Node's OWN view of the key, not from whether a signature
 * happened to verify. `verifyOperationalPossession` succeeds for an Ed25519 or
 * a 1024-bit RSA key just as readily as for the one shape this path can
 * actually issue — forge signs RSA, and the Hub LAN transport is proven against
 * RSA-2048 — so a proof-of-possession check is not a key-support check.
 *
 * This runs BEFORE anything irreversible. Registering a key the signer cannot
 * use would spend generation 1 on a request guaranteed to fail at signing, and
 * generation 1 is spent exactly once.
 */
export type OperationalKeyRejection =
  | { readonly ok: true }
  | { readonly ok: false; readonly detail: string };

export function validateOperationalKey(publicKeyPem: string): OperationalKeyRejection {
  let key: ReturnType<typeof createPublicKey>;
  try {
    key = createPublicKey(publicKeyPem);
  } catch {
    return { ok: false, detail: "the operational public key is not a readable PEM SubjectPublicKeyInfo" };
  }
  if (key.asymmetricKeyType !== "rsa") {
    return {
      ok: false,
      detail: `development operational keys must be RSA; this key is ${key.asymmetricKeyType ?? "of an unknown type"}`,
    };
  }
  const bits = key.asymmetricKeyDetails?.modulusLength;
  if (bits !== DEV_TLS_KEY_BITS) {
    return {
      ok: false,
      detail: `development operational keys must be RSA-${DEV_TLS_KEY_BITS}; this key is RSA-${bits ?? "unknown"}`,
    };
  }
  return { ok: true };
}

/**
 * Verify that whoever built this request holds the private half.
 *
 * Performed by THIS module, from inside the trusted computing base. The verdict
 * is never accepted from a caller: `popServiceVerified` below is this function's
 * return value and nothing else, which is the whole point of OPTION B.
 */
export function verifyOperationalPossession(
  publicKeyPem: string,
  preimage: Uint8Array,
  signature: Uint8Array,
): boolean {
  try {
    // 'sha256', not null: an RSA signature needs a digest algorithm, where
    // Ed25519 takes none. Passing null here would fail every valid signature.
    return cryptoVerify(
      "sha256",
      Buffer.from(preimage),
      createPublicKey(publicKeyPem),
      Buffer.from(signature),
    );
  } catch {
    // A malformed key or signature is a failed proof, not an exception to
    // propagate — the caller gets one refusal shape for every way it can fail.
    return false;
  }
}

export interface FirstOperationalIssuanceRequest {
  readonly deviceRecordId: string;
  readonly environment: string;
  readonly assignmentGeneration: number;
  readonly hardwareTrustLevel: HardwareTrustLevel;
  /** The device's LOCALLY generated operational public key. */
  readonly operationalPublicKeyPem: string;
  /** Opaque reference the device uses for its own private key. Never a key. */
  readonly operationalKeyHandle: string;
  /** `kitluy.csr.v1` over `requestBytes`, signed with the operational key. */
  readonly proofOfPossession: Uint8Array;
  readonly requestId: string;
  readonly nonce: string;
  readonly correlationId: string;
  /** Trusted time, from the governed authority. Never a host clock. */
  readonly requestedAt: Date;
  readonly trustedTimeStatus: string;
  readonly actorRef: string;
}

export type FirstIssuanceRefusalCode =
  | "OPCERT_UNSUPPORTED_KEY"
  | "OPCERT_POSSESSION_PROOF_FAILED"
  | "OPCERT_KEY_REGISTRATION_REFUSED"
  | "OPCERT_GOVERNED_ISSUANCE_REFUSED"
  | "OPCERT_X509_SIGNING_FAILED"
  | "OPCERT_ARTIFACT_NOT_PERSISTED"
  | "OPCERT_CA_UNAVAILABLE";

export type FirstOperationalIssuanceOutcome =
  | {
      readonly outcome: "ISSUED" | "REPLAYED";
      readonly credentialId: string;
      readonly certificateGeneration: number;
      readonly serialNumber: string;
      readonly certificateSha256: string;
      readonly certificatePem: string;
      readonly chainPem: string;
      readonly publicKeyAlgorithm: string;
      readonly notBefore?: string;
      readonly notAfter?: string;
    }
  | {
      readonly outcome: "REFUSED";
      readonly refusalCode: FirstIssuanceRefusalCode;
      /** The governed refusal, verbatim. Never flattened. */
      readonly detail: string;
    };

/**
 * Encode hex bytes as a MINIMAL POSITIVE DER INTEGER, and nothing else.
 *
 * ===========================================================================
 * R2-1: WHY THIS FUNCTION EXISTS AT ALL
 * ===========================================================================
 * The previous mapping prefixed `00` unconditionally. When the significant
 * bytes ALREADY began with `00` — which they do for roughly one credential
 * serial in 256 — the certificate carried two leading zero bytes and OpenSSL
 * refused it outright:
 *
 *     asn1 encoding routines::illegal padding
 *
 * The second independent review measured ~5 failures per 1200 mints. Confirmed
 * here before changing anything: `DEV-004C34C1A664C9E5` produced a certificate
 * `node:crypto` could not parse.
 *
 * node-forge does not save you. Measured against forge 1.x, it strips at most
 * ONE redundant leading zero:
 *
 *     input 000123456789abcdef -> DER 0123456789abcdef   (fixed for us)
 *     input 00004c34c1a664c9e5 -> DER 004c34c1a664c9e5   (STILL malformed)
 *     input 00ff34c1a664c9e512 -> DER 00ff34c1a664c9e512 (correctly kept)
 *
 * So the encoder has to be correct before forge sees it.
 *
 * DER INTEGER, exactly:
 *   1. remove leading zero bytes, keeping at least one byte;
 *   2. if the first remaining byte has the high bit set, prefix exactly ONE
 *      `00`, because a leading byte >= 0x80 would make the integer NEGATIVE and
 *      RFC 5280 requires a positive serial;
 *   3. never emit a redundant zero;
 *   4. never truncate.
 */
export function minimalPositiveDerInteger(hex: string): string {
  const lower = hex.toLowerCase();
  if (!/^([0-9a-f]{2})+$/.test(lower)) {
    throw new Error(`KLUY-SERIAL-MALFORMED: "${hex}" is not whole hex bytes`);
  }
  let bytes = lower;
  // 1. Strip leading zero BYTES. Keep one, so zero encodes as `00` rather than
  //    as nothing — an empty INTEGER is not a valid encoding of anything.
  while (bytes.length > 2 && bytes.startsWith("00")) {
    bytes = bytes.slice(2);
  }
  // 2. One sign byte, and only when the value would otherwise read as negative.
  if (Number.parseInt(bytes.slice(0, 2), 16) >= 0x80) {
    bytes = `00${bytes}`;
  }
  return bytes;
}

/**
 * THE credential-serial to X.509-serial mapping, shared with the database.
 *
 * Mirrors `kitluy_devices.x509_serial_for_credential_v1` exactly, and the
 * artifact door recomputes it from the certificate's own DER and refuses a
 * mismatch — so a divergence between these two implementations fails loudly at
 * issuance rather than quietly at revocation time.
 *
 * A `DEV-` serial carries 8 bytes of real entropy in 20 bytes of clothing, so
 * the mapping takes the significant half and encodes it as a minimal positive
 * DER INTEGER: at most nine octets, well inside RFC 5280's twenty, and
 * REVERSIBLE, which is what lets a revocation projection recover the credential
 * serial from a presented certificate (see `credentialSerialFromX509`).
 *
 * Anything else is hashed to nineteen bytes and encoded the same way —
 * deterministic, in-range, and it never truncates.
 */
export function x509SerialForCredential(serialNumber: string): string {
  const significant = /^DEV-[0-9A-Fa-f]{16}$/.test(serialNumber)
    ? serialNumber.slice(4).toLowerCase()
    : createHash("sha256").update(serialNumber).digest("hex").slice(0, 38);
  return minimalPositiveDerInteger(significant);
}

/** Raised when a serial cannot be inverted. Never a fabricated answer. */
export class SerialNotInvertibleError extends Error {
  constructor(reason: string) {
    super(`KLUY-SERIAL-NOT-INVERTIBLE: ${reason}`);
    this.name = "SerialNotInvertibleError";
  }
}

/**
 * The inverse, for the revocation projection — and it FAILS CLOSED.
 *
 * ===========================================================================
 * N-1: WHY THIS THROWS
 * ===========================================================================
 * `x509SerialForCredential` has two branches. `DEV-<16 hex>` keeps the 8
 * significant bytes and is invertible. Everything else is SHA-256 truncated to
 * 19 bytes and is NOT invertible — a hash has no inverse.
 *
 * The previous version ignored that. Handed a hashed serial it stripped leading
 * zeros, took whatever remained, and padded it into a `DEV-`-shaped string:
 *
 *     'not-a-dev-serial' -> 3cb969e3dd8d3187876956f5491a4a571c8ab6
 *                        -> returned  DEV-3CB969E3DD8D3187
 *
 * Not a wrong answer — a FABRICATED one. A well-formed credential serial that no
 * credential has. A revocation projection that looked a presented certificate up
 * by that value would find nothing and conclude the certificate is not revoked.
 * The SQL half fabricated a DIFFERENT value from this one, which is how the
 * reviewer found it.
 *
 * SELF-CHECKING rather than width-checked: the candidate is run back through the
 * forward mapping and must reproduce the input byte for byte, so a value the
 * forward mapping could never have produced is refused even at the right width.
 *
 * Mirrors `kitluy_devices.credential_serial_from_x509_v1` exactly, including its
 * refusals, and the two are compared case by case in
 * `serial-canonicalization.adversarial.test.ts`.
 */
export function credentialSerialFromX509(x509SerialHex: string): string {
  const input = x509SerialHex.toLowerCase();
  if (!/^([0-9a-f]{2})+$/.test(input)) {
    throw new SerialNotInvertibleError(`"${x509SerialHex}" is not whole hex bytes`);
  }
  // A non-minimal encoding never came out of the forward mapping.
  if (input !== minimalPositiveDerInteger(input)) {
    throw new SerialNotInvertibleError(
      `"${x509SerialHex}" is not a minimal positive DER INTEGER`,
    );
  }

  let bytes = input;
  while (bytes.length > 2 && bytes.startsWith("00")) {
    bytes = bytes.slice(2);
  }
  // The DEV- form carries exactly 8 significant bytes. More is the hashed
  // branch, which has no inverse by construction.
  if (bytes.length > 16) {
    throw new SerialNotInvertibleError(
      `${bytes.length / 2} significant bytes; only the canonical 8-byte DEV- shape is ` +
        "invertible. Look the certificate up by its stored certificate_x509_serial instead.",
    );
  }

  const candidate = `DEV-${bytes.padStart(16, "0").toUpperCase()}`;
  if (x509SerialForCredential(candidate) !== input) {
    throw new SerialNotInvertibleError(
      `"${x509SerialHex}" does not round-trip through the forward mapping`,
    );
  }
  return candidate;
}

/**
 * Mint the operational X.509 leaf over the device's key.
 *
 * Every identifying value is taken from the FINALIZED credential — serial,
 * validity window, generation — so the leaf cannot describe anything the
 * governed lifecycle did not already decide. The caller contributes the public
 * key it proved possession of, and nothing else.
 */
function signOperationalLeaf(input: {
  readonly subjectPublicKeyPem: string;
  readonly deviceRecordId: string;
  readonly serialNumber: string;
  readonly notBefore: Date;
  readonly notAfter: Date;
  readonly certificateGeneration: number;
  readonly issuerCertificatePem: string;
  readonly issuerPrivateKeyPem: string;
}): string {
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(input.subjectPublicKeyPem);
  // M-1: THE CANONICAL SERIAL, NOT A TRUNCATED ONE.
  //
  // This line read `\`00${hex(serialNumber)}\`.slice(0, 40)`. A credential
  // serial is `DEV-` plus 16 hex characters — 20 ASCII bytes, so 40 hex
  // characters — and the `00` prefix pushed it to 42. The slice then silently
  // dropped the last byte, so EVERY certificate this path ever issued carried a
  // serial that was not the credential's.
  //
  // Harmless only for as long as nothing compares them. Hub mTLS authorization,
  // the revocation projection and the offline revocation set all have to match a
  // presented certificate back to a credential, and that is the next milestone.
  cert.serialNumber = x509SerialForCredential(input.serialNumber);
  cert.validity.notBefore = input.notBefore;
  cert.validity.notAfter = input.notAfter;

  const issuer = forge.pki.certificateFromPem(input.issuerCertificatePem);
  // The device record id is the subject identity. Store and Location are NOT
  // encoded here: the approved profile does not carry them, and inventing an
  // extension for business authority would put authorization in a place the
  // application layer already owns.
  cert.setSubject([
    { name: "commonName", value: input.deviceRecordId },
    { name: "organizationName", value: "KitLuy Suite" },
    { name: "organizationalUnitName", value: "NON-PRODUCTION development device" },
  ]);
  cert.setIssuer(issuer.subject.attributes);
  cert.setExtensions([
    // A leaf, and never a CA. Critical, so a parser cannot ignore it.
    { name: "basicConstraints", cA: false, critical: true },
    {
      name: "keyUsage",
      critical: true,
      digitalSignature: true,
      keyEncipherment: true,
    },
    // Both, because a Store Hub is a TLS SERVER to its terminals and a TLS
    // CLIENT to nothing yet — but the same credential is what a terminal will
    // present back, and one profile for both keeps the trust model single.
    { name: "extKeyUsage", serverAuth: true, clientAuth: true },
    {
      name: "subjectAltName",
      altNames: [
        // URI, not DNS: this identity is a device record, not a hostname.
        { type: 6, value: `kitluy-device://${input.deviceRecordId}` },
        { type: 6, value: `kitluy-generation://${String(input.certificateGeneration)}` },
        { type: 6, value: "kitluy-environment://development" },
      ],
    },
    { name: "subjectKeyIdentifier" },
    // M-2: THE AUTHORITY KEY IDENTIFIER.
    //
    // Absent until now, and a leaf without one leaves a verifier to guess which
    // issuer certificate to try — fine with a chain of two, wrong the moment the
    // development CA is ever rotated and two intermediates share a subject name.
    // Derived from the ISSUER's own subject key identifier, so it points at the
    // key rather than at the name.
    {
      name: "authorityKeyIdentifier",
      keyIdentifier: forge.pki
        .certificateFromPem(input.issuerCertificatePem)
        .generateSubjectKeyIdentifier()
        .getBytes(),
    },
  ]);
  cert.sign(forge.pki.privateKeyFromPem(input.issuerPrivateKeyPem), forge.md.sha256.create());
  return forge.pki.certificateToPem(cert);
}

/**
 * The composition.
 *
 * Order matters and is the owner's: verify possession BEFORE anything is
 * reserved, and persist the artifact BEFORE reporting success.
 */
export async function issueFirstOperationalCertificate(
  pool: pg.Pool,
  request: FirstOperationalIssuanceRequest,
  env: NodeJS.ProcessEnv = process.env,
): Promise<FirstOperationalIssuanceOutcome> {
  const refuse = (
    refusalCode: FirstIssuanceRefusalCode,
    detail: string,
  ): FirstOperationalIssuanceOutcome => ({ outcome: "REFUSED", refusalCode, detail });

  assertDevelopmentOnly(request.environment);

  // -- 0. THE KEY ITSELF, BEFORE ANYTHING IS SPENT ---------------------------
  // C-3. Ordered first deliberately: every later step either reserves something
  // irreversible or costs a signature, and a key this path cannot issue for was
  // never going to reach the end. Refusing here costs the caller a round trip;
  // refusing after `register_generation_key_v1` costs a physical Store Hub its
  // only generation-1 slot.
  const keyCheck = validateOperationalKey(request.operationalPublicKeyPem);
  if (!keyCheck.ok) {
    return refuse("OPCERT_UNSUPPORTED_KEY", keyCheck.detail);
  }

  const fingerprint = operationalKeyFingerprint(request.operationalPublicKeyPem);

  // -- 1. PROOF OF POSSESSION, BEFORE ANYTHING IS RESERVED -------------------
  // `kitluy.csr.v1`. The preimage binds the device, the environment, THIS public
  // key's fingerprint, the purpose, the assignment generation, the trusted
  // timestamp, a nonce and a correlation id. Credential generation is absent on
  // purpose: the server allocates it, so the device cannot know it to sign it.
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

  // -- 2. THE PERSISTENT CA ---------------------------------------------------
  // Loaded before any reservation is spent: a CA that turns out to be missing
  // after `prepare` has run leaves a reservation behind for nothing.
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

  // -- 3. REGISTER THE DEVICE-GENERATED KEY ----------------------------------
  // Through the governed door, never by a direct write. Idempotent per
  // (device, environment, purpose, generation): a retry replays.
  try {
    await withServiceRole(pool, REGISTRY_ROLES.issuance, async (c) => {
      await c.query(
        `select kitluy_devices.register_generation_key_v1(
                  $1::uuid, $2::text, 'device_identity', 1, $3::text, $4::text, $5::text)`,
        [
          request.deviceRecordId,
          request.environment,
          request.operationalKeyHandle,
          request.operationalPublicKeyPem,
          fingerprint,
        ],
      );
    });
  } catch (error) {
    return refuse(
      "OPCERT_KEY_REGISTRATION_REFUSED",
      error instanceof Error ? error.message : "the generation key could not be registered",
    );
  }

  // -- 4. THE GOVERNED CREDENTIAL --------------------------------------------
  // `runGovernedIssuance` allocates nothing itself: serial, generation,
  // credential id, validity window and canonical TBS all come out of
  // `prepare_device_credential_issuance_v1`.
  const gateway = createIssuanceGateway({ pool, issuerRole: REGISTRY_ROLES.issuance });
  const governed = await runGovernedIssuance(
    {
      requestId: request.requestId,
      deviceRecordId: request.deviceRecordId,
      environment: request.environment,
      purpose: "device_identity",
      assignmentGeneration: request.assignmentGeneration,
      publicKeyPem: request.operationalPublicKeyPem,
      publicKeyFingerprint: fingerprint,
      // Derived from the SIGNED preimage, so a retry of the same signed request
      // recomputes the same credential id and serial rather than allocating new
      // ones.
      idempotencyKey: createHash("sha256").update(Buffer.from(preimage)).digest("hex"),
      canonicalPayloadHash: createHash("sha256").update(Buffer.from(preimage)).digest("hex"),
      popAlgorithm: OPERATIONAL_KEY_ALGORITHM,
      popSignedPreimageHash: createHash("sha256").update(Buffer.from(preimage)).digest("hex"),
      popSignature: request.proofOfPossession,
      // THIS module's verdict, computed above. Never the caller's claim.
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

  // -- 4b. THE AUTHORITATIVE WINDOW, READ FROM THE CREDENTIAL ----------------
  // NOT from `finalize`'s optional fields. On a REPLAY the governed door returns
  // only `credential_id`, `serial_number` and `certificate_generation` — it does
  // not repeat the validity window — so a composition that trusted those fields
  // fell back to the request timestamp and minted a certificate with a DIFFERENT
  // window on every retry. The door then correctly refused it as
  // `KLUY-OPCERT-ARTIFACT-CONFLICT`.
  //
  // The credential row is the authority for all of it, on both paths.
  const authoritative = await withServiceRole(pool, REGISTRY_ROLES.issuance, async (c) => {
    const { rows } = await c.query<{
      serial_number: string;
      certificate_generation: number;
      not_before: Date;
      not_after: Date;
      existing_pem: string | null;
      existing_sha: string | null;
      existing_chain: string | null;
    }>(
      `select cr.serial_number, cr.certificate_generation, cr.not_before, cr.not_after,
              c2.certificate_pem as existing_pem, c2.certificate_sha256 as existing_sha,
              c2.chain_pem as existing_chain
         from kitluy_devices.device_credentials cr
         left join kitluy_devices.device_certificates c2 on c2.credential_id = cr.credential_id
        where cr.credential_id = $1::uuid`,
      [credential.credentialId],
    );
    return rows[0];
  });
  if (authoritative === undefined) {
    return refuse("OPCERT_GOVERNED_ISSUANCE_REFUSED", "the finalized credential could not be read back");
  }

  // A retry after a lost response returns the SAME persisted bytes. Re-signing
  // would produce a second, equally valid certificate for one credential, which
  // is precisely the ambiguity one-credential-one-certificate exists to prevent.
  if (authoritative.existing_pem !== null && authoritative.existing_sha !== null) {
    return {
      outcome: "REPLAYED",
      credentialId: credential.credentialId,
      certificateGeneration: authoritative.certificate_generation,
      serialNumber: authoritative.serial_number,
      certificateSha256: authoritative.existing_sha,
      certificatePem: authoritative.existing_pem,
      chainPem: authoritative.existing_chain ?? "",
      publicKeyAlgorithm: OPERATIONAL_KEY_ALGORITHM,
      notBefore: authoritative.not_before.toISOString(),
      notAfter: authoritative.not_after.toISOString(),
    };
  }

  // -- 5. THE OPERATIONAL X.509 LEAF -----------------------------------------
  // Signed by the PERSISTENT issuing CA, over the same key, with the window and
  // serial the governed credential already fixed.
  let leafPem: string;
  try {
    leafPem = withIssuingCaKey(paths, (issuerPrivateKeyPem) =>
      signOperationalLeaf({
        subjectPublicKeyPem: request.operationalPublicKeyPem,
        deviceRecordId: request.deviceRecordId,
        serialNumber: authoritative.serial_number,
        notBefore: authoritative.not_before,
        notAfter: authoritative.not_after,
        certificateGeneration: authoritative.certificate_generation,
        issuerCertificatePem: chain.intermediateCertificatePem,
        issuerPrivateKeyPem,
      }),
    );
  } catch (error) {
    // The governed credential EXISTS at this point. Reporting a refusal here is
    // honest and recoverable: a retry replays the same reservation and signs
    // again, and no artifact was recorded.
    return refuse(
      "OPCERT_X509_SIGNING_FAILED",
      error instanceof DevPkiUnavailableError ? error.message : "the leaf could not be signed",
    );
  }

  // -- 5b. VERIFY WHAT WAS JUST SIGNED, BEFORE ASKING ANYONE TO TRUST IT -----
  //
  // M-3, and defence in depth rather than the authority. The DATABASE is the
  // authority: group 0203's door parses this leaf, recomputes its SPKI
  // fingerprint, and verifies its signature under the PINNED development issuing
  // CA and that CA under the PINNED root. Nothing here substitutes for that, and
  // nothing here is trusted by it.
  //
  // What this adds is a fast, local failure with a readable message. A leaf that
  // does not verify against the chain it will be shipped with is a bug in THIS
  // module — a mismatched key, a stale CA load, a forge encoding fault — and
  // meeting it three layers down as a governed refusal costs an hour every time.
  try {
    const leaf = new X509Certificate(leafPem);
    const issuer = new X509Certificate(chain.intermediateCertificatePem);
    const root = new X509Certificate(chain.rootCertificatePem);
    if (!leaf.verify(issuer.publicKey) || !issuer.verify(root.publicKey)) {
      return refuse(
        "OPCERT_X509_SIGNING_FAILED",
        "the freshly signed leaf does not verify against the development chain",
      );
    }
  } catch {
    return refuse("OPCERT_X509_SIGNING_FAILED", "the freshly signed leaf could not be parsed");
  }

  // -- 6. PERSIST BEFORE REPORTING SUCCESS -----------------------------------
  const chainPem = `${chain.intermediateCertificatePem.trim()}\n${chain.rootCertificatePem.trim()}\n`;
  let recorded: {
    outcome?: string;
    certificate_sha256?: string;
    certificate_serial?: string;
    certificate_generation?: number;
    not_before?: string;
    not_after?: string;
    refusal_code?: string;
    detail?: string;
  };
  try {
    recorded = await withServiceRole(pool, REGISTRY_ROLES.issuance, async (c) => {
      const { rows } = await c.query<{ result: Record<string, unknown> }>(
        `select kitluy_devices.record_operational_certificate_v1(
                  $1::uuid, $2::text, $3::text, $4::text, $5::text) as result`,
        [credential.credentialId, leafPem, chainPem, OPERATIONAL_KEY_ALGORITHM, request.actorRef],
      );
      return (rows[0]?.result ?? {}) as typeof recorded;
    });
  } catch (error) {
    return refuse(
      "OPCERT_ARTIFACT_NOT_PERSISTED",
      error instanceof Error ? error.message : "the artifact could not be recorded",
    );
  }
  if (recorded.outcome !== "RECORDED" && recorded.outcome !== "ALREADY_RECORDED") {
    return refuse(
      "OPCERT_ARTIFACT_NOT_PERSISTED",
      `${recorded.refusal_code ?? "REFUSED"}: ${recorded.detail ?? "the artifact door refused"}`,
    );
  }

  return {
    outcome: governed.outcome === "REPLAYED" ? "REPLAYED" : "ISSUED",
    credentialId: credential.credentialId,
    certificateGeneration: authoritative.certificate_generation,
    serialNumber: authoritative.serial_number,
    // FROM THE DATABASE, computed there over the DER. Not recomputed here, so
    // the value returned is the value that was stored.
    certificateSha256: recorded.certificate_sha256 ?? "",
    certificatePem: leafPem,
    chainPem,
    publicKeyAlgorithm: OPERATIONAL_KEY_ALGORITHM,
    notBefore: authoritative.not_before.toISOString(),
    notAfter: authoritative.not_after.toISOString(),
  };
}
