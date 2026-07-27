/**
 * @kitluy/api-errors — canonical error envelope and error-code registry.
 *
 * Source authority: rebuild bible v4.0.0 §10.2 (every contract defines typed
 * errors); API Error Code Registry v1.0.0
 * (`docs/source/api-contracts/kitluy-api-error-code-registry-v1.0.0.md`) §4,
 * which is CANONICAL for all four governed API surfaces; owner decision
 * KLD-2026-07-26-002 Group 5 (APPROVED WITH ADDITIONS), whose mapping table
 * renames and merges the pre-decision scaffold codes; POS Desktop spec v4.0.0
 * §14.3 (named edge error codes). API routes must not leak provider-specific
 * infrastructure details.
 *
 * STATUS: BUILT + TESTED (test/api-errors.test.ts). The registry is seeded
 * with codes named in canonical specs; it grows only with spec citations.
 */

export interface KitluyApiError {
  readonly code: KitluyErrorCode;
  /** Human-readable, safe to show operators. Never leaks provider internals. */
  readonly message: string;
  /** Correlation ID for tracing across services. */
  readonly correlationId?: string;
  /** Machine-readable details; schema owned by the specific contract. */
  readonly details?: Readonly<Record<string, unknown>>;
}

/** The standard error envelope returned by every governed KitLuy API. */
export interface KitluyErrorEnvelope {
  readonly error: KitluyApiError;
}

/**
 * Structured retry semantics. KLD-2026-07-26-002 Group 5: HTTP status is only
 * transport classification — client behavior is governed by `code`, `retryable`
 * and the documented retry contract. A structured value keeps the approved
 * per-code semantics machine-readable instead of prose.
 *
 * API Error Code Registry v1.0.0 §3.4: `retryable=true` is safe ONLY under the
 * documented retry/idempotency contract named here.
 */
export type KitluyRetryGuidance =
  /** Never replay: the request must change before it can succeed. */
  | "none"
  /** Transient dependency failure: replay with backoff. */
  | "backoff"
  /** KLD-2026-07-26-002 Group 5 `INTERNAL_ERROR`: replay with the SAME idempotency key. */
  | "same-idempotency-key"
  /** KLD-2026-07-26-002 Group 5 `SCALE_UNSTABLE`: replay only once a stable reading exists. */
  | "after-stable-reading"
  /** KLD-2026-07-26-002 Group 5 `HUB_READ_ONLY`: replay only after Hub write health recovers. */
  | "after-hub-write-health-recovers"
  /** KLD-2026-07-26-002 Group 5 `GARMENT_COUNT_MISMATCH`: NOT safe for blind automatic replay. */
  | "operator-resolution-required"
  /** KLD-2026-07-26-002 Group 5 `PAYMENT_PENDING`: poll for the authoritative outcome. */
  | "poll-for-authoritative-outcome";

/** One row of the canonical registry. */
export interface KitluyErrorCodeEntry {
  /** Transport classification only — never a substitute for `code`. */
  readonly httpStatus: number;
  /** Safe to replay ONLY under the contract named by `retryGuidance`. */
  readonly retryable: boolean;
  /**
   * `false` marks an ACCEPTED NON-TERMINAL outcome: the operation was accepted
   * but the authoritative result is not yet known, so it is neither a terminal
   * error nor a success. KLD-2026-07-26-002 Group 5 (`PAYMENT_PENDING`).
   */
  readonly terminal: boolean;
  readonly retryGuidance: KitluyRetryGuidance;
}

/**
 * Canonical error-code registry, aligned name-for-name with API Error Code
 * Registry v1.0.0 §4, plus the four additive codes approved in
 * KLD-2026-07-26-002 Group 5 and the Edge codes named in POS Desktop spec
 * v4.0.0 §14.3.
 *
 * KLD-2026-07-26-002 Group 5: the generic `CONFLICT` code is RETIRED — every
 * call site must emit the applicable specific registered conflict code. The
 * `EDGE_` prefix convention is REJECTED for production error identifiers, so no
 * registered code may carry it (the Hub LAN spec's `EDGE_*` table is
 * documentation-only reconciliation history).
 */
