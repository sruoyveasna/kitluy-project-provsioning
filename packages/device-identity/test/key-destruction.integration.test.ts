/**
 * Governed provider-key destruction — LIVE PostgreSQL.
 *
 * Authority: KLD-2026-07-29-DEVICE-KEY-DESTRUCTION-001 (KLREQ-031); migration
 * group 0137; WS-11-T003 Step 4.
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS AT ALL
 * ===========================================================================
 * `key-destruction.test.ts` proves the ORDERING against stubs. A stub cannot
 * prove that the retention window, the four-eyes gate, the holds, the attempt
 * budget and the "no confirmation without evidence" CHECK actually bite,
 * because a stub only ever agrees with itself. Every governed call below is a
 * real `select kitluy_devices.<fn>(...)` executed as `kitluy_issuance_service`,
 * and every refusal asserted below is a refusal the DATABASE produced.
 *
 * The provider is the real `DevelopmentReplacementKeyProvider` holding a real
 * private half in the dev vault, so "the provider erased something" is a fact
 * about a key that existed rather than a flag a fake flipped.
 *
 * Every test runs inside `withDatabaseTransaction`, which ALWAYS rolls back.
 * Nothing here can leave a destruction request, a hold or a destroyed key
 * behind for the order-sensitive assertion suite in `supabase/tests` to trip
 * over. A skip is reported as a skip, never as a pass.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import type pg from "pg";

import {
  devDatabaseUrl,
  isDevDatabaseReachable,
  reportSkippedIntegration,
  withDatabaseTransaction,
} from "./support/dev-database.js";
import {
  DEVELOPMENT,
  DEVICE_IDENTITY,
  MS_PER_DAY,
  TEST_ROLES,
  createIncumbentFixture,
  currentRole,
  enableDevelopmentRotation,
  expectRefused,
  pgIncumbentRepository,
  pgIssuanceGateway,
  pgReservationGateway,
  pgRotationGateway,
  withRole,
} from "./support/renewal-fixtures.js";
import {
  KEY_HOLD_TYPES,
  MAX_DESTRUCTION_EXECUTION_ATTEMPTS,
  approveProviderKeyDestruction,
  executeProviderKeyDestruction,
  requestProviderKeyDestruction,
  type DestructionExecutionInput,
  type KeyDestructionGateway,
  type ProviderKeyDestroyer,
} from "../src/key-destruction.js";
import {
  DevelopmentReplacementKeyProvider,
  ProviderDestructionAmbiguousError,
  type ProviderDestructionReceipt,
  type ProviderDestructionRequest,
} from "../src/replacement-key-provider.js";
import { completeRotateKeyCredentialRenewal } from "../src/rotate-key-renewal-issuance.js";
import type { TrustedTimeEvaluation } from "../src/trusted-time.js";

const SUITE = "@kitluy/device-identity governed provider-key destruction";

const reachable = await isDevDatabaseReachable();
if (!reachable) reportSkippedIntegration(SUITE);

const trustedAt = (instant: Date): TrustedTimeEvaluation => ({
  status: "trusted",
  trustedTime: instant,
  source: "authenticated_network",
  floorAdvanced: true,
  anomalyType: null,
  detail: "key-destruction fixture",
});

// ---------------------------------------------------------------------------
// The REAL gateway over the governed functions of migration group 0137
// ---------------------------------------------------------------------------

/**
 * Records every governed call and every provider call in ONE list.
 *
 * The ordering is the whole control (KLREQ-031 §9/§12): the database may only
 * mark a key destroyed after the provider produced evidence. A single shared
 * log is the only way to assert that "provider" really did precede "confirm"
 * — two separate counters can both be right while the order was wrong.
 */
type CallLog = string[];

interface RecordingGateway extends KeyDestructionGateway {
  readonly rolesObserved: string[];
}

/**
 * One method per governed function and nothing else, exactly as
 * `KeyDestructionGateway` requires. There is deliberately no helper here that
 * writes `device_key_destruction_requests`, `device_key_holds` or
 * `device_generation_keys` directly: group 0137 withholds those writes from
 * `kitluy_issuance_service` on purpose, and a convenience write in the test
 * harness would be a second path to the rows that skips retention, holds and
 * four-eyes — which is the thing this suite exists to prove impossible.
 */
