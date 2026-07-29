/**
 * The neutral execution loop.
 *
 * AT-LEAST-ONCE, and it says so. A worker may call a provider or a database
 * more than once — a lease can expire while an operation is still in flight,
 * and a completed operation can lose its acknowledgement. What this runtime
 * guarantees is that at most ONE business effect survives, and that guarantee
 * comes from deduplication, lease ownership, idempotent handlers and governed
 * compare-and-swap. It does NOT come from pretending the second call never
 * happened, and nothing here claims exactly-once execution.
 */
import type {
  DurableJob,
  DurableJobGateway,
  JobAttemptEvidence,
  JobLease,
  JobOutcomeClassification,
  WorkerIdentity,
} from "./durable-job.js";
import { classifyFailureCode, jitterFrom, type JitterSource } from "./retry-policy.js";

/** What a handler decided. Deliberately closed: there is no "maybe". */
export type HandlerDisposition =
  | {
      readonly kind: "completed";
      readonly resultCode: string;
    }
  | {
      /**
       * Not due yet, and nothing failed. Distinct from a retry because it must
       * not consume an attempt: an overlap that is still running is not a
       * failure to retire it, and counting it as one would dead-letter a
       * perfectly healthy device after five sweeps.
       */
      readonly kind: "deferred";
      readonly nextAttemptAt: Date;
      readonly reason: string;
    }
  | {
      readonly kind: "failed";
      readonly failureCode: string;
    };

export interface HandlerResult {
  readonly disposition: HandlerDisposition;
  /** Everything except the classification, which the runtime derives. */
  readonly evidence: Omit<JobAttemptEvidence, "classification" | "startedAt" | "finishedAt">;
}

export interface JobHandler {
  readonly jobKind: string;
  handle(job: DurableJob): Promise<HandlerResult>;
}

export interface WorkerClock {
  now(): Date;
}

export interface JobRuntimeOptions {
  readonly gateway: DurableJobGateway;
  readonly identity: WorkerIdentity;
  readonly handlers: readonly JobHandler[];
  readonly lease: JobLease;
  readonly clock: WorkerClock;
  readonly jitter: JitterSource;
  readonly maxJobs: number;
}

export interface ExecutedJob {
  readonly jobId: string;
  readonly jobKind: string;
  readonly subjectId: string;
  readonly disposition: HandlerDisposition["kind"] | "replayed";
  readonly classification: JobOutcomeClassification;
  readonly resultCode: string;
  readonly attemptCount: number;
}

/** Raised when a handler is missing. Fails closed rather than silently idling. */
export class UnhandledJobKindError extends Error {
  constructor(jobKind: string) {
    super(`no handler is registered for job kind ${jobKind}`);
    this.name = "UnhandledJobKindError";
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/**
 * Claims a batch and runs each job to a durable conclusion.
 *
 * Every path — success, deferral, failure, unexpected throw — records evidence
 * BEFORE the job status moves, so a crash between the two leaves an attempt
 * row that explains what was happening rather than a status with no story.
 */
export async function runDurableJobs(options: JobRuntimeOptions): Promise<readonly ExecutedJob[]> {
  const { gateway, identity, handlers, lease, clock, jitter, maxJobs } = options;
  const byKind = new Map(handlers.map((h) => [h.jobKind, h]));
  const kinds = handlers.map((h) => h.jobKind);

  const claimed = await gateway.claim(kinds, identity.environment, lease, maxJobs);
  const executed: ExecutedJob[] = [];

  for (const job of claimed) {
    executed.push(await runOne(job));
  }
  return executed;

  async function runOne(job: DurableJob): Promise<ExecutedJob> {
    const handler = byKind.get(job.jobKind);
    const startedAt = clock.now();

    if (handler === undefined) {
      // Claimed but unrunnable. Escalate rather than release it back into a
      // loop that will claim it again a second later.
      return finish(job, startedAt, {
        disposition: { kind: "failed", failureCode: "SCHEMA_VERSION_INCOMPATIBLE" },
        evidence: {
          observedBusinessState: "unknown",
          calledOperation: "none",
          operationResult: new UnhandledJobKindError(job.jobKind).message,
          failureCode: "SCHEMA_VERSION_INCOMPATIBLE",
        },
      });
    }

    // leased -> running. The distinction is what tells a later reconciler
    // "this one had started" from "this one never began".
    await gateway.start(job.jobId, lease.leaseId);

    let result: HandlerResult;
    try {
      result = await handler.handle(job);
    } catch (error) {
      result = {
        disposition: { kind: "failed", failureCode: "UNHANDLED_EXCEPTION" },
        evidence: {
          observedBusinessState: "unknown",
          calledOperation: job.jobKind,
          operationResult: describeError(error),
          failureCode: "UNHANDLED_EXCEPTION",
        },
      };
    }
    return finish(job, startedAt, result);
  }

  async function finish(
    job: DurableJob,
    startedAt: Date,
    result: HandlerResult,
  ): Promise<ExecutedJob> {
    const disposition = result.disposition;
    const classification: JobOutcomeClassification =
      disposition.kind === "completed"
        ? "terminal_success"
        : disposition.kind === "deferred"
          ? "terminal_success"
          : classifyFailureCode(disposition.failureCode);

    await gateway.recordAttempt(job.jobId, lease.leaseId, identity, {
      ...result.evidence,
      classification,
      startedAt,
      finishedAt: clock.now(),
    });

    if (disposition.kind === "deferred") {
      await gateway.defer(
        job.jobId,
        lease.leaseId,
        disposition.nextAttemptAt,
        disposition.reason,
        identity.serviceIdentity,
      );
      return {
        jobId: job.jobId,
        jobKind: job.jobKind,
        subjectId: job.subjectId,
        disposition: "deferred",
        classification,
        resultCode: disposition.reason,
        attemptCount: job.attemptCount,
      };
    }

    if (disposition.kind === "completed") {
      const outcome = await gateway.complete(
        job.jobId,
        lease.leaseId,
        disposition.resultCode,
        identity.serviceIdentity,
      );
      return {
        jobId: job.jobId,
        jobKind: job.jobKind,
        subjectId: job.subjectId,
        disposition: outcome === "ALREADY_COMPLETED" ? "replayed" : "completed",
        classification,
        resultCode: disposition.resultCode,
        attemptCount: job.attemptCount,
      };
    }

    // A classification of terminal_success on a `failed` disposition is not a
    // contradiction: it is a code like KEY_DESTRUCTION_NOT_AUTHORIZED, which is
    // a correct and final ANSWER rather than a fault. Completing it is what
    // stops a policy decision becoming a retry storm.
    if (classification === "terminal_success") {
      const outcome = await gateway.complete(
        job.jobId,
        lease.leaseId,
        disposition.failureCode,
        identity.serviceIdentity,
      );
      return {
        jobId: job.jobId,
        jobKind: job.jobKind,
        subjectId: job.subjectId,
        disposition: outcome === "ALREADY_COMPLETED" ? "replayed" : "completed",
        classification,
        resultCode: disposition.failureCode,
        attemptCount: job.attemptCount,
      };
    }

    const failed = await gateway.fail(
      job.jobId,
      lease.leaseId,
      disposition.failureCode,
      classification,
      jitterFrom(jitter),
      identity.serviceIdentity,
    );
    return {
      jobId: job.jobId,
      jobKind: job.jobKind,
      subjectId: job.subjectId,
      disposition: "failed",
      classification,
      resultCode: `${failed.status}:${disposition.failureCode}`,
      attemptCount: job.attemptCount,
    };
  }
}
