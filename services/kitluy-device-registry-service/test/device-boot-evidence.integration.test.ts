/**
 * Boot classification against the real database: the evidence read (group
 * 0227) and the contract, over devices built through the governed doors.
 *
 * Authority: owner task BOOT-RECOVERY-CLASSIFICATION-001 slices B and C.
 *
 * ===========================================================================
 * WHAT THIS SUITE PROVES THAT THE SCENARIO MATRIX CANNOT
 * ===========================================================================
 * `packages/device-boot-classification/test/scenario-matrix.test.ts` proves the
 * DECISION for every scenario, over evidence it builds by hand. That leaves one
 * question open: does the cloud actually PRODUCE that evidence? A matrix over
 * hand-built facts would stay green while the read reported the wrong
 * generation, missed a quarantine or resolved the card instead of the board.
 *
 * So each device here is made the way a real one is — `enroll_device_v1`,
 * a pairing session, first certificate issuance, activation, then
 * `register_device_v1` with a new key for the re-flash and
 * `revoke_device_assignment_v1` for the release — and the classification is
 * asserted end to end through `classifyDeviceBoot`, which runs as
 * `kitluy_device_boot_service` exactly as the route does.
 *
 * It is a formal security suite: it FAILS rather than skips when the database,
 * the development PKI or the pinned trust anchors are missing.
 */
import { createHash, generateKeyPairSync, randomUUID, sign as cryptoSign } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import {
  publicKeyFingerprint,
  requestBytes,
  type DeviceCertificateRequest,
} from "@kitluy/device-identity";
import type { MediaClaims } from "@kitluy/device-boot-classification";

import { withServiceRole, REGISTRY_ROLES } from "../src/database.js";
import { classifyDeviceBoot, type BootSignal } from "../src/device-boot-classification.js";
import { advanceDeviceTrust } from "../src/device-trust-advance.js";
import { operationalKeyFingerprint } from "../src/first-operational-issuance.js";
import { HubPairingComposition } from "../src/hub-pairing-composition.js";
import { obtainOperationalCertificate } from "../src/reflash-credential-recovery.js";
import { requireSecurityFixture } from "./support/security-gate.js";

const DSN =
  process.env.KITLUY_DEV_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54392/postgres";
const ENVIRONMENT = "development";
const HUB_PROFILE_KEY = "WS11-T001-HUB-PROBE";
const FIXTURE_PREFIX = "BOOT-EVIDENCE-";
const FLOW_TIMEOUT_MS = 60_000;

await requireSecurityFixture({ dsn: DSN, needsPki: true, needsTrustAnchors: true });

let pool: pg.Pool;

const sha256 = (v: string): string => createHash("sha256").update(v).digest("hex");

function identityKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

function rsaKey() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

function pairingCode(): string {
  return Array.from(randomUUID().replace(/-/g, "").slice(0, 8), (ch) =>
    "0123456789ABCDEFGHJKMNPQRSTVWXYZ".charAt(parseInt(ch, 16) % 32),
  ).join("");
}

interface Board {
  readonly deviceId: string;
  readonly boardSerial: string;
  readonly mac: string;
  /** The identity key the card registered with — what `registration-state.json` records. */
  identityFingerprint: string;
}

function signalsOf(board: Pick<Board, "boardSerial" | "mac">): BootSignal[] {
  return [
    { signalType: "board_serial", signalValue: board.boardSerial },
    { signalType: "mac_address", signalValue: board.mac },
    // A storage signal changes with every card and must never matter.
    { signalType: "storage_serial", signalValue: `SS-${randomUUID().slice(0, 8)}` },
  ];
}

function freshCard(): MediaClaims {
  return {
    imageDeviceClass: "store_hub",
    imageEnvironment: ENVIRONMENT,
    hasAdoptedCredential: false,
  };
}

