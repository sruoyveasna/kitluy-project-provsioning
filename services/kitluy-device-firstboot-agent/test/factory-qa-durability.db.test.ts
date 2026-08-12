/**
 * Durable factory QA — RESTART SURVIVAL.
 *
 * ===========================================================================
 * WHY THIS SUITE COMMITS INSTEAD OF ROLLING BACK
 * ===========================================================================
 * Every other database suite here wraps each test in a transaction and rolls
 * it back. This one cannot, and the reason is the whole point of the group it
 * tests: durability means the record outlives the process that wrote it. A
 * value that is only visible inside the writing transaction proves nothing —
 * a second connection cannot see it, which is precisely the failure mode
 * ("QA passed, but only in memory") that migration 0188 exists to close.
 *
 * So these tests COMMIT, then drop the connection entirely and open a new one.
 * A fresh `pg.Client` shares no session state, no transaction and no cache
 * with the first: it is the closest in-process analogue of the firstboot agent
 * being killed and restarted.
 *
 * ===========================================================================
 * WHY THE FIXTURES ARE DETERMINISTIC
 * ===========================================================================
 * `factory_qa_executions` is append-only — the trigger refuses DELETE — so a
 * suite that generated a random device per run would grow the database
 * forever and could never tidy up after itself. Instead each fixture derives
 * its identity from a fixed seed, so re-running is idempotent: enrollment
 * resolves the same device by key fingerprint, and QA resolves the same
 * execution by `execution_ref`.
 */
import { createHash } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";
import { Client } from "pg";

import {
  enrollDeviceAtFactory,
  persistFactoryQa,
  readCurrentFactoryQa,
  readProvisioningEligibility,
  type DatabaseHandle,
} from "../src/factory-gateway.js";
import { runFactoryQa, validateHardwareManifest, type HardwareSignal } from "../src/factory.js";

const DB_URL =
  process.env.KITLUY_M1_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54402/postgres";

const HUB_PROFILE_KEY = "WS11-T001-HUB-PROBE";
const REQUIRED_SIGNALS = ["mac_address", "board_serial", "storage_serial"] as const;

async function probeDatabase(): Promise<boolean> {
  const probe = new Client({ connectionString: DB_URL, connectionTimeoutMillis: 4000 });
  try {
    await probe.connect();
    const { rows } = await probe.query<{ n: number }>(
      `select count(*)::int as n from information_schema.tables
        where table_schema = 'kitluy_devices' and table_name = 'factory_qa_executions'`,
    );
    await probe.end();
    return (rows[0]?.n ?? 0) > 0;
  } catch {
    try {
      await probe.end();
    } catch {
      /* never connected */
    }
    return false;
  }
}

const reachable = await probeDatabase();

/** Deterministic hex, so a re-run resolves the same device instead of a new one. */
function seededHex(seed: string, bytes = 32): string {
  return createHash("sha256")
    .update(seed)
    .digest("hex")
    .slice(0, bytes * 2);
}

function fixtureSignals(seed: string): HardwareSignal[] {
  const h = seededHex(seed);
  return [
    { signal_type: "mac_address", signal_value: (h.slice(0, 12).match(/../g) ?? []).join(":") },
    { signal_type: "board_serial", signal_value: `BS-${h.slice(12, 28)}` },
    { signal_type: "storage_serial", signal_value: `SS-${h.slice(28, 44)}` },
  ];
}

interface Fixture {
  readonly deviceRecordId: string;
  readonly signals: readonly HardwareSignal[];
}

/** Enrol (or resolve) the deterministic fixture device for a seed. */
async function ensureFixture(db: DatabaseHandle, seed: string): Promise<Fixture> {
  const signals = fixtureSignals(seed);
  const result = await enrollDeviceAtFactory(db, {
    assetTag: `DEV-QADUR-${seededHex(seed, 4).toUpperCase()}`,
    hardwareProfileKey: HUB_PROFILE_KEY,
    devicePublicKeyFingerprint: seededHex(`${seed}:key`),
    publicKeyAlgorithm: "ed25519",
    keyStorageClass: "software",
    enrollmentStationKey: "STATION-QA-DURABILITY-DEV",
    enrollmentOperatorRef: "HET-MFG/qa-durability-suite",
    signals,
  });

  if (result.kind !== "enrolled") {
    throw new Error(`fixture enrollment refused: ${result.code} ${result.detail}`);
  }
  return { deviceRecordId: result.deviceRecordId, signals };
}

