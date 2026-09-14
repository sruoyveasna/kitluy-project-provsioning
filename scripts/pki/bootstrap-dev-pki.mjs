#!/usr/bin/env node
/**
 * Create the persistent DEVELOPMENT PKI, once.
 *
 * Authority: owner Decision 3 (2026-08-24) — "Create an explicit DEVELOPMENT PKI
 * bootstrap/setup mechanism"; KLD-2026-07-28-002 (BLK-005) — development
 * certificate implementation AUTHORIZED, pilot and production BLOCKED.
 *
 *   node scripts/pki/bootstrap-dev-pki.mjs --dir ../../local-config/het-kitluy-project/dev-pki
 *
 * ===========================================================================
 * WHAT THIS EXISTS TO PREVENT
 * ===========================================================================
 * `DevelopmentCertificateAuthority` mints a CA in its constructor, so every
 * service restart produced a new root and a new intermediate and orphaned every
 * certificate issued before it. A signer that forgets who it is cannot be the
 * basis of mutual TLS between a Hub and a till.
 *
 * So the CA identity is created HERE, deliberately, once, by a person — and
 * every issuing process afterwards LOADS it.
 *
 * ===========================================================================
 * WHY IT REFUSES MORE THAN IT DOES
 * ===========================================================================
 * Regenerating a root that certificates already chain to is indistinguishable,
 * from a device's point of view, from an attacker substituting the CA. So:
 *
 *   * an existing file is NEVER overwritten — the script stops and says which;
 *   * `--force` does not exist, because the safe recovery is a NEW directory and
 *     a deliberate re-issue, not a silent replacement;
 *   * the directory is created 0700 and the private keys 0600, then VERIFIED
 *     after writing rather than assumed from the create flags;
 *   * it refuses to write anywhere inside this repository, checked by real path,
 *     so development CA material cannot be committed by accident;
 *   * every artifact is stamped `NON-PRODUCTION` in its subject, so a leaked
 *     certificate announces what it is.
 *
 * The root signs the intermediate exactly once, here. Nothing else ever holds
 * the root key.
 *
 * DEVELOPMENT ONLY. This is not a custody ceremony, there is no HSM, and no
 * artifact it produces is production-eligible.
 */
