/**
 * H-1, H-2 and M-1: who may reserve a generation, how many artifacts one
 * credential may carry, and whether the serial in the certificate is the serial
 * the rest of the system will look for.
 *
 * Authority: independent Store Hub credential-path review 2026-08-26, findings
 * H-1, H-2 and M-1; owner remediation Phases 6, 7 and 8; migration group 0208.
 */
import { randomUUID, createHash, generateKeyPairSync, sign as cryptoSign, X509Certificate } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import forge from "node-forge";

import { requestBytes, type DeviceCertificateRequest } from "@kitluy/device-identity";

import { REGISTRY_ROLES, withServiceRole } from "../src/database.js";
import {
  issueFirstOperationalCertificate,
  operationalKeyFingerprint,
  x509SerialForCredential,
  credentialSerialFromX509,
} from "../src/first-operational-issuance.js";
import { HubPairingComposition } from "../src/hub-pairing-composition.js";
import { requireSecurityFixture } from "./support/security-gate.js";

const DSN =
  process.env.KITLUY_DEV_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54392/postgres";
const ENVIRONMENT = "development";
const HUB_PROFILE_KEY = "WS11-T001-HUB-PROBE";
const FIXTURE_PREFIX = "H1-H2-M1-";

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

async function enrollOnly(): Promise<string> {
  const assetTag = `${FIXTURE_PREFIX}${randomUUID()}`;
  const h = sha256(assetTag);
  const { rows } = await pool.query<{ device_id: string }>(
    `select kitluy_devices.enroll_device_v1(
       $1::text,
       (select id from kitluy_devices.hardware_profiles where profile_key = $2::text and is_active),
       now(), $3::text, 'ed25519', 'software', 'STATION-H', 'HET-MFG/h-suite',
       $4::jsonb, null) as device_id`,
    [
      assetTag,
      HUB_PROFILE_KEY,
      h,
      JSON.stringify([
        { signal_type: "mac_address", signal_value: (h.slice(0, 12).match(/../g) ?? []).join(":") },
        { signal_type: "board_serial", signal_value: `BS-${h.slice(12, 28)}` },
        { signal_type: "storage_serial", signal_value: `SS-${h.slice(28, 44)}` },
      ]),
    ],
  );
  return rows[0]!.device_id;
}

async function pairAndTrust(deviceId: string): Promise<number> {
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
    `select kitluy_devices.open_hub_pairing_session_v1($1::uuid,$2::uuid,$3::uuid,$4::text,900,'operator/h')`,
    [scope[0]!.tenant_id, scope[0]!.digital_store_id, scope[0]!.store_location_id, sha256(code)],
  );
  await new HubPairingComposition({ source: pool }).pair({
    deviceRecordId: deviceId,
    presentedCode: code,
    actorRef: "device/h-suite",
  });
  await withServiceRole(pool, REGISTRY_ROLES.activation, async (c) => {
    await c.query(
      `select status from kitluy_devices.establish_device_trusted_time_v1($1::uuid,$2::text,gen_random_uuid())`,
      [deviceId, ENVIRONMENT],
    );
  });
  const { rows } = await pool.query<{ g: number }>(
    `select assignment_generation as g from kitluy_devices.devices where id=$1::uuid`,
    [deviceId],
  );
  return rows[0]!.g;
}

/** Call the generation-key door exactly as the issuance service does. */
async function registerKey(deviceId: string, generation: number, publicKeyPem: string) {
  return withServiceRole(pool, REGISTRY_ROLES.issuance, async (c) =>
    c.query(
      `select kitluy_devices.register_generation_key_v1(
                $1::uuid, $2::text, 'device_identity', $3::int, $4::text, $5::text, $6::text)`,
      [
        deviceId,
        ENVIRONMENT,
        generation,
        `h-suite:${randomUUID()}`,
        publicKeyPem,
        operationalKeyFingerprint(publicKeyPem),
      ],
    ),
  );
}