function pgKeyDestructionGateway(client: pg.PoolClient, log: CallLog): RecordingGateway {
  const rolesObserved: string[] = [];

  const governed = async (
    step: string,
    sql: string,
    params: unknown[],
  ): Promise<Record<string, unknown>> =>
    withRole(client, TEST_ROLES.issuanceService, async () => {
      // Recorded per call, not once per suite: the point of the grant model is
      // that the EXECUTOR runs these, and a test that assumed the role without
      // observing it would still pass if the role were silently dropped.
      rolesObserved.push(await currentRole(client));
      log.push(step);
      // Each governed call is its own transaction in production, so a refusal
      // rolls back only itself. This suite shares one transaction it must keep
      // using; the savepoint reproduces that isolation instead of poisoning
      // every later assertion in the test.
      const savepoint = `kd_${randomUUID().replace(/-/g, "")}`;
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

    async evaluateEligibility(call) {
      return governed(
        "evaluate",
        `select kitluy_devices.evaluate_key_destruction_eligibility_v1(
           $1::uuid,$2,$3,$4::timestamptz,$5) as result`,
        [
          call.deviceRecordId,
          call.environment,
          call.providerKeyReference,
          call.trustedNow,
          call.trustedTimeStatus,
        ],
      );
    },

    async requestKeyDestruction(call) {
      return governed(
        "request",
        `select kitluy_devices.request_key_destruction_v1(
           $1,$2::uuid,$3,$4,$5,$6,$7,$8::boolean,$9::timestamptz,$10) as result`,
        [
          call.requestKey,
          call.deviceRecordId,
          call.environment,
          call.purpose,
          call.providerKeyReference,
          call.requestedBy,
          call.requestReason,
          call.reauthenticated,
          call.trustedNow,
          call.trustedTimeStatus,
        ],
      );
    },

    async approveKeyDestruction(call) {
      return governed(
        "approve",
        `select kitluy_devices.approve_key_destruction_v1(
           $1::uuid,$2,$3,$4::boolean,$5::timestamptz,$6) as result`,
        [
          call.destructionRequestId,
          call.approvedBy,
          call.approvalReason,
          call.reauthenticated,
          call.trustedNow,
          call.trustedTimeStatus,
        ],
      );
    },

    async beginKeyDestructionExecution(call) {
      return governed(
        "begin",
        `select kitluy_devices.begin_key_destruction_execution_v1($1::uuid,$2) as result`,
        [call.destructionRequestId, call.executedBy],
      );
    },

    async confirmKeyDestruction(call) {
      return governed(
        "confirm",
        `select kitluy_devices.confirm_key_destruction_v1(
           $1::uuid,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9::timestamptz) as result`,
        [
          call.destructionRequestId,
          call.providerResult,
          call.providerReceiptDigest,
          call.providerResponseRef,
          call.observedFingerprint,
          call.observedKeyReference,
          call.executedBy,
          call.startedAt,
          call.finishedAt,
        ],
      );
    },
  };
}

/** `place_key_hold_v1` / `release_key_hold_v1` — governed, as the executor. */
async function placeHold(
  client: pg.PoolClient,
  input: {
    readonly holdType: string;
    readonly deviceRecordId: string;
    readonly providerKeyReference: string;
    readonly declaredBy: string;
  },
): Promise<string> {
  return withRole(client, TEST_ROLES.issuanceService, async () => {
    const r = await client.query<{ result: Record<string, unknown> }>(
      `select kitluy_devices.place_key_hold_v1(
         $1::kitluy_devices.key_hold_type,$2::uuid,$3,$4,$5,$6) as result`,
      [
        input.holdType,
        input.deviceRecordId,
        DEVELOPMENT,
        input.providerKeyReference,
        `${input.holdType} hold for the destruction suite`,
        input.declaredBy,
      ],
    );
    expect(r.rows[0]?.result["outcome"]).toBe("HELD");
    return String(r.rows[0]?.result["hold_id"]);
  });
}

async function releaseHold(
  client: pg.PoolClient,
  holdId: string,
  releasedBy: string,
): Promise<Record<string, unknown>> {
  return withRole(client, TEST_ROLES.issuanceService, async () => {
    const r = await client.query<{ result: Record<string, unknown> }>(
      `select kitluy_devices.release_key_hold_v1($1::uuid,$2,$3) as result`,
      [holdId, releasedBy, "the matter that justified the hold closed"],
    );
    return r.rows[0]?.result ?? {};
  });
}

// ---------------------------------------------------------------------------
// Observation of the database — reads only, never a write
// ---------------------------------------------------------------------------

interface DestructionRow {
  readonly status: string;
  readonly approvedBy: string | null;
  readonly attemptCount: number;
  readonly providerResult: string | null;
  readonly providerReceiptDigest: string | null;
  readonly providerResponseRef: string | null;
  readonly databaseConfirmedAt: Date | null;
  readonly providerConfirmedAt: Date | null;
  readonly manualReviewReason: string | null;
  readonly lastFailureCode: string | null;
  readonly keyGeneration: number;
  readonly publicKeyFingerprint: string;
  readonly retentionBasis: string;
}

async function readRequest(client: pg.PoolClient, id: string): Promise<DestructionRow> {
  const r = await client.query(
    `select status::text status, approved_by, attempt_count, provider_result,
            provider_receipt_digest, provider_response_ref, database_confirmed_at,
            provider_confirmed_at, manual_review_reason, last_failure_code,
            key_generation, public_key_fingerprint, retention_basis
       from kitluy_devices.device_key_destruction_requests
      where destruction_request_id = $1`,
    [id],
  );
  const row = r.rows[0];
  if (row === undefined) throw new Error(`no destruction request ${id}`);
  return {
    status: row.status,
    approvedBy: row.approved_by,
    attemptCount: Number(row.attempt_count),
    providerResult: row.provider_result,
    providerReceiptDigest: row.provider_receipt_digest,
    providerResponseRef: row.provider_response_ref,
    databaseConfirmedAt: row.database_confirmed_at,
    providerConfirmedAt: row.provider_confirmed_at,
    manualReviewReason: row.manual_review_reason,
    lastFailureCode: row.last_failure_code,
    keyGeneration: Number(row.key_generation),
    publicKeyFingerprint: row.public_key_fingerprint,
    retentionBasis: row.retention_basis,
  };
}

/** The one fact every refusal in this suite must leave true. */
async function keyIsDestroyed(
  client: pg.PoolClient,
  deviceRecordId: string,
  providerKeyReference: string,
): Promise<{ state: string; destroyedAt: Date | null }> {
  const r = await client.query(
    `select state::text state, destroyed_at from kitluy_devices.device_generation_keys
      where device_record_id = $1 and environment = $2 and key_handle = $3`,
    [deviceRecordId, DEVELOPMENT, providerKeyReference],
  );
  return { state: r.rows[0]?.state ?? "MISSING", destroyedAt: r.rows[0]?.destroyed_at ?? null };
}

async function readAttempts(
  client: pg.PoolClient,
  destructionRequestId: string,
): Promise<ReadonlyArray<{ outcome: string; failureCode: string | null; attemptNumber: number }>> {
  const r = await client.query(
    `select outcome, failure_code, attempt_number
       from kitluy_devices.device_key_destruction_attempts
      where destruction_request_id = $1 order by sequence_no`,
    [destructionRequestId],
  );
  return r.rows.map((row) => ({
    outcome: row.outcome,
    failureCode: row.failure_code,
    attemptNumber: Number(row.attempt_number),
  }));
}

/**
 * EVERY column of EVERY destruction row for a device, serialized.
 *
 * `to_jsonb(row)` rather than a column list on purpose: a check that named the
 * columns would stop covering the one somebody adds later, and "no key material
 * anywhere in the evidence" has to mean anywhere.
 */
async function storedEvidenceJson(client: pg.PoolClient, deviceRecordId: string): Promise<string> {
  const requests = await client.query(
    `select to_jsonb(q) j from kitluy_devices.device_key_destruction_requests q
      where q.device_record_id = $1`,
    [deviceRecordId],
  );
  const attempts = await client.query(
    `select to_jsonb(a) j from kitluy_devices.device_key_destruction_attempts a
       join kitluy_devices.device_key_destruction_requests q
         on q.destruction_request_id = a.destruction_request_id
      where q.device_record_id = $1`,
    [deviceRecordId],
  );
  const holds = await client.query(
    `select to_jsonb(h) j from kitluy_devices.device_key_holds h where h.device_record_id = $1`,
    [deviceRecordId],
  );
  return JSON.stringify([...requests.rows, ...attempts.rows, ...holds.rows].map((r) => r.j));
}

// ---------------------------------------------------------------------------
// A key that is genuinely destroyable, built ONLY through governed calls
// ---------------------------------------------------------------------------

interface DestroyableKey {
  readonly deviceRecordId: string;
  readonly providerKeyReference: string;
  readonly publicKeyFingerprint: string;
  readonly keyGeneration: number;
  /** The real provider that holds the private half being destroyed. */
  readonly provider: DevelopmentReplacementKeyProvider;
  /** A trusted instant past every retention floor group 0137 computes. */
  readonly trustedNow: string;
}

/**
 * Produces a superseded provider key that `evaluate_key_destruction_eligibility_v1`
 * calls ELIGIBLE — without a single direct write.
 *
 * TWO rotations are required, and the reason is worth stating because it looks
 * like overkill. `register_generation_key_v1` (the enrollment path) leaves
 * `key_generation` NULL, and `device_key_destruction_requests.key_generation`
 * is NOT NULL — so the generation-1 key an enrolled device carries cannot be
 * named in a destruction request at all. Only `register_generation_key_v2`, the
 * rotation path, records a key generation. So the first rotation MINTS a key
 * that could be destroyed, and the second SUPERSEDES it — §5 refuses `active`
 * and `credential_issued_pending_activation` outright.
 *
 * Retirement then removes the last blocker: while the credential that key
 * signed is still `issued`, §5 blocks on REFERENCED_BY_ISSUED_CREDENTIAL, which
 * is the check that stops a working key being erased.
 *
 * Trusted time is a VALUE the caller supplies, so the retention floors are
 * crossed deterministically rather than by waiting 30 days.
 */
async function createDestroyableKey(client: pg.PoolClient, label: string): Promise<DestroyableKey> {
  const firstRotationAt = new Date();
  // The incumbent credential is issued so that 9 days remain: inside the
  // 10-day development renewal window `reserve_device_credential_renewal_v1`
  // enforces.
  const fixture = await createIncumbentFixture(client, {
    issuedAtTrustedTime: new Date(firstRotationAt.getTime() - 21 * MS_PER_DAY),
    label,
  });

  // Rotation stays DISABLED in the shipped policy; this NAMES a test decision
  // so the CHECK is satisfied honestly, and the transaction rolls it back.
  await enableDevelopmentRotation(client);
  const provider = new DevelopmentReplacementKeyProvider();

  const rotate = async (at: Date, suffix: string): Promise<void> => {
    const outcome = await completeRotateKeyCredentialRenewal(
      {
        deviceRecordId: fixture.deviceRecordId,
        environment: DEVELOPMENT,
        purpose: DEVICE_IDENTITY,
        idempotencyKey: `kd-${suffix}-${fixture.credentialId}`,
        actorRef: "KEY-DESTRUCTION-TEST",
        trustedTime: trustedAt(at),
        trustedRootFingerprints: [fixture.ca.rootCertificate.tbs.subjectFingerprint],
        currentAssignmentGeneration: fixture.assignmentGeneration,
      },
      pgIncumbentRepository(client),
      pgReservationGateway(client),
      pgRotationGateway(client),
      pgIssuanceGateway(client),
      fixture.ca,
      provider,
    );
    if (outcome.outcome !== "ROTATED") {
      throw new Error(
        `fixture rotation ${suffix} did not rotate: ${outcome.refusalCode ?? "?"} ${outcome.detail ?? ""}`,
      );
    }
  };

  // Rotation 1 mints key generation 2 inside the provider.
  await rotate(firstRotationAt, "r1");
  const target = await client.query<{
    key_handle: string;
    public_key_fingerprint: string;
    key_generation: number;
  }>(
    `select key_handle, public_key_fingerprint, key_generation
       from kitluy_devices.device_generation_keys
      where device_record_id = $1 and generation = 2`,
    [fixture.deviceRecordId],
  );
  const key = target.rows[0];
  if (key === undefined) throw new Error("rotation 1 registered no generation-2 key");

  // Rotation 2, 21 days later, supersedes it. Credential 2's window is 30 days
  // from rotation 1, so 9 days remain — the same window, crossed with a value.
  const secondRotationAt = new Date(firstRotationAt.getTime() + 21 * MS_PER_DAY);
  await rotate(secondRotationAt, "r2");

  // Retire credential 2 at its overlap boundary, so the key it signed is no
  // longer referenced by an `issued` credential.
  const head = await client.query<{ overlap_ends_at: Date }>(
    `select overlap_ends_at from kitluy_devices.device_credential_heads
      where device_record_id = $1 and environment = $2 and purpose = $3`,
    [fixture.deviceRecordId, DEVELOPMENT, DEVICE_IDENTITY],
  );
  const boundary = head.rows[0]?.overlap_ends_at ?? secondRotationAt;
  await withRole(client, TEST_ROLES.issuanceService, async () => {
    const retired = await client.query<{ result: Record<string, unknown> }>(
      `select kitluy_devices.retire_overlapped_credential_v1(
         $1::uuid,$2,$3,$4::timestamptz,'trusted','KEY-DESTRUCTION-TEST') as result`,
      [fixture.deviceRecordId, DEVELOPMENT, DEVICE_IDENTITY, boundary],
    );
    const outcome = String(retired.rows[0]?.result["outcome"] ?? "");
    if (outcome !== "RETIRED" && outcome !== "ALREADY_RETIRED") {
      throw new Error(`fixture retirement returned ${outcome}`);
    }
  });

  // §4 applies the recovery floor to BOTH bases, and treats a MISSING verified
  // terminal recovery as a blocker rather than a zero. One real reconciliation
  // record, written through the governed function, supplies it.
  const reservation = await client.query<{ renewal_attempt_id: string }>(
    `select renewal_attempt_id from kitluy_devices.device_renewal_reservations
      where device_record_id = $1 order by created_at limit 1`,
    [fixture.deviceRecordId],
  );
  await withRole(client, TEST_ROLES.issuanceService, async () => {
    await client.query(
      `select kitluy_devices.record_renewal_reconciliation_v1(
         $1::uuid,'CONSISTENT','CONSISTENT','CONSISTENT','NONE','NONE','NONE',null,
         'KEY-DESTRUCTION-TEST')`,
      [reservation.rows[0]?.renewal_attempt_id],
    );
  });

  return {
    deviceRecordId: fixture.deviceRecordId,
    providerKeyReference: key.key_handle,
    publicKeyFingerprint: key.public_key_fingerprint,
    keyGeneration: Number(key.key_generation),
    provider,
    // Past every §2/§3/§4 floor: 30 days after the overlap end, 14 days after
    // the recovery. A year clears all of them without inventing a clock.
    trustedNow: new Date(boundary.getTime() + 365 * MS_PER_DAY).toISOString(),
  };
}

/** The full §6 four-eyes ceremony, through the governed functions. */
async function requestAndApprove(
  gateway: KeyDestructionGateway,
  world: DestroyableKey,
  options: {
    readonly requestKey: string;
    readonly requestedBy: string;
    readonly approvedBy: string;
  },
): Promise<string> {
  const requested = await requestProviderKeyDestruction(gateway, {
    requestKey: options.requestKey,
    deviceRecordId: world.deviceRecordId,
    environment: DEVELOPMENT,
    purpose: DEVICE_IDENTITY,
    providerKeyReference: world.providerKeyReference,
    requestedBy: options.requestedBy,
    requestReason: "the superseded key passed every retention floor",
    reauthenticated: true,
    trustedNow: world.trustedNow,
    trustedTimeStatus: "trusted",
  });
  if (requested.detail !== "REQUESTED") {
    throw new Error(
      `the governed request refused: ${requested.refusalCode ?? "?"} ${requested.detail ?? ""}`,
    );
  }
  const id = String(requested.destructionRequestId);
  const approved = await approveProviderKeyDestruction(gateway, {
    destructionRequestId: id,
    approvedBy: options.approvedBy,
    approvalReason: "eligibility independently re-verified",
    reauthenticated: true,
    trustedNow: world.trustedNow,
    trustedTimeStatus: "trusted",
  });
  if (approved.detail !== "APPROVED") {
    throw new Error(
      `the governed approval refused: ${approved.refusalCode ?? "?"} ${approved.detail ?? ""}`,
    );
  }
  return id;
}

function executionInput(
  world: DestroyableKey,
  destructionRequestId: string,
  overrides: Partial<DestructionExecutionInput> = {},
): DestructionExecutionInput {
  return {
    destructionRequestId,
    executedBy: "worker:destruction",
    deviceRecordId: world.deviceRecordId,
    environment: DEVELOPMENT,
    purpose: DEVICE_IDENTITY,
    providerKeyReference: world.providerKeyReference,
    publicKeyFingerprint: world.publicKeyFingerprint,
    keyGeneration: world.keyGeneration,
    ...overrides,
  };
}

/**
 * The provider behind a TRANSPORT, which is where ambiguity actually comes
 * from.
 *
 * `DevelopmentReplacementKeyProvider` has no way to lose its own answer — it is
 * an in-process object — so an ambiguous outcome cannot be produced by the
 * provider alone. It is produced here by the thing that can genuinely fail in
 * production: the call. `reachesProvider` distinguishes the two shapes that
 * matter, and they are NOT the same failure:
 *
 *   false  the request never arrived; nothing was erased
 *   true   the key WAS erased and the answer was lost — the dangerous one
 *
 * Both must leave the database non-destroyed, which is the property under test.
 * The provider underneath is real, and so is every governed call around it.
 */
function ambiguousTransport(
  provider: DevelopmentReplacementKeyProvider,
  log: CallLog,
  options: {
    readonly reachesProvider: boolean;
    readonly classification: "TIMEOUT" | "CONNECTION_FAILED";
    /** Receipts the lost answer would have carried, kept so a retry can be compared. */
    readonly captured?: ProviderDestructionReceipt[];
  },
): ProviderKeyDestroyer {
  return {
    async destroyProviderKey(request: ProviderDestructionRequest) {
      // The DISPATCH happened, which is what makes the outcome unknown rather
      // than known-not-attempted. Whether it arrived is `reachesProvider`.
      log.push("provider");
      if (options.reachesProvider) {
        options.captured?.push(await provider.destroyProviderKey(request));
      }
      throw new ProviderDestructionAmbiguousError(
        request.providerKeyReference,
        options.classification,
        "the destruction call did not return an outcome",
      );
    },
  };
}

/** The real provider, with its calls recorded in the shared ordering log. */
function recordingProvider(
  provider: DevelopmentReplacementKeyProvider,
  log: CallLog,
): ProviderKeyDestroyer {
  return {
    async destroyProviderKey(
      request: ProviderDestructionRequest,
    ): Promise<ProviderDestructionReceipt> {
      log.push("provider");
      return provider.destroyProviderKey(request);
    },
  };
}

describe.skipIf(!reachable)("live governed provider-key destruction", () => {
  beforeAll(() => {
    expect(devDatabaseUrl()).toMatch(/127\.0\.0\.1|localhost/);
  });

  // =========================================================================
  // A. Vocabulary conformance — cheap, and it guards a defect that shipped
  // =========================================================================
  it("mirrors kitluy_devices.key_hold_type exactly", async () => {
    await withDatabaseTransaction(async (client) => {
      // The first version of `KeyHoldType` said "INCIDENT" | "LEGAL" | "AUDIT".
      // Every member was wrong: the labels are lower case, `AUDIT` is really
      // `audit_preservation`, and `regulatory` was missing outright — so a
      // regulatory hold, which §8 says suspends eligibility, execution,
      // approval use and retry, could not be NAMED from TypeScript at all.
      // `src/key-destruction.ts` says in so many words that this check did not
      // exist and that the values were a transcription. This is that check.
      const enumLabels = await client.query<{ label: string }>(
        `select e.enumlabel as label
           from pg_enum e
           join pg_type t on t.oid = e.enumtypid
           join pg_namespace n on n.oid = t.typnamespace
          where n.nspname = 'kitluy_devices' and t.typname = 'key_hold_type'
          order by e.enumsortorder`,
      );
      const fromDatabase = enumLabels.rows.map((r) => r.label);
      expect(fromDatabase.length).toBeGreaterThan(0);
      expect([...KEY_HOLD_TYPES].sort()).toEqual([...fromDatabase].sort());
      // Spelling and case, not just membership: a case-insensitive comparison
      // would have passed for "INCIDENT" and the enum cast would still refuse.
      for (const label of fromDatabase) {
        expect(KEY_HOLD_TYPES).toContain(label);
      }
    });
  }, 60_000);

  it("mirrors the attempt budget the policy actually enforces", async () => {
    await withDatabaseTransaction(async (client) => {
      // `MAX_DESTRUCTION_EXECUTION_ATTEMPTS` is exported as DATA so a worker
      // cannot invent its own budget. If the number drifts from §13's, a worker
      // would either give up early or keep calling an irreversible operation
      // after the database stopped permitting it.
      const policy = await client.query<{ maximum_execution_attempts: number }>(
        `select maximum_execution_attempts from kitluy_devices.key_destruction_policy
          where environment = $1`,
        [DEVELOPMENT],
      );
      expect(Number(policy.rows[0]?.maximum_execution_attempts)).toBe(
        MAX_DESTRUCTION_EXECUTION_ATTEMPTS,
      );
    });
  }, 60_000);

  // =========================================================================
  // C. Ordering and success
  // =========================================================================
  it("calls the provider BEFORE the database confirms, and records the receipt", async () => {
    await withDatabaseTransaction(async (client) => {
      const world = await createDestroyableKey(client, "KDOK");
      const log: CallLog = [];
      const gateway = pgKeyDestructionGateway(client, log);

      const requestId = await requestAndApprove(gateway, world, {
        requestKey: `kd-ok-${randomUUID()}`,
        requestedBy: "operator:alice",
        approvedBy: "operator:bob",
      });

      log.length = 0;
      const outcome = await executeProviderKeyDestruction(
        gateway,
        recordingProvider(world.provider, log),
        executionInput(world, requestId),
      );

      expect(outcome.outcome).toBe("DESTROYED");
      // THE ORDER IS THE CONTROL. `confirm` after `provider` is the whole of
      // §12; the reverse order would record a destruction nobody evidenced.
      expect(log).toEqual(["begin", "provider", "confirm"]);
      expect(world.provider.destructionCount).toBe(1);

      const row = await readRequest(client, requestId);
      expect(row.status).toBe("executed");
      expect(row.providerResult).toBe("DESTROYED");
      expect(row.providerReceiptDigest).toBe(outcome.providerReceiptDigest);
      expect(row.providerResponseRef).toBe(outcome.providerResponseRef);
      expect(row.databaseConfirmedAt).not.toBeNull();
      expect(row.providerConfirmedAt).not.toBeNull();

      // And ONLY NOW is the key destroyed.
      const key = await keyIsDestroyed(client, world.deviceRecordId, world.providerKeyReference);
      expect(key.state).toBe("destroyed");
      expect(key.destroyedAt).not.toBeNull();

      // Every governed call ran as the EXECUTOR.
      expect(gateway.rolesObserved.length).toBeGreaterThan(0);
      expect(gateway.rolesObserved.every((r) => r === TEST_ROLES.issuanceService)).toBe(true);

      // ---- no private key material anywhere it could have leaked ----------
      // The receipt is built from PUBLIC bindings and an instant, and it
      // OUTLIVES the key it attests to, so a receipt that carried material
      // would be a permanent copy of a key everyone believes is gone.
      const evidence = await storedEvidenceJson(client, world.deviceRecordId);
      for (const serialized of [JSON.stringify(outcome), evidence]) {
        expect(serialized).not.toMatch(/PRIVATE KEY/i);
        expect(serialized).not.toContain("BEGIN");
        expect(serialized).not.toMatch(/postgres(ql)?:\/\//);
      }
      // A sha-256 hex digest and a correlatable reference — nothing else.
      expect(outcome.providerReceiptDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(outcome.providerResponseRef).toBe(`dev-destruction:${requestId}`);
    });
  }, 180_000);

  // =========================================================================
  // B. Refusals — every one leaves the database NON-DESTROYED
  // =========================================================================
  it("refuses execution with no approval, and never calls the provider", async () => {
    await withDatabaseTransaction(async (client) => {
      const world = await createDestroyableKey(client, "KDNOAPP");
      const log: CallLog = [];
      const gateway = pgKeyDestructionGateway(client, log);

      const requested = await requestProviderKeyDestruction(gateway, {
        requestKey: `kd-noapproval-${randomUUID()}`,
        deviceRecordId: world.deviceRecordId,
        environment: DEVELOPMENT,
        purpose: DEVICE_IDENTITY,
        providerKeyReference: world.providerKeyReference,
        requestedBy: "operator:alice",
        requestReason: "the superseded key passed every retention floor",
        reauthenticated: true,
        trustedNow: world.trustedNow,
        trustedTimeStatus: "trusted",
      });
      expect(requested.detail).toBe("REQUESTED");
      const requestId = String(requested.destructionRequestId);

      log.length = 0;
      const outcome = await executeProviderKeyDestruction(
        gateway,
        recordingProvider(world.provider, log),
        executionInput(world, requestId),
      );

      expect(outcome.outcome).toBe("DESTRUCTION_REFUSED");
      expect(outcome.refusalCode).toBe("KLUY-KEYDESTROY-NOT-APPROVED");
      // The provider is the only party that can actually erase. It was never
      // asked, so nothing could have been erased even if the database were
      // wrong about the rest.
      expect(log).toEqual(["begin"]);
      expect(world.provider.destructionCount).toBe(0);

      const row = await readRequest(client, requestId);
      expect(row.status).toBe("requested");
      expect(row.approvedBy).toBeNull();
      // A refused attempt is not an attempt: the budget was not spent either.
      expect(row.attemptCount).toBe(0);
      expect(row.databaseConfirmedAt).toBeNull();
      expect(row.providerResult).toBeNull();
      expect(await readAttempts(client, requestId)).toEqual([]);

      const key = await keyIsDestroyed(client, world.deviceRecordId, world.providerKeyReference);
      expect(key).toEqual({ state: "superseded", destroyedAt: null });
    });
  }, 180_000);

  it("refuses self-approval in the DATABASE, not only in the service", async () => {
    await withDatabaseTransaction(async (client) => {
      const world = await createDestroyableKey(client, "KDSELF");
      const log: CallLog = [];
      const gateway = pgKeyDestructionGateway(client, log);
      const requestKey = `kd-self-${randomUUID()}`;

      const requested = await requestProviderKeyDestruction(gateway, {
        requestKey,
        deviceRecordId: world.deviceRecordId,
        environment: DEVELOPMENT,
        purpose: DEVICE_IDENTITY,
        providerKeyReference: world.providerKeyReference,
        requestedBy: "operator:alice",
        requestReason: "the superseded key passed every retention floor",
        reauthenticated: true,
        trustedNow: world.trustedNow,
        trustedTimeStatus: "trusted",
      });
      const requestId = String(requested.destructionRequestId);

      // STRAIGHT AT THE GOVERNED FUNCTION, bypassing the service's pre-check.
      // The service refuses self-approval too, but only when a caller chose to
      // tell it who requested — the database is the only party that KNOWS.
      const raw = await gateway.approveKeyDestruction({
        destructionRequestId: requestId,
        approvedBy: "operator:alice",
        approvalReason: "I am satisfied with my own work",
        reauthenticated: true,
        trustedNow: world.trustedNow,
        trustedTimeStatus: "trusted",
      });
      expect(raw["outcome"]).toBe("APPROVAL_REFUSED");
      expect(raw["refusal_code"]).toBe("KLUY-KEYDESTROY-SELF-APPROVED");

      // The service's own belt-and-braces refusal, for completeness.
      const viaService = await approveProviderKeyDestruction(
        gateway,
        {
          destructionRequestId: requestId,
          approvedBy: "operator:alice",
          approvalReason: "I am satisfied with my own work",
          reauthenticated: true,
          trustedNow: world.trustedNow,
          trustedTimeStatus: "trusted",
        },
        "operator:alice",
      );
      expect(viaService.refusalCode).toBe("DESTRUCTION_SELF_APPROVED");

      // And the executor cannot write the approval by hand. §6's four-eyes
      // CHECK is a constraint, but the executor never gets close enough to
      // meet it: group 0137 withholds UPDATE on the table entirely.
      await withRole(client, TEST_ROLES.issuanceService, async () => {
        expect(await currentRole(client)).toBe(TEST_ROLES.issuanceService);
        const refused = await expectRefused(client, () =>
          client.query(
            `update kitluy_devices.device_key_destruction_requests
                set approved_by = 'operator:alice', approved_at = now(),
                    approval_expires_at = now() + interval '24 hours',
                    approver_reauthenticated = true, status = 'approved'
              where destruction_request_id = $1`,
            [requestId],
          ),
        );
        expect(refused).toMatch(/permission denied/);
      });

      const row = await readRequest(client, requestId);
      expect(row.status).toBe("requested");
      expect(row.approvedBy).toBeNull();

      // With no valid approval there is nothing to execute.
      log.length = 0;
      const outcome = await executeProviderKeyDestruction(
        gateway,
        recordingProvider(world.provider, log),
        executionInput(world, requestId),
      );
      expect(outcome.outcome).toBe("DESTRUCTION_REFUSED");
      expect(log).toEqual(["begin"]);
      expect(world.provider.destructionCount).toBe(0);
      expect(
        await keyIsDestroyed(client, world.deviceRecordId, world.providerKeyReference),
      ).toEqual({ state: "superseded", destroyedAt: null });
    });
  }, 180_000);

  it("lets every hold type block execution, and a release never resurrects the approval", async () => {
    await withDatabaseTransaction(async (client) => {
      const world = await createDestroyableKey(client, "KDHOLD");
      const log: CallLog = [];
      const gateway = pgKeyDestructionGateway(client, log);

      // All FOUR, driven from the exported vocabulary rather than a literal
      // list, so a hold type added to the enum without a TypeScript member is
      // caught by the conformance test above and exercised here.
      for (const holdType of KEY_HOLD_TYPES) {
        const requestId = await requestAndApprove(gateway, world, {
          requestKey: `kd-hold-${holdType}-${randomUUID()}`,
          requestedBy: "operator:alice",
          approvedBy: "operator:bob",
        });
        expect((await readRequest(client, requestId)).status).toBe("approved");

        const holdId = await placeHold(client, {
          holdType,
          deviceRecordId: world.deviceRecordId,
          providerKeyReference: world.providerKeyReference,
          declaredBy: "security:carol",
        });

        // §8: the hold SUSPENDS the approval already granted. It does not
        // merely prevent the next one.
        const held = await readRequest(client, requestId);
        expect(held.status).toBe("manual_review");
        expect(held.manualReviewReason).toContain(holdType);

        log.length = 0;
        const blocked = await executeProviderKeyDestruction(
          gateway,
          recordingProvider(world.provider, log),
          executionInput(world, requestId),
        );
        expect(blocked.outcome).toBe("DESTRUCTION_REFUSED");
        // NOT `KLUY-KEYDESTROY-HOLD-ACTIVE`, and that is worth stating rather
        // than papering over. `place_key_hold_v1` suspends the request to
        // `manual_review` before `begin_key_destruction_execution_v1` ever
        // reaches its hold check, so the hold branch of `begin` is unreachable
        // through the only function that can place a hold. The refusal is the
        // right one — nothing executes — but a reader chasing the hold code
        // path would otherwise never find out it is dead. Recorded, not fixed:
        // this suite does not edit migrations.
        expect(blocked.refusalCode).toBe("KLUY-KEYDESTROY-NOT-APPROVED");
        expect(log).toEqual(["begin"]);
        expect(world.provider.destructionCount).toBe(0);
        expect(
          await keyIsDestroyed(client, world.deviceRecordId, world.providerKeyReference),
        ).toEqual({ state: "superseded", destroyedAt: null });

        // §8: a hold is released by someone OTHER than its declarer.
        const selfRelease = await releaseHold(client, holdId, "security:carol");
        expect(selfRelease["outcome"]).toBe("RELEASE_REFUSED");
        expect(selfRelease["refusal_code"]).toBe("KLUY-KEYHOLD-SELF-RELEASE");

        const released = await releaseHold(client, holdId, "security:dan");
        expect(released["outcome"]).toBe("RELEASED");

        // KLREQ-031 §8, the part that is easy to get wrong: releasing the hold
        // does NOT resume the prior approval. The approval RECORD survives —
        // an audit trail that erased who approved what would be worse — but
        // the request stays in manual review and execution stays refused.
        const afterRelease = await readRequest(client, requestId);
        expect(afterRelease.status).toBe("manual_review");
        expect(afterRelease.approvedBy).toBe("operator:bob");

        log.length = 0;
        const stillBlocked = await executeProviderKeyDestruction(
          gateway,
          recordingProvider(world.provider, log),
          executionInput(world, requestId),
        );
        expect(stillBlocked.outcome).toBe("DESTRUCTION_REFUSED");
        expect(stillBlocked.refusalCode).toBe("KLUY-KEYDESTROY-NOT-APPROVED");
        expect(log).toEqual(["begin"]);
        expect(world.provider.destructionCount).toBe(0);
        expect(
          await keyIsDestroyed(client, world.deviceRecordId, world.providerKeyReference),
        ).toEqual({ state: "superseded", destroyedAt: null });
      }
    });
  }, 300_000);

  it("a legal hold is REPORTED as a blocker, not raised as an array error (group 0143)", async () => {
    await withDatabaseTransaction(async (client) => {
      const world = await createDestroyableKey(client, "KDBLOCKER");
      const log: CallLog = [];
      const gateway = pgKeyDestructionGateway(client, log);

      // The key IS eligible, and the governed evaluation says so.
      const clean = await gateway.evaluateEligibility({
        deviceRecordId: world.deviceRecordId,
        environment: DEVELOPMENT,
        providerKeyReference: world.providerKeyReference,
        trustedNow: world.trustedNow,
        trustedTimeStatus: "trusted",
      });
      expect(clean["eligible"]).toBe(true);
      // ELIGIBLE IS NOT AUTHORIZED (§6). The evaluation never claims otherwise.
      expect(clean["authorized"]).toBe(false);
      expect(clean["blockers"]).toEqual([]);
      expect(clean["retention_basis"]).toBe("superseded");

      await placeHold(client, {
        holdType: "legal",
        deviceRecordId: world.deviceRecordId,
        providerKeyReference: world.providerKeyReference,
        declaredBy: "security:carol",
      });

      // ===================================================================
      // WHAT GROUP 0143 FIXED, asserted as the behaviour it now must have
      // ===================================================================
      // Group 0137 accumulated blockers with
      //   v_blockers := v_blockers || 'HOLD_ACTIVE';
      // where `v_blockers` is `text[]` and the literal is UNKNOWN. PostgreSQL
      // resolves that `||` to `anyarray || anyarray` rather than `anyarray ||
      // anyelement`, tries to parse "HOLD_ACTIVE" as an array literal, and
      // raises 22P02. Seven blockers were affected —
      // REFERENCED_BY_ISSUED_CREDENTIAL, UNFINISHED_RENEWAL,
      // OVERLAP_END_UNKNOWN, ABANDONED_AT_UNKNOWN,
      // NO_VERIFIED_TERMINAL_RECOVERY, HOLD_ACTIVE and RETENTION_NOT_ELAPSED.
      // `format('KEY_STATE_%s', ...)` was not, because `format` returns a
      // typed `text`.
      //
      // It always FAILED CLOSED, so no key was ever wrongly destroyed. What was
      // lost was the ANSWER: an operator asking why a key could not be
      // destroyed got an array-syntax error instead of "HOLD_ACTIVE". Group
      // 0143 adds the seven `::text` casts. This test is the regression guard —
      // if a future definition drops a cast, the blocker list stops arriving
      // and this fails.
      const blocked = await gateway.evaluateEligibility({
        deviceRecordId: world.deviceRecordId,
        environment: DEVELOPMENT,
        providerKeyReference: world.providerKeyReference,
        trustedNow: world.trustedNow,
        trustedTimeStatus: "trusted",
      });
      expect(blocked["eligible"]).toBe(false);
      expect(blocked["authorized"]).toBe(false);
      // The blocker is NAMED, which is the whole point of the fix.
      expect(blocked["blockers"]).toContain("HOLD_ACTIVE");

      // A NEW destruction request goes through the same evaluation, so it is
      // refused too — and now refused legibly rather than aborting.
      const requestWhileHeld = await gateway.requestKeyDestruction({
        requestKey: `kd-blocked-${randomUUID()}`,
        deviceRecordId: world.deviceRecordId,
        environment: DEVELOPMENT,
        purpose: DEVICE_IDENTITY,
        providerKeyReference: world.providerKeyReference,
        requestedBy: "operator:alice",
        requestReason: "a request made while a legal hold stands",
        reauthenticated: true,
        trustedNow: world.trustedNow,
        trustedTimeStatus: "trusted",
      });
      expect(requestWhileHeld["outcome"]).not.toBe("REQUESTED");

      // FAIL CLOSED is the property that matters: no request row was created,
      // and no key was destroyed.
      const requests = await client.query(
        `select count(*) n from kitluy_devices.device_key_destruction_requests
          where device_record_id = $1`,
        [world.deviceRecordId],
      );
      expect(Number(requests.rows[0].n)).toBe(0);
      expect(
        await keyIsDestroyed(client, world.deviceRecordId, world.providerKeyReference),
      ).toEqual({ state: "superseded", destroyedAt: null });
    });
  }, 180_000);

  it("stops at the attempt ceiling and routes to manual review", async () => {
    await withDatabaseTransaction(async (client) => {
      const world = await createDestroyableKey(client, "KDATT");
      const log: CallLog = [];
      const gateway = pgKeyDestructionGateway(client, log);
      const requestId = await requestAndApprove(gateway, world, {
        requestKey: `kd-attempts-${randomUUID()}`,
        requestedBy: "operator:alice",
        approvedBy: "operator:bob",
      });

      // Claim the right to call the provider, MAX times, without ever calling
      // it — the shape of a worker that keeps crashing after `begin`.
      for (let attempt = 1; attempt <= MAX_DESTRUCTION_EXECUTION_ATTEMPTS; attempt += 1) {
        const begun = await gateway.beginKeyDestructionExecution({
          destructionRequestId: requestId,
          executedBy: `worker:${attempt}`,
        });
        expect(begun["outcome"]).toBe("EXECUTION_CLEARED");
        expect(begun["attempt_number"]).toBe(attempt);
      }

      log.length = 0;
      const exhausted = await executeProviderKeyDestruction(
        gateway,
        recordingProvider(world.provider, log),
        executionInput(world, requestId),
      );
      // §13: running out of patience is not evidence of anything. The budget
      // expiring is a manual-review trigger, never a destruction.
      expect(exhausted.outcome).toBe("DESTRUCTION_REFUSED");
      expect(exhausted.refusalCode).toBe("KLUY-KEYDESTROY-ATTEMPTS-EXHAUSTED");
      expect(log).toEqual(["begin"]);
      expect(world.provider.destructionCount).toBe(0);

      const row = await readRequest(client, requestId);
      expect(row.status).toBe("manual_review");
      expect(row.attemptCount).toBe(MAX_DESTRUCTION_EXECUTION_ATTEMPTS);
      expect(row.databaseConfirmedAt).toBeNull();
      expect(
        await keyIsDestroyed(client, world.deviceRecordId, world.providerKeyReference),
      ).toEqual({ state: "superseded", destroyedAt: null });
    });
  }, 180_000);

  it("refuses a provider result that is not a destruction, and routes to manual review", async () => {
    await withDatabaseTransaction(async (client) => {
      const world = await createDestroyableKey(client, "KDBADRESULT");
      const log: CallLog = [];
      const gateway = pgKeyDestructionGateway(client, log);
      const requestId = await requestAndApprove(gateway, world, {
        requestKey: `kd-badresult-${randomUUID()}`,
        requestedBy: "operator:alice",
        approvedBy: "operator:bob",
      });
      const begun = await gateway.beginKeyDestructionExecution({
        destructionRequestId: requestId,
        executedBy: "worker:destruction",
      });
      expect(begun["outcome"]).toBe("EXECUTION_CLEARED");

      const digest = "a".repeat(64);
      // ABSENCE IS NOT ERASURE. `NOT_FOUND` is the exact answer a caller is
      // most tempted to treat as success — the key is not there, so surely it
      // is gone — and it is the one that would leave a live private key behind
      // a row saying it was destroyed.
      const notFound = await gateway.confirmKeyDestruction({
        destructionRequestId: requestId,
        providerResult: "NOT_FOUND",
        providerReceiptDigest: digest,
        providerResponseRef: `dev-destruction:${requestId}`,
        observedFingerprint: world.publicKeyFingerprint,
        observedKeyReference: world.providerKeyReference,
        executedBy: "worker:destruction",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      });
      expect(notFound["outcome"]).toBe("MANUAL_REVIEW_REQUIRED");
      expect(String(notFound["detail"])).toContain("NOT_FOUND");

      let row = await readRequest(client, requestId);
      expect(row.status).toBe("manual_review");
      expect(row.lastFailureCode).toBe("PROVIDER_EVIDENCE_INSUFFICIENT");
      expect(row.providerResult).toBeNull();
      expect(row.databaseConfirmedAt).toBeNull();
      expect(
        await keyIsDestroyed(client, world.deviceRecordId, world.providerKeyReference),
      ).toEqual({ state: "superseded", destroyedAt: null });

      // A receipt about a DIFFERENT key is a divergence, never a success —
      // even when it says `DESTROYED`.
      const wrongKey = await gateway.confirmKeyDestruction({
        destructionRequestId: requestId,
        providerResult: "DESTROYED",
        providerReceiptDigest: digest,
        providerResponseRef: `dev-destruction:${requestId}`,
        observedFingerprint: "f".repeat(64),
        observedKeyReference: world.providerKeyReference,
        executedBy: "worker:destruction",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      });
      expect(wrongKey["outcome"]).toBe("MANUAL_REVIEW_REQUIRED");
      expect(String(wrongKey["detail"])).toContain("fingerprint");

      row = await readRequest(client, requestId);
      expect(row.databaseConfirmedAt).toBeNull();
      expect(
        await keyIsDestroyed(client, world.deviceRecordId, world.providerKeyReference),
      ).toEqual({ state: "superseded", destroyedAt: null });

      // The append-only attempt history kept BOTH, with why each was refused.
      const attempts = await readAttempts(client, requestId);
      expect(attempts.map((a) => a.outcome)).toEqual(["REVIEW", "REVIEW"]);
      expect(attempts[0]?.failureCode).toContain("NOT_FOUND");
      expect(attempts[1]?.failureCode).toContain("fingerprint");
      expect(log).not.toContain("provider");
    });
  }, 180_000);

  it("treats an ambiguous provider outcome as reconciliation, never as destruction", async () => {
    await withDatabaseTransaction(async (client) => {
      const world = await createDestroyableKey(client, "KDAMBIG");
      const log: CallLog = [];
      const gateway = pgKeyDestructionGateway(client, log);
      const requestId = await requestAndApprove(gateway, world, {
        requestKey: `kd-ambiguous-${randomUUID()}`,
        requestedBy: "operator:alice",
        approvedBy: "operator:bob",
      });

      // ---- the call never arrived -----------------------------------------
      log.length = 0;
      const unreached = await executeProviderKeyDestruction(
        gateway,
        ambiguousTransport(world.provider, log, {
          reachesProvider: false,
          classification: "CONNECTION_FAILED",
        }),
        executionInput(world, requestId),
      );
      expect(unreached.outcome).toBe("RECONCILIATION_REQUIRED");
      expect(unreached.refusalCode).toBe("DESTRUCTION_PROVIDER_AMBIGUOUS");
      expect(unreached.errorClassification).toBe("CONNECTION_FAILED");
      // CONFIRM WAS NEVER CALLED. That is the assertion; the outcome word is
      // just this module's report of it.
      expect(log).toEqual(["begin", "provider"]);
      expect(world.provider.destructionCount).toBe(0);
      expect(await readAttempts(client, requestId)).toEqual([]);
      expect(
        await keyIsDestroyed(client, world.deviceRecordId, world.providerKeyReference),
      ).toEqual({ state: "superseded", destroyedAt: null });

      // ---- the key WAS erased and the answer was lost ----------------------
      // The dangerous shape: the provider really did destroy, and nobody knows.
      // The database must still say non-destroyed, because a row claiming
      // destruction nobody can evidence is worse than no row at all.
      const captured: ProviderDestructionReceipt[] = [];
      log.length = 0;
      const lost = await executeProviderKeyDestruction(
        gateway,
        ambiguousTransport(world.provider, log, {
          reachesProvider: true,
          classification: "TIMEOUT",
          captured,
        }),
        executionInput(world, requestId),
      );
      expect(lost.outcome).toBe("RECONCILIATION_REQUIRED");
      expect(lost.errorClassification).toBe("TIMEOUT");
      expect(log).toEqual(["begin", "provider"]);
      expect(world.provider.destructionCount).toBe(1);
      expect(captured[0]?.result).toBe("DESTROYED");

      const diverged = await readRequest(client, requestId);
      expect(diverged.status).toBe("pending_execution");
      expect(diverged.databaseConfirmedAt).toBeNull();
      expect(diverged.providerResult).toBeNull();
      expect(await readAttempts(client, requestId)).toEqual([]);
      expect(
        await keyIsDestroyed(client, world.deviceRecordId, world.providerKeyReference),
      ).toEqual({ state: "superseded", destroyedAt: null });

      // ---- reconciliation: ask again, and get the FIRST receipt back -------
      // KLREQ-031 accepts `ALREADY_DESTROYED` only "with matching prior
      // evidence", so the retry must carry the receipt the FIRST destruction
      // produced rather than a fresh assertion about a key that no longer
      // exists to be re-destroyed.
      log.length = 0;
      const reconciled = await executeProviderKeyDestruction(
        gateway,
        recordingProvider(world.provider, log),
        executionInput(world, requestId),
      );
      expect(reconciled.outcome).toBe("DESTROYED");
      expect(reconciled.providerResult).toBe("ALREADY_DESTROYED");
      expect(reconciled.providerReceiptDigest).toBe(captured[0]?.receiptDigest);
      expect(log).toEqual(["begin", "provider", "confirm"]);
      // ERASED EXACTLY ONCE, across three attempts.
      expect(world.provider.destructionCount).toBe(1);

      const settled = await readRequest(client, requestId);
      expect(settled.status).toBe("executed");
      expect(settled.providerResult).toBe("ALREADY_DESTROYED");
      expect(settled.providerReceiptDigest).toBe(captured[0]?.receiptDigest);
      expect(settled.attemptCount).toBe(3);
      expect(
        await keyIsDestroyed(client, world.deviceRecordId, world.providerKeyReference),
      ).toEqual(expect.objectContaining({ state: "destroyed" }));

      // ---- and a plain replay changes nothing ------------------------------
      log.length = 0;
      const replay = await executeProviderKeyDestruction(
        gateway,
        recordingProvider(world.provider, log),
        executionInput(world, requestId),
      );
      expect(replay.outcome).toBe("DESTRUCTION_REFUSED");
      expect(replay.detail).toBe("ALREADY_EXECUTED");
      expect(log).toEqual(["begin"]);
      expect(world.provider.destructionCount).toBe(1);
      expect((await readRequest(client, requestId)).attemptCount).toBe(3);
    });
  }, 300_000);

  it("fails closed at the provider when a binding changed, and never reaches confirm", async () => {
    await withDatabaseTransaction(async (client) => {
      const world = await createDestroyableKey(client, "KDBIND");
      const log: CallLog = [];
      const gateway = pgKeyDestructionGateway(client, log);
      const requestId = await requestAndApprove(gateway, world, {
        requestKey: `kd-binding-${randomUUID()}`,
        requestedBy: "operator:alice",
        approvedBy: "operator:bob",
      });

      // The three ways a destruction could name a key other than the one that
      // was approved. Erasing the wrong private key is not recoverable, so
      // each one refuses at the provider — before anything is erased.
      const mutations: ReadonlyArray<{
        readonly what: string;
        readonly override: Partial<DestructionExecutionInput>;
        readonly expected: string;
      }> = [
        {
          what: "a changed provider reference",
          override: { providerKeyReference: "dev-replacement:no-such-key" },
          expected: "PROVIDER_KEY_NOT_FOUND",
        },
        {
          what: "a changed fingerprint",
          override: { publicKeyFingerprint: "b".repeat(64) },
          expected: "PROVIDER_KEY_FINGERPRINT_MISMATCH",
        },
        {
          what: "a changed key generation",
          override: { keyGeneration: world.keyGeneration + 1 },
          expected: "PROVIDER_KEY_WRONG_GENERATION",
        },
      ];

      for (const mutation of mutations) {
        log.length = 0;
        const outcome = await executeProviderKeyDestruction(
          gateway,
          recordingProvider(world.provider, log),
          executionInput(world, requestId, mutation.override),
        );
        expect(outcome.outcome, mutation.what).toBe("DESTRUCTION_REFUSED");
        expect(outcome.refusalCode, mutation.what).toBe("DESTRUCTION_PROVIDER_BINDING_CHANGED");
        expect(outcome.errorClassification, mutation.what).toBe(mutation.expected);
        expect(log, mutation.what).toEqual(["begin", "provider"]);
        expect(world.provider.destructionCount, mutation.what).toBe(0);
        expect(
          await keyIsDestroyed(client, world.deviceRecordId, world.providerKeyReference),
        ).toEqual({ state: "superseded", destroyedAt: null });
        expect((await readRequest(client, requestId)).databaseConfirmedAt).toBeNull();
        expect(await readAttempts(client, requestId)).toEqual([]);
      }

      // The refusals were about the BINDINGS, not about a broken request: the
      // same request, with the bindings the database actually holds, proceeds.
      // Without this the three refusals above would also pass if the request
      // had simply been unusable.
      log.length = 0;
      const correct = await executeProviderKeyDestruction(
        gateway,
        recordingProvider(world.provider, log),
        executionInput(world, requestId),
      );
      expect(correct.outcome).toBe("DESTROYED");
      expect(log).toEqual(["begin", "provider", "confirm"]);
      expect(world.provider.destructionCount).toBe(1);
      expect((await readRequest(client, requestId)).attemptCount).toBe(4);
    });
  }, 300_000);
});

describe("integration reporting", () => {
  it("states plainly whether the live destruction suite ran", () => {
    if (!reachable) {
      console.warn(`${SUITE} DID NOT RUN — no database evidence for governed key destruction.`);
    }
    expect(typeof reachable).toBe("boolean");
  });
});