export const ERROR_CODES = {
  // Shared foundation — API Error Code Registry v1.0.0 §4 (surface: ALL).
  AUTHENTICATION_REQUIRED: {
    httpStatus: 401,
    retryable: false,
    terminal: true,
    retryGuidance: "none",
  },
  /** Registry §4: absent scope OR permission — one code, no policy internals leaked. */
  SCOPE_PERMISSION_DENIED: {
    httpStatus: 403,
    retryable: false,
    terminal: true,
    retryGuidance: "none",
  },
  RESOURCE_NOT_FOUND: { httpStatus: 404, retryable: false, terminal: true, retryGuidance: "none" },
  VALIDATION_FAILED: { httpStatus: 422, retryable: false, terminal: true, retryGuidance: "none" },
  /** Registry §4: expected version/ETag mismatch — refresh and reconcile, never blind-retry. */
  RESOURCE_VERSION_CONFLICT: {
    httpStatus: 409,
    retryable: false,
    terminal: true,
    retryGuidance: "none",
  },
  /** Registry §4: key reused with a different semantic payload. */
  IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST: {
    httpStatus: 409,
    retryable: false,
    terminal: true,
    retryGuidance: "none",
  },
  RATE_LIMITED: { httpStatus: 429, retryable: true, terminal: true, retryGuidance: "backoff" },
  /**
   * KLD-2026-07-26-002 Group 5 (additive; renamed from the scaffold `INTERNAL`):
   * HTTP 500, retryable with the SAME idempotency key. The server must never
   * claim success when the authoritative outcome is unknown.
   */
  INTERNAL_ERROR: {
    httpStatus: 500,
    retryable: true,
    terminal: true,
    retryGuidance: "same-idempotency-key",
  },
  /** Registry §4: a required internal dependency is unavailable — retry with backoff or queue. */
  DEPENDENCY_UNAVAILABLE: {
    httpStatus: 503,
    retryable: true,
    terminal: true,
    retryGuidance: "backoff",
  },
  /**
   * Registry §4: required Store-operational truth is too stale. `retryable` is
   * FALSE — the caller must wait for sync or use the authorized Edge workflow
   * instead of replaying the same request.
   */
  STALE_OPERATIONAL_DATA: {
    httpStatus: 409,
    retryable: false,
    terminal: true,
    retryGuidance: "none",
  },

  // Edge codes (POS Desktop spec v4.0.0 §14.3; statuses per registry §4 where listed)
  DEVICE_NOT_ASSIGNED: { httpStatus: 403, retryable: false, terminal: true, retryGuidance: "none" },
  PROFILE_NOT_ALLOWED: { httpStatus: 403, retryable: false, terminal: true, retryGuidance: "none" },
  HUB_UNREACHABLE: { httpStatus: 503, retryable: true, terminal: true, retryGuidance: "backoff" },
  /**
   * KLD-2026-07-26-002 Group 5 (additive): HTTP 503, mutations stay BLOCKED
   * while the Store Hub is in read-only safety mode. The same idempotency key
   * may be retried only after Hub health and write authority recover.
   */
  HUB_READ_ONLY: {
    httpStatus: 503,
    retryable: true,
    terminal: true,
    retryGuidance: "after-hub-write-health-recovers",
  },
  CONFIG_VERSION_INCOMPATIBLE: {
    httpStatus: 409,
    retryable: false,
    terminal: true,
    retryGuidance: "none",
  },
  /**
   * KLD-2026-07-26-002 Group 5 + API Error Code Registry v1.0.0 §4:
   * an ACCEPTED, NON-TERMINAL business outcome returned with HTTP 202. It is
   * neither a terminal error nor authoritative payment success. No client,
   * Store Hub, connector, POS or API may mark a Booking paid until
   * authoritative confirmation is recorded — see `assertNotPaid`.
   */
  PAYMENT_PENDING: {
    httpStatus: 202,
    retryable: true,
    terminal: false,
    retryGuidance: "poll-for-authoritative-outcome",
  },
  /** Registry §4: 503 (not 502) — fix the peripheral and retry the same print job. */
  PRINT_FAILED: { httpStatus: 503, retryable: true, terminal: true, retryGuidance: "backoff" },
  /**
   * KLD-2026-07-26-002 Group 5 (additive; status corrected 409 -> 422):
   * retryable only after a stable reading is available.
   */
  SCALE_UNSTABLE: {
    httpStatus: 422,
    retryable: true,
    terminal: true,
    retryGuidance: "after-stable-reading",
  },
  /**
   * KLD-2026-07-26-002 Group 5 (additive): HTTP 409 and NOT safe for blind
   * automatic replay. The operator must resolve or record the exception before
   * Ready or pickup completion.
   */
  GARMENT_COUNT_MISMATCH: {
    httpStatus: 409,
    retryable: false,
    terminal: true,
    retryGuidance: "operator-resolution-required",
  },
  STORAGE_POSITION_OCCUPIED: {
    httpStatus: 409,
    retryable: false,
    terminal: true,
    retryGuidance: "none",
  },
  /** POS Desktop spec v4.0.0 §14.3; no counterpart row in registry v1.0.0 §4 yet. */
  COLLECTOR_VERIFICATION_REQUIRED: {
    httpStatus: 403,
    retryable: false,
    terminal: true,
    retryGuidance: "none",
  },
  /** POS Desktop spec v4.0.0 §14.3; no counterpart row in registry v1.0.0 §4 yet. */
  BALANCE_PAYMENT_REQUIRED: {
    httpStatus: 402,
    retryable: false,
    terminal: true,
    retryGuidance: "none",
  },
  PICKUP_RELEASE_BLOCKED: {
    httpStatus: 409,
    retryable: false,
    terminal: true,
    retryGuidance: "none",
  },
} as const satisfies Readonly<Record<string, KitluyErrorCodeEntry>>;

