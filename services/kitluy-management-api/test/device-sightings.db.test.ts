/**
 * Group 0216 — the registration beat, and the rule it makes enforceable.
 *
 * ===========================================================================
 * THE RULE THIS PROVES (owner, 2026-09-08)
 * ===========================================================================
 * "Tracking online when only device is already approve if it is not waiting for
 * approve yet or registed yet when it down just make it disappear from list."
 *
 * Two halves, and both are tested here:
 *   1. A board that is still WAITING for approval and has stopped answering
 *      LEAVES the approval queue. It is not deleted and not marked — it simply
 *      is not listed, and it comes back the moment it answers again.
 *   2. Liveness itself comes from the beat `bin/cloud-registration.ts` already
 *      sends every 60 seconds, forever, approved or not.
 *
 * ===========================================================================
 * WHY THIS BEAT EXISTS AT ALL
 * ===========================================================================
 * `device_fleet_status.last_observed_at` reads `device_hardware_observations`,
 * which is written at ENROLMENT. It is null for every board waiting for
 * approval and the table is empty on a fresh stack, so every device in the
 * Admin Portal read NEVER_SEEN however healthy it was. The signal was arriving
 * every 60s all along; nothing recorded it.
 *
 * ===========================================================================
 * EVERY TEST RUNS INSIDE A TRANSACTION THAT IS ROLLED BACK
 * ===========================================================================
 * These tests REGISTER hardware, which is exactly the kind of thing that must
 * not accumulate in a shared development database — the fleet is small enough
 * that four junk boards is a visibly wrong fleet, and one suite already had to
 * be fixed for growing it on every run. Nothing here survives the test.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

import {
  DEFAULT_PENDING_UNSEEN_AFTER_SECONDS,
  listPendingRegistrations,
} from "../src/device-approval.js";
import { DEVELOPMENT_OFFLINE_AFTER_SECONDS } from "../src/composition.js";

const DB_URL =
  process.env.KITLUY_M1_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54392/postgres";

const ASSET_TAG = "TEST-SIGHTING-0216";
const FINGERPRINT = `aa${"b".repeat(62)}`;

let client: Client | null = null;

/** `Client` is a `DatabaseHandle`; this only narrows the generic. */
function handle(c: Client) {
  return {
    query: <R>(sql: string, params?: readonly unknown[]) =>
      c.query<R extends Record<string, unknown> ? R : never>(sql, params as unknown[]),
  } as unknown as Parameters<typeof listPendingRegistrations>[0];
}

async function reachable(): Promise<boolean> {
  const c = new Client({ connectionString: DB_URL, connectionTimeoutMillis: 4000 });
  try {
    await c.connect();
    const { rows } = await c.query<{ ok: boolean }>(
      `select to_regclass('kitluy_devices.device_registration_sightings') is not null as ok`,
    );
    if (rows[0]?.ok !== true) {
      await c.end();
      return false;
    }
    client = c;
    return true;
  } catch {
    await c.end().catch(() => undefined);
    return false;
  }
}
const live = await reachable();

afterAll(async () => {
  await client?.end().catch(() => undefined);
});

/** Registers one board and returns its id. Caller is inside a transaction. */
async function registerBoard(): Promise<string> {
  const { rows } = await client!.query<{ device_id: string }>(
    `with p as (select id from kitluy_devices.hardware_profiles where is_active limit 1)
     select (kitluy_devices.register_device_v1(
       $1::text, p.id, $2::text, 'sighting-probe',
       '[{"signal_type":"board_serial","signal_value":"SIGHTINGPROBE0216"}]'::jsonb,
       '{}'::jsonb, 'device/self-registration')->>'device_id') as device_id
     from p`,
    [ASSET_TAG, FINGERPRINT],
  );
  const id = rows[0]?.device_id;
  expect(id, "register_device_v1 returned no device id").toBeTruthy();
  return id!;
}

async function inRollback(body: () => Promise<void>): Promise<void> {
  await client!.query("begin");
  try {
    await body();
  } finally {
    await client!.query("rollback");
  }
}

