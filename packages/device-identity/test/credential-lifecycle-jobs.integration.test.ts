/**
 * Durable job runtime — LIVE PostgreSQL.
 *
 * Every governed call runs under `SET LOCAL ROLE kitluy_worker_service` or
 * `kitluy_issuance_service`, never under inherited `postgres` privileges:
 * `postgres` inherits `service_role`, and a boundary test that leans on that
 * passes while the boundary is broken.
 *
 * TWO REAL CONNECTIONS are used for the concurrency scenarios. Two workers
 * sharing one `pg` client is not concurrency — interleaved queries share a
 * transaction and corrupt each other — so those tests open genuinely separate
 * connections, COMMIT, and clean up explicitly. Everything else keeps the
 * rolled-back-transaction isolation the other suites use.
 *
 * WHAT THIS SUITE CANNOT PROVE. The development key provider is in memory, so a
 * "restarted" worker is handed the same provider instance. PostgreSQL state IS
 * durable and is re-read on every path below. Provider durability across a real
 * process restart remains unproven and is labelled here rather than hidden.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import type pg from "pg";

import {
  isDevDatabaseReachable,
  reportSkippedIntegration,
  requireDevDatabase,
  withDatabaseClient,
  withDatabaseTransaction,
} from "./support/dev-database.js";
import {
  createIncumbentFixture,
  pgIncumbentRepository,
  pgIssuanceGateway,
  pgLifecycleGateway,
  pgLifecycleReader,
  pgReservationGateway,
} from "./support/renewal-fixtures.js";
import {
  expireLease,
  fixedClock,
  fixedJitter,
  makeDueNow,
  newLease,
  pgJobGateway,
  purgeLeftoverTestJobs,
  purgeTestJobs,
  readJob,
  readJobAttempts,
  testWorkerIdentity,
  withTwoDatabaseClients,
} from "./support/job-fixtures.js";
import { completeSameKeyCredentialRenewal } from "../src/same-key-renewal-issuance.js";
import {
  CREDENTIAL_LIFECYCLE_JOB_KIND,
  KEY_CLEANUP_EVALUATE_JOB_KIND,
  credentialLifecycleDedupeKey,
  credentialLifecycleHandler,
  keyCleanupEvaluateHandler,
} from "../src/credential-lifecycle-jobs.js";
import {
  evaluateKeyDestruction,
  type KeyDestructionApproval,
} from "../src/credential-lifecycle.js";
import { runDurableJobs, backoffSeconds } from "@kitluy/job-contracts";
import type { TrustedTimeEvaluation } from "../src/trusted-time.js";

const DEVELOPMENT = "development";
const DEVICE_IDENTITY = "device_identity";
const MS_PER_DAY = 86_400_000;
/** The decision that closed KLREQ-031 and enabled the policy (0137 §15). */
const DECISION_REF = "KLD-2026-07-29-DEVICE-KEY-DESTRUCTION-001";

let reachable = false;
/** Counted so a skip can never be reported as a pass. */
let executed = 0;

beforeAll(async () => {
  reachable = await isDevDatabaseReachable();
  if (!reachable) reportSkippedIntegration("credential-lifecycle-jobs.integration");
  else {
    await requireDevDatabase();
    // A previous run that failed before its cleanup leaves claimable rows
    // behind. Start from a known-empty test namespace so a failure reproduces
    // here rather than surfacing in an unrelated test next time.
    await withDatabaseClient(purgeLeftoverTestJobs);
  }
});

const live = it;

const trustedAt = (instant: Date): TrustedTimeEvaluation => ({
  status: "trusted",
  trustedTime: instant,
  source: "authenticated_network",
  floorAdvanced: true,
  anomalyType: null,
  detail: "job fixture",
});

/** Matches the lifecycle suite's 30-day certificate window. */
const issuedSoThat = (daysRemaining: number): Date =>
  new Date(Date.now() - (30 - daysRemaining) * MS_PER_DAY);

async function overlapEnd(client: pg.PoolClient, deviceRecordId: string): Promise<Date> {
  const { rows } = await client.query(
    `select overlap_ends_at from kitluy_devices.device_credential_heads
      where device_record_id = $1`,
    [deviceRecordId],
  );
  return new Date(rows[0].overlap_ends_at);
}

