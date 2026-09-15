/**
 * A re-flashed Store Hub recovers its operational credential — and nobody else
 * can use the same door.
 *
 * Authority: KLD-2026-09-14-REFLASH-CREDENTIAL-RECOVERY-001; migration group
 * 0224; U1 hardware report 2026-09-12 §9b (KLUY-KEY-GENERATION-TAKEN on a
 * re-flashed Hub, cleared only by a table-wide reset of the device database).
 *
 * ===========================================================================
 * WHAT THIS SUITE PROVES
 * ===========================================================================
 * The re-flash is reproduced through the governed doors a real board uses:
 *
 *   enroll + pair + first certificate + activate          (the board in service)
 *   register_device_v1 with the same board, a new key     (the re-flashed card)
 *   open a pairing session + pair again                   (the operator's code)
 *   certificate request over a new operational key        (recovery)
 *
 * and then asserts, separately:
 *
 *   - the board RECOVERS generation 2 without a new device record, a new asset
 *     tag, a removed row or a reset — and activates;
 *   - the lost key is superseded, the old artifact is superseded, the evidence
 *     says why the reservation was allowed;
 *   - a lost response replays the same certificate;
 *   - a stranger holding the device id is refused, as is the board's PREVIOUS
 *     identity key, a proof over different bytes, a board that was never
 *     re-flashed, a board that was not re-paired, and a revoked credential;
 *   - two concurrent recoveries allocate exactly one generation;
 *   - first issuance is unchanged, and proactive rotation stays disabled.
 *
 * It is a formal security suite: it FAILS rather than skips when the database,
 * the development PKI or the pinned trust anchors are missing.
 */
import {
  X509Certificate,
  createHash,
  generateKeyPairSync,
  randomUUID,
  sign as cryptoSign,
} from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import {
  publicKeyFingerprint,
  recoveryIdentityProofBytes,
  requestBytes,
  type DeviceCertificateRequest,
} from "@kitluy/device-identity";
import {
  ensureOperationalCertificate,
  fileRecoveryIdentitySigner,
  type IssuanceCallResult,
  type OperationalCertificateClient,
} from "@kitluy-services/kitluy-device-firstboot-agent";

import { REGISTRY_ROLES, withServiceRole } from "../src/database.js";
import { advanceDeviceTrust } from "../src/device-trust-advance.js";
import { readDevPkiChain, resolveDevPkiPaths } from "../src/dev-operational-pki.js";
import { operationalKeyFingerprint } from "../src/first-operational-issuance.js";
import { HubPairingComposition } from "../src/hub-pairing-composition.js";
import { createOperationalCertificateRouter } from "../src/operational-certificate-routes.js";
import {
  obtainOperationalCertificate,
  type OperationalCertificateOutcome,
} from "../src/reflash-credential-recovery.js";
import { requireSecurityFixture } from "./support/security-gate.js";

const DSN =
  process.env.KITLUY_DEV_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54392/postgres";
const ENVIRONMENT = "development";
const HUB_PROFILE_KEY = "WS11-T001-HUB-PROBE";
const FIXTURE_PREFIX = "REFLASH-RECOVERY-";
const FLOW_TIMEOUT_MS = 60_000;

let pool: pg.Pool;

await requireSecurityFixture({ dsn: DSN, needsPki: true, needsTrustAnchors: true });

const sha256 = (v: string): string => createHash("sha256").update(v).digest("hex");

interface Key {
  readonly publicKeyPem: string;
  readonly privateKeyPem: string;
}

function rsaKey(): Key {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

function identityKey(): Key {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
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
  readonly assetTag: string;
  readonly boardSerial: string;
  readonly mac: string;
  identity: Key;
  assignmentGeneration: number;
}

async function currentAssignmentGeneration(deviceId: string): Promise<number> {
  const { rows } = await pool.query<{ g: number }>(
    `select assignment_generation as g from kitluy_devices.devices where id = $1::uuid`,
    [deviceId],
  );
  return rows[0]!.g;
}

/** An operator opens a session in the fixture Store and the board redeems the code. */
async function pair(deviceId: string, actor: string): Promise<string> {
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
    `select kitluy_devices.open_hub_pairing_session_v1($1::uuid,$2::uuid,$3::uuid,$4::text,900,'operator/reflash-suite')`,
    [scope[0]!.tenant_id, scope[0]!.digital_store_id, scope[0]!.store_location_id, sha256(code)],
  );
  const paired = await new HubPairingComposition({ source: pool }).pair({
    deviceRecordId: deviceId,
    presentedCode: code,
    actorRef: actor,
  });
  return paired.result === "PAIRED" ? "PAIRED" : `${paired.result}: ${paired.auditDetail ?? ""}`;
}

async function establishTrustedTime(deviceId: string): Promise<void> {
  await withServiceRole(pool, REGISTRY_ROLES.activation, async (c) => {
    await c.query(
      `select status from kitluy_devices.establish_device_trusted_time_v1($1::uuid,$2::text,gen_random_uuid())`,
      [deviceId, ENVIRONMENT],
    );
  });
}

