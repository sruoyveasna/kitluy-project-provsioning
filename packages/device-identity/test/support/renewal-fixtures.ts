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
import type { IncumbentDeviceKeySigner } from "../../src/same-key-renewal-issuance.js";
import type { RotationGateway } from "../../src/rotate-key-renewal-issuance.js";
import type {
  ObservedDatabaseState,
  ReconciliationAuditGateway,
  ReconciliationReader,
} from "../../src/renewal-reconciliation.js";
import type {
  LifecycleGateway,
  LifecycleReader,
  ObservedLifecycleState,
} from "../../src/credential-lifecycle.js";
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

/** Quote a role name for SET ROLE. Roles here are catalog values, never input. */
function quoteRole(role: string): string {
  return `"${role.replace(/"/g, '""')}"`;
}

/**
 * Run `body` with the governed clock pinned to `instant`.
 *
 * ===========================================================================
 * WHY THIS EXISTS
 * ===========================================================================
 * These fixtures build credentials whose validity window sits in the PAST, so
 * the renewal-window, overlap and expiry suites have something aged to reason
 * about. They used to do that by handing
 * `prepare_device_credential_issuance_v1` a `trustedTime` of their choosing,
 * which the door copied straight into `not_before`.
 *
 * That is finding C-2: the caller chose the certificate's validity anchor. It
 * was not a fixture-only shortcut — the Hub reached the same parameter with its
 * own `requestedAt`, so a device could date its own certificate. Group 0204
 * closed it, and the fixtures can no longer assert an anchor.
 *
 * They can still MOVE THE CLOCK, through the one door built for it. Everything
 * here is transaction-local: the policy row, the role, and the override all die
 * with the surrounding transaction, which these suites already roll back. In a
 * real database no `test_clock_policy` row exists, `test_clock_set_v1` is
 * refused to every runtime, service and human identity including
 * `service_role`, and `authoritative_now_v1` therefore returns the real clock.
 *
 * The distinction that matters: the caller still cannot NAME the anchor. It can
 * only ask a governed, audited authority to shift time for one transaction in a
 * database that has deliberately opted in.
 */