export type KitluyErrorCode = keyof typeof ERROR_CODES;

/**
 * Retired scaffold identifiers and their canonical replacements
 * (KLD-2026-07-26-002 Group 5 mapping table).
 *
 * API Error Code Registry v1.0.0 §3.7 requires retired codes to stay documented
 * with their replacement. This map is DOCUMENTATION ONLY: it is deliberately
 * not consulted by `isKnownErrorCode` or any lookup, because KLD-2026-07-26-002
 * requires no runtime alias layer (no affected code was ever deployed).
 * Emitting a retired identifier must fail, not silently resolve.
 */
export const RETIRED_ERROR_CODES = {
  UNAUTHENTICATED: "AUTHENTICATION_REQUIRED",
  PERMISSION_DENIED: "SCOPE_PERMISSION_DENIED",
  ACTOR_PERMISSION_DENIED: "SCOPE_PERMISSION_DENIED",
  NOT_FOUND: "RESOURCE_NOT_FOUND",
  BOOKING_VERSION_CONFLICT: "RESOURCE_VERSION_CONFLICT",
  IDEMPOTENCY_KEY_REUSED: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
  DUPLICATE_IDEMPOTENCY_KEY: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
  SERVICE_UNAVAILABLE: "DEPENDENCY_UNAVAILABLE",
  PAYMENT_PROVIDER_UNAVAILABLE: "DEPENDENCY_UNAVAILABLE",
  STALE_DATA: "STALE_OPERATIONAL_DATA",
  INTERNAL: "INTERNAL_ERROR",
  /**
   * Retired with no single replacement: each call site emits the applicable
   * specific registered conflict code (KLD-2026-07-26-002 Group 5).
   */
  CONFLICT: null,
} as const satisfies Readonly<Record<string, KitluyErrorCode | null>>;