/** Enrolled, paired, with trusted time — ready for its FIRST certificate. */
async function pairedHub(): Promise<Board> {
  const assetTag = `${FIXTURE_PREFIX}${randomUUID()}`;
  const h = sha256(assetTag);
  const identity = identityKey();
  const mac = (h.slice(0, 12).match(/../g) ?? []).join(":");
  const boardSerial = `BS-${h.slice(12, 28)}`;
  const { rows } = await pool.query<{ device_id: string }>(
    `select kitluy_devices.enroll_device_v1(
       $1::text,
       (select id from kitluy_devices.hardware_profiles where profile_key = $2::text and is_active),
       now(), $3::text, 'ed25519', 'software', 'STATION-REFLASH', 'HET-MFG/reflash-suite',
       $4::jsonb, null) as device_id`,
    [
      assetTag,
      HUB_PROFILE_KEY,
      publicKeyFingerprint(identity.publicKeyPem),
      JSON.stringify([
        { signal_type: "mac_address", signal_value: mac },
        { signal_type: "board_serial", signal_value: boardSerial },
        { signal_type: "storage_serial", signal_value: `SS-${h.slice(28, 44)}` },
      ]),
    ],
  );
  const deviceId = rows[0]!.device_id;
  expect(await pair(deviceId, "device/reflash-suite")).toBe("PAIRED");
  await establishTrustedTime(deviceId);
  return {
    deviceId,
    assetTag,
    boardSerial,
    mac,
    identity,
    assignmentGeneration: await currentAssignmentGeneration(deviceId),
  };
}

interface RequestOptions {
  /** The identity key that signs the recovery proof; null sends no proof. */
  readonly identity?: Key | null;
  /** Sign the identity proof over DIFFERENT bytes than the request. */
  readonly tamperIdentityProof?: boolean;
  /** Reuse a request id, so the same signed request can be replayed. */
  readonly requestId?: string;
  readonly nonce?: string;
  readonly correlationId?: string;
  readonly requestedAt?: Date;
}

function buildRequest(board: Board, operationalKey: Key, options: RequestOptions = {}) {
  const requestId = options.requestId ?? randomUUID();
  const nonce = options.nonce ?? randomUUID();
  const correlationId = options.correlationId ?? randomUUID();
  const requestedAt = options.requestedAt ?? new Date();
  const csr: DeviceCertificateRequest = {
    requestId,
    deviceRecordId: board.deviceId,
    environment: ENVIRONMENT,
    devicePublicKeyPem: operationalKey.publicKeyPem,
    publicKeyFingerprint: operationalKeyFingerprint(operationalKey.publicKeyPem),
    hardwareTrustLevel: "development_software",
    assignmentGeneration: board.assignmentGeneration,
    requestedPurpose: "device_identity",
    requestedAt,
    nonce,
    correlationId,
    proofOfPossession: new Uint8Array(),
  };
  const bytes = requestBytes(csr);
  const proofOfPossession = new Uint8Array(
    cryptoSign("sha256", Buffer.from(bytes), operationalKey.privateKeyPem),
  );
  const identity = options.identity === undefined ? board.identity : options.identity;
  let identityFields: { identityPublicKeyPem: string; identityProof: Uint8Array } | object = {};
  if (identity !== null) {
    const signedBytes = options.tamperIdentityProof
      ? new Uint8Array(Buffer.concat([Buffer.from(bytes), Buffer.from("tampered")]))
      : bytes;
    identityFields = {
      identityPublicKeyPem: identity.publicKeyPem,
      identityProof: new Uint8Array(
        cryptoSign(
          null,
          Buffer.from(
            recoveryIdentityProofBytes(publicKeyFingerprint(identity.publicKeyPem), signedBytes),
          ),
          identity.privateKeyPem,
        ),
      ),
    };
  }
  return {
    deviceRecordId: board.deviceId,
    environment: ENVIRONMENT,
    assignmentGeneration: board.assignmentGeneration,
    hardwareTrustLevel: "development_software" as const,
    operationalPublicKeyPem: operationalKey.publicKeyPem,
    operationalKeyHandle: `reflash-suite:${board.deviceId}:${requestId}`,
    proofOfPossession,
    requestId,
    nonce,
    correlationId,
    requestedAt,
    trustedTimeStatus: "trusted",
    actorRef: `device/${board.deviceId}`,
    ...identityFields,
  };
}

async function ask(
  board: Board,
  operationalKey: Key,
  options: RequestOptions = {},
): Promise<OperationalCertificateOutcome> {
  return obtainOperationalCertificate(pool, buildRequest(board, operationalKey, options));
}

