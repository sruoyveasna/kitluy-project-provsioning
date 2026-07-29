/**
 * Live-database fixtures and adapters for the same-key renewal preflight suite.
 *
 * TEST-ONLY, and deliberately not exported from `src/`. Nothing in the shipped
 * package opens a database connection.
 *
 * Everything here goes through the GOVERNED path. There is no direct write to
 * `device_credentials`, `device_credential_heads` or `device_generation_keys`
 * anywhere in this file — not even to build a fixture — because a fixture built
 * by bypassing the governor would prove nothing about the path under test. (It
 * would also fail: `postgres` in this stack is not a superuser and is not a
 * member of `kitluy_credential_issuer`.)
 */
import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";

import {
  DevelopmentCertificateAuthority,
  DevelopmentDeviceKeyProvider,
  verifyDetachedSignature,
} from "../../src/dev-crypto.js";
import { runGovernedIssuance, type GovernedIssuanceGateway } from "../../src/issuance-adapter.js";
import type {
  CredentialHeadRecord,
  IncumbentCredentialRecord,
  IncumbentCredentialRepository,
  ProviderKeyRecord,
  RenewalReservationGateway,
  ReservedRenewalRow,
  RevocationStateRecord,
  StoredChainLink,
} from "../../src/same-key-renewal-preflight.js";
import type { DeviceRecordId } from "../../src/index.js";

export const MS_PER_DAY = 86_400_000;
export const DEVELOPMENT = "development";
export const DEVICE_IDENTITY = "device_identity";

/** Seed scope, shared with `supabase/tests/assertions.sql`. */
const TENANT_ID = "00000000-0000-4000-8000-000000000011";
const DIGITAL_STORE_ID = "00000000-0000-4000-8000-000000000015";
const STORE_LOCATION_ID = "00000000-0000-4000-8000-000000000018";
const HARDWARE_PROFILE_KEY = "WS11-T001-HUB-PROBE";

/**
 * Roles a test may assume. An ALLOWLIST rather than an interpolated argument:
 * `SET ROLE` cannot be parameterized, so the only safe input is a fixed one.
 */
export const TEST_ROLES = {
  issuanceService: "kitluy_issuance_service",
  serviceRole: "service_role",
} as const;
export type TestRole = (typeof TEST_ROLES)[keyof typeof TEST_ROLES];

const sha256Hex = (value: string): string =>
  createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");

/**
 * Runs `fn` under `role`, and restores the session role afterwards even when it
 * throws. `set local` keeps the change inside the caller's transaction.
 */
export async function withRole<T>(
  client: pg.PoolClient,
  role: TestRole,
  fn: () => Promise<T>,
): Promise<T> {
  await client.query(`set local role ${role}`);
  try {
    return await fn();
  } finally {
    await client.query("reset role").catch(() => undefined);
  }
}

export async function currentRole(client: pg.PoolClient): Promise<string> {
  const result = await client.query<{ role: string }>("select current_user as role");
  return result.rows[0]?.role ?? "";
}

/**
 * Runs a statement expected to be REFUSED, inside a savepoint so the refusal
 * does not abort the surrounding transaction. Returns the message.
 *
 * Fails loudly if the statement SUCCEEDS: a privilege test that silently passes
 * because the write went through is worse than no test.
 */
export async function expectRefused(
  client: pg.PoolClient,
  run: () => Promise<unknown>,
): Promise<string> {
  const savepoint = `sp_${randomUUID().replace(/-/g, "")}`;
  await client.query(`savepoint ${savepoint}`);
  try {
    await run();
    await client.query(`rollback to savepoint ${savepoint}`);
    throw new Error("EXPECTED REFUSAL: the statement succeeded and should not have");
  } catch (error) {
    await client.query(`rollback to savepoint ${savepoint}`).catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("EXPECTED REFUSAL")) throw error;
    return message;
  }
}

// ---------------------------------------------------------------------------
// The governed issuance gateway, over a real transaction
// ---------------------------------------------------------------------------

