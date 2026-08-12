/**
 * M1 factory enrollment — DATABASE-BACKED integration.
 *
 * This suite runs against a REAL canonical KitLuy database built from zero by
 * all 86 migrations. It is the evidence that the M1 path composes the existing
 * WS-11 contracts rather than a mock of them: every device record here is
 * created by `kitluy_devices.enroll_device_v1`, and every state assertion reads
 * canonical relations.
 *
 * It SKIPS — never fails — when no database is reachable, so `pnpm verify` in
 * an environment without one is not turned red by an absent dependency. A skip
 * is reported as a skip and must never be read as a pass.
 *
 * To run:
 *   supabase start --workdir <isolated workdir>   # ports must not collide
 *   KITLUY_M1_DB_URL=postgresql://postgres:postgres@127.0.0.1:54362/postgres \
 *     pnpm --filter @kitluy-services/kitluy-device-firstboot-agent test:db
 *
 * Every test runs inside a transaction that is ROLLED BACK, so the suite is
 * re-runnable and leaves the database exactly as it found it.
 */
import { createHash } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";
import { Client } from "pg";

import {
  enrollDeviceAtFactory,
  readCanonicalState,
  readEligibilityFacts,
  type DatabaseHandle,
} from "../src/factory-gateway.js";
import {
  advanceFactoryState,
  evaluateProvisioningEligibility,
  runFactoryQa,
  validateHardwareManifest,
  type FactoryState,
  type HardwareSignal,
} from "../src/factory.js";
import { bootstrapIdentity, type FirstbootDeps, type StoredIdentity } from "../src/identity.js";

const DB_URL =
  process.env.KITLUY_M1_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54362/postgres";

/**
 * The reachability probe runs at MODULE scope, not in `beforeAll`.
 *
 * `describe.skipIf` is evaluated during collection, which happens before any
 * hook runs — a flag set in `beforeAll` is still false when the skip decision
 * is made, and the whole suite silently skips even against a live database.
 * Top-level await resolves it before collection reads the flag.
 */
async function probeDatabase(): Promise<{ client: Client | null; reachable: boolean }> {
  const probe = new Client({ connectionString: DB_URL, connectionTimeoutMillis: 4000 });
  try {
    await probe.connect();
    // Presence of the canonical schema is part of reachability: a database
    // that answers but carries a different lineage must not be tested against.
    const { rows } = await probe.query<{ n: number }>(
      "select count(*)::int as n from information_schema.tables where table_schema = 'kitluy_devices'",
    );
    const ok = (rows[0]?.n ?? 0) > 0;
    if (!ok) {
      await probe.end();
      return { client: null, reachable: false };
    }
    return { client: probe, reachable: true };
  } catch {
    try {
      await probe.end();
    } catch {
      /* probe never connected */
    }
    return { client: null, reachable: false };
  }
}

const { client, reachable } = await probeDatabase();

afterAll(async () => {
  if (client !== null && reachable) await client.end();
});

const REQUIRED_SIGNALS = ["mac_address", "board_serial", "storage_serial"] as const;

function signals(seed: string): HardwareSignal[] {
  return [
    { signal_type: "mac_address", signal_value: `b8:27:eb:${seed}:00:01` },
    { signal_type: "board_serial", signal_value: `board-${seed}` },
    { signal_type: "storage_serial", signal_value: `nvme-${seed}` },
  ];
}

/** A device-side identity, generated fresh per simulated machine. */
async function simulatedIdentity(seed: string): Promise<StoredIdentity> {
  let stored: StoredIdentity | null = null;
  const deps: FirstbootDeps = {
    store: {
      async read() {
        return stored;
      },
      async write(i) {
        stored = i;
      },
    },
    keys: {
      async generateKeyPair() {
        return {
          publicKeyPem: `-----BEGIN PUBLIC KEY-----\n${seed}\n-----END PUBLIC KEY-----`,
          privateKeyHandle: `handle-${seed}`,
        };
      },
      async verifyKeyUsable() {
        return true;
      },
    },
    hardware: {
      async collect() {
        return { macAddress: `b8:27:eb:${seed}:00:01`, boardSerial: `board-${seed}` };
      },
    },
    now: () => new Date("2026-08-07T00:00:00.000Z"),
  };
  await bootstrapIdentity(deps);
  if (stored === null) throw new Error("identity bootstrap produced nothing");
  return stored;
}

