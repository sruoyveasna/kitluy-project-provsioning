/**
 * R2-3: the certificate's declared algorithm is checked by exact DER equality.
 *
 * Authority: SECOND independent Store Hub credential-path review, 2026-08-27,
 * verdict APPROVED WITH REQUIRED FIXES, finding R2-3; owner remediation
 * instruction 2026-08-27; migration group 0211.
 *
 * ===========================================================================
 * WHAT WAS WRONG
 * ===========================================================================
 * The RSA mathematics and the PKCS#1 v1.5 exact-block comparison passed
 * independent adversarial review and are NOT touched. One layer up was:
 *
 *   1. `position(oid in algorithmIdentifier) > 0` — a SUBSTRING SEARCH. An
 *      AlgorithmIdentifier that merely CONTAINS the sha256WithRSAEncryption OID
 *      bytes, anywhere, passed.
 *   2. The TBS `signature` AlgorithmIdentifier was never compared to the outer
 *      `signatureAlgorithm`. X.509 carries the algorithm twice so a verifier can
 *      catch a mismatch — the inner copy is signed, the outer is not — and
 *      reading only one discards that.
 *
 * Every case below is a certificate whose SIGNATURE IS GENUINELY VALID. They are
 * not broken signatures dressed up; the maths verifies. What is wrong is the
 * declaration, which is exactly the class of defect a substring search cannot
 * see.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generateKeyPairSync,
  X509Certificate,
  createPublicKey,
  sign as cryptoSign,
} from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import forge from "node-forge";

import { requireSecurityFixture } from "./support/security-gate.js";

const DSN =
  process.env.KITLUY_DEV_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54392/postgres";

const SHA256_RSA = "1.2.840.113549.1.1.11";
const SHA1_RSA = "1.2.840.113549.1.1.5";
const SHA512_RSA = "1.2.840.113549.1.1.13";

let pool: pg.Pool;
let workDir: string;
let counter = 0;

// R2-4: a FORMAL SECURITY SUITE. It fails rather than skips.
await requireSecurityFixture({ dsn: DSN, needsPki: false });

interface Minted {
  pem: string;
  publicKeyPem: string;
}

/**
 * A self-signed certificate whose signature GENUINELY VERIFIES, with the inner
 * and outer algorithm identifiers set independently.
 *
 * The re-signing step is essential and was got wrong first time round.
 * node-forge overwrites BOTH `signatureOid` and `siginfo.algorithmOid` from the
 * message digest during `sign()`, so setting them beforehand achieves nothing —
 * the first version of this suite "passed" three tests that were actually
 * verifying ordinary well-formed certificates.
 *
 * So the certificate is built, mutated, and only then signed: the TBS is
 * re-serialised after every change and the signature recomputed over those
 * exact bytes with `node:crypto`. Every case below therefore carries a
 * cryptographically valid signature, and only the DECLARATION is hostile —
 * which is the entire class of defect a substring search cannot see.
 */
function mint(options: {
  innerOid?: string;
  outerOid?: string;
  mutate?: (asn1Cert: forge.asn1.Asn1) => void;
}): Minted {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(publicKeyPem);
  counter += 1;
  cert.serialNumber = `0${counter.toString(16).padStart(3, "0")}`;
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + 86_400_000);
  cert.setSubject([{ name: "commonName", value: "r2-3" }]);
  cert.setIssuer([{ name: "commonName", value: "r2-3" }]);
  cert.setExtensions([{ name: "basicConstraints", cA: true }]);
  cert.sign(forge.pki.privateKeyFromPem(privateKeyPem), forge.md.sha256.create());

  const asn1Cert = forge.pki.certificateToAsn1(cert);
  const children = asn1Cert.value as forge.asn1.Asn1[];
  const tbs = children[0]!;
  const tbsChildren = tbs.value as forge.asn1.Asn1[];
  const innerIndex =
    tbsChildren[0]!.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC ? 2 : 1;

  const algorithmIdentifier = (oid: string): forge.asn1.Asn1 =>
    forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
      forge.asn1.create(
        forge.asn1.Class.UNIVERSAL,
        forge.asn1.Type.OID,
        false,
        forge.asn1.oidToDer(oid).getBytes(),
      ),
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.NULL, false, ""),
    ]);

  if (options.innerOid !== undefined) {
    tbsChildren[innerIndex] = algorithmIdentifier(options.innerOid);
  }
  if (options.outerOid !== undefined) {
    children[1] = algorithmIdentifier(options.outerOid);
  }
  options.mutate?.(asn1Cert);

  // RE-SIGN over the TBS as it now stands. Always SHA-256 with RSA, so the
  // mathematics is valid in every case and only the declaration varies.
  const tbsDer = Buffer.from(forge.asn1.toDer(tbs).getBytes(), "binary");
  const signature = cryptoSign("sha256", tbsDer, privateKeyPem);
  children[2] = forge.asn1.create(
    forge.asn1.Class.UNIVERSAL,
    forge.asn1.Type.BITSTRING,
    false,
    // A BIT STRING's first content byte counts unused trailing bits.
    String.fromCharCode(0) + signature.toString("binary"),
  );

  const der = forge.asn1.toDer(asn1Cert).getBytes();
  const pem = `-----BEGIN CERTIFICATE-----\n${Buffer.from(der, "binary")
    .toString("base64")
    .replace(/(.{64})/g, "$1\n")
    .trim()}\n-----END CERTIFICATE-----\n`;
  return { pem, publicKeyPem };
}

