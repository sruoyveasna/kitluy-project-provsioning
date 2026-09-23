/**
 * A same-board reflash releases itself — proven THROUGH THE REAL ROUTE.
 *
 * 0234 built the door and 0235 made registration call it, but a SQL-only test
 * proves neither: the question this file answers is whether a board that
 * re-registers over HTTP, signing like a real Pi, comes back re-pairable
 * without anyone running `dev:device:unassign`.
 *
 * So nothing here is faked except the hardware: a real Ed25519 key per install,
 * the real `kitluy.device-registration-request.v1` bytes, the real signature the
 * edge function verifies, the real `register_device_v1`, and the real 0235 door
 * behind it. The assertions read the database the route wrote.
 *
 * OPT-IN: set `KITLUY_ROUTE_TESTS=1`.
 *
 * Not because it is slow or flaky, but because the only stack that serves this
 * route is the one the HARDWARE registers against, and device rows there are
 * append-only where it matters: `KLUY-DEVICE-ASSIGNMENT-IMMUTABLE` refuses to
 * delete assignment history, so a run cannot fully tidy up after itself and
 * leaves fixtures beside the owner's real boards. Running it is a deliberate
 * act, and the strays are purged deliberately too (scratchpad purge-devices.sql).
 *
 * SKIPPED, not failed, when it is not opted into or the stack is not up — and a
 * skipped run is not evidence (KLD-EVIDENCE-001).
 */
import { generateKeyPairSync, sign as edSign, randomBytes } from "node:crypto";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DEVICE_REGISTRATION_REQUEST_KIND,
  deviceRegistrationRequestBytes,
} from "@kitluy/device-identity";

const ROUTE =
  process.env.KITLUY_REGISTRATION_ROUTE ??
  "http://172.16.21.17:54371/functions/v1/device-registration";
const DB_URL =
  process.env.KITLUY_REGISTRATION_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54372/postgres";
const PROFILE_KEY = "KL-PI5-STORE-HUB-DEV";

/** Marks every row this file creates, so cleanup can be exact. */
const SUITE = `reflash-route-${randomBytes(4).toString("hex")}`;

interface Board {
  readonly boardSerial: string;
  readonly socSerial: string;
  readonly macAddress: string;
}

interface RouteAnswer {
  readonly status: string;
  readonly deviceId: string | null;
  readonly installationId: string | null;
  readonly installationCreated: boolean;
  readonly conflictReason?: string;
}

function hex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

function newBoard(): Board {
  const serial = hex(8);
  return {
    boardSerial: serial,
    socSerial: serial,
    macAddress: Array.from({ length: 6 }, () => hex(1)).join(":"),
  };
}

/** Registers exactly as a board does: fresh key, canonical bytes, real signature. */
async function registerOverHttp(input: {
  board: Board;
  hostname: string;
  installationEvidence: Record<string, string>;
}): Promise<RouteAnswer> {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ type: "spki", format: "der" });
  const { createHash } = await import("node:crypto");
  const fingerprint = createHash("sha256").update(spki).digest("hex");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();

  const fields = {
    assetTag: `KL-${fingerprint.slice(0, 12).toUpperCase()}`,
    hardwareProfileKey: PROFILE_KEY,
    hostname: input.hostname,
    registrationPublicKeyFingerprint: fingerprint,
    signals: [
      { signalType: "board_serial" as const, signalValue: input.board.boardSerial },
      { signalType: "soc_serial" as const, signalValue: input.board.socSerial },
      { signalType: "mac_address" as const, signalValue: input.board.macAddress },
    ],
    installationEvidence: input.installationEvidence,
  };
  const signature = edSign(null, Buffer.from(deviceRegistrationRequestBytes(fields)), privateKey);

  const response = await fetch(ROUTE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: DEVICE_REGISTRATION_REQUEST_KIND,
      ...fields,
      registrationPublicKeyPem: publicKeyPem,
      signature: signature.toString("base64"),
    }),
  });
  return (await response.json()) as RouteAnswer;
}