async function withGovernedClock<T>(
  client: pg.PoolClient,
  instant: Date | undefined,
  body: () => Promise<T>,
): Promise<T> {
  if (instant === undefined) return body();
  const savepoint = `clk_${randomUUID().replace(/-/g, "")}`;
  // The caller is usually already inside `set local role kitluy_issuance_service`,
  // and that role cannot reach `kitluy_ops` at all — nor should it: a service
  // identity that could touch the clock policy would own the clock. So the role
  // is stepped out of and put back exactly as it was found.
  const roleRow = await client.query<{ role: string }>("select current_user as role");
  const callerRole = roleRow.rows[0]?.role ?? "";
  const restoreRole = async (): Promise<void> => {
    if (callerRole !== "") {
      await client.query(`set local role ${quoteRole(callerRole)}`);
    }
  };

  // WHAT THIS FIXTURE INSTALLED, so it can remove exactly that and nothing else.
  //
  // An earlier version of this helper inserted the policy row and granted the
  // harness role and never took either back. Both LEAKED into the development
  // database: `kitluy_ops.test_clock_policy` ended up with a live row and
  // `postgres` ended up holding the clock authority, which left the sanctioned
  // test clock ENABLED — the precise condition group 0184's governance suite
  // exists to refuse, and it duly failed.
  //
  // A fixture that enables a security control must disable it again, and must
  // only remove what it added: another session's policy row is not ours to
  // delete.
  let installedPolicy = false;
  let grantedHarness = false;

  await client.query(`savepoint ${savepoint}`);
  try {
    await client.query("reset role");
    const inserted = await client.query(
      `insert into kitluy_ops.test_clock_policy (environment, enabled_by, decision_ref)
       values ('test', 'device-identity-renewal-fixtures', $1)
       on conflict do nothing
       returning environment`,
      ["KLD-2026-07-31-SECURITY-TEST-CLOCK-001"],
    );
    installedPolicy = (inserted.rowCount ?? 0) > 0;

    // UNCONDITIONAL, and that is not laziness.
    //
    // The obvious guard — skip the grant when `pg_has_role(..., 'member')` is
    // already true — is wrong here. A membership granted with `set_option =
    // false` makes that predicate TRUE while `SET ROLE` remains forbidden, and
    // `postgres`'s memberships in this database were granted exactly that way by
    // `supabase_admin`. The guarded version skipped the grant and every fixture
    // then died on "permission denied to set role".
    //
    // Granting again is idempotent and refreshes the set option, so it is simply
    // always done — and always undone below.
    await client.query(
      `do $b$ begin execute format('grant kitluy_test_harness to %I', current_user); end $b$;`,
    );
    grantedHarness = true;

    await client.query("set local role kitluy_test_harness");
    await client.query(`select kitluy_ops.test_clock_set_v1($1::timestamptz)`, [instant]);
    await restoreRole();
    return await body();
  } finally {
    // Hand the clock back BEFORE anything else: clearing a transaction-local
    // setting needs no privilege, and leaving it set would make every later
    // statement in this transaction quietly run in the past.
    await client
      .query(`select set_config('kitluy.test_clock_instant', '', true)`)
      .catch(() => undefined);
    await client.query("reset role").catch(() => undefined);
    // Remove ONLY what this call installed. The suite's own transaction is
    // usually rolled back, but these fixtures are also used from committing
    // paths, and a leaked clock policy is a real security regression rather than
    // untidiness.
    if (installedPolicy) {
      await client
        .query(
          `delete from kitluy_ops.test_clock_policy
            where environment = 'test' and enabled_by = 'device-identity-renewal-fixtures'`,
        )
        .catch(() => undefined);
    }
    if (grantedHarness) {
      await client
        .query(
          `do $b$ begin execute format('revoke kitluy_test_harness from %I', current_user); end $b$;`,
        )
        .catch(() => undefined);
    }
    await restoreRole().catch(() => undefined);
    await client.query(`release savepoint ${savepoint}`).catch(() => undefined);
  }
}