function passingQaReport(signals: readonly HardwareSignal[]) {
  return runFactoryQa({
    deviceClass: "store_hub",
    installationId: "inst-qa-durability",
    publicKeyPem: "-----BEGIN PUBLIC KEY-----\nAAA\n-----END PUBLIC KEY-----",
    osImageVersion: "kitluy-storehub-os-arm64-DEV",
    agentVersion: "0.1.0",
    releaseChannel: "internal",
    manifest: validateHardwareManifest(signals, REQUIRED_SIGNALS),
    enrollmentReachable: true,
    deviceRecordId: "set-below",
    localStatePersisted: true,
    localDatabasePresent: true,
  });
}

function failingQaReport(signals: readonly HardwareSignal[]) {
  // A genuinely failing run: the local database the Store Hub profile requires
  // is absent. Not a synthetic "fail" flag — the same predicate that would
  // fail on a real Hub missing PostgreSQL.
  return runFactoryQa({
    deviceClass: "store_hub",
    installationId: "inst-qa-durability-fail",
    publicKeyPem: "-----BEGIN PUBLIC KEY-----\nAAA\n-----END PUBLIC KEY-----",
    osImageVersion: "kitluy-storehub-os-arm64-DEV",
    agentVersion: "0.1.0",
    releaseChannel: "internal",
    manifest: validateHardwareManifest(signals, REQUIRED_SIGNALS),
    enrollmentReachable: true,
    deviceRecordId: "set-below",
    localStatePersisted: true,
    localDatabasePresent: false,
  });
}

const openClients: Client[] = [];
async function connect(): Promise<Client> {
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  openClients.push(c);
  return c;
}

afterAll(async () => {
  await Promise.all(openClients.map((c) => c.end().catch(() => undefined)));
});

describe.skipIf(!reachable)("durable factory QA survives a process restart", () => {
  it("records a passing QA run and derives eligibility from storage", async () => {
    const db = await connect();
    const fx = await ensureFixture(db, "qa-dur-pass");

    const report = passingQaReport(fx.signals);
    expect(report.softwarePassed).toBe(true);

    const persisted = await persistFactoryQa(db, {
      deviceRecordId: fx.deviceRecordId,
      executionRef: "qa-dur-pass-run-1",
      qaProfileKey: "kitluy-store-hub-factory-qa",
      qaProfileVersion: "1.0.0",
      stationId: "STATION-QA-DURABILITY-DEV",
      operatorRef: "HET-MFG/qa-durability-suite",
      report,
      startedAt: new Date(Date.now() - 5_000),
      completedAt: new Date(),
      agentVersion: "0.1.0",
      osImageVersion: "kitluy-storehub-os-arm64-DEV",
      releaseChannel: "internal",
    });

    expect(persisted.kind).toBe("recorded");

    const eligibility = await readProvisioningEligibility(db, fx.deviceRecordId);
    expect(eligibility.reasons).toEqual([]);
    expect(eligibility.eligible).toBe(true);
  });

  it("PROCESS RESTART: a brand new connection still sees the pass and the eligibility", async () => {
    const first = await connect();
    const fx = await ensureFixture(first, "qa-dur-pass");
    // Drop the writer entirely — no session state, no transaction, no cache.
    await first.end();
    openClients.splice(openClients.indexOf(first), 1);

    const restarted = await connect();
    const qa = await readCurrentFactoryQa(restarted, fx.deviceRecordId);
    expect(qa).not.toBeNull();
    expect(qa?.result).toBe("passed");
    expect(qa?.checksFailed).toBe(0);
    expect(qa?.evidenceSha256).toMatch(/^[0-9a-f]{64}$/);

    const eligibility = await readProvisioningEligibility(restarted, fx.deviceRecordId);
    expect(eligibility.eligible).toBe(true);
  });

  it("a failed QA run persists and keeps the device INELIGIBLE across a restart", async () => {
    const first = await connect();
    const fx = await ensureFixture(first, "qa-dur-fail");

    const report = failingQaReport(fx.signals);
    expect(report.softwarePassed).toBe(false);

    const persisted = await persistFactoryQa(first, {
      deviceRecordId: fx.deviceRecordId,
      executionRef: "qa-dur-fail-run-1",
      qaProfileKey: "kitluy-store-hub-factory-qa",
      qaProfileVersion: "1.0.0",
      stationId: "STATION-QA-DURABILITY-DEV",
      operatorRef: "HET-MFG/qa-durability-suite",
      report,
      startedAt: new Date(Date.now() - 5_000),
      completedAt: new Date(),
    });
    expect(persisted.kind).toBe("recorded");

    await first.end();
    openClients.splice(openClients.indexOf(first), 1);

    const restarted = await connect();
    const qa = await readCurrentFactoryQa(restarted, fx.deviceRecordId);
    expect(qa?.result).toBe("failed");
    expect(qa?.failureReasonCode).not.toBeNull();

    const eligibility = await readProvisioningEligibility(restarted, fx.deviceRecordId);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons.join(" ")).toMatch(/factory QA failed/);
  });

  it("a device with no QA at all is not eligible — absence is a denial, never a pass", async () => {
    const db = await connect();
    const fx = await ensureFixture(db, "qa-dur-noqa");

    const qa = await readCurrentFactoryQa(db, fx.deviceRecordId);
    expect(qa).toBeNull();

    const eligibility = await readProvisioningEligibility(db, fx.deviceRecordId);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons.join(" ")).toMatch(/no factory QA execution is recorded/);
  });
});

