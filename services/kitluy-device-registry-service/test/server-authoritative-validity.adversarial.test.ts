/**
 * C-2: the caller does not choose when its certificate is valid.
 *
 * Authority: independent Store Hub credential-path review 2026-08-26, verdict
 * REJECTED, critical finding C-2; owner remediation Phase 2; migration group
 * 0204.
 *
 * ===========================================================================
 * WHAT WAS WRONG
 * ===========================================================================
 * `prepare_device_credential_issuance_v1` took a caller-supplied
 * `p_trusted_time timestamptz` and assigned it straight to `not_before`, three
 * lines below a comment claiming the window was "computed HERE, never accepted
 * from the caller". The composition filled that parameter from the HUB's own
 * `requestedAt`, so a device dated its own certificate.
 *
 * This is R-1 at a second door. Group 0198 removed caller-supplied timestamps
 * from the trusted-time bridge after an external review advanced a device's
 * monotonic floor ten years through exactly this shape; the shape survived one
 * door along, and this suite is the reason it cannot survive a third time.
 *
 * Each case below sends a hostile `requestedAt` through the REAL composition and
 * then reads the window the database actually recorded.
 */
import { randomUUID, createHash, generateKeyPairSync, sign as cryptoSign } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { requestBytes, type DeviceCertificateRequest } from "@kitluy/device-identity";

import { REGISTRY_ROLES, withServiceRole } from "../src/database.js";
import {
  issueFirstOperationalCertificate,
  operationalKeyFingerprint,
} from "../src/first-operational-issuance.js";
import { HubPairingComposition } from "../src/hub-pairing-composition.js";
import { requireSecurityFixture } from "./support/security-gate.js";

const DSN =
  process.env.KITLUY_DEV_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54392/postgres";
const ENVIRONMENT = "development";
const HUB_PROFILE_KEY = "WS11-T001-HUB-PROBE";
const FIXTURE_PREFIX = "C2-TIME-";
const MS_PER_DAY = 86_400_000;

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