import { mkdirSync, existsSync, writeFileSync, chmodSync, statSync, realpathSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { generateKeyPairSync, createHash, sign as edSign, randomUUID } from "node:crypto";

const require = createRequire(import.meta.url);
const forge = require("node-forge");

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const KEY_BITS = 2048;
/** Long enough that a development chain is not a weekly chore. */
const ROOT_YEARS = 10;
const INTERMEDIATE_YEARS = 5;

const FILES = {
  // X.509, for Hub LAN mutual TLS.
  rootCertificate: "dev-root-ca.crt.pem",
  rootKey: "dev-root-ca.key.pem",
  intermediateCertificate: "dev-device-issuing-ca.crt.pem",
  intermediateKey: "dev-device-issuing-ca.key.pem",
  // The CANONICAL KitLuy credential chain, which is deliberately NOT X.509
  // (`CREDENTIAL_IS_NOT_X509`): Ed25519 over a canonical JSON to-be-signed
  // structure. `runGovernedIssuance` signs with this one; TLS uses the other.
  // Two chains because they are two different credentials, not because
  // anything is duplicated.
  canonicalRootKey: "dev-canonical-root.key.pem",
  canonicalIntermediateKey: "dev-canonical-intermediate.key.pem",
  canonicalChain: "dev-canonical-chain.json",
  // RELEASE SIGNING — a THIRD key, and a separate one on purpose.
  //
  // KLD-2026-07-28-002 §1 requires the six signing purposes to stay separate:
  // "a key used for one purpose must not be reused for another". Release
  // manifests are `release_signing`; the two chains above are device identity
  // and TLS. Reusing either of them here would collapse a separation the owner
  // decision names explicitly, so this key signs release manifests and nothing
  // else, and the trust record beside it SAYS so — the device refuses a key
  // whose declared purpose is not `release_signing` (U1 requirement §12).
  releaseSigningKey: "dev-release-signing.key.pem",
  releaseSigningPublicKey: "dev-release-signing.pub.pem",
  releaseSigningTrustRecord: "dev-release-signing.json",
};

/** Bumped only when a release-signing key is deliberately replaced. */
const RELEASE_SIGNING_KEY_VERSION = 1;

function die(message) {
  console.error(`REFUSED: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  let dir = process.env.KITLUY_DEV_PKI_DIR ?? "";
  // ADD THE RELEASE KEY TO AN EXISTING PKI, without touching the CA.
  //
  // The release-signing key arrived with U1, after development PKIs had already
  // been created. Regenerating the whole directory to get one new key would
  // orphan every certificate already chained to the existing root — precisely
  // what the never-overwrite rule exists to prevent. So this mode mints ONLY
  // the release key, and still refuses if that key is already there.
  let releaseKeyOnly = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dir") {
      dir = argv[i + 1] ?? "";
      i += 1;
    } else if (argv[i] === "--release-key-only") {
      releaseKeyOnly = true;
    }
  }
  if (dir.trim() === "") {
    die("no directory given. Pass --dir <path> or set KITLUY_DEV_PKI_DIR.");
  }
  return { directory: resolve(dir.trim()), releaseKeyOnly };
}

/**
 * Refuse anywhere inside the repository.
 *
 * Resolved through `realpathSync` on the nearest existing ancestor so a symlink
 * pointing back into the tree is caught too — the check has to survive someone
 * being clever, not just someone being careless.
 */
function assertOutsideRepository(directory) {
  let probe = directory;
  while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
  const real = realpathSync(probe);
  const repo = realpathSync(REPO_ROOT);
  if (real === repo || real.startsWith(`${repo}/`)) {
    die(
      `${directory} resolves inside the repository (${repo}). Development CA private keys must live outside it — the convention is ../../local-config/het-kitluy-project/dev-pki.`,
    );
  }
}

/**
 * ASCII ONLY, and that is a correctness requirement rather than a style choice.
 *
 * The first version of this script put a typographic em-dash in the common name.
 * forge encoded the DN as a PrintableString, which permits neither an em-dash nor
 * any other non-ASCII byte, and produced a certificate that BOTH `openssl verify`
 * and Node's `X509Certificate` rejected with "bad base64 decode" — a message that
 * points at the encoding and not at the character that caused it.
 *
 * Rejected by two independent parsers is exactly the outcome to want from a bad
 * DN; the lesson is that a certificate subject is a wire format, not prose.
 */
function subject(commonName) {
  const ascii = /^[\x20-\x7e]+$/;
  for (const value of [commonName, "KitLuy Suite", "NON-PRODUCTION development PKI"]) {
    if (!ascii.test(value)) {
      die(
        `subject value ${JSON.stringify(value)} contains a non-ASCII character; an X.509 PrintableString cannot carry it`,
      );
    }
  }
  return [
    { name: "commonName", value: commonName },
    { name: "organizationName", value: "KitLuy Suite" },
    { name: "organizationalUnitName", value: "NON-PRODUCTION development PKI" },
  ];
}

function validity(certificate, years) {
  certificate.validity.notBefore = new Date();
  const notAfter = new Date();
  notAfter.setFullYear(notAfter.getFullYear() + years);
  certificate.validity.notAfter = notAfter;
}

function main() {
  const { directory, releaseKeyOnly } = parseArgs(process.argv.slice(2));
  assertOutsideRepository(directory);

  const paths = Object.fromEntries(
    Object.entries(FILES).map(([key, name]) => [key, join(directory, name)]),
  );
  const RELEASE_KEYS = new Set([
    "releaseSigningKey",
    "releaseSigningPublicKey",
    "releaseSigningTrustRecord",
  ]);
  // In release-key-only mode the CA files are EXPECTED to exist; only the three
  // release files must not.
  const guarded = releaseKeyOnly
    ? Object.entries(paths).filter(([key]) => RELEASE_KEYS.has(key))
    : Object.entries(paths);
  for (const [key, path] of guarded) {
    if (existsSync(path)) {
      die(
        `${path} already exists (${key}). This script never overwrites CA material: replacing a root that certificates already chain to is indistinguishable, to a device, from an attacker substituting the CA. Use a NEW directory and re-issue deliberately.`,
      );
    }
  }

  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);

  const write = (path, contents, mode) => {
    writeFileSync(path, contents, { mode });
    chmodSync(path, mode);
    const actual = statSync(path).mode & 0o777;
    if (actual !== mode) {
      die(`${path} was written but is mode ${actual.toString(8)}, expected ${mode.toString(8)}`);
    }
  };

  const edKeyPair = (label) => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const fingerprint = createHash("sha256")
      .update(publicKey.export({ type: "spki", format: "der" }))
      .digest("hex");
    return { label, publicKeyPem, privateKeyPem, privateKey, fingerprint };
  };

  const mintReleaseSigningKey = () => {
    console.log("[dev-pki] generating the release-signing key (purpose: release_signing)");
    const signing = edKeyPair("release-signing");
    write(paths.releaseSigningKey, signing.privateKeyPem, 0o600);
    write(paths.releaseSigningPublicKey, signing.publicKeyPem, 0o644);
    write(
      paths.releaseSigningTrustRecord,
      `${JSON.stringify(
        {
          kind: "kitluy.release-trust-key.v1",
          keyId: signing.fingerprint,
          keyVersion: RELEASE_SIGNING_KEY_VERSION,
          algorithm: "ed25519",
          purpose: "release_signing",
          environment: "development",
          productionEligible: false,
          state: "current",
          publicKeyPem: signing.publicKeyPem,
        },
        null,
        2,
      )}\n`,
      0o644,
    );
    console.log("");
    console.log(
      `[dev-pki]   release signing  ${signing.fingerprint} (v${RELEASE_SIGNING_KEY_VERSION})`,
    );
    console.log(
      "[dev-pki] The PUBLIC record is the trust anchor an image carries — never the key:",
    );
    console.log(`[dev-pki]   ${paths.releaseSigningTrustRecord}`);
    return signing;
  };

  if (releaseKeyOnly) {
    if (!existsSync(paths.rootCertificate)) {
      die(`${directory} has no development CA. Create one first without --release-key-only.`);
    }
    mintReleaseSigningKey();
    return;
  }

  console.log(`[dev-pki] generating a ${KEY_BITS}-bit root (this takes a moment)`);
  const rootKeys = forge.pki.rsa.generateKeyPair(KEY_BITS);
  const root = forge.pki.createCertificate();
  root.publicKey = rootKeys.publicKey;
  root.serialNumber = `01${forge.util.bytesToHex(forge.random.getBytesSync(8))}`;
  validity(root, ROOT_YEARS);
  root.setSubject(subject("KitLuy Development Root CA NON-PRODUCTION"));
  root.setIssuer(subject("KitLuy Development Root CA NON-PRODUCTION"));
  root.setExtensions([
    { name: "basicConstraints", cA: true, critical: true },
    { name: "keyUsage", keyCertSign: true, cRLSign: true, critical: true },
    { name: "subjectKeyIdentifier" },
  ]);
  // Self-signed, and this is the ONLY time the root key signs anything other
  // than the intermediate below.
  root.sign(rootKeys.privateKey, forge.md.sha256.create());

  console.log(`[dev-pki] generating the device-issuing intermediate`);
  const intermediateKeys = forge.pki.rsa.generateKeyPair(KEY_BITS);
  const intermediate = forge.pki.createCertificate();
  intermediate.publicKey = intermediateKeys.publicKey;
  intermediate.serialNumber = `02${forge.util.bytesToHex(forge.random.getBytesSync(8))}`;
  validity(intermediate, INTERMEDIATE_YEARS);
  intermediate.setSubject(subject("KitLuy Development Device Issuing CA NON-PRODUCTION"));
  intermediate.setIssuer(root.subject.attributes);
  intermediate.setExtensions([
    // pathLenConstraint 0: the intermediate may sign leaves and NEVER another
    // CA, so a compromised device certificate cannot become an issuer.
    { name: "basicConstraints", cA: true, pathLenConstraint: 0, critical: true },
    { name: "keyUsage", keyCertSign: true, cRLSign: true, critical: true },
    { name: "subjectKeyIdentifier" },
  ]);
  intermediate.sign(rootKeys.privateKey, forge.md.sha256.create());

  // Certificates are public. Keys are 0600 and verified after writing, because
  // an umask or a filesystem can disagree with the create flag.
  write(paths.rootCertificate, forge.pki.certificateToPem(root), 0o644);
  write(paths.rootKey, forge.pki.privateKeyToPem(rootKeys.privateKey), 0o600);
  write(paths.intermediateCertificate, forge.pki.certificateToPem(intermediate), 0o644);
  write(paths.intermediateKey, forge.pki.privateKeyToPem(intermediateKeys.privateKey), 0o600);

  // ===========================================================================
  // THE CANONICAL KITLUY CHAIN — Ed25519, persisted, and STABLE.
  // ===========================================================================
  // `DevelopmentCertificateAuthority` builds this chain in its constructor with
  // `randomUUID()` and `new Date()`, so every process produced a different root
  // and orphaned every credential signed before it. Persisting the KEYS alone
  // would not fix that: the certificates themselves carry a certificateId, a
  // serial and a validity window that are part of the signed bytes, so they are
  // written here too and loaded verbatim afterwards.
  console.log("[dev-pki] generating the canonical Ed25519 credential chain");

  const edKey = (label) => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    // Fingerprint EXACTLY as @kitluy/device-identity computes it: SHA-256 over
    // the DER SPKI. A different spelling here would break every comparison.
    const fingerprint = createHash("sha256")
      .update(publicKey.export({ type: "spki", format: "der" }))
      .digest("hex");
    return { label, publicKeyPem, privateKeyPem, privateKey, fingerprint };
  };

  // Mirrors `tbsBytes` in packages/device-identity/src/dev-crypto.ts. Field
  // order and the "kitluy.cert.v1" lead are part of the signature; they are not
  // formatting.
  const tbsBytes = (tbs) =>
    Buffer.from(
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

  const canonicalRoot = edKey("canonical-root");
  const canonicalIntermediate = edKey("canonical-intermediate");
  const notBefore = new Date();
  const canonicalNotAfter = new Date();
  canonicalNotAfter.setFullYear(canonicalNotAfter.getFullYear() + ROOT_YEARS);

  const makeTbs = (subject, role, issuerKeyId) => ({
    certificateId: randomUUID(),
    serialNumber: `DEV-${role.toUpperCase()}-${randomUUID()}`,
    role,
    purpose: "device_identity",
    environment: "development",
    subjectFingerprint: subject.fingerprint,
    subjectPublicKeyPem: subject.publicKeyPem,
    issuerKeyId,
    deviceRecordId: null,
    certificateGeneration: null,
    hardwareTrustLevel: null,
    productionEligible: false,
    notBefore: notBefore.toISOString(),
    notAfter: canonicalNotAfter.toISOString(),
  });

  const rootTbs = makeTbs(canonicalRoot, "root", canonicalRoot.fingerprint);
  const intermediateTbs = makeTbs(canonicalIntermediate, "intermediate", canonicalRoot.fingerprint);
  // The root signs itself and the intermediate, and never a device. That
  // restriction is structural in the provider, not enforced by a runtime check.
  const canonicalChain = {
    kind: "kitluy.dev-canonical-chain.v1",
    environment: "development",
    productionEligible: false,
    rootKeyId: canonicalRoot.fingerprint,
    intermediateKeyId: canonicalIntermediate.fingerprint,
    rootCertificate: {
      tbs: rootTbs,
      signatureB64: Buffer.from(edSign(null, tbsBytes(rootTbs), canonicalRoot.privateKey)).toString(
        "base64",
      ),
    },
    intermediateCertificate: {
      tbs: intermediateTbs,
      signatureB64: Buffer.from(
        edSign(null, tbsBytes(intermediateTbs), canonicalRoot.privateKey),
      ).toString("base64"),
    },
  };

  write(paths.canonicalRootKey, canonicalRoot.privateKeyPem, 0o600);
  write(paths.canonicalIntermediateKey, canonicalIntermediate.privateKeyPem, 0o600);
  // Public material only: two TBS structures and their signatures. No key.
  write(paths.canonicalChain, `${JSON.stringify(canonicalChain, null, 2)}\n`, 0o644);

  const releaseSigning = mintReleaseSigningKey();

  const fingerprint = (certificate) =>
    forge.md.sha256
      .create()
      .update(forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes())
      .digest()
      .toHex();

  console.log("");
  console.log("[dev-pki] DEVELOPMENT PKI created. NON-PRODUCTION, no custody ceremony, no HSM.");
  console.log(`[dev-pki]   directory     ${directory}  (0700)`);
  console.log(`[dev-pki]   root          ${fingerprint(root)}`);
  console.log(`[dev-pki]   issuing CA    ${fingerprint(intermediate)}`);
  console.log(`[dev-pki]   canonical root        ${canonicalRoot.fingerprint}`);
  console.log(`[dev-pki]   canonical intermediate ${canonicalIntermediate.fingerprint}`);
  console.log(
    `[dev-pki]   release signing       ${releaseSigning.fingerprint} (v${RELEASE_SIGNING_KEY_VERSION}, purpose release_signing)`,
  );
  console.log("");
  console.log("[dev-pki] The release trust anchor a Pi Terminal image must carry is the PUBLIC");
  console.log("[dev-pki] record beside it — never the key:");
  console.log(`[dev-pki]   ${join(directory, FILES.releaseSigningTrustRecord)}`);
  console.log("");
  console.log("[dev-pki] Point the issuing service at it and keep it out of every image:");
  console.log(`[dev-pki]   export KITLUY_DEV_PKI_DIR=${directory}`);
  console.log("");
  console.log("[dev-pki] The private keys are NOT printed and must never be. Back the directory");
  console.log("[dev-pki] up the way you back up ../../local-config — outside the repository.");
}

main();
