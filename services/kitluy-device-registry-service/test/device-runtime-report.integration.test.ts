/**
 * `POST /v1/device-runtime/report` against the real database (group 0229).
 *
 * Authority: owner mission T1-STORE-OPERATIONS-001 §15-§17.
 *
 * Every report here is signed the way a Pi Terminal signs it (the firstboot
 * agent's own `signRuntimeReport`), carried through the real route
 * (`createDeviceRuntimeRouter`), and recorded by the real door as
 * `kitluy_device_runtime_service` (`recordDeviceRuntimeReport`). The devices are
 * made through `enroll_device_v1`, so the identity key the door binds to is the
 * one a real enrollment recorded.
 *
 * A formal security suite: it FAILS rather than skips without its database.
 */
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { publicKeyFingerprint } from "@kitluy/device-identity";
import { signRuntimeReport } from "@kitluy-services/kitluy-device-firstboot-agent";

import { createDeviceRuntimeRouter } from "../src/device-runtime-routes.js";
import { recordDeviceRuntimeReport } from "../src/device-runtime-status.js";
import { requireSecurityFixture } from "./support/security-gate.js";

const DSN =
  process.env.KITLUY_DEV_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54392/postgres";

await requireSecurityFixture({ dsn: DSN, needsPki: false });

let pool: pg.Pool;
let work: string;

const REPORT = {
  schema: "kitluy.device-runtime-report.v1",
  deviceClass: "terminal",
  imageVersion: "0.2.0-dev",
  agentVersion: "0.1.0",
  hubLink: {
    phase: "SERVING",
    hubDeviceId: "549a41c6-21e9-4838-8b48-34a3878ba290",
    checkedAt: "2026-09-17T03:00:00.000Z",
    reads: { authorityTime: "ok", eligibility: "ok", configuration: "ok" },
  },
  application: {
    product: "kitluy-terminal",
    installedReleaseId: "0b6f3f58-8d5a-4f52-9f59-6d2f8d7f0a11",
    installedVersion: "0.1.0-t1a",
    journalPhase: "COMMITTED",
    lastOutcome: "INSTALLED",
    lastReason: null,
    runningReleaseId: "0b6f3f58-8d5a-4f52-9f59-6d2f8d7f0a11",
    runningSince: "2026-09-17T02:59:00.000Z",
    unitActive: true,
  },
  pos: {
    state: "ready",
    refusalCode: null,
    applicationVersion: "0.1.0",
    configurationVersion: 7,
    configurationFreshness: "current",
    staffSignedIn: true,
    observedAt: "2026-09-17T03:00:01.000Z",
  },
};

interface Board {
  readonly deviceId: string;
  readonly keyPath: string;
}

async function enrolled(deviceClass: "terminal" | "store_hub"): Promise<Board> {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const keyPath = join(work, `${randomUUID()}.key.pem`);
  writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  const fingerprint = publicKeyFingerprint(
    publicKey.export({ type: "spki", format: "pem" }).toString(),
  );
  const tag = `RUNTIME-REPORT-${randomUUID()}`;
  const { rows } = await pool.query<{ device_id: string }>(
    `select kitluy_devices.enroll_device_v1(
       $1::text,
       (select id from kitluy_devices.hardware_profiles
         where device_class = $2::kitluy_devices.device_class and is_active
         order by profile_key limit 1),
       now(), $3::text, 'ed25519', 'software', 'STATION-RUNTIME', 'HET-MFG/runtime-report-suite',
       $4::jsonb, null) as device_id`,
    [
      tag,
      deviceClass,
      fingerprint,
      JSON.stringify([
        {
          signal_type: "mac_address",
          signal_value: randomUUID().replace(/-/g, "").slice(0, 12).match(/../g)?.join(":"),
        },
        { signal_type: "board_serial", signal_value: `BS-${randomUUID().slice(0, 16)}` },
      ]),
    ],
  );
  return { deviceId: rows[0]!.device_id, keyPath };
}

const router = () =>
  createDeviceRuntimeRouter({
    record: (input) => recordDeviceRuntimeReport(pool, input),
    // A fresh limiter per router: this suite is one source address.
  });

async function send(body: unknown) {
  return router().handle({
    method: "POST",
    path: "/v1/device-runtime/report",
    headers: { "content-type": "application/json" },
    sourceIp: `10.0.0.${String(Math.floor(Math.random() * 250))}`,
    rawBody: JSON.stringify(body),
  });
}

async function stored(deviceId: string) {
  const { rows } = await pool.query<{
    report_sequence: string;
    report: Record<string, unknown>;
    report_age_seconds: string;
  }>(
    `select report_sequence::text, report, report_age_seconds::text
       from kitluy_devices.device_runtime_status_read where device_id = $1`,
    [deviceId],
  );
  return rows[0];
}

beforeAll(() => {
  pool = new pg.Pool({ connectionString: DSN, max: 4 });
  work = mkdtempSync(join(tmpdir(), "kitluy-runtime-report-it-"));
});
afterAll(async () => {
  await pool.end();
  rmSync(work, { recursive: true, force: true });
});

