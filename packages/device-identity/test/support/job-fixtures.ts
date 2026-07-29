/**
 * Live-database adapters for the durable job runtime (migration group 0135).
 *
 * TEST-ONLY, and deliberately not exported from `src/`. Nothing in the shipped
 * package opens a database connection.
 *
 * Every call below goes through a governed function. There is no direct INSERT
 * or UPDATE against `kitluy_ops.durable_jobs` anywhere in this file — not even
 * to build a fixture — because a fixture built by bypassing the governor proves
 * nothing about the path under test, and would fail anyway: the worker role
 * holds no table authority at all.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";

import type {
  DurableJob,
  DurableJobGateway,
  DurableJobStatus,
  EnqueueRequest,
  EnqueueResult,
  JobAttemptEvidence,
  JobLease,
  JobOutcomeClassification,
  JobStatusSummary,
  WorkerIdentity,
} from "@kitluy/job-contracts";

import { devDatabaseUrl } from "./dev-database.js";

export const WORKER_ROLE = "kitluy_worker_service";
export const ISSUANCE_ROLE = "kitluy_issuance_service";

/**
 * Assume the worker role for the rest of the transaction.
 *
 * `SET LOCAL ROLE`, never plain `postgres`: `postgres` inherits `service_role`
 * and would mask a missing grant, which is exactly how a boundary test passes
 * while the boundary is broken.
 */
export async function asWorker(client: pg.PoolClient): Promise<void> {
  await client.query(`set local role ${WORKER_ROLE}`);
}

export async function asIssuanceService(client: pg.PoolClient): Promise<void> {
  await client.query(`set local role ${ISSUANCE_ROLE}`);
}

export async function resetRole(client: pg.PoolClient): Promise<void> {
  await client.query("reset role");
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value : new Date(String(value));
}

function rowToJob(row: Record<string, unknown>): DurableJob {
  return {
    jobId: String(row.job_id),
    jobKind: String(row.job_kind),
    jobVersion: Number(row.job_version),
    dedupeKey: String(row.dedupe_key),
    environment: String(row.environment),
    subjectId: String(row.subject_id),
    payload: (row.payload ?? {}) as Record<string, unknown>,
    status: String(row.status) as DurableJobStatus,
    attemptCount: Number(row.attempt_count),
    deferralCount: Number(row.deferral_count ?? 0),
    maxAttempts: Number(row.max_attempts),
    nextAttemptAt: toDate(row.next_attempt_at),
    leaseId: row.lease_id === null ? null : String(row.lease_id),
    leaseOwner: row.lease_owner === null ? null : String(row.lease_owner),
    leaseExpiresAt: toDate(row.lease_expires_at),
  };
}

/**
 * Runs one call as the worker and RESETS afterwards.
 *
 * Scoped per call rather than around a whole run, because job authority and
 * credential authority are separate roles and neither is a member of the other:
 * a worker cannot `SET ROLE` to the issuance service, so a nested attempt is
 * refused and aborts the transaction. The session holds both memberships and
 * switches between them via the session role, which is what a real worker
 * process would do.
 */
async function asWorkerCall<T>(client: pg.PoolClient, fn: () => Promise<T>): Promise<T> {
  await client.query(`set local role ${WORKER_ROLE}`);
  try {
    return await fn();
  } finally {
    await client.query("reset role").catch(() => undefined);
  }
}

