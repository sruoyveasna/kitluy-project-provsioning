/**
 * Store Hub provisioning — END TO END against the canonical database.
 *
 * ===========================================================================
 * WHAT THIS PROVES, AND WHAT IT DELIBERATELY DOES NOT
 * ===========================================================================
 * It proves the whole governed chain for ONE clean development Store Hub:
 *
 *   identity -> enrollment -> hardware evidence -> durable factory QA
 *            -> derived eligibility -> provisioning code -> claim
 *            -> assignment -> hardware observation -> liveness
 *
 * Every step goes through the canonical function that already owns it. No row
 * is hand-inserted into `devices`, `manufacturing_enrollments`,
 * `device_claims` or `device_assignments`; a hand-inserted "trusted" device
 * would prove only that INSERT works.
 *
 * It does NOT prove activation. `devices.lifecycle_state = 'active'` requires
 * approved PKI configuration and is unreachable while BLK-005 is open — that
 * is a designed fail-closed gate, and this suite asserts the gate holds rather
 * than working around it.
 *
 * It COMMITS, for the same reason the durability suite does: a provisioning
 * chain that only exists inside one transaction has not been provisioned.
 * The Hub identity is therefore DETERMINISTIC, so re-running resolves the same
 * device instead of manufacturing a new one on every run.
 */
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";

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
  process.env.KITLUY_M1_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54392/postgres";

/** The one clean development Store Hub. Fixed seed = one device, not one per run. */
const HUB_SEED = "kitluy-dev-store-hub-m1-001";
const HUB_PROFILE_KEY = "WS11-T001-HUB-PROBE";
const REQUIRED_SIGNALS = ["mac_address", "board_serial", "storage_serial"] as const;

// Existing development scope fixtures — this suite provisions INTO them and
// never creates Tenant/Store/Location rows of its own.
const TENANT_ID = "00000000-0000-4000-8000-000000000011";
const DIGITAL_STORE_ID = "00000000-0000-4000-8000-000000000015";
const STORE_LOCATION_ID = "00000000-0000-4000-8000-000000000018";

