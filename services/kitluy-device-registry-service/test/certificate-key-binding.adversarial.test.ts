/**
 * C-1: a certificate must PROVE it carries the governed key.
 *
 * Authority: independent Store Hub credential-path review 2026-08-26, verdict
 * REJECTED, critical finding C-1; owner remediation Phase 1; migration group
 * 0203.
 *
 * ===========================================================================
 * WHAT THE REVIEWER DID, AND WHY IT WORKED
 * ===========================================================================
 * Group 0202's door COPIED `public_key_fingerprint` out of the governed
 * credential into `device_certificates`, and group 0201's activation predicate
 * then compared the two columns. The comparison could not fail — it was a value
 * checked against its own source.
 *
 * So the reviewer recorded a SELF-SIGNED `CN=ATTACKER` certificate, over a key
 * the device had never seen, against a legitimate credential. The database
 * accepted it and the device activated. Nothing had ever looked inside the
 * certificate.
 *
 * Every test below attacks the door directly, as `kitluy_issuance_service` —
 * the identity that legitimately calls it. This is deliberate: a test that
 * attacked through the TypeScript composition would only prove the composition
 * is well behaved, and the finding is about what the DOOR accepts. The door has
 * to refuse a hostile caller that holds the right role.
 *
 * The binding checks all run BEFORE the idempotency lookup, so these forgeries
 * are refused without disturbing the real artifact the fixture already holds.
 */
import {
  randomUUID,
  createHash,
  generateKeyPairSync,
  sign as cryptoSign,
  X509Certificate,
} from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import forge from "node-forge";

import { requestBytes, type DeviceCertificateRequest } from "@kitluy/device-identity";

import { REGISTRY_ROLES, withServiceRole } from "../src/database.js";
import {
  issueFirstOperationalCertificate,
  operationalKeyFingerprint,
} from "../src/first-operational-issuance.js";
import { resolveDevPkiPaths, readDevPkiChain, withIssuingCaKey } from "../src/dev-operational-pki.js";
import { HubPairingComposition } from "../src/hub-pairing-composition.js";
import { requireSecurityFixture } from "./support/security-gate.js";

const DSN =
  process.env.KITLUY_DEV_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54392/postgres";
const ENVIRONMENT = "development";
const HUB_PROFILE_KEY = "WS11-T001-HUB-PROBE";
const FIXTURE_PREFIX = "C1-BINDING-";

let pool: pg.Pool;

// =============================================================================
// R2-4: THIS IS A FORMAL SECURITY SUITE. IT FAILS RATHER THAN SKIPS.
// =============================================================================
// It used to guard itself with `describe.skipIf(!live)`, where `live` depended
// on $KITLUY_DEV_PKI_DIR — a variable the documented handoff commands did not
// export. A reviewer could run the documented command, watch it go green, and be
// looking at a run in which its security assertions never executed.
//
// A green security gate with skipped security assertions is a false statement
// about what was checked. This throws at module load, before any test is
// collected, so the failure cannot be read as anything else.
await requireSecurityFixture({ dsn: DSN, needsPki: true, needsTrustAnchors: true });

const sha256 = (v: string): string => createHash("sha256").update(v).digest("hex");

function rsaKey(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

/** Build a certificate over `subjectPublicKeyPem`, signed by `signerPrivateKeyPem`. */
function mintCertificate(input: {
  subjectPublicKeyPem: string;
  subjectCn: string;
  issuerCn: string;
  signerPrivateKeyPem: string;
  serial?: string;
}): string {
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(input.subjectPublicKeyPem);
  cert.serialNumber = input.serial ?? `00${randomUUID().replace(/-/g, "")}`.slice(0, 32);
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + 30 * 86_400_000);
  cert.setSubject([{ name: "commonName", value: input.subjectCn }]);
  cert.setIssuer([{ name: "commonName", value: input.issuerCn }]);
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
  ]);
  cert.sign(forge.pki.privateKeyFromPem(input.signerPrivateKeyPem), forge.md.sha256.create());
  return forge.pki.certificateToPem(cert);
}