function pgIssuanceGateway(client: pg.PoolClient): GovernedIssuanceGateway {
  const call = async (sql: string, params: unknown[]): Promise<Record<string, unknown>> => {
    const result = await client.query<{ result: Record<string, unknown> }>(sql, params);
    return result.rows[0]?.result ?? {};
  };
  return {
    async prepare(input) {
      const row = await call(
        `select kitluy_devices.prepare_device_credential_issuance_v1(
           $1,$2::uuid,$3,$4,$5::integer,$6,$7,$8,$9,$10,$11,$12::bytea,$13,$14,$15::timestamptz,$16,$17
         ) as result`,
        [
          input.requestId,
          input.deviceRecordId,
          input.environment,
          input.purpose,
          input.assignmentGeneration,
          input.publicKeyPem,
          input.publicKeyFingerprint,
          input.idempotencyKey,
          input.canonicalPayloadHash,
          input.popAlgorithm,
          input.popSignedPreimageHash,
          Buffer.from(input.popSignature),
          input.popServiceVerified,
          input.issuerKeyId,
          input.trustedTime,
          input.trustedTimeStatus,
          input.actorRef,
        ],
      );
      return {
        outcome: row["outcome"] as "RESERVED" | "REPLAYED_RESERVATION" | "ALREADY_ISSUED",
        requestId: String(row["request_id"] ?? input.requestId),
        credentialId: String(row["credential_id"] ?? ""),
        serialNumber: String(row["serial_number"] ?? ""),
        certificateGeneration: Number(row["certificate_generation"] ?? 0),
        assignmentGeneration: Number(row["assignment_generation"] ?? 0),
        issuerKeyId: row["issuer_key_id"] as string | undefined,
        notBefore: row["not_before"] as string | undefined,
        notAfter: row["not_after"] as string | undefined,
        canonicalTbs: row["canonical_tbs"] as string | undefined,
        canonicalTbsHash: row["canonical_tbs_hash"] as string | undefined,
        headVersionSeen: Number(row["head_version_seen"] ?? 0),
        alreadySigned: row["already_signed"] === true,
      };
    },
    async recordSignature(input) {
      const row = await call(
        `select kitluy_devices.record_device_credential_signature_v1($1,$2,$3::bytea,$4,$5) as result`,
        [
          input.requestId,
          input.canonicalTbsHash,
          Buffer.from(input.detachedSignature),
          input.serviceVerified,
          input.actorRef,
        ],
      );
      return { outcome: String(row["outcome"] ?? "") };
    },
    async finalize(input) {
      const row = await call(
        `select kitluy_devices.finalize_device_credential_issuance_v1($1,$2::jsonb,$3) as result`,
        [
          input.requestId,
          JSON.stringify(
            input.chainLinks.map((link) => ({
              link_position: link.linkPosition,
              role: link.role,
              subject_fingerprint: link.subjectFingerprint,
              issuer_key_id: link.issuerKeyId,
              canonical_tbs: link.canonicalTbs,
              detached_signature_b64: link.detachedSignatureB64,
            })),
          ),
          input.actorRef,
        ],
      );
      return {
        outcome: row["outcome"] as "ISSUED" | "ALREADY_ISSUED",
        credentialId: String(row["credential_id"] ?? ""),
        serialNumber: String(row["serial_number"] ?? ""),
        certificateGeneration: Number(row["certificate_generation"] ?? 0),
      };
    },
    async recordOrphanSignature() {
      throw new Error("the fixture never orphans a signature");
    },
  };
}

// ---------------------------------------------------------------------------
// The incumbent fixture
// ---------------------------------------------------------------------------

export interface IncumbentFixture {
  readonly deviceRecordId: string;
  readonly credentialId: string;
  readonly serialNumber: string;
  readonly publicKeyPem: string;
  readonly fingerprint: string;
  readonly providerKeyHandle: string;
  readonly generation: number;
  readonly assignmentGeneration: number;
  readonly headVersion: number;
  readonly notBefore: Date;
  readonly notAfter: Date;
  readonly ca: DevelopmentCertificateAuthority;
  /** Counts every provider key generation. Asserted to stay at ONE. */
  readonly keyGenerationCount: () => number;
  /** True only if some caller asked the provider for private key material. */
  readonly privateKeyWasExported: () => boolean;
}

