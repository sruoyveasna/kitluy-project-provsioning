/**
 * Retry classification and the bounded backoff schedule.
 *
 * The schedule is owned by the DATABASE (`kitluy_ops.durable_job_backoff_
 * seconds_v1`), because `next_attempt_at` is the database's column and a
 * caller-supplied delay would let a buggy worker hammer a provider ten times a
 * second and call it policy. This module mirrors it for planning and reporting,
 * and a conformance test asserts the two agree — the same cross-layer
 * discipline the credential-overlap boundary uses.
 */
import type { JobOutcomeClassification } from "./durable-job.js";

/** attempt 1 immediate, then 30s, 2m, 10m, capped at 30m. */
const BACKOFF_LADDER_SECONDS: readonly number[] = [0, 30, 120, 600, 1800];
const BACKOFF_CAP_SECONDS = 1800;
/** Jitter only ever ADDS, and never unboundedly. */
export const MAX_JITTER_SECONDS = 60;

export function backoffSeconds(attemptNumber: number, jitterSeconds = 0): number {
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1) {
    throw new RangeError(`attempt number must be an integer >= 1, received ${attemptNumber}`);
  }
  if (!Number.isInteger(jitterSeconds) || jitterSeconds < 0) {
    throw new RangeError(`jitter must be an integer >= 0, received ${jitterSeconds}`);
  }
  const base = BACKOFF_LADDER_SECONDS[attemptNumber - 1] ?? BACKOFF_CAP_SECONDS;
  return base + Math.min(jitterSeconds, MAX_JITTER_SECONDS);
}

/**
 * Deterministic jitter from an injected source.
 *
 * `Math.random()` is deliberately absent: a retry schedule nobody can reproduce
 * is a retry schedule nobody can test, and "it usually spreads out" is not an
 * assertion.
 */
export interface JitterSource {
  next(): number;
}

export function jitterFrom(source: JitterSource): number {
  const raw = source.next();
  if (!Number.isFinite(raw) || raw < 0 || raw > 1) {
    throw new RangeError(`jitter source must yield a value in [0, 1], received ${raw}`);
  }
  return Math.floor(raw * MAX_JITTER_SECONDS);
}

/**
 * The retryability table.
 *
 * A failure is retryable only when repeating the SAME call could plausibly
 * succeed without anything else changing. Everything else escalates. The
 * default is escalation, not retry: a code nobody classified is a code nobody
 * understood, and retrying an unknown failure until the budget runs out just
 * delays the human by an hour.
 */
export const RETRYABLE_FAILURE_CODES: ReadonlySet<string> = new Set([
  "DATABASE_UNAVAILABLE",
  "DATABASE_SERIALIZATION_FAILURE",
  "DATABASE_DEADLOCK",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_TIMEOUT",
  "PROVIDER_ACTIVATION_ACK_LOST",
  "NETWORK_TRANSIENT",
  "LEASE_SAFE_TIMEOUT",
  "TRUSTED_TIME_UNAVAILABLE",
]);

/**
 * Failures that a retry cannot fix and must never be allowed to consume the
 * attempt budget. Two systems disagreeing does not get better by asking again.
 */
export const MANUAL_REVIEW_FAILURE_CODES: ReadonlySet<string> = new Set([
  "DATABASE_PROVIDER_FINGERPRINT_DIVERGENCE",
  "DATABASE_ACTIVE_PROVIDER_KEY_MISSING",
  "PROVIDER_KEY_MISSING",
  "CONFLICTING_SIGNATURE",
  "PROVIDER_KEY_REFERENCE_CHANGED",
  "KEY_GENERATION_CHANGED",
  "UNKNOWN_LIFECYCLE_COMBINATION",
  "AUTHORIZATION_FAILED",
  "SCHEMA_VERSION_INCOMPATIBLE",
  "MACHINE_IDENTITY_INVALID",
]);

/**
 * Outcomes that are DONE, including the policy-blocked one.
 *
 * `KEY_DESTRUCTION_NOT_AUTHORIZED` belongs here and not in the retry set. An
 * absent owner decision is not a transient fault: retrying it would produce a
 * storm of identical evaluations that can only ever reach the same answer, and
 * would eventually dead-letter a job whose result was correct every single
 * time. A new policy version creates a NEW deduplicated job instead.
 */
export const TERMINAL_SUCCESS_CODES: ReadonlySet<string> = new Set([
  "RECONCILIATION_ALREADY_COMPLETED",
  "LIFECYCLE_ALREADY_ADVANCED",
  "JOB_RESULT_REPLAYED",
  "KEY_DESTRUCTION_NOT_AUTHORIZED",
  "NO_ACTION_REQUIRED",
]);

export function classifyFailureCode(code: string): JobOutcomeClassification {
  if (TERMINAL_SUCCESS_CODES.has(code)) return "terminal_success";
  if (RETRYABLE_FAILURE_CODES.has(code)) return "retryable";
  if (MANUAL_REVIEW_FAILURE_CODES.has(code)) return "manual_review";
  // Fail closed toward a human. See the comment on the table above.
  return "manual_review";
}
