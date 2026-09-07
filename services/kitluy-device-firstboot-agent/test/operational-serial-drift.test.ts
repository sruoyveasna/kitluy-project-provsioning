/**
 * The device's copy of the credential-serial mapping must equal the server's.
 *
 * `src/operational-tls-client.ts` carries a local `x509SerialForCredentialSerial`
 * for the same reason `operational-csr-bytes.ts` carries local canonical bytes:
 * the image ships no `node_modules`. Two implementations of one mapping is how
 * finding R2-1 happened — the SQL and TypeScript halves disagreed and a test
 * normalised the difference away — so this compares them directly.
 */
import { describe, expect, it } from "vitest";

import { x509SerialForCredentialSerial } from "../src/operational-tls-client.js";

/**
 * The server's rule, restated from group 0210 and
 * `first-operational-issuance.ts`. Restated rather than imported because the
 * registry service is not a dependency of this package in either direction —
 * which is the point of the comparison.
 */
function serverRule(credentialSerial: string): string {
  let bytes = credentialSerial.slice(4).toLowerCase();
  while (bytes.length > 2 && bytes.startsWith("00")) bytes = bytes.slice(2);
  if (Number.parseInt(bytes.slice(0, 2), 16) >= 0x80) bytes = `00${bytes}`;
  return bytes;
}

describe("the credential-serial mapping does not drift", () => {
  it("agrees with the server rule on every awkward shape", () => {
    const serials = [
      "DEV-0123456789ABCDEF",
      "DEV-004C34C1A664C9E5",
      "DEV-0000000000000001",
      "DEV-0000000000000000",
      "DEV-7FFFFFFFFFFFFFFF",
      "DEV-8000000000000000",
      "DEV-FF34C1A664C9E512",
      "DEV-00D3A8F60D8FCC31",
    ];
    for (const serial of serials) {
      expect(x509SerialForCredentialSerial(serial), `drift on ${serial}`).toBe(serverRule(serial));
    }
  });

  it("never emits a redundant zero and never emits a negative integer", () => {
    for (let lead = 0; lead <= 0xff; lead += 1) {
      const serial = `DEV-${lead.toString(16).padStart(2, "0").toUpperCase()}AABBCCDDEEFF0011`.slice(0, 20);
      const encoded = x509SerialForCredentialSerial(serial);
      const first = Number.parseInt(encoded.slice(0, 2), 16);
      if (first === 0x00 && encoded.length > 2) {
        // A leading zero is legal ONLY as a sign byte. Anything else is the
        // "illegal padding" OpenSSL rejected in R2-1.
        expect(Number.parseInt(encoded.slice(2, 4), 16)).toBeGreaterThanOrEqual(0x80);
      }
      expect(first).toBeLessThan(0x80);
    }
  });
});
