/**
 * Production Postgres adapter for {@link DurableJobGateway}.
 *
 * Authority: migration group 0135 (the governed durable-job runtime);
 * WS-11-T003 Step 4 final completion §3.
 *
 * ===========================================================================
 * WHY THIS EXISTS IN THE PACKAGE AND NOT IN A SERVICE
 * ===========================================================================
 * A complete gateway over the group 0135 RPCs already existed — as a TEST
 * FIXTURE, in `packages/device-identity/test/support/job-fixtures.ts`. Every job
 * suite in the repository proved the governed runtime works, and no production
 * code could reach it. Copying the fixture into one service would have made a
 * second copy to drift; the queue is neutral infrastructure that any worker
 * needs, so the adapter belongs beside its contract.
 *
 * ===========================================================================
 * NO TABLE ACCESS, EVER
 * ===========================================================================
 * There is no INSERT, UPDATE or DELETE against `kitluy_ops.durable_jobs` in this
 * file. Every method is a call to a SECURITY DEFINER function, exactly as
 * `DurableJobGateway`'s own doc requires — the runtime holds no table authority
 * and must not appear to. Group 0135 enforces this: the tables carry an
 * append-only trigger and a transition guard, and the worker role holds no direct
 * write privilege.
 *
 * `pg` is imported for TYPES ONLY, so this package gains no runtime dependency —
 * the same arrangement `packages/device-identity/src/pg-revocation-gateway.ts`
 * uses.
 */
import type { QueryResult } from "pg";

import type {
  DurableJob,
  DurableJobGateway,
  DurableJobStatus,
  EnqueueRequest,
  EnqueueResult,
  JobAttemptEvidence,
  JobOutcomeClassification,
  JobStatusSummary,
  WorkerIdentity,
} from "./durable-job.js";

export type JobSqlExecutor = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>>;
};

/** The governed job identity. Group 0135 grants the job RPCs to this role. */
export const WORKER_SERVICE_ROLE = "kitluy_worker_service" as const;

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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

function record(raw: unknown): Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

/**
 * Builds a gateway over a client that ALREADY holds the worker identity.
 *
 * Used when a caller owns the transaction — the production worker loop, which
 * must keep claim, execute and complete inside one governed session.
 */
export function createPgDurableJobGateway(client: JobSqlExecutor): DurableJobGateway {
  return {
    async enqueue(request: EnqueueRequest): Promise<EnqueueResult> {
      const { rows } = await client.query<{ r: unknown }>(
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
      const r = record(rows[0]?.r);
      return {
        outcome: String(r.outcome) === "EXISTING" ? "EXISTING" : "CREATED",
        jobId: String(r.job_id),
        status: String(r.status) as DurableJobStatus,
        attemptCount: Number(r.attempt_count ?? 0),
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
      const { rows } = await client.query<{ r: unknown }>(
        `select kitluy_ops.complete_durable_job_v1($1,$2,$3,$4) as r`,
        [jobId, leaseId, resultCode, actorRef],
      );
      return String(record(rows[0]?.r).outcome) === "ALREADY_COMPLETED"
        ? "ALREADY_COMPLETED"
        : "COMPLETED";
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
      const { rows } = await client.query<{ r: unknown }>(
        `select kitluy_ops.fail_durable_job_v1($1,$2,$3,$4::kitluy_ops.job_outcome_classification,$5,$6) as r`,
        [jobId, leaseId, failureCode, classification, jitterSeconds, actorRef],
      );
      const r = record(rows[0]?.r);
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
      const { rows } = await client.query<{ r: unknown }>(
        `select kitluy_ops.durable_job_status_summary_v1($1,$2::text[],$3) as r`,
        [environment, jobKinds ?? null, subjectId ?? null],
      );
      const r = record(rows[0]?.r);
      return {
        environment: String(r.environment),
        queued: Number(r.queued ?? 0),
        leasedOrRunning: Number(r.leased_or_running ?? 0),
        retryScheduled: Number(r.retry_scheduled ?? 0),
        manualReview: Number(r.manual_review ?? 0),
        deadLetter: Number(r.dead_letter ?? 0),
        completed: Number(r.completed ?? 0),
        cancelled: Number(r.cancelled ?? 0),
        staleLeases: Number(r.stale_leases ?? 0),
        oldestQueuedAgeSeconds: Number(r.oldest_queued_age_seconds ?? 0),
        oldestRetryAgeSeconds: Number(r.oldest_retry_age_seconds ?? 0),
        byKind: (r.by_kind ?? {}) as Record<string, number>,
        byFailureCode: (r.by_failure_code ?? {}) as Record<string, number>,
      };
    },
  };
}

/** Hands out a client for one governed call. Lets a pool back the gateway. */
export interface JobClientSource {
  connect(): Promise<
    JobSqlExecutor & {
      release(): void;
    }
  >;
}

/**
 * Builds a gateway that opens its OWN transaction per call, as the worker.
 *
 * The shape a route or scheduler wants: it has no transaction of its own and
 * must not borrow one. `set local role` means the identity dies with the
 * transaction, so a pooled connection can never leak it to the next borrower.
 */
export function createPooledPgDurableJobGateway(source: JobClientSource): DurableJobGateway {
  const inGovernedTransaction = async <T>(
    fn: (gateway: DurableJobGateway) => Promise<T>,
  ): Promise<T> => {
    const client = await source.connect();
    try {
      await client.query("begin");
      await client.query(`set local role ${WORKER_SERVICE_ROLE}`);
      const result = await fn(createPgDurableJobGateway(client));
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  };

  return {
    enqueue: (r) => inGovernedTransaction((g) => g.enqueue(r)),
    claim: (k, e, l, m) => inGovernedTransaction((g) => g.claim(k, e, l, m)),
    start: (j, l) => inGovernedTransaction((g) => g.start(j, l)),
    complete: (j, l, r, a) => inGovernedTransaction((g) => g.complete(j, l, r, a)),
    defer: (j, l, n, r, a) => inGovernedTransaction((g) => g.defer(j, l, n, r, a)),
    fail: (j, l, f, c, s, a) => inGovernedTransaction((g) => g.fail(j, l, f, c, s, a)),
    recordAttempt: (j, l, i, e) => inGovernedTransaction((g) => g.recordAttempt(j, l, i, e)),
    summary: (e, k, s) => inGovernedTransaction((g) => g.summary(e, k, s)),
  };
}