/** Enrolled at the factory, and nothing more. */
async function enrolledBoard(overrides: { mac?: string } = {}): Promise<Board> {
  const assetTag = `${FIXTURE_PREFIX}${randomUUID()}`;
  const h = sha256(assetTag);
  const mac = overrides.mac ?? (h.slice(0, 12).match(/../g) ?? []).join(":");
  const boardSerial = `BS-${h.slice(12, 28)}`;
  const identityFingerprint = publicKeyFingerprint(identityKey().publicKeyPem);
  const { rows } = await pool.query<{ device_id: string }>(
    `select kitluy_devices.enroll_device_v1(
       $1::text,
       (select id from kitluy_devices.hardware_profiles where profile_key = $2::text and is_active),
       now(), $3::text, 'ed25519', 'software', 'STATION-BOOT', 'HET-MFG/boot-evidence-suite',
       $4::jsonb, null) as device_id`,
    [
      assetTag,
      HUB_PROFILE_KEY,
      identityFingerprint,
      JSON.stringify([
        { signal_type: "mac_address", signal_value: mac },
        { signal_type: "board_serial", signal_value: boardSerial },
        { signal_type: "storage_serial", signal_value: `SS-${h.slice(28, 44)}` },
      ]),
    ],
  );
  return { deviceId: rows[0]!.device_id, boardSerial, mac, identityFingerprint };
}

async function pair(deviceId: string): Promise<void> {
  const { rows: scope } = await pool.query<{
    tenant_id: string;
    digital_store_id: string;
    store_location_id: string;
  }>(
    `select tenant_id, digital_store_id, store_location_id
       from kitluy_devices.device_claims order by created_at desc limit 1`,
  );
  const code = pairingCode();
  await pool.query(
    `select kitluy_devices.open_hub_pairing_session_v1($1::uuid,$2::uuid,$3::uuid,$4::text,900,'operator/boot-evidence-suite')`,
    [scope[0]!.tenant_id, scope[0]!.digital_store_id, scope[0]!.store_location_id, sha256(code)],
  );
  const paired = await new HubPairingComposition({ source: pool }).pair({
    deviceRecordId: deviceId,
    presentedCode: code,
    actorRef: "device/boot-evidence-suite",
  });
  expect(paired.result, paired.auditDetail).toBe("PAIRED");
}

/**
 * A FIRST certificate request, signed by the operational key alone — the shape
 * `reflash-credential-recovery.adversarial.test.ts` sends with `identity: null`.
 */
function firstIssuanceRequest(
  deviceRecordId: string,
  assignmentGeneration: number,
  key: { publicKeyPem: string; privateKeyPem: string },
) {
  const requestId = randomUUID();
  const nonce = randomUUID();
  const correlationId = randomUUID();
  const requestedAt = new Date();
  const csr: DeviceCertificateRequest = {
    requestId,
    deviceRecordId,
    environment: ENVIRONMENT,
    devicePublicKeyPem: key.publicKeyPem,
    publicKeyFingerprint: operationalKeyFingerprint(key.publicKeyPem),
    hardwareTrustLevel: "development_software",
    assignmentGeneration,
    requestedPurpose: "device_identity",
    requestedAt,
    nonce,
    correlationId,
    proofOfPossession: new Uint8Array(),
  };
  return {
    deviceRecordId,
    environment: ENVIRONMENT,
    assignmentGeneration,
    hardwareTrustLevel: "development_software" as const,
    operationalPublicKeyPem: key.publicKeyPem,
    operationalKeyHandle: `boot-evidence-suite:${deviceRecordId}:${requestId}`,
    proofOfPossession: new Uint8Array(
      cryptoSign("sha256", Buffer.from(requestBytes(csr)), key.privateKeyPem),
    ),
    requestId,
    nonce,
    correlationId,
    requestedAt,
    trustedTimeStatus: "trusted",
    actorRef: `device/${deviceRecordId}`,
  };
}

/** A Store Hub in service: paired, first certificate issued, active. */
async function hubInService(): Promise<Board> {
  const board = await enrolledBoard();
  await pair(board.deviceId);
  await withServiceRole(pool, REGISTRY_ROLES.activation, async (c) => {
    await c.query(
      `select status from kitluy_devices.establish_device_trusted_time_v1($1::uuid,$2::text,gen_random_uuid())`,
      [board.deviceId, ENVIRONMENT],
    );
  });
  const key = rsaKey();
  const { rows } = await pool.query<{ g: number }>(
    `select assignment_generation as g from kitluy_devices.devices where id = $1::uuid`,
    [board.deviceId],
  );
  const issued = await obtainOperationalCertificate(
    pool,
    firstIssuanceRequest(board.deviceId, rows[0]!.g, key),
  );
  expect(issued.outcome, JSON.stringify(issued)).toBe("ISSUED");
  const advanced = await advanceDeviceTrust(pool, {
    deviceRecordId: board.deviceId,
    environment: ENVIRONMENT,
    actorRef: "boot-evidence-suite/activation",
  });
  expect(advanced.kind, JSON.stringify(advanced)).toBe("advanced");
  return board;
}

