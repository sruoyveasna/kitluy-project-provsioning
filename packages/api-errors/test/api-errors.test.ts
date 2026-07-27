import { describe, expect, it } from "vitest";
import {
  assertNotPaid,
  ERROR_CODES,
  errorEnvelope,
  httpStatusFor,
  isAuthoritativePaymentSuccess,
  isKnownErrorCode,
  isPendingOutcome,
  isRetiredErrorCode,
  isRetryable,
  isTerminal,
  messageKeyFor,
  PaymentNotAuthoritativeError,
  RETIRED_ERROR_CODES,
  retryGuidanceFor,
  type KitluyErrorCode,
} from "../src/index.js";

const ALL_CODES = Object.keys(ERROR_CODES) as KitluyErrorCode[];

/** KLD-2026-07-26-002 Group 5 mapping table: retired scaffold identifiers. */
const RETIRED_NAMES = [
  "UNAUTHENTICATED",
  "PERMISSION_DENIED",
  "ACTOR_PERMISSION_DENIED",
  "NOT_FOUND",
  "BOOKING_VERSION_CONFLICT",
  "IDEMPOTENCY_KEY_REUSED",
  "DUPLICATE_IDEMPOTENCY_KEY",
  "SERVICE_UNAVAILABLE",
  "PAYMENT_PROVIDER_UNAVAILABLE",
  "STALE_DATA",
  "CONFLICT",
  "INTERNAL",
];