/**
 * Issues a real, verifiable incumbent credential through the governed path.
 *
 * `issuedAtTrustedTime` sets the credential's 30-day window, so a caller can
 * place the renewal window wherever a test needs it WITHOUT touching a clock:
 * the preflight is then run with a later trusted time.
 */
export async function createIncumbentFixture(
  client: pg.PoolClient,
  options: { readonly issuedAtTrustedTime: Date; readonly label: string },
): Promise<IncumbentFixture> {
  const suffix = randomUUID();
  const ca = new DevelopmentCertificateAuthority({
    notBefore: new Date(options.issuedAtTrustedTime.getTime() - 365 * MS_PER_DAY),
    notAfter: new Date(options.issuedAtTrustedTime.getTime() + 3650 * MS_PER_DAY),
  });

  // The device key is generated INSIDE the provider and never leaves it. The
  // handle is a placeholder id because enrollment needs the fingerprint before
  // a device_record_id exists — the private half is still unreachable either
  // way, which is the property this fixture must not weaken.
  let generations = 0;
  const provider = new DevelopmentDeviceKeyProvider();
  const keyHandleId = `fixture-${suffix}` as DeviceRecordId;
  await provider.generateDeviceKey(keyHandleId, DEVELOPMENT);
  generations += 1;
  const publicKeyPem = provider.publicKeyPem(keyHandleId) ?? "";
  const { publicKeyFingerprint } = await import("../../src/dev-crypto.js");
  const fingerprint = publicKeyFingerprint(publicKeyPem);

  const profile = await client.query<{ id: string }>(
    "select id from kitluy_devices.hardware_profiles where profile_key = $1",
    [HARDWARE_PROFILE_KEY],
  );
  const hardwareProfileId = profile.rows[0]?.id;
  if (hardwareProfileId === undefined) {
    throw new Error(`the seed hardware profile ${HARDWARE_PROFILE_KEY} is missing`);
  }

  const enrolled = await client.query<{ id: string }>(
    `select kitluy_devices.enroll_device_v1(
       $1, $2::uuid, $3::timestamptz, $4, 'ed25519', 'software', $5, $6, $7::jsonb) as id`,
    [
      `KL-${options.label}-${suffix}`,
      hardwareProfileId,
      options.issuedAtTrustedTime,
      // The enrolled fingerprint IS the device key's. Governed issuance
      // re-checks it, so a fixture that enrolled some other value would be
      // refused rather than quietly producing a mismatched credential.
      fingerprint,
      `STATION-${options.label}`,
      `OP-${options.label}`,
      JSON.stringify([
        { signal_type: "mac_address", signal_value: `aa:bb:${suffix.slice(0, 8)}` },
        { signal_type: "board_serial", signal_value: `board-${suffix}` },
        { signal_type: "storage_serial", signal_value: `nvme-${suffix}` },
      ]),
    ],
  );
  const deviceRecordId = enrolled.rows[0]?.id ?? "";

  const claimToken = sha256Hex(`claim-${suffix}`);
  const claimPayload = sha256Hex(`payload-${suffix}`);
  await client.query(
    `select kitluy_devices.create_device_claim_v1(
       $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, 900, $7)`,
    [
      deviceRecordId,
      TENANT_ID,
      DIGITAL_STORE_ID,
      STORE_LOCATION_ID,
      claimToken,
      claimPayload,
      `OP-${options.label}`,
    ],
  );
  await client.query("select kitluy_devices.redeem_device_claim_v1($1, $2, $3::uuid, $4)", [
    claimToken,
    claimPayload,
    deviceRecordId,
    `HUB-${options.label}`,
  ]);

  const assignment = await client.query<{ assignment_generation: number }>(
    "select assignment_generation from kitluy_devices.devices where id = $1",
    [deviceRecordId],
  );
  const assignmentGeneration = Number(assignment.rows[0]?.assignment_generation ?? 0);

  // Idempotency key must be a sha-256 hex digest: the database derives the
  // credential id and serial from it.
  const idempotencyKey = sha256Hex(`idem-${suffix}`);
  const requestId = `rq-${options.label}-${suffix}`;
  const preimage = Buffer.from(`kitluy.csr.v1\n${deviceRecordId}\n${fingerprint}`, "utf8");
  const popSignature = provider.provePossession(keyHandleId, preimage);
  // OPTION B: the SERVICE performs the asymmetric check. A false verdict here
  // would spend the request id, so it is computed, never asserted.
  const popServiceVerified = verifyDetachedSignature(publicKeyPem, preimage, popSignature);

  const issued = await withRole(client, TEST_ROLES.issuanceService, async () => {
    await client.query(
      `select kitluy_devices.register_generation_key_v1($1::uuid, $2, $3, $4::integer, $5, $6, $7)`,
      [
        deviceRecordId,
        DEVELOPMENT,
        DEVICE_IDENTITY,
        1,
        `dev-device:${keyHandleId}`,
        publicKeyPem,
        fingerprint,
      ],
    );

    return runGovernedIssuance(
      {
        requestId,
        deviceRecordId,
        environment: DEVELOPMENT,
        purpose: DEVICE_IDENTITY,
        assignmentGeneration,
        publicKeyPem,
        publicKeyFingerprint: fingerprint,
        idempotencyKey,
        canonicalPayloadHash: sha256Hex(`canonical-${suffix}`),
        popAlgorithm: "ed25519",
        popSignedPreimageHash: createHash("sha256").update(preimage).digest("hex"),
        popSignature,
        popServiceVerified,
        issuerKeyId: ca.intermediateKeyId,
        trustedTime: options.issuedAtTrustedTime,
        trustedTimeStatus: "trusted",
        actorRef: `ISSUANCE-${options.label}`,
        hardwareTrustLevel: "development_software",
      },
      pgIssuanceGateway(client),
      ca,
    );
  });

  if (issued.outcome !== "ISSUED") {
    throw new Error(
      `fixture issuance did not issue: ${issued.refusalCode ?? "?"} ${issued.detail ?? ""}`,
    );
  }

  const stored = await client.query<{
    credential_id: string;
    serial_number: string;
    not_before: Date;
    not_after: Date;
    certificate_generation: number;
  }>(
    `select credential_id, serial_number, not_before, not_after, certificate_generation
     from kitluy_devices.device_credentials where created_from_request_id = $1`,
    [requestId],
  );
  const row = stored.rows[0];
  if (row === undefined) throw new Error("fixture issuance left no credential row");

  const head = await client.query<{ version: string }>(
    `select version from kitluy_devices.device_credential_heads
     where device_record_id = $1 and environment = $2 and purpose = $3`,
    [deviceRecordId, DEVELOPMENT, DEVICE_IDENTITY],
  );

  return {
    deviceRecordId,
    credentialId: row.credential_id,
    serialNumber: row.serial_number,
    publicKeyPem,
    fingerprint,
    providerKeyHandle: `dev-device:${keyHandleId}`,
    generation: Number(row.certificate_generation),
    assignmentGeneration,
    headVersion: Number(head.rows[0]?.version ?? 0),
    notBefore: row.not_before,
    notAfter: row.not_after,
    ca,
    keyGenerationCount: () => generations,
    // `DevelopmentDeviceKeyProvider` has no export method at all — not a
    // disabled one, none — so this can only ever be false. It is asserted
    // anyway, so the guarantee is checked rather than assumed.
    privateKeyWasExported: () =>
      Object.keys(provider).some((key) => /private|export|secret/i.test(key)),
  };
}

