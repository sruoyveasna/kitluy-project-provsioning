/**
 * The first governed operational X.509 certificate, end to end.
 *
 * ===========================================================================
 * WHAT THIS PROVES THAT NOTHING ELSE DID
 * ===========================================================================
 * `device_certificates` held 35 rows and NOT ONE carried a certificate. The
 * governed credential machinery had been built, reviewed and never executed
 * against a real signer, and activation was gated on metadata that no signed
 * credential stood behind.
 *
 * This file issues a real certificate through the real doors and then activates
 * a real device with it.
 *
 * The device half is simulated in-process — a locally generated RSA key that
 * signs `kitluy.csr.v1` — because the firstboot client does not exist yet. What
 * is NOT simulated is anything on the server side: the governed reservation, the
 * persistent CA, the X.509 signing, the artifact door and the activation
 * predicate are all the shipping implementations.
 */
import { randomUUID, createHash, generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { X509Certificate } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import {
  issueFirstOperationalCertificate,
  operationalKeyFingerprint,
  OPERATIONAL_KEY_ALGORITHM,
} from "../src/first-operational-issuance.js";
import { REGISTRY_ROLES, withServiceRole } from "../src/database.js";
import { HubPairingComposition } from "../src/hub-pairing-composition.js";
import { requireSecurityFixture } from "./support/security-gate.js";
import { requestBytes, type DeviceCertificateRequest } from "@kitluy/device-identity";

const DSN =
  process.env.KITLUY_HUB_PAIRING_DSN ?? "postgresql://postgres:postgres@127.0.0.1:54392/postgres";
const ENVIRONMENT = "development";
const HUB_PROFILE_KEY = "WS11-T001-HUB-PROBE";
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

let pool: pg.Pool;

/** Both the database AND a persistent development CA must be present. */
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

/** The DEVICE half: a key that never leaves this process, as on a real Hub. */
function generateOperationalKey(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

/** Sign `kitluy.csr.v1` exactly as a Hub would. */
function proveePossession(csr: DeviceCertificateRequest, privateKeyPem: string): Uint8Array {
  return cryptoSign("sha256", Buffer.from(requestBytes(csr)), privateKeyPem);
}

/**
 * FRESH DEVICES, and that is forced by the domain rather than convenience.
 *
 * A slot-reuse fixture was tried first and the database refused it —
 * `KLUY-KEY-GENERATION-TAKEN: generation 1 already holds a different key for
 * this device`. That refusal is correct: generation 1 holds exactly one key, for
 * ever, and a device has exactly one FIRST issuance in its life. Re-running a
 * first-issuance suite against a device that has already had one is not a repeat
 * of the scenario, it is a different scenario.
 *
 * Every device created here is RETIRED in `afterAll`, so the active fleet does
 * not grow.
 */
const FIXTURE_PREFIX = "OPCERT-FIXTURE-";

async function mintHub(): Promise<string> {
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
       (select id from kitluy_devices.hardware_profiles where profile_key=$2::text and is_active),
       now(), $3::text, 'ed25519', 'software', 'STATION-OPCERT', 'HET-MFG/opcert-suite',
       $4::jsonb, null) as device_id`,
    [assetTag, HUB_PROFILE_KEY, h, JSON.stringify(signals)],
  );
  return rows[0]!.device_id;
}

function freshCode(): string {
  return Array.from(
    randomUUID().replace(/-/g, "").slice(0, 8),
    (c) => CROCKFORD[parseInt(c, 16) % CROCKFORD.length]!,
  ).join("");
}

/** Pair a fresh Hub and return its device id plus its assignment generation. */
async function pairedHub(): Promise<{ deviceId: string; assignmentGeneration: number }> {
  const deviceId = await mintHub();
  const { rows: scope } = await pool.query<{
    tenant_id: string;
    digital_store_id: string;
    store_location_id: string;
  }>(
    `select tenant_id, digital_store_id, store_location_id
       from kitluy_devices.device_claims order by created_at desc limit 1`,
  );
  const code = freshCode();
  await pool.query(
    `select kitluy_devices.open_hub_pairing_session_v1($1::uuid,$2::uuid,$3::uuid,$4::text,900,'operator/opcert')`,
    [scope[0]!.tenant_id, scope[0]!.digital_store_id, scope[0]!.store_location_id, sha256(code)],
  );
  const paired = await new HubPairingComposition({ source: pool }).pair({
    deviceRecordId: deviceId,
    presentedCode: code,
    actorRef: "device/opcert-suite",
  });
  expect(paired.result).toBe("PAIRED");
  const { rows } = await pool.query<{ g: number }>(
    `select assignment_generation as g from kitluy_devices.devices where id=$1::uuid`,
    [deviceId],
  );
  return { deviceId, assignmentGeneration: rows[0]!.g };
}

/** Establish trusted time through the governed bridge, as the product does. */
async function establishTrustedTime(deviceId: string): Promise<Date> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("set local role kitluy_activation_service");
    const { rows } = await c.query<{ t: Date }>(
      `select trusted_time as t
         from kitluy_devices.establish_device_trusted_time_v1($1::uuid,$2::text,gen_random_uuid())`,
      [deviceId, ENVIRONMENT],
    );
    await c.query("commit");
    return rows[0]!.t;
  } finally {
    c.release();
  }
}

interface IssuedFixture {
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
  csr: DeviceCertificateRequest;
  requestId: string;
}

/** Everything a Hub does before it may ask for a certificate. */
async function readyToIssue(): Promise<IssuedFixture> {
  const { deviceId, assignmentGeneration } = await pairedHub();
  const trustedTime = await establishTrustedTime(deviceId);
  const key = generateOperationalKey();
  const requestId = randomUUID();
  const csr: DeviceCertificateRequest = {
    requestId,
    deviceRecordId: deviceId,
    environment: ENVIRONMENT,
    devicePublicKeyPem: key.publicKeyPem,
    publicKeyFingerprint: operationalKeyFingerprint(key.publicKeyPem),
    hardwareTrustLevel: "development_software",
    assignmentGeneration,
    requestedPurpose: "device_identity",
    requestedAt: trustedTime,
    nonce: randomUUID(),
    correlationId: randomUUID(),
    proofOfPossession: new Uint8Array(),
  };
  return { deviceId, ...key, csr, requestId };
}

const issueFrom = (f: IssuedFixture, pop: Uint8Array) =>
  issueFirstOperationalCertificate(
    pool,
    {
      deviceRecordId: f.deviceId,
      environment: ENVIRONMENT,
      assignmentGeneration: f.csr.assignmentGeneration,
      hardwareTrustLevel: "development_software",
      operationalPublicKeyPem: f.publicKeyPem,
      operationalKeyHandle: `hub-operational:${f.deviceId}`,
      proofOfPossession: pop,
      requestId: f.requestId,
      nonce: f.csr.nonce,
      correlationId: f.csr.correlationId,
      requestedAt: f.csr.requestedAt,
      trustedTimeStatus: "trusted",
      actorRef: "device/opcert-suite",
    },
    process.env,
  );

beforeAll(() => {
  pool = new pg.Pool({ connectionString: DSN, max: 6 });
});
afterAll(async () => {
  // Park this run's fixtures so the active fleet does not grow one Hub per test.
  await pool
    ?.query(
      `update kitluy_devices.devices set lifecycle_state='retired', retired_at=now()
        where asset_tag like $1 and lifecycle_state <> 'retired'`,
      [`${FIXTURE_PREFIX}%`],
    )
    .catch(() => undefined);
  await pool?.end().catch(() => undefined);
});

describe("the first governed operational X.509", () => {
  it("issues a real certificate through the governed doors", async () => {
    const f = await readyToIssue();
    const pop = proveePossession(f.csr, f.privateKeyPem);
    const outcome = await issueFrom(f, pop);

    if (outcome.outcome === "REFUSED") {
      throw new Error(`${outcome.refusalCode}: ${outcome.detail}`);
    }
    expect(outcome.outcome).toBe("ISSUED");
    // The SERVER allocated this, not the caller.
    expect(outcome.certificateGeneration).toBe(1);
    expect(outcome.publicKeyAlgorithm).toBe(OPERATIONAL_KEY_ALGORITHM);
    expect(outcome.certificateSha256).toMatch(/^[0-9a-f]{64}$/);

    // The artifact is a real X.509 that Node itself will parse and verify.
    const leaf = new X509Certificate(outcome.certificatePem);
    expect(leaf.ca).toBe(false);
    expect(leaf.subject).toContain(f.deviceId);
    // The certificate's public key IS the key the device proved it holds.
    expect(
      operationalKeyFingerprint(leaf.publicKey.export({ type: "spki", format: "pem" }).toString()),
    ).toBe(operationalKeyFingerprint(f.publicKeyPem));
    // ...and it chains to the persistent development issuing CA.
    const [intermediatePem] = outcome.chainPem.split(/(?<=-----END CERTIFICATE-----)\n/);
    const intermediate = new X509Certificate(intermediatePem!);
    expect(leaf.checkIssued(intermediate)).toBe(true);
    expect(leaf.verify(intermediate.publicKey)).toBe(true);

    // The fingerprint the database computed matches the bytes it stored.
    const { rows } = await pool.query<{
      sha: string;
      pem: string;
      gen: number;
      cred: string;
      alg: string;
    }>(
      `select certificate_sha256 as sha, certificate_pem as pem, certificate_generation as gen,
              credential_id as cred, public_key_algorithm as alg
         from kitluy_devices.device_certificates where credential_id=$1::uuid`,
      [outcome.credentialId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.pem).toBe(outcome.certificatePem);
    expect(rows[0]!.gen).toBe(1);
    expect(rows[0]!.alg).toBe(OPERATIONAL_KEY_ALGORITHM);
    // Recomputed independently from the stored bytes.
    const der = Buffer.from(
      rows[0]!.pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s/g, ""),
      "base64",
    );
    expect(createHash("sha256").update(der).digest("hex")).toBe(rows[0]!.sha);
  });

  it("refuses a proof signed by a DIFFERENT private key", async () => {
    const f = await readyToIssue();
    const impostor = generateOperationalKey();
    // Correct public key presented, signature from another key entirely.
    const pop = proveePossession(f.csr, impostor.privateKeyPem);
    const outcome = await issueFrom(f, pop);
    expect(outcome.outcome).toBe("REFUSED");
    if (outcome.outcome === "REFUSED") {
      expect(outcome.refusalCode).toBe("OPCERT_POSSESSION_PROOF_FAILED");
    }
    // Nothing was reserved, so nothing was recorded.
    const { rows } = await pool.query<{ n: number }>(
      `select count(*)::int as n from kitluy_devices.device_certificates
        where device_id=$1::uuid and certificate_pem is not null`,
      [f.deviceId],
    );
    expect(rows[0]!.n).toBe(0);
  });

  it("refuses a mutated preimage", async () => {
    const f = await readyToIssue();
    // Sign a DIFFERENT nonce than the one submitted: the signature is valid, but
    // not over the bytes the server rebuilds.
    const pop = proveePossession({ ...f.csr, nonce: randomUUID() }, f.privateKeyPem);
    const outcome = await issueFrom(f, pop);
    expect(outcome.outcome).toBe("REFUSED");
    if (outcome.outcome === "REFUSED") {
      expect(outcome.refusalCode).toBe("OPCERT_POSSESSION_PROOF_FAILED");
    }
  });

  it("is idempotent: replaying the same signed request mints nothing new", async () => {
    const f = await readyToIssue();
    const pop = proveePossession(f.csr, f.privateKeyPem);
    const first = await issueFrom(f, pop);
    if (first.outcome === "REFUSED") throw new Error(`${first.refusalCode}: ${first.detail}`);

    const second = await issueFrom(f, pop);
    if (second.outcome === "REFUSED") throw new Error(`${second.refusalCode}: ${second.detail}`);

    // Same governed authority, byte-identical artifact.
    expect(second.credentialId).toBe(first.credentialId);
    expect(second.serialNumber).toBe(first.serialNumber);
    expect(second.certificateGeneration).toBe(first.certificateGeneration);
    expect(second.certificateSha256).toBe(first.certificateSha256);

    // And exactly one of each in the database.
    const { rows } = await pool.query<{ certs: number; creds: number }>(
      `select (select count(*)::int from kitluy_devices.device_certificates
                where device_id=$1::uuid and certificate_pem is not null) as certs,
              (select count(*)::int from kitluy_devices.device_credentials
                where device_record_id=$1::uuid) as creds`,
      [f.deviceId],
    );
    expect(rows[0]!.certs).toBe(1);
    expect(rows[0]!.creds).toBe(1);
  });

  it("refuses two concurrent requests without creating conflicting authority", async () => {
    const f = await readyToIssue();
    const pop = proveePossession(f.csr, f.privateKeyPem);
    const [a, b] = await Promise.all([issueFrom(f, pop), issueFrom(f, pop)]);
    const succeeded = [a, b].filter((r) => r.outcome !== "REFUSED");
    // Whatever the interleaving, the fleet must not end up with two.
    const { rows } = await pool.query<{ n: number }>(
      `select count(*)::int as n from kitluy_devices.device_certificates
        where device_id=$1::uuid and certificate_pem is not null`,
      [f.deviceId],
    );
    expect(rows[0]!.n).toBeLessThanOrEqual(1);
    if (succeeded.length === 2) {
      const [x, y] = succeeded as Extract<typeof a, { credentialId: string }>[];
      expect(y.credentialId).toBe(x.credentialId);
      expect(y.certificateSha256).toBe(x.certificateSha256);
    }
  });
});

describe("activation, through the real certificate", () => {
  it("refuses before issuance and succeeds after it", async () => {
    const f = await readyToIssue();

    // BEFORE: group 0201's predicate has nothing to select.
    //
    // Probed through `attempt_activate_device_v1` DIRECTLY rather than through
    // `advanceDeviceTrust`, and that is a finding rather than a preference:
    // `advanceDeviceTrust` still calls `issue_development_device_certificate_v1`,
    // which inserts a metadata-only `active` row. Since group 0201 added
    // one-active-certificate-per-device, that legacy row then collides with the
    // governed artifact this suite issues
    // (`device_certificates_one_active_per_env_idx`). The legacy step is
    // superseded by the path under test and is recorded for removal; it is not
    // silently worked around here, it is named.
        // Entered explicitly, as the product does. This call used to run as the
    // bare connection identity and reached the door through `service_role`'s
    // inherited membership of `kitluy_activation_service` — the chain group 0206
    // cut to close finding C-4. Activation is a governed capability now, not an
    // ambient one.
    const { rows: beforeRows } = await withServiceRole(pool, REGISTRY_ROLES.activation, async (c) =>
      c.query<{ outcome: string; refusal_code: string | null }>(
        `select outcome, refusal_code
         from kitluy_devices.attempt_activate_device_v1($1::uuid, $2::text, 'opcert-suite/before')`,
        [f.deviceId, ENVIRONMENT],
      ),
    );
    expect(beforeRows[0]!.outcome).toBe("REFUSED");
    expect(beforeRows[0]!.refusal_code).toBe("KLUY-DEVICE-NO-CERTIFICATE");

    // Issue for real.
    const pop = proveePossession(f.csr, f.privateKeyPem);
    const issued = await issueFrom(f, pop);
    if (issued.outcome === "REFUSED") throw new Error(`${issued.refusalCode}: ${issued.detail}`);

    // AFTER: the same predicate now finds an artifact bound to the device's
    // current governed credential, inside its validity window.
        // Entered explicitly, as the product does. This call used to run as the
    // bare connection identity and reached the door through `service_role`'s
    // inherited membership of `kitluy_activation_service` — the chain group 0206
    // cut to close finding C-4. Activation is a governed capability now, not an
    // ambient one.
    const { rows: afterRows } = await withServiceRole(pool, REGISTRY_ROLES.activation, async (c) =>
      c.query<{
      outcome: string;
      lifecycle_state: string;
      refusal_code: string | null;
    }>(
        `select outcome, lifecycle_state::text as lifecycle_state, refusal_code
         from kitluy_devices.attempt_activate_device_v1($1::uuid, $2::text, 'opcert-suite/after')`,
        [f.deviceId, ENVIRONMENT],
      ),
    );
    // Asserted WITH the refusal code, so a failure names the gate that refused
    // instead of only saying "not ACTIVATED". When this assertion first fired it
    // reported `KLUY-DEVICE-NO-CERTIFICATE` even though every field of the 0201
    // predicate was satisfied — the activation identity held a SELECT grant on
    // `device_credentials` but no row-security POLICY, and a FORCE-RLS read with
    // no policy returns zero rows rather than raising. Without the code in the
    // message that would have been a long hunt.
    expect(afterRows[0]!.refusal_code).toBeNull();
    expect(afterRows[0]!.outcome).toBe("ACTIVATED");
    expect(afterRows[0]!.lifecycle_state).toBe("active");

    const { rows } = await pool.query<{ s: string }>(
      `select lifecycle_state::text as s from kitluy_devices.devices where id=$1::uuid`,
      [f.deviceId],
    );
    expect(rows[0]!.s).toBe("active");
  });

  /**
   * ===========================================================================
   * THE SIGNER, AND WHAT HAPPENS WHEN IT IS NOT THERE
   * ===========================================================================
   * Every row here asserts the same property from a different direction: a
   * request that cannot be honoured must leave NOTHING behind. A half-issued
   * identity — a spent generation slot, a credential with no artifact, an
   * `active` certificate row carrying no bytes — is worse than a clean refusal,
   * because the device's ONE generation-1 key slot is then gone for good.
   */
  it("refuses with OPCERT_CA_UNAVAILABLE when no signer is configured, and spends nothing", async () => {
    const f = await readyToIssue();
    const pop = proveePossession(f.csr, f.privateKeyPem);

    // A deliberately empty environment. Not a mocked CA — the real resolution
    // path, asked to run where no development PKI exists.
    const outcome = await issueFirstOperationalCertificate(
      pool,
      {
        deviceRecordId: f.deviceId,
        environment: ENVIRONMENT,
        assignmentGeneration: f.csr.assignmentGeneration,
        hardwareTrustLevel: "development_software",
        operationalPublicKeyPem: f.publicKeyPem,
        operationalKeyHandle: `opcert-suite:${f.requestId}`,
        proofOfPossession: pop,
        requestId: f.requestId,
        nonce: f.csr.nonce,
        correlationId: f.csr.correlationId,
        requestedAt: f.csr.requestedAt,
        trustedTimeStatus: "trusted",
        actorRef: "opcert-suite/no-ca",
      },
      {},
    );

    expect(outcome.outcome).toBe("REFUSED");
    if (outcome.outcome !== "REFUSED") return;
    expect(outcome.refusalCode).toBe("OPCERT_CA_UNAVAILABLE");

    // NOTHING RESERVED. The CA is loaded before `register_generation_key_v1`
    // runs, precisely so a missing signer cannot burn generation 1 — the slot
    // holds ONE key permanently, so a reservation spent for a certificate that
    // was never minted would strand the device with no way to ask again.
    const { rows } = await pool.query<{ keys: string; certs: string }>(
      `select (select count(*) from kitluy_devices.device_credentials
                where device_record_id = $1::uuid)::text as keys,
              (select count(*) from kitluy_devices.device_certificates
                where device_id = $1::uuid)::text as certs`,
      [f.deviceId],
    );
    expect(rows[0]).toEqual({ keys: "0", certs: "0" });

    // And the refusal names the FILE it wanted, never a key or a fragment of one.
    expect(outcome.detail).not.toMatch(/PRIVATE KEY|BEGIN [A-Z ]*KEY/);
  });

  it("cannot be pointed at pilot or production, even with a working CA", async () => {
    const f = await readyToIssue();
    const pop = proveePossession(f.csr, f.privateKeyPem);
    const at = (environment: string) =>
      issueFirstOperationalCertificate(pool, {
        deviceRecordId: f.deviceId,
        environment,
        assignmentGeneration: f.csr.assignmentGeneration,
        hardwareTrustLevel: "development_software",
        operationalPublicKeyPem: f.publicKeyPem,
        operationalKeyHandle: `opcert-suite:${f.requestId}`,
        proofOfPossession: pop,
        requestId: f.requestId,
        nonce: f.csr.nonce,
        correlationId: f.csr.correlationId,
        requestedAt: f.csr.requestedAt,
        trustedTimeStatus: "trusted",
        actorRef: "opcert-suite/environment",
      });

    // THROWS rather than refusing, and the difference is deliberate. A refusal
    // is a normal answer to a normal request; being asked to sign a PRODUCTION
    // certificate with a development CA is a misconfiguration that must not be
    // reachable, and BLK-005 blocks pilot and production outright.
    await expect(at("production")).rejects.toThrow(/BLK-005/);
    await expect(at("pilot")).rejects.toThrow(/BLK-005/);

    // Still nothing spent for either.
    const { rows } = await pool.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_certificates where device_id=$1::uuid`,
      [f.deviceId],
    );
    expect(rows[0]!.n).toBe("0");
  });
});