async function headVersion(client: pg.PoolClient, deviceRecordId: string): Promise<string> {
  const { rows } = await client.query(
    `select version from kitluy_devices.device_credential_heads where device_record_id = $1`,
    [deviceRecordId],
  );
  return String(rows[0].version);
}

async function credentialStates(client: pg.PoolClient, deviceRecordId: string): Promise<string> {
  const { rows } = await client.query(
    `select state::text as state, certificate_generation
       from kitluy_devices.device_credentials
      where device_record_id = $1 order by certificate_generation`,
    [deviceRecordId],
  );
  return rows.map((r) => `${r.state}:${r.certificate_generation}`).join(",");
}

async function destroyedKeyCount(client: pg.PoolClient, deviceRecordId: string): Promise<number> {
  const { rows } = await client.query(
    `select count(*)::int as n from kitluy_devices.device_generation_keys
      where device_record_id = $1 and (state = 'destroyed' or destroyed_at is not null)`,
    [deviceRecordId],
  );
  return rows[0].n as number;
}

/** A device carrying a live overlap, built entirely through the governed path. */
async function seedRenewedDevice(client: pg.PoolClient, label: string) {
  const fixture = await createIncumbentFixture(client, {
    issuedAtTrustedTime: issuedSoThat(9),
    label,
  });
  const renewal = await completeSameKeyCredentialRenewal(
    {
      deviceRecordId: fixture.deviceRecordId,
      environment: DEVELOPMENT,
      purpose: DEVICE_IDENTITY,
      idempotencyKey: `jobs-${fixture.credentialId}`,
      actorRef: "JOBS-TEST",
      trustedTime: trustedAt(new Date()),
      trustedRootFingerprints: [fixture.ca.rootCertificate.tbs.subjectFingerprint],
      currentAssignmentGeneration: fixture.assignmentGeneration,
    },
    pgIncumbentRepository(client),
    pgReservationGateway(client),
    pgIssuanceGateway(client),
    fixture.ca,
    fixture.signer,
  );
  expect(renewal.outcome).toBe("RENEWED");
  return fixture;
}

async function enqueueLifecycleJob(client: pg.PoolClient, fixture: { deviceRecordId: string }) {
  const gateway = pgJobGateway(client);
  const boundary = await overlapEnd(client, fixture.deviceRecordId);
  const version = await headVersion(client, fixture.deviceRecordId);
  const { rows } = await client.query(
    `select credential_id from kitluy_devices.device_credentials
      where device_record_id = $1 and certificate_generation = 1`,
    [fixture.deviceRecordId],
  );
  const dedupeKey = credentialLifecycleDedupeKey({
    deviceRecordId: fixture.deviceRecordId,
    environment: DEVELOPMENT,
    purpose: DEVICE_IDENTITY,
    headVersion: version,
    previousCredentialId: String(rows[0].credential_id),
    overlapEndsAt: boundary,
  });
  const enqueued = await gateway.enqueue({
    jobKind: CREDENTIAL_LIFECYCLE_JOB_KIND,
    jobVersion: 1,
    dedupeKey,
    environment: DEVELOPMENT,
    subjectId: fixture.deviceRecordId,
    payload: { deviceRecordId: fixture.deviceRecordId, purpose: DEVICE_IDENTITY },
    maxAttempts: 5,
    actorRef: "JOBS-TEST",
  });
  return { enqueued, boundary, dedupeKey };
}

function lifecycleWorker(client: pg.PoolClient, at: Date, instance: string) {
  return credentialLifecycleHandler({
    reader: pgLifecycleReader(client),
    gateway: pgLifecycleGateway(client),
    identity: testWorkerIdentity(instance),
    trustedTime: async () => trustedAt(at),
  });
}

