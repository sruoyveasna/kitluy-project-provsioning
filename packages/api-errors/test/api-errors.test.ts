import { describe, expect, it } from "vitest";
import {
  ERROR_CODES,
  errorEnvelope,
  httpStatusFor,
  isKnownErrorCode,
  isRetryable,
} from "../src/index.js";

describe("@kitluy/api-errors", () => {
  it("registers the edge error codes named in POS Desktop spec v4.0.0 §14.3", () => {
    for (const code of [
      "DEVICE_NOT_ASSIGNED",
      "PROFILE_NOT_ALLOWED",
      "ACTOR_PERMISSION_DENIED",
      "HUB_UNREACHABLE",
      "CONFIG_VERSION_INCOMPATIBLE",
      "BOOKING_VERSION_CONFLICT",
      "DUPLICATE_IDEMPOTENCY_KEY",
      "PAYMENT_PENDING",
      "PAYMENT_PROVIDER_UNAVAILABLE",
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
    expect(httpStatusFor("UNAUTHENTICATED")).toBe(401);
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
    expect(Object.keys(ERROR_CODES).length).toBeGreaterThanOrEqual(26);
  });
});