/** The governed gateway, bound to one client. Each call assumes the worker role. */
export function pgJobGateway(client: pg.PoolClient): DurableJobGateway {
  const raw = {
    async enqueue(request: EnqueueRequest): Promise<EnqueueResult> {
      const { rows } = await client.query(
        `select kitluy_ops.enqueue_durable_job_v1($1,$2,$3,$4,$5,$6::jsonb,$7,$8) as r`,
        [
          request.jobKind,
          request.jobVersion,
          request.dedupeKey,
          request.environment,
          request.subjectId,
          JSON.stringify(request.payload),
          request.maxAttempts,
          request.actorRef,
        ],
      );
      const r = rows[0].r as Record<string, unknown>;
      return {
        outcome: String(r.outcome) as "CREATED" | "EXISTING",
        jobId: String(r.job_id),
        status: String(r.status) as DurableJobStatus,
        attemptCount: Number(r.attempt_count),
      };
    },

    async claim(jobKinds, environment, lease, maxJobs) {
      const { rows } = await client.query(
        `select * from kitluy_ops.claim_durable_jobs_v1($1::text[],$2,$3,$4,$5,$6)`,
        [jobKinds, environment, lease.leaseOwner, lease.leaseId, lease.leaseSeconds, maxJobs],
      );
      return rows.map((row) => rowToJob(row as Record<string, unknown>));
    },

    async start(jobId, leaseId) {
      await client.query(`select kitluy_ops.start_durable_job_v1($1,$2)`, [jobId, leaseId]);
    },

    async complete(jobId, leaseId, resultCode, actorRef) {
      const { rows } = await client.query(
        `select kitluy_ops.complete_durable_job_v1($1,$2,$3,$4) as r`,
        [jobId, leaseId, resultCode, actorRef],
      );
      const outcome = String((rows[0].r as Record<string, unknown>).outcome);
      return outcome === "ALREADY_COMPLETED" ? "ALREADY_COMPLETED" : "COMPLETED";
    },

    async defer(jobId, leaseId, nextAttemptAt, reason, actorRef) {
      await client.query(`select kitluy_ops.defer_durable_job_v1($1,$2,$3,$4,$5)`, [
        jobId,
        leaseId,
        nextAttemptAt.toISOString(),
        reason,
        actorRef,
      ]);
    },

    async fail(jobId, leaseId, failureCode, classification, jitterSeconds, actorRef) {
      const { rows } = await client.query(
        `select kitluy_ops.fail_durable_job_v1($1,$2,$3,$4::kitluy_ops.job_outcome_classification,$5,$6) as r`,
        [jobId, leaseId, failureCode, classification, jitterSeconds, actorRef],
      );
      const r = rows[0].r as Record<string, unknown>;
      return {
        status: String(r.outcome).toLowerCase() as DurableJobStatus,
        nextAttemptAt: toDate(r.next_attempt_at),
      };
    },

    async recordAttempt(
      jobId: string,
      leaseId: string,
      identity: WorkerIdentity,
      evidence: JobAttemptEvidence,
    ) {
      await client.query(
        `select kitluy_ops.record_job_attempt_v1($1,$2,$3,$4,$5,$6,$7,$8,
                $9::kitluy_ops.job_outcome_classification,$10,$11,$12,$13)`,
        [
          jobId,
          leaseId,
          identity.serviceIdentity,
          identity.workerInstanceId,
          identity.softwareVersion,
          evidence.observedBusinessState,
          evidence.calledOperation,
          evidence.operationResult,
          evidence.classification satisfies JobOutcomeClassification,
          evidence.failureCode,
          evidence.startedAt.toISOString(),
          evidence.finishedAt.toISOString(),
          evidence.correlationId ?? null,
        ],
      );
    },

    async summary(environment, jobKinds, subjectId): Promise<JobStatusSummary> {
      const { rows } = await client.query(
        `select kitluy_ops.durable_job_status_summary_v1($1,$2::text[],$3) as r`,
        [environment, jobKinds ?? null, subjectId ?? null],
      );
      const r = rows[0].r as Record<string, unknown>;
      return {
        environment: String(r.environment),
        queued: Number(r.queued),
        leasedOrRunning: Number(r.leased_or_running),
        retryScheduled: Number(r.retry_scheduled),
        manualReview: Number(r.manual_review),
        deadLetter: Number(r.dead_letter),
        completed: Number(r.completed),
        cancelled: Number(r.cancelled),
        staleLeases: Number(r.stale_leases),
        oldestQueuedAgeSeconds: Number(r.oldest_queued_age_seconds),
        oldestRetryAgeSeconds: Number(r.oldest_retry_age_seconds),
        byKind: (r.by_kind ?? {}) as Record<string, number>,
        byFailureCode: (r.by_failure_code ?? {}) as Record<string, number>,
      };
    },
  };

  return {
    enqueue: (r) => asWorkerCall(client, () => raw.enqueue(r)),
    claim: (k, e, l, m) => asWorkerCall(client, () => raw.claim(k, e, l, m)),
    start: (j, l) => asWorkerCall(client, () => raw.start(j, l)),
    complete: (j, l, r, a) => asWorkerCall(client, () => raw.complete(j, l, r, a)),
    defer: (j, l, n, r, a) => asWorkerCall(client, () => raw.defer(j, l, n, r, a)),
    fail: (j, l, f, c, s, a) => asWorkerCall(client, () => raw.fail(j, l, f, c, s, a)),
    recordAttempt: (j, l, i, e) => asWorkerCall(client, () => raw.recordAttempt(j, l, i, e)),
    summary: (e, k, s) => asWorkerCall(client, () => raw.summary(e, k, s)),
  };
}

export function testWorkerIdentity(instance: string): WorkerIdentity {
  return {
    workerInstanceId: instance,
    serviceIdentity: "kitluy.worker.device-lifecycle",
    environment: "development",
    softwareVersion: "test-0135",
  };
}

export function newLease(owner: string, seconds = 60): JobLease {
  return { leaseId: randomUUID(), leaseOwner: owner, leaseSeconds: seconds };
}

/** Deterministic. `Math.random()` in a retry test is an untestable schedule. */
export function fixedJitter(value = 0): { next(): number } {
  return { next: () => value };
}

export function fixedClock(at: Date): { now(): Date } {
  return { now: () => at };
}

// ---------------------------------------------------------------------------
// Reading back what the runtime wrote
// ---------------------------------------------------------------------------

