/**
 * Cross-layer canonical-TBS conformance — the load-bearing assumption.
 *
 * The whole safety argument of the governed issuance pipeline is that
 * `kitluy_devices.build_canonical_device_tbs_v1` in PostgreSQL and `tbsBytes()`
 * in this package produce THE SAME BYTES. If they ever drift, the adapter would
 * sign something the database cannot re-derive, and — under OPTION B, where the
 * database cannot verify the signature — the divergence would be invisible
 * until a credential failed to verify in the field.
 *
 * Testing the two against each other with the SAME TypeScript function proves
 * nothing, so this test asks the real server.
 *
 * Skips VISIBLY when the local stack is unreachable. A skipped run is never
 * reported as executed evidence.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { tbsBytes, DevelopmentDeviceKeyProvider, publicKeyFingerprint } from "../src/dev-crypto.js";

const CONTAINER = "supabase_db_kitluy-local";

function psql(sql: string): { ok: boolean; out: string } {
  const res = spawnSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-f", "-"],
    { input: sql, encoding: "utf8" },
  );
  return { ok: res.status === 0, out: (res.stdout ?? "").replace(/\r\n/g, "\n") };
}

const reachable = psql("select 1;").ok;
if (!reachable) {
  console.warn(
    "SKIPPED @kitluy/device-identity cross-layer TBS conformance: local Supabase stack unreachable",
  );
}

describe.skipIf(!reachable)("canonical TBS: PostgreSQL and the device-identity package", () => {
  it("build_canonical_device_tbs_v1 and tbsBytes produce identical bytes", async () => {
    const keys = new DevelopmentDeviceKeyProvider();
    const deviceRecordId = randomUUID();
    await keys.generateDeviceKey(deviceRecordId, "development");
    const pem = keys.publicKeyPem(deviceRecordId) ?? "";
    const fingerprint = publicKeyFingerprint(pem);

    const credentialId = randomUUID();
    const serialNumber = "DEV-0123456789ABCDEF";
    const issuerKeyId = "ica-conformance";
    const notBefore = "2026-07-28T10:00:00.000Z";
    const notAfter = "2026-08-27T10:00:00.000Z";

    const fromPackage = Buffer.from(
      tbsBytes({
        certificateId: credentialId,
        serialNumber,
        role: "device",
        purpose: "device_identity",
        environment: "development",
        subjectFingerprint: fingerprint,
        subjectPublicKeyPem: pem,
        issuerKeyId,
        deviceRecordId,
        certificateGeneration: 7,
        hardwareTrustLevel: "development_software",
        productionEligible: false,
        notBefore,
        notAfter,
      }),
    ).toString("utf8");

    // The PEM contains newlines, which are also the TBS field separator — so a
    // naive round-trip through psql would be ambiguous. Compare the SHA-256
    // instead: equal digests over the same input mean equal bytes, and the
    // digest survives transport intact.
    const escaped = pem.replace(/'/g, "''");
    const query = `
      set search_path = kitluy_devices, extensions, pg_catalog;
      select encode(extensions.digest(
        kitluy_devices.build_canonical_device_tbs_v1(
          '${credentialId}'::uuid,
          '${serialNumber}',
          'development',
          '${fingerprint}',
          '${escaped}',
          '${issuerKeyId}',
          '${deviceRecordId}'::uuid,
          7,
          'development_software'::kitluy_devices.hardware_trust_level,
          '${notBefore}'::timestamptz,
          '${notAfter}'::timestamptz
        ), 'sha256'), 'hex');
    `;

    const { ok, out } = psql(query);
    expect(ok).toBe(true);

    const fromDatabase = out.trim().split("\n").filter(Boolean).pop() ?? "";
    const packageDigest = (await import("node:crypto"))
      .createHash("sha256")
      .update(fromPackage, "utf8")
      .digest("hex");

    expect(fromDatabase).toMatch(/^[0-9a-f]{64}$/);
    expect(fromDatabase).toBe(packageDigest);
  });

  it("a changed field changes the digest, so the comparison is not vacuous", async () => {
    // Guards the test itself: if the SQL below were mis-parameterised and both
    // sides collapsed to a constant, the assertion above would pass for the
    // wrong reason. This proves the digest actually tracks the inputs.
    const base = (generation: number): string => {
      const { out } = psql(`
        select encode(extensions.digest(
          kitluy_devices.build_canonical_device_tbs_v1(
            '00000000-0000-4000-8000-000000000001'::uuid, 'DEV-X', 'development',
            '${"a".repeat(64)}', 'PEM', 'ica',
            '00000000-0000-4000-8000-000000000002'::uuid, ${generation},
            'development_software'::kitluy_devices.hardware_trust_level,
            '2026-07-28T10:00:00.000Z'::timestamptz, '2026-08-27T10:00:00.000Z'::timestamptz
          ), 'sha256'), 'hex');
      `);
      return out.trim().split("\n").filter(Boolean).pop() ?? "";
    };
    expect(base(1)).toMatch(/^[0-9a-f]{64}$/);
    expect(base(1)).not.toBe(base(2));
  });
});