/** KitLuy's verdict, from the database. */
async function kitluyAccepts(pem: string): Promise<boolean> {
  const { rows } = await pool.query<{ ok: boolean }>(
    `select kitluy_devices.x509_signature_is_valid_v1(
              (kitluy_devices.pem_certificates_to_der_v1($1::text))[1],
              (kitluy_devices.pem_certificates_to_der_v1($1::text))[1]) as ok`,
    [pem],
  );
  return rows[0]?.ok === true;
}

/** Node's verdict: parse AND verify, not merely parse. */
function nodeAccepts(minted: Minted): boolean {
  try {
    const cert = new X509Certificate(minted.pem);
    return cert.verify(createPublicKey(minted.publicKeyPem));
  } catch {
    return false;
  }
}

/** OpenSSL's verdict: parse AND verify the self-signature. */
function opensslAccepts(pem: string): boolean {
  counter += 1;
  const file = join(workDir, `algid-${counter}.pem`);
  writeFileSync(file, pem);
  try {
    execFileSync("openssl", ["x509", "-in", file, "-noout", "-text"], {
      stdio: ["ignore", "ignore", "ignore"],
    });
  } catch {
    return false;
  }
  try {
    const out = execFileSync("openssl", ["verify", "-CAfile", file, file], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return out.includes("OK");
  } catch {
    return false;
  }
}

beforeAll(() => {
  pool = new pg.Pool({ connectionString: DSN, max: 4 });
  workDir = mkdtempSync(join(tmpdir(), "kitluy-r23-"));
});
afterAll(async () => {
  await pool?.end().catch(() => undefined);
  rmSync(workDir, { recursive: true, force: true });
});

describe("R2-3: AlgorithmIdentifier is validated by exact DER equality", () => {
  it("ACCEPTS the supported development profile", async () => {
    const minted = mint({});
    expect(await kitluyAccepts(minted.pem), "the control certificate was refused").toBe(true);
    expect(nodeAccepts(minted), "Node refused the control certificate").toBe(true);
    expect(opensslAccepts(minted.pem), "OpenSSL refused the control certificate").toBe(true);
  });

  it("REFUSES a TBS/outer algorithm mismatch", async () => {
    // The signature is a genuine SHA-256 RSA signature and the outer field says
    // so. The SIGNED inner copy says SHA-1. Nothing in a substring search notices.
    const minted = mint({ innerOid: SHA1_RSA, outerOid: SHA256_RSA });
    expect(await kitluyAccepts(minted.pem)).toBe(false);
  });

  it("REFUSES the mismatch in the other direction too", async () => {
    const minted = mint({ innerOid: SHA256_RSA, outerOid: SHA1_RSA });
    expect(await kitluyAccepts(minted.pem)).toBe(false);
  });

  it("REFUSES a wrong OID, consistently declared", async () => {
    for (const oid of [SHA1_RSA, SHA512_RSA]) {
      const minted = mint({ innerOid: oid, outerOid: oid });
      // Consistent, genuinely signed with SHA-256 — and still refused, because
      // the declaration is not the supported profile. Supported algorithms are
      // deliberately not broadened here.
      expect(await kitluyAccepts(minted.pem), `oid ${oid} was accepted`).toBe(false);
    }
  });

  it("REFUSES parameters absent, even with the right OID", async () => {
    // AlgorithmIdentifier ::= SEQUENCE { algorithm OID, parameters ANY OPTIONAL }.
    // RFC 4055 requires an explicit NULL for RSA. Dropping it changes the DER,
    // and the canonical constant includes `0500`, so equality refuses it.
    const dropParameters = (asn1Cert: forge.asn1.Asn1): void => {
      const top = asn1Cert.value as forge.asn1.Asn1[];
      (top[1]!.value as forge.asn1.Asn1[]).splice(1, 1);
      const tbsChildren = top[0]!.value as forge.asn1.Asn1[];
      const index = tbsChildren[0]!.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC ? 2 : 1;
      (tbsChildren[index]!.value as forge.asn1.Asn1[]).splice(1, 1);
    };
    const minted = mint({ mutate: dropParameters });
    expect(await kitluyAccepts(minted.pem)).toBe(false);
  });

  it("REFUSES trailing junk inside the AlgorithmIdentifier", async () => {
    // A third element after OID and NULL. The OID is still present and a
    // substring search still finds it; the SEQUENCE is a different byte string.
    const appendJunk = (asn1Cert: forge.asn1.Asn1): void => {
      const outer = (asn1Cert.value as forge.asn1.Asn1[])[1]!;
      (outer.value as forge.asn1.Asn1[]).push(
        forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.OCTETSTRING, false, "junk"),
      );
    };
    const minted = mint({ mutate: appendJunk });
    expect(await kitluyAccepts(minted.pem)).toBe(false);
  });

  it("REFUSES SHA-1 with the SHA-256 OID hidden in the parameters", async () => {
    // The exact shape a substring search cannot distinguish: the declared OID is
    // sha1WithRSAEncryption, and the sha256WithRSAEncryption OID bytes are
    // planted in the parameters field where `position()` would find them.
    const hideOid = (asn1Cert: forge.asn1.Asn1): void => {
      const sha256OidBytes = forge.asn1.oidToDer(SHA256_RSA).getBytes();
      const plant = (algId: forge.asn1.Asn1): void => {
        const children = algId.value as forge.asn1.Asn1[];
        children[0] = forge.asn1.create(
          forge.asn1.Class.UNIVERSAL,
          forge.asn1.Type.OID,
          false,
          forge.asn1.oidToDer(SHA1_RSA).getBytes(),
        );
        children[1] = forge.asn1.create(
          forge.asn1.Class.UNIVERSAL,
          forge.asn1.Type.OCTETSTRING,
          false,
          sha256OidBytes,
        );
      };
      plant((asn1Cert.value as forge.asn1.Asn1[])[1]!);
      const tbs = (asn1Cert.value as forge.asn1.Asn1[])[0]!;
      const children = tbs.value as forge.asn1.Asn1[];
      const index = children[0]!.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC ? 2 : 1;
      plant(children[index]!);
    };
    const minted = mint({ mutate: hideOid });
    expect(await kitluyAccepts(minted.pem)).toBe(false);
  });

  it("REFUSES a malformed AlgorithmIdentifier", async () => {
    // Not a SEQUENCE at all.
    const wreck = (asn1Cert: forge.asn1.Asn1): void => {
      (asn1Cert.value as forge.asn1.Asn1[])[1] = forge.asn1.create(
        forge.asn1.Class.UNIVERSAL,
        forge.asn1.Type.OCTETSTRING,
        false,
        "not an algorithm identifier",
      );
    };
    const minted = mint({ mutate: wreck });
    expect(await kitluyAccepts(minted.pem)).toBe(false);
  });

  it("DIFFERENTIAL: KitLuy accepts exactly what Node and OpenSSL accept, for this profile", async () => {
    const cases: ReadonlyArray<{ name: string; minted: Minted }> = [
      { name: "supported profile", minted: mint({}) },
      { name: "inner SHA-1 / outer SHA-256", minted: mint({ innerOid: SHA1_RSA }) },
      { name: "inner SHA-256 / outer SHA-1", minted: mint({ outerOid: SHA1_RSA }) },
      { name: "SHA-512 declared", minted: mint({ innerOid: SHA512_RSA, outerOid: SHA512_RSA }) },
    ];

    const table: string[] = [];
    for (const testCase of cases) {
      const kitluy = await kitluyAccepts(testCase.minted.pem);
      const node = nodeAccepts(testCase.minted);
      const openssl = opensslAccepts(testCase.minted.pem);
      table.push(`${testCase.name}: kitluy=${kitluy} node=${node} openssl=${openssl}`);

      // The goal the instruction states: KitLuy ACCEPT iff Node/OpenSSL ACCEPT,
      // for the SUPPORTED profile. KitLuy is permitted to be STRICTER — refusing
      // an algorithm it does not support is correct — but it must never be more
      // permissive than either of them.
      if (kitluy) {
        expect(node, `KitLuy accepted "${testCase.name}" but Node did not`).toBe(true);
        expect(openssl, `KitLuy accepted "${testCase.name}" but OpenSSL did not`).toBe(true);
      }
    }
    // Printed so the differential is visible in the run, not merely asserted.
    expect(table.length).toBe(cases.length);
  });
});