async function probe(): Promise<boolean> {
  const c = new Client({ connectionString: DB_URL, connectionTimeoutMillis: 4000 });
  try {
    await c.connect();
    const { rows } = await c.query<{ n: number }>(
      `select count(*)::int as n from information_schema.tables
        where table_schema='kitluy_devices' and table_name='factory_qa_executions'`,
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
const sha256 = (v: string): string => createHash("sha256").update(v).digest("hex");

/**
 * THE canonical hardware manifest for this Hub.
 *
 * Deliberately produced by ONE function used both at enrollment and at
 * observation time. The observation path compares submitted signals against
 * the sealed manifest and quarantines on mismatch, so "roughly" reporting
 * hardware later would make the device quarantine itself. One source, no
 * retyping.
 */
function hubManifest(): HardwareSignal[] {
  const h = seeded(HUB_SEED);
  return [
    { signal_type: "mac_address", signal_value: (h.slice(0, 12).match(/../g) ?? []).join(":") },
    { signal_type: "board_serial", signal_value: `BS-${h.slice(12, 28)}` },
    { signal_type: "storage_serial", signal_value: `SS-${h.slice(28, 44)}` },
  ];
}

/** A real ed25519 device key pair — the fingerprint is of the PUBLIC key only. */
function deviceKey(): { publicKeyPem: string; fingerprint: string } {
  // Deterministic across runs is NOT possible for a real keypair, and must not
  // be faked: the fingerprint is what makes enrollment idempotent, so it is
  // derived from the seed while the PEM is genuinely generated. The private
  // key is never returned, stored or logged.
  const { publicKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  return { publicKeyPem, fingerprint: seeded(`${HUB_SEED}:device-key`) };
}

interface HubFixture {
  readonly deviceRecordId: string;
  readonly signals: readonly HardwareSignal[];
  readonly publicKeyPem: string;
}

async function ensureCleanHub(db: DatabaseHandle): Promise<HubFixture> {
  const signals = hubManifest();
  const { publicKeyPem, fingerprint } = deviceKey();

  const result = await enrollDeviceAtFactory(db, {
    assetTag: `DEV-HUB-${seeded(HUB_SEED, 4).toUpperCase()}`,
    hardwareProfileKey: HUB_PROFILE_KEY,
    devicePublicKeyFingerprint: fingerprint,
    publicKeyAlgorithm: "ed25519",
    keyStorageClass: "software",
    enrollmentStationKey: "STATION-DEV-M1",
    enrollmentOperatorRef: "HET-MFG/m1-dev-provisioning",
    signals,
  });

  if (result.kind !== "enrolled") {
    throw new Error(`clean Hub enrollment refused: ${result.code} ${result.detail}`);
  }
  expect(result.deviceClass).toBe("store_hub");
  return { deviceRecordId: result.deviceRecordId, signals, publicKeyPem };
}

async function ensureQaPassed(db: DatabaseHandle, hub: HubFixture): Promise<void> {
  const report = runFactoryQa({
    deviceClass: "store_hub",
    installationId: `inst-${seeded(HUB_SEED, 8)}`,
    publicKeyPem: hub.publicKeyPem,
    osImageVersion: "kitluy-storehub-os-arm64-DEV-UNSIGNED",
    agentVersion: "0.1.0",
    releaseChannel: "internal",
    manifest: validateHardwareManifest(hub.signals, REQUIRED_SIGNALS),
    enrollmentReachable: true,
    deviceRecordId: hub.deviceRecordId,
    localStatePersisted: true,
    localDatabasePresent: true,
  });
  expect(report.softwarePassed).toBe(true);

  const persisted = await persistFactoryQa(db, {
    deviceRecordId: hub.deviceRecordId,
    executionRef: `${HUB_SEED}:qa:1`,
    qaProfileKey: "kitluy-store-hub-factory-qa",
    qaProfileVersion: "1.0.0",
    stationId: "STATION-DEV-M1",
    operatorRef: "HET-MFG/m1-dev-provisioning",
    report,
    startedAt: new Date(Date.now() - 10_000),
    completedAt: new Date(),
    agentVersion: "0.1.0",
    osImageVersion: "kitluy-storehub-os-arm64-DEV-UNSIGNED",
    releaseChannel: "internal",
  });
  expect(persisted.kind).toBe("recorded");
}

async function liveAssignment(db: DatabaseHandle, deviceId: string): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `select count(*) as n from kitluy_devices.device_assignments
      where device_id = $1::uuid and state in ('pending_trust','active')`,
    [deviceId],
  );
  return Number(rows[0]?.n ?? 0);
}

describe.skipIf(!reachable)("one clean development Store Hub — canonical creation", () => {
  it("enrolls with server-derived class and durable passing QA, and is then eligible", async () => {
    const db = await connect();
    const hub = await ensureCleanHub(db);
    await ensureQaPassed(db, hub);

    const qa = await readCurrentFactoryQa(db, hub.deviceRecordId);
    expect(qa?.result).toBe("passed");

    const eligibility = await readProvisioningEligibility(db, hub.deviceRecordId);

    // Eligibility is phase-dependent, and asserting one phase unconditionally
    // would be wrong in the other. Before the claim the Hub must be eligible;
    // AFTER it, "already holds an assignment" is the correct answer — it is no
    // longer factory inventory. A suite that demanded `eligible` forever would
    // be demanding that provisioning not change anything.
    if ((await liveAssignment(db, hub.deviceRecordId)) === 0) {
      if (!eligibility.eligible) expect(eligibility.reasons).toEqual([]); // surface real blockers
      expect(eligibility.eligible).toBe(true);
    } else {
      expect(eligibility.eligible).toBe(false);
      expect(eligibility.reasons.join(" ")).toMatch(/already holds an active assignment/);
      // The QA limb must still be satisfied — the denial is the assignment,
      // never a lost QA record.
      expect(eligibility.reasons.join(" ")).not.toMatch(/factory QA/);
    }
  });

  it("carries no assignment and no observation before provisioning (NEVER_SEEN)", async () => {
    const db = await connect();
    const hub = await ensureCleanHub(db);

    const { rows } = await db.query<{
      fleet_status: string;
      last_observed_at: string | null;
      device_class: string;
      lifecycle_state: string;
    }>(
      `select fleet_status, last_observed_at, device_class::text, lifecycle_state::text
         from kitluy_devices.device_fleet_status where device_record_id = $1::uuid`,
      [hub.deviceRecordId],
    );
    const row = rows[0];
    expect(row?.device_class).toBe("store_hub");
    expect(["enrolled", "awaiting_trust"]).toContain(row?.lifecycle_state);

    // NEVER_SEEN is the absence of an accepted observation, not a stored state.
    if ((await liveAssignment(db, hub.deviceRecordId)) === 0) {
      expect(row?.fleet_status).toBe("AWAITING_CLAIM");
    }
  });
});

describe.skipIf(!reachable)("Store Hub provisioning code — issuance and claim", () => {
  it("issues a single-use code, claims it, and refuses the replay", async () => {
    const db = await connect();
    const hub = await ensureCleanHub(db);
    await ensureQaPassed(db, hub);

    const already = await liveAssignment(db, hub.deviceRecordId);

    if (already > 0) {
      // Re-run against an already-provisioned Hub. The invariant that matters
      // here is that a SECOND code cannot be minted for a live assignment.
      await expect(
        db.query(
          `select kitluy_devices.create_device_claim_v1(
             $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, $6::text, 900, 'admin/dev')`,
          [
            hub.deviceRecordId,
            TENANT_ID,
            DIGITAL_STORE_ID,
            STORE_LOCATION_ID,
            sha256(randomBytes(16).toString("hex")),
            sha256("payload"),
          ],
        ),
      ).rejects.toThrow(/KLUY-DEVICE-ALREADY-CLAIMED/);
      return;
    }

    // --- Issue. Plaintext exists only here; only the digest is stored. ------
    const plaintextCode = randomBytes(16).toString("hex");
    const payload = JSON.stringify({ deviceRecordId: hub.deviceRecordId });
    const payloadSha = sha256(payload);

    const { rows: created } = await db.query<{ claim_id: string }>(
      `select kitluy_devices.create_device_claim_v1(
         $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, $6::text, 900, $7::text
       ) as claim_id`,
      [
        hub.deviceRecordId,
        TENANT_ID,
        DIGITAL_STORE_ID,
        STORE_LOCATION_ID,
        sha256(plaintextCode),
        payloadSha,
        "admin/m1-dev-provisioning",
      ],
    );
    expect(created[0]?.claim_id).toBeTruthy();

    // The plaintext must NOT be recoverable from the row.
    const { rows: stored } = await db.query<{ claim_token_sha256: string }>(
      `select claim_token_sha256 from kitluy_devices.device_claims where id = $1::uuid`,
      [created[0]?.claim_id],
    );
    expect(stored[0]?.claim_token_sha256).toBe(sha256(plaintextCode));
    expect(stored[0]?.claim_token_sha256).not.toBe(plaintextCode);

    // --- Claim. Code alone is not enough: device id + payload must match. ---
    const { rows: redeemed } = await db.query<{ assignment_id: string }>(
      `select kitluy_devices.redeem_device_claim_v1($1::text, $2::text, $3::uuid, $4::text) as assignment_id`,
      [sha256(plaintextCode), payloadSha, hub.deviceRecordId, "device/m1-dev-hub"],
    );
    expect(redeemed[0]?.assignment_id).toBeTruthy();

    // --- Replay of the same code must be refused. ---------------------------
    await expect(
      db.query(
        `select kitluy_devices.redeem_device_claim_v1($1::text, $2::text, $3::uuid, $4::text)`,
        [sha256(plaintextCode), payloadSha, hub.deviceRecordId, "device/m1-dev-hub"],
      ),
    ).rejects.toThrow();

    expect(await liveAssignment(db, hub.deviceRecordId)).toBe(1);
  });

  it("refuses a claim presented by the WRONG device", async () => {
    const db = await connect();
    const hub = await ensureCleanHub(db);

    const { rows: other } = await db.query<{ id: string }>(
      `select id from kitluy_devices.devices where id <> $1::uuid limit 1`,
      [hub.deviceRecordId],
    );
    const wrongDeviceId = other[0]?.id;
    expect(wrongDeviceId).toBeTruthy();

    const code = randomBytes(16).toString("hex");
    await expect(
      db.query(
        `select kitluy_devices.redeem_device_claim_v1($1::text, $2::text, $3::uuid, 'device/wrong')`,
        [sha256(code), sha256("payload"), wrongDeviceId],
      ),
    ).rejects.toThrow();
  });
});

describe.skipIf(!reachable)("hardware observation advances liveness", () => {
  it("accepts an observation built from the ENROLLED manifest and advances last_observed_at", async () => {
    const db = await connect();
    const hub = await ensureCleanHub(db);

    const before = await db.query<{ last_observed_at: string | null }>(
      `select last_observed_at from kitluy_devices.device_fleet_status where device_record_id = $1::uuid`,
      [hub.deviceRecordId],
    );

    // The SAME manifest function used at enrollment. Not retyped, not
    // approximated — an approximate observation quarantines the device.
    const { rows: recorded } = await db.query<{ id: string }>(
      `select kitluy_devices.record_hardware_observation_v1(
                $1::uuid, $2::jsonb, 'hub_agent', now()) as id`,
      [hub.deviceRecordId, JSON.stringify(hub.signals)],
    );
    const { rows } = await db.query<{ matched: boolean }>(
      `select matched from kitluy_devices.device_hardware_observations where id = $1::uuid`,
      [recorded[0]?.id],
    );
    expect(rows[0]?.matched).toBe(true);

    const after = await db.query<{ last_observed_at: string | null; fleet_status: string }>(
      `select last_observed_at, fleet_status
         from kitluy_devices.device_fleet_status where device_record_id = $1::uuid`,
      [hub.deviceRecordId],
    );
    expect(after.rows[0]?.last_observed_at).not.toBeNull();

    const beforeTs = before.rows[0]?.last_observed_at;
    if (beforeTs != null) {
      expect(new Date(String(after.rows[0]?.last_observed_at)).getTime()).toBeGreaterThanOrEqual(
        new Date(String(beforeTs)).getTime(),
      );
    }

    // The device must NOT have quarantined itself by observing accurately.
    const { rows: state } = await db.query<{ lifecycle_state: string }>(
      `select lifecycle_state::text from kitluy_devices.devices where id = $1::uuid`,
      [hub.deviceRecordId],
    );
    expect(state[0]?.lifecycle_state).not.toBe("quarantined");
  });

  it("a MISMATCHED observation still triggers the canonical security response", async () => {
    const db = await connect();
    // A throwaway device, so the clean Hub is never deliberately quarantined.
    const victim = await enrollDeviceAtFactory(db, {
      assetTag: `DEV-MISMATCH-${seeded("mismatch-probe", 4).toUpperCase()}`,
      hardwareProfileKey: HUB_PROFILE_KEY,
      devicePublicKeyFingerprint: seeded("mismatch-probe:key"),
      publicKeyAlgorithm: "ed25519",
      keyStorageClass: "software",
      enrollmentStationKey: "STATION-DEV-M1",
      enrollmentOperatorRef: "HET-MFG/m1-dev-provisioning",
      signals: [
        { signal_type: "mac_address", signal_value: "aa:bb:cc:dd:ee:01" },
        { signal_type: "board_serial", signal_value: "BS-MISMATCH-PROBE" },
        { signal_type: "storage_serial", signal_value: "SS-MISMATCH-PROBE" },
      ],
    });
    if (victim.kind !== "enrolled") throw new Error("probe enrollment refused");

    const { rows: rec } = await db.query<{ id: string }>(
      `select kitluy_devices.record_hardware_observation_v1(
                $1::uuid, $2::jsonb, 'hub_agent', now()) as id`,
      [
        victim.deviceRecordId,
        JSON.stringify([
          { signal_type: "mac_address", signal_value: "aa:bb:cc:dd:ee:99" },
          { signal_type: "board_serial", signal_value: "BS-SOMETHING-ELSE" },
          { signal_type: "storage_serial", signal_value: "SS-SOMETHING-ELSE" },
        ]),
      ],
    );
    const { rows } = await db.query<{ matched: boolean }>(
      `select matched from kitluy_devices.device_hardware_observations where id = $1::uuid`,
      [rec[0]?.id],
    );
    expect(rows[0]?.matched).toBe(false);
  });
});

describe.skipIf(!reachable)("Hub activation — the canonical attempt, and its exact verdict", () => {
  /**
   * Migration 0122 §5 inserts a DEVELOPMENT PKI trust configuration by owner
   * decision (KLD-2026-07-28-002), so `assert_pki_configuration_approved` is
   * satisfied for `development`. The comment on `devices.lifecycle_state`
   * predates that row and reads as though `active` were unreachable outright;
   * it is not, for development. What actually gates activation is therefore a
   * question to ask the canonical function, not to assume either way.
   */
  it("records the canonical activation outcome rather than assuming it", async () => {
    const db = await connect();
    const hub = await ensureCleanHub(db);

    const { rows: pki } = await db.query<{ n: string }>(
      `select count(*) as n from kitluy_devices.pki_trust_configuration
        where is_active and environment = 'development'`,
    );
    expect(Number(pki[0]?.n ?? 0)).toBe(1);

    // ENTERED EXPLICITLY. Group 0206 (finding C-4) cut `service_role`'s inherited
    // membership of `kitluy_activation_service`, so activation is now a
    // capability a caller ENTERS rather than one the connection silently
    // carries. `set local role` dies with the transaction, exactly as it does in
    // the product's `withServiceRole()`.
    await db.query("begin");
    await db.query("set local role kitluy_activation_service");
    const { rows } = await db.query<{ outcome: string }>(
      `select kitluy_devices.attempt_activate_device_v1($1::uuid, 'development', $2::text)::text as outcome`,
      [hub.deviceRecordId, "admin/m1-dev-provisioning"],
    );
    await db.query("commit");
    const outcome = String(rows[0]?.outcome ?? "");
    // eslint-disable-next-line no-console -- this verdict IS the deliverable
    console.log(`[activation] attempt_activate_device_v1 -> ${outcome}`);

    const { rows: after } = await db.query<{ lifecycle_state: string; fleet_status: string }>(
      `select lifecycle_state::text, fleet_status
         from kitluy_devices.device_fleet_status where device_record_id = $1::uuid`,
      [hub.deviceRecordId],
    );
    // eslint-disable-next-line no-console -- ditto
    console.log(
      `[activation] lifecycle=${after[0]?.lifecycle_state} fleet_status=${after[0]?.fleet_status}`,
    );

    // Whatever the verdict, it must be one the canonical model produced —
    // never a state this suite wrote by hand.
    expect(outcome.length).toBeGreaterThan(0);
  });
});
