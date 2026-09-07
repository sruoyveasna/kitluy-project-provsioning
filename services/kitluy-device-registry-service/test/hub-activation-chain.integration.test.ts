/**
 * The whole chain, on a Hub that has never existed before:
 *
 *   pair -> trusted time -> certificate -> activation -> ACTIVE
 *
 * ===========================================================================
 * WHY THIS SUITE, WHEN EACH STEP IS ALREADY TESTED
 * ===========================================================================
 * Because the steps are owned by DIFFERENT identities in DIFFERENT transactions
 * and the only thing that proves they compose is running them in order:
 *
 *   kitluy_hub_pairing_service         redemption and assignment
 *   kitluy_activation_service          trusted time, activation
 *   kitluy_device_certificate_issuer   certificate issuance
 *
 * `set local role` dies with its transaction, so these cannot be one call. Every
 * previous confirmation that this chain works was a person running SQL by hand
 * once; this file is the executable version.
 *
 * The negative path is asserted BEFORE it is satisfied — a device that reaches
 * `active` in a suite that never showed it could be refused proves very little.
 *
 * FIXTURES DO NOT GROW THE FLEET. A bounded pool of asset tags is reused and
 * RELEASED between runs, the way `hub-pairing.integration.test.ts` does it — a
 * suite that minted a new device every run put 2,843 rows in this database once
 * already. Release closes rows, never deletes them: claims, assignments and
 * certificates are append-only.
 */
import { randomUUID, createHash, generateKeyPairSync, sign as cryptoSign } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { advanceDeviceTrust } from "../src/device-trust-advance.js";
import { operationalKeyFingerprint } from "../src/first-operational-issuance.js";
import type { OperationalCertificateRequest } from "../src/device-trust-advance.js";
import { REGISTRY_ROLES, withServiceRole } from "../src/database.js";
import { HubPairingComposition } from "../src/hub-pairing-composition.js";
import { requireSecurityFixture } from "./support/security-gate.js";
import { requestBytes } from "@kitluy/device-identity";

const DSN =
  process.env.KITLUY_HUB_PAIRING_DSN ?? "postgresql://postgres:postgres@127.0.0.1:54392/postgres";
const ENVIRONMENT = "development";
const HUB_PROFILE_KEY = "WS11-T001-HUB-PROBE";
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const sha256 = (v: string): string => createHash("sha256").update(v).digest("hex");

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

const FIXTURE_PREFIX = "CHAIN-FIXTURE";

/**
 * Close what a previous run left behind so the device is claimable again.
 * Mirrors the pairing suite's release, including the certificate: a fixture
 * walked back to `enrolled` while still holding an active credential is a state
 * no governed path can produce, and the next run would inherit it.
 */
async function releaseHub(deviceId: string): Promise<void> {
  await pool.query(
    `update kitluy_devices.device_claims set state = 'revoked', revoked_at = now()
      where device_id = $1::uuid and state = 'issued'`,
    [deviceId],
  );
  await pool.query(
    `update kitluy_devices.device_assignments set state = 'revoked', revoked_at = now()
      where device_id = $1::uuid and state in ('pending_trust', 'active')`,
    [deviceId],
  );
  await pool.query(
    `update kitluy_devices.device_certificates
        set status = 'revoked', revoked_at = now(), revocation_reason = 'fixture release'
      where device_id = $1::uuid and status = 'active'`,
    [deviceId],
  );
  await pool.query(
    `update kitluy_devices.devices set lifecycle_state = 'enrolled'
      where id = $1::uuid and lifecycle_state in ('awaiting_trust', 'active')`,
    [deviceId],
  );
  // TRUSTED TIME IS DELIBERATELY NOT RESET. An earlier draft of this helper
  // deleted the fixture's `device_trusted_time` row so each run would assert a
  // FIRST establishment, and the database refused it outright:
  // `KLUY-DEVICE-TIME-IMMUTABLE: trusted-time state is never deleted`.
  //
  // That refusal is correct and the draft was wrong — clearing a floor is
  // exactly the backdoor a monotonic floor exists to forbid, and a test helper
  // is not entitled to one. So this suite asserts on the DELTA instead: what one
  // advance adds, not what the device has accumulated. The never-advanced
  // negative-path fixture below is a separate slot that is never advanced at
  // all, which is how that assertion stays true on every run.
}

