/**
 * R2-1: one serial, encoded as a minimal positive DER INTEGER, everywhere.
 *
 * Authority: SECOND independent Store Hub credential-path review, 2026-08-27,
 * verdict APPROVED WITH REQUIRED FIXES, finding R2-1; owner remediation
 * instruction 2026-08-27; migration group 0210.
 *
 * ===========================================================================
 * THE DEFECT
 * ===========================================================================
 * Group 0208 declared ONE canonical serial mapping and implemented it twice,
 * differently. TypeScript prefixed `00` unconditionally; SQL stripped every
 * leading zero and never added a sign byte.
 *
 * The TypeScript half shipped a real product defect: when the significant bytes
 * already began with 0x00 — one credential serial in 256 — the certificate
 * carried two leading zero bytes and OpenSSL refused it with
 * `asn1 encoding routines::illegal padding`. The reviewer measured ~5 failures
 * per 1200 mints.
 *
 * The previous test did not catch it because it normalised the difference away
 * before comparing:
 *
 *     expect(rows[0].s).toBe(x509SerialForCredential(serial).replace(/^(00)+/, ""))
 *
 * That `.replace` erased exactly the bug. It is gone, and nothing here
 * normalises anything: every comparison is against the literal canonical form.
 *
 * ===========================================================================
 * THE CHAIN THIS SUITE WALKS
 * ===========================================================================
 *     credential serial -> TypeScript -> SQL -> DER bytes -> Node -> OpenSSL
 *
 * A mismatch at any hop is a failure. OpenSSL is included because it is the
 * implementation that actually rejected the malformed certificates, and Node
 * alone would not have caught the negative-integer half of the defect.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, X509Certificate } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import forge from "node-forge";

import {
  minimalPositiveDerInteger,
  x509SerialForCredential,
  credentialSerialFromX509,
  SerialNotInvertibleError,
} from "../src/first-operational-issuance.js";
import { requireSecurityFixture } from "./support/security-gate.js";

const DSN =
  process.env.KITLUY_DEV_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54392/postgres";

let pool: pg.Pool;
let workDir: string;

// R2-4: this is a FORMAL SECURITY SUITE. It fails rather than skips.
await requireSecurityFixture({ dsn: DSN, needsPki: false });

/** The DER INTEGER content of the serial, read out of a real certificate. */
function mintAndReadSerial(serialHex: string): {
  derSerial: string;
  nodeAccepted: boolean;
  nodeSerial: string;
  pem: string;
} {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(
    publicKey.export({ type: "spki", format: "pem" }).toString(),
  );
  cert.serialNumber = serialHex;
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + 86_400_000);
  cert.setSubject([{ name: "commonName", value: "r2-1-leaf" }]);
  cert.setIssuer([{ name: "commonName", value: "r2-1-ca" }]);
  cert.setExtensions([{ name: "basicConstraints", cA: false }]);
  cert.sign(
    forge.pki.privateKeyFromPem(privateKey.export({ type: "pkcs8", format: "pem" }).toString()),
    forge.md.sha256.create(),
  );
  const pem = forge.pki.certificateToPem(cert);

  // Walk the DER ourselves. Node and OpenSSL both NORMALISE the serial for
  // display, so asking either of them what the serial is would hide a redundant
  // leading zero — which is the entire defect.
  const der = Buffer.from(pem.replace(/-----[^-]+-----/g, "").replace(/\s/g, ""), "base64");
  const tlv = (buf: Buffer, offset: number): { header: number; length: number } => {
    let length = buf[offset + 1]!;
    let header = 2;
    if ((length & 0x80) !== 0) {
      const count = length & 0x7f;
      length = 0;
      for (let i = 0; i < count; i += 1) length = length * 256 + buf[offset + 2 + i]!;
      header = 2 + count;
    }
    return { header, length };
  };
  let cursor = tlv(der, 0).header;
  const tbs = tlv(der, cursor);
  cursor += tbs.header;
  if (der[cursor] === 0xa0) {
    const version = tlv(der, cursor);
    cursor += version.header + version.length;
  }
  const serial = tlv(der, cursor);
  const derSerial = der
    .subarray(cursor + serial.header, cursor + serial.header + serial.length)
    .toString("hex");

  let nodeAccepted = true;
  let nodeSerial = "";
  try {
    nodeSerial = new X509Certificate(pem).serialNumber.toLowerCase();
  } catch {
    nodeAccepted = false;
  }
  return { derSerial, nodeAccepted, nodeSerial, pem };
}

