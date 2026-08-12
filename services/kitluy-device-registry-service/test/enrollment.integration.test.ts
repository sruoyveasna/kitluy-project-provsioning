/**
 * Factory enrollment, end to end against a REAL database.
 *
 * Everything below this line has been proven separately: migration `0190`'s
 * doors directly in SQL, the routes with a stubbed composition, the PoP and the
 * time token as pure functions. What none of that proves is that the pieces
 * fit — a route that calls the door with arguments in the wrong order, or a
 * composition that maps a real refusal to the wrong result, passes every one of
 * those tests and fails on the first real device.
 *
 * So this drives the ACTUAL router over the ACTUAL composition against the
 * ACTUAL governed doors, with a real Ed25519 key signing a real challenge.
 * Nothing is stubbed except the clock.
 *
 * IT COMMITS, for the same reason `hub-provisioning-e2e.db.test.ts` does: an
 * enrollment that exists only inside one transaction has not been enrolled.
 * `withServiceRole` owns its own transaction per door call — that is the
 * production behaviour, and forcing the test to share a transaction would mean
 * testing something the service never does. Fixtures are uniquely named per
 * run, so repeated runs accumulate dev rows rather than colliding.
 */
import {
  generateKeyPairSync,
  createPublicKey,
  createHash,
  randomUUID,
  sign as nodeSign,
} from "node:crypto";

import {
  manufacturingEnrollmentChallengeBytes,
  MANUFACTURING_ENROLLMENT_POP_PURPOSE,
  type SnapshotSigningKeyReference,
} from "@kitluy/device-identity";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { EnrollmentComposition } from "../src/enrollment-composition.js";
import { createEd25519SnapshotSigner } from "../src/snapshot-signer.js";
import { createEnrollmentRouter, DEVICE_ENROLLMENT_PREFIX } from "../src/enrollment-routes.js";
import { BootstrapRateLimiter, type BootstrapRouteRequest } from "../src/provisioning-routes.js";

/**
 * Group 0190 is applied to the PG17 stack. Overridable, because a developer
 * with a different local layout should be able to point this at their own.
 */
const DSN =
  process.env.KITLUY_ENROLLMENT_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54392/postgres";

async function reachable(): Promise<boolean> {
  const probe = new pg.Pool({ connectionString: DSN, max: 1, connectionTimeoutMillis: 2000 });
  try {
    // Presence of the 0190 door, not merely of a server: pointing this at a
    // database without the group would produce confusing failures rather than
    // an honest skip.
    const { rows } = await probe.query<{ n: string }>(
      `select count(*) as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'kitluy_devices'
          and p.proname = 'redeem_manufacturing_enrollment_ticket_v1'`,
    );
    return Number(rows[0]?.n ?? 0) === 1;
  } catch {
    return false;
  } finally {
    await probe.end().catch(() => undefined);
  }
}

const live = await reachable();
if (!live) {
  console.warn(`SKIPPED: enrollment integration — no 0190-bearing database at ${DSN}`);
}

const TIME_KEY_ENV = "KITLUY_TEST_ENROLLMENT_TIME_KEY";

function fingerprintOf(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  return createHash("sha256").update(new Uint8Array(der)).digest("hex");
}