/** A Hub in service: first certificate issued and activated. */
async function hubInService(): Promise<Board & { firstKey: Key; firstCredentialId: string }> {
  const board = await pairedHub();
  const firstKey = rsaKey();
  const first = await ask(board, firstKey, { identity: null });
  expect(first.outcome).toBe("ISSUED");
  if (first.outcome === "REFUSED") throw new Error(first.detail);
  expect(first.certificateGeneration).toBe(1);
  const advanced = await advanceDeviceTrust(pool, {
    deviceRecordId: board.deviceId,
    environment: ENVIRONMENT,
    actorRef: "reflash-suite/activation",
  });
  expect(advanced.kind).toBe("advanced");
  expect(await lifecycle(board.deviceId)).toBe("active");
  return { ...board, firstKey, firstCredentialId: first.credentialId };
}

/** The SD card is re-flashed: the same board registers with a new identity key. */
async function reflash(board: Board): Promise<{ previousIdentity: Key }> {
  const previousIdentity = board.identity;
  const identity = identityKey();
  const { rows } = await pool.query<{ r: { status: string; device_id: string | null } }>(
    `select kitluy_devices.register_device_v1(
       $1::text,
       (select id from kitluy_devices.hardware_profiles where profile_key = $2::text and is_active),
       $3::text, 'pi5-reflash-suite', $4::jsonb, $5::jsonb, 'device/reflash-suite') as r`,
    [
      // The label a re-flashed board derives from its NEW key. The server must
      // not rename a board it already knows, which is asserted below.
      `KL-${publicKeyFingerprint(identity.publicKeyPem).slice(0, 12).toUpperCase()}`,
      HUB_PROFILE_KEY,
      publicKeyFingerprint(identity.publicKeyPem),
      JSON.stringify([
        { signal_type: "mac_address", signal_value: board.mac },
        { signal_type: "board_serial", signal_value: board.boardSerial },
        // A new card: storage evidence changes and must not matter.
        { signal_type: "storage_serial", signal_value: `SS-NEW-${randomUUID().slice(0, 8)}` },
      ]),
      JSON.stringify({ installationId: randomUUID() }),
    ],
  );
  expect(rows[0]!.r.device_id).toBe(board.deviceId);
  board.identity = identity;
  return { previousIdentity };
}

/**
 * Run `work` with `role`'s authority inside one transaction, and leave role
 * membership exactly as it was found.
 *
 * Membership shapes found on the local stacks, handled the way
 * `scripts/development/unassign-hosted-dev-device.mjs` and
 * `revocation-composition.integration.test.ts` handle them:
 *   - INHERIT held      privileges are already present (the D-12 shape);
 *                       the work runs under the session itself;
 *   - SET held          set role;
 *   - neither           borrow a grant, set role, and hand the grant back.
 *
 * The borrow and the hand-back are issued through `DO ... execute format`, as
 * every suite in this service does. A TOP-LEVEL `grant <role> to current_user`
 * over an existing platform-granted membership SIGSEGVs the backend on the
 * local supabase/postgres 17.6 image (observed 2026-09-14); the same grant
 * issued through `execute` does not.
 */
async function withBorrowedRole(role: string, work: (client: pg.PoolClient) => Promise<void>) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<{ set_option: boolean; inherit_option: boolean }>(
      `select m.set_option, m.inherit_option from pg_auth_members m
         join pg_roles r on r.oid = m.roleid
         join pg_roles u on u.oid = m.member
        where r.rolname = $1 and u.rolname = current_user`,
      [role],
    );
    const inherits = rows.some((m) => m.inherit_option);
    const canSet = rows.some((m) => m.set_option);
    const borrowed = !inherits && !canSet;
    if (borrowed) {
      await client.query(
        `do $borrow$ begin execute format('grant %I to %I', '${role}', current_user); end $borrow$;`,
      );
    }
    const setRole = !inherits;
    if (setRole) {
      await client.query(`set local role ${role}`);
    }
    await work(client);
    if (setRole) {
      await client.query("reset role");
    }
    if (borrowed) {
      await client.query(
        `do $handback$ begin execute format('revoke %I from %I', '${role}', current_user); end $handback$;`,
      );
    }
    await client.query("commit");
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}

/**
 * The operator's re-flash procedure for a Store Hub: revoke the live assignment
 * (the Hub returns to `enrolled`; `pnpm dev:device:unassign` does the same),
 * then issue a new pairing code, which the board redeems.
 */
async function rePair(board: Board): Promise<void> {
  await withBorrowedRole("kitluy_fleet_governor", async (client) => {
    await client.query(
      "select kitluy_devices.revoke_device_assignment_v1($1::uuid, 'SD_CARD_REFLASH', 'OP-REFLASH-SUITE')",
      [board.deviceId],
    );
  });
  expect(await lifecycle(board.deviceId)).toBe("enrolled");
  const result = await pair(board.deviceId, "device/reflash-suite-repair");
  expect(result).toBe("PAIRED");
  await establishTrustedTime(board.deviceId);
  board.assignmentGeneration = await currentAssignmentGeneration(board.deviceId);
  expect(await lifecycle(board.deviceId)).toBe("awaiting_trust");
}

