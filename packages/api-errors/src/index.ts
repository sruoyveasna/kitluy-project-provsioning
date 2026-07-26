/**
 * @kitluy/api-errors — canonical error envelope and error-code registry.
 *
 * Source authority: rebuild bible v4.0.0 §10.2 (every contract defines typed
 * errors); POS Desktop spec v4.0.0 §14.3 (named edge error codes); API routes
 * must not leak provider-specific infrastructure details.
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
 * Error-code registry. Codes under `edge.*` come from POS Desktop spec v4.0.0
 * §14.3 verbatim. Generic codes are the shared API foundation set.
 */
export const ERROR_CODES = {
  // Shared foundation
  UNAUTHENTICATED: { httpStatus: 401, retryable: false },
  PERMISSION_DENIED: { httpStatus: 403, retryable: false },
  NOT_FOUND: { httpStatus: 404, retryable: false },
  VALIDATION_FAILED: { httpStatus: 422, retryable: false },
  CONFLICT: { httpStatus: 409, retryable: false },
  IDEMPOTENCY_KEY_REUSED: { httpStatus: 409, retryable: false },
  RATE_LIMITED: { httpStatus: 429, retryable: true },
  INTERNAL: { httpStatus: 500, retryable: true },
  SERVICE_UNAVAILABLE: { httpStatus: 503, retryable: true },
  STALE_DATA: { httpStatus: 409, retryable: true },

  // Edge codes (POS Desktop spec v4.0.0 §14.3)
  DEVICE_NOT_ASSIGNED: { httpStatus: 403, retryable: false },
  PROFILE_NOT_ALLOWED: { httpStatus: 403, retryable: false },
  ACTOR_PERMISSION_DENIED: { httpStatus: 403, retryable: false },
  HUB_UNREACHABLE: { httpStatus: 503, retryable: true },
  CONFIG_VERSION_INCOMPATIBLE: { httpStatus: 409, retryable: false },
  BOOKING_VERSION_CONFLICT: { httpStatus: 409, retryable: false },
  DUPLICATE_IDEMPOTENCY_KEY: { httpStatus: 409, retryable: false },
  PAYMENT_PENDING: { httpStatus: 409, retryable: true },
  PAYMENT_PROVIDER_UNAVAILABLE: { httpStatus: 503, retryable: true },
  PRINT_FAILED: { httpStatus: 502, retryable: true },
  SCALE_UNSTABLE: { httpStatus: 409, retryable: true },
  GARMENT_COUNT_MISMATCH: { httpStatus: 409, retryable: false },
  STORAGE_POSITION_OCCUPIED: { httpStatus: 409, retryable: false },
  COLLECTOR_VERIFICATION_REQUIRED: { httpStatus: 403, retryable: false },
  BALANCE_PAYMENT_REQUIRED: { httpStatus: 402, retryable: false },
  PICKUP_RELEASE_BLOCKED: { httpStatus: 409, retryable: false },
} as const;

export type KitluyErrorCode = keyof typeof ERROR_CODES;

export function isKnownErrorCode(code: string): code is KitluyErrorCode {
  return Object.prototype.hasOwnProperty.call(ERROR_CODES, code);
}

export function httpStatusFor(code: KitluyErrorCode): number {
  return ERROR_CODES[code].httpStatus;
}

export function isRetryable(code: KitluyErrorCode): boolean {
  return ERROR_CODES[code].retryable;
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