export type KitluyRetiredErrorCode = keyof typeof RETIRED_ERROR_CODES;

export function isKnownErrorCode(code: string): code is KitluyErrorCode {
  return Object.prototype.hasOwnProperty.call(ERROR_CODES, code);
}

/** True for pre-decision identifiers that must never be emitted or aliased. */
export function isRetiredErrorCode(code: string): code is KitluyRetiredErrorCode {
  return Object.prototype.hasOwnProperty.call(RETIRED_ERROR_CODES, code);
}

export function httpStatusFor(code: KitluyErrorCode): number {
  return ERROR_CODES[code].httpStatus;
}

export function isRetryable(code: KitluyErrorCode): boolean {
  return ERROR_CODES[code].retryable;
}

/** The approved retry contract for a code (KLD-2026-07-26-002 Group 5). */
export function retryGuidanceFor(code: KitluyErrorCode): KitluyRetryGuidance {
  return ERROR_CODES[code].retryGuidance;
}

/**
 * `true` when the code carries a final outcome. `false` marks an accepted
 * non-terminal outcome whose authoritative result is still unknown, so callers
 * MUST keep polling rather than settling state (KLD-2026-07-26-002 Group 5).
 */
export function isTerminal(code: KitluyErrorCode): boolean {
  return ERROR_CODES[code].terminal;
}

/** Inverse of {@link isTerminal}: an accepted, still-open business outcome. */
export function isPendingOutcome(code: KitluyErrorCode): boolean {
  return !ERROR_CODES[code].terminal;
}

/**
 * Fail-closed settlement predicate the service layer MUST consult before
 * recording any paid/terminal success derived from an API outcome.
 *
 * KLD-2026-07-26-002 Group 5: no registered code is authoritative payment
 * confirmation, and `PAYMENT_PENDING` explicitly is not. The literal `false`
 * return type makes it impossible for a caller to narrow a registry outcome
 * into a paid state.
 */
export function isAuthoritativePaymentSuccess(code: KitluyErrorCode): false {
  void code;
  return false;
}

/** Thrown when a caller tries to settle payment on a non-terminal outcome. */
export class PaymentNotAuthoritativeError extends Error {
  readonly code: KitluyErrorCode;

  constructor(code: KitluyErrorCode) {
    super(
      `${code} is an accepted non-terminal outcome; authoritative payment confirmation is absent.`,
    );
    this.name = "PaymentNotAuthoritativeError";
    this.code = code;
  }
}

/**
 * Guard for the payment settlement path. Throws on any non-terminal outcome
 * (`PAYMENT_PENDING`) so a pending payment can never be silently coerced into
 * "paid" (KLD-2026-07-26-002 Group 5; API Error Code Registry v1.0.0 §4
 * required action: "Poll/await verified provider event; do not mark paid").
 */
export function assertNotPaid(code: KitluyErrorCode): void {
  if (isPendingOutcome(code)) {
    throw new PaymentNotAuthoritativeError(code);
  }
}

/**
 * Canonical localization key for a code. API Error Code Registry v1.0.0 §2
 * envelope contract: `message_key` is `api.error.<lowercase code>`
 * (e.g. `api.error.resource_version_conflict`, `api.error.hub_read_only`).
 */
export function messageKeyFor(code: KitluyErrorCode): string {
  return `api.error.${code.toLowerCase()}`;
}

export function errorEnvelope(
  code: KitluyErrorCode,
  message: string,
  extras?: { correlationId?: string; details?: Readonly<Record<string, unknown>> },
): KitluyErrorEnvelope {
  return {
    error: {
      code,
      message,
      ...(extras?.correlationId !== undefined ? { correlationId: extras.correlationId } : {}),
      ...(extras?.details !== undefined ? { details: extras.details } : {}),
    },
  };
}