async function lifecycle(deviceId: string): Promise<string> {
  const { rows } = await pool.query<{ s: string }>(
    `select lifecycle_state::text as s from kitluy_devices.devices where id = $1::uuid`,
    [deviceId],
  );
  return rows[0]!.s;
}

async function snapshot(deviceId: string) {
  const q = async <T extends pg.QueryResultRow>(sql: string): Promise<T[]> =>
    (await pool.query<T>(sql, [deviceId])).rows;
  return {
    device: (
      await q<{ id: string; asset_tag: string; current_enrollment_id: string }>(
        `select id, asset_tag, current_enrollment_id from kitluy_devices.devices where id = $1::uuid`,
      )
    )[0]!,
    head: (
      await q<{ current_generation: number; previous_generation: number | null }>(
        `select current_generation, previous_generation from kitluy_devices.device_credential_heads
          where device_record_id = $1::uuid and purpose = 'device_identity'`,
      )
    )[0],
    keys: await q<{
      generation: number;
      key_generation: number | null;
      state: string;
      rotation: boolean;
      fp: string;
    }>(
      `select generation, key_generation, state::text as state,
              renewal_attempt_id is not null as rotation, public_key_fingerprint as fp
         from kitluy_devices.device_generation_keys
        where device_record_id = $1::uuid order by generation, created_at`,
    ),
    artifacts: await q<{ certificate_generation: number; status: string; enrollment_id: string }>(
      `select certificate_generation, status::text as status, enrollment_id
         from kitluy_devices.device_certificates
        where device_id = $1::uuid and credential_id is not null order by certificate_generation`,
    ),
    reservations: await q<{
      status: string;
      renewal_mode: string;
      next_credential_generation: number;
    }>(
      `select status::text as status, renewal_mode::text as renewal_mode, next_credential_generation
         from kitluy_devices.device_renewal_reservations where device_record_id = $1::uuid`,
    ),
    evidence: await q<{
      incumbent_enrollment_id: string;
      current_enrollment_id: string;
      identity_public_key_fingerprint: string;
      incumbent_credential_generation: number;
    }>(
      `select incumbent_enrollment_id, current_enrollment_id, identity_public_key_fingerprint,
              incumbent_credential_generation
         from kitluy_devices.device_credential_recovery_evidence where device_record_id = $1::uuid`,
    ),
    enrollments: await q<{
      id: string;
      enrollment_sequence: number;
      state: string;
      supersedes: string | null;
    }>(
      `select id, enrollment_sequence, state::text as state, supersedes_enrollment_id as supersedes
         from kitluy_devices.manufacturing_enrollments where device_id = $1::uuid order by enrollment_sequence`,
    ),
    boardDevices: Number(
      (
        await q<{ n: string }>(
          `select count(*)::text as n from kitluy_devices.devices d
            where exists (select 1 from kitluy_devices.hardware_manifests m
                            join kitluy_devices.hardware_manifest_signals s on s.manifest_id = m.id
                           where m.device_id = d.id and s.signal_type = 'board_serial'
                             and s.signal_value = (select lower(s2.signal_value)
                                                     from kitluy_devices.hardware_manifests m2
                                                     join kitluy_devices.hardware_manifest_signals s2 on s2.manifest_id = m2.id
                                                    where m2.device_id = $1::uuid and s2.signal_type = 'board_serial'
                                                    limit 1))`,
        )
      )[0]!.n,
    ),
  };
}

function refusalOf(outcome: OperationalCertificateOutcome): string {
  return outcome.outcome === "REFUSED"
    ? `${outcome.refusalCode} ${outcome.detail}`
    : outcome.outcome;
}

beforeAll(() => {
  pool = new pg.Pool({ connectionString: DSN, max: 8 });
});

afterAll(async () => {
  await pool
    ?.query(
      `update kitluy_devices.devices set lifecycle_state = 'retired', retired_at = now()
        where asset_tag like $1 and lifecycle_state <> 'retired'`,
      [`${FIXTURE_PREFIX}%`],
    )
    .catch(() => undefined);
  await pool?.end().catch(() => undefined);
});

