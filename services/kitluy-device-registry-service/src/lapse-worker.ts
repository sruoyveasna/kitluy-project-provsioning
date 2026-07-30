/**
 * PRODUCTION durable-job worker for governed emergency post-approval lapse.
 *
 * Authority: KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001 §2.4 RULING 4 (the
 * deadline may be shortened but never extended, reset or renewed; a missed
 * post-approval leaves the credential REVOKED and moves the case to
 * MANUAL_SECURITY_REVIEW with incident escalation); migration group 0155;
 * WS-11-T003 Step 4 final remediation §5.
 *
 * ===========================================================================
 * WHAT RV-GW-002 WAS
 * ===========================================================================
 * The lapse SWEEPER existed in the database and was reachable by
 * `kitluy_worker_service` (group 0154 made it so, after group 0152 shipped it
 * unusable). What did not exist was any TypeScript that ever called it. The only
 * mechanism that converts an unreviewed emergency into a LAPSED verdict and an
 * escalation had no runtime, so in a deployed system it would never have fired,
 * and a missing escalation looks exactly like "nothing to escalate".
 *
 * ===========================================================================
 * THE WORKER CHOOSES NOTHING
 * ===========================================================================
 * The payload carries ONE field: an immutable authorization id. Everything the
 * lapse depends on is read from the stored row inside the database:
 *
 *   * the human actor — a lapse HAS no approver, and the verdict row records
 *     `actor_user_id = null` rather than a fabricated one;
 *   * the emergency reason, incident and affected scope — copied from the
 *     authorization, which is append-only and trigger-protected;
 *   * the post-approval deadline — compared against DATABASE time. A worker that
 *     could pass an instant could lapse early and manufacture an escalation
 *     against a human who still had time to answer.
 *
 * `readLapseAuthorizationId` is deliberately strict for this reason: a payload
 * carrying anything else is a payload someone tried to make the worker decide
 * with, and it is refused rather than partially honoured.
 *
 * ===========================================================================
 * DURABILITY IS THE RUNTIME'S, NOT THIS FILE'S
 * ===========================================================================
 * Claim, lease, heartbeat, attempt accounting, backoff and the replay short
 * circuit all live in `runDurableJobs` (`@kitluy/job-contracts`), which records
 * attempt evidence BEFORE moving job status. This handler's job is to translate
 * one governed database outcome into one disposition, and to get the retry
 * classification right.
 */
import {
  classifyFailureCode,
  runDurableJobs,
  type DurableJob,
  type DurableJobGateway,
  type ExecutedJob,
  type HandlerResult,
  type JobHandler,
  type JobLease,
  type JitterSource,
  type WorkerClock,
  type WorkerIdentity,
} from "@kitluy/job-contracts";

import { RedactedRevocationError } from "./revocation-failures.js";
import type { DeviceRevocationService, LapseResult } from "./revocation-service.js";

export const EMERGENCY_LAPSE_JOB_KIND = "kitluy.devices.emergency-post-approval-lapse.v1" as const;

/**
 * Deduplicated on the authorization id ALONE.
 *
 * Group 0138's trigger permits `post_approval_due_at` to be brought FORWARD and
 * refuses to let it move out. Including the deadline in the key would open a
 * SECOND obligation every time it was shortened; keying on the authorization
 * means an earlier deadline escalates earlier through the same job.
 */
export function emergencyLapseDedupeKey(authorizationId: string): string {
  return `${EMERGENCY_LAPSE_JOB_KIND}:${authorizationId}`;
}

/**
 * The ONE field a lapse job may carry.
 *
 * Returns null — never a default — when the payload is not exactly an
 * authorization id. A worker that tolerated an environment, a reason or a
 * deadline in its payload would be a worker that could be told what to decide.
 */
export function readLapseAuthorizationId(job: DurableJob): string | null {
  const raw = job.payload["authorizationId"] ?? job.payload["authorization_id"];
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return null;
  return value;
}

/**
 * Failure codes this handler emits, and why each classifies as it does.
 *
 * `classifyFailureCode` maps these through `@kitluy/job-contracts`:
 *
 *   AUTHORIZATION_FAILED          -> manual_review  (42501: permanent, never retried)
 *   DATABASE_UNAVAILABLE          -> retryable
 *   DATABASE_SERIALIZATION_FAILURE-> retryable
 *   NO_ACTION_REQUIRED            -> terminal_success (already decided)
 *   REVOCATION_OUTCOME_UNKNOWN    -> manual_review  (unmapped, and the policy's
 *                                    documented default is to fail closed toward
 *                                    a human — which is exactly what an
 *                                    unconfirmed commit requires)
 */
export const LAPSE_FAILURE_CODES = {
  authorization: "AUTHORIZATION_FAILED",
  unavailable: "DATABASE_UNAVAILABLE",
  contention: "DATABASE_SERIALIZATION_FAILURE",
  settled: "NO_ACTION_REQUIRED",
  unknownOutcome: "REVOCATION_OUTCOME_UNKNOWN",
  badPayload: "MACHINE_IDENTITY_INVALID",
  refused: "UNKNOWN_LIFECYCLE_COMBINATION",
} as const;

const OPERATION = "lapse_governed_emergency_post_approval_v1";

/**
 * Builds the handler over the REAL revocation service.
 *
 * Takes the service interface rather than a pool so the handler is testable
 * without a database, while production supplies the real implementation from
 * `resolveDeviceRevocationService` — the same discipline as the composition root:
 * no branch here can select a fake, because there is no branch.
 */
