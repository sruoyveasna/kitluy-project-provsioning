/**
 * Fleet liveness against the canonical database — NEVER_SEEN -> ONLINE -> STALE -> OFFLINE.
 *
 * ===========================================================================
 * WHY THE CLOCK MOVES AND THE DATA DOES NOT
 * ===========================================================================
 * Proving OFFLINE by waiting is proving it by waiting five real minutes, every
 * run, forever. Proving it by rewriting `observed_at` would be falsifying the
 * one column the whole liveness model reads — and `device_hardware_observations`
 * is append-only precisely so nobody can.
 *
 * So the stored observation is left exactly as the device wrote it and the
 * OBSERVER's clock is advanced instead. `deriveFreshness` already takes `now`
 * as a parameter, so this exercises the real projection with real data; only
 * the question ("how fresh is this AS OF t?") changes.
 *
 * The owner-approved development defaults (90 / 300) are asserted separately,
 * so a suite that passes with re-tuned thresholds cannot hide a change to them.
 */
import { afterAll, describe, expect, it } from "vitest";
import { Client } from "pg";

import {
  DEVELOPMENT_OFFLINE_AFTER_SECONDS,
  DEVELOPMENT_STALE_AFTER_SECONDS,
} from "../src/composition.js";
import { deriveFreshness, getFleetDevice, type FreshnessPolicy } from "../src/fleet.js";

const DB_URL =
  process.env.KITLUY_M1_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54402/postgres";

/** The clean development Store Hub created by the firstboot E2E suite. */
const HUB_ASSET_TAG_PREFIX = "DEV-HUB-";

const DEV_POLICY: FreshnessPolicy = {
  staleAfterSeconds: DEVELOPMENT_STALE_AFTER_SECONDS,
  offlineAfterSeconds: DEVELOPMENT_OFFLINE_AFTER_SECONDS,
};

let client: Client | null = null;
async function probe(): Promise<boolean> {
  const c = new Client({ connectionString: DB_URL, connectionTimeoutMillis: 4000 });
  try {
    await c.connect();
    const { rows } = await c.query<{ n: number }>(
      `select count(*)::int as n from kitluy_devices.device_fleet_status
        where asset_tag like $1`,
      [`${HUB_ASSET_TAG_PREFIX}%`],
    );
    if ((rows[0]?.n ?? 0) === 0) {
      await c.end();
      return false;
    }
    client = c;
    return true;
  } catch {
    try {
      await c.end();
    } catch {
      /* never connected */
    }
    return false;
  }
}
const reachable = await probe();

afterAll(async () => {
  await client?.end().catch(() => undefined);
});

async function hubRow(): Promise<{ deviceId: string; lastObservedAt: string | null }> {
  const { rows } = await client!.query<{
    device_record_id: string;
    last_observed_at: string | null;
  }>(
    `select device_record_id, last_observed_at
       from kitluy_devices.device_fleet_status
      where asset_tag like $1
      order by asset_tag
      limit 1`,
    [`${HUB_ASSET_TAG_PREFIX}%`],
  );
  const row = rows[0];
  if (row === undefined) throw new Error("clean development Hub not found");
  return { deviceId: row.device_record_id, lastObservedAt: row.last_observed_at };
}

describe("owner-approved development liveness thresholds", () => {
  it("are 90 and 300 seconds, and are configuration rather than schema", () => {
    expect(DEVELOPMENT_STALE_AFTER_SECONDS).toBe(90);
    expect(DEVELOPMENT_OFFLINE_AFTER_SECONDS).toBe(300);
  });

  it("reports NEVER_SEEN for a device with no accepted observation", () => {
    expect(deriveFreshness(null, DEV_POLICY, new Date())).toBe("NEVER_SEEN");
  });

  it("reports UNKNOWN — never ONLINE — while the policy is unruled", () => {
    const unruled: FreshnessPolicy = { staleAfterSeconds: null, offlineAfterSeconds: null };
    expect(deriveFreshness(new Date().toISOString(), unruled, new Date())).toBe("UNKNOWN");
  });
});

describe.skipIf(!reachable)(
  "the clean development Store Hub is live in the canonical fleet",
  () => {
    it("has an accepted observation, so it is no longer NEVER_SEEN", async () => {
      const hub = await hubRow();
      expect(hub.lastObservedAt).not.toBeNull();
    });

    it("projects ONLINE at observation time, then STALE, then OFFLINE as the clock advances", async () => {
      const hub = await hubRow();
      const observedAt = new Date(String(hub.lastObservedAt));

      const online = await getFleetDevice(client!, hub.deviceId, {
        policy: DEV_POLICY,
        now: new Date(observedAt.getTime() + 1_000),
      });
      expect(online?.freshness).toBe("ONLINE");

      const stale = await getFleetDevice(client!, hub.deviceId, {
        policy: DEV_POLICY,
        now: new Date(observedAt.getTime() + 120_000),
      });
      expect(stale?.freshness).toBe("STALE");

      const offline = await getFleetDevice(client!, hub.deviceId, {
        policy: DEV_POLICY,
        now: new Date(observedAt.getTime() + 400_000),
      });
      expect(offline?.freshness).toBe("OFFLINE");
    });

    it("is a store_hub assigned to a Location, and has NOT been activated", async () => {
      const hub = await hubRow();
      const device = await getFleetDevice(client!, hub.deviceId, { policy: DEV_POLICY });
      expect(device?.deviceClass).toBe("store_hub");
      expect(device?.storeLocationId).not.toBeNull();
      expect(device?.lifecycle).not.toBe("active");
    });
  },
);

/**
 * Boundary semantics are tested here rather than against the database on
 * purpose. `device_hardware_observations.observed_at` carries MICROSECOND
 * precision and a JavaScript `Date` carries milliseconds, so "exactly 90
 * seconds after the stored observation" is not expressible from the client —
 * an exact-boundary assertion against a real row tests float truncation, not
 * the policy. With a synthetic timestamp the boundary is exact and the
 * inclusive-lower-bound rule is pinned properly.
 */
describe("freshness boundaries are inclusive at the lower bound", () => {
  const base = new Date("2026-08-10T00:00:00.000Z");
  const at = (offsetSeconds: number): string =>
    deriveFreshness(
      base.toISOString(),
      DEV_POLICY,
      new Date(base.getTime() + offsetSeconds * 1000),
    );

  it("ONLINE below 90s, STALE from 90s, OFFLINE from 300s", () => {
    expect(at(0)).toBe("ONLINE");
    expect(at(89)).toBe("ONLINE");
    expect(at(90)).toBe("STALE");
    expect(at(299)).toBe("STALE");
    expect(at(300)).toBe("OFFLINE");
    expect(at(3600)).toBe("OFFLINE");
  });
});