export async function readJob(client: pg.PoolClient, jobId: string) {
  const { rows } = await client.query(
    `select job_id, job_kind, status::text as status, attempt_count, max_attempts,
            deferral_count, next_attempt_at, lease_id, lease_owner, lease_expires_at,
            last_failure_code, last_failure_classification::text as last_failure_classification,
            terminal_reason
       from kitluy_ops.durable_jobs where job_id = $1`,
    [jobId],
  );
  return rows[0] as Record<string, unknown> | undefined;
}

export async function readJobAttempts(client: pg.PoolClient, jobId: string) {
  const { rows } = await client.query(
    `select attempt_number, worker_identity, worker_instance_id, lease_owner,
            lease_token_fingerprint, observed_business_state, called_operation,
            operation_result, outcome_classification::text as outcome_classification,
            failure_code, software_version, sequence_no
       from kitluy_ops.durable_job_attempts
      where job_id = $1 order by sequence_no`,
    [jobId],
  );
  return rows as Record<string, unknown>[];
}

/**
 * Simulates the SCHEDULER's clock reaching a job's due time.
 *
 * Only `next_attempt_at` moves. The business decision the job then makes is
 * still taken against TRUSTED time by the credential services — which is the
 * separation being demonstrated: a deferred job stays out of the queue until
 * server time reaches its boundary, and reaching it grants no business verdict.
 */
export async function makeDueNow(client: pg.PoolClient, jobId: string): Promise<void> {
  await client.query(
    `update kitluy_ops.durable_jobs set next_attempt_at = now() where job_id = $1`,
    [jobId],
  );
}

/** Forces a lease to look expired without touching business state. */
export async function expireLease(client: pg.PoolClient, jobId: string): Promise<void> {
  await client.query(
    `update kitluy_ops.durable_jobs
        set leased_at = now() - interval '2 hours',
            lease_expires_at = now() - interval '1 hour'
      where job_id = $1`,
    [jobId],
  );
}

// ---------------------------------------------------------------------------
// TRUE concurrency
//
// Two workers on ONE pg client is not concurrency: interleaved queries on a
// single connection share a transaction and corrupt each other. These helpers
// open genuinely separate connections so "two workers raced" means it.
//
// The cost is that a rolled-back transaction can no longer provide isolation,
// so anything written here is COMMITTED and must be cleaned up explicitly.
// ---------------------------------------------------------------------------
export interface DualConnection {
  readonly a: pg.PoolClient;
  readonly b: pg.PoolClient;
}

export async function withTwoDatabaseClients<T>(
  fn: (connections: DualConnection) => Promise<T>,
): Promise<T> {
  const pool = new pg.Pool({ connectionString: devDatabaseUrl(), max: 4 });
  let a: pg.PoolClient | undefined;
  let b: pg.PoolClient | undefined;
  try {
    a = await pool.connect();
    b = await pool.connect();
    if (a === b) {
      throw new Error("the pool handed out the same client twice; this would not be concurrency");
    }
    return await fn({ a, b });
  } finally {
    a?.release();
    b?.release();
    await pool.end().catch(() => undefined);
  }
}

/**
 * Clears jobs left behind by a PREVIOUS run that failed before its cleanup.
 *
 * The concurrency scenarios must commit, so a mid-test failure leaks rows —
 * and a leaked claimable row is exactly what turns the next run's claim
 * assertions into a coin flip. Starting from a known-empty test namespace makes
 * a failure reproduce instead of migrating to a different test.
 *
 * Scoped to `kitluy.test.%` kinds only: real device work is never touched.
 */
export async function purgeLeftoverTestJobs(client: pg.PoolClient): Promise<void> {
  const { rows } = await client.query(
    `select job_id from kitluy_ops.durable_jobs where job_kind like 'kitluy.test.%'`,
  );
  await purgeTestJobs(
    client,
    rows.map((r) => String(r.job_id)),
  );
}

/**
 * Removes committed job rows created by a test.
 *
 * Runs as the table owner rather than the worker, because the worker cannot
 * delete jobs and neither can anyone else through the governed path — jobs are
 * cancelled or dead-lettered, never deleted. This is a TEST-ONLY escape and it
 * is loud about being one.
 */
export async function purgeTestJobs(client: pg.PoolClient, jobIds: readonly string[]) {
  if (jobIds.length === 0) return;
  await client.query("reset role");
  await client.query(`set local role kitluy_job_governor`);
  await client.query(
    `alter table kitluy_ops.durable_jobs disable trigger trg_durable_jobs_no_delete`,
  );
  try {
    await client.query(
      `delete from kitluy_ops.durable_job_attempts where job_id = any($1::uuid[])`,
      [jobIds],
    );
    await client.query(`delete from kitluy_ops.durable_jobs where job_id = any($1::uuid[])`, [
      jobIds,
    ]);
  } finally {
    await client.query(
      `alter table kitluy_ops.durable_jobs enable trigger trg_durable_jobs_no_delete`,
    );
    await client.query("reset role");
  }
}
