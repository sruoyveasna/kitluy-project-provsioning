/**
 * Failure classification and redaction for governed revocation operations.
 *
 * Authority: WS-11-T003 Step 4 final remediation §2 (SQLSTATE 42501 permanent
 * and non-retryable; ambiguous commit outcomes enter reconciliation; raw
 * database, SQL and security-sensitive details redacted); job runtime retry
 * contract `packages/job-contracts/src/retry-policy.ts`.
 *
 * ===========================================================================
 * THE THREE DECISIONS THIS MODULE MAKES
 * ===========================================================================
 * 1. MAY THIS BE RETRIED? Retrying an authorization failure is not merely
 *    useless, it is harmful: it turns one refused emergency revocation into a
 *    burst of them in the audit trail, and it can spend a re-authentication
 *    evidence row that a human would rather still have. `42501` is therefore
 *    permanent by rule, not by heuristic.
 *
 * 2. DO WE KNOW WHAT HAPPENED? A connection that dies between `commit` and the
 *    acknowledgement leaves the caller unable to say whether the credential is
 *    revoked. Guessing either way is wrong — guessing "failed" invites a
 *    duplicate revocation, guessing "succeeded" may leave a live credential
 *    believed dead. Those outcomes are classified AMBIGUOUS and routed to
 *    reconciliation, which is the only honest answer.
 *
 * 3. WHAT MAY THE CALLER SEE? A refused emergency revocation is a security
 *    event, and its raw `message`/`detail`/`hint`/`where` describe the internals
 *    of a definer function, the names of governed tables and sometimes the
 *    predicate that refused. None of that crosses this boundary. The caller gets
 *    a stable classification and a correlation id; the operator gets the rest
 *    through the audit trail the database already writes.
 */

/**
 * What a caller may do about a failure. Deliberately not a boolean: "retryable"
 * and "we do not know the outcome" are different states and collapsing them is
 * how a duplicate revocation happens.
 */
export type RevocationFailureClass =
  /** Authorization, permission or re-authentication refused. NEVER retry. */
  | "PERMANENT_AUTHORIZATION"
  /** The request itself is wrong (bad enum, absent function, failed CHECK). NEVER retry. */
  | "PERMANENT_INVALID"
  /** A transient contention or capacity fault. Retry under the job policy. */
  | "RETRYABLE"
  /** The outcome is genuinely unknown. Reconcile; never blind-retry. */
  | "AMBIGUOUS_NEEDS_RECONCILIATION";

export interface RedactedRevocationFailure {
  readonly failureClass: RevocationFailureClass;
  /** Stable, safe-to-log identifier for the failure shape. */
  readonly code: string;
  /** The governed operation that failed, for correlation. */
  readonly operation: string;
  /** TRUE only for `RETRYABLE`. Convenience for the job runtime. */
  readonly retryable: boolean;
  /** TRUE only for `AMBIGUOUS_NEEDS_RECONCILIATION`. */
  readonly requiresReconciliation: boolean;
  /**
   * A fixed sentence chosen from a closed set. Never interpolates driver text,
   * SQL, table names, role names or predicate values.
   */
  readonly safeSummary: string;
}

/**
 * `42501 insufficient_privilege` — the class the remediation names explicitly.
 *
 * Reached when a human lacks `fleet.device_credential.emergency_revoke`, when a
 * service identity tries a door it does not hold, or when a role was revoked
 * mid-flight. All three are permanent for THIS attempt with THIS identity.
 */
export const INSUFFICIENT_PRIVILEGE = "42501" as const;

/** `42883 undefined_function` — a caller reaching for a door that no longer exists. */
export const UNDEFINED_FUNCTION = "42883" as const;

/**
 * SQLSTATEs that mean "contention, try again". Serialization and deadlock are
 * the job runtime's normal weather; `55P03` is a lock timeout; `53300`/`53400`
 * are capacity.
 */
const RETRYABLE_SQLSTATES: ReadonlySet<string> = new Set([
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  "55P03", // lock_not_available
  "53300", // too_many_connections
  "53400", // configuration_limit_exceeded
]);

/**
 * SQLSTATEs that leave the transaction's fate genuinely unknown.
 *
 * Every one of these can arrive AFTER the server has begun committing, so the
 * write may or may not be durable. `08006`/`08003`/`08007` are the connection
 * classes — `08007` is literally `transaction_resolution_unknown` — and
 * `57P01`/`57P02`/`57P03` are the server going away underneath us.
 */
const AMBIGUOUS_SQLSTATES: ReadonlySet<string> = new Set([
  "08000", // connection_exception
  "08003", // connection_does_not_exist
  "08006", // connection_failure
  "08007", // transaction_resolution_unknown
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
]);

/** Node-level socket faults that are indistinguishable from a lost commit. */
const AMBIGUOUS_ERROR_CODES: ReadonlySet<string> = new Set([
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "ECONNABORTED",
]);

/**
 * Governed refusals the RPCs raise as `P0001` with a `KLUY-`prefixed message.
 *
 * These are permanent by nature — a refused re-authentication or a rejected
 * citation does not become acceptable on the second try — but the MESSAGE is a
 * security detail, so only its shape is used and none of its text escapes.
 */
const GOVERNED_REFUSAL_SQLSTATE = "P0001" as const;