describe("a Terminal's signed report is recorded, once, under its enrolled key", () => {
  it("accepts a report signed by the enrolled identity key, and the read carries a cloud-clock age", async () => {
    const board = await enrolled("terminal");
    const body = signRuntimeReport({
      deviceId: board.deviceId,
      reportSequence: 1_000,
      observedAt: "2026-09-17T03:00:02.000Z",
      report: REPORT,
      keyPath: board.keyPath,
    });
    const answer = await send(body);
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect(answer.body["outcome"]).toBe("ACCEPTED");
    const row = await stored(board.deviceId);
    expect(row?.report_sequence).toBe("1000");
    expect(row?.report["hubLink"]).toMatchObject({ phase: "SERVING" });
    expect(Number(row?.report_age_seconds)).toBeLessThan(60);
  });

  it("a replay, and an older sequence, are STALE and change nothing", async () => {
    const board = await enrolled("terminal");
    const first = signRuntimeReport({
      deviceId: board.deviceId,
      reportSequence: 2_000,
      observedAt: "2026-09-17T03:00:02.000Z",
      report: REPORT,
      keyPath: board.keyPath,
    });
    expect((await send(first)).body["outcome"]).toBe("ACCEPTED");
    expect((await send(first)).body["outcome"]).toBe("STALE");
    const older = signRuntimeReport({
      deviceId: board.deviceId,
      reportSequence: 1_999,
      observedAt: "2026-09-17T03:00:03.000Z",
      report: { ...REPORT, pos: { ...REPORT.pos, state: "hub_unavailable" } },
      keyPath: board.keyPath,
    });
    expect((await send(older)).body["outcome"]).toBe("STALE");
    expect((await stored(board.deviceId))?.report["pos"]).toMatchObject({ state: "ready" });
  });

  it("a newer report supersedes the stored one", async () => {
    const board = await enrolled("terminal");
    for (const [sequence, state] of [
      [3_000, "staff_authentication_required"],
      [3_001, "ready"],
    ] as const) {
      await send(
        signRuntimeReport({
          deviceId: board.deviceId,
          reportSequence: sequence,
          observedAt: "2026-09-17T03:00:02.000Z",
          report: { ...REPORT, pos: { ...REPORT.pos, state } },
          keyPath: board.keyPath,
        }),
      );
    }
    expect((await stored(board.deviceId))?.report["pos"]).toMatchObject({ state: "ready" });
  });
});

describe("who may NOT write a Terminal's status", () => {
  it("a validly signed report from a key the cloud did not enroll for this device", async () => {
    const board = await enrolled("terminal");
    const stranger = await enrolled("terminal");
    const answer = await send(
      signRuntimeReport({
        deviceId: board.deviceId,
        reportSequence: 1,
        observedAt: "2026-09-17T03:00:02.000Z",
        report: REPORT,
        keyPath: stranger.keyPath,
      }),
    );
    expect(answer.status).toBe(403);
    expect(await stored(board.deviceId)).toBeUndefined();
  });

  it("a report altered after signing", async () => {
    const board = await enrolled("terminal");
    const body = signRuntimeReport({
      deviceId: board.deviceId,
      reportSequence: 1,
      observedAt: "2026-09-17T03:00:02.000Z",
      report: REPORT,
      keyPath: board.keyPath,
    });
    const answer = await send({
      ...body,
      report: { ...REPORT, pos: { ...REPORT.pos, staffSignedIn: false } },
    });
    expect(answer.status).toBe(403);
    expect(await stored(board.deviceId)).toBeUndefined();
  });

  it("a Store Hub, even with its own enrolled key", async () => {
    const hub = await enrolled("store_hub");
    const answer = await send(
      signRuntimeReport({
        deviceId: hub.deviceId,
        reportSequence: 1,
        observedAt: "2026-09-17T03:00:02.000Z",
        report: REPORT,
        keyPath: hub.keyPath,
      }),
    );
    expect(answer.status).toBe(403);
  });

  it("an unknown device, and a report with an extra field", async () => {
    const board = await enrolled("terminal");
    const unknown = signRuntimeReport({
      deviceId: randomUUID(),
      reportSequence: 1,
      observedAt: "2026-09-17T03:00:02.000Z",
      report: REPORT,
      keyPath: board.keyPath,
    });
    expect((await send(unknown)).status).toBe(403);
    const extra = signRuntimeReport({
      deviceId: board.deviceId,
      reportSequence: 1,
      observedAt: "2026-09-17T03:00:02.000Z",
      report: { ...REPORT, customerPhone: "012345678" },
      keyPath: board.keyPath,
    });
    // VALIDATION_FAILED is 422 in this service (httpStatusFor).
    expect((await send(extra)).status).toBe(422);
  });

  it("the runtime service cannot write the table directly, and nobody can delete a status", async () => {
    const board = await enrolled("terminal");
    await send(
      signRuntimeReport({
        deviceId: board.deviceId,
        reportSequence: 1,
        observedAt: "2026-09-17T03:00:02.000Z",
        report: REPORT,
        keyPath: board.keyPath,
      }),
    );
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set local role kitluy_device_runtime_service");
      await expect(
        client.query(
          `update kitluy_devices.device_runtime_status set report_sequence = 99 where device_id = $1`,
          [board.deviceId],
        ),
      ).rejects.toThrow(/permission denied/u);
      await client.query("rollback");
      await client.query("begin");
      await expect(
        client.query(`delete from kitluy_devices.device_runtime_status where device_id = $1`, [
          board.deviceId,
        ]),
      ).rejects.toThrow(/KLUY-RUNTIME-STATUS-IMMUTABLE|permission denied/u);
      await client.query("rollback");
    } finally {
      client.release();
    }
  });
});