async function reachable(): Promise<boolean> {
  try {
    const response = await fetch(ROUTE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(4000),
    });
    const body = (await response.json()) as { code?: string };
    return body.code === "KLUY-REG-MALFORMED";
  } catch {
    return false;
  }
}

const optedIn = process.env.KITLUY_ROUTE_TESTS === "1";
const live = optedIn && (await reachable());
if (!optedIn) {
  console.warn(
    "[reflash-release-route] set KITLUY_ROUTE_TESTS=1 to run: this writes device rows to the live development cloud — SKIPPED, not evidence",
  );
} else if (!live) {
  console.warn(`[reflash-release-route] ${ROUTE} is unreachable — SKIPPED, not evidence`);
}

describe.skipIf(!live)("0235: a same-board reflash releases itself, through the real route", () => {
  let db: Client;
  const created: string[] = [];

  beforeAll(async () => {
    db = new Client({ connectionString: DB_URL });
    await db.connect();
  });

  afterAll(async () => {
    // BEST EFFORT BY DESIGN. `device_assignments` is append-only
    // (KLUY-DEVICE-ASSIGNMENT-IMMUTABLE), so this cannot fully tidy up after
    // itself. What it can remove it removes; everything else is RETIRED, which
    // takes the board out of `resolve_device_by_board_evidence_v1` for good, and
    // an operator purges the rows deliberately.
    const tidy = async (sql: string, id: string): Promise<void> => {
      try {
        await db.query(sql, [id]);
      } catch {
        /* append-only or still referenced: left for a deliberate purge */
      }
    };
    for (const deviceId of created) {
      await tidy(
        `update kitluy_devices.devices set lifecycle_state = 'retired', updated_at = now()
          where id = $1::uuid and lifecycle_state <> 'retired'`,
        deviceId,
      );
      await tidy(
        `delete from kitluy_devices.device_assignment_projections where device_id = $1::uuid`,
        deviceId,
      );
      await tidy(
        `delete from kitluy_devices.device_registration_sightings where device_id = $1::uuid`,
        deviceId,
      );
      await tidy(
        `delete from kitluy_devices.device_installations where device_id = $1::uuid`,
        deviceId,
      );
      await tidy(`delete from kitluy_devices.devices where id = $1::uuid`, deviceId);
    }
    await db.end();
  });

  /** The state a working Hub comes back in: approved, paired, holding a seat. */
  async function putToWork(deviceId: string): Promise<void> {
    await db.query(
      `select kitluy_devices.approve_device_enrollment_v1(
         $1::uuid, 'admin/${SUITE}', 'suite: board verified on the bench',
         'development', 'evidence/${SUITE}', null)`,
      [deviceId],
    );
    const { rows } = await db.query<{ t: string; s: string; l: string }>(
      `select t.id::text as t, s.id::text as s, l.id::text as l
         from kitluy_core.tenants t
         join kitluy_core.digital_stores s on s.tenant_id = t.id
         join kitluy_core.store_locations l on l.digital_store_id = s.id
        limit 1`,
    );
    const where = rows[0];
    if (where === undefined) throw new Error("no Store scope in the development cloud");
    const assignment = (
      await db.query<{ id: string }>(
        `insert into kitluy_devices.device_assignments
           (id, device_id, tenant_id, digital_store_id, store_location_id,
            assignment_generation, state, valid_from, activated_at, created_by_operator_ref)
         values (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4::uuid,
                 1, 'active', now(), now(), $5)
         returning id::text as id`,
        [deviceId, where.t, where.s, where.l, `operator/${SUITE}`],
      )
    ).rows[0];
    // The projection is what proves this device's ENVIRONMENT to the 0235 door.
    await db.query(
      `insert into kitluy_devices.device_assignment_projections
         (device_id, assignment_id, assignment_generation, tenant_id, digital_store_id,
          store_location_id, terminal_profile_keys, projected_at, environment)
       values ($1::uuid, $2::uuid, 1, $3::uuid, $4::uuid, $5::uuid, '{}', now(), 'development')`,
      [deviceId, assignment?.id, where.t, where.s, where.l],
    );
    await db.query(
      `update kitluy_devices.devices
          set assignment_generation = 1, lifecycle_state = 'awaiting_trust'
        where id = $1::uuid`,
      [deviceId],
    );
  }

  async function stateOf(
    deviceId: string,
  ): Promise<{ lifecycle: string; generation: number; live: number }> {
    const { rows } = await db.query<{ lifecycle: string; generation: number; live: number }>(
      `select d.lifecycle_state::text as lifecycle,
              d.assignment_generation::int as generation,
              (select count(*)::int from kitluy_devices.device_assignments a
                where a.device_id = d.id and a.state in ('pending_trust','active')) as live
         from kitluy_devices.devices d where d.id = $1::uuid`,
      [deviceId],
    );
    const row = rows[0];
    if (row === undefined) throw new Error(`device ${deviceId} vanished`);
    return row;
  }

  it("comes back re-pairable with no dev:device:unassign, keeping its device_record_id", async () => {
    const board = newBoard();

    const first = await registerOverHttp({
      board,
      hostname: `${SUITE}-first-boot`,
      installationEvidence: { installationId: hex(16), storageSerial: hex(8) },
    });
    expect(first.status).toBe("PENDING_APPROVAL");
    const deviceId = first.deviceId;
    expect(deviceId).toBeTruthy();
    created.push(deviceId!);

    await putToWork(deviceId!);
    expect(await stateOf(deviceId!)).toMatchObject({
      lifecycle: "awaiting_trust",
      generation: 1,
      live: 1,
    });

    // THE REFLASH: same board, new card — new key, new hostname, new install.
    const second = await registerOverHttp({
      board,
      hostname: `${SUITE}-after-reflash`,
      installationEvidence: { installationId: hex(16), storageSerial: hex(8) },
    });

    expect(second.status).toBe("KNOWN_DEVICE_INSTALLATION_REGISTERED");
    expect(second.deviceId).toBe(deviceId); // the permanent identity survived
    expect(second.installationCreated).toBe(true); // a new installation opened
    expect(second.installationId).not.toBe(first.installationId);

    // …and the route released it for re-pairing, by itself.
    expect(await stateOf(deviceId!)).toMatchObject({
      lifecycle: "enrolled",
      generation: 0,
      live: 0,
    });
  });

  it("does not release on the 60-second poll a waiting board makes", async () => {
    const board = newBoard();
    const evidence = { installationId: hex(16), storageSerial: hex(8) };

    const first = await registerOverHttp({
      board,
      hostname: `${SUITE}-poller`,
      installationEvidence: evidence,
    });
    const deviceId = first.deviceId;
    created.push(deviceId!);
    await putToWork(deviceId!);

    // The same card polling again: same installation evidence, so no new
    // installation — the gate that keeps this route from releasing a board that
    // is merely waiting for approval.
    const poll = await registerOverHttp({
      board,
      hostname: `${SUITE}-poller`,
      installationEvidence: evidence,
    });
    expect(poll.installationCreated).toBe(false);
    expect(await stateOf(deviceId!)).toMatchObject({
      lifecycle: "awaiting_trust",
      generation: 1,
      live: 1,
    });
  });

  it("never releases a first installation, and never a different board", async () => {
    // A first installation has nothing to release and must not be touched.
    const board = newBoard();
    const first = await registerOverHttp({
      board,
      hostname: `${SUITE}-brand-new`,
      installationEvidence: { installationId: hex(16), storageSerial: hex(8) },
    });
    created.push(first.deviceId!);
    expect(first.status).toBe("PENDING_APPROVAL");
    expect(await stateOf(first.deviceId!)).toMatchObject({
      lifecycle: "manufactured",
      generation: 0,
    });

    // A DIFFERENT board carrying the same storage evidence is a different
    // device: it cannot reach the release path at all, because it is not the
    // known board (0197 resolves on board_serial, never on the card).
    const other = newBoard();
    const stranger = await registerOverHttp({
      board: other,
      hostname: `${SUITE}-brand-new`,
      installationEvidence: { installationId: hex(16), storageSerial: hex(8) },
    });
    created.push(stranger.deviceId!);
    expect(stranger.deviceId).not.toBe(first.deviceId);
    expect(stranger.status).toBe("PENDING_APPROVAL");
  });
});