export function emergencyLapseJobHandler(service: DeviceRevocationService): JobHandler {
  return {
    jobKind: EMERGENCY_LAPSE_JOB_KIND,
    async handle(job: DurableJob): Promise<HandlerResult> {
      const authorizationId = readLapseAuthorizationId(job);
      if (authorizationId === null) {
        return failed(
          LAPSE_FAILURE_CODES.badPayload,
          "payload does not carry exactly one authorization id",
          "PAYLOAD_REFUSED",
        );
      }

      let result: LapseResult;
      try {
        result = await service.lapseEmergencyPostApproval(authorizationId);
      } catch (error) {
        // Already redacted by the service. The classification is reused rather
        // than re-derived, so the worker and any HTTP caller agree on whether a
        // failure was permanent.
        if (error instanceof RedactedRevocationError) {
          const { failureClass, code } = error.failure;
          if (failureClass === "PERMANENT_AUTHORIZATION") {
            return failed(LAPSE_FAILURE_CODES.authorization, "AUTHORIZATION_REFUSED", code);
          }
          if (failureClass === "RETRYABLE") {
            return failed(LAPSE_FAILURE_CODES.contention, "CONTENTION", code);
          }
          if (failureClass === "AMBIGUOUS_NEEDS_RECONCILIATION") {
            return failed(LAPSE_FAILURE_CODES.unknownOutcome, "OUTCOME_UNCONFIRMED", code);
          }
          return failed(LAPSE_FAILURE_CODES.refused, "REQUEST_REFUSED", code);
        }
        // Not a database fault this module recognises. Fail closed toward a human
        // rather than guess; the error's own text is NOT propagated.
        return failed(LAPSE_FAILURE_CODES.unknownOutcome, "OUTCOME_UNCONFIRMED", "UNCLASSIFIED");
      }

      switch (result.outcome) {
        case "LAPSED":
          return {
            disposition: { kind: "completed", resultCode: "EMERGENCY_POST_APPROVAL_LAPSED" },
            evidence: {
              observedBusinessState: "PENDING_PAST_DEADLINE",
              calledOperation: OPERATION,
              operationResult: "LAPSED",
              failureCode: null,
              correlationId: result.verdictId,
            },
          };

        case "ALREADY_DECIDED":
          // A settled obligation is a SUCCESS, not a failure: duplicate delivery,
          // a retry after an ambiguous commit, and losing the race to the
          // environment sweeper all land here, and none of them is a fault.
          return {
            disposition: { kind: "completed", resultCode: LAPSE_FAILURE_CODES.settled },
            evidence: {
              observedBusinessState: "ALREADY_DECIDED",
              calledOperation: OPERATION,
              operationResult: "ALREADY_DECIDED",
              failureCode: null,
              correlationId: result.verdictId,
            },
          };

        case "NOT_DUE":
          // DEFERRED, not retried: the window has not closed, so nothing failed
          // and no attempt may be consumed. Counting this as a failure would
          // dead-letter a healthy obligation after five early sweeps.
          //
          // The next attempt is not computed from a deadline this worker was
          // told — it was not told one. A fixed short defer re-asks the database,
          // which is the only thing that knows.
          return {
            disposition: {
              kind: "deferred",
              nextAttemptAt: new Date(Date.now() + LAPSE_DEFER_MS),
              reason: "the post-approval window has not closed",
            },
            evidence: {
              observedBusinessState: "PENDING_WITHIN_DEADLINE",
              calledOperation: OPERATION,
              operationResult: "NOT_DUE",
              failureCode: null,
              correlationId: null,
            },
          };

        default:
          return failed(
            LAPSE_FAILURE_CODES.refused,
            "LAPSE_REFUSED",
            result.refusalCode ?? "UNSPECIFIED",
          );
      }
    },
  };

  function failed(failureCode: string, observed: string, resultDetail: string): HandlerResult {
    return {
      disposition: { kind: "failed", failureCode },
      evidence: {
        observedBusinessState: observed,
        calledOperation: OPERATION,
        // A STABLE code, never driver text. `revocation-failures.ts` withholds
        // the raw message and this is the only place it could have leaked back in.
        operationResult: resultDetail,
        failureCode,
        correlationId: null,
      },
    };
  }
}

/**
 * How long to wait before re-asking about an obligation that is not yet due.
 *
 * Short relative to the four-hour post-approval window, so a lapse fires promptly
 * after the deadline rather than up to a poll-interval late. Long enough that a
 * queue of not-yet-due obligations is not a busy loop.
 */
export const LAPSE_DEFER_MS = 60_000;

export interface EmergencyLapseWorker {
  runOnce(): Promise<readonly ExecutedJob[]>;
}

/**
 * The production worker composition.
 *
 * `identity`, `lease`, `clock` and `jitter` are supplied by the caller because
 * they are deployment facts (which worker, how long a lease, whose clock), and
 * inventing them here would hide them. `service` is the real revocation service.
 */
export function createEmergencyLapseWorker(options: {
  readonly gateway: DurableJobGateway;
  readonly service: DeviceRevocationService;
  readonly identity: WorkerIdentity;
  readonly lease: JobLease;
  readonly clock: WorkerClock;
  readonly jitter: JitterSource;
  readonly maxJobs?: number;
}): EmergencyLapseWorker {
  const handler = emergencyLapseJobHandler(options.service);
  return {
    async runOnce(): Promise<readonly ExecutedJob[]> {
      return runDurableJobs({
        gateway: options.gateway,
        identity: options.identity,
        handlers: [handler],
        lease: options.lease,
        clock: options.clock,
        jitter: options.jitter,
        maxJobs: options.maxJobs ?? 25,
      });
    },
  };
}

/** Re-exported so callers can assert the classification without importing two packages. */
export { classifyFailureCode };