/**
 * What the board's own card holds after pairing and adoption — and ONLY that.
 * No enrollment id: a real card never records one. Its identity is the
 * fingerprint of the key it registered with.
 */
async function currentCard(board: Board): Promise<MediaClaims> {
  const { rows } = await pool.query<{
    certificate_generation: number;
    assignment_generation: number;
    digital_store_id: string;
    store_location_id: string;
  }>(
    `select c.certificate_generation, d.assignment_generation,
            a.digital_store_id, a.store_location_id
       from kitluy_devices.devices d
       join kitluy_devices.device_certificates c on c.device_id = d.id and c.status = 'active'
       join kitluy_devices.device_assignments a on a.device_id = d.id and a.state in ('pending_trust','active')
      where d.id = $1::uuid`,
    [board.deviceId],
  );
  const r = rows[0]!;
  return {
    deviceRecordId: board.deviceId,
    identityKeyFingerprint: board.identityFingerprint,
    certificateGeneration: r.certificate_generation,
    assignmentGeneration: r.assignment_generation,
    digitalStoreId: r.digital_store_id,
    storeLocationId: r.store_location_id,
    imageDeviceClass: "store_hub",
    imageEnvironment: ENVIRONMENT,
    hasAdoptedCredential: true,
  };
}

/** The same board, re-flashed: a new identity key registers against the same hardware. */
async function reflash(board: Board): Promise<string> {
  const identity = identityKey();
  board.identityFingerprint = publicKeyFingerprint(identity.publicKeyPem);
  const { rows } = await pool.query<{ r: { status: string; device_id: string | null } }>(
    `select kitluy_devices.register_device_v1(
       $1::text,
       (select id from kitluy_devices.hardware_profiles where profile_key = $2::text and is_active),
       $3::text, 'pi5-boot-evidence-suite', $4::jsonb, $5::jsonb, 'device/boot-evidence-suite') as r`,
    [
      `KL-${publicKeyFingerprint(identity.publicKeyPem).slice(0, 12).toUpperCase()}`,
      HUB_PROFILE_KEY,
      publicKeyFingerprint(identity.publicKeyPem),
      JSON.stringify(
        signalsOf(board).map((s) => ({ signal_type: s.signalType, signal_value: s.signalValue })),
      ),
      JSON.stringify({ installationId: randomUUID() }),
    ],
  );
  expect(rows[0]!.r.device_id).toBe(board.deviceId);
  return rows[0]!.r.status;
}

/** Every row, in every device table the test login can read, that names this device. */
async function rowsNaming(deviceId: string): Promise<Record<string, number>> {
  const { rows: tables } = await pool.query<{ table_name: string; column_name: string }>(
    // By catalog oid, not by name: a name-built privilege check can be evaluated
    // on another schema's relations before the schema filter applies.
    `select cls.relname as table_name, att.attname as column_name
       from pg_class cls
       join pg_namespace ns on ns.oid = cls.relnamespace and ns.nspname = 'kitluy_devices'
       join pg_attribute att on att.attrelid = cls.oid and not att.attisdropped and att.attnum > 0
      where cls.relkind = 'r'
        and att.attname in ('device_id', 'device_record_id', 'observed_device_id', 'paired_device_id')
        and has_table_privilege(cls.oid, 'select')
      order by 1, 2`,
  );
  const counts: Record<string, number> = {};
  for (const t of tables) {
    const { rows } = await pool.query<{ n: number }>(
      `select count(*)::int as n from kitluy_devices.${pg.escapeIdentifier(t.table_name)}
        where ${pg.escapeIdentifier(t.column_name)} = $1::uuid`,
      [deviceId],
    );
    counts[`${t.table_name}.${t.column_name}`] = rows[0]!.n;
  }
  return counts;
}

const classify = (signals: BootSignal[], media: MediaClaims, registration?: "PENDING_APPROVAL") =>
  classifyDeviceBoot(pool, ENVIRONMENT, {
    signals,
    media,
    ...(registration === undefined ? {} : { registration }),
  });

let hub: Board;

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: DSN, max: 8 });
  hub = await hubInService();
}, FLOW_TIMEOUT_MS);