async function issueFor(deviceId: string, assignmentGeneration: number) {
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
    assignmentGeneration,
    requestedPurpose: "device_identity",
    requestedAt,
    nonce,
    correlationId,
    proofOfPossession: new Uint8Array(),
  };
  return issueFirstOperationalCertificate(pool, {
    deviceRecordId: deviceId,
    environment: ENVIRONMENT,
    assignmentGeneration,
    hardwareTrustLevel: "development_software",
    operationalPublicKeyPem: key.publicKeyPem,
    operationalKeyHandle: `h-suite:${requestId}`,
    proofOfPossession: cryptoSign("sha256", Buffer.from(requestBytes(csr)), key.privateKeyPem),
    requestId,
    nonce,
    correlationId,
    requestedAt,
    trustedTimeStatus: "trusted",
    actorRef: "h-suite/issue",
  });
}

beforeAll(() => {
  pool = new pg.Pool({ connectionString: DSN, max: 8 });
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

describe("H-1: a generation cannot be reserved for just any device", () => {
  it("refuses a device that does not exist", async () => {
    await expect(registerKey(randomUUID(), 1, rsaKey().publicKeyPem)).rejects.toThrow(
      /KLUY-KEY-NO-DEVICE/,
    );
  });

  it("PRE-EMPTION: refuses a device that has never been paired", async () => {
    // The attack H-1 is about. A caller holding `kitluy_issuance_service` and a
    // device id it read somewhere could reserve that device's generation 1 —
    // and because generation 1 is spent exactly once, the real Hub would then
    // arrive to find its only slot taken by a key it does not hold.
    //
    // An enrolled-but-unpaired board has no Store to serve, so a key for it
    // protects nothing and is refused.
    const stranger = await enrollOnly();
    await expect(registerKey(stranger, 1, rsaKey().publicKeyPem)).rejects.toThrow(
      /KLUY-KEY-NO-ASSIGNMENT/,
    );

    const { rows } = await pool.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_generation_keys where device_record_id=$1::uuid`,
      [stranger],
    );
    expect(rows[0]!.n).toBe("0");
  });

  it("refuses a retired device", async () => {
    const device = await enrollOnly();
    await pairAndTrust(device);
    await pool.query(
      `update kitluy_devices.devices set lifecycle_state='retired', retired_at=now() where id=$1::uuid`,
      [device],
    );
    await expect(registerKey(device, 1, rsaKey().publicKeyPem)).rejects.toThrow(
      /KLUY-KEY-DEVICE-STATE/,
    );
  });

  it("refuses a quarantined device", async () => {
    const device = await enrollOnly();
    await pairAndTrust(device);
    // Both columns together: `devices_quarantine_consistency_chk` refuses a
    // quarantine timestamp without the matching lifecycle state, which is a
    // good constraint and means the state check fires first here.
    await pool.query(
      `update kitluy_devices.devices
          set quarantined_at = now(), lifecycle_state = 'quarantined'
        where id = $1::uuid`,
      [device],
    );
    await expect(registerKey(device, 1, rsaKey().publicKeyPem)).rejects.toThrow(
      /KLUY-KEY-DEVICE-(QUARANTINED|STATE)/,
    );
  });

  it("refuses a generation the governed head has not reached", async () => {
    const device = await enrollOnly();
    await pairAndTrust(device);
    // Parking a key on a far-future generation would let a caller pre-empt every
    // renewal a device has not had yet.
    await expect(registerKey(device, 7, rsaKey().publicKeyPem)).rejects.toThrow(
      /KLUY-KEY-GENERATION-OUT-OF-SEQUENCE/,
    );
    // ...and generation 1 is still free for the device that owns it.
    await expect(registerKey(device, 1, rsaKey().publicKeyPem)).resolves.toBeDefined();
  });
});

describe("H-2: one credential carries exactly one artifact", () => {
  it("is enforced by a UNIQUE index, not only by a check-then-insert", async () => {
    const { rows } = await pool.query<{ def: string }>(
      `select indexdef as def from pg_indexes
        where schemaname='kitluy_devices' and indexname='device_certificates_credential_uq'`,
    );
    // `device_certificates_credential_idx` looked like this index and was NOT
    // unique, which is why two concurrent recordings could both pass the door's
    // existence check.
    expect(rows[0]?.def).toMatch(/CREATE UNIQUE INDEX/);
  });

  it("returns ALREADY_RECORDED to the loser of a concurrent recording, never a raw 23505", async () => {
    const device = await enrollOnly();
    const generation = await pairAndTrust(device);
    const issued = await issueFor(device, generation);
    if (issued.outcome === "REFUSED") throw new Error(`${issued.refusalCode}: ${issued.detail}`);

    // Both calls carry the SAME bytes, as two retries of one request would.
    const recordOnce = () =>
      withServiceRole(pool, REGISTRY_ROLES.issuance, async (c) => {
        const { rows } = await c.query<{ result: { outcome: string; refusal_code?: string } }>(
          `select kitluy_devices.record_operational_certificate_v1(
                    $1::uuid, $2::text, $3::text, 'rsa-2048', 'h-suite/race') as result`,
          [issued.credentialId, issued.certificatePem, issued.chainPem],
        );
        return rows[0]!.result;
      });

    const results = await Promise.all([recordOnce(), recordOnce(), recordOnce()]);
    for (const result of results) {
      expect(result.outcome).toBe("ALREADY_RECORDED");
    }

    const { rows: count } = await pool.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_certificates where credential_id=$1::uuid`,
      [issued.credentialId],
    );
    expect(count[0]!.n).toBe("1");
  });
});

describe("M-1: one serial, shared by the credential and the certificate", () => {
  it("the TypeScript and SQL mappings agree, including on leading zeros", async () => {
    // Two implementations of one mapping is a divergence waiting to happen, so
    // they are compared directly. `DEV-00...` is not hypothetical — the real
    // corpus contains such serials, and DER drops that leading byte.
    const serials = [
      "DEV-0123456789ABCDEF",
      "DEV-004C34C1A664C9E5",
      "DEV-00D3A8F60D8FCC31",
      "not-a-dev-serial",
    ];
    for (const serial of serials) {
      const { rows } = await pool.query<{ s: string }>(
        `select kitluy_devices.x509_serial_for_credential_v1($1::text) as s`,
        [serial],
      );
      // Compared LITERALLY. This assertion used to read
      // `.replace(/^(00)+/, "")`, which normalised away the exact difference
      // between the two implementations — finding R2-1. The full case matrix
      // lives in `serial-canonicalization.adversarial.test.ts`.
      expect(rows[0]!.s, `mapping for ${serial}`).toBe(x509SerialForCredential(serial));
    }
  });

  it("the issued certificate carries the credential's serial, untruncated", async () => {
    const device = await enrollOnly();
    const generation = await pairAndTrust(device);
    const issued = await issueFor(device, generation);
    if (issued.outcome === "REFUSED") throw new Error(`${issued.refusalCode}: ${issued.detail}`);

    const { rows } = await pool.query<{
      credential_serial: string;
      stored_x509: string;
      pem: string;
    }>(
      `select cr.serial_number as credential_serial,
              c.certificate_x509_serial as stored_x509,
              c.certificate_pem as pem
         from kitluy_devices.device_certificates c
         join kitluy_devices.device_credentials cr on cr.credential_id = c.credential_id
        where c.credential_id = $1::uuid`,
      [issued.credentialId],
    );
    const row = rows[0]!;

    // What the certificate ITSELF says, read by Node rather than by us.
    //
    // Node NORMALISES for display: it drops the 0x00 sign byte that DER requires
    // when the leading byte is >= 0x80. The stored column is the VERBATIM DER
    // content (group 0210 deliberately stopped stripping it), so the two are
    // compared as integers. Comparing the strings would fail on a formatting
    // difference for roughly half of all serials and prove nothing about either.
    const fromCertificate = new X509Certificate(row.pem).serialNumber.toLowerCase();
    const asInteger = (hex: string): bigint => BigInt(`0x${hex === "" ? "0" : hex}`);
    expect(asInteger(row.stored_x509)).toBe(asInteger(fromCertificate));

    // And it is the canonical encoding of the credential's serial. Before this
    // fix the leaf carried `('00' + hex(serial)).slice(0, 40)`, which dropped the
    // last byte — so this equality did not hold for a single certificate ever
    // issued, and nothing noticed because nothing compared them yet.
    const { rows: expected } = await pool.query<{ s: string }>(
      `select kitluy_devices.x509_serial_for_credential_v1($1::text) as s`,
      [row.credential_serial],
    );
    // The STORED value is compared to the canonical mapping EXACTLY — no
    // normalisation — because that is the pair R2-1 found disagreeing.
    expect(row.stored_x509).toBe(expected[0]!.s);
    expect(asInteger(fromCertificate)).toBe(asInteger(expected[0]!.s));

    // The credential serial is RECOVERABLE from the certificate, which is what a
    // revocation projection needs.
    // Inverted from the STORED canonical value, not from Node's display form.
    //
    // Node strips the 0x00 sign byte when printing, so its display is NOT a
    // minimal positive DER INTEGER for any serial whose leading byte is >= 0x80
    // — and after N-1 the inverse refuses exactly that, rather than guessing.
    // The stored column is the verbatim DER content and is the value a
    // revocation projection would actually hold.
    expect(credentialSerialFromX509(row.stored_x509)).toBe(row.credential_serial);
  });
});

describe("M-2: revocation reaches the certificate, and the leaf can be chained", () => {
  it("revoking the credential revokes its artifact in the same transaction", async () => {
    const device = await enrollOnly();
    const generation = await pairAndTrust(device);
    const issued = await issueFor(device, generation);
    if (issued.outcome === "REFUSED") throw new Error(`${issued.refusalCode}: ${issued.detail}`);

    const statusOf = async () => {
      const { rows } = await pool.query<{ s: string; r: string | null }>(
        `select status::text as s, revocation_reason as r
           from kitluy_devices.device_certificates where credential_id=$1::uuid`,
        [issued.credentialId],
      );
      return rows[0]!;
    };
    expect((await statusOf()).s).toBe("active");

    // `device_credentials` is owned by the credential issuer and postgres holds
    // no direct write on it, which is itself the C-4 boundary working. The role
    // is borrowed for one transaction and handed back, the pattern every
    // migration that touches a governed table already uses.
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `do $b$ begin execute format('grant kitluy_credential_issuer to %I', current_user); end $b$;`,
      );
      await client.query("set local role kitluy_credential_issuer");
      await client.query(
        // Both columns: `device_credentials_revoked_chk` requires the state and
        // the timestamp to agree, which is a good constraint.
        `update kitluy_devices.device_credentials
            set revoked_at = now(), state = 'revoked',
                revocation_reason = 'M-2 suite: credential revoked'
          where credential_id = $1::uuid`,
        [issued.credentialId],
      );
      await client.query("reset role");
      await client.query("commit");
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }

    // Before group 0209 this stayed `active`: revocation set a column on the
    // credential and left the artifact chaining to the pinned root, inside its
    // own validity window, with nothing marking it dead. Hub LAN mTLS authorises
    // on the CERTIFICATE, so that gap is the difference between a revoked device
    // and a device that still gets in.
    const after = await statusOf();
    expect(after.s).toBe("revoked");
    expect(after.r).toMatch(/credential revoked/);
  });

  it("the leaf carries an authority key identifier, so a verifier need not guess", async () => {
    const device = await enrollOnly();
    const generation = await pairAndTrust(device);
    const issued = await issueFor(device, generation);
    if (issued.outcome === "REFUSED") throw new Error(`${issued.refusalCode}: ${issued.detail}`);

    // Read from the DER. `X509Certificate.toString()` returns the PEM rather
    // than a text dump, and Node exposes no general extension accessor, so the
    // certificate is parsed properly instead of pattern-matched.
    const leaf = forge.pki.certificateFromPem(issued.certificatePem);
    const aki = leaf.extensions.find((e: { name?: string }) => e.name === "authorityKeyIdentifier");
    const ski = leaf.extensions.find((e: { name?: string }) => e.name === "subjectKeyIdentifier");
    expect(aki, "the leaf carries no authority key identifier").toBeDefined();
    expect(ski, "the leaf carries no subject key identifier").toBeDefined();

    // And it points at the ISSUER's key: the AKI must equal the intermediate's
    // own subject key identifier, or it names the wrong authority.
    const chainPems =
      issued.chainPem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
    const issuer = forge.pki.certificateFromPem(chainPems[0]!);
    const issuerSki = issuer.generateSubjectKeyIdentifier().getBytes();
    // forge stores the parsed extension as raw DER in `value`, so the issuer's
    // key identifier is asserted to be CONTAINED in it rather than compared to a
    // decoded field that forge does not expose.
    const akiBytes = Buffer.from((aki as { value: string }).value, "binary").toString("hex");
    expect(akiBytes).toContain(Buffer.from(issuerSki, "binary").toString("hex"));
  });
});

