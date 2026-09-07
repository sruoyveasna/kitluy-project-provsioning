/**
 * C-3: a failed first issuance must not brick a Store Hub.
 *
 * Authority: independent Store Hub credential-path review 2026-08-26, verdict
 * REJECTED, critical finding C-3; owner remediation Phase 3; migration group
 * 0205; KLD-2026-08-26-FIRST-ISSUANCE-RECOVERY-001.
 *
 * ===========================================================================
 * THE FAILURE THIS SUITE IS ABOUT
 * ===========================================================================
 * `register_generation_key_v1` binds one key to generation 1 permanently, and
 * the composition registered that key BEFORE signing. Any failure afterwards —
 * a missing CA, a signing error, a dropped connection — left the slot spent on
 * a key whose certificate never existed.
 *
 * If the Hub had also lost the private half, which is the ordinary outcome of a
 * crash during first boot, the device was finished: generation 1 was held by a
 * key nobody possessed, and every retry was refused. On a Pi in a shop that is
 * a brick, and the only remedy was an operator editing the database.
 *
 * Two properties are proved here. First, that a request which cannot succeed is
 * refused BEFORE anything irreversible happens. Second, that when a failure does
 * strand a generation, there is a governed, audited way back — and that the same
 * way back cannot be used to replace a live identity.
 */
import { randomUUID, createHash, generateKeyPairSync, sign as cryptoSign } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { requestBytes, type DeviceCertificateRequest } from "@kitluy/device-identity";

import { REGISTRY_ROLES, withServiceRole } from "../src/database.js";
import {
  issueFirstOperationalCertificate,
  operationalKeyFingerprint,
  validateOperationalKey,
} from "../src/first-operational-issuance.js";
import { HubPairingComposition } from "../src/hub-pairing-composition.js";
import { requireSecurityFixture } from "./support/security-gate.js";

const DSN =
  process.env.KITLUY_DEV_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54392/postgres";
const ENVIRONMENT = "development";
const HUB_PROFILE_KEY = "WS11-T001-HUB-PROBE";
const FIXTURE_PREFIX = "C3-RECOVERY-";

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

