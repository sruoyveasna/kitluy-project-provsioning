/**
 * Trusted time and Hub activation — against the canonical database.
 *
 * ===========================================================================
 * THE ONE RULE THIS SUITE ENFORCES ON ITSELF
 * ===========================================================================
 * No timestamp in `device_trusted_time` or `device_trusted_time_events` is ever
 * written by this file. Every floor movement goes through
 * `evaluate_trusted_time_v1`, and every activation through
 * `attempt_activate_device_v1`. Manufacturing a pass by UPDATE-ing a floor
 * would prove only that UPDATE works, and the floor is the exact thing an
 * attacker would want to move.
 *
 * Like the other Hub suites it COMMITS and uses a deterministic fixture: a
 * trusted floor that vanished on rollback would not be a floor.
 */
import { createHash } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";
import { Client } from "pg";

import { enrollDeviceAtFactory, type DatabaseHandle } from "../src/factory-gateway.js";
import {
  controlPlaneNetworkTime,
  establishTrustedTime,
  readTrustedTimeState,
  selectOfferableSources,
} from "../src/trusted-time-gateway.js";
import type { HardwareSignal } from "../src/factory.js";

/**
 * THE CANONICAL DEVELOPMENT TARGET, WHICH IS POSTGRESQL 17.
 *
 * This defaulted to port 54402 — the `kitluy-repo15` container, PostgreSQL 15.8,
 * migration head `20260810120000` (group 0188) with 87 of 99 migrations applied
 * and neither `kitluy_activation_service` nor `kitluy_device_certificate_issuer`
 * existing at all. That environment was superseded on 2026-08-10 when the chain
 * was proven against PostgreSQL 17.6 chosen to match the canonical cloud
 * project's exact image tag (`30_CLEAN_PG17_CANONICAL_CHAIN_PROOF.md`), and it
 * has not moved since.
 *
 * The three failures this file carried were entirely environmental: eleven
 * migrations of trusted-time and activation work simply were not there. Against
 * the canonical target the same eleven assertions pass unchanged.
 *
 * `KITLUY_M1_DB_URL` still overrides, so a deliberate run against another target
 * costs one environment variable.
 */
const DB_URL =
  process.env.KITLUY_M1_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54392/postgres";

/** The clean development Store Hub from the provisioning E2E suite. */
const HUB_SEED = "kitluy-dev-store-hub-m1-001";
const ENVIRONMENT = "development";