/**
 * `P0001` messages whose subject is authority rather than input shape.
 *
 * Matched case-insensitively against the raw message INSIDE this module only.
 * The matched text is never propagated.
 */
const AUTHORIZATION_REFUSAL_MARKERS: readonly string[] = [
  "permission",
  "not permitted",
  "reauthentication",
  "re-authentication",
  "unauthori", // unauthorised / unauthorized
  "emergency_revoke",
  "emergency_post_approve",
  "actor",
  "auth.uid",
  "distinct human",
  "four eyes",
  "four-eyes",
];

interface PgLikeError {
  readonly code?: unknown;
  readonly message?: unknown;
}

function sqlstateOf(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as PgLikeError).code;
  return typeof code === "string" ? code : null;
}

function rawMessageOf(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const message = (error as PgLikeError).message;
  return typeof message === "string" ? message : "";
}

const SUMMARIES: Readonly<Record<RevocationFailureClass, string>> = {
  PERMANENT_AUTHORIZATION:
    "the authoritative database refused this operation for the calling identity; it will not be retried",
  PERMANENT_INVALID:
    "the authoritative database rejected this request as invalid; it will not be retried",
  RETRYABLE: "the operation met transient database contention and may be retried",
  AMBIGUOUS_NEEDS_RECONCILIATION:
    "the outcome of this operation could not be confirmed and has been referred to reconciliation",
};

/**
 * Classifies and REDACTS a failure from a governed revocation call.
 *
 * Total by construction: an unrecognised error is AMBIGUOUS, never "fine" and
 * never blindly retryable. An unknown fault whose write may have landed is the
 * one case where doing nothing and asking a human is correct.
 */
export function classifyRevocationFailure(
  error: unknown,
  operation: string,
): RedactedRevocationFailure {
  const build = (
    failureClass: RevocationFailureClass,
    code: string,
  ): RedactedRevocationFailure => ({
    failureClass,
    code,
    operation,
    retryable: failureClass === "RETRYABLE",
    requiresReconciliation: failureClass === "AMBIGUOUS_NEEDS_RECONCILIATION",
    safeSummary: SUMMARIES[failureClass],
  });

  // `pg` reports SQLSTATE on `code`; Node reports socket faults on the SAME
  // field. One read, two vocabularies — so the socket names are checked against
  // it as well, below.
  const sqlstate = sqlstateOf(error);

  // 1. The named rule, checked first and unconditionally.
  if (sqlstate === INSUFFICIENT_PRIVILEGE) {
    return build("PERMANENT_AUTHORIZATION", "REVOCATION_PRIVILEGE_REFUSED");
  }

  // 2. A door that is not there. Since group 0151 this is what a legacy call
  //    site looks like from the outside, and retrying cannot conjure the
  //    function back.
  if (sqlstate === UNDEFINED_FUNCTION) {
    return build("PERMANENT_INVALID", "REVOCATION_DOOR_ABSENT");
  }

  if (
    sqlstate !== null &&
    (AMBIGUOUS_SQLSTATES.has(sqlstate) || AMBIGUOUS_ERROR_CODES.has(sqlstate))
  ) {
    return build("AMBIGUOUS_NEEDS_RECONCILIATION", "REVOCATION_OUTCOME_UNKNOWN");
  }

  if (sqlstate !== null && RETRYABLE_SQLSTATES.has(sqlstate)) {
    return build("RETRYABLE", "REVOCATION_CONTENTION");
  }

  if (sqlstate === GOVERNED_REFUSAL_SQLSTATE) {
    const raw = rawMessageOf(error).toLowerCase();
    const isAuthority = AUTHORIZATION_REFUSAL_MARKERS.some((marker) => raw.includes(marker));
    return isAuthority
      ? build("PERMANENT_AUTHORIZATION", "REVOCATION_GOVERNANCE_REFUSED")
      : build("PERMANENT_INVALID", "REVOCATION_REQUEST_REFUSED");
  }

  // 3. Integrity and input classes: wrong enum label, failed CHECK, bad cast.
  //    All are the request's fault and none improves on retry.
  if (
    sqlstate !== null &&
    (sqlstate.startsWith("22") || sqlstate.startsWith("23") || sqlstate === "42804")
  ) {
    return build("PERMANENT_INVALID", "REVOCATION_REQUEST_INVALID");
  }

  // 4. Anything else. Unknown means unknown.
  return build("AMBIGUOUS_NEEDS_RECONCILIATION", "REVOCATION_OUTCOME_UNKNOWN");
}

/**
 * The error type this service throws outward.
 *
 * Carries the classification and nothing else. `cause` is deliberately NOT set
 * to the driver error: an `Error` with a `cause` is routinely serialized whole
 * by loggers, which would re-export exactly the detail this class exists to
 * withhold.
 */
export class RedactedRevocationError extends Error {
  readonly failure: RedactedRevocationFailure;

  constructor(failure: RedactedRevocationFailure) {
    super(`${failure.operation}: ${failure.safeSummary} [${failure.code}]`);
    this.name = "RedactedRevocationError";
    this.failure = failure;
  }
}

/** Classifies, wraps and rethrows. The only exit this service uses for DB faults. */
export function throwRedacted(error: unknown, operation: string): never {
  throw new RedactedRevocationError(classifyRevocationFailure(error, operation));
}