/** A certificate authority that is not ours, wearing our name. */
function attackerCa(): { certificatePem: string; privateKeyPem: string; commonName: string } {
  const key = rsaKey();
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(key.publicKeyPem);
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + 30 * 86_400_000);
  // Deliberately the SAME common name a real issuing CA would use. A check that
  // compared names rather than bytes and signatures would pass this.
  const cn = "KitLuy Development Device Issuing CA";
  cert.setSubject([{ name: "commonName", value: cn }]);
  cert.setIssuer([{ name: "commonName", value: cn }]);
  cert.setExtensions([{ name: "basicConstraints", cA: true }]);
  cert.sign(forge.pki.privateKeyFromPem(key.privateKeyPem), forge.md.sha256.create());
  return { certificatePem: forge.pki.certificateToPem(cert), privateKeyPem: key.privateKeyPem, commonName: cn };
}

interface Fixture {
  deviceId: string;
  credentialId: string;
  devicePublicKeyPem: string;
  realCertificatePem: string;
  realChainPem: string;
}

async function mintDevice(): Promise<string> {
  const assetTag = `${FIXTURE_PREFIX}${randomUUID()}`;
  const h = sha256(assetTag);
  const signals = [
    { signal_type: "mac_address", signal_value: (h.slice(0, 12).match(/../g) ?? []).join(":") },
    { signal_type: "board_serial", signal_value: `BS-${h.slice(12, 28)}` },
    { signal_type: "storage_serial", signal_value: `SS-${h.slice(28, 44)}` },
  ];
  const { rows } = await pool.query<{ device_id: string }>(
    `select kitluy_devices.enroll_device_v1(
       $1::text,
       (select id from kitluy_devices.hardware_profiles where profile_key = $2::text and is_active),
       now(), $3::text, 'ed25519', 'software', 'STATION-C1', 'HET-MFG/c1-suite',
       $4::jsonb, null) as device_id`,
    [assetTag, HUB_PROFILE_KEY, h, JSON.stringify(signals)],
  );
  return rows[0]!.device_id;
}

/** A device that legitimately holds a real, governed operational certificate. */
async function issuedFixture(): Promise<Fixture> {
  const deviceId = await mintDevice();

  const { rows: scope } = await pool.query<{
    tenant_id: string;
    digital_store_id: string;
    store_location_id: string;
  }>(
    `select tenant_id, digital_store_id, store_location_id
        from kitluy_devices.device_claims order by created_at desc limit 1`,
  );
  const code = Array.from(randomUUID().replace(/-/g, "").slice(0, 8), (ch) =>
    "0123456789ABCDEFGHJKMNPQRSTVWXYZ".charAt(parseInt(ch, 16) % 32),
  ).join("");
  await pool.query(
    `select kitluy_devices.open_hub_pairing_session_v1($1::uuid,$2::uuid,$3::uuid,$4::text,900,'operator/c1')`,
    [scope[0]!.tenant_id, scope[0]!.digital_store_id, scope[0]!.store_location_id, sha256(code)],
  );
  await new HubPairingComposition({ source: pool }).pair({
    deviceRecordId: deviceId,
    presentedCode: code,
    actorRef: "device/c1-suite",
  });
  await withServiceRole(pool, REGISTRY_ROLES.activation, async (c) => {
    await c.query(
      `select status from kitluy_devices.establish_device_trusted_time_v1($1::uuid,$2::text,gen_random_uuid())`,
      [deviceId, ENVIRONMENT],
    );
  });

  const { rows: gen } = await pool.query<{ g: number }>(
    `select assignment_generation as g from kitluy_devices.devices where id=$1::uuid`,
    [deviceId],
  );
  const key = rsaKey();
  const requestId = randomUUID();
  const nonce = randomUUID();
  const correlationId = randomUUID();
  const requestedAt = new Date();
  const csr: DeviceCertificateRequest = {
    requestId,
    deviceRecordId: deviceId,
    environment: ENVIRONMENT,
    devicePublicKeyPem: key.publicKeyPem,
    publicKeyFingerprint: operationalKeyFingerprint(key.publicKeyPem),
    hardwareTrustLevel: "development_software",
    assignmentGeneration: gen[0]!.g,
    requestedPurpose: "device_identity",
    requestedAt,
    nonce,
    correlationId,
    proofOfPossession: new Uint8Array(),
  };
  const outcome = await issueFirstOperationalCertificate(pool, {
    deviceRecordId: deviceId,
    environment: ENVIRONMENT,
    assignmentGeneration: gen[0]!.g,
    hardwareTrustLevel: "development_software",
    operationalPublicKeyPem: key.publicKeyPem,
    operationalKeyHandle: `c1-suite:${requestId}`,
    proofOfPossession: cryptoSign("sha256", Buffer.from(requestBytes(csr)), key.privateKeyPem),
    requestId,
    nonce,
    correlationId,
    requestedAt,
    trustedTimeStatus: "trusted",
    actorRef: "c1-suite/setup",
  });
  if (outcome.outcome === "REFUSED") {
    throw new Error(`fixture could not be issued: ${outcome.refusalCode}: ${outcome.detail}`);
  }
  return {
    deviceId,
    credentialId: outcome.credentialId,
    devicePublicKeyPem: key.publicKeyPem,
    realCertificatePem: outcome.certificatePem,
    realChainPem: outcome.chainPem,
  };
}