describe("THE RE-FLASH: a known board recovers its operational credential", () => {
  it(
    "recovers generation 2 through the real route, keeps its identity, and activates",
    async () => {
      const hub = await hubInService();
      const before = await snapshot(hub.deviceId);
      expect(before.head?.current_generation).toBe(1);

      await reflash(hub);
      await rePair(hub);

      // The pre-0224 failure, now a precise refusal with nothing reserved: a
      // device that already holds a credential cannot take a new key by
      // possession alone.
      const legacy = await ask(hub, rsaKey(), { identity: null });
      expect(refusalOf(legacy)).toContain("OPCERT_RECOVERY_IDENTITY_PROOF_REQUIRED");
      expect((await snapshot(hub.deviceId)).reservations).toHaveLength(0);

      // THE RECOVERY, through the real HTTP route handler.
      const recoveredKey = rsaKey();
      const request = buildRequest(hub, recoveredKey);
      const router = createOperationalCertificateRouter({ pool });
      const response = await router.handle({
        method: "POST",
        path: "/v1/operational-certificate",
        headers: { "content-type": "application/json", "x-correlation-id": request.correlationId },
        sourceIp: "127.0.0.1",
        rawBody: JSON.stringify({
          requestId: request.requestId,
          deviceRecordId: request.deviceRecordId,
          environment: request.environment,
          operationalPublicKeyPem: request.operationalPublicKeyPem,
          publicKeyFingerprint: operationalKeyFingerprint(request.operationalPublicKeyPem),
          hardwareTrustLevel: request.hardwareTrustLevel,
          assignmentGeneration: request.assignmentGeneration,
          requestedPurpose: "device_identity",
          requestedAt: request.requestedAt.toISOString(),
          nonce: request.nonce,
          correlationId: request.correlationId,
          proofOfPossession: Buffer.from(request.proofOfPossession).toString("base64"),
          identityPublicKeyPem: (request as { identityPublicKeyPem: string }).identityPublicKeyPem,
          identityProof: Buffer.from(
            (request as { identityProof: Uint8Array }).identityProof,
          ).toString("base64"),
        }),
      });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const body = response.body as Record<string, unknown>;
      expect(body.outcome).toBe("ISSUED");
      expect(body.recovered).toBe(true);
      expect(body.certificateGeneration).toBe(2);

      // The certificate is real, over the NEW key, for the SAME device.
      const leaf = new X509Certificate(String(body.certificatePem));
      const chain = readDevPkiChain(resolveDevPkiPaths()!);
      expect(leaf.verify(new X509Certificate(chain.intermediateCertificatePem).publicKey)).toBe(
        true,
      );
      expect(
        publicKeyFingerprint(leaf.publicKey.export({ type: "spki", format: "pem" }).toString()),
      ).toBe(operationalKeyFingerprint(recoveredKey.publicKeyPem));
      expect(leaf.subject).toContain(`CN=${hub.deviceId}`);

      const after = await snapshot(hub.deviceId);
      // IDENTITY PRESERVED: same record, same label, one device for the board.
      expect(after.device.id).toBe(hub.deviceId);
      expect(after.device.asset_tag).toBe(hub.assetTag);
      expect(after.boardDevices).toBe(1);
      // The credential head ADVANCED — never replaced.
      expect(after.head).toEqual({ current_generation: 2, previous_generation: 1 });
      // The lost key is superseded; the recovered key is active and rotated.
      expect(after.keys.map((k) => [k.generation, k.state, k.rotation])).toEqual([
        [1, "superseded", false],
        [2, "active", true],
      ]);
      expect(after.keys[1]!.key_generation).toBe(2);
      expect(after.keys[0]!.fp).toBe(before.keys[0]!.fp);
      // One active artifact, and it is the recovered one.
      expect(after.artifacts.map((a) => [a.certificate_generation, a.status])).toEqual([
        [1, "superseded"],
        [2, "active"],
      ]);
      expect(after.reservations).toEqual([
        { status: "completed", renewal_mode: "rotate_key", next_credential_generation: 2 },
      ]);
      // THE EVIDENCE: the old certificate's enrollment, superseded by the current one.
      expect(after.enrollments.map((e) => [e.enrollment_sequence, e.state])).toEqual([
        [1, "superseded"],
        [2, "sealed"],
      ]);
      expect(after.evidence).toHaveLength(1);
      expect(after.evidence[0]).toMatchObject({
        incumbent_enrollment_id: after.enrollments[0]!.id,
        current_enrollment_id: after.enrollments[1]!.id,
        identity_public_key_fingerprint: publicKeyFingerprint(hub.identity.publicKeyPem),
        incumbent_credential_generation: 1,
      });
      expect(after.artifacts[0]!.enrollment_id).toBe(after.enrollments[0]!.id);
      expect(after.artifacts[1]!.enrollment_id).toBe(after.enrollments[1]!.id);

      // The route re-checked trust after issuance, exactly as for first issuance.
      expect(await lifecycle(hub.deviceId)).toBe("active");
    },
    FLOW_TIMEOUT_MS,
  );

  it(
    "is idempotent: a lost response replays the same recovered certificate",
    async () => {
      const hub = await hubInService();
      await reflash(hub);
      await rePair(hub);

      const key = rsaKey();
      const fixed = {
        requestId: randomUUID(),
        nonce: randomUUID(),
        correlationId: randomUUID(),
        requestedAt: new Date(),
      };
      const first = await ask(hub, key, fixed);
      expect(first.outcome, refusalOf(first)).toBe("ISSUED");
      const replay = await ask(hub, key, fixed);
      expect(replay.outcome, refusalOf(replay)).toBe("REPLAYED");
      if (first.outcome === "REFUSED" || replay.outcome === "REFUSED") return;
      expect(replay.credentialId).toBe(first.credentialId);
      expect(replay.certificateSha256).toBe(first.certificateSha256);
      expect(replay.recovered).toBe(true);

      const state = await snapshot(hub.deviceId);
      expect(state.head?.current_generation).toBe(2);
      expect(state.reservations).toHaveLength(1);
      expect(state.evidence).toHaveLength(1);
    },
    FLOW_TIMEOUT_MS,
  );
});