/**
 * A device that has NEVER existed before, on every run.
 *
 * This used to hand back a rolling slot (`...-01`, `...-02`) with its claims and
 * assignments revoked, and that worked for as long as the certificate step wrote
 * a metadata-only row a fixture could revoke. It cannot survive real issuance:
 * `register_generation_key_v1` binds ONE key to generation 1 PERMANENTLY, so the
 * second run of a reused slot is refused with `KLUY-KEY-GENERATION-TAKEN` —
 * correctly, because a device that could re-register generation 1 under a new
 * key could silently replace its own identity.
 *
 * So the slots are gone. Every device here is fresh and is RETIRED in
 * `afterAll`, which is the same shape the issuance suite arrived at for the same
 * reason, and it keeps the suite from growing the active fleet on every run.
 */
async function mintHub(): Promise<string> {
  return mintHubTagged(`${FIXTURE_PREFIX}-${randomUUID()}`);
}

async function mintHubTagged(assetTag: string): Promise<string> {
  const { rows: found } = await pool.query<{ id: string }>(
    `select id from kitluy_devices.devices where asset_tag = $1::text`,
    [assetTag],
  );
  const existing = found[0]?.id;
  if (existing !== undefined) {
    await releaseHub(existing);
    return existing;
  }

  // Signals derived from the asset tag: stable across runs, unique per slot.
  // Two devices sharing evidence is a security event that would quarantine the
  // previous slot's Hub (`KLUY-DEVICE-EVIDENCE-COLLISION`).
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
       now(), $3::text, 'ed25519', 'software', 'STATION-CHAIN', 'HET-MFG/chain-suite',
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

interface Scope {
  tenantId: string;
  digitalStoreId: string;
  storeLocationId: string;
}

/** Borrowed from an existing claim, exactly as the pairing suite does. */
async function borrowedScope(): Promise<Scope> {
  const { rows } = await pool.query<{
    tenant_id: string;
    digital_store_id: string;
    store_location_id: string;
  }>(
    `select tenant_id, digital_store_id, store_location_id
       from kitluy_devices.device_claims order by created_at desc limit 1`,
  );
  const r = rows[0]!;
  return {
    tenantId: r.tenant_id,
    digitalStoreId: r.digital_store_id,
    storeLocationId: r.store_location_id,
  };
}

/** Opened the way the Partner Portal opens it: store scope, no device. */
async function openSession(code: string, scope: Scope): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `select kitluy_devices.open_hub_pairing_session_v1(
              $1::uuid, $2::uuid, $3::uuid, $4::text, 900, 'operator/chain-suite') as id`,
    [scope.tenantId, scope.digitalStoreId, scope.storeLocationId, sha256(code)],
  );
  return rows[0]!.id;
}

async function trustedTimeEventCount(device: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    `select count(*)::int as n from kitluy_devices.device_trusted_time_events
      where device_id = $1::uuid`,
    [device],
  );
  return rows[0]!.n;
}

async function lifecycleOf(device: string): Promise<string> {
  const { rows } = await pool.query<{ s: string }>(
    `select lifecycle_state::text as s from kitluy_devices.devices where id = $1::uuid`,
    [device],
  );
  return rows[0]!.s;
}

beforeAll(() => {
  pool = new pg.Pool({ connectionString: DSN, max: 6 });
});
afterAll(async () => {
  // Retire what this run created. Devices are never deleted — the fleet record
  // is append-only — so `retired` is the correct end state, not a DELETE.
  await pool
    ?.query(
      `update kitluy_devices.devices set lifecycle_state = 'retired', retired_at = now()
        where asset_tag like $1 and lifecycle_state <> 'retired'`,
      [`${FIXTURE_PREFIX}-%-%`],
    )
    .catch(() => undefined);
  await pool?.end().catch(() => undefined);
});

/**
 * The DEVICE half of the chain: an operational key and a signed `kitluy.csr.v1`.
 *
 * Generated here because the firstboot client that will do this on a real Hub is
 * the NEXT step, not this one. What matters for this suite is that the private
 * key exists only in this process and that the control plane never sees it —
 * exactly the property a Hub-held key has, and the reason the server cannot
 * simply mint a certificate on the device's behalf.
 */