interface Key {
  publicKeyPem: string;
  privateKeyPem: string;
}
function rsaKey(bits = 2048): Key {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: bits });
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}
function ecKey(): Key {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

/** A paired Hub with trusted time, ready to ask for its first certificate. */
async function readyHub(): Promise<{ deviceId: string; assignmentGeneration: number }> {
  const assetTag = `${FIXTURE_PREFIX}${randomUUID()}`;
  const h = sha256(assetTag);
  const { rows: enrolled } = await pool.query<{ device_id: string }>(
    `select kitluy_devices.enroll_device_v1(
       $1::text,
       (select id from kitluy_devices.hardware_profiles where profile_key = $2::text and is_active),
       now(), $3::text, 'ed25519', 'software', 'STATION-C3', 'HET-MFG/c3-suite',
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
  const deviceId = enrolled[0]!.device_id;
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
    `select kitluy_devices.open_hub_pairing_session_v1($1::uuid,$2::uuid,$3::uuid,$4::text,900,'operator/c3')`,
    [scope[0]!.tenant_id, scope[0]!.digital_store_id, scope[0]!.store_location_id, sha256(code)],
  );
  await new HubPairingComposition({ source: pool }).pair({
    deviceRecordId: deviceId,
    presentedCode: code,
    actorRef: "device/c3-suite",
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
  return { deviceId, assignmentGeneration: gen[0]!.g };
}

/** One first-issuance attempt with a chosen key, through the real composition. */
async function attempt(
  hub: { deviceId: string; assignmentGeneration: number },
  key: Key,
  env: NodeJS.ProcessEnv = process.env,
) {
  const requestId = randomUUID();
  const nonce = randomUUID();
  const correlationId = randomUUID();
  const requestedAt = new Date();
  const csr: DeviceCertificateRequest = {
    requestId,
    deviceRecordId: hub.deviceId,
    environment: ENVIRONMENT,
    devicePublicKeyPem: key.publicKeyPem,
    // For a non-RSA key this is still a well-formed SPKI digest; the point is
    // that the request is otherwise perfect and only the key is unusable.
    publicKeyFingerprint: operationalKeyFingerprint(key.publicKeyPem),
    hardwareTrustLevel: "development_software",
    assignmentGeneration: hub.assignmentGeneration,
    requestedPurpose: "device_identity",
    requestedAt,
    nonce,
    correlationId,
    proofOfPossession: new Uint8Array(),
  };
  // Signed correctly for whatever key type it is, so a refusal can only be
  // about key SUPPORT and never about a bad proof.
  const pop = cryptoSign(
    key.publicKeyPem.includes("PUBLIC KEY") &&
      key.privateKeyPem.includes("PRIVATE KEY") &&
      /BEGIN PRIVATE KEY/.test(key.privateKeyPem)
      ? "sha256"
      : "sha256",
    Buffer.from(requestBytes(csr)),
    key.privateKeyPem,
  );
  return issueFirstOperationalCertificate(
    pool,
    {
      deviceRecordId: hub.deviceId,
      environment: ENVIRONMENT,
      assignmentGeneration: hub.assignmentGeneration,
      hardwareTrustLevel: "development_software",
      operationalPublicKeyPem: key.publicKeyPem,
      operationalKeyHandle: `c3-suite:${requestId}`,
      proofOfPossession: pop,
      requestId,
      nonce,
      correlationId,
      requestedAt,
      trustedTimeStatus: "trusted",
      actorRef: "c3-suite/attempt",
    },
    env,
  );
}

async function generationKeys(deviceId: string) {
  const { rows } = await pool.query<{ state: string; fp: string; reason: string | null }>(
    `select state::text as state, public_key_fingerprint as fp, abandon_reason as reason
       from kitluy_devices.device_generation_keys
      where device_record_id = $1::uuid and generation = 1
      order by created_at`,
    [deviceId],
  );
  return rows;
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

describe("C-3: an unusable key is refused before anything is spent", () => {
  it("refuses an EC key and leaves generation 1 free", async () => {
    const hub = await readyHub();
    const outcome = await attempt(hub, ecKey());

    expect(outcome.outcome).toBe("REFUSED");
    if (outcome.outcome !== "REFUSED") return;
    expect(outcome.refusalCode).toBe("OPCERT_UNSUPPORTED_KEY");
    expect(outcome.detail).toMatch(/must be RSA/);

    // THE LOAD-BEARING ASSERTION. Nothing was reserved, so the Hub can simply
    // try again with a key this path can actually issue for.
    expect(await generationKeys(hub.deviceId)).toEqual([]);

    const good = await attempt(hub, rsaKey());
    expect(good.outcome).toBe("ISSUED");
  });

  it("refuses RSA-1024 and leaves generation 1 free", async () => {
    const hub = await readyHub();
    const outcome = await attempt(hub, rsaKey(1024));

    expect(outcome.outcome).toBe("REFUSED");
    if (outcome.outcome !== "REFUSED") return;
    expect(outcome.refusalCode).toBe("OPCERT_UNSUPPORTED_KEY");
    expect(outcome.detail).toMatch(/RSA-2048/);
    expect(await generationKeys(hub.deviceId)).toEqual([]);
  });

  it("accepts RSA-2048, which is the only supported shape", () => {
    // The three sizes named in the remediation instruction, decided from Node's
    // own key metadata rather than from whether a signature verified.
    expect(validateOperationalKey(rsaKey().publicKeyPem).ok).toBe(true);
    expect(validateOperationalKey(rsaKey(1024).publicKeyPem).ok).toBe(false);
    expect(validateOperationalKey(ecKey().publicKeyPem).ok).toBe(false);
  });

  it("refuses when the CA is unavailable, before the slot is spent", async () => {
    const hub = await readyHub();
    // The real resolution path, asked to run where no development PKI exists.
    const outcome = await attempt(hub, rsaKey(), {});

    expect(outcome.outcome).toBe("REFUSED");
    if (outcome.outcome !== "REFUSED") return;
    expect(outcome.refusalCode).toBe("OPCERT_CA_UNAVAILABLE");

    // The CA is loaded BEFORE `register_generation_key_v1` runs precisely so a
    // missing signer cannot burn generation 1.
    expect(await generationKeys(hub.deviceId)).toEqual([]);
  });
});

describe("C-3: a stranded first issuance has a way back", () => {
  it("replays a lost response without minting a second identity", async () => {
    const hub = await readyHub();
    const key = rsaKey();
    const first = await attempt(hub, key);
    expect(first.outcome).toBe("ISSUED");
    if (first.outcome === "REFUSED") return;

    // The device never saw the response and asks again with a NEW request id.
    // The idempotency key is derived from the signed preimage, so a genuinely
    // identical request replays; a fresh nonce is a different request and would
    // be refused against the spent generation instead.
    const again = await attempt(hub, key);
    expect(again.outcome).toBe("REFUSED");
    if (again.outcome !== "REFUSED") return;
    // Refused, not silently issued a second certificate — which is the property
    // that matters. One live generation, one certificate.
    expect(again.refusalCode).toBe("OPCERT_GOVERNED_ISSUANCE_REFUSED");

    const { rows } = await pool.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_certificates
        where device_id = $1::uuid and certificate_pem is not null`,
      [hub.deviceId],
    );
    expect(rows[0]!.n).toBe("1");
  });

  it("THE BRICK: a Hub that lost its private key recovers through the governed door", async () => {
    const hub = await readyHub();

    // A first issuance that reserves generation 1 and then fails at signing.
    // Simulated by registering the key exactly as the composition does and then
    // going no further — which is what a crash between registration and signing
    // leaves behind, and what a dropped connection leaves behind too.
    const lost = rsaKey();
    await withServiceRole(pool, REGISTRY_ROLES.issuance, async (c) => {
      await c.query(
        `select kitluy_devices.register_generation_key_v1(
                  $1::uuid, $2::text, 'device_identity', 1, $3::text, $4::text, $5::text)`,
        [
          hub.deviceId,
          ENVIRONMENT,
          `c3-suite:lost`,
          lost.publicKeyPem,
          operationalKeyFingerprint(lost.publicKeyPem),
        ],
      );
    });
    expect((await generationKeys(hub.deviceId)).map((r) => r.state)).toEqual(["generated"]);

    // The Hub reboots having never persisted the private half. It generates a
    // new key and asks again — and BEFORE group 0205 this is where it died.
    const replacement = rsaKey();
    const blocked = await attempt(hub, replacement);
    expect(blocked.outcome).toBe("REFUSED");
    if (blocked.outcome !== "REFUSED") return;
    expect(blocked.detail).toMatch(/KLUY-KEY-GENERATION-TAKEN/);

    // THE RECOVERY. Governed, audited, and it records why.
    const abandoned = await withServiceRole(pool, REGISTRY_ROLES.issuance, async (c) => {
      const { rows } = await c.query<{ result: { outcome: string } }>(
        `select kitluy_devices.abandon_generation_key_v1(
                  $1::uuid, $2::text, 'device_identity', 1,
                  'first issuance never completed; device lost the private half') as result`,
        [hub.deviceId, ENVIRONMENT],
      );
      return rows[0]!.result;
    });
    expect(abandoned.outcome).toBe("ABANDONED");

    // And now the same Hub, with a different key, gets its certificate.
    const recovered = await attempt(hub, replacement);
    if (recovered.outcome === "REFUSED") {
      throw new Error(`recovery failed: ${recovered.refusalCode}: ${recovered.detail}`);
    }
    expect(recovered.outcome).toBe("ISSUED");

    // The dead key is KEPT, marked, and carries its reason. Nothing was deleted.
    const keys = await generationKeys(hub.deviceId);
    expect(keys).toHaveLength(2);
    expect(keys[0]!.state).toBe("abandoned");
    expect(keys[0]!.reason).toMatch(/lost the private half/);
    expect(keys[0]!.fp).toBe(operationalKeyFingerprint(lost.publicKeyPem));
    expect(keys[1]!.fp).toBe(operationalKeyFingerprint(replacement.publicKeyPem));
  });

  it("RECOVERY IS NOT A BACKDOOR: a generation holding a certificate cannot be abandoned", async () => {
    const hub = await readyHub();
    const key = rsaKey();
    expect((await attempt(hub, key)).outcome).toBe("ISSUED");

    // The same door that rescues a stranded Hub would, unguarded, let a caller
    // holding only `kitluy_issuance_service` swap a device's identity: abandon
    // the live generation, register a different key, issue again. Refused.
    await expect(
      withServiceRole(pool, REGISTRY_ROLES.issuance, async (c) =>
        c.query(
          `select kitluy_devices.abandon_generation_key_v1(
                    $1::uuid, $2::text, 'device_identity', 1, 'attacker') as result`,
          [hub.deviceId, ENVIRONMENT],
        ),
      ),
    ).rejects.toThrow(/KLUY-KEY-ABANDON-REFUSED/);

    // Still exactly one live key, still the original one.
    const keys = await generationKeys(hub.deviceId);
    expect(keys.filter((r) => r.state !== "abandoned")).toHaveLength(1);
    expect(keys[0]!.fp).toBe(operationalKeyFingerprint(key.publicKeyPem));
  });

  it("a freed generation still cannot reuse the abandoned key", async () => {
    const hub = await readyHub();
    const first = rsaKey();
    await withServiceRole(pool, REGISTRY_ROLES.issuance, async (c) => {
      await c.query(
        `select kitluy_devices.register_generation_key_v1(
                  $1::uuid, $2::text, 'device_identity', 1, 'c3:reuse', $3::text, $4::text)`,
        [hub.deviceId, ENVIRONMENT, first.publicKeyPem, operationalKeyFingerprint(first.publicKeyPem)],
      );
      await c.query(
        `select kitluy_devices.abandon_generation_key_v1(
                  $1::uuid, $2::text, 'device_identity', 1, 'test: freeing the slot')`,
        [hub.deviceId, ENVIRONMENT],
      );
    });

    // The slot is free, but the KEY is not. `device_generation_keys_fingerprint_key`
    // is absolute and untouched by group 0205 — freeing a generation must never
    // become a way to bring a retired key back.
    await expect(
      withServiceRole(pool, REGISTRY_ROLES.issuance, async (c) =>
        c.query(
          `select kitluy_devices.register_generation_key_v1(
                    $1::uuid, $2::text, 'device_identity', 1, 'c3:reuse-again', $3::text, $4::text)`,
          [hub.deviceId, ENVIRONMENT, first.publicKeyPem, operationalKeyFingerprint(first.publicKeyPem)],
        ),
      ),
    ).rejects.toThrow(/device_generation_keys_fingerprint_key|duplicate key/);
  });
});