describe("THE REAL DEVICE CODE, through the real route, across a re-flash", () => {
  /** The firstboot transport, wired straight to the route handler. */
  function routeClient(): OperationalCertificateClient {
    const router = createOperationalCertificateRouter({ pool });
    return {
      async request({ csr, operationalPublicKeyPem, proofOfPossessionBase64, identity }) {
        const response = await router.handle({
          method: "POST",
          path: "/v1/operational-certificate",
          headers: { "content-type": "application/json", "x-correlation-id": csr.correlationId },
          sourceIp: "127.0.0.1",
          rawBody: JSON.stringify({
            requestId: csr.requestId,
            deviceRecordId: csr.deviceRecordId,
            environment: csr.environment,
            operationalPublicKeyPem,
            publicKeyFingerprint: csr.publicKeyFingerprint,
            hardwareTrustLevel: csr.hardwareTrustLevel,
            assignmentGeneration: csr.assignmentGeneration,
            requestedPurpose: csr.requestedPurpose,
            requestedAt: csr.requestedAt,
            nonce: csr.nonce,
            proofOfPossession: proofOfPossessionBase64,
            ...(identity === undefined
              ? {}
              : {
                  identityPublicKeyPem: identity.identityPublicKeyPem,
                  identityProof: identity.identityProofBase64,
                }),
          }),
        });
        const body = response.body as Record<string, unknown>;
        if (response.status !== 200) {
          const error = body.error as Record<string, unknown> | undefined;
          const details = error?.details as Record<string, unknown> | undefined;
          return {
            kind: "refused",
            refusal: {
              refusalCode: String(details?.refusalCode ?? "OPCERT_REFUSED"),
              detail: String(error?.message ?? "refused"),
              retryable: details?.retryable === true,
            },
          } satisfies IssuanceCallResult;
        }
        return {
          kind: "issued",
          response: {
            outcome: body.outcome === "REPLAYED" ? "REPLAYED" : "ISSUED",
            credentialId: String(body.credentialId),
            certificateGeneration: Number(body.certificateGeneration),
            serialNumber: String(body.serialNumber),
            certificateSha256: String(body.certificateSha256),
            certificatePem: String(body.certificatePem),
            chainPem: String(body.chainPem),
            publicKeyAlgorithm: String(body.publicKeyAlgorithm),
            ...(typeof body.notBefore === "string" ? { notBefore: body.notBefore } : {}),
            ...(typeof body.notAfter === "string" ? { notAfter: body.notAfter } : {}),
          },
        } satisfies IssuanceCallResult;
      },
    };
  }

  /** An SD card: the operational credential directory and the identity key on it. */
  function sdCard(root: string, name: string, identity: Key) {
    const directory = mkdtempSync(join(root, `${name}-`));
    const identityKeyPath = join(directory, "device-identity.key.pem");
    writeFileSync(identityKeyPath, identity.privateKeyPem, { mode: 0o600 });
    return {
      identitySigner: fileRecoveryIdentitySigner(identityKeyPath),
      paths: {
        directory,
        privateKey: join(directory, "operational-tls.key.pem"),
        requestState: join(directory, "issuance-request.json"),
        certificate: join(directory, "operational-tls.crt.pem"),
        chain: join(directory, "operational-tls.chain.pem"),
        manifest: join(directory, "operational-credential.json"),
      },
    };
  }

  it(
    "the firstboot client adopts generation 1, is re-flashed, and adopts generation 2",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "kitluy-reflash-e2e-"));
      try {
        const chain = readDevPkiChain(resolveDevPkiPaths()!);
        const expectedRootSha256 = createHash("sha256")
          .update(new X509Certificate(chain.rootCertificatePem).raw)
          .digest("hex");
        const board = await pairedHub();
        const client = routeClient();

        const cardA = sdCard(root, "card-a", board.identity);
        const first = await ensureOperationalCertificate({
          client,
          deviceRecordId: board.deviceId,
          environment: ENVIRONMENT,
          hardwareTrustLevel: "development_software",
          assignmentGeneration: board.assignmentGeneration,
          trustedTime: new Date(),
          expectedRootSha256,
          paths: cardA.paths,
          identitySigner: cardA.identitySigner,
        });
        expect(first.kind, JSON.stringify(first)).toBe("adopted");
        if (first.kind !== "adopted") return;
        expect(first.manifest.certificateGeneration).toBe(1);
        expect(await lifecycle(board.deviceId)).toBe("active");

        // The card is re-flashed: a NEW card, a NEW identity key, the same board.
        await reflash(board);
        await rePair(board);
        const cardB = sdCard(root, "card-b", board.identity);

        const recovered = await ensureOperationalCertificate({
          client,
          deviceRecordId: board.deviceId,
          environment: ENVIRONMENT,
          hardwareTrustLevel: "development_software",
          assignmentGeneration: board.assignmentGeneration,
          trustedTime: new Date(),
          expectedRootSha256,
          paths: cardB.paths,
          identitySigner: cardB.identitySigner,
        });
        expect(recovered.kind, JSON.stringify(recovered)).toBe("adopted");
        if (recovered.kind !== "adopted") return;
        expect(recovered.manifest.certificateGeneration).toBe(2);
        expect(recovered.manifest.deviceRecordId).toBe(board.deviceId);
        expect(recovered.manifest.publicKeyFingerprint).not.toBe(
          first.manifest.publicKeyFingerprint,
        );
        // The route re-checked trust, and the board is back in service.
        expect(await lifecycle(board.deviceId)).toBe("active");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    FLOW_TIMEOUT_MS,
  );
});