async function deviceCertificateRequest(
  deviceRecordId: string,
): Promise<OperationalCertificateRequest> {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  const { rows } = await pool.query<{ g: number }>(
    `select assignment_generation as g from kitluy_devices.devices where id = $1::uuid`,
    [deviceRecordId],
  );
  const assignmentGeneration = rows[0]!.g;
  const requestedAt = new Date();
  const nonce = randomUUID();
  const correlationId = randomUUID();
  const requestId = randomUUID();

  // The preimage the SERVER will rebuild. Signed by the device, over its own
  // key's fingerprint — a request signed with a key the device does not hold
  // fails `OPCERT_POSSESSION_PROOF_FAILED`, which the issuance suite proves.
  const proofOfPossession = cryptoSign(
    "sha256",
    Buffer.from(
      requestBytes({
        requestId,
        deviceRecordId,
        environment: ENVIRONMENT,
        devicePublicKeyPem: publicKeyPem,
        publicKeyFingerprint: operationalKeyFingerprint(publicKeyPem),
        hardwareTrustLevel: "development_software",
        assignmentGeneration,
        requestedPurpose: "device_identity",
        requestedAt,
        nonce,
        correlationId,
        proofOfPossession: new Uint8Array(),
      }),
    ),
    privateKeyPem,
  );

  return {
    assignmentGeneration,
    hardwareTrustLevel: "development_software",
    operationalPublicKeyPem: publicKeyPem,
    operationalKeyHandle: `chain-suite:${requestId}`,
    proofOfPossession,
    requestId,
    nonce,
    correlationId,
    requestedAt,
  };
}