describe.skipIf(!reachable)("durable factory QA integrity rules", () => {
  it("is idempotent: the same execution_ref returns the same execution", async () => {
    const db = await connect();
    const fx = await ensureFixture(db, "qa-dur-pass");
    const report = passingQaReport(fx.signals);

    const common = {
      deviceRecordId: fx.deviceRecordId,
      executionRef: "qa-dur-pass-run-1",
      qaProfileKey: "kitluy-store-hub-factory-qa",
      qaProfileVersion: "1.0.0",
      stationId: "STATION-QA-DURABILITY-DEV",
      operatorRef: "HET-MFG/qa-durability-suite",
      report,
      startedAt: new Date(Date.now() - 5_000),
      completedAt: new Date(),
    };

    const a = await persistFactoryQa(db, common);
    const b = await persistFactoryQa(db, common);
    expect(a.kind).toBe("recorded");
    expect(b).toEqual(a);
  });

  it("refuses a same-ref resubmission carrying DIFFERENT evidence", async () => {
    const db = await connect();
    const fx = await ensureFixture(db, "qa-dur-pass");

    const conflicting = await persistFactoryQa(db, {
      deviceRecordId: fx.deviceRecordId,
      executionRef: "qa-dur-pass-run-1",
      qaProfileKey: "kitluy-store-hub-factory-qa",
      qaProfileVersion: "1.0.0",
      stationId: "STATION-QA-DURABILITY-DEV",
      operatorRef: "HET-MFG/qa-durability-suite",
      report: failingQaReport(fx.signals),
      startedAt: new Date(Date.now() - 5_000),
      completedAt: new Date(),
    });

    expect(conflicting).toEqual({
      kind: "refused",
      code: "KLUY-DEVICE-QA-EVIDENCE-CONFLICT",
      detail: "KLUY-DEVICE-QA-EVIDENCE-CONFLICT",
    });
  });

  it("the database refuses a hardware-in-the-loop check recorded as passed", async () => {
    const db = await connect();
    const fx = await ensureFixture(db, "qa-dur-pass");

    // Bypass the agent entirely and submit straight to the governed door: the
    // constraint must hold even when the caller is not our TypeScript.
    await expect(
      db.query(
        `select kitluy_devices.record_factory_qa_v1(
           $1::uuid, 'qa-dur-hil-attempt', 'kitluy-store-hub-factory-qa', '1.0.0',
           'STATION-QA-DURABILITY-DEV', 'HET-MFG/qa-durability-suite',
           $2::jsonb, now() - interval '5 seconds', now(),
           null, null, null, null)`,
        [
          fx.deviceRecordId,
          JSON.stringify([
            { name: "nvme_storage", outcome: "pass", hardware_in_loop: true, detail: "faked" },
          ]),
        ],
      ),
    ).rejects.toThrow(/factory_qa_check_results_hil_never_pass_chk/);
  });

  it("QA evidence is append-only: UPDATE and DELETE are refused", async () => {
    const db = await connect();
    const fx = await ensureFixture(db, "qa-dur-pass");
    const qa = await readCurrentFactoryQa(db, fx.deviceRecordId);
    expect(qa).not.toBeNull();

    await expect(
      db.query(`update kitluy_devices.factory_qa_executions set result = 'passed' where id = $1`, [
        qa?.executionId,
      ]),
    ).rejects.toThrow();

    await expect(
      db.query(`delete from kitluy_devices.factory_qa_executions where id = $1`, [qa?.executionId]),
    ).rejects.toThrow();
  });
});