describe("NOT A BACKDOOR: recovery refuses everyone who is not the re-flashed board", () => {
  it(
    "refuses a stranger who knows the device id and signs with their own identity key",
    async () => {
      const hub = await hubInService();
      await reflash(hub);
      await rePair(hub);

      const outcome = await ask(hub, rsaKey(), { identity: identityKey() });
      expect(refusalOf(outcome)).toContain("KLUY-RECOVERY-IDENTITY-MISMATCH");
      const state = await snapshot(hub.deviceId);
      expect(state.reservations).toHaveLength(0);
      expect(state.keys.filter((k) => k.generation === 2)).toHaveLength(0);
      expect(state.head?.current_generation).toBe(1);
    },
    FLOW_TIMEOUT_MS,
  );

  it(
    "refuses the board's PREVIOUS identity key: the card that was replaced is not the device",
    async () => {
      const hub = await hubInService();
      const { previousIdentity } = await reflash(hub);
      await rePair(hub);

      const outcome = await ask(hub, rsaKey(), { identity: previousIdentity });
      expect(refusalOf(outcome)).toContain("KLUY-RECOVERY-IDENTITY-MISMATCH");
      expect((await snapshot(hub.deviceId)).reservations).toHaveLength(0);
    },
    FLOW_TIMEOUT_MS,
  );

  it(
    "refuses an identity proof over different bytes before anything is reserved",
    async () => {
      const hub = await hubInService();
      await reflash(hub);
      await rePair(hub);

      const outcome = await ask(hub, rsaKey(), { tamperIdentityProof: true });
      expect(refusalOf(outcome)).toContain("OPCERT_RECOVERY_IDENTITY_PROOF_FAILED");
      expect((await snapshot(hub.deviceId)).reservations).toHaveLength(0);
    },
    FLOW_TIMEOUT_MS,
  );

  it(
    "refuses a board that was never re-flashed: its current installation holds the certificate",
    async () => {
      // Issued but not activated, so it is still awaiting_trust and every other
      // precondition holds — only the re-flash evidence is missing.
      const board = await pairedHub();
      const first = await ask(board, rsaKey(), { identity: null });
      expect(first.outcome, refusalOf(first)).toBe("ISSUED");
      expect(await lifecycle(board.deviceId)).toBe("awaiting_trust");

      const outcome = await ask(board, rsaKey());
      expect(refusalOf(outcome)).toContain("KLUY-RECOVERY-NO-REFLASH-EVIDENCE");
      expect((await snapshot(board.deviceId)).reservations).toHaveLength(0);
    },
    FLOW_TIMEOUT_MS,
  );

  it(
    "refuses a re-flashed board that has not been re-paired by an operator",
    async () => {
      const hub = await hubInService();
      await reflash(hub);
      expect(await lifecycle(hub.deviceId)).toBe("active");

      const outcome = await ask(hub, rsaKey());
      expect(refusalOf(outcome)).toContain("KLUY-RECOVERY-DEVICE-STATE");
      expect((await snapshot(hub.deviceId)).reservations).toHaveLength(0);
    },
    FLOW_TIMEOUT_MS,
  );

  it(
    "refuses a revoked credential: revocation is a decision recovery does not route around",
    async () => {
      const hub = await hubInService();
      await reflash(hub);
      await rePair(hub);

      // `device_credentials` is owned by the credential issuer.
      await withBorrowedRole("kitluy_credential_issuer", async (client) => {
        await client.query(
          `update kitluy_devices.device_credentials
              set revoked_at = now(), state = 'revoked',
                  revocation_reason = 'reflash suite: revoked before recovery'
            where credential_id = $1::uuid`,
          [hub.firstCredentialId],
        );
      });

      const outcome = await ask(hub, rsaKey());
      expect(refusalOf(outcome)).toContain("KLUY-RECOVERY-REVOKED-CREDENTIAL");
      expect((await snapshot(hub.deviceId)).reservations).toHaveLength(0);
    },
    FLOW_TIMEOUT_MS,
  );
});