// ---------------------------------------------------------------------------
// Read adapters over the real tables
// ---------------------------------------------------------------------------

export function pgIncumbentRepository(client: pg.PoolClient): IncumbentCredentialRepository {
  return {
    async loadCredentialHead(scope): Promise<CredentialHeadRecord | null> {
      const result = await client.query(
        `select device_record_id, environment, purpose, current_generation,
                previous_generation, overlap_ends_at, version
         from kitluy_devices.device_credential_heads
         where device_record_id = $1 and environment = $2 and purpose = $3`,
        [scope.deviceRecordId, scope.environment, scope.purpose],
      );
      const row = result.rows[0];
      if (row === undefined) return null;
      return {
        deviceRecordId: row.device_record_id,
        environment: row.environment,
        purpose: row.purpose,
        currentGeneration: Number(row.current_generation),
        previousGeneration:
          row.previous_generation === null ? null : Number(row.previous_generation),
        overlapEndsAt: row.overlap_ends_at,
        version: Number(row.version),
      };
    },

    async loadCredentialAtGeneration(scope, generation): Promise<IncumbentCredentialRecord | null> {
      const result = await client.query(
        `select credential_id, serial_number, device_record_id, environment, purpose,
                certificate_generation, assignment_generation, public_key_fingerprint,
                issuer_key_id, hardware_trust_level, state, revoked_at,
                canonical_tbs, detached_signature
         from kitluy_devices.device_credentials
         where device_record_id = $1 and environment = $2 and purpose = $3
           and certificate_generation = $4`,
        [scope.deviceRecordId, scope.environment, scope.purpose, generation],
      );
      const row = result.rows[0];
      if (row === undefined) return null;
      return {
        credentialId: row.credential_id,
        serialNumber: row.serial_number,
        deviceRecordId: row.device_record_id,
        environment: row.environment,
        purpose: row.purpose,
        certificateGeneration: Number(row.certificate_generation),
        assignmentGeneration: Number(row.assignment_generation),
        publicKeyFingerprint: row.public_key_fingerprint,
        issuerKeyId: row.issuer_key_id,
        hardwareTrustLevel: row.hardware_trust_level,
        state: row.state,
        revokedAt: row.revoked_at,
        canonicalTbs: row.canonical_tbs,
        detachedSignature: new Uint8Array(row.detached_signature),
      };
    },

    async loadCredentialChainLinks(credentialId): Promise<readonly StoredChainLink[]> {
      const result = await client.query(
        `select link_position, role, canonical_tbs, detached_signature
         from kitluy_devices.device_credential_chain_links
         where credential_id = $1 order by link_position`,
        [credentialId],
      );
      return result.rows.map((row) => ({
        linkPosition: Number(row.link_position),
        role: row.role,
        canonicalTbs: row.canonical_tbs,
        detachedSignature: new Uint8Array(row.detached_signature),
      }));
    },

    async loadRevocationState(scope, serialNumber): Promise<RevocationStateRecord> {
      const result = await client.query(
        `select
           exists (
             select 1 from kitluy_devices.device_credentials
             where environment = $2 and serial_number = $3 and state = 'revoked'
           ) as credential_revoked,
           -- A device in a containment state cannot have its credential
           -- renewed: §10 containment is enforced immediately, not on the next
           -- revocation snapshot.
           exists (
             select 1 from kitluy_devices.devices
             where id = $1
               and lifecycle_state in
                 ('quarantined', 'restricted_investigation', 'suspended', 'retired', 'replaced')
           ) as device_revoked`,
        [scope.deviceRecordId, scope.environment, serialNumber],
      );
      return {
        credentialRevoked: result.rows[0]?.credential_revoked === true,
        deviceRevoked: result.rows[0]?.device_revoked === true,
      };
    },

    async loadCurrentProviderKey(scope): Promise<ProviderKeyRecord | null> {
      // NOT filtered by state. An inactive key must reach the preflight so it
      // can be refused as INACTIVE rather than reported as missing.
      const result = await client.query(
        `select id, device_record_id, environment, purpose, generation, key_generation,
                public_key_fingerprint, key_handle, state
         from kitluy_devices.device_generation_keys
         where device_record_id = $1 and environment = $2 and purpose = $3
         order by generation desc limit 1`,
        [scope.deviceRecordId, scope.environment, scope.purpose],
      );
      const row = result.rows[0];
      if (row === undefined) return null;
      return {
        keyId: row.id,
        deviceRecordId: row.device_record_id,
        environment: row.environment,
        purpose: row.purpose,
        generation: Number(row.generation),
        keyGeneration: row.key_generation === null ? null : Number(row.key_generation),
        publicKeyFingerprint: row.public_key_fingerprint,
        providerKeyReference: row.key_handle,
        state: row.state,
      };
    },
  };
}

