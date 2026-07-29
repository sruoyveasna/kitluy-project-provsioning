/**
 * The neutral durable-job contract.
 *
 * NOTHING here names a device, a credential or a key. Work arrives as a job
 * KIND string and an opaque subject, exactly as `kitluy_ops.durable_jobs`
 * models it. A subsystem that needs durable retries implements a handler; it
 * does not get its own queue, because two queues with two lease models is how
 * one of them ends up subtly wrong.
 *
 * Mirrors migration group 0135. Where a rule exists in both layers it is
 * written identically in both and asserted by a conformance test, the same
 * discipline the credential-overlap boundary uses.
 */

/**
 * Job lifecycle.
 *
 * `leased` and `running` are deliberately distinct. A worker that died between
 * claiming and starting left no business effect; one that died after starting
 * may have left a COMPLETE effect whose acknowledgement was lost. Recovery
 * treats those differently, so collapsing them would erase the distinction it
 * needs.
 */
export type DurableJobStatus =
  | "queued"
  | "leased"
  | "running"
  | "retry_scheduled"
  | "completed"
  | "manual_review"
  | "dead_letter"
  | "cancelled";

/** How an execution outcome is to be handled. */
export type JobOutcomeClassification = "terminal_success" | "retryable" | "manual_review";

/**
 * Legal transitions. Mirrors `kitluy_ops.enforce_durable_job_transitions`.
 *
 * The rule that matters most: `dead_letter` never returns to `queued` in one
 * step. An automatic path back turns "we gave up and recorded why" into a loop.
 * An operator moves it to `manual_review` and then releases it — two deliberate
 * acts, two audit rows.
 */
export const LEGAL_JOB_TRANSITIONS: Readonly<
  Record<DurableJobStatus, readonly DurableJobStatus[]>
> = {
  queued: ["leased", "cancelled"],
  leased: ["running", "retry_scheduled", "completed", "manual_review", "dead_letter", "queued"],
  // `leased` is reachable from `running`: a worker that died AFTER starting
  // must still be reclaimable once its lease expires. Omitting it would make
  // the crash this model exists for the one crash it cannot recover from.
  running: ["retry_scheduled", "completed", "manual_review", "dead_letter", "queued", "leased"],
  retry_scheduled: ["leased", "queued", "cancelled"],
  manual_review: ["queued", "cancelled", "completed"],
  dead_letter: ["manual_review"],
  completed: [],
  cancelled: [],
};

export const TERMINAL_JOB_STATUSES: ReadonlySet<DurableJobStatus> = new Set<DurableJobStatus>([
  "completed",
  "cancelled",
]);

export function isLegalJobTransition(from: DurableJobStatus, to: DurableJobStatus): boolean {
  if (from === to) return true;
  return LEGAL_JOB_TRANSITIONS[from].includes(to);
}

/** A job as the runtime sees it. */
export interface DurableJob {
  readonly jobId: string;
  readonly jobKind: string;
  readonly jobVersion: number;
  readonly dedupeKey: string;
  readonly environment: string;
  /** Opaque. The runtime never interprets it. */
  readonly subjectId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly status: DurableJobStatus;
  /** Monotonic count of claims. Never decremented. */
  readonly attemptCount: number;
  /** How many claims ended in "not due yet". Discounted from the budget. */
  readonly deferralCount: number;
  readonly maxAttempts: number;
  readonly nextAttemptAt: Date | null;
  readonly leaseId: string | null;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAt: Date | null;
}

/**
 * Who is executing. Never an end-user identity: automated work that borrows a
 * person's identity is unattributable the moment that person leaves.
 */
export interface WorkerIdentity {
  readonly workerInstanceId: string;
  readonly serviceIdentity: string;
  readonly environment: string;
  readonly softwareVersion: string;
}

/** A claim held over one job. The lease id is the authority to complete it. */
export interface JobLease {
  readonly leaseId: string;
  readonly leaseOwner: string;
  readonly leaseSeconds: number;
}

export interface EnqueueRequest {
  readonly jobKind: string;
  readonly jobVersion: number;
  /**
   * Deterministic identity of the WORK. Built from authoritative lifecycle
   * facts — versions, generations, boundaries — never from a clock: a
   * timestamp here makes every discovery sweep create a duplicate.
   */
  readonly dedupeKey: string;
  readonly environment: string;
  readonly subjectId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly maxAttempts: number;
  readonly actorRef: string;
}

export interface EnqueueResult {
  readonly outcome: "CREATED" | "EXISTING";
  readonly jobId: string;
  readonly status: DurableJobStatus;
  readonly attemptCount: number;
}

/** Evidence of one attempt. Append-only; a retry adds a row. */
export interface JobAttemptEvidence {
  readonly observedBusinessState: string;
  readonly calledOperation: string;
  readonly operationResult: string;
  readonly classification: JobOutcomeClassification;
  readonly failureCode: string | null;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  /** Set only by subsystems that have one. Opaque to the runtime. */
  readonly correlationId?: string | null;
}

export interface JobStatusSummary {
  readonly environment: string;
  readonly queued: number;
  readonly leasedOrRunning: number;
  readonly retryScheduled: number;
  readonly manualReview: number;
  readonly deadLetter: number;
  readonly completed: number;
  readonly cancelled: number;
  readonly staleLeases: number;
  readonly oldestQueuedAgeSeconds: number;
  readonly oldestRetryAgeSeconds: number;
  readonly byKind: Readonly<Record<string, number>>;
  readonly byFailureCode: Readonly<Record<string, number>>;
}

/**
 * The governed surface. Every method is a call to a SECURITY DEFINER function;
 * there is deliberately no method that writes a job table directly, because the
 * runtime holds no table authority and must not appear to.
 */
export interface DurableJobGateway {
  enqueue(request: EnqueueRequest): Promise<EnqueueResult>;
  claim(
    jobKinds: readonly string[],
    environment: string,
    lease: JobLease,
    maxJobs: number,
  ): Promise<readonly DurableJob[]>;
  start(jobId: string, leaseId: string): Promise<void>;
  complete(
    jobId: string,
    leaseId: string,
    resultCode: string,
    actorRef: string,
  ): Promise<"COMPLETED" | "ALREADY_COMPLETED">;
  /** Not due yet. Must not consume an attempt. */
  defer(
    jobId: string,
    leaseId: string,
    nextAttemptAt: Date,
    reason: string,
    actorRef: string,
  ): Promise<void>;
  fail(
    jobId: string,
    leaseId: string,
    failureCode: string,
    classification: Exclude<JobOutcomeClassification, "terminal_success">,
    jitterSeconds: number,
    actorRef: string,
  ): Promise<{ readonly status: DurableJobStatus; readonly nextAttemptAt: Date | null }>;
  recordAttempt(
    jobId: string,
    leaseId: string,
    identity: WorkerIdentity,
    evidence: JobAttemptEvidence,
  ): Promise<void>;
  summary(
    environment: string,
    jobKinds?: readonly string[],
    subjectId?: string,
  ): Promise<JobStatusSummary>;
}