describe("CONCURRENCY: two recoveries race for one generation", () => {
  it(
    "allocates exactly one generation and exactly one active recovered key",
    async () => {
      const hub = await hubInService();
      await reflash(hub);
      await rePair(hub);

      const results = await Promise.all([ask(hub, rsaKey()), ask(hub, rsaKey())]);
      const issued = results.filter((r) => r.outcome === "ISSUED");
      expect(issued, results.map(refusalOf).join(" | ")).toHaveLength(1);
      expect(results.filter((r) => r.outcome === "REFUSED")).toHaveLength(1);

      const state = await snapshot(hub.deviceId);
      expect(state.head?.current_generation).toBe(2);
      expect(state.keys.filter((k) => k.state === "active")).toHaveLength(1);
      expect(state.artifacts.filter((a) => a.status === "active")).toHaveLength(1);
      expect(state.reservations.filter((r) => r.status === "completed")).toHaveLength(1);
    },
    FLOW_TIMEOUT_MS,
  );
});

describe("NOTHING ELSE CHANGED", () => {
  it(
    "first issuance is unchanged for a device with no credential, even with an identity proof",
    async () => {
      const board = await pairedHub();
      const outcome = await ask(board, rsaKey());
      expect(outcome.outcome, refusalOf(outcome)).toBe("ISSUED");
      if (outcome.outcome === "REFUSED") return;
      expect(outcome.certificateGeneration).toBe(1);
      expect(outcome.recovered).toBeUndefined();
      expect((await snapshot(board.deviceId)).reservations).toHaveLength(0);
    },
    FLOW_TIMEOUT_MS,
  );

  it(
    "a first-issuance retry that now carries an identity proof replays generation 1",
    async () => {
      const board = await pairedHub();
      const key = rsaKey();
      const fixed = {
        requestId: randomUUID(),
        nonce: randomUUID(),
        correlationId: randomUUID(),
        requestedAt: new Date(),
      };
      const first = await ask(board, key, { ...fixed, identity: null });
      expect(first.outcome, refusalOf(first)).toBe("ISSUED");
      const retry = await ask(board, key, fixed);
      expect(retry.outcome, refusalOf(retry)).toBe("REPLAYED");
      if (first.outcome === "REFUSED" || retry.outcome === "REFUSED") return;
      expect(retry.certificateSha256).toBe(first.certificateSha256);
      expect(retry.certificateGeneration).toBe(1);
    },
    FLOW_TIMEOUT_MS,
  );

  it("keeps proactive key rotation disabled, and recovery gated by a named decision", async () => {
    const { rows } = await pool.query<{
      allow_key_rotation: boolean;
      allow_reflash_credential_recovery: boolean;
      reflash_recovery_approved_by_decision_ref: string | null;
    }>(
      `select allow_key_rotation, allow_reflash_credential_recovery, reflash_recovery_approved_by_decision_ref
         from kitluy_devices.renewal_policy where environment = 'development'`,
    );
    expect(rows[0]).toEqual({
      allow_key_rotation: false,
      allow_reflash_credential_recovery: true,
      reflash_recovery_approved_by_decision_ref: "KLD-2026-09-14-REFLASH-CREDENTIAL-RECOVERY-001",
    });

    const client = await pool.connect();
    try {
      await client.query("begin");
      await expect(
        client.query(
          `update kitluy_devices.renewal_policy
              set reflash_recovery_approved_by_decision_ref = null
            where environment = 'development'`,
        ),
      ).rejects.toThrow(/renewal_policy_reflash_recovery_needs_decision_chk/);
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }
  });

  it(
    "recovery evidence is append-only, and only the governed door may write it",
    async () => {
      const hub = await hubInService();
      await reflash(hub);
      await rePair(hub);
      const recovered = await ask(hub, rsaKey());
      expect(recovered.outcome, refusalOf(recovered)).toBe("ISSUED");

      await expect(
        pool.query(
          `update kitluy_devices.device_credential_recovery_evidence
              set actor_ref = 'rewritten' where device_record_id = $1::uuid`,
          [hub.deviceId],
        ),
      ).rejects.toThrow(/KLUY-RECOVERY-EVIDENCE-IMMUTABLE/);

      await expect(
        pool.query(
          `insert into kitluy_devices.device_credential_recovery_evidence
             select * from kitluy_devices.device_credential_recovery_evidence
              where device_record_id = $1::uuid`,
          [hub.deviceId],
        ),
      ).rejects.toThrow(/KLUY-RECOVERY-UNAUTHORIZED/);
      expect((await snapshot(hub.deviceId)).evidence).toHaveLength(1);
    },
    FLOW_TIMEOUT_MS,
  );
});