describe.skipIf(!live)("the registration beat (group 0216)", () => {
  beforeAll(() => {
    expect(client).not.toBeNull();
  });

  it("records a first sighting for a board that has just registered", async () => {
    await inRollback(async () => {
      const deviceId = await registerBoard();
      await client!.query(`select kitluy_devices.record_device_sighting_v1($1::uuid, null)`, [
        deviceId,
      ]);
      const { rows } = await client!.query<{
        sighting_count: string;
        same_moment: boolean;
      }>(
        `select sighting_count, (first_seen_at = last_seen_at) as same_moment
           from kitluy_devices.device_registration_sightings where device_id = $1::uuid`,
        [deviceId],
      );
      expect(rows).toHaveLength(1);
      expect(Number(rows[0]!.sighting_count)).toBe(1);
      expect(rows[0]!.same_moment).toBe(true);
    });
  });

  it("counts a repeat beat instead of creating a second row, and keeps first_seen_at", async () => {
    await inRollback(async () => {
      const deviceId = await registerBoard();
      await client!.query(`select kitluy_devices.record_device_sighting_v1($1::uuid, null)`, [
        deviceId,
      ]);
      // Age the first beat so the second is measurably later. The table is
      // liveness, not evidence: it is deliberately mutable and carries no
      // append-only trigger, which is what makes this rewrite legitimate.
      await client!.query(
        `update kitluy_devices.device_registration_sightings
            set first_seen_at = now() - interval '1 hour',
                last_seen_at  = now() - interval '1 hour'
          where device_id = $1::uuid`,
        [deviceId],
      );
      await client!.query(`select kitluy_devices.record_device_sighting_v1($1::uuid, null)`, [
        deviceId,
      ]);
      const { rows } = await client!.query<{
        n: string;
        sighting_count: string;
        first_is_old: boolean;
        last_is_now: boolean;
      }>(
        `select count(*) over () as n, sighting_count,
                (first_seen_at < now() - interval '30 minutes') as first_is_old,
                (last_seen_at  > now() - interval '30 seconds') as last_is_now
           from kitluy_devices.device_registration_sightings where device_id = $1::uuid`,
        [deviceId],
      );
      expect(Number(rows[0]!.n)).toBe(1);
      expect(Number(rows[0]!.sighting_count)).toBe(2);
      // first_seen_at is when we MET the board and must never move forward.
      expect(rows[0]!.first_is_old).toBe(true);
      expect(rows[0]!.last_is_now).toBe(true);
    });
  });

  it("ignores a sighting for a device that does not exist rather than raising", async () => {
    // A liveness write must never be able to turn a successful registration
    // into an error the board then retries for ever.
    await inRollback(async () => {
      await expect(
        client!.query(`select kitluy_devices.record_device_sighting_v1($1::uuid, null)`, [
          "00000000-0000-4000-8000-999999999999",
        ]),
      ).resolves.toBeDefined();
      const { rows } = await client!.query<{ n: string }>(
        `select count(*) as n from kitluy_devices.device_registration_sightings
          where device_id = '00000000-0000-4000-8000-999999999999'::uuid`,
      );
      expect(Number(rows[0]!.n)).toBe(0);
    });
  });

  it("ignores a null device id", async () => {
    await inRollback(async () => {
      await expect(
        client!.query(`select kitluy_devices.record_device_sighting_v1(null::uuid, null)`),
      ).resolves.toBeDefined();
    });
  });

  it("publishes the beat on the fleet read model", async () => {
    await inRollback(async () => {
      const deviceId = await registerBoard();
      await client!.query(`select kitluy_devices.record_device_sighting_v1($1::uuid, null)`, [
        deviceId,
      ]);
      const { rows } = await client!.query<{
        last_seen_at: string | null;
        sighting_count: string | null;
      }>(
        `select last_seen_at, sighting_count from kitluy_devices.device_fleet_status
          where device_record_id = $1::uuid`,
        [deviceId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.last_seen_at).not.toBeNull();
      expect(Number(rows[0]!.sighting_count)).toBe(1);
    });
  });
});

describe.skipIf(!live)("a board that stops answering leaves the approval queue", () => {
  it("lists a board that is answering now", async () => {
    await inRollback(async () => {
      const deviceId = await registerBoard();
      await client!.query(`select kitluy_devices.record_device_sighting_v1($1::uuid, null)`, [
        deviceId,
      ]);
      const pending = await listPendingRegistrations(handle(client!), { limit: 500 });
      const mine = pending.find((p) => p.deviceId === deviceId);
      expect(mine, "a board that just answered must be offered for approval").toBeDefined();
      expect(mine!.lastSeenAt).not.toBeNull();
    });
  });

  it("drops a board that has not been heard from for longer than the window", async () => {
    await inRollback(async () => {
      const deviceId = await registerBoard();
      await client!.query(`select kitluy_devices.record_device_sighting_v1($1::uuid, null)`, [
        deviceId,
      ]);
      // Unplugged. Both the beat AND the registration fall behind the window —
      // the query takes the LATER of the two, so ageing only one proves nothing.
      await client!.query(
        `update kitluy_devices.device_registration_sightings
            set last_seen_at = now() - interval '2 hours' where device_id = $1::uuid`,
        [deviceId],
      );
      await client!.query(
        `update kitluy_devices.device_installations
            set created_at = now() - interval '2 hours' where device_record_id = $1::uuid`,
        [deviceId],
      );
      const pending = await listPendingRegistrations(handle(client!), { limit: 500 });
      expect(pending.find((p) => p.deviceId === deviceId)).toBeUndefined();
    });
  });

  it("brings the board straight back when it answers again — nothing was deleted", async () => {
    await inRollback(async () => {
      const deviceId = await registerBoard();
      await client!.query(`select kitluy_devices.record_device_sighting_v1($1::uuid, null)`, [
        deviceId,
      ]);
      await client!.query(
        `update kitluy_devices.device_registration_sightings
            set last_seen_at = now() - interval '2 hours' where device_id = $1::uuid`,
        [deviceId],
      );
      await client!.query(
        `update kitluy_devices.device_installations
            set created_at = now() - interval '2 hours' where device_record_id = $1::uuid`,
        [deviceId],
      );
      expect(
        (await listPendingRegistrations(handle(client!), { limit: 500 })).find(
          (p) => p.deviceId === deviceId,
        ),
      ).toBeUndefined();

      // The board is powered back on and polls.
      await client!.query(`select kitluy_devices.record_device_sighting_v1($1::uuid, null)`, [
        deviceId,
      ]);
      expect(
        (await listPendingRegistrations(handle(client!), { limit: 500 })).find(
          (p) => p.deviceId === deviceId,
        ),
        "the queue reads liveness; it must never record a decision about it",
      ).toBeDefined();
    });
  });

  it("keeps a board that has answered inside a caller-supplied window", async () => {
    await inRollback(async () => {
      const deviceId = await registerBoard();
      await client!.query(`select kitluy_devices.record_device_sighting_v1($1::uuid, null)`, [
        deviceId,
      ]);
      await client!.query(
        `update kitluy_devices.device_registration_sightings
            set last_seen_at = now() - interval '10 minutes' where device_id = $1::uuid`,
        [deviceId],
      );
      await client!.query(
        `update kitluy_devices.device_installations
            set created_at = now() - interval '10 minutes' where device_record_id = $1::uuid`,
        [deviceId],
      );
      // Outside the ruled 5 minutes...
      expect(
        (await listPendingRegistrations(handle(client!), { limit: 500 })).find(
          (p) => p.deviceId === deviceId,
        ),
      ).toBeUndefined();
      // ...inside a wider one the caller chose.
      expect(
        (
          await listPendingRegistrations(handle(client!), {
            limit: 500,
            unseenAfterSeconds: 3600,
          })
        ).find((p) => p.deviceId === deviceId),
      ).toBeDefined();
    });
  });

  it("never widens the window to zero, which would hide a board answering right now", async () => {
    await inRollback(async () => {
      const deviceId = await registerBoard();
      await client!.query(`select kitluy_devices.record_device_sighting_v1($1::uuid, null)`, [
        deviceId,
      ]);
      for (const bad of [0, -1, -3600]) {
        const pending = await listPendingRegistrations(handle(client!), {
          limit: 500,
          unseenAfterSeconds: bad,
        });
        expect(
          pending.find((p) => p.deviceId === deviceId),
          `window ${bad} must be floored, not applied`,
        ).toBeDefined();
      }
    });
  });
});

describe("the queue window is the ruled OFFLINE threshold, not a second opinion", () => {
  it("agrees with the owner-approved development default", () => {
    // If these drift apart a device reads OFFLINE on the fleet page while still
    // sitting in the approval queue, and an operator has to decide which lies.
    expect(DEFAULT_PENDING_UNSEEN_AFTER_SECONDS).toBe(DEVELOPMENT_OFFLINE_AFTER_SECONDS);
  });
});