describe("durable job runtime — live PostgreSQL", () => {
  live("states plainly whether this suite ran", () => {
    if (!reachable) {
      expect.soft(reachable, "SKIPPED: the development database was unreachable").toBe(true);
    }
    expect(true).toBe(true);
  });

  // =========================================================================
  // The cross-layer conformance the whole retry policy depends on
  // =========================================================================
  live(
    "agrees with the database about the backoff ladder, attempt by attempt",
    async () => {
      if (!reachable) return;
      await withDatabaseTransaction(async (client) => {
        for (const attempt of [1, 2, 3, 4, 5, 6, 12]) {
          const { rows } = await client.query(
            `select kitluy_ops.durable_job_backoff_seconds_v1($1, $2) as s`,
            [attempt, 0],
          );
          expect(Number(rows[0].s), `attempt ${attempt}`).toBe(backoffSeconds(attempt, 0));
        }
        // ...including the jitter cap, which is where two independent
        // implementations of "bounded" usually stop agreeing.
        const { rows } = await client.query(
          `select kitluy_ops.durable_job_backoff_seconds_v1(3, 9999) as s`,
        );
        expect(Number(rows[0].s)).toBe(backoffSeconds(3, 9999));
        executed += 1;
      });
    },
    60_000,
  );

  // =========================================================================
  // Credential lifecycle worker
  // =========================================================================
  live(
    "defers at the authoritative boundary, retires once at it, and never twice",
    async () => {
      if (!reachable) return;
      await withDatabaseTransaction(async (client) => {
        const fixture = await seedRenewedDevice(client, "JOBLC");
        const { enqueued, boundary } = await enqueueLifecycleJob(client, fixture);
        expect(enqueued.outcome).toBe("CREATED");

        const before = new Date(boundary.getTime() - MS_PER_DAY);
        const identity = testWorkerIdentity("worker-A");

        // -- BEFORE the boundary: deferred to the AUTHORITATIVE overlap end --
        const lease1 = newLease("worker-A");
        const gateway = pgJobGateway(client);
        const run1 = await runDurableJobs({
          gateway,
          identity,
          handlers: [lifecycleWorker(client, before, "worker-A")],
          lease: lease1,
          clock: fixedClock(before),
          jitter: fixedJitter(0),
          maxJobs: 10,
        });

        // Filtered to THIS job. A sweep claims by kind, so asserting on the
        // batch size would make this test depend on whatever else happens to be
        // queued — which is a property of the database, not of the deferral.
        const mine1 = run1.filter((r) => r.jobId === enqueued.jobId);
        expect(mine1).toHaveLength(1);
        expect(mine1[0].disposition).toBe("deferred");
        const deferred = await readJob(client, enqueued.jobId);
        expect(deferred?.status).toBe("retry_scheduled");
        // The persisted overlap end, TO THE MILLISECOND. Not an invented
        // interval. Compared as a Date rather than through String(), which
        // drops sub-second precision — on a boundary assertion that would hide
        // exactly the disagreement it exists to catch.
        expect((deferred?.next_attempt_at as Date).toISOString()).toBe(boundary.toISOString());
        // The claim is remembered as evidence; the deferral is discounted from
        // the retry BUDGET. Waiting three days for an overlap must not spend it.
        expect(Number(deferred?.attempt_count)).toBe(1);
        expect(Number(deferred?.deferral_count)).toBe(1);
        expect(await credentialStates(client, fixture.deviceRecordId)).toBe("issued:1,issued:2");

        // A deferred job really is OUT of the queue: a sweep before the
        // boundary claims nothing, so the overlap is not re-evaluated every
        // thirty seconds for three days.
        const earlySweep = await runDurableJobs({
          gateway,
          identity,
          handlers: [lifecycleWorker(client, before, "worker-A")],
          lease: newLease("worker-A"),
          clock: fixedClock(before),
          jitter: fixedJitter(0),
          maxJobs: 10,
        });
        expect(earlySweep.filter((r) => r.jobId === enqueued.jobId)).toHaveLength(0);

        // -- AT the boundary: the retirement lands, exactly once -------------
        // The SCHEDULER's clock reaches the due time. That grants no business
        // verdict — the retirement below is still decided against trusted time.
        await makeDueNow(client, enqueued.jobId);
        const lease2 = newLease("worker-A");
        const run2 = await runDurableJobs({
          gateway,
          identity,
          handlers: [lifecycleWorker(client, boundary, "worker-A")],
          lease: lease2,
          clock: fixedClock(boundary),
          jitter: fixedJitter(0),
          maxJobs: 10,
        });

        const mine2 = run2.filter((r) => r.jobId === enqueued.jobId);
        expect(mine2).toHaveLength(1);
        expect(mine2[0].disposition).toBe("completed");
        expect(await credentialStates(client, fixture.deviceRecordId)).toBe(
          "superseded:1,issued:2",
        );
        const completed = await readJob(client, enqueued.jobId);
        expect(completed?.status).toBe("completed");
        expect(completed?.terminal_reason).toBe("PREVIOUS_CREDENTIAL_RETIRED");

        // -- A THIRD sweep: the job is terminal, so nothing runs -------------
        const lease3 = newLease("worker-A");
        const run3 = await runDurableJobs({
          gateway,
          identity,
          handlers: [lifecycleWorker(client, boundary, "worker-A")],
          lease: lease3,
          clock: fixedClock(boundary),
          jitter: fixedJitter(0),
          maxJobs: 10,
        });
        expect(run3.filter((r) => r.jobId === enqueued.jobId)).toHaveLength(0);
        expect(await credentialStates(client, fixture.deviceRecordId)).toBe(
          "superseded:1,issued:2",
        );

        // Nothing anywhere in this path destroyed a key.
        expect(await destroyedKeyCount(client, fixture.deviceRecordId)).toBe(0);

        // Durable evidence: one attempt row per execution, no lease tokens.
        const attempts = await readJobAttempts(client, enqueued.jobId);
        expect(attempts).toHaveLength(2);
        expect(attempts[0].called_operation).toBe("advanceDeviceCredentialLifecycle");
        for (const attempt of attempts) {
          expect(String(attempt.lease_token_fingerprint)).toMatch(/^[0-9a-f]{16}$/);
          expect(String(attempt.lease_token_fingerprint)).not.toBe(lease1.leaseId);
          expect(String(attempt.lease_token_fingerprint)).not.toBe(lease2.leaseId);
          expect(String(attempt.worker_identity)).toBe("kitluy.worker.device-lifecycle");
        }
        executed += 1;
      });
    },
    180_000,
  );

  // =========================================================================
  // Rediscovery
  // =========================================================================
  live(
    "rediscovering the same work returns the same job, not a second one",
    async () => {
      if (!reachable) return;
      await withDatabaseTransaction(async (client) => {
        const fixture = await seedRenewedDevice(client, "JOBDEDUP");
        const first = await enqueueLifecycleJob(client, fixture);
        const second = await enqueueLifecycleJob(client, fixture);
        expect(first.enqueued.outcome).toBe("CREATED");
        expect(second.enqueued.outcome).toBe("EXISTING");
        expect(second.enqueued.jobId).toBe(first.enqueued.jobId);

        const { rows } = await client.query(
          `select count(*)::int as n from kitluy_ops.durable_jobs where subject_id = $1`,
          [fixture.deviceRecordId],
        );
        expect(rows[0].n).toBe(1);
        executed += 1;
      });
    },
    180_000,
  );

  // =========================================================================
  // Policy-blocked cleanup
  // =========================================================================
  live(
    "completes a cleanup evaluation as policy-blocked and destroys nothing",
    async () => {
      if (!reachable) return;
      await withDatabaseTransaction(async (client) => {
        const fixture = await seedRenewedDevice(client, "JOBCLEAN");
        const boundary = await overlapEnd(client, fixture.deviceRecordId);

        const gateway = pgJobGateway(client);
        const enqueued = await gateway.enqueue({
          jobKind: KEY_CLEANUP_EVALUATE_JOB_KIND,
          jobVersion: 1,
          dedupeKey: `cleanup-${fixture.deviceRecordId}-${randomUUID()}`,
          environment: DEVELOPMENT,
          subjectId: fixture.deviceRecordId,
          payload: { deviceRecordId: fixture.deviceRecordId, purpose: DEVICE_IDENTITY },
          maxAttempts: 5,
          actorRef: "JOBS-TEST",
        });

        const lease = newLease("worker-clean");
        const executedJobs = await runDurableJobs({
          gateway,
          identity: testWorkerIdentity("worker-clean"),
          handlers: [
            keyCleanupEvaluateHandler({
              reader: pgLifecycleReader(client),
              gateway: pgLifecycleGateway(client),
              identity: testWorkerIdentity("worker-clean"),
              trustedTime: async () => trustedAt(boundary),
            }),
          ],
          lease,
          clock: fixedClock(boundary),
          jitter: fixedJitter(0),
          maxJobs: 10,
        });

        const mine = executedJobs.filter((r) => r.jobId === enqueued.jobId);
        expect(mine).toHaveLength(1);
        expect(mine[0].disposition).toBe("completed");
        expect(mine[0].resultCode).toBe("KEY_DESTRUCTION_NOT_AUTHORIZED");

        const job = await readJob(client, enqueued.jobId);
        // COMPLETED, not retry_scheduled: a missing four-eyes approval is a
        // final answer, and retrying it would be a storm that can only ever
        // reach the same result before dead-lettering a correct job.
        expect(job?.status).toBe("completed");
        expect(job?.terminal_reason).toBe("KEY_DESTRUCTION_NOT_AUTHORIZED");
        expect(Number(job?.attempt_count)).toBe(1);

        // -- WHY it was blocked, and what it is NOT ---------------------------
        // The policy is ENABLED and carries the owner decision. That changed
        // nothing here, which is the whole point of this test now: the flag is
        // not the authority (0137 §15), the four-eyes record is (§6), and none
        // exists. Asserting the policy is disabled would no longer be true, and
        // asserting only "not authorized" would no longer say why.
        const { rows } = await client.query(
          `select destruction_enabled, approved_by_decision_ref, required_owner_decision,
                  four_eyes_required, automatic_provider_destruction
             from kitluy_devices.key_destruction_policy where environment = 'development'`,
        );
        expect(rows[0].destruction_enabled).toBe(true);
        expect(rows[0].approved_by_decision_ref).toBe(DECISION_REF);
        expect(rows[0].required_owner_decision).toBeNull();
        expect(rows[0].four_eyes_required).toBe(true);
        expect(rows[0].automatic_provider_destruction).toBe(false);

        const state = (await pgLifecycleReader(client).loadLifecycleState({
          deviceRecordId: fixture.deviceRecordId,
          environment: DEVELOPMENT,
          purpose: DEVICE_IDENTITY,
        }))!;
        // NO APPROVAL — not in the state the handler read, not in the database.
        expect(state.destructionApproval ?? null).toBeNull();
        for (const table of [
          `select count(*) n from kitluy_devices.device_key_destruction_requests
            where device_record_id = $1`,
          `select count(*) n from kitluy_devices.device_key_destruction_attempts a
             join kitluy_devices.device_key_destruction_requests r
               on r.destruction_request_id = a.destruction_request_id
            where r.device_record_id = $1`,
        ]) {
          const { rows: counted } = await client.query(table, [fixture.deviceRecordId]);
          expect(Number(counted[0].n)).toBe(0);
        }

        const eligibility = evaluateKeyDestruction(state, boundary);
        expect(eligibility.authorized).toBe(false);
        expect(eligibility.policyReference).toBe(DECISION_REF);
        expect(eligibility.requiredOwnerDecision).toBeNull();
        // This device renewed with the SAME key, so it is not even eligible —
        // the key still backs the current credential — and an approval would
        // not change that. Both answers are asserted so neither can be read as
        // standing in for the other.
        expect(eligibility.eligible).toBe(false);
        const fourEyes: KeyDestructionApproval = {
          destructionRequestId: "00000000-0000-4000-8000-000000000002",
          approved: true,
          requestedBy: "operator:alice",
          approvedBy: "operator:bob",
          expiresAt: new Date(boundary.getTime() + 3_600_000),
        };
        expect(
          evaluateKeyDestruction({ ...state, destructionApproval: fourEyes }, boundary).eligible,
        ).toBe(false);

        // -- NOTHING WAS DESTROYED. Unchanged and non-negotiable. -------------
        expect(await destroyedKeyCount(client, fixture.deviceRecordId)).toBe(0);
        // The handler holds no reference to a destroy operation at all, and the
        // durable evidence shows it: one attempt, whose only called operation
        // was the evaluation. There is no provider destroy call to count
        // because there is no branch that could make one.
        const attempts = await readJobAttempts(client, enqueued.jobId);
        expect(attempts).toHaveLength(1);
        expect(attempts[0].called_operation).toBe("evaluateKeyDestruction");
        expect(attempts[0].operation_result).toBe("KEY_DESTRUCTION_NOT_AUTHORIZED");
        expect(String(attempts[0].observed_business_state)).toContain("authorized=false");
        expect(attempts[0].failure_code).toBeNull();
        executed += 1;
      });
    },
    180_000,
  );

  // =========================================================================
  // Manual review
  // =========================================================================
  live(
    "escalates a divergence to manual review and changes no business state",
    async () => {
      if (!reachable) return;
      await withDatabaseTransaction(async (client) => {
        const fixture = await seedRenewedDevice(client, "JOBMR");
        const statesBefore = await credentialStates(client, fixture.deviceRecordId);
        const { enqueued } = await enqueueLifecycleJob(client, fixture);

        const gateway = pgJobGateway(client);
        const lease = newLease("worker-mr");
        // A lifecycle reader that reports a state no rule describes. The runtime
        // must escalate rather than guess, and must not touch a credential.
        const runs = await runDurableJobs({
          gateway,
          identity: testWorkerIdentity("worker-mr"),
          handlers: [
            {
              jobKind: CREDENTIAL_LIFECYCLE_JOB_KIND,
              handle: async () => ({
                disposition: {
                  kind: "failed" as const,
                  failureCode: "DATABASE_ACTIVE_PROVIDER_KEY_MISSING",
                },
                evidence: {
                  observedBusinessState: "db=active provider=absent",
                  calledOperation: "advanceDeviceCredentialLifecycle",
                  operationResult: "INCONSISTENT_STATE",
                  failureCode: "DATABASE_ACTIVE_PROVIDER_KEY_MISSING",
                  correlationId: null,
                },
              }),
            },
          ],
          lease,
          clock: fixedClock(new Date()),
          jitter: fixedJitter(0),
          maxJobs: 10,
        });

        expect(runs.filter((r) => r.jobId === enqueued.jobId)[0].classification).toBe(
          "manual_review",
        );
        const job = await readJob(client, enqueued.jobId);
        expect(job?.status).toBe("manual_review");
        expect(job?.last_failure_code).toBe("DATABASE_ACTIVE_PROVIDER_KEY_MISSING");
        // Escalated on the FIRST attempt: a divergence does not improve by being
        // asked again, and burning the budget only delays the human.
        expect(Number(job?.attempt_count)).toBe(1);

        // Nothing was repaired, regenerated or mutated.
        expect(await credentialStates(client, fixture.deviceRecordId)).toBe(statesBefore);
        expect(await destroyedKeyCount(client, fixture.deviceRecordId)).toBe(0);
        const { rows } = await client.query(
          `select count(*)::int as n from kitluy_devices.device_generation_keys
          where device_record_id = $1`,
          [fixture.deviceRecordId],
        );
        expect(rows[0].n).toBe(1);

        // ...and the escalation is durable evidence, not a log line.
        const attempts = await readJobAttempts(client, enqueued.jobId);
        expect(attempts).toHaveLength(1);
        expect(attempts[0].outcome_classification).toBe("manual_review");
        executed += 1;
      });
    },
    180_000,
  );

  // =========================================================================
  // Worker authority
  // =========================================================================
  live(
    "gives the worker no authority it does not need",
    async () => {
      if (!reachable) return;
      await withDatabaseTransaction(async (client) => {
        const check = async (sql: string) => {
          const { rows } = await client.query(sql);
          return rows[0].ok as boolean;
        };
        // No direct table authority anywhere.
        expect(
          await check(
            `select not has_table_privilege('kitluy_worker_service','kitluy_ops.durable_jobs','update') as ok`,
          ),
        ).toBe(true);
        expect(
          await check(
            `select not has_table_privilege('kitluy_worker_service','kitluy_devices.device_credentials','update') as ok`,
          ),
        ).toBe(true);
        // Cannot clear its own escalation.
        expect(
          await check(
            `select not has_function_privilege('kitluy_worker_service',
             'kitluy_ops.release_manual_review_job_v1(uuid, text, text, text)','execute') as ok`,
          ),
        ).toBe(true);
        // Cannot finalize a credential either: job authority is not credential
        // authority, and the two roles are deliberately separate grants.
        expect(
          await check(
            `select not has_function_privilege('kitluy_worker_service',
             'kitluy_devices.retire_overlapped_credential_v1(uuid, text, text, timestamptz, text, text)',
             'execute') as ok`,
          ),
        ).toBe(true);
        executed += 1;
      });
    },
    60_000,
  );

  // =========================================================================
  // TRUE concurrency — two real connections
  // =========================================================================
  live(
    "lets exactly one of two racing workers claim a job",
    async () => {
      if (!reachable) return;
      const created: string[] = [];
      // Its OWN kind: claiming is by kind, and a row leaked by an earlier crashed
      // run would otherwise be claimable here and turn this into a coin flip.
      const kind = `kitluy.test.race-${randomUUID()}.v1`;
      await withTwoDatabaseClients(async ({ a, b }) => {
        const subject = randomUUID();
        const dedupeKey = `concurrent-${randomUUID()}`;

        await a.query("begin");
        const enqueued = await pgJobGateway(a).enqueue({
          jobKind: kind,
          jobVersion: 1,
          dedupeKey,
          environment: DEVELOPMENT,
          subjectId: subject,
          payload: { deviceRecordId: subject, purpose: DEVICE_IDENTITY },
          maxAttempts: 5,
          actorRef: "JOBS-TEST",
        });
        await a.query("commit");
        created.push(enqueued.jobId);

        // Both connections claim, genuinely concurrently.
        const leaseA = newLease("worker-A");
        const leaseB = newLease("worker-B");
        const claimBoth = async (client: pg.PoolClient, lease: ReturnType<typeof newLease>) => {
          await client.query("begin");
          const claimed = await pgJobGateway(client).claim([kind], DEVELOPMENT, lease, 10);
          await client.query("commit");
          return claimed.filter((j) => j.jobId === enqueued.jobId);
        };
        const [fromA, fromB] = await Promise.all([claimBoth(a, leaseA), claimBoth(b, leaseB)]);

        // Exactly one. Not zero, not two.
        expect(fromA.length + fromB.length).toBe(1);
        const winner = fromA.length === 1 ? leaseA : leaseB;
        const loser = fromA.length === 1 ? leaseB : leaseA;
        const loserClient = fromA.length === 1 ? b : a;

        // The loser holds no authority over the job it did not win.
        await loserClient.query("begin");
        await expect(
          pgJobGateway(loserClient).complete(enqueued.jobId, loser.leaseId, "DONE", "JOBS-TEST"),
        ).rejects.toThrow(/STALE-LEASE/);
        await loserClient.query("rollback");

        // The winner can.
        await a.query("begin");
        const completion = await pgJobGateway(a).complete(
          enqueued.jobId,
          winner.leaseId,
          "DONE",
          "JOBS-TEST",
        );
        await a.query("commit");
        expect(completion).toBe("COMPLETED");

        await purgeTestJobs(a, created);
        executed += 1;
      });
    },
    120_000,
  );

  live(
    "lets two workers claim DIFFERENT jobs at the same time",
    async () => {
      if (!reachable) return;
      const created: string[] = [];
      const kind = `kitluy.test.parallel-${randomUUID()}.v1`;
      await withTwoDatabaseClients(async ({ a, b }) => {
        await a.query("begin");
        const gatewayA = pgJobGateway(a);
        for (let i = 0; i < 2; i += 1) {
          const enqueued = await gatewayA.enqueue({
            jobKind: kind,
            jobVersion: 1,
            dedupeKey: `parallel-${randomUUID()}`,
            environment: DEVELOPMENT,
            subjectId: randomUUID(),
            payload: { deviceRecordId: randomUUID(), purpose: DEVICE_IDENTITY },
            maxAttempts: 5,
            actorRef: "JOBS-TEST",
          });
          created.push(enqueued.jobId);
        }
        await a.query("commit");

        const claimOne = async (client: pg.PoolClient, owner: string) => {
          await client.query("begin");
          const claimed = await pgJobGateway(client).claim([kind], DEVELOPMENT, newLease(owner), 1);
          await client.query("commit");
          return claimed.filter((j) => created.includes(j.jobId));
        };
        const [fromA, fromB] = await Promise.all([
          claimOne(a, "worker-A"),
          claimOne(b, "worker-B"),
        ]);

        // SKIP LOCKED, so one stuck job never blocks another device's work.
        expect(fromA).toHaveLength(1);
        expect(fromB).toHaveLength(1);
        expect(fromA[0].jobId).not.toBe(fromB[0].jobId);

        await purgeTestJobs(a, created);
        executed += 1;
      });
    },
    120_000,
  );

  live(
    "reclaims an expired lease once, and refuses the dead worker's completion",
    async () => {
      if (!reachable) return;
      const created: string[] = [];
      const kind = `kitluy.test.crash-${randomUUID()}.v1`;
      await withTwoDatabaseClients(async ({ a, b }) => {
        await a.query("begin");
        const enqueued = await pgJobGateway(a).enqueue({
          jobKind: kind,
          jobVersion: 1,
          dedupeKey: `crash-${randomUUID()}`,
          environment: DEVELOPMENT,
          subjectId: randomUUID(),
          payload: { deviceRecordId: randomUUID(), purpose: DEVICE_IDENTITY },
          maxAttempts: 5,
          actorRef: "JOBS-TEST",
        });
        created.push(enqueued.jobId);

        // Worker A claims, starts... and disappears.
        const leaseA = newLease("worker-A");
        await pgJobGateway(a).claim([kind], DEVELOPMENT, leaseA, 10);
        await pgJobGateway(a).start(enqueued.jobId, leaseA.leaseId);
        await a.query("commit");

        await a.query("begin");
        await expireLease(a, enqueued.jobId);
        await a.query("commit");

        // Worker B, on its own connection, reclaims.
        await b.query("begin");
        const reclaimed = await pgJobGateway(b).claim(
          [kind],
          DEVELOPMENT,
          newLease("worker-B"),
          10,
        );
        await b.query("commit");
        const mine = reclaimed.filter((j) => j.jobId === enqueued.jobId);
        expect(mine).toHaveLength(1);
        // Attempt 1 was A's. Expiry is not an outcome, and erases no history.
        expect(mine[0].attemptCount).toBe(2);

        // A comes back from the dead and tries to finish. It must not.
        await a.query("begin");
        await expect(
          pgJobGateway(a).complete(enqueued.jobId, leaseA.leaseId, "DONE", "JOBS-TEST"),
        ).rejects.toThrow(/STALE-LEASE/);
        await a.query("rollback");

        const job = await readJob(a, enqueued.jobId);
        expect(job?.status).toBe("leased");
        expect(job?.lease_owner).toBe("worker-B");

        await purgeTestJobs(a, created);
        executed += 1;
      });
    },
    120_000,
  );

  live(
    "reports scoped operational status",
    async () => {
      if (!reachable) return;
      await withDatabaseTransaction(async (client) => {
        const subject = randomUUID();
        const gateway = pgJobGateway(client);
        await gateway.enqueue({
          jobKind: CREDENTIAL_LIFECYCLE_JOB_KIND,
          jobVersion: 1,
          dedupeKey: `status-${randomUUID()}`,
          environment: DEVELOPMENT,
          subjectId: subject,
          payload: { deviceRecordId: subject, purpose: DEVICE_IDENTITY },
          maxAttempts: 5,
          actorRef: "JOBS-TEST",
        });

        const scoped = await gateway.summary(DEVELOPMENT, [CREDENTIAL_LIFECYCLE_JOB_KIND], subject);
        expect(scoped.queued).toBe(1);
        expect(scoped.byKind[CREDENTIAL_LIFECYCLE_JOB_KIND]).toBe(1);

        // A different subject sees none of it.
        const other = await gateway.summary(
          DEVELOPMENT,
          [CREDENTIAL_LIFECYCLE_JOB_KIND],
          randomUUID(),
        );
        expect(other.queued).toBe(0);
        executed += 1;
      });
    },
    120_000,
  );

  live("reports how many live scenarios actually executed", () => {
    if (!reachable) {
      expect(executed, "the live suite did NOT run and is not evidence").toBe(0);
      return;
    }
    // Every scenario above increments this. A silent zero would mean the suite
    // reported green without touching a database.
    expect(executed).toBeGreaterThanOrEqual(9);
  });
});