describe("@kitluy/api-errors", () => {
  it("registers the edge error codes named in POS Desktop spec v4.0.0 §14.3", () => {
    for (const code of [
      "DEVICE_NOT_ASSIGNED",
      "PROFILE_NOT_ALLOWED",
      "HUB_UNREACHABLE",
      "CONFIG_VERSION_INCOMPATIBLE",
      "PAYMENT_PENDING",
      "PRINT_FAILED",
      "SCALE_UNSTABLE",
      "GARMENT_COUNT_MISMATCH",
      "STORAGE_POSITION_OCCUPIED",
      "COLLECTOR_VERIFICATION_REQUIRED",
      "BALANCE_PAYMENT_REQUIRED",
      "PICKUP_RELEASE_BLOCKED",
    ]) {
      expect(isKnownErrorCode(code)).toBe(true);
    }
  });

  it("maps codes to HTTP statuses and retryability", () => {
    expect(httpStatusFor("AUTHENTICATION_REQUIRED")).toBe(401);
    expect(httpStatusFor("BALANCE_PAYMENT_REQUIRED")).toBe(402);
    expect(isRetryable("HUB_UNREACHABLE")).toBe(true);
    expect(isRetryable("PICKUP_RELEASE_BLOCKED")).toBe(false);
  });

  it("builds a stable error envelope", () => {
    const env = errorEnvelope("VALIDATION_FAILED", "phone is not a Cambodian number", {
      correlationId: "corr-1",
      details: { field: "phone" },
    });
    expect(env.error.code).toBe("VALIDATION_FAILED");
    expect(env.error.correlationId).toBe("corr-1");
    expect(env.error.details).toEqual({ field: "phone" });
  });

  it("rejects unknown codes at the type/guard level", () => {
    expect(isKnownErrorCode("SOMETHING_ELSE")).toBe(false);
    expect(Object.keys(ERROR_CODES).length).toBe(23);
  });

  // --- API Error Code Registry v1.0.0 §4 canonical names ----------------------

  it("uses the canonical registry names approved in KLD-2026-07-26-002 Group 5", () => {
    for (const code of [
      "AUTHENTICATION_REQUIRED",
      "SCOPE_PERMISSION_DENIED",
      "RESOURCE_NOT_FOUND",
      "RESOURCE_VERSION_CONFLICT",
      "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
      "DEPENDENCY_UNAVAILABLE",
      "STALE_OPERATIONAL_DATA",
    ]) {
      expect(isKnownErrorCode(code)).toBe(true);
    }
  });

  it("does not know any retired scaffold identifier", () => {
    for (const name of RETIRED_NAMES) {
      expect(isKnownErrorCode(name)).toBe(false);
      expect(isRetiredErrorCode(name)).toBe(true);
    }
    expect(Object.keys(RETIRED_ERROR_CODES).sort()).toEqual([...RETIRED_NAMES].sort());
  });

  it("documents a known canonical replacement for every retired identifier", () => {
    for (const [retired, replacement] of Object.entries(RETIRED_ERROR_CODES)) {
      if (replacement === null) {
        // Generic CONFLICT retires with no single replacement: each call site
        // emits the applicable specific registered conflict code.
        expect(retired).toBe("CONFLICT");
        continue;
      }
      expect(isKnownErrorCode(replacement)).toBe(true);
    }
    // The replacement map must never act as a runtime alias.
    for (const name of RETIRED_NAMES) {
      expect(ALL_CODES).not.toContain(name);
    }
  });

  it("carries the registry status and retryability for the merged codes", () => {
    // PERMISSION_DENIED + ACTOR_PERMISSION_DENIED collapse into one 403 code.
    expect(httpStatusFor("SCOPE_PERMISSION_DENIED")).toBe(403);
    expect(isRetryable("SCOPE_PERMISSION_DENIED")).toBe(false);

    // IDEMPOTENCY_KEY_REUSED + DUPLICATE_IDEMPOTENCY_KEY merge into one 409 code.
    expect(httpStatusFor("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST")).toBe(409);
    expect(isRetryable("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST")).toBe(false);

    // SERVICE_UNAVAILABLE + PAYMENT_PROVIDER_UNAVAILABLE merge into one 503 code.
    expect(httpStatusFor("DEPENDENCY_UNAVAILABLE")).toBe(503);
    expect(isRetryable("DEPENDENCY_UNAVAILABLE")).toBe(true);
    expect(retryGuidanceFor("DEPENDENCY_UNAVAILABLE")).toBe("backoff");
  });

  it("matches the API Error Code Registry v1.0.0 §4 table row for row", () => {
    const expected: Record<string, { httpStatus: number; retryable: boolean }> = {
      AUTHENTICATION_REQUIRED: { httpStatus: 401, retryable: false },
      SCOPE_PERMISSION_DENIED: { httpStatus: 403, retryable: false },
      RESOURCE_NOT_FOUND: { httpStatus: 404, retryable: false },
      VALIDATION_FAILED: { httpStatus: 422, retryable: false },
      RESOURCE_VERSION_CONFLICT: { httpStatus: 409, retryable: false },
      IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST: { httpStatus: 409, retryable: false },
      RATE_LIMITED: { httpStatus: 429, retryable: true },
      DEPENDENCY_UNAVAILABLE: { httpStatus: 503, retryable: true },
      // Registry §4: stale operational truth is NOT blind-retryable.
      STALE_OPERATIONAL_DATA: { httpStatus: 409, retryable: false },
      // Registry §4 lists PRINT_FAILED as 503, not 502.
      PRINT_FAILED: { httpStatus: 503, retryable: true },
      PAYMENT_PENDING: { httpStatus: 202, retryable: true },
      HUB_UNREACHABLE: { httpStatus: 503, retryable: true },
      DEVICE_NOT_ASSIGNED: { httpStatus: 403, retryable: false },
      PROFILE_NOT_ALLOWED: { httpStatus: 403, retryable: false },
      CONFIG_VERSION_INCOMPATIBLE: { httpStatus: 409, retryable: false },
      STORAGE_POSITION_OCCUPIED: { httpStatus: 409, retryable: false },
      PICKUP_RELEASE_BLOCKED: { httpStatus: 409, retryable: false },
    };
    for (const [code, row] of Object.entries(expected)) {
      expect(isKnownErrorCode(code)).toBe(true);
      expect(httpStatusFor(code as KitluyErrorCode)).toBe(row.httpStatus);
      expect(isRetryable(code as KitluyErrorCode)).toBe(row.retryable);
    }
  });

  // --- KLD-2026-07-26-002 Group 5 additive codes ------------------------------

  it("registers the four canonical names approved in KLD-2026-07-26-002 Group 5", () => {
    for (const code of [
      "INTERNAL_ERROR",
      "SCALE_UNSTABLE",
      "GARMENT_COUNT_MISMATCH",
      "HUB_READ_ONLY",
    ]) {
      expect(isKnownErrorCode(code)).toBe(true);
    }
  });

  it("uses the approved HTTP statuses for the four Group 5 codes", () => {
    expect(httpStatusFor("INTERNAL_ERROR")).toBe(500);
    expect(httpStatusFor("SCALE_UNSTABLE")).toBe(422);
    expect(httpStatusFor("GARMENT_COUNT_MISMATCH")).toBe(409);
    expect(httpStatusFor("HUB_READ_ONLY")).toBe(503);
  });

  it("carries the approved retryability semantics for the four Group 5 codes", () => {
    // INTERNAL_ERROR: retryable with the SAME idempotency key; never a success claim.
    expect(isRetryable("INTERNAL_ERROR")).toBe(true);
    expect(retryGuidanceFor("INTERNAL_ERROR")).toBe("same-idempotency-key");

    // SCALE_UNSTABLE: bounded retry — only once a stable reading exists.
    expect(isRetryable("SCALE_UNSTABLE")).toBe(true);
    expect(retryGuidanceFor("SCALE_UNSTABLE")).toBe("after-stable-reading");

    // GARMENT_COUNT_MISMATCH: NOT safe for blind automatic replay.
    expect(isRetryable("GARMENT_COUNT_MISMATCH")).toBe(false);
    expect(retryGuidanceFor("GARMENT_COUNT_MISMATCH")).toBe("operator-resolution-required");

    // HUB_READ_ONLY: retry only after Hub write health recovers.
    expect(isRetryable("HUB_READ_ONLY")).toBe(true);
    expect(retryGuidanceFor("HUB_READ_ONLY")).toBe("after-hub-write-health-recovers");
  });

  it("registers no EDGE_-prefixed production error identifiers", () => {
    for (const code of ALL_CODES) {
      expect(code.startsWith("EDGE_")).toBe(false);
    }
  });

  it("treats PAYMENT_PENDING as an accepted non-terminal 202 outcome", () => {
    expect(httpStatusFor("PAYMENT_PENDING")).toBe(202);
    expect(isTerminal("PAYMENT_PENDING")).toBe(false);
    expect(isPendingOutcome("PAYMENT_PENDING")).toBe(true);
    expect(retryGuidanceFor("PAYMENT_PENDING")).toBe("poll-for-authoritative-outcome");
    // It is the only non-terminal outcome in the registry.
    expect(ALL_CODES.filter((code) => !isTerminal(code))).toEqual(["PAYMENT_PENDING"]);
  });

  it("never lets PAYMENT_PENDING be read as a paid/terminal success state", () => {
    expect(isAuthoritativePaymentSuccess("PAYMENT_PENDING")).toBe(false);
    expect(() => assertNotPaid("PAYMENT_PENDING")).toThrow(PaymentNotAuthoritativeError);
    // No registered code is ever authoritative payment confirmation.
    for (const code of ALL_CODES) {
      expect(isAuthoritativePaymentSuccess(code)).toBe(false);
    }
    // Terminal codes are not payment settlements either — the guard is a no-op there.
    expect(() => assertNotPaid("VALIDATION_FAILED")).not.toThrow();
  });

  it("keeps HUB_READ_ONLY fail-closed while the Hub cannot accept writes", () => {
    expect(httpStatusFor("HUB_READ_ONLY")).toBe(503);
    expect(isTerminal("HUB_READ_ONLY")).toBe(true);
    // Retry is permitted only under the recovery contract, never blindly.
    expect(retryGuidanceFor("HUB_READ_ONLY")).toBe("after-hub-write-health-recovers");
    expect(retryGuidanceFor("HUB_READ_ONLY")).not.toBe("backoff");
    expect(isAuthoritativePaymentSuccess("HUB_READ_ONLY")).toBe(false);
  });

  it("exposes registry message keys for canonical and Group 5 codes", () => {
    expect(messageKeyFor("INTERNAL_ERROR")).toBe("api.error.internal_error");
    expect(messageKeyFor("SCALE_UNSTABLE")).toBe("api.error.scale_unstable");
    expect(messageKeyFor("GARMENT_COUNT_MISMATCH")).toBe("api.error.garment_count_mismatch");
    expect(messageKeyFor("HUB_READ_ONLY")).toBe("api.error.hub_read_only");
    // Registry v1.0.0 §2 envelope example.
    expect(messageKeyFor("RESOURCE_VERSION_CONFLICT")).toBe("api.error.resource_version_conflict");
    expect(messageKeyFor("AUTHENTICATION_REQUIRED")).toBe("api.error.authentication_required");
    expect(messageKeyFor("SCOPE_PERMISSION_DENIED")).toBe("api.error.scope_permission_denied");
    expect(messageKeyFor("RESOURCE_NOT_FOUND")).toBe("api.error.resource_not_found");
    expect(messageKeyFor("DEPENDENCY_UNAVAILABLE")).toBe("api.error.dependency_unavailable");
    expect(messageKeyFor("STALE_OPERATIONAL_DATA")).toBe("api.error.stale_operational_data");
    expect(messageKeyFor("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST")).toBe(
      "api.error.idempotency_key_reused_with_different_request",
    );
    // Every code has a lowercase, dot-namespaced key.
    for (const code of ALL_CODES) {
      expect(messageKeyFor(code)).toBe(`api.error.${code.toLowerCase()}`);
    }
  });

  it("keeps every registered entry structurally complete", () => {
    for (const code of ALL_CODES) {
      const entry = ERROR_CODES[code];
      expect(Number.isInteger(entry.httpStatus)).toBe(true);
      expect(typeof entry.retryable).toBe("boolean");
      expect(typeof entry.terminal).toBe("boolean");
      // Codes are uppercase SNAKE_CASE (registry v1.0.0 §3.2).
      expect(code).toMatch(/^[A-Z][A-Z0-9_]*$/);
      // Non-retryable codes never advertise an automatic replay contract.
      if (!entry.retryable) {
        expect(["none", "operator-resolution-required"]).toContain(entry.retryGuidance);
      }
    }
  });
});