export function pgIssuanceGateway(client: pg.PoolClient): GovernedIssuanceGateway {
  const call = async (sql: string, params: unknown[]): Promise<Record<string, unknown>> => {
    // Each governed call is its own TRANSACTION in production, so a refusal
    // rolls back only itself. The suite shares one transaction it must keep
    // using, and a savepoint reproduces that isolation — without it a single
    // expected refusal aborts every later assertion in the test.
    const savepoint = `iss_${randomUUID().replace(/-/g, "")}`;
    await client.query(`savepoint ${savepoint}`);
    // ENTER THE ISSUANCE ROLE, as the product does.
    //
    // These calls used to run as plain `postgres` and worked, because `postgres`
    // inherited `service_role` and `service_role` inherited
    // `kitluy_issuance_service`. That chain is finding C-4, and group 0206 cut
    // it: the connection identity must now enter a role to reach a governed
    // door, exactly as `withServiceRole()` does in the registry service.
    //
    // `job-fixtures.ts` had already written down why this matters — "`postgres`
    // inherits `service_role` and would mask a missing grant, which is exactly
    // how a boundary test passes while the boundary is broken" — and it was
    // right: every one of these calls was passing through a boundary that did
    // not exist.
    const roleRow = await client.query<{ role: string }>("select current_user as role");
    const previousRole = roleRow.rows[0]?.role ?? "";
    try {
      await client.query(`set local role ${TEST_ROLES.issuanceService}`);
      const result = await client.query<{ result: Record<string, unknown> }>(sql, params);
      await client.query(`release savepoint ${savepoint}`);
      return result.rows[0]?.result ?? {};
    } catch (error) {
      await client.query(`rollback to savepoint ${savepoint}`).catch(() => undefined);
      throw error;
    } finally {
      // The savepoint rollback above already restores the role on the failure
      // path; this covers the success path, where the role would otherwise leak
      // into the rest of the caller's transaction.
      if (previousRole !== "") {
        await client.query(`set local role ${quoteRole(previousRole)}`).catch(() => undefined);
      }
    }
  };
  return {
    async prepare(input) {
      // The anchor comes from the DOOR now (group 0204). The fixture's
      // `trustedTime` no longer sets `not_before`; it says WHEN this issuance is
      // happening, and the governed clock makes that true for one statement.
      const row = await withGovernedClock(client, input.trustedTime, () =>
        call(
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
        ),
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
  /**
   * The SAME provider key, wrapped for renewal. Proves possession without
   * surrendering anything: the private half stays inside the provider vault.
   */
  readonly signer: IncumbentDeviceKeySigner;
  /** Every possession proof this fixture's key was asked for. */
  readonly possessionProofCount: () => number;
  /** True if provider key ACTIVATION was ever requested. Must stay false. */
  readonly activationWasCalled: () => boolean;
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
  let possessionProofs = 0;
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
    // NOT a seed row: `supabase/seed/` creates no hardware profiles at all.
    // This one is created by `supabase/tests/assertions.sql`, so these live
    // suites require the canonical order. Said explicitly, because "profile is
    // missing" on its own sends a reader hunting through the seed for
    // something that was never there.
    throw new Error(
      `hardware profile ${HARDWARE_PROFILE_KEY} is absent. It is created by ` +
        `supabase/tests/assertions.sql, NOT by the seed, so the live device-identity ` +
        `suites require the canonical order: pnpm db:reset -> db:seed -> db:test -> test:rls ` +
        `-> vitest. Inventing a profile here would mean guessing certification and ` +
        `secure-element values that are owner decisions.`,
    );
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

  // TRUSTED TIME, ESTABLISHED FOR REAL.
  //
  // This fixture used to hand `prepare_device_credential_issuance_v1` the pair
  // (`trustedTime`, `trustedTimeStatus: "trusted"`) for a device that had never
  // established trusted time at all, and the door believed it — that is exactly
  // finding C-2, and 160 assertions in this package were resting on it.
  //
  // Group 0204 makes the door read the DEVICE'S OWN trusted-time state instead
  // of the caller's claim, so the fixture now has to satisfy the precondition
  // rather than assert it. The value still comes from the control plane's own
  // clock inside the governed door; nothing here names a time.
  await client.query(
    `select kitluy_devices.establish_device_trusted_time_v1($1::uuid, $2::text, gen_random_uuid())`,
    [deviceRecordId, DEVELOPMENT],
  );

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
    signer: {
      publicKeyPem: (reference) =>
        reference === `dev-device:${keyHandleId}` ? publicKeyPem : null,
      proveIncumbentPossession: (reference, payload) => {
        if (reference !== `dev-device:${keyHandleId}`) {
          throw new Error(`the provider holds no key under ${reference}`);
        }
        possessionProofs += 1;
        // `provePossession` signs INSIDE the provider. There is no path here
        // that could return key material even if a caller asked for it.
        return provider.provePossession(keyHandleId, payload);
      },
    },
    possessionProofCount: () => possessionProofs,
    // Nothing in this fixture calls confirm_provider_key_activation_v1, and a
    // same-key renewal must never need to.
    activationWasCalled: () => false,
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

// ---------------------------------------------------------------------------
// Rotation: policy, registration and activation
// ---------------------------------------------------------------------------

/**
 * TEST-ONLY rotation enablement.
 *
 * Rotation stays DISABLED in the shipped policy. This names a test decision so
 * the `renewal_policy_rotation_needs_decision_chk` CHECK is satisfied HONESTLY
 * rather than bypassed — the constraint is the real control, and a test that
 * dodged it would be testing nothing.
 *
 * Every caller runs inside `withDatabaseTransaction`, so the override is rolled
 * back automatically. `restoreDevelopmentRotation` exists so a test can also
 * prove the restore explicitly rather than trusting the rollback.
 */
export const TEST_ROTATION_DECISION_REF = "TEST-ONLY-ws11-prompt-2c";

export async function enableDevelopmentRotation(
  client: pg.PoolClient,
  decisionRef: string = TEST_ROTATION_DECISION_REF,
): Promise<void> {
  await client.query(
    `update kitluy_devices.renewal_policy
        set allow_key_rotation = true, rotation_approved_by_decision_ref = $1
      where environment = $2`,
    [decisionRef, DEVELOPMENT],
  );
}

export async function restoreDevelopmentRotation(client: pg.PoolClient): Promise<void> {
  await client.query(
    `update kitluy_devices.renewal_policy
        set allow_key_rotation = false, rotation_approved_by_decision_ref = null
      where environment = $1`,
    [DEVELOPMENT],
  );
}

export async function readRotationPolicy(
  client: pg.PoolClient,
): Promise<{ allowKeyRotation: boolean; decisionRef: string | null; defaultMode: string }> {
  const r = await client.query(
    `select allow_key_rotation, rotation_approved_by_decision_ref, default_renewal_mode
       from kitluy_devices.renewal_policy where environment = $1`,
    [DEVELOPMENT],
  );
  return {
    allowKeyRotation: r.rows[0].allow_key_rotation === true,
    decisionRef: r.rows[0].rotation_approved_by_decision_ref,
    defaultMode: r.rows[0].default_renewal_mode,
  };
}

/**
 * The governed rotation writes, executed as the ISSUANCE SERVICE.
 *
 * Reads go as `postgres`: the executor can EXECUTE the governed functions and
 * cannot SELECT the tables behind them, which is the boundary group 0131
 * restored rather than widened.
 */
export function pgRotationGateway(client: pg.PoolClient): RotationGateway & {
  readonly rolesObserved: string[];
} {
  const rolesObserved: string[] = [];

  const governed = async (sql: string, params: unknown[]): Promise<Record<string, unknown>> =>
    withRole(client, TEST_ROLES.issuanceService, async () => {
      rolesObserved.push(await currentRole(client));
      const savepoint = `rot_${randomUUID().replace(/-/g, "")}`;
      await client.query(`savepoint ${savepoint}`);
      try {
        const result = await client.query<{ result: Record<string, unknown> }>(sql, params);
        await client.query(`release savepoint ${savepoint}`);
        return result.rows[0]?.result ?? {};
      } catch (error) {
        await client.query(`rollback to savepoint ${savepoint}`).catch(() => undefined);
        throw error;
      }
    });

  return {
    rolesObserved,

    async registerReplacementKey(input) {
      const row = await governed(
        `select kitluy_devices.register_generation_key_v2($1::uuid,$2,$3,$4,$5::integer) as result`,
        [
          input.renewalAttemptId,
          input.providerKeyReference,
          input.publicKeyPem,
          input.publicKeyFingerprint,
          input.keyGeneration,
        ],
      );
      return {
        outcome: row["outcome"] as "REGISTERED" | "ALREADY_REGISTERED",
        keyId: String(row["key_id"] ?? ""),
        state: String(row["state"] ?? ""),
        providerKeyReference: String(row["provider_key_reference"] ?? ""),
      };
    },

    async loadReplacementKey(renewalAttemptId) {
      const r = await client.query(
        `select id, state, key_generation, generation, public_key_fingerprint,
                key_handle, renewal_attempt_id
           from kitluy_devices.device_generation_keys
          where renewal_attempt_id = $1`,
        [renewalAttemptId],
      );
      const row = r.rows[0];
      if (row === undefined) return null;
      return {
        keyId: row.id,
        state: row.state,
        keyGeneration: row.key_generation === null ? null : Number(row.key_generation),
        generation: Number(row.generation),
        publicKeyFingerprint: row.public_key_fingerprint,
        providerKeyReference: row.key_handle,
        renewalAttemptId: row.renewal_attempt_id,
      };
    },

    async loadReservationStatus(renewalAttemptId) {
      const r = await client.query(
        `select status::text as s from kitluy_devices.device_renewal_reservations
          where renewal_attempt_id = $1`,
        [renewalAttemptId],
      );
      return r.rows[0]?.s ?? null;
    },

    async confirmProviderKeyActivation(input) {
      const row = await governed(
        `select kitluy_devices.confirm_provider_key_activation_v1(
           $1::uuid,$2::uuid,$3::uuid,$4,$5,$6::integer,$7::integer,$8,$9,$10) as result`,
        [
          input.renewalAttemptId,
          input.credentialId,
          input.deviceRecordId,
          input.environment,
          input.purpose,
          input.credentialGeneration,
          input.keyGeneration,
          input.providerKeyReference,
          input.publicKeyFingerprint,
          input.actorRef,
        ],
      );
      return {
        outcome: row["outcome"] as "ACTIVATED" | "ALREADY_ACTIVE",
        keyId: String(row["key_id"] ?? ""),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Reconciliation adapters
// ---------------------------------------------------------------------------

/**
 * Reads the whole observable database state for one renewal attempt.
 *
 * One query per fact, joined in TypeScript rather than in one clever query,
 * because a reconciler that mis-read a join would "repair" states that were
 * never broken and the mistake would be invisible.
 */
export function pgReconciliationReader(
  client: pg.PoolClient,
  requestIdFor: (renewalAttemptId: string) => string,
): ReconciliationReader {
  return {
    async loadDatabaseState(renewalAttemptId): Promise<ObservedDatabaseState | null> {
      const res = await client.query(
        `select renewal_attempt_id, renewal_mode::text mode, device_record_id, environment,
                purpose, status::text status, current_credential_id,
                current_credential_generation, next_credential_generation,
                assignment_generation, credential_head_version
           from kitluy_devices.device_renewal_reservations
          where renewal_attempt_id = $1`,
        [renewalAttemptId],
      );
      const r = res.rows[0];
      if (r === undefined) return null;

      const key = await client.query(
        `select state::text state, key_generation, public_key_fingerprint, key_handle
           from kitluy_devices.device_generation_keys where renewal_attempt_id = $1`,
        [renewalAttemptId],
      );
      const attempt = await client.query(
        `select state::text state, credential_id, serial_number, certificate_generation,
                canonical_tbs_hash, issuer_key_id, signature_sha256, detached_signature
           from kitluy_devices.device_credential_signing_attempts where request_id = $1`,
        [requestIdFor(renewalAttemptId)],
      );
      const credential = await client.query(
        `select credential_id from kitluy_devices.device_credentials
          where device_record_id = $1 and environment = $2 and purpose = $3
            and certificate_generation = $4`,
        [r.device_record_id, r.environment, r.purpose, Number(r.next_credential_generation)],
      );
      const head = await client.query(
        `select current_generation, version from kitluy_devices.device_credential_heads
          where device_record_id = $1 and environment = $2 and purpose = $3`,
        [r.device_record_id, r.environment, r.purpose],
      );
      const device = await client.query(
        `select assignment_generation from kitluy_devices.devices where id = $1`,
        [r.device_record_id],
      );

      const k = key.rows[0];
      const a = attempt.rows[0];
      return {
        renewalAttemptId: r.renewal_attempt_id,
        renewalMode: r.mode,
        deviceRecordId: r.device_record_id,
        environment: r.environment,
        purpose: r.purpose,
        reservationStatus: r.status,
        currentCredentialId: r.current_credential_id,
        currentCredentialGeneration: Number(r.current_credential_generation),
        nextCredentialGeneration: Number(r.next_credential_generation),
        assignmentGeneration: Number(r.assignment_generation),
        credentialHeadVersion: Number(r.credential_head_version),
        headVersion: head.rows[0] === undefined ? null : Number(head.rows[0].version),
        headGeneration: head.rows[0] === undefined ? null : Number(head.rows[0].current_generation),
        replacementKey:
          k === undefined
            ? null
            : {
                state: k.state,
                keyGeneration: k.key_generation === null ? null : Number(k.key_generation),
                publicKeyFingerprint: k.public_key_fingerprint,
                providerKeyReference: k.key_handle,
              },
        issuanceAttempt:
          a === undefined
            ? null
            : {
                state: a.state,
                credentialId: a.credential_id,
                serialNumber: a.serial_number,
                certificateGeneration: Number(a.certificate_generation),
                canonicalTbsHash: a.canonical_tbs_hash,
                issuerKeyId: a.issuer_key_id,
                signatureSha256: a.signature_sha256,
                hasSignature: a.detached_signature !== null,
              },
        credentialPersisted: credential.rowCount !== null && credential.rowCount > 0,
        persistedCredentialId: credential.rows[0]?.credential_id ?? null,
        deviceAssignmentGeneration: Number(device.rows[0].assignment_generation),
      };
    },
  };
}

/** Appends the reconciliation record through the governed function. */
export function pgReconciliationAudit(
  client: pg.PoolClient,
): ReconciliationAuditGateway & { readonly rolesObserved: string[] } {
  const rolesObserved: string[] = [];
  return {
    rolesObserved,
    async record(input) {
      return withRole(client, TEST_ROLES.issuanceService, async () => {
        rolesObserved.push(await currentRole(client));
        const savepoint = `rec_${randomUUID().replace(/-/g, "")}`;
        await client.query(`savepoint ${savepoint}`);
        try {
          const r = await client.query<{ result: Record<string, unknown> }>(
            `select kitluy_devices.record_renewal_reconciliation_v1(
               $1::uuid,$2,$3,$4,$5,$6,$7,$8,$9) as result`,
            [
              input.renewalAttemptId,
              input.observedDatabaseState,
              input.observedProviderState,
              input.classification,
              input.actionAttempted,
              input.actionResult,
              input.replayOutcome,
              input.failureCode,
              input.actorRef,
            ],
          );
          await client.query(`release savepoint ${savepoint}`);
          return { reconciliationId: String(r.rows[0]?.result["reconciliation_id"] ?? "") };
        } catch (error) {
          await client.query(`rollback to savepoint ${savepoint}`).catch(() => undefined);
          throw error;
        }
      });
    },
  };
}

/** Reads reconciliation history, so a test can assert what was recorded. */
export async function readReconciliations(
  client: pg.PoolClient,
  renewalAttemptId: string,
): Promise<
  ReadonlyArray<{
    classification: string;
    actionAttempted: string;
    replayOutcome: string;
    observedDatabaseState: string;
    observedProviderState: string;
    failureCode: string | null;
  }>
> {
  const r = await client.query(
    `select classification, action_attempted, replay_outcome, observed_database_state,
            observed_provider_state, failure_code
       from kitluy_devices.device_renewal_reconciliations
      where renewal_attempt_id = $1 order by sequence_no`,
    [renewalAttemptId],
  );
  return r.rows.map((row) => ({
    classification: row.classification,
    actionAttempted: row.action_attempted,
    replayOutcome: row.replay_outcome,
    observedDatabaseState: row.observed_database_state,
    observedProviderState: row.observed_provider_state,
    failureCode: row.failure_code,
  }));
}

// ---------------------------------------------------------------------------
// Lifecycle adapters
// ---------------------------------------------------------------------------

/**
 * Reads the whole lifecycle state for one device.
 *
 * The retention blockers are real counts from the real tables, not a fixture
 * flag: a key is retained because something actually still references it.
 */
export function pgLifecycleReader(client: pg.PoolClient): LifecycleReader {
  return {
    async loadLifecycleState(scope): Promise<ObservedLifecycleState | null> {
      const head = await client.query(
        `select current_generation, previous_generation, overlap_ends_at
           from kitluy_devices.device_credential_heads
          where device_record_id = $1 and environment = $2 and purpose = $3`,
        [scope.deviceRecordId, scope.environment, scope.purpose],
      );
      if (head.rowCount === 0) return null;
      const h = head.rows[0];

      const credential = async (generation: number | null) => {
        if (generation === null) return null;
        const r = await client.query(
          `select credential_id, certificate_generation, public_key_fingerprint,
                  state::text state, not_after
             from kitluy_devices.device_credentials
            where device_record_id = $1 and environment = $2 and purpose = $3
              and certificate_generation = $4`,
          [scope.deviceRecordId, scope.environment, scope.purpose, generation],
        );
        const row = r.rows[0];
        return row === undefined
          ? null
          : {
              credentialId: row.credential_id,
              certificateGeneration: Number(row.certificate_generation),
              publicKeyFingerprint: row.public_key_fingerprint,
              state: row.state,
              notAfter: row.not_after as Date,
            };
      };

      const current = await credential(Number(h.current_generation));
      const previous = await credential(
        h.previous_generation === null ? null : Number(h.previous_generation),
      );

      const keyFor = async (fingerprint: string | undefined) => {
        if (fingerprint === undefined) return null;
        const r = await client.query(
          `select key_handle, public_key_fingerprint, generation, key_generation, state::text state
             from kitluy_devices.device_generation_keys
            where device_record_id = $1 and environment = $2 and purpose = $3
              and public_key_fingerprint = $4`,
          [scope.deviceRecordId, scope.environment, scope.purpose, fingerprint],
        );
        const row = r.rows[0];
        return row === undefined
          ? null
          : {
              providerKeyReference: row.key_handle,
              publicKeyFingerprint: row.public_key_fingerprint,
              generation: Number(row.generation),
              keyGeneration: row.key_generation === null ? null : Number(row.key_generation),
              state: row.state,
            };
      };

      const policy = await client.query(
        `select destruction_enabled, minimum_retention_days, recovery_retention_days,
                requires_operator_approval, approved_by_decision_ref, required_owner_decision
           from kitluy_devices.key_destruction_policy where environment = $1`,
        [scope.environment],
      );
      const p = policy.rows[0];

      // Real blocker counts, from the real tables.
      const blockers = await client.query(
        `select
           (select count(*) from kitluy_devices.device_credential_signing_attempts
             where device_record_id = $1 and state in ('reserved', 'signed')) unfinished_issuance,
           (select count(*) from kitluy_devices.device_renewal_reservations
             where device_record_id = $1
               and status not in ('refused', 'abandoned', 'completed')) open_renewals,
           (select count(*) from kitluy_devices.device_generation_keys
             where device_record_id = $1
               and state = 'credential_issued_pending_activation') activation_pending,
           (select count(*) from kitluy_devices.device_renewal_reconciliations r
             join kitluy_devices.device_renewal_reservations v
               on v.renewal_attempt_id = r.renewal_attempt_id
            where v.device_record_id = $1
              and r.classification in ('MANUAL_REVIEW_REQUIRED', 'INCONSISTENT_STATE')) divergences`,
        [scope.deviceRecordId],
      );
      const b = blockers.rows[0];

      const referencing = await client.query(
        `select credential_id from kitluy_devices.device_credentials
          where device_record_id = $1 and environment = $2 and purpose = $3
            and public_key_fingerprint = $4 and state = 'issued'`,
        [
          scope.deviceRecordId,
          scope.environment,
          scope.purpose,
          previous?.publicKeyFingerprint ?? "",
        ],
      );

      return {
        deviceRecordId: scope.deviceRecordId,
        environment: scope.environment,
        purpose: scope.purpose,
        headGeneration: Number(h.current_generation),
        headPreviousGeneration:
          h.previous_generation === null ? null : Number(h.previous_generation),
        overlapEndsAt: h.overlap_ends_at as Date | null,
        currentCredential: current,
        previousCredential: previous,
        currentKey: await keyFor(current?.publicKeyFingerprint),
        previousKey: await keyFor(previous?.publicKeyFingerprint),
        destructionPolicy: {
          destructionEnabled: p?.destruction_enabled === true,
          minimumRetentionDays:
            p?.minimum_retention_days === null || p === undefined
              ? null
              : Number(p.minimum_retention_days),
          recoveryRetentionDays:
            p?.recovery_retention_days === null || p === undefined
              ? null
              : Number(p.recovery_retention_days),
          requiresOperatorApproval: p?.requires_operator_approval !== false,
          approvedByDecisionRef: p?.approved_by_decision_ref ?? null,
          requiredOwnerDecision: p?.required_owner_decision ?? null,
        },
        retention: {
          referencingCredentialIds: referencing.rows.map((r) => r.credential_id),
          unfinishedIssuanceCount: Number(b.unfinished_issuance),
          openRenewalCount: Number(b.open_renewals),
          activationPendingCount: Number(b.activation_pending),
          openReconciliationCount: 0,
          manualReviewOutstanding: Number(b.divergences) > 0,
        },
      };
    },
  };
}

/** The governed lifecycle writes, executed as the ISSUANCE SERVICE. */
export function pgLifecycleGateway(client: pg.PoolClient): LifecycleGateway & {
  readonly rolesObserved: string[];
} {
  const rolesObserved: string[] = [];
  const governed = async (sql: string, params: unknown[]): Promise<Record<string, unknown>> =>
    withRole(client, TEST_ROLES.issuanceService, async () => {
      rolesObserved.push(await currentRole(client));
      const savepoint = `life_${randomUUID().replace(/-/g, "")}`;
      await client.query(`savepoint ${savepoint}`);
      try {
        const r = await client.query<{ result: Record<string, unknown> }>(sql, params);
        await client.query(`release savepoint ${savepoint}`);
        return r.rows[0]?.result ?? {};
      } catch (error) {
        await client.query(`rollback to savepoint ${savepoint}`).catch(() => undefined);
        throw error;
      }
    });

  return {
    rolesObserved,
    async retireOverlappedCredential(input) {
      const row = await governed(
        `select kitluy_devices.retire_overlapped_credential_v1(
           $1::uuid,$2,$3,$4::timestamptz,$5,$6) as result`,
        [
          input.deviceRecordId,
          input.environment,
          input.purpose,
          input.trustedTime,
          input.trustedTimeStatus,
          input.actorRef,
        ],
      );
      return {
        outcome: String(row["outcome"] ?? ""),
        previousCredentialId: row["previous_credential_id"] as string | undefined,
      };
    },
    async recordLifecycleEvent(r) {
      const row = await governed(
        `select kitluy_devices.record_credential_lifecycle_event_v1(
           $1::uuid,$2,$3,$4::timestamptz,$5,$6,$7::uuid,$8::integer,$9::uuid,$10::integer,
           $11::timestamptz,$12,$13,$14,$15,$16,$17,$18,$19,$20) as result`,
        [
          r.deviceRecordId,
          r.environment,
          r.purpose,
          r.trustedTime,
          r.trustedTimeSource,
          r.trustedTimeStatus,
          r.currentCredentialId,
          r.currentCredentialGeneration,
          r.previousCredentialId,
          r.previousCredentialGeneration,
          r.overlapEndsAt,
          r.classification,
          r.credentialTransition,
          r.providerKeyTransition,
          r.destructionPolicyReference,
          r.providerResult,
          r.databaseConfirmationResult,
          r.reason,
          r.replayOutcome,
          r.actorRef,
        ],
      );
      return { lifecycleExecutionId: String(row["lifecycle_execution_id"] ?? "") };
    },
  };
}

/** Reads lifecycle history so a test can assert what was recorded. */
export async function readLifecycleEvents(
  client: pg.PoolClient,
  deviceRecordId: string,
): Promise<
  ReadonlyArray<{
    classification: string;
    credentialTransition: string;
    providerKeyTransition: string;
    destructionPolicyReference: string | null;
    trustedTimeStatus: string;
    replayOutcome: string;
  }>
> {
  const r = await client.query(
    `select classification, credential_transition, provider_key_transition,
            destruction_policy_reference, trusted_time_status, replay_outcome
       from kitluy_devices.device_credential_lifecycle_events
      where device_record_id = $1 order by sequence_no`,
    [deviceRecordId],
  );
  return r.rows.map((row) => ({
    classification: row.classification,
    credentialTransition: row.credential_transition,
    providerKeyTransition: row.provider_key_transition,
    destructionPolicyReference: row.destruction_policy_reference,
    trustedTimeStatus: row.trusted_time_status,
    replayOutcome: row.replay_outcome,
  }));
}