/** Issue for a brand new Hub, with `requestedAt` set to whatever we like. */
async function issueWithRequestedAt(requestedAt: Date): Promise<{
  notBefore: Date;
  notAfter: Date;
  deviceId: string;
}> {
  const assetTag = `${FIXTURE_PREFIX}${randomUUID()}`;
  const h = sha256(assetTag);
  const { rows: enrolled } = await pool.query<{ device_id: string }>(
    `select kitluy_devices.enroll_device_v1(
       $1::text,
       (select id from kitluy_devices.hardware_profiles where profile_key = $2::text and is_active),
       now(), $3::text, 'ed25519', 'software', 'STATION-C2', 'HET-MFG/c2-suite',
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
    `select kitluy_devices.open_hub_pairing_session_v1($1::uuid,$2::uuid,$3::uuid,$4::text,900,'operator/c2')`,
    [scope[0]!.tenant_id, scope[0]!.digital_store_id, scope[0]!.store_location_id, sha256(code)],
  );
  await new HubPairingComposition({ source: pool }).pair({
    deviceRecordId: deviceId,
    presentedCode: code,
    actorRef: "device/c2-suite",
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
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const requestId = randomUUID();
  const nonce = randomUUID();
  const correlationId = randomUUID();

  // THE HOSTILE VALUE. It is signed into the CSR too, so this is not a mangled
  // request — it is a perfectly valid, properly proven request that happens to
  // claim an absurd time.
  const csr: DeviceCertificateRequest = {
    requestId,
    deviceRecordId: deviceId,
    environment: ENVIRONMENT,
    devicePublicKeyPem: publicKeyPem,
    publicKeyFingerprint: operationalKeyFingerprint(publicKeyPem),
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
    operationalPublicKeyPem: publicKeyPem,
    operationalKeyHandle: `c2-suite:${requestId}`,
    proofOfPossession: cryptoSign("sha256", Buffer.from(requestBytes(csr)), privateKeyPem),
    requestId,
    nonce,
    correlationId,
    requestedAt,
    trustedTimeStatus: "trusted",
    actorRef: "c2-suite/hostile-time",
  });
  if (outcome.outcome === "REFUSED") {
    throw new Error(`${outcome.refusalCode}: ${outcome.detail}`);
  }

  // Read the window the DATABASE recorded, not the one the outcome reported.
  const { rows } = await pool.query<{ nb: Date; na: Date }>(
    `select not_before as nb, not_after as na from kitluy_devices.device_credentials
      where credential_id = $1::uuid`,
    [outcome.credentialId],
  );
  return { notBefore: rows[0]!.nb, notAfter: rows[0]!.na, deviceId };
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

describe("C-2: the validity anchor is the server's, whatever the caller claims", () => {
  // Generous, because this asserts "the server used its own clock", not "the
  // clocks agree to the millisecond". A window anchored to a caller's value
  // would be out by years, not by seconds.
  const TOLERANCE_MS = 5 * 60_000;

  const cases: ReadonlyArray<{ name: string; at: () => Date }> = [
    { name: "now + 10 years", at: () => new Date(Date.now() + 3650 * MS_PER_DAY) },
    { name: "now - 31 days", at: () => new Date(Date.now() - 31 * MS_PER_DAY) },
    { name: "the unix epoch", at: () => new Date(0) },
    // Not "malformed" as a string — `requestedAt` is a `Date`, so the reachable
    // hostile shape is an absurd but VALID instant. A genuinely unparseable
    // value is covered by the CSR canonicalisation, which refuses it before any
    // door sees it.
    { name: "the year 9999", at: () => new Date("9999-12-31T23:59:59.000Z") },
  ];

  for (const testCase of cases) {
    it(`ignores a requestedAt of ${testCase.name}`, async () => {
      const before = new Date();
      const { notBefore, notAfter } = await issueWithRequestedAt(testCase.at());
      const after = new Date();

      // The window opens NOW, on the server's clock — within the bracket this
      // test itself observed, which no caller-supplied value could land inside.
      expect(notBefore.getTime()).toBeGreaterThanOrEqual(before.getTime() - TOLERANCE_MS);
      expect(notBefore.getTime()).toBeLessThanOrEqual(after.getTime() + TOLERANCE_MS);

      // And it is a 30-day development lifetime measured from there, not from
      // whatever the caller asked for.
      expect(notAfter.getTime() - notBefore.getTime()).toBe(30 * MS_PER_DAY);
    });
  }

  it("STRUCTURAL: the door cannot derive its anchor from a parameter", async () => {
    // The behavioural cases above prove today's build. This one prevents the
    // regression: group 0198 fixed exactly this shape at the trusted-time
    // bridge, and it came back at the next door because nothing was watching the
    // source. Now something is.
    const { rows } = await pool.query<{ src: string; cfg: string[] }>(
      `select prosrc as src, proconfig as cfg
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'kitluy_devices'
          and p.proname = 'prepare_device_credential_issuance_v1'`,
    );
    const source = rows[0]!.src;

    expect(source).not.toMatch(/v_not_before\s*:=\s*[^;]*p_trusted_time/);
    expect(source).toMatch(/v_authoritative_now\s*:=\s*date_trunc\('milliseconds', kitluy_ops\.authoritative_now_v1\(\)\)/);
    expect(source).toMatch(/v_not_before\s*:=\s*v_authoritative_now/);

    // pg_catalog must LEAD the search_path. It used to trail it, and a reviewer
    // forged `cloud_authoritative` trusted time through precisely that gap by
    // shadowing `now()`.
    expect(rows[0]!.cfg[0]).toBe("search_path=pg_catalog, kitluy_devices, kitluy_ops, extensions");
  });

  it("STRUCTURAL: no overload grows a second timestamp argument", async () => {
    // The R-1 protection group 0198 established, applied to this door. One
    // inert `p_trusted_time` remains for contract compatibility; a second
    // timestamp parameter would mean someone reintroduced the shape.
    const { rows } = await pool.query<{ n: string }>(
      `select count(*)::text as n
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         join unnest(p.proargtypes) as t(oid) on true
        where n.nspname = 'kitluy_devices'
          and p.proname = 'prepare_device_credential_issuance_v1'
          and t.oid = 'timestamptz'::regtype`,
    );
    expect(rows[0]!.n).toBe("1");
  });
});
