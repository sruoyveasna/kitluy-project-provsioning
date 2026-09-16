/**
 * The device recovery view against a real database: the role switch, the door
 * (group 0227) and the strict row mapping, over whatever devices the database
 * actually holds.
 *
 * Authority: owner task BOOT-RECOVERY-CLASSIFICATION-001 slice D.
 *
 * `test/device-recovery.test.ts` proves the decisions over hand-built rows.
 * This proves real rows — real lifecycles, fingerprints, seats and overlap
 * windows — map without being refused, and that the API's connection can
 * actually become `kitluy_device_boot_service`. Skipped only when no database
 * is reachable, like `device-sightings.db.test.ts`.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readDeviceRecovery } from "../src/device-recovery.js";

const DB_URL =
  process.env.KITLUY_M1_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54392/postgres";

let pool: pg.Pool | null = null;

async function reachable(): Promise<boolean> {
  const c = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 4000 });
  try {
    await c.connect();
    const { rows } = await c.query<{ present: boolean }>(
      `select to_regprocedure('kitluy_devices.describe_device_recovery_facts_v1(uuid,text)') is not null as present`,
    );
    return rows[0]?.present === true;
  } catch {
    return false;
  } finally {
    await c.end().catch(() => undefined);
  }
}

const available = await reachable();

beforeAll(() => {
  if (available) pool = new pg.Pool({ connectionString: DB_URL, max: 2 });
});
afterAll(async () => {
  await pool?.end();
});

describe.skipIf(!available)("the recovery view over real devices", () => {
  it("maps every live Store Hub and Terminal without refusing a row", async () => {
    const { rows } = await pool!.query<{ id: string }>(
      `select id from kitluy_devices.devices
        where device_class in ('store_hub', 'terminal')
        order by updated_at desc
        limit 25`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const { id } of rows) {
      const view = await readDeviceRecovery({ pool: pool! }, id, "development");
      expect(view, id).not.toBeNull();
      expect(view!.reasonCode).toMatch(/^KLUY-BOOT-/);
      expect(view!.message).not.toMatch(/KLUY-|generation|enrollment/i);
    }
  });

  it("an id that names no device is nothing, not an error", async () => {
    expect(
      await readDeviceRecovery(
        { pool: pool! },
        "00000000-0000-4000-8000-000000000000",
        "development",
      ),
    ).toBeNull();
  });

  it("the connection is left exactly as it was: the role dies with the transaction", async () => {
    await readDeviceRecovery(
      { pool: pool! },
      "00000000-0000-4000-8000-000000000000",
      "development",
    );
    const { rows } = await pool!.query<{ current_user: string }>("select current_user");
    expect(rows[0]!.current_user).not.toBe("kitluy_device_boot_service");
  });
});