/** Call the door exactly as the issuance service does. */
async function record(
  credentialId: string,
  certificatePem: string,
  chainPem: string,
): Promise<{ outcome: string; refusal_code?: string; detail?: string }> {
  return withServiceRole(pool, REGISTRY_ROLES.issuance, async (c) => {
    const { rows } = await c.query<{ result: { outcome: string; refusal_code?: string; detail?: string } }>(
      `select kitluy_devices.record_operational_certificate_v1(
                $1::uuid, $2::text, $3::text, 'rsa-2048', 'c1-suite/attack') as result`,
      [credentialId, certificatePem, chainPem],
    );
    return rows[0]!.result;
  });
}

beforeAll(() => {
  pool = new pg.Pool({ connectionString: DSN, max: 6 });
});
afterAll(async () => {
  await pool
    ?.query(
      `update kitluy_devices.devices set lifecycle_state='retired', retired_at=now()
        where asset_tag like $1 and lifecycle_state <> 'retired'`,
      [`${FIXTURE_PREFIX}%`],
    )
    .catch(() => undefined);
  await pool?.end().catch(() => undefined);
});

describe("C-1: the certificate must carry the governed key", () => {
  it("THE REVIEWER'S ATTACK: a self-signed CN=ATTACKER over an unrelated key is refused", async () => {
    const f = await issuedFixture();
    const attacker = rsaKey();
    const forged = mintCertificate({
      subjectPublicKeyPem: attacker.publicKeyPem,
      subjectCn: "ATTACKER",
      issuerCn: "ATTACKER",
      signerPrivateKeyPem: attacker.privateKeyPem,
    });

    const result = await record(f.credentialId, forged, f.realChainPem);

    // Deterministic, and it names the KEY — not the chain. The certificate never
    // reaches signature verification, because it does not contain the device's
    // key and so cannot be that device's certificate whoever signed it.
    expect(result.outcome).toBe("REFUSED");
    expect(result.refusal_code).toBe("KLUY-OPCERT-KEY-BINDING");

    // And the real artifact is untouched: the attack changed nothing.
    const { rows } = await pool.query<{ pem: string }>(
      `select certificate_pem as pem from kitluy_devices.device_certificates where credential_id=$1::uuid`,
      [f.credentialId],
    );
    expect(rows[0]!.pem).toBe(f.realCertificatePem);
  });

  it("refuses a certificate signed by the REAL CA but over an unrelated key", async () => {
    const f = await issuedFixture();
    const stranger = rsaKey();
    // Signed by the genuine development issuing CA. The chain is impeccable;
    // only the key is wrong. This proves the binding check is doing the work,
    // rather than the chain check happening to catch everything.
    const forged = withIssuingCaKey(resolveDevPkiPaths()!, (caKeyPem) =>
      mintCertificate({
        subjectPublicKeyPem: stranger.publicKeyPem,
        subjectCn: `kitluy-device:${f.deviceId}`,
        issuerCn: "KitLuy Development Device Issuing CA",
        signerPrivateKeyPem: caKeyPem,
      }),
    );

    const result = await record(f.credentialId, forged, f.realChainPem);
    expect(result.outcome).toBe("REFUSED");
    expect(result.refusal_code).toBe("KLUY-OPCERT-KEY-BINDING");
  });

  it("refuses a leaf with the CORRECT device metadata but the wrong key", async () => {
    const f = await issuedFixture();
    const wrongKey = rsaKey();
    // Everything a metadata check would look at is right: the device id in the
    // subject, the real issuer, a real signature, a plausible serial.
    const forged = withIssuingCaKey(resolveDevPkiPaths()!, (caKeyPem) =>
      mintCertificate({
        subjectPublicKeyPem: wrongKey.publicKeyPem,
        subjectCn: `kitluy-device:${f.deviceId}`,
        issuerCn: "KitLuy Development Device Issuing CA",
        signerPrivateKeyPem: caKeyPem,
        serial: "00aa",
      }),
    );

    const result = await record(f.credentialId, forged, f.realChainPem);
    expect(result.outcome).toBe("REFUSED");
    expect(result.refusal_code).toBe("KLUY-OPCERT-KEY-BINDING");
  });

  it("refuses a certificate over the CORRECT key signed by the wrong CA", async () => {
    const f = await issuedFixture();
    const rogue = attackerCa();
    // The key binding SUCCEEDS here — this certificate really does contain the
    // device's public key. Only the signature is worthless. A door that checked
    // fingerprints alone would record it.
    const forged = mintCertificate({
      subjectPublicKeyPem: f.devicePublicKeyPem,
      subjectCn: `kitluy-device:${f.deviceId}`,
      issuerCn: rogue.commonName,
      signerPrivateKeyPem: rogue.privateKeyPem,
    });

    const result = await record(f.credentialId, forged, f.realChainPem);
    expect(result.outcome).toBe("REFUSED");
    expect(result.refusal_code).toBe("KLUY-OPCERT-CHAIN-UNVERIFIED");
  });

  it("refuses a valid leaf presented with a CORRUPTED chain", async () => {
    const f = await issuedFixture();
    // The genuine certificate; only the chain the device would be handed is
    // damaged. A device that cannot build a path to the root cannot verify
    // anything, so recording this would hand out an unusable identity.
    const corrupted = f.realChainPem.replace(/[A-Za-z]/, (ch) => (ch === "A" ? "B" : "A"));

    const result = await record(f.credentialId, f.realCertificatePem, corrupted);
    expect(result.outcome).toBe("REFUSED");
    expect(result.refusal_code).toBe("KLUY-OPCERT-CHAIN-MISMATCH");
  });

  it("refuses a valid leaf whose intermediate has been SUBSTITUTED", async () => {
    const f = await issuedFixture();
    const rogue = attackerCa();
    const chain = readDevPkiChain(resolveDevPkiPaths()!);
    // The rogue CA carries the same common name as the real one, so the chain
    // looks right to anything that reads names. It is refused on BYTES.
    const substituted = `${rogue.certificatePem}\n${chain.rootCertificatePem}`;

    const result = await record(f.credentialId, f.realCertificatePem, substituted);
    expect(result.outcome).toBe("REFUSED");
    expect(result.refusal_code).toBe("KLUY-OPCERT-CHAIN-MISMATCH");
  });

  it("refuses a trust anchor submitted as though it were a device certificate", async () => {
    const f = await issuedFixture();
    const chain = readDevPkiChain(resolveDevPkiPaths()!);
    const result = await record(f.credentialId, chain.rootCertificatePem, f.realChainPem);
    expect(result.outcome).toBe("REFUSED");
    expect(["KLUY-OPCERT-KEY-BINDING", "KLUY-OPCERT-NOT-A-LEAF"]).toContain(result.refusal_code);
  });

  it("STORES THE COMPUTED FINGERPRINT, so activation no longer compares a value to itself", async () => {
    const f = await issuedFixture();

    const stored = await pool.query<{ fp: string; cred_fp: string; pem: string }>(
      `select c.public_key_fingerprint as fp,
              cr.public_key_fingerprint as cred_fp,
              c.certificate_pem as pem
         from kitluy_devices.device_certificates c
         join kitluy_devices.device_credentials cr on cr.credential_id = c.credential_id
        where c.credential_id = $1::uuid`,
      [f.credentialId],
    );
    const row = stored.rows[0]!;
    // Recomputed independently, from the certificate the database holds.
    const fromCertificate = createHash("sha256")
      .update(new X509Certificate(row.pem).publicKey.export({ type: "spki", format: "der" }))
      .digest("hex");

    // The stored value equals the SPKI of the stored certificate...
    expect(row.fp).toBe(fromCertificate);
    // ...and equals the governed credential. Both, independently — which is the
    // difference between a proof and a tautology.
    expect(row.fp).toBe(row.cred_fp);

    // And the database will say so itself, from the bytes, with no help.
    const { rows: pgSide } = await pool.query<{ fp: string }>(
      `select kitluy_devices.x509_public_key_fingerprint_v1(
                (kitluy_devices.pem_certificates_to_der_v1($1::text))[1]) as fp`,
      [row.pem],
    );
    expect(pgSide[0]!.fp).toBe(fromCertificate);
  });

  it("FALSIFICATION: the pre-0203 shape really did activate on a forgery", async () => {
    // A fix is only worth what the defect cost, and a test that passes against
    // both the broken and the repaired code proves nothing. So this reproduces
    // the OLD behaviour exactly — an artifact row whose `public_key_fingerprint`
    // is COPIED from the credential rather than computed from the certificate —
    // and shows that activation accepted it.
    //
    // Everything happens inside a transaction that is ROLLED BACK, so no forged
    // artifact and no activation survives this test.
    const f = await issuedFixture();
    const attacker = rsaKey();
    const forged = mintCertificate({
      subjectPublicKeyPem: attacker.publicKeyPem,
      subjectCn: "ATTACKER",
      issuerCn: "ATTACKER",
      signerPrivateKeyPem: attacker.privateKeyPem,
    });

    const client = await pool.connect();
    let outcomeUnderOldShape = "";
    try {
      await client.query("begin");
      // Clear the genuine artifact so the forgery can take the one-active slot.
      await client.query(`delete from kitluy_devices.device_certificates where credential_id=$1::uuid`, [
        f.credentialId,
      ]);
      // THE 0202 INSERT, verbatim in its essential part: the fingerprint comes
      // from the CREDENTIAL. No one looks at the certificate.
      await client.query(
        `insert into kitluy_devices.device_certificates (
           device_id, enrollment_id, environment, certificate_serial, public_key_fingerprint,
           issuer_reference, status, issued_at, expires_at,
           credential_id, certificate_generation, public_key_algorithm,
           certificate_pem, certificate_sha256, chain_pem)
         select cr.device_record_id, d.current_enrollment_id, cr.environment, cr.serial_number,
                cr.public_key_fingerprint,          -- <-- COPIED. This was C-1.
                cr.issuer_key_id, 'active', cr.not_before, cr.not_after,
                cr.credential_id, cr.certificate_generation, 'rsa-2048',
                $2::text, encode(extensions.digest($2::text::bytea,'sha256'),'hex'), $3::text
           from kitluy_devices.device_credentials cr
           join kitluy_devices.devices d on d.id = cr.device_record_id
          where cr.credential_id = $1::uuid`,
        [f.credentialId, forged, f.realChainPem],
      );
      // The activation door is entered explicitly, as the product does. Before
      // group 0206 this reached it through `service_role`'s inherited
      // membership, which is finding C-4.
      await client.query(`set local role ${REGISTRY_ROLES.activation}`);
      const { rows } = await client.query<{ outcome: string; refusal_code: string | null }>(
        `select outcome, refusal_code
           from kitluy_devices.attempt_activate_device_v1($1::uuid, $2::text, 'c1-suite/falsify')`,
        [f.deviceId, ENVIRONMENT],
      );
      await client.query("reset role");
      outcomeUnderOldShape = `${rows[0]!.outcome}${rows[0]!.refusal_code ? ` ${rows[0]!.refusal_code}` : ""}`;
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }

    // THE DEFECT, MEASURED. A self-signed CN=ATTACKER certificate over a key the
    // device never held activated it. That is what the reviewer reported, and it
    // is reproducible on demand.
    expect(outcomeUnderOldShape).toBe("ACTIVATED");

    // And nothing survived: the genuine certificate is still the only artifact,
    // and the device did not activate.
    const { rows: after } = await pool.query<{ pem: string; state: string }>(
      `select c.certificate_pem as pem, d.lifecycle_state::text as state
         from kitluy_devices.device_certificates c
         join kitluy_devices.devices d on d.id = c.device_id
        where c.credential_id = $1::uuid`,
      [f.credentialId],
    );
    expect(after[0]!.pem).toBe(f.realCertificatePem);
    expect(after[0]!.state).toBe("awaiting_trust");
  });
});