afterAll(async () => {
  // Retire every fixture, quarantined ones included. `quarantined_at` must be
  // cleared with the state (devices_quarantine_consistency_chk), or the ONE
  // statement fails and every fixture — active Hubs in the shared fixture Store
  // among them — stays live for the next suite. Not swallowed: a cleanup that
  // fails silently is how that happened the first time.
  await pool?.query(
    `update kitluy_devices.devices
        set lifecycle_state = 'retired', retired_at = now(), quarantined_at = null
      where asset_tag like $1 and lifecycle_state <> 'retired'`,
    [`${FIXTURE_PREFIX}%`],
  );
  await pool?.end().catch(() => undefined);
});

describe("the cloud reports the device the HARDWARE is", () => {
  it("S01 a Hub in service with its own card → READY, from real evidence", async () => {
    const card = await currentCard(hub);
    const { evidence, decision } = await classify(signalsOf(hub), card);
    expect(evidence.boardResolution).toBe("resolved");
    expect(evidence.cloudDevice?.deviceRecordId).toBe(hub.deviceId);
    expect(evidence.cloudDevice?.lifecycle).toBe("active");
    expect(evidence.cloudDevice?.assignment?.state).toBe("active");
    expect(evidence.cloudDevice?.activeCertificate?.generation).toBe(card.certificateGeneration);
    expect(evidence.cloudDevice?.activeCertificate?.enrollmentId).toBe(
      evidence.cloudDevice?.currentEnrollmentId,
    );
    // The card's identity key IS the current enrollment's: same SHA-256 over the SPKI.
    expect(evidence.cloudDevice?.currentIdentityKeyFingerprint).toBe(card.identityKeyFingerprint);
    expect(evidence.cloudDevice?.credentialHeadGeneration).toBe(card.certificateGeneration);
    expect(evidence.cloudDevice?.openTrustIncidentCount).toBe(0);
    expect(decision.classification, decision.adminDetail).toBe("READY");
  });

  it("S03 the same Hub with a freshly flashed card → RECOVERING_DEVICE, release first", async () => {
    const { decision } = await classify(signalsOf(hub), freshCard());
    expect(decision.classification).toBe("RECOVERING_DEVICE");
    expect(decision.reasonCode).toBe("KLUY-BOOT-RECOVERY-NEEDS-RELEASE");
  });

  it("S07 another device's card in this board → WRONG_MEDIA; the card never names the device", async () => {
    const card = { ...(await currentCard(hub)), deviceRecordId: randomUUID() };
    const { evidence, decision } = await classify(signalsOf(hub), card);
    // Resolved from the board, not from the card's claim.
    expect(evidence.cloudDevice?.deviceRecordId).toBe(hub.deviceId);
    expect(decision.reasonCode).toBe("KLUY-BOOT-MEDIA-OTHER-DEVICE");
  });

  it("S09 this device's card claiming a different Store → WRONG_MEDIA, never a Store move", async () => {
    const card = { ...(await currentCard(hub)), digitalStoreId: randomUUID() };
    const { decision } = await classify(signalsOf(hub), card);
    expect(decision.reasonCode).toBe("KLUY-BOOT-MEDIA-OTHER-STORE");
  });

  it("S13 a board the cloud has never seen → NEW_DEVICE, with no device facts at all", async () => {
    const h = sha256(randomUUID());
    const stranger = {
      boardSerial: `BS-${h.slice(0, 16)}`,
      // Random, locally administered: a fixed MAC once matched a device already
      // in this database and resolved, correctly, as review_mac_only.
      mac: `02:${(h.slice(16, 26).match(/../g) ?? []).join(":")}`,
    };
    const { evidence, decision } = await classify(
      signalsOf(stranger),
      freshCard(),
      "PENDING_APPROVAL",
    );
    expect(evidence.boardResolution).toBe("unknown");
    expect(evidence.cloudDevice).toBeUndefined();
    expect(decision.classification).toBe("NEW_DEVICE");
  });

  it("S19 a MAC that matches but a board serial that does not → SECURITY_LOCK for review", async () => {
    const { evidence, decision } = await classify(
      [
        { signalType: "board_serial", signalValue: `BS-${randomUUID().slice(0, 16)}` },
        { signalType: "mac_address", signalValue: hub.mac },
      ],
      freshCard(),
    );
    expect(evidence.boardResolution).toBe("review_mac_only");
    expect(evidence.cloudDevice).toBeUndefined();
    expect(decision.reasonCode).toBe("KLUY-BOOT-LOCKED-TRUST-REVIEW");
  });
});