async function probe(): Promise<boolean> {
  const c = new Client({ connectionString: DB_URL, connectionTimeoutMillis: 4000 });
  try {
    await c.connect();
    const { rows } = await c.query<{ n: number }>(
      `select count(*)::int as n from information_schema.tables
        where table_schema='kitluy_devices' and table_name='device_trusted_time'`,
    );
    await c.end();
    return (rows[0]?.n ?? 0) > 0;
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

const clients: Client[] = [];
async function connect(): Promise<Client> {
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  clients.push(c);
  return c;
}
afterAll(async () => {
  await Promise.all(clients.map((c) => c.end().catch(() => undefined)));
});

function seeded(seed: string, bytes = 32): string {
  return createHash("sha256")
    .update(seed)
    .digest("hex")
    .slice(0, bytes * 2);
}

function manifestFor(seed: string): HardwareSignal[] {
  const h = seeded(seed);
  return [
    { signal_type: "mac_address", signal_value: (h.slice(0, 12).match(/../g) ?? []).join(":") },
    { signal_type: "board_serial", signal_value: `BS-${h.slice(12, 28)}` },
    { signal_type: "storage_serial", signal_value: `SS-${h.slice(28, 44)}` },
  ];
}

async function ensureDevice(db: DatabaseHandle, seed: string, tag: string): Promise<string> {
  const result = await enrollDeviceAtFactory(db, {
    assetTag: tag,
    hardwareProfileKey: "WS11-T001-HUB-PROBE",
    devicePublicKeyFingerprint: seeded(`${seed}:device-key`),
    publicKeyAlgorithm: "ed25519",
    keyStorageClass: "software",
    enrollmentStationKey: "STATION-DEV-M1",
    enrollmentOperatorRef: "HET-MFG/m1-dev-provisioning",
    signals: manifestFor(seed),
  });
  if (result.kind !== "enrolled") throw new Error(`enrollment refused: ${result.code}`);
  return result.deviceRecordId;
}

const hubId = async (db: DatabaseHandle): Promise<string> =>
  ensureDevice(db, HUB_SEED, `DEV-HUB-${seeded(HUB_SEED, 4).toUpperCase()}`);

/** Dedicated fixture for the invariant tests that intentionally move the floor. */
const invariantDeviceId = async (db: DatabaseHandle): Promise<string> =>
  ensureDevice(db, "tt-invariants", "DEV-TT-INVARIANTS-01");

// ---------------------------------------------------------------------------
// Source selection — pure, no database
// ---------------------------------------------------------------------------

describe("only validated readings may be offered as trusted-time sources", () => {
  it("drops a faulted RTC, unauthenticated network time and an unverified token", () => {
    const offered = selectOfferableSources({
      rtc: { available: true, faulted: true, time: new Date() },
      network: { available: true, authenticated: false, time: new Date() },
      signedToken: { verified: false, time: new Date() },
    });
    expect(offered.rtcTime).toBeNull();
    expect(offered.authenticatedNetworkTime).toBeNull();
    expect(offered.signedTokenTime).toBeNull();
    expect(offered.rejected.join(" ")).toMatch(/faulted/);
    expect(offered.rejected.join(" ")).toMatch(/plain NTP is not a trusted source/);
  });

  it("offers a healthy RTC and an authenticated network reading", () => {
    const t = new Date("2026-08-10T00:00:00.000Z");
    const offered = selectOfferableSources({
      rtc: { available: true, faulted: false, time: t },
      network: { available: true, authenticated: true, time: t },
    });
    expect(offered.rtcTime).toEqual(t);
    expect(offered.authenticatedNetworkTime).toEqual(t);
    expect(offered.rejected).toEqual([]);
  });

  it("offers nothing when nothing was collected", () => {
    const offered = selectOfferableSources({});
    expect(offered.rtcTime).toBeNull();
    expect(offered.authenticatedNetworkTime).toBeNull();
    expect(offered.signedTokenTime).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Establishment, restart, rollback, advancement
// ---------------------------------------------------------------------------

/**
 * Bring the shared Hub fixture's floor to the present through the GOVERNED path
 * before the device-side assertions run.
 *
 * WHY THIS IS NEEDED, AND WHY IT IS NOT A WORKAROUND
 * --------------------------------------------------
 * `controlPlaneNetworkTime` offers the control-plane clock as
 * `authenticated_network` — a DEVICE-CLASS source, and since group 0200 a
 * device-class source may not close a gap wider than
 * `trusted_time_max_forward_jump_seconds` (3600). That is deliberate: a device's
 * own clock is exactly what an attacker controls.
 *
 * So a long-lived shared fixture rots. Left alone, this file passes when its
 * fixture was minted minutes ago and fails an hour later, which is the worst
 * kind of red — one that arrives without a change.
 *
 * The fix is to model what the PRODUCT does. A cloud-connected Hub re-establishes
 * through `establish_device_trusted_time_v1`, the SECURITY DEFINER bridge that
 * reads the database's own clock and takes no timestamp from anyone. Running it
 * here puts the fixture in the state a real paired Hub is in, and the assertions
 * below then test what they were written to test: the device-side gateway's
 * transport, not the anomaly model. The anomaly model is proven separately and
 * adversarially in
 * `services/kitluy-device-registry-service/test/trusted-time-staleness.integration.test.ts`.
 *
 * Nothing here writes a floor. The bridge is the only thing that moves it, and
 * it moves it forward only.
 */
async function reanchorThroughGovernedBridge(db: DatabaseHandle, id: string): Promise<void> {
  await db.query(
    `select kitluy_devices.establish_device_trusted_time_v1($1::uuid, $2::text, gen_random_uuid())`,
    [id, ENVIRONMENT],
  );
}

describe.skipIf(!reachable)("trusted time — establishment and security invariants", () => {
  it("a device offering NO source stays untrusted and is refused activation", async () => {
    const db = await connect();
    const id = await ensureDevice(db, "tt-nosource", "DEV-TT-NOSRC-01");

    const { outcome } = await establishTrustedTime(db, {
      deviceRecordId: id,
      environment: ENVIRONMENT,
      sources: {
        rtc: { available: false, faulted: false },
        network: { available: false, authenticated: false },
      },
    });
    expect(outcome.status).toBe("restricted_no_trusted_source");
    expect(outcome.restricted).toBe(true);
    expect(outcome.trustedTime).toBeNull();

    await expect(
      db.query(`select kitluy_devices.assert_trusted_time_v1($1::uuid, 'activation')`, [id]),
    ).rejects.toThrow(/KLUY-DEVICE-TIME-(UNTRUSTED|RESTRICTED)/);
  });

  it("a valid authenticated source establishes the floor", async () => {
    const db = await connect();
    const id = await hubId(db);
    await reanchorThroughGovernedBridge(db, id);

    const network = await controlPlaneNetworkTime(db);
    expect(network.authenticated).toBe(true);

    const { outcome } = await establishTrustedTime(db, {
      deviceRecordId: id,
      environment: ENVIRONMENT,
      sources: { network },
    });
    expect(outcome.status).toBe("trusted");
    expect(outcome.restricted).toBe(false);
    expect(outcome.source).toBe("authenticated_network");
    expect(outcome.trustedTime).not.toBeNull();

    const state = await readTrustedTimeState(db, id);
    expect(state?.status).toBe("trusted");
    expect(state?.floor).not.toBeNull();
  });

  it("PROCESS RESTART: the floor survives a brand new connection", async () => {
    const first = await connect();
    const id = await hubId(first);
    const before = await readTrustedTimeState(first, id);
    expect(before?.floor).not.toBeNull();

    await first.end();
    clients.splice(clients.indexOf(first), 1);

    const restarted = await connect();
    const after = await readTrustedTimeState(restarted, id);
    expect(after?.status).toBe("trusted");
    expect(after?.floor?.getTime()).toBe(before?.floor?.getTime());
  });

  it("CLOCK ROLLBACK: a source far behind the floor cannot move trusted time backwards", async () => {
    const db = await connect();
    // A DEDICATED device, not the clean Hub. These invariant tests deliberately
    // drive the floor around; doing that to the provisioned Hub would leave its
    // floor sitting in the future and corrode the fixture every run.
    const id = await invariantDeviceId(db);
    await establishTrustedTime(db, {
      deviceRecordId: id,
      environment: ENVIRONMENT,
      sources: { network: await controlPlaneNetworkTime(db) },
    });
    const before = await readTrustedTimeState(db, id);
    const floor = before?.floor;
    expect(floor).toBeDefined();

    // One hour behind the floor — well beyond the development
    // max_clock_lag_seconds of 300. Offered as a healthy RTC, i.e. the exact
    // shape of a device whose operator wound the clock back.
    const rolledBack = new Date(floor!.getTime() - 3_600_000);
    const { outcome } = await establishTrustedTime(db, {
      deviceRecordId: id,
      environment: ENVIRONMENT,
      sources: { rtc: { available: true, faulted: false, time: rolledBack } },
    });

    expect(outcome.status).toBe("restricted_clock_rollback");
    expect(outcome.floorAdvanced).toBe(false);

    const after = await readTrustedTimeState(db, id);
    // The floor did NOT move backwards. That is the whole invariant.
    expect(after?.floor?.getTime()).toBe(floor!.getTime());
  });

  it("ADVANCEMENT: a newer valid source advances the floor, and the advance persists", async () => {
    const db = await connect();
    const id = await invariantDeviceId(db);

    // Recover from the rollback anomaly using a reading derived from the
    // device's OWN floor rather than the control-plane clock: repeated runs
    // leave the floor ahead of `now()`, and a recovery source that is behind
    // the floor cannot advance it. This keeps the test independent of how many
    // times it has run before.
    const current = await readTrustedTimeState(db, id);
    await establishTrustedTime(db, {
      deviceRecordId: id,
      environment: ENVIRONMENT,
      sources: {
        network: {
          available: true,
          authenticated: true,
          time: new Date((current?.floor?.getTime() ?? Date.now()) + 1_000),
        },
      },
    });
    const before = await readTrustedTimeState(db, id);
    expect(before?.status).toBe("trusted");

    // 60 seconds ahead: forward, and well inside the 3600s forward-jump limit.
    const advanced = new Date(before!.floor!.getTime() + 60_000);
    const { outcome } = await establishTrustedTime(db, {
      deviceRecordId: id,
      environment: ENVIRONMENT,
      sources: { network: { available: true, authenticated: true, time: advanced } },
    });
    expect(outcome.status).toBe("trusted");
    expect(outcome.floorAdvanced).toBe(true);

    const mid = await readTrustedTimeState(db, id);
    expect(mid?.floor?.getTime()).toBe(advanced.getTime());

    await db.end();
    clients.splice(clients.indexOf(db), 1);
    const restarted = await connect();
    const after = await readTrustedTimeState(restarted, id);
    expect(after?.floor?.getTime()).toBe(advanced.getTime());
  });

  it("evaluates the authority EXACTLY ONCE per call — one call, one audit event", async () => {
    const db = await connect();
    const id = await invariantDeviceId(db);
    const countEvents = async (): Promise<number> => {
      const { rows } = await db.query<{ n: string }>(
        `select count(*) as n from kitluy_devices.device_trusted_time_events where device_id = $1::uuid`,
        [id],
      );
      return Number(rows[0]?.n ?? 0);
    };

    const before = await countEvents();
    const state = await readTrustedTimeState(db, id);
    await establishTrustedTime(db, {
      deviceRecordId: id,
      environment: ENVIRONMENT,
      sources: {
        network: {
          available: true,
          authenticated: true,
          time: new Date((state?.floor?.getTime() ?? Date.now()) + 30_000),
        },
      },
    });
    // Exactly one. `(fn(...)).*` in a SELECT list would produce seven.
    expect(await countEvents()).toBe(before + 1);
  });

  it("records an append-only event history for every evaluation", async () => {
    const db = await connect();
    const id = await invariantDeviceId(db);

    const { rows } = await db.query<{ event_type: string; status: string; n: string }>(
      `select event_type, status::text as status, count(*) as n
         from kitluy_devices.device_trusted_time_events
        where device_id = $1::uuid
        group by event_type, status order by 3 desc`,
      [id],
    );
    expect(rows.length).toBeGreaterThan(0);
    const statuses = rows.map((r) => r.status);
    expect(statuses).toContain("trusted");
    // The rollback attempt must have left evidence, not just been ignored.
    expect(statuses).toContain("restricted_clock_rollback");
  });
});

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

describe.skipIf(!reachable)("Hub activation, once trusted time is established", () => {
  it("no longer refuses for KLUY-DEVICE-TIME-UNTRUSTED", async () => {
    const db = await connect();
    const id = await hubId(db);
    await reanchorThroughGovernedBridge(db, id);

    const state = await readTrustedTimeState(db, id);
    expect(state?.status).toBe("trusted");

    // ENTERED EXPLICITLY. Group 0206 (finding C-4) cut `service_role`'s inherited
    // membership of `kitluy_activation_service`, so activation is now a
    // capability a caller ENTERS rather than one the connection silently
    // carries. `set local role` dies with the transaction, exactly as it does in
    // the product's `withServiceRole()`.
    await db.query("begin");
    await db.query("set local role kitluy_activation_service");
    const { rows } = await db.query<{ outcome: string }>(
      `select kitluy_devices.attempt_activate_device_v1($1::uuid, $2::text, $3::text)::text as outcome`,
      [id, ENVIRONMENT, "admin/trusted-time-task"],
    );
    await db.query("commit");
    const outcome = String(rows[0]?.outcome ?? "");
    // eslint-disable-next-line no-console -- the verdict IS the deliverable
    console.log(`[activation] ${outcome}`);

    expect(outcome).not.toMatch(/KLUY-DEVICE-TIME-UNTRUSTED/);

    const { rows: after } = await db.query<{ lifecycle_state: string; fleet_status: string }>(
      `select lifecycle_state::text, fleet_status
         from kitluy_devices.device_fleet_status where device_record_id = $1::uuid`,
      [id],
    );
    // eslint-disable-next-line no-console -- ditto
    console.log(
      `[activation] lifecycle=${after[0]?.lifecycle_state} fleet_status=${after[0]?.fleet_status}`,
    );
    expect(after[0]?.lifecycle_state).toBeDefined();
  });
});