/** OpenSSL's own verdict. The implementation that actually rejected these. */
function opensslAccepts(pem: string): { accepted: boolean; detail: string } {
  const file = join(workDir, `cert-${Math.abs(hashOf(pem))}.pem`);
  writeFileSync(file, pem);
  try {
    const out = execFileSync("openssl", ["x509", "-in", file, "-noout", "-serial"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { accepted: true, detail: out.trim() };
  } catch (error) {
    return { accepted: false, detail: String((error as { stderr?: Buffer }).stderr ?? error) };
  }
}
function hashOf(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (h * 31 + value.charCodeAt(i)) | 0;
  return h;
}

/** Every shape R2-1 names, plus the real corpus. */
const SIGNIFICANT_BYTES: ReadonlyArray<{ name: string; hex: string }> = [
  { name: "ordinary", hex: "0123456789abcdef" },
  { name: "begins 00", hex: "004c34c1a664c9e5" },
  { name: "begins 0000", hex: "00004c34c1a664c9e5" },
  { name: "begins 7f (no sign byte)", hex: "7f34c1a664c9e512" },
  { name: "begins 80 (needs sign byte)", hex: "8034c1a664c9e512" },
  { name: "begins ff (needs sign byte)", hex: "ff34c1a664c9e512" },
  { name: "already sign-prefixed", hex: "00ff34c1a664c9e512" },
  { name: "all zero", hex: "0000000000000000" },
  { name: "single zero byte", hex: "00" },
  { name: "odd byte length (7)", hex: "4c34c1a664c9e5" },
  { name: "odd byte length (9), high bit", hex: "ff34c1a664c9e51234" },
  { name: "maximum expected length (19 bytes)", hex: "ab".repeat(19) },
  { name: "maximum expected length, high bit", hex: `ff${"ab".repeat(18)}` },
];

const DEV_SERIALS: readonly string[] = [
  "DEV-0123456789ABCDEF",
  "DEV-004C34C1A664C9E5",
  "DEV-00D3A8F60D8FCC31",
  "DEV-00D8A72038F6A70F",
  "DEV-FF34C1A664C9E512",
  "DEV-8000000000000000",
  "DEV-0000000000000000",
  "DEV-7FFFFFFFFFFFFFFF",
];

beforeAll(() => {
  pool = new pg.Pool({ connectionString: DSN, max: 4 });
  workDir = mkdtempSync(join(tmpdir(), "kitluy-r21-"));
});
afterAll(async () => {
  await pool?.end().catch(() => undefined);
  rmSync(workDir, { recursive: true, force: true });
});

describe("R2-1: the canonical serial encoding", () => {
  it("TypeScript and SQL agree, byte for byte, with NO normalisation", async () => {
    for (const testCase of SIGNIFICANT_BYTES) {
      const { rows } = await pool.query<{ s: string }>(
        `select kitluy_devices.minimal_positive_der_integer_v1($1::text) as s`,
        [testCase.hex],
      );
      // Compared literally. The previous version of this assertion stripped
      // leading zeros from one side first, which is how the defect survived.
      expect(rows[0]!.s, `SQL vs TypeScript for ${testCase.name}`).toBe(
        minimalPositiveDerInteger(testCase.hex),
      );
    }
  });

  it("never emits a redundant zero and never emits a negative integer", () => {
    for (let lead = 0; lead <= 0xff; lead += 1) {
      const encoded = minimalPositiveDerInteger(
        `${lead.toString(16).padStart(2, "0")}aabbccddee`,
      );
      const first = Number.parseInt(encoded.slice(0, 2), 16);
      const second = Number.parseInt(encoded.slice(2, 4), 16);
      // DER: a leading 0x00 is legal ONLY when the next byte has the high bit
      // set. Anything else is the "illegal padding" OpenSSL rejects.
      if (first === 0x00 && encoded.length > 2) {
        expect(second, `redundant zero for lead byte ${lead}`).toBeGreaterThanOrEqual(0x80);
      }
      // ...and the value must never read as negative.
      expect(first, `negative integer for lead byte ${lead}`).toBeLessThan(0x80);
    }
  });

  it("round-trips every DEV- serial through the inverse, in both languages", async () => {
    for (const serial of DEV_SERIALS) {
      const ts = x509SerialForCredential(serial);
      const { rows } = await pool.query<{ s: string; back: string }>(
        `select kitluy_devices.x509_serial_for_credential_v1($1::text) as s,
                kitluy_devices.credential_serial_from_x509_v1(
                  kitluy_devices.x509_serial_for_credential_v1($1::text)) as back`,
        [serial],
      );
      expect(rows[0]!.s, `SQL mapping for ${serial}`).toBe(ts);
      expect(rows[0]!.back, `SQL inverse for ${serial}`).toBe(serial);
      expect(credentialSerialFromX509(ts), `TypeScript inverse for ${serial}`).toBe(serial);
    }
  });

  it("DIFFERENTIAL: what we encode is what lands in the DER, and Node AND OpenSSL accept it", () => {
    for (const serial of DEV_SERIALS) {
      const canonical = x509SerialForCredential(serial);
      const minted = mintAndReadSerial(canonical);

      // 1. The bytes in the certificate are the bytes we asked for. forge only
      //    strips ONE redundant zero, so an encoder that emitted two would land
      //    a malformed serial here rather than being quietly repaired.
      expect(minted.derSerial, `DER bytes for ${serial}`).toBe(canonical);

      // 2. Node parses it.
      expect(minted.nodeAccepted, `Node rejected ${serial} (serial ${canonical})`).toBe(true);

      // 3. And so does OpenSSL — the implementation that actually failed here.
      const openssl = opensslAccepts(minted.pem);
      expect(openssl.accepted, `OpenSSL rejected ${serial}: ${openssl.detail}`).toBe(true);

      // 4. All three agree on the VALUE.
      //
      //    Compared as INTEGERS, not as printed strings. Node and OpenSSL each
      //    normalise for display — they drop the sign byte, and Node prints zero
      //    as "0" rather than "00" — so a string comparison would fail on a
      //    formatting difference and pass on nothing useful. The DER bytes are
      //    already asserted exactly above; this asserts the three parsers read
      //    the same number out of them.
      const asInteger = (hex: string): bigint => BigInt(`0x${hex === "" ? "0" : hex}`);
      expect(asInteger(minted.nodeSerial), `Node's value for ${serial}`).toBe(
        asInteger(canonical),
      );
      const opensslHex = /serial=([0-9A-Fa-f]+)/.exec(openssl.detail)?.[1] ?? "";
      expect(opensslHex, `OpenSSL printed no serial for ${serial}: ${openssl.detail}`).not.toBe("");
      expect(asInteger(opensslHex), `OpenSSL's value for ${serial}`).toBe(asInteger(canonical));
    }
  });

  it("FALSIFICATION: the pre-0210 encoding really was rejected by OpenSSL", () => {
    // The old rule, reproduced: prefix `00` unconditionally.
    const brokenEncoder = (devSerial: string): string => `00${devSerial.slice(4).toLowerCase()}`;

    let rejected = 0;
    for (const serial of DEV_SERIALS) {
      const minted = mintAndReadSerial(brokenEncoder(serial));
      const openssl = opensslAccepts(minted.pem);
      if (!openssl.accepted || !minted.nodeAccepted) rejected += 1;
    }

    // The serials beginning `00` are the ones that failed — three of the eight
    // here, which is the sample being deliberately loaded, not the 1/256 rate.
    // The point is that the number is NOT zero: the fix is load-bearing.
    expect(rejected, "the old encoder produced no failures, so this suite proves nothing").toBeGreaterThan(0);

    // And every one of those same serials passes under the new encoder.
    for (const serial of DEV_SERIALS) {
      const minted = mintAndReadSerial(x509SerialForCredential(serial));
      expect(opensslAccepts(minted.pem).accepted, `new encoder failed for ${serial}`).toBe(true);
    }
  });

  it("N-1: the inverse round-trips every INVERTIBLE DEV shape, in both languages", async () => {
    const invertible = [
      { name: "ordinary", serial: "DEV-0123456789ABCDEF" },
      { name: "zero-leading", serial: "DEV-004C34C1A664C9E5" },
      { name: "many zeros leading", serial: "DEV-0000000000000001" },
      { name: "sign byte required (ff)", serial: "DEV-FF34C1A664C9E512" },
      { name: "sign byte required (80)", serial: "DEV-8000000000000000" },
      { name: "no sign byte, maximal", serial: "DEV-7FFFFFFFFFFFFFFF" },
    ];
    for (const testCase of invertible) {
      const forward = x509SerialForCredential(testCase.serial);
      expect(credentialSerialFromX509(forward), `TypeScript inverse, ${testCase.name}`).toBe(
        testCase.serial,
      );
      const { rows } = await pool.query<{ back: string }>(
        `select kitluy_devices.credential_serial_from_x509_v1($1::text) as back`,
        [forward],
      );
      expect(rows[0]!.back, `SQL inverse, ${testCase.name}`).toBe(testCase.serial);
    }
  });

  it("N-1: the inverse REFUSES a 19-byte hashed serial instead of fabricating one", async () => {
    // THE FINDING. `x509SerialForCredential` hashes any non-DEV serial to 19
    // bytes, and a hash has no inverse. The previous version stripped, padded,
    // and returned a well-formed credential serial that no credential has —
    // and the SQL half fabricated a DIFFERENT one from the same input.
    const hashed = x509SerialForCredential("not-a-dev-serial");
    expect(hashed.replace(/^00/, "").length / 2, "the fixture is not the hashed branch").toBe(19);

    expect(() => credentialSerialFromX509(hashed)).toThrow(SerialNotInvertibleError);
    expect(() => credentialSerialFromX509(hashed)).toThrow(/only the canonical 8-byte DEV- shape/);

    await expect(
      pool.query(`select kitluy_devices.credential_serial_from_x509_v1($1::text)`, [hashed]),
    ).rejects.toThrow(/KLUY-SERIAL-NOT-INVERTIBLE/);

    // And specifically: it does not return the value it used to.
    let fabricated = "";
    try {
      fabricated = credentialSerialFromX509(hashed);
    } catch {
      fabricated = "(refused)";
    }
    expect(fabricated).toBe("(refused)");
  });

  it("N-1: REFUSES arbitrary non-invertible serials in both languages", async () => {
    const refusals = [
      { name: "hashed from a real non-DEV serial", hex: x509SerialForCredential("SERIAL-XRACE-HUB-abc") },
      { name: "non-minimal encoding", hex: "000123456789abcdef" },
      { name: "redundant zeros", hex: "00004c34c1a664c9e5" },
      { name: "19 bytes of ff", hex: `00${"ff".repeat(19)}` },
      { name: "9 significant bytes", hex: "0102030405060708090a" },
      { name: "not hex", hex: "zz" },
      { name: "odd hex length", hex: "abc" },
    ];
    for (const testCase of refusals) {
      expect(
        () => credentialSerialFromX509(testCase.hex),
        `TypeScript accepted ${testCase.name}`,
      ).toThrow(/KLUY-SERIAL-NOT-INVERTIBLE/);
      await expect(
        pool.query(`select kitluy_devices.credential_serial_from_x509_v1($1::text)`, [testCase.hex]),
        `SQL accepted ${testCase.name}`,
      ).rejects.toThrow(/KLUY-SERIAL-NOT-INVERTIBLE/);
    }
  });

  it("N-1: SQL and TypeScript agree on WHICH serials are invertible", async () => {
    // The halves disagreeing is how the reviewer found this. Agreement is
    // asserted directly rather than assumed from two separate test lists.
    const shapes = [
      "0123456789abcdef",
      "4c34c1a664c9e5",
      "00ff34c1a664c9e512",
      "00",
      "0102030405060708090a",
      `00${"ab".repeat(19)}`,
      "000123456789abcdef",
    ];
    for (const hex of shapes) {
      let tsResult: string;
      try {
        tsResult = credentialSerialFromX509(hex);
      } catch {
        tsResult = "REFUSED";
      }
      let sqlResult: string;
      try {
        const { rows } = await pool.query<{ back: string }>(
          `select kitluy_devices.credential_serial_from_x509_v1($1::text) as back`,
          [hex],
        );
        sqlResult = rows[0]!.back;
      } catch {
        sqlResult = "REFUSED";
      }
      expect(sqlResult, `divergence on ${hex}`).toBe(tsResult);
    }
  });
});