describe.skipIf(!live)("factory enrollment — device to database", () => {
  let pool: pg.Pool | undefined;

  afterAll(async () => {
    await pool?.end().catch(() => undefined);
  });

  it("enrolls a fresh terminal and leaves it UNASSIGNED", async () => {
    pool = new pg.Pool({ connectionString: DSN, max: 4 });

    // An ephemeral signing key for the time token. Generated per run and held
    // only in this process's env — never written, never committed.
    const timeKey = generateKeyPairSync("ed25519");
    const env: Record<string, string> = {
      [TIME_KEY_ENV]: timeKey.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    };
    const keyReference: SnapshotSigningKeyReference = {
      secretEnvVar: TIME_KEY_ENV,
      keyId: "enrollment-time-test",
      keyVersion: 1,
    };

    // The device's own key pair — the thing possession is proven of.
    const deviceKey = generateKeyPairSync("ed25519");
    const devicePublicKeyPem = deviceKey.publicKey
      .export({ type: "spki", format: "pem" })
      .toString();
    const deviceFingerprint = fingerprintOf(devicePublicKeyPem);

    // --- Fixtures -----------------------------------------------------
    // A terminal hardware profile does not exist in the canonical database
    // yet (only WS11-T001-HUB-PROBE, a store_hub). This is an explicit test
    // fixture and is NOT a governed profile — see the report.
    const profileKey = `ENR-INT-${randomUUID().slice(0, 8)}`;
    const { rows: profileRows } = await pool.query<{ id: string }>(
      `insert into kitluy_devices.hardware_profiles
           (profile_key, display_name, device_class, manufacturer, model_identifier,
            hardware_revision, required_signal_types, secure_element_expectation,
            certification_status, profile_version, is_active)
         values ($1, 'enrollment integration probe', 'terminal', 'Raspberry Pi', 'Pi 5', '1.0',
                 '{mac_address,board_serial,storage_serial}', 'development_software',
                 'CERTIFIED', 1, true)
         returning id`,
      [profileKey],
    );
    const profileId = profileRows[0]?.id;
    expect(profileId).toBeDefined();

    // The flash-time ticket. The SECRET exists only here and on the device;
    // the database stores its digest.
    const ticketReference = `KL-TKT-${randomUUID().slice(0, 8)}`;
    const ticketSecret = randomUUID();
    const ticketDigest = createHash("sha256").update(ticketSecret, "utf8").digest("hex");

    // Role-scoped inside a transaction: session-level `set role` segfaults
    // these local stacks (KLREC-2026-08-11-EDGE-006).
    const issuer = await pool.connect();
    let issued;
    try {
      await issuer.query("begin");
      await issuer.query(`set local role kitluy_fleet_service`);
      issued = await issuer.query<{ result: Record<string, unknown> }>(
        `select kitluy_devices.issue_manufacturing_enrollment_ticket_v1(
             $1, $2, $3::uuid, 'development', 'flash-station-int', 'operator/flash', 'operator/test', 24, null
           ) as result`,
        [ticketReference, ticketDigest, profileId],
      );
      await issuer.query("commit");
    } finally {
      issuer.release();
    }
    expect(issued.rows[0]?.result.outcome).toBe("ISSUED");

    // --- The real stack, on the real pool ------------------------------
    // The composition opens its own transaction per door call through
    // `withServiceRole`, exactly as it does in production.
    const source = { connect: () => pool!.connect() };
    const audit: Record<string, unknown>[] = [];
    const composition = new EnrollmentComposition({
      source,
      signer: createEd25519SnapshotSigner({ env }),
      timeKeyReference: keyReference,
      // The REAL clock, deliberately. The challenge's expiry is written by
      // the database's `now()`, so a frozen test clock that disagreed with it
      // would judge a live challenge expired — which is exactly what a
      // hardcoded 10:00Z did against a container sitting at 03:00Z.
      logger: { info: (fields) => void audit.push({ ...fields }) },
    });
    const router = createEnrollmentRouter({
      composition,
      rateLimiter: new BootstrapRateLimiter({ now: () => 0 }),
      logger: { info: (fields) => void audit.push({ ...fields }) },
    });

    const call = (path: string, body: unknown): BootstrapRouteRequest => ({
      method: "POST",
      path,
      headers: { "content-type": "application/json" },
      sourceIp: "10.9.9.9",
      rawBody: JSON.stringify(body),
    });

    // --- 1. Challenge over HTTP ---------------------------------------
    const challengeResponse = await router.handle(
      call(`${DEVICE_ENROLLMENT_PREFIX}/challenges`, {
        ticketReference,
        ticketDigest,
        publicKeyFingerprint: deviceFingerprint,
        publicKeyPem: devicePublicKeyPem,
        publicKeyAlgorithm: "ed25519",
        keyStorageClass: "software",
      }),
    );
    expect(challengeResponse.status).toBe(201);

    const challenge = (
      challengeResponse.body as {
        challenge: {
          challengeId: string;
          nonce: string;
          issuedAt: string;
          expiresAt: string;
          presentedKeyFingerprint: string;
        };
      }
    ).challenge;
    expect(challenge.challengeId).toBeDefined();

    // --- 2. Prove possession -------------------------------------------
    // Signed with the SHARED canonicalizer. The device's own copy is proven
    // byte-identical to it by `enrollment-pop-drift.test.ts`, so using it
    // here would re-test drift through a brittle cross-package import
    // instead of testing what this file exists to test.
    const signature = nodeSign(
      null,
      Buffer.from(
        manufacturingEnrollmentChallengeBytes({
          challengeId: challenge.challengeId,
          purpose: MANUFACTURING_ENROLLMENT_POP_PURPOSE,
          environment: "development",
          presentedKeyFingerprint: challenge.presentedKeyFingerprint,
          nonce: challenge.nonce,
          issuedAt: new Date(challenge.issuedAt),
          expiresAt: new Date(challenge.expiresAt),
        }),
      ),
      deviceKey.privateKey,
    );

    // --- 3. Redeem over HTTP ------------------------------------------
    const redemption = await router.handle(
      call(`${DEVICE_ENROLLMENT_PREFIX}/redemptions`, {
        challengeId: challenge.challengeId,
        signature: Buffer.from(signature).toString("base64url"),
        publicKeyPem: devicePublicKeyPem,
        assetTag: `INT-${randomUUID().slice(0, 8)}`,
        nonce: challenge.nonce,
        presentedKeyFingerprint: challenge.presentedKeyFingerprint,
        issuedAt: challenge.issuedAt,
        expiresAt: challenge.expiresAt,
        signals: [
          { signal_type: "mac_address", signal_value: `aa:bb:cc:${randomUUID().slice(0, 2)}:${randomUUID().slice(0, 2)}:${randomUUID().slice(0, 2)}` },
          { signal_type: "board_serial", signal_value: `BRD-${randomUUID().slice(0, 8)}` },
          { signal_type: "storage_serial", signal_value: `NVM-${randomUUID().slice(0, 8)}` },
        ],
      }),
    );

    // Surfacing the audit trail turns an opaque 403 into the actual cause.
    if (redemption.status !== 201) {
      // eslint-disable-next-line no-console -- the diagnosis IS the value here
      console.error("redemption refused:", JSON.stringify(audit), JSON.stringify(redemption.body));
    }
    expect(redemption.status).toBe(201);
    const enrolled = redemption.body as {
      deviceRecordId: string;
      fleetEnrollment: string;
      storeAssignment: string;
      trustedTimeToken: { token: { deviceRecordId: string; challengeId: string } };
    };

    expect(enrolled.fleetEnrollment).toBe("enrolled");
    expect(enrolled.storeAssignment).toBe("unassigned");

    // --- 4. The database agrees ---------------------------------------
    const { rows: device } = await pool.query<{
      device_class: string;
      lifecycle_state: string;
      production_eligible: boolean;
    }>(
      `select device_class::text, lifecycle_state::text, production_eligible
           from kitluy_devices.devices where id = $1::uuid`,
      [enrolled.deviceRecordId],
    );
    expect(device[0]?.device_class).toBe("terminal");
    expect(device[0]?.lifecycle_state).toBe("enrolled");
    expect(device[0]?.production_eligible).toBe(false);

    // THE invariant this whole stage exists to protect (KLSRC-0162 §35).
    const { rows: assignments } = await pool.query<{ n: string }>(
      `select count(*) as n from kitluy_devices.device_assignments where device_id = $1::uuid`,
      [enrolled.deviceRecordId],
    );
    expect(Number(assignments[0]?.n)).toBe(0);

    // --- 5. The time token is bound to THIS device and THIS exchange ---
    expect(enrolled.trustedTimeToken.token.deviceRecordId).toBe(enrolled.deviceRecordId);
    expect(enrolled.trustedTimeToken.token.challengeId).toBe(challenge.challengeId);

    // --- 6. Replay is refused ------------------------------------------
    const replay = await router.handle(
      call(`${DEVICE_ENROLLMENT_PREFIX}/challenges`, {
        ticketReference,
        ticketDigest,
        publicKeyFingerprint: deviceFingerprint,
        publicKeyPem: devicePublicKeyPem,
        publicKeyAlgorithm: "ed25519",
        keyStorageClass: "software",
      }),
    );
    expect(replay.status).not.toBe(201);
  });
});