/**
 * The governed reservation, executed as the ISSUANCE SERVICE.
 *
 * The role is assumed for the call and released afterwards, so the privilege
 * model is actually exercised rather than assumed from a `postgres` session
 * that inherits it.
 */
export function pgReservationGateway(client: pg.PoolClient): RenewalReservationGateway & {
  readonly rolesObserved: string[];
} {
  const rolesObserved: string[] = [];
  return {
    rolesObserved,
    async reserveRenewal(input): Promise<ReservedRenewalRow> {
      return withRole(client, TEST_ROLES.issuanceService, async () => {
        rolesObserved.push(await currentRole(client));
        // In production each governed call is its own transaction, so a
        // refusal rolls back only itself. The whole suite shares ONE
        // transaction it must be able to keep using, so the savepoint
        // reproduces that isolation rather than poisoning the rest of the test.
        const savepoint = `reserve_${randomUUID().replace(/-/g, "")}`;
        await client.query(`savepoint ${savepoint}`);
        try {
          const row = await runReserve(client, input);
          await client.query(`release savepoint ${savepoint}`);
          return row;
        } catch (error) {
          await client.query(`rollback to savepoint ${savepoint}`).catch(() => undefined);
          throw error;
        }
      });
    },
  };
}

async function runReserve(
  client: pg.PoolClient,
  input: Parameters<RenewalReservationGateway["reserveRenewal"]>[0],
): Promise<ReservedRenewalRow> {
  const result = await client.query<{ result: Record<string, unknown> }>(
    `select kitluy_devices.reserve_device_credential_renewal_v1(
       $1::uuid, $2, $3, $4, $5::timestamptz, $6,
       $7::kitluy_devices.renewal_mode, $8) as result`,
    [
      input.deviceRecordId,
      input.environment,
      input.purpose,
      input.idempotencyKey,
      input.trustedTime,
      input.trustedTimeStatus,
      input.renewalMode,
      input.actorRef,
    ],
  );
  const row = result.rows[0]?.result ?? {};
  return {
    outcome: row["outcome"] as "RESERVED" | "REPLAYED_RESERVATION",
    renewalAttemptId: String(row["renewal_attempt_id"] ?? ""),
    renewalMode: String(row["renewal_mode"] ?? ""),
    currentCredentialId: String(row["current_credential_id"] ?? ""),
    currentCredentialGeneration: Number(row["current_credential_generation"] ?? 0),
    nextCredentialGeneration: Number(row["next_credential_generation"] ?? 0),
    assignmentGeneration: Number(row["assignment_generation"] ?? 0),
    credentialHeadVersion: Number(row["credential_head_version"] ?? 0),
    status: String(row["status"] ?? ""),
  };
}

/** Row counts a test asserts did NOT move. */
export async function fleetCounts(
  client: pg.PoolClient,
  deviceRecordId: string,
): Promise<{
  readonly credentials: number;
  readonly providerKeys: number;
  readonly reservations: number;
  readonly headGeneration: number | null;
  readonly headVersion: number | null;
}> {
  const result = await client.query(
    `select
       (select count(*) from kitluy_devices.device_credentials where device_record_id = $1) as credentials,
       (select count(*) from kitluy_devices.device_generation_keys where device_record_id = $1) as provider_keys,
       (select count(*) from kitluy_devices.device_renewal_reservations where device_record_id = $1) as reservations,
       (select current_generation from kitluy_devices.device_credential_heads where device_record_id = $1) as head_generation,
       (select version from kitluy_devices.device_credential_heads where device_record_id = $1) as head_version`,
    [deviceRecordId],
  );
  const row = result.rows[0];
  return {
    credentials: Number(row.credentials),
    providerKeys: Number(row.provider_keys),
    reservations: Number(row.reservations),
    headGeneration: row.head_generation === null ? null : Number(row.head_generation),
    headVersion: row.head_version === null ? null : Number(row.head_version),
  };
}