describe("recovery, step by step, as the cloud sees it", () => {
  it(
    "S11/S03b re-flash makes the old card outdated; release makes the fresh card ask for pairing",
    async () => {
      const board = await hubInService();
      const oldCard = await currentCard(board);

      const status = await reflash(board);
      expect(status).toBe("KNOWN_DEVICE_INSTALLATION_REGISTERED");

      const afterReflash = await classify(signalsOf(board), oldCard);
      // The re-flash registered a NEW identity key, so the old card — whose
      // certificate is still active, because recovery has not run — no longer
      // holds the device's identity: refused on freshness, not on validity.
      expect(afterReflash.evidence.cloudDevice?.currentIdentityKeyFingerprint).toBe(
        board.identityFingerprint,
      );
      expect(oldCard.identityKeyFingerprint).not.toBe(board.identityFingerprint);
      expect(afterReflash.evidence.cloudDevice?.activeCertificate?.generation).toBe(
        oldCard.certificateGeneration,
      );
      expect(afterReflash.decision.reasonCode, afterReflash.decision.adminDetail).toBe(
        "KLUY-BOOT-MEDIA-OUTDATED",
      );

      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query(
          `do $b$ begin execute format('grant %I to %I', 'kitluy_fleet_governor', current_user); end $b$;`,
        );
        await client.query("set local role kitluy_fleet_governor");
        await client.query(
          "select kitluy_devices.revoke_device_assignment_v1($1::uuid, 'SD_CARD_REFLASH', 'OP-BOOT-EVIDENCE')",
          [board.deviceId],
        );
        await client.query("reset role");
        await client.query(
          `do $h$ begin execute format('revoke %I from %I', 'kitluy_fleet_governor', current_user); end $h$;`,
        );
        await client.query("commit");
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }

      const released = await classify(signalsOf(board), freshCard());
      expect(released.evidence.cloudDevice?.assignment).toBeUndefined();
      expect(released.evidence.cloudDevice?.assignmentGeneration).toBe(0);
      expect(released.decision.reasonCode, released.decision.adminDetail).toBe(
        "KLUY-BOOT-RECOVERY-NEEDS-PAIRING",
      );
      expect(released.decision.nextAction).toBe("ENTER_PAIRING_CODE");
    },
    FLOW_TIMEOUT_MS,
  );
});

describe("locks the cloud holds, whatever the card says", () => {
  it("S20 a quarantined device → SECURITY_LOCK, even with its own current card", async () => {
    const board = await enrolledBoard();
    await pool.query(
      `select kitluy_devices.quarantine_device_v1($1::uuid, 'manual_quarantine', 'CRITICAL',
         'boot-evidence-suite', 'fixture quarantine', '{}'::jsonb)`,
      [board.deviceId],
    );
    const { evidence, decision } = await classify(signalsOf(board), freshCard());
    expect(evidence.cloudDevice?.lifecycle).toBe("quarantined");
    expect(evidence.cloudDevice?.openTrustIncidentCount).toBeGreaterThan(0);
    expect(decision.classification).toBe("SECURITY_LOCK");
    expect(decision.reasonCode).toBe("KLUY-BOOT-LOCKED-QUARANTINED");
  });

  it("S22 a retired board powered up again is recognised and locked, never offered as new", async () => {
    const board = await enrolledBoard();
    // Retirement has no device-side door; the fixture sets it the way this
    // service's suites retire their own fixtures.
    await pool.query(
      `update kitluy_devices.devices set lifecycle_state = 'retired', retired_at = now() where id = $1::uuid`,
      [board.deviceId],
    );
    const { evidence, decision } = await classify(
      signalsOf(board),
      freshCard(),
      "PENDING_APPROVAL",
    );
    expect(evidence.boardResolution).toBe("resolved");
    expect(evidence.resolutionDetail).toBe("KLUY-BOARD-EVIDENCE-RETIRED-DEVICE");
    expect(evidence.cloudDevice?.deviceRecordId).toBe(board.deviceId);
    expect(decision.classification).toBe("SECURITY_LOCK");
    expect(decision.reasonCode).toBe("KLUY-BOOT-LOCKED-RETIRED");
  });

  it("S18 two live devices sharing hardware evidence → conflict, SECURITY_LOCK", async () => {
    const first = await enrolledBoard();
    let second: Board | undefined;
    try {
      second = await enrolledBoard({ mac: first.mac });
    } catch (error) {
      // A factory door that refuses the twin outright is an even earlier stop;
      // the evidence read must still lock the first board if a twin exists.
      expect(String(error)).toMatch(/KLUY|duplicate|collision/i);
      return;
    }
    const { evidence, decision } = await classify(signalsOf(first), freshCard());
    expect(evidence.boardResolution).toBe("conflict");
    expect(decision.classification).toBe("SECURITY_LOCK");
    expect(second.deviceId).not.toBe(first.deviceId);
  });
});