describe("pair -> trusted time -> certificate -> activation -> ACTIVE", () => {
  it("runs the whole chain on a Hub that has never existed before", async () => {
    const device = await mintHub();
    const scope = await borrowedScope();
    const code = freshCode();
    await openSession(code, scope);

    // 1. PAIRING. The device presents a code and chooses nothing else: the
    //    session already knows the tenant, Digital Store and Store Location.
    const composition = new HubPairingComposition({ source: pool });
    const paired = await composition.pair({
      deviceRecordId: device,
      presentedCode: code,
      actorRef: "device/chain-suite",
    });
    expect(paired.result).toBe("PAIRED");
    expect(paired.data!.storeLocationId).toBe(scope.storeLocationId);
    expect(paired.data!.tenantId).toBe(scope.tenantId);
    expect(paired.data!.digitalStoreId).toBe(scope.digitalStoreId);

    // Pairing ASSIGNS; it does not activate. Asserted before the rest runs.
    expect(await lifecycleOf(device)).toBe("awaiting_trust");

    // 2. THE COMPOSITION. Trusted time, certificate and activation, each in its
    //    own transaction under its own identity.
    const eventsBefore = await trustedTimeEventCount(device);
    const advanced = await advanceDeviceTrust(pool, {
      deviceRecordId: device,
      environment: ENVIRONMENT,
      actorRef: "device/hub-pairing",
      operationalRequest: await deviceCertificateRequest(device),
    });

    expect(advanced).toEqual({
      kind: "advanced",
      lifecycleState: "active",
      trustedTimeStatus: "trusted",
      certificate: "ISSUED",
    });
    expect(await lifecycleOf(device)).toBe("active");

    // 3. The trusted time it landed on came from the authority's own clock.
    const { rows: tt } = await pool.query<{ status: string; last_source: string }>(
      `select status, last_source::text as last_source
         from kitluy_devices.device_trusted_time where device_id = $1::uuid`,
      [device],
    );
    expect(tt[0]!.status).toBe("trusted");
    expect(tt[0]!.last_source).toBe("cloud_authoritative");

    // 4. DEFECT A, MEASURED. One advance must add EXACTLY ONE trusted-time
    //    event. `select (fn(...)).*` added seven, because PostgreSQL
    //    re-evaluates a composite once per field and the outcome type has seven.
    expect((await trustedTimeEventCount(device)) - eventsBefore).toBe(1);

    // 5. Exactly one active certificate, and the device holds it.
    const { rows: cert } = await pool.query<{ n: number }>(
      `select count(*)::int as n from kitluy_devices.device_certificates
        where device_id = $1::uuid and status = 'active'`,
      [device],
    );
    expect(cert[0]!.n).toBe(1);
  });

  it("REFUSES activation while trusted time is unestablished, and names the clock", async () => {
    // A DEDICATED tag this suite pairs and NEVER advances, so it has no
    // trusted-time row on any run. It cannot be a rolling slot: trusted-time
    // state is immutable (`KLUY-DEVICE-TIME-IMMUTABLE`), so the first slot that
    // ever gets advanced is burned for this assertion for ever. The negative
    // path has to stay reachable after the positive one starts working, or it
    // stops being evidence.
    const device = await mintHubTagged("CHAIN-NEG-01");
    const scope = await borrowedScope();
    const code = freshCode();
    await openSession(code, scope);
    const paired = await new HubPairingComposition({ source: pool }).pair({
      deviceRecordId: device,
      presentedCode: code,
      actorRef: "device/chain-suite",
    });
    expect(paired.result).toBe("PAIRED");
    expect(await lifecycleOf(device)).toBe("awaiting_trust");

    await expect(
      pool.query(`select kitluy_devices.assert_trusted_time_v1($1::uuid, 'activation')`, [device]),
    ).rejects.toThrow(/KLUY-DEVICE-TIME-(UNTRUSTED|RESTRICTED)/);

    // And activation itself refuses, naming the gate rather than failing opaquely.
        // Entered explicitly, as the product does. This call used to run as the
    // bare connection identity and reached the door through `service_role`'s
    // inherited membership of `kitluy_activation_service` — the chain group 0206
    // cut to close finding C-4. Activation is a governed capability now, not an
    // ambient one.
    const { rows } = await withServiceRole(pool, REGISTRY_ROLES.activation, async (c) =>
      c.query<{ outcome: string; refusal_code: string | null }>(
        `select outcome, refusal_code
         from kitluy_devices.attempt_activate_device_v1($1::uuid, $2::text, 'chain-suite/negative')`,
        [device, ENVIRONMENT],
      ),
    );
    expect(rows[0]!.outcome).toBe("REFUSED");
    expect(rows[0]!.refusal_code).toMatch(/KLUY-DEVICE-(TIME|NO-CERTIFICATE)/);
  });

  it("a second advance mints no second certificate and leaves the Hub active", async () => {
    const device = await mintHub();
    const scope = await borrowedScope();
    const code = freshCode();
    await openSession(code, scope);
    await new HubPairingComposition({ source: pool }).pair({
      deviceRecordId: device,
      presentedCode: code,
      actorRef: "device/chain-suite",
    });

    const request = await deviceCertificateRequest(device);
    const first = await advanceDeviceTrust(pool, {
      deviceRecordId: device,
      environment: ENVIRONMENT,
      actorRef: "device/hub-pairing",
      operationalRequest: request,
    });
    expect(first.kind).toBe("advanced");

    // THE SAME REQUEST REPLAYED, as a Hub retrying a dropped response would send
    // it — same key, same nonce, same signature. A retry must not mint a second
    // identity.
    const second = await advanceDeviceTrust(pool, {
      deviceRecordId: device,
      environment: ENVIRONMENT,
      actorRef: "device/hub-pairing",
      operationalRequest: request,
    });
    expect(second.kind).toBe("advanced");
    if (second.kind === "advanced") {
      // `REPLAYED`, and the change from `KLUY-DEVCERT-STATE` is the point.
      //
      // This step used to call `issue_development_device_certificate_v1`, whose
      // state gate refused an already-active device before it could reach its
      // idempotence branch. That door wrote a metadata-only row that group 0201
      // will no longer accept as a certificate, so it is gone from this path;
      // the governed composition answers instead, and its idempotence is keyed
      // on the CREDENTIAL rather than on lifecycle state. A retry therefore
      // returns the certificate the device already holds.
      //
      // Asserted verbatim rather than loosely: `REPLAYED` and a refusal code
      // mean different things to an operator.
      expect(second.certificate).toBe("REPLAYED");
      expect(second.lifecycleState).toBe("active");
    }

    const { rows } = await pool.query<{ n: number }>(
      `select count(*)::int as n from kitluy_devices.device_certificates
        where device_id = $1::uuid and status = 'active'`,
      [device],
    );
    expect(rows[0]!.n).toBe(1);
  });
});