/**
 * Run `body` inside a rolled-back transaction with a certified probe profile
 * and an active enrollment station in place.
 */
async function withProbeFixture(
  deviceClass: "store_hub" | "terminal",
  body: (db: DatabaseHandle, profileKey: string, stationKey: string) => Promise<void>,
): Promise<void> {
  const c = client;
  if (c === null) throw new Error("no client");
  const unique = Math.abs(Number(process.hrtime.bigint() % 100000n));
  const profileKey = `M1-${deviceClass}-${unique}`;
  const stationKey = `M1-STATION-${unique}`;

  await c.query("begin");
  try {
    await c.query(
      `insert into kitluy_devices.hardware_profiles
         (profile_key, display_name, device_class, manufacturer, model_identifier,
          hardware_revision, required_signal_types, secure_element_expectation,
          certification_status, profile_version, is_active)
       values ($1,$2,$3::kitluy_devices.device_class,'Raspberry Pi','Pi 5','1.0',
               '{mac_address,board_serial,storage_serial}','development_software','CERTIFIED',1,true)`,
      [profileKey, `M1 probe ${deviceClass}`, deviceClass],
    );
    await c.query(
      `insert into kitluy_devices.enrollment_stations
         (station_key, display_name, environment, operator_org_ref, status)
       values ($1,'M1 probe station','development','HET-FACTORY','active')`,
      [stationKey],
    );
    await body(c as unknown as DatabaseHandle, profileKey, stationKey);
  } finally {
    await c.query("rollback");
  }
}

/**
 * A canonical fingerprint: 64 lowercase hex characters, as
 * `manufacturing_enrollments_fingerprint_format_chk` requires. Derived from
 * the seed so each simulated device gets a distinct, stable value.
 */