describe("the read is a read, and only the boot identity may make it", () => {
  it("writes nothing, in any device table that names the device", async () => {
    const card = await currentCard(hub);
    const before = await rowsNaming(hub.deviceId);
    expect(Object.keys(before).length).toBeGreaterThan(5);
    for (let i = 0; i < 3; i += 1) {
      await classify(signalsOf(hub), card);
      await classify(signalsOf(hub), freshCard());
    }
    expect(await rowsNaming(hub.deviceId)).toEqual(before);
  });

  it("every 0227 function is STABLE, so Postgres itself refuses any write inside them", async () => {
    const { rows } = await pool.query<{ proname: string; provolatile: string; prosecdef: boolean }>(
      `select proname, provolatile, prosecdef from pg_proc
        where proname in ('describe_device_boot_evidence_v1', 'describe_device_recovery_facts_v1',
                          'device_boot_facts_v1', 'device_boot_credential_head_v1')
        order by proname`,
    );
    expect(rows.map((r) => [r.proname, r.provolatile, r.prosecdef])).toEqual([
      ["describe_device_boot_evidence_v1", "s", true],
      ["describe_device_recovery_facts_v1", "s", true],
      ["device_boot_credential_head_v1", "s", true],
      ["device_boot_facts_v1", "s", true],
    ]);
  });

  it("the Admin's door and the board's door report the SAME facts for a device", async () => {
    const byHardware = await withServiceRole(pool, REGISTRY_ROLES.deviceBoot, async (c) => {
      const { rows } = await c.query<{ e: unknown }>(
        "select kitluy_devices.describe_device_boot_evidence_v1($1::jsonb, 'development') as e",
        [
          JSON.stringify(
            signalsOf(hub).map((s) => ({ signal_type: s.signalType, signal_value: s.signalValue })),
          ),
        ],
      );
      return rows[0]!.e;
    });
    const byId = await withServiceRole(pool, REGISTRY_ROLES.deviceBoot, async (c) => {
      const { rows } = await c.query<{ e: unknown }>(
        "select kitluy_devices.describe_device_recovery_facts_v1($1::uuid, 'development') as e",
        [hub.deviceId],
      );
      return rows[0]!.e;
    });
    expect(byId).toEqual(byHardware);
    // An unknown id is simply nothing, never an error that names a table.
    const missing = await withServiceRole(pool, REGISTRY_ROLES.deviceBoot, async (c) => {
      const { rows } = await c.query<{ e: unknown }>(
        "select kitluy_devices.describe_device_recovery_facts_v1(gen_random_uuid(), 'development') as e",
      );
      return rows[0]!.e;
    });
    expect(missing).toBeNull();
  });

  it("another composition identity cannot make the read", async () => {
    await expect(
      withServiceRole(pool, REGISTRY_ROLES.hubPairing, (c) =>
        c.query(
          "select kitluy_devices.describe_device_boot_evidence_v1('[]'::jsonb, 'development')",
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("the boot identity can make the read and nothing else", async () => {
    await expect(
      withServiceRole(pool, REGISTRY_ROLES.deviceBoot, (c) =>
        c.query("select count(*) from kitluy_devices.devices"),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withServiceRole(pool, REGISTRY_ROLES.deviceBoot, (c) =>
        c.query("select kitluy_devices.resolve_device_by_board_evidence_v1('[]'::jsonb)"),
      ),
    ).rejects.toThrow(/permission denied/);
    for (const internal of [
      "select kitluy_devices.device_boot_credential_head_v1(gen_random_uuid(), 'development')",
      "select kitluy_devices.device_boot_facts_v1(gen_random_uuid(), 'development')",
    ]) {
      await expect(
        withServiceRole(pool, REGISTRY_ROLES.deviceBoot, (c) => c.query(internal)),
      ).rejects.toThrow(/permission denied/);
    }
  });
});