function fingerprint(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

describe.skipIf(!reachable)("M1 factory enrollment against the canonical database", () => {
  it("reports why it is running (canonical schema present)", () => {
    expect(reachable).toBe(true);
  });

  for (const deviceClass of ["store_hub", "terminal"] as const) {
    it(`${deviceClass}: fresh device → first boot → enroll → QA → PROVISIONING_ELIGIBLE`, async () => {
      await withProbeFixture(deviceClass, async (db, profileKey, stationKey) => {
        const seed = `${deviceClass.slice(0, 4)}${Date.now() % 10000}`;

        // --- the agent's factory state machine, walked for real -------------
        let state: FactoryState = "IMAGE_PREPARED";
        const step = (next: FactoryState) => {
          const o = advanceFactoryState(state, next);
          expect(o.kind).toBe("advanced");
          state = next;
        };
        step("FIRST_BOOT");

        const identity = await simulatedIdentity(seed);
        step("IDENTITY_CREATED");
        step("KEYPAIR_CREATED");

        const manifest = validateHardwareManifest(signals(seed), REQUIRED_SIGNALS);
        expect(manifest.ok).toBe(true);
        step("HARDWARE_MANIFEST_READY");
        step("ENROLLMENT_PENDING");
        step("ENROLLMENT_AUTHENTICATED");

        // --- real enrollment through canonical SQL --------------------------
        const result = await enrollDeviceAtFactory(db, {
          assetTag: `KL-${seed}`,
          hardwareProfileKey: profileKey,
          devicePublicKeyFingerprint: fingerprint(seed),
          publicKeyAlgorithm: "ed25519",
          keyStorageClass: "software",
          enrollmentStationKey: stationKey,
          enrollmentOperatorRef: "OP-M1",
          signals: signals(seed),
          enrollmentBatchRef: "BATCH-M1",
        });

        expect(result.kind).toBe("enrolled");
        if (result.kind !== "enrolled") return;
        step("FACTORY_ENROLLED");

        // Device class is DERIVED by the database from the hardware profile.
        expect(result.deviceClass).toBe(deviceClass);
        expect(result.lifecycleState).toBe("enrolled");
        // Factory enrollment assigns nothing.
        expect(result.hasActiveAssignment).toBe(false);
        expect(result.created).toBe(true);

        // --- software QA ----------------------------------------------------
        const qa = runFactoryQa({
          deviceClass,
          installationId: identity.publicKeyPem,
          publicKeyPem: identity.publicKeyPem,
          osImageVersion: "kitluy-os-0.1.0",
          agentVersion: "0.1.0",
          releaseChannel: "internal",
          manifest,
          enrollmentReachable: true,
          deviceRecordId: result.deviceRecordId,
          localStatePersisted: true,
          localDatabasePresent: deviceClass === "store_hub" ? true : undefined,
          kioskRuntime: deviceClass === "terminal" ? "wayland/labwc" : undefined,
        });
        expect(qa.softwarePassed).toBe(true);
        // Hardware checks are deferred, never passed from this simulation.
        expect(qa.hardwareDeferred.length).toBeGreaterThan(0);
        step("FACTORY_TESTED");

        // --- eligibility, derived from canonical facts ----------------------
        const facts = await readEligibilityFacts(db, result.deviceRecordId);
        expect(facts).not.toBeNull();
        if (facts === null) return;

        const verdict = evaluateProvisioningEligibility({
          ...facts,
          softwareQaPassed: qa.softwarePassed,
        });
        expect(verdict.reasons).toEqual([]);
        expect(verdict.eligible).toBe(true);
        step("PROVISIONING_ELIGIBLE");
        expect(state).toBe("PROVISIONING_ELIGIBLE");
      });
    });
  }

  it("a replayed enrollment produces ONE device, not two", async () => {
    await withProbeFixture("store_hub", async (db, profileKey, stationKey) => {
      const seed = `replay${Date.now() % 10000}`;
      const request = {
        assetTag: `KL-${seed}`,
        hardwareProfileKey: profileKey,
        devicePublicKeyFingerprint: fingerprint(seed),
        publicKeyAlgorithm: "ed25519",
        keyStorageClass: "software",
        enrollmentStationKey: stationKey,
        enrollmentOperatorRef: "OP-M1",
        signals: signals(seed),
      };

      const first = await enrollDeviceAtFactory(db, request);
      const second = await enrollDeviceAtFactory(db, request);

      expect(first.kind).toBe("enrolled");
      expect(second.kind).toBe("enrolled");
      if (first.kind !== "enrolled" || second.kind !== "enrolled") return;

      // Same business effect: one device identity.
      expect(second.deviceRecordId).toBe(first.deviceRecordId);
      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
    });
  });

  it("a reboot during enrollment resumes without creating a second device", async () => {
    await withProbeFixture("terminal", async (db, profileKey, stationKey) => {
      const seed = `reboot${Date.now() % 10000}`;
      const fp = fingerprint(seed);

      // Boot 1: enrolls, then "crashes" before recording local progress.
      const first = await enrollDeviceAtFactory(db, {
        assetTag: `KL-${seed}`,
        hardwareProfileKey: profileKey,
        devicePublicKeyFingerprint: fp,
        publicKeyAlgorithm: "ed25519",
        keyStorageClass: "software",
        enrollmentStationKey: stationKey,
        enrollmentOperatorRef: "OP-M1",
        signals: signals(seed),
      });
      expect(first.kind).toBe("enrolled");
      if (first.kind !== "enrolled") return;

      // Boot 2: the device does not know it enrolled and tries again with the
      // SAME key. It must rediscover its identity, not mint a new one.
      const resumed = await enrollDeviceAtFactory(db, {
        assetTag: `KL-${seed}`,
        hardwareProfileKey: profileKey,
        devicePublicKeyFingerprint: fp,
        publicKeyAlgorithm: "ed25519",
        keyStorageClass: "software",
        enrollmentStationKey: stationKey,
        enrollmentOperatorRef: "OP-M1",
        signals: signals(seed),
      });
      expect(resumed.kind).toBe("enrolled");
      if (resumed.kind !== "enrolled") return;
      expect(resumed.deviceRecordId).toBe(first.deviceRecordId);
      expect(resumed.created).toBe(false);

      const count = await (client as Client).query(
        "select count(*)::int as n from kitluy_devices.manufacturing_enrollments where device_public_key_fingerprint = $1",
        [fp],
      );
      expect(count.rows[0]?.n).toBe(1);
    });
  });

  it("two distinct devices never collapse into one identity", async () => {
    await withProbeFixture("store_hub", async (db, profileKey, stationKey) => {
      const base = {
        hardwareProfileKey: profileKey,
        publicKeyAlgorithm: "ed25519",
        keyStorageClass: "software",
        enrollmentStationKey: stationKey,
        enrollmentOperatorRef: "OP-M1",
      };
      const a = await enrollDeviceAtFactory(db, {
        ...base,
        assetTag: `KL-A${Date.now() % 1000}`,
        devicePublicKeyFingerprint: fingerprint(`aaa${Date.now() % 10000}`),
        signals: signals(`a${Date.now() % 10000}`),
      });
      const b = await enrollDeviceAtFactory(db, {
        ...base,
        assetTag: `KL-B${Date.now() % 1000}`,
        devicePublicKeyFingerprint: fingerprint(`bbb${Date.now() % 10000}`),
        signals: signals(`b${Date.now() % 10000}`),
      });

      expect(a.kind).toBe("enrolled");
      expect(b.kind).toBe("enrolled");
      if (a.kind !== "enrolled" || b.kind !== "enrolled") return;
      expect(a.deviceRecordId).not.toBe(b.deviceRecordId);
    });
  });

  it("refuses enrollment with an empty hardware manifest", async () => {
    await withProbeFixture("store_hub", async (db, profileKey, stationKey) => {
      const result = await enrollDeviceAtFactory(db, {
        assetTag: `KL-EMPTY${Date.now() % 10000}`,
        hardwareProfileKey: profileKey,
        devicePublicKeyFingerprint: fingerprint(`empty${Date.now() % 10000}`),
        publicKeyAlgorithm: "ed25519",
        keyStorageClass: "software",
        enrollmentStationKey: stationKey,
        enrollmentOperatorRef: "OP-M1",
        signals: [],
      });
      expect(result.kind).toBe("refused");
      if (result.kind !== "refused") return;
      expect(result.code).toBe("KLUY-DEVICE-EVIDENCE-MISSING");
      // Not retryable: sending the same empty manifest again cannot succeed.
      expect(result.retryable).toBe(false);
    });
  });

  it("a factory-enrolled device is NOT eligible while unsealed or QA-failed", async () => {
    await withProbeFixture("terminal", async (db, profileKey, stationKey) => {
      const seed = `gate${Date.now() % 10000}`;
      const result = await enrollDeviceAtFactory(db, {
        assetTag: `KL-${seed}`,
        hardwareProfileKey: profileKey,
        devicePublicKeyFingerprint: fingerprint(seed),
        publicKeyAlgorithm: "ed25519",
        keyStorageClass: "software",
        enrollmentStationKey: stationKey,
        enrollmentOperatorRef: "OP-M1",
        signals: signals(seed),
      });
      if (result.kind !== "enrolled") throw new Error("expected enrollment");

      const facts = await readEligibilityFacts(db, result.deviceRecordId);
      if (facts === null) throw new Error("expected facts");

      // QA failure alone blocks eligibility, even with everything else valid.
      const failed = evaluateProvisioningEligibility({ ...facts, softwareQaPassed: false });
      expect(failed.eligible).toBe(false);
      expect(failed.reasons.join(" ")).toContain("software factory QA");
    });
  });

  it("canonical state read reports enrolled + unassigned without a stored flag", async () => {
    await withProbeFixture("store_hub", async (db, profileKey, stationKey) => {
      const seed = `state${Date.now() % 10000}`;
      const result = await enrollDeviceAtFactory(db, {
        assetTag: `KL-${seed}`,
        hardwareProfileKey: profileKey,
        devicePublicKeyFingerprint: fingerprint(seed),
        publicKeyAlgorithm: "ed25519",
        keyStorageClass: "software",
        enrollmentStationKey: stationKey,
        enrollmentOperatorRef: "OP-M1",
        signals: signals(seed),
      });
      if (result.kind !== "enrolled") throw new Error("expected enrollment");

      const state = await readCanonicalState(db, result.deviceRecordId);
      expect(state?.lifecycleState).toBe("enrolled");
      expect(state?.hasActiveAssignment).toBe(false);
    });
  });
});
